-- ══════════════════════════════════════════════════
-- MedSetu — R2 Order Routing, Part B: routing candidate function
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: ONE new read-only function. No order-flow/cart/checkout code
-- changed — R2-C wires this into order creation later. Depends on
-- 025_routingFoundation.sql (sellers.routing_weight) and
-- 026_serviceablePincodes.sql (serviceable_pincodes table), both
-- already applied; this file doesn't modify anything either added.
--
-- WHY A SQL FUNCTION (not JS in orders.js):
--   1. Race-safety: R2-C will call this at order-creation time. Two
--      concurrent orders must not both read the same "0 orders today"
--      snapshot and pick the same seller. Living in SQL lets R2-C wrap
--      this alongside the orders INSERT in one RPC transaction (with
--      row locking) — the same tool this codebase already uses for the
--      identical class of problem (reserve_stock / 005+023, and
--      confirm_order_with_reserve / 016). A JS implementation would
--      need multiple round-trips with a race window in between, and no
--      way to lock across them without extra infra.
--   2. Cross-seller reads: counting today's orders per seller needs
--      rows outside the caller's own RLS-visible scope (orders_select,
--      015_rlsPhase5b.sql, only shows a customer their own orders).
--      SECURITY DEFINER bypasses this cleanly here, same as
--      resolve_seller_user_id / create_notification (019_notificationRpcV2.sql).
--   Caveat: this function itself only SELECTs — it takes no locks, so
--   by itself it does not yet close the double-pick race. It gives
--   R2-C the means to close it (call inside one transaction, lock
--   candidate seller rows) — R2-C still has to do that part.

-- ================================================================
-- get_routing_candidates(p_pincode)
--
-- Input: a pincode only (no medicine list — stock doesn't gate this,
-- a seller sources from a wholesaler if needed, per F12).
--
-- Returns JSONB:
--   { "serviceable": false, "candidates": [] }
--     — p_pincode has no active row in serviceable_pincodes.
--   { "serviceable": true,  "candidates": [] }
--     — pincode is serviceable but no active retailer has
--       routing_weight > 0 (nobody opted into rotation yet).
--   { "serviceable": true, "candidates": [ {seller_id, store_name,
--       weight, today_count, target_share, priority_score}, ... ] }
--     — ordered so index 0 is who should get the NEXT order.
--
-- Algorithm ("least-satisfied-ratio"):
--   candidates  = active retailer sellers with routing_weight > 0
--   target_share(seller) = weight / SUM(weight) across candidates
--   today_count(seller)  = seller's orders whose created_at falls on
--                          today's IST calendar day (orders.created_at
--                          is stored UTC — see formatTime.js's own
--                          comment on this — so it's converted via
--                          AT TIME ZONE 'UTC' → AT TIME ZONE
--                          'Asia/Kolkata' before taking ::date, same
--                          IST rule the rest of the app displays by)
--   priority_score(seller) = today_count / target_share
--     — lower score = furthest behind their fair share = goes first.
--   Sort: priority_score ASC, then weight DESC, then seller_id ASC
--     (the last one is a fully deterministic tie-break — arbitrary but
--     stable, so the ordering never flaps between two equal-priority
--     candidates on repeated calls within the same instant).
--   Single candidate → that one row alone, target_share = 1.0 (100%).
-- ================================================================

CREATE OR REPLACE FUNCTION get_routing_candidates(p_pincode TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_serviceable BOOLEAN;
  v_candidates  JSONB;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM serviceable_pincodes
    WHERE pincode = p_pincode AND is_active = true
  ) INTO v_serviceable;

  IF NOT v_serviceable THEN
    RETURN jsonb_build_object('serviceable', false, 'candidates', '[]'::jsonb);
  END IF;

  WITH weighted AS (
    SELECT
      s.id                                                  AS seller_id,
      s.store_name,
      s.routing_weight                                      AS weight,
      s.routing_weight::numeric / SUM(s.routing_weight) OVER () AS target_share
    FROM sellers s
    WHERE s.seller_type = 'retailer'
      AND s.routing_weight > 0
  ),
  today_orders AS (
    SELECT o.seller_id, COUNT(*) AS today_count
    FROM orders o
    WHERE o.seller_id IS NOT NULL
      AND ((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
          = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    GROUP BY o.seller_id
  ),
  scored AS (
    SELECT
      w.seller_id,
      w.store_name,
      w.weight,
      COALESCE(t.today_count, 0)                             AS today_count,
      w.target_share,
      COALESCE(t.today_count, 0) / w.target_share             AS priority_score
    FROM weighted w
    LEFT JOIN today_orders t ON t.seller_id = w.seller_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'seller_id',      sc.seller_id,
      'store_name',     sc.store_name,
      'weight',         sc.weight,
      'today_count',    sc.today_count,
      'target_share',   ROUND(sc.target_share, 6),
      'priority_score', ROUND(sc.priority_score, 6)
    )
    ORDER BY sc.priority_score ASC, sc.weight DESC, sc.seller_id ASC
  )
  INTO v_candidates
  FROM scored sc;

  RETURN jsonb_build_object('serviceable', true, 'candidates', COALESCE(v_candidates, '[]'::jsonb));
END;
$$;


-- ================================================================
-- TEST — run these in Supabase SQL Editor
-- ================================================================

-- 1. Not-serviceable pincode:
--   SELECT get_routing_candidates('999999');
--   -- expect {"serviceable": false, "candidates": []}

-- 2. Serviceable pincode, nobody in rotation yet (fresh install —
--    every seller.routing_weight defaults to 0 from 025):
--   SELECT get_routing_candidates('274001');
--   -- expect {"serviceable": true, "candidates": []}

-- 3. Single seller in rotation (what you're about to test against):
--   UPDATE sellers SET routing_weight = 5 WHERE id = '<your one seller id>';
--   SELECT get_routing_candidates('274001');
--   -- expect candidates = [ { ..., "weight": 5, "target_share": 1,
--   --   "today_count": <today's real order count for that seller>,
--   --   "priority_score": today_count / 1 } ]
--   -- i.e. that one seller, 100% share, regardless of today_count.

-- 4. Add a second seller to see ordering respond to both weight and
--    today's order count:
--   UPDATE sellers SET routing_weight = 6 WHERE id = '<seller A>';
--   UPDATE sellers SET routing_weight = 2 WHERE id = '<seller B>';
--   SELECT get_routing_candidates('274001');
--   -- with 0 orders today for both: target_share 0.75/0.25,
--   -- priority_score 0/0.75=0 and 0/0.25=0 -> tie -> higher weight (A) first.
--   -- Place a couple of test orders for seller A today, re-run:
--   -- A's today_count rises, A's priority_score rises above B's ->
--   -- B moves to position #1 (least-satisfied-ratio working as intended).

-- 5. Pretty-print from psql/SQL editor if the raw JSON is hard to read:
--   SELECT jsonb_pretty(get_routing_candidates('274001'));

-- JS-side smoke test (run from anywhere with the app's supabase client,
-- e.g. browser devtools console on a logged-in session — SECURITY
-- DEFINER means it works regardless of caller role):
--   const { data, error } = await supabase.rpc('get_routing_candidates', { p_pincode: '274001' });
--   console.log(data); // { serviceable, candidates: [...] }


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS get_routing_candidates(TEXT);
