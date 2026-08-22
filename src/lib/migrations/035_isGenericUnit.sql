-- Migration 035: is_generic + unit columns (record-keeping)
-- Ye columns live DB mein pehle se hain (out-of-band SQL editor se).
-- Ye file sirf schema history poori karne ke liye.
-- IF NOT EXISTS ki wajah se safe.
ALTER TABLE master_medicines
  ADD COLUMN IF NOT EXISTS is_generic BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
