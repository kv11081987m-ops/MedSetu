-- ══════════════════════════════════════════════════
-- MedSetu — Hyphen/symbol-insensitive medicine search (pg_trgm)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- get_customer_medicines (040_customerMedicineFeed.sql, dosage_form filter
-- added by 041_categoryFeed.sql) has always matched via plain
-- `name ILIKE '%term%'` — a leading wildcard, so it can't use a btree or
-- even the existing to_tsvector GIN index (idx_master_medicines_name);
-- every search is a sequential-ish scan. It's also symbol-sensitive: a
-- customer typing "Abflo" never matches a master row stored as "AB-FLO"
-- or "AB FLO" because the hyphen/space breaks the substring match.
--
-- pg_trgm is already installed on this DB (confirmed via
-- `SELECT * FROM pg_extension WHERE extname='pg_trgm'` — extversion 1.6)
-- but nothing uses it yet. This migration:
--   1. Adds clean_search_text() — strips everything but letters/digits and
--      uppercases, so "AB-FLO", "ab flo" and "ABFLO" all normalize to the
--      same "ABFLO" string on both the column side and the query side.
--   2. Adds trigram GIN indexes on the cleaned expression for name/
--      generic_name/salt_composition — 250k+ row table, ILIKE '%term%'
--      needs gin_trgm_ops specifically (an expression index, since the
--      indexed value is clean_search_text(col) not the raw column).
--   3. Points get_customer_medicines's WHERE at the cleaned comparison.
--      Only that OR-block changes — avail CTE, mrp_max>0 gate,
--      dosage_form filter, per-section ordering/caps are untouched, and
--      the function is reproduced here in full only because
--      CREATE OR REPLACE FUNCTION requires the whole body.
--
-- The old idx_master_medicines_name (to_tsvector GIN) and
-- idx_master_medicines_lower_name are left in place — dropping unused
-- indexes is a separate decision, out of scope here.


-- ================================================================
-- 1. clean_search_text(p_text) — symbol/space-insensitive normalize
-- ================================================================
CREATE OR REPLACE FUNCTION clean_search_text(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(coalesce(p_text,''), '[^a-zA-Z0-9]', '', 'g'))
$$;


-- ================================================================
-- 2. pg_trgm + expression GIN indexes
-- ================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_master_medicines_name_clean_trgm
ON master_medicines USING gin (clean_search_text(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_master_medicines_generic_clean_trgm
ON master_medicines USING gin (clean_search_text(generic_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_master_medicines_salt_clean_trgm
ON master_medicines USING gin (clean_search_text(salt_composition) gin_trgm_ops);


-- ================================================================
-- 3. get_customer_medicines — same function, only the search OR-block
--    in the `base` CTE's WHERE now goes through clean_search_text().
-- ================================================================
CREATE OR REPLACE FUNCTION get_customer_medicines(
  p_query       text    DEFAULT NULL,
  p_mrp_mode    boolean DEFAULT false,
  p_limit       integer DEFAULT 12,
  p_offset      integer DEFAULT 0,
  p_dosage_form text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public' AS $function$
DECLARE
  -- search mode tabhi jab query 2+ (non-blank) chars — warna "popular"
  v_search boolean := (p_query IS NOT NULL AND length(btrim(p_query)) >= 2);
  v_lim    integer := GREATEST(1, LEAST(COALESCE(p_limit, 12), 50));
  v_off    integer := GREATEST(0, COALESCE(p_offset, 0));
  v_result jsonb;
BEGIN
  WITH avail AS (
    -- Har medicine jiske paas current mode mein kam se kam ek visible
    -- seller_inventory row hai + us par cheapest price (kai seller ho to MIN).
    -- mrp_mode OFF: is_available + stock>0, price = selling_price
    -- mrp_mode ON : seller_hidden=false,   price = seller ka mrp
    SELECT
      si.medicine_id,
      MIN(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END)
        FILTER (
          WHERE COALESCE(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END, 0) > 0
        ) AS min_price
    FROM seller_inventory si
    WHERE CASE
            WHEN p_mrp_mode THEN si.seller_hidden = false
            ELSE si.is_available = true AND si.stock_quantity > 0
          END
    GROUP BY si.medicine_id
  ),
  base AS (
    SELECT
      mm.id,
      mm.mrp_max,
      mm.source,
      mm.is_generic,
      to_jsonb(mm) || jsonb_build_object(
        'sellerPrice',
        CASE
          -- mrp_mode ON: seller ka apna mrp jeeta, warna master mrp_max
          -- (effectiveMrp() ke barabar). mrp_max WHERE se hamesha >0.
          WHEN p_mrp_mode THEN COALESCE(NULLIF(a.min_price, 0), mm.mrp_max)
          -- mrp_mode OFF: cheapest selling_price (null ho sakta hai —
          -- mapMedicine tab mrp_max par fallback karta hai, aaj jaisa)
          ELSE a.min_price
        END
      ) AS j
    FROM master_medicines mm
    JOIN avail a ON a.medicine_id = mm.id
    WHERE mm.is_active = true
      AND mm.mrp_max  > 0
      -- category-browse ke liye dosage_form filter (NULL = sab, aaj jaisा)
      AND (p_dosage_form IS NULL OR mm.dosage_form = p_dosage_form)
      AND (
        NOT v_search
        -- 070_improveSearch.sql: symbol/hyphen-insensitive match via
        -- clean_search_text() + trigram GIN indexes, in place of the old
        -- plain `mm.name ILIKE '%' || p_query || '%'` OR-block.
        OR clean_search_text(mm.name)             ILIKE '%' || clean_search_text(p_query) || '%'
        OR clean_search_text(mm.generic_name)     ILIKE '%' || clean_search_text(p_query) || '%'
        OR clean_search_text(mm.salt_composition) ILIKE '%' || clean_search_text(p_query) || '%'
      )
  )
  SELECT CASE WHEN v_search THEN
    jsonb_build_object(
      'mode', 'search',
      -- sections disjoint + per-section cap + ordering — aaj ke 3 alag
      -- queries jaisa (jan/generic mrp_max ASC, branded DESC, limit 5).
      'janaushadhi', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max ASC)
        FROM (SELECT j, mrp_max FROM base
              WHERE source = 'janaushadhi'
              ORDER BY mrp_max ASC LIMIT v_lim) x), '[]'::jsonb),
      'generic', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max ASC)
        FROM (SELECT j, mrp_max FROM base
              WHERE is_generic = true AND source IS DISTINCT FROM 'janaushadhi'
              ORDER BY mrp_max ASC LIMIT v_lim) x), '[]'::jsonb),
      'branded', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max DESC)
        FROM (SELECT j, mrp_max FROM base
              WHERE is_generic = false AND source IS DISTINCT FROM 'janaushadhi'
              ORDER BY mrp_max DESC LIMIT v_lim) x), '[]'::jsonb)
    )
  ELSE
    -- popular / category-browse dono yahi — flat items[], mrp_max ASC, paged
    jsonb_build_object(
      'mode', 'popular',
      'items', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max ASC)
        FROM (SELECT j, mrp_max FROM base
              ORDER BY mrp_max ASC
              LIMIT v_lim OFFSET v_off) x), '[]'::jsonb)
    )
  END
  INTO v_result;

  RETURN v_result;
END;
$function$;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- 1. Function updated (search_path/body reflects clean_search_text):
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'get_customer_medicines';
--   -- expect: body contains 'clean_search_text' in the WHERE block.

-- 2. Symbol-insensitive match — searching "Abflo" should reach a row
--    stored as "AB-FLO" (or similar), since both clean to "ABFLO":
-- SELECT name FROM master_medicines WHERE clean_search_text(name) ILIKE '%ABFLO%';

-- 3. Trigram index actually used (Bitmap Index Scan, not Seq Scan):
-- EXPLAIN ANALYZE
-- SELECT id FROM master_medicines WHERE clean_search_text(name) ILIKE '%ABFLO%';

-- Real-session check: searchMedicines('Abflo') via the RPC itself —
-- SELECT get_customer_medicines(p_query := 'Abflo');
--   -- expect any "AB-FLO"/"AB FLO"-style row to now appear in whichever
--   -- section (branded/generic/janaushadhi) it belongs to.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Restores get_customer_medicines to the pre-070 plain-ILIKE body
-- (040_customerMedicineFeed.sql + 041_categoryFeed.sql's p_dosage_form
-- addition) if the trigram approach needs to be backed out:
--
-- CREATE OR REPLACE FUNCTION get_customer_medicines(
--   p_query text DEFAULT NULL, p_mrp_mode boolean DEFAULT false,
--   p_limit integer DEFAULT 12, p_offset integer DEFAULT 0,
--   p_dosage_form text DEFAULT NULL
-- ) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
--   -- ... same body as above, with the WHERE OR-block reverted to:
--   --   OR mm.name             ILIKE '%' || p_query || '%'
--   --   OR mm.generic_name     ILIKE '%' || p_query || '%'
--   --   OR mm.salt_composition ILIKE '%' || p_query || '%'
-- $function$;
--
-- DROP INDEX IF EXISTS idx_master_medicines_salt_clean_trgm;
-- DROP INDEX IF EXISTS idx_master_medicines_generic_clean_trgm;
-- DROP INDEX IF EXISTS idx_master_medicines_name_clean_trgm;
-- DROP FUNCTION IF EXISTS clean_search_text(text);
-- -- pg_trgm left installed (other objects may come to depend on it).
