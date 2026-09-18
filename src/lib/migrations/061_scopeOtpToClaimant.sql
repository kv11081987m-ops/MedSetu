-- ══════════════════════════════════════════════════
-- MedSetu — Scope generate_delivery_otp to the claimant only
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- 059_fixOtpAuth.sql added is_active_delivery_partner() to the ownership
-- check so a delivery partner could generate an OTP at all — but that
-- check only confirms "some active delivery partner", not "the specific
-- partner who claimed THIS order" (060_deliveryClaimOrder.sql's
-- claim_delivery_order, which is now mandatory before pickup). Net effect:
-- any active delivery partner could still call generate_delivery_otp on
-- an order a DIFFERENT partner claimed. This tightens the delivery_partner
-- branch to require delivered_by_staff_id = the caller's own staff id —
-- NULL (unclaimed) is deliberately NOT allowed here, since claiming is now
-- mandatory before pickup. Seller/admin/superadmin paths are untouched.

CREATE OR REPLACE FUNCTION public.generate_delivery_otp(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order    orders%ROWTYPE;
  v_otp      text;
  v_staff_id uuid;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  -- Delivery-partner ka apna staff_id resolve karo
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  IF NOT (
    is_active_superadmin() OR is_approved_admin() OR EXISTS (
      SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.id = v_order.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
    ) OR (v_staff_id IS NOT NULL AND v_order.delivered_by_staff_id = v_staff_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh order aapka nahi hai');
  END IF;

  IF v_order.status <> 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'OTP sirf out_for_delivery order ke liye ban sakta hai (status: ' || v_order.status || ')');
  END IF;

  v_otp := lpad(floor(random() * 10000)::text, 4, '0');
  UPDATE orders SET delivery_otp = v_otp WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'otp', v_otp);
END;
$$;

GRANT EXECUTE ON FUNCTION generate_delivery_otp(uuid) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT prosrc ~ 'delivered_by_staff_id = v_staff_id'
-- FROM pg_proc WHERE proname = 'generate_delivery_otp';
-- -- expect: t

-- Real-session checks:
--   1. Delivery partner A claims an order (claim_delivery_order), then
--      calls generate_delivery_otp on it -> {success:true, otp:'nnnn'}.
--   2. Delivery partner B (different active delivery partner, did NOT
--      claim this order) calls generate_delivery_otp on the SAME order ->
--      {success:false,'Yeh order aapka nahi hai'} (previously succeeded —
--      this is the fix).
--   3. Seller/admin/superadmin paths on the same order -> unchanged.
--   4. An order nobody has claimed yet (delivered_by_staff_id NULL) ->
--      no delivery_partner can generate_delivery_otp on it (must claim
--      first) — seller/admin/superadmin still can, unchanged.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- -- Re-apply 059_fixOtpAuth.sql's version of this function (drops the
-- -- claimant-scoping, restores plain is_active_delivery_partner()).
