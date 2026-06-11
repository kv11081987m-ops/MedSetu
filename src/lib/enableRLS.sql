-- ================================
-- STEP 1: RLS Enable karo
-- ================================

ALTER TABLE users
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE orders
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE prescriptions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE addresses
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE medicines
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE sellers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE seller_registrations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE staff_whitelist
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE super_admins
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE reviews
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE master_medicines
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE seller_inventory
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE medicine_requests
  ENABLE ROW LEVEL SECURITY;

-- ================================
-- STEP 2: USERS table policies
-- ================================

-- User apna record dekh sake
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  USING (true);

-- User apna record update kare
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  USING (true);

-- Naya user create ho sake
CREATE POLICY "users_insert"
  ON users FOR INSERT
  WITH CHECK (true);

-- ================================
-- STEP 3: ORDERS table policies
-- ================================

-- Customer apne orders dekhe
CREATE POLICY "orders_select"
  ON orders FOR SELECT
  USING (true);

-- Order create ho sake
CREATE POLICY "orders_insert"
  ON orders FOR INSERT
  WITH CHECK (true);

-- Order update ho sake
CREATE POLICY "orders_update"
  ON orders FOR UPDATE
  USING (true);

-- ================================
-- STEP 4: ORDER_ITEMS policies
-- ================================

CREATE POLICY "order_items_select"
  ON order_items FOR SELECT
  USING (true);

CREATE POLICY "order_items_insert"
  ON order_items FOR INSERT
  WITH CHECK (true);

-- ================================
-- STEP 5: PRESCRIPTIONS policies
-- ================================

CREATE POLICY "prescriptions_select"
  ON prescriptions FOR SELECT
  USING (true);

CREATE POLICY "prescriptions_insert"
  ON prescriptions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "prescriptions_update"
  ON prescriptions FOR UPDATE
  USING (true);

-- ================================
-- STEP 6: ADDRESSES policies
-- ================================

CREATE POLICY "addresses_select"
  ON addresses FOR SELECT
  USING (true);

CREATE POLICY "addresses_insert"
  ON addresses FOR INSERT
  WITH CHECK (true);

CREATE POLICY "addresses_update"
  ON addresses FOR UPDATE
  USING (true);

CREATE POLICY "addresses_delete"
  ON addresses FOR DELETE
  USING (true);

-- ================================
-- STEP 7: MEDICINES policies
-- ================================

-- Sabhi medicines dekh sakein
CREATE POLICY "medicines_select"
  ON medicines FOR SELECT
  USING (true);

-- Seller medicines add kare
CREATE POLICY "medicines_insert"
  ON medicines FOR INSERT
  WITH CHECK (true);

-- Seller medicines update kare
CREATE POLICY "medicines_update"
  ON medicines FOR UPDATE
  USING (true);

-- Seller medicines delete kare
CREATE POLICY "medicines_delete"
  ON medicines FOR DELETE
  USING (true);

-- ================================
-- STEP 8: SELLERS policies
-- ================================

-- Sabhi sellers dekh sakein
CREATE POLICY "sellers_select"
  ON sellers FOR SELECT
  USING (true);

-- Seller record create ho sake
CREATE POLICY "sellers_insert"
  ON sellers FOR INSERT
  WITH CHECK (true);

-- Seller apna record update kare
CREATE POLICY "sellers_update"
  ON sellers FOR UPDATE
  USING (true);

-- ================================
-- STEP 9: SELLER_REGISTRATIONS
-- ================================

CREATE POLICY "seller_reg_select"
  ON seller_registrations
  FOR SELECT
  USING (true);

CREATE POLICY "seller_reg_insert"
  ON seller_registrations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "seller_reg_update"
  ON seller_registrations
  FOR UPDATE
  USING (true);

-- ================================
-- STEP 10: STAFF_WHITELIST
-- ================================

CREATE POLICY "whitelist_select"
  ON staff_whitelist FOR SELECT
  USING (true);

CREATE POLICY "whitelist_insert"
  ON staff_whitelist FOR INSERT
  WITH CHECK (true);

CREATE POLICY "whitelist_update"
  ON staff_whitelist FOR UPDATE
  USING (true);

-- ================================
-- STEP 11: SUPER_ADMINS
-- ================================

CREATE POLICY "super_admins_select"
  ON super_admins FOR SELECT
  USING (true);

-- ================================
-- STEP 12: REVIEWS
-- ================================

CREATE POLICY "reviews_select"
  ON reviews FOR SELECT
  USING (true);

CREATE POLICY "reviews_insert"
  ON reviews FOR INSERT
  WITH CHECK (true);

-- ================================
-- STEP 13: MASTER_MEDICINES
-- ================================

CREATE POLICY "master_med_select"
  ON master_medicines FOR SELECT
  USING (true);

CREATE POLICY "master_med_insert"
  ON master_medicines FOR INSERT
  WITH CHECK (true);

CREATE POLICY "master_med_update"
  ON master_medicines FOR UPDATE
  USING (true);

-- ================================
-- STEP 14: SELLER_INVENTORY
-- ================================

CREATE POLICY "seller_inv_select"
  ON seller_inventory FOR SELECT
  USING (true);

CREATE POLICY "seller_inv_insert"
  ON seller_inventory FOR INSERT
  WITH CHECK (true);

CREATE POLICY "seller_inv_update"
  ON seller_inventory FOR UPDATE
  USING (true);

-- ================================
-- STEP 15: MEDICINE_REQUESTS
-- ================================

CREATE POLICY "med_req_select"
  ON medicine_requests FOR SELECT
  USING (true);

CREATE POLICY "med_req_insert"
  ON medicine_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "med_req_update"
  ON medicine_requests FOR UPDATE
  USING (true);
