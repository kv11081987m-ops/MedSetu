-- ══════════════════════════════════════════════════
-- MedSetu — MRP Mode Phase R1 Part D (B5+B6): seller_hidden column
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Deliberately a SEPARATE column from is_available, not a reuse of it.
-- is_available is stock/price-derived and gets recomputed by reserve_stock
-- (005/023_stockNonBlocking.sql), deduct_stock, release_stock
-- (005_atomicStockFunctions.sql), addToSellerInventory, updateInventoryItem
-- (inventory.js), and RateConfirmModal's save handler (SellerDashboard.jsx)
-- — none of them know about a seller's manual "hide this from customers"
-- intent, so overloading is_available would risk a seller's manual hide
-- being silently undone by any of those five write paths (e.g.
-- reserve_stock forcing is_available=true under mrp_mode on the very next
-- order accept). seller_hidden is untouched by all of them — only the
-- seller's own toggle (inventory.js toggleSellerHidden, Part D/B6) ever
-- writes it.
--
-- No trigger/RPC changes in this migration — column only, as scoped.

ALTER TABLE seller_inventory
  ADD COLUMN IF NOT EXISTS seller_hidden BOOLEAN NOT NULL DEFAULT false;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'seller_inventory' AND column_name = 'seller_hidden';

-- Every existing row must default to false (visible) — mrp_mode's new
-- seller_hidden filter (Part D/B5) must not hide anything nobody
-- explicitly hid:
--   SELECT count(*) FROM seller_inventory WHERE seller_hidden IS DISTINCT FROM false;
--   -- expect 0 immediately after migration


-- ================================================================
-- ROLLBACK
-- ================================================================

-- ALTER TABLE seller_inventory DROP COLUMN IF EXISTS seller_hidden;
