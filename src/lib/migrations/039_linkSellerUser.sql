-- ══════════════════════════════════════════════════
-- MedSetu — BUG: naye seller ka online-toggle persist nahi hota
-- Root: sellers.user_id kabhi link nahi hota (approval par users row
-- exist nahi karta; AuthContext ka first-login backfill khud
-- sellers_update RLS ke chicken-and-egg se 0 rows karta hai).
-- Fix: SECURITY DEFINER RPC jo approval par users row bana ke link kare.
-- Depends on: 014_rlsPhase5a.sql (is_active_superadmin()), 001_schema.sql
-- Run this in Supabase SQL Editor.
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION link_seller_user(p_seller_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller sellers%ROWTYPE;
  v_uid    UUID;
BEGIN
  IF NOT is_active_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'superadmin only');
  END IF;

  SELECT * INTO v_seller FROM sellers WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'seller not found');
  END IF;

  -- Already linked (re-approval / repeat call) — idempotent no-op.
  IF v_seller.user_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'user_id', v_seller.user_id, 'note', 'already linked');
  END IF;

  IF v_seller.email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'seller has no email');
  END IF;

  -- Seller ne shayad pehle hi login kar liya ho (edge) — us row ko reuse karo.
  SELECT id INTO v_uid FROM users WHERE lower(email) = lower(v_seller.email) LIMIT 1;

  -- Warna pre-login shell row — auth_id/phone NULL, wahi shape jo
  -- AuthContext staff-upsert banata hai (AuthContext.jsx:423); pehle
  -- Google login par AuthContext.jsx:433-437 auth_id patch kar deta hai.
  -- users.phone UNIQUE hai par nullable (004_fix_users_phone.sql) —
  -- multiple NULL rows allowed, koi collision nahi.
  IF v_uid IS NULL THEN
    INSERT INTO users (email, name, role)
    VALUES (v_seller.email, v_seller.owner_name, 'seller')
    RETURNING id INTO v_uid;
  END IF;

  UPDATE sellers SET user_id = v_uid WHERE id = p_seller_id;

  RETURN jsonb_build_object('success', true, 'user_id', v_uid);
END;
$$;

GRANT EXECUTE ON FUNCTION link_seller_user(UUID) TO authenticated;

-- VERIFY:
--   SELECT link_seller_user('<new seller id>');   -> { success: true, user_id: ... }
--   SELECT id, email, user_id FROM sellers WHERE id = '<new seller id>';  -> user_id set
