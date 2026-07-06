-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 0: auth identity bridge
-- Run this in Supabase SQL Editor
-- No RLS is enabled here. This only adds/backfills columns —
-- zero behavior change for the running app.
-- ══════════════════════════════════════════════════

-- 1a. users.auth_id — bridges public.users to auth.users (auth.uid()).
--     Nullable: phone-OTP customers never get a Supabase Auth session
--     (that verification happens entirely through Firebase), so their
--     rows have nothing to bridge to and will legitimately stay NULL.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id UUID;

-- 1b. Backfill — match on email (the only reliable join key for the
--     Google/magic-link segment; phone-only rows have no auth.users
--     counterpart at all and are correctly skipped by this WHERE).
UPDATE public.users u
SET auth_id = au.id
FROM auth.users au
WHERE u.email IS NOT NULL
  AND au.email IS NOT NULL
  AND lower(u.email) = lower(au.email)
  AND u.auth_id IS NULL;

-- 1c. sellers.user_id backfill — mirrors the app's own lookup order in
--     getCurrentSeller() (auth.js): phone first, then email fallback.
--     Two passes so phone-match takes priority where both would match.
UPDATE public.sellers s
SET user_id = u.id
FROM public.users u
WHERE s.user_id IS NULL
  AND s.phone IS NOT NULL
  AND u.phone IS NOT NULL
  AND s.phone = u.phone;

UPDATE public.sellers s
SET user_id = u.id
FROM public.users u
WHERE s.user_id IS NULL
  AND s.email IS NOT NULL
  AND u.email IS NOT NULL
  AND lower(s.email) = lower(u.email);

-- ================================================================
-- VERIFY — run after the migration to see how much actually bridged.
-- Both are expected to have a non-trivial NULL count: phone-OTP
-- customers (no auth.users row to bridge) and any seller who has
-- never logged in yet (no users row to link to) are supposed to stay
-- NULL — that's not a failure, it's exactly what Phase 0 promised.
-- ================================================================

SELECT
  count(*) FILTER (WHERE auth_id IS NOT NULL) AS auth_id_filled,
  count(*) FILTER (WHERE auth_id IS NULL)     AS auth_id_null,
  count(*)                                    AS total_users
FROM public.users;

SELECT
  count(*) FILTER (WHERE user_id IS NOT NULL) AS user_id_filled,
  count(*) FILTER (WHERE user_id IS NULL)     AS user_id_null,
  count(*)                                    AS total_sellers
FROM public.sellers;
