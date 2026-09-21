-- ══════════════════════════════════════════════════
-- MedSetu — Rider-visibility: staff phone + manual "reached" signal
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Two independent additions for a seller-staff "who's picking this up,
-- and are they here yet" card:
--   1. staff.phone — staff table (add_seller_staff/approve_delivery_partner,
--      056_sellerStaffSimple.sql / 052_deliveryPartner.sql) never captured
--      a phone number, only email + name. delivery_partner_registrations
--      already collects `mobile` at signup time (055_deliveryPartnerRegistration.sql)
--      but approve_delivery_partner never copied it into the staff row it
--      creates. Backfilled for already-approved partners too, so this
--      isn't a "only new signups get a phone" gap.
--   2. orders.rider_reached_at — no live GPS tracking exists in this app
--      (confirmed separately: delivery_latitude/longitude on orders are
--      the CUSTOMER's pin-dropped address, 034_addressLatLng.sql, not a
--      rider position). This is a manual signal instead — the delivery
--      partner taps "Store Reach Ho Gaya" once physically at the seller,
--      same class of action as the existing OTP-based confirm_delivery
--      step, just for arrival rather than handover.


-- ================================================================
-- 1. staff.phone
-- ================================================================
ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone varchar(10);


-- ================================================================
-- 2. approve_delivery_partner — same function, INSERT now also copies
--    the registration's mobile into the new staff.phone column.
-- ================================================================
CREATE OR REPLACE FUNCTION public.approve_delivery_partner(p_registration_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  SELECT 'DEL' || LPAD((COUNT(*) + 1)::text, 4, '0') INTO v_staff_code
  FROM staff WHERE staff_code LIKE 'DEL%';

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


-- ================================================================
-- 3. Backfill — already-approved partners whose staff row predates this
--    migration (e.g. Sanjay Verma) never got a phone copied at approval
--    time; this fills it in from their own original registration without
--    re-approving anything.
-- ================================================================
UPDATE staff s
SET phone = dpr.mobile
FROM delivery_partner_registrations dpr
WHERE s.email = dpr.email
AND s.phone IS NULL
AND dpr.status = 'approved';


-- ================================================================
-- 4. orders.rider_reached_at
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  rider_reached_at timestamptz;


-- ================================================================
-- 5. mark_rider_reached(p_order_id) — delivery partner's own "Reach" tap
-- ================================================================
CREATE OR REPLACE FUNCTION mark_rider_reached(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_staff_id uuid;
BEGIN
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Aap active delivery partner nahi hain');
  END IF;

  UPDATE orders SET rider_reached_at = now(), updated_at = now()
  WHERE id = p_order_id AND delivered_by_staff_id = v_staff_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye order aapka nahi hai');
  END IF;

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION mark_rider_reached(uuid) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name FROM information_schema.columns WHERE table_name='staff' AND column_name='phone';
-- SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='rider_reached_at';
-- SELECT proname FROM pg_proc WHERE proname = 'mark_rider_reached';

-- Backfill check — an already-approved partner's staff row now has a
-- phone pulled from their own registration:
-- SELECT s.name, s.phone, dpr.mobile FROM staff s
--   JOIN delivery_partner_registrations dpr ON dpr.email = s.email
--   WHERE dpr.status = 'approved';
--   -- expect s.phone = dpr.mobile for every row, none NULL.

-- Real-session checks:
--   1. New approval: approve_delivery_partner(reg_id) -> staff row created
--      with phone = that registration's mobile.
--   2. Delivery partner (delivered_by_staff_id = them) calls
--      mark_rider_reached(order_id) -> {success:true}; orders.rider_reached_at set.
--   3. Same call from a different delivery partner on that order ->
--      {success:false, 'Ye order aapka nahi hai'}.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS mark_rider_reached(uuid);
-- ALTER TABLE orders DROP COLUMN IF EXISTS rider_reached_at;
-- -- approve_delivery_partner: re-apply 052_deliveryPartner.sql's original
-- -- body (git history) to drop the phone copy, if needed.
-- ALTER TABLE staff DROP COLUMN IF EXISTS phone;
