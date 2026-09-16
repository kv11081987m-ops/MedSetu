-- ══════════════════════════════════════════════════
-- MedSetu — Return/Refund system, ground-up.
-- PART A: table + RLS + storage + request_return RPC (customer).
-- PART B: seller_review_return + admin_decide_return + process_refund
--         RPCs (seller / superadmin side of the lifecycle).
--
-- Lifecycle: requested → seller_reviewed → approved|rejected → refunded
--   (UI still to come — this file gets the whole guarded state-machine
--    working end-to-end from SQL Editor / RPC calls.)
--
-- Run this in Supabase SQL Editor (046 ke baad). Idempotent-ish —
-- CREATE TABLE/POLICY use IF NOT EXISTS / DROP+CREATE where relevant.
--
-- Depends on: orders, users, sellers (001_schema.sql), notifications
-- (018/019), is_active_superadmin() (014_rlsPhase5a.sql), prescriptions
-- bucket policy shape (016_orderFlowFixes.sql PART 2 — same path-scoped
-- pattern reused here for return-photos).
--
-- ⚠️ DEVIATIONS from the draft spec — security fixes, flagged here so
-- they're not silently different from what was asked:
--   1. Customer RLS policy is SELECT-only (not FOR ALL). A "FOR ALL"
--      policy on customer_id would let a customer UPDATE their own row
--      directly via supabase-js — including status/admin_action/
--      refund_amount — completely bypassing the guarded RPCs below.
--      All writes now go through SECURITY DEFINER RPCs only (matches
--      the "cancel_order jaisa guarded" requirement).
--   2. Storage SELECT policy scoped to the actual involved parties
--      (customer/seller/superadmin via an EXISTS join), not a blanket
--      `USING (bucket_id = 'return-photos')` — the draft's version let
--      ANY authenticated user view ANY return photo on the platform.
--      Mirrors the existing prescriptions-bucket pattern exactly
--      (016_orderFlowFixes.sql PART 2).
--   3. Storage INSERT policy scoped to the uploader's own folder
--      (path convention: `<customer_users_id>/<order_id>/<filename>`),
--      not "any authenticated user, any path" — same reasoning as #2,
--      and matches the prescriptions bucket's own-folder convention.
--   4. Added CHECK constraints for reason/status/seller_action/
--      admin_action/refund_status — the draft already documented the
--      valid values as comments; making Postgres enforce them is a
--      small addition matching that intent (orders.status has no such
--      constraint — a real gap found in the read-only investigation —
--      no reason to repeat it on a brand-new table).
--   5. Added a partial unique index so only one *active* (non-rejected)
--      return can exist per order — enforced at the DB level (race-safe),
--      not just inside the RPC.
--   6. customer/seller ownership checks use `auth_id = auth.uid() OR
--      email = auth.email()` (not auth_id alone) — matches the
--      Google/magic-link fallback used everywhere else in this codebase
--      (e.g. cancel_order, create_notification).
--
-- PART B deviations (seller_review_return / admin_decide_return / process_refund):
--   7. admin_decide_return now rejects 'approved' with a NULL/<=0
--      p_refund_amount instead of silently writing refund_amount=NULL —
--      the draft let an "approved" return through with no refund amount
--      set, which process_refund would then happily mark 'processed'
--      on (an approved-but-nothing-refunded broken state).
--   8. RESOLVED (targeted fix): admin_decide_return now INSERTs directly
--      into notifications instead of calling create_notification() —
--      it has to, since create_notification resolves the recipient from
--      the CALLER's relationship to the order (customer→seller,
--      seller→customer/buyer), and a superadmin is none of those (it
--      would've silently returned false). ⚠️ CAVEAT still open: this
--      INSERT sets ref_id = p_return_id (a order_returns.id), but every
--      other notification in this codebase sets ref_id = orders.id —
--      CustomerHome.jsx's notification-tap handler does
--      `navigate('/order-tracking', { state: { orderId: n.ref_id } })`
--      unconditionally for every notification type, so tapping THIS one
--      will hand OrderTracking a return_id instead of an order_id and
--      fail to load. Left as specified (targeted-fix request) — needs
--      either a ref_id convention exception in that click handler, or
--      switching this INSERT to ref_id = v_return.order_id, before any
--      customer-facing UI ships.
--   9. RESOLVED (targeted fix): process_refund now sets
--      orders.status = 'returned' after marking refund_status =
--      'processed' — a fully refunded order now reaches a terminal
--      status instead of staying at 'return_requested' forever. Note:
--      'returned' is a brand-new orders.status value with no CHECK
--      constraint to catch typos (orders.status has none — confirmed
--      earlier) and no UI anywhere recognizes it yet (OrderHistory.jsx's
--      ACTIVE_STATUSES / 'delivered' / 'cancelled' branches won't match
--      it, so such an order will render with none of the current action
--      buttons until that screen is updated for it).
-- ══════════════════════════════════════════════════

-- ────────────────────────────────────────────────────
-- 1) order_returns table
-- ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_returns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id),
  customer_id         uuid NOT NULL REFERENCES users(id),
  reason              text NOT NULL
                         CHECK (reason IN ('wrong_item','damaged','not_delivered','expired','other')),
  reason_detail       text,
  photo_url           text,
  status              text NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested','seller_reviewed','approved','rejected','refunded')),
  -- requested → seller_reviewed → approved → rejected → refunded
  seller_action       text CHECK (seller_action IS NULL OR seller_action IN ('accepted','rejected')),
  seller_note         text,
  seller_reviewed_at  timestamptz,
  admin_action        text CHECK (admin_action IS NULL OR admin_action IN ('approved','rejected')),
  admin_note          text,
  refund_amount       numeric(10,2),
  refund_status       text DEFAULT 'pending' CHECK (refund_status IN ('pending','processed')),
  requested_at        timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_returns_order_id_idx    ON order_returns(order_id);
CREATE INDEX IF NOT EXISTS order_returns_customer_id_idx ON order_returns(customer_id);
CREATE INDEX IF NOT EXISTS order_returns_status_idx      ON order_returns(status);

-- Ek order par ek hi waqt me ek "active" (non-rejected) return —
-- rejected hone ke baad dobara request allowed hai (naya row), isliye
-- partial index sirf status <> 'rejected' par.
CREATE UNIQUE INDEX IF NOT EXISTS order_returns_one_active_per_order
  ON order_returns (order_id)
  WHERE status <> 'rejected';

-- ────────────────────────────────────────────────────
-- 2) RLS
-- ────────────────────────────────────────────────────
ALTER TABLE order_returns ENABLE ROW LEVEL SECURITY;

-- Customer: apni returns dekh sakta hai — likhna sirf RPC (SECURITY
-- DEFINER) se, taaki status/admin_action/refund_amount jaise fields
-- direct table-write se bypass na ho sakein.
CREATE POLICY "customer_select_own_returns" ON order_returns
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT id FROM users WHERE auth_id = auth.uid() OR email = auth.email() LIMIT 1)
  );

CREATE POLICY "seller_see_returns" ON order_returns
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      JOIN sellers s ON s.id = o.seller_id
      JOIN users u ON u.id = s.user_id
      WHERE o.id = order_returns.order_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email())
    )
  );

CREATE POLICY "superadmin_all_returns" ON order_returns
  FOR ALL TO authenticated
  USING (is_active_superadmin())
  WITH CHECK (is_active_superadmin());

-- ────────────────────────────────────────────────────
-- 3) Storage bucket for return photos
-- Path convention: `<customer_users_id>/<order_id>/<filename>`
-- (photo upload happens BEFORE request_return is called — return_id
-- doesn't exist yet at upload time — so the path can only key off
-- customer_id + order_id, both known client-side already).
-- ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('return-photos', 'return-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "customer_upload_return_photo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'return-photos'
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_id = auth.uid() AND u.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "involved_parties_see_return_photo" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'return-photos'
    AND (
      -- (a) customer: apni hi photo — path ka pehla folder = uski users.id
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_id = auth.uid() AND u.id::text = (storage.foldername(objects.name))[1]
      )
      -- (b) seller: jis return ki ye photo hai, uska order us seller ka ho
      OR EXISTS (
        SELECT 1
        FROM order_returns r
        JOIN orders o ON o.id = r.order_id
        JOIN sellers s ON s.id = o.seller_id
        JOIN users u ON u.id = s.user_id
        WHERE r.photo_url = objects.name
          AND (u.auth_id = auth.uid() OR u.email = auth.email())
      )
      -- (c) superadmin
      OR is_active_superadmin()
    )
  );

-- ────────────────────────────────────────────────────
-- 4) RPC: request_return (customer) — guarded, cancel_order jaisा
-- ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION request_return(
  p_order_id      uuid,
  p_reason        text,
  p_reason_detail text DEFAULT NULL,
  p_photo_url     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_customer_id uuid;
  v_return_id   uuid;
BEGIN
  -- Customer ki apni id
  SELECT id INTO v_customer_id FROM users
  WHERE auth_id = auth.uid() OR email = auth.email()
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Login required');
  END IF;

  IF p_reason NOT IN ('wrong_item', 'damaged', 'not_delivered', 'expired', 'other') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid return reason');
  END IF;

  -- Order check: delivered + customer ka apna
  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id AND customer_id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status != 'delivered' THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Sirf delivered orders par return request ho sakti hai');
  END IF;

  -- Duplicate guard — friendly message; order_returns_one_active_per_order
  -- (unique index, upar) isi ko DB-level par bhi enforce karta hai
  -- (concurrent double-submit ke against race-safe).
  IF EXISTS (
    SELECT 1 FROM order_returns
    WHERE order_id = p_order_id AND status <> 'rejected'
  ) THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Is order par pehle se ek return request active hai');
  END IF;

  INSERT INTO order_returns (order_id, customer_id, reason, reason_detail, photo_url)
  VALUES (p_order_id, v_customer_id, p_reason, p_reason_detail, p_photo_url)
  RETURNING id INTO v_return_id;

  -- Notification (seller ko batana ki naya return request aaya hai) is
  -- yahan SE nahi ki jaati — is codebase ka pattern hai ki guarded RPC
  -- sirf state-transition karta hai, aur caller (JS) alag se
  -- supabase.rpc('create_notification', {...}) fire-and-forget call
  -- karta hai (SellerDashboard.jsx accept-order flow jaisa). Wahi yahan
  -- bhi follow karna — is RPC ke andar nahi, kyunki create_notification
  -- khud caller ke role (customer/seller/buyer) se recipient resolve
  -- karta hai aur ref_id = orders.id expect karta hai, return_id nahi.

  RETURN jsonb_build_object('success', true, 'message', 'Return request submit ho gayi', 'return_id', v_return_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'message', 'Is order par pehle se ek return request active hai');
END;
$$;

GRANT EXECUTE ON FUNCTION request_return(uuid, text, text, text) TO authenticated;

-- ────────────────────────────────────────────────────
-- 5) RPC: seller_review_return (seller accepts/rejects the request)
-- ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seller_review_return(
  p_return_id   uuid,
  p_action      text,  -- 'accepted' | 'rejected'
  p_note        text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_return order_returns%ROWTYPE;
BEGIN
  SELECT * INTO v_return FROM order_returns
  WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','Return nahi mila');
  END IF;

  -- Ye seller is order ka owner hai?
  IF NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN sellers s ON s.id = o.seller_id
    JOIN users u ON u.id = s.user_id
    WHERE o.id = v_return.order_id
    AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) THEN
    RETURN jsonb_build_object('success',false,'message','Authorized nahi');
  END IF;

  IF v_return.status != 'requested' THEN
    RETURN jsonb_build_object('success',false,
      'message','Sirf requested status par seller review ho sakta hai');
  END IF;

  IF p_action NOT IN ('accepted','rejected') THEN
    RETURN jsonb_build_object('success',false,'message','Invalid action');
  END IF;

  UPDATE order_returns SET
    status = 'seller_reviewed',
    seller_action = p_action,
    seller_note = p_note,
    seller_reviewed_at = now(),
    updated_at = now()
  WHERE id = p_return_id;

  RETURN jsonb_build_object('success',true,'action',p_action);
END; $$;

GRANT EXECUTE ON FUNCTION seller_review_return(uuid,text,text) TO authenticated;

-- ────────────────────────────────────────────────────
-- 6) RPC: admin_decide_return (SuperAdmin final call)
-- ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_decide_return(
  p_return_id    uuid,
  p_action       text,   -- 'approved' | 'rejected'
  p_refund_amount numeric DEFAULT NULL,
  p_note         text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_return order_returns%ROWTYPE;
BEGIN
  IF NOT is_active_superadmin() THEN
    RETURN jsonb_build_object('success',false,'message','Superadmin only');
  END IF;

  IF p_action NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('success',false,'message','Invalid action');
  END IF;

  -- Deviation #7 (see header): 'approved' ke saath valid refund_amount
  -- zaroori hai — warna refund_amount=NULL ke saath 'approved' row ban
  -- jaati thi, jise process_refund aage bina kisi amount ke bhi
  -- 'processed' mark kar deta.
  IF p_action = 'approved' AND (p_refund_amount IS NULL OR p_refund_amount <= 0) THEN
    RETURN jsonb_build_object('success',false,'message','Approved ke liye valid refund_amount zaroori hai');
  END IF;

  SELECT * INTO v_return FROM order_returns
  WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','Return nahi mila');
  END IF;

  IF v_return.status NOT IN ('requested','seller_reviewed') THEN
    RETURN jsonb_build_object('success',false,
      'message','Ye return already decided ho chuka hai');
  END IF;

  UPDATE order_returns SET
    status = CASE p_action WHEN 'approved' THEN 'approved' ELSE 'rejected' END,
    admin_action = p_action,
    admin_note = p_note,
    refund_amount = CASE p_action WHEN 'approved' THEN p_refund_amount ELSE NULL END,
    refund_status = CASE p_action WHEN 'approved' THEN 'pending' ELSE NULL END,
    updated_at = now()
  WHERE id = p_return_id;

  -- Order status update agar approved
  IF p_action = 'approved' THEN
    UPDATE orders SET status = 'return_requested', updated_at = now()
    WHERE id = v_return.order_id;
  END IF;

  INSERT INTO notifications (user_id, title, body, type, ref_id)
  VALUES (
    v_return.customer_id,
    CASE p_action WHEN 'approved' THEN 'Return Approved ✅' ELSE 'Return Rejected ❌' END,
    CASE p_action WHEN 'approved'
      THEN 'Aapka refund ₹' || p_refund_amount || ' process ho raha hai'
      ELSE COALESCE(p_note, 'Aapki return request reject ho gayi') END,
    'return_update',
    p_return_id
  );

  RETURN jsonb_build_object('success',true,'action',p_action,
    'refund_amount',p_refund_amount);
END; $$;

GRANT EXECUTE ON FUNCTION admin_decide_return(uuid,text,numeric,text) TO authenticated;

-- ────────────────────────────────────────────────────
-- 7) RPC: process_refund (SuperAdmin — manual refund complete mark karta hai)
-- ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_refund(
  p_return_id uuid,
  p_note      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF NOT is_active_superadmin() THEN
    RETURN jsonb_build_object('success',false,'message','Superadmin only');
  END IF;

  UPDATE order_returns SET
    refund_status = 'processed',
    admin_note = COALESCE(p_note, admin_note),
    updated_at = now()
  WHERE id = p_return_id
  AND status = 'approved'
  AND refund_status = 'pending'
  RETURNING order_id INTO v_order_id;

  -- v_order_id NULL = UPDATE ne koi row touch nahi ki (FOUND upar wali
  -- UPDATE ke turant baad hi valid hai — beech me ek aur UPDATE daalne
  -- se overwrite ho jaata, isliye RETURNING se seedha capture kiya).
  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success',false,
      'message','Return approved+pending state mein nahi hai');
  END IF;

  UPDATE orders SET
    status = 'returned',
    updated_at = now()
  WHERE id = v_order_id;

  RETURN jsonb_build_object('success',true,'message','Refund processed mark ho gaya');
END; $$;

GRANT EXECUTE ON FUNCTION process_refund(uuid,text) TO authenticated;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- 1. Table + constraints exist:
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'order_returns' ORDER BY ordinal_position;
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'order_returns'::regclass AND contype = 'c';
--
-- 2. RLS policies:
--   SELECT polname FROM pg_policy WHERE polrelid = 'order_returns'::regclass;
--   -- expect: customer_select_own_returns, seller_see_returns, superadmin_all_returns
--
-- 3. Storage bucket + policies:
--   SELECT id, public FROM storage.buckets WHERE id = 'return-photos';
--   SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
--     AND polname IN ('customer_upload_return_photo', 'involved_parties_see_return_photo');
--
-- 4. Smoke (customer session, apna ek delivered order id se):
--   SELECT request_return('<delivered-order-id>'::uuid, 'damaged', 'Box tuta hua tha', NULL);
--   -- expect: {"success": true, "message": "...", "return_id": "..."}
--   -- dobara same order pe:
--   SELECT request_return('<delivered-order-id>'::uuid, 'damaged', NULL, NULL);
--   -- expect: {"success": false, "message": "Is order par pehle se..."}
--
-- 5. Non-delivered order par try:
--   SELECT request_return('<pending-order-id>'::uuid, 'damaged', NULL, NULL);
--   -- expect: {"success": false, "message": "Sirf delivered orders..."}
--
-- 6. PART B smoke (seller session, apna return_id se):
--   SELECT seller_review_return('<return-id>'::uuid, 'accepted', 'Sahi lag raha hai');
--   -- expect: {"success": true, "action": "accepted"}; order_returns.status -> 'seller_reviewed'
--
-- 7. PART B smoke (superadmin session):
--   SELECT admin_decide_return('<return-id>'::uuid, 'approved', 250.00, 'OK, refund karo');
--   -- expect: {"success": true, "action": "approved", "refund_amount": 250.00}
--   -- refund_amount NULL/0 ke saath 'approved' -> expect failure (deviation #7):
--   SELECT admin_decide_return('<return-id-2>'::uuid, 'approved', NULL, NULL);
--   -- expect: {"success": false, "message": "Approved ke liye valid refund_amount zaroori hai"}
--   -- notification bani (deviation #8) — note ref_id = return_id, NOT order_id:
--   SELECT title, body, type, ref_id FROM notifications
--     WHERE type = 'return_update' ORDER BY created_at DESC LIMIT 1;
--
-- 8. PART B smoke (superadmin session, approved return par):
--   SELECT process_refund('<return-id>'::uuid, 'UPI se bhej diya');
--   -- expect: {"success": true, "message": "Refund processed mark ho gaya"}
--   -- dobara same return par -> expect: {"success": false, "message": "...pending state mein nahi..."}
--   -- order terminal status (deviation #9):
--   SELECT status FROM orders WHERE id = (SELECT order_id FROM order_returns WHERE id = '<return-id>');
--   -- expect: 'returned'

-- ================================================================
-- ROLLBACK
-- ================================================================
-- DROP FUNCTION IF EXISTS process_refund(uuid, text);
-- DROP FUNCTION IF EXISTS admin_decide_return(uuid, text, numeric, text);
-- DROP FUNCTION IF EXISTS seller_review_return(uuid, text, text);
-- DROP FUNCTION IF EXISTS request_return(uuid, text, text, text);
-- DROP POLICY IF EXISTS "involved_parties_see_return_photo" ON storage.objects;
-- DROP POLICY IF EXISTS "customer_upload_return_photo" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'return-photos';
-- DROP TABLE IF EXISTS order_returns;
-- ================================================================
