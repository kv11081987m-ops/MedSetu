-- ══════════════════════════════════════════════════════════════
-- MedSetu — Fix users table for email magic link login
-- Run this ONCE in Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Make phone column nullable (email-only users don't have phone)
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- 2. Make email column indexed for faster lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 3. Confirm
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('phone', 'email');
