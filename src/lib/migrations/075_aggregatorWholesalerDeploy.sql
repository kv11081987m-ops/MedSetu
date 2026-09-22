-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator staff → wholesaler deployment
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Lets an aggregator seller (sellers.is_aggregator = true, e.g. Sarthak)
-- optionally tag a staff_assignment row with which of their mapped
-- wholesalers (aggregator_wholesalers) that staff member is deployed to.
-- Normal (non-aggregator) sellers are entirely unaffected — the new
-- column/param default to NULL and the UI dropdown this feeds never
-- renders for them.
--
-- IMPORTANT — confirmed by the user via Supabase SQL Editor before this
-- file was written: aggregator_wholesalers and sellers.is_aggregator
-- ALREADY EXIST live (leftover from the older, still-unmerged
-- aggregator-staff branch referenced in 052_deliveryPartner.sql's header
-- and explicitly called "out of scope" in 056_sellerStaffSimple.sql's).
-- Sarthak already has is_aggregator=true and 2 active wholesaler
-- mappings. Every DDL statement below is IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS, so it's a no-op against whatever's already live and does
-- NOT touch existing rows — confirmed safe for Sarthak's existing
-- mappings. It assumes the live aggregator_wholesalers table has columns
-- named exactly aggregator_seller_id / wholesaler_seller_id / is_active
-- (the names the user's own request used) — run part 0 below first and
-- stop if those don't match before applying the rest.

-- ================================================================
-- 0. VERIFY FIRST — confirm live column names match what's assumed below
-- ================================================================
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'aggregator_wholesalers' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'sellers' AND column_name = 'is_aggregator';


-- ================================================================
-- 1. Schema — no-ops if already live, exactly as reported
-- ================================================================
CREATE TABLE IF NOT EXISTS aggregator_wholesalers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregator_seller_id uuid NOT NULL REFERENCES sellers(id),
  wholesaler_seller_id uuid NOT NULL REFERENCES sellers(id),
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamp DEFAULT now(),
  UNIQUE (aggregator_seller_id, wholesaler_seller_id)
);

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS is_aggregator boolean NOT NULL DEFAULT false;

-- role_type='delivery_partner' rows leave this NULL same as seller_id/
-- deployed_wholesaler_id already do (052_deliveryPartner.sql) — a global
-- pool row was never scoped to one seller in the first place.
ALTER TABLE staff_assignment
  ADD COLUMN IF NOT EXISTS deployed_wholesaler_id uuid REFERENCES sellers(id);


-- ================================================================
-- 2. RLS — owner can read their OWN aggregator_wholesalers rows
-- ================================================================
-- Needed for the SellerDashboard.jsx dropdown query. Same auth_id/email
-- fallback pattern as owner_view_staff_assignment (056_sellerStaffSimple.
-- sql) — single-level join to sellers, no recursion risk (unlike the
-- staff/staff_assignment cycle 057_fixStaffRlsRecursion.sql fixed).
ALTER TABLE aggregator_wholesalers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_view_aggregator_wholesalers" ON aggregator_wholesalers;
CREATE POLICY "owner_view_aggregator_wholesalers" ON aggregator_wholesalers
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sellers s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = aggregator_wholesalers.aggregator_seller_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email())
  )
);


-- ================================================================
-- 3. add_seller_staff — new optional p_deployed_wholesaler_id param
-- ================================================================
-- Dropped and re-created (rather than a same-signature CREATE OR REPLACE)
-- because adding a parameter changes the function's identity in Postgres
-- — REPLACE alone would leave the old 2-arg version around as a separate
-- overload. Dropping first keeps a single canonical function. Default
-- NULL on the new param means every existing call site (2 args) still
-- works unchanged; SellerDashboard.jsx is updated to pass the 3rd arg.
DROP FUNCTION IF EXISTS add_seller_staff(text, text);

CREATE FUNCTION add_seller_staff(
  p_name text, p_email text, p_deployed_wholesaler_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
  v_staff_id uuid;
  v_staff_code text;
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
  -- moment could compute the same COUNT(*)+1 and one insert would crash
  -- on staff_staff_code_key. Held only for the rest of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('add_seller_staff_staff_code'));

  SELECT 'SS' || LPAD((COUNT(*) + 1)::text, 4, '0') INTO v_staff_code
  FROM staff WHERE staff_code LIKE 'SS%';

  BEGIN
    INSERT INTO staff (staff_code, email, name)
    VALUES (v_staff_code, p_email, p_name)
    RETURNING id INTO v_staff_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye email pehle se kisi staff/delivery-partner record mein hai');
  END;

  INSERT INTO staff_assignment (staff_id, seller_id, role_type, is_active, deployed_wholesaler_id)
  VALUES (v_staff_id, v_seller_id, 'seller_staff', true, p_deployed_wholesaler_id);

  RETURN jsonb_build_object('success', true, 'staff_code', v_staff_code);
END; $$;


-- ================================================================
-- 4. set_staff_deployment(p_staff_id, p_deployed_wholesaler_id) — edit
-- ================================================================
-- Changes (or clears, if NULL) which wholesaler an already-added staff
-- member is deployed to. Same owner-resolution and ownership checks as
-- end_seller_staff; same wholesaler-mapping validation as add_seller_staff.
CREATE OR REPLACE FUNCTION set_staff_deployment(
  p_staff_id uuid, p_deployed_wholesaler_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT s.id INTO v_seller_id FROM sellers s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email()
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Seller nahi mila');
  END IF;

  IF p_deployed_wholesaler_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM aggregator_wholesalers
    WHERE aggregator_seller_id = v_seller_id
      AND wholesaler_seller_id = p_deployed_wholesaler_id
      AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ye wholesaler aapke saath mapped nahi hai');
  END IF;

  UPDATE staff_assignment SET deployed_wholesaler_id = p_deployed_wholesaler_id
  WHERE staff_id = p_staff_id AND seller_id = v_seller_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Staff nahi mila ya aapka nahi hai');
  END IF;

  RETURN jsonb_build_object('success', true);
END; $$;


-- ================================================================
-- 5. Grants
-- ================================================================
GRANT EXECUTE ON FUNCTION add_seller_staff(text, text, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION set_staff_deployment(uuid, uuid)         TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'staff_assignment' AND column_name = 'deployed_wholesaler_id';

-- SELECT proname, pronargs FROM pg_proc
--   WHERE proname IN ('add_seller_staff', 'set_staff_deployment');
--   -- expect add_seller_staff with pronargs = 3, set_staff_deployment with pronargs = 2

-- SELECT policyname FROM pg_policies
--   WHERE tablename = 'aggregator_wholesalers' AND policyname = 'owner_view_aggregator_wholesalers';

-- Confirm Sarthak's existing mappings are untouched:
-- SELECT * FROM aggregator_wholesalers WHERE aggregator_seller_id = 'b209fcbe-9af3-4f46-8f16-71221108025a';
--   -- expect: still 2 rows, same as before this migration ran


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS set_staff_deployment(uuid, uuid);
-- DROP FUNCTION IF EXISTS add_seller_staff(text, text, uuid);
-- (re-create the original 2-arg add_seller_staff from 056_sellerStaffSimple.sql if rolling back)
-- DROP POLICY IF EXISTS "owner_view_aggregator_wholesalers" ON aggregator_wholesalers;
-- ALTER TABLE staff_assignment DROP COLUMN IF EXISTS deployed_wholesaler_id;
-- Do NOT drop aggregator_wholesalers or sellers.is_aggregator on rollback —
-- both pre-date this migration and hold Sarthak's live data.
