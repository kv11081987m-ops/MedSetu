-- ══════════════════════════════════════════════════
-- MedSetu — Delivery partner keeps visibility of their own completed
-- return pickups (needed for DeliveryPartnerPanel's "Recent Completed")
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Found while wiring a "Recent Completed" sub-section into
-- DeliveryPartnerPanel.jsx's Return Pickups list: order_returns_select_
-- delivery_partner (067_returnPickupFlow.sql, fixed in
-- 068_fixReturnPickupRLS.sql) gates the WHOLE policy on
--   status = 'seller_reviewed' AND seller_action = 'accepted'
-- even for the "pickup_staff_id = me" branch. confirm_return_pickup()
-- only sets pickup_confirmed_at — it never touches seller_action — so a
-- partner's own row stays visible right up until the SELLER later calls
-- seller_review_return(p_action := 'return_received') (SellerDashboard.jsx/
-- SellerStaffPanel.jsx), which flips seller_action away from 'accepted'.
-- At that exact moment the row silently drops out of EVERY delivery
-- partner's SELECT, including the one who did the pickup — there's no
-- RLS path back to it. A UI change alone can't surface data RLS already
-- hides, so this widens the policy: the unclaimed-pool branch keeps its
-- original status/seller_action/serviceability gate untouched, but a
-- partner's own claimed pickup (pickup_staff_id = them) is now visible
-- regardless of how far the seller has since moved it — same "read your
-- own history forever" shape as the delivery_earnings/Aaj Ki History
-- pattern elsewhere in this panel, just applied to order_returns.


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
  AND (
    -- Mine forever, once claimed — regardless of what the seller does
    -- with it afterwards (return_received, or anything else).
    pickup_staff_id = (SELECT staff.id FROM staff WHERE staff.email = auth.email())
    OR (
      -- Unclaimed pool — unchanged gate from 068.
      pickup_staff_id IS NULL
      AND status = 'seller_reviewed'
      AND seller_action = 'accepted'
      AND is_return_pickup_serviceable(order_returns.order_id)
    )
  )
);


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT qual FROM pg_policies WHERE tablename='order_returns'
--   AND policyname='order_returns_select_delivery_partner';
--   -- expect the OR'd shape above, no longer a single top-level AND-chain.

-- Real-session check: as the delivery partner who claimed + confirmed a
-- pickup, after the seller calls seller_review_return(return_id,
-- 'return_received') on it — SELECT id FROM order_returns WHERE id =
-- '<that return id>' (client, RLS-enforced) should still return 1 row,
-- where before this migration it returned 0.
-- A different delivery partner (never claimed this one) still gets 0
-- rows for it, whatever its status — the pool-visibility gate is
-- untouched.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP POLICY IF EXISTS "order_returns_select_delivery_partner" ON order_returns;
-- CREATE POLICY "order_returns_select_delivery_partner" ON order_returns
-- FOR SELECT TO authenticated
-- USING (
--   is_active_delivery_partner()
--   AND status = 'seller_reviewed'
--   AND seller_action = 'accepted'
--   AND (
--     (pickup_staff_id IS NULL AND is_return_pickup_serviceable(order_returns.order_id))
--     OR pickup_staff_id = (SELECT staff.id FROM staff WHERE staff.email = auth.email())
--   )
-- );
