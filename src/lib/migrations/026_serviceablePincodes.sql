-- ══════════════════════════════════════════════════
-- MedSetu — R2 Order Routing, Part A2: pincode supplement
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: schema + admin-facing data only, additive. Area/service
-- routing will run on PINCODE (not delivery_city, which
-- 025_routingFoundation.sql already added and this migration does not
-- touch) — this file only gives admin somewhere to maintain the
-- serviceable-pincode list and orders somewhere to record which pincode
-- an order was placed for. No service-area check is enforced anywhere
-- yet — that's R3. Depends on 025_routingFoundation.sql having already
-- run (platform_settings/orders/sellers routing columns), but doesn't
-- modify anything it added.

-- ================================================================
-- 1. orders.delivery_pincode
-- ================================================================
-- Customer's pincode for this order, same denormalized-snapshot
-- reasoning as delivery_city (025_routingFoundation.sql) — captured at
-- order time so a later address edit can't retroactively change what a
-- past order was routed/served against. Nullable, no default — not
-- populated by any code path yet (that's R2-C, alongside delivery_city).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_pincode TEXT;


-- ================================================================
-- 2. serviceable_pincodes — admin-maintained service-area list
-- ================================================================
-- This table IS the service area: a pincode is servICeable if (and only
-- if, once R3 enforces it) it has a row here with is_active = true.
-- Nothing reads or enforces this yet.
CREATE TABLE IF NOT EXISTS serviceable_pincodes (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  pincode     TEXT        NOT NULL UNIQUE,
  area_name   TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMP   DEFAULT NOW()
);

INSERT INTO serviceable_pincodes (pincode, area_name, is_active) VALUES
  ('274001', 'Deoria',    true),
  ('274201', 'Baitalpur', true)
ON CONFLICT (pincode) DO NOTHING;


-- ── RLS ──────────────────────────────────────────────────────────
-- Same admin/super_admin-manage, everyone-read shape as offers
-- (017_rlsOffersDisputes.sql) and disputes' is_active_superadmin() OR
-- is_approved_admin() write gate — both helper functions already exist
-- (011_rlsPhase2.sql / 014_rlsPhase5a.sql), not redefined here.
-- SELECT is scoped to authenticated (auth.uid() IS NOT NULL) rather than
-- offers' fully-open USING(true): offers had to stay open for
-- phone-OTP-only customer sessions with no real Supabase session at all
-- (see 017's comment) — serviceable_pincodes has no such caller today,
-- and the ask here is explicitly "sabhi authenticated read karein", so
-- the tighter check is used.
ALTER TABLE serviceable_pincodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "serviceable_pincodes_select_authenticated" ON serviceable_pincodes;
DROP POLICY IF EXISTS "serviceable_pincodes_write_staff"          ON serviceable_pincodes;

CREATE POLICY "serviceable_pincodes_select_authenticated"
  ON serviceable_pincodes FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "serviceable_pincodes_write_staff"
  ON serviceable_pincodes FOR ALL
  USING (is_active_superadmin() OR is_approved_admin())
  WITH CHECK (is_active_superadmin() OR is_approved_admin());


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'delivery_pincode';

-- SELECT * FROM serviceable_pincodes ORDER BY pincode;
--   -- expect exactly the 2 seed rows on a fresh run (274001 Deoria,
--   -- 274201 Baitalpur), both is_active = true; re-running this file
--   -- must not duplicate or error on the seed insert.

-- SELECT relrowsecurity FROM pg_class WHERE relname = 'serviceable_pincodes';
--   -- expect true

-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'serviceable_pincodes';
--   -- expect: serviceable_pincodes_select_authenticated (SELECT),
--   --         serviceable_pincodes_write_staff (ALL)

-- Real-session checks:
--   1. SuperAdmin: add/toggle/delete a pincode in the Order Routing screen -> works.
--   2. Approved Admin: same actions -> works (is_approved_admin() covers them too).
--   3. A logged-in customer session: SELECT serviceable_pincodes -> returns rows.
--   4. Anon (no session): SELECT serviceable_pincodes -> returns zero rows (RLS denies).
--   5. Existing orders: delivery_pincode is NULL on every pre-existing row, nothing else changed.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- ALTER TABLE orders DROP COLUMN IF EXISTS delivery_pincode;
-- DROP POLICY IF EXISTS "serviceable_pincodes_select_authenticated" ON serviceable_pincodes;
-- DROP POLICY IF EXISTS "serviceable_pincodes_write_staff"          ON serviceable_pincodes;
-- DROP TABLE IF EXISTS serviceable_pincodes;
