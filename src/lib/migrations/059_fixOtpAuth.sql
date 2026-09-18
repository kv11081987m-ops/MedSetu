-- ══════════════════════════════════════════════════
-- MedSetu — URGENT: generate_delivery_otp missing delivery_partner auth
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Found via read-only investigation: generate_delivery_otp's ownership
-- check (052_deliveryPartner.sql) only recognizes is_active_superadmin(),
-- is_approved_admin(), and the order's own seller — a delivery_partner
-- has no path through it at all. DeliveryPartnerPanel.jsx's handlePickup()
-- calls exactly this RPC from the delivery partner's own session (Pickup
-- Karo button) — every real delivery partner hits
-- {success:false, message:'Yeh order aapka nahi hai'} and can never
-- generate the OTP needed to complete a delivery. Production-blocking.
--
-- Fix: one addition to the ownership OR-chain — is_active_delivery_partner()
-- (already defined in 053_deliveryPartnerOrdersRLS.sql, reused as-is, not
-- redefined here). Nothing else in the function changes: same order lock,
-- same out_for_delivery status guard, same OTP generation/UPDATE, same
-- return shape.

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
    ) OR is_active_delivery_partner()
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

-- SELECT position('is_active_delivery_partner' in prosrc) > 0
-- FROM pg_proc WHERE proname = 'generate_delivery_otp';
-- -- expect: t

-- Real-session check: as a logged-in, active delivery_partner staff
-- member, call generate_delivery_otp(p_order_id) on an out_for_delivery
-- order with delivered_by_staff_id IS NULL -> {success:true, otp:'nnnn'}
-- (previously {success:false,'Yeh order aapka nahi hai'}). Seller/admin/
-- superadmin paths on the same order -> unchanged.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- -- Re-apply 052_deliveryPartner.sql's version of this function (drops
-- -- the "OR is_active_delivery_partner()" clause, everything else
-- -- byte-for-byte identical).
