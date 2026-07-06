-- ══════════════════════════════════════════════════
-- MedSetu — Commission RPC (Hard Case 3)
-- ARCHIVED / SUPERSEDED — 015_rlsPhase5b.sql's CREATE OR REPLACE of
-- mark_order_delivered (adds the app.mark_delivered_trusted flag so
-- the orders sensitive-column trigger can tell the RPC's own UPDATE
-- apart from a raw client one) is the version actually live. Kept
-- here for history only — do not run this file on its own.
-- ══════════════════════════════════════════════════


-- ================================================================
-- mark_order_delivered(p_order_id)
--
-- Replaces the client-side calc that used to live in
-- SellerDashboard.jsx#markDelivered. Same rules, just now computed
-- from DB state the caller can't influence:
--   - Ownership: caller must be the seller on this order, via the
--     Phase 0 bridge (sellers.user_id -> users.auth_id = auth.uid()).
--   - Transition: only confirmed -> delivered is allowed (matches the
--     UI — OrderCard only shows "Mark Delivered" when status is
--     'confirmed'; SellerDashboard.jsx:149).
--   - Rate: seller's own commission_mode/commission_flat_rate
--     (sellers table), tier rates + fallback from platform_settings —
--     identical formula to the old client code, just read fresh from
--     the DB instead of trusting client state. No B2C/B2B rate split
--     exists in the current app (checked: buyer_type only changes
--     notification wording, never the rate) — same here.
--   - Idempotent: if commission_amount is already set (e.g. a retry),
--     the stored values are kept rather than recalculated, matching
--     the old `if (orderForComm?.commission_amount == null)` guard.
--   - Stock deduction: same best-effort semantics as before — a
--     missing/mismatched inventory row doesn't block the delivery or
--     commission write, it's just reported back in
--     stock_deduct_failures for the same "manually check inventory"
--     alert the UI already shows. (Deliberately not stricter: the
--     original design treats stock deduct at delivery-time as
--     non-blocking on purpose, since the order is already fulfilled
--     in the real world by this point.)
-- ================================================================

CREATE OR REPLACE FUNCTION mark_order_delivered(p_order_id UUID)
RETURNS TABLE (
  success               BOOLEAN,
  commission_rate       NUMERIC,
  commission_amount     NUMERIC,
  seller_earning        NUMERIC,
  stock_deduct_failures TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order     orders%ROWTYPE;
  v_seller    sellers%ROWTYPE;
  v_ps        platform_settings%ROWTYPE;
  v_subtotal  NUMERIC;
  v_comm_amt  NUMERIC := 0;
  v_rate      NUMERIC;
  v_earning   NUMERIC;
  v_item      RECORD;
  v_item_rate NUMERIC;
  v_failures  TEXT[] := '{}';
  v_deduct_ok BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order nahi mila';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.seller_id AND u.auth_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Yeh order aapka nahi hai';
  END IF;

  IF v_order.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Order abhi deliver-ready nahi hai (status: %)', v_order.status;
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = v_order.seller_id;
  SELECT * INTO v_ps     FROM platform_settings WHERE id = 1;

  v_subtotal := COALESCE(v_order.final_amount, 0) - COALESCE(v_order.delivery_charge, 0);

  IF v_order.commission_amount IS NULL THEN
    IF v_seller.commission_mode = 'tier' THEN
      FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
        IF v_item.commission_band = 'high' THEN
          v_item_rate := v_ps.tier_high_rate;
        ELSIF v_item.commission_band = 'moderate' THEN
          v_item_rate := v_ps.tier_mod_rate;
        ELSIF v_item.commission_band = 'low' THEN
          v_item_rate := v_ps.tier_low_rate;
        ELSE
          -- Unclassified medicine — same fallback as the old client code.
          v_item_rate := COALESCE(v_seller.commission_flat_rate, v_ps.commission);
        END IF;
        v_comm_amt := v_comm_amt + (COALESCE(v_item.unit_price, 0) * COALESCE(v_item.quantity, 0) * (v_item_rate / 100.0));
      END LOOP;
      v_comm_amt := ROUND(v_comm_amt, 2);
      -- Blended effective rate, numeric — same reasoning as before: keeps
      -- commission_rate sortable/reportable whether flat or tier.
      v_rate := CASE WHEN v_subtotal > 0 THEN ROUND((v_comm_amt / v_subtotal) * 100, 2) ELSE 0 END;
    ELSE
      v_rate     := COALESCE(v_seller.commission_flat_rate, v_ps.commission);
      v_comm_amt := ROUND(v_subtotal * (v_rate / 100.0), 2);
    END IF;
    v_earning := ROUND(v_subtotal - v_comm_amt, 2);
  ELSE
    -- Already computed (idempotent retry) — keep existing stored values.
    v_rate     := v_order.commission_rate;
    v_comm_amt := v_order.commission_amount;
    v_earning  := v_order.seller_earning;
  END IF;

  UPDATE orders
  SET status            = 'delivered',
      commission_rate   = v_rate,
      commission_amount = v_comm_amt,
      seller_earning    = v_earning
  WHERE id = p_order_id;

  -- Stock deduct — best-effort per item, same as the old deductStock().
  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
      SELECT deduct_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_deduct_ok;
      IF v_deduct_ok IS NOT TRUE THEN
        v_failures := array_append(v_failures, COALESCE(v_item.name, 'Medicine'));
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT true, v_rate, v_comm_amt, v_earning, v_failures;
END;
$$;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'mark_order_delivered';

-- Manual smoke test (replace with a real confirmed order's id, run as
-- that order's seller so the ownership check passes):
-- SELECT * FROM mark_order_delivered('00000000-0000-0000-0000-000000000000');


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS mark_order_delivered(UUID);
-- (SellerDashboard.jsx's markDelivered would need to revert to its
-- pre-RPC client-side calc if this is dropped — keep the old code in
-- git history, don't hand-reconstruct it.)
