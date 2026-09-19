-- ══════════════════════════════════════════════════
-- MedSetu — fix: deduct_stock / release_stock directly callable by anyone
-- ══════════════════════════════════════════════════
--
-- Bug (found via full code audit, 2026-09-19): deduct_stock and
-- release_stock are internal helpers — called from confirm_order_with_reserve
-- (on reservation failure) and mark_order_delivered (on delivery) — but
-- Postgres grants EXECUTE to PUBLIC by default on function creation, and
-- neither function ever had that revoked. Both take p_seller_id directly
-- as a parameter with zero ownership check in their body, so anyone with
-- the public anon key could call them via /rest/v1/rpc/deduct_stock (or
-- release_stock) to corrupt any seller's stock_quantity / reserved_quantity
-- / is_available, no login required.
--
-- Fix: REVOKE EXECUTE from PUBLIC, anon, authenticated. Confirmed exact
-- signatures via pg_proc first (both: uuid, uuid, integer).
--
-- Why internal callers keep working: deduct_stock/release_stock, and the
-- SECURITY DEFINER functions that call them (confirm_order_with_reserve,
-- mark_order_delivered), are ALL owned by the `postgres` role (verified via
-- pg_proc.proowner). A SECURITY DEFINER function executes with its OWNER's
-- privileges for the duration of the call, and an object's owner always
-- retains implicit EXECUTE on objects it owns regardless of REVOKE (unless
-- revoked from the owner role itself, which this migration does not do).
-- So confirm_order_with_reserve/mark_order_delivered calling deduct_stock/
-- release_stock internally is unaffected; only direct external RPC calls
-- (as anon/authenticated) are blocked.

SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc WHERE proname IN ('deduct_stock','release_stock');
-- confirmed: deduct_stock(uuid, uuid, integer), release_stock(uuid, uuid, integer)

REVOKE EXECUTE ON FUNCTION deduct_stock(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION release_stock(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- SELECT proname,
--   has_function_privilege('anon', oid, 'EXECUTE')          AS anon_can,
--   has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_can,
--   has_function_privilege('postgres', oid, 'EXECUTE')      AS postgres_can
-- FROM pg_proc WHERE proname IN ('deduct_stock','release_stock');
--   -- expect: anon_can=f, auth_can=f, postgres_can=t (owner)
--
-- Direct-role tests (not the interactive superuser session, which
-- bypasses nothing here since postgres itself is NOT a superuser in this
-- Supabase setup — confirmed via `SELECT rolsuper FROM pg_roles WHERE
-- rolname='postgres'` = false; postgres passes only because it OWNS
-- these functions):
--
-- 1) postgres (== the owner role that confirm_order_with_reserve /
--    mark_order_delivered run as via SECURITY DEFINER) -- should still work:
--   BEGIN;
--   SELECT deduct_stock('<seller_id>'::uuid, '<medicine_id>'::uuid, 0);
--   -- expect: succeeds (returns true/null row, no permission error)
--   ROLLBACK;
--
-- 2) anon -- should now be blocked:
--   BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT deduct_stock('<seller_id>'::uuid, '<medicine_id>'::uuid, 0);
--   -- expect: ERROR - permission denied for function deduct_stock
--   ROLLBACK;
--
-- 3) authenticated -- should now be blocked:
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT release_stock('<seller_id>'::uuid, '<medicine_id>'::uuid, 0);
--   -- expect: ERROR - permission denied for function release_stock
--   ROLLBACK;
--
-- 4) End-to-end sanity (whenever a live order is available): run
--    confirm_order_with_reserve / mark_order_delivered as the real
--    authorized user (pharmacist / owning seller) and confirm they still
--    succeed — proves the internal call chain survives the revoke.

-- ================================================================
-- ROLLBACK — reintroduces the vulnerability, not recommended
-- ================================================================
-- GRANT EXECUTE ON FUNCTION deduct_stock(uuid, uuid, integer) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION release_stock(uuid, uuid, integer) TO PUBLIC;
