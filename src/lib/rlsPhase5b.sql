-- ══════════════════════════════════════════════════
-- MedSetu — RLS Phase 5b: orders + order_items + prescriptions
-- DO NOT RUN YET — read the chat reply's code-check report first.
-- Several decisions in here (esp. the orders trigger's scope and the
-- mark_order_delivered change) need your confirmation.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 0. Existing helpers used below (all already SECURITY DEFINER from
--    earlier phases): is_active_superadmin(), is_approved_admin(),
--    is_approved_pharmacist(), is_superadmin_or_delegated_admin().
--    No new helpers needed this phase.
-- ================================================================


-- ================================================================
-- 1. ORDERS
-- ================================================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select" ON orders;
DROP POLICY IF EXISTS "orders_insert" ON orders;
DROP POLICY IF EXISTS "orders_update" ON orders;
DROP POLICY IF EXISTS "orders_select_involved_or_staff" ON orders;
DROP POLICY IF EXISTS "orders_insert_own"                ON orders;
DROP POLICY IF EXISTS "orders_update_involved_or_staff"  ON orders;

-- SELECT: (a) customer's own order, (b) selling seller's own order,
-- (c) B2B buyer's own order — buyer_id references sellers.id, NOT
-- users.id (confirmed: notifications.js:48-49's getSellerUserId(),
-- SellerDashboard.jsx:562-567's own comment, orders.js:76's
-- fetchB2BOrders(buyerId) all treat buyer_id as a sellers row), so
-- this branch reuses the seller-bridge shape on buyer_id instead of
-- a users bridge, (d) Admin/SuperAdmin, (e) approved Pharmacist
-- (PharmacistPanel.jsx:279-284's call queue — global, unfiltered by
-- pharmacist_id, matching the existing design).
CREATE POLICY "orders_select_involved_or_staff"
  ON orders FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = orders.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.buyer_id  AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR is_active_superadmin()
    OR is_approved_admin()
    OR is_approved_pharmacist()
  );

-- INSERT: authenticated, and the order must belong to whoever is
-- creating it. Two shapes checked, matching the two live call sites:
--   - Checkout.jsx (B2C): customer_id set to the caller's own id, buyer_id null.
--   - B2BCheckout.jsx: buyer_id set to the caller's own sellers.id (the
--     retailer buying), buyer_type='retailer', customer_id null.
-- status is pinned to 'pending' — createOrder always sends 'pending'
-- (orders.js:20); this just stops a crafted insert from claiming an
-- instant 'confirmed'/'delivered' status.
CREATE POLICY "orders_insert_own"
  ON orders FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND status = 'pending'
    AND (
      (customer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM users u WHERE u.id = customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
      ))
      OR
      (buyer_type = 'retailer' AND buyer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
        WHERE s.id = buyer_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
      ))
    )
  );

-- UPDATE: row-level access mirrors SELECT — if you can see it via one
-- of the 5 branches above, you may attempt to update it. What you can
-- actually CHANGE on it is enforced by the trigger below, not here —
-- RLS is row-scoped, and this table has 5 different roles each
-- allowed to touch only specific columns/transitions, which needs
-- OLD-vs-NEW comparison a USING/WITH CHECK clause can't express.
CREATE POLICY "orders_update_involved_or_staff"
  ON orders FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = orders.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.buyer_id  AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR is_active_superadmin()
    OR is_approved_admin()
    OR is_approved_pharmacist()
  );

-- No DELETE policy — grepped the app, nothing ever deletes an order.


-- ----------------------------------------------------------------
-- Column/transition guard — five distinct write paths land on this
-- one table, each legitimately allowed to touch only a slice of it:
--   1. mark_order_delivered() RPC (SECURITY DEFINER) — sets status,
--      commission_rate/commission_amount/seller_earning. Runs under
--      the ORIGINAL caller's identity for auth.uid()/auth.email() (a
--      SECURITY DEFINER function changes execution privilege, not
--      what these functions return), so without an explicit signal
--      this trigger can't otherwise tell "the trusted RPC's own
--      UPDATE" apart from "that same seller's own raw client UPDATE".
--      Fixed via a transaction-local flag the RPC sets right before
--      its UPDATE (see the mark_order_delivered change below) — this
--      is the standard Postgres pattern for a SECURITY DEFINER
--      function to cooperate with a protective trigger.
--   2. Owning seller (SellerDashboard.jsx acceptOrder/declineOrder/
--      cancelConfirmedOrder) — status only, and never 'delivered'
--      directly (that must go through the RPC above, so commission
--      always gets computed).
--   3. Owning B2B buyer/retailer (SellerDashboard.jsx
--      handleReceiveLot -> markOrderReceived) — received_by_buyer only.
--   4. Owning customer (OrderTracking.jsx handleCancelConfirm) —
--      status -> 'cancelled' only, and only from pending/confirmed
--      (activeStep < 3 gate at OrderTracking.jsx:389 — matches
--      today's actual status set: only pending/confirmed/delivered/
--      cancelled are ever written, 'preparing'/'out_for_delivery' are
--      display-only labels that never occur as real rows).
--   5. Approved pharmacist (PharmacistPanel.jsx handleCallAction/
--      handleRejectCall — an orphan write path not in your original
--      spec, found via grep: pharmacist_verified + status, only from
--      'pending' to 'confirmed'/'cancelled'). NOTE: this path doesn't
--      call reserve_stock — a pharmacist-confirmed order skips the
--      seller's own accept/stock-reservation step entirely. That's an
--      existing app-logic quirk, not something this file changes or
--      fixes — flagging it since it affects who this policy needs to
--      trust, not touching the behavior itself.
-- Violations don't raise — they silently revert the disallowed
-- columns to their OLD value (same non-throwing style as the sellers
-- trigger from Phase 5a), so a partially-out-of-scope UPDATE still
-- succeeds for the fields it WAS allowed to touch instead of erroring
-- the whole request.
-- ----------------------------------------------------------------

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
                  OR COALESCE(current_setting('app.mark_delivered_trusted', true), 'false') = 'true';

  -- Commission fields: only admin/superadmin/the trusted RPC may set these.
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

DROP TRIGGER IF EXISTS trg_protect_order_sensitive_columns ON orders;
CREATE TRIGGER trg_protect_order_sensitive_columns
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION protect_order_sensitive_columns();


-- ----------------------------------------------------------------
-- mark_order_delivered() — one-line addition so its own internal
-- UPDATE can bypass the trigger above. SET LOCAL scope means this
-- resets automatically at end of transaction; a client can't set it
-- themselves (they only ever call the RPC over supabase.rpc(), never
-- raw SQL). Everything else in the function body is byte-for-byte
-- identical to commissionRpc.sql.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION mark_order_delivered(p_order_id UUID)
RETURNS TABLE (
  success               BOOLEAN,
  commission_rate       NUMERIC,
  commission_amount     NUMERIC,
  seller_earning        NUMERIC,
  stock_deduct_failures TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order     orders%ROWTYPE;
  v_seller    sellers%ROWTYPE;
  v_ps        platform_settings%ROWTYPE;
  v_subtotal  NUMERIC;
  v_comm_amt  NUMERIC := 0;
  v_rate      NUMERIC;
  v_earning   NUMERIC;
  v_item      RECORD;
  v_item_rate NUMERIC;
  v_failures  TEXT[] := '{}';
  v_deduct_ok BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order nahi mila';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.seller_id AND u.auth_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Yeh order aapka nahi hai';
  END IF;

  IF v_order.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Order abhi deliver-ready nahi hai (status: %)', v_order.status;
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = v_order.seller_id;
  SELECT * INTO v_ps     FROM platform_settings WHERE id = 1;

  v_subtotal := COALESCE(v_order.final_amount, 0) - COALESCE(v_order.delivery_charge, 0);

  IF v_order.commission_amount IS NULL THEN
    IF v_seller.commission_mode = 'tier' THEN
      FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
        IF v_item.commission_band = 'high' THEN
          v_item_rate := v_ps.tier_high_rate;
        ELSIF v_item.commission_band = 'moderate' THEN
          v_item_rate := v_ps.tier_mod_rate;
        ELSIF v_item.commission_band = 'low' THEN
          v_item_rate := v_ps.tier_low_rate;
        ELSE
          v_item_rate := COALESCE(v_seller.commission_flat_rate, v_ps.commission);
        END IF;
        v_comm_amt := v_comm_amt + (COALESCE(v_item.unit_price, 0) * COALESCE(v_item.quantity, 0) * (v_item_rate / 100.0));
      END LOOP;
      v_comm_amt := ROUND(v_comm_amt, 2);
      v_rate := CASE WHEN v_subtotal > 0 THEN ROUND((v_comm_amt / v_subtotal) * 100, 2) ELSE 0 END;
    ELSE
      v_rate     := COALESCE(v_seller.commission_flat_rate, v_ps.commission);
      v_comm_amt := ROUND(v_subtotal * (v_rate / 100.0), 2);
    END IF;
    v_earning := ROUND(v_subtotal - v_comm_amt, 2);
  ELSE
    v_rate     := v_order.commission_rate;
    v_comm_amt := v_order.commission_amount;
    v_earning  := v_order.seller_earning;
  END IF;

  -- NEW: let the orders trigger know this specific UPDATE is coming from
  -- the trusted RPC, not a raw client write. Transaction-scoped (SET LOCAL
  -- semantics via the 3rd arg = true), auto-resets — nothing to clean up.
  PERFORM set_config('app.mark_delivered_trusted', 'true', true);

  UPDATE orders
  SET status            = 'delivered',
      commission_rate   = v_rate,
      commission_amount = v_comm_amt,
      seller_earning    = v_earning
  WHERE id = p_order_id;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
      SELECT deduct_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_deduct_ok;
      IF v_deduct_ok IS NOT TRUE THEN
        v_failures := array_append(v_failures, COALESCE(v_item.name, 'Medicine'));
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT true, v_rate, v_comm_amt, v_earning, v_failures;
END;
$$;


-- ================================================================
-- 2. ORDER_ITEMS
-- ================================================================

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_select" ON order_items;
DROP POLICY IF EXISTS "order_items_insert" ON order_items;
DROP POLICY IF EXISTS "order_items_select_via_order" ON order_items;
DROP POLICY IF EXISTS "order_items_insert_via_order"  ON order_items;

-- SELECT: same visibility as the parent order.
CREATE POLICY "order_items_select_via_order"
  ON order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          EXISTS (SELECT 1 FROM users u WHERE u.id = o.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
          OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = o.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
          OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = o.buyer_id  AND (u.auth_id = auth.uid() OR u.email = auth.email()))
          OR is_active_superadmin()
          OR is_approved_admin()
          OR is_approved_pharmacist()
        )
    )
  );

-- INSERT: createOrderItems (orders.js:39-68) runs right after
-- createOrder, same session — the referenced order must belong to
-- the caller (customer or B2B buyer branch only; a seller/pharmacist/
-- admin session never creates order_items).
CREATE POLICY "order_items_insert_via_order"
  ON order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          EXISTS (SELECT 1 FROM users u WHERE u.id = o.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
          OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = o.buyer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
        )
    )
  );

-- No UPDATE/DELETE policy — grepped the app, neither is ever called
-- on order_items. Default deny.


-- ================================================================
-- 3. PRESCRIPTIONS
-- ================================================================

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prescriptions_select" ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_insert" ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_update" ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_select_own_or_staff" ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_insert_own"           ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_update_own_or_staff"  ON prescriptions;

-- SELECT: (a) customer's own, (b) approved pharmacist — global queue,
-- same as today (PharmacistPanel.jsx:269-274 filters status only, no
-- pharmacist_id), (c) Admin/SuperAdmin (no current call site found,
-- included for forward-safety same as other phases).
-- NOTE: no seller branch — confirmed SellerDashboard's Rx badge reads
-- orders.prescription_url (a plain URL column already on a row the
-- seller can already SELECT via the orders policy), never this table
-- directly (SellerDashboard.jsx:72). Your own suspicion was right.
CREATE POLICY "prescriptions_select_own_or_staff"
  ON prescriptions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = prescriptions.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR is_approved_pharmacist()
    OR is_active_superadmin()
    OR is_approved_admin()
  );

-- INSERT: own row only (PrescriptionUpload.jsx:141-150).
CREATE POLICY "prescriptions_insert_own"
  ON prescriptions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
  );

-- UPDATE: row-level access mirrors SELECT minus admin's blanket read
-- (still included for completeness); column protection below decides
-- what each role can actually change.
CREATE POLICY "prescriptions_update_own_or_staff"
  ON prescriptions FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = prescriptions.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR is_approved_pharmacist()
    OR is_active_superadmin()
    OR is_approved_admin()
  );

-- No DELETE policy — grepped the app, nothing ever deletes a prescription.


-- ----------------------------------------------------------------
-- Column guard — finding: a naive "customer can UPDATE their own row"
-- policy (needed for Checkout.jsx:411-414's order_id back-link) would
-- ALSO let a customer set status/reviewed_at on their OWN
-- prescription directly, i.e. self-approve a prescription without
-- pharmacist review. Restrict the customer branch to order_id only;
-- pharmacist/admin/superadmin keep full write access to status/
-- reviewed_at (review_notes is NOT protected — PrescriptionUpload.jsx
-- itself writes it at upload time as the customer's own medicine
-- note, it's not a pharmacist-only review field despite the name).
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION protect_prescription_review_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_active_superadmin() OR is_approved_admin() OR is_approved_pharmacist()) THEN
    NEW.status      := OLD.status;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.customer_id := OLD.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_prescription_review_columns ON prescriptions;
CREATE TRIGGER trg_protect_prescription_review_columns
BEFORE UPDATE ON prescriptions
FOR EACH ROW EXECUTE FUNCTION protect_prescription_review_columns();


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('orders', 'order_items', 'prescriptions');

-- SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('orders', 'order_items', 'prescriptions')
--   ORDER BY tablename, cmd;

-- SELECT tgname, tgrelid::regclass FROM pg_trigger
--   WHERE tgname IN ('trg_protect_order_sensitive_columns', 'trg_protect_prescription_review_columns');

-- Real-session sanity checks:
--   1. Customer: place a B2C order (Checkout) -> orders + order_items insert ok.
--   2. B2B retailer: place an order (B2BCheckout) -> insert ok.
--   3. Seller: accept/decline/cancel-confirmed -> status changes ok.
--   4. Seller: markDelivered (RPC) -> still computes + stores commission
--      correctly (this is the one that MUST still work after adding the
--      trigger + the mark_delivered_trusted flag).
--   5. Seller: raw PATCH attempting commission_amount directly -> reverted.
--   6. Retailer: handleReceiveLot -> received_by_buyer flips, nothing else changes.
--   7. Customer: OrderTracking cancel on a pending/confirmed order -> works;
--      on a delivered/cancelled order -> silently no-ops (button shouldn't
--      even show past activeStep 3, but confirm the DB also refuses).
--   8. Pharmacist: call-queue confirm/reject -> status + pharmacist_verified change.
--   9. Pharmacist: try editing commission_amount on some order -> reverted.
--   10. Customer: prescription upload + Checkout's order_id back-link -> works.
--   11. Customer: try setting their own prescription's status to 'approved' -> reverted.
--   12. Pharmacist: approve/reject a prescription -> works.
--   13. Realtime: SellerDashboard (seller_id + buyer_id channels),
--       OrderTracking, SuperAdminPanel (unfiltered) all still receive events.


-- ================================================================
-- ROLLBACK — table by table
-- ================================================================

-- orders:
-- ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
-- DROP TRIGGER IF EXISTS trg_protect_order_sensitive_columns ON orders;
-- DROP FUNCTION IF EXISTS protect_order_sensitive_columns();
-- -- mark_order_delivered: either leave the set_config line in place
-- -- (harmless no-op with the trigger gone) or restore the version from
-- -- commissionRpc.sql (identical minus that one line).
-- -- or, keeping RLS on but dropping just the policies:
-- DROP POLICY IF EXISTS "orders_select_involved_or_staff" ON orders;
-- DROP POLICY IF EXISTS "orders_insert_own"                ON orders;
-- DROP POLICY IF EXISTS "orders_update_involved_or_staff"  ON orders;

-- order_items:
-- ALTER TABLE order_items DISABLE ROW LEVEL SECURITY;
-- -- or:
-- DROP POLICY IF EXISTS "order_items_select_via_order" ON order_items;
-- DROP POLICY IF EXISTS "order_items_insert_via_order" ON order_items;

-- prescriptions:
-- ALTER TABLE prescriptions DISABLE ROW LEVEL SECURITY;
-- DROP TRIGGER IF EXISTS trg_protect_prescription_review_columns ON prescriptions;
-- DROP FUNCTION IF EXISTS protect_prescription_review_columns();
-- -- or:
-- DROP POLICY IF EXISTS "prescriptions_select_own_or_staff" ON prescriptions;
-- DROP POLICY IF EXISTS "prescriptions_insert_own"          ON prescriptions;
-- DROP POLICY IF EXISTS "prescriptions_update_own_or_staff" ON prescriptions;
