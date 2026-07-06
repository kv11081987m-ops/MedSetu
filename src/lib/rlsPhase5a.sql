-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 5a: users + sellers + addresses
-- Run this in Supabase SQL Editor
-- Identity-core tables. Read the chat reply alongside this file for
-- the full code-check and two findings that need your decision
-- before running.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 0. NEW HELPERS (in addition to is_superadmin_or_delegated_admin()
--    and is_active_superadmin(), both already SECURITY DEFINER from
--    earlier phases).
-- ================================================================

-- Any currently-approved Admin, delegated or not. Distinct from
-- is_superadmin_or_delegated_admin() — that one gates the specific
-- commission-approval/Medicine-Bands delegation; this one gates a
-- base Admin capability that every approved Admin has regardless of
-- delegation (AdminPanel.jsx's own seller approve/reject, and the
-- admin/superadmin branch of the users SELECT policy below).
CREATE OR REPLACE FUNCTION is_approved_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_whitelist
    WHERE email = auth.email() AND role = 'admin' AND is_approved = true
  );
$$;

-- Any currently-approved pharmacist. New requirement surfaced by this
-- phase's code-check — see finding #1 in the chat reply.
CREATE OR REPLACE FUNCTION is_approved_pharmacist()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_whitelist
    WHERE email = auth.email() AND role = 'pharmacist' AND is_approved = true
  );
$$;


-- ================================================================
-- 1. USERS
-- ================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select" ON users;
DROP POLICY IF EXISTS "users_insert" ON users;
DROP POLICY IF EXISTS "users_update" ON users;
DROP POLICY IF EXISTS "users_select_own_or_staff" ON users;
DROP POLICY IF EXISTS "users_insert_own"          ON users;
DROP POLICY IF EXISTS "users_update_own_or_superadmin" ON users;

-- SELECT: own row (via the Phase 0 bridge — auth_id primary, email as
-- fallback for the exact moment auth_id hasn't been backfilled yet),
-- OR Admin/SuperAdmin (user-list stats, order/dispute customer-name
-- joins), OR an approved pharmacist (prescription/order verification
-- queue needs the customer's name+phone — see finding #1).
CREATE POLICY "users_select_own_or_staff"
  ON users FOR SELECT
  USING (
    auth_id = auth.uid()
    OR email = auth.email()
    OR is_active_superadmin()
    OR is_approved_admin()
    OR is_approved_pharmacist()
  );

-- INSERT: only your own row, identified by the identity you're
-- signing in with right now. Covers both AuthContext.jsx upsert
-- branches (staff: line ~206, customer: line ~271) — both set
-- auth_id: emailUser.id and email: emailUser.email, i.e. exactly the
-- caller's own auth.uid()/auth.email(), so this passes trivially.
-- auth.js's phone-only upsert (line 31) is NOT covered — auth.uid()
-- and auth.email() are both NULL with no Supabase session behind a
-- bare phone number. Per your note this path is already
-- parked/broken (Firebase OTP isn't live), so this doesn't newly
-- break anything — it just stays broken. Flagging per finding #2.
CREATE POLICY "users_insert_own"
  ON users FOR INSERT
  WITH CHECK (auth_id = auth.uid() OR email = auth.email());

-- UPDATE: own row (covers AuthContext's auth_id-backfill UPDATE —
-- line ~219 / ~279 — matched via email since auth_id is still NULL
-- at that exact moment; PharmacistPanel.jsx:381's is_available
-- toggle; UserProfile.jsx:115's profile edit), or SuperAdmin.
CREATE POLICY "users_update_own_or_superadmin"
  ON users FOR UPDATE
  USING (auth_id = auth.uid() OR email = auth.email() OR is_active_superadmin());

-- No DELETE policy — grepped the whole app, nothing ever deletes a
-- users row. Default deny.


-- ================================================================
-- 2. SELLERS
-- ================================================================

ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sellers_select" ON sellers;
DROP POLICY IF EXISTS "sellers_insert" ON sellers;
DROP POLICY IF EXISTS "sellers_update" ON sellers;
DROP POLICY IF EXISTS "sellers_delete" ON sellers;
DROP POLICY IF EXISTS "sellers_select_all"            ON sellers;
DROP POLICY IF EXISTS "sellers_insert_superadmin"      ON sellers;
DROP POLICY IF EXISTS "sellers_update_owner_or_staff"  ON sellers;
DROP POLICY IF EXISTS "sellers_delete_superadmin"      ON sellers;

-- SELECT: fully open — public store directory (customer browse,
-- fetchSellers/fetchWholesalers, CustomerStoreInventory, B2B
-- locator all depend on this).
CREATE POLICY "sellers_select_all"
  ON sellers FOR SELECT
  USING (true);

-- INSERT: SuperAdmin only — the only INSERT call site is
-- SuperAdminPanel.jsx#approveSeller (~line 249). seedData.js also
-- inserts sellers directly, but its import is commented out in
-- App.jsx (dead code, not a live path) — not accommodated.
CREATE POLICY "sellers_insert_superadmin"
  ON sellers FOR INSERT
  WITH CHECK (is_active_superadmin());

-- UPDATE: owning seller (bridge), OR SuperAdmin, OR approved Admin.
-- Row-level only — see the trigger below for the column-level
-- restriction this table actually needs (finding #3): a plain owning
-- seller must NOT be able to set is_verified/commission_mode/
-- commission_flat_rate/rating themselves just because they can UPDATE
-- their own row.
CREATE POLICY "sellers_update_owner_or_staff"
  ON sellers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = sellers.user_id
        AND (u.auth_id = auth.uid() OR u.email = auth.email())
    )
    OR is_active_superadmin()
    OR is_approved_admin()
  );

-- DELETE: SuperAdmin only. No live call site today (kept for
-- completeness, per your spec).
CREATE POLICY "sellers_delete_superadmin"
  ON sellers FOR DELETE
  USING (is_active_superadmin());


-- ----------------------------------------------------------------
-- Column-level guard (finding #3) — RLS policies are row-level only;
-- they can't by themselves stop an owning seller from setting
-- is_verified/commission_mode/commission_flat_rate/rating on their
-- OWN row via a crafted client call, since "own row" already passes
-- the UPDATE policy above. A BEFORE UPDATE trigger reverts these
-- specific columns to their prior value unless the caller has the
-- right authority for that specific column:
--   - is_verified / rejection_reason / rating: SuperAdmin OR any
--     approved Admin (AdminPanel.jsx's approveSeller/rejectSeller is
--     NOT gated by delegation — any admin can flip these today).
--   - commission_mode / commission_flat_rate: SuperAdmin OR
--     DELEGATED Admin only (SuperAdminPanel.jsx#saveSellerCommission
--     is SuperAdmin's own direct authority; AdminPanel.jsx's
--     handleApproveCommission is reachable only when
--     commissionDelegated is true — AdminPanel.jsx:632/566).
-- Seller-editable fields (store_name/owner_name/phone/drug_license/
-- gst_number/is_open/commission_pending_mode/commission_pending_rate/
-- commission_status) are untouched by this trigger.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION protect_seller_trust_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_active_superadmin() OR is_approved_admin()) THEN
    NEW.is_verified      := OLD.is_verified;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.rating           := OLD.rating;
  END IF;

  IF NOT is_superadmin_or_delegated_admin() THEN
    NEW.commission_mode      := OLD.commission_mode;
    NEW.commission_flat_rate := OLD.commission_flat_rate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_seller_trust_columns ON sellers;
CREATE TRIGGER trg_protect_seller_trust_columns
BEFORE UPDATE ON sellers
FOR EACH ROW EXECUTE FUNCTION protect_seller_trust_columns();


-- ================================================================
-- 3. ADDRESSES — purely self-scoped, no staff/admin reader exists
--    anywhere in the app (grepped: only Checkout.jsx + UserProfile.jsx
--    touch this table, both always keyed by the logged-in user's own
--    user_id from localStorage's medsetu_user).
-- ================================================================

ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "addresses_select" ON addresses;
DROP POLICY IF EXISTS "addresses_insert" ON addresses;
DROP POLICY IF EXISTS "addresses_update" ON addresses;
DROP POLICY IF EXISTS "addresses_delete" ON addresses;
DROP POLICY IF EXISTS "addresses_select_own" ON addresses;
DROP POLICY IF EXISTS "addresses_insert_own" ON addresses;
DROP POLICY IF EXISTS "addresses_update_own" ON addresses;
DROP POLICY IF EXISTS "addresses_delete_own" ON addresses;

CREATE POLICY "addresses_select_own"
  ON addresses FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = addresses.user_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
  );

CREATE POLICY "addresses_insert_own"
  ON addresses FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = addresses.user_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
  );

CREATE POLICY "addresses_update_own"
  ON addresses FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = addresses.user_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
  );

CREATE POLICY "addresses_delete_own"
  ON addresses FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = addresses.user_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
  );


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('users', 'sellers', 'addresses');

-- SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('users', 'sellers', 'addresses')
--   ORDER BY tablename, cmd;

-- SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('is_approved_admin', 'is_approved_pharmacist', 'protect_seller_trust_columns');

-- Confirm the trigger is attached:
-- SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname = 'trg_protect_seller_trust_columns';

-- Real-session sanity checks to run from the app after applying:
--   1. Seller: edit store details (owner_name/phone/license/gst) -> succeeds.
--   2. Seller: try setting is_verified/commission_mode via a raw
--      supabase.rpc/PATCH call (not through UI) -> value must stay
--      unchanged (trigger reverts it), UPDATE itself still succeeds.
--   3. Admin (non-delegated): approveSeller/rejectSeller -> succeeds.
--   4. Admin (non-delegated): try changing commission_mode directly -> reverted.
--   5. Delegated Admin: approve/reject a commission REQUEST -> succeeds.
--   6. Pharmacist: PharmacistPanel prescription/order queue shows
--      customer name+phone (not blank).
--   7. Customer: UserProfile addresses CRUD, Checkout default-address
--      read -> all still work.
--   8. AdminPanel user-count stat and users(name)/users(phone,name)
--      joins on orders/disputes -> still populate.


-- ================================================================
-- ROLLBACK — table by table
-- ================================================================

-- users:
-- ALTER TABLE users DISABLE ROW LEVEL SECURITY;
-- -- or, keeping RLS on:
-- DROP POLICY IF EXISTS "users_select_own_or_staff"      ON users;
-- DROP POLICY IF EXISTS "users_insert_own"                ON users;
-- DROP POLICY IF EXISTS "users_update_own_or_superadmin"  ON users;

-- sellers:
-- ALTER TABLE sellers DISABLE ROW LEVEL SECURITY;
-- DROP TRIGGER IF EXISTS trg_protect_seller_trust_columns ON sellers;
-- DROP FUNCTION IF EXISTS protect_seller_trust_columns();
-- -- or, keeping RLS on but dropping just the policies:
-- DROP POLICY IF EXISTS "sellers_select_all"           ON sellers;
-- DROP POLICY IF EXISTS "sellers_insert_superadmin"     ON sellers;
-- DROP POLICY IF EXISTS "sellers_update_owner_or_staff" ON sellers;
-- DROP POLICY IF EXISTS "sellers_delete_superadmin"     ON sellers;

-- addresses:
-- ALTER TABLE addresses DISABLE ROW LEVEL SECURITY;
-- -- or:
-- DROP POLICY IF EXISTS "addresses_select_own" ON addresses;
-- DROP POLICY IF EXISTS "addresses_insert_own" ON addresses;
-- DROP POLICY IF EXISTS "addresses_update_own" ON addresses;
-- DROP POLICY IF EXISTS "addresses_delete_own" ON addresses;

-- Helpers (only if nothing from Phase 5a is left applied):
-- DROP FUNCTION IF EXISTS is_approved_admin();
-- DROP FUNCTION IF EXISTS is_approved_pharmacist();
