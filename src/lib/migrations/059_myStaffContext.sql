-- 059_myStaffContext.sql
-- Ek hi jagah "main kaun staff hoon" ka sach: login-email se staff (vyakti)
-- + uski ACTIVE posting (staff_assignment) join karke ek row lautata hai.
-- AuthContext (role decide) aur StaffPanel (pool dikhana) dono isi ko call karenge.
-- Agar vyakti hai par koi active posting nahi (resign ho chuka) -> 0 rows -> staff-role nahi.

CREATE OR REPLACE FUNCTION my_staff_context()
RETURNS TABLE (
  staff_id                UUID,
  staff_code              TEXT,
  name                    TEXT,
  seller_id               UUID,
  deployed_wholesaler_id  UUID,
  is_aggregator           BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id                        AS staff_id,
    s.staff_code                AS staff_code,
    s.name                      AS name,
    a.seller_id                 AS seller_id,
    a.deployed_wholesaler_id    AS deployed_wholesaler_id,
    COALESCE(sel.is_aggregator, false) AS is_aggregator
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id AND a.is_active = true
  LEFT JOIN sellers sel   ON sel.id = a.seller_id
  WHERE s.email = auth.email()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION my_staff_context() TO authenticated;
