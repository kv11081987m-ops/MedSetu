-- ══════════════════════════════════════════════════
-- MedSetu — bulk_add_seller_inventory: hybrid ingestion
-- 044 ka RPC sirf normalize_med_name() exact-token match par depend karta
-- tha — jo Marg-shorthand seller CSVs (pack-size glued to unit, e.g.
-- "1*21TAB") par ~15% hi match karta hai (measured: 446/3049 rows).
-- Baaki rows "unmatched" bucket me chali jaati thi aur customer ko kabhi
-- nahi dikhti (master-link required for get_customer_medicines()).
--
-- Fix — hybrid ingestion:
--   exactly-1 normalize_med_name() match  -> master medicine_id use karo
--                                             (Rx-flag automatically master
--                                             se inherit hota hai, kyunki
--                                             requires_prescription master
--                                             row par hi stored hai — koi
--                                             extra code nahi chahiye).
--   0 ya ambiguous(>1) match               -> seller-sourced: master_medicines
--                                             me nayi row (source='seller',
--                                             mrp_max=seller ka apna mrp,
--                                             requires_prescription=true —
--                                             safe default jab tak verify
--                                             na ho). Re-upload par SAME
--                                             normalized-name + source='seller'
--                                             row REUSE hoti hai (duplicate
--                                             nahi banta).
--   mrp na ho AND match bhi na ho          -> skip (skipped_no_mrp me report,
--                                             kyunki customer-visibility ko
--                                             mrp_max > 0 chahiye — Q2 dekho).
--   MRP-guard                              -> purana EXACT rule same:
--                                             ref := (own mrp>0) ? own mrp
--                                                    : master.mrp_max;
--                                             selling_price > ref => failed.
--   seller_inventory upsert                -> purana ON CONFLICT logic same.
--
-- Implementation note: seller-sourced create+reuse ko ek hi CTE/INSERT me
-- mix NAHI kiya (temp-table-from-CTE Postgres me flaky/error-prone) — do
-- saaf steps: (1) reuse-mapping ek plain INSERT...SELECT se _sslink me,
-- (2) jo bache unke liye INSERT...RETURNING se master_medicines me naya row,
-- phir uska id bhi _sslink me. Dono steps alag statements hain.
--
-- Purane bulk_add_seller_inventory (044) ko REPLACE karta hai.
-- Depends on: 044_normalizeMatch.sql (normalize_med_name + functional index)
-- Run this in Supabase SQL Editor (044 ke baad).
--
-- Rollback: DELETE FROM master_medicines WHERE source = 'seller';
--           (phir 044_normalizeMatch.sql ka CREATE OR REPLACE FUNCTION
--           bulk_add_seller_inventory (3) dobara chala do — purana behaviour
--           wapas aa jaayega.)
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bulk_add_seller_inventory(p_seller_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- ── Ownership check: purane jaisा byte-same ──
  IF NOT EXISTS (
    SELECT 1 FROM sellers s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = p_seller_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR is_active_superadmin())
  ) THEN
    RAISE EXCEPTION 'Not authorized for seller %', p_seller_id USING errcode = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('matched', 0, 'seller_sourced', 0, 'upserted', 0,
                              'skipped_no_mrp', '[]'::jsonb, 'failed', '[]'::jsonb);
  END IF;

  -- ON COMMIT DROP temp tables sirf transaction-end par drop hoti hain, statement-end
  -- par nahi — agar ye function kabhi same transaction me 2+ baar call ho (retry logic,
  -- ya SQL-editor se manual double-call), "relation already exists" milta. Defensive drop:
  DROP TABLE IF EXISTS _in, _mm, _res, _ss, _sslink, _final;

  -- 1) parse input
  CREATE TEMP TABLE _in ON COMMIT DROP AS
  SELECT
    btrim(r->>'name')                                    AS name,
    normalize_med_name(btrim(r->>'name'))                AS nname,
    COALESCE(NULLIF(r->>'stock','')::int, 0)             AS stock,
    COALESCE(NULLIF(r->>'selling_price','')::numeric, 0) AS selling_price,
    NULLIF(r->>'mrp', '')::numeric                       AS mrp,
    COALESCE(NULLIF(r->>'unit', ''), 'strips')           AS unit,
    NULLIF(r->>'expiry_date', '')::date                  AS expiry_date,
    NULLIF(r->>'batch_number', '')                       AS batch_number,
    COALESCE(NULLIF(r->>'min_order_quantity', '')::int, 1) AS moq,
    NULLIF(r->>'commission_band', '')                    AS commission_band,
    NULLIF(r->>'dosage_form', '')                        AS dosage_form,
    ord.idx
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS ord(r, idx)
  WHERE btrim(COALESCE(r->>'name', '')) <> '';

  -- 2) count master matches per normalized name (0 / 1 / >1)
  CREATE TEMP TABLE _mm ON COMMIT DROP AS
  SELECT i.idx,
         (SELECT count(*) FROM master_medicines mm
            WHERE mm.is_active AND normalize_med_name(mm.name) = i.nname) AS mcount,
         (SELECT mm.id FROM master_medicines mm
            WHERE mm.is_active AND normalize_med_name(mm.name) = i.nname
            ORDER BY mm.id LIMIT 1) AS one_id
  FROM _in i;

  -- 3) resolve medicine_id for every row (NULL if 0-or-ambiguous)
  CREATE TEMP TABLE _res ON COMMIT DROP AS
  SELECT i.*, m.mcount,
         CASE WHEN m.mcount = 1 THEN m.one_id ELSE NULL END AS matched_id
  FROM _in i JOIN _mm m USING (idx);

  -- 4) seller-sourced candidates: 0-or-ambiguous match, but HAVE own mrp>0
  CREATE TEMP TABLE _ss ON COMMIT DROP AS
  SELECT DISTINCT ON (nname) nname, name, mrp, commission_band, dosage_form
  FROM _res
  WHERE matched_id IS NULL AND mrp IS NOT NULL AND mrp > 0
  ORDER BY nname, idx;

  -- 5) _sslink: nname -> master_medicines.id resolution for seller-sourced rows.
  --    Do saaf steps (CTE-in-temp-table se bachne ke liye) —
  CREATE TEMP TABLE _sslink (nname text PRIMARY KEY, id uuid) ON COMMIT DROP;

  -- 5a) REUSE: pehle se maujood source='seller' row with same normalized name
  INSERT INTO _sslink (nname, id)
  SELECT s.nname,
         (SELECT mm.id FROM master_medicines mm
            WHERE mm.source = 'seller' AND normalize_med_name(mm.name) = s.nname
            ORDER BY mm.id LIMIT 1)
  FROM _ss s
  WHERE EXISTS (
    SELECT 1 FROM master_medicines mm
    WHERE mm.source = 'seller' AND normalize_med_name(mm.name) = s.nname
  );

  -- 5b) CREATE: jo abhi bhi resolve nahi hue, unke liye nayi master row
  WITH to_create AS (
    SELECT s.* FROM _ss s
    WHERE NOT EXISTS (SELECT 1 FROM _sslink l WHERE l.nname = s.nname)
  ),
  created AS (
    INSERT INTO master_medicines
      (name, mrp_max, requires_prescription, source, is_active, is_verified, commission_band, dosage_form)
    SELECT name, mrp, true, 'seller', true, false,
      commission_band,   -- NULL hoga to column ka default chalega
      dosage_form
    FROM to_create
    RETURNING id, normalize_med_name(name) AS nname
  )
  INSERT INTO _sslink (nname, id)
  SELECT nname, id FROM created;

  -- 6) final medicine_id per row (matched OR seller-sourced OR still-null)
  CREATE TEMP TABLE _final ON COMMIT DROP AS
  SELECT r.*,
         COALESCE(r.matched_id, l.id) AS medicine_id,
         (r.matched_id IS NOT NULL)   AS was_matched
  FROM _res r
  LEFT JOIN _sslink l ON l.nname = r.nname;

  -- 6b) master-matched rows: CSV se dosage_form aaya ho aur master row
  -- abhi NULL ho, to backfill kar do (seller-sourced naye rows ke liye
  -- dosage_form already 5b ke INSERT me set ho chuka hai, isliye yahan
  -- sirf was_matched rows chahiye).
  UPDATE master_medicines mm
  SET dosage_form = f.dosage_form
  FROM _final f
  WHERE mm.id = f.medicine_id
    AND f.was_matched
    AND mm.dosage_form IS NULL
    AND f.dosage_form IS NOT NULL;

  -- 7) MRP-guard (purane jaisа exact rule) + 8) upsert
  WITH ref AS (
    SELECT f.*,
      COALESCE(NULLIF(f.mrp, 0), mm.mrp_max) AS v_ref, mm.mrp_max AS master_mrp
    FROM _final f JOIN master_medicines mm ON mm.id = f.medicine_id
    WHERE f.medicine_id IS NOT NULL
  ),
  ok AS (
    SELECT * FROM ref
    WHERE NOT (selling_price IS NOT NULL AND v_ref IS NOT NULL AND v_ref > 0 AND selling_price > v_ref)
  ),
  dedup AS (
    SELECT DISTINCT ON (medicine_id) * FROM ok ORDER BY medicine_id, idx DESC
  ),
  ins AS (
    INSERT INTO seller_inventory AS si
      (seller_id, medicine_id, selling_price, mrp, stock_quantity, unit,
       expiry_date, batch_number, is_available, min_order_quantity)
    SELECT p_seller_id, medicine_id,
           CASE WHEN selling_price > 0 THEN selling_price ELSE COALESCE(NULLIF(mrp, 0), master_mrp) END,
           mrp, stock, unit, expiry_date, batch_number, (stock > 0), moq
    FROM dedup
    ON CONFLICT (seller_id, medicine_id) DO UPDATE SET
      selling_price      = EXCLUDED.selling_price,
      mrp                = COALESCE(EXCLUDED.mrp, si.mrp),
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
    'matched',        (SELECT count(*) FROM _final WHERE was_matched),
    'seller_sourced', (SELECT count(*) FROM _final WHERE NOT was_matched AND medicine_id IS NOT NULL),
    'upserted',       (SELECT count(*) FROM ins),
    'skipped_no_mrp', COALESCE((SELECT jsonb_agg(name ORDER BY idx)
                       FROM _res WHERE matched_id IS NULL AND (mrp IS NULL OR mrp <= 0)), '[]'::jsonb),
    'failed',         COALESCE((SELECT jsonb_agg(name || ' (selling price MRP se zyada)' ORDER BY idx)
                       FROM ref WHERE selling_price > v_ref AND v_ref > 0), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION bulk_add_seller_inventory(uuid, jsonb) TO authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- RPC smoke (apne seller id se, seller-session mein):
--   SELECT bulk_add_seller_inventory('<my-seller-id>'::uuid,
--     '[{"name":"Doxid","stock":10,"selling_price":50,"mrp":60,"unit":"strips"},
--       {"name":"Totally Unknown Brand XYZ","stock":5,"selling_price":40,"mrp":50,"unit":"strips"}]'::jsonb);
--   -- expect: matched=1 (Doxid, agar master me hai), seller_sourced=1 (XYZ,
--   --         naya master_medicines row source='seller' banega),
--   --         upserted=2, skipped_no_mrp=[], failed=[]
-- Re-run same payload dobara -> seller_sourced row REUSE honi chahiye
-- (master_medicines me XYZ ka DUPLICATE row NAHI banna chahiye):
--   SELECT count(*) FROM master_medicines WHERE source='seller' AND normalize_med_name(name)=normalize_med_name('Totally Unknown Brand XYZ');
--   -- expect: 1

-- ================================================================
-- ROLLBACK
-- ================================================================
-- 1) Naye seller-sourced master rows hata do (CAUTION: agar unpar already
--    orders/seller_inventory bana hai to un rows ko bhi pehle handle karo):
--    DELETE FROM master_medicines WHERE source = 'seller';
-- 2) Function purane (044) version par wapas le jao —
--    044_normalizeMatch.sql ka CREATE OR REPLACE FUNCTION bulk_add_seller_inventory (3) dobara chalao.
-- ================================================================
