-- ══════════════════════════════════════════════════
-- MedSetu — Delivery Partner system, Part 2 fix: orders SELECT for delivery partners
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Found while building DeliveryPartnerPanel.jsx (the "Available Orders" /
-- "Meri Kamai" UI): orders_update_involved_or_staff and
-- orders_select_involved_or_staff (both from earlier migrations) only
-- recognize the customer, the seller, the buyer, admin/superadmin/
-- pharmacist, or is_seller_staff() as parties who may see an order row.
-- A delivery_partner staff member matches NONE of these — and
-- is_seller_staff() was just scoped to role_type='seller_staff' in
-- 052_deliveryPartner.sql, so it's explicitly false for them too. Net
-- effect without this migration: every "Available Orders" query from
-- DeliveryPartnerPanel.jsx returns zero rows under RLS, silently — no
-- error, the panel just looks permanently empty.
--
-- Mutations (confirm_delivery, generate_delivery_otp) were already fine —
-- both are SECURITY DEFINER and bypass RLS entirely. This migration only
-- adds read access: a delivery partner may see (a) the open pool —
-- out_for_delivery, unclaimed, in a delivery_enabled pincode — and
-- (b) orders they personally delivered (needed so "Meri Kamai" can join
-- through to orders.order_number for display).

CREATE OR REPLACE FUNCTION public.is_active_delivery_partner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM staff s
    JOIN staff_assignment a ON a.staff_id = s.id
    WHERE s.email = auth.email() AND a.is_active = true AND a.role_type = 'delivery_partner'
  );
$function$;

-- Additive — a second permissive SELECT policy on the same table is OR'd
-- together with orders_select_involved_or_staff by Postgres, so the
-- existing policy (and everyone else's access through it) is untouched.
DROP POLICY IF EXISTS "orders_select_delivery_partner" ON orders;

CREATE POLICY "orders_select_delivery_partner" ON orders
  FOR SELECT TO authenticated
  USING (
    is_active_delivery_partner() AND (
      (
        status = 'out_for_delivery'
        AND delivered_by_staff_id IS NULL
        AND delivery_pincode IN (SELECT pincode FROM serviceable_pincodes WHERE delivery_enabled = true)
      )
      OR delivered_by_staff_id = (SELECT id FROM staff WHERE email = auth.email())
    )
  );


-- ================================================================
-- confirm_delivery — return the actual amount instead of leaving the
-- client to hardcode/guess it (DeliveryPartnerPanel's success toast
-- shows "₹{amount} kamaye"). Same function body as 052_deliveryPartner.sql,
-- only the final RETURN line changes.
-- ================================================================

CREATE OR REPLACE FUNCTION public.confirm_delivery(
  p_order_id uuid,
  p_otp_entered text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  ON CONFLICT (order_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'message', 'Delivery confirmed', 'amount', v_flat_rate);
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_delivery(uuid, text) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname FROM pg_proc WHERE proname = 'is_active_delivery_partner';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'orders' AND policyname = 'orders_select_delivery_partner';
-- SELECT prosrc ~ 'v_flat_rate' AND prosrc ~ ''''amount''''
--   FROM pg_proc WHERE proname = 'confirm_delivery';
--   -- sanity check the new RETURN line landed (grep, not a real assertion)

-- Real-session check: as a logged-in delivery partner (active
-- staff_assignment, role_type='delivery_partner'), SELECT * FROM orders
-- WHERE status='out_for_delivery' -> now returns pool orders in
-- delivery_enabled pincodes instead of zero rows; an order NOT in a
-- delivery_enabled pincode, or already claimed (delivered_by_staff_id
-- set), stays invisible.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP POLICY IF EXISTS "orders_select_delivery_partner" ON orders;
-- DROP FUNCTION IF EXISTS is_active_delivery_partner();
-- -- confirm_delivery: re-apply 052_deliveryPartner.sql's version to drop
-- -- the 'amount' key from the RETURN if needed (behaviourally identical
-- -- otherwise).
