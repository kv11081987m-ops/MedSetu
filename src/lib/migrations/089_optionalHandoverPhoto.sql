-- ══════════════════════════════════════════════════
-- MedSetu — 089: handover photo OPTIONAL for COD "OTP nahi mila"
-- NOT yet applied — run in Supabase SQL Editor (after 088).
-- ══════════════════════════════════════════════════
-- Only the photo rule of deliver_without_otp changes (same signature, so
-- CREATE OR REPLACE swaps it in place; grants are kept):
--   * p_photo_path NULL/blank  -> allowed, but the detail text
--     (p_reason_text) must be >= 10 characters.
--   * p_photo_path given       -> must start with '<order_id>/' and exist in
--     bucket 'delivery-handover' (unchanged check).
-- Everything else (COD-only, reason, cash, authz, commission, stock,
-- rider earnings, delivered_without_otp flag) is identical to 088.

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
  -- Photo is optional. Without one, a written explanation (>= 10 chars) is
  -- required; WITH one, it must really exist under this order's folder.
  IF NULLIF(btrim(COALESCE(p_photo_path, '')), '') IS NULL THEN
    p_photo_path := NULL;
    IF length(v_text) < 10 THEN
      RETURN jsonb_build_object('success', false, 'message',
        'Photo nahi hai to detail (kam se kam 10 akshar) likhna zaroori hai');
    END IF;
  ELSIF left(p_photo_path, length(p_order_id::text) + 1) <> p_order_id::text || '/'
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'delivery-handover' AND name = p_photo_path) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Handover ki photo mili nahi — dobara upload karein');
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

-- VERIFY (as the assigned rider / seller on a COD order out for delivery):
--   -- no photo, short detail -> {success:false, message:'Photo nahi hai to detail ...'}
--   -- no photo, detail >= 10 chars -> {success:true}; then
--   SELECT order_number, delivered_without_otp, handover_photo_path, no_otp_reason_text
--   FROM orders WHERE delivered_without_otp ORDER BY no_otp_marked_at DESC LIMIT 3;   -- photo path NULL
--   -- photo path pointing at a non-existent object -> success:false
-- ROLLBACK: re-run the deliver_without_otp definition from 088_deliveredWithoutOtp.sql
--   (photo required again).
