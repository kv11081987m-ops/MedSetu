-- ══════════════════════════════════════════════════
-- MedSetu — Migration 038: set_default_address RPC + one-default safeguard
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- "Ek hi default address" abhi sirf convention hai — addAddress()'s
-- insert-time `is_default: addresses.length === 0` only guarantees the
-- FIRST address a customer ever adds becomes default; nothing has ever
-- enforced "at most one" at the DB level, and nothing existed to change
-- the default afterwards. This migration adds both pieces:
--   1. A cleanup pass + partial UNIQUE index that makes "at most one
--      default per user" a real DB guarantee, not just a convention.
--   2. set_default_address(p_address_id) — the atomic RPC the client
--      will call in A3+ to actually change which address is default.
--
-- Checked live before writing this: zero users currently have more than
-- one default, and zero users with addresses have none marked default.
-- The cleanup step below is a no-op today — it's included as a safety
-- net so this migration stays safe to run regardless of when it's
-- actually applied, not because it's fixing a problem that exists right
-- now.

-- ================================================================
-- 1. Cleanup — collapse any user with multiple is_default=true rows
--    down to just their most-recently-created one. Required for the
--    unique index below to succeed if this ever runs against data
--    where duplicates exist (none exist as of this writing).
-- ================================================================
WITH ranked AS (
  SELECT id, user_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM addresses
  WHERE is_default = true
)
UPDATE addresses
SET is_default = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);


-- ================================================================
-- 2. Partial UNIQUE index — DB-level guarantee of at most one default
--    address per user. This is also what keeps set_default_address
--    below fully safe under concurrency: even if two calls raced for
--    the same user, only one of the two UPDATEs that sets is_default =
--    true could ever commit — the other would fail on this index
--    rather than silently leaving two defaults.
-- ================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_address
  ON addresses(user_id) WHERE is_default = true;


-- ================================================================
-- 3. set_default_address(p_address_id) — same SECURITY DEFINER +
--    ownership-check-inside shape as mark_order_delivered/cancel_order,
--    return-shape (success/message JSONB) matches assign_order_to_seller
--    (029_adminAssignOrder.sql). Both UPDATEs run inside this function's
--    own transaction — they commit together or not at all, so there's
--    no window where the target user has zero default addresses.
-- ================================================================
CREATE OR REPLACE FUNCTION set_default_address(p_address_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_address addresses%ROWTYPE;
BEGIN
  SELECT * INTO v_address FROM addresses WHERE id = p_address_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Address nahi mila');
  END IF;

  -- Ownership check — same auth_id/email match every other RLS-backed
  -- RPC in this codebase uses (mark_order_delivered, cancel_order,
  -- assign_order_to_seller) — the address must belong to the calling
  -- session's own users row.
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = v_address.user_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh address aapka nahi hai');
  END IF;

  UPDATE addresses SET is_default = false WHERE user_id = v_address.user_id AND is_default = true;
  UPDATE addresses SET is_default = true  WHERE id = p_address_id;

  RETURN jsonb_build_object('success', true, 'address_id', p_address_id);
END;
$$;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'addresses' AND indexname = 'idx_one_default_address';
--   -- expect a UNIQUE index on (user_id) with a WHERE (is_default = true) predicate

-- SELECT user_id, count(*) FROM addresses WHERE is_default = true GROUP BY user_id HAVING count(*) > 1;
--   -- expect zero rows (impossible now that the index exists)

-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'set_default_address';
--   -- prosecdef should be true (SECURITY DEFINER)

-- Real-session checks:
--   1. Logged-in customer calls set_default_address on one of their OWN
--      addresses -> {success:true, address_id}, that address is now the
--      only is_default=true row for that user, the previous default (if
--      any) is now false.
--   2. Same customer calls it on an address that doesn't exist ->
--      {success:false, message:'Address nahi mila'}.
--   3. Customer A calls it on customer B's address_id -> {success:false,
--      message:'Yeh address aapka nahi hai'} — B's addresses untouched.
--   4. A customer with zero addresses, or calling with a garbage UUID ->
--      same "Address nahi mila" path, no crash.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS set_default_address(UUID);
-- DROP INDEX IF EXISTS idx_one_default_address;
-- -- Note: the cleanup UPDATE (step 1) is not reversible — it only ever
-- -- unsets is_default on rows that were already a duplicate, so there is
-- -- nothing meaningful to restore.
