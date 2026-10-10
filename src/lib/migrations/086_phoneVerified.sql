-- ══════════════════════════════════════════════════
-- MedSetu — 086: users.phone_verified + strict customer_unverified
-- NOT yet applied — run in Supabase SQL Editor (after 084).
-- ══════════════════════════════════════════════════
-- phone_verified = true ONLY when a phone was proven by OTP:
--   (a) OTP login: mark_phone_verified_from_session() reads the `phone`
--       claim of the caller's signed JWT (minted by firebase-bridge after
--       Firebase verified the OTP) — unforgeable by the client.
--   (b) OTP prompt for Google users: Edge Function `attach-verified-phone`
--       verifies the Firebase ID token server-side, then calls
--       admin_set_verified_phone() (service_role only).
-- Clients can NOT set it: the guard trigger below forces false on INSERT,
-- resets it to false whenever `phone` changes (e.g. typed on the profile
-- screen), and otherwise keeps the old value — unless a SECURITY DEFINER
-- function above set the app.phone_verify_trusted flag for its own UPDATE.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION guard_phone_verified()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.phone_verify_trusted', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.phone_verified := false;
  ELSIF NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phone_verified := false;
  ELSE
    NEW.phone_verified := OLD.phone_verified;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_phone_verified ON users;
CREATE TRIGGER trg_guard_phone_verified
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_phone_verified();

-- (a) OTP login path ------------------------------------------------
CREATE OR REPLACE FUNCTION mark_phone_verified_from_session()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jwt_phone TEXT := regexp_replace(COALESCE(auth.jwt() ->> 'phone', ''), '\D', '', 'g');
  v_n         INTEGER;
BEGIN
  IF auth.uid() IS NULL OR length(v_jwt_phone) < 10 THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.phone_verify_trusted', 'true', true);
  UPDATE users SET phone_verified = true
  WHERE auth_id = auth.uid()
    AND phone_verified IS NOT TRUE
    AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = right(v_jwt_phone, 10);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.phone_verify_trusted', 'false', true);
  RETURN v_n > 0 OR EXISTS (
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND phone_verified
  );
END;
$$;
REVOKE ALL ON FUNCTION mark_phone_verified_from_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_phone_verified_from_session() TO authenticated;

-- (b) OTP prompt path (called only by the Edge Function, service_role) --
CREATE OR REPLACE FUNCTION admin_set_verified_phone(p_auth_id UUID, p_email TEXT, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM users
  WHERE auth_id = p_auth_id OR (p_email IS NOT NULL AND email = p_email)
  ORDER BY (auth_id = p_auth_id) DESC NULLS LAST
  LIMIT 1;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_user');
  END IF;
  PERFORM set_config('app.phone_verify_trusted', 'true', true);
  UPDATE users SET phone = p_phone, phone_verified = true WHERE id = v_id;
  PERFORM set_config('app.phone_verify_trusted', 'false', true);
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'code', 'duplicate');
END;
$$;
REVOKE ALL ON FUNCTION admin_set_verified_phone(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_verified_phone(UUID, TEXT, TEXT) TO service_role;

-- Backfill ------------------------------------------------------------
-- We cannot tell OTP-set phones from typed ones in users alone (no history).
-- The one strong proof: firebase-bridge creates auth.users rows with
-- phone_confirm=true, so users whose linked auth.users.phone matches
-- users.phone really logged in by OTP. Only those become verified. Everyone
-- else (incl. Google users who used the OTP prompt before this migration,
-- and legacy pre-Firebase phone rows) stays false — the safe default: worst
-- case an extra "call recipient" badge, never a missed one. They become
-- verified at their next OTP login.
DO $$
BEGIN
  PERFORM set_config('app.phone_verify_trusted', 'true', true);
  UPDATE users u SET phone_verified = true
  FROM auth.users a
  WHERE a.id = u.auth_id
    AND COALESCE(a.phone, '') <> ''
    AND COALESCE(u.phone, '') <> ''
    AND right(regexp_replace(a.phone, '\D', '', 'g'), 10) = right(regexp_replace(u.phone, '\D', '', 'g'), 10);
  PERFORM set_config('app.phone_verify_trusted', 'false', true);
END $$;

-- 084 trigger now keys off phone_verified instead of "phone not empty" ---
CREATE OR REPLACE FUNCTION set_customer_unverified()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.buyer_type, 'customer') <> 'customer' OR NEW.customer_id IS NULL THEN
    NEW.customer_unverified := false;
    RETURN NEW;
  END IF;
  NEW.customer_unverified := NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.customer_id AND u.phone_verified = true
  );
  RETURN NEW;
END;
$$;

-- VERIFY:
--   SELECT phone_verified, count(*) FROM users GROUP BY 1;
--   -- client cannot flip it (run as an authenticated user):
--   --   UPDATE users SET phone_verified = true WHERE auth_id = auth.uid(); -> row stays false
-- ROLLBACK:
--   CREATE OR REPLACE FUNCTION set_customer_unverified() ... (re-run 084's body)
--   DROP TRIGGER IF EXISTS trg_guard_phone_verified ON users;
--   DROP FUNCTION IF EXISTS guard_phone_verified(), mark_phone_verified_from_session(),
--                           admin_set_verified_phone(UUID, TEXT, TEXT);
--   ALTER TABLE users DROP COLUMN IF EXISTS phone_verified;
