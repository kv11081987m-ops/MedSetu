-- ══════════════════════════════════════════════════
-- MedSetu — 084: orders.customer_unverified (flag only, never blocks)
-- NOT yet applied anywhere — run in Supabase SQL Editor.
-- ══════════════════════════════════════════════════
-- True when the placing customer had NO phone on their users row at the
-- moment the order was inserted (Google-only / NRI users). Snapshot, set
-- server-side by a BEFORE INSERT trigger from users.phone — the client
-- cannot spoof it either way (value is overwritten on every insert).
-- Why a column and not derive-at-read: sellers/pharmacists/admins cannot
-- generally read a customer's users row, and a snapshot stays stable if the
-- customer adds a phone later while the order is still in flight.
-- Caveat: users.phone is only OTP-verified when set via OTP login or
-- AttachPhoneModal; UserProfile also lets a user type one in unverified.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_unverified BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION set_customer_unverified()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.buyer_type, 'customer') <> 'customer' OR NEW.customer_id IS NULL THEN
    NEW.customer_unverified := false;
    RETURN NEW;
  END IF;
  NEW.customer_unverified := NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = NEW.customer_id AND COALESCE(btrim(u.phone), '') <> ''
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_customer_unverified ON orders;
CREATE TRIGGER trg_set_customer_unverified
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION set_customer_unverified();

-- VERIFY: place an order as a Google user with users.phone NULL ->
--   SELECT order_number, customer_unverified FROM orders ORDER BY created_at DESC LIMIT 3;
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_set_customer_unverified ON orders;
--   DROP FUNCTION IF EXISTS set_customer_unverified();
--   ALTER TABLE orders DROP COLUMN IF EXISTS customer_unverified;
