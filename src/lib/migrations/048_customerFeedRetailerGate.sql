-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator, Chunk 2a: customer feed wholesaler-leak fix
-- Run this in Supabase SQL Editor. DB me abhi RUN nahi hua — review ke
-- baad chalana.
--
-- BUG (047_aggregatorStaff.sql ki investigation me mila, isse pehle
-- kabhi note nahi hua tha): get_customer_medicines RPC (040/041) ki
-- `avail` CTE seller_inventory ko seedha padhti hai — sellers se JOIN
-- karke seller_type kabhi check nahi karti. Matlab agar kisi wholesaler
-- seller ka seller_inventory row is_available=true/stock>0 (mrp_mode OFF)
-- ya seller_hidden=false (mrp_mode ON) hai, wo customer ke Home/Search/
-- Category feed me LEAK ho jaata hai — customer seedha wholesaler se
-- kharид sakta hai, jo pharmacy-safety/business model dono ke against hai
-- (wholesaler sirf B2B/retailer-facing hona chahiye, customer-facing nahi).
-- Aaj tak yeh gate sirf client-side tha — fetchSellersForMedicine
-- (api.js:233) ka `.filter((row) => row.sellers?.seller_type === 'retailer')`
-- — jo sirf ek hi call-site (seller-detail modal) ko cover karta hai,
-- Home/Search/Category ka get_customer_medicines RPC path bilkul
-- unprotected hai.
--
-- Fix: `avail` CTE me seller_inventory-to-sellers JOIN add karo, aur
-- WHERE me `seller_type = 'retailer' OR is_aggregator = true` laga do —
-- aggregator (047's naya flag) customer-facing hai isliye dikhna chahiye,
-- wholesaler kabhi nahi. Baaki poora function body 041_categoryFeed.sql
-- se HU-BA-HU (join shape/cheapest-price/search-sections/limit-offset/
-- dosage_form sab same) — is file me sirf `avail` CTE ka FROM/WHERE badla
-- hai, kuch aur nahi.
--
-- ⚠️ OVERLOAD GOTCHA (041 ke apne comment se, dobara na ho isliye yahan
-- bhi likh raha): signature bilkul 041 wala 5-arg hi rakha hai (p_query,
-- p_mrp_mode, p_limit, p_offset, p_dosage_form) — koi naya param nahi,
-- koi DROP FUNCTION nahi. CREATE OR REPLACE same arg-types par sirf body
-- replace karta hai, naya overload nahi banata — is migration ke baad bhi
-- get_customer_medicines ka EXACTLY ek hi (5-arg) version rahega.
--
-- Depends on: 041_categoryFeed.sql (yahi function, jiska body replace ho
-- raha), 047_aggregatorStaff.sql (sellers.is_aggregator column — is file
-- se PEHLE run hona zaroori, warna neeche wala JOIN condition error dega:
-- column "is_aggregator" does not exist).
--
-- NOT changed here (deliberately, per request): api.js:233 ka client-side
-- retailer-only .filter() — ab RPC-level gate ke baad redundant hai wahan
-- (get_customer_medicines ab khud wholesaler kabhi laata hi nahi), par
-- double-safety ke liye hataya nahi. fetchSellersForMedicine khud is RPC
-- se alag hai (seller-detail modal, seedha seller_inventory join karta
-- hai) — chaho to ek future chunk me usse bhi yahi seller_type/is_aggregator
-- gate DB-side de sakte hain, abhi scope se bahar.
-- ══════════════════════════════════════════════════

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
    -- NAYA (048): sellers se JOIN + seller_type/is_aggregator gate —
    -- customer feed me sirf retailer + aggregator ka stock, wholesaler
    -- KABHI nahi (see this file's header).
    SELECT
      si.medicine_id,
      MIN(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END)
        FILTER (
          WHERE COALESCE(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END, 0) > 0
        ) AS min_price
    FROM seller_inventory si
    JOIN sellers s ON s.id = si.seller_id
    WHERE (s.seller_type = 'retailer' OR s.is_aggregator = true)
      AND CASE
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

-- Signature abhi bhi exactly ek 5-arg (koi overload nahi bana):
--   SELECT pg_get_function_identity_arguments(oid)
--   FROM pg_proc WHERE proname = 'get_customer_medicines';
--   -- expect exactly ONE row:
--   -- "p_query text, p_mrp_mode boolean, p_limit integer, p_offset integer, p_dosage_form text"

-- Setup ek test case (real IDs se replace karke):
--   1. Ek wholesaler seller (seller_type='wholesaler', is_aggregator=false)
--      lo, uske seller_inventory me EK medicine ko is_available=true,
--      stock_quantity=10 rakho, JISKA koi retailer/aggregator stock na ho
--      (fresh/unique medicine_id chuno taaki doosre seller na overlap karein).
--   2. Ek retailer seller ka koi medicine (jo already available hai) note karo.
--   3. Ek aggregator seller (is_aggregator=true, seller_type kuch bhi) ka
--      bhi ek available medicine note karo (047 ke baad kisi seller par
--      UPDATE sellers SET is_aggregator=true karke test karo).

-- Wholesaler-only medicine ab feed me NAHI (leak band):
--   SELECT get_customer_medicines(NULL, false, 50, 0)
--     -> 'items' me us wholesaler-only medicine_id ka element DHOONDO
--     -- expect: nahi milega (0 matches)
--   -- ya seedha count se:
--   SELECT EXISTS (
--     SELECT 1 FROM jsonb_array_elements(
--       get_customer_medicines(NULL, false, 50, 0) -> 'items'
--     ) e WHERE (e ->> 'id') = '<wholesaler-only medicine_id>'
--   );  -- expect false

-- Retailer wali medicine dikhti rahe (regression check):
--   SELECT EXISTS (
--     SELECT 1 FROM jsonb_array_elements(
--       get_customer_medicines(NULL, false, 50, 0) -> 'items'
--     ) e WHERE (e ->> 'id') = '<retailer medicine_id>'
--   );  -- expect true

-- Aggregator wali medicine bhi dikhe (naya coverage):
--   SELECT EXISTS (
--     SELECT 1 FROM jsonb_array_elements(
--       get_customer_medicines(NULL, false, 50, 0) -> 'items'
--     ) e WHERE (e ->> 'id') = '<aggregator medicine_id>'
--   );  -- expect true

-- Search aur category-browse bhi isi gate ke peeche (mode='search' /
-- p_dosage_form diya hua dono verify karo, same wholesaler-only id se):
--   SELECT get_customer_medicines('<wholesaler-only medicine ka naam>', false, 5, 0);
--   -- teeno section (janaushadhi/generic/branded) me wo id kahin na ho
--   SELECT get_customer_medicines(NULL, false, 50, 0, '<uska dosage_form>');
--   -- items[] me wo id na ho

-- mrp_mode ON branch bhi (seller_hidden=false wholesaler row) same tarah
-- gate ho (upar wala pura set p_mrp_mode=true ke saath dobara chalao).

-- Real app checks:
--   1. CustomerHome/MedicineSearch/CategoriesScreen — wholesaler-only
--      medicine kahin na dikhe.
--   2. Retailer/aggregator ka stock pehle jaisa dikhta rahe (koi
--      regression nahi) — seller-price bhi sahi (cheapest retailer/
--      aggregator price, wholesaler price kabhi factor na ho MIN() me).
--   3. B2B/WholesalerLocator/WholesalerInventory flows (jo seedha
--      seller_type='wholesaler' query karte hain, is RPC se alag) — unpar
--      koi asar nahi, ye sab is function ko call hi nahi karte.


-- ================================================================
-- ROLLBACK — 041_categoryFeed.sql ka original body wapas
-- ================================================================
-- Neeche wala poora CREATE OR REPLACE chalao (041 se hu-ba-hu, seller_type/
-- is_aggregator gate ke bina) taaki wholesaler-leak wapas aa jaaye (yani
-- NORMALLY yeh mat chalana — sirf emergency revert ke liye):
--
-- CREATE OR REPLACE FUNCTION get_customer_medicines(
--   p_query       text    DEFAULT NULL,
--   p_mrp_mode    boolean DEFAULT false,
--   p_limit       integer DEFAULT 12,
--   p_offset      integer DEFAULT 0,
--   p_dosage_form text    DEFAULT NULL
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- STABLE
-- SECURITY INVOKER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_search boolean := (p_query IS NOT NULL AND length(btrim(p_query)) >= 2);
--   v_lim    integer := GREATEST(1, LEAST(COALESCE(p_limit, 12), 50));
--   v_off    integer := GREATEST(0, COALESCE(p_offset, 0));
--   v_result jsonb;
-- BEGIN
--   WITH avail AS (
--     SELECT
--       si.medicine_id,
--       MIN(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END)
--         FILTER (
--           WHERE COALESCE(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END, 0) > 0
--         ) AS min_price
--     FROM seller_inventory si
--     WHERE CASE
--             WHEN p_mrp_mode THEN si.seller_hidden = false
--             ELSE si.is_available = true AND si.stock_quantity > 0
--           END
--     GROUP BY si.medicine_id
--   ),
--   base AS (
--     SELECT
--       mm.id, mm.mrp_max, mm.source, mm.is_generic,
--       to_jsonb(mm) || jsonb_build_object(
--         'sellerPrice',
--         CASE
--           WHEN p_mrp_mode THEN COALESCE(NULLIF(a.min_price, 0), mm.mrp_max)
--           ELSE a.min_price
--         END
--       ) AS j
--     FROM master_medicines mm
--     JOIN avail a ON a.medicine_id = mm.id
--     WHERE mm.is_active = true
--       AND mm.mrp_max  > 0
--       AND (p_dosage_form IS NULL OR mm.dosage_form = p_dosage_form)
--       AND (
--         NOT v_search
--         OR mm.name             ILIKE '%' || p_query || '%'
--         OR mm.generic_name     ILIKE '%' || p_query || '%'
--         OR mm.salt_composition ILIKE '%' || p_query || '%'
--       )
--   )
--   SELECT CASE WHEN v_search THEN
--     jsonb_build_object(
--       'mode', 'search',
--       'janaushadhi', COALESCE((
--         SELECT jsonb_agg(j ORDER BY mrp_max ASC)
--         FROM (SELECT j, mrp_max FROM base
--               WHERE source = 'janaushadhi'
--               ORDER BY mrp_max ASC LIMIT v_lim) x), '[]'::jsonb),
--       'generic', COALESCE((
--         SELECT jsonb_agg(j ORDER BY mrp_max ASC)
--         FROM (SELECT j, mrp_max FROM base
--               WHERE is_generic = true AND source IS DISTINCT FROM 'janaushadhi'
--               ORDER BY mrp_max ASC LIMIT v_lim) x), '[]'::jsonb),
--       'branded', COALESCE((
--         SELECT jsonb_agg(j ORDER BY mrp_max DESC)
--         FROM (SELECT j, mrp_max FROM base
--               WHERE is_generic = false AND source IS DISTINCT FROM 'janaushadhi'
--               ORDER BY mrp_max DESC LIMIT v_lim) x), '[]'::jsonb)
--     )
--   ELSE
--     jsonb_build_object(
--       'mode', 'popular',
--       'items', COALESCE((
--         SELECT jsonb_agg(j ORDER BY mrp_max ASC)
--         FROM (SELECT j, mrp_max FROM base
--               ORDER BY mrp_max ASC
--               LIMIT v_lim OFFSET v_off) x), '[]'::jsonb)
--     )
--   END
--   INTO v_result;
--   RETURN v_result;
-- END;
-- $$;
--
-- GRANT EXECUTE ON FUNCTION get_customer_medicines(text, boolean, integer, integer, text)
--   TO anon, authenticated;
-- ================================================================
