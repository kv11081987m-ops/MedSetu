-- ══════════════════════════════════════════════════
-- MedSetu — 087: issue delivery OTP at out_for_delivery + enforce it on delivery
-- NOT yet applied — run in Supabase SQL Editor.
-- ══════════════════════════════════════════════════
-- Scope = B2C home-delivery orders only (buyer_type customer, delivery_type
-- not a pickup). B2B (retailer) orders and store-pickup orders behave exactly
-- as before.
--
-- 1. The OTP used to be created ONLY when a delivery partner tapped "pickup"
--    (generate_delivery_otp). A seller/staff handover to out_for_delivery
--    never created one, so the customer saw no OTP. Now a BEFORE UPDATE
--    trigger issues it the moment status becomes out_for_delivery, on every
--    path (seller button, staff_handover_order, admin). generate_delivery_otp
--    stays and is idempotent ("already_sent").
-- 2. mark_order_delivered (seller button) used to need no OTP. It now needs
--    the customer's OTP; a super admin may instead pass a typed reason
--    (>= 5 chars), which is saved on the order.
-- 3. A guard trigger refuses ANY other route to status 'delivered' for these
--    orders (e.g. admin editing the row directly): only confirm_delivery
--    (rider, after its OTP check) and mark_order_delivered (after OTP /
--    override) set app.mark_delivered_trusted = 'true' at that point.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_override_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_override_by     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_override_at     TIMESTAMPTZ;
-- true for ANY delivery that skipped the OTP (super-admin override here, COD "OTP nahi mila" in 088)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_without_otp    BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION is_b2c_home_order(p_buyer_type TEXT, p_delivery_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_buyer_type, 'customer') = 'customer'
     AND COALESCE(p_delivery_type, 'home') NOT IN ('pickup', 'store_pickup');
$$;

-- ── 1. Issue the OTP when the order goes out for delivery ───────────
CREATE OR REPLACE FUNCTION issue_delivery_otp_on_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'out_for_delivery'
     AND OLD.status IS DISTINCT FROM 'out_for_delivery'
     AND is_b2c_home_order(NEW.buyer_type, NEW.delivery_type) THEN
    INSERT INTO order_delivery_otps (order_id, otp, failed_attempts, created_at)
    VALUES (NEW.id, lpad(floor(random() * 10000)::int::text, 4, '0'), 0, now())
    ON CONFLICT (order_id) DO NOTHING;
    NEW.delivery_otp_sent_at := COALESCE(NEW.delivery_otp_sent_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_issue_delivery_otp_on_dispatch ON orders;
CREATE TRIGGER trg_issue_delivery_otp_on_dispatch
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION issue_delivery_otp_on_dispatch();

-- Backfill: B2C home orders already out for delivery without an OTP.
DO $$
BEGIN
  PERFORM set_config('app.routing_trusted', 'true', true);
  INSERT INTO order_delivery_otps (order_id, otp, failed_attempts, created_at)
  SELECT id, lpad(floor(random() * 10000)::int::text, 4, '0'), 0, now()
  FROM orders
  WHERE status = 'out_for_delivery' AND is_b2c_home_order(buyer_type, delivery_type)
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE orders SET delivery_otp_sent_at = now()
  WHERE status = 'out_for_delivery' AND is_b2c_home_order(buyer_type, delivery_type)
    AND delivery_otp_sent_at IS NULL;
END $$;

-- ── 2. mark_order_delivered: OTP (or super-admin override) for B2C home ──
-- New signature + extra `message` column, so the old 1-arg function is
-- dropped (otherwise it would stay callable and keep the bypass open).
DROP FUNCTION IF EXISTS mark_order_delivered(UUID);

CREATE OR REPLACE FUNCTION mark_order_delivered(
  p_order_id UUID, p_otp TEXT DEFAULT NULL, p_override_reason TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, commission_rate NUMERIC, commission_amount NUMERIC,
              seller_earning NUMERIC, stock_deduct_failures TEXT[], message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order     orders%ROWTYPE;
  v_seller    sellers%ROWTYPE;
  v_ps        platform_settings%ROWTYPE;
  v_otp_row   order_delivery_otps%ROWTYPE;
  v_is_owner  BOOLEAN;
  v_super     BOOLEAN := is_active_superadmin();
  v_reason    TEXT    := btrim(COALESCE(p_override_reason, ''));
  v_home      BOOLEAN;
  v_override  BOOLEAN := false;
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

  v_is_owner := EXISTS (
    SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
    WHERE s.id = v_order.seller_id AND u.auth_id = auth.uid()
  );
  IF NOT (v_is_owner OR (v_super AND v_reason <> '')) THEN
    RAISE EXCEPTION 'Yeh order aapka nahi hai';
  END IF;

  IF v_order.status NOT IN ('confirmed', 'out_for_delivery') THEN
    RAISE EXCEPTION 'Order abhi deliver-ready nahi hai (status: %)', v_order.status;
  END IF;

  v_home := is_b2c_home_order(v_order.buyer_type, v_order.delivery_type);

  IF v_home THEN
    IF v_reason <> '' THEN
      -- Override: super admin only, with a real typed reason.
      IF NOT v_super THEN
        RETURN QUERY SELECT false, NULL::numeric, NULL::numeric, NULL::numeric, '{}'::text[],
          'Sirf super admin override kar sakta hai'::text;
        RETURN;
      END IF;
      IF length(v_reason) < 5 THEN
        RETURN QUERY SELECT false, NULL::numeric, NULL::numeric, NULL::numeric, '{}'::text[],
          'Override ka kaaran (kam se kam 5 akshar) likhna zaroori hai'::text;
        RETURN;
      END IF;
      v_override := true;
    ELSE
      IF v_order.status <> 'out_for_delivery' THEN
        RETURN QUERY SELECT false, NULL::numeric, NULL::numeric, NULL::numeric, '{}'::text[],
          'Pehle order ko "Out for Delivery" karein, tab customer ka OTP lekar deliver karein'::text;
        RETURN;
      END IF;
      SELECT * INTO v_otp_row FROM order_delivery_otps WHERE order_id = p_order_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::numeric, NULL::numeric, NULL::numeric, '{}'::text[],
          'Is order ka OTP abhi bana nahi hai'::text;
        RETURN;
      END IF;
      IF v_otp_row.failed_attempts >= 5 THEN
        RETURN QUERY SELECT false, NULL::numeric, NULL::numeric, NULL::numeric, '{}'::text[],
          'OTP 5 baar galat daala gaya — lock ho gaya. Super admin se sampark karein.'::text;
        RETURN;
      END IF;
      IF v_otp_row.otp <> COALESCE(btrim(p_otp), '') THEN
        -- Plain RETURN (not RAISE) so this increment commits.
        UPDATE order_delivery_otps SET failed_attempts = failed_attempts + 1
        WHERE order_id = p_order_id;
        RETURN QUERY SELECT false, NULL::numeric, NULL::numeric, NULL::numeric, '{}'::text[],
          ('Galat OTP (' || (4 - v_otp_row.failed_attempts) || ' koshish baaki)')::text;
        RETURN;
      END IF;
    END IF;
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

  -- Set only now, AFTER the OTP / override check passed (the guard trigger
  -- below treats this flag as proof of verification).
  PERFORM set_config('app.mark_delivered_trusted', 'true', true);

  UPDATE orders
  SET status                   = 'delivered',
      commission_rate          = v_rate,
      commission_amount        = v_comm_amt,
      seller_earning           = v_earning,
      delivered_at             = now(),
      delivery_confirmed_at    = CASE WHEN v_home AND NOT v_override THEN now() ELSE delivery_confirmed_at END,
      delivery_override_reason = CASE WHEN v_override THEN v_reason ELSE delivery_override_reason END,
      delivery_override_by     = CASE WHEN v_override THEN auth.email() ELSE delivery_override_by END,
      delivery_override_at     = CASE WHEN v_override THEN now() ELSE delivery_override_at END,
      delivered_without_otp    = CASE WHEN v_override THEN true ELSE delivered_without_otp END
  WHERE id = p_order_id;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
      SELECT deduct_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_deduct_ok;
      IF v_deduct_ok IS NOT TRUE THEN
        v_failures := array_append(v_failures, COALESCE(v_item.name, 'Medicine'));
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT true, v_rate, v_comm_amt, v_earning, v_failures, NULL::text;
END;
$function$;

REVOKE ALL ON FUNCTION mark_order_delivered(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_order_delivered(UUID, TEXT, TEXT) TO authenticated;

-- ── 3. Guard: no other route to 'delivered' for B2C home orders ─────
CREATE OR REPLACE FUNCTION enforce_delivery_otp_on_deliver()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND OLD.status IS DISTINCT FROM 'delivered'
     AND is_b2c_home_order(NEW.buyer_type, NEW.delivery_type)
     AND COALESCE(current_setting('app.mark_delivered_trusted', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Home delivery order sirf customer OTP se deliver ho sakta hai';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_delivery_otp_on_deliver ON orders;
CREATE TRIGGER trg_enforce_delivery_otp_on_deliver
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_delivery_otp_on_deliver();

-- VERIFY:
--   -- 1. dispatch a B2C home order -> OTP row + sent_at appear immediately:
--   SELECT o.order_number, o.status, o.delivery_otp_sent_at, d.otp IS NOT NULL AS has_otp
--   FROM orders o LEFT JOIN order_delivery_otps d ON d.order_id = o.id
--   WHERE o.status = 'out_for_delivery';
--   -- 2. no out_for_delivery home order without an OTP (expect 0 rows):
--   SELECT o.order_number FROM orders o LEFT JOIN order_delivery_otps d ON d.order_id = o.id
--   WHERE o.status='out_for_delivery' AND is_b2c_home_order(o.buyer_type, o.delivery_type) AND d.order_id IS NULL;
--   -- 3. as admin, UPDATE orders SET status='delivered' on such an order -> exception.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_enforce_delivery_otp_on_deliver ON orders;
--   DROP TRIGGER IF EXISTS trg_issue_delivery_otp_on_dispatch  ON orders;
--   DROP FUNCTION IF EXISTS enforce_delivery_otp_on_deliver(), issue_delivery_otp_on_dispatch(),
--                           is_b2c_home_order(TEXT, TEXT), mark_order_delivered(UUID, TEXT, TEXT);
--   then re-run 036_deliverReadyOutForDelivery.sql to restore the 1-arg mark_order_delivered
--   (and revert the SellerDashboard / SuperAdminPanel changes).
