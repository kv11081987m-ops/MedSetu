-- 057_staffTwoTable.sql
-- Staff system ko do table me re-architecture:
--   staff             = permanent vyakti (jawan-number: UUID + staff_code MS0001), email UNIQUE
--   staff_assignment  = posting (kaun staff, kis seller/wholesaler par, active/ended)
-- orders.claimed_by ab permanent staff(id) ko point karega (assignment ko nahi).
-- Purana seller_staff (sirf test-rows) drop. Functions/RPCs agli migration 058 me.

-- ========== 1) staff (vyakti) ==========
CREATE TABLE IF NOT EXISTS staff (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_code  TEXT        UNIQUE,            -- MS0001... (trigger se auto)
  email       TEXT        NOT NULL UNIQUE,   -- pahchan (Google login email)
  name        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

-- staff_code auto-generator: MS + 4-digit zero-padded sequence
CREATE SEQUENCE IF NOT EXISTS staff_code_seq START 1;

CREATE OR REPLACE FUNCTION set_staff_code()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.staff_code IS NULL THEN
    NEW.staff_code := 'MS' || LPAD(nextval('staff_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_staff_code ON staff;
CREATE TRIGGER trg_set_staff_code
BEFORE INSERT ON staff
FOR EACH ROW EXECUTE FUNCTION set_staff_code();

-- ========== 2) staff_assignment (posting) ==========
CREATE TABLE IF NOT EXISTS staff_assignment (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id                UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  seller_id               UUID        NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  deployed_wholesaler_id  UUID        REFERENCES sellers(id) ON DELETE SET NULL,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  started_at              TIMESTAMPTZ DEFAULT NOW(),
  ended_at                TIMESTAMPTZ,
  created_by              UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_assignment_staff    ON staff_assignment(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignment_seller   ON staff_assignment(seller_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignment_whid     ON staff_assignment(deployed_wholesaler_id);

-- Ek staff ki ek waqt SIRF EK active assignment (arbitrary-row bug jad se khatam)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_one_active_assignment
  ON staff_assignment(staff_id)
  WHERE is_active = true;

-- ========== 3) orders.claimed_by ko naye staff par repoint ==========
-- Purana FK (seller_staff par) hatao, phir naya FK staff par. Purane test-orders
-- me claimed_by hai to nahi (koi asli claim nahi hua), fir bhi safe: pehle NULL kar do.
UPDATE orders SET claimed_by = NULL WHERE claimed_by IS NOT NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_claimed_by_fkey;
ALTER TABLE orders
  ADD CONSTRAINT orders_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES staff(id) ON DELETE SET NULL;

-- ========== 4) purana seller_staff drop (FK hat chuka, ab safe) ==========
DROP TABLE IF EXISTS seller_staff CASCADE;

-- ========== 5) RLS ==========
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_assignment ENABLE ROW LEVEL SECURITY;

-- staff: superadmin sab kuchh; vyakti apni row email se dekh sake
CREATE POLICY "staff_manage_superadmin"
  ON staff FOR ALL
  USING (is_active_superadmin())
  WITH CHECK (is_active_superadmin());

CREATE POLICY "staff_select_own"
  ON staff FOR SELECT
  USING (email = auth.email());

-- staff_assignment: superadmin sab kuchh; vyakti apni assignments dekh sake
-- (apni staff row se match karke)
CREATE POLICY "staff_assignment_manage_superadmin"
  ON staff_assignment FOR ALL
  USING (is_active_superadmin())
  WITH CHECK (is_active_superadmin());

CREATE POLICY "staff_assignment_select_own"
  ON staff_assignment FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff s
      WHERE s.id = staff_assignment.staff_id
        AND s.email = auth.email()
    )
  );
