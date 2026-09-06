-- 055_generalizeSellerStaff.sql
-- Normal-seller staff (deployed_wholesaler_id = NULL) support jodta hai,
-- aggregator staff (wholesaler par deployed) ke saath.
-- Teen jagah: claim_order, staff_accept_order, orders SELECT RLS.

CREATE OR REPLACE FUNCTION claim_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id     UUID;
  v_staff_agg_id UUID;
  v_staff_whid   UUID;
  v_order_whid   UUID;
  v_order_seller UUID;
  v_is_agg       BOOLEAN;
  v_row_count    INTEGER;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff claim_order chala sakta hai'
      USING errcode = '42501';
  END IF;

  SELECT id, aggregator_seller_id, deployed_wholesaler_id
    INTO v_staff_id, v_staff_agg_id, v_staff_whid
  FROM seller_staff
  WHERE email = auth.email() AND is_active = true;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'message', 'Staff record nahi mila');
  END IF;

  SELECT is_aggregator INTO v_is_agg FROM sellers WHERE id = v_staff_agg_id;

  SELECT sourced_from_wholesaler_id, seller_id
    INTO v_order_whid, v_order_seller
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'message', 'Order nahi mila');
  END IF;

  IF v_staff_whid IS NOT NULL THEN
    IF v_order_whid IS DISTINCT FROM v_staff_whid THEN
      RETURN jsonb_build_object('claimed', false, 'message', 'Ye order aapke wholesaler ka nahi');
    END IF;
  ELSE
    IF COALESCE(v_is_agg, false) = true THEN
      RETURN jsonb_build_object('claimed', false, 'message', 'Aap kisi wholesaler par deploy nahi hain');
    ELSE
      IF v_order_seller IS DISTINCT FROM v_staff_agg_id THEN
        RETURN jsonb_build_object('claimed', false, 'message', 'Ye order aapki dukan ka nahi');
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders
  SET claimed_by = v_staff_id, claimed_at = NOW()
  WHERE id = p_order_id
    AND claimed_by IS NULL;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 1 THEN
    RETURN jsonb_build_object('claimed', true, 'staff_id', v_staff_id);
  ELSE
    RETURN jsonb_build_object('claimed', false, 'message', 'Order pehle se kisi aur ne le liya');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_order(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION staff_accept_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id UUID;
  v_order    orders%ROWTYPE;
  v_item     RECORD;
  v_stock    INTEGER;
  v_src      UUID;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff staff_accept_order chala sakta hai'
      USING errcode = '42501';
  END IF;

  SELECT id INTO v_staff_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true;
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'message', 'Staff record nahi mila');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.claimed_by IS DISTINCT FROM v_staff_id THEN
    RETURN jsonb_build_object('accepted', false, 'message', 'Ye order aapne claim nahi kiya');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('accepted', false, 'message',
      'Order pending nahi hai (status: ' || v_order.status || ')');
  END IF;

  IF v_order.sourced_from_wholesaler_id IS NOT NULL THEN
    v_src := v_order.sourced_from_wholesaler_id;

    FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
      IF v_item.medicine_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN CONTINUE; END IF;
      SELECT stock_quantity INTO v_stock
      FROM seller_inventory
      WHERE seller_id = v_src AND medicine_id = v_item.medicine_id
      FOR UPDATE;
      IF NOT FOUND OR v_stock < v_item.quantity THEN
        RETURN jsonb_build_object('accepted', false, 'message',
          'Wholesaler ke paas poora stock nahi (' || COALESCE(v_item.name, 'Medicine') || ')');
      END IF;
    END LOOP;

    FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
      IF v_item.medicine_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN CONTINUE; END IF;
      UPDATE seller_inventory
      SET stock_quantity = stock_quantity - v_item.quantity, updated_at = NOW()
      WHERE seller_id = v_src AND medicine_id = v_item.medicine_id;
    END LOOP;

  ELSE
    FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
      IF v_item.medicine_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN CONTINUE; END IF;
      PERFORM reserve_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity);
    END LOOP;
  END IF;

  PERFORM set_config('app.routing_trusted', 'true', true);
  UPDATE orders SET status = 'confirmed' WHERE id = p_order_id;
  RETURN jsonb_build_object('accepted', true);
END;
$$;

DROP POLICY IF EXISTS "orders_select_involved_or_staff" ON orders;
CREATE POLICY "orders_select_involved_or_staff"
  ON orders FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = orders.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.seller_id AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR EXISTS (SELECT 1 FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = orders.buyer_id  AND (u.auth_id = auth.uid() OR u.email = auth.email()))
    OR is_active_superadmin()
    OR is_approved_admin()
    OR is_approved_pharmacist()
    OR (
      is_seller_staff()
      AND orders.sourced_from_wholesaler_id = current_staff_wholesaler_id()
    )
    OR (
      is_seller_staff()
      AND current_staff_wholesaler_id() IS NULL
      AND orders.seller_id = current_staff_aggregator_id()
    )
  );

GRANT EXECUTE ON FUNCTION staff_accept_order(UUID) TO authenticated;
