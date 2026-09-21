-- ══════════════════════════════════════════════════
-- MedSetu — drop stale 4-param request_return overload
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- 071_returnBankDetails.sql added a 5th parameter
-- (p_refund_payment_details) to request_return via CREATE OR REPLACE
-- FUNCTION. Postgres only replaces a function with the exact same
-- signature — a changed parameter list creates a NEW overload instead of
-- replacing the old one, so the original 4-param version
-- (047_returnRefund.sql) was left behind alongside the new 5-param one.
-- Two live overloads means a caller (or a stale PostgREST schema cache)
-- could resolve to either, and any future fix to the 5-param body would
-- silently NOT apply to the 4-param one. This drops the stale overload so
-- exactly one request_return exists again.


DROP FUNCTION IF EXISTS request_return(uuid, text, text, text);


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc WHERE proname = 'request_return';
--   -- expect exactly ONE row: p_order_id uuid, p_reason text,
--   -- p_reason_detail text, p_photo_url text, p_refund_payment_details text


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Not meaningful to roll back on its own — re-creating the 4-param
-- overload would just reintroduce the duplicate-overload bug this fixes.
-- If 071's request_return itself needs rolling back, see 071's own
-- ROLLBACK section instead.
