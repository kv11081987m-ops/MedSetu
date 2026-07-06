-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 3: platform_settings + super_admins
-- Run this in Supabase SQL Editor
-- Only these two tables touched. No other table's policies changed.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 0. RE-CONFIRM BOTH HELPERS ARE SECURITY DEFINER.
--    Both were already set this way in Phase 2 — this is a defensive
--    CREATE OR REPLACE (body unchanged) so this file is correct
--    standalone even if Phase 2 somehow wasn't applied first, since
--    both functions read the two tables this file locks down.
--    Without SECURITY DEFINER here, once RLS is ON for
--    platform_settings/super_admins, these functions' own internal
--    reads would get re-evaluated under RLS for the calling role —
--    and with no policies granting that role read access (see
--    super_admins below), the functions would start returning false
--    for everyone, locking out every SuperAdmin/delegated-Admin write
--    across every phase already applied (master_medicines,
--    staff_whitelist, seller_registrations).
-- ================================================================

CREATE OR REPLACE FUNCTION is_superadmin_or_delegated_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (SELECT 1 FROM super_admins WHERE email = auth.email() AND is_active = true)
    OR (
      EXISTS (SELECT 1 FROM platform_settings WHERE id = 1 AND commission_approval_delegated_to_admin = true)
      AND EXISTS (SELECT 1 FROM staff_whitelist WHERE email = auth.email() AND role = 'admin' AND is_approved = true)
    );
$$;

CREATE OR REPLACE FUNCTION is_active_superadmin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE email = auth.email() AND is_active = true);
$$;


-- ================================================================
-- 1. PLATFORM_SETTINGS — single-row app config (rates, delivery
--    charge, WhatsApp number, delegation flag, feature toggles).
--    Read everywhere, including by phone-OTP customers who never
--    hold a real Supabase session (Checkout.jsx's delivery-charge
--    read runs under the anon role for them) — so SELECT stays open.
-- ================================================================

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_settings_select" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_insert" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_update" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_delete" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_select_all"        ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_insert_superadmin" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_update_superadmin" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_delete_superadmin" ON platform_settings;

-- Read: fully open, including anon — Checkout, SellerDashboard,
-- MedicineSearch, the WhatsApp-support link, and the delegation-flag
-- check in commission.js all read this regardless of auth state.
CREATE POLICY "platform_settings_select_all"
  ON platform_settings FOR SELECT
  USING (true);

-- Write: SuperAdmin only. The one write call site is
-- SuperAdminPanel.jsx's saveSettings() (single UPDATE, includes the
-- delegation flag itself) — only reachable behind SuperAdminRoute, so
-- this is never called from a delegated-Admin session. Delegation is
-- scoped to commission requests and Medicine Bands writes elsewhere;
-- it does not extend to platform_settings itself, so
-- is_superadmin_or_delegated_admin() is deliberately NOT used here.
CREATE POLICY "platform_settings_update_superadmin"
  ON platform_settings FOR UPDATE
  USING (is_active_superadmin());

-- INSERT/DELETE: no client call site exists (this is a single fixed
-- row, id = 1) — policies included anyway for completeness /
-- forward-safety, same SuperAdmin-only gate.
CREATE POLICY "platform_settings_insert_superadmin"
  ON platform_settings FOR INSERT
  WITH CHECK (is_active_superadmin());

CREATE POLICY "platform_settings_delete_superadmin"
  ON platform_settings FOR DELETE
  USING (is_active_superadmin());


-- ================================================================
-- 2. SUPER_ADMINS — confirmed via grep: zero client-side references
--    anywhere in src/ (no .from('super_admins') call exists). Every
--    read of this table happens exclusively inside the two SECURITY
--    DEFINER helper functions above, which bypass RLS entirely for
--    their own internal SELECTs regardless of policy. So the tightest
--    option applies: enable RLS and add NO policies at all — RLS with
--    zero policies is a default-deny for every operation, for every
--    role, with no exception. The client can never read or write this
--    table directly; the helpers are the only path in or out.
-- ================================================================

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admins_select" ON super_admins;
DROP POLICY IF EXISTS "super_admins_insert" ON super_admins;
DROP POLICY IF EXISTS "super_admins_update" ON super_admins;
DROP POLICY IF EXISTS "super_admins_delete" ON super_admins;

-- (Intentionally no CREATE POLICY below this line for super_admins.)


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('platform_settings', 'super_admins');

-- SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('platform_settings', 'super_admins')
--   ORDER BY tablename, cmd;
-- (super_admins should return zero rows here — that's expected, not a bug.)

-- Confirm both helpers are SECURITY DEFINER:
-- SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('is_superadmin_or_delegated_admin', 'is_active_superadmin');

-- Sanity-check that SuperAdmin can still update settings, and that a
-- non-SuperAdmin session gets denied (test from the app or via a
-- second, non-SuperAdmin authenticated session).


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Option A: turn RLS off entirely for these two tables
-- ALTER TABLE platform_settings DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE super_admins      DISABLE ROW LEVEL SECURITY;

-- Option B: keep RLS on, just remove these specific policies
-- (super_admins has none to drop beyond what's already listed above)
-- DROP POLICY IF EXISTS "platform_settings_select_all"        ON platform_settings;
-- DROP POLICY IF EXISTS "platform_settings_update_superadmin" ON platform_settings;
-- DROP POLICY IF EXISTS "platform_settings_insert_superadmin" ON platform_settings;
-- DROP POLICY IF EXISTS "platform_settings_delete_superadmin" ON platform_settings;
-- Note: do NOT drop is_superadmin_or_delegated_admin() / is_active_superadmin()
-- here — Phase 1 and Phase 2 policies still depend on both.
