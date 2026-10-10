-- ══════════════════════════════════════════════════
-- MedSetu — 088: COD "OTP nahi mila" delivery (reason + cash + photo proof)
-- NOT yet applied — run in Supabase SQL Editor AFTER 087.
-- ══════════════════════════════════════════════════
-- Rule (087 + this file), B2C home-delivery orders:
--   * PREPAID (payment_method <> 'cod'): delivered only with the customer
--     OTP. Only super admin may override (087, typed reason).
--   * COD (payment_method = 'cod'): OTP is the normal path. If the customer
--     cannot give it, the assigned delivery partner, the seller owner or
--     seller staff may call deliver_without_otp() with a reason, cash
--     collected yes/no (+ amount) and ONE handover photo already uploaded to
--     the private 'delivery-handover' bucket. The order becomes delivered
--     with delivered_without_otp = true.
-- Payment mode today: orders.payment_method (cod | upi | card | netbanking),
-- payment_status. Launch is COD-only (Checkout disables the others), so in
-- practice every current order is COD; the prepaid branch is future-proof.
-- B2B and store-pickup orders are untouched.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_without_otp BOOLEAN NOT NULL DEFAULT false; -- also in 087
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_otp_reason_code    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_otp_reason_text    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_collected        BOOLEAN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_collected_amount NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_photo_path   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_otp_marked_by      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_otp_marked_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_delivered_without_otp
  ON orders (created_at DESC) WHERE delivered_without_otp;

-- Who may act on a delivery: assigned rider, seller owner, seller staff.
CREATE OR REPLACE FUNCTION can_handle_delivery_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = p_order_id AND (
      EXISTS (
        SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id
        WHERE s.id = o.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
      )
      OR EXISTS (
        SELECT 1 FROM staff st JOIN staff_assignment a ON a.staff_id = st.id
        WHERE st.email = auth.email() AND a.is_active = true AND (
          (a.role_type = 'delivery_partner' AND o.delivered_by_staff_id = st.id)
          OR (a.role_type = 'seller_staff' AND a.seller_id = o.seller_id)
        )
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION can_handle_delivery_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_handle_delivery_order(UUID) TO authenticated;

-- ── Private bucket for handover photos: path = <order_id>/<file> ────
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-handover', 'delivery-handover', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS handover_upload ON storage.objects;
CREATE POLICY handover_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-handover'
    AND CASE WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN can_handle_delivery_order(((storage.foldername(name))[1])::uuid)
             ELSE false END
  );

DROP POLICY IF EXISTS handover_read ON storage.objects;
CREATE POLICY handover_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-handover'
    AND (
      is_active_superadmin() OR is_approved_admin()
      OR CASE WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN can_handle_delivery_order(((storage.foldername(name))[1])::uuid)
              ELSE false END
    )
  );

-- ── deliver_without_otp ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deliver_without_otp(
  p_order_id      UUID,
  p_reason_code   TEXT,
  p_reason_text   TEXT,
  p_cash_collected BOOLEAN,
  p_cash_amount   NUMERIC,
  p_photo_path    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_flat_rate CONSTANT NUMERIC := 25;
  v_order     orders%ROWTYPE;
  v_seller    sellers%ROWTYPE;
  v_ps        platform_settings%ROWTYPE;
  v_staff_id  UUID;
  v_rider_id  UUID;
  v_text      TEXT := btrim(COALESCE(p_reason_text, ''));
  v_subtotal  NUMERIC;
  v_comm_amt  NUMERIC := 0;
  v_rate      NUMERIC;
  v_earning   NUMERIC;
  v_item      RECORD;
  v_item_rate NUMERIC;
  v_deduct_ok BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF NOT can_handle_delivery_order(p_order_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh order aapka nahi hai');
  END IF;

  IF NOT is_b2c_home_order(v_order.buyer_type, v_order.delivery_type) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh sirf home-delivery orders ke liye hai');
  END IF;
  IF v_order.status <> 'out_for_delivery' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Order out_for_delivery nahi hai (status: ' || v_order.status || ')');
  END IF;
  IF COALESCE(v_order.payment_method, '') <> 'cod' THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Prepaid order bina OTP deliver nahi ho sakta — super admin se override karwayein');
  END IF;

  IF p_reason_code NOT IN ('customer_unaware', 'elderly_no_phone', 'network_issue', 'other') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kaaran chuniye');
  END IF;
  IF p_reason_code = 'other' AND length(v_text) < 3 THEN
    RETURN jsonb_build_object('success', false, 'message', '"Other" ke liye kaaran likhein');
  END IF;
  IF p_cash_collected IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cash mila ya nahi — chuniye');
  END IF;
  IF p_cash_collected AND COALESCE(p_cash_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cash ki rakam daalein');
  END IF;
  IF p_photo_path IS NULL OR left(p_photo_path, length(p_order_id::text) + 1) <> p_order_id::text || '/'
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'delivery-handover' AND name = p_photo_path) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Handover ki photo zaroori hai');
  END IF;

  -- Rider identity (for delivered_by + earnings), if the caller is the assigned partner
  SELECT st.id INTO v_rider_id
  FROM staff st JOIN staff_assignment a ON a.staff_id = st.id
  WHERE st.email = auth.email() AND a.role_type = 'delivery_partner' AND a.is_active = true
    AND v_order.delivered_by_staff_id = st.id
  LIMIT 1;

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

  -- Everything required has been validated above; 087's guard trigger
  -- accepts this flag as proof.
  PERFORM set_config('app.mark_delivered_trusted', 'true', true);

  UPDATE orders SET
    status                = 'delivered',
    commission_rate       = v_rate,
    commission_amount     = v_comm_amt,
    seller_earning        = v_earning,
    delivered_at          = now(),
    delivered_by_staff_id = COALESCE(v_rider_id, delivered_by_staff_id),
    delivered_without_otp = true,
    no_otp_reason_code    = p_reason_code,
    no_otp_reason_text    = NULLIF(v_text, ''),
    cash_collected        = p_cash_collected,
    cash_collected_amount = CASE WHEN p_cash_collected THEN p_cash_amount ELSE 0 END,
    handover_photo_path   = p_photo_path,
    no_otp_marked_by      = auth.email(),
    no_otp_marked_at      = now()
  WHERE id = p_order_id;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
      SELECT deduct_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_deduct_ok;
    END IF;
  END LOOP;

  IF v_rider_id IS NOT NULL THEN
    INSERT INTO delivery_earnings (staff_id, order_id, amount)
    VALUES (v_rider_id, p_order_id, v_flat_rate)
    ON CONFLICT (order_id) WHERE return_id IS NULL DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Delivered (bina OTP)',
                            'amount', CASE WHEN v_rider_id IS NOT NULL THEN v_flat_rate ELSE NULL END);
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_without_otp(UUID, TEXT, TEXT, BOOLEAN, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliver_without_otp(UUID, TEXT, TEXT, BOOLEAN, NUMERIC, TEXT) TO authenticated;

-- VERIFY:
--   SELECT id, public FROM storage.buckets WHERE id = 'delivery-handover';   -- public = false
--   -- COD order out for delivery, as the assigned rider with an uploaded photo:
--   --   rpc deliver_without_otp -> {success:true}; then
--   SELECT order_number, status, delivered_without_otp, no_otp_reason_code, cash_collected,
--          cash_collected_amount, handover_photo_path FROM orders WHERE delivered_without_otp;
--   -- missing photo / prepaid order / reason 'other' without text -> success:false with a message
--   -- customer gets exactly one "दवा पहुंच गई ✅" (085 trigger)
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.deliver_without_otp(UUID, TEXT, TEXT, BOOLEAN, NUMERIC, TEXT);
--   DROP POLICY IF EXISTS handover_upload ON storage.objects;
--   DROP POLICY IF EXISTS handover_read   ON storage.objects;
--   DROP FUNCTION IF EXISTS can_handle_delivery_order(UUID);
--   DROP INDEX IF EXISTS idx_orders_delivered_without_otp;
--   ALTER TABLE orders DROP COLUMN IF EXISTS no_otp_reason_code, DROP COLUMN IF EXISTS no_otp_reason_text,
--     DROP COLUMN IF EXISTS cash_collected, DROP COLUMN IF EXISTS cash_collected_amount,
--     DROP COLUMN IF EXISTS handover_photo_path, DROP COLUMN IF EXISTS no_otp_marked_by,
--     DROP COLUMN IF EXISTS no_otp_marked_at;   -- (keep delivered_without_otp if 087 stays)
--   (photos: delete objects in bucket 'delivery-handover' from the dashboard, then the bucket)
