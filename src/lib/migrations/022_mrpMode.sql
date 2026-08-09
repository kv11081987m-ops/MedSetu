-- ══════════════════════════════════════════════════
-- MedSetu — MRP Mode Phase R1 Part A: platform_settings.mrp_mode,
-- seller_inventory.mrp, and guard trigger update (seller's own MRP
-- becomes authoritative once set; master_medicines.mrp_max stays as
-- the fallback for sellers who haven't declared one yet)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: DB + seller side only (Part A). Nothing dropped, nothing
-- customer-facing changes here — that's Part B. Existing selling_price
-- flow keeps working exactly as before for every seller until (a) this
-- migration runs and (b) mrp_mode is turned ON in platform_settings.

-- ────────────────────────────────────────────────────────────────
-- 1. platform_settings — MRP Mode toggle
-- ────────────────────────────────────────────────────────────────
-- Default false: turning this migration on does NOT change behaviour
-- until a SuperAdmin flips the switch.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS mrp_mode BOOLEAN DEFAULT false;

-- ────────────────────────────────────────────────────────────────
-- 2. seller_inventory — seller's own freshly-declared MRP
-- ────────────────────────────────────────────────────────────────
-- Nullable, no DEFAULT — a seller who hasn't set one yet keeps
-- selling_price working exactly as before (guard trigger below falls
-- back to master_medicines.mrp_max when this is NULL/0, same as
-- 021_mrpGuard.sql's original behaviour).
ALTER TABLE seller_inventory
  ADD COLUMN IF NOT EXISTS mrp DECIMAL(10,2);

-- ────────────────────────────────────────────────────────────────
-- 3. Guard trigger — seller's own mrp now wins over the master
--    reference once set; master_medicines.mrp_max is the fallback
--    only when the seller hasn't declared one.
-- ────────────────────────────────────────────────────────────────
-- Original (021_mrpGuard.sql), for reference — always compared against
-- master_medicines.mrp_max:
--
--   SELECT mrp_max INTO v_mrp_max FROM master_medicines WHERE id = NEW.medicine_id;
--
-- New version below only changes WHERE v_mrp_max comes from; the NULL/0
-- skip reasoning and the NULL selling_price skip are unchanged.

CREATE OR REPLACE FUNCTION guard_selling_price_vs_mrp()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_mrp_max NUMERIC;
BEGIN
  IF NEW.selling_price IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.mrp IS NOT NULL AND NEW.mrp > 0 THEN
    -- Seller has declared their own MRP on this row — authoritative,
    -- master_medicines is not consulted at all.
    v_mrp_max := NEW.mrp;
  ELSE
    -- No seller MRP yet — fall back to the old master reference,
    -- exactly like 021_mrpGuard.sql did for every row.
    SELECT mrp_max INTO v_mrp_max FROM master_medicines WHERE id = NEW.medicine_id;
  END IF;

  IF v_mrp_max IS NOT NULL AND v_mrp_max > 0 AND NEW.selling_price > v_mrp_max THEN
    RAISE EXCEPTION 'Selling price (₹%) MRP (₹%) se zyada nahi ho sakta', NEW.selling_price, v_mrp_max;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger binding itself is unchanged (still BEFORE INSERT OR UPDATE on
-- seller_inventory, same name) — CREATE OR REPLACE FUNCTION above is
-- enough on its own, but DROP/CREATE TRIGGER is repeated here so this
-- file is idempotent and safe to re-run standalone.
DROP TRIGGER IF EXISTS trg_guard_selling_price_vs_mrp ON seller_inventory;
CREATE TRIGGER trg_guard_selling_price_vs_mrp
BEFORE INSERT OR UPDATE ON seller_inventory
FOR EACH ROW EXECUTE FUNCTION guard_selling_price_vs_mrp();


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'platform_settings' AND column_name = 'mrp_mode';
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'seller_inventory' AND column_name = 'mrp';

-- Smoke test 1 — seller's own mrp now wins over master_medicines.mrp_max
-- (replace ids with a real seller_inventory row):
--   UPDATE seller_inventory SET mrp = 50 WHERE id = '...';
--   UPDATE seller_inventory SET selling_price = 60 WHERE id = '...';
--   -- should raise "Selling price (₹60) MRP (₹50) se zyada nahi ho sakta"
--   -- even if master_medicines.mrp_max for that medicine is, say, 200.

-- Smoke test 2 — fallback to master still works once seller mrp is cleared:
--   UPDATE seller_inventory SET mrp = NULL WHERE id = '...';
--   -- selling_price is now re-checked against master_medicines.mrp_max again,
--   -- exactly like before this migration.

-- Smoke test 3 — unaffected existing rows (mrp still NULL everywhere until
-- Part A's UI writes it): behaviour for every current row is byte-for-byte
-- identical to 021_mrpGuard.sql until something sets seller_inventory.mrp.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- 1. Restore the original guard (from 021_mrpGuard.sql):
--
-- CREATE OR REPLACE FUNCTION guard_selling_price_vs_mrp()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql AS $$
-- DECLARE
--   v_mrp_max NUMERIC;
-- BEGIN
--   IF NEW.selling_price IS NULL THEN
--     RETURN NEW;
--   END IF;
--   SELECT mrp_max INTO v_mrp_max FROM master_medicines WHERE id = NEW.medicine_id;
--   IF v_mrp_max IS NOT NULL AND v_mrp_max > 0 AND NEW.selling_price > v_mrp_max THEN
--     RAISE EXCEPTION 'Selling price (₹%) MRP (₹%) se zyada nahi ho sakta', NEW.selling_price, v_mrp_max;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- 2. Columns are safe to leave in place (nullable, no behaviour change
--    while mrp_mode is off). Only drop if truly rolling back the feature:
-- ALTER TABLE seller_inventory DROP COLUMN IF EXISTS mrp;
-- ALTER TABLE platform_settings DROP COLUMN IF EXISTS mrp_mode;
