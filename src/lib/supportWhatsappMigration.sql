-- ══════════════════════════════════════════════════
-- MedSetu — Support WhatsApp number in platform_settings
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS support_whatsapp TEXT;

UPDATE platform_settings
  SET support_whatsapp = '919196103234'
  WHERE id = 1;
