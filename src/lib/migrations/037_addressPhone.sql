-- Migration 037: addresses me phone column (har address ka apna number)
-- Safe & non-blocking: nullable column.
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS phone VARCHAR(15);
