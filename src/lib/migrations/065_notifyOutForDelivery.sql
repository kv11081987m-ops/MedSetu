-- ══════════════════════════════════════════════════
-- MedSetu — notify customer when order goes out_for_delivery
-- ══════════════════════════════════════════════════
--
-- Gap (found via full code audit, 2026-09-19): staff_handover_order
-- (056_sellerStaffSimple.sql) moves the order to 'out_for_delivery' with
-- zero notification — customer only learns the delivery OTP is live if
-- they happen to open OrderTracking.jsx themselves. Fix: insert a
-- notification for the customer right after the status UPDATE succeeds,
-- same direct-INSERT pattern already used by reject_rx_order/
-- admin_decide_return. Rest of the function is byte-for-byte unchanged.

CREATE OR REPLACE FUNCTION public.staff_handover_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  INSERT INTO notifications (user_id, title, body, type, ref_id)
  SELECT u.id, 'Order Nikal Gaya 🚚',
    'Aapka order delivery ke liye nikal gaya hai. OTP dekhne ke liye order-tracking screen kholein.',
    'order_out_for_delivery', p_order_id
  FROM orders o JOIN users u ON u.id = o.customer_id
  WHERE o.id = p_order_id;

  RETURN jsonb_build_object('success', true);
END; $function$;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'staff_handover_order';
--   -- expect: INSERT INTO notifications ... block present between the
--   -- NOT FOUND check and the final `RETURN jsonb_build_object('success', true)`,
--   -- rest of the body identical to the pre-migration version.

-- ================================================================
-- ROLLBACK — re-apply 056_sellerStaffSimple.sql's original CREATE OR
-- REPLACE FUNCTION staff_handover_order (without the notification INSERT).
-- ================================================================
