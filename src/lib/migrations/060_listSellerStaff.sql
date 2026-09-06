-- 060_listSellerStaff.sql
-- Owner apne seller ki ACTIVE staff-list dekh sake. RLS owner ko nahi dikhati
-- (sirf vyakti ko apni row), isliye ek ownership-verified RPC — bilkul waise hi
-- jaise add_staff_to_seller / end_staff_assignment karte hain. SECURITY DEFINER
-- se RLS bypass, par pehle owner-check.

CREATE OR REPLACE FUNCTION list_seller_staff(p_seller_id UUID)
RETURNS TABLE (
  assignment_id           UUID,
  staff_id                UUID,
  staff_code              TEXT,
  name                    TEXT,
  email                   TEXT,
  deployed_wholesaler_id  UUID,
  started_at              TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_owns    BOOLEAN;
BEGIN
  SELECT user_id INTO v_user_id FROM sellers WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN;  -- seller nahi mila -> khaali
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = v_user_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) INTO v_owns;

  IF NOT (v_owns OR is_active_superadmin()) THEN
    RETURN;  -- owner nahi -> khaali (koi data leak nahi)
  END IF;

  RETURN QUERY
    SELECT
      a.id                     AS assignment_id,
      s.id                     AS staff_id,
      s.staff_code             AS staff_code,
      s.name                   AS name,
      s.email                  AS email,
      a.deployed_wholesaler_id AS deployed_wholesaler_id,
      a.started_at             AS started_at
    FROM staff_assignment a
    JOIN staff s ON s.id = a.staff_id
    WHERE a.seller_id = p_seller_id
      AND a.is_active = true
    ORDER BY s.name NULLS LAST, s.staff_code;
END;
$$;

GRANT EXECUTE ON FUNCTION list_seller_staff(UUID) TO authenticated;
