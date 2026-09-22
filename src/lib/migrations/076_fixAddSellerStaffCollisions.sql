-- ══════════════════════════════════════════════════
-- MedSetu — add_seller_staff: gap-safe staff_code + real collision detection
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Context: 075_aggregatorWholesalerDeploy.sql added a 3rd arg
-- (p_deployed_wholesaler_id) to add_seller_staff via DROP + CREATE
-- FUNCTION. Diagnosed separately (see conversation) that the live
-- add_seller_staff(text, text, uuid) may not be the exact body from 075
-- — CREATE FUNCTION (not OR REPLACE) would have errored out and aborted
-- the rest of that script if a 3-arg overload already existed live from
-- the older, still-unmerged aggregator-staff branch referenced in
-- 052_deliveryPartner.sql/056_sellerStaffSimple.sql's headers, leaving
-- an unknown/unreviewed function actually running — explaining "every
-- email, even brand-new ones, gets 'email already exists'".
--
-- This file does exactly 2 things to add_seller_staff, everything else
-- (seller resolution, wholesaler-mapping validation, advisory lock,
-- staff_assignment insert, all messages except the ones named below)
-- is untouched from the 075 body:
--
--   1. staff_code generation: COUNT(*)+1 -> MAX(numeric suffix)+1. COUNT
--      is wrong the moment any 'SS%' row is missing from the middle of
--      the sequence (a delete, or — per the diagnosis above — a prior
--      run that inserted then something else rolled back outside this
--      function's own savepoint), since COUNT(*)+1 can regenerate a code
--      that already exists further up the sequence. MAX(suffix)+1 always
--      picks the next number after the highest one actually in use.
--      pg_advisory_xact_lock is untouched — still serializes concurrent
--      callers so two sellers adding staff simultaneously can't compute
--      the same MAX and collide.
--
--   2. The INSERT's unique_violation handler no longer assumes every
--      collision is the email — GET STACKED DIAGNOSTICS reads the actual
--      constraint name. staff_staff_code_key is the one name we can
--      confirm from this repo's own comments (056/075, "would crash on
--      staff_staff_code_key"); the live email UNIQUE constraint's exact
--      name was never captured in any migration file here (the `staff`
--      table predates this migration series), so rather than guess it
--      and risk silently misclassifying a real email collision into the
--      generic bucket, anything that ISN'T staff_staff_code_key is
--      treated as the email case (preserves the original message
--      exactly). Run part 0 below to confirm the actual constraint names
--      match this assumption.

-- ================================================================
-- 0. VERIFY FIRST — confirm constraint names + next code before/after
-- ================================================================
-- SELECT conname FROM pg_constraint
--   WHERE conrelid = 'staff'::regclass AND contype = 'u';
--   -- expect staff_staff_code_key among them; note the other (email) name

-- Next code under the OLD count-based formula vs the NEW max-based one —
-- run both, compare:
-- SELECT 'SS' || LPAD((COUNT(*) + 1)::text, 4, '0') AS old_next_code
--   FROM staff WHERE staff_code LIKE 'SS%';
-- SELECT 'SS' || LPAD((COALESCE(MAX(SUBSTRING(staff_code FROM 3)::int), 0) + 1)::text, 4, '0') AS new_next_code
--   FROM staff WHERE staff_code LIKE 'SS%';


-- ================================================================
-- 1. add_seller_staff — gap-safe staff_code + real collision detection
-- ================================================================
CREATE OR REPLACE FUNCTION add_seller_staff(
  p_name text, p_email text, p_deployed_wholesaler_id uuid DEFAULT NULL
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

  -- Not just trusted from the client dropdown — the wholesaler must
  -- actually be one of THIS seller's own active mappings.
  IF p_deployed_wholesaler_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM aggregator_wholesalers
    WHERE aggregator_seller_id = v_seller_id
      AND wholesaler_seller_id = p_deployed_wholesaler_id
      AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ye wholesaler aapke saath mapped nahi hai');
  END IF;

  -- Serializes staff_code generation across concurrent add_seller_staff
  -- calls (any seller) — without it two sellers adding staff at the same
  -- moment could compute the same next code and one insert would crash
  -- on staff_staff_code_key. Held only for the rest of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('add_seller_staff_staff_code'));

  -- MAX(numeric suffix)+1, not COUNT(*)+1 — COUNT regenerates an
  -- already-used code the moment any 'SS%' row is missing from the
  -- middle of the sequence; MAX always resumes after the highest code
  -- actually in use.
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

  INSERT INTO staff_assignment (staff_id, seller_id, role_type, is_active, deployed_wholesaler_id)
  VALUES (v_staff_id, v_seller_id, 'seller_staff', true, p_deployed_wholesaler_id);

  RETURN jsonb_build_object('success', true, 'staff_code', v_staff_code);
END; $$;

GRANT EXECUTE ON FUNCTION add_seller_staff(text, text, uuid) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT prosrc FROM pg_proc WHERE proname = 'add_seller_staff';
--   -- eyeball: body now has GET STACKED DIAGNOSTICS and the MAX(...) code query

-- Confirm the next code is gap-safe (should match the new_next_code
-- computed in part 0, NOT necessarily COUNT(*)+1's old_next_code if they
-- differed):
-- SELECT 'SS' || LPAD((COALESCE(MAX(SUBSTRING(staff_code FROM 3)::int), 0) + 1)::text, 4, '0')
--   FROM staff WHERE staff_code LIKE 'SS%';

-- Functional check: add a genuinely brand-new email and confirm success
-- (not the old "email already exists" for-everyone symptom).


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Re-apply the 075_aggregatorWholesalerDeploy.sql version of
-- add_seller_staff (COUNT(*)+1 code generation, single generic
-- unique_violation message) via CREATE OR REPLACE FUNCTION.
