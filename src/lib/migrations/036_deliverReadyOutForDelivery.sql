-- ══════════════════════════════════════════════════
-- MedSetu — Migration 036: mark_order_delivered accepts 'out_for_delivery'
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Bug: B15's new seller-side "Out for Delivery" button (SellerDashboard.jsx)
-- moves a B2C order confirmed -> out_for_delivery before delivery. But
-- mark_order_delivered's deliver-ready gate (added in 015_rlsPhase5b.sql)
-- only ever accepted status = 'confirmed':
--
--   IF v_order.status <> 'confirmed' THEN
--     RAISE EXCEPTION 'Order abhi deliver-ready nahi hai (status: %)', v_order.status;
--   END IF;
--
-- so "Mark Delivered" on an out_for_delivery order raises that exact
-- exception and never delivers. This is the ONLY change in this
-- migration — one line, widened from an exact match to an IN() list.
--
-- Both 'confirmed' and 'out_for_delivery' are accepted (not just the
-- latter) so the old direct confirmed -> delivered path (still used by
-- every B2B order, and by any B2C order a seller marks delivered without
-- using the new middle step) keeps working exactly as before — nothing
-- is forced through the new step.
--
-- Everything else in the function (ownership check, commission math,
-- stock deduction, the mark_delivered_trusted flag for the sensitive-
-- columns trigger) is copied byte-for-byte from the live function
-- (confirmed via pg_get_functiondef against the running DB) — no other
-- behaviour changes.

CREATE OR REPLACE FUNCTION mark_order_delivered(p_order_id UUID)
RETURNS TABLE(success BOOLEAN, commission_rate NUMERIC, commission_amount NUMERIC, seller_earning NUMERIC, stock_deduct_failures TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- B15 fix: was `v_order.status <> 'confirmed'` — only allowed the
  -- direct confirmed -> delivered path. Now also accepts
  -- out_for_delivery (the new seller-side middle step), without
  -- removing the old confirmed path.
  IF v_order.status NOT IN ('confirmed', 'out_for_delivery') THEN
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

  -- Let the orders trigger know this specific UPDATE is coming from
  -- the trusted RPC, not a raw client write. Transaction-scoped (SET LOCAL
  -- semantics via the 3rd arg = true), auto-resets — nothing to clean up.
  PERFORM set_config('app.mark_delivered_trusted', 'true', true);

  UPDATE orders
  SET status            = 'delivered',
      commission_rate   = v_rate,
      commission_amount = v_comm_amt,
      seller_earning    = v_earning
  WHERE id = p_order_id;

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
$function$;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT prosrc FROM pg_proc WHERE proname = 'mark_order_delivered';
--   -- confirm the status check now reads:
--   -- IF v_order.status NOT IN ('confirmed', 'out_for_delivery') THEN

-- Real-session checks:
--   1. Seller marks a 'confirmed' order delivered (old direct path) ->
--      still works exactly as before, status becomes 'delivered'.
--   2. Seller taps "Out for Delivery" on a confirmed order (client-side,
--      no DB change needed for that step), then "Mark Delivered" on the
--      resulting out_for_delivery order -> now succeeds instead of
--      raising "Order abhi deliver-ready nahi hai (status: out_for_delivery)".
--   3. Seller tries to mark a 'pending' or 'delivered' order delivered ->
--      still raises the same exception, unchanged (those statuses are
--      still outside the allowed set).


-- ================================================================
-- ROLLBACK
-- ================================================================
-- Restore the original (015_rlsPhase5b.sql) status check — only that one
-- IF condition changes back, rest of the function body is identical:
--
-- CREATE OR REPLACE FUNCTION mark_order_delivered(p_order_id UUID)
-- ... (same function body as above) ...
--   IF v_order.status <> 'confirmed' THEN
--     RAISE EXCEPTION 'Order abhi deliver-ready nahi hai (status: %)', v_order.status;
--   END IF;
-- ... (same function body as above) ...
