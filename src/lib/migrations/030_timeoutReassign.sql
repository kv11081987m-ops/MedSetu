-- ══════════════════════════════════════════════════
-- MedSetu — R2-D1: Timeout reassign logic + admin controls
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: DB only. Scheduler (pg_cron) is D2, separate — this file only
-- adds the RPC D2 will call, plus the two admin-facing settings. Test
-- manually right now with: SELECT process_expired_routing();
--
-- Depends on: 025_routingFoundation.sql (assigned_at/routing_expires_at/
-- routing_attempt/routing_history/assigned_by), 027_routingCandidatesFn.sql
-- (get_routing_candidates), 028_rejectReassignChain.sql (routing_status,
-- the app.routing_trusted trust flag on protect_order_sensitive_columns),
-- 019_notificationRpcV2.sql (resolve_seller_user_id).

-- ================================================================
-- 1. platform_settings — two new admin controls
-- ================================================================
-- Same ALTER-TABLE-ADD-COLUMN pattern as mrp_mode (022_mrpMode.sql) and
-- routing_timeout_minutes (025_routingFoundation.sql).
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS routing_auto_reassign BOOLEAN DEFAULT true;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS routing_hold_enabled  BOOLEAN DEFAULT false;
-- routing_hold_enabled: column + toggle only for now, nothing reads it
-- yet — future "let a seller briefly hold new orders" feature, out of
-- scope for R2-D.

-- ================================================================
-- 2. process_expired_routing()
-- ================================================================
-- WHY NOT advance_order_routing(): that function's ownership check
-- (028) requires auth.uid()/auth.email() to match the seller CURRENTLY
-- assigned to the order. Verified empirically: in a plain DB session
-- with no JWT (the context both pg_cron jobs and this guard's
-- current_user='postgres' path run in), auth.uid() and auth.email()
-- both return NULL — so that check would fail on every order, every
-- time. This RPC reimplements the same "next untried candidate, else
-- needs_admin" logic self-contained, with a role/authority guard
-- instead of a per-order ownership check (same reasoning 029's
-- assign_order_to_seller already used for the admin-assign case).
--
-- GUARD: is_active_superadmin() OR is_approved_admin() OR
-- current_user = 'postgres'. PostgREST (what every supabase-js call in
-- this app goes through) always executes as DB role 'anon' or
-- 'authenticated', never 'postgres' — confirmed against this project's
-- live pg_roles. So current_user = 'postgres' can only be true for a
-- direct SQL Editor / psql session (manual test, right now) or a
-- pg_cron job scheduled by the postgres role (D2, later) — never a
-- public/anon/authenticated PostgREST caller. The admin-JWT branch is
-- kept too so a future admin-UI "Run Now" button works without
-- touching this guard again.
--
-- Returns JSONB:
--   { success: false, message }                              — not authorized
--   { success: true, processed: 0, disabled: true }           — routing_auto_reassign is off
--   { success: true, processed, reassigned, exhausted }       — ran
CREATE OR REPLACE FUNCTION process_expired_routing()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auto_reassign BOOLEAN;
  v_timeout_min   INTEGER;
  v_order         orders%ROWTYPE;
  v_candidates    JSONB;
  v_tried_ids     UUID[];
  v_next          JSONB;
  v_now           TIMESTAMP;
  v_new_uid       UUID;
  v_admin         RECORD;
  v_admin_uid     UUID;
  v_processed     INTEGER := 0;
  v_reassigned    INTEGER := 0;
  v_exhausted     INTEGER := 0;
BEGIN
  IF NOT (is_active_superadmin() OR is_approved_admin() OR current_user = 'postgres') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Aapko yeh chalane ka access nahi hai');
  END IF;

  SELECT routing_auto_reassign, routing_timeout_minutes
    INTO v_auto_reassign, v_timeout_min
    FROM platform_settings WHERE id = 1;

  IF COALESCE(v_auto_reassign, true) = false THEN
    RETURN jsonb_build_object('success', true, 'processed', 0, 'disabled', true);
  END IF;

  v_timeout_min := COALESCE(v_timeout_min, 15);

  -- Trust flag so protect_order_sensitive_columns() (028) lets the
  -- UPDATEs below touch seller_id/status/routing_* — same flag 028
  -- added, reused as-is, no trigger change here.
  PERFORM set_config('app.routing_trusted', 'true', true);

  -- SKIP LOCKED: if a seller reject (advance_order_routing) or an
  -- admin assign (assign_order_to_seller) is mid-transaction on one of
  -- these rows right now, skip it this pass rather than blocking —
  -- it'll either no longer be expired or still be picked up next run.
  FOR v_order IN
    SELECT * FROM orders
    WHERE status = 'pending'
      AND routing_expires_at < NOW()
      AND seller_id IS NOT NULL
      AND routing_status IS DISTINCT FROM 'needs_admin'
    FOR UPDATE SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;
    v_now := NOW();

    IF v_order.delivery_pincode IS NULL THEN
      -- Can't route without a pincode — leave it for admin rather than
      -- looping on it forever every run.
      UPDATE orders SET
        seller_id       = NULL,
        routing_status  = 'needs_admin',
        routing_history = COALESCE(v_order.routing_history, '[]'::jsonb)
                           || jsonb_build_array(jsonb_build_object(
                                'seller_id', v_order.seller_id, 'result', 'timeout', 'at', v_now
                              ))
      WHERE id = v_order.id;
      v_exhausted := v_exhausted + 1;
      CONTINUE;
    END IF;

    v_candidates := (get_routing_candidates(v_order.delivery_pincode))->'candidates';

    SELECT COALESCE(array_agg((elem->>'seller_id')::UUID), ARRAY[]::UUID[])
    INTO v_tried_ids
    FROM jsonb_array_elements(COALESCE(v_order.routing_history, '[]'::jsonb)) elem;

    SELECT elem INTO v_next
    FROM jsonb_array_elements(COALESCE(v_candidates, '[]'::jsonb)) elem
    WHERE NOT ((elem->>'seller_id')::UUID = ANY(v_tried_ids))
    LIMIT 1;

    IF v_next IS NOT NULL THEN
      UPDATE orders SET
        seller_id          = (v_next->>'seller_id')::UUID,
        assigned_at         = v_now,
        routing_expires_at  = v_now + (v_timeout_min || ' minutes')::INTERVAL,
        routing_attempt     = COALESCE(v_order.routing_attempt, 0) + 1,
        assigned_by         = 'auto',
        routing_status      = NULL,
        routing_history     = COALESCE(v_order.routing_history, '[]'::jsonb)
                               || jsonb_build_array(jsonb_build_object(
                                    'seller_id', v_order.seller_id, 'result', 'timeout', 'at', v_now
                                  ))
                               || jsonb_build_array(jsonb_build_object(
                                    'seller_id', (v_next->>'seller_id')::UUID, 'result', 'assigned', 'at', v_now
                                  ))
      WHERE id = v_order.id;

      v_new_uid := resolve_seller_user_id((v_next->>'seller_id')::UUID);
      IF v_new_uid IS NOT NULL THEN
        INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
        VALUES (v_new_uid, 'Naya Order! 🛒', 'Aapko naya order mila', 'order_placed', v_order.id, false);
      END IF;

      v_reassigned := v_reassigned + 1;
    ELSE
      UPDATE orders SET
        seller_id       = NULL,
        routing_status  = 'needs_admin',
        routing_history = COALESCE(v_order.routing_history, '[]'::jsonb)
                           || jsonb_build_array(jsonb_build_object(
                                'seller_id', v_order.seller_id, 'result', 'timeout', 'at', v_now
                              ))
      WHERE id = v_order.id;

      FOR v_admin IN SELECT email FROM staff_whitelist WHERE role = 'admin' AND is_approved = true LOOP
        SELECT id INTO v_admin_uid FROM users WHERE email = v_admin.email LIMIT 1;
        IF v_admin_uid IS NOT NULL THEN
          INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
          VALUES (
            v_admin_uid, 'Order Ko Seller Nahi Mila ⚠️',
            'Order #' || COALESCE(v_order.order_number, v_order.id::TEXT) || ' — koi seller le nahi raha, manual assign karein',
            'order_needs_admin', v_order.id, false
          );
        END IF;
      END LOOP;

      v_exhausted := v_exhausted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'processed', v_processed, 'reassigned', v_reassigned, 'exhausted', v_exhausted);
END;
$$;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'platform_settings' AND column_name IN ('routing_auto_reassign', 'routing_hold_enabled');

-- SELECT proname, prosecdef, pronargs FROM pg_proc WHERE proname = 'process_expired_routing';

-- Manual test (run as postgres in SQL Editor — satisfies the
-- current_user='postgres' guard branch):
--   1. Find/make a pending order with seller_id set and
--      routing_expires_at in the past (e.g.
--      UPDATE orders SET routing_expires_at = NOW() - INTERVAL '1 minute'
--      WHERE id = '<some pending routed order>';)
--   2. SELECT process_expired_routing();
--      -> {success:true, processed:1, reassigned:1, exhausted:0} if
--         another candidate existed, seller_id changed, routing_history
--         got 'timeout'+'assigned' entries, new seller notified.
--      -> {success:true, processed:1, reassigned:0, exhausted:1} if no
--         more candidates, seller_id NULL, routing_status='needs_admin',
--         admins notified.
--   3. With routing_auto_reassign=false:
--      UPDATE platform_settings SET routing_auto_reassign=false WHERE id=1;
--      SELECT process_expired_routing(); -> {success:true, processed:0, disabled:true}
--      (remember to set it back to true afterwards)
--   4. As a non-admin authenticated user (or via anon key) ->
--      {success:false, message:'Aapko yeh chalane ka access nahi hai'}.
--   5. B2B orders (buyer_type='retailer') untouched — same filter as
--      the reject-chain (routing_status/routing_expires_at only ever
--      set on B2C-routed orders).

-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS process_expired_routing();
-- ALTER TABLE platform_settings DROP COLUMN IF EXISTS routing_auto_reassign;
-- ALTER TABLE platform_settings DROP COLUMN IF EXISTS routing_hold_enabled;
