-- 062_staffDutyHold.sql
-- Duty Hold: staff ko asthayi roop se rokna (id hold) — active rehte hue bhi
-- kaam na kar sake, baad me switch off karke wapas chalu. Ek naya column +
-- do context functions update: current_staff_context (kaam-gate) hold par
-- KHAALI lautaye (kaam ruke); my_staff_context (login/panel) hold par bhi
-- lautaye par is_on_hold flag ke saath (panel suchna dikha sake).

-- 1) naya column
ALTER TABLE staff_assignment
  ADD COLUMN IF NOT EXISTS is_on_hold BOOLEAN NOT NULL DEFAULT false;

-- 2) current_staff_context: hold wala staff -> khaali (koi kaam nahi)
CREATE OR REPLACE FUNCTION current_staff_context()
RETURNS TABLE (staff_id UUID, seller_id UUID, wholesaler_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, a.seller_id, a.deployed_wholesaler_id
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.is_active = true
    AND a.is_on_hold = false
  LIMIT 1;
$$;

-- 3) my_staff_context: login/panel ke liye — hold par BHI lautaye, flag ke saath
DROP FUNCTION IF EXISTS my_staff_context();
CREATE OR REPLACE FUNCTION my_staff_context()
RETURNS TABLE (
  staff_id                UUID,
  staff_code              TEXT,
  name                    TEXT,
  seller_id               UUID,
  deployed_wholesaler_id  UUID,
  is_aggregator           BOOLEAN,
  is_on_hold              BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id                        AS staff_id,
    s.staff_code::text          AS staff_code,
    s.name::text                AS name,
    a.seller_id                 AS seller_id,
    a.deployed_wholesaler_id    AS deployed_wholesaler_id,
    COALESCE(sel.is_aggregator, false) AS is_aggregator,
    a.is_on_hold                AS is_on_hold
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id AND a.is_active = true
  LEFT JOIN sellers sel   ON sel.id = a.seller_id
  WHERE s.email = auth.email()
  LIMIT 1;
$$;
