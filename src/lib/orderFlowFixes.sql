-- ══════════════════════════════════════════════════
-- MedSetu — 3 order-flow bug fixes (post RLS 5a/5b)
-- Run this in Supabase SQL Editor. Assumes rlsPhase5b.sql is already
-- applied (both new functions depend on the orders trigger + helpers
-- it introduces: protect_order_sensitive_columns(), is_active_superadmin(),
-- is_approved_pharmacist(), reserve_stock(), release_stock()).
-- ══════════════════════════════════════════════════


-- ================================================================
-- FIX 1 — cancel_order(p_order_id): customer-initiated cancel with
-- proper stock release.
--
-- Why a DEFINER function is required: release_stock() is SECURITY
-- INVOKER (deliberately left that way in Phase 4 — every existing
-- call site is the OWNING seller's own session). A customer is never
-- the owning seller, so calling release_stock() directly from
-- OrderTracking.jsx would fail seller_inventory's owning-seller
-- UPDATE policy. This function runs as its owner, so its internal
-- calls to release_stock()/the orders UPDATE bypass RLS entirely —
-- the function does its OWN ownership check up front instead.
--
-- No trusted-flag needed here (unlike mark_order_delivered): the
-- orders trigger's customer branch already permits exactly the
-- pending/confirmed -> cancelled transition this function performs,
-- so it passes through cleanly without needing to signal "trust me".
--
-- Reserve/release symmetry: only release stock if the order was
-- 'confirmed' (reserve_stock already ran at seller-accept time) — a
-- still-'pending' order was never reserved, so nothing to release.
-- ================================================================

CREATE OR REPLACE FUNCTION cancel_order(p_order_id UUID)
RETURNS TABLE (success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order     orders%ROWTYPE;
  v_item      RECORD;
  v_ok        BOOLEAN;
  v_failures  TEXT[] := '{}';
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Order nahi mila'::TEXT;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_order.customer_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) THEN
    RETURN QUERY SELECT false, 'Yeh order aapka nahi hai'::TEXT;
    RETURN;
  END IF;

  IF v_order.status NOT IN ('pending', 'confirmed') THEN
    RETURN QUERY SELECT false, ('Yeh order ab cancel nahi ho sakta (status: ' || v_order.status || ')')::TEXT;
    RETURN;
  END IF;

  UPDATE orders SET status = 'cancelled' WHERE id = p_order_id;

  IF v_order.status = 'confirmed' THEN
    FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
      IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
        SELECT release_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_ok;
        IF v_ok IS NOT TRUE THEN
          v_failures := array_append(v_failures, COALESCE(v_item.name, 'Medicine'));
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF array_length(v_failures, 1) > 0 THEN
    RETURN QUERY SELECT true, ('Order cancel ho gaya, par in items ka stock release nahi hua: ' || array_to_string(v_failures, ', ') || '. Store se sampark karein.')::TEXT;
  ELSE
    RETURN QUERY SELECT true, 'Order cancel ho gaya'::TEXT;
  END IF;
END;
$$;


-- ================================================================
-- FIX 3 — confirm_order_with_reserve(p_order_id): pharmacist confirm
-- with atomic stock reservation, same guarantee reserveStock() gives
-- the seller-accept path (rolls back partial reservations on a
-- multi-item failure).
--
-- Same DEFINER reasoning as FIX 1 — reserve_stock() is INVOKER, a
-- pharmacist is never the owning seller. This function validates
-- is_approved_pharmacist() itself (the trigger's pharmacist branch
-- checks the same helper independently — both need to agree, and
-- they do, same function).
-- ================================================================

CREATE OR REPLACE FUNCTION confirm_order_with_reserve(p_order_id UUID)
RETURNS TABLE (success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order        orders%ROWTYPE;
  v_item         RECORD;
  v_res          RECORD;
  v_reserved_ids UUID[] := '{}';
  v_reserved_qty INT[]  := '{}';
  i              INT;
BEGIN
  IF NOT is_approved_pharmacist() THEN
    RETURN QUERY SELECT false, 'Sirf approved pharmacist yeh action kar sakta hai'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Order nahi mila'::TEXT;
    RETURN;
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN QUERY SELECT false, ('Yeh order ab pending nahi hai (status: ' || v_order.status || ')')::TEXT;
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_res FROM reserve_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity);

    IF NOT v_res.success THEN
      FOR i IN 1 .. COALESCE(array_length(v_reserved_ids, 1), 0) LOOP
        PERFORM release_stock(v_order.seller_id, v_reserved_ids[i], v_reserved_qty[i]);
      END LOOP;
      RETURN QUERY SELECT false, ('Stock kam hai — ' || COALESCE(v_item.name, 'Medicine') || ' ke sirf ' || v_res.available || ' unit bache hain')::TEXT;
      RETURN;
    END IF;

    v_reserved_ids := array_append(v_reserved_ids, v_item.medicine_id);
    v_reserved_qty := array_append(v_reserved_qty, v_item.quantity);
  END LOOP;

  UPDATE orders SET status = 'confirmed', pharmacist_verified = true WHERE id = p_order_id;

  RETURN QUERY SELECT true, 'Order confirm ho gaya, stock reserve ho gaya'::TEXT;
END;
$$;


-- ================================================================
-- FIX 2 — customer_name/customer_phone columns (confirmed live via
-- REST probe: "column orders.customer_name does not exist" — adding
-- both, idempotent). B2B needs no schema change — SellerDashboard.jsx
-- already shows the buyer's store name via the existing
-- buyer:buyer_id(store_name, phone) embed; only the B2C path was dead.
-- ================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;


-- ================================================================
-- VERIFY
-- ================================================================

-- SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('cancel_order', 'confirm_order_with_reserve');

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN ('customer_name', 'customer_phone');

-- Real-session checks:
--   1. Customer: cancel a still-pending order -> cancels, no release_stock call needed/made.
--   2. Customer: cancel a confirmed order -> cancels AND reserved stock goes back to available.
--   3. Customer: try cancel_order on someone else's order id -> "Yeh order aapka nahi hai".
--   4. Pharmacist: confirm a pending order with enough stock -> confirms, stock reserved.
--   5. Pharmacist: confirm a pending order with insufficient stock on one of several items ->
--      whole call fails, any items reserved earlier in the same call are released back.
--   6. New B2C order -> customer_name/customer_phone populate; SellerDashboard order
--      card shows the real name instead of "Customer".
--   7. Old pre-fix orders -> customer_name/customer_phone stay NULL, card falls back
--      to "Customer" as before (unchanged, expected).


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS cancel_order(UUID);
-- DROP FUNCTION IF EXISTS confirm_order_with_reserve(UUID);
-- ALTER TABLE orders DROP COLUMN IF EXISTS customer_name;
-- ALTER TABLE orders DROP COLUMN IF EXISTS customer_phone;
-- -- Reverting the columns requires also reverting orders.js/Checkout.jsx's
-- -- writes to them (harmless to leave the code writing to dropped
-- -- columns removed first, or Supabase will error on next order placed).
