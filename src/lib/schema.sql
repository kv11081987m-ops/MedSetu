-- ================================================================
-- MedSetu — Supabase Database Schema
-- Run this in Supabase Dashboard → SQL Editor
-- ================================================================

-- Enable UUID generation (already available in Supabase)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ================================================================
-- 1. USERS
-- ================================================================
CREATE TABLE users (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  phone          VARCHAR(10)  UNIQUE NOT NULL,
  name           VARCHAR(100),
  email          VARCHAR(100),
  gender         VARCHAR(10),
  date_of_birth  DATE,
  blood_group    VARCHAR(5),
  allergies      TEXT,
  chronic_conditions TEXT,
  regular_medicines  TEXT,
  role           VARCHAR(20)  DEFAULT 'customer',  -- customer | seller | pharmacist | admin
  created_at     TIMESTAMP    DEFAULT NOW(),
  updated_at     TIMESTAMP    DEFAULT NOW()
);


-- ================================================================
-- 2. ADDRESSES
-- ================================================================
CREATE TABLE addresses (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID         REFERENCES users(id) ON DELETE CASCADE,
  label         VARCHAR(50),                        -- Ghar | Office | Other
  address_line  TEXT         NOT NULL,
  city          VARCHAR(50),
  district      VARCHAR(50),
  state         VARCHAR(50),
  pincode       VARCHAR(6),
  is_default    BOOLEAN      DEFAULT false,
  created_at    TIMESTAMP    DEFAULT NOW()
);


-- ================================================================
-- 3. SELLERS
-- ================================================================
CREATE TABLE sellers (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID          REFERENCES users(id) ON DELETE SET NULL,
  store_name        VARCHAR(100)  NOT NULL,
  owner_name        VARCHAR(100),
  phone             VARCHAR(10),
  address           TEXT,
  district          VARCHAR(50),
  drug_license      VARCHAR(50)   UNIQUE,
  pharmacist_name   VARCHAR(100),
  pharmacist_cert   VARCHAR(100),
  approval_status   VARCHAR(20)   DEFAULT 'pending',  -- pending | approved | rejected
  is_open           BOOLEAN       DEFAULT true,
  rating            DECIMAL(2,1)  DEFAULT 0,
  total_reviews     INTEGER       DEFAULT 0,
  latitude          DECIMAL(10,8),
  longitude         DECIMAL(11,8),
  created_at        TIMESTAMP     DEFAULT NOW(),
  updated_at        TIMESTAMP     DEFAULT NOW()
);


-- ================================================================
-- 4. MEDICINES
-- ================================================================
CREATE TABLE medicines (
  id                     UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id              UUID          REFERENCES sellers(id) ON DELETE CASCADE,
  name                   VARCHAR(100)  NOT NULL,
  brand                  VARCHAR(100),
  salt_name              VARCHAR(100),
  category               VARCHAR(50),   -- Tablet | Syrup | Injection | Equipment | etc.
  mrp                    DECIMAL(10,2),
  selling_price          DECIMAL(10,2),
  stock                  INTEGER        DEFAULT 0,
  unit                   VARCHAR(20),   -- Strip | Bottle | Piece | etc.
  expiry_date            DATE,
  requires_prescription  BOOLEAN        DEFAULT false,
  is_available           BOOLEAN        DEFAULT true,
  created_at             TIMESTAMP      DEFAULT NOW(),
  updated_at             TIMESTAMP      DEFAULT NOW()
);


-- ================================================================
-- 5. ORDERS
-- ================================================================
CREATE TABLE orders (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number      VARCHAR(20)   UNIQUE,            -- MED-2024-001
  customer_id       UUID          REFERENCES users(id) ON DELETE SET NULL,
  seller_id         UUID          REFERENCES sellers(id) ON DELETE SET NULL,
  total_amount      DECIMAL(10,2),
  delivery_charge   DECIMAL(10,2) DEFAULT 30,
  discount          DECIMAL(10,2) DEFAULT 0,
  promo_code        VARCHAR(20),
  final_amount      DECIMAL(10,2),
  status            VARCHAR(30)   DEFAULT 'pending',
    -- pending | confirmed | preparing | out_for_delivery | delivered | cancelled
  payment_method    VARCHAR(20),   -- cod | upi | card | netbanking
  payment_status    VARCHAR(20)   DEFAULT 'pending',  -- pending | paid | refunded
  delivery_type     VARCHAR(20)   DEFAULT 'home_delivery',  -- home_delivery | store_pickup
  delivery_address  TEXT,
  prescription_url  TEXT,
  notes             TEXT,
  estimated_time    VARCHAR(30),
  delivered_at      TIMESTAMP,
  cancelled_at      TIMESTAMP,
  cancel_reason     TEXT,
  created_at        TIMESTAMP     DEFAULT NOW(),
  updated_at        TIMESTAMP     DEFAULT NOW()
);

-- Auto-generate order_number trigger
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number := 'MED-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                      LPAD(NEXTVAL('order_seq')::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS order_seq START 1;

CREATE TRIGGER set_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION generate_order_number();


-- ================================================================
-- 6. ORDER ITEMS
-- ================================================================
CREATE TABLE order_items (
  id           UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id     UUID          REFERENCES orders(id) ON DELETE CASCADE,
  medicine_id  UUID          REFERENCES medicines(id) ON DELETE SET NULL,
  name         VARCHAR(100)  NOT NULL,   -- snapshot at order time
  quantity     INTEGER       NOT NULL,
  unit_price   DECIMAL(10,2) NOT NULL,
  total_price  DECIMAL(10,2) NOT NULL,
  created_at   TIMESTAMP     DEFAULT NOW()
);


-- ================================================================
-- 7. PRESCRIPTIONS
-- ================================================================
CREATE TABLE prescriptions (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id      UUID         REFERENCES users(id) ON DELETE CASCADE,
  order_id         UUID         REFERENCES orders(id) ON DELETE SET NULL,
  image_url        TEXT         NOT NULL,
  doctor_name      VARCHAR(100),
  hospital_name    VARCHAR(100),
  prescribed_date  DATE,
  status           VARCHAR(20)  DEFAULT 'pending',
    -- pending | approved | rejected | more_info_needed
  reviewed_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  review_notes     TEXT,
  reviewed_at      TIMESTAMP,
  created_at       TIMESTAMP    DEFAULT NOW()
);


-- ================================================================
-- 8. PHARMACIST CALLS
-- ================================================================
CREATE TABLE pharmacist_calls (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
  pharmacist_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
  order_id        UUID         REFERENCES orders(id) ON DELETE SET NULL,
  prescription_id UUID         REFERENCES prescriptions(id) ON DELETE SET NULL,
  status          VARCHAR(20)  DEFAULT 'waiting',
    -- waiting | in_progress | completed | rejected | missed
  is_urgent       BOOLEAN      DEFAULT false,
  wait_minutes    INTEGER      DEFAULT 0,
  duration_secs   INTEGER,     -- call duration in seconds
  notes           TEXT,
  started_at      TIMESTAMP,
  ended_at        TIMESTAMP,
  created_at      TIMESTAMP    DEFAULT NOW()
);


-- ================================================================
-- 9. DISPUTES
-- ================================================================
CREATE TABLE disputes (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id     UUID        REFERENCES orders(id) ON DELETE SET NULL,
  customer_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  seller_id    UUID        REFERENCES sellers(id) ON DELETE SET NULL,
  issue_type   VARCHAR(50),
    -- wrong_medicine | not_delivered | damaged | overcharged | other
  description  TEXT        NOT NULL,
  amount       DECIMAL(10,2),
  status       VARCHAR(20) DEFAULT 'open',  -- open | in_review | resolved | closed
  is_urgent    BOOLEAN     DEFAULT false,
  resolved_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolution   TEXT,
  resolved_at  TIMESTAMP,
  created_at   TIMESTAMP   DEFAULT NOW(),
  updated_at   TIMESTAMP   DEFAULT NOW()
);


-- ================================================================
-- 10. NOTIFICATIONS
-- ================================================================
CREATE TABLE notifications (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(100) NOT NULL,
  body        TEXT,
  type        VARCHAR(30),   -- order_update | promo | system | dispute
  ref_id      UUID,          -- order_id or dispute_id
  is_read     BOOLEAN     DEFAULT false,
  created_at  TIMESTAMP   DEFAULT NOW()
);


-- ================================================================
-- ROW LEVEL SECURITY (RLS)
-- Enable after testing — uncomment when ready
-- ================================================================

-- ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE addresses      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sellers        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE medicines      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE order_items    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE prescriptions  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pharmacist_calls ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE disputes       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;

-- Sample RLS policy (customer sees own orders only):
-- CREATE POLICY "customer_own_orders" ON orders
--   FOR SELECT USING (auth.uid() = customer_id);


-- ================================================================
-- INDEXES (performance)
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_users_phone         ON users(phone);
CREATE INDEX IF NOT EXISTS idx_addresses_user      ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_sellers_district    ON sellers(district);
CREATE INDEX IF NOT EXISTS idx_sellers_status      ON sellers(approval_status);
CREATE INDEX IF NOT EXISTS idx_medicines_seller    ON medicines(seller_id);
CREATE INDEX IF NOT EXISTS idx_medicines_category  ON medicines(category);
CREATE INDEX IF NOT EXISTS idx_orders_customer     ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller       ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_cust  ON prescriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status     ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id, is_read);


-- ================================================================
-- UPDATED_AT AUTO-UPDATE TRIGGER (reusable)
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sellers_updated_at
  BEFORE UPDATE ON sellers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER medicines_updated_at
  BEFORE UPDATE ON medicines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER disputes_updated_at
  BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
