-- ══════════════════════════════════════════════════
-- MedSetu — MRP Mode Phase R1 Part C (B3): stock never blocks an order
-- when mrp_mode is ON. Updates reserve_stock() only — deduct_stock()
-- and release_stock() already never block (GREATEST(0,...) clamps).
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: DB only. reserve_stock() is called from exactly two places —
-- SellerDashboard.jsx's acceptOrderImpl (seller accept) and
-- confirm_order_with_reserve() (016_orderFlowFixes.sql, pharmacist
-- call-confirm) — both call this same function, so both are covered by
-- this one change with no further edits needed anywhere else.
--
-- mrp_mode OFF: byte-for-byte identical to 005_atomicStockFunctions.sql's
-- original — same WHERE-clause stock check, same is_available formula.
--
-- mrp_mode ON: the stock-sufficiency WHERE condition is skipped — the
-- UPDATE always matches (as long as the seller_inventory row exists) and
-- always succeeds. reserved_quantity is still bumped for bookkeeping
-- (so stock reports/low-stock alerts keep reflecting real demand), and
-- is_available is forced true — the row must stay visible/orderable
-- regardless of how far reserved_quantity has run past stock_quantity.
-- This intentionally allows reserved_quantity > stock_quantity (an
-- "over-reserve") under mrp_mode — that's the point: stock is now purely
-- informational, never a gate.

CREATE OR REPLACE FUNCTION reserve_stock(p_seller_id UUID, p_medicine_id UUID, p_qty INT)
RETURNS TABLE (success BOOLEAN, available INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_available INT;
  v_mrp_mode  BOOLEAN;
BEGIN
  SELECT mrp_mode INTO v_mrp_mode FROM platform_settings WHERE id = 1;
  v_mrp_mode := COALESCE(v_mrp_mode, false);

  IF v_mrp_mode THEN
    -- Stock never blocks: no stock-sufficiency condition in the WHERE
    -- clause, is_available forced true. Still bumps reserved_quantity so
    -- the row keeps an honest record of demand.
    UPDATE seller_inventory
    SET reserved_quantity = reserved_quantity + p_qty,
        is_available       = true
    WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id
    RETURNING (stock_quantity - reserved_quantity) INTO v_available;

    IF FOUND THEN
      RETURN QUERY SELECT true, v_available;
    ELSE
      -- No such seller_inventory row at all — genuinely can't reserve
      -- against something that doesn't exist, mrp_mode doesn't change that.
      RETURN QUERY SELECT false, 0;
    END IF;
    RETURN;
  END IF;

  -- ── mrp_mode OFF — original 005_atomicStockFunctions.sql behaviour,
  -- unchanged ──────────────────────────────────────────────────────
  UPDATE seller_inventory
  SET reserved_quantity = reserved_quantity + p_qty,
      is_available = (stock_quantity - (reserved_quantity + p_qty)) > 0
  WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id
    AND (stock_quantity - reserved_quantity) >= p_qty
  RETURNING (stock_quantity - reserved_quantity) INTO v_available;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_available;
  ELSE
    SELECT (stock_quantity - reserved_quantity) INTO v_available
    FROM seller_inventory
    WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id;
    RETURN QUERY SELECT false, COALESCE(v_available, 0);
  END IF;
END;
$$;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT prosrc FROM pg_proc WHERE proname = 'reserve_stock';

-- Smoke test 1 — mrp_mode OFF, insufficient stock still blocks (unchanged):
--   UPDATE platform_settings SET mrp_mode = false WHERE id = 1;
--   -- pick a seller_inventory row with (stock_quantity - reserved_quantity) = 2
--   SELECT * FROM reserve_stock('<seller_id>', '<medicine_id>', 5);
--   -- expect success=false, available=2

-- Smoke test 2 — mrp_mode ON, same row now succeeds regardless:
--   UPDATE platform_settings SET mrp_mode = true WHERE id = 1;
--   SELECT * FROM reserve_stock('<seller_id>', '<medicine_id>', 5);
--   -- expect success=true; reserved_quantity went up by 5 even though
--   -- only 2 were "available"; is_available stayed true on the row.

-- Smoke test 3 — pharmacist path automatically covered (no separate change):
--   SELECT confirm_order_with_reserve('<pending_order_id>');
--   -- under mrp_mode ON, succeeds even if an item's stock is 0/negative-available.

-- Smoke test 4 — nonexistent row still fails cleanly under mrp_mode:
--   SELECT * FROM reserve_stock('<seller_id>', '<medicine_id_not_in_inventory>', 1);
--   -- expect success=false, available=0, even with mrp_mode ON.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Restore the original (005_atomicStockFunctions.sql) — no mrp_mode branch:
--
-- CREATE OR REPLACE FUNCTION reserve_stock(p_seller_id UUID, p_medicine_id UUID, p_qty INT)
-- RETURNS TABLE (success BOOLEAN, available INT)
-- LANGUAGE plpgsql AS $$
-- DECLARE
--   v_available INT;
-- BEGIN
--   UPDATE seller_inventory
--   SET reserved_quantity = reserved_quantity + p_qty,
--       is_available = (stock_quantity - (reserved_quantity + p_qty)) > 0
--   WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id
--     AND (stock_quantity - reserved_quantity) >= p_qty
--   RETURNING (stock_quantity - reserved_quantity) INTO v_available;
--
--   IF FOUND THEN
--     RETURN QUERY SELECT true, v_available;
--   ELSE
--     SELECT (stock_quantity - reserved_quantity) INTO v_available
--     FROM seller_inventory
--     WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id;
--     RETURN QUERY SELECT false, COALESCE(v_available, 0);
--   END IF;
-- END;
-- $$;
