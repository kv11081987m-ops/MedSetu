-- ══════════════════════════════════════════════════
-- MedSetu — critical security fixes (audit 2026-09-23)
-- Run this in Supabase SQL Editor — ONE SECTION AT A TIME, in order.
-- ══════════════════════════════════════════════════
--
-- Each numbered section is its own BEGIN...COMMIT so it can be applied
-- and verified independently. Section 1B is NOT safe to run until the
-- frontend that ships alongside this file (explicit sellers column
-- lists + my_seller_profile / link_my_seller_account RPCs) is deployed —
-- the currently-live frontend still does sellers select('*') and
-- .eq('email', …), both of which fail once authenticated loses SELECT
-- on sellers.email.
--
--   1A. sellers PII — non-breaking prep + anon lockout
--   1B. sellers PII — column lock for authenticated (AFTER frontend deploy)
--   2.  delivery OTP hidden from riders
--   3.  Rx gate enforced server-side
--   4.  expired stock never sellable
--   5.  approve_delivery_partner gap-safe DEL code
--   6.  dead RPCs locked down


-- >>> SECTION 1A
-- ================================================================
-- 1A. sellers PII — non-breaking prep + anon lockout
-- ================================================================
-- Why: sellers_select_all is USING (true) for {public}, and anon +
-- authenticated both hold table-level SELECT, so phone/email/
-- drug_license/aadhar_number were readable with just the anon key.
--
-- No pre-login screen in the app reads sellers (every read is behind
-- ProtectedRoute/SuperAdminRoute), so anon loses SELECT outright here.
-- authenticated keeps it until 1B, which needs the new frontend first.
--
-- Also here, so 1B can't break them:
--   - owner_view_staff_assignment / owner_view_aggregator_wholesalers
--     read s.email inside the policy, which runs with the caller's
--     privileges — once 1B revokes sellers.email from authenticated,
--     every staff_assignment read by anyone would error. Both now go
--     through is_owner_of_seller() (SECURITY DEFINER, same predicate).
--   - my_seller_profile(): the seller's own full row (incl. aadhar/email)
--     for getCurrentSeller(), which today does select('*') and
--     .eq('email', …) directly.
--   - link_my_seller_account(): replaces AuthContext's direct
--     sellers.select().eq('email').is('user_id', null) + update. Note
--     that direct update never actually matched under RLS —
--     sellers_update_owner_or_staff identifies the owner via
--     sellers.user_id, which is exactly the NULL being backfilled.
BEGIN;

CREATE OR REPLACE FUNCTION is_owner_of_seller(p_seller uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sellers s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = p_seller
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email())
  );
$$;
REVOKE EXECUTE ON FUNCTION is_owner_of_seller(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION is_owner_of_seller(uuid) TO authenticated;

DROP POLICY IF EXISTS owner_view_staff_assignment ON staff_assignment;
CREATE POLICY owner_view_staff_assignment ON staff_assignment
  FOR SELECT TO authenticated
  USING (is_owner_of_seller(seller_id));

DROP POLICY IF EXISTS owner_view_aggregator_wholesalers ON aggregator_wholesalers;
CREATE POLICY owner_view_aggregator_wholesalers ON aggregator_wholesalers
  FOR SELECT TO authenticated
  USING (is_owner_of_seller(aggregator_seller_id));

-- Same match order getCurrentSeller() used: phone first, then email.
-- users.phone/email are the caller's own row (auth_id), never client input.
CREATE OR REPLACE FUNCTION my_seller_profile()
RETURNS SETOF sellers LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH me AS (
    SELECT id, phone, email FROM users
    WHERE auth_id = auth.uid() OR email = auth.email()
    ORDER BY (auth_id = auth.uid()) DESC NULLS LAST
    LIMIT 1
  )
  SELECT s.* FROM sellers s, me
  WHERE s.user_id = me.id
     OR (me.phone IS NOT NULL AND me.phone <> '' AND s.phone = me.phone)
     OR (s.email = auth.email())
  ORDER BY (me.phone IS NOT NULL AND s.phone = me.phone) DESC,
           (s.user_id = me.id) DESC NULLS LAST
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION my_seller_profile() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION my_seller_profile() TO authenticated;

CREATE OR REPLACE FUNCTION link_my_seller_account()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_linked  int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM staff_whitelist
    WHERE email = auth.email() AND role = 'seller' AND is_approved = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Approved seller nahi');
  END IF;

  SELECT id INTO v_user_id FROM users WHERE email = auth.email() LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'User row nahi mila');
  END IF;

  UPDATE sellers SET user_id = v_user_id
  WHERE email = auth.email() AND user_id IS NULL;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'linked', v_linked);
END; $$;
REVOKE EXECUTE ON FUNCTION link_my_seller_account() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION link_my_seller_account() TO authenticated;

REVOKE SELECT ON sellers FROM anon;

COMMIT;
-- <<< SECTION 1A


-- >>> SECTION 1B
-- ================================================================
-- 1B. sellers PII — column lock for authenticated
-- ⚠️  RUN ONLY AFTER the frontend shipped with this file is deployed.
-- ================================================================
-- authenticated keeps row-level SELECT (sellers_select_all is untouched —
-- customers, pharmacists, riders, staff all legitimately embed store
-- name/address/phone/drug_license/gst for listings and invoices), but
-- loses the two columns nobody but the seller themself needs:
-- aadhar_number and email. The seller gets both back through
-- my_seller_profile() (1A). INSERT/UPDATE grants are untouched, so the
-- seller's own EditStoreModal save and SuperAdmin approve still write them.
--
-- Future sellers columns are NOT auto-readable by authenticated after
-- this (column-level grant) — add them to the GRANT below and to
-- SELLER_COLUMNS in src/lib/api.js.
BEGIN;

REVOKE SELECT ON sellers FROM authenticated;
GRANT SELECT (
  id, user_id, store_name, owner_name, phone, address, district, drug_license,
  pharmacist_name, pharmacist_cert, approval_status, is_open, rating, total_reviews,
  latitude, longitude, created_at, updated_at, is_verified, seller_type,
  commission_mode, commission_flat_rate, commission_status, commission_pending_mode,
  commission_pending_rate, gst_number, routing_weight, invoice_prefix, is_aggregator
) ON sellers TO authenticated;

COMMIT;
-- <<< SECTION 1B


-- >>> SECTION 2A
-- ================================================================
-- 2A. delivery OTP — moved out of orders, attempt-limited (non-breaking)
-- ================================================================
-- Why: orders.delivery_otp is readable by every party that can see the
-- order row — including the rider who has to be handed it by the
-- customer (DeliveryPartnerPanel selected it, only to use as a "has an
-- OTP been generated" flag), and generate_delivery_otp returned it to
-- whoever called it (the rider, in practice). Also 4 digits, no attempt
-- limit, and the rider could regenerate at will, so it was brute-forceable.
--
-- Now:
--   - order_delivery_otps holds the OTP. SELECT only for the order's
--     customer (+ superadmin); no client INSERT/UPDATE/DELETE at all —
--     only the two SECURITY DEFINER functions below write it.
--   - orders.delivery_otp_sent_at is the non-secret "OTP exists" flag
--     the rider UI needs.
--   - generate_delivery_otp never returns the OTP. An existing unlocked
--     OTP is kept (idempotent), not regenerated. A locked one (5 wrong
--     tries) can only be regenerated by the seller/admin — not the rider.
--   - confirm_delivery checks order_delivery_otps and counts failures.
--
-- Transitional: generate_delivery_otp still ALSO writes orders.delivery_otp
-- so the currently-deployed customer OrderTracking keeps showing the
-- OTP until the new frontend (reads order_delivery_otps) is live.
-- Section 2B removes that write and NULLs the column.
BEGIN;

CREATE TABLE IF NOT EXISTS order_delivery_otps (
  order_id        uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  otp             text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE order_delivery_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_delivery_otps FROM anon, authenticated;
GRANT SELECT ON order_delivery_otps TO authenticated;

DROP POLICY IF EXISTS delivery_otp_select_customer ON order_delivery_otps;
CREATE POLICY delivery_otp_select_customer ON order_delivery_otps
  FOR SELECT TO authenticated
  USING (
    is_active_superadmin() OR EXISTS (
      SELECT 1 FROM orders o JOIN users u ON u.id = o.customer_id
      WHERE o.id = order_delivery_otps.order_id
        AND (u.auth_id = auth.uid() OR u.email = auth.email())
    )
  );

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_otp_sent_at timestamptz;

-- Carry over any OTP already issued for an order still in flight.
INSERT INTO order_delivery_otps (order_id, otp)
SELECT id, delivery_otp FROM orders
WHERE delivery_otp IS NOT NULL AND status = 'out_for_delivery'
ON CONFLICT (order_id) DO NOTHING;
UPDATE orders SET delivery_otp_sent_at = COALESCE(delivery_otp_sent_at, updated_at, now())
WHERE delivery_otp IS NOT NULL AND status = 'out_for_delivery';

CREATE OR REPLACE FUNCTION public.generate_delivery_otp(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order      orders%ROWTYPE;
  v_otp        text;
  v_staff_id   uuid;
  v_privileged boolean;
  v_existing   order_delivery_otps%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  -- Delivery-partner ka apna staff_id resolve karo
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  v_privileged := is_active_superadmin() OR is_approved_admin() OR EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );

  IF NOT (v_privileged OR (v_staff_id IS NOT NULL AND v_order.delivered_by_staff_id = v_staff_id)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh order aapka nahi hai');
  END IF;

  IF v_order.status <> 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'OTP sirf out_for_delivery order ke liye ban sakta hai (status: ' || v_order.status || ')');
  END IF;

  SELECT * INTO v_existing FROM order_delivery_otps WHERE order_id = p_order_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.failed_attempts < 5 THEN
      -- Idempotent: the customer already has this OTP; never rotate it
      -- on the rider's say-so.
      RETURN jsonb_build_object('success', true, 'already_sent', true);
    ELSIF NOT v_privileged THEN
      RETURN jsonb_build_object('success', false, 'locked', true, 'message',
        'OTP 5 baar galat daala gaya — lock ho gaya. Seller se naya OTP banwao.');
    END IF;
  END IF;

  v_otp := lpad(floor(random() * 10000)::text, 4, '0');
  INSERT INTO order_delivery_otps (order_id, otp, failed_attempts, created_at)
  VALUES (p_order_id, v_otp, 0, now())
  ON CONFLICT (order_id) DO UPDATE
    SET otp = EXCLUDED.otp, failed_attempts = 0, created_at = now();

  -- orders.delivery_otp: transitional mirror for the old customer UI,
  -- removed in section 2B.
  UPDATE orders SET delivery_otp = v_otp, delivery_otp_sent_at = now() WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Body identical to the live version except the OTP check block
-- (order_delivery_otps + failed_attempts instead of orders.delivery_otp).
CREATE OR REPLACE FUNCTION public.confirm_delivery(p_order_id uuid, p_otp_entered text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flat_rate CONSTANT numeric := 25;
  v_order     orders%ROWTYPE;
  v_seller    sellers%ROWTYPE;
  v_ps        platform_settings%ROWTYPE;
  v_staff_id  uuid;
  v_subtotal  numeric;
  v_comm_amt  numeric := 0;
  v_rate      numeric;
  v_earning   numeric;
  v_item      RECORD;
  v_item_rate numeric;
  v_deduct_ok boolean;
  v_otp_row   order_delivery_otps%ROWTYPE;
BEGIN
  SELECT s.id INTO v_staff_id
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner'
    AND a.is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Aap active delivery partner nahi hain');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status <> 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Order abhi delivery ke liye ready nahi hai (status: ' || v_order.status || ')');
  END IF;

  SELECT * INTO v_otp_row FROM order_delivery_otps WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Galat OTP');
  END IF;
  IF v_otp_row.failed_attempts >= 5 THEN
    RETURN jsonb_build_object('success', false, 'locked', true, 'message',
      'OTP 5 baar galat daala gaya — lock ho gaya. Seller se naya OTP banwao.');
  END IF;
  IF v_otp_row.otp <> COALESCE(p_otp_entered, '') THEN
    -- Plain RETURN (not RAISE), so this increment commits.
    UPDATE order_delivery_otps SET failed_attempts = failed_attempts + 1
    WHERE order_id = p_order_id;
    RETURN jsonb_build_object('success', false, 'message',
      'Galat OTP (' || (4 - v_otp_row.failed_attempts) || ' koshish baaki)');
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = v_order.seller_id;
  SELECT * INTO v_ps     FROM platform_settings WHERE id = 1;

  IF v_order.commission_amount IS NULL THEN
    v_subtotal := COALESCE(v_order.final_amount, 0) - COALESCE(v_order.delivery_charge, 0);
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

  PERFORM set_config('app.mark_delivered_trusted', 'true', true);

  UPDATE orders SET
    status                = 'delivered',
    commission_rate       = v_rate,
    commission_amount     = v_comm_amt,
    seller_earning        = v_earning,
    delivered_at          = now(),
    delivery_confirmed_at = now(),
    delivered_by_staff_id = v_staff_id
  WHERE id = p_order_id;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
      SELECT deduct_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_deduct_ok;
    END IF;
  END LOOP;

  INSERT INTO delivery_earnings (staff_id, order_id, amount)
  VALUES (v_staff_id, p_order_id, v_flat_rate)
  ON CONFLICT (order_id) WHERE return_id IS NULL DO NOTHING;

  RETURN jsonb_build_object('success', true, 'message', 'Delivery confirmed', 'amount', v_flat_rate);
END;
$function$;

COMMIT;
-- <<< SECTION 2A


-- >>> SECTION 2B
-- ================================================================
-- 2B. delivery OTP — drop the transitional orders.delivery_otp mirror
-- ⚠️  RUN ONLY AFTER the frontend shipped with this file is deployed
--     (OrderTracking reads order_delivery_otps, DeliveryPartnerPanel
--     reads delivery_otp_sent_at).
-- ================================================================
-- Same generate_delivery_otp as 2A minus the orders.delivery_otp write;
-- then every existing value is cleared so no row carries a readable OTP.
-- The column itself is left in place (drop it in a later cleanup once
-- nothing references it).
BEGIN;

CREATE OR REPLACE FUNCTION public.generate_delivery_otp(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order      orders%ROWTYPE;
  v_otp        text;
  v_staff_id   uuid;
  v_privileged boolean;
  v_existing   order_delivery_otps%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  -- Delivery-partner ka apna staff_id resolve karo
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  v_privileged := is_active_superadmin() OR is_approved_admin() OR EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  );

  IF NOT (v_privileged OR (v_staff_id IS NOT NULL AND v_order.delivered_by_staff_id = v_staff_id)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh order aapka nahi hai');
  END IF;

  IF v_order.status <> 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'OTP sirf out_for_delivery order ke liye ban sakta hai (status: ' || v_order.status || ')');
  END IF;

  SELECT * INTO v_existing FROM order_delivery_otps WHERE order_id = p_order_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.failed_attempts < 5 THEN
      RETURN jsonb_build_object('success', true, 'already_sent', true);
    ELSIF NOT v_privileged THEN
      RETURN jsonb_build_object('success', false, 'locked', true, 'message',
        'OTP 5 baar galat daala gaya — lock ho gaya. Seller se naya OTP banwao.');
    END IF;
  END IF;

  v_otp := lpad(floor(random() * 10000)::text, 4, '0');
  INSERT INTO order_delivery_otps (order_id, otp, failed_attempts, created_at)
  VALUES (p_order_id, v_otp, 0, now())
  ON CONFLICT (order_id) DO UPDATE
    SET otp = EXCLUDED.otp, failed_attempts = 0, created_at = now();

  UPDATE orders SET delivery_otp_sent_at = now() WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

SELECT set_config('app.routing_trusted', 'true', true);  -- protect_order_sensitive_columns
UPDATE orders SET delivery_otp = NULL WHERE delivery_otp IS NOT NULL;

COMMIT;
-- <<< SECTION 2B


-- >>> SECTION 3
-- ================================================================
-- 3. Rx gate enforced server-side
-- ================================================================
-- Why: the only thing sending a prescription-required order to the
-- pharmacist was Checkout.jsx choosing status 'awaiting_pharmacist'.
-- orders_insert_own allows 'pending' too, so a direct API insert skipped
-- pharmacist review entirely.
--
-- Checkout inserts the order first and its items after (orders.js
-- createOrder → createOrderItems), so the check has to live on
-- order_items: when a requires_prescription medicine lands on a B2C
-- order that is still 'pending', the order is forced into the same
-- shape Checkout gives a gated order (awaiting_pharmacist, no seller,
-- routing cleared) — approve_rx_order routes it from scratch anyway.
-- An Rx item added to a B2C order that's already past pending (confirmed
-- etc.) is refused outright. B2B orders (buyer_type 'retailer' — a
-- pharmacy restocking) are not gated, same as today.
--
-- Not covered: order_items with medicine_id NULL can't be classified.
BEGIN;

CREATE OR REPLACE FUNCTION enforce_rx_gate_on_order_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_prev  text;
BEGIN
  IF NEW.medicine_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM master_medicines WHERE id = NEW.medicine_id AND requires_prescription
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_order.buyer_type, 'customer') <> 'customer'
     OR v_order.status = 'awaiting_pharmacist' THEN
    RETURN NEW;
  END IF;

  IF v_order.status = 'pending' THEN
    -- protect_order_sensitive_columns() reverts status/seller_id for a
    -- customer caller unless the routing trust flag is set; restore the
    -- caller's own value afterwards.
    v_prev := current_setting('app.routing_trusted', true);
    PERFORM set_config('app.routing_trusted', 'true', true);
    UPDATE orders SET
      status              = 'awaiting_pharmacist',
      pharmacist_verified = false,
      seller_id           = NULL,
      assigned_at         = NULL,
      routing_expires_at  = NULL,
      routing_attempt     = 0,
      routing_status      = NULL,
      routing_history     = '[]'::jsonb
    WHERE id = NEW.order_id;
    PERFORM set_config('app.routing_trusted', COALESCE(v_prev, 'false'), true);
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Prescription wali dawa is order (status: %) mein nahi jod sakte', v_order.status
    USING ERRCODE = '42501';
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_rx_gate ON order_items;
CREATE TRIGGER trg_enforce_rx_gate
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION enforce_rx_gate_on_order_item();

COMMIT;
-- <<< SECTION 3


-- >>> SECTION 4
-- ================================================================
-- 4. expired stock never sellable
-- ================================================================
-- Why: neither the customer feed (get_customer_medicines) nor
-- reserve_stock looked at seller_inventory.expiry_date. mrp_mode is ON
-- live, and in that mode the feed ignores is_available entirely (only
-- seller_hidden) and reserve_stock forces is_available = true — so
-- flipping is_available alone would not have hidden anything.
--
-- Rule (inventory_expiry_ok): a row is sellable when expiry_date is NULL,
-- or its effective expiry is at least 30 days away. Bulk upload stores a
-- label month ("2026-09") as the 1st ("2026-09-01"), and a label month
-- is valid through its last day, so a 1st-of-month date counts as the
-- end of that month; any other date is taken as-is. The 30-day buffer
-- keeps near-expiry stock off the customer app too.
--
-- get_customer_medicines and reserve_stock are otherwise byte-for-byte
-- the live versions; only the expiry condition is added. The frontend's
-- fetchSellersForMedicine (medicine detail seller list) applies the same
-- rule client-side (src/lib/api.js isExpirySellable).
BEGIN;

CREATE OR REPLACE FUNCTION inventory_expiry_ok(p_expiry date)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT p_expiry IS NULL OR (
    CASE WHEN extract(day FROM p_expiry) = 1
         THEN (date_trunc('month', p_expiry) + interval '1 month - 1 day')::date
         ELSE p_expiry
    END
  ) - 30 >= CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_medicines(p_query text DEFAULT NULL::text, p_mrp_mode boolean DEFAULT false, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0, p_dosage_form text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  -- search mode tabhi jab query 2+ (non-blank) chars — warna "popular"
  v_search boolean := (p_query IS NOT NULL AND length(btrim(p_query)) >= 2);
  v_lim    integer := GREATEST(1, LEAST(COALESCE(p_limit, 12), 50));
  v_off    integer := GREATEST(0, COALESCE(p_offset, 0));
  v_result jsonb;
BEGIN
  WITH avail AS (
    -- Har medicine jiske paas current mode mein kam se kam ek visible
    -- seller_inventory row hai + us par cheapest price (kai seller ho to MIN).
    -- mrp_mode OFF: is_available + stock>0, price = selling_price
    -- mrp_mode ON : seller_hidden=false,   price = seller ka mrp
    -- Dono mode: expired / near-expiry row kabhi nahi (078 section 4).
    SELECT
      si.medicine_id,
      MIN(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END)
        FILTER (
          WHERE COALESCE(CASE WHEN p_mrp_mode THEN si.mrp ELSE si.selling_price END, 0) > 0
        ) AS min_price
    FROM seller_inventory si
    WHERE CASE
            WHEN p_mrp_mode THEN si.seller_hidden = false
            ELSE si.is_available = true AND si.stock_quantity > 0
          END
      AND inventory_expiry_ok(si.expiry_date)
    GROUP BY si.medicine_id
  ),
  base AS (
    SELECT
      mm.id,
      mm.mrp_max,
      mm.source,
      mm.is_generic,
      to_jsonb(mm) || jsonb_build_object(
        'sellerPrice',
        CASE
          -- mrp_mode ON: seller ka apna mrp jeeta, warna master mrp_max
          -- (effectiveMrp() ke barabar). mrp_max WHERE se hamesha >0.
          WHEN p_mrp_mode THEN COALESCE(NULLIF(a.min_price, 0), mm.mrp_max)
          -- mrp_mode OFF: cheapest selling_price (null ho sakta hai —
          -- mapMedicine tab mrp_max par fallback karta hai, aaj jaisa)
          ELSE a.min_price
        END
      ) AS j
    FROM master_medicines mm
    JOIN avail a ON a.medicine_id = mm.id
    WHERE mm.is_active = true
      AND mm.mrp_max  > 0
      -- category-browse ke liye dosage_form filter (NULL = sab, aaj jaisा)
      AND (p_dosage_form IS NULL OR mm.dosage_form = p_dosage_form)
      AND (
        NOT v_search
        -- 070_improveSearch.sql: symbol/hyphen-insensitive match via
        -- clean_search_text() + trigram GIN indexes, in place of the old
        -- plain `mm.name ILIKE '%' || p_query || '%'` OR-block.
        OR clean_search_text(mm.name)             ILIKE '%' || clean_search_text(p_query) || '%'
        OR clean_search_text(mm.generic_name)     ILIKE '%' || clean_search_text(p_query) || '%'
        OR clean_search_text(mm.salt_composition) ILIKE '%' || clean_search_text(p_query) || '%'
      )
  )
  SELECT CASE WHEN v_search THEN
    jsonb_build_object(
      'mode', 'search',
      -- sections disjoint + per-section cap + ordering — aaj ke 3 alag
      -- queries jaisa (jan/generic mrp_max ASC, branded DESC, limit 5).
      'janaushadhi', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max ASC)
        FROM (SELECT j, mrp_max FROM base
              WHERE source = 'janaushadhi'
              ORDER BY mrp_max ASC LIMIT v_lim) x), '[]'::jsonb),
      'generic', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max ASC)
        FROM (SELECT j, mrp_max FROM base
              WHERE is_generic = true AND source IS DISTINCT FROM 'janaushadhi'
              ORDER BY mrp_max ASC LIMIT v_lim) x), '[]'::jsonb),
      'branded', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max DESC)
        FROM (SELECT j, mrp_max FROM base
              WHERE is_generic = false AND source IS DISTINCT FROM 'janaushadhi'
              ORDER BY mrp_max DESC LIMIT v_lim) x), '[]'::jsonb)
    )
  ELSE
    -- popular / category-browse dono yahi — flat items[], mrp_max ASC, paged
    jsonb_build_object(
      'mode', 'popular',
      'items', COALESCE((
        SELECT jsonb_agg(j ORDER BY mrp_max ASC)
        FROM (SELECT j, mrp_max FROM base
              ORDER BY mrp_max ASC
              LIMIT v_lim OFFSET v_off) x), '[]'::jsonb)
    )
  END
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_stock(p_seller_id uuid, p_medicine_id uuid, p_qty integer)
 RETURNS TABLE(success boolean, available integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_available INT;
  v_mrp_mode  BOOLEAN;
BEGIN
  SELECT mrp_mode INTO v_mrp_mode FROM platform_settings WHERE id = 1;
  v_mrp_mode := COALESCE(v_mrp_mode, false);

  IF v_mrp_mode THEN
    -- Stock never blocks: no stock-sufficiency condition in the WHERE
    -- clause, is_available forced true. Still bumps reserved_quantity so
    -- the row keeps an honest record of demand.
    -- Expiry DOES block (078 section 4).
    UPDATE seller_inventory
    SET reserved_quantity = reserved_quantity + p_qty,
        is_available       = true
    WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id
      AND inventory_expiry_ok(expiry_date)
    RETURNING (stock_quantity - reserved_quantity) INTO v_available;

    IF FOUND THEN
      RETURN QUERY SELECT true, v_available;
    ELSE
      -- No such seller_inventory row at all (or it's expired) — genuinely
      -- can't reserve against it, mrp_mode doesn't change that.
      RETURN QUERY SELECT false, 0;
    END IF;
    RETURN;
  END IF;

  -- ── mrp_mode OFF — original 005_atomicStockFunctions.sql behaviour,
  -- plus the expiry condition ─────────────────────────────────────
  UPDATE seller_inventory
  SET reserved_quantity = reserved_quantity + p_qty,
      is_available = (stock_quantity - (reserved_quantity + p_qty)) > 0
  WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id
    AND (stock_quantity - reserved_quantity) >= p_qty
    AND inventory_expiry_ok(expiry_date)
  RETURNING (stock_quantity - reserved_quantity) INTO v_available;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_available;
  ELSE
    SELECT (stock_quantity - reserved_quantity) INTO v_available
    FROM seller_inventory
    WHERE seller_id = p_seller_id AND medicine_id = p_medicine_id;
    RETURN QUERY SELECT false, COALESCE(v_available, 0);
  END IF;
END;
$function$;

UPDATE seller_inventory SET is_available = false
WHERE is_available AND NOT inventory_expiry_ok(expiry_date);

COMMIT;
-- <<< SECTION 4


-- >>> SECTION 5
-- ================================================================
-- 5. approve_delivery_partner — gap-safe DEL staff_code
-- ================================================================
-- Why: 'DEL' || COUNT(*)+1 regenerates a code already in use as soon as
-- the DEL sequence has a gap. Live: the only DEL row is DEL0002, so the
-- next approval would compute DEL0002 again and fail on
-- staff_staff_code_key. Same fix as 076 did for add_seller_staff:
-- MAX(numeric suffix)+1. The advisory lock already serializes callers.
-- Everything else in the body is the live version, unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_delivery_partner(p_registration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reg delivery_partner_registrations%ROWTYPE;
  v_staff_id uuid;
  v_staff_code text;
BEGIN
  IF NOT is_active_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Superadmin only');
  END IF;

  SELECT * INTO v_reg FROM delivery_partner_registrations
  WHERE id = p_registration_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Registration nahi mila');
  END IF;

  IF v_reg.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already decided');
  END IF;

  -- Serializes staff_code generation across concurrent approvals — see
  -- note above. Held only for the rest of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('approve_delivery_partner_staff_code'));

  -- MAX(numeric suffix)+1, not COUNT(*)+1 (078 section 5).
  SELECT 'DEL' || LPAD((COALESCE(MAX(SUBSTRING(staff_code FROM 4)::int), 0) + 1)::text, 4, '0')
    INTO v_staff_code
  FROM staff WHERE staff_code ~ '^DEL[0-9]+$';

  BEGIN
    INSERT INTO staff (staff_code, email, name, phone)
    VALUES (v_staff_code, v_reg.email, v_reg.name, v_reg.mobile)
    RETURNING id INTO v_staff_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Staff code ya email pehle se staff mein hai — duplicate registration ho sakta hai');
  END;

  INSERT INTO staff_assignment (staff_id, role_type, is_active)
  VALUES (v_staff_id, 'delivery_partner', true);

  UPDATE delivery_partner_registrations SET
    status = 'approved',
    reviewed_by = (SELECT id FROM users WHERE email = auth.email()),
    review_date = now(), updated_at = now()
  WHERE id = p_registration_id;

  RETURN jsonb_build_object('success', true,
    'staff_code', v_staff_code, 'staff_id', v_staff_id);
END; $function$;

COMMIT;
-- <<< SECTION 5


-- >>> SECTION 6
-- ================================================================
-- 6. dead RPCs — no client execute
-- ================================================================
-- None of these 14 is called by the frontend, an edge function, another
-- DB function, an RLS policy or a cron job (checked 2026-09-23), yet
-- all were EXECUTE-able by anon and authenticated. Mostly leftovers of
-- the aggregator-staff branch plus the pre-staff claim/release and
-- confirm_order_with_reserve paths. Revoked from PUBLIC (Postgres'
-- default grant), anon and authenticated; service_role and the owner
-- (SQL editor) keep it. To bring one back, GRANT EXECUTE ... TO
-- authenticated.
--
-- NOT included on purpose: current_staff_wholesaler_id /
-- current_staff_aggregator_id / current_staff_context — the live orders
-- policy orders_select_involved_or_staff still calls the first two.
BEGIN;

DO $$
DECLARE
  f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'add_staff_to_seller(uuid,text,text,uuid)',
    'edit_staff_assignment(uuid,text,uuid)',
    'end_staff_assignment(uuid)',
    'set_assignment_hold(uuid,boolean)',
    'set_staff_deployment(uuid,uuid)',
    'list_seller_staff(uuid)',
    'list_seller_wholesaler_mappings(uuid)',
    'my_staff_context()',
    'is_active_seller_staff_of(uuid)',
    'resolve_order_wholesaler_source(uuid)',
    'sync_aggregator_inventory(uuid)',
    'claim_order(uuid)',
    'release_order(uuid)',
    'confirm_order_with_reserve(uuid)'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

COMMIT;
-- <<< SECTION 6
