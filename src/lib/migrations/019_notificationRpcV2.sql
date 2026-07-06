-- ══════════════════════════════════════════════════
-- MedSetu — create_notification v2: server-side recipient resolution
-- Run this in Supabase SQL Editor
--
-- Why: getSellerUserId() (notifications.js) reads the OTHER party's
-- users row by phone/email match — since 014_rlsPhase5a.sql's users
-- SELECT policy only allows own-row/admin/pharmacist, every real
-- caller (a customer or a different seller) gets blocked and the
-- lookup silently returns null. Net effect: seller/wholesaler "new
-- order" notifications have been silently not firing since Phase 5a.
-- Fix: the RPC resolves the recipient itself, server-side, under
-- SECURITY DEFINER (bypasses RLS) — the client no longer needs to
-- pre-resolve or pass a recipient at all.
-- ══════════════════════════════════════════════════


-- ================================================================
-- resolve_seller_user_id(p_seller_id) — same fallback chain as the
-- old client-side getSellerUserId(): prefer sellers.user_id, fall
-- back to matching users by phone then email for seller rows that
-- predate that column being populated. Shared by both branches below
-- (used for the selling seller's side AND the B2B buyer's side —
-- buyer_id is also a sellers.id).
-- ================================================================

CREATE OR REPLACE FUNCTION resolve_seller_user_id(p_seller_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller sellers%ROWTYPE;
  v_uid    UUID;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_seller.user_id IS NOT NULL THEN
    RETURN v_seller.user_id;
  END IF;

  IF v_seller.phone IS NOT NULL THEN
    SELECT id INTO v_uid FROM users WHERE phone = v_seller.phone LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  IF v_seller.email IS NOT NULL THEN
    SELECT id INTO v_uid FROM users WHERE email = v_seller.email LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  RETURN NULL;
END;
$$;


-- ================================================================
-- create_notification(p_title, p_body, p_type, p_ref_id) — v2.
-- p_user_id is GONE. The function determines which party the caller
-- is (same three bridges the orders/order_items policies already
-- use), then resolves the OTHER party as the recipient:
--   - caller is the B2C customer      -> recipient = selling seller
--   - caller is the selling seller,
--     order is B2B (buyer_id set)     -> recipient = buying retailer
--   - caller is the selling seller,
--     order is B2C                    -> recipient = customer_id directly
--   - caller is the B2B buyer         -> recipient = selling seller
--   - caller isn't a party at all     -> false, nothing inserted
-- Old 5-param version is dropped, not just replaced (different arg
-- list = different overload in Postgres; a plain CREATE OR REPLACE
-- would have left both signatures callable).
-- ================================================================

DROP FUNCTION IF EXISTS create_notification(UUID, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION create_notification(
  p_title TEXT, p_body TEXT, p_type TEXT, p_ref_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_is_customer BOOLEAN;
  v_is_seller   BOOLEAN;
  v_is_buyer    BOOLEAN;
  v_recipient   UUID;
BEGIN
  IF p_ref_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_ref_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_is_customer := EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_order.customer_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );
  v_is_seller := EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );
  v_is_buyer := EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.buyer_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );

  IF v_is_customer THEN
    v_recipient := resolve_seller_user_id(v_order.seller_id);
  ELSIF v_is_seller THEN
    IF v_order.buyer_type = 'retailer' AND v_order.buyer_id IS NOT NULL THEN
      v_recipient := resolve_seller_user_id(v_order.buyer_id);
    ELSE
      v_recipient := v_order.customer_id;
    END IF;
  ELSIF v_is_buyer THEN
    v_recipient := resolve_seller_user_id(v_order.seller_id);
  ELSE
    RETURN false; -- caller isn't a party to this order at all
  END IF;

  IF v_recipient IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
  VALUES (v_recipient, p_title, p_body, p_type, p_ref_id, false);

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;


-- ================================================================
-- Realtime — NOT affected. Confirmed: delivery to a subscribed
-- client is gated by the notifications SELECT policy (own row via
-- the auth_id bridge), which this file doesn't touch. Only the
-- INSERT path (already default-deny for direct client writes since
-- 018_notificationRpc.sql) changes — a SECURITY DEFINER function's
-- INSERT looks identical to any other INSERT to a listening client.
-- ================================================================


-- ================================================================
-- VERIFY
-- ================================================================

-- SELECT proname, prosecdef, pronargs FROM pg_proc
--   WHERE proname IN ('create_notification', 'resolve_seller_user_id');
-- (create_notification should show pronargs = 4 now, only one row.)

-- Real-session checks:
--   1. Customer places a B2C order -> seller now actually receives
--      "Naya Order" (previously silently didn't).
--   2. Seller accepts/delivers/cancels -> customer still notified
--      (this direction already worked, confirm it still does).
--   3. B2B: retailer places order -> wholesaler notified (previously
--      silently didn't); wholesaler accepts/delivers -> retailer
--      notified (previously silently didn't).
--   4. Any of the above from a session that ISN'T actually party to
--      that order -> no row inserted, no error surfaced.
--   5. Realtime bells (CustomerHome/SellerDashboard/PharmacistPanel)
--      still receive INSERT events for their own user_id.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS create_notification(TEXT, TEXT, TEXT, UUID);
-- DROP FUNCTION IF EXISTS resolve_seller_user_id(UUID);
-- -- Then re-create the old 5-param version from
-- -- migrations/018_notificationRpc.sql if you need to revert the
-- -- client call sites too.
