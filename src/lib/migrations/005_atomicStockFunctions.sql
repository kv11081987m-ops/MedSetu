-- ══════════════════════════════════════════════════
-- MedSetu — A38 fix: atomic stock reserve/deduct/release
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════

-- Reserve stock on order ACCEPT. Single conditional UPDATE — only
-- succeeds if (stock_quantity - reserved_quantity) >= p_qty at the
-- moment Postgres applies the row lock, so two concurrent accepts on
-- the last unit can't both succeed (the second one's WHERE clause
-- simply won't match once the first has updated reserved_quantity).
-- Returns success=false + the real available count on failure, so the
-- caller can show a precise "only N left" message.
CREATE OR REPLACE FUNCTION reserve_stock(p_seller_id UUID, p_medicine_id UUID, p_qty INT)
RETURNS TABLE (success BOOLEAN, available INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_available INT;
BEGIN
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

-- Deduct stock on DELIVERED — moves qty out of both stock_quantity and
-- reserved_quantity for real. GREATEST(0, ...) keeps either from going
-- negative regardless of ordering/timing quirks.
CREATE OR REPLACE FUNCTION deduct_stock(p_seller_id UUID, p_medicine_id UUID, p_qty INT)
RETURNS BOOLEAN
LANGUAGE sql AS $$
  UPDATE seller_inventory
  SET stock_quantity    = GREATEST(0, stock_quantity - p_qty),
      reserved_quantity = GREATEST(0, reserved_quantity - p_qty),
      is_available       = GREATEST(0, stock_quantity - p_qty) > GREATEST(0, reserved_quantity - p_qty)
  WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id
  RETURNING true;
$$;

-- Release a reservation on confirmed-order CANCEL (also used to roll
-- back partial reservations when a multi-item accept fails partway
-- through — see reserveStock in inventory.js).
CREATE OR REPLACE FUNCTION release_stock(p_seller_id UUID, p_medicine_id UUID, p_qty INT)
RETURNS BOOLEAN
LANGUAGE sql AS $$
  UPDATE seller_inventory
  SET reserved_quantity = GREATEST(0, reserved_quantity - p_qty),
      is_available       = stock_quantity > GREATEST(0, reserved_quantity - p_qty)
  WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id
  RETURNING true;
$$;
