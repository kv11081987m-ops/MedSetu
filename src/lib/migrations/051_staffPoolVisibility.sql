-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator, Chunk 4a: staff helper + pool visibility (SELECT only)
-- Run this in Supabase SQL Editor. DB me abhi RUN nahi hua — review ke
-- baad chalana.
--
-- Scope: SIRF do cheez — staff ko apne wholesaler ke aggregator-source
-- orders DEKHNE dena. Koi UPDATE/claim/status/stock is chunk me nahi
-- (chunk 4b/4c) — staff order dekh sakega, badal nahi sakega. orders
-- UPDATE RLS (orders_update_involved_or_staff) aur
-- protect_order_sensitive_columns() trigger dono jaanbujh ke untouched.
--
-- Ismein:
--   1. current_staff_aggregator_id() / current_staff_wholesaler_id() —
--      calling staff (email = auth.email(), is_active=true) ki apni
--      seller_staff row se aggregator_seller_id/deployed_wholesaler_id.
--      Do alag chhote SQL helpers (ek row ke do fields) taaki RLS me
--      inline subquery se cleaner rahe — is_active_seller_staff_of()
--      (047_aggregatorStaff.sql) jaisा hi shape.
--   2. orders_select_involved_or_staff (015_rlsPhase5b.sql:39-48) me 6th
--      branch — staff apne deployed wholesaler ke sourced orders dekh
--      sake. Baaki 5 branches (customer/seller/buyer/superadmin/admin/
--      pharmacist) HU-BA-HU, ek bhi badla nahi.
--
-- Depends on (sab already applied/prior chunks, is file se PEHLE run
-- karna zaroori):
--   • 015_rlsPhase5b.sql       — orders_select_involved_or_staff (jiska
--                                 body replace ho raha, 5 purane branches
--                                 se), is_active_superadmin()/
--                                 is_approved_admin()/is_approved_pharmacist()
--   • 047_aggregatorStaff.sql  — seller_staff table, is_seller_staff(),
--                                 orders.sourced_from_wholesaler_id
--
-- NOTE — pool vs claimed: yeh RLS branch sirf "sourced_from_wholesaler_id
-- = tera wholesaler" gate karta hai — ek staff ko apne wholesaler ke SAARE
-- source-orders (claimed ho ya na ho) dikhte hain. "Sirf unclaimed dikhao"
-- ya "sirf apne claim dikhao" — yeh UI-side query filter (claimed_by IS
-- NULL / claimed_by = <apna id>) ka kaam hai, RLS ka nahi (request me
-- explicitly yahi kaha gaya hai). claimed_by column khud abhi kisi bhi RLS
-- branch me reference nahi hota — 4b/4c me claim-RPC likhte waqt zaroorat
-- padegi.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 1. Staff identity helpers
-- ================================================================
CREATE OR REPLACE FUNCTION current_staff_aggregator_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT aggregator_seller_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_staff_wholesaler_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT deployed_wholesaler_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true
  LIMIT 1;
$$;


-- ================================================================
-- 2. orders_select_involved_or_staff — 6th branch (staff pool visibility)
-- ================================================================
DROP POLICY IF EXISTS "orders_select_involved_or_staff" ON orders;

CREATE POLICY "orders_select_involved_or_staff"
  ON orders FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = orders.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.buyer_id  AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR is_active_superadmin()
    OR is_approved_admin()
    OR is_approved_pharmacist()
    -- NAYA (051): aggregator ka deployed staff — sirf apne deployed
    -- wholesaler ke naam sourced orders (claimed ya unclaimed dono;
    -- pool/claimed split UI-query ka kaam, yahan nahi).
    OR (
      is_seller_staff()
      AND orders.sourced_from_wholesaler_id = current_staff_wholesaler_id()
    )
  );


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Functions ban gaye + SECURITY DEFINER:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('current_staff_aggregator_id', 'current_staff_wholesaler_id');

-- Policy me exactly 6 branches (ek hi USING clause, expression se count
-- nahi hota seedha SQL se — neeche wala manual check hai):
--   SELECT policyname, cmd, qual FROM pg_policies
--   WHERE tablename = 'orders' AND policyname = 'orders_select_involved_or_staff';
--   -- qual me 6 "OR" segments dikhne chahiye (5 purane + naya staff wala)

-- Setup (real IDs se replace karke):
--   0. Aggregator AGG, wholesaler W1 aur W2 (dono AGG se mapped),
--      staff ST1 (seller_staff: aggregator_seller_id=AGG,
--      deployed_wholesaler_id=W1, email=<ST1 ka Google login email>,
--      is_active=true).
--   1. Order O1: seller_id=AGG, sourced_from_wholesaler_id=W1 (050 se ya
--      manually UPDATE karke).
--   2. Order O2: seller_id=AGG, sourced_from_wholesaler_id=W2.
--   3. Order O3: kisi normal retailer seller ka (non-aggregator), koi
--      sourced_from_wholesaler_id nahi (NULL).

-- ST1 ke Google-login session se:
--   SELECT id FROM orders WHERE id IN ('<O1-id>', '<O2-id>', '<O3-id>');
--   -- expect: sirf O1 (apna wholesaler W1) — O2 (W2, doosra wholesaler)
--   -- aur O3 (non-aggregator, sourced_from_wholesaler_id NULL) DONO NAHI.

-- ST1 ki is_active ko false karo, dobara same query:
--   -- expect: O1 bhi ab NAHI dikhta (is_seller_staff() false ho gaya).

-- Regression — baaki 5 branch bilkul waisa:
--   1. O1/O2 ka customer apna session se apna order dekh sake (customer branch).
--   2. AGG (aggregator seller khud, apna login) O1/O2 dono dekh sake
--      (seller branch — seller_id=AGG match, staff branch se independent).
--   3. Superadmin/approved-admin/approved-pharmacist session — sab orders
--      dikhte rahein, koi change nahi.
--   4. B2B buyer_id wala order — us buyer ko dikhta rahe.
--   5. Ek non-staff authenticated user (customer/seller jo O1/O2 se
--      unrelated hai) — O1/O2 dono NAHI dikhne chahiye (naya branch sirf
--      is_seller_staff()=true walon ke liye hai).

-- UPDATE abhi bhi staff ko allow nahi karta (yeh chunk ka scope hi nahi):
--   ST1 session se: UPDATE orders SET status='confirmed' WHERE id='<O1-id>';
--   -- expect: 0 rows affected (orders_update_involved_or_staff me staff
--   -- branch nahi hai — RLS row hi match nahi karegi is UPDATE ke liye).


-- ================================================================
-- ROLLBACK — 015_rlsPhase5b.sql wale 5-branch policy par wapas
-- ================================================================

-- DROP FUNCTION IF EXISTS current_staff_aggregator_id();
-- DROP FUNCTION IF EXISTS current_staff_wholesaler_id();
--
-- DROP POLICY IF EXISTS "orders_select_involved_or_staff" ON orders;
-- CREATE POLICY "orders_select_involved_or_staff"
--   ON orders FOR SELECT
--   USING (
--     EXISTS (SELECT 1 FROM users u WHERE u.id = orders.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
--     OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
--     OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.buyer_id  AND (u.auth_id = auth.uid() OR u.email = auth.email()))
--     OR is_active_superadmin()
--     OR is_approved_admin()
--     OR is_approved_pharmacist()
--   );
-- ================================================================
