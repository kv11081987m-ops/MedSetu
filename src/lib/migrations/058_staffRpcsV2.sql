-- 058_staffRpcsV2.sql
-- Sabhi staff functions/RPCs ko nayi do-table neenv par: staff (vyakti) +
-- staff_assignment (posting). email -> staff -> active assignment.
-- orders.claimed_by me STAFF(id) bharega (vyakti), assignment nahi.
-- Rule: ek vyakti ek waqt sirf ek dukan par active (uniq index already 057 me).

-- =====================================================================
-- GROUP 1 — HELPERS (email -> staff -> active assignment)
-- =====================================================================

-- kya current login ek active staff hai? (kahin bhi active assignment ho)
CREATE OR REPLACE FUNCTION is_seller_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM staff s
    JOIN staff_assignment a ON a.staff_id = s.id
    WHERE s.email = auth.email() AND a.is_active = true
  );
$$;

-- kya current login p_seller ka active staff hai?
DROP FUNCTION IF EXISTS is_active_seller_staff_of(UUID);
CREATE OR REPLACE FUNCTION is_active_seller_staff_of(p_seller UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM staff s
    JOIN staff_assignment a ON a.staff_id = s.id
    WHERE s.email = auth.email()
      AND a.is_active = true
      AND a.seller_id = p_seller
  );
$$;

-- current staff ka seller (active assignment se). ek-active rule ki wajah se
-- ab LIMIT 1 arbitrary nahi — zyada se zyada ek hi active row hoti hai.
CREATE OR REPLACE FUNCTION current_staff_aggregator_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.seller_id
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email() AND a.is_active = true
  LIMIT 1;
$$;

-- current staff ka deployed wholesaler (active assignment se)
CREATE OR REPLACE FUNCTION current_staff_wholesaler_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.deployed_wholesaler_id
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email() AND a.is_active = true
  LIMIT 1;
$$;

-- helper: current login ka STAFF id (vyakti) + uski active assignment ka context.
-- claim/fulfillment RPCs isi se apna staff pakdenge.
CREATE OR REPLACE FUNCTION current_staff_context()
RETURNS TABLE (staff_id UUID, seller_id UUID, wholesaler_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, a.seller_id, a.deployed_wholesaler_id
  FROM staff s
  JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email() AND a.is_active = true
  LIMIT 1;
$$;

-- =====================================================================
-- GROUP 2 — CLAIM + FULFILLMENT (5 RPCs)
-- claimed_by = STAFF(id) (vyakti). Match-logic 055 wali hi, source nayi tables.
-- =====================================================================

CREATE OR REPLACE FUNCTION claim_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id     UUID;
  v_staff_seller UUID;
  v_staff_whid   UUID;
  v_order_whid   UUID;
  v_order_seller UUID;
  v_is_agg       BOOLEAN;
  v_row_count    INTEGER;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff claim_order chala sakta hai' USING errcode = '42501';
  END IF;

  SELECT staff_id, seller_id, wholesaler_id
    INTO v_staff_id, v_staff_seller, v_staff_whid
  FROM current_staff_context();

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'message', 'Aapki koi active posting nahi hai');
  END IF;

  SELECT is_aggregator INTO v_is_agg FROM sellers WHERE id = v_staff_seller;

  SELECT sourced_from_wholesaler_id, seller_id
    INTO v_order_whid, v_order_seller
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'message', 'Order nahi mila');
  END IF;

  IF v_staff_whid IS NOT NULL THEN
    -- aggregator staff, wholesaler par deployed
    IF v_order_whid IS DISTINCT FROM v_staff_whid THEN
      RETURN jsonb_build_object('claimed', false, 'message', 'Ye order aapke wholesaler ka nahi');
    END IF;
  ELSE
    IF COALESCE(v_is_agg, false) = true THEN
      -- aggregator ka un-deployed staff -> reject
      RETURN jsonb_build_object('claimed', false, 'message', 'Aap kisi wholesaler par deploy nahi hain');
    ELSE
      -- normal-seller staff -> sirf apni dukan ke order
      IF v_order_seller IS DISTINCT FROM v_staff_seller THEN
        RETURN jsonb_build_object('claimed', false, 'message', 'Ye order aapki dukan ka nahi');
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders
  SET claimed_by = v_staff_id, claimed_at = NOW()
  WHERE id = p_order_id AND claimed_by IS NULL;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 1 THEN
    RETURN jsonb_build_object('claimed', true, 'staff_id', v_staff_id);
  ELSE
    RETURN jsonb_build_object('claimed', false, 'message', 'Order pehle se kisi aur ne le liya');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION release_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id UUID;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff release_order chala sakta hai' USING errcode = '42501';
  END IF;

  SELECT staff_id INTO v_staff_id FROM current_staff_context();
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'message', 'Aapki koi active posting nahi hai');
  END IF;

  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders
  SET claimed_by = NULL, claimed_at = NULL
  WHERE id = p_order_id
    AND claimed_by = v_staff_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'message', 'Ye order aapne claim nahi kiya ya pending nahi hai');
  END IF;

  RETURN jsonb_build_object('released', true);
END;
$$;

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
    RAISE EXCEPTION 'Sirf seller staff staff_accept_order chala sakta hai' USING errcode = '42501';
  END IF;

  SELECT staff_id INTO v_staff_id FROM current_staff_context();
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'message', 'Aapki koi active posting nahi hai');
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
    -- aggregator path: wholesaler se hard-decrement
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
    -- normal seller path: apni inventory par reserve (owner jaisa)
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

CREATE OR REPLACE FUNCTION staff_mark_packed(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id UUID;
  v_order    orders%ROWTYPE;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff staff_mark_packed chala sakta hai' USING errcode = '42501';
  END IF;

  SELECT staff_id INTO v_staff_id FROM current_staff_context();
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('packed', false, 'message', 'Aapki koi active posting nahi hai');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('packed', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.claimed_by IS DISTINCT FROM v_staff_id THEN
    RETURN jsonb_build_object('packed', false, 'message', 'Ye order aapne claim nahi kiya');
  END IF;

  IF v_order.status <> 'confirmed' THEN
    RETURN jsonb_build_object('packed', false, 'message',
      'Order confirmed nahi hai (status: ' || v_order.status || ')');
  END IF;

  PERFORM set_config('app.routing_trusted', 'true', true);
  UPDATE orders SET status = 'preparing' WHERE id = p_order_id;
  RETURN jsonb_build_object('packed', true);
END;
$$;

CREATE OR REPLACE FUNCTION staff_handover_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id UUID;
  v_order    orders%ROWTYPE;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff staff_handover_order chala sakta hai' USING errcode = '42501';
  END IF;

  SELECT staff_id INTO v_staff_id FROM current_staff_context();
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('handed', false, 'message', 'Aapki koi active posting nahi hai');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('handed', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.claimed_by IS DISTINCT FROM v_staff_id THEN
    RETURN jsonb_build_object('handed', false, 'message', 'Ye order aapne claim nahi kiya');
  END IF;

  IF v_order.status <> 'preparing' THEN
    RETURN jsonb_build_object('handed', false, 'message',
      'Order preparing nahi hai (status: ' || v_order.status || ')');
  END IF;

  PERFORM set_config('app.routing_trusted', 'true', true);
  UPDATE orders SET status = 'out_for_delivery' WHERE id = p_order_id;
  RETURN jsonb_build_object('handed', true);
END;
$$;

-- =====================================================================
-- GROUP 3 — OWNER-SIDE MANAGEMENT (create-or-reuse vyakti + assignment)
-- =====================================================================

-- add_staff_to_seller: email se vyakti khojo-ya-banao, phir is seller par nayi
-- active assignment do. Rule: ek vyakti ek waqt ek hi dukan par active.
CREATE OR REPLACE FUNCTION add_staff_to_seller(
  p_seller_id              UUID,
  p_email                  TEXT,
  p_name                   TEXT,
  p_deployed_wholesaler_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id   UUID;
  v_is_agg    BOOLEAN;
  v_owns      BOOLEAN;
  v_email     TEXT;
  v_whid      UUID;
  v_staff_id  UUID;
  v_active_elsewhere UUID;
  v_caller    UUID;
  v_assign_id UUID;
BEGIN
  SELECT user_id, is_aggregator INTO v_user_id, v_is_agg FROM sellers WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Seller nahi mila');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Seller account link nahi hai — pehle account link karein');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = v_user_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) INTO v_owns;
  IF NOT (v_owns OR is_active_superadmin()) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Aap is dukan ke owner nahi hain');
  END IF;

  v_email := lower(trim(p_email));
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Email zaroori hai');
  END IF;

  -- wholesaler deployment: aggregator par mapped hona chahiye; normal seller par NULL
  IF COALESCE(v_is_agg, false) = true THEN
    IF p_deployed_wholesaler_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM aggregator_wholesalers
        WHERE aggregator_seller_id = p_seller_id
          AND wholesaler_seller_id = p_deployed_wholesaler_id
      ) THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Ye wholesaler is aggregator se mapped nahi hai');
      END IF;
      v_whid := p_deployed_wholesaler_id;
    ELSE
      v_whid := NULL;
    END IF;
  ELSE
    v_whid := NULL;
  END IF;

  -- vyakti khojo-ya-banao (staff)
  SELECT id INTO v_staff_id FROM staff WHERE email = v_email;

  SELECT id INTO v_caller FROM users
  WHERE auth_id = auth.uid() OR email = auth.email() LIMIT 1;

  IF v_staff_id IS NULL THEN
    INSERT INTO staff (email, name, created_by)
    VALUES (v_email, NULLIF(trim(p_name), ''), v_caller)
    RETURNING id INTO v_staff_id;
  END IF;

  -- ek-waqt-ek-dukan rule: kya ye vyakti pehle se kahin active hai?
  SELECT seller_id INTO v_active_elsewhere
  FROM staff_assignment
  WHERE staff_id = v_staff_id AND is_active = true
  LIMIT 1;

  IF v_active_elsewhere IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message',
      'Ye staff pehle se kisi dukan par active hai — pehle wahan se end karein');
  END IF;

  INSERT INTO staff_assignment (staff_id, seller_id, deployed_wholesaler_id, is_active, created_by)
  VALUES (v_staff_id, p_seller_id, v_whid, true, v_caller)
  RETURNING id INTO v_assign_id;

  RETURN jsonb_build_object('ok', true, 'staff_id', v_staff_id, 'assignment_id', v_assign_id);
END;
$$;

-- end_staff_assignment: posting khatm (vyakti kabhi delete nahi)
CREATE OR REPLACE FUNCTION end_staff_assignment(p_assignment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_id UUID;
  v_user_id   UUID;
  v_owns      BOOLEAN;
BEGIN
  SELECT seller_id INTO v_seller_id FROM staff_assignment WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Assignment nahi mila');
  END IF;

  SELECT user_id INTO v_user_id FROM sellers WHERE id = v_seller_id;
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = v_user_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) INTO v_owns;
  IF NOT (v_owns OR is_active_superadmin()) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Aap is dukan ke owner nahi hain');
  END IF;

  UPDATE staff_assignment
  SET is_active = false, ended_at = NOW()
  WHERE id = p_assignment_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Assignment pehle se end hai');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION release_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION staff_accept_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION staff_mark_packed(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION staff_handover_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION add_staff_to_seller(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION end_staff_assignment(UUID) TO authenticated;
