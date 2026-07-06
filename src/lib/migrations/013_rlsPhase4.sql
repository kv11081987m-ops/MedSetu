-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 4: seller_inventory + notifications
-- Run this in Supabase SQL Editor
-- Only these two tables touched (+ re-confirming the 2 existing
-- helper functions stay SECURITY DEFINER).
--
-- NOTE (notifications, section 2 below): applied as originally
-- specified — RLS on, authenticated-only INSERT stopgap. Accepted
-- as-is because no phone-OTP user currently exists; every live
-- session is a real Supabase session. Jab Firebase OTP revive ho,
-- Supabase-session route (phone-auth ya token exchange) SE HI
-- banana — warna phone customers ka bell + order-notification toot
-- jayega. Ya create_notification SECURITY DEFINER RPC banana
-- (Hard Case 4) taaki auth.uid() na hone par bhi insert chal sake.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 0a. RE-CONFIRM THE TWO EXISTING HELPERS ARE SECURITY DEFINER.
--     Defensive CREATE OR REPLACE, body unchanged — same reasoning
--     as Phase 3 (both read tables that now have RLS on).
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
-- 0b. STOCK RPCs — reserve_stock / deduct_stock / release_stock.
--     LEFT AS SECURITY INVOKER (Postgres default) — not touched,
--     kept here only as a no-op reference (bodies identical to
--     atomicStockFunctions.sql, no CREATE OR REPLACE needed).
--
--     Decision: every call site in the app
--     (SellerDashboard.jsx:611/638/709/732, inventory.js:180) passes
--     sellerData.id — the CALLING session's OWN seller row — for
--     both B2C and B2B accept/deliver/cancel. No call site ever
--     reserves/deducts/releases another seller's stock, so the
--     owning-seller UPDATE policy on seller_inventory (below) already
--     lets these functions run correctly as plain SECURITY INVOKER,
--     with the added benefit that RLS blocks a caller from ever
--     touching a seller_id they don't own — no SQL change needed
--     here, section kept for documentation only.
-- ================================================================


-- ================================================================
-- 1. SELLER_INVENTORY — public catalogue rows (customer search,
--    store browse, B2B locator all read this), owning-seller writes.
-- ================================================================

ALTER TABLE seller_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_inventory_select" ON seller_inventory;
DROP POLICY IF EXISTS "seller_inventory_insert" ON seller_inventory;
DROP POLICY IF EXISTS "seller_inventory_update" ON seller_inventory;
DROP POLICY IF EXISTS "seller_inventory_delete" ON seller_inventory;
DROP POLICY IF EXISTS "seller_inventory_select_all"          ON seller_inventory;
DROP POLICY IF EXISTS "seller_inventory_insert_owner"        ON seller_inventory;
DROP POLICY IF EXISTS "seller_inventory_update_owner"        ON seller_inventory;
DROP POLICY IF EXISTS "seller_inventory_delete_owner"        ON seller_inventory;

-- Read: fully open — customer medicine search, store inventory
-- screens, B2B wholesaler locator all depend on this being public.
CREATE POLICY "seller_inventory_select_all"
  ON seller_inventory FOR SELECT
  USING (true);

-- Write: the OWNING seller only — resolved via the Phase 0 bridge
-- (sellers.user_id -> users.id -> users.auth_id = auth.uid()) — or
-- SuperAdmin (not delegated Admin: no existing delegation scope
-- covers inventory, so kept narrow like staff_whitelist/settings;
-- widen later if AdminPanel ever needs to touch a seller's stock).
CREATE POLICY "seller_inventory_insert_owner"
  ON seller_inventory FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.id = seller_inventory.seller_id AND u.auth_id = auth.uid()
    )
    OR is_active_superadmin()
  );

CREATE POLICY "seller_inventory_update_owner"
  ON seller_inventory FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.id = seller_inventory.seller_id AND u.auth_id = auth.uid()
    )
    OR is_active_superadmin()
  );

CREATE POLICY "seller_inventory_delete_owner"
  ON seller_inventory FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.id = seller_inventory.seller_id AND u.auth_id = auth.uid()
    )
    OR is_active_superadmin()
  );


-- ================================================================
-- 2. NOTIFICATIONS — see the file-header NOTE re: phone-OTP.
-- ================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
DROP POLICY IF EXISTS "notifications_update" ON notifications;
DROP POLICY IF EXISTS "notifications_delete" ON notifications;
DROP POLICY IF EXISTS "notifications_select_own"          ON notifications;
DROP POLICY IF EXISTS "notifications_insert_authenticated" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own"          ON notifications;

-- SELECT: own row only, via the same auth_id bridge.
CREATE POLICY "notifications_select_own"
  ON notifications FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = notifications.user_id AND u.auth_id = auth.uid())
  );

-- INSERT: authenticated-only stopgap — createNotification() is always
-- a cross-user write (the acting session creates a row for the OTHER
-- party in an order), so it can't be scoped to "your own row" the way
-- SELECT/UPDATE are. Real fix is RPC-izing this later; not in scope now.
CREATE POLICY "notifications_insert_authenticated"
  ON notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE: own row only — markNotificationRead / markAllNotificationsRead.
CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = notifications.user_id AND u.auth_id = auth.uid())
  );

-- DELETE: no policy — grepped the whole app, nothing ever deletes a
-- notification. RLS + zero policy = default deny, same as super_admins.


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('seller_inventory', 'notifications');

-- SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('seller_inventory', 'notifications')
--   ORDER BY tablename, cmd;

-- Confirm both helpers touched by this file are SECURITY DEFINER:
-- SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('is_superadmin_or_delegated_admin', 'is_active_superadmin');
-- (reserve_stock / deduct_stock / release_stock intentionally excluded
-- — left as SECURITY INVOKER, see section 0b.)

-- Real-session sanity checks to run from the app after applying:
--   1. Seller (Google/magic-link session) accept/deliver/cancel an order
--      -> stock RPCs must still succeed (now RLS-enforced via
--      seller_inventory_update_owner, not bypassed).
--   2. Any user's notification bell (fetch + realtime) -> must still
--      show their own notifications; Checkout.jsx's seller-notify
--      insert must still succeed (all current sessions are real).


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Option A: turn RLS off entirely for these two tables
-- ALTER TABLE seller_inventory DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications    DISABLE ROW LEVEL SECURITY;

-- Option B: keep RLS on, just remove these specific policies
-- DROP POLICY IF EXISTS "seller_inventory_select_all"   ON seller_inventory;
-- DROP POLICY IF EXISTS "seller_inventory_insert_owner" ON seller_inventory;
-- DROP POLICY IF EXISTS "seller_inventory_update_owner" ON seller_inventory;
-- DROP POLICY IF EXISTS "seller_inventory_delete_owner" ON seller_inventory;
-- DROP POLICY IF EXISTS "notifications_select_own"          ON notifications;
-- DROP POLICY IF EXISTS "notifications_insert_authenticated" ON notifications;
-- DROP POLICY IF EXISTS "notifications_update_own"          ON notifications;

-- Stock RPCs were not modified by this file (left SECURITY INVOKER) —
-- nothing to roll back there.
