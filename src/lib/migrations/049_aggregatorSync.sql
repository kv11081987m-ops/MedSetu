-- ══════════════════════════════════════════════════
-- MedSetu — Aggregator, Chunk 2b: aggregator inventory sync (Model 1)
-- Run this in Supabase SQL Editor. DB me abhi RUN nahi hua — review ke
-- baad chalana.
--
-- Design (locked): aggregator (jaise Sarthak Medical) khud stock nahi
-- rakhta — apne mapped wholesalers (aggregator_wholesalers, 047) ke
-- stock se apni hi seller_inventory row bharta hai, is manual RPC se.
-- Wholesaler-source PRIORITY-based hai (admin ek chhota number set karta
-- hai = pehla source), koi auto-rule (cheapest/nearest/etc.) nahi.
--
-- Ismein 3 cheezein:
--   1. aggregator_wholesalers.priority — kis order me wholesaler try karna hai.
--   2. seller_inventory.sourced_from_wholesaler_id — sync-managed row ka
--      asal source (internal, customer ko nahi dikhta — 048 ka wala
--      orders.sourced_from_wholesaler_id column ALAG hai, yeh wala
--      seller_inventory par hai; dono unrelated columns, naam similar hai
--      bas concept same hai: "asal maal kahan se aaya").
--   3. sync_aggregator_inventory(p_aggregator_id) RPC — superadmin-only
--      (abhi test/admin use ke liye; aggregator ko khud trigger karne dena
--      ek future chunk me).
--
-- Depends on (sab already applied/prior chunk me likhe, is file se PEHLE
-- run karne zaroori):
--   • 003_masterMedicine.sql   — seller_inventory, UNIQUE(seller_id, medicine_id)
--   • 014_rlsPhase5a.sql       — is_active_superadmin()
--   • 022_mrpMode.sql          — seller_inventory.mrp + guard_selling_price_vs_mrp
--                                 trigger (see NOTE below — confirmed no conflict)
--   • 042_bulkSellerInventory.sql — is RPC ka INSERT..ON CONFLICT shape isी
--                                 file ke bulk_add_seller_inventory se liya
--   • 047_aggregatorStaff.sql  — sellers.is_aggregator, aggregator_wholesalers table
--   • 048_customerFeedRetailerGate.sql — get_customer_medicines already
--     `seller_type='retailer' OR is_aggregator=true` dikhata hai, is file
--     ke sync se bani rows customer ko apne aap Sarthak ke naam dikhengi —
--     yahan get_customer_medicines ko chhua nahi gaya.
--
-- NOTE — MRP-guard trigger (022, trg_guard_selling_price_vs_mrp) confirm:
--   is RPC ka INSERT/UPDATE hamesha selling_price = mrp = mm.mrp_max
--   bhejta hai (byte-for-byte barabar). Trigger logic: NEW.mrp > 0 hai to
--   v_mrp_max := NEW.mrp (= mrp_max), phir check NEW.selling_price >
--   v_mrp_max (= mrp_max > mrp_max) → FALSE → pass. Kabhi exception nahi
--   uthega jab tak mrp_max khud negative na ho (jo mm.mrp_max > 0 check se
--   already excluded hai).
--
-- NOTE — TEMP TABLE jaanbujh ke use nahi kiya: Supabase/PostgREST aksar
-- PgBouncer transaction-pooling ke peeche chalta hai, jahan CREATE TEMP
-- TABLE cross-connection state leak/prepared-statement conflicts ka risk
-- hai. Isliye "chosen wholesaler per medicine" wala CTE logic teen jagah
-- (skip-count SELECT, INSERT, cleanup UPDATE) thoda repeat hota hai —
-- jaanbujh ke, DRY se zyada safety.
-- ══════════════════════════════════════════════════


-- ================================================================
-- 1. aggregator_wholesalers.priority
-- ================================================================
ALTER TABLE aggregator_wholesalers ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;

COMMENT ON COLUMN aggregator_wholesalers.priority IS
  'Chhota number = pehla source (1 = top priority). sync_aggregator_inventory() isi order (ASC) me wholesaler try karta hai — har medicine ke liye pehla wholesaler jiske paas stock available ho. Admin priority badal ke source badal sakta hai (row delete/re-add ki zaroorat nahi).';


-- ================================================================
-- 2. seller_inventory.sourced_from_wholesaler_id
-- ================================================================
ALTER TABLE seller_inventory ADD COLUMN IF NOT EXISTS sourced_from_wholesaler_id UUID REFERENCES sellers(id) ON DELETE SET NULL;

COMMENT ON COLUMN seller_inventory.sourced_from_wholesaler_id IS
  'Sirf aggregator ki (sync_aggregator_inventory se bani) inventory row ke liye set — ye medicine asal me kis wholesaler se aati hai. Normal seller (khud-stock-rakhne wale retailer/wholesaler) ki row me hamesha NULL. Customer-facing kahin nahi dikhta.';


-- ================================================================
-- 3. sync_aggregator_inventory(p_aggregator_id)
-- ================================================================
-- Har medicine ke liye: p_aggregator_id ke active-mapped wholesalers me
-- se priority ASC (tie -> wholesaler seller_id ASC) me PEHLA wholesaler
-- jiske paas available stock (is_available=true AND stock_quantity>0) ho,
-- uska stock/unit aggregator ki apni seller_inventory row me upsert.
-- mrp_max NULL/0 wali medicine skip (customer ko ₹0/invisible row nahi
-- dena). Purani sync-managed rows jinka medicine ab kisi mapped wholesaler
-- ke paas nahi (ya jinka mrp_max ab invalid ho gaya) — is_available=false
-- (deactivate, delete nahi — history/order-links safe).
CREATE OR REPLACE FUNCTION sync_aggregator_inventory(p_aggregator_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_synced         INTEGER := 0;
  v_deactivated    INTEGER := 0;
  v_skipped_no_mrp INTEGER := 0;
BEGIN
  IF NOT is_active_superadmin() THEN
    RAISE EXCEPTION 'Sirf super-admin sync_aggregator_inventory chala sakta hai'
      USING errcode = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sellers WHERE id = p_aggregator_id AND is_aggregator = true) THEN
    RAISE EXCEPTION 'Seller % is_aggregator=true nahi hai', p_aggregator_id
      USING errcode = '22023';
  END IF;

  -- ── skip count (mrp_max NULL/0 wali chosen medicines) ──────────────
  SELECT count(*) INTO v_skipped_no_mrp
  FROM (
    SELECT DISTINCT ON (si.medicine_id) si.medicine_id, mm.mrp_max
    FROM seller_inventory si
    JOIN aggregator_wholesalers aw
      ON aw.wholesaler_seller_id = si.seller_id
     AND aw.aggregator_seller_id = p_aggregator_id
     AND aw.is_active = true
    JOIN master_medicines mm ON mm.id = si.medicine_id
    WHERE si.is_available = true AND si.stock_quantity > 0
    ORDER BY si.medicine_id, aw.priority ASC, si.seller_id ASC
  ) chosen
  WHERE chosen.mrp_max IS NULL OR chosen.mrp_max <= 0;

  -- ── sync: upsert har medicine ki chosen-wholesaler row aggregator ke
  --    apne seller_id par ─────────────────────────────────────────────
  INSERT INTO seller_inventory AS si (
    seller_id, medicine_id, selling_price, mrp, stock_quantity, unit,
    is_available, sourced_from_wholesaler_id
  )
  SELECT
    p_aggregator_id,
    chosen.medicine_id,
    chosen.mrp_max,                                  -- selling_price = MRP
    chosen.mrp_max,                                  -- own mrp = MRP (guard-safe, see NOTE)
    chosen.stock_quantity,
    COALESCE(NULLIF(chosen.unit, ''), 'strips'),
    true,
    chosen.wholesaler_seller_id
  FROM (
    SELECT DISTINCT ON (si.medicine_id)
      si.medicine_id,
      si.seller_id       AS wholesaler_seller_id,
      si.stock_quantity,
      si.unit,
      mm.mrp_max
    FROM seller_inventory si
    JOIN aggregator_wholesalers aw
      ON aw.wholesaler_seller_id = si.seller_id
     AND aw.aggregator_seller_id = p_aggregator_id
     AND aw.is_active = true
    JOIN master_medicines mm ON mm.id = si.medicine_id
    WHERE si.is_available = true AND si.stock_quantity > 0
    ORDER BY si.medicine_id, aw.priority ASC, si.seller_id ASC
  ) chosen
  WHERE chosen.mrp_max IS NOT NULL AND chosen.mrp_max > 0
  ON CONFLICT (seller_id, medicine_id) DO UPDATE SET
    selling_price              = EXCLUDED.selling_price,
    mrp                        = EXCLUDED.mrp,
    stock_quantity             = EXCLUDED.stock_quantity,
    unit                       = EXCLUDED.unit,
    is_available               = EXCLUDED.is_available,
    sourced_from_wholesaler_id = EXCLUDED.sourced_from_wholesaler_id,
    updated_at                 = NOW();

  GET DIAGNOSTICS v_synced = ROW_COUNT;

  -- ── cleanup: aggregator ki sync-managed rows (sourced_from_wholesaler_id
  --    IS NOT NULL) jinka medicine ab upar wale "chosen" set me nahi (stock
  --    khatam / wholesaler unmapped / mrp_max ab invalid) — deactivate.
  --    Aggregator ki koi manually-added row (sourced_from_wholesaler_id
  --    NULL) isse kabhi touch nahi hoti. ─────────────────────────────
  UPDATE seller_inventory si
  SET is_available = false, updated_at = NOW()
  WHERE si.seller_id = p_aggregator_id
    AND si.sourced_from_wholesaler_id IS NOT NULL
    AND si.is_available = true
    AND NOT EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON (si2.medicine_id) si2.medicine_id, mm2.mrp_max
        FROM seller_inventory si2
        JOIN aggregator_wholesalers aw2
          ON aw2.wholesaler_seller_id = si2.seller_id
         AND aw2.aggregator_seller_id = p_aggregator_id
         AND aw2.is_active = true
        JOIN master_medicines mm2 ON mm2.id = si2.medicine_id
        WHERE si2.is_available = true AND si2.stock_quantity > 0
        ORDER BY si2.medicine_id, aw2.priority ASC, si2.seller_id ASC
      ) chosen2
      WHERE chosen2.medicine_id = si.medicine_id
        AND chosen2.mrp_max IS NOT NULL AND chosen2.mrp_max > 0
    );

  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  RETURN jsonb_build_object(
    'synced',         v_synced,
    'deactivated',    v_deactivated,
    'skipped_no_mrp', v_skipped_no_mrp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION sync_aggregator_inventory(UUID) TO authenticated;


-- ================================================================
-- VERIFY — run after applying
-- ================================================================

-- Columns lag gaye:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'aggregator_wholesalers' AND column_name = 'priority';
--   -- expect integer, default 100
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'seller_inventory' AND column_name = 'sourced_from_wholesaler_id';

-- Function ban gaya + SECURITY DEFINER:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'sync_aggregator_inventory';

-- Full scenario (real IDs se replace karke):
--   0. Ek aggregator seller AGG (is_aggregator=true), do wholesaler W1/W2,
--      aggregator_wholesalers me AGG->W1 priority=1, AGG->W2 priority=2
--      (dono is_active=true) bana lo.
--   1. Ek hi medicine M dono W1 aur W2 ke paas stock kar do:
--      W1: stock_quantity=5,  is_available=true
--      W2: stock_quantity=20, is_available=true
--      master_medicines.mrp_max(M) = 100 (>0).
--   2. SELECT sync_aggregator_inventory('<AGG-id>');
--      -> { synced: >=1, deactivated: 0, skipped_no_mrp: 0 }
--   3. Priority se sahi source chuna (W1, kyunki priority 1 < 2):
--      SELECT selling_price, mrp, stock_quantity, sourced_from_wholesaler_id
--      FROM seller_inventory WHERE seller_id = '<AGG-id>' AND medicine_id = '<M-id>';
--      -- expect: selling_price=100, mrp=100, stock_quantity=5 (W1 ka, W2 ka 20 NAHI),
--      --         sourced_from_wholesaler_id = '<W1-id>'
--   4. W1 ka stock 0 kar do (UPDATE seller_inventory SET stock_quantity=0
--      WHERE seller_id='<W1-id>' AND medicine_id='<M-id>'), dobara sync:
--      SELECT sync_aggregator_inventory('<AGG-id>');
--      -- ab W2 chuna jaana chahiye (fallback):
--      SELECT stock_quantity, sourced_from_wholesaler_id FROM seller_inventory
--      WHERE seller_id='<AGG-id>' AND medicine_id='<M-id>';
--      -- expect stock_quantity=20, sourced_from_wholesaler_id='<W2-id>'
--   5. Cleanup check: W1 aur W2 dono ka stock 0 kar do, dobara sync:
--      SELECT sync_aggregator_inventory('<AGG-id>');
--      -- { synced: 0 (ya baaki medicines ke hisaab se), deactivated: >=1, ... }
--      SELECT is_available FROM seller_inventory
--      WHERE seller_id='<AGG-id>' AND medicine_id='<M-id>';
--      -- expect false
--   6. mrp_max NULL/0 skip: ek medicine N jiska master_medicines.mrp_max
--      NULL/0 hai, kisi mapped wholesaler ke paas available stock kar do:
--      SELECT sync_aggregator_inventory('<AGG-id>');
--      -- skipped_no_mrp me count hona chahiye, N ki koi row seller_inventory
--      -- me AGG ke naam par NAHI banni chahiye:
--      SELECT count(*) FROM seller_inventory
--      WHERE seller_id='<AGG-id>' AND medicine_id='<N-id>';  -- expect 0
--   7. Aggregator ki manually-added row (sourced_from_wholesaler_id NULL,
--      agar koi ho) sync se untouched rahe — is_available/values wahi
--      rahein jo pehle the.
--   8. Idempotent: same state par dobara sync_aggregator_inventory chalao
--      -> koi duplicate row nahi (UNIQUE seller_id+medicine_id already
--      guarantee karta hai), synced/deactivated dono agli baar 0/consistent.
--   9. Guard: non-superadmin session se
--      SELECT sync_aggregator_inventory('<AGG-id>');
--      -> exception, errcode 42501.
--  10. Guard: superadmin session, par p_aggregator_id kisi non-aggregator
--      seller ka -> exception, errcode 22023.
--  11. get_customer_medicines(NULL, false, 50, 0) me ab M (step 3 ke baad)
--      AGG ke naam se dikhna chahiye (048 ka is_aggregator gate already
--      isse allow karta hai) — customer ko W1/W2 ka naam kahin nahi dikhna.


-- ================================================================
-- ROLLBACK
-- ================================================================

-- DROP FUNCTION IF EXISTS sync_aggregator_inventory(UUID);
-- ALTER TABLE seller_inventory DROP COLUMN IF EXISTS sourced_from_wholesaler_id;
-- ALTER TABLE aggregator_wholesalers DROP COLUMN IF EXISTS priority;
-- ================================================================
