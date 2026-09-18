-- ══════════════════════════════════════════════════
-- MedSetu — Delivery-partner early visibility: confirmed/preparing preview
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Today a delivery partner only sees an order once it's out_for_delivery
-- (053_deliveryPartnerOrdersRLS.sql) — they have zero advance notice while
-- a seller is packing it. This adds a READ-ONLY early-visibility layer:
-- confirmed/preparing orders in a serviceable pincode become visible (new
-- additive RLS policy, existing orders_select_delivery_partner untouched),
-- and staff_accept_order now records who accepted + broadcasts a heads-up
-- notification to every active delivery partner. No action buttons, no
-- claiming — DeliveryPartnerPanel.jsx's existing "Available Orders" pickup
-- flow (still out_for_delivery-only) is completely unchanged.
--
-- notifications.user_id verified against 001_schema.sql (REFERENCES
-- users(id)) — staff rows have no users row of their own, so the broadcast
-- loop below resolves each active delivery partner's users.id via
-- staff.email = users.email (same email-match precedent as
-- resolve_seller_user_id(), 019_notificationRpcV2.sql). A delivery partner
-- who has never logged in yet has no users row and is silently skipped —
-- same known gap resolve_seller_user_id() already has for un-linked sellers.

-- ================================================================
-- 1. orders.accepted_by_staff_id — who accepted this order
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_by_staff_id uuid REFERENCES staff(id);


-- ================================================================
-- 2. staff_accept_order — record acceptor + broadcast heads-up notification
-- ================================================================
-- Same body as 056_sellerStaffSimple.sql's version, two changes only:
--   a. the final UPDATE also sets accepted_by_staff_id
--   b. a notification loop right after, one row per active delivery
--      partner (broadcast pattern copied from advance_order_routing's
--      admin/super_admin exhaustion notify, 048_cronEscalation.sql /
--      052_deliveryPartner.sql)
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
  v_dp           RECORD;
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

  UPDATE orders SET
    status = 'confirmed',
    accepted_by_staff_id = (SELECT id FROM staff WHERE email = auth.email()),
    updated_at = now()
  WHERE id = p_order_id;

  -- Broadcast: every active delivery partner gets an early heads-up.
  -- Read-only preview only (RLS section 3 below) — nobody can claim off
  -- this notification, it's purely informational.
  FOR v_dp IN
    SELECT u.id AS user_id
    FROM staff st
    JOIN staff_assignment sa ON sa.staff_id = st.id
    JOIN users u ON u.email = st.email
    WHERE sa.role_type = 'delivery_partner' AND sa.is_active = true
  LOOP
    INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
    VALUES (
      v_dp.user_id, 'Naya Parcel Taiyar Ho Raha Hai 📦',
      COALESCE(v_order.order_number, p_order_id::text) || ' — pickup ke liye jald ready hoga',
      'delivery_upcoming', p_order_id, false
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION staff_accept_order(uuid) TO authenticated;


-- ================================================================
-- 3. RLS — confirmed/preparing preview for delivery partners
-- ================================================================
-- Additive — a second/third permissive SELECT policy on the same table
-- is OR'd together by Postgres with orders_select_involved_or_staff AND
-- orders_select_delivery_partner (053), so neither existing policy nor
-- the out_for_delivery claim flow changes at all. Deliberately no
-- delivered_by_staff_id / claim condition here — this is preview-only,
-- every active delivery partner in a serviceable pincode sees the same
-- upcoming pool.
DROP POLICY IF EXISTS "orders_select_delivery_partner_preview" ON orders;

CREATE POLICY "orders_select_delivery_partner_preview" ON orders
  FOR SELECT TO authenticated
  USING (
    is_active_delivery_partner() AND
    status IN ('confirmed', 'preparing') AND
    delivery_pincode IN (SELECT pincode FROM serviceable_pincodes WHERE delivery_enabled = true)
  );


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'accepted_by_staff_id';

-- SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'orders' AND policyname = 'orders_select_delivery_partner_preview';

-- SELECT prosrc ~ 'accepted_by_staff_id' AND prosrc ~ 'delivery_upcoming'
--   FROM pg_proc WHERE proname = 'staff_accept_order';

-- Real-session checks:
--   1. Seller staff accepts a pending order -> order.accepted_by_staff_id
--      = the accepting staff's id; status='confirmed' (unchanged behaviour
--      otherwise — stock still reserved exactly as before).
--   2. Every active delivery_partner who has logged in at least once (has
--      a matching users row) gets one 'delivery_upcoming' notification
--      with ref_id = that order.
--   3. A delivery_partner staff row with NO users row yet (never logged
--      in) -> silently skipped, no error, no row inserted for them.
--   4. Logged-in delivery partner: SELECT * FROM orders WHERE status IN
--      ('confirmed','preparing') -> now returns rows in delivery_enabled
--      pincodes (previously zero); a pincode NOT delivery_enabled, or a
--      'pending' order -> still invisible.
--   5. Existing out_for_delivery "Available Orders" pool (053's policy)
--      and the Pickup/OTP/Confirm flow -> unchanged.

-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP POLICY IF EXISTS "orders_select_delivery_partner_preview" ON orders;
-- -- staff_accept_order: re-apply 056_sellerStaffSimple.sql's version to
-- -- drop the accepted_by_staff_id set + notification broadcast.
-- ALTER TABLE orders DROP COLUMN IF EXISTS accepted_by_staff_id;
