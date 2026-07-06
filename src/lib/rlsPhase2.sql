-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 2: staff_whitelist + seller_registrations
-- Run this in Supabase SQL Editor
-- Only these two tables touched. No other table's policies changed.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 0. HARDEN THE PHASE-1 HELPER — SECURITY DEFINER + locked search_path.
--    Reason: this function itself reads staff_whitelist (and, from
--    Phase 3 onward, platform_settings). Once RLS is ON for
--    staff_whitelist (this file), a policy that calls this function
--    would otherwise have that internal SELECT re-evaluated under RLS
--    too — for a caller who isn't SuperAdmin/delegated-admin, that
--    internal SELECT could itself get blocked, making the function
--    return a false negative (or in the worst case, if invoked by an
--    even more restricted role, error out) instead of a clean
--    true/false. SECURITY DEFINER makes the function body run as its
--    owner (bypassing RLS for its own internal reads), and
--    SET search_path = public closes the classic search-path
--    injection hole that SECURITY DEFINER functions are otherwise
--    exposed to. Body is unchanged from Phase 1 — only the security
--    context changes.
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

-- Same hardening for the plain-SuperAdmin check used standalone below
-- (medicine_requests in Phase 1, and staff_whitelist/seller_registrations
-- UPDATE/DELETE here) — pulled into its own helper so it also gets
-- SECURITY DEFINER once staff_whitelist RLS goes on. Not strictly
-- required today (super_admins has no RLS yet), but this function is
-- the one that will keep working unchanged when super_admins gets RLS
-- in a later phase.
CREATE OR REPLACE FUNCTION is_active_superadmin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE email = auth.email() AND is_active = true);
$$;


-- ================================================================
-- 1. STAFF_WHITELIST
-- ================================================================

ALTER TABLE staff_whitelist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_whitelist_select"           ON staff_whitelist;
DROP POLICY IF EXISTS "staff_whitelist_insert"            ON staff_whitelist;
DROP POLICY IF EXISTS "staff_whitelist_update"            ON staff_whitelist;
DROP POLICY IF EXISTS "staff_whitelist_delete"            ON staff_whitelist;
DROP POLICY IF EXISTS "staff_whitelist_insert_self_reg"   ON staff_whitelist;
DROP POLICY IF EXISTS "staff_whitelist_select_own_or_admin" ON staff_whitelist;
DROP POLICY IF EXISTS "staff_whitelist_update_superadmin" ON staff_whitelist;
DROP POLICY IF EXISTS "staff_whitelist_delete_superadmin" ON staff_whitelist;

-- INSERT: open — this is the public pharmacist self-registration form
-- (PharmacistRegister.jsx), which runs before any login exists, so it
-- must be reachable by anon. WITH CHECK forces every anon-submitted row
-- to land unapproved: is_approved must be false and approved_by must be
-- NULL, no matter what role/value the client sends — so nobody can
-- insert themselves as already-approved staff.
--
-- Second branch — is_active_superadmin() — exists because
-- SuperAdminPanel.jsx does two INSERT-shaped writes of its own with
-- is_approved: true directly: approveSeller() (line ~270) upserts a
-- staff_whitelist row for a seller email that has no prior row, which
-- Postgres executes as a plain INSERT since there's no existing row to
-- conflict on; and addAdmin() (line ~385) does a bare insert() the same
-- way. Both would be rejected by the self-registration branch alone
-- (is_approved must be false there). Only a genuine, currently-active
-- SuperAdmin gets this bypass — a delegated Admin does not, since
-- delegation is scoped to commission requests, not staff approval.
CREATE POLICY "staff_whitelist_insert_self_reg"
  ON staff_whitelist FOR INSERT
  WITH CHECK (
    (is_approved = false AND approved_by IS NULL)
    OR is_active_superadmin()
  );

-- SELECT: (a) SuperAdmin or a delegated Admin sees every row (approval
-- queues, admin list); (b) any authenticated session may read its own
-- row by email — this is what AuthContext.jsx's post-login role
-- resolution depends on (see code-check below).
CREATE POLICY "staff_whitelist_select_own_or_admin"
  ON staff_whitelist FOR SELECT
  USING (
    is_superadmin_or_delegated_admin()
    OR email = auth.email()
  );

-- UPDATE: SuperAdmin only. Approval is explicitly a SuperAdmin action —
-- the commission delegation flag is scoped to commission requests, not
-- staff approval, so is_superadmin_or_delegated_admin() is deliberately
-- NOT used here.
CREATE POLICY "staff_whitelist_update_superadmin"
  ON staff_whitelist FOR UPDATE
  USING (is_active_superadmin());

-- DELETE: SuperAdmin only.
CREATE POLICY "staff_whitelist_delete_superadmin"
  ON staff_whitelist FOR DELETE
  USING (is_active_superadmin());


-- ================================================================
-- 2. SELLER_REGISTRATIONS
-- ================================================================

ALTER TABLE seller_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_registrations_select"           ON seller_registrations;
DROP POLICY IF EXISTS "seller_registrations_insert"           ON seller_registrations;
DROP POLICY IF EXISTS "seller_registrations_update"           ON seller_registrations;
DROP POLICY IF EXISTS "seller_registrations_delete"           ON seller_registrations;
DROP POLICY IF EXISTS "seller_registrations_insert_public"   ON seller_registrations;
DROP POLICY IF EXISTS "seller_registrations_select_superadmin" ON seller_registrations;
DROP POLICY IF EXISTS "seller_registrations_update_superadmin" ON seller_registrations;
DROP POLICY IF EXISTS "seller_registrations_delete_superadmin" ON seller_registrations;

-- INSERT: open — public seller application form (SellerRegister.jsx),
-- also submitted before any login exists.
CREATE POLICY "seller_registrations_insert_public"
  ON seller_registrations FOR INSERT
  WITH CHECK (true);

-- SELECT/UPDATE/DELETE: SuperAdmin only — this is SuperAdminPanel's
-- review queue (approveSeller/rejectSeller), never touched by
-- AdminPanel or any customer/seller-facing screen.
CREATE POLICY "seller_registrations_select_superadmin"
  ON seller_registrations FOR SELECT
  USING (is_active_superadmin());

CREATE POLICY "seller_registrations_update_superadmin"
  ON seller_registrations FOR UPDATE
  USING (is_active_superadmin());

CREATE POLICY "seller_registrations_delete_superadmin"
  ON seller_registrations FOR DELETE
  USING (is_active_superadmin());


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('staff_whitelist', 'seller_registrations');

-- SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('staff_whitelist', 'seller_registrations')
--   ORDER BY tablename, cmd;

-- Confirm both helper functions are now SECURITY DEFINER:
-- SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('is_superadmin_or_delegated_admin', 'is_active_superadmin');


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Option A: turn RLS off entirely for these two tables
-- ALTER TABLE staff_whitelist      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE seller_registrations DISABLE ROW LEVEL SECURITY;

-- Option B: keep RLS on, just remove these specific policies
-- DROP POLICY IF EXISTS "staff_whitelist_insert_self_reg"        ON staff_whitelist;
-- DROP POLICY IF EXISTS "staff_whitelist_select_own_or_admin"    ON staff_whitelist;
-- DROP POLICY IF EXISTS "staff_whitelist_update_superadmin"      ON staff_whitelist;
-- DROP POLICY IF EXISTS "staff_whitelist_delete_superadmin"      ON staff_whitelist;
-- DROP POLICY IF EXISTS "seller_registrations_insert_public"     ON seller_registrations;
-- DROP POLICY IF EXISTS "seller_registrations_select_superadmin" ON seller_registrations;
-- DROP POLICY IF EXISTS "seller_registrations_update_superadmin" ON seller_registrations;
-- DROP POLICY IF EXISTS "seller_registrations_delete_superadmin" ON seller_registrations;
-- DROP FUNCTION IF EXISTS is_active_superadmin();
-- Note: is_superadmin_or_delegated_admin() reverts to its Phase 1 shape
-- (drop SECURITY DEFINER / SET search_path) only if you also roll back
-- Phase 1 — otherwise leave it as-is, Phase 1's policies still need it.
