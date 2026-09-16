-- ══════════════════════════════════════════════════
-- MedSetu — needs_admin exhaustion notify: superadmin fallback
-- 048_cronEscalation.sql ki investigation mein mila: dono jagah jahan
-- ek order needs_admin mein exhaust hoti hai (advance_order_routing —
-- seller reject path, aur process_expired_routing — cron timeout path),
-- admin-notify sirf staff_whitelist (role='admin', is_approved=true) ko
-- target karta hai. Live check: us filter se 0 rows milte hain — matlab
-- yeh loop kabhi chalta hi nahi, aur pehli baar koi bhi admin/superadmin
-- notify nahi hota jab order exhaust hoti hai (048's daily cron isi gap
-- ka ek din-baad-tak-ka safety net tha; yeh fix asli waqt par bhi
-- notify karta hai).
--
-- Fix: staff_whitelist loop ke turant baad ek aur loop — super_admins
-- (is_active=true) ko bhi wahi notification bhejta hai. Dono independent
-- hain (staff_whitelist khaali rehne par bhi super_admins se notify ho
-- jaata hai) — isliye "fallback" naam, lekin dono UNCONDITIONALLY chalte
-- hain (koi guard nahi ki staff_whitelist khaali tha to hi super_admins
-- chalao). Abhi staff_whitelist ka admin-filter khaali hai (0 rows) to
-- double-notify ka koi practical risk nahi — lekin agar kabhi koi
-- insaan dono staff_whitelist (role='admin', approved) AND super_admins
-- (active) dono mein ho, use SAME exhaustion event par 2 notifications
-- milengi. Jaan-boojh ke isi tarah rakha (draft se match), guard nahi
-- add kiya — flag kar raha hoon future maintainer ke liye.
--
-- Depends on: 016_orderFlowFixes.sql / 028 (advance_order_routing,
-- process_expired_routing original definitions), super_admins
-- (001_schema.sql), 048_cronEscalation.sql (isi investigation se nikla).
-- Run this in Supabase SQL Editor.
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.advance_order_routing(p_order_id uuid, p_result text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order       orders%ROWTYPE;
  v_candidates  JSONB;
  v_tried_ids   UUID[];
  v_next        JSONB;
  v_timeout_min INTEGER;
  v_now         TIMESTAMP := NOW();
  v_admin       RECORD;
  v_admin_uid   UUID;
  v_new_uid     UUID;
BEGIN
  -- Lock the row first — closes the race between a concurrent reject/
  -- timeout call landing on the same order (same FOR UPDATE pattern as
  -- cancel_order/confirm_order_with_reserve, 016_orderFlowFixes.sql).
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  -- Only the seller CURRENTLY assigned to this order may advance it —
  -- mirrors cancel_order's ownership check. (A scheduler/admin caller is
  -- out of scope for R2-E; this only authorizes the seller-reject path.)
  IF NOT EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh order aapka nahi hai');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Yeh order ab pending nahi hai (status: ' || v_order.status || ')');
  END IF;

  IF v_order.delivery_pincode IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order mein pincode nahi hai, routing nahi ho sakti');
  END IF;

  v_candidates := (get_routing_candidates(v_order.delivery_pincode))->'candidates';

  -- Every seller ever written to routing_history, regardless of past
  -- result — a reject must never loop back to a seller already tried.
  SELECT COALESCE(array_agg((elem->>'seller_id')::UUID), ARRAY[]::UUID[])
  INTO v_tried_ids
  FROM jsonb_array_elements(COALESCE(v_order.routing_history, '[]'::jsonb)) elem;

  SELECT elem INTO v_next
  FROM jsonb_array_elements(COALESCE(v_candidates, '[]'::jsonb)) elem
  WHERE NOT ((elem->>'seller_id')::UUID = ANY(v_tried_ids))
  LIMIT 1;

  -- Trust flag so protect_order_sensitive_columns() (above) lets this
  -- UPDATE touch seller_id/status/routing_* — see section 2's comment.
  PERFORM set_config('app.routing_trusted', 'true', true);

  IF v_next IS NOT NULL THEN
    SELECT routing_timeout_minutes INTO v_timeout_min FROM platform_settings WHERE id = 1;
    v_timeout_min := COALESCE(v_timeout_min, 15);

    UPDATE orders SET
      seller_id          = (v_next->>'seller_id')::UUID,
      status              = 'pending',
      assigned_at         = v_now,
      routing_expires_at  = v_now + (v_timeout_min || ' minutes')::INTERVAL,
      routing_attempt     = COALESCE(v_order.routing_attempt, 0) + 1,
      assigned_by         = 'auto',
      routing_status      = NULL,
      routing_history     = COALESCE(v_order.routing_history, '[]'::jsonb)
                             || jsonb_build_array(jsonb_build_object(
                                  'seller_id', v_order.seller_id,
                                  'result',    p_result,
                                  'reason',    p_reason,
                                  'at',        v_now
                                ))
                             || jsonb_build_array(jsonb_build_object(
                                  'seller_id', (v_next->>'seller_id')::UUID,
                                  'result',    'assigned',
                                  'at',        v_now
                                ))
    WHERE id = p_order_id;

    -- Notify the new seller directly. create_notification's recipient
    -- resolution is caller-relative ("the other party to the CALLER") —
    -- it has no path for "notify a third seller who is neither the
    -- caller nor the caller's counterpart", so this inserts directly,
    -- same SECURITY DEFINER bypass create_notification itself uses,
    -- reusing its resolve_seller_user_id() helper (019_notificationRpcV2.sql).
    v_new_uid := resolve_seller_user_id((v_next->>'seller_id')::UUID);
    IF v_new_uid IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
      VALUES (v_new_uid, 'Naya Order! 🛒', 'Aapko naya order mila', 'order_placed', p_order_id, false);
    END IF;

    RETURN jsonb_build_object(
      'success', true, 'reassigned', true,
      'new_seller_id', (v_next->>'seller_id')::UUID
    );
  END IF;

  -- Candidates exhausted — flag for admin. status stays 'pending' (no
  -- new status value introduced); seller_id cleared since nobody
  -- currently has this order.
  UPDATE orders SET
    seller_id       = NULL,
    routing_status  = 'needs_admin',
    routing_history = COALESCE(v_order.routing_history, '[]'::jsonb)
                       || jsonb_build_array(jsonb_build_object(
                            'seller_id', v_order.seller_id,
                            'result',    p_result,
                            'reason',    p_reason,
                            'at',        v_now
                          ))
  WHERE id = p_order_id;

  FOR v_admin IN SELECT email FROM staff_whitelist WHERE role = 'admin' AND is_approved = true LOOP
    SELECT id INTO v_admin_uid FROM users WHERE email = v_admin.email LIMIT 1;
    IF v_admin_uid IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
      VALUES (
        v_admin_uid, 'Order Ko Seller Nahi Mila ⚠️',
        'Order #' || COALESCE(v_order.order_number, p_order_id::TEXT) || ' — koi seller le nahi raha, manual assign karein',
        'order_needs_admin', p_order_id, false
      );
    END IF;
  END LOOP;

  -- Superadmin fallback notify (staff_whitelist mein admin na ho to bhi notify ho)
  FOR v_admin IN
    SELECT u.id as uid
    FROM super_admins sa
    JOIN users u ON u.email = sa.email
    WHERE sa.is_active = true
  LOOP
    INSERT INTO notifications
      (user_id, title, body, type, ref_id, is_read)
    VALUES (
      v_admin.uid,
      'Order Ko Seller Nahi Mila ⚠️',
      'Order #' || COALESCE(v_order.order_number,
        p_order_id::TEXT) ||
        ' — koi seller le nahi raha, manual assign karein',
      'order_needs_admin', p_order_id, false
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reassigned', false, 'exhausted', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION advance_order_routing(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_expired_routing()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

      -- Superadmin fallback notify (staff_whitelist mein admin na ho to bhi notify ho)
      FOR v_admin IN
        SELECT u.id as uid
        FROM super_admins sa
        JOIN users u ON u.email = sa.email
        WHERE sa.is_active = true
      LOOP
        INSERT INTO notifications
          (user_id, title, body, type, ref_id, is_read)
        VALUES (
          v_admin.uid,
          'Order Ko Seller Nahi Mila ⚠️',
          'Order #' || COALESCE(v_order.order_number,
            v_order.id::TEXT) ||
            ' — koi seller le nahi raha, manual assign karein',
          'order_needs_admin', v_order.id, false
        );
      END LOOP;

      v_exhausted := v_exhausted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'processed', v_processed, 'reassigned', v_reassigned, 'exhausted', v_exhausted);
END;
$function$;

GRANT EXECUTE ON FUNCTION process_expired_routing() TO authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- SELECT proname, length(prosrc) FROM pg_proc
--   WHERE proname IN ('advance_order_routing','process_expired_routing');
--
-- Both blocks present:
--   SELECT proname, prosrc ~ 'super_admins' AS has_super_admins_fallback
--   FROM pg_proc WHERE proname IN ('advance_order_routing','process_expired_routing');
--   -- expect: t, t
--
-- Smoke — force an order into needs_admin (e.g. reject with no other
-- candidates in that pincode) and check the active super_admin got 2
-- notifications for it (once via the old staff_whitelist loop attempt —
-- 0 rows there currently so nothing inserted from that branch — and
-- once via this new super_admins loop):
--   SELECT title, body, type, ref_id, created_at FROM notifications
--     WHERE type = 'order_needs_admin' ORDER BY created_at DESC LIMIT 5;

-- ================================================================
-- ROLLBACK
-- ================================================================
-- Purane (super_admins fallback ke bina) version par wapas jaane ke
-- liye: 016_orderFlowFixes.sql (advance_order_routing) aur jahan
-- process_expired_routing pehli baar define hui thi, unke CREATE OR
-- REPLACE FUNCTION blocks dobara chalao.
-- ================================================================
