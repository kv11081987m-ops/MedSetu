-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator + Deployed-Staff, Chunk 1: schema foundation
-- Run this in Supabase SQL Editor. DB me abhi RUN nahi hua — review ke
-- baad chalana.
--
-- Scope: SIRF schema (columns/tables/RLS helpers/policies). Koi UI ya
-- order-flow logic yahan nahi — checkout/routing/SellerDashboard wiring
-- baad ke chunks me, ek-ek karke.
--
-- Concept recap (design discussion se):
--   - Aggregator = ek seller row (sellers.seller_type abhi bhi 'retailer'
--     ya 'wholesaler' hoga, is_aggregator sirf ek extra flag hai us par)
--     jo khud stock nahi rakhta — ek ya zyada wholesaler se maal pack
--     karwa ke customer ko apne naam par bechta hai (jaise Sarthak Medical).
--   - aggregator_wholesalers: kaunsa aggregator kaunse wholesaler(s) se
--     sourced hai — many-to-many.
--   - seller_staff: aggregator ka deployed staff — jo kisi wholesaler ke
--     godown par baith ke uska order pick/pack/claim karta hai. Google
--     login email se identify hota hai (StaffLogin.jsx jaisa role-login,
--     par yeh ek naya role nahi — seller_staff independent identity hai).
--   - orders.claimed_by/claimed_at/sourced_from_wholesaler_id — kis staff
--     ne order pick kiya aur asal maal kis wholesaler se aaya (internal
--     bookkeeping — customer ko wholesaler ka naam kabhi nahi dikhta).
--
-- Depends on (sab already applied, in-repo grepped before writing this):
--   • 001_schema.sql              — sellers, orders base tables
--   • 003_masterMedicine.sql      — seller_inventory
--   • 011_rlsPhase2.sql / 012_rlsPhase3.sql — is_active_superadmin()
--   • 014_rlsPhase5a.sql          — is_approved_pharmacist() (helper
--                                   shape this file's is_seller_staff()
--                                   copies exactly), protect_seller_trust_
--                                   columns() trigger (see NOTE below)
--   • 025_routingFoundation.sql / 028_rejectReassignChain.sql — orders
--     routing columns (routing_status etc.) — untouched by this file.
--
-- NOTE — is_aggregator NOT YET trigger-protected: sellers already has a
--   BEFORE UPDATE trigger (protect_seller_trust_columns, 014:172-194)
--   that reverts is_verified/rejection_reason/rating/commission_mode/
--   commission_flat_rate back to OLD when the caller is neither
--   is_active_superadmin() nor is_approved_admin(). is_aggregator is
--   NOT in that list, and sellers_update_owner_or_staff (014:133) lets
--   the owning seller UPDATE their own row at the row level — so today,
--   a seller could self-flip is_aggregator via a normal profile-update
--   call, same as it could always flip e.g. store_name. Closing that
--   (adding is_aggregator to the trigger's protected list) means editing
--   existing security-critical trigger code, which is out of scope for
--   this schema-only chunk — flagging it here so it's a deliberate
--   decision for the next chunk, not a silent gap.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 1. sellers.is_aggregator
-- ================================================================
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS is_aggregator BOOLEAN DEFAULT false;

COMMENT ON COLUMN sellers.is_aggregator IS
  'Sirf super-admin set kare (see this file''s header NOTE — not yet trigger-enforced). true = aggregator: wholesaler stock apne naam par bechne wali company (jaise Sarthak Medical), normal stock-holding retailer/wholesaler nahi.';


-- ================================================================
-- 2. aggregator_wholesalers — aggregator <-> wholesaler sourcing links
-- ================================================================
CREATE TABLE IF NOT EXISTS aggregator_wholesalers (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  aggregator_seller_id  UUID        NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  wholesaler_seller_id  UUID        NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (aggregator_seller_id, wholesaler_seller_id)
);

COMMENT ON TABLE aggregator_wholesalers IS
  'Kaunsa aggregator seller kaunse wholesaler seller(s) se maal pack karwata hai — many-to-many. is_active=false = link suspend (row delete kiye bina history rakhne ke liye).';

CREATE INDEX IF NOT EXISTS idx_aggregator_wholesalers_aggregator ON aggregator_wholesalers(aggregator_seller_id);
CREATE INDEX IF NOT EXISTS idx_aggregator_wholesalers_wholesaler ON aggregator_wholesalers(wholesaler_seller_id);


-- ================================================================
-- 3. seller_staff — aggregator ka deployed staff
-- ================================================================
CREATE TABLE IF NOT EXISTS seller_staff (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  aggregator_seller_id    UUID        NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  email                   TEXT        NOT NULL UNIQUE,
  name                    TEXT,
  deployed_wholesaler_id  UUID        REFERENCES sellers(id) ON DELETE SET NULL,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  created_by              UUID        REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE seller_staff IS
  'Aggregator seller ka deployed staff — kisi wholesaler ke godown par baith ke uske orders pick/claim karta hai. email = staff ka Google login email, is_seller_staff() isi se match karta hai. Ek email = ek hi staff (UNIQUE) — StaffLogin.jsx jaisa role-login flow nahi, independent identity hai.';

CREATE INDEX IF NOT EXISTS idx_seller_staff_aggregator          ON seller_staff(aggregator_seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_staff_deployed_wholesaler ON seller_staff(deployed_wholesaler_id);


-- ================================================================
-- 4. orders — claim + sourcing columns
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES seller_staff(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sourced_from_wholesaler_id UUID REFERENCES sellers(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.claimed_by IS
  'Kis seller_staff ne is order ko pick/claim kiya. NULL = abhi kisi ne claim nahi kiya (ya non-aggregator order, jahan yeh column kabhi use hi nahi hoga).';
COMMENT ON COLUMN orders.claimed_at IS
  'claimed_by set hone ka timestamp.';
COMMENT ON COLUMN orders.sourced_from_wholesaler_id IS
  'Internal bookkeeping — is order ka maal asal me kis wholesaler seller se aaya. Customer-facing kahin nahi dikhta (checkout/order-tracking UI isse kabhi read nahi karti).';

CREATE INDEX IF NOT EXISTS idx_orders_claimed_by         ON orders(claimed_by);
CREATE INDEX IF NOT EXISTS idx_orders_sourced_wholesaler  ON orders(sourced_from_wholesaler_id);


-- ================================================================
-- 5. RLS helpers — is_approved_pharmacist() (014_rlsPhase5a.sql:33-40)
--    ke SAME shape.
-- ================================================================
CREATE OR REPLACE FUNCTION is_seller_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM seller_staff
    WHERE email = auth.email() AND is_active = true
  );
$$;

-- Optional helper — checks the calling staff belongs to one specific
-- aggregator (future per-aggregator RLS/RPC scoping will want this).
CREATE OR REPLACE FUNCTION is_active_seller_staff_of(p_aggregator UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM seller_staff
    WHERE email = auth.email()
      AND is_active = true
      AND aggregator_seller_id = p_aggregator
  );
$$;


-- ================================================================
-- 6. RLS — aggregator_wholesalers / seller_staff
-- ================================================================
-- Abhi ke liye: dono table par manage (SELECT/INSERT/UPDATE/DELETE)
-- sirf super-admin. Aggregator-seller ko khud manage karne dena (apne
-- wholesaler links / apna staff add karna) baad ke chunk me — abhi
-- sirf is_active_superadmin() ka gate, is_approved_admin() bhi nahi
-- (jaanbujh ke tighter rakha hai, request ke mutaabik).
ALTER TABLE aggregator_wholesalers ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_staff           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aggregator_wholesalers_manage_superadmin" ON aggregator_wholesalers;
DROP POLICY IF EXISTS "seller_staff_manage_superadmin"           ON seller_staff;
DROP POLICY IF EXISTS "seller_staff_select_own"                  ON seller_staff;

CREATE POLICY "aggregator_wholesalers_manage_superadmin"
  ON aggregator_wholesalers FOR ALL
  USING (is_active_superadmin())
  WITH CHECK (is_active_superadmin());

CREATE POLICY "seller_staff_manage_superadmin"
  ON seller_staff FOR ALL
  USING (is_active_superadmin())
  WITH CHECK (is_active_superadmin());

-- Staff apni khud ki row dekh sake (StaffLogin/whatever screen baad me
-- "aap kaun ho, kis aggregator/wholesaler ke liye" dikhaane ke liye) —
-- yeh permissive policy super-admin wali FOR ALL policy ke saath OR
-- hoti hai, usse replace nahi karti.
CREATE POLICY "seller_staff_select_own"
  ON seller_staff FOR SELECT
  USING (email = auth.email());


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Columns lag gaye:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'sellers' AND column_name = 'is_aggregator';
--   -- expect boolean, default false
--
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN ('claimed_by', 'claimed_at', 'sourced_from_wholesaler_id');
--   -- expect all 3 present

-- Tables ban gaye + shape sahi:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'aggregator_wholesalers' ORDER BY ordinal_position;
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'seller_staff' ORDER BY ordinal_position;

-- UNIQUE constraints kaam kar rahe:
--   -- same (aggregator, wholesaler) pair dobara insert -> unique violation:
--   INSERT INTO aggregator_wholesalers (aggregator_seller_id, wholesaler_seller_id)
--     VALUES ('<agg-id>', '<who-id>');
--   INSERT INTO aggregator_wholesalers (aggregator_seller_id, wholesaler_seller_id)
--     VALUES ('<agg-id>', '<who-id>');  -- expect error: duplicate key
--
--   -- same email dobara seller_staff insert -> unique violation:
--   INSERT INTO seller_staff (aggregator_seller_id, email) VALUES ('<agg-id>', 'x@y.com');
--   INSERT INTO seller_staff (aggregator_seller_id, email) VALUES ('<agg-id2>', 'x@y.com');  -- expect error

-- RLS enabled + policies present:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('aggregator_wholesalers', 'seller_staff');
--   -- expect relrowsecurity = true dono par
--
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('aggregator_wholesalers', 'seller_staff');
--   -- expect: aggregator_wholesalers_manage_superadmin (ALL),
--   --         seller_staff_manage_superadmin (ALL),
--   --         seller_staff_select_own (SELECT)

-- Functions ban gaye:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('is_seller_staff', 'is_active_seller_staff_of');
--   -- prosecdef = true dono par

-- Real-session checks (ek test aggregator seller + wholesaler + staff row banake):
--   1. Non-superadmin session se aggregator_wholesalers/seller_staff par INSERT/UPDATE ->
--      RLS denies (0 rows affected / permission error).
--   2. SuperAdmin session se same INSERT/UPDATE -> works.
--   3. Staff ka apna Google-login session: SELECT * FROM seller_staff -> sirf apni
--      (email = apna email) row dikhti hai, doosre staff ki nahi.
--   4. SELECT is_seller_staff() us staff ke session se -> true (is_active=true hone par).
--      is_active=false karke dobara -> false.
--   5. SELECT is_active_seller_staff_of('<uska apna aggregator_seller_id>') -> true;
--      kisi doosre aggregator ka id de ke -> false.
--   6. Pre-existing orders/sellers rows par koi effect nahi — sab naye columns NULL/false default.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP POLICY IF EXISTS "aggregator_wholesalers_manage_superadmin" ON aggregator_wholesalers;
-- DROP POLICY IF EXISTS "seller_staff_manage_superadmin"           ON seller_staff;
-- DROP POLICY IF EXISTS "seller_staff_select_own"                  ON seller_staff;
--
-- -- orders ke FK columns pehle hatao (seller_staff/sellers table drop se pehle):
-- ALTER TABLE orders DROP COLUMN IF EXISTS claimed_by;
-- ALTER TABLE orders DROP COLUMN IF EXISTS claimed_at;
-- ALTER TABLE orders DROP COLUMN IF EXISTS sourced_from_wholesaler_id;
--
-- DROP FUNCTION IF EXISTS is_active_seller_staff_of(UUID);
-- DROP FUNCTION IF EXISTS is_seller_staff();
--
-- DROP TABLE IF EXISTS seller_staff;
-- DROP TABLE IF EXISTS aggregator_wholesalers;
--
-- ALTER TABLE sellers DROP COLUMN IF EXISTS is_aggregator;
-- ================================================================
