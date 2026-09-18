-- ══════════════════════════════════════════════════
-- MedSetu — Delivery-partner order claim: race-safe Accept step
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Today DeliveryPartnerPanel.jsx's "Pickup Karo" button calls
-- generate_delivery_otp() directly on an unclaimed out_for_delivery
-- order — nothing ever sets delivered_by_staff_id before that point, so
-- two delivery partners tapping the same order at nearly the same moment
-- could both generate an OTP for it. This adds an explicit claim step in
-- between: claim_delivery_order() locks the order row (FOR UPDATE) and
-- sets delivered_by_staff_id atomically — the loser of a simultaneous
-- claim sees delivered_by_staff_id already set and fails cleanly, never
-- reaching the OTP step at all.
--
-- Once claimed, orders_select_delivery_partner (053_deliveryPartnerOrdersRLS.sql)
-- already drops the order out of every OTHER partner's "Available Orders"
-- pool on their next fetch — its unclaimed-pool clause requires
-- delivered_by_staff_id IS NULL, and its only other clause is
-- delivered_by_staff_id = self. No RLS change needed for this migration.

CREATE OR REPLACE FUNCTION claim_delivery_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_staff_id uuid;
  v_order    orders%ROWTYPE;
BEGIN
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Aap active delivery partner nahi hain');
  END IF;

  -- Row lock — race-safe, sirf ek partner claim kar paayega
  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status != 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye order abhi ready nahi hai');
  END IF;

  IF v_order.delivered_by_staff_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye order kisi aur delivery-partner ne le liya hai');
  END IF;

  UPDATE orders SET delivered_by_staff_id = v_staff_id, updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION claim_delivery_order(uuid) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'claim_delivery_order';

-- Real-session checks:
--   1. Active delivery partner calls claim_delivery_order on an unclaimed
--      out_for_delivery order -> {success:true}; orders.delivered_by_staff_id
--      = the caller's staff id.
--   2. Same order, a DIFFERENT delivery partner calls it right after ->
--      {success:false,'Ye order kisi aur delivery-partner ne le liya hai'};
--      delivered_by_staff_id stays the first partner's.
--   3. Two delivery partners racing the SAME order at nearly the same
--      moment -> exactly one succeeds (FOR UPDATE serializes them), the
--      loser sees delivered_by_staff_id already set and never reaches the
--      UPDATE.
--   4. Order not out_for_delivery (e.g. still 'preparing') -> {success:false,
--      'Ye order abhi ready nahi hai'}; delivered_by_staff_id untouched.
--   5. After a successful claim, that OTHER (non-claiming) delivery
--      partner's next "Available Orders" fetch no longer includes this
--      order (053's RLS policy, unchanged by this migration).

-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS claim_delivery_order(uuid);
