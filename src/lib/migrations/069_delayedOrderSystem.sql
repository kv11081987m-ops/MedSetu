-- ══════════════════════════════════════════════════
-- MedSetu — Partial-delay + fulfillment-type system
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Three independent, additive pieces — none of them touch the existing
-- order status flow (pending -> confirmed -> preparing -> out_for_delivery
-- -> delivered/cancelled stays exactly as-is):
--
--   1. master_medicines.fulfillment_type — data-only flag for a future
--      instant-vs-on-order distinction per medicine. No RPC/UI reads this
--      yet; it's laid down now so it exists when that feature is built.
--   2. serviceable_pincodes.delivery_speed_tier — data-only flag for a
--      future per-pincode instant-vs-batch delivery distinction. Same
--      deal: Checkout.jsx reads it for an informational banner (below),
--      nothing else keys off it yet.
--   3. orders delay-tracking (is_delayed/delayed_note/delayed_at/
--      delayed_acknowledged) — a boolean side-channel a seller can raise
--      mid-flow (e.g. while 'confirmed' or 'preparing') to tell the
--      customer "this will take longer than usual", with two RPCs to
--      raise and acknowledge it. Deliberately NOT a new orders.status
--      value — orders.status has no CHECK constraint today (see
--      052_deliveryPartner.sql's note) and every UI status map
--      (SellerDashboard.jsx STATUS_LABEL/COLOR/BG, OrderHistory.jsx
--      ACTIVE_STATUSES) would need updating for a real new status, the
--      same "returned" gap 047_returnRefund.sql already flagged. A
--      side-flag needs none of that — every existing status branch keeps
--      working unmodified and the delay layers on top.
--
-- mark_order_delayed's owner-or-staff resolution is written inline,
-- matching this codebase's established convention (056_sellerStaffSimple.sql
-- itself keeps owner-resolution and staff-resolution as two separate
-- inline blocks across its functions — there is no single shared
-- "resolve caller's seller_id, owner-or-staff" helper to call instead).
-- The owner half uses 056's hardened form (LEFT JOIN + sellers.email
-- fallback), not the plainer JOIN, since that's the fix 056 already made
-- for the exact same lookup and there's no reason to regress it here.


-- ================================================================
-- 1. master_medicines.fulfillment_type
-- ================================================================
ALTER TABLE master_medicines ADD COLUMN IF NOT EXISTS
  fulfillment_type text DEFAULT 'instant'
  CHECK (fulfillment_type IN ('instant','on_order'));


-- ================================================================
-- 2. serviceable_pincodes.delivery_speed_tier
-- ================================================================
ALTER TABLE serviceable_pincodes ADD COLUMN IF NOT EXISTS
  delivery_speed_tier text DEFAULT 'instant'
  CHECK (delivery_speed_tier IN ('instant','batch'));


-- ================================================================
-- 3. orders delay-tracking columns
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  is_delayed boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  delayed_note text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  delayed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  delayed_acknowledged boolean DEFAULT false;


-- ================================================================
-- 4. mark_order_delayed(p_order_id, p_note) — seller owner OR seller-staff
-- ================================================================
-- p_note is optional; when omitted the same apology text that goes into
-- the notification is also stored in delayed_note, not NULL — Part C's
-- customer popup renders delayed_note directly as the dialog body, so a
-- NULL there would show a blank message.
CREATE OR REPLACE FUNCTION mark_order_delayed(
  p_order_id uuid, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
  v_order     orders%ROWTYPE;
  v_note      text;
BEGIN
  -- Owner check (056's hardened form: LEFT JOIN + sellers.email fallback).
  SELECT s.id INTO v_seller_id FROM sellers s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email()
  LIMIT 1;

  -- Ya seller-staff check (agar owner check fail hui)
  IF v_seller_id IS NULL THEN
    SELECT sa.seller_id INTO v_seller_id
    FROM staff st JOIN staff_assignment sa ON sa.staff_id = st.id
    WHERE st.email = auth.email()
      AND sa.role_type = 'seller_staff' AND sa.is_active = true;
  END IF;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authorized nahi');
  END IF;

  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id AND seller_id = v_seller_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status IN ('delivered', 'cancelled') THEN
    RETURN jsonb_build_object('success', false,
      'message', ('Yeh order ab delayed mark nahi ho sakta (status: ' || v_order.status || ')'));
  END IF;

  v_note := COALESCE(NULLIF(TRIM(p_note), ''),
    'Demand zyada hone ki wajah se stock arrange karne mein samay lag raha hai. Kripya 1 din ka samay dein.');

  UPDATE orders SET
    is_delayed = true,
    delayed_note = v_note,
    delayed_at = now(),
    delayed_acknowledged = false,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
  SELECT u.id, 'Order Mein Thoda Samay Lagega 🙏', v_note, 'order_delayed', p_order_id, false
  FROM orders o JOIN users u ON u.id = o.customer_id
  WHERE o.id = p_order_id;

  RETURN jsonb_build_object('success', true);
END; $$;


-- ================================================================
-- 5. acknowledge_order_delay(p_order_id) — customer "Order Rakhein" tap
-- ================================================================
CREATE OR REPLACE FUNCTION acknowledge_order_delay(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE orders SET delayed_acknowledged = true, updated_at = now()
  WHERE id = p_order_id
    AND customer_id = (SELECT id FROM users WHERE auth_id = auth.uid() OR email = auth.email());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila ya aapka nahi hai');
  END IF;

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION mark_order_delayed(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION acknowledge_order_delay(uuid)  TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'master_medicines' AND column_name = 'fulfillment_type';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'serviceable_pincodes' AND column_name = 'delivery_speed_tier';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN
--     ('is_delayed','delayed_note','delayed_at','delayed_acknowledged');
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('mark_order_delayed','acknowledge_order_delay');

-- Real-session checks:
--   1. Seller owner calls mark_order_delayed(a 'confirmed' order they own, null)
--      -> {success:true}; orders row: is_delayed=true, delayed_note=default
--      apology text, delayed_acknowledged=false; a notifications row for the
--      customer with type='order_delayed'.
--   2. Seller-staff (056) of the same seller calls mark_order_delayed on a
--      different order of that seller with a custom note -> {success:true},
--      delayed_note = that custom note.
--   3. Same call from a seller/staff who does NOT own the order -> {success:false,
--      'Order nahi mila'} (no row leaked, no update happens).
--   4. mark_order_delayed on an already-'delivered' order -> {success:false,
--      naming the status}.
--   5. Customer calls acknowledge_order_delay on their own delayed order ->
--      {success:true}; delayed_acknowledged flips to true. Same call from a
--      different customer -> {success:false, 'Order nahi mila ya aapka nahi hai'}.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- GRANT/DROP FUNCTION order doesn't matter for rollback, but drop the
-- functions before the columns they read if run manually:
-- DROP FUNCTION IF EXISTS acknowledge_order_delay(uuid);
-- DROP FUNCTION IF EXISTS mark_order_delayed(uuid, text);
-- ALTER TABLE orders DROP COLUMN IF EXISTS delayed_acknowledged;
-- ALTER TABLE orders DROP COLUMN IF EXISTS delayed_at;
-- ALTER TABLE orders DROP COLUMN IF EXISTS delayed_note;
-- ALTER TABLE orders DROP COLUMN IF EXISTS is_delayed;
-- ALTER TABLE serviceable_pincodes DROP COLUMN IF EXISTS delivery_speed_tier;
-- ALTER TABLE master_medicines DROP COLUMN IF EXISTS fulfillment_type;
