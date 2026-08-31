-- ══════════════════════════════════════════════════
-- MedSetu — BUG: customer-side medicine feed HTTP 414
-- Root: fetchPopularMedicines / searchMedicines (api.js) pehle
-- seller_inventory se ~1000-3202 medicine_id nikaalti hain, phir
-- master_medicines.in('id', [poori list]) karti hain -> request URL
-- ~37-118 KB -> gateway 414 -> error swallow -> empty-state.
-- Fix: yeh single RPC join + filter + section-split + cheapest-price +
-- LIMIT/OFFSET sab DB-side karta hai; client sirf jsonb result leta hai,
-- koi id-list URL mein nahi jaati.
--
-- SECURITY INVOKER — seller_inventory & master_medicines dono par SELECT
-- RLS already USING (true) (013_rlsPhase4 / 010_rlsPhase1), to caller
-- (anon/authenticated) ke role se hi padh sakte hain, bypass ki zaroorat
-- nahi (get_routing_candidates jaisa DEFINER yahan nahi chahiye).
--
-- Return shape (jsonb), client-side mapping tootne se bachne ke liye
-- current api.js output ke barabar:
--   search  -> { mode:"search", janaushadhi:[...], generic:[...], branded:[...] }
--   popular -> { mode:"popular", items:[...] }
--   har element = master_medicines row (to_jsonb) + "sellerPrice" key
--   (bilkul purane attachSellerPrice output jaisa).
--
-- Section-split: teeno disjoint —
--   janaushadhi : source = 'janaushadhi'
--   generic     : is_generic = true  AND source <> 'janaushadhi'
--   branded     : is_generic = false AND source <> 'janaushadhi'
-- (real data mein source='janaushadhi' => is_generic=true, to purane
--  searchMedicines ke `is_generic=false`-only branded query jaisa hi hai;
--  `source <> 'janaushadhi'` sirf hand-inserted anomaly row ke liye extra
--  guard hai taaki duplicate kabhi na aaye.)
--
-- Depends on: 003_masterMedicine.sql, 022_mrpMode.sql (seller_inventory.mrp),
--             024_sellerHidden.sql (seller_hidden), 035_isGenericUnit.sql
--             (master_medicines.is_generic, .unit).
-- Run this in Supabase SQL Editor.
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_customer_medicines(
  p_query    text    DEFAULT NULL,
  p_mrp_mode boolean DEFAULT false,
  p_limit    integer DEFAULT 12,
  p_offset   integer DEFAULT 0
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

GRANT EXECUTE ON FUNCTION get_customer_medicines(text, boolean, integer, integer)
  TO anon, authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- Popular (query NULL) — up to 12 items, koi 414 nahi:
--   SELECT jsonb_array_length(get_customer_medicines(NULL, false, 12, 0) -> 'items');
-- Search "doxid" — 3 sections:
--   SELECT get_customer_medicines('doxid', false, 5, 0);
-- mrp_mode ON branch:
--   SELECT jsonb_array_length(get_customer_medicines(NULL, true, 12, 0) -> 'items');
-- Har element mein sellerPrice key honi chahiye:
--   SELECT (get_customer_medicines(NULL, false, 3, 0) -> 'items' -> 0) ? 'sellerPrice';
-- Sections disjoint (search) — koi id do section mein na ho:
--   WITH r AS (SELECT get_customer_medicines('tab', false, 50, 0) AS d)
--   SELECT count(*) AS dupes FROM (
--     SELECT (e ->> 'id') id, count(*) c
--     FROM r, LATERAL (
--       SELECT jsonb_array_elements(d->'janaushadhi') e FROM r
--       UNION ALL SELECT jsonb_array_elements(d->'generic') FROM r
--       UNION ALL SELECT jsonb_array_elements(d->'branded') FROM r
--     ) s GROUP BY 1 HAVING count(*) > 1
--   ) q;   -- expect 0

-- ================================================================
-- ROLLBACK
-- ================================================================
-- DROP FUNCTION IF EXISTS get_customer_medicines(text, boolean, integer, integer);
