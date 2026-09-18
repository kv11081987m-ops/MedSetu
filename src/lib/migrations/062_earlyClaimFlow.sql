-- ══════════════════════════════════════════════════
-- MedSetu — Early-claim flow: claim at confirmed/preparing, not just out_for_delivery
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Today claim_delivery_order (060_deliveryClaimOrder.sql) only accepts
-- out_for_delivery orders — a delivery partner has zero advance notice
-- to head toward the seller until the seller has fully packed and handed
-- over. This widens the claim window to confirmed/preparing too, so a
-- partner can claim while the seller is still packing and start heading
-- that way. generate_delivery_otp and confirm_delivery are UNCHANGED —
-- both still require status = 'out_for_delivery', so the parcel must be
-- physically ready before OTP/delivery-confirm can happen, regardless of
-- how early it was claimed.

-- ================================================================
-- 1. claim_delivery_order — status check widened
-- ================================================================
CREATE OR REPLACE FUNCTION claim_delivery_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_staff_id uuid;
  v_order    orders%ROWTYPE;
BEGIN
  SELECT s.id INTO v_staff_id
  FROM staff s JOIN staff_assignment a ON a.staff_id = s.id
  WHERE s.email = auth.email()
    AND a.role_type = 'delivery_partner' AND a.is_active = true;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Aap active delivery partner nahi hain');
  END IF;

  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  -- Widened: confirmed/preparing/out_for_delivery all claimable now
  -- (was out_for_delivery only) — early-claim lets a partner head toward
  -- the seller while packing is still in progress.
  IF v_order.status NOT IN ('confirmed', 'preparing', 'out_for_delivery') THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye order abhi ready nahi hai');
  END IF;

  IF v_order.delivered_by_staff_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Ye order kisi aur delivery-partner ne le liya hai');
  END IF;

  UPDATE orders SET delivered_by_staff_id = v_staff_id, updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION claim_delivery_order(uuid) TO authenticated;


-- ================================================================
-- 2. RLS — unclaimed-only preview + always-visible own-claimed
-- ================================================================

-- Tightened: delivered_by_staff_id IS NULL added — once claimed, the
-- order drops out of every OTHER partner's preview pool. The claiming
-- partner still sees it via orders_select_own_claimed below (status-
-- independent), so this is additive with that policy, not a net loss of
-- visibility for anyone.
DROP POLICY IF EXISTS "orders_select_delivery_partner_preview" ON orders;

CREATE POLICY "orders_select_delivery_partner_preview" ON orders
  FOR SELECT TO authenticated
  USING (
    is_active_delivery_partner() AND
    status IN ('confirmed', 'preparing') AND
    delivered_by_staff_id IS NULL AND
    delivery_pincode IN (SELECT pincode FROM serviceable_pincodes WHERE delivery_enabled = true)
  );

-- New — a partner's own claimed order stays visible to them regardless
-- of status (confirmed/preparing/out_for_delivery), so the early-claim
-- flow doesn't lose the order between fetches as it moves through the
-- seller's pack/handover steps. Additive with orders_select_delivery_
-- partner (053) and the preview policy above — Postgres ORs all
-- permissive SELECT policies together.
DROP POLICY IF EXISTS "orders_select_own_claimed" ON orders;

CREATE POLICY "orders_select_own_claimed" ON orders
  FOR SELECT TO authenticated
  USING (
    is_active_delivery_partner() AND
    delivered_by_staff_id = (SELECT id FROM staff WHERE email = auth.email())
  );


-- ================================================================
-- 3. generate_delivery_otp / confirm_delivery — NO CHANGE
-- ================================================================
-- Both remain status = 'out_for_delivery'-gated (059_fixOtpAuth.sql /
-- 061_scopeOtpToClaimant.sql, 053_deliveryPartnerOrdersRLS.sql) — an
-- early claim never lets OTP/delivery-confirm happen before the parcel
-- is physically handed over.


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT prosrc LIKE '%confirmed%preparing%out_for_delivery%'
--   FROM pg_proc WHERE proname = 'claim_delivery_order';
-- -- expect: t (sanity check the widened status list landed)
-- SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'orders'
--   AND policyname IN ('orders_select_delivery_partner_preview','orders_select_own_claimed');

-- Real-session checks:
--   1. Delivery partner claims a 'confirmed' order -> {success:true};
--      delivered_by_staff_id set immediately, status stays 'confirmed'.
--   2. A DIFFERENT delivery partner's next preview fetch no longer shows
--      that order (delivered_by_staff_id IS NULL clause now excludes it).
--   3. The claiming partner still sees it (any status) via
--      orders_select_own_claimed, even after the seller advances it to
--      'preparing' then 'out_for_delivery'.
--   4. generate_delivery_otp / confirm_delivery on that order while still
--      'confirmed'/'preparing' -> still fail with the out_for_delivery
--      message, unchanged.
--   5. Claim on a 'pending' or 'delivered' order -> still {success:false,
--      'Ye order abhi ready nahi hai'} (status list unchanged there).
--   6. Two delivery partners racing the same 'confirmed' order -> exactly
--      one succeeds (FOR UPDATE), same as before.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP POLICY IF EXISTS "orders_select_own_claimed" ON orders;
-- -- Re-apply 058_deliveryEarlyVisibility.sql's version of
-- -- orders_select_delivery_partner_preview (drops delivered_by_staff_id
-- -- IS NULL clause).
-- -- Re-apply 060_deliveryClaimOrder.sql's version of claim_delivery_order
-- -- (restores out_for_delivery-only status check).
