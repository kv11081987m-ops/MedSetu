-- ══════════════════════════════════════════════════
-- MedSetu — server-side order price validation + active-inventory Rx flags
-- Run this in Supabase SQL Editor — ONE SECTION AT A TIME, in order.
-- ══════════════════════════════════════════════════
--
--   1. B2C order_items: unit price floor + order total consistency
--   2. Rx flags for indian_dataset medicines in live seller inventory


-- >>> SECTION 1
-- ================================================================
-- 1. B2C order_items — price floor + order total consistency
-- ================================================================
-- Why: orders (total_amount, final_amount) and order_items (unit_price,
-- total_price) were both taken from the client as-is — nothing compared
-- them to seller_inventory, and confirm_delivery computes commission from
-- them. A direct API insert could place a ₹1 order for anything.
--
-- Rules, B2C only (buyer_type 'customer'; B2B wholesale pricing is a
-- different model and is not checked here):
--   Per item (BEFORE INSERT, row):
--     - medicine_id required (an item with no medicine can't be priced
--       or Rx-gated)
--     - quantity > 0, total_price = unit_price × quantity (±0.05)
--     - unit_price >= 99% of customer_min_price(medicine_id): the
--       cheapest price any retailer currently sells it at, computed
--       exactly like src/lib/api.js fetchSellersForMedicine (mrp_mode:
--       seller mrp, else master mrp_max; otherwise selling_price). Only a
--       floor — paying more than the cheapest (stale cart after a price
--       drop, pricier routed seller) is allowed. No sellable row at all →
--       floor is master mrp_max; no mrp_max either → not checked.
--   Per order (AFTER INSERT, statement — Checkout inserts all of an
--   order's items in one statement, orders.js createOrderItems):
--     - total_amount = sum of that order's item total_price (±0.05)
--     - 0 <= discount <= total_amount, delivery_charge >= 0
--     - final_amount = total_amount + delivery_charge − discount (±0.05)
-- Not validated: whether the promo code / discount amount and the
-- delivery charge themselves are legitimate.
BEGIN;

CREATE OR REPLACE FUNCTION customer_min_price(p_medicine_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT CASE WHEN COALESCE((SELECT mrp_mode FROM platform_settings WHERE id = 1), false) THEN
    (SELECT min(CASE WHEN si.mrp > 0 THEN si.mrp WHEN mm.mrp_max > 0 THEN mm.mrp_max END)
       FROM seller_inventory si
       JOIN sellers s ON s.id = si.seller_id AND s.seller_type = 'retailer'
       JOIN master_medicines mm ON mm.id = si.medicine_id
      WHERE si.medicine_id = p_medicine_id
        AND si.seller_hidden = false
        AND inventory_expiry_ok(si.expiry_date))
  ELSE
    (SELECT min(si.selling_price)
       FROM seller_inventory si
       JOIN sellers s ON s.id = si.seller_id AND s.seller_type = 'retailer'
      WHERE si.medicine_id = p_medicine_id
        AND si.is_available = true
        AND si.stock_quantity - si.reserved_quantity > 0
        AND si.selling_price > 0
        AND inventory_expiry_ok(si.expiry_date))
  END;
$$;
REVOKE EXECUTE ON FUNCTION customer_min_price(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION validate_order_item_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_buyer_type text;
  v_floor      numeric;
BEGIN
  SELECT buyer_type INTO v_buyer_type FROM orders WHERE id = NEW.order_id;
  IF COALESCE(v_buyer_type, 'customer') <> 'customer' THEN
    RETURN NEW;
  END IF;

  IF NEW.medicine_id IS NULL THEN
    RAISE EXCEPTION 'Order item mein medicine_id zaroori hai' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(NEW.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantity galat hai (%)', NEW.quantity USING ERRCODE = '22023';
  END IF;
  IF abs(COALESCE(NEW.total_price, 0) - COALESCE(NEW.unit_price, 0) * NEW.quantity) > 0.05 THEN
    RAISE EXCEPTION 'Item total (%) price × quantity se match nahi karta', NEW.total_price
      USING ERRCODE = '22023';
  END IF;

  v_floor := COALESCE(customer_min_price(NEW.medicine_id),
                      (SELECT NULLIF(mrp_max, 0) FROM master_medicines WHERE id = NEW.medicine_id));
  IF v_floor IS NOT NULL AND COALESCE(NEW.unit_price, 0) < v_floor * 0.99 THEN
    RAISE EXCEPTION 'Price badal gaya hai: % ka current price ₹% hai (bheja ₹%)',
      NEW.name, round(v_floor, 2), NEW.unit_price
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_order_item_price ON order_items;
CREATE TRIGGER trg_validate_order_item_price
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION validate_order_item_price();

CREATE OR REPLACE FUNCTION validate_order_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_items numeric;
BEGIN
  FOR v_order IN
    SELECT o.* FROM orders o
    WHERE o.id IN (SELECT DISTINCT order_id FROM new_items)
      AND COALESCE(o.buyer_type, 'customer') = 'customer'
  LOOP
    SELECT COALESCE(sum(total_price), 0) INTO v_items FROM order_items WHERE order_id = v_order.id;

    IF abs(COALESCE(v_order.total_amount, 0) - v_items) > 0.05 THEN
      RAISE EXCEPTION 'Order total (₹%) items ke jod (₹%) se match nahi karta',
        v_order.total_amount, round(v_items, 2) USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_order.discount, 0) < 0
       OR COALESCE(v_order.discount, 0) > COALESCE(v_order.total_amount, 0) + 0.05
       OR COALESCE(v_order.delivery_charge, 0) < 0 THEN
      RAISE EXCEPTION 'Discount/delivery charge galat hai' USING ERRCODE = '22023';
    END IF;
    IF abs(COALESCE(v_order.final_amount, 0)
           - (COALESCE(v_order.total_amount, 0) + COALESCE(v_order.delivery_charge, 0)
              - COALESCE(v_order.discount, 0))) > 0.05 THEN
      RAISE EXCEPTION 'Final amount (₹%) total + delivery − discount se match nahi karta',
        v_order.final_amount USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_order_totals ON order_items;
CREATE TRIGGER trg_validate_order_totals
  AFTER INSERT ON order_items
  REFERENCING NEW TABLE AS new_items
  FOR EACH STATEMENT EXECUTE FUNCTION validate_order_totals();

COMMIT;
-- <<< SECTION 1


-- >>> SECTION 2
-- ================================================================
-- 2. Rx flags for indian_dataset medicines in live seller inventory
-- ================================================================
-- Why: indian_dataset marks only 0.17% of its 246,068 rows as Rx
-- (Augmentin, Pan 40, Telma, Monocef are all false), and the Rx gate
-- (078 section 3) trusts that flag. Of the 700 indian_dataset medicines
-- in live, sellable inventory (seller_hidden = false, not expired —
-- all Sarthak Medical today), 689 were flagged OTC, including tramadol,
-- pregabalin, cefixime, escitalopram.
--
-- Conservative rule, applied only to those rows and only in the
-- OTC -> Rx direction (rows already Rx are untouched):
--   stays OTC  = the NAME clearly is a non-drug / supplement / consumable
--                (short allow-list below), AND neither name, salt nor
--                generic_name contains a known-Rx pattern;
--   everything else -> Rx, whether it matched a known-Rx pattern or was
--   just ambiguous (safe default). Salt/generic text is only used to
--   force Rx, never to allow OTC — combos like dicyclomine+simethicone or
--   pregabalin+methylcobalamin otherwise slipped through.
-- The rest of indian_dataset (not in any live inventory) is not touched.
BEGIN;

UPDATE master_medicines m
SET requires_prescription = true
WHERE m.source = 'indian_dataset'
  AND m.requires_prescription = false
  AND EXISTS (
    SELECT 1 FROM seller_inventory si
    WHERE si.medicine_id = m.id
      AND si.seller_hidden = false
      AND inventory_expiry_ok(si.expiry_date)
  )
  AND NOT (
    lower(m.name) ~ '(tooth ?paste|toothbrush|\mtears\M|lubricat|dusting powder|antacid|anti-?dandruff shampoo|probiotic|\mors\M|oral rehydration|electral|zincovit|multivit|sunscreen|moisturi|plaster|bandage|cotton|gauze|mask|thermometer|syringe|glucometer|condom|dettol|savlon|antiseptic|calamine|osmodrops|gutgermina|enteroclausi)'
    AND lower(coalesce(m.name, '') || ' ' || coalesce(m.salt_composition, '') || ' ' || coalesce(m.generic_name, ''))
        !~ '(cillin|mycin|micin|cef|ceph|floxacin|oxacin|cycline|clav|azithro|clarithro|linezolid|nitrofur|metronid|tinidaz|ornidaz|sulfameth|trimeth|acyclo|valacyclo|oseltam|fluconaz|itraconaz|voriconaz|terbinaf|ivermec|albendaz|hydroxychlor|predni|dexameth|dexona|betameth|methylpred|hydrocort|cortil|solone|deflaz|clobeta|mometa|flutica|budeso|beclometh|triamcin|testost|estradi|progest|dydrogest|gestofit|hmg|clomiph|letroz|levonorg|norethist|medroxy|alpraz|clonaz|lorazep|diazep|nitrazep|zolpid|tramad|tapent|codein|morphin|fentan|buprenor|pregab|gabapen|olanz|quetia|risperi|aripip|haloper|escitalo|citalo|sertral|fluoxet|paroxet|duloxet|venlafax|amitrip|nortrip|imipram|mirtaz|lithium|valpro|divalpro|levetir|carbamaz|oxcarb|phenyto|lamotr|topira|donepez|ropinir|pramipex|metform|glimep|glicl|glibencl|sitaglip|vildag|teneligl|linaglip|dapaglif|empaglif|pioglit|voglib|acarbose|insulin|telmis|amlod|losart|olmes|valsart|ramipr|enalapr|atenol|metopro|bisopro|carvedil|nebivol|propranol|cilnid|nifedip|torsem|furosem|spironol|hydrochlorot|chlorthal|indapam|atorvas|rosuvas|simvas|fenofib|clopidog|prasug|ticagr|warfar|acenocou|apixab|rivarox|dabigat|aspirin 75|ecosprin|thyrox|levothy|carbimaz|methimaz|methotrex|tamox|anastroz|hydroxyurea|allopur|febuxo|colchic|sildenaf|tadalaf|tamsul|silodos|finaster|dutaster|ondanset|domperid|metoclop|levosulp|itopr|pantopr|rabepr|esomepr|omepr|lansopr|ranitid|famotid|montelu|levocetir|fexofen|bilast|salbut|levosalb|formot|tiotrop|theophyl|doxofyl|etoricox|aceclof|diclof|nimesul|ketorol|naproxen|piroxic|mefenam|tizanid|thiocolch|chlorzox|baclof|\minj|injection|vial|\mamp\M|respules|rotacap|inhaler)'
  );

COMMIT;
-- <<< SECTION 2
