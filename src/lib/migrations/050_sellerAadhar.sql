-- ══════════════════════════════════════════════════
-- MedSetu — sellers.aadhar_number (Phase 1: seller self-edit, text-only)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- seller_registrations.aadhar_number already exists (002_superadmin.sql,
-- collected at signup via SellerRegister.jsx) but approveSeller()
-- (SuperAdminPanel.jsx) never copies it into sellers on approval — the
-- live `sellers` table has no aadhar_number column at all. This adds it
-- so a seller can set/correct it post-approval from their own dashboard
-- (EditStoreModal, SellerDashboard.jsx).
--
-- Nullable, no default needed beyond NULL — every existing seller row
-- simply starts unset. ADD COLUMN IF NOT EXISTS, so re-running this file
-- is a no-op the second time.

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS aadhar_number VARCHAR(12);


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, character_maximum_length, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'sellers' AND column_name = 'aadhar_number';
--   -- expect: character varying, 12, YES

-- Every existing seller must be untouched:
--   SELECT count(*) FROM sellers WHERE aadhar_number IS NOT NULL;
--   -- expect 0 immediately after migration


-- ================================================================
-- ROLLBACK
-- ================================================================

-- ALTER TABLE sellers DROP COLUMN IF EXISTS aadhar_number;
