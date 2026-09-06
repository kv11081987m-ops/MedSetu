-- 063_staffEditHold.sql
-- Do owner-side RPCs: (1) set_assignment_hold — duty hold on/off switch,
-- (2) edit_staff_assignment — staff ka naam + deployed wholesaler badalna.
-- Dono me wahi ownership-check jo add_staff_to_seller / end_staff_assignment me hai.

-- ============================================================
-- set_assignment_hold: owner apne staff ki duty hold on/off kare
-- ============================================================
CREATE OR REPLACE FUNCTION set_assignment_hold(p_assignment_id UUID, p_hold BOOLEAN)
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
  SET is_on_hold = p_hold
  WHERE id = p_assignment_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Assignment active nahi hai');
  END IF;

  RETURN jsonb_build_object('ok', true, 'is_on_hold', p_hold);
END;
$$;

-- ============================================================
-- edit_staff_assignment: naam (staff) + deployed wholesaler (assignment) badalna
--   - normal seller  -> deployed_wholesaler_id ZABARDASTI NULL
--   - aggregator     -> naya wholesaler uske mapped wholesalers me se ho
-- ============================================================
CREATE OR REPLACE FUNCTION edit_staff_assignment(
  p_assignment_id          UUID,
  p_name                   TEXT,
  p_deployed_wholesaler_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_id UUID;
  v_staff_id  UUID;
  v_user_id   UUID;
  v_owns      BOOLEAN;
  v_is_agg    BOOLEAN;
  v_whid      UUID;
BEGIN
  SELECT seller_id, staff_id INTO v_seller_id, v_staff_id
  FROM staff_assignment WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Assignment nahi mila');
  END IF;

  SELECT user_id, is_aggregator INTO v_user_id, v_is_agg FROM sellers WHERE id = v_seller_id;
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = v_user_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) INTO v_owns;
  IF NOT (v_owns OR is_active_superadmin()) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Aap is dukan ke owner nahi hain');
  END IF;

  -- deployed wholesaler logic
  IF COALESCE(v_is_agg, false) = true THEN
    IF p_deployed_wholesaler_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM aggregator_wholesalers
        WHERE aggregator_seller_id = v_seller_id
          AND wholesaler_seller_id = p_deployed_wholesaler_id
      ) THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Ye wholesaler is aggregator se mapped nahi hai');
      END IF;
      v_whid := p_deployed_wholesaler_id;
    ELSE
      v_whid := NULL;
    END IF;
  ELSE
    v_whid := NULL;  -- normal seller: hamesha NULL
  END IF;

  -- naam staff (vyakti) table me update
  UPDATE staff SET name = NULLIF(trim(p_name), '') WHERE id = v_staff_id;

  -- deployed wholesaler assignment me update
  UPDATE staff_assignment SET deployed_wholesaler_id = v_whid WHERE id = p_assignment_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION set_assignment_hold(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION edit_staff_assignment(UUID, TEXT, UUID) TO authenticated;
