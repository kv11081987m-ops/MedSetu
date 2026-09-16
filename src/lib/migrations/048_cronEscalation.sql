-- ══════════════════════════════════════════════════
-- MedSetu — needs_admin queue: daily reminder cron
-- Root cause found in a read-only investigation of a Sep-3 "zombie"
-- order stuck in routing_status='needs_admin' for 12 days: the existing
-- exhaustion notify loop (advance_order_routing / process_expired_routing,
-- 016/028) fires
--   FOR v_admin IN SELECT email FROM staff_whitelist WHERE role = 'admin' AND is_approved = true LOOP
-- — and staff_whitelist currently has ZERO rows matching that filter
-- (confirmed live: `SELECT count(*) FROM staff_whitelist WHERE role='admin' AND is_approved=true` = 0).
-- So the loop body never runs — nobody gets notified when an order first
-- exhausts into needs_admin. The one real active admin account lives in
-- `super_admins` instead (confirmed: 1 active row there), which is why
-- this job targets that table, not staff_whitelist.
--
-- This is a SEPARATE, additive safety net — a DAILY reminder for any
-- order still sitting in needs_admin+pending 24h+ after creation, not a
-- fix to the original one-shot notify (that gap is still open; this
-- just means a stuck order won't go unnoticed indefinitely once someone
-- checks their notifications).
--
-- ⚠️ DEVIATION from the draft: the admin subquery had `LIMIT 1` — with
-- only 1 active super_admin today that's harmless, but it's a latent
-- bug (a 2nd super_admin added later would be picked non-deterministically,
-- possibly never notified). Removed LIMIT 1 so the CROSS JOIN naturally
-- fans out one notification row per active super_admin per stuck order.
--
-- Depends on: orders, users, super_admins, notifications (001_schema.sql),
-- pg_cron extension (already installed, v1.6.4 — confirmed live), the
-- existing cron.job 'process_expired_routing' (jobid 1) it runs alongside.
-- Run this in Supabase SQL Editor.
-- ══════════════════════════════════════════════════

SELECT cron.schedule(
  'remind_needs_admin_daily',
  '0 9 * * *',
  $$
  INSERT INTO notifications (user_id, title, body, type, ref_id)
  SELECT
    u.id as user_id,
    '⚠️ Order Assignment Pending',
    o.order_number || ' — ' ||
    FLOOR(EXTRACT(EPOCH FROM (now() - o.created_at))/3600)::text ||
    ' ghante se unassigned hai',
    'needs_admin_reminder',
    o.id
  FROM orders o
  CROSS JOIN (
    SELECT u.id
    FROM super_admins sa
    JOIN users u ON u.email = sa.email
    WHERE sa.is_active = true
  ) u
  WHERE o.routing_status = 'needs_admin'
  AND o.status = 'pending'
  AND o.created_at < now() - interval '24 hours';
  $$
);

-- ================================================================
-- VERIFY — run after applying
-- ================================================================
-- Job registered:
--   SELECT jobid, schedule, command, jobname FROM cron.job
--     WHERE jobname = 'remind_needs_admin_daily';
--   -- expect: schedule = '0 9 * * *'
--
-- Manual dry-run of the job body right now (doesn't wait for 9am) —
-- run the INSERT...SELECT block above directly; if there's currently a
-- stuck order (routing_status='needs_admin', status='pending', 24h+ old)
-- and an active super_admin, a new notifications row should appear:
--   SELECT * FROM notifications WHERE type = 'needs_admin_reminder'
--     ORDER BY created_at DESC LIMIT 5;

-- ================================================================
-- ROLLBACK
-- ================================================================
-- SELECT cron.unschedule('remind_needs_admin_daily');
-- ================================================================
