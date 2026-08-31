-- ══════════════════════════════════════════════════
-- MedSetu — bulk_add_seller_inventory: statement-timeout headroom (Free plan)
-- 042 ka RPC bade chunk par default statement_timeout (Free plan) cross kar
-- raha tha. Do cheezein:
--   (a) function ko apna statement_timeout = '60s' de do (SET clause).
--   (b) defensive: lower(name) index + ANALYZE (agar 042 ka CREATE INDEX
--       kisi wajah se na laga ho — IF NOT EXISTS no-op agar pehle se hai).
-- RPC ka body 042 se BYTE-FOR-BYTE same — sirf header mein ek SET line.
-- Client-side CHUNK bhi 300 -> 100 kiya gaya (InventoryManagement.jsx).
--
-- Depends on: 042_bulkSellerInventory.sql
-- Run this in Supabase SQL Editor (042 ke baad).
-- ══════════════════════════════════════════════════

-- (b) index + stats — 042 ne bana diya ho to ye no-op
CREATE INDEX IF NOT EXISTS idx_master_medicines_lower_name
  ON master_medicines (lower(name));
ANALYZE master_medicines;

-- (a) same function, +SET statement_timeout, body unchanged
CREATE OR REPLACE FUNCTION bulk_add_seller_inventory(
  p_seller_id uuid,
  p_rows      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- ── Ownership: p_seller_id caller ka apna seller ho (ya superadmin) ──
  -- 014 sellers_update_owner_or_staff jaisा (auth_id YA email fallback) —
  -- email-fallback tab kaam aata hai jab users row bani hai par auth_id
  -- patch abhi lagna baaki hai.
  IF NOT EXISTS (
    SELECT 1
    FROM sellers s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = p_seller_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR is_active_superadmin())
  ) THEN
    RAISE EXCEPTION 'Not authorized for seller %', p_seller_id
      USING errcode = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('added', 0, 'unmatched', '[]'::jsonb,
                              'failed', '[]'::jsonb, 'upserted', 0);
  END IF;

  WITH input AS (
    SELECT
      btrim(r->>'name')                                       AS name,
      COALESCE(NULLIF(r->>'stock','')::int, 0)                AS stock,
      COALESCE(NULLIF(r->>'selling_price','')::numeric, 0)    AS selling_price,
      NULLIF(r->>'mrp','')::numeric                           AS mrp,
      COALESCE(NULLIF(r->>'unit',''), 'strips')              AS unit,
      NULLIF(r->>'expiry_date','')::date                      AS expiry_date,
      NULLIF(r->>'batch_number','')                           AS batch_number,
      COALESCE(NULLIF(r->>'min_order_quantity','')::int, 1)  AS min_order_quantity,
      ord.idx
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS ord(r, idx)
    WHERE btrim(COALESCE(r->>'name','')) <> ''
  ),
  matched AS (
    SELECT
      i.*,
      mm.id      AS medicine_id,
      mm.mrp_max,
      -- guard_selling_price_vs_mrp (022) ka EXACT rule:
      --   ref := (NEW.mrp IS NOT NULL AND NEW.mrp > 0) ? NEW.mrp : master.mrp_max
      CASE WHEN i.mrp IS NOT NULL AND i.mrp > 0 THEN i.mrp ELSE mm.mrp_max END AS v_ref
    FROM input i
    LEFT JOIN LATERAL (
      SELECT id, mrp_max
      FROM master_medicines
      WHERE lower(name) = lower(i.name) AND is_active = true
      ORDER BY id
      LIMIT 1
    ) mm ON true
  ),
  classified AS (
    SELECT m.*,
      CASE
        WHEN m.medicine_id IS NULL THEN 'unmatched'
        -- trigger: FAIL iff selling_price NOT NULL AND v_ref NOT NULL AND v_ref > 0 AND selling_price > v_ref
        WHEN m.selling_price IS NOT NULL
             AND m.v_ref IS NOT NULL
             AND m.v_ref > 0
             AND m.selling_price > m.v_ref
          THEN 'failed'
        ELSE 'ok'
      END AS bucket
    FROM matched m
  ),
  -- Ek hi chunk mein same medicine 2 baar aaye to last wins (per-row
  -- upsert loop bhi yahi karta tha). ON CONFLICT ek command mein dobaraa
  -- same row affect nahi kar sakta, isliye pehle dedupe.
  dedup AS (
    SELECT DISTINCT ON (medicine_id) *
    FROM classified
    WHERE bucket = 'ok'
    ORDER BY medicine_id, idx DESC
  ),
  ins AS (
    INSERT INTO seller_inventory AS si (
      seller_id, medicine_id, selling_price, mrp, stock_quantity, unit,
      expiry_date, batch_number, is_available, min_order_quantity
    )
    SELECT
      p_seller_id, medicine_id, COALESCE(selling_price, 0), mrp, stock, unit,
      expiry_date, batch_number, (stock > 0), min_order_quantity
    FROM dedup
    ON CONFLICT (seller_id, medicine_id) DO UPDATE SET
      selling_price      = EXCLUDED.selling_price,
      mrp                = COALESCE(EXCLUDED.mrp, si.mrp),   -- mrp_mode OFF: naya mrp NULL -> purana untouched
      stock_quantity     = EXCLUDED.stock_quantity,
      unit               = EXCLUDED.unit,
      expiry_date        = EXCLUDED.expiry_date,
      batch_number       = EXCLUDED.batch_number,
      is_available       = EXCLUDED.is_available,
      min_order_quantity = EXCLUDED.min_order_quantity,
      updated_at         = NOW()
    RETURNING 1
  )
  SELECT jsonb_build_object(
    'added',     (SELECT count(*) FROM classified WHERE bucket = 'ok'),
    'unmatched', COALESCE((SELECT jsonb_agg(name ORDER BY idx)
                           FROM classified WHERE bucket = 'unmatched'), '[]'::jsonb),
    'failed',    COALESCE((SELECT jsonb_agg(name || ' (selling price MRP se zyada)' ORDER BY idx)
                           FROM classified WHERE bucket = 'failed'), '[]'::jsonb),
    'upserted',  (SELECT count(*) FROM ins)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_add_seller_inventory(uuid, jsonb) TO authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- Timeout attribute laga:
--   SELECT proconfig FROM pg_proc WHERE proname = 'bulk_add_seller_inventory';
--   -- {search_path=public, statement_timeout=60s}
-- Index-scan (seq-scan nahi):
--   EXPLAIN SELECT id FROM master_medicines
--   WHERE lower(name) = lower('Doxid') AND is_active = true ORDER BY id LIMIT 1;
--   -- expect: Index Scan using idx_master_medicines_lower_name
-- RPC smoke (apne seller id se):
--   SELECT bulk_add_seller_inventory('<my-seller-id>'::uuid,
--     '[{"name":"Doxid","stock":10,"selling_price":50,"mrp":60,"unit":"strips"}]'::jsonb);

-- ================================================================
-- ROLLBACK — 042 ka version wapas (bina SET statement_timeout ke):
--   042_bulkSellerInventory.sql dobara chala do.
-- ================================================================
