-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 5a Fix / Diagnostic
-- ARCHIVED / SUPERSEDED — 014_rlsPhase5a.sql re-ran clean after this
-- patch was applied, so its content (both helpers + the two users
-- policies) is now redundant with that file. Kept for history only —
-- do not run this file on its own.
-- Run this in Supabase SQL Editor
-- Does NOT change the intended design (the users SELECT/UPDATE
-- policies already specify is_active_superadmin() OR ... in
-- rlsPhase5a.sql) — this file (1) re-asserts those exact policies in
-- case of partial/failed application, and (2) gives you a way to
-- actually SEE which branch is failing, since you can't just read
-- auth.email() from the SQL editor (it runs as the postgres
-- superuser, not as your app session — there is no JWT to read).
-- ══════════════════════════════════════════════════


-- ================================================================
-- STEP 1 — DIAGNOSE FIRST. Run this block (uncomment), swap in the
-- exact email you tested with, and check which column comes back
-- false. This simulates having that email's JWT for this session
-- only (local to this SQL editor tab, harmless, nothing persisted).
-- ================================================================

-- SELECT set_config('request.jwt.claims',
--   json_build_object('email', 'kv11081987m@gmail.com')::text, true);
--
-- SELECT
--   current_setting('request.jwt.claims', true) AS jwt_seen,
--   auth.email()                                AS resolved_email,
--   is_active_superadmin()                      AS is_superadmin,
--   is_approved_admin()                         AS is_admin,
--   (SELECT email FROM super_admins WHERE email = auth.email())      AS super_admins_match,
--   (SELECT is_active FROM super_admins WHERE email = auth.email())  AS super_admins_is_active;

-- If is_superadmin comes back false while super_admins_match shows a
-- row, check super_admins_is_active — a false/NULL there (not a
-- missing-branch bug) would explain exactly this symptom.
-- If super_admins_match is NULL, the email in the JWT doesn't match
-- what's stored in super_admins.email at all (casing/whitespace).


-- ================================================================
-- STEP 2 — RE-ASSERT. Harmless no-op if everything already applied
-- correctly; fixes it if the earlier run was partial. Re-declares the
-- two helpers and the two users policies exactly as specified in
-- rlsPhase5a.sql — no design change.
-- ================================================================

CREATE OR REPLACE FUNCTION is_active_superadmin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE email = auth.email() AND is_active = true);
$$;

CREATE OR REPLACE FUNCTION is_approved_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_whitelist
    WHERE email = auth.email() AND role = 'admin' AND is_approved = true
  );
$$;

-- This one was missing from the original patch — the users SELECT
-- policy below calls it, so without this it fails with "function
-- is_approved_pharmacist() does not exist", which is exactly the
-- symptom that surfaced. Fixed here.
CREATE OR REPLACE FUNCTION is_approved_pharmacist()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_whitelist
    WHERE email = auth.email() AND role = 'pharmacist' AND is_approved = true
  );
$$;

DROP POLICY IF EXISTS "users_select_own_or_staff" ON users;
CREATE POLICY "users_select_own_or_staff"
  ON users FOR SELECT
  USING (
    auth_id = auth.uid()
    OR email = auth.email()
    OR is_active_superadmin()
    OR is_approved_admin()
    OR is_approved_pharmacist()
  );

DROP POLICY IF EXISTS "users_update_own_or_superadmin" ON users;
CREATE POLICY "users_update_own_or_superadmin"
  ON users FOR UPDATE
  USING (auth_id = auth.uid() OR email = auth.email() OR is_active_superadmin());


-- ================================================================
-- STEP 3 — CONFIRM RLS + policies are actually live on users right
-- now (rules out "the whole earlier script silently rolled back").
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'users';
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'users';

-- If relrowsecurity is false, or the two policies above aren't
-- listed, the earlier rlsPhase5a.sql run didn't fully commit — most
-- likely the sellers trigger section later in that same script threw
-- an error and the SQL editor rolled back everything run as one
-- transaction. Re-run the full rlsPhase5a.sql after this file, not
-- just this patch.
