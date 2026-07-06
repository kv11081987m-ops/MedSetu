-- ══════════════════════════════════════════════════
-- MedSetu — Tier Commission Redesign: band columns
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════

-- 1. master_medicines — admin-assigned commission band.
--    NULL = unclassified (falls back to the seller's flat rate).
--    Classification UI comes in Step 2 — this just adds the column.
ALTER TABLE master_medicines
  ADD COLUMN IF NOT EXISTS commission_band TEXT
    CHECK (commission_band IN ('high', 'moderate', 'low'));

-- 2. order_items — snapshot of the medicine's band at order-placement
--    time. Freezes the rate an order was actually charged at, so a later
--    admin reclassification never retroactively changes an already-placed
--    order's commission (same reasoning the old cost_price snapshot used).
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS commission_band TEXT
    CHECK (commission_band IN ('high', 'moderate', 'low'));

-- No columns dropped. cost_price stays on seller_inventory and
-- order_items — it's just no longer read by the tier commission calc.
