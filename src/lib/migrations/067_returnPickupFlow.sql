-- ══════════════════════════════════════════════════
-- MedSetu — return pickup flow: delivery-partner leg + SuperAdmin gate
-- ══════════════════════════════════════════════════
--
-- New 5-step return flow:
--   1. Customer requests return (existing: request_return)
--   2. Seller accepts (existing: seller_review_return, p_action='accepted')
--   3. NEW: a delivery partner claims the pickup (claim_return_pickup),
--      collects from the customer, and confirms handover to the seller
--      (confirm_return_pickup — this is also where their earning is created)
--   4. Seller marks "Received" (existing seller_review_return,
--      p_action='return_received') — but ONLY once step 3 is confirmed
--   5. NEW GATE: SuperAdmin's refund queue only shows/accepts returns once
--      step 4 is done (seller_action='return_received'), not merely
--      'seller_reviewed' (which is also true for 'accepted'/'pickup_scheduled')
--
-- Three things found while building this that needed fixing alongside it:
--
--   (a) delivery_earnings has UNIQUE(order_id) (idx_one_earning_per_order).
--       confirm_return_pickup inserting a second earning row for the same
--       order_id (the return-pickup leg) would silently no-op against the
--       forward-delivery's existing row under that constraint. Fixed by
--       adding a return_id column and splitting the single unique index
--       into two partial ones (one per leg) — which also requires
--       confirm_delivery's existing ON CONFLICT target to be updated to
--       match, in the same migration, or that insert breaks outright.
--
--   (b) seller_review_return's 'return_received' action had no check
--       tying it to the delivery-partner leg at all — a seller could click
--       "Received" before any pickup was ever claimed/confirmed. Added a
--       pickup_confirmed_at IS NOT NULL requirement for that action only.
--
--   (c) admin_decide_return's backend gate (status IN
--       ('requested','seller_reviewed')) is looser than the new frontend
--       queue filter — a direct RPC call could still bypass the gate.
--       Tightened to require seller_action = 'return_received' explicitly,
--       matching the frontend change (a frontend-only gate isn't a gate).
--
-- Also: order_returns had zero RLS policies letting a delivery partner see
-- any row at all (only customer/seller/superadmin policies existed) — a
-- delivery partner querying order_returns from the client would always get
-- zero rows back, regardless of the RPCs working. Added a SELECT policy
-- mirroring orders_select_delivery_partner's shape (unclaimed pool scoped
-- to serviceable pincodes, OR already claimed by me).

-- ────────────────────────────────────────────────────────────────
-- 1) order_returns — new columns for the delivery-partner leg
-- ────────────────────────────────────────────────────────────────
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS
  pickup_staff_id uuid REFERENCES staff(id);
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS
  pickup_confirmed_at timestamptz;

-- ────────────────────────────────────────────────────────────────
-- 2) delivery_earnings — split the one-earning-per-order constraint into
--    one-per-leg (forward delivery vs return pickup)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE delivery_earnings ADD COLUMN IF NOT EXISTS
  return_id uuid REFERENCES order_returns(id);

DROP INDEX IF EXISTS idx_one_earning_per_order;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_delivery_earning_per_order
  ON delivery_earnings(order_id) WHERE return_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_return_earning_per_return
  ON delivery_earnings(return_id) WHERE return_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3) confirm_delivery — unchanged except the ON CONFLICT target, to match
--    the new partial index above (return_id IS NULL for this leg)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_delivery(p_order_id uuid, p_otp_entered text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flat_rate CONSTANT numeric := 25;
  v_order     orders%ROWTYPE;
  v_seller    sellers%ROWTYPE;
  v_ps        platform_settings%ROWTYPE;
  v_staff_id  uuid;
  v_subtotal  numeric;
  v_comm_amt  numeric := 0;
  v_rate      numeric;
  v_earning   numeric;
  v_item      RECORD;
  v_item_rate numeric;
  v_deduct_ok boolean;
BEGIN
  SELECT s.id INTO v_staff_id
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner'
    AND a.is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Aap active delivery partner nahi hain');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status <> 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Order abhi delivery ke liye ready nahi hai (status: ' || v_order.status || ')');
  END IF;

  IF v_order.delivery_otp IS NULL OR v_order.delivery_otp <> p_otp_entered THEN
    RETURN jsonb_build_object('success', false, 'message', 'Galat OTP');
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = v_order.seller_id;
  SELECT * INTO v_ps     FROM platform_settings WHERE id = 1;

  IF v_order.commission_amount IS NULL THEN
    v_subtotal := COALESCE(v_order.final_amount, 0) - COALESCE(v_order.delivery_charge, 0);
    IF v_seller.commission_mode = 'tier' THEN
      FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
        IF v_item.commission_band = 'high' THEN
          v_item_rate := v_ps.tier_high_rate;
        ELSIF v_item.commission_band = 'moderate' THEN
          v_item_rate := v_ps.tier_mod_rate;
        ELSIF v_item.commission_band = 'low' THEN
          v_item_rate := v_ps.tier_low_rate;
        ELSE
          v_item_rate := COALESCE(v_seller.commission_flat_rate, v_ps.commission);
        END IF;
        v_comm_amt := v_comm_amt + (COALESCE(v_item.unit_price, 0) * COALESCE(v_item.quantity, 0) * (v_item_rate / 100.0));
      END LOOP;
      v_comm_amt := ROUND(v_comm_amt, 2);
      v_rate := CASE WHEN v_subtotal > 0 THEN ROUND((v_comm_amt / v_subtotal) * 100, 2) ELSE 0 END;
    ELSE
      v_rate     := COALESCE(v_seller.commission_flat_rate, v_ps.commission);
      v_comm_amt := ROUND(v_subtotal * (v_rate / 100.0), 2);
    END IF;
    v_earning := ROUND(v_subtotal - v_comm_amt, 2);
  ELSE
    v_rate     := v_order.commission_rate;
    v_comm_amt := v_order.commission_amount;
    v_earning  := v_order.seller_earning;
  END IF;

  PERFORM set_config('app.mark_delivered_trusted', 'true', true);

  UPDATE orders SET
    status                = 'delivered',
    commission_rate       = v_rate,
    commission_amount     = v_comm_amt,
    seller_earning        = v_earning,
    delivered_at          = now(),
    delivery_confirmed_at = now(),
    delivered_by_staff_id = v_staff_id
  WHERE id = p_order_id;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
      SELECT deduct_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_deduct_ok;
    END IF;
  END LOOP;

  INSERT INTO delivery_earnings (staff_id, order_id, amount)
  VALUES (v_staff_id, p_order_id, v_flat_rate)
  ON CONFLICT (order_id) WHERE return_id IS NULL DO NOTHING;

  RETURN jsonb_build_object('success', true, 'message', 'Delivery confirmed', 'amount', v_flat_rate);
END;
$function$;

-- ────────────────────────────────────────────────────────────────
-- 4) claim_return_pickup — race-safe via FOR UPDATE + explicit check,
--    same pattern as claim_delivery_order
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_return_pickup(p_return_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_staff_id uuid;
  v_return order_returns%ROWTYPE;
BEGIN
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Aap active delivery partner nahi hain');
  END IF;

  SELECT * INTO v_return FROM order_returns
  WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Return nahi mila');
  END IF;

  IF v_return.status != 'seller_reviewed' OR v_return.seller_action != 'accepted' THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye return abhi pickup ke liye ready nahi hai');
  END IF;

  IF v_return.pickup_staff_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye pickup kisi aur delivery-partner ne le liya hai');
  END IF;

  UPDATE order_returns SET pickup_staff_id = v_staff_id, updated_at = now()
  WHERE id = p_return_id;

  RETURN jsonb_build_object('success', true);
END; $$;

-- ────────────────────────────────────────────────────────────────
-- 5) confirm_return_pickup — delivery-partner confirms handover to
--    seller; creates their earning (return_id-scoped, separate leg from
--    any forward-delivery earning on the same order_id)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_return_pickup(p_return_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_return order_returns%ROWTYPE;
  v_staff_id uuid;
  v_flat_rate CONSTANT numeric := 18;
BEGIN
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Aap active delivery partner nahi hain');
  END IF;

  SELECT * INTO v_return FROM order_returns
  WHERE id = p_return_id AND pickup_staff_id = v_staff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye pickup aapka nahi hai');
  END IF;

  IF v_return.pickup_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye pickup pehle se confirm ho chuka hai');
  END IF;

  UPDATE order_returns SET pickup_confirmed_at = now(), updated_at = now()
  WHERE id = p_return_id;

  INSERT INTO delivery_earnings (staff_id, order_id, amount, return_id)
  SELECT v_staff_id, order_id, v_flat_rate, p_return_id
  FROM order_returns WHERE id = p_return_id
  ON CONFLICT (return_id) WHERE return_id IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object('success', true, 'amount', v_flat_rate);
END; $$;

-- ────────────────────────────────────────────────────────────────
-- 6) seller_review_return — unchanged except one new guard: 'return_received'
--    now requires the delivery-partner leg (step 3) to be confirmed first
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seller_review_return(p_return_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_return order_returns%ROWTYPE;
BEGIN
  SELECT * INTO v_return FROM order_returns
  WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','Return nahi mila');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN sellers s ON s.id = o.seller_id
    JOIN users u ON u.id = s.user_id
    WHERE o.id = v_return.order_id
    AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) THEN
    RETURN jsonb_build_object('success',false,'message','Authorized nahi');
  END IF;

  IF p_action NOT IN ('accepted','rejected','pickup_scheduled','return_received') THEN
    RETURN jsonb_build_object('success',false,'message','Invalid action');
  END IF;

  IF p_action IN ('accepted','rejected') THEN
    IF v_return.status != 'requested' THEN
      RETURN jsonb_build_object('success',false,
        'message','Sirf requested status par seller review ho sakta hai');
    END IF;
  ELSE
    IF v_return.status != 'seller_reviewed' OR v_return.seller_action NOT IN ('accepted','pickup_scheduled') THEN
      RETURN jsonb_build_object('success',false,
        'message','Sirf accept ki hui return par pickup/receive update ho sakta hai');
    END IF;

    IF p_action = 'return_received' AND v_return.pickup_confirmed_at IS NULL THEN
      RETURN jsonb_build_object('success',false,
        'message','Delivery-partner ne abhi tak pickup confirm nahi kiya — Received mark nahi ho sakta');
    END IF;
  END IF;

  UPDATE order_returns SET
    status = 'seller_reviewed',
    seller_action = p_action,
    seller_note = p_note,
    seller_reviewed_at = now(),
    updated_at = now()
  WHERE id = p_return_id;

  RETURN jsonb_build_object('success',true,'action',p_action);
END; $function$;

-- ────────────────────────────────────────────────────────────────
-- 7) admin_decide_return — tightened gate: only seller_action=
--    'return_received' is decidable now, not merely 'seller_reviewed'
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_decide_return(p_return_id uuid, p_action text, p_refund_amount numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_return order_returns%ROWTYPE;
BEGIN
  IF NOT is_active_superadmin() THEN
    RETURN jsonb_build_object('success',false,'message','Superadmin only');
  END IF;

  IF p_action NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('success',false,'message','Invalid action');
  END IF;

  IF p_action = 'approved' AND (p_refund_amount IS NULL OR p_refund_amount <= 0) THEN
    RETURN jsonb_build_object('success',false,'message','Approved ke liye valid refund_amount zaroori hai');
  END IF;

  SELECT * INTO v_return FROM order_returns
  WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','Return nahi mila');
  END IF;

  IF v_return.status IN ('approved','rejected') THEN
    RETURN jsonb_build_object('success',false,
      'message','Ye return already decided ho chuka hai');
  END IF;

  IF v_return.status <> 'seller_reviewed' OR v_return.seller_action <> 'return_received' THEN
    RETURN jsonb_build_object('success',false,
      'message','Ye return abhi decide karne ke liye ready nahi hai — pickup/receive pending hai');
  END IF;

  UPDATE order_returns SET
    status = CASE p_action WHEN 'approved' THEN 'approved' ELSE 'rejected' END,
    admin_action = p_action,
    admin_note = p_note,
    refund_amount = CASE p_action WHEN 'approved' THEN p_refund_amount ELSE NULL END,
    refund_status = CASE p_action WHEN 'approved' THEN 'pending' ELSE NULL END,
    updated_at = now()
  WHERE id = p_return_id;

  IF p_action = 'approved' THEN
    UPDATE orders SET status = 'return_requested', updated_at = now()
    WHERE id = v_return.order_id;
  END IF;

  INSERT INTO notifications (user_id, title, body, type, ref_id)
  VALUES (
    v_return.customer_id,
    CASE p_action WHEN 'approved' THEN 'Return Approved ✅' ELSE 'Return Rejected ❌' END,
    CASE p_action WHEN 'approved'
      THEN 'Aapka refund ₹' || p_refund_amount || ' process ho raha hai'
      ELSE COALESCE(p_note, 'Aapki return request reject ho gayi') END,
    'return_update',
    p_return_id
  );

  RETURN jsonb_build_object('success',true,'action',p_action,
    'refund_amount',p_refund_amount);
END; $function$;

-- ────────────────────────────────────────────────────────────────
-- 8) RLS — delivery partners couldn't see any order_returns row at all
--    before this; mirrors orders_select_delivery_partner's shape
-- ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "order_returns_select_delivery_partner" ON order_returns;
CREATE POLICY "order_returns_select_delivery_partner" ON order_returns
FOR SELECT TO authenticated
USING (
  is_active_delivery_partner()
  AND status = 'seller_reviewed'
  AND seller_action = 'accepted'
  AND (
    (pickup_staff_id IS NULL
     AND EXISTS (
       SELECT 1 FROM orders o
       JOIN serviceable_pincodes sp ON sp.pincode = o.delivery_pincode AND sp.delivery_enabled = true
       WHERE o.id = order_returns.order_id
     ))
    OR pickup_staff_id = (SELECT staff.id FROM staff WHERE staff.email = auth.email())
  )
);

-- ────────────────────────────────────────────────────────────────
-- 9) Grants — internal-auth-checked, but not left world-executable to
--    anon/unauthenticated (same hardening pattern as 064)
-- ────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION claim_return_pickup(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION confirm_return_pickup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_return_pickup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_return_pickup(uuid) TO authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name='order_returns' AND column_name LIKE 'pickup%';
--   -- expect: pickup_staff_id, pickup_confirmed_at
-- SELECT indexname FROM pg_indexes WHERE tablename='delivery_earnings';
--   -- expect: idx_one_delivery_earning_per_order, idx_one_return_earning_per_return
--   -- (idx_one_earning_per_order should be GONE)
-- SELECT has_function_privilege('anon','claim_return_pickup(uuid)','EXECUTE') AS anon_can; -- expect f
-- SELECT policyname FROM pg_policies WHERE tablename='order_returns';
--   -- expect: customer_select_own_returns, seller_see_returns,
--   -- superadmin_all_returns, order_returns_select_delivery_partner

-- ================================================================
-- ROLLBACK
-- ================================================================
-- Re-apply the pre-migration bodies of confirm_delivery, seller_review_return,
-- admin_decide_return (git history has them); DROP FUNCTION claim_return_pickup,
-- confirm_return_pickup; DROP POLICY order_returns_select_delivery_partner;
-- DROP the two partial indexes and recreate idx_one_earning_per_order UNIQUE(order_id)
-- (only safe if no return_id rows exist yet); DROP the return_id/pickup_* columns.
