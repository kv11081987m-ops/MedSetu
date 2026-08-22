-- ══════════════════════════════════════════════════
-- MedSetu — R4-A: Invoice numbering foundation
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: DB only — two new columns, one new counter table, one new RPC.
-- B2C orders only (buyer_type <> 'retailer'); B2B is explicitly left
-- untouched, same "B2B orders (buyer_type='retailer') untouched" line
-- used in 028/029/030 for the routing work. No app-code call site is
-- added here — that's wiring for a later step; this file only builds
-- the RPC so it exists to be called.
--
-- Depends on: 001_schema.sql (orders.customer_id/buyer_id/buyer_type,
-- sellers.store_name), 015_rlsPhase5b.sql (is_active_superadmin(),
-- is_approved_admin(), the users-bridge auth.uid()/auth.email() pattern,
-- protect_order_sensitive_columns() — confirmed below this trigger does
-- NOT touch a column unless it's explicitly named in one of its reset
-- branches, so the new invoice_number column passes through untouched
-- with no trust-flag needed), 027_routingCandidatesFn.sql (the
-- "orders.created_at is stored UTC, convert AT TIME ZONE 'UTC' -> AT
-- TIME ZONE 'Asia/Kolkata' before taking a calendar date" rule — reused
-- here for the FY boundary since Indian financial years are an IST
-- calendar concept, same as formatTime.js's display rule).
--
-- Format: prefix/FY/00001
--   prefix = sellers.invoice_prefix (seeded for Shyam Medical below;
--            NULL for every other seller today)
--   FY     = financial year of the ORDER's created_at, in IST, Apr-Mar
--            (2026-08 IST -> "2026-27", 2027-02 IST -> "2026-27",
--            2027-04 IST -> "2027-28")
--   00001  = per seller-per-FY running number, 5-digit zero-padded
--
-- Counter design: a dedicated invoice_counters(seller_id,
-- financial_year, last_number) table, one row per seller-per-FY,
-- rather than a jsonb blob on sellers. Chosen because (a) the
-- increment is then a single `INSERT ... ON CONFLICT DO UPDATE SET
-- last_number = last_number + 1 RETURNING last_number` — Postgres
-- resolves ON CONFLICT by locking the conflicting row, so two orders
-- for the same seller in the same FY racing this RPC concurrently
-- serialize on that row and cannot receive the same number; a jsonb
-- read-modify-write on sellers would need its own explicit row lock to
-- get the same guarantee and is harder to reason about under
-- concurrency, and (b) it keeps `sellers` free of a growing per-FY blob
-- that has to be parsed to answer "what's the last number for FY X".
-- A UNIQUE index on orders.invoice_number is added as a second,
-- belt-and-braces guard against duplicates from any future bug.
--
-- Fallback prefix (seller.invoice_prefix IS NULL): lower(left(seller_id
-- ::text, 3)) — first 3 hex chars of the seller's own UUID. Chosen over
-- a shared literal like 'med' specifically so two prefix-less sellers
-- never collide onto the same series (each UUID gives a different,
-- effectively-unique fallback) — confirmed with the user over a literal
-- 'med' fallback, which would have made every un-prefixed seller share
-- one series.

-- ================================================================
-- 1. sellers.invoice_prefix
-- ================================================================
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS invoice_prefix TEXT DEFAULT NULL;

-- Seed Shyam Medical. If this UPDATE reports 0 rows, the store_name
-- spelling in the live sellers table doesn't match exactly — check
-- `SELECT id, store_name FROM sellers WHERE store_name ILIKE '%shyam%';`
-- and adjust before re-running.
UPDATE sellers SET invoice_prefix = 'sms' WHERE store_name = 'Shyam Medical';

-- ================================================================
-- 2. orders.invoice_number
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number_unique
  ON orders(invoice_number) WHERE invoice_number IS NOT NULL;

-- ================================================================
-- 3. invoice_counters — per seller-per-FY running number
-- ================================================================
CREATE TABLE IF NOT EXISTS invoice_counters (
  seller_id       UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  financial_year  TEXT NOT NULL,
  last_number     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (seller_id, financial_year)
);

-- ================================================================
-- 4. generate_invoice_number(p_order_id)
-- ================================================================
-- GUARD: is_active_superadmin() OR is_approved_admin() OR
-- current_user = 'postgres' OR the caller is the order's own customer
-- (users-bridge on orders.customer_id, same auth.uid()/auth.email()
-- pattern 015_rlsPhase5b.sql's RLS policies and 028's trigger both use).
-- The customer branch is there because this RPC is meant to be callable
-- at the point a customer views/downloads their own bill — not just by
-- staff — while still blocking a caller from generating (and burning a
-- counter slot on) someone else's order.
--
-- Idempotent: if orders.invoice_number is already set, returns the
-- existing value instead of incrementing the counter again — repeat
-- calls (e.g. re-opening the bill screen) never skip numbers.
--
-- Returns JSONB:
--   { success: false, message }                                — couldn't proceed
--   { success: true, invoice_number, already_existed: true }   — already had one
--   { success: true, invoice_number, already_existed: false }  — newly generated
CREATE OR REPLACE FUNCTION generate_invoice_number(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order      orders%ROWTYPE;
  v_prefix     TEXT;
  v_ist_ts     TIMESTAMP;
  v_fy_start   INTEGER;
  v_fy         TEXT;
  v_seq        INTEGER;
  v_invoice_no TEXT;
BEGIN
  -- Lock the order row first — closes the race between two concurrent
  -- calls for the SAME order (e.g. a double-click), same FOR UPDATE
  -- pattern used by every other order-mutating RPC in this project.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF NOT (
    is_active_superadmin() OR is_approved_admin() OR current_user = 'postgres'
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = v_order.customer_id AND (u.auth_id = auth.uid() OR u.email = auth.email())
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Aapko yeh chalane ka access nahi hai');
  END IF;

  IF v_order.invoice_number IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'invoice_number', v_order.invoice_number, 'already_existed', true);
  END IF;

  IF v_order.buyer_type = 'retailer' THEN
    RETURN jsonb_build_object('success', false, 'message', 'B2B orders ke liye invoice numbering abhi supported nahi hai');
  END IF;

  IF v_order.seller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order ko abhi koi seller assign nahi hai');
  END IF;

  SELECT invoice_prefix INTO v_prefix FROM sellers WHERE id = v_order.seller_id;
  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    v_prefix := lower(left(v_order.seller_id::TEXT, 3));
  END IF;

  -- FY boundary in IST calendar terms — same UTC->Asia/Kolkata
  -- conversion 027_routingCandidatesFn.sql uses for "today" — Apr-Mar.
  v_ist_ts := (v_order.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata';
  IF EXTRACT(MONTH FROM v_ist_ts) >= 4 THEN
    v_fy_start := EXTRACT(YEAR FROM v_ist_ts)::INTEGER;
  ELSE
    v_fy_start := EXTRACT(YEAR FROM v_ist_ts)::INTEGER - 1;
  END IF;
  v_fy := v_fy_start::TEXT || '-' || LPAD(((v_fy_start + 1) % 100)::TEXT, 2, '0');

  -- Atomic increment — ON CONFLICT locks the (seller_id, financial_year)
  -- row, so concurrent calls for the same seller+FY serialize here and
  -- cannot return the same last_number.
  INSERT INTO invoice_counters (seller_id, financial_year, last_number)
  VALUES (v_order.seller_id, v_fy, 1)
  ON CONFLICT (seller_id, financial_year)
  DO UPDATE SET last_number = invoice_counters.last_number + 1
  RETURNING last_number INTO v_seq;

  v_invoice_no := v_prefix || '/' || v_fy || '/' || LPAD(v_seq::TEXT, 5, '0');

  UPDATE orders SET invoice_number = v_invoice_no WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_no, 'already_existed', false);
END;
$$;

-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Columns exist:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE (table_name = 'sellers' AND column_name = 'invoice_prefix')
--      OR (table_name = 'orders'  AND column_name = 'invoice_number');

-- Shyam Medical seeded correctly (expect exactly 1 row, invoice_prefix='sms'):
-- SELECT id, store_name, invoice_prefix FROM sellers WHERE invoice_prefix IS NOT NULL;

-- Counter table + RPC registered:
-- SELECT * FROM invoice_counters;
-- SELECT proname, prosecdef, pronargs FROM pg_proc WHERE proname = 'generate_invoice_number';

-- Manual test (as postgres in SQL Editor, or as the order's own customer):
--   1. Pick a B2C pending/confirmed order with a seller assigned:
--      SELECT id, seller_id, buyer_type, created_at, invoice_number FROM orders
--        WHERE buyer_type IS DISTINCT FROM 'retailer' AND seller_id IS NOT NULL
--        ORDER BY created_at DESC LIMIT 1;
--   2. SELECT generate_invoice_number('<that order id>');
--      -> {success:true, invoice_number:'sms/2026-27/00001', already_existed:false}
--         if that order's seller is Shyam Medical and this is the first
--         invoice this FY; otherwise prefix/number will differ.
--   3. Call it again on the SAME order -> same invoice_number,
--      already_existed:true, invoice_counters.last_number unchanged
--      (no number burned on repeat calls).
--   4. Call it on a second order for the SAME seller, same FY ->
--      last_number in the invoice_number increments by exactly 1.
--   5. Call it on a B2B order (buyer_type='retailer') ->
--      {success:false, message mentions B2B not supported}.
--   6. As a different customer (not the order owner) and not
--      admin/superadmin -> {success:false, message:'Aapko yeh chalane
--      ka access nahi hai'}.
--   7. On a seller with invoice_prefix NULL -> invoice_number starts
--      with the first 3 chars of that seller's own id, e.g. 'a1b/2026-27/00001'.

-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS generate_invoice_number(UUID);
-- DROP TABLE IF EXISTS invoice_counters;
-- DROP INDEX IF EXISTS idx_orders_invoice_number_unique;
-- ALTER TABLE orders  DROP COLUMN IF EXISTS invoice_number;
-- ALTER TABLE sellers DROP COLUMN IF EXISTS invoice_prefix;
