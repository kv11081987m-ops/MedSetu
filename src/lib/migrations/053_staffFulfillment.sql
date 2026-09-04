-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator, Chunk 4c: staff status-change RPCs + wholesaler
-- stock reserve
-- Run this in Supabase SQL Editor. DB me abhi RUN nahi hua — review ke
-- baad chalana.
--
-- Scope: staff apne CLAIMED aggregator order ko pending→confirmed→
-- preparing→out_for_delivery le jaata hai, teen naye standalone RPC se.
-- Seller ka mojooda flow (SellerDashboard.jsx acceptOrderImpl/
-- markOutForDeliveryImpl/mark_order_delivered, reserve_stock/release_stock,
-- protect_order_sensitive_columns trigger, orders UPDATE RLS) — sab
-- BILKUL untouched, koi CREATE OR REPLACE/DROP kisi purani cheez par nahi.
--
-- Status mapping is chunk ke liye:
--   pending →(staff_accept_order)→ confirmed
--   confirmed →(staff_mark_packed)→ preparing   ('preparing' — orders.js:176
--     KNOWN_ORDER_STATUSES me pehle se listed tha par koi transition
--     kabhi karta nahi tha, ab yeh dead status staff-packed ke liye zinda
--     hota hai)
--   preparing →(staff_handover_order)→ out_for_delivery
-- 'delivered' yahan NAHI — wo delivery-side (rider/mark_order_delivered),
-- is chunk ka scope nahi.
--
-- Depends on (sab already applied/prior chunks, is file se PEHLE run
-- karna zaroori):
--   • 001_schema.sql              — orders, order_items
--   • 028_rejectReassignChain.sql — protect_order_sensitive_columns(),
--                                    app.routing_trusted (see NOTE below)
--   • 047_aggregatorStaff.sql     — seller_staff, is_seller_staff(),
--                                    orders.claimed_by, sourced_from_wholesaler_id
--   • 052_staffClaim.sql          — claim_order (claimed_by tabhi set hota
--                                    hai jab order sourced_from_wholesaler_id
--                                    staff ke apne wholesaler se match kare)
--
-- Common guard (teeno RPC me identical):
--   1. is_seller_staff() — warna 42501.
--   2. calling staff ki apni seller_staff.id (email=auth.email(),
--      is_active=true) — na mile to graceful {..., message:'Staff record
--      nahi mila'} (business-failure shape, exception nahi — 42501 sirf
--      "role hi galat hai" ke liye, yeh "role sahi par row race me gayab"
--      jaisा edge case hai).
--   3. order FOR UPDATE lock + claimed_by = apni staff.id, warna
--      {..., message:'Ye order aapne claim nahi kiya'} — staff sirf apne
--      hi claim par kaam kare (052 ka hi invariant yahan bhi enforce).
--
-- NOTE — trust flag zaroori hai ya nahi (jaisा poocha gaya): 028's
-- protect_order_sensitive_columns() ka seller-branch (v_is_seller) sirf
-- OLD.seller_id se linked users row (owner) ke auth.uid()/email() se match
-- karta hai — staff ki apni identity kabhi is match me nahi aati (staff
-- seller ka owner nahi). Trigger ke pharmacist/buyer/customer branches
-- bhi match nahi karte. Matlab practically, ek staff-triggered UPDATE kisi
-- bhi branch se match hi nahi karta aur function ke bilkul aakhir wale
-- unconditional `RETURN NEW` (028:130) tak gir jaata hai — jahan KOI
-- column revert nahi hota, status included (same finding jo 050/052 ki
-- apni investigation me bhi mila tha unke columns ke liye). Matlab
-- technically trust-flag ki zaroorat nahi thi. Fir bhi app.routing_trusted
-- laga raha hoon — wahi 045/050/052 wala forward-safety idiom (agar kabhi
-- trigger ka default fall-through branch badla/koi naya identity-branch
-- add hua jo galti se staff ko match kar de, yeh flag safety net rehta hai).
--
-- NOTE — is_available untouched: wholesaler ki seller_inventory row par
-- sirf stock_quantity ghataya jaata hai, is_available column ko yeh RPC
-- kabhi nahi chhedta (0 stock hone par bhi) — request me sirf
-- "stock_quantity -= qty" maanga gaya tha. Agla sync_aggregator_inventory
-- (049) run aggregator ki synced copy ko naye (ghate hue) stock ke hisaab
-- se apne aap reconcile kar dega.
--
-- NOTE (out-of-scope finding, is file me FIX nahi kiya): 052's claim_order
-- staff-wholesaler match `v_order_whid IS DISTINCT FROM v_staff_whid` se
-- karta hai — agar kisi staff ka deployed_wholesaler_id abhi NULL hai
-- (047 me nullable column, naya-deployed-nahi-hua staff), aur wo kisi
-- non-aggregator order (jiska sourced_from_wholesaler_id bhi NULL hota
-- hai) par claim_order chalaye, to NULL IS DISTINCT FROM NULL = false ->
-- check galti se PASS ho jaata (051's SELECT RLS isse already chhupa deta
-- — plain `=` NULL par kabhi true nahi hota — par claim_order khud
-- SECURITY DEFINER hone se RLS bypass karta hai, isliye is gap se koi bhi
-- order-id seedha guess/dekh ke claim try kar sakta hai). Neeche wala
-- staff_accept_order is edge-case me bhi safe fail karta hai (wholesaler
-- seller_id NULL -> seller_inventory match hi nahi -> "poora stock nahi"
-- error, koi corruption nahi) — par asli fix 052 me `v_staff_whid IS NULL
-- OR v_order_whid IS DISTINCT FROM v_staff_whid` karna chahiye, alag
-- (chhota) patch chunk me.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 1. staff_accept_order(p_order_id) — pending -> confirmed
-- ================================================================
-- Iska hi asli point: stock WHOLESALER ki apni seller_inventory row se
-- ghatana (aggregator ki synced copy se nahi) — taaki wholesaler ka B2B/
-- doosra bikri channel isी real stock ko dekhe, double-sell na ho.
-- Do-phase (check-then-decrement, dono FOR UPDATE lock ke andar) taaki
-- ek item bhi kam pade to POORA accept fail ho, koi partial decrement na
-- ho — Postgres row-lock hi race-safety hai: dusra concurrent
-- staff_accept_order (kisi doosre order ka, isी wholesaler+medicine par)
-- is transaction ke commit/rollback tak wait karega.
CREATE OR REPLACE FUNCTION staff_accept_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id UUID;
  v_order    orders%ROWTYPE;
  v_item     RECORD;
  v_stock    INTEGER;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff staff_accept_order chala sakta hai'
      USING errcode = '42501';
  END IF;

  SELECT id INTO v_staff_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true;
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'message', 'Staff record nahi mila');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.claimed_by IS DISTINCT FROM v_staff_id THEN
    RETURN jsonb_build_object('accepted', false, 'message', 'Ye order aapne claim nahi kiya');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('accepted', false, 'message',
      'Order pending nahi hai (status: ' || v_order.status || ')');
  END IF;

  -- Phase 1 — check + lock: har item ke liye wholesaler ki seller_inventory
  -- row FOR UPDATE lock karo aur poora stock hai ya nahi dekho. Ek bhi
  -- item kam pade to yahin return (kuch decrement nahi hua abhi tak).
  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    SELECT stock_quantity INTO v_stock
    FROM seller_inventory
    WHERE seller_id   = v_order.sourced_from_wholesaler_id
      AND medicine_id = v_item.medicine_id
    FOR UPDATE;

    IF NOT FOUND OR v_stock < v_item.quantity THEN
      RETURN jsonb_build_object('accepted', false, 'message',
        'Wholesaler ke paas poora stock nahi (' || COALESCE(v_item.name, 'Medicine') || ')');
    END IF;
  END LOOP;

  -- Phase 2 — decrement: sab items pass ho chuke + unki rows abhi bhi is
  -- transaction se locked hain (Phase 1 ke SELECT ... FOR UPDATE se) —
  -- koi concurrent transaction beech me stock badal nahi sakti thi, ab
  -- safely ghataao.
  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE seller_inventory
    SET stock_quantity = stock_quantity - v_item.quantity,
        updated_at     = NOW()
    WHERE seller_id   = v_order.sourced_from_wholesaler_id
      AND medicine_id = v_item.medicine_id;
  END LOOP;

  -- Escape hatch for protect_order_sensitive_columns() — see header NOTE.
  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders SET status = 'confirmed' WHERE id = p_order_id;

  RETURN jsonb_build_object('accepted', true);
END;
$$;

GRANT EXECUTE ON FUNCTION staff_accept_order(UUID) TO authenticated;


-- ================================================================
-- 2. staff_mark_packed(p_order_id) — confirmed -> preparing
-- ================================================================
CREATE OR REPLACE FUNCTION staff_mark_packed(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id UUID;
  v_order    orders%ROWTYPE;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff staff_mark_packed chala sakta hai'
      USING errcode = '42501';
  END IF;

  SELECT id INTO v_staff_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true;
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('packed', false, 'message', 'Staff record nahi mila');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('packed', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.claimed_by IS DISTINCT FROM v_staff_id THEN
    RETURN jsonb_build_object('packed', false, 'message', 'Ye order aapne claim nahi kiya');
  END IF;

  IF v_order.status <> 'confirmed' THEN
    RETURN jsonb_build_object('packed', false, 'message',
      'Order confirmed nahi hai (status: ' || v_order.status || ')');
  END IF;

  -- Escape hatch for protect_order_sensitive_columns() — see file header NOTE.
  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders SET status = 'preparing' WHERE id = p_order_id;

  RETURN jsonb_build_object('packed', true);
END;
$$;

GRANT EXECUTE ON FUNCTION staff_mark_packed(UUID) TO authenticated;


-- ================================================================
-- 3. staff_handover_order(p_order_id) — preparing -> out_for_delivery
-- ================================================================
CREATE OR REPLACE FUNCTION staff_handover_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id UUID;
  v_order    orders%ROWTYPE;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff staff_handover_order chala sakta hai'
      USING errcode = '42501';
  END IF;

  SELECT id INTO v_staff_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true;
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('handover', false, 'message', 'Staff record nahi mila');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('handover', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.claimed_by IS DISTINCT FROM v_staff_id THEN
    RETURN jsonb_build_object('handover', false, 'message', 'Ye order aapne claim nahi kiya');
  END IF;

  IF v_order.status <> 'preparing' THEN
    RETURN jsonb_build_object('handover', false, 'message',
      'Order preparing nahi hai (status: ' || v_order.status || ')');
  END IF;

  -- Escape hatch for protect_order_sensitive_columns() — see file header NOTE.
  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders SET status = 'out_for_delivery' WHERE id = p_order_id;

  RETURN jsonb_build_object('handover', true);
END;
$$;

GRANT EXECUTE ON FUNCTION staff_handover_order(UUID) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Functions ban gaye + SECURITY DEFINER:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('staff_accept_order', 'staff_mark_packed', 'staff_handover_order');

-- Setup (052 ka hi setup reuse — real IDs se replace karke):
--   Aggregator AGG, wholesaler W1, staff ST1 (deployed_wholesaler_id=W1).
--   Medicine M1 — W1 ki seller_inventory: stock_quantity=10.
--   Order O1: seller_id=AGG, sourced_from_wholesaler_id=W1, status='pending',
--     claimed_by=ST1 (claim_order se), order_items: M1 qty=3.

-- Case A — poora stock hai -> accept success, wholesaler stock ghatta hai:
--   ST1 session: SELECT staff_accept_order('<O1-id>');
--   -> { accepted: true }
--   SELECT status FROM orders WHERE id='<O1-id>';               -- 'confirmed'
--   SELECT stock_quantity FROM seller_inventory
--     WHERE seller_id='<W1-id>' AND medicine_id='<M1-id>';       -- 10-3 = 7

-- Case B — poora stock nahi -> accept fail, KUCH change nahi:
--   (naya order O2, same M1, qty=100 — jo ab W1 ke paas nahi bacha, ya
--   seedha W1 ka stock 0 kar do test ke liye)
--   SELECT staff_accept_order('<O2-id>');
--   -> { accepted: false, message: 'Wholesaler ke paas poora stock nahi (...)' }
--   SELECT status FROM orders WHERE id='<O2-id>';                -- 'pending' hi (unchanged)
--   SELECT stock_quantity FROM seller_inventory
--     WHERE seller_id='<W1-id>' AND medicine_id='<M1-id>';       -- unchanged (Case A ke baad wala 7)

-- Case C — multi-item, dusra item fail -> pehla item bhi decrement NAHI
--   (all-or-nothing confirm karne ke liye): order O3 me 2 items — M1 (jo
--   W1 ke paas hai) aur M2 (jo W1 ke paas NAHI/kam hai). staff_accept_order('<O3-id>')
--   -> { accepted: false, ... } aur M1 ka stock_quantity bhi UNCHANGED
--   rehna chahiye (Phase 1 ne M2 par hi fail kar diya, Phase 2 kabhi chala nahi).

-- Case D — packed transition:
--   (O1 ab 'confirmed', Case A ke baad) SELECT staff_mark_packed('<O1-id>');
--   -> { packed: true }
--   SELECT status FROM orders WHERE id='<O1-id>';  -- 'preparing'

-- Case E — handover transition:
--   SELECT staff_handover_order('<O1-id>');
--   -> { handover: true }
--   SELECT status FROM orders WHERE id='<O1-id>';  -- 'out_for_delivery'

-- Case F — galat status par transition -> fail, kuch nahi badla:
--   (O1 ab 'out_for_delivery') SELECT staff_mark_packed('<O1-id>');
--   -> { packed: false, message: 'Order confirmed nahi hai (status: out_for_delivery)' }
--   SELECT staff_accept_order('<O1-id>');
--   -> { accepted: false, message: 'Order pending nahi hai (status: out_for_delivery)' }

-- Case G — non-claimer try kare -> fail:
--   Ek doosra staff ST2 (jisne O1 claim nahi kiya) session se koi bhi teeno:
--   -> { ..., message: 'Ye order aapne claim nahi kiya' }

-- Case H — guard: non-staff session se teeno RPC -> exception, errcode 42501.

-- Case I — REGRESSION: normal retailer seller ka order flow bilkul same:
--   Ek non-aggregator order par SellerDashboard ka purana flow (accept
--   button -> reserveStock+direct .update, markOutForDelivery ->
--   updateOrderStatus, mark_order_delivered RPC) chalao — sab pehle jaisा
--   kaam kare. Confirm: grep se pukka karo ki 053 file me in teen purani
--   cheezon (reserve_stock, release_stock, mark_order_delivered) ka koi
--   CREATE OR REPLACE nahi hai — sirf naye function names hain.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS staff_accept_order(UUID);
-- DROP FUNCTION IF EXISTS staff_mark_packed(UUID);
-- DROP FUNCTION IF EXISTS staff_handover_order(UUID);
-- -- Koi wholesaler seller_inventory.stock_quantity is file ke chalne se
-- -- pehle wapas nahi hota — jitna decrement hua tha wo asli maal-bhejai
-- -- (real dispatch) hai, rollback isse "un-ship" nahi karta.
-- ================================================================
