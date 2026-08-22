-- ══════════════════════════════════════════════════
-- MedSetu — R2-F: Admin manual-assign (needs_admin orders)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: ONE new RPC. Admin-side only — no B2B/seller/customer flow
-- touched. Depends on 028_rejectReassignChain.sql (orders.routing_status,
-- the app.routing_trusted trust flag on protect_order_sensitive_columns),
-- 025_routingFoundation.sql (assigned_at/routing_expires_at/routing_attempt/
-- assigned_by/routing_history), 019_notificationRpcV2.sql
-- (resolve_seller_user_id).
--
-- WHY A NEW RPC instead of extending advance_order_routing(): that
-- function's ownership check requires the CALLER to be the seller
-- CURRENTLY assigned to the order (028, "Only the seller CURRENTLY
-- assigned ... may advance it"). A needs_admin order has seller_id =
-- NULL — no seller could ever pass that check, and admin is a
-- different kind of caller (authorized by role, not by being a party
-- to the order) picking an ARBITRARY seller rather than "the next
-- candidate in line". Bolting that onto advance_order_routing would
-- mean threading an admin-vs-seller branch through a function whose
-- whole shape (candidate-list walk, tried-seller exclusion) is built
-- around the reject-chain use case. A small dedicated RPC is clearer.
--
-- Not restricted to routing_status='needs_admin' — deliberately usable
-- on any 'pending' order, so the same RPC also covers admin manually
-- reassigning an order that still has an active seller (the UI below
-- only surfaces needs_admin orders for now; the RPC itself doesn't
-- need to know that's the only caller).

-- ================================================================
-- assign_order_to_seller(p_order_id, p_seller_id)
-- ================================================================
-- Returns JSONB:
--   { success: false, message }   — couldn't proceed
--   { success: true, seller_id }  — assigned
CREATE OR REPLACE FUNCTION assign_order_to_seller(
  p_order_id UUID, p_seller_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_seller      sellers%ROWTYPE;
  v_timeout_min INTEGER;
  v_now         TIMESTAMP := NOW();
  v_new_uid     UUID;
BEGIN
  IF NOT (is_active_superadmin() OR is_approved_admin()) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Aapko admin access nahi hai');
  END IF;

  -- Lock the row first — same FOR UPDATE pattern as advance_order_routing
  -- (028), closes the race against a concurrent reject/timeout/assign
  -- call landing on the same order.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = p_seller_id AND seller_type = 'retailer';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Seller nahi mila');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Yeh order ab pending nahi hai (status: ' || v_order.status || ')');
  END IF;

  SELECT routing_timeout_minutes INTO v_timeout_min FROM platform_settings WHERE id = 1;
  v_timeout_min := COALESCE(v_timeout_min, 15);

  -- Trust flag so protect_order_sensitive_columns() (028) lets this
  -- UPDATE touch seller_id/status/routing_* — same flag 028 added, no
  -- trigger change needed here.
  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders SET
    seller_id          = p_seller_id,
    assigned_at         = v_now,
    routing_expires_at  = v_now + (v_timeout_min || ' minutes')::INTERVAL,
    routing_attempt     = COALESCE(v_order.routing_attempt, 0) + 1,
    assigned_by         = 'admin',
    routing_status      = NULL,
    routing_history     = COALESCE(v_order.routing_history, '[]'::jsonb)
                           || jsonb_build_array(jsonb_build_object(
                                'seller_id', p_seller_id,
                                'result',    'admin_assigned',
                                'at',        v_now
                              ))
  WHERE id = p_order_id;

  -- Notify the assigned seller directly — same reasoning as 028 (no
  -- create_notification path fits "notify a third seller who isn't the
  -- caller or the caller's counterpart").
  v_new_uid := resolve_seller_user_id(p_seller_id);
  IF v_new_uid IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
    VALUES (v_new_uid, 'Naya Order! 🛒', 'Aapko naya order mila', 'order_placed', p_order_id, false);
  END IF;

  RETURN jsonb_build_object('success', true, 'seller_id', p_seller_id);
END;
$$;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname, prosecdef, pronargs FROM pg_proc WHERE proname = 'assign_order_to_seller';

-- Real-session checks:
--   1. Non-admin user calls this -> {success:false, message:'Aapko admin
--      access nahi hai'}.
--   2. Admin assigns a needs_admin order (seller_id NULL,
--      routing_status='needs_admin') to seller X -> seller_id=X,
--      routing_status=NULL, status stays 'pending', assigned_by='admin',
--      routing_history gets one 'admin_assigned' entry, seller X gets a
--      notification.
--   3. Admin tries to assign an already-delivered/cancelled order ->
--      {success:false, message mentions current status}.
--   4. Two admins assign the same needs_admin order near-simultaneously
--      -> FOR UPDATE serializes them, second call still succeeds but
--      overwrites to the second admin's chosen seller (last-write-wins,
--      same as any other single-row UPDATE — no special handling needed
--      since only one order-row is involved, not a shared counter).
--   5. B2B orders (buyer_type='retailer') are untouched — this RPC only
--      gets called from the admin UI's needs_admin list, which itself is
--      only ever populated by 028's B2C reassign-chain exhaustion.

-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS assign_order_to_seller(UUID, UUID);
