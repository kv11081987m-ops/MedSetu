-- ══════════════════════════════════════════════════
-- MedSetu — Return/refund: capture customer's payout reference
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Refunds today are manual (SuperAdminPanel's Return/Refund Queue —
-- admin_decide_return / process_refund, 047_returnRefund.sql) — there is
-- no payment-gateway integration, so the admin has no way to know WHERE
-- to send the money back except by contacting the customer separately.
-- This adds a plain freeform text field the customer can optionally fill
-- in at return-request time (bank A/C or UPI ID) so the admin has a
-- ready reference on the return card. It is NOT a payment-gateway field
-- and nothing auto-processes off it — purely a reference the admin reads
-- and manually acts on.


-- ================================================================
-- 1. order_returns.refund_payment_details
-- ================================================================
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS
  refund_payment_details text;


-- ================================================================
-- 2. request_return — same function, new optional trailing param
-- ================================================================
CREATE OR REPLACE FUNCTION request_return(
  p_order_id uuid,
  p_reason text,
  p_reason_detail text DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_refund_payment_details text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $function$
DECLARE
  v_order       orders%ROWTYPE;
  v_customer_id uuid;
  v_return_id   uuid;
BEGIN
  -- Customer ki apni id
  SELECT id INTO v_customer_id FROM users
  WHERE auth_id = auth.uid() OR email = auth.email()
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Login required');
  END IF;

  IF p_reason NOT IN ('wrong_item', 'damaged', 'not_delivered', 'expired', 'other') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid return reason');
  END IF;

  -- Order check: delivered + customer ka apna
  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id AND customer_id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order.status != 'delivered' THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Sirf delivered orders par return request ho sakti hai');
  END IF;

  -- Duplicate guard — friendly message; order_returns_one_active_per_order
  -- (unique index, upar) isi ko DB-level par bhi enforce karta hai
  -- (concurrent double-submit ke against race-safe).
  IF EXISTS (
    SELECT 1 FROM order_returns
    WHERE order_id = p_order_id AND status <> 'rejected'
  ) THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Is order par pehle se ek return request active hai');
  END IF;

  INSERT INTO order_returns (order_id, customer_id, reason, reason_detail, photo_url, refund_payment_details)
  VALUES (p_order_id, v_customer_id, p_reason, p_reason_detail, p_photo_url, NULLIF(BTRIM(p_refund_payment_details), ''))
  RETURNING id INTO v_return_id;

  -- Notification (seller ko batana ki naya return request aaya hai) is
  -- yahan SE nahi ki jaati — is codebase ka pattern hai ki guarded RPC
  -- sirf state-transition karta hai, aur caller (JS) alag se
  -- supabase.rpc('create_notification', {...}) fire-and-forget call
  -- karta hai (SellerDashboard.jsx accept-order flow jaisa). Wahi yahan
  -- bhi follow karna — is RPC ke andar nahi, kyunki create_notification
  -- khud caller ke role (customer/seller/buyer) se recipient resolve
  -- karta hai aur ref_id = orders.id expect karta hai, return_id nahi.

  RETURN jsonb_build_object('success', true, 'message', 'Return request submit ho gayi', 'return_id', v_return_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'message', 'Is order par pehle se ek return request active hai');
END;
$function$;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'order_returns' AND column_name = 'refund_payment_details';

-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'request_return';
--   -- expect: 5 params (p_order_id, p_reason, p_reason_detail, p_photo_url,
--   -- p_refund_payment_details), INSERT lists refund_payment_details.

-- Real-session check: request_return(p_order_id, 'wrong_item', null, null,
--   '  ') -> inserted row has refund_payment_details = NULL (blank/whitespace
--   collapses to NULL, not an empty string); a real value like 'UPI: a@bank'
--   is stored as-is.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Restores request_return to its pre-071 4-param body
-- (047_returnRefund.sql) if needed:
--
-- CREATE OR REPLACE FUNCTION request_return(
--   p_order_id uuid, p_reason text, p_reason_detail text DEFAULT NULL,
--   p_photo_url text DEFAULT NULL
-- ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path TO 'public' AS $function$
--   -- ... same body as 047, INSERT without refund_payment_details
-- $function$;
--
-- ALTER TABLE order_returns DROP COLUMN IF EXISTS refund_payment_details;
