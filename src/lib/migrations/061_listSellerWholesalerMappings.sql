-- 061_listSellerWholesalerMappings.sql
-- Aggregator-owner apni mapped wholesalers ki list padh sake. aggregator_wholesalers
-- ki RLS sirf superadmin ko padhne deti hai, isliye ownership-verified RPC — bilkul
-- list_seller_staff / add_staff_to_seller jaisa. SECURITY DEFINER se RLS bypass, par
-- pehle owner-check.

CREATE OR REPLACE FUNCTION list_seller_wholesaler_mappings(p_seller_id UUID)
RETURNS TABLE (
  wholesaler_seller_id  UUID,
  store_name            TEXT,
  priority              INT,
  is_active             BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_owns    BOOLEAN;
BEGIN
  SELECT user_id INTO v_user_id FROM sellers WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN;  -- seller nahi mila -> khaali
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = v_user_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
  ) INTO v_owns;

  IF NOT (v_owns OR is_active_superadmin()) THEN
    RETURN;  -- owner nahi -> khaali (koi leak nahi)
  END IF;

  RETURN QUERY
    SELECT
      aw.wholesaler_seller_id,
      sel.store_name::text AS store_name,
      aw.priority,
      aw.is_active
    FROM aggregator_wholesalers aw
    JOIN sellers sel ON sel.id = aw.wholesaler_seller_id
    WHERE aw.aggregator_seller_id = p_seller_id
      AND aw.is_active = true
    ORDER BY aw.priority;
END;
$$;

GRANT EXECUTE ON FUNCTION list_seller_wholesaler_mappings(UUID) TO authenticated;
