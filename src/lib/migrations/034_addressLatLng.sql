-- Migration 034: address lat/lng (R6-B1)
-- Safe & non-blocking: nullable columns.
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION;
