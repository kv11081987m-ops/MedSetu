-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 1: catalogue tables
-- Run this in Supabase SQL Editor
-- master_medicines + medicine_requests only. No other table touched.
-- ══════════════════════════════════════════════════

-- Safety net — this row already exists live (verified), kept here as an
-- idempotent no-op so this file is correct standalone on any environment.
INSERT INTO super_admins (email, name, is_active)
VALUES ('kv11081987m@gmail.com', 'Kumar', true)
ON CONFLICT (email) DO NOTHING;


-- ================================================================
-- Helper — "SuperAdmin, OR an Admin the SuperAdmin has delegated to."
-- Same delegation flag SuperAdminPanel/AdminPanel already use for
-- Commission Requests (platform_settings.commission_approval_delegated_to_admin,
-- see commission.js#fetchCommissionDelegation). Reused wherever a
-- delegated Admin needs the same write access as SuperAdmin — currently
-- just master_medicines (Medicine Bands), since that's the only place
-- AdminPanel actually exercises delegated write access to a catalogue
-- table. medicine_requests is NOT included here — AdminPanel never reads
-- or writes that table at all (grepped the whole codebase — zero
-- references), so it stays SuperAdmin-only below, not widened.
-- ================================================================

CREATE OR REPLACE FUNCTION is_superadmin_or_delegated_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT
    EXISTS (SELECT 1 FROM super_admins WHERE email = auth.email() AND is_active = true)
    OR (
      EXISTS (SELECT 1 FROM platform_settings WHERE id = 1 AND commission_approval_delegated_to_admin = true)
      AND EXISTS (SELECT 1 FROM staff_whitelist WHERE email = auth.email() AND role = 'admin' AND is_approved = true)
    );
$$;


-- ================================================================
-- 1. MASTER_MEDICINES — public catalogue, SuperAdmin (or delegated
--    Admin) writes
-- ================================================================

ALTER TABLE master_medicines ENABLE ROW LEVEL SECURITY;

-- Drop the old blanket USING(true) policies from enableRLS.sql, if present,
-- and this file's own earlier SuperAdmin-only draft, if it was ever applied.
DROP POLICY IF EXISTS "master_med_select" ON master_medicines;
DROP POLICY IF EXISTS "master_med_insert" ON master_medicines;
DROP POLICY IF EXISTS "master_med_update" ON master_medicines;
DROP POLICY IF EXISTS "master_medicines_insert_superadmin" ON master_medicines;
DROP POLICY IF EXISTS "master_medicines_update_superadmin" ON master_medicines;
DROP POLICY IF EXISTS "master_medicines_delete_superadmin" ON master_medicines;

-- Read: fully open — this is the public medicine catalogue (248K rows),
-- every screen from customer search to seller inventory reads it.
CREATE POLICY "master_medicines_select_all"
  ON master_medicines FOR SELECT
  USING (true);

-- Write: SuperAdmin, or an Admin the SuperAdmin has delegated to
-- (MedicineBandsTab.jsx runs under both — SuperAdminPanel unconditionally,
-- AdminPanel only when commissionDelegated is true).
CREATE POLICY "master_medicines_insert_superadmin_or_delegated"
  ON master_medicines FOR INSERT
  WITH CHECK (is_superadmin_or_delegated_admin());

CREATE POLICY "master_medicines_update_superadmin_or_delegated"
  ON master_medicines FOR UPDATE
  USING (is_superadmin_or_delegated_admin());

CREATE POLICY "master_medicines_delete_superadmin_or_delegated"
  ON master_medicines FOR DELETE
  USING (is_superadmin_or_delegated_admin());


-- ================================================================
-- 2. MEDICINE_REQUESTS — sellers request, SuperAdmin reviews.
--    NOT widened to delegated Admin — AdminPanel never touches this
--    table (checked: zero references anywhere in AdminPanel.jsx).
-- ================================================================

ALTER TABLE medicine_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "med_req_select" ON medicine_requests;
DROP POLICY IF EXISTS "med_req_insert" ON medicine_requests;
DROP POLICY IF EXISTS "med_req_update" ON medicine_requests;

-- Insert: any authenticated session (sellers always log in via
-- magic-link/Google, so auth.uid() is reliably populated for them).
CREATE POLICY "medicine_requests_insert_authenticated"
  ON medicine_requests FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Read/update: SuperAdmin's review queue only — deliberately not using
-- is_superadmin_or_delegated_admin() here, per the check above.
CREATE POLICY "medicine_requests_select_superadmin"
  ON medicine_requests FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM super_admins WHERE email = auth.email() AND is_active = true)
  );

CREATE POLICY "medicine_requests_update_superadmin"
  ON medicine_requests FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM super_admins WHERE email = auth.email() AND is_active = true)
  );


-- ================================================================
-- VERIFY — run after applying, confirm the shape matches the above
-- ================================================================

-- Confirm RLS is actually on for both tables
-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('master_medicines', 'medicine_requests');

-- List every policy now active on both tables
-- SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('master_medicines', 'medicine_requests')
--   ORDER BY tablename, cmd;

-- Sanity-check the helper directly against today's delegation flag
-- SELECT commission_approval_delegated_to_admin FROM platform_settings WHERE id = 1;


-- ================================================================
-- ROLLBACK — isolated to these two tables (+ the helper function)
-- ================================================================

-- Option A: turn RLS off entirely (instant return to today's open access)
-- ALTER TABLE master_medicines  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE medicine_requests DISABLE ROW LEVEL SECURITY;

-- Option B: keep RLS on, just remove these specific policies
-- DROP POLICY IF EXISTS "master_medicines_select_all"                    ON master_medicines;
-- DROP POLICY IF EXISTS "master_medicines_insert_superadmin_or_delegated" ON master_medicines;
-- DROP POLICY IF EXISTS "master_medicines_update_superadmin_or_delegated" ON master_medicines;
-- DROP POLICY IF EXISTS "master_medicines_delete_superadmin_or_delegated" ON master_medicines;
-- DROP POLICY IF EXISTS "medicine_requests_insert_authenticated"          ON medicine_requests;
-- DROP POLICY IF EXISTS "medicine_requests_select_superadmin"             ON medicine_requests;
-- DROP POLICY IF EXISTS "medicine_requests_update_superadmin"             ON medicine_requests;
-- DROP FUNCTION IF EXISTS is_superadmin_or_delegated_admin();
