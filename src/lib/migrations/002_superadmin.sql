-- ══════════════════════════════════════════════════
-- MedSetu — Super Admin & Staff Structure
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════

-- 1. SUPER ADMINS TABLE
CREATE TABLE IF NOT EXISTS super_admins (
  id         UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  email      VARCHAR(100) UNIQUE NOT NULL,
  name       VARCHAR(100),
  is_active  BOOLEAN      DEFAULT true,
  created_at TIMESTAMP    DEFAULT NOW()
);

-- Super Admin insert karo
INSERT INTO super_admins (email, name)
VALUES ('kv11081987m@gmail.com', 'Kumar')
ON CONFLICT (email) DO NOTHING;

-- ──────────────────────────────────────────────────

-- 2. STAFF WHITELIST TABLE
CREATE TABLE IF NOT EXISTS staff_whitelist (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  email            VARCHAR(100) UNIQUE NOT NULL,
  role             VARCHAR(20)  NOT NULL,
  -- 'admin' / 'seller' / 'pharmacist'
  name             VARCHAR(100),
  phone            VARCHAR(10),
  is_approved      BOOLEAN      DEFAULT false,
  approved_by      UUID         REFERENCES super_admins(id),
  approval_date    TIMESTAMP,
  rejection_reason TEXT,
  created_at       TIMESTAMP    DEFAULT NOW()
);

-- ──────────────────────────────────────────────────

-- 3. SELLER REGISTRATION TABLE
CREATE TABLE IF NOT EXISTS seller_registrations (
  id   UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Personal Info
  owner_name   VARCHAR(100) NOT NULL,
  mobile       VARCHAR(10)  NOT NULL,
  email        VARCHAR(100) NOT NULL,
  aadhar_number VARCHAR(12),

  -- Store Info
  store_name VARCHAR(100) NOT NULL,
  address    TEXT         NOT NULL,
  district   VARCHAR(50)  NOT NULL,
  city       VARCHAR(50),
  pincode    VARCHAR(6),
  maps_link  TEXT,

  -- Legal Documents
  drug_license_number    VARCHAR(50) UNIQUE,
  drug_license_expiry    DATE,
  drug_license_image     TEXT,
  pharmacist_name        VARCHAR(100),
  pharmacist_reg_number  VARCHAR(50),
  pharmacist_cert_image  TEXT,

  -- Bank Details
  bank_name      VARCHAR(100),
  account_number VARCHAR(20),
  ifsc_code      VARCHAR(11),
  upi_id         VARCHAR(50),

  -- Status
  status           VARCHAR(20) DEFAULT 'pending',
  -- 'pending' / 'approved' / 'rejected'
  reviewed_by      UUID        REFERENCES super_admins(id),
  review_date      TIMESTAMP,
  rejection_reason TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ──────────────────────────────────────────────────

-- 4. ADMIN PERMISSIONS TABLE
CREATE TABLE IF NOT EXISTS admin_permissions (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_email  VARCHAR(100) NOT NULL,
  permission   VARCHAR(50)  NOT NULL,
  -- 'approve_sellers'
  -- 'manage_orders'
  -- 'manage_disputes'
  -- 'view_reports'
  -- 'manage_pharmacists'
  granted_by  UUID      REFERENCES super_admins(id),
  granted_at  TIMESTAMP DEFAULT NOW()
);

-- ──────────────────────────────────────────────────

-- 5. TRIGGER — auto-update updated_at
CREATE OR REPLACE FUNCTION update_seller_reg_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seller_reg_updated_at ON seller_registrations;
CREATE TRIGGER seller_reg_updated_at
BEFORE UPDATE ON seller_registrations
FOR EACH ROW EXECUTE FUNCTION update_seller_reg_timestamp();

-- ──────────────────────────────────────────────────

-- 6. RLS Disable (development)
ALTER TABLE super_admins         DISABLE ROW LEVEL SECURITY;
ALTER TABLE staff_whitelist      DISABLE ROW LEVEL SECURITY;
ALTER TABLE seller_registrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_permissions    DISABLE ROW LEVEL SECURITY;
