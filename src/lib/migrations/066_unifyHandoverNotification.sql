-- ══════════════════════════════════════════════════
-- MedSetu — unify out_for_delivery notification wording
-- ══════════════════════════════════════════════════
--
-- 065_notifyOutForDelivery.sql added a customer notification to
-- staff_handover_order (staff-panel handover path) with its own title
-- ("Order Nikal Gaya 🚚"). Turns out a second, older path already existed
-- — the seller-owner's own dashboard action (markOutForDeliveryImpl in
-- SellerDashboard.jsx, via a plain orders UPDATE + client-side
-- create_notification call) — sending a DIFFERENT title for the same
-- real-world event ("Order Raaste Mein! 🛵"). The two paths are mutually
-- exclusive (never both fire for the same transition — confirmed
-- updateOrderStatus is a raw table UPDATE, not staff_handover_order), so
-- no double-notification risk, but customers saw inconsistent wording
-- depending on who handed the order over.
--
-- Fix: keep the pre-existing, longer-tested wording ("Order Raaste Mein!
-- 🛵") and match staff_handover_order's title to it. Body text is
-- untouched from 065 (still mentions the OTP, which the seller-owner
-- path's shorter body doesn't — out of scope here, only unifying title
-- per this request). Rest of the function unchanged from 065.

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
  SELECT u.id, 'Order Raaste Mein! 🛵',
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
--   -- expect: title now 'Order Raaste Mein! 🛵', body unchanged from 065,
--   -- rest of the body identical.
--
-- Raw-byte check (065's live-apply mistake was passing the emoji through
-- a Bash -c command-line argument, which mangled it to literal '??' —
-- ALWAYS apply this file via `psql -f`, never `-c`):
--   SELECT encode(convert_to((regexp_match(pg_get_functiondef(oid),
--     'Order Raaste Mein[^'']*'))[1], 'UTF8'), 'hex')
--   FROM pg_proc WHERE proname = 'staff_handover_order';
--   -- expect hex to end in f09f9bb5 (🛵, U+1F6F5) not 3f3f ('??')

-- ================================================================
-- ROLLBACK — re-apply 065_notifyOutForDelivery.sql's version (title
-- 'Order Nikal Gaya 🚚').
-- ================================================================
