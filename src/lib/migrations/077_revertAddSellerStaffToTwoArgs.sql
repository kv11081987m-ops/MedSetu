-- ══════════════════════════════════════════════════
-- MedSetu — add_seller_staff: revert to 2-arg (drop wholesaler routing)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Decision: wholesaler-routing (075_aggregatorWholesalerDeploy.sql's
-- p_deployed_wholesaler_id param + its aggregator_wholesalers mapping
-- check inside add_seller_staff) is being pulled back out of the normal
-- add/remove/accept/pack/handover staff flow. Piyush ji and Hasnain ji
-- go back to being plain seller_staff — no wholesaler-specific gating.
--
-- What THIS file does to add_seller_staff, and nothing else:
--   1. Drops the 3-arg overload (text, text, uuid) from 075/076.
--   2. Re-creates the 2-arg (text, text) signature — every call site
--      already passes exactly 2 args once SellerDashboard.jsx's own
--      change (same commit) drops the 3rd.
--   3. Removes the "p_deployed_wholesaler_id must be one of this
--      seller's active aggregator_wholesalers mappings" IF block —
--      there's no 3rd param left to validate.
--   4. staff_assignment insert drops the deployed_wholesaler_id column
--      from its VALUES list — the column itself is untouched (still
--      exists, stays NULL going forward for staff added via this RPC).
--
-- Left completely alone, on purpose:
--   - staff_code generation (MAX(numeric suffix)+1, gap-safe) and the
--     GET STACKED DIAGNOSTICS unique_violation → real-constraint-name
--     collision handling, both from 076_fixAddSellerStaffCollisions.sql
--     — copied byte-for-byte into the body below.
--   - set_staff_deployment(uuid, uuid) — left live/dormant in the DB.
--     Nothing calls it anymore after this change (the Deploy button/
--     dropdown is removed from SellerDashboard.jsx in the same commit),
--     but dropping a function wasn't asked for and it's harmless unused.
--   - staff_assignment.deployed_wholesaler_id column, aggregator_wholesalers
--     table, sellers.is_aggregator, sync_aggregator_inventory — NOT
--     touched by this file at all.

-- ================================================================
-- 1. add_seller_staff — back to (p_name, p_email), gap-safe code kept
-- ================================================================
-- Dropped and re-created (not CREATE OR REPLACE) because removing a
-- parameter changes the function's identity — REPLACE alone can't turn
-- a 3-arg function into a 2-arg one; it would just leave both overloads
-- live. Drop the 3-arg one first so only the 2-arg signature remains.
DROP FUNCTION IF EXISTS add_seller_staff(text, text, uuid);

CREATE FUNCTION add_seller_staff(
  p_name text, p_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
  v_staff_id uuid;
  v_staff_code text;
  v_constraint text;
BEGIN
  -- LEFT JOIN + sellers.email fallback (not just the user_id-linked
  -- join) — see 056_sellerStaffSimple.sql's file header note.
  SELECT s.id INTO v_seller_id FROM sellers s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email()
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Seller nahi mila');
  END IF;

  -- Serializes staff_code generation across concurrent add_seller_staff
  -- calls (any seller) — without it two sellers adding staff at the same
  -- moment could compute the same next code and one insert would crash
  -- on staff_staff_code_key. Held only for the rest of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('add_seller_staff_staff_code'));

  -- MAX(numeric suffix)+1, not COUNT(*)+1 — COUNT regenerates an
  -- already-used code the moment any 'SS%' row is missing from the
  -- middle of the sequence; MAX always resumes after the highest code
  -- actually in use. (076_fixAddSellerStaffCollisions.sql)
  SELECT 'SS' || LPAD((COALESCE(MAX(SUBSTRING(staff_code FROM 3)::int), 0) + 1)::text, 4, '0')
    INTO v_staff_code
  FROM staff WHERE staff_code LIKE 'SS%';

  BEGIN
    INSERT INTO staff (staff_code, email, name)
    VALUES (v_staff_code, p_email, p_name)
    RETURNING id INTO v_staff_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'staff_staff_code_key' THEN
      RETURN jsonb_build_object('success', false,
        'message', 'Staff code clash, dobara try karo');
    ELSE
      RETURN jsonb_build_object('success', false,
        'message', 'Ye email pehle se kisi staff/delivery-partner record mein hai');
    END IF;
  END;

  INSERT INTO staff_assignment (staff_id, seller_id, role_type, is_active)
  VALUES (v_staff_id, v_seller_id, 'seller_staff', true);

  RETURN jsonb_build_object('success', true, 'staff_code', v_staff_code);
END; $$;

GRANT EXECUTE ON FUNCTION add_seller_staff(text, text) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname, pronargs FROM pg_proc WHERE proname = 'add_seller_staff';
--   -- expect exactly one row, pronargs = 2

-- SELECT prosrc FROM pg_proc WHERE proname = 'add_seller_staff';
--   -- eyeball: no p_deployed_wholesaler_id, no aggregator_wholesalers
--   -- reference, GET STACKED DIAGNOSTICS + MAX(...) code query both present

-- Functional check: add a genuinely brand-new email as a normal (non-
-- aggregator) seller and confirm success with a fresh SSxxxx code.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Re-apply the 076_fixAddSellerStaffCollisions.sql version (3-arg,
-- p_deployed_wholesaler_id DEFAULT NULL + aggregator_wholesalers check)
-- via DROP FUNCTION add_seller_staff(text, text); then its CREATE OR
-- REPLACE FUNCTION block.
