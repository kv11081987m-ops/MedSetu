-- ══════════════════════════════════════════════════
-- MedSetu — MRP Guard: selling_price can never exceed master_medicines.mrp_max
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- DB-level backstop for the 4 client-side entry points (InventoryManagement
-- Add/Edit modals, CSV bulk import, SellerDashboard's RateConfirmModal for
-- B2B lot auto-add) that already validate this client-side — a UI check can
-- be bypassed (a crafted API call, or a future entry point that forgets
-- it), this trigger can't be.
--
-- NULL/0 mrp_max (many manually-entered or bulk-imported medicines have no
-- reference price at all) means skip, not block — an unknown MRP is not
-- proof of overpricing. A NULL selling_price (pending-rate rows — B2B lot
-- auto-add inserts these before the retailer sets a rate) is also skipped,
-- same reasoning.
-- ================================================================

CREATE OR REPLACE FUNCTION guard_selling_price_vs_mrp()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_mrp_max NUMERIC;
BEGIN
  IF NEW.selling_price IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT mrp_max INTO v_mrp_max FROM master_medicines WHERE id = NEW.medicine_id;

  IF v_mrp_max IS NOT NULL AND v_mrp_max > 0 AND NEW.selling_price > v_mrp_max THEN
    RAISE EXCEPTION 'Selling price (₹%) MRP (₹%) se zyada nahi ho sakta', NEW.selling_price, v_mrp_max;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_selling_price_vs_mrp ON seller_inventory;
CREATE TRIGGER trg_guard_selling_price_vs_mrp
BEFORE INSERT OR UPDATE ON seller_inventory
FOR EACH ROW EXECUTE FUNCTION guard_selling_price_vs_mrp();


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'guard_selling_price_vs_mrp';

-- Manual smoke test (replace with a real seller_id + a medicine_id whose
-- mrp_max you know is > 0):
--   UPDATE seller_inventory SET selling_price = 999999
--     WHERE seller_id = '...' AND medicine_id = '...';
--   -- should raise: "Selling price (₹999999) MRP (₹...) se zyada nahi ho sakta"

-- Sanity check it does NOT block legitimate writes:
--   1. A medicine with mrp_max IS NULL or 0 — any selling_price should save fine.
--   2. A pending-rate row (selling_price IS NULL, e.g. fresh B2B lot auto-add
--      insert) — should save fine regardless of mrp_max.
--   3. A selling_price at or below mrp_max — should save fine.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP TRIGGER IF EXISTS trg_guard_selling_price_vs_mrp ON seller_inventory;
-- DROP FUNCTION IF EXISTS guard_selling_price_vs_mrp();
