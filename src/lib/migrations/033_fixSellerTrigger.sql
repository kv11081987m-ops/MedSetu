-- ══════════════════════════════════════════════════
-- MedSetu — BUG-SELLERTRIG fix: protect_seller_trust_columns()
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Bug: protect_seller_trust_columns() (014_rlsPhase5a.sql:172-189)
-- references NEW.rejection_reason / OLD.rejection_reason, but `sellers`
-- has no rejection_reason column (that field only exists on
-- seller_registrations and staff_whitelist, 002_superadmin.sql:33/76 —
-- the trigger's column set was modeled on that review-workflow shape
-- without checking `sellers` actually carries all three fields).
-- BEFORE UPDATE ON sellers fires on EVERY update to any sellers row, so
-- this breaks any UPDATE that reaches this trigger — seller profile
-- edits, is_open toggle, routing_weight changes, plain SQL-editor
-- updates. Admin/superadmin calls happened to still hit the same
-- broken line (NEW.rejection_reason is assigned regardless of the
-- is_verified/rating branch's guard result) — so this was never truly
-- "admin-context skip", every UPDATE path was equally broken; it just
-- hadn't been exercised outside admin flows until now.
--
-- Fix: CREATE OR REPLACE the function body, identical to 014's version,
-- with exactly one line removed:
--     NEW.rejection_reason := OLD.rejection_reason;
-- No other line touched. is_verified/rating stay admin-or-superadmin
-- guarded; commission_mode/commission_flat_rate stay
-- superadmin-or-delegated-admin guarded — same as 014, unchanged.
--
-- Depends on: 014_rlsPhase5a.sql (is_active_superadmin(),
-- is_approved_admin(), is_superadmin_or_delegated_admin(),
-- trg_protect_seller_trust_columns already bound to sellers).

-- ================================================================
-- protect_seller_trust_columns() — rejection_reason line removed
-- ================================================================
CREATE OR REPLACE FUNCTION protect_seller_trust_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_active_superadmin() OR is_approved_admin()) THEN
    NEW.is_verified      := OLD.is_verified;
    NEW.rating           := OLD.rating;
  END IF;

  IF NOT is_superadmin_or_delegated_admin() THEN
    NEW.commission_mode      := OLD.commission_mode;
    NEW.commission_flat_rate := OLD.commission_flat_rate;
  END IF;

  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE FUNCTION replaces the body in place — the existing
-- trg_protect_seller_trust_columns trigger (014) keeps pointing at this
-- function by name, no rebind needed. Re-binding anyway, belt-and-braces,
-- same DROP+CREATE shape 014 used:
DROP TRIGGER IF EXISTS trg_protect_seller_trust_columns ON sellers;
CREATE TRIGGER trg_protect_seller_trust_columns
BEFORE UPDATE ON sellers
FOR EACH ROW EXECUTE FUNCTION protect_seller_trust_columns();

-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Function body no longer references rejection_reason:
-- SELECT prosrc FROM pg_proc WHERE proname = 'protect_seller_trust_columns';

-- Plain UPDATE on sellers no longer errors (run as a non-admin session,
-- or via SQL Editor as postgres — both previously hit the bug):
--   UPDATE sellers SET updated_at = NOW() WHERE id = '<any seller id>';
--   -> succeeds, no "record new has no field rejection_reason" error.

-- Guards still intact:
--   1. Non-admin tries to set is_verified/rating directly -> reverted to
--      OLD value (silently, same as before — this trigger doesn't
--      raise, it just discards the attempted change).
--   2. Admin/superadmin sets is_verified/rating -> takes effect.
--   3. Non-superadmin/non-delegated-admin tries commission_mode /
--      commission_flat_rate -> reverted to OLD value.
--   4. Superadmin or delegated admin sets commission_mode /
--      commission_flat_rate -> takes effect.

-- ================================================================
-- ROLLBACK — restores 014's original (broken) version, with
-- rejection_reason back in, if ever needed
-- ================================================================

-- CREATE OR REPLACE FUNCTION protect_seller_trust_columns()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF NOT (is_active_superadmin() OR is_approved_admin()) THEN
--     NEW.is_verified      := OLD.is_verified;
--     NEW.rejection_reason := OLD.rejection_reason;
--     NEW.rating           := OLD.rating;
--   END IF;
--
--   IF NOT is_superadmin_or_delegated_admin() THEN
--     NEW.commission_mode      := OLD.commission_mode;
--     NEW.commission_flat_rate := OLD.commission_flat_rate;
--   END IF;
--
--   RETURN NEW;
-- END;
-- $$;
--
-- DROP TRIGGER IF EXISTS trg_protect_seller_trust_columns ON sellers;
-- CREATE TRIGGER trg_protect_seller_trust_columns
-- BEFORE UPDATE ON sellers
-- FOR EACH ROW EXECUTE FUNCTION protect_seller_trust_columns();
