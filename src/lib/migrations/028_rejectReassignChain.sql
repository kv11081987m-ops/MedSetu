-- ══════════════════════════════════════════════════
-- MedSetu — R2-E: seller reject → next candidate seller (reassign chain)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: seller-reject-driven reassignment only. Scheduler-driven timeout
-- (R2-D) and admin manual-assign UI are separate, later work — this file
-- only builds what R2-E needs, but advance_order_routing()'s p_result
-- param is generic ('rejected' | 'timeout' | ...) so R2-D can call the
-- same function later without changing it.
--
-- Depends on: 025_routingFoundation.sql (routing_history/routing_attempt/
-- assigned_at/routing_expires_at/assigned_by), 026_serviceablePincodes.sql
-- (delivery_pincode), 027_routingCandidatesFn.sql (get_routing_candidates),
-- 019_notificationRpcV2.sql (resolve_seller_user_id), 015_rlsPhase5b.sql
-- (protect_order_sensitive_columns — replaced below, additively).

-- ================================================================
-- 1. orders.routing_status — additive, nullable
-- ================================================================
-- NULL = normal (either not yet routed, or currently assigned to a
-- seller). 'needs_admin' = every routing candidate for this order's
-- pincode has already been tried (rejected/timed out) — no seller
-- currently assigned, waiting on a human. Deliberately a separate
-- column from assigned_by ('auto'|'admin' = WHO assigned the current
-- seller) rather than overloading it — this is a STATE ("nobody has it
-- right now"), not an assigner, and conflating the two would make
-- assigned_by ambiguous for every other reader of that column.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_status TEXT DEFAULT NULL;


-- ================================================================
-- 2. protect_order_sensitive_columns() — add a routing-trusted escape
-- hatch, same shape as mark_order_delivered's existing
-- app.mark_delivered_trusted flag (015_rlsPhase5b.sql). Without this,
-- advance_order_routing()'s UPDATE (below) touching seller_id/status/
-- routing_* columns would be evaluated under the REJECTING SELLER's own
-- auth.uid() (SECURITY DEFINER changes execution privilege, not what
-- auth.uid()/is_approved_admin() return — same fact this trigger's own
-- header comment already documents for mark_order_delivered). The
-- seller-branch of this trigger happens not to reset seller_id today, so
-- the UPDATE would technically still pass — but that's an incidental gap
-- in a hand-maintained column list, not a guarantee. This flag makes the
-- RPC's authority explicit instead of silently depending on that gap
-- never being closed by an unrelated future edit.
-- ================================================================

CREATE OR REPLACE FUNCTION protect_order_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_privileged  BOOLEAN;
  v_is_seller   BOOLEAN;
  v_is_buyer    BOOLEAN;
  v_is_customer BOOLEAN;
BEGIN
  v_privileged := is_active_superadmin()
                  OR is_approved_admin()
                  OR COALESCE(current_setting('app.mark_delivered_trusted', true), 'false') = 'true'
                  OR COALESCE(current_setting('app.routing_trusted', true), 'false') = 'true';

  -- Commission fields: only admin/superadmin/the trusted RPCs may set these.
  IF NOT v_privileged THEN
    NEW.commission_rate   := OLD.commission_rate;
    NEW.commission_amount := OLD.commission_amount;
    NEW.seller_earning    := OLD.seller_earning;
  END IF;

  IF v_privileged THEN
    RETURN NEW;
  END IF;

  IF is_approved_pharmacist() THEN
    IF NOT (OLD.status = 'pending' AND NEW.status IN ('confirmed', 'cancelled')) THEN
      NEW.status             := OLD.status;
      NEW.pharmacist_verified := OLD.pharmacist_verified;
    END IF;
    NEW.customer_id       := OLD.customer_id;
    NEW.seller_id         := OLD.seller_id;
    NEW.buyer_id          := OLD.buyer_id;
    NEW.final_amount      := OLD.final_amount;
    NEW.received_by_buyer := OLD.received_by_buyer;
    RETURN NEW;
  END IF;

  v_is_seller := EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = OLD.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );
  IF v_is_seller THEN
    IF NEW.status = 'delivered' THEN
      NEW.status := OLD.status; -- must go through mark_order_delivered()
    END IF;
    NEW.customer_id         := OLD.customer_id;
    NEW.buyer_id            := OLD.buyer_id;
    NEW.final_amount        := OLD.final_amount;
    NEW.pharmacist_verified := OLD.pharmacist_verified;
    NEW.received_by_buyer   := OLD.received_by_buyer;
    RETURN NEW;
  END IF;

  v_is_buyer := EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = OLD.buyer_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );
  IF v_is_buyer THEN
    NEW.status              := OLD.status;
    NEW.customer_id          := OLD.customer_id;
    NEW.seller_id            := OLD.seller_id;
    NEW.final_amount         := OLD.final_amount;
    NEW.pharmacist_verified  := OLD.pharmacist_verified;
    RETURN NEW;
  END IF;

  v_is_customer := EXISTS (
    SELECT 1 FROM users u WHERE u.id = OLD.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );
  IF v_is_customer THEN
    IF NOT (OLD.status IN ('pending', 'confirmed') AND NEW.status = 'cancelled') THEN
      NEW.status := OLD.status;
    END IF;
    NEW.seller_id            := OLD.seller_id;
    NEW.buyer_id             := OLD.buyer_id;
    NEW.final_amount         := OLD.final_amount;
    NEW.pharmacist_verified  := OLD.pharmacist_verified;
    NEW.received_by_buyer    := OLD.received_by_buyer;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
-- (Trigger itself — trg_protect_order_sensitive_columns — already exists
-- from 015_rlsPhase5b.sql and points at this function by name; replacing
-- the function body is enough, no need to re-create the trigger.)


-- ================================================================
-- 3. advance_order_routing(p_order_id, p_result, p_reason)
-- ================================================================
-- Called when a seller rejects a pending B2C order (R2-E) — and, later,
-- unchanged, by a timeout scheduler (R2-D) with p_result='timeout'.
-- p_result is free text describing why the current seller is being
-- removed ('rejected' | 'timeout' | ...), stored in routing_history.
--
-- Returns JSONB:
--   { success: false, message }                         — couldn't proceed at all
--   { success: true, reassigned: true, new_seller_id }  — moved to next candidate
--   { success: true, reassigned: false, exhausted: true } — no candidates left, admin flagged
CREATE OR REPLACE FUNCTION advance_order_routing(
  p_order_id UUID, p_result TEXT, p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  RETURN jsonb_build_object('success', true, 'reassigned', false, 'exhausted', true);
END;
$$;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'routing_status';

-- SELECT proname, prosecdef, pronargs FROM pg_proc WHERE proname = 'advance_order_routing';

-- Real-session checks (need at least 2 retailer sellers with
-- routing_weight > 0 in the same serviceable pincode, and a pending
-- order routed to one of them):
--   1. Seller A rejects -> order.seller_id becomes seller B, status
--      stays 'pending', routing_attempt +1, routing_history has 2 new
--      entries (A: rejected, B: assigned). Seller B gets a notification.
--   2. Seller B also rejects (no more candidates) -> seller_id NULL,
--      routing_status='needs_admin', status still 'pending'. Every
--      approved admin (staff_whitelist role='admin') gets a notification.
--   3. A seller tries to call advance_order_routing on an order that
--      ISN'T currently assigned to them -> {success:false, message:'Yeh
--      order aapka nahi hai'}.
--   4. Two near-simultaneous reject calls on the same order (double-tap)
--      -> second one sees status/seller_id already changed by the first
--      (FOR UPDATE serializes them) and fails cleanly, no double-reassign.
--   5. A B2B order (buyer_type='retailer') is untouched by this file —
--      SellerDashboard.jsx still isn't wired to call this RPC for those
--      (that's the JS-side change, separate from this migration).


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS advance_order_routing(UUID, TEXT, TEXT);
-- ALTER TABLE orders DROP COLUMN IF EXISTS routing_status;
-- -- Restore protect_order_sensitive_columns() to the 015_rlsPhase5b.sql
-- -- version (drop the "OR ... app.routing_trusted ..." line from
-- -- v_privileged) if the routing-trusted bypass needs to be revoked.
