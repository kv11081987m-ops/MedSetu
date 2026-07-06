-- ══════════════════════════════════════════════════
-- MedSetu — Notification RPC (Hard Case 4, option c)
-- Run this in Supabase SQL Editor
-- Replaces the "any authenticated user, any recipient" INSERT stopgap
-- from rlsPhase4.sql with real validation: the recipient must
-- actually be the other party on the order the notification is about.
-- ══════════════════════════════════════════════════


-- ================================================================
-- create_notification(p_user_id, p_title, p_body, p_type, p_ref_id)
--
-- Validates:
--   1. p_ref_id resolves to a real order.
--   2. The CALLER is a party to that order (customer/seller/buyer bridge).
--   3. p_user_id resolves to the OTHER party of that same order — not
--      just any user_id the caller feels like passing.
-- On any failure, returns false silently — no RAISE EXCEPTION.
-- Notifications are secondary to the order flow (same philosophy as
-- notifications.js's own "must never block accept/deliver/cancel/place"
-- comment) — a rejected notification must never surface as an error
-- the caller has to handle, it just doesn't get created.
--
-- Recipient resolution mirrors notifications.js's existing
-- getSellerUserId(): sellers.user_id is preferred, but falls back to
-- matching users by phone then email for older seller rows that
-- predate that column being populated.
-- ================================================================

CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID, p_title TEXT, p_body TEXT, p_type TEXT, p_ref_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order         orders%ROWTYPE;
  v_is_customer   BOOLEAN;
  v_is_seller     BOOLEAN;
  v_is_buyer      BOOLEAN;
  v_recipient_ok  BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL OR p_ref_id IS NULL THEN
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

  IF NOT (v_is_customer OR v_is_seller OR v_is_buyer) THEN
    RETURN false; -- caller isn't a party to this order at all
  END IF;

  IF v_is_customer THEN
    -- Recipient must be the selling seller's resolved user.
    v_recipient_ok :=
      EXISTS (SELECT 1 FROM sellers s WHERE s.id = v_order.seller_id AND s.user_id = p_user_id)
      OR EXISTS (
        SELECT 1 FROM sellers s JOIN users u ON (u.phone = s.phone OR u.email = s.email)
        WHERE s.id = v_order.seller_id AND u.id = p_user_id
      );
  ELSE
    -- Caller is the seller or the B2B buyer — recipient must be the
    -- customer, or (B2B) the other side's resolved user.
    v_recipient_ok :=
      (v_order.customer_id = p_user_id)
      OR EXISTS (SELECT 1 FROM sellers s WHERE s.id = v_order.buyer_id AND s.user_id = p_user_id)
      OR EXISTS (
        SELECT 1 FROM sellers s JOIN users u ON (u.phone = s.phone OR u.email = s.email)
        WHERE s.id = v_order.buyer_id AND u.id = p_user_id
      );
  END IF;

  IF NOT v_recipient_ok THEN
    RETURN false;
  END IF;

  INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
  VALUES (p_user_id, p_title, p_body, p_type, p_ref_id, false);

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;


-- ================================================================
-- notifications INSERT — default-deny. All inserts now go through
-- the DEFINER function above, which bypasses RLS for its own INSERT.
-- Direct client inserts (the old authenticated-only stopgap) no
-- longer have any path in.
-- ================================================================

DROP POLICY IF EXISTS "notifications_insert_authenticated" ON notifications;
-- (No replacement policy — default deny for direct table INSERT.)


-- ================================================================
-- VERIFY
-- ================================================================

-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'create_notification';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notifications';
-- (should show select_own and update_own only — no insert policy.)

-- Real-session checks:
--   1. Customer places an order -> seller gets "Naya Order" notification.
--   2. Seller accepts/delivers/cancels -> customer gets the matching notification.
--   3. B2B: retailer places order -> wholesaler notified; wholesaler
--      accepts/delivers -> retailer notified.
--   4. Try calling create_notification with a p_user_id NOT party to
--      p_ref_id's order -> returns false, no row inserted, no error thrown.
--   5. Realtime bell (CustomerHome/SellerDashboard/PharmacistPanel) still
--      receives INSERT events for its own user_id.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS create_notification(UUID, TEXT, TEXT, TEXT, UUID);
-- CREATE POLICY "notifications_insert_authenticated"
--   ON notifications FOR INSERT
--   WITH CHECK (auth.uid() IS NOT NULL);
