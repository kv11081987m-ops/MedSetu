-- ══════════════════════════════════════════════════
-- MedSetu — fix: order_returns_select_delivery_partner never actually matched
-- ══════════════════════════════════════════════════
--
-- Bug found during 067's own end-to-end verification (dry-run, rolled
-- back): the delivery-partner SELECT policy on order_returns
-- (067_returnPickupFlow.sql) checks pincode serviceability via
--   EXISTS (SELECT 1 FROM orders o JOIN serviceable_pincodes sp ... WHERE o.id = order_returns.order_id)
-- but that subquery is itself subject to orders' OWN RLS policies for the
-- CURRENT role — being nested inside another table's policy does not
-- bypass it. orders_select_delivery_partner(_preview) only let a delivery
-- partner see orders with status IN ('out_for_delivery','confirmed',
-- 'preparing') — never 'delivered', which is exactly the status every
-- return-eligible order is in. So the EXISTS always evaluated false, and
-- the whole policy never matched anything, for any real return.
--
-- Same root cause and same fix as 057_fixStaffRlsRecursion.sql: wrap the
-- cross-table lookup in a SECURITY DEFINER function, which runs with its
-- owner's privileges and so reads `orders`/`serviceable_pincodes`
-- bypassing their RLS entirely — the delivery-partner-visibility decision
-- still lives entirely in this one policy, this just lets it actually see
-- the pincode it needs to check.

CREATE OR REPLACE FUNCTION public.is_return_pickup_serviceable(p_order_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM orders o
    JOIN serviceable_pincodes sp ON sp.pincode = o.delivery_pincode AND sp.delivery_enabled = true
    WHERE o.id = p_order_id
  );
$$;

DROP POLICY IF EXISTS "order_returns_select_delivery_partner" ON order_returns;
CREATE POLICY "order_returns_select_delivery_partner" ON order_returns
FOR SELECT TO authenticated
USING (
  is_active_delivery_partner()
  AND status = 'seller_reviewed'
  AND seller_action = 'accepted'
  AND (
    (pickup_staff_id IS NULL AND is_return_pickup_serviceable(order_returns.order_id))
    OR pickup_staff_id = (SELECT staff.id FROM staff WHERE staff.email = auth.email())
  )
);

REVOKE EXECUTE ON FUNCTION is_return_pickup_serviceable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_return_pickup_serviceable(uuid) TO authenticated;

-- ================================================================
-- VERIFY — run after applying (same dry-run as 067's own verify, this
-- time A1 should return 1 instead of 0)
-- ================================================================
-- Re-run 067's e2e test: as the delivery partner, before claiming,
-- SELECT count(*) FROM order_returns WHERE id = '<test return id>';
-- -- now expect 1, not 0.

-- ================================================================
-- ROLLBACK
-- ================================================================
-- Re-apply 067_returnPickupFlow.sql's original policy (broken, EXISTS
-- directly on orders) and DROP FUNCTION is_return_pickup_serviceable(uuid).
