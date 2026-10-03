-- ════════════════════════════════════════════════════════════════
-- 083_APPLY.sql — 083_serviceHoursScheduledOrders.sql ko ASLI chalane ke liye
-- (koi test nahi). SQL Editor mein poori file ek saath chalao.
-- Pehle 083_DRYRUN.sql chala kar tests dekh lo; ye file COMMIT karti hai.
-- ⚠️ Apply ke baad har seller ke default hours (Mon-Sat 09-21, Sun band) lag
-- jaate hain; sirf Sarthak ke explicit set kiye gaye hain (neeche UPDATE).
-- ════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ================================================================
-- 083 migration — poora body (083_serviceHoursScheduledOrders.sql se, fixed)
-- ================================================================
-- ══════════════════════════════════════════════════
-- MedSetu — 083 (v2): Per-seller weekly hours + next-day (scheduled) orders
-- Run this in Supabase SQL Editor (NOT yet applied anywhere)
-- ══════════════════════════════════════════════════
--
-- Design: samay har seller ke apne hain (sellers.weekly_hours), platform-wide
-- nahi. Timezone hamesha Asia/Kolkata. Ek seller "accepting" tab hai jab
-- is_open = true (manual master switch) AND abhi (IST) ka samay aaj ke
-- weekly_hours window ke andar ho. Ye logic SIRF seller_accepting_at() mein
-- hai; baaki sab (routing, is_any_seller_open, release) usi ko call karte hain.
--
-- Non-Rx home delivery par jab koi seller accepting nahi, customer
-- "agle samay ke liye" order kar sakta hai: seller_id NULL, status
-- 'pending', routing_status 'scheduled', scheduled_for = next_service_open_time().
-- release_scheduled_orders() (pg_cron, 5 min) use route kar deta hai.
--
-- Depends on: 025 (routing columns), 079 D (get_routing_candidates body —
-- only the is_open condition is replaced), 028 (app.routing_trusted),
-- 045b (approve_rx_order — assignment pattern), 049 (superadmin notify),
-- 031 (pg_cron), 078 1B (sellers column-level SELECT grant).
--
-- ⚠️ BEHAVIOUR CHANGE ON APPLY: every existing seller gets the default
-- hours (Mon-Sat 09:00-21:00, Sunday closed) and so STOPS receiving routed
-- orders outside them. Update sellers whose real hours differ right after
-- applying (SellerDashboard → "Dukaan ke samay", or SQL, see VERIFY).
-- Existing triggers (price validation, Rx gate, protect_order_sensitive_
-- columns, protect_seller_trust_columns) are NOT touched.

-- ================================================================
-- 1. sellers.weekly_hours
-- ================================================================
-- {"mon":{"open":"09:00","close":"21:00"}, ..., "sun":null}  (null = band)
-- Window must not cross midnight (open < close, 'HH:MM').
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS weekly_hours JSONB NOT NULL DEFAULT '{
  "mon":{"open":"09:00","close":"21:00"},
  "tue":{"open":"09:00","close":"21:00"},
  "wed":{"open":"09:00","close":"21:00"},
  "thu":{"open":"09:00","close":"21:00"},
  "fri":{"open":"09:00","close":"21:00"},
  "sat":{"open":"09:00","close":"21:00"},
  "sun":null
}'::jsonb;

-- A malformed value would otherwise raise inside get_routing_candidates for
-- EVERY order — so reject it at write time.
CREATE OR REPLACE FUNCTION weekly_hours_is_valid(h JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(h) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) AS k
       WHERE NOT (h ? k)
          OR (
            jsonb_typeof(h -> k) <> 'null'
            AND NOT (
              jsonb_typeof(h -> k) = 'object'
              AND (h -> k ->> 'open')  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              AND (h -> k ->> 'close') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              AND (h -> k ->> 'open') < (h -> k ->> 'close')
            )
          )
     );
$$;

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_weekly_hours_valid;
ALTER TABLE sellers ADD CONSTRAINT sellers_weekly_hours_valid
  CHECK (weekly_hours_is_valid(weekly_hours));

-- 078 1B made sellers column-level readable for authenticated. A seller's
-- own dashboard reads the row via my_seller_profile() (SECURITY DEFINER,
-- s.* — picks the column up automatically); this grant only matters for
-- direct selects. UPDATE is NOT column-restricted (sellers_update_owner_or_
-- staff RLS + protect_seller_trust_columns don't touch weekly_hours), so the
-- owner's save works as-is. anon has no sellers SELECT and gets none here.
GRANT SELECT (weekly_hours) ON sellers TO authenticated;

-- ================================================================
-- 2. Availability helpers — the ONE place the rule lives
-- ================================================================
-- seller_accepting_at(is_open, weekly_hours, at): true iff is_open AND `at`
-- (converted to IST) falls in that weekday's [open, close) window.
-- NULL weekly_hours = no hour restriction (only is_open counts).
CREATE OR REPLACE FUNCTION seller_accepting_at(
  p_is_open BOOLEAN, p_hours JSONB, p_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_local TIMESTAMP := p_at AT TIME ZONE 'Asia/Kolkata';
  v_h     JSONB;
BEGIN
  IF p_is_open IS NOT TRUE THEN RETURN false; END IF;
  IF p_hours IS NULL THEN RETURN true; END IF;
  v_h := p_hours -> (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[EXTRACT(DOW FROM v_local)::int + 1];
  IF v_h IS NULL OR jsonb_typeof(v_h) <> 'object' THEN RETURN false; END IF;
  RETURN v_local::time >= (v_h ->> 'open')::time
     AND v_local::time <  (v_h ->> 'close')::time;
END;
$$;

-- Row version used by queries: seller_is_accepting(s)
CREATE OR REPLACE FUNCTION seller_is_accepting(p_seller sellers)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT seller_accepting_at(p_seller.is_open, p_seller.weekly_hours, NOW());
$$;

-- Earliest instant >= p_from at which this weekly_hours is open (ignores
-- is_open). NULL hours = open right away. NULL if never open in 8 days.
CREATE OR REPLACE FUNCTION seller_next_open_at(p_hours JSONB, p_from TIMESTAMPTZ DEFAULT NOW())
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_local TIMESTAMP := p_from AT TIME ZONE 'Asia/Kolkata';
  v_day   DATE;
  v_h     JSONB;
  d       INTEGER;
BEGIN
  IF p_hours IS NULL THEN RETURN p_from; END IF;
  FOR d IN 0..7 LOOP
    v_day := v_local::date + d;
    v_h   := p_hours -> (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[EXTRACT(DOW FROM v_day)::int + 1];
    IF v_h IS NULL OR jsonb_typeof(v_h) <> 'object' THEN CONTINUE; END IF;
    IF d = 0 THEN
      IF v_local::time >= (v_h ->> 'close')::time THEN CONTINUE; END IF;      -- aaj band ho chuka
      IF v_local::time >= (v_h ->> 'open')::time  THEN RETURN p_from; END IF; -- abhi khula hai
    END IF;
    RETURN (v_day + (v_h ->> 'open')::time) AT TIME ZONE 'Asia/Kolkata';
  END LOOP;
  RETURN NULL;
END;
$$;

-- Internal helpers: not callable from the API roles (the SECURITY DEFINER
-- functions below call them as owner).
REVOKE ALL ON FUNCTION seller_accepting_at(BOOLEAN, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seller_is_accepting(sellers)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seller_next_open_at(JSONB, TIMESTAMPTZ)          FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 3. get_routing_candidates — ONLY the is_open condition replaced
-- ================================================================
-- Body = 079 section D (latest in repo), one line changed:
--   AND s.is_open = true   →   AND seller_is_accepting(s)
-- ⚠️ Before applying, diff against the live body:
--   SELECT pg_get_functiondef('public.get_routing_candidates(text)'::regprocedure);
-- If live differs from 079 D, re-base this on live, change only that line.
CREATE OR REPLACE FUNCTION public.get_routing_candidates(p_pincode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_serviceable BOOLEAN;
  v_candidates  JSONB;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM serviceable_pincodes
    WHERE pincode = p_pincode AND is_active = true
  ) INTO v_serviceable;

  IF NOT v_serviceable THEN
    RETURN jsonb_build_object('serviceable', false, 'candidates', '[]'::jsonb);
  END IF;

  WITH weighted AS (
    SELECT
      s.id                                                  AS seller_id,
      s.store_name,
      s.routing_weight                                      AS weight,
      s.routing_weight::numeric / SUM(s.routing_weight) OVER () AS target_share
    FROM sellers s
    WHERE s.seller_type = 'retailer'
      AND s.routing_weight > 0
      AND seller_is_accepting(s)   -- 083: is_open AND inside today's weekly_hours (IST)
  ),
  today_orders AS (
    SELECT o.seller_id, COUNT(*) AS today_count
    FROM orders o
    WHERE o.seller_id IS NOT NULL
      AND ((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
          = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    GROUP BY o.seller_id
  ),
  scored AS (
    SELECT
      w.seller_id,
      w.store_name,
      w.weight,
      COALESCE(t.today_count, 0)                             AS today_count,
      w.target_share,
      COALESCE(t.today_count, 0) / w.target_share             AS priority_score
    FROM weighted w
    LEFT JOIN today_orders t ON t.seller_id = w.seller_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'seller_id',      sc.seller_id,
      'store_name',     sc.store_name,
      'weight',         sc.weight,
      'today_count',    sc.today_count,
      'target_share',   ROUND(sc.target_share, 6),
      'priority_score', ROUND(sc.priority_score, 6)
    )
    ORDER BY sc.priority_score ASC, sc.weight DESC, sc.seller_id ASC
  )
  INTO v_candidates
  FROM scored sc;

  RETURN jsonb_build_object('serviceable', true, 'candidates', COALESCE(v_candidates, '[]'::jsonb));
END;
$function$;

-- ================================================================
-- 4. orders.scheduled_for
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_scheduled_release
  ON orders (scheduled_for) WHERE routing_status = 'scheduled';

-- ================================================================
-- 5. Customer-safe RPCs (boolean / timestamp only, no seller data)
-- ================================================================
-- Same eligibility as get_routing_candidates: retailer, routing_weight>0,
-- and seller_is_accepting().
CREATE OR REPLACE FUNCTION public.is_any_seller_open()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM sellers s
    WHERE s.seller_type = 'retailer'
      AND s.routing_weight > 0
      AND seller_is_accepting(s)
  );
$function$;

REVOKE ALL ON FUNCTION public.is_any_seller_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_any_seller_open() TO anon, authenticated;

-- Earliest moment any eligible seller is (or becomes) open.
--   • Some eligible seller has is_open = true: NOW() if one is accepting
--     already, else the soonest weekly_hours opening (Sunday closed →
--     Monday's).
--   • NO eligible seller has is_open = true (everyone switched off): the
--     switch means "aaj nahi", so the answer must NOT be "abhi" even if
--     weekly_hours say open right now. Their weekly_hours are searched from
--     TOMORROW 00:00 IST (rest of today skipped) — Saturday evening →
--     Monday 09:00 when Sunday is closed.
-- Eligible = retailer, routing_weight>0. NULL only if no seller has any
-- opening in the 8-day window.
CREATE OR REPLACE FUNCTION public.next_service_open_time()
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now      TIMESTAMPTZ := NOW();
  v_from     TIMESTAMPTZ;
  v_any_open BOOLEAN;
  v_best     TIMESTAMPTZ;
  v_cand     TIMESTAMPTZ;
  r          RECORD;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM sellers s
    WHERE s.seller_type = 'retailer' AND s.routing_weight > 0 AND s.is_open = true
  ) INTO v_any_open;

  IF v_any_open THEN
    v_from := v_now;
  ELSE
    -- everyone switched off: skip the rest of today, start at tomorrow 00:00 IST
    v_from := ((v_now AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
  END IF;

  FOR r IN
    SELECT s.weekly_hours FROM sellers s
    WHERE s.seller_type = 'retailer' AND s.routing_weight > 0
      AND (NOT v_any_open OR s.is_open = true)
  LOOP
    v_cand := seller_next_open_at(r.weekly_hours, v_from);
    IF v_cand IS NOT NULL AND (v_best IS NULL OR v_cand < v_best) THEN
      v_best := v_cand;
    END IF;
  END LOOP;

  RETURN v_best;
END;
$function$;

REVOKE ALL ON FUNCTION public.next_service_open_time() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_service_open_time() TO anon, authenticated;

-- ================================================================
-- 6. Scheduled order creation — BEFORE INSERT normaliser
-- ================================================================
-- Checkout reuses the normal insert path (orders.js createOrder); client
-- only sends routing_status='scheduled'. scheduled_for is NEVER taken from
-- the client — it is next_service_open_time() (fallback: next 09:00 IST if
-- no seller has any hours). B2C home delivery + status 'pending' only,
-- otherwise the flag is stripped. Scheduled orders get seller_id/assigned_at/
-- routing_expires_at forced NULL; non-scheduled rows get scheduled_for NULL.
CREATE OR REPLACE FUNCTION normalize_scheduled_order()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_when TIMESTAMPTZ;
BEGIN
  IF NEW.routing_status IS DISTINCT FROM 'scheduled' THEN
    NEW.scheduled_for := NULL;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.buyer_type, 'customer') <> 'customer'
     OR NEW.status IS DISTINCT FROM 'pending'
     OR NEW.delivery_pincode IS NULL THEN
    NEW.routing_status := NULL;
    NEW.scheduled_for  := NULL;
    RETURN NEW;
  END IF;

  v_when := next_service_open_time();
  IF v_when IS NULL THEN
    v_when := ((((NOW() AT TIME ZONE 'Asia/Kolkata')::date + 1) + TIME '09:00')
               AT TIME ZONE 'Asia/Kolkata');
  END IF;

  NEW.scheduled_for      := v_when;
  NEW.seller_id          := NULL;
  NEW.assigned_at        := NULL;
  NEW.routing_expires_at := NULL;
  NEW.routing_attempt    := 0;
  NEW.routing_history    := jsonb_build_array(jsonb_build_object(
                              'result', 'scheduled',
                              'scheduled_for', v_when,
                              'at', NOW()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_scheduled_order ON orders;
CREATE TRIGGER trg_normalize_scheduled_order
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION normalize_scheduled_order();

-- ================================================================
-- 7. release_scheduled_orders()
-- ================================================================
-- Guard: same as process_expired_routing (030) — admin/superadmin ya
-- direct postgres (pg_cron). PostgREST anon/authenticated nahi chala sakte.
--
-- Har due order (routing_status='scheduled', status='pending',
-- seller_id IS NULL, scheduled_for <= NOW()):
--   a) agar is_any_seller_open() (hours-aware) aur get_routing_candidates
--      (hours-aware) se candidate mila → approve_rx_order jaisa assignment:
--      seller_id, assigned_at, routing_expires_at (routing_timeout_minutes),
--      routing_attempt+1, assigned_by='auto', routing_status=NULL, history
--      entry, order_items.commission_band backfill, seller notification.
--      Iske baad normal routing/process_expired_routing sambhalta hai.
--   b) warna agar scheduled_for + 60 min nikal chuka → routing_status=
--      'needs_admin' + admin/superadmin notification (049 jaisa).
--   c) warna chhod do — agla 5-min run dobara try karega.
-- Returns {success, processed, released, escalated, waiting}.
CREATE OR REPLACE FUNCTION release_scheduled_orders()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_timeout_min INTEGER;
  v_open        BOOLEAN;
  v_candidates  JSONB;
  v_next        JSONB;
  v_now         TIMESTAMP := NOW();
  v_new_uid     UUID;
  v_admin       RECORD;
  v_admin_uid   UUID;
  v_processed   INTEGER := 0;
  v_released    INTEGER := 0;
  v_escalated   INTEGER := 0;
  v_waiting     INTEGER := 0;
BEGIN
  IF NOT (is_active_superadmin() OR is_approved_admin() OR current_user = 'postgres') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Aapko yeh chalane ka access nahi hai');
  END IF;

  SELECT COALESCE(routing_timeout_minutes, 15) INTO v_timeout_min
    FROM platform_settings WHERE id = 1;
  v_timeout_min := COALESCE(v_timeout_min, 15);

  v_open := is_any_seller_open();

  -- Same trust flag as approve_rx_order / process_expired_routing, so
  -- protect_order_sensitive_columns() lets these UPDATEs through.
  PERFORM set_config('app.routing_trusted', 'true', true);

  FOR v_order IN
    SELECT * FROM orders
    WHERE routing_status = 'scheduled'
      AND status = 'pending'
      AND seller_id IS NULL
      AND scheduled_for <= NOW()
    ORDER BY scheduled_for
    FOR UPDATE SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;
    v_next := NULL;

    IF v_open AND v_order.delivery_pincode IS NOT NULL THEN
      v_candidates := (get_routing_candidates(v_order.delivery_pincode))->'candidates';
      SELECT elem INTO v_next
      FROM jsonb_array_elements(COALESCE(v_candidates, '[]'::jsonb)) elem
      LIMIT 1;
    END IF;

    IF v_next IS NOT NULL THEN
      UPDATE orders SET
        seller_id          = (v_next->>'seller_id')::UUID,
        assigned_at        = v_now,
        routing_expires_at = v_now + (v_timeout_min || ' minutes')::INTERVAL,
        routing_attempt    = COALESCE(v_order.routing_attempt, 0) + 1,
        assigned_by        = 'auto',
        routing_status     = NULL,
        routing_history    = COALESCE(v_order.routing_history, '[]'::jsonb)
                              || jsonb_build_array(jsonb_build_object(
                                   'seller_id', (v_next->>'seller_id')::UUID,
                                   'result',    'assigned',
                                   'via',       'scheduled_release',
                                   'at',        v_now
                                 ))
      WHERE id = v_order.id;

      -- Commission-band snapshot: scheduled order seller-less bana tha, to
      -- createOrderItems ne band lookup skip kiya (same as Rx-gated path).
      UPDATE order_items oi
      SET commission_band = mm.commission_band
      FROM seller_inventory si
      JOIN master_medicines mm ON mm.id = si.medicine_id
      WHERE oi.order_id    = v_order.id
        AND si.seller_id   = (v_next->>'seller_id')::UUID
        AND si.medicine_id = oi.medicine_id
        AND mm.commission_band IS NOT NULL;

      v_new_uid := resolve_seller_user_id((v_next->>'seller_id')::UUID);
      IF v_new_uid IS NOT NULL THEN
        INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
        VALUES (v_new_uid, 'Naya Order! 🛒',
                'Aapko naya order mila — ' || COALESCE(v_order.order_number, v_order.id::TEXT),
                'order_placed', v_order.id, false);
      END IF;

      v_released := v_released + 1;

    ELSIF NOW() >= v_order.scheduled_for + INTERVAL '60 minutes' THEN
      UPDATE orders SET
        routing_status  = 'needs_admin',
        routing_history = COALESCE(v_order.routing_history, '[]'::jsonb)
                           || jsonb_build_array(jsonb_build_object(
                                'result', 'needs_admin',
                                'reason', 'no seller accepting 60 min after scheduled_for',
                                'via',    'scheduled_release',
                                'at',     v_now
                              ))
      WHERE id = v_order.id;

      FOR v_admin IN SELECT email FROM staff_whitelist WHERE role = 'admin' AND is_approved = true LOOP
        SELECT id INTO v_admin_uid FROM users WHERE email = v_admin.email LIMIT 1;
        IF v_admin_uid IS NOT NULL THEN
          INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
          VALUES (v_admin_uid, 'Order Ko Seller Nahi Mila ⚠️',
            'Order #' || COALESCE(v_order.order_number, v_order.id::TEXT)
              || ' — scheduled order ke baad bhi koi seller open nahi, manual assign karein',
            'order_needs_admin', v_order.id, false);
        END IF;
      END LOOP;

      -- Superadmin fallback (049 jaisa — staff_whitelist mein admin na ho to bhi)
      FOR v_admin IN
        SELECT u.id AS uid FROM super_admins sa
        JOIN users u ON u.email = sa.email WHERE sa.is_active = true
      LOOP
        INSERT INTO notifications (user_id, title, body, type, ref_id, is_read)
        VALUES (v_admin.uid, 'Order Ko Seller Nahi Mila ⚠️',
          'Order #' || COALESCE(v_order.order_number, v_order.id::TEXT)
            || ' — scheduled order ke baad bhi koi seller open nahi, manual assign karein',
          'order_needs_admin', v_order.id, false);
      END LOOP;

      v_escalated := v_escalated + 1;
    ELSE
      v_waiting := v_waiting + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'processed', v_processed,
    'released', v_released, 'escalated', v_escalated, 'waiting', v_waiting);
END;
$$;

-- Supabase default privileges grant EXECUTE on new public functions to anon
-- and authenticated DIRECTLY, so "FROM PUBLIC" alone does not close it (cf.
-- 078 section on revoked RPCs). And the in-body guard's `current_user =
-- 'postgres'` is always true inside a SECURITY DEFINER function owned by
-- postgres — so THIS REVOKE is the real access control, not the guard.
REVOKE ALL ON FUNCTION release_scheduled_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_scheduled_orders() TO service_role;
-- (admin UI "Run Now" button chahiye to GRANT EXECUTE ... TO authenticated
-- baad mein add karein; tab guard ka admin-check hi kaam karega — us
-- case mein guard se `current_user = 'postgres'` hatana padega.)

-- ================================================================
-- 8. pg_cron — every 5 minutes (idempotent, same pattern as 031)
-- ================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-scheduled-orders') THEN
    PERFORM cron.unschedule('release-scheduled-orders');
  END IF;
END $$;

SELECT cron.schedule(
  'release-scheduled-orders',
  '*/5 * * * *',
  'SELECT release_scheduled_orders();'
);

-- ================================================================
-- 9. process_expired_routing — NO CHANGE
-- ================================================================
-- Its filter (049): status='pending' AND routing_expires_at < NOW() AND
-- seller_id IS NOT NULL AND routing_status IS DISTINCT FROM 'needs_admin'.
-- A scheduled order has seller_id NULL and routing_expires_at NULL → skipped
-- twice over. After release it is a normal routed order; re-routing is
-- hours-aware automatically via get_routing_candidates.

-- ================================================================
-- Sarthak Medical — Mon-Sat 09:00-21:00, Sunday band
-- ================================================================
UPDATE sellers SET weekly_hours = '{"mon":{"open":"09:00","close":"21:00"},"tue":{"open":"09:00","close":"21:00"},"wed":{"open":"09:00","close":"21:00"},"thu":{"open":"09:00","close":"21:00"},"fri":{"open":"09:00","close":"21:00"},"sat":{"open":"09:00","close":"21:00"},"sun":null}'::jsonb
WHERE id = 'b209fcbe-9af3-4f46-8f16-71221108025a';

COMMIT;

-- ================================================================
-- VERIFY (COMMIT ke baad) — ek row: yehi aakhri result dikhega
-- ================================================================
SELECT
  (SELECT weekly_hours FROM sellers WHERE id = 'b209fcbe-9af3-4f46-8f16-71221108025a') AS sarthak_weekly_hours,
  is_any_seller_open()                                            AS any_seller_open,
  next_service_open_time() AT TIME ZONE 'Asia/Kolkata'            AS next_open_ist,
  (SELECT row_to_json(j) FROM (
     SELECT jobid, jobname, schedule, command, active
     FROM cron.job WHERE jobname = 'release-scheduled-orders') j) AS cron_row;
