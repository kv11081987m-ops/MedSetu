-- ══════════════════════════════════════════════════
-- MedSetu — R2 Order Routing, Part A: DB foundation only
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: schema only, additive. No order-placement/assignment behaviour
-- changes yet — that's R2-C (auto-assign on order create) and R2-D
-- (timeout → next seller). This migration only gives those future phases
-- somewhere to write to.
--
-- Every column is nullable or has a safe default — no existing row in
-- orders/sellers/platform_settings is touched or can fail to satisfy a
-- new constraint. All ADD COLUMN IF NOT EXISTS, so re-running this file
-- is a no-op the second time.

-- ================================================================
-- 1. sellers.routing_weight — admin-set ratio weight
-- ================================================================
-- 0 = seller is out of the routing rotation (new sellers start here
-- until an admin opts them in via the Order Routing screen). Weight has
-- no unit — it's only ever compared against other sellers' weights at
-- assignment time (R2-C), e.g. weights 6/2/1/1 → 60%/20%/10%/10%.
ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS routing_weight INTEGER NOT NULL DEFAULT 0;


-- ================================================================
-- 2. orders — routing bookkeeping columns
-- ================================================================
-- All nullable/defaulted — orders.status stays driven by the existing
-- pending/confirmed/.../cancelled values (see 001_schema.sql) and is
-- NOT touched by this migration. These columns are write targets for
-- R2-C/R2-D, unused until then.

-- When this order was assigned to its current seller_id (auto-routed or
-- admin-overridden). NULL for every order placed before R2-C ships, and
-- for any order whose seller was picked the old way (cart-bound).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

-- Deadline for the assigned seller to accept before R2-D's timeout logic
-- moves the order to the next candidate. NULL = no active routing
-- deadline (untouched order, or routing already resolved).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_expires_at TIMESTAMP;

-- How many sellers have already been tried for this order (0 = none
-- yet / not a routed order). R2-D increments this on each timeout hop.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_attempt INTEGER DEFAULT 0;

-- Append-only log of past assignment attempts (seller tried, when, why
-- it moved on) so a routed order's path is auditable from the order row
-- alone. Shape is owned by R2-C/R2-D, not fixed here — starts empty.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_history JSONB DEFAULT '[]'::jsonb;

-- Who set the current seller_id: 'auto' (routing algorithm) or 'admin'
-- (manual override). Default 'auto' so every future routed order is
-- unambiguous without extra logic; existing/manual orders also read as
-- 'auto' by default, which is harmless since routing isn't live yet.
-- No CHECK constraint added — enforced application-side only, per scope.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_by TEXT DEFAULT 'auto';

-- Customer's city for this order, copied from their address at order
-- time (R2-C will populate this from addresses.city). Denormalized
-- on purpose — same reasoning as order_items snapshotting price/name:
-- a routing decision must stay tied to the city it was made for even if
-- the customer's address later changes.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_city TEXT;


-- ================================================================
-- 3. platform_settings.routing_timeout_minutes
-- ================================================================
-- Global default for how long an assigned seller has to accept before
-- R2-D routes to the next candidate. Admin-editable (Order Routing
-- screen). Not used by any code path yet.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS routing_timeout_minutes INTEGER DEFAULT 15;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'sellers' AND column_name = 'routing_weight';
--   -- expect: integer, NO, 0

-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'orders'
--     AND column_name IN ('assigned_at', 'routing_expires_at', 'routing_attempt',
--                          'routing_history', 'assigned_by', 'delivery_city')
--   ORDER BY column_name;

-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'platform_settings' AND column_name = 'routing_timeout_minutes';
--   -- expect: integer, 15

-- Every existing seller must default to 0 (out of rotation) — nobody
-- should suddenly start receiving routed orders just because this
-- migration ran:
--   SELECT count(*) FROM sellers WHERE routing_weight IS DISTINCT FROM 0;
--   -- expect 0 immediately after migration

-- Every existing order must be untouched by the new routing columns:
--   SELECT count(*) FROM orders
--   WHERE assigned_at IS NOT NULL OR routing_expires_at IS NOT NULL
--      OR routing_attempt IS DISTINCT FROM 0 OR routing_history IS DISTINCT FROM '[]'::jsonb
--      OR delivery_city IS NOT NULL;
--   -- expect 0 immediately after migration


-- ================================================================
-- ROLLBACK
-- ================================================================

-- ALTER TABLE sellers            DROP COLUMN IF EXISTS routing_weight;
-- ALTER TABLE orders             DROP COLUMN IF EXISTS assigned_at;
-- ALTER TABLE orders             DROP COLUMN IF EXISTS routing_expires_at;
-- ALTER TABLE orders             DROP COLUMN IF EXISTS routing_attempt;
-- ALTER TABLE orders             DROP COLUMN IF EXISTS routing_history;
-- ALTER TABLE orders             DROP COLUMN IF EXISTS assigned_by;
-- ALTER TABLE orders             DROP COLUMN IF EXISTS delivery_city;
-- ALTER TABLE platform_settings  DROP COLUMN IF EXISTS routing_timeout_minutes;
