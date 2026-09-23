-- ══════════════════════════════════════════════════
-- MedSetu — follow-up fixes to 078 (investigation 2026-09-23)
-- Run this in Supabase SQL Editor — ONE SECTION AT A TIME, in order.
-- ══════════════════════════════════════════════════
--
--   A. seller-sourced medicines: Rx flag from an OTC allow-list, not hardcoded true
--   B. seller cancel of a confirmed order: status + stock release in one RPC
--   C. prescriptions / return-photos storage INSERT policies (C1 fix, then C2 tighten)
--   D. routing skips closed stores (is_open)


-- >>> SECTION A
-- ================================================================
-- A. seller-sourced medicines — Rx flag from an OTC allow-list
-- ================================================================
-- Why: bulk_add_seller_inventory created every unmatched CSV medicine
-- with requires_prescription = true, hardcoded. All 2,012 source='seller'
-- rows were Rx — 2,022 of Sarthak's 2,711 inventory rows, including
-- Zincovit, ORS, soap, toothpaste — so almost every cart went to the
-- pharmacist (and, since 078 section 3, that is enforced server-side).
--
-- Rule (guess_requires_prescription): OTC only when the name clearly is a
-- non-drug / supplement / personal-care / consumable item (allow-list);
-- everything else stays Rx. Deliberately the safe direction: a wrong
-- guess costs a pharmacist review, never an Rx drug sold without one.
-- Rejected alternatives: copying the flag from master rows with the same
-- brand word (master's own flags are unreliable — indian_dataset marks
-- only 414 of 246,068 as Rx; Augmentin/Pan 40/Telma are false there) and
-- an Rx keyword deny-list (misses Rx brands like Sitalembic, Glychek M).
--
-- Exclusions: anything injectable, and domperidone (DOMESTAL BABY DROP
-- matched "baby"). On the 2,012 rows this yields 97 OTC / 1,915 Rx.
-- Not touched: indian_dataset / janaushadhi / merge_* flags.
BEGIN;

CREATE OR REPLACE FUNCTION guess_requires_prescription(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = public AS $$
  SELECT NOT (
    lower(coalesce(p_name, '')) ~ '(tooth ?paste|mouth ?wash|toothbrush|\mlotion|\msoap|shampoo|face ?wash|body ?wash|\mbaby|diaper|sanitary|napkin|\mpads?\M|talc|dusting powder|moisturi|sunscreen|sun screen|lip ?balm|hair oil|massage oil|conditioner|protein|horlicks|ensure|bournvita|pediasure|glucon-?d\M|\mors\M|electral|walyte|multivit|zincovit|\mzinc\M|calcium|d-?3\M|d3\+|d-360|omega|fish oil|cod liver|biotin|chyawan|honey|\meno\M|gelusil|digene|vicks|\mbalm\M|plaster|bandage|cotton|gauze|crepe|mask|gloves?|thermometer|syringe|needle|test strip|glucometer|condom|sensodent|sensodyne|colgate|dettol|savlon|tears natural|refresh tears|lubricat|nano shots|sachet|energy drink|feeding bottle|nipple|wipes|hand ?wash|sanitizer|antiseptic liquid|oral rehydration)'
    AND lower(coalesce(p_name, '')) !~ '(inj|injection|vial|domest)'
  );
$$;

UPDATE master_medicines
SET requires_prescription = guess_requires_prescription(name)
WHERE source = 'seller'
  AND requires_prescription IS DISTINCT FROM guess_requires_prescription(name);

-- Live body, only the requires_prescription value in step 5b changed.
CREATE OR REPLACE FUNCTION public.bulk_add_seller_inventory(p_seller_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- ── Ownership check: purane jaisा byte-same ──
  IF NOT EXISTS (
    SELECT 1 FROM sellers s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = p_seller_id
      AND (u.auth_id = auth.uid() OR u.email = auth.email() OR is_active_superadmin())
  ) THEN
    RAISE EXCEPTION 'Not authorized for seller %', p_seller_id USING errcode = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('matched', 0, 'seller_sourced', 0, 'upserted', 0,
                              'skipped_no_mrp', '[]'::jsonb, 'failed', '[]'::jsonb);
  END IF;

  -- ON COMMIT DROP temp tables sirf transaction-end par drop hoti hain, statement-end
  -- par nahi — agar ye function kabhi same transaction me 2+ baar call ho (retry logic,
  -- ya SQL-editor se manual double-call), "relation already exists" milta. Defensive drop:
  DROP TABLE IF EXISTS _in, _mm, _res, _ss, _sslink, _final;

  -- 1) parse input
  CREATE TEMP TABLE _in ON COMMIT DROP AS
  SELECT
    btrim(r->>'name')                                    AS name,
    normalize_med_name(btrim(r->>'name'))                AS nname,
    COALESCE(NULLIF(r->>'stock','')::int, 0)             AS stock,
    COALESCE(NULLIF(r->>'selling_price','')::numeric, 0) AS selling_price,
    NULLIF(r->>'mrp', '')::numeric                       AS mrp,
    COALESCE(NULLIF(r->>'unit', ''), 'strips')           AS unit,
    NULLIF(r->>'expiry_date', '')::date                  AS expiry_date,
    NULLIF(r->>'batch_number', '')                       AS batch_number,
    COALESCE(NULLIF(r->>'min_order_quantity', '')::int, 1) AS moq,
    NULLIF(r->>'commission_band', '')                    AS commission_band,
    NULLIF(r->>'dosage_form', '')                        AS dosage_form,
    ord.idx
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS ord(r, idx)
  WHERE btrim(COALESCE(r->>'name', '')) <> '';

  -- 2) count master matches per normalized name (0 / 1 / >1)
  CREATE TEMP TABLE _mm ON COMMIT DROP AS
  SELECT i.idx,
         (SELECT count(*) FROM master_medicines mm
            WHERE mm.is_active AND normalize_med_name(mm.name) = i.nname) AS mcount,
         (SELECT mm.id FROM master_medicines mm
            WHERE mm.is_active AND normalize_med_name(mm.name) = i.nname
            ORDER BY mm.id LIMIT 1) AS one_id
  FROM _in i;

  -- 3) resolve medicine_id for every row (NULL if 0-or-ambiguous)
  CREATE TEMP TABLE _res ON COMMIT DROP AS
  SELECT i.*, m.mcount,
         CASE WHEN m.mcount = 1 THEN m.one_id ELSE NULL END AS matched_id
  FROM _in i JOIN _mm m USING (idx);

  -- 4) seller-sourced candidates: 0-or-ambiguous match, but HAVE own mrp>0
  CREATE TEMP TABLE _ss ON COMMIT DROP AS
  SELECT DISTINCT ON (nname) nname, name, mrp, commission_band, dosage_form
  FROM _res
  WHERE matched_id IS NULL AND mrp IS NOT NULL AND mrp > 0
  ORDER BY nname, idx;

  -- 5) _sslink: nname -> master_medicines.id resolution for seller-sourced rows.
  --    Do saaf steps (CTE-in-temp-table se bachne ke liye) —
  CREATE TEMP TABLE _sslink (nname text PRIMARY KEY, id uuid) ON COMMIT DROP;

  -- 5a) REUSE: pehle se maujood source='seller' row with same normalized name
  INSERT INTO _sslink (nname, id)
  SELECT s.nname,
         (SELECT mm.id FROM master_medicines mm
            WHERE mm.source = 'seller' AND normalize_med_name(mm.name) = s.nname
            ORDER BY mm.id LIMIT 1)
  FROM _ss s
  WHERE EXISTS (
    SELECT 1 FROM master_medicines mm
    WHERE mm.source = 'seller' AND normalize_med_name(mm.name) = s.nname
  );

  -- 5b) CREATE: jo abhi bhi resolve nahi hue, unke liye nayi master row
  WITH to_create AS (
    SELECT s.* FROM _ss s
    WHERE NOT EXISTS (SELECT 1 FROM _sslink l WHERE l.nname = s.nname)
  ),
  created AS (
    INSERT INTO master_medicines
      (name, mrp_max, requires_prescription, source, is_active, is_verified, commission_band, dosage_form)
    -- 079 A: was hardcoded true; OTC allow-list now, Rx by default
    SELECT name, mrp, guess_requires_prescription(name), 'seller', true, false,
      commission_band,   -- NULL hoga to column ka default chalega
      dosage_form
    FROM to_create
    RETURNING id, normalize_med_name(name) AS nname
  )
  INSERT INTO _sslink (nname, id)
  SELECT nname, id FROM created;

  -- 6) final medicine_id per row (matched OR seller-sourced OR still-null)
  CREATE TEMP TABLE _final ON COMMIT DROP AS
  SELECT r.*,
         COALESCE(r.matched_id, l.id) AS medicine_id,
         (r.matched_id IS NOT NULL)   AS was_matched
  FROM _res r
  LEFT JOIN _sslink l ON l.nname = r.nname;

  -- 6b) master-matched rows: CSV se dosage_form aaya ho aur master row
  -- abhi NULL ho, to backfill kar do (seller-sourced naye rows ke liye
  -- dosage_form already 5b ke INSERT me set ho chuka hai, isliye yahan
  -- sirf was_matched rows chahiye).
  UPDATE master_medicines mm
  SET dosage_form = f.dosage_form
  FROM _final f
  WHERE mm.id = f.medicine_id
    AND f.was_matched
    AND mm.dosage_form IS NULL
    AND f.dosage_form IS NOT NULL;

  -- 7) MRP-guard (purane jaisа exact rule) + 8) upsert
  WITH ref AS (
    SELECT f.*,
      COALESCE(NULLIF(f.mrp, 0), mm.mrp_max) AS v_ref, mm.mrp_max AS master_mrp
    FROM _final f JOIN master_medicines mm ON mm.id = f.medicine_id
    WHERE f.medicine_id IS NOT NULL
  ),
  ok AS (
    SELECT * FROM ref
    WHERE NOT (selling_price IS NOT NULL AND v_ref IS NOT NULL AND v_ref > 0 AND selling_price > v_ref)
  ),
  dedup AS (
    SELECT DISTINCT ON (medicine_id) * FROM ok ORDER BY medicine_id, idx DESC
  ),
  ins AS (
    INSERT INTO seller_inventory AS si
      (seller_id, medicine_id, selling_price, mrp, stock_quantity, unit,
       expiry_date, batch_number, is_available, min_order_quantity)
    SELECT p_seller_id, medicine_id,
           CASE WHEN selling_price > 0 THEN selling_price ELSE COALESCE(NULLIF(mrp, 0), master_mrp) END,
           mrp, stock, unit, expiry_date, batch_number, (stock > 0), moq
    FROM dedup
    ON CONFLICT (seller_id, medicine_id) DO UPDATE SET
      selling_price      = EXCLUDED.selling_price,
      mrp                = COALESCE(EXCLUDED.mrp, si.mrp),
      stock_quantity     = EXCLUDED.stock_quantity,
      unit               = EXCLUDED.unit,
      expiry_date        = EXCLUDED.expiry_date,
      batch_number       = EXCLUDED.batch_number,
      is_available       = EXCLUDED.is_available,
      min_order_quantity = EXCLUDED.min_order_quantity,
      updated_at         = NOW()
    RETURNING 1
  )
  SELECT jsonb_build_object(
    'matched',        (SELECT count(*) FROM _final WHERE was_matched),
    'seller_sourced', (SELECT count(*) FROM _final WHERE NOT was_matched AND medicine_id IS NOT NULL),
    'upserted',       (SELECT count(*) FROM ins),
    'skipped_no_mrp', COALESCE((SELECT jsonb_agg(name ORDER BY idx)
                       FROM _res WHERE matched_id IS NULL AND (mrp IS NULL OR mrp <= 0)), '[]'::jsonb),
    'failed',         COALESCE((SELECT jsonb_agg(name || ' (selling price MRP se zyada)' ORDER BY idx)
                       FROM ref WHERE selling_price > v_ref AND v_ref > 0), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMIT;
-- <<< SECTION A


-- >>> SECTION B
-- ================================================================
-- B. seller cancel of a confirmed order — one atomic RPC
-- ================================================================
-- Why: SellerDashboard's cancelConfirmedOrderImpl set status='cancelled'
-- directly and then called release_stock from the client. 064 revoked
-- release_stock from client roles (it has no ownership check — granting
-- it back would let any logged-in user release any seller's reserve),
-- so since 2026-09-19 every seller cancel left its reservation stuck.
-- MED-MUB6BWTM3MPR (cancelled 2026-09-22) left 1 unit reserved on four
-- Sarthak rows.
--
-- seller_cancel_order does the status change and the releases in one
-- transaction, for the order's own seller (or a superadmin), only from
-- the post-accept states the dashboard offers Cancel on.
BEGIN;

CREATE OR REPLACE FUNCTION seller_cancel_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_order    orders%ROWTYPE;
  v_item     RECORD;
  v_ok       boolean;
  v_failures text[] := '{}';
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order nahi mila');
  END IF;

  IF NOT (is_owner_of_seller(v_order.seller_id) OR is_active_superadmin()) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Yeh order aapka nahi hai');
  END IF;

  IF v_order.status NOT IN ('confirmed', 'preparing', 'out_for_delivery') THEN
    RETURN jsonb_build_object('success', false, 'message',
      'Yeh order ab cancel nahi ho sakta (status: ' || v_order.status || ')');
  END IF;

  UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = p_order_id;

  -- Every one of these states was reached through an accept that
  -- reserved stock, so each item's reserve is released here.
  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    IF v_item.medicine_id IS NOT NULL AND COALESCE(v_item.quantity, 0) > 0 THEN
      SELECT release_stock(v_order.seller_id, v_item.medicine_id, v_item.quantity) INTO v_ok;
      IF v_ok IS NOT TRUE THEN
        v_failures := array_append(v_failures, COALESCE(v_item.name, 'Medicine'));
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'failures', to_jsonb(v_failures));
END; $$;
REVOKE EXECUTE ON FUNCTION seller_cancel_order(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION seller_cancel_order(uuid) TO authenticated;

-- One-off: the four rows MED-MUB6BWTM3MPR left reserved (no active order
-- references any of them).
UPDATE seller_inventory si SET reserved_quantity = 0
FROM master_medicines m
WHERE m.id = si.medicine_id
  AND si.seller_id = (SELECT id FROM sellers WHERE store_name = 'Sarthak Medical')
  AND m.name IN ('Acticort 10mg Tablet', 'Medomol Injection', 'Acticort 5mg Tablet', 'Perinorm Injection')
  AND si.reserved_quantity = 1
  AND NOT EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE i.medicine_id = si.medicine_id AND o.seller_id = si.seller_id
      AND o.status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery', 'awaiting_pharmacist')
  );

COMMIT;
-- <<< SECTION B


-- >>> SECTION C1
-- ================================================================
-- C1. storage INSERT policies — check the object's own path
-- ================================================================
-- Why: both policies wrote storage.foldername(name) inside a subquery
-- over users u, so the bare `name` bound to users.name (e.g. "Ajay"),
-- not storage.objects.name — the check could never pass. Prescription
-- uploads only worked because of the separate bucket-only policy
-- "Allow prescription uploads" (tightened in C2, which must come after
-- this). Path shape stays as PrescriptionUpload.jsx builds it:
-- <users.id>/rx_<ts>.<ext>.
BEGIN;

DROP POLICY IF EXISTS rx_insert_own_folder ON storage.objects;
CREATE POLICY rx_insert_own_folder ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prescriptions' AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = auth.uid()
        AND u.id::text = (storage.foldername(objects.name))[1]
    )
  );

DROP POLICY IF EXISTS customer_upload_return_photo ON storage.objects;
CREATE POLICY customer_upload_return_photo ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'return-photos' AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = auth.uid()
        AND u.id::text = (storage.foldername(objects.name))[1]
    )
  );

COMMIT;
-- <<< SECTION C1


-- >>> SECTION C2
-- ================================================================
-- C2. drop the bucket-only prescriptions INSERT policy
-- ⚠️  Only after C1 is applied and verified.
-- ================================================================
-- "Allow prescription uploads" let any logged-in user write anywhere in
-- the prescriptions bucket, including another user's folder. With C1 in
-- place rx_insert_own_folder covers the real upload path on its own.
BEGIN;

DROP POLICY IF EXISTS "Allow prescription uploads" ON storage.objects;

COMMIT;
-- <<< SECTION C2


-- >>> SECTION D
-- ================================================================
-- D. routing skips closed stores
-- ================================================================
-- Why: get_routing_candidates only required seller_type = retailer and
-- routing_weight > 0, so a seller who toggled their store closed kept
-- receiving new orders (checkout, timeout re-route, approve_rx_order all
-- use this). approval_status is left out on purpose: nothing ever sets it
-- (every seller reads pending); the real approval gate is that a sellers
-- row only exists after superadmin approval, plus routing_weight.
-- Live body, one condition added.
BEGIN;

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
      AND s.is_open = true   -- 079 D: a closed store gets no new orders
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

COMMIT;
-- <<< SECTION D
