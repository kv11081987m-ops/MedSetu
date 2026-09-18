-- ══════════════════════════════════════════════════
-- MedSetu — Pharmacist Rx-verification gate (Chunk 1: DB only)
-- Run this in Supabase SQL Editor. DB me RUN karne se pehle review.
--
-- Aim: Rx-required order checkout se SEEDHA seller ko na jaaye — pehle
--   status 'awaiting_pharmacist' me ruke (checkout wiring = Chunk 2, alag).
--   Company pharmacist PharmacistPanel se:
--     • approve_rx_order(order)        → seller ko route + status 'pending'
--                                        + pharmacist_verified = true
--     • reject_rx_order(order, reason) → status 'cancelled' + rx_reject_reason
--
-- Is file me 3 cheezein (idempotent):
--   (1) orders.status ka naya value 'awaiting_pharmacist' (status par koi
--       CHECK/enum nahi hai — sirf COMMENT update) + naya column
--       orders.rx_reject_reason. Defensive orders.pharmacist_verified guard
--       (016 uspe depend karta hai par kisi migration me record nahi).
--   (2) approve_rx_order(uuid)       RPC — SECURITY DEFINER.
--   (3) reject_rx_order(uuid, text)  RPC — SECURITY DEFINER.
--
-- Depends on (sab already applied):
--   • 014_rlsPhase5a.sql          — is_approved_pharmacist()
--   • 015_rlsPhase5b.sql          — protect_order_sensitive_columns() trigger
--   • 016_orderFlowFixes.sql      — confirm_order_with_reserve() (guard/shape ref)
--   • 019_notificationRpcV2.sql   — resolve_seller_user_id()
--   • 025_routingFoundation.sql   — orders.assigned_at / routing_expires_at /
--                                   routing_attempt / routing_history / assigned_by
--   • 026_serviceablePincodes.sql — orders.delivery_pincode, serviceable_pincodes
--   • 027_routingCandidatesFn.sql — get_routing_candidates(text)
--   • 028_rejectReassignChain.sql — orders.routing_status, app.routing_trusted flag,
--                                   advance_order_routing() (routing pattern ref)
--
-- NOTE: 044_normalizeMatch.sql abhi placeholder-adhoori hai — ye file usse
--   poori tarah independent hai, uspe koi depend nahi.
-- ══════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- (1) Naya status value + rx_reject_reason column
-- ─────────────────────────────────────────────────────────────
-- orders.status par koi CHECK constraint / enum NAHI hai (001_schema.sql:111
-- — VARCHAR(30) DEFAULT 'pending', sirf comment). 'awaiting_pharmacist'
-- (19 chars) VARCHAR(30) me fit hai — sirf documented set update karna hai.
-- JS-side KNOWN_ORDER_STATUSES (src/lib/orders.js) alag se update hoga.
COMMENT ON COLUMN orders.status IS
  'pending | confirmed | preparing | out_for_delivery | delivered | cancelled | awaiting_pharmacist (Rx-gate: pharmacist review pending, seller ko route nahi hua)';

-- Pharmacist reject ka kaaran — customer / support ko dikhane ke liye.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rx_reject_reason TEXT;

COMMENT ON COLUMN orders.rx_reject_reason IS
  'reject_rx_order() se set — pharmacist ne Rx-gate par order kyun cancel kiya';

-- Defensive: 016_orderFlowFixes.sql aur 015 ka trigger dono
-- orders.pharmacist_verified maante hain par kisi migration me iska
-- ADD COLUMN record nahi (live-only, normalize_med_name jaisा). Idempotent
-- guard taaki 045 self-contained rahe — pehle se hai to no-op.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pharmacist_verified BOOLEAN DEFAULT false;


-- ─────────────────────────────────────────────────────────────
-- (2) approve_rx_order(p_order_id)
-- ─────────────────────────────────────────────────────────────
-- Guard + FOR UPDATE lock + state-check confirm_order_with_reserve (016)
-- jaisा. Routing block advance_order_routing (028:193-267) se HU-BA-HU
-- pattern: get_routing_candidates(pincode) → pehla candidate → seller_id +
-- routing_* set; koi candidate nahi to routing_status='needs_admin'.
-- Routed hone par order_items.commission_band bhi ab is naye seller ke
-- hisaab se snapshot hota hai (gated order me Checkout NULL chhod deta hai —
-- neeche detail). needs_admin branch me band NULL rehta hai (seller hi
-- nahi) — admin manual-assign (assign_order_to_seller / 029) abhi band
-- re-snapshot NAHI karta, wo alag pre-existing gap hai.
--
-- protect_order_sensitive_columns (028:48-132) ka pharmacist-branch
-- OLD.status='awaiting_pharmacist' hone par status / seller_id /
-- pharmacist_verified write ko silently OLD pe revert kar dega (wo branch
-- sirf OLD.status='pending' → 'confirmed'/'cancelled' allow karta hai).
-- Isliye 028 ka HI trusted-flag — app.routing_trusted (txn-scoped SET LOCAL
-- semantics, value 'true' — trigger check exactly = 'true', 028:60/208 ke
-- saath byte-match). Isse v_privileged TRUE ho jaata hai aur trigger poora
-- RETURN NEW karta hai.
--
-- Return JSONB:
--   { success:false, message }                       — guard / state fail
--   { success:true,  routed:true,  seller_id }       — seller assign ho gaya
--   { success:true,  routed:false, needs_admin:true} — koi serviceable seller
--                                                       nahi; status 'pending'
--                                                       + routing_status
--                                                       'needs_admin' (order
--                                                       atkta nahi, admin
--                                                       manual assign kare)
CREATE OR REPLACE FUNCTION approve_rx_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_routing     JSONB;
  v_candidates  JSONB;
  v_next        JSONB;
  v_timeout_min INTEGER;
  v_now         TIMESTAMP := NOW();
  v_new_uid     UUID;
  v_admin       RECORD;
  v_admin_uid   UUID;
BEGIN
  IF NOT is_approved_pharmacist() THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Sirf approved pharmacist yeh action kar sakta hai');
  END IF;

  -- FOR UPDATE — do concurrent approve/reject ko is order par serialize
  -- karta hai (same pattern: confirm_order_with_reserve / cancel_order /
  -- advance_order_routing).
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status <> 'awaiting_pharmacist' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Yeh order pharmacist review me nahi hai (status: ' || v_order.status || ')');
  END IF;

  -- Routing candidates — Checkout.jsx:576-594 / advance_order_routing wahi
  -- pattern. delivery_pincode NULL (store pickup) → get_routing_candidates
  -- serviceable:false deta hai → neeche needs_admin fallback.
  v_routing    := get_routing_candidates(v_order.delivery_pincode);
  v_candidates := v_routing->'candidates';

  SELECT elem INTO v_next
  FROM jsonb_array_elements(COALESCE(v_candidates, '[]'::jsonb)) elem
  LIMIT 1;   -- get_routing_candidates already priority-sorted; index 0 = next

  -- Trust flag — protect_order_sensitive_columns() ko batata hai ki ye
  -- UPDATE trusted RPC se aa raha hai (028:208 ka hi mechanism, txn-scoped).
  -- Ek hi flag dono possible UPDATE (routed / needs_admin) ko cover karta hai.
  PERFORM set_config('app.routing_trusted', 'true', true);

  IF v_next IS NOT NULL THEN
    SELECT routing_timeout_minutes INTO v_timeout_min FROM platform_settings WHERE id = 1;
    v_timeout_min := COALESCE(v_timeout_min, 15);

    UPDATE orders SET
      seller_id           = (v_next->>'seller_id')::UUID,
      status              = 'pending',
      pharmacist_verified = true,
      assigned_at         = v_now,
      routing_expires_at  = v_now + (v_timeout_min || ' minutes')::INTERVAL,
      routing_attempt     = COALESCE(v_order.routing_attempt, 0) + 1,
      assigned_by         = 'auto',
      routing_status      = NULL,
      routing_history     = COALESCE(v_order.routing_history, '[]'::jsonb)
                             || jsonb_build_array(jsonb_build_object(
                                  'seller_id', (v_next->>'seller_id')::UUID,
                                  'result',    'assigned',
                                  'via',       'pharmacist_approve',
                                  'at',        v_now
                                ))
    WHERE id = p_order_id;

    -- Commission-band snapshot (gated-order fix). Checkout ne ye order gated
    -- banaya tha (sellerId null), isliye createOrderItems (orders.js:53-65)
    -- ka band-lookup skip ho gaya aur order_items.commission_band NULL rahe.
    -- Ab routed seller pata hai to WAHI rule DB-side lagao — non-gated
    -- order-creation path ke saath byte-for-byte:
    --   band = master_medicines.commission_band, sirf un items ke liye jo
    --   ye seller stock karta hai (seller_inventory se scoped, orders.js ka
    --   same join). Jo item seller stock nahi karta ya jiska master band
    --   NULL hai — wo NULL hi rahega (mark_order_delivered/016 uska
    --   flat-rate fallback lega, unchanged). order_items par koi trigger
    --   nahi + SECURITY DEFINER → RLS default-deny bypass (015:379).
    UPDATE order_items oi
    SET commission_band = mm.commission_band
    FROM seller_inventory si
    JOIN master_medicines mm ON mm.id = si.medicine_id
    WHERE oi.order_id      = p_order_id
      AND si.seller_id     = (v_next->>'seller_id')::UUID
      AND si.medicine_id   = oi.medicine_id
      AND mm.commission_band IS NOT NULL;

    -- Routed seller ko notify — advance_order_routing (028:242-246) jaisा
    -- direct insert (create_notification ka recipient-resolution "teesra
    -- seller" ke liye kaam nahi karta). Seller ki realtime bell isi
    -- notifications INSERT par jagti hai.
    v_new_uid := resolve_seller_user_id((v_next->>'seller_id')::UUID);
    IF v_new_uid IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
      VALUES (v_new_uid, 'Naya Order! 🛒',
              'Aapko naya order mila — ' || COALESCE(v_order.order_number, p_order_id::TEXT),
              'order_placed', p_order_id, false);
    END IF;

    RETURN jsonb_build_object('success', true, 'routed', true,
      'seller_id', (v_next->>'seller_id')::UUID);
  END IF;

  -- Koi serviceable seller nahi (pincode not serviceable / rotation khali /
  -- store pickup). Order atke nahi — status 'pending' + routing_status
  -- 'needs_admin' (advance_order_routing:254-267 jaisा), pharmacist_verified
  -- true (approve to ho hi chuka hai).
  UPDATE orders SET
    status              = 'pending',
    pharmacist_verified = true,
    routing_status      = 'needs_admin',
    routing_history     = COALESCE(v_order.routing_history, '[]'::jsonb)
                           || jsonb_build_array(jsonb_build_object(
                                'result', 'needs_admin',
                                'reason', 'no serviceable seller at pharmacist approval',
                                'via',    'pharmacist_approve',
                                'at',     v_now
                              ))
  WHERE id = p_order_id;

  -- Approved admins ko flag karo (advance_order_routing:269-279 jaisा).
  FOR v_admin IN SELECT email FROM staff_whitelist WHERE role = 'admin' AND is_approved = true LOOP
    SELECT id INTO v_admin_uid FROM users WHERE email = v_admin.email LIMIT 1;
    IF v_admin_uid IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
      VALUES (v_admin_uid, 'Order Ko Seller Nahi Mila ⚠️',
        'Order #' || COALESCE(v_order.order_number, p_order_id::TEXT)
          || ' — pharmacist ne approve kiya par koi seller nahi mila, manual assign karein',
        'order_needs_admin', p_order_id, false);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'routed', false, 'needs_admin', true);
END;
$$;

GRANT EXECUTE ON FUNCTION approve_rx_order(UUID) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- (3) reject_rx_order(p_order_id, p_reason)
-- ─────────────────────────────────────────────────────────────
-- 'awaiting_pharmacist' order kabhi seller ko route nahi hua, kabhi accept
-- nahi hua → koi reserve_stock kabhi nahi chala → cancel par kuch release
-- NAHI karna. (cancel_order/016 me bhi release sirf OLD.status='confirmed'
-- par hota hai — yahan to us stage se bhi pehle hain.)
--
-- Trigger ka pharmacist-branch OLD.status='awaiting_pharmacist' par
-- status → 'cancelled' bhi block karta (sirf OLD.status='pending' allow),
-- isliye wahi app.routing_trusted flag.
CREATE OR REPLACE FUNCTION reject_rx_order(p_order_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  IF NOT is_approved_pharmacist() THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Sirf approved pharmacist yeh action kar sakta hai');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status <> 'awaiting_pharmacist' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Yeh order pharmacist review me nahi hai (status: ' || v_order.status || ')');
  END IF;

  -- Trust flag — 028:208 ka hi mechanism (txn-scoped, value 'true').
  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders SET
    status              = 'cancelled',
    pharmacist_verified = false,
    rx_reject_reason    = p_reason
  WHERE id = p_order_id;

  -- Customer ko batao — reject reason ke saath. advance_order_routing ka
  -- hi direct-insert pattern; cancel_order khud notify nahi karta, par
  -- Rx-reject me customer ko pata chalna zaroori hai. orders.customer_id
  -- already users.id hai (001_schema.sql:102).
  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
    VALUES (v_order.customer_id, 'Order Cancel Ho Gaya',
      'Aapka order #' || COALESCE(v_order.order_number, p_order_id::TEXT)
        || ' pharmacist ne cancel kiya: '
        || COALESCE(NULLIF(btrim(p_reason), ''), 'kaaran nahi diya gaya'),
      'order_rx_rejected', p_order_id, false);
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Order reject kar diya gaya');
END;
$$;

GRANT EXECUTE ON FUNCTION reject_rx_order(UUID, TEXT) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- Dono function ban gaye + SECURITY DEFINER:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('approve_rx_order', 'reject_rx_order');
--   -- prosecdef = true dono par
--
-- rx_reject_reason column lag gaya:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN ('rx_reject_reason', 'pharmacist_verified');
--
-- EXECUTE grant:
--   SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--   WHERE routine_name IN ('approve_rx_order', 'reject_rx_order');
--
-- Real-session checks (ek test order manually 'awaiting_pharmacist' me daal ke):
--   UPDATE orders SET status = 'awaiting_pharmacist', seller_id = NULL,
--     pharmacist_verified = false WHERE id = '<test-order-id>';
--
--   1. Non-pharmacist session se approve_rx_order('<id>')
--      -> { success:false, message:'Sirf approved pharmacist ...' }
--   2. Pharmacist session, serviceable pincode wala order:
--      SELECT approve_rx_order('<id>');
--      -> { success:true, routed:true, seller_id:<uuid> }
--      -> orders row: status='pending', seller_id set, pharmacist_verified=true,
--         assigned_at/routing_expires_at/routing_attempt set, routing_status NULL,
--         routing_history me {result:'assigned', via:'pharmacist_approve'}.
--      -> us seller ke user_id par 'order_placed' notification.
--      -> order_items.commission_band ab set (jo item seller stock karta hai
--         + master_medicines.commission_band NOT NULL). Check:
--         SELECT oi.medicine_id, oi.commission_band, mm.commission_band AS master_band
--         FROM order_items oi JOIN master_medicines mm ON mm.id = oi.medicine_id
--         WHERE oi.order_id = '<id>';
--         -- gated order me pehle sab NULL the; approve ke baad seller-stocked
--         -- + classified items ka band master_band ke barabar.
--   3. Pharmacist, non-serviceable pincode (ya store-pickup) order:
--      SELECT approve_rx_order('<id>');
--      -> { success:true, routed:false, needs_admin:true }
--      -> status='pending', routing_status='needs_admin', pharmacist_verified=true.
--      -> har approved admin ko 'order_needs_admin' notification.
--   4. approve_rx_order us order par jo 'pending' hai (awaiting_pharmacist nahi)
--      -> { success:false, message:'... pharmacist review me nahi hai (status: pending)' }
--   5. Pharmacist, reject_rx_order('<id>', 'prescription blurry hai')
--      -> { success:true, message:'Order reject kar diya gaya' }
--      -> status='cancelled', pharmacist_verified=false,
--         rx_reject_reason='prescription blurry hai'.
--      -> customer ke user_id par 'order_rx_rejected' notification.
--   6. reject_rx_order dubara usi (ab 'cancelled') order par
--      -> { success:false, message:'... pharmacist review me nahi hai (status: cancelled)' }


-- ================================================================
-- ROLLBACK
-- ================================================================
-- DROP FUNCTION IF EXISTS approve_rx_order(UUID);
-- DROP FUNCTION IF EXISTS reject_rx_order(UUID, TEXT);
-- ALTER TABLE orders DROP COLUMN IF EXISTS rx_reject_reason;
-- -- pharmacist_verified DROP MAT karo — 016/028 uspe depend karte hain.
-- -- 'awaiting_pharmacist' status: koi constraint add nahi hua (sirf COMMENT).
-- --   Revert ke liye COMMENT ON COLUMN orders.status ko purana text de do.
-- --   Jo orders us status me atke hon unhe manually approve_rx_order/
-- --   reject_rx_order ya seedha UPDATE se nikaalna hoga.
-- ================================================================
