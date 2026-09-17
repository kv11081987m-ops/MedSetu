-- ══════════════════════════════════════════════════
-- MedSetu — Delivery Partner system, Part 1: DB foundation
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Read-only checks done before writing this file (see conversation):
--   • orders.status has NO check constraint at all (only
--     orders_buyer_type_check exists, unrelated) — 'out_for_delivery'
--     and 'delivered' are already free-form values, already in live use
--     (SellerDashboard.jsx's "Out for Delivery" button, mark_order_
--     delivered's deliver-ready gate, 036_deliverReadyOutForDelivery.sql).
--     So Part 5 (assign_order_for_delivery) needs NO new RPC — the
--     existing plain client update (updateOrderStatus in lib/orders.js)
--     already moves an order into the delivery queue.
--   • is_seller_staff() / current_staff_wholesaler_id() /
--     current_staff_aggregator_id() / claim_order / release_order are
--     already live in this DB from the (still-unmerged) aggregator-staff
--     branch's schema migrations — staff_assignment already exists with
--     exactly the columns the earlier read-only report listed.
--
-- ================================================================
-- 1. serviceable_pincodes.delivery_enabled — separate from is_active
-- ================================================================
-- is_active already means "orders accepted here" (read by
-- get_routing_candidates(), 027_routingCandidatesFn.sql). Delivery-partner
-- coverage is a different, narrower concept — a pincode can accept
-- orders (seller self-fulfils) without yet having delivery-partner
-- coverage — so this is its own column, not an overload of is_active.
ALTER TABLE serviceable_pincodes
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT false;

UPDATE serviceable_pincodes
  SET delivery_enabled = true
  WHERE pincode = '274001';


-- ================================================================
-- 2. staff_assignment.role_type
-- ================================================================
-- Distinguishes the existing seller/wholesaler-deployed staff model
-- from a delivery partner. Defaults 'seller_staff' so every existing
-- assignment row keeps its current meaning unchanged. A delivery_partner
-- row leaves seller_id/deployed_wholesaler_id NULL (global pool, not
-- scoped to one seller) — confirm_delivery below relies on that.
ALTER TABLE staff_assignment
  ADD COLUMN IF NOT EXISTS role_type text NOT NULL DEFAULT 'seller_staff';

ALTER TABLE staff_assignment
  DROP CONSTRAINT IF EXISTS staff_assignment_role_type_check;
ALTER TABLE staff_assignment
  ADD CONSTRAINT staff_assignment_role_type_check
  CHECK (role_type IN ('seller_staff', 'delivery_partner'));

-- Companion fix, same reason it's in this file: is_seller_staff() was
-- written before role_type existed, so today it means "has ANY active
-- staff_assignment row" — which would now also be true for a delivery
-- partner. Doesn't currently leak anything (the orders SELECT policy's
-- follow-on checks compare against seller_id/deployed_wholesaler_id,
-- both NULL for a delivery partner, so those comparisons always fail),
-- but the function's name should mean what it says.
CREATE OR REPLACE FUNCTION public.is_seller_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM staff s
    JOIN staff_assignment a ON a.staff_id = s.id
    WHERE s.email = auth.email() AND a.is_active = true AND a.role_type = 'seller_staff'
  );
$function$;


-- ================================================================
-- 3. orders — delivery confirmation columns
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_otp text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_by_staff_id uuid REFERENCES staff(id);


-- ================================================================
-- 4. delivery_earnings — one payout row per delivered order
-- ================================================================
CREATE TABLE IF NOT EXISTS delivery_earnings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid NOT NULL REFERENCES staff(id),
  order_id   uuid NOT NULL REFERENCES orders(id),
  amount     numeric(10,2) NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled')),
  created_at timestamptz DEFAULT now()
);

-- One payout per order, ever — confirm_delivery relies on this via
-- ON CONFLICT (order_id) DO NOTHING to make a retried/duplicate call safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_earning_per_order
  ON delivery_earnings(order_id);

ALTER TABLE delivery_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_own_earnings"      ON delivery_earnings;
DROP POLICY IF EXISTS "superadmin_all_earnings" ON delivery_earnings;

CREATE POLICY "staff_own_earnings" ON delivery_earnings
  FOR SELECT TO authenticated
  USING (staff_id IN (
    SELECT id FROM staff WHERE email = auth.email()
  ));

CREATE POLICY "superadmin_all_earnings" ON delivery_earnings
  FOR ALL TO authenticated
  USING (is_active_superadmin())
  WITH CHECK (is_active_superadmin());


-- ================================================================
-- 5. assign_order_for_delivery — NOT ADDED, confirmed unnecessary
-- ================================================================
-- See the read-only-check note at the top of this file: orders.status
-- has no CHECK constraint, 'out_for_delivery' is already a working
-- status, and the existing plain client update (updateOrderStatus,
-- lib/orders.js) already moves an order into it under RLS + the
-- protect_order_sensitive_columns trigger (which only blocks a
-- non-privileged party from setting status = 'delivered' directly —
-- every other transition, out_for_delivery included, already passes
-- through for the recognized seller). Nothing to add.


-- ================================================================
-- 6. generate_delivery_otp
-- ================================================================
-- Ownership check added (not in the original ask): without it, any
-- authenticated caller could pass an arbitrary order id and read back
-- the OTP meant only for that order's customer, defeating the point of
-- an OTP entirely. Status guard added so an OTP can't be minted for an
-- order that isn't actually out for delivery yet.
CREATE OR REPLACE FUNCTION public.generate_delivery_otp(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_otp   text;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF NOT (
    is_active_superadmin() OR is_approved_admin() OR EXISTS (
      SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.id = v_order.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh order aapka nahi hai');
  END IF;

  IF v_order.status <> 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'OTP sirf out_for_delivery order ke liye ban sakta hai (status: ' || v_order.status || ')');
  END IF;

  v_otp := lpad(floor(random() * 10000)::text, 4, '0');
  UPDATE orders SET delivery_otp = v_otp WHERE id = p_order_id;

  -- TODO (later phase): trigger actual SMS/notification send to the
  -- customer here. Returning the OTP to the caller (the seller, per the
  -- ownership check above) is fine for now — nothing sends it onward yet.
  RETURN jsonb_build_object('success', true, 'otp', v_otp);
END;
$$;


-- ================================================================
-- 7. confirm_delivery
-- ================================================================
-- Differs from the original ask in three ways, each explained where it
-- happens below: (a) role_type-scoped staff check instead of "any staff
-- row", (b) NULL-safe OTP comparison, (c) the settlement math + stock
-- deduction that mark_order_delivered performs is reproduced here rather
-- than skipped, since this is what actually turns into the seller's
-- payout and inventory truth. p_flat_rate is no longer a caller-supplied
-- argument — GRANT EXECUTE hands this to every authenticated user, and a
-- client-controlled amount going straight into delivery_earnings would
-- let a caller set their own payout.
CREATE OR REPLACE FUNCTION public.confirm_delivery(
  p_order_id uuid,
  p_otp_entered text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flat_rate CONSTANT numeric := 25; -- Phase 1: flat rate only, move to a settings table if/when zones/tiers are needed
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
  -- Must be an ACTIVE DELIVERY_PARTNER specifically — not just any row
  -- in `staff` matching the caller's email, which would also let a
  -- seller_staff-role staff member confirm deliveries and collect
  -- delivery earnings they have no business collecting.
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

  -- NULL-safe: `NULL <> anything` is NULL, which an IF treats as false —
  -- without the explicit IS NULL check, an order that never had
  -- generate_delivery_otp() called on it would pass with ANY entered
  -- value, since v_order.delivery_otp would be NULL.
  IF v_order.delivery_otp IS NULL OR v_order.delivery_otp <> p_otp_entered THEN
    RETURN jsonb_build_object('success', false, 'message', 'Galat OTP');
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = v_order.seller_id;
  SELECT * INTO v_ps     FROM platform_settings WHERE id = 1;

  -- Same settlement math as mark_order_delivered (015_rlsPhase5b.sql,
  -- widened by 036_deliverReadyOutForDelivery.sql) — duplicated, not
  -- shared, because that function's ownership check requires the caller
  -- to BE the assigned seller, which a delivery partner never is.
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

  -- Needed for protect_order_sensitive_columns() to let this UPDATE set
  -- commission_rate/commission_amount/seller_earning — same flag
  -- mark_order_delivered sets; without it they'd get silently reset
  -- back to OLD (NULL) by the trigger since this caller isn't
  -- admin/superadmin and isn't recognized as the order's seller.
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
  ON CONFLICT (order_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'message', 'Delivery confirmed');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_delivery_otp(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_delivery(uuid, text)      TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'serviceable_pincodes' AND column_name = 'delivery_enabled';
-- SELECT pincode, delivery_enabled FROM serviceable_pincodes ORDER BY pincode;
--   -- expect: 274001 = true, 274201 = false

-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'staff_assignment' AND column_name = 'role_type';
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'staff_assignment_role_type_check';

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders'
--     AND column_name IN ('delivery_otp','delivery_confirmed_at','delivered_by_staff_id');

-- SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('generate_delivery_otp','confirm_delivery','is_seller_staff');

-- Real-session checks (needs at least one staff row + an active
-- role_type='delivery_partner' staff_assignment row, plus a users row
-- linking that staff's email to an auth_id, to actually test as that
-- delivery partner):
--   1. Seller calls generate_delivery_otp on their own out_for_delivery
--      order -> {success:true, otp:"NNNN"}; on someone else's order ->
--      {success:false, message:'Yeh order aapka nahi hai'}.
--   2. Delivery partner calls confirm_delivery with the right OTP ->
--      {success:true}; order.status='delivered', commission_rate/
--      commission_amount/seller_earning populated, stock decremented,
--      one delivery_earnings row inserted.
--   3. Same call repeated (retry) -> ON CONFLICT DO NOTHING means no
--      second earnings row (check idx_one_earning_per_order held).
--   4. Wrong OTP, or an order whose delivery_otp was never generated
--      (NULL) -> {success:false, message:'Galat OTP'} in both cases.
--   5. A seller_staff-role staff member (not delivery_partner) calling
--      confirm_delivery -> {success:false, message:'Aap active delivery
--      partner nahi hain'}.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- GRANT/DROP FUNCTION confirm_delivery(uuid, text);
-- DROP FUNCTION IF EXISTS generate_delivery_otp(uuid);
-- DROP TABLE IF EXISTS delivery_earnings;
-- ALTER TABLE orders DROP COLUMN IF EXISTS delivered_by_staff_id;
-- ALTER TABLE orders DROP COLUMN IF EXISTS delivery_confirmed_at;
-- ALTER TABLE orders DROP COLUMN IF EXISTS delivery_otp;
-- ALTER TABLE staff_assignment DROP CONSTRAINT IF EXISTS staff_assignment_role_type_check;
-- ALTER TABLE staff_assignment DROP COLUMN IF EXISTS role_type;
-- ALTER TABLE serviceable_pincodes DROP COLUMN IF EXISTS delivery_enabled;
-- -- is_seller_staff(): re-create the pre-052 version (drop the
-- -- `AND a.role_type = 'seller_staff'` filter) if role_type itself is
-- -- rolled back above.
