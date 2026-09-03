-- ══════════════════════════════════════════════════
-- MedSetu — Pharmacist Rx-gate: RLS / storage policy changes
-- 045_pharmacistGate.sql ke saath jodne wale policy edits jo LIVE DB me
-- manually (ALTER / DROP+CREATE POLICY se) lag chuke the par ab tak kisi
-- migration me record nahi the. Ye file repo = live parity ke liye.
--
-- PART 1 (orders_insert_own) & PART 2 (rx_select_customer_seller_admin)
-- dono ki definition LIVE se pg_get_expr(polwithcheck/polqual, ...) se
-- VERIFIED (Sep 3) — neeche exact match hai (sirf whitespace/newline
-- readability ke liye, semantics byte-for-byte).
--
-- Run this in Supabase SQL Editor (045 ke baad). Idempotent — DROP + CREATE.
--
-- Depends on:
--   • 015_rlsPhase5b.sql       — orders_insert_own ka base
--   • 014_rlsPhase5a.sql       — is_approved_pharmacist(), is_active_superadmin()
--   • 045_pharmacistGate.sql   — 'awaiting_pharmacist' status
--
-- NOTE — role binding (polroles): is dump me sirf expression tha, role list
--   nahi. 015 apni policies me koi explicit `TO` clause nahi likhta
--   (= TO public); yahan bhi wahi rakha — har branch ke andar
--   auth.uid()/auth.email() check hi gate karta hai, to effect TO
--   authenticated ke barabar. Agar strict parity chahiye:
--     SELECT polname, polroles::regrole[] FROM pg_policy
--       WHERE polname IN ('orders_insert_own','rx_select_customer_seller_admin');
--   '{authenticated}' aaye to neeche dono CREATE me `TO authenticated` add
--   kar dena.
-- ══════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════
-- PART 1 — orders_insert_own (orders)
-- status 'pending' -> ('pending' | 'awaiting_pharmacist')
-- ════════════════════════════════════════════════════════════════
-- Kyun: Rx-gated order Checkout se ab status='awaiting_pharmacist' ke saath
-- insert hota hai (Chunk 2). 015 ki WITH CHECK me `status = 'pending'`
-- hard-pinned tha -> gated insert RLS 42501 se block. Ab dono values allow.
-- Customer / retailer-buyer branches 015 se unchanged.
--
-- Live pg_get_expr(polwithcheck, 'orders'::regclass) se exact:
--   ((auth.uid() IS NOT NULL)
--    AND ((status)::text = ANY (ARRAY['pending'::text, 'awaiting_pharmacist'::text]))
--    AND (((customer_id IS NOT NULL) AND (EXISTS (...users...)))
--         OR ((buyer_type = 'retailer') AND (buyer_id IS NOT NULL) AND (EXISTS (...sellers JOIN users...)))))

DROP POLICY IF EXISTS "orders_insert_own" ON orders;

CREATE POLICY "orders_insert_own"
  ON orders FOR INSERT
  WITH CHECK (
    (auth.uid() IS NOT NULL)
    AND ((status)::text = ANY (ARRAY['pending'::text, 'awaiting_pharmacist'::text]))
    AND (
      (
        (customer_id IS NOT NULL) AND (EXISTS (
          SELECT 1
          FROM users u
          WHERE ((u.id = orders.customer_id) AND ((u.auth_id = auth.uid()) OR ((u.email)::text = auth.email())))
        ))
      )
      OR
      (
        (buyer_type = 'retailer'::text) AND (buyer_id IS NOT NULL) AND (EXISTS (
          SELECT 1
          FROM (sellers s JOIN users u ON ((u.id = s.user_id)))
          WHERE ((s.id = orders.buyer_id) AND ((u.auth_id = auth.uid()) OR ((u.email)::text = auth.email())))
        ))
      )
    )
  );


-- ════════════════════════════════════════════════════════════════
-- PART 2 — rx_select_customer_seller_admin (storage.objects)
-- naya "approved pharmacist" branch (sirf order-linked objects)
-- ════════════════════════════════════════════════════════════════
-- Kyun: PharmacistPanel gated order ki prescription image kholta hai
-- (getSignedRxUrl -> storage.objects SELECT, bucket 'prescriptions').
-- Approved pharmacist ko sirf UN objects ka SELECT milna chahiye jinka path
-- kisi order ki prescription_url se match karta ho (blanket bucket access
-- nahi). Live USING me ek OR branch add hua:
--   OR (is_approved_pharmacist()
--       AND EXISTS (SELECT 1 FROM orders o WHERE o.prescription_url = objects.name))
--
-- Live pg_get_expr(polqual, 'storage.objects'::regclass) se exact:
--   ((bucket_id = 'prescriptions')
--    AND ((EXISTS (users u: u.auth_id=auth.uid() AND (u.id)::text = (storage.foldername(objects.name))[1]))
--         OR (EXISTS (orders o JOIN sellers s ON s.id=o.seller_id JOIN users u ON u.id=s.user_id
--                     WHERE o.prescription_url = objects.name AND (u.auth_id=auth.uid() OR (u.email)::text=auth.email())))
--         OR is_active_superadmin()
--         OR (is_approved_pharmacist() AND (EXISTS (orders o WHERE o.prescription_url = objects.name)))))
--
-- NOTE: is policy ki definition pehle repo me KAHIN nahi thi (storage
-- policies migrations me kabhi record nahi hue). Ab yahan hai — SELECT-only,
-- bucket 'prescriptions'. `objects.name` qualifier waisा hi jaisा
-- pg_get_expr ne diya (policy expression ke andar relation alias 'objects').

DROP POLICY IF EXISTS "rx_select_customer_seller_admin" ON storage.objects;

CREATE POLICY "rx_select_customer_seller_admin"
  ON storage.objects FOR SELECT
  USING (
    (bucket_id = 'prescriptions'::text)
    AND (
      -- (a) customer: apni hi rx — object path ka pehla folder = uski users.id
      (EXISTS (
        SELECT 1
        FROM users u
        WHERE ((u.auth_id = auth.uid()) AND ((u.id)::text = (storage.foldername(objects.name))[1]))
      ))
      -- (b) seller: jis order ki ye prescription hai wo order us seller ka ho
      OR (EXISTS (
        SELECT 1
        FROM ((orders o JOIN sellers s ON ((s.id = o.seller_id))) JOIN users u ON ((u.id = s.user_id)))
        WHERE ((o.prescription_url = objects.name) AND ((u.auth_id = auth.uid()) OR ((u.email)::text = auth.email())))
      ))
      -- (c) superadmin
      OR is_active_superadmin()
      -- (d) NAYA: approved pharmacist, sirf kisi order se linked object
      OR (is_approved_pharmacist() AND (EXISTS (
        SELECT 1
        FROM orders o
        WHERE (o.prescription_url = objects.name)
      )))
    )
  );


-- ================================================================
-- VERIFY — apply ke baad
-- ================================================================
-- 1. orders_insert_own — nayi WITH CHECK me dono status:
--   SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
--     WHERE polrelid = 'orders'::regclass AND polname = 'orders_insert_own';
--   -- ARRAY['pending'::text, 'awaiting_pharmacist'::text] dikhna chahiye
--
-- 2. rx_select_customer_seller_admin — pharmacist branch:
--   SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--     WHERE polrelid = 'storage.objects'::regclass
--       AND polname = 'rx_select_customer_seller_admin';
--   -- is_approved_pharmacist() + (o.prescription_url = objects.name) dikhna chahiye
--
-- 3. Smoke (customer session): Rx-gated order place karo
--    (status 'awaiting_pharmacist') -> insert PASS (pehle 42501 milta).
-- 4. Smoke: non-gated order abhi bhi place hota hai (status 'pending').
-- 5. Smoke (pharmacist session): gated order ka "Rx Dekho" -> signed URL
--    khulti hai. Koi random object jo kisi order se linked nahi -> pharmacist
--    ko SELECT NAHI milna chahiye.


-- ================================================================
-- ROLLBACK
-- ================================================================
-- PART 1 — 015 wali (sirf status = 'pending'):
--   DROP POLICY IF EXISTS "orders_insert_own" ON orders;
--   -- phir 015_rlsPhase5b.sql:58-73 wali CREATE POLICY dobara chalao.
--
-- PART 2 — pharmacist branch hatao (baaki branches rakho):
--   DROP POLICY IF EXISTS "rx_select_customer_seller_admin" ON storage.objects;
--   -- phir upar wali CREATE POLICY me se sirf branch (d)
--   -- "OR (is_approved_pharmacist() AND ...)" nikaal ke dobara chalao.
-- ================================================================
