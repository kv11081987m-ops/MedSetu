-- ══════════════════════════════════════════════════
-- MedSetu — 085: in-app "delivered" notification for B2C customers
-- NOT yet applied — run in Supabase SQL Editor.
-- ══════════════════════════════════════════════════
-- Delivered is reached by three paths: mark_order_delivered (seller, 015),
-- confirm_delivery (rider, 053) and the 052 rider function. Only the seller
-- path ever notified, via a client-side create_notification call. A trigger
-- on the status flip covers all paths and fires once: it requires
-- OLD.status <> 'delivered' AND NEW.status = 'delivered', plus an
-- idempotency check on (ref_id, type). SellerDashboard's B2C client call is
-- removed in the same change (B2B 'b2b_update' call stays).

CREATE OR REPLACE FUNCTION notify_customer_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND OLD.status IS DISTINCT FROM 'delivered'
     AND COALESCE(NEW.buyer_type, 'customer') = 'customer'
     AND NEW.customer_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM notifications
       WHERE ref_id = NEW.id AND type = 'order_delivered'
     )
  THEN
    INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
    VALUES (NEW.customer_id, 'दवा पहुंच गई ✅',
            'ऑर्डर ' || COALESCE(NEW.order_number, NEW.id::TEXT) || ' डिलीवर हो गया',
            'order_delivered', NEW.id, false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- a notification failure must never roll back a delivery
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_delivered ON orders;
CREATE TRIGGER trg_notify_customer_delivered
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_customer_delivered();

-- VERIFY: mark a B2C order delivered (seller button, then a rider OTP
-- delivery on another order) ->
--   SELECT ref_id, title, count(*) FROM notifications
--   WHERE type='order_delivered' GROUP BY 1,2 HAVING count(*) > 1;   -- expect 0 rows
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_notify_customer_delivered ON orders;
--   DROP FUNCTION IF EXISTS notify_customer_delivered();
--   (and restore the B2C create_notification call in SellerDashboard.markDeliveredImpl)
