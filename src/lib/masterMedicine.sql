-- ══════════════════════════════════════════════════
-- MedSetu — Master Medicine & Seller Inventory
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════

-- 1. MASTER MEDICINES TABLE
CREATE TABLE IF NOT EXISTS master_medicines (
  id   UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Basic Info
  name         VARCHAR(200) NOT NULL,
  generic_name VARCHAR(200),
  brand_names  TEXT,
  -- comma separated brands

  -- Composition
  salt_composition TEXT,
  strength         VARCHAR(100),

  -- Classification
  category     VARCHAR(50),
  -- Tablets / Syrup / Injection / Equipment /
  -- Ayurvedic / Surgical / Baby Care / Powder / Drops
  sub_category  VARCHAR(50),
  dosage_form   VARCHAR(50),

  -- Manufacturer
  manufacturer      VARCHAR(200),
  country_of_origin VARCHAR(50) DEFAULT 'India',

  -- Pricing (Reference)
  mrp_max DECIMAL(10,2),
  -- Maximum retail price

  -- Legal
  requires_prescription BOOLEAN DEFAULT false,
  schedule              VARCHAR(10),
  -- H / H1 / X / OTC
  is_narcotic           BOOLEAN DEFAULT false,

  -- Source
  source VARCHAR(50) DEFAULT 'manual',
  -- 'janaushadhi' / 'cdsco' / 'seller' / 'manual'

  -- Verification
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID,
  -- super_admin id

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Search optimization
  search_tags TEXT,
  -- comma separated keywords

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ──────────────────────────────────────────────────

-- 2. SELLER INVENTORY TABLE (Master se linked)
CREATE TABLE IF NOT EXISTS seller_inventory (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  medicine_id UUID REFERENCES master_medicines(id) ON DELETE SET NULL,

  -- Seller-specific details
  custom_name  VARCHAR(200),
  -- agar master name se alag ho
  selling_price DECIMAL(10,2) NOT NULL,
  stock_quantity INTEGER DEFAULT 0,
  unit           VARCHAR(20) DEFAULT 'strip',
  -- strip / bottle / piece / box

  -- Availability
  is_available    BOOLEAN DEFAULT true,
  low_stock_alert INTEGER DEFAULT 10,
  -- alert when stock < this

  -- Expiry tracking
  batch_number    VARCHAR(50),
  expiry_date     DATE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(seller_id, medicine_id)
);

-- ──────────────────────────────────────────────────

-- 3. TRIGGERS — auto-update updated_at

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS master_medicines_updated_at ON master_medicines;
CREATE TRIGGER master_medicines_updated_at
BEFORE UPDATE ON master_medicines
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS seller_inventory_updated_at ON seller_inventory;
CREATE TRIGGER seller_inventory_updated_at
BEFORE UPDATE ON seller_inventory
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ──────────────────────────────────────────────────

-- 4. INDEXES — search performance ke liye
CREATE INDEX IF NOT EXISTS idx_master_medicines_name
  ON master_medicines USING gin(to_tsvector('english', name));

CREATE INDEX IF NOT EXISTS idx_master_medicines_generic
  ON master_medicines (generic_name);

CREATE INDEX IF NOT EXISTS idx_master_medicines_category
  ON master_medicines (category);

CREATE INDEX IF NOT EXISTS idx_seller_inventory_seller
  ON seller_inventory (seller_id);

CREATE INDEX IF NOT EXISTS idx_seller_inventory_available
  ON seller_inventory (seller_id, is_available);

-- ──────────────────────────────────────────────────

-- 5. RLS Disable (development)
ALTER TABLE master_medicines  DISABLE ROW LEVEL SECURITY;
ALTER TABLE seller_inventory  DISABLE ROW LEVEL SECURITY;
