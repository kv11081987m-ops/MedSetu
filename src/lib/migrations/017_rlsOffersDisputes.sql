-- ══════════════════════════════════════════════════
-- MedSetu — RLS Final Patch: offers + disputes + dead-table sweep
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════


-- ================================================================
-- 1. OFFERS
--
-- Code-check: read by Checkout.jsx:224/316 and CustomerHome.jsx:173
-- (promo banner + apply-at-checkout) — both screens sit behind
-- ProtectedRoute(customer) in App.jsx, but "logged in" there can mean
-- just the localStorage fallback (lsLoggedIn), not a real Supabase
-- session — same phone-OTP-shaped gap as platform_settings. SELECT
-- stays open for the same reason platform_settings' does: it must
-- work regardless of whether auth.uid() is populated.
-- Write: confirmed ONLY SuperAdminPanel.jsx:884-920 (addOffer/
-- toggleOffer/deleteOffer) — grepped AdminPanel.jsx, zero references,
-- so this is not a delegatable capability. is_active_superadmin() only.
-- ================================================================

ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offers_select"           ON offers;
DROP POLICY IF EXISTS "offers_insert"           ON offers;
DROP POLICY IF EXISTS "offers_update"           ON offers;
DROP POLICY IF EXISTS "offers_delete"           ON offers;
DROP POLICY IF EXISTS "offers_select_all"       ON offers;
DROP POLICY IF EXISTS "offers_insert_superadmin" ON offers;
DROP POLICY IF EXISTS "offers_update_superadmin" ON offers;
DROP POLICY IF EXISTS "offers_delete_superadmin" ON offers;

CREATE POLICY "offers_select_all"
  ON offers FOR SELECT
  USING (true);

CREATE POLICY "offers_insert_superadmin"
  ON offers FOR INSERT
  WITH CHECK (is_active_superadmin());

CREATE POLICY "offers_update_superadmin"
  ON offers FOR UPDATE
  USING (is_active_superadmin());

CREATE POLICY "offers_delete_superadmin"
  ON offers FOR DELETE
  USING (is_active_superadmin());


-- ================================================================
-- 2. DISPUTES
--
-- Code-check: grepped the whole app for any INSERT into disputes —
-- zero results. Only read path is AdminPanel.jsx:481
-- (.select('*, users(name), sellers(store_name))')). The audit's
-- "read only" call was correct — no customer-facing dispute-raising
-- feature currently exists, so no customer branch is added. If that
-- feature gets built later, this file's SELECT/UPDATE/DELETE stay
-- admin-only; only a new INSERT branch (customer owns their own row,
-- same bridge shape as prescriptions) would need adding then.
-- ================================================================

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "disputes_select"      ON disputes;
DROP POLICY IF EXISTS "disputes_insert"      ON disputes;
DROP POLICY IF EXISTS "disputes_update"      ON disputes;
DROP POLICY IF EXISTS "disputes_delete"      ON disputes;
DROP POLICY IF EXISTS "disputes_all_staff"   ON disputes;

CREATE POLICY "disputes_all_staff"
  ON disputes FOR ALL
  USING (is_active_superadmin() OR is_approved_admin())
  WITH CHECK (is_active_superadmin() OR is_approved_admin());


-- ================================================================
-- 3. DEAD-TABLE SWEEP — full cross-check of every CREATE TABLE found
-- across schema.sql/superadmin.sql/masterMedicine.sql against every
-- rlsPhaseX.sql + this file, plus a live existence probe (anon key,
-- read-only) for anything with no client-code reference. Result:
--
--   medicines          — exists live (probed: [] , no "does not
--                         exist" error), but ZERO .from('medicines')
--                         anywhere in src/ except seedData.js, whose
--                         import is commented out in App.jsx:6 (dead).
--   pharmacist_calls    — exists live, zero .from('pharmacist_calls')
--                         anywhere (the pharmacist_calls hits in
--                         SuperAdminPanel.jsx:229/993 are a
--                         platform_settings COLUMN of the same name,
--                         a feature toggle — not this table).
--   admin_permissions   — exists live, zero .from('admin_permissions')
--                         anywhere.
--
-- None of these three are reachable from the running app, so they're
-- not a launch blocker — but they exist as real, empty, RLS-less
-- tables in the live DB, meaning anyone with the anon key could
-- currently read or write them directly by name even though the app
-- never does. Closing with default-deny (enable RLS, add no
-- policies) costs nothing since nothing legitimate uses them.
--
-- Every other table in every CREATE TABLE statement found
-- (users, addresses, sellers, orders, order_items, prescriptions,
-- notifications, master_medicines, seller_inventory, super_admins,
-- staff_whitelist, seller_registrations, platform_settings,
-- medicine_requests, offers, disputes) is now accounted for across
-- rlsPhase0-5b.sql + this file. Nothing left uncovered.
-- ================================================================

ALTER TABLE medicines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacist_calls  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;
-- (Intentionally no CREATE POLICY for any of the three — default deny.)


-- ================================================================
-- VERIFY
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('offers', 'disputes', 'medicines', 'pharmacist_calls', 'admin_permissions');

-- SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('offers', 'disputes')
--   ORDER BY tablename, cmd;
-- (medicines/pharmacist_calls/admin_permissions should show zero rows here — expected.)

-- Real-session checks:
--   1. Customer: Checkout/CustomerHome offers banner still shows FLAT15 etc.
--   2. SuperAdmin: add/toggle/delete an offer -> still works.
--   3. Non-superadmin (plain Admin): try writing to offers directly -> denied.
--   4. Admin/SuperAdmin: AdminPanel disputes list still loads.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- ALTER TABLE offers             DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE disputes           DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE medicines          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE pharmacist_calls   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE admin_permissions  DISABLE ROW LEVEL SECURITY;
-- -- or, keeping RLS on but dropping just the new policies:
-- DROP POLICY IF EXISTS "offers_select_all"        ON offers;
-- DROP POLICY IF EXISTS "offers_insert_superadmin" ON offers;
-- DROP POLICY IF EXISTS "offers_update_superadmin" ON offers;
-- DROP POLICY IF EXISTS "offers_delete_superadmin" ON offers;
-- DROP POLICY IF EXISTS "disputes_all_staff"       ON disputes;
