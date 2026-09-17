-- ══════════════════════════════════════════════════
-- MedSetu — URGENT fix: RLS infinite recursion on 'staff'
-- Already applied directly to the live DB (production-breaking bug,
-- review-first process skipped per explicit instruction). This file
-- documents exactly what was run, matching the live state.
-- ══════════════════════════════════════════════════
--
-- Bug: "infinite recursion detected in policy for relation 'staff'"
-- (Postgres code 42P17), breaking every query that touched orders/
-- sellers/staff RLS for a logged-in seller owner — including
-- SellerDashboard.jsx's own order fetch, unrelated to staff management.
--
-- Root cause: owner_view_staff (056_sellerStaffSimple.sql) did a raw
-- subquery from `staff` into `staff_assignment`:
--
--   CREATE POLICY "owner_view_staff" ON staff FOR SELECT TO authenticated
--   USING (EXISTS (SELECT 1 FROM staff_assignment sa JOIN sellers s ...));
--
-- Evaluating that subquery requires evaluating staff_assignment's OWN RLS
-- policies — which include the PRE-EXISTING staff_assignment_select_own
-- (from an earlier migration, untouched by 056):
--
--   CREATE POLICY "staff_assignment_select_own" ON staff_assignment ...
--   USING (EXISTS (SELECT 1 FROM staff s WHERE s.id = staff_assignment.staff_id
--                  AND s.email = auth.email()));
--
-- — which queries `staff` again, re-triggering staff's RLS, landing back
-- on owner_view_staff. staff -> staff_assignment -> staff -> ... forever.
-- Confirmed via `SELECT tablename, policyname, qual FROM pg_policies
-- WHERE tablename IN ('staff','staff_assignment')` before touching anything.
--
-- owner_view_staff_assignment (also from 056) was checked and is NOT part
-- of any cycle — its subquery only touches sellers/users, and users'
-- policies (users_select_own_or_staff etc.) don't reference staff or
-- staff_assignment at all. No change needed there.
--
-- Fix: same pattern already used everywhere else in this schema for
-- cross-table RLS checks (is_seller_staff(), current_staff_wholesaler_id(),
-- resolve_seller_user_id(), etc.) — wrap the check in a SECURITY DEFINER
-- function. Such a function executes under its owner's privileges, which
-- bypasses RLS entirely for its internal queries, so calling it from
-- owner_view_staff no longer re-triggers staff_assignment's RLS at all.
-- That removes the staff -> staff_assignment edge; the remaining
-- staff_assignment -> staff edge alone is harmless (a cycle needs both
-- directions), so staff_assignment_select_own is left exactly as-is.

CREATE OR REPLACE FUNCTION public.is_seller_owner_of_staff(p_staff_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_assignment sa
    JOIN sellers s ON s.id = sa.seller_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE sa.staff_id = p_staff_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR s.email = auth.email())
  );
$$;

DROP POLICY IF EXISTS "owner_view_staff" ON staff;
CREATE POLICY "owner_view_staff" ON staff
FOR SELECT TO authenticated
USING (is_seller_owner_of_staff(staff.id));

-- staff_select_own (pre-existing, untouched) already covers "a staff
-- member can see their own row" — no need to duplicate that check here.


-- ================================================================
-- VERIFY — already run against the live DB after applying
-- ================================================================

-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'is_seller_owner_of_staff';
--   -- expect: 1 row, prosecdef = t

-- SELECT policyname, qual FROM pg_policies WHERE tablename = 'staff' AND policyname = 'owner_view_staff';
--   -- expect: USING clause now reads is_seller_owner_of_staff(staff.id),
--   -- no raw subquery into staff_assignment

-- Simulated authenticated session (not the postgres superuser, which
-- bypasses RLS and would pass either way) as a real seller owner
-- (sarthakmedical119@gmail.com / seller b209fcbe-9af3-4f46-8f16-71221108025a):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '{"email":"sarthakmedical119@gmail.com"}', true);
--   SELECT count(*) FROM staff_assignment WHERE seller_id = 'b209fcbe-9af3-4f46-8f16-71221108025a'; -- 0, no error
--   SELECT count(*) FROM staff;                                                                     -- 0, no error
--   SELECT count(*) FROM orders WHERE seller_id = 'b209fcbe-9af3-4f46-8f16-71221108025a';             -- 7, no error
--   RESET ROLE;
--   COMMIT;
-- All three ran clean — confirmed fixed under an actual RLS-evaluated
-- session, not just a superuser bypass.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- Not recommended — this would reintroduce the recursion bug. If ever
-- needed: DROP POLICY IF EXISTS "owner_view_staff" ON staff; then
-- re-create it with 056_sellerStaffSimple.sql's original raw-subquery
-- version, and DROP FUNCTION IF EXISTS is_seller_owner_of_staff(uuid);
