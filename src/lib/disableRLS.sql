-- ================================================================
-- MedSetu — RLS Disable (Development Only)
-- ================================================================
-- Yeh sirf development ke liye hai.
-- Production mein deploy karne se pehle
-- src/lib/enableRLS.sql chalana mat bhoolo.
-- ================================================================

ALTER TABLE users             DISABLE ROW LEVEL SECURITY;
ALTER TABLE addresses         DISABLE ROW LEVEL SECURITY;
ALTER TABLE sellers           DISABLE ROW LEVEL SECURITY;
ALTER TABLE medicines         DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders            DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_items       DISABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacist_calls  DISABLE ROW LEVEL SECURITY;
ALTER TABLE disputes          DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     DISABLE ROW LEVEL SECURITY;

-- Note: 'reviews' table schema mein nahi hai abhi.
-- Agar baad mein banao to yahan add karna:
-- ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;
