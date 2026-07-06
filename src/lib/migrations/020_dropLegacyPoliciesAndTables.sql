-- ══════════════════════════════════════════════════
-- MedSetu — Drop legacy permissive policies (record) + lock 3
-- legacy tables never covered by any RLS phase
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════


-- ================================================================
-- 0. CODE-CHECK — grepped fresh, zero live references to any of the
--    three tables below:
--      medicines         — only src/lib/seedData.js:72 (a dev seed
--                           script); its import is commented out at
--                           App.jsx:6 — dead code, not a live path.
--      pharmacist_calls  — zero .from('pharmacist_calls') anywhere.
--                           PharmacistPanel.jsx reads/writes 'orders'
--                           directly (pharmacist_verified column) —
--                           this legacy table was never wired up.
--      reviews           — zero .from('reviews') anywhere. Every
--                           "reviews" hit in the app is either
--                           sellers.total_reviews (a denormalized
--                           count column on sellers itself) or
--                           hardcoded mock UI data (StoreLocator.jsx)
--                           — the feature was never built.
--    All three tables confirmed to still exist live (anon probe:
--    empty array, not a "relation does not exist" error) with an
--    open policy — legacy leftovers from before any RLS phase.
-- ================================================================


-- ================================================================
-- 1. RECORD — the 8 stray permissive policies (qual/with_check =
--    'true') found on users/staff_whitelist/seller_registrations
--    during live incident response were already dropped manually,
--    directly in the SQL Editor, and confirmed closed via repeated
--    anon-key probes in this same session (users/staff_whitelist/
--    seller_registrations all now return zero rows to anon).
--
--    The exact policy names as they existed live were not captured
--    before dropping them — the block below reconstructs them using
--    Supabase's well-known default policy-template names (what the
--    Dashboard's no-code policy UI names things when a table is set
--    up via "Enable read access for all users" / "Enable insert for
--    authenticated users only" style templates, which is the most
--    likely origin given these tables predate this whole RLS effort).
--    DROP POLICY IF EXISTS is a no-op if a name doesn't match — this
--    section is for documentation completeness, not a functional
--    requirement (the fix is already confirmed live).
-- ================================================================

DROP POLICY IF EXISTS "Enable read access for all users"            ON users;
DROP POLICY IF EXISTS "Enable insert for authenticated users only"   ON users;

DROP POLICY IF EXISTS "Enable read access for all users"            ON staff_whitelist;
DROP POLICY IF EXISTS "Enable insert for authenticated users only"   ON staff_whitelist;
DROP POLICY IF EXISTS "Enable update for authenticated users only"   ON staff_whitelist;

DROP POLICY IF EXISTS "Enable read access for all users"            ON seller_registrations;
DROP POLICY IF EXISTS "Enable insert for authenticated users only"   ON seller_registrations;
DROP POLICY IF EXISTS "Enable update for authenticated users only"   ON seller_registrations;


-- ================================================================
-- 2. LEGACY TABLES — medicines / pharmacist_calls / reviews.
--    NOT dropping the tables themselves (may hold data worth
--    inspecting first) — just closing the open door. Enable RLS,
--    drop every policy currently on them (name unknown/irrelevant,
--    wildcard-style drop below via a DO block since we don't know
--    the exact names, same reasoning as section 1), add NO new
--    policy — default deny, same pattern already used for
--    super_admins. No live code path touches these three, so
--    default-deny changes nothing for the running app.
--
--    TODO (post-launch, not now): once you've confirmed none of
--    these three tables hold data worth keeping, DROP TABLE them
--    outright instead of just locking them.
-- ================================================================

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies
    WHERE tablename IN ('medicines', 'pharmacist_calls', 'reviews')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

ALTER TABLE medicines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacist_calls  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews           ENABLE ROW LEVEL SECURITY;
-- (Intentionally no CREATE POLICY for any of the three — default deny.)


-- ================================================================
-- VERIFY
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('medicines', 'pharmacist_calls', 'reviews');

-- SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('medicines', 'pharmacist_calls', 'reviews');
-- (should return zero rows.)

-- Confirm no stray permissive policy remains ANYWHERE outside the
-- intentionally-open tables:
-- SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--   WHERE tablename NOT IN ('master_medicines', 'sellers', 'seller_inventory', 'platform_settings', 'offers')
--     AND (qual = 'true' OR with_check = 'true');
-- (should return zero rows.)


-- ================================================================
-- ROLLBACK
-- ================================================================

-- ALTER TABLE medicines         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE pharmacist_calls  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE reviews           DISABLE ROW LEVEL SECURITY;
-- Note: this file does not restore the 8 dropped permissive policies —
-- those were an unintended exposure, not a design to roll back to.
