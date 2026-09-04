-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator, Chunk 3: order wholesaler-source resolve
-- Run this in Supabase SQL Editor. DB me abhi RUN nahi hua — review ke
-- baad chalana.
--
-- Design (locked): jab ek AGGREGATOR (sellers.is_aggregator=true) seller
-- ka order route/create hota hai, ek internal step us order ka
-- wholesaler-source tय karega — orders.sourced_from_wholesaler_id (047)
-- set karke — taaki Chunk 4 me us wholesaler ke deployed staff
-- (seller_staff, 047) ko yeh order dikhe/claim ho sake.
--
-- Rule: aggregator ke active-mapped wholesalers (aggregator_wholesalers,
-- 047/049) me se PRIORITY ASC me PEHLA wholesaler jiske paas order ki
-- SAARI items available hon (har order_item.medicine_id: seller_inventory
-- is_available=true AND stock_quantity >= us item ki quantity). Milta hai
-- to sourced set; kisi ek ke paas poora order na ho to sourced NULL +
-- routing_status='needs_admin' (manual handle — 028/045 ka hi
-- "candidates exhausted -> admin flag" idiom).
--
-- Is file me:
--   1. resolve_order_wholesaler_source(p_order_id) RPC — standalone.
--      Koi checkout/routing wiring nahi (wo alag, baad ka chunk) — abhi
--      sirf manual/system call ke liye (SQL Editor / service_role /
--      superadmin), 049_aggregatorSync.sql jaisा guard.
--
-- Depends on (sab already applied/prior chunks, is file se PEHLE run
-- karna zaroori):
--   • 001_schema.sql              — orders, order_items (quantity)
--   • 014_rlsPhase5a.sql          — is_active_superadmin()
--   • 015_rlsPhase5b.sql / 028_rejectReassignChain.sql — orders.routing_status,
--     protect_order_sensitive_columns() + app.routing_trusted escape hatch
--     (see NOTE below)
--   • 047_aggregatorStaff.sql     — sellers.is_aggregator, aggregator_wholesalers,
--                                    orders.sourced_from_wholesaler_id
--   • 049_aggregatorSync.sql      — aggregator_wholesalers.priority,
--                                    is_active_superadmin()/service_role/
--                                    postgres guard idiom (same yahan reused)
--
-- NOTE — protect_order_sensitive_columns() (028_rejectReassignChain.sql:48-132)
--   ki poori column-revert list padh ke confirm kiya: uska koi bhi branch
--   (seller/buyer/customer/pharmacist/default) routing_status ya
--   sourced_from_wholesaler_id (jo 047 me trigger ke BAAD add hua, trigger
--   ise jaanta hi nahi) ko explicitly revert NAHI karta — sirf status/
--   seller_id/buyer_id/customer_id/final_amount/pharmacist_verified/
--   received_by_buyer/commission_* us list me hain. Matlab in dono
--   columns ko technically trust-flag ki zaroorat nahi. Fir bhi
--   app.routing_trusted flag laga raha hoon (approve_rx_order, 045, ka
--   hi rule) — 028 ke apne header comment ki spirit follow karte hue:
--   "isse silently kisi incidental trigger-gap par depend nahi karna
--   padta jo koi future unrelated edit band kar de". Zero extra risk,
--   consistent idiom.
--
-- NOT done here (deliberately, standalone-scope): routing_status ko wapas
-- NULL karna agar ek baad ke re-run me sourced mil jaaye (jab pehli baar
-- needs_admin lag chuka ho) — spec explicitly kehta hai "sourced:true
-- path par routing_status ko chhedo mat", to yeh RPC literally wahi karta
-- hai. Poora lifecycle (needs_admin se recover, checkout/routing wiring,
-- staff-claim) baad ke chunks me.
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION resolve_order_wholesaler_source(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order         orders%ROWTYPE;
  v_is_aggregator BOOLEAN;
  v_item_count    INTEGER;
  v_chosen        UUID;
BEGIN
  IF NOT (is_active_superadmin() OR current_setting('role', true) = 'service_role'
          OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Sirf super-admin ya service-role resolve_order_wholesaler_source chala sakta hai'
      USING errcode = '42501';
  END IF;

  -- Lock the row — future callers (checkout/routing wiring) may call this
  -- concurrently with other order-mutating RPCs; same FOR UPDATE pattern
  -- as advance_order_routing/approve_rx_order/cancel_order.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  -- Non-aggregator seller ka order — is step ka scope hi nahi, no-op.
  SELECT is_aggregator INTO v_is_aggregator FROM sellers WHERE id = v_order.seller_id;
  IF NOT COALESCE(v_is_aggregator, false) THEN
    RETURN jsonb_build_object('aggregator', false);
  END IF;

  SELECT count(*) INTO v_item_count FROM order_items WHERE order_id = p_order_id;
  IF v_item_count = 0 THEN
    -- Line-items hi nahi — kisi wholesaler ko "poora order stock karta
    -- hai" bola nahi ja sakta. Defensive edge-case (aggregator order
    -- normally items ke bina banta hi nahi) — needs_admin, sourced NULL.
    PERFORM set_config('app.routing_trusted', 'true', true);
    UPDATE orders SET sourced_from_wholesaler_id = NULL, routing_status = 'needs_admin'
    WHERE id = p_order_id;
    RETURN jsonb_build_object('aggregator', true, 'sourced', false, 'needs_admin', true);
  END IF;

  -- Priority ASC (tie -> wholesaler seller_id ASC) me PEHLA active-mapped
  -- wholesaler jiske paas order ki HAR item available ho (is_available +
  -- stock_quantity >= order qty). "Poora order na mile to koi nahi" —
  -- isliye NOT EXISTS(order_item jiske liye is wholesaler ke paas seller_
  -- inventory match na ho) — ek bhi item miss to yeh wholesaler reject.
  SELECT aw.wholesaler_seller_id
  INTO v_chosen
  FROM aggregator_wholesalers aw
  WHERE aw.aggregator_seller_id = v_order.seller_id
    AND aw.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = p_order_id
        AND NOT EXISTS (
          SELECT 1 FROM seller_inventory si
          WHERE si.seller_id      = aw.wholesaler_seller_id
            AND si.medicine_id    = oi.medicine_id
            AND si.is_available   = true
            AND si.stock_quantity >= oi.quantity
        )
    )
  ORDER BY aw.priority ASC, aw.wholesaler_seller_id ASC
  LIMIT 1;

  -- Escape hatch for protect_order_sensitive_columns() — see this file's
  -- header NOTE (not strictly required for these 2 columns today, kept
  -- for the same forward-safety reason 045/028 keep it).
  PERFORM set_config('app.routing_trusted', 'true', true);

  IF v_chosen IS NOT NULL THEN
    UPDATE orders SET sourced_from_wholesaler_id = v_chosen
    WHERE id = p_order_id;
    -- routing_status jaanbujh ke untouched — order apne normal flow me rahe.
    RETURN jsonb_build_object('aggregator', true, 'sourced', true, 'wholesaler_id', v_chosen);
  END IF;

  UPDATE orders SET sourced_from_wholesaler_id = NULL, routing_status = 'needs_admin'
  WHERE id = p_order_id;
  RETURN jsonb_build_object('aggregator', true, 'sourced', false, 'needs_admin', true);
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_order_wholesaler_source(UUID) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Function ban gaya + SECURITY DEFINER:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'resolve_order_wholesaler_source';

-- Setup (real IDs se replace karke):
--   0. Ek aggregator seller AGG (is_aggregator=true), do wholesaler W1
--      (priority=1) aur W2 (priority=2), dono aggregator_wholesalers me
--      is_active=true.
--   1. Ek order O, seller_id=AGG, do order_items: item1 (medicine M1,
--      qty=2), item2 (medicine M2, qty=1).

-- Case A — ek wholesaler ke paas poora order (sourced set):
--   W1 ke paas M1 (stock=5, is_available=true) aur M2 (stock=3,
--   is_available=true) dono available karo.
--   SELECT resolve_order_wholesaler_source('<O-id>');
--   -> { aggregator: true, sourced: true, wholesaler_id: '<W1-id>' }
--   SELECT sourced_from_wholesaler_id, routing_status FROM orders WHERE id='<O-id>';
--   -- sourced_from_wholesaler_id = W1, routing_status unchanged (pehle jo tha)

-- Case B — alag-alag wholesaler (koi ek ke paas poora nahi -> needs_admin):
--   W1 ke paas sirf M1 hai (M2 nahi/stock 0), W2 ke paas sirf M2 hai.
--   SELECT resolve_order_wholesaler_source('<O-id>');
--   -> { aggregator: true, sourced: false, needs_admin: true }
--   SELECT sourced_from_wholesaler_id, routing_status FROM orders WHERE id='<O-id>';
--   -- sourced_from_wholesaler_id = NULL, routing_status = 'needs_admin'

-- Case C — priority se sahi wholesaler chuna (dono ke paas poora order hai):
--   W1 AUR W2 dono ke paas M1+M2 poora stock. priority W1=1 < W2=2.
--   SELECT resolve_order_wholesaler_source('<O-id>');
--   -> wholesaler_id = '<W1-id>' (priority jeeta), W2 nahi.

-- Case D — quantity-check (available hai par kam stock -> reject):
--   W1 ke paas M1 stock_quantity=1 (order qty=2 se kam), M2 theek.
--   SELECT resolve_order_wholesaler_source('<O-id>');
--   -- W1 reject ho, agar W2 ke paas poora ho to W2 chuna jaaye, warna needs_admin.

-- Case E — non-aggregator order (no-op):
--   Ek normal retailer seller ka order O2:
--   SELECT resolve_order_wholesaler_source('<O2-id>');
--   -> { aggregator: false }
--   -- orders row (seller_id/status/sourced_from_wholesaler_id/routing_status
--   -- sab) bilkul unchanged.

-- Case F — order hi nahi mila:
--   SELECT resolve_order_wholesaler_source('00000000-0000-0000-0000-000000000000');
--   -> { success: false, message: 'Order nahi mila' }

-- Guard: non-superadmin/non-service-role session se koi bhi upar wala call
--   -> exception, errcode 42501.

-- Read-only confirm — wholesalers ki apni seller_inventory rows (stock/
-- price/is_available) is function ke chalne se pehle/baad EXACT same hain
-- (sirf orders table touch hui):
--   SELECT id, stock_quantity, is_available FROM seller_inventory
--   WHERE seller_id IN ('<W1-id>', '<W2-id>') ORDER BY id;


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS resolve_order_wholesaler_source(UUID);
-- -- orders.sourced_from_wholesaler_id / routing_status columns 047/028 ke
-- -- hain, is file ne banaye nahi — rollback yahan unhe drop nahi karta.
-- ================================================================
