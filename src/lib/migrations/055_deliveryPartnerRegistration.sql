-- ══════════════════════════════════════════════════
-- MedSetu — Delivery Partner self-registration
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Follows the seller_registrations pattern (002_superadmin.sql /
-- SellerRegister.jsx) with three deliberate improvements over it:
--   1. OTP-verify mandatory before insert (seller_registrations has no
--      such gate — anyone can insert any mobile/email with zero proof).
--   2. Storage path scoped by shape (seller-documents' upload policy has
--      no path restriction at all — see caveat below on what "scoped"
--      can actually mean for an anonymous flow).
--   3. A real document-viewer in the SuperAdmin UI (SuperAdminPanel.jsx's
--      existing seller "Documents Dekho" panel never actually renders
--      the uploaded image/PDF — just text metadata; this one does, via
--      a signed URL, same pattern as getSignedRxUrl).

-- ================================================================
-- 1. delivery_partner_registrations
-- ================================================================
CREATE TABLE IF NOT EXISTS delivery_partner_registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  mobile            varchar(10) NOT NULL,
  mobile_verified   boolean DEFAULT false,
  email             text,
  address           text NOT NULL,
  aadhar_number     varchar(12) NOT NULL,
  aadhar_image_url  text,
  vehicle_type      text,
  status            text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by       uuid REFERENCES users(id),
  review_date       timestamptz,
  rejection_reason  text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE delivery_partner_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_verified_only" ON delivery_partner_registrations;
DROP POLICY IF EXISTS "superadmin_all"               ON delivery_partner_registrations;

-- Guards against a client that simply forgot to set the flag — it does
-- NOT (and structurally cannot) prove the OTP was really verified, since
-- Postgres has no way to see the Firebase confirmation that happened
-- client-side. The real proof-of-phone-ownership step is the Firebase
-- OTP round-trip in DeliveryPartnerRegister.jsx; this is a backstop, not
-- the security boundary. Still strictly better than seller_registrations'
-- current insert policy, which is `WITH CHECK (true)` — no gate at all.
CREATE POLICY "public_insert_verified_only"
ON delivery_partner_registrations
FOR INSERT TO anon, authenticated
WITH CHECK (mobile_verified = true);

CREATE POLICY "superadmin_all" ON delivery_partner_registrations
FOR ALL TO authenticated
USING (is_active_superadmin())
WITH CHECK (is_active_superadmin());


-- ================================================================
-- 2. Storage bucket for aadhar images — path scoped by shape
-- ================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-documents', 'delivery-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "delivery_docs_upload_own_path" ON storage.objects;
DROP POLICY IF EXISTS "delivery_docs_read_admin"       ON storage.objects;

-- CAVEAT (unlike prescriptions/return-photos, which scope by
-- auth.uid() against an authenticated session): this flow is
-- intentionally anonymous — Firebase phone verification never creates a
-- Supabase auth.uid(), so there is no server-side identity to bind a
-- path to. This check only constrains the path's SHAPE (first folder
-- segment must look like a 10-digit mobile number, matching
-- DeliveryPartnerRegister.jsx's `${mobile}/aadhar_...` pattern) — it
-- blocks directory-traversal / junk paths and keeps the bucket
-- organized, but does NOT stop one submitter from uploading into
-- another's numbered folder if they guess/know the number. True
-- per-owner isolation here would require bridging to a real Supabase
-- session first, which this lightweight registration flow deliberately
-- doesn't do. Still a strict improvement over seller-documents'
-- seller_docs_upload, which has no path check whatsoever.
CREATE POLICY "delivery_docs_upload_own_path" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'delivery-documents'
  AND (storage.foldername(name))[1] ~ '^[0-9]{10}$'
);

CREATE POLICY "delivery_docs_read_admin" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'delivery-documents' AND is_active_superadmin());


-- ================================================================
-- 3. approve_delivery_partner / reject_delivery_partner
-- ================================================================
-- Automates what was previously a manual SQL Editor sequence (staff +
-- staff_assignment insert) for every delivery-partner onboarding.
--
-- Two hardenings beyond the original draft, both found while checking
-- staff's actual constraints (staff_code and email are UNIQUE):
--   - pg_advisory_xact_lock serializes staff_code generation — without
--     it, two admins approving different registrations at the same
--     moment could both compute the same COUNT(*)+1 and one insert
--     would crash on the UNIQUE(staff_code) violation. Approvals are a
--     low-frequency admin action, so a full-table lock for the instant
--     of this one INSERT is cheap and simplest.
--   - unique_violation is caught explicitly (covers staff_code AND the
--     case of two registrations sharing the same email — UNIQUE(email)
--     — e.g. an accidental duplicate submission) and returns a friendly
--     jsonb message instead of an unhandled exception reaching the client.
CREATE OR REPLACE FUNCTION approve_delivery_partner(
  p_registration_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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
    INSERT INTO staff (staff_code, email, name)
    VALUES (v_staff_code, v_reg.email, v_reg.name)
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
END; $$;

CREATE OR REPLACE FUNCTION reject_delivery_partner(
  p_registration_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT is_active_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Superadmin only');
  END IF;

  UPDATE delivery_partner_registrations SET
    status = 'rejected', rejection_reason = p_reason,
    reviewed_by = (SELECT id FROM users WHERE email = auth.email()),
    review_date = now(), updated_at = now()
  WHERE id = p_registration_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already decided ya nahi mila');
  END IF;

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION approve_delivery_partner(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION reject_delivery_partner(uuid, text) TO authenticated;


-- ================================================================
-- 4. Auto-expire stale pending registrations (daily cron)
-- ================================================================
-- cron.schedule() upserts by job name (re-running this file updates the
-- existing job in place rather than duplicating it) — same as every
-- other cron migration in this repo (031, 048).
SELECT cron.schedule(
  'expire_old_delivery_registrations',
  '0 3 * * *',
  $$
  UPDATE delivery_partner_registrations
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending'
  AND created_at < now() - interval '30 days';
  $$
);


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'delivery_partner_registrations' ORDER BY ordinal_position;

-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'delivery_partner_registrations';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage'
--   AND policyname LIKE 'delivery_docs%';

-- SELECT id, public FROM storage.buckets WHERE id = 'delivery-documents';

-- SELECT proname FROM pg_proc WHERE proname IN ('approve_delivery_partner', 'reject_delivery_partner');

-- SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'expire_old_delivery_registrations';

-- Real-session checks:
--   1. anon insert with mobile_verified=false -> rejected by RLS.
--   2. anon insert with mobile_verified=true -> succeeds.
--   3. anon upload to delivery-documents/9876543210/aadhar_x.jpg -> succeeds;
--      upload to delivery-documents/not-a-number/x.jpg -> rejected by RLS.
--   4. Non-superadmin calling approve_delivery_partner -> {success:false,'Superadmin only'}.
--   5. Superadmin approves a pending row -> staff + staff_assignment
--      (role_type='delivery_partner', is_active=true) rows created,
--      registration status='approved'; approving the SAME row again ->
--      {success:false,'Already decided'}.
--   6. Two registrations sharing an email, both approved -> second one
--      returns the friendly duplicate message instead of crashing.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- SELECT cron.unschedule('expire_old_delivery_registrations');
-- DROP FUNCTION IF EXISTS reject_delivery_partner(uuid, text);
-- DROP FUNCTION IF EXISTS approve_delivery_partner(uuid);
-- DROP POLICY IF EXISTS "delivery_docs_read_admin"       ON storage.objects;
-- DROP POLICY IF EXISTS "delivery_docs_upload_own_path"  ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'delivery-documents';
-- DROP TABLE IF EXISTS delivery_partner_registrations;
