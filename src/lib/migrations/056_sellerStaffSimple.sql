-- ══════════════════════════════════════════════════
-- MedSetu — Seller-Staff, simple scope (NOT the aggregator-staff branch)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Deliberately a light system: a seller owner can add staff who see their
-- shop's order pool and move it pending -> confirmed -> preparing ->
-- out_for_delivery, using the staff/staff_assignment tables already live
-- from 052_deliveryPartner.sql (role_type='seller_staff' vs
-- 'delivery_partner'). Does NOT port the aggregator-staff branch's
-- wholesaler-deployment/claim-pool/is_aggregator machinery — out of scope.
--
-- Read-only check done first (see conversation): all 3 current sellers
-- already have sellers.user_id set, so the exact "Sarthak Medical" gap
-- doesn't exist today. Still hardened below with a sellers.email fallback,
-- since that gap is specifically about a FUTURE seller whose user_id
-- backfill (AuthContext.jsx, on first login) never ran or matched.
--
-- Three fixes beyond the original draft, each noted inline where it
-- applies:
--   1. add_seller_staff/end_seller_staff: sellers.email fallback for
--      owner resolution (the hardening above).
--   2. add_seller_staff: advisory lock + unique_violation handling for
--      staff.staff_code/email UNIQUE constraints — same class of race
--      already found and fixed for DEL-codes in 055_deliveryPartnerRegistration.sql.
--   3. staff_accept_order: actually reserves stock (reserve_stock/
--      release_stock, same functions SellerDashboard.jsx's own accept
--      flow uses) and locks the order row before doing so — the original
--      draft flipped status with zero inventory impact, which is the
--      exact overselling risk reserve_stock exists to prevent.
--
-- Also adds RLS the draft didn't include but the UI needs: order_items
-- visibility for staff (their orders SELECT access doesn't propagate to
-- the item rows, which have their own independent policy), and
-- staff_assignment/staff visibility for the OWNER (today only a staff
-- member can see their own row — the owner has no policy letting them
-- read the very staff they're managing).


-- ================================================================
-- 1. add_seller_staff(p_name, p_email)
-- ================================================================
CREATE OR REPLACE FUNCTION add_seller_staff(
  p_name text, p_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
  v_staff_id uuid;
  v_staff_code text;
BEGIN
  -- LEFT JOIN + sellers.email fallback (not just the user_id-linked
  -- join) — see file header note.
  SELECT s.id INTO v_seller_id FROM sellers s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email()
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Seller nahi mila');
  END IF;

  -- Serializes staff_code generation across concurrent add_seller_staff
  -- calls (any seller) — without it two sellers adding staff at the same
  -- moment could compute the same COUNT(*)+1 and one insert would crash
  -- on staff_staff_code_key. Held only for the rest of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('add_seller_staff_staff_code'));

  SELECT 'SS' || LPAD((COUNT(*) + 1)::text, 4, '0') INTO v_staff_code
  FROM staff WHERE staff_code LIKE 'SS%';

  BEGIN
    INSERT INTO staff (staff_code, email, name)
    VALUES (v_staff_code, p_email, p_name)
    RETURNING id INTO v_staff_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye email pehle se kisi staff/delivery-partner record mein hai');
  END;

  INSERT INTO staff_assignment (staff_id, seller_id, role_type, is_active)
  VALUES (v_staff_id, v_seller_id, 'seller_staff', true);

  RETURN jsonb_build_object('success', true, 'staff_code', v_staff_code);
END; $$;


-- ================================================================
-- 2. end_seller_staff(p_staff_id)
-- ================================================================
CREATE OR REPLACE FUNCTION end_seller_staff(p_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT s.id INTO v_seller_id FROM sellers s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email()
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Seller nahi mila');
  END IF;

  UPDATE staff_assignment SET is_active = false, ended_at = now()
  WHERE staff_id = p_staff_id AND seller_id = v_seller_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Staff nahi mila ya aapka nahi hai');
  END IF;

  RETURN jsonb_build_object('success', true);
END; $$;


-- ================================================================
-- 3. my_seller_staff_context()
-- ================================================================
CREATE OR REPLACE FUNCTION my_seller_staff_context()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'staff_id', st.id,
    'staff_code', st.staff_code,
    'name', st.name,
    'seller_id', sa.seller_id,
    'is_active', sa.is_active
  ) INTO v_result
  FROM staff st
  JOIN staff_assignment sa ON sa.staff_id = st.id
  WHERE st.email = auth.email()
    AND sa.role_type = 'seller_staff'
    AND sa.is_active = true
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Active staff nahi mila');
  END IF;

  RETURN jsonb_build_object('success', true) || v_result;
END; $$;


-- ================================================================
-- 4a. staff_accept_order(p_order_id) — pending -> confirmed
-- ================================================================
-- Reworked from the draft to actually reserve stock (reserve_stock/
-- release_stock — same DB functions lib/inventory.js's reserveStock()
-- calls for the owner's own Accept button) and to lock the order row
-- BEFORE reserving anything: if a concurrent accept (another staff
-- member, or the owner clicking Accept in their own dashboard) wins the
-- race, this call sees status already flipped at lock-acquisition time
-- and returns immediately, never touching inventory. Reserving first and
-- checking status after would risk an orphaned reservation nobody
-- releases when this call turns out to have lost the race.
CREATE OR REPLACE FUNCTION staff_accept_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id    uuid;
  v_order        orders%ROWTYPE;
  v_item         RECORD;
  v_success      boolean;
  v_available    integer;
  v_reserved_med uuid[]    := '{}';
  v_reserved_qty integer[] := '{}';
  i              integer;
BEGIN
  SELECT sa.seller_id INTO v_seller_id
  FROM staff st JOIN staff_assignment sa ON sa.staff_id = st.id
  WHERE st.email = auth.email()
    AND sa.role_type = 'seller_staff' AND sa.is_active = true;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authorized nahi');
  END IF;

  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id AND seller_id = v_seller_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order accept nahi ho paya');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order accept nahi ho paya');
  END IF;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    SELECT success, available INTO v_success, v_available
    FROM reserve_stock(v_seller_id, v_item.medicine_id, v_item.quantity);

    IF NOT v_success THEN
      -- Roll back everything reserved so far in this call — same
      -- partial-failure behaviour as reserveStock()'s client-side loop
      -- (lib/inventory.js), just done atomically inside one transaction.
      FOR i IN 1 .. COALESCE(array_length(v_reserved_med, 1), 0) LOOP
        PERFORM release_stock(v_seller_id, v_reserved_med[i], v_reserved_qty[i]);
      END LOOP;
      RETURN jsonb_build_object('success', false, 'message',
        'Stock kam hai — ' || COALESCE(v_item.name, 'Medicine') || ' ke sirf ' || v_available || ' unit bache hain');
    END IF;

    v_reserved_med := array_append(v_reserved_med, v_item.medicine_id);
    v_reserved_qty := array_append(v_reserved_qty, v_item.quantity);
  END LOOP;

  UPDATE orders SET status = 'confirmed', updated_at = now() WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END; $$;


-- ================================================================
-- 4b. staff_mark_packed(p_order_id) — confirmed -> preparing
-- ================================================================
-- Pure status transition, no stock impact (matches the owner's own
-- markOutForDeliveryImpl-style transitions) — kept as drafted.
CREATE OR REPLACE FUNCTION staff_mark_packed(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT sa.seller_id INTO v_seller_id
  FROM staff st JOIN staff_assignment sa ON sa.staff_id = st.id
  WHERE st.email = auth.email()
    AND sa.role_type = 'seller_staff' AND sa.is_active = true;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authorized nahi');
  END IF;

  UPDATE orders SET status = 'preparing', updated_at = now()
  WHERE id = p_order_id AND seller_id = v_seller_id AND status = 'confirmed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pack nahi ho paya');
  END IF;

  RETURN jsonb_build_object('success', true);
END; $$;


-- ================================================================
-- 4c. staff_handover_order(p_order_id) — preparing -> out_for_delivery
-- ================================================================
CREATE OR REPLACE FUNCTION staff_handover_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT sa.seller_id INTO v_seller_id
  FROM staff st JOIN staff_assignment sa ON sa.staff_id = st.id
  WHERE st.email = auth.email()
    AND sa.role_type = 'seller_staff' AND sa.is_active = true;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authorized nahi');
  END IF;

  UPDATE orders SET status = 'out_for_delivery', updated_at = now()
  WHERE id = p_order_id AND seller_id = v_seller_id AND status = 'preparing';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Handover nahi ho paya');
  END IF;

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION add_seller_staff(text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION end_seller_staff(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION my_seller_staff_context()     TO authenticated;
GRANT EXECUTE ON FUNCTION staff_accept_order(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION staff_mark_packed(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION staff_handover_order(uuid)    TO authenticated;


-- ================================================================
-- 5. RLS
-- ================================================================

-- Staff can see their own seller's order pool — additive (Postgres ORs
-- multiple permissive SELECT policies together), orders_select_involved_or_staff
-- and the delivery-partner policy from 053 are both untouched.
DROP POLICY IF EXISTS "seller_staff_view_orders" ON orders;
CREATE POLICY "seller_staff_view_orders" ON orders
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM staff st
    JOIN staff_assignment sa ON sa.staff_id = st.id
    WHERE st.email = auth.email()
    AND sa.role_type = 'seller_staff' AND sa.is_active = true
    AND sa.seller_id = orders.seller_id
  )
);

-- NOT in the original draft: order_items_select_via_order re-derives
-- party membership independently of orders' own RLS — passing orders'
-- check above does not make the item rows visible too. Without this, the
-- pool list and the invoice would both see the order but zero line items.
DROP POLICY IF EXISTS "seller_staff_view_order_items" ON order_items;
CREATE POLICY "seller_staff_view_order_items" ON order_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders o
    JOIN staff st ON true
    JOIN staff_assignment sa ON sa.staff_id = st.id AND sa.seller_id = o.seller_id
    WHERE o.id = order_items.order_id
      AND st.email = auth.email()
      AND sa.role_type = 'seller_staff' AND sa.is_active = true
  )
);

-- NOT in the original draft: today only a staff member can see their OWN
-- staff/staff_assignment row (staff_select_own / staff_assignment_select_own,
-- both from earlier migrations) — the OWNER has no policy letting them
-- read the staff they themselves added. Without these two, PART B's
-- "Mera Staff" list silently returns nothing under RLS.
DROP POLICY IF EXISTS "owner_view_staff_assignment" ON staff_assignment;
CREATE POLICY "owner_view_staff_assignment" ON staff_assignment
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sellers s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = staff_assignment.seller_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email())
  )
);

DROP POLICY IF EXISTS "owner_view_staff" ON staff;
CREATE POLICY "owner_view_staff" ON staff
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM staff_assignment sa
    JOIN sellers s ON s.id = sa.seller_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE sa.staff_id = staff.id
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email())
  )
);


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname FROM pg_proc WHERE proname IN
--   ('add_seller_staff','end_seller_staff','my_seller_staff_context',
--    'staff_accept_order','staff_mark_packed','staff_handover_order');

-- SELECT policyname, cmd, tablename FROM pg_policies
--   WHERE policyname IN ('seller_staff_view_orders','seller_staff_view_order_items',
--                         'owner_view_staff_assignment','owner_view_staff');

-- Real-session checks:
--   1. Seller owner calls add_seller_staff('Ramesh','ramesh@x.com') ->
--      {success:true, staff_code:'SS0001'}; staff + staff_assignment
--      (role_type='seller_staff', is_active=true, seller_id=owner's) rows created.
--   2. Same owner, SELECT from staff_assignment/staff (client, RLS-enforced)
--      -> now sees the row (previously would've seen 0 rows).
--   3. Ramesh logs in (Google, own email), calls my_seller_staff_context()
--      -> {success:true, staff_id, staff_code:'SS0001', seller_id, is_active:true}.
--   4. Ramesh SELECTs orders where seller_id = owner's -> sees them (RLS);
--      a DIFFERENT seller's orders -> sees nothing.
--   5. Ramesh calls staff_accept_order on a pending order with enough
--      stock -> {success:true}; seller_inventory.reserved_quantity went up
--      per item; order.status='confirmed'.
--   6. Same, but one item is short on stock -> {success:false, message
--      naming the short item}; NO item's reserved_quantity net-changed
--      (earlier successful reservations in the same call were released).
--   7. Two staff (or a staff + the owner) racing staff_accept_order /
--      Accept on the SAME pending order -> exactly one succeeds, the
--      loser sees status already 'confirmed' and never calls reserve_stock.
--   8. staff_mark_packed on a 'confirmed' order Ramesh doesn't have (wrong
--      seller_id) -> {success:false,'Pack nahi ho paya'}.
--   9. Owner calls end_seller_staff(ramesh_staff_id) -> {success:true};
--      staff_assignment.is_active=false, ended_at set; my_seller_staff_context()
--      for Ramesh now returns {success:false,'Active staff nahi mila'}.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP POLICY IF EXISTS "owner_view_staff" ON staff;
-- DROP POLICY IF EXISTS "owner_view_staff_assignment" ON staff_assignment;
-- DROP POLICY IF EXISTS "seller_staff_view_order_items" ON order_items;
-- DROP POLICY IF EXISTS "seller_staff_view_orders" ON orders;
-- DROP FUNCTION IF EXISTS staff_handover_order(uuid);
-- DROP FUNCTION IF EXISTS staff_mark_packed(uuid);
-- DROP FUNCTION IF EXISTS staff_accept_order(uuid);
-- DROP FUNCTION IF EXISTS my_seller_staff_context();
-- DROP FUNCTION IF EXISTS end_seller_staff(uuid);
-- DROP FUNCTION IF EXISTS add_seller_staff(text, text);
