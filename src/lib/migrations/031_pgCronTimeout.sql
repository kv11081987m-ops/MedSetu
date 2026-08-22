-- ══════════════════════════════════════════════════
-- MedSetu — R2-D2: pg_cron schedule (routing timeout automatic)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════
--
-- Scope: DB only, scheduling. process_expired_routing() (030) already
-- exists and already has a current_user='postgres' guard branch built
-- specifically for this — pg_cron jobs run as the role that scheduled
-- them (postgres, via the SQL Editor), so no guard change needed here.
--
-- Depends on: 030_timeoutReassign.sql (process_expired_routing()).
--
-- Why direct RPC call, no edge-function/HTTP hop: pg_cron runs inside
-- the same Postgres instance, so `SELECT process_expired_routing();`
-- is a plain in-process call — no network round-trip, no separate
-- deploy, no extra failure mode to monitor.
--
-- Why every 5 minutes: routing_timeout_minutes defaults to 15 (025) —
-- checking every 5 min catches an expired order within at most 5 min
-- of it expiring, well inside that window.
--
-- Idempotency: cron.schedule() with an existing job NAME does not
-- update it in place, and re-scheduling under the same name can leave
-- a stray/duplicate entry depending on version — while cron.unschedule()
-- errors on a name that isn't registered yet. Fix: unschedule the job
-- first IF IT EXISTS (guarded with an EXISTS check against cron.job),
-- then schedule fresh. Safe to run this whole file as many times as
-- needed — clean slate or re-apply, same result.

-- ================================================================
-- 1. Enable pg_cron
-- ================================================================
-- Creates the `cron` schema (cron.job, cron.job_run_details, etc.) —
-- confirmed available on this project's Postgres (pg_cron v1.6.4).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ================================================================
-- 2. Schedule routing-timeout-check (idempotent)
-- ================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'routing-timeout-check') THEN
    PERFORM cron.unschedule('routing-timeout-check');
  END IF;
END $$;

SELECT cron.schedule(
  'routing-timeout-check',
  '*/5 * * * *',
  'SELECT process_expired_routing();'
);

-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Job registered, schedule/command correct:
-- SELECT jobid, jobname, schedule, command, active FROM cron.job WHERE jobname = 'routing-timeout-check';

-- After waiting ~5-10 min, confirm it actually ran:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
--   -> status should be 'succeeded'; return_message shows
--      process_expired_routing()'s JSONB result (processed/reassigned/
--      exhausted, or disabled:true if routing_auto_reassign is off).

-- ================================================================
-- ROLLBACK
-- ================================================================
-- Removes only the job, not the extension — pg_cron may back other
-- scheduled jobs in future; dropping the extension would wipe all of
-- them plus the cron.job_run_details history.

-- SELECT cron.unschedule('routing-timeout-check');
