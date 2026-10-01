-- ================================================================
-- 082 — Enable RLS on the Sep-24 wipe/backup snapshot tables.
--
-- These tables were created ad hoc (not via migrations) and were left
-- with RLS disabled, so the anon key could read them via REST
-- (users: phone/email/health data, sellers: aadhar_number, etc).
--
-- RLS ON + NO policy = deny-all for anon/authenticated. Only
-- service_role / superuser (SQL editor) can read them.
-- ================================================================
BEGIN;

ALTER TABLE wipe_backup_order_returns_sep24          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_reviews_sep24                ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_disputes_sep24               ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_pharmacist_calls_sep24       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_order_delivery_otps_sep24    ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_inventory_backup_sep24            ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_medicines_rxflag_backup_sep24     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_aggregator_wholesalers_sep24 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_orders_sep24                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_order_items_sep24            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_users_sep24                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_sellers_sep24                ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_notifications_sep24          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_addresses_sep24              ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_prescriptions_sep24          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wipe_backup_delivery_earnings_sep24      ENABLE ROW LEVEL SECURITY;

-- Belt and braces: also drop the table grants so anon/authenticated get
-- 42501 "permission denied" (and the tables disappear from REST) instead
-- of an empty 200.
REVOKE ALL ON wipe_backup_order_returns_sep24          FROM anon, authenticated;
REVOKE ALL ON wipe_backup_reviews_sep24                FROM anon, authenticated;
REVOKE ALL ON wipe_backup_disputes_sep24               FROM anon, authenticated;
REVOKE ALL ON wipe_backup_pharmacist_calls_sep24       FROM anon, authenticated;
REVOKE ALL ON wipe_backup_order_delivery_otps_sep24    FROM anon, authenticated;
REVOKE ALL ON seller_inventory_backup_sep24            FROM anon, authenticated;
REVOKE ALL ON master_medicines_rxflag_backup_sep24     FROM anon, authenticated;
REVOKE ALL ON wipe_backup_aggregator_wholesalers_sep24 FROM anon, authenticated;
REVOKE ALL ON wipe_backup_orders_sep24                 FROM anon, authenticated;
REVOKE ALL ON wipe_backup_order_items_sep24            FROM anon, authenticated;
REVOKE ALL ON wipe_backup_users_sep24                  FROM anon, authenticated;
REVOKE ALL ON wipe_backup_sellers_sep24                FROM anon, authenticated;
REVOKE ALL ON wipe_backup_notifications_sep24          FROM anon, authenticated;
REVOKE ALL ON wipe_backup_addresses_sep24              FROM anon, authenticated;
REVOKE ALL ON wipe_backup_prescriptions_sep24          FROM anon, authenticated;
REVOKE ALL ON wipe_backup_delivery_earnings_sep24      FROM anon, authenticated;

COMMIT;

-- Verify: expect 0 rows.
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname='public' AND rowsecurity=false;
