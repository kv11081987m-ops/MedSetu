-- ══════════════════════════════════════════════════
-- MedSetu — Category browse ko bhi 414 se bachao + RPC extend
-- fetchMedicinesByCategory (api.js) mein wahi 2-step bug tha:
-- seller_inventory se ~1000-3202 medicine_id -> master_medicines
-- .in('id', [poori list]) + .eq('dosage_form', ...) -> URL 37-118 KB
-- -> HTTP 414 -> CategoriesScreen silently "Is category mein abhi
-- medicine nahi".
--
-- Fix: 040 ke get_customer_medicines RPC ko ek optional dosage_form
-- filter se extend karo. Category-browse = "popular mode" + dosage_form
-- filter (flat items[], mrp_max ASC, LIMIT) — CategoriesScreen ka
-- consumer contract Home jaisा hi hai.
--
-- ⚠️ Postgres mein naya param add karne se function OVERLOAD ban jaata
-- (4-arg + 5-arg dono) -> PostgREST ambiguity. Isliye pehle purana
-- 4-arg signature DROP, phir ek hi 5-arg (5th DEFAULT NULL) CREATE.
-- Purane callers (fetchPopularMedicines/searchMedicines) 4 named args
-- bhejte hain; 5th default NULL se bhar jaata hai -> nahi tootte
-- (api.js mein waise bhi explicit p_dosage_form:null add kiya ja raha).
--
-- ⚠️ Agar 040 ko kabhi is file ke BAAD dobara chalaya, to 4-arg wapas
-- ban jaayega -> overload. Migrations order mein ek baar chalti hain,
-- normal flow mein issue nahi.
--
-- Depends on: 040_customerMedicineFeed.sql (yahi function), 003/022/024/035.
-- Run this in Supabase SQL Editor.
-- ══════════════════════════════════════════════════

-- 1) Purana 4-arg signature hatao (overload rokne ke liye)
DROP FUNCTION IF EXISTS get_customer_medicines(text, boolean, integer, integer);

-- 2) Naya 5-arg — p_dosage_form optional, baaki logic 040 jaisा hi
CREATE OR REPLACE FUNCTION get_customer_medicines(
  p_query       text    DEFAULT NULL,
  p_mrp_mode    boolean DEFAULT false,
  p_limit       integer DEFAULT 12,
  p_offset      integer DEFAULT 0,
  p_dosage_form text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
      -- NAYA: category-browse ke liye dosage_form filter (NULL = sab, aaj jaisा)
      AND (p_dosage_form IS NULL OR mm.dosage_form = p_dosage_form)
      AND (
        NOT v_search
        OR mm.name             ILIKE '%' || p_query || '%'
        OR mm.generic_name     ILIKE '%' || p_query || '%'
        OR mm.salt_composition ILIKE '%' || p_query || '%'
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
$$;

GRANT EXECUTE ON FUNCTION get_customer_medicines(text, boolean, integer, integer, text)
  TO anon, authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- Purana 4-arg gone, sirf 5-arg hai:
--   SELECT pg_get_function_identity_arguments(oid)
--   FROM pg_proc WHERE proname = 'get_customer_medicines';
--   -- expect exactly one row:
--   -- "p_query text, p_mrp_mode boolean, p_limit integer, p_offset integer, p_dosage_form text"
-- Category feed:
--   SELECT jsonb_array_length(get_customer_medicines(NULL, false, 50, 0, 'Tablet') -> 'items');
-- Home still works (5th omitted / NULL):
--   SELECT jsonb_array_length(get_customer_medicines(NULL, false, 30, 0) -> 'items');
--   SELECT jsonb_array_length(get_customer_medicines(NULL, false, 30, 0, NULL) -> 'items');
-- Search still works:
--   SELECT get_customer_medicines('doxid', false, 5, 0, NULL);

-- ================================================================
-- ROLLBACK — 040 ka 4-arg version wapas laana ho to:
--   DROP FUNCTION IF EXISTS get_customer_medicines(text, boolean, integer, integer, text);
--   -- phir 040_customerMedicineFeed.sql dobara chala do
-- ================================================================
