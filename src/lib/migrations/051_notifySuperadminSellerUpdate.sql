-- ══════════════════════════════════════════════════
-- MedSetu — notify_superadmins_seller_updated (Phase 1 seller self-edit)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Why a new RPC instead of create_notification: create_notification
-- (019_notificationRpcV2.sql) resolves its recipient by looking up
-- p_ref_id in `orders` and finding "the other party to that order" —
-- it has no concept of a seller-profile-edit event and no path to
-- target the superadmin. Calling it with a sellers.id as p_ref_id would
-- just silently return false (order NOT FOUND), notifying nobody.
--
-- Instead this follows the direct-insert pattern already used for
-- admin-facing events that aren't order-party-relative
-- (049_superadminNotifyFallback.sql's super_admins loop): SECURITY
-- DEFINER, loops active super_admins, inserts one notification each.
--
-- Store name and caller identity are both resolved server-side (not
-- trusted from the client) — the function only accepts a seller_id and
-- verifies the caller actually owns that seller row before notifying,
-- same ownership check advance_order_routing uses.

CREATE OR REPLACE FUNCTION public.notify_superadmins_seller_updated(p_seller_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller sellers%ROWTYPE;
  v_admin  RECORD;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Only the seller's own linked user may trigger this notify — same
  -- bridge advance_order_routing uses to authorize a seller action.
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_seller.user_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) THEN
    RETURN false;
  END IF;

  FOR v_admin IN
    SELECT u.id AS uid
    FROM super_admins sa
    JOIN users u ON u.email = sa.email
    WHERE sa.is_active = true
  LOOP
    INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
    VALUES (
      v_admin.uid,
      'Seller Details Update ✏️',
      v_seller.store_name || ' ne apni details update ki hain — review karein',
      'seller_details_updated', p_seller_id, false
    );
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_superadmins_seller_updated(uuid) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT proname, prosecdef, pronargs FROM pg_proc
--   WHERE proname = 'notify_superadmins_seller_updated';
--   -- expect: 1 row, prosecdef = t, pronargs = 1

-- Smoke: as a logged-in seller, call
--   select notify_superadmins_seller_updated('<own sellers.id>');
-- then check every active super_admin got a row:
--   SELECT title, body, type, ref_id, created_at FROM notifications
--     WHERE type = 'seller_details_updated' ORDER BY created_at DESC LIMIT 5;
-- Calling it with someone else's seller id (or while logged out) must
-- return false and insert nothing.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS notify_superadmins_seller_updated(uuid);
