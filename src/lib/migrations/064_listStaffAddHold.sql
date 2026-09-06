-- 064_listStaffAddHold.sql
-- list_seller_staff me is_on_hold column jodta hai, taaki owner ko staff list
-- me hold-state DB se sahi mile (refresh par bhi). Return-type badal raha hai
-- (naya column), isliye pehle DROP zaroori.

DROP FUNCTION IF EXISTS list_seller_staff(UUID);

CREATE OR REPLACE FUNCTION list_seller_staff(p_seller_id UUID)
RETURNS TABLE (
  assignment_id           UUID,
  staff_id                UUID,
  staff_code              TEXT,
  name                    TEXT,
  email                   TEXT,
  deployed_wholesaler_id  UUID,
  is_on_hold              BOOLEAN,
  started_at              TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_owns    BOOLEAN;
BEGIN
  SELECT user_id INTO v_user_id FROM sellers WHERE id = p_seller_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = v_user_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) INTO v_owns;
  IF NOT (v_owns OR is_active_superadmin()) THEN RETURN; END IF;

  RETURN QUERY
    SELECT
      a.id                     AS assignment_id,
      s.id                     AS staff_id,
      s.staff_code::text       AS staff_code,
      s.name::text             AS name,
      s.email::text            AS email,
      a.deployed_wholesaler_id AS deployed_wholesaler_id,
      a.is_on_hold             AS is_on_hold,
      a.started_at             AS started_at
    FROM staff_assignment a
    JOIN staff s ON s.id = a.staff_id
    WHERE a.seller_id = p_seller_id
      AND a.is_active = true
    ORDER BY s.name NULLS LAST, s.staff_code;
END;
$$;

GRANT EXECUTE ON FUNCTION list_seller_staff(UUID) TO authenticated;
