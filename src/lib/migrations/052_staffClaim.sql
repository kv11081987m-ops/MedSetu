-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator, Chunk 4b: claim/release atomic RPC
-- Run this in Supabase SQL Editor. DB me abhi RUN nahi hua — review ke
-- baad chalana.
--
-- Scope: SIRF pool "Pick"/"Release" — claimed_by/claimed_at set/clear
-- karna. Koi status/stock/seller_id/pricing change nahi (chunk 4c).
-- Staff apni khud ki Google-login session se chalata hai (RLS ke through
-- staff seedha orders UPDATE nahi kar sakta — orders_update_involved_or_staff
-- me staff branch jaanbujh ke abhi bhi nahi hai, 051's header NOTE), isliye
-- dono RPC SECURITY DEFINER — pharmacist ke approve_rx_order/reject_rx_order
-- (045) jaisा hi pattern: staff apni identity se authorize hota hai (guard
-- andar), function apne owner ki privilege se UPDATE karta hai.
--
-- Is file me:
--   1. claim_order(p_order_id)   — atomic "Pick": claimed_by/claimed_at set,
--      sirf tabhi jab (a) caller active staff ho, (b) order uske apne
--      deployed_wholesaler_id se sourced ho, (c) abhi kisi ne claim na
--      kiya ho. Race-safe via ek hi conditional UPDATE (WHERE claimed_by
--      IS NULL) — do staff ek saath try karein to Postgres ka row-level
--      lock unhe serialize kar deta hai, jeetne wale ko hi 1 row milta hai.
--   2. release_order(p_order_id) — wapas pool: sirf wahi staff jisne claim
--      kiya (ya super-admin, force-release). Bhi ek hi atomic UPDATE.
--
-- Depends on (sab already applied/prior chunks, is file se PEHLE run
-- karna zaroori):
--   • 014_rlsPhase5a.sql          — is_active_superadmin()
--   • 028_rejectReassignChain.sql — app.routing_trusted escape hatch idiom
--   • 047_aggregatorStaff.sql     — seller_staff, is_seller_staff(),
--                                    orders.claimed_by/claimed_at/
--                                    sourced_from_wholesaler_id
--   • 050_aggregatorOrderSource.sql — orders.sourced_from_wholesaler_id ka
--     hi actual source (RPC ke bina yeh column kabhi set hi nahi hota)
--   • 051_staffPoolVisibility.sql — current_staff_wholesaler_id() (aggregator
--     id yahan use nahi hoti — order ka ownership already seller_id=
--     aggregator se tय hai, redundant check nahi; wholesaler + apni
--     seller_staff.id hi chahiye, dono niche nikaale gaye hain)
--
-- NOTE — trust flag: 050's apni investigation confirm kar chuki hai ki
-- protect_order_sensitive_columns() (028) claimed_by/claimed_at ko
-- explicitly revert NAHI karta (na hi routing_status/sourced_from_
-- wholesaler_id — jinke liye 050 ne yahi flag laga rakha tha). Fir bhi
-- app.routing_trusted='true' laga raha hoon — same forward-safety idiom
-- jo 045/050 dono follow karte hain.
--
-- NOTE — release_order ka superadmin force-release: request me optional
-- tha, maine RAKHA hai (single atomic UPDATE me `claimed_by = v_staff_id
-- OR is_active_superadmin()` — superadmin ke liye v_staff_id chahe NULL
-- ho, is_active_superadmin() akela hi unlock kar deta hai). Har failure
-- case ka message wahi ek string hai jo spec ne diya ('Ye order aapne
-- claim nahi kiya') — superadmin ke "order already unclaimed tha" case ke
-- liye thoda imprecise hai, par do alag messages ke liye branching complexity
-- add karne se pehle aapki confirmation chahiye — agar chahiye to alag
-- kar dunga.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 1. claim_order(p_order_id) — atomic "Pick"
-- ================================================================
CREATE OR REPLACE FUNCTION claim_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id   UUID;
  v_staff_whid UUID;
  v_order_whid UUID;
  v_row_count  INTEGER;
BEGIN
  IF NOT is_seller_staff() THEN
    RAISE EXCEPTION 'Sirf seller staff claim_order chala sakta hai'
      USING errcode = '42501';
  END IF;

  v_staff_whid := current_staff_wholesaler_id();

  SELECT id INTO v_staff_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true;

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'message', 'Staff record nahi mila');
  END IF;

  SELECT sourced_from_wholesaler_id INTO v_order_whid
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'message', 'Order nahi mila');
  END IF;

  IF v_order_whid IS DISTINCT FROM v_staff_whid THEN
    RETURN jsonb_build_object('claimed', false, 'message', 'Ye order aapke wholesaler ka nahi');
  END IF;

  -- Escape hatch for protect_order_sensitive_columns() — see header NOTE.
  PERFORM set_config('app.routing_trusted', 'true', true);

  -- Atomic pick: claimed_by IS NULL guard hi race-safety hai — do staff
  -- ek saath yahi statement chalayein to Postgres row-level lock serialize
  -- karta hai; jo pehle commit hota hai wahi 1 row match karega, doosra
  -- 0 rows dekhega (claimed_by ab NULL nahi raha).
  UPDATE orders
  SET claimed_by = v_staff_id, claimed_at = NOW()
  WHERE id = p_order_id
    AND claimed_by IS NULL
    AND sourced_from_wholesaler_id = v_staff_whid;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 1 THEN
    RETURN jsonb_build_object('claimed', true, 'staff_id', v_staff_id);
  ELSE
    RETURN jsonb_build_object('claimed', false, 'message', 'Order pehle se kisi aur ne le liya');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_order(UUID) TO authenticated;


-- ================================================================
-- 2. release_order(p_order_id) — wapas pool
-- ================================================================
CREATE OR REPLACE FUNCTION release_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id  UUID;
  v_row_count INTEGER;
BEGIN
  IF NOT (is_seller_staff() OR is_active_superadmin()) THEN
    RAISE EXCEPTION 'Sirf seller staff ya super-admin release_order chala sakta hai'
      USING errcode = '42501';
  END IF;

  -- Superadmin caller ke liye v_staff_id NULL rahega — neeche wale
  -- WHERE me is_active_superadmin() akela hi unlock kar deta hai
  -- (force-release, kisi ka bhi claim ho).
  SELECT id INTO v_staff_id FROM seller_staff
  WHERE email = auth.email() AND is_active = true;

  -- Escape hatch for protect_order_sensitive_columns() — see header NOTE.
  PERFORM set_config('app.routing_trusted', 'true', true);

  UPDATE orders
  SET claimed_by = NULL, claimed_at = NULL
  WHERE id = p_order_id
    AND claimed_by IS NOT NULL
    AND (claimed_by = v_staff_id OR is_active_superadmin());

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 1 THEN
    RETURN jsonb_build_object('released', true);
  ELSE
    RETURN jsonb_build_object('released', false, 'message', 'Ye order aapne claim nahi kiya');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION release_order(UUID) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Functions ban gaye + SECURITY DEFINER:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('claim_order', 'release_order');

-- Setup (real IDs se replace karke, 051 ka hi setup reuse karo):
--   Aggregator AGG, wholesaler W1/W2, staff ST1 (deployed_wholesaler_id=W1,
--   is_active=true), staff ST2 (deployed_wholesaler_id=W1, is_active=true —
--   DO staff EK HI wholesaler par, race test ke liye), staff ST3
--   (deployed_wholesaler_id=W2). Orders: O1 (sourced_from_wholesaler_id=W1,
--   claimed_by=NULL), O2 (sourced_from_wholesaler_id=W2, claimed_by=NULL).

-- Case A — apna wholesaler, unclaimed -> claim ho jaata hai:
--   ST1 session: SELECT claim_order('<O1-id>');
--   -> { claimed: true, staff_id: '<ST1-id>' }
--   SELECT claimed_by, claimed_at FROM orders WHERE id='<O1-id>';
--   -- claimed_by=ST1, claimed_at set

-- Case B — doosre wholesaler ka order -> reject:
--   ST1 session: SELECT claim_order('<O2-id>');
--   -> { claimed: false, message: 'Ye order aapke wholesaler ka nahi' }
--   -- O2 ka claimed_by/claimed_at bilkul unchanged.

-- Case C — pehle se claimed order, doosra staff (same wholesaler) try kare:
--   (O1 already ST1 ke paas, Case A ke baad) ST2 session:
--   SELECT claim_order('<O1-id>');
--   -> { claimed: false, message: 'Order pehle se kisi aur ne le liya' }
--   -- O1.claimed_by ST1 hi rehta hai, ST2 se overwrite nahi hota.

-- Case D — race note (do staff EK SAATH same unclaimed order try karein):
--   Do alag DB sessions (2 psql/SQL-editor tabs) me EK SAATH:
--     Session 1 (ST1): SELECT claim_order('<O-id>');
--     Session 2 (ST2): SELECT claim_order('<O-id>');
--   Postgres in dono UPDATE ko row-level lock se serialize karega — jo
--   pehle commit hota hai use { claimed: true }, doosra apne aap
--   { claimed: false, message: 'Order pehle se kisi aur ne le liya' } dekhega
--   (WHERE claimed_by IS NULL doosri UPDATE ke chalte time tak already
--   false ho chuka hoga). Kabhi dono {claimed:true} nahi honge.

-- Case E — release: sirf claimer release kar sake:
--   (O1 abhi ST1 ke paas) ST2 session: SELECT release_order('<O1-id>');
--   -> { released: false, message: 'Ye order aapne claim nahi kiya' }
--   ST1 session: SELECT release_order('<O1-id>');
--   -> { released: true }
--   SELECT claimed_by, claimed_at FROM orders WHERE id='<O1-id>';
--   -- dono NULL

-- Case F — release non-claimed order:
--   SELECT release_order('<O2-id>');  -- (O2 kabhi claim hi nahi hua)
--   -> { released: false, message: 'Ye order aapne claim nahi kiya' }

-- Case G — superadmin force-release:
--   ST1 se O1 claim karao, phir superadmin session: SELECT release_order('<O1-id>');
--   -> { released: true } (staff khud na ho tab bhi, is_active_superadmin() se)

-- Guard: non-staff/non-superadmin session se claim_order/release_order
--   dono -> exception, errcode 42501.

-- Non-aggregator order par claim_order:
--   SELECT claim_order('<koi normal retailer order id>');
--   -- uska sourced_from_wholesaler_id hamesha NULL, staff ka
--   -- current_staff_wholesaler_id() kabhi NULL = NULL match nahi karta
--   -- (IS DISTINCT FROM correctly true), isliye:
--   -> { claimed: false, message: 'Ye order aapke wholesaler ka nahi' }


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS claim_order(UUID);
-- DROP FUNCTION IF EXISTS release_order(UUID);
-- ================================================================
