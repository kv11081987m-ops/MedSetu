-- ══════════════════════════════════════════════════
-- MedSetu — salt-based Rx flags for live inventory (follow-up to 080 section 2)
-- Run this in Supabase SQL Editor — ONE SECTION AT A TIME, in order.
-- ══════════════════════════════════════════════════
--
-- Scope: medicines in live, sellable inventory (seller_hidden = false,
-- not expired — all Sarthak Medical on 2026-09-23).
--
--   1. 215 medicines with a FULL salt_composition — 193 indian_dataset rows
--      that carry one, plus 22 seller-source rows that exact-matched (strict
--      DBFviewer/match_inventory_v2.py rule) an indian_dataset row that does.
--      Salt is copied onto those 22; the Rx flag of all 215 is then set FROM
--      THE SALT, not copied from the matched master row: master flags are
--      unreliable (17 of the 22 matches carry false, incl. levofloxacin,
--      apixaban, mupirocin, diclofenac).
--   2. 581 medicines with only a first-ingredient signal (507 indian_dataset
--      with generic_name but no salt; 74 seller-source matched to such rows):
--      Rx is set when that ingredient is a known-Rx molecule. Never set to
--      OTC — a hidden second ingredient could still make it Rx.
-- Everything else stays as-is and goes to pharmacist review
-- (pharmacist_rx_review.csv).


-- >>> SECTION 1
-- ================================================================
-- 1. full-salt medicines — Rx flag from the salt
-- ================================================================
-- salt_is_otc: OTC only when EVERY ingredient is on a short, clearly
-- non-prescription list (vitamins/minerals, ocular lubricants, povidone
-- iodine/chlorhexidine, antacids, probiotics, ORS components) and the
-- product is not an injectable. Potassium salts and anything unlisted
-- stay Rx.
BEGIN;

CREATE OR REPLACE FUNCTION salt_is_otc(p_salt text, p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = public AS $fn$
  SELECT CASE
    WHEN nullif(btrim(coalesce(p_salt, '')), '') IS NULL THEN false
    WHEN lower(coalesce(p_name, '') || ' ' || p_salt) ~ '(\minj|injection|vial|\mamp\M)' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM unnest(string_to_array(p_salt, '+')) AS part
      WHERE btrim(regexp_replace(regexp_replace(lower(part), '\([^)]*\)', ' ', 'g'), '\s+', ' ', 'g')) <> ''
        AND btrim(regexp_replace(regexp_replace(lower(part), '\([^)]*\)', ' ', 'g'), '\s+', ' ', 'g'))
            !~ '^(zinc|calcium|magnesium|iron|ferrous|folic acid|cyanocobalamin|methylcobalamin|vitamin|pyridoxine|niacinamide|biotin|coenzyme q10|levo-?carnitine|l-?carnitine|carboxymethylcellulose|hydroxypropylmethylcellulose|hypromellose|sodium hyaluronate|polyethylene glycol|propylene glycol|glycerin|povidone iodine|chlorhexidine|calamine|simethicone|magaldrate|aluminium hydroxide|magnesium hydroxide|sodium bicarbonate|lactobacillus|bacillus clausii|saccharomyces|sodium chloride|dextrose|oral rehydration)'
    )
  END;
$fn$;

CREATE TEMP TABLE _full_salt_match (seller_id uuid PRIMARY KEY, master_id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO _full_salt_match (seller_id, master_id) VALUES
    ('3abb49e9-a420-4a64-b379-c9a0f341ae1e'::uuid, '6044b84b-6952-4ad8-b05a-762dbdc5775f'::uuid),  -- ZIORAL DROP => Zioral Drops
    ('110c8eb0-7b60-448f-9983-f08dd2bc2257'::uuid, 'd41fa4e9-2add-4f22-9914-d96f3e1b39ab'::uuid),  -- STALOPAM PLUS TAB => Stalopam Plus Tablet
    ('f6bb7958-0201-4fe6-beb2-2feb03e8b528'::uuid, 'f55f64b8-c6eb-427b-8a82-a6878ea4e36c'::uuid),  -- SOFINOX CREAM => Sofinox Cream
    ('c9b3e7cb-28af-4303-b85c-cdd0474bc82f'::uuid, 'd8d10c9d-4b44-4841-a31f-8b6891765c54'::uuid),  -- METOSARTAN 25 TAB => Metosartan 25 Tablet ER
    ('7c9b1cbc-d15c-40fb-9e6a-d9904a4195a2'::uuid, 'd4c9e928-aac3-4bd0-a5ac-5767859b5930'::uuid),  -- DYNAPAR TAB => Dynapar Tablet
    ('0dd6e541-f869-4b76-ae0c-1d86df7c4ed7'::uuid, 'd0add8fe-617b-485c-aedc-c85ebdd2a27a'::uuid),  -- PULMOCLEAR SYP => Pulmoclear  Syrup
    ('d30c7f54-dc84-4b8d-82a7-1ccf13b46104'::uuid, 'a3d8c51f-8bf1-49fc-82f8-f4703272fb88'::uuid),  -- ELIQUIS 2.5 TAB => Eliquis 2.5mg Tablet
    ('86f302ff-98ae-4b81-9693-30239320e2d6'::uuid, '7d66420f-6569-43c8-a8d8-0357698106ec'::uuid),  -- MIRA 25 TAB => Lupin Mira 25 Tablet ER
    ('fde3950e-a400-4d06-8cf5-3bff7e82b3d7'::uuid, 'fbf0c670-3b87-4725-9e0a-ce3623e047c9'::uuid),  -- KETO-B CR. => Keto-B Cream
    ('b12495fc-4868-4d36-88df-0c5b4e82a20e'::uuid, '3ffa63ea-714f-44ce-aaa6-bf1fe208ad48'::uuid),  -- MUPIMET OINT => Mupimet Ointment
    ('6086dbf0-b53f-4402-8c10-1c6146639bca'::uuid, '16b0e09d-410c-48fe-bd6a-de607931cc5a'::uuid),  -- UBEXA 40 TAB => Ubexa 40 Tablet
    ('09cae21e-9adb-44df-b736-bd9a8d1ba513'::uuid, '7b9a636d-1d48-4029-ad21-d6142a03c229'::uuid),  -- L-CIN 500MG TAB => L-Cin 500 Tablet
    ('54fb59d6-610a-4cfc-8d42-de9e0225d32e'::uuid, '5764dd2e-e343-4930-87f2-b37199bf967a'::uuid),  -- MAXTRA ORAL DROP => Maxtra Oral Drops
    ('188e09ae-368c-4f1d-a171-f4d3ffb1bb44'::uuid, 'b142de5a-d21d-4bf0-8fc6-a51959a4e855'::uuid),  -- BETADINE POW => Betadine Powder
    ('b041e5bf-8123-4708-9e83-e6a9bf2bb44a'::uuid, '6280cf74-6a04-4299-8ab2-8bc95dc2fc46'::uuid),  -- WAXIL EAR => Waxil Ear Drop
    ('3f3019e7-e2b0-4148-97a6-386ced25e85c'::uuid, 'ecbf88f5-94c7-4fb0-9a54-6eec1f77f534'::uuid),  -- NUTRIHALE SYP => Nutrihale Syrup
    ('85bb2552-163e-4f2d-aa33-12eb020c404f'::uuid, '7e774b36-ab1d-47f2-8a2a-210563e53e6e'::uuid),  -- K MAC LIQ => K Mac Liquid
    ('6e5d9722-23e6-42dd-b700-b785ef712c8c'::uuid, '196847e6-8f54-4666-aeff-1d8beda57190'::uuid),  -- JECTOCOS PLUS Injection => Jectocos Plus Injection 1.5ml
    ('f296722e-b158-4c97-b495-cfcce357078d'::uuid, '9a44d5be-6ac8-4b41-b95b-019b30fbae35'::uuid),  -- KETO SOAP => Keto Soap
    ('ee042dce-5b98-4df1-b8a8-a7a550e70bff'::uuid, '33b5a7e8-f01c-476a-8f0a-f401164cd14b'::uuid),  -- LACRIGEL => Lacrigel Ocular Lubricant
    ('8d2697e2-d269-4978-9049-214cb70bacb0'::uuid, '8056c489-7e75-4a2e-8719-85a4f31d28e0'::uuid),  -- GLUCONORM G2 TAB => Gluconorm G2 Tablet PR
    ('cb7513e2-c3a3-42f8-b543-3baa7bea7eea'::uuid, '09110925-84d0-4fbf-b9a2-87bda65baf80'::uuid)  -- JANUMET 50/1000 TAB => Janumet 50mg/1000mg Tablet
;

UPDATE master_medicines s
SET salt_composition = t.salt_composition,
    generic_name     = COALESCE(nullif(btrim(t.generic_name), ''), t.salt_composition)
FROM _full_salt_match f
JOIN master_medicines t ON t.id = f.master_id
WHERE s.id = f.seller_id
  AND s.source = 'seller';

UPDATE master_medicines m
SET requires_prescription = NOT salt_is_otc(m.salt_composition, m.name)
WHERE (
        m.id IN (SELECT seller_id FROM _full_salt_match)
     OR (m.source = 'indian_dataset'
         AND nullif(btrim(m.salt_composition), '') IS NOT NULL
         AND EXISTS (SELECT 1 FROM seller_inventory si
                     WHERE si.medicine_id = m.id AND si.seller_hidden = false
                       AND inventory_expiry_ok(si.expiry_date)))
      )
  AND m.requires_prescription IS DISTINCT FROM NOT salt_is_otc(m.salt_composition, m.name);

COMMIT;
-- <<< SECTION 1


-- >>> SECTION 2
-- ================================================================
-- 2. first-ingredient-only medicines — Rx when that ingredient is Rx
-- ================================================================
-- Same known-Rx molecule pattern as 080 section 2, matched against the
-- first-ingredient text only. Only ever sets true.
BEGIN;

CREATE TEMP TABLE _first_ingredient (seller_id uuid PRIMARY KEY, first_ingredient text NOT NULL) ON COMMIT DROP;
INSERT INTO _first_ingredient (seller_id, first_ingredient) VALUES
    ('83ed73b5-336a-4d1c-a9e3-790208f57e60'::uuid, 'Chlorpheniramine Maleate (1mg)'),  -- FEBREX PLUS ORAL DROP => Febrex Plus Oral Drops
    ('1740e9ca-7f4c-446b-a987-ed0818681517'::uuid, 'Glimepiride (3mg)'),  -- GLUCONORM G-3 FORTE => Gluconorm-G 3 Forte Tablet PR
    ('55e084c3-39a3-4070-94d7-6c5d08bda3c6'::uuid, 'Azithromycin (200mg/5ml)'),  -- ZATHRIN 200 READYMIX => Zathrin 200 Readymix Oral Suspension
    ('f007379b-8aa1-4ba2-823a-854769c00598'::uuid, 'Itraconazole (200mg)'),  -- ZITRAN 200 CAP => Zitran 200 Capsule
    ('40b0ae57-ee84-4f73-8176-6cc96694f98d'::uuid, 'Trimetazidine (60mg)'),  -- CARVIDON OD TAB => Carvidon-OD Tablet MR
    ('7b8c1ba7-572b-4656-a13e-397688540170'::uuid, 'Butyl Alcohol (52mg/ml)'),  -- REVICI Injection => Revici Injection 5ml
    ('69e22c86-7f69-482c-91b1-79136de5f839'::uuid, 'Domperidone (30mg)'),  -- ZIPANT-DSR CAP => Zipant-DSR Capsule
    ('bf4bbd7b-bdd5-4658-9325-98736631a360'::uuid, 'Olmesartan Medoxomil (40mg)'),  -- OLMAT-40 TAB => Olmat 40 Tablet
    ('8d89deb7-fbb9-4083-9c9f-50faec8be06b'::uuid, 'Iron (50mg)'),  -- JECTOCOS Injection => Jectocos Injection 1.5ml
    ('1db64455-230c-4915-8452-f4f889a242ba'::uuid, 'Glimepiride (2mg)'),  -- SWITGLIM-M 2/1000 TAB => Switglim-M 2/1000 Tablet PR
    ('375545e7-67ee-4788-b159-c7a4641096b8'::uuid, 'Amoxycillin  (200mg)'),  -- THEMICLAV DS => Themiclav DS Dry Syrup
    ('8e09cb6e-1a6c-45ae-aaa1-589ddd355fd3'::uuid, 'Itraconazole (100mg)'),  -- ZITRAN 100 CAP => Zitran 100 Capsule
    ('38924952-1844-4a7d-b828-ffcfd239b53d'::uuid, 'Glimepiride (1mg)'),  -- GLADOR M1 TAB => Glador M1 Tablet PR
    ('8c14d425-8951-46d7-8c28-233c5d9acf67'::uuid, 'Rabeprazole (20mg)'),  -- REKOOL IT CAP => Rekool-IT Capsule PR
    ('a28ec4d9-cb13-452a-a7b7-cc46d7c7f21e'::uuid, 'Carboxymethylcellulose (1% w/v)'),  -- MOSS FRESH GEL => Moss Fresh Gel Eye Drop
    ('484bbd7f-36bd-42db-9c86-99fe75050478'::uuid, 'Cefixime (50mg/5ml)'),  -- ZIFI 50 DRY SYP => Zifi 50 Dry Syrup
    ('3334c1f7-fe68-4c04-b30d-03773e711f19'::uuid, 'Benzydamine (0.15% w/v)'),  -- COOLORA => Coolora Mouth Wash
    ('6cb159d3-f1f0-4f8c-a956-22ae43caf808'::uuid, 'Paracetamol (500mg)'),  -- XYKAA 500 TAB => Xykaa 500 Tablet
    ('a3076193-a725-4bf8-85c9-14984dc388b6'::uuid, 'Rosuvastatin (10mg)'),  -- ROSYCAP-10 TAB => Rosycap 10 Tablet
    ('b14cfd4f-160c-489c-b6a4-feaf6968b217'::uuid, 'Empagliflozin (12.5mg)'),  -- GIBTULIO MET 12.5MG+500MG T => Gibtulio Met 12.5mg/500mg Tablet
    ('aa73f4f3-8f52-44fc-a50c-a57df47ee75d'::uuid, 'Chlorhexidine Gluconate (1% w/w)'),  -- HEXIGEL => Hexigel Mouth Gel
    ('e89a7b10-c642-4604-aef6-a71c90998489'::uuid, 'Sodium Hyaluronate (0.18% w/v)'),  -- SOHA LIQUIGEL => Soha Liquigel
    ('dacee088-13c4-4587-8a2a-1d119845fa10'::uuid, 'Lacosamide (200mg)'),  -- LACONEXT 200 TAB => Laconext 200 Tablet
    ('2edad715-d3f1-4432-b1ea-2ae4e1333063'::uuid, 'Cilnidipine (10mg)'),  -- CETANIL TM 50 TAB => Cetanil-TM 50 Tablet ER
    ('218ed40a-3782-4a7f-adc6-e4999feac524'::uuid, 'Paracetamol (250mg)'),  -- P-250 TAB => P 250 Tablet DT
    ('22c14721-e49b-4945-9b86-d6f29fbdea33'::uuid, 'Cilnidipine (20mg)'),  -- NULONG 20 TAB => Nulong 20 Tablet
    ('7f7f757a-d70b-48b6-8217-4a9f9a925aa5'::uuid, 'Cefuroxime (125mg)'),  -- CETIL DRY SYP => Cetil Dry Syrup
    ('8da0a487-1053-42ba-82c1-79112c3eed67'::uuid, 'Budesonide (0.5mg)'),  -- BUDATE TRANSPULES => Budate Transpules
    ('9b19cde1-4106-4477-b251-14015fa2a33c'::uuid, 'Ambroxol (7.5mg/ml)'),  -- BROZEET LS DROP => Brozeet-LS Drops
    ('0885bf48-267e-4c9b-9d11-d925cf9cb5c7'::uuid, 'Diltiazem (180mg)'),  -- DILZEM CD 180 CAP => Dilzem CD 180 Capsule ER
    ('0de08d30-cabb-4f4e-b871-c1ab968d2097'::uuid, 'Fluconazole (2% w/w)'),  -- ZOCON DUSTING POW => Zocon Dusting Powder
    ('23844326-056d-4568-af3b-8916dc18df27'::uuid, 'Amoxycillin  (250mg)'),  -- FLEMICLAV 375 TAB => Flemiclav 375 Tablet
    ('e74c76e7-acd3-42c2-9e43-0435e85d5222'::uuid, 'Montelukast (4mg)'),  -- TELEKAST 4 CHEW => Telekast 4 Chewable Tablet
    ('b5329a90-1aff-42e6-b4d7-ab6de35a3f8d'::uuid, 'Levofloxacin (250mg)'),  -- L-CIN 250MG => L-Cin 250mg Tablet
    ('45d2fd58-3ce9-4bbb-979d-a02d40d99c36'::uuid, 'Atorvastatin (20mg)'),  -- TONACT EZ 20 TAB => Tonact 20-EZ Tablet
    ('91a4588d-8b88-49d7-bc60-f79d22c7d7f8'::uuid, 'Formoterol (20mcg)'),  -- BUDAMATE NEB 1MG => Budamate Neb 1mg Respules 2ml
    ('c1839abc-68d4-43c5-ad82-3de047842bbd'::uuid, 'Clotrimazole (1% w/v)'),  -- CLOTRIN LOTION => Clotrin Lotion
    ('a9ce3c52-3d79-415d-8285-3451af7db61a'::uuid, 'IV Cannula Fixator (Medium 6cm x 5cm)'),  -- FIXATOR => IV Cannula Fixator (Medium 6cm x 5cm)
    ('4d71e3ba-b1fd-4539-9f5b-2cbe9476f2fa'::uuid, 'Glimepiride (1mg)'),  -- SWITGLIM-M 1/1000 TAB => Switglim-M 1/1000 Tablet PR
    ('c80c002b-95e2-4bf7-8629-27a52cd87bf7'::uuid, 'Rosuvastatin (10mg)'),  -- ROSYCAP-ASP 10/75 CAP => Rosycap-ASP 10/75 Capsule
    ('d346342a-9ed8-44fe-acc0-64710c386dc2'::uuid, 'Domperidone (30mg)'),  -- P2i D CAP => P2i-D Capsule PR
    ('a0066d91-6035-435c-ab2e-e119758568ae'::uuid, 'Aspirin (75mg)'),  -- ROSYCAP-GOLD 10-75 CAP => Rosycap-Gold 10/75 Capsule
    ('83834fc5-c24f-40cf-b9be-fa97ba87a63d'::uuid, 'Levosalbutamol (0.63mg)'),  -- SALBAIR NEB TRANSPULES 0.63 => Salbair Neb 0.63 Transpules
    ('d364cb0f-6ac9-4795-b71c-bd56f9ca0e22'::uuid, 'Glimepiride (1mg)'),  -- DIAPRIDE M1 TAB => Diapride M1 Tablet PR
    ('6cd93d52-7780-47b6-8f17-2b11f31dc747'::uuid, 'Pantoprazole (40mg)'),  -- ZIPANT 40 TAB => Zipant 40 Tablet
    ('ed14f478-8129-4e6b-953f-7035c3104066'::uuid, 'Tetrabenazine (25mg)'),  -- ATREST 25 TAB => Atrest 25 Tablet
    ('28fb9bd5-2fc2-4361-a088-a2094dfdfde2'::uuid, 'Glimepiride (2mg)'),  -- DIAPRIDE M2 TAB => Diapride M2 Tablet PR
    ('26256a6f-9081-41fd-a2b9-88b4e68e187b'::uuid, 'Diltiazem (120mg)'),  -- DILZEM CD 120 CAP => Dilzem CD 120 Capsule ER
    ('75331cf9-4e73-4a33-b11c-4ad76ff3381c'::uuid, 'Carvedilol (6.25mg)'),  -- CARVISTAR 6.25 TAB => Carvistar 6.25 Tablet
    ('e0a6bf0a-5889-481d-9d6f-cc12521af381'::uuid, 'Glimepiride (2mg)'),  -- GLUCONORM G2 FORTE TAB => Gluconorm G2 Forte Tablet PR
    ('72772f99-a39f-4165-a68b-47264b884daf'::uuid, 'Luliconazole (1% w/w)'),  -- ZOCON L CREAM => Zocon L Cream
    ('28d2ef87-5da3-47ae-b7ba-def7e4fde0d7'::uuid, 'Glimepiride (2mg)'),  -- GLISEN MF 2 TAB => Glisen MF 2 Tablet PR
    ('4449472c-70d0-4d50-b18f-61b780127ff3'::uuid, 'Cilnidipine (10mg)'),  -- CETANIL TM 25 TAB => Cetanil-TM 25 Tablet ER
    ('8062760c-d231-4960-9da4-d46cee97d2b0'::uuid, 'Chlorpheniramine Maleate (2mg/ml)'),  -- WIKORYL AF DROP => Wikoryl AF Drops
    ('f7c1dd2c-38b9-459b-af44-54bff5c77b6a'::uuid, 'Olmesartan Medoxomil (20mg)'),  -- OLMAT MT 50 TAB => Olmat MT 50 Tablet ER
    ('a79153fb-6383-42f0-af1e-c9e5b60e0e1d'::uuid, 'Sodium Chloride (0.65% w/v)'),  -- MAXTRA S NASAL SPRAY => Maxtra-S Nasal Spray
    ('84b9e6eb-e65c-46c1-abe8-cd48fd54c7bd'::uuid, 'Telmisartan (40mg)'),  -- TELSAR 40 TAB => Telsar 40 Tablet
    ('71cd8da2-fded-4034-88c1-724de6887192'::uuid, 'Ketoconazole (2% w/w)'),  -- KETO CREAM => Keto Cream
    ('7491a3ae-842f-41c6-976e-ed939685ac58'::uuid, 'Polyethylene Glycol (0.4% w/v)'),  -- SYSTANE GEL => Systane Gel Drop Lubricant Eye Gel
    ('ff9e8f3e-bedb-41b3-8c5a-d841036512d5'::uuid, 'Montelukast (5mg)'),  -- TELEKAST 5 CHEW => Telekast 5 Chewable Tablet
    ('bfcfc253-ea35-4b91-8090-aabdc4ccaa07'::uuid, 'Paracetamol (650mg)'),  -- MEDOMOL 650 TAB => Medomol 650 Tablet
    ('675e70bd-5f62-4fb2-b683-7ed29c290fe2'::uuid, 'Azithromycin (250mg)'),  -- NUAZY 250 TAB => Nuazy 250mg Tablet
    ('1e08c30b-d879-4dbf-8951-3da65d21a75e'::uuid, 'Ambroxol (15mg/5ml)'),  -- KUFRIL SYP => Kufril Syrup
    ('0dee7e86-8530-465a-9bf4-d1f4d624662c'::uuid, 'Benidipine (4mg)'),  -- BENITOWA BETA 50 TAB => Benitowa-Beta 50 Tablet ER
    ('ad26f5b0-c786-42d0-bf2d-0aee6863b010'::uuid, 'Ambroxol (15mg/5ml)'),  -- LCF KID EXP => Advanced LCF Kid Expectorant
    ('fa82e858-4ea8-46a5-aeb2-4bbd74a7cfa4'::uuid, 'Acyclovir (5% w/w)'),  -- OCUVIR SKIN CREAM => Ocuvir Skin Cream
    ('87edeb94-b393-4b78-99e7-511a29fe0345'::uuid, 'Mucopolysaccharide Polysulfate (250IU/gm)'),  -- HIRUDAL CREAM => Hirudal Cream
    ('42f60484-6d58-4168-a55a-23e8be8915ae'::uuid, 'Cilnidipine (10mg)'),  -- NULONG 10 TAB => Nulong 10 Tablet
    ('3873fb2b-f530-4ebb-9de2-8d2cbcb19085'::uuid, 'Pantoprazole (40mg)'),  -- P 40 TAB => P 40 Tablet
    ('69790ece-ed85-430c-8e4b-504f96a43c6a'::uuid, 'Pioglitazone (15mg)'),  -- GLUCONORM P-15 => Gluconorm P 15 Tablet ER
    ('fc660f8f-ec32-432c-90eb-ee5a7ea56183'::uuid, 'Chlorpheniramine Maleate (1mg/5ml)'),  -- FEBREX PLUS SYP => Febrex Plus Syrup
    ('77e8456c-652f-43d3-875e-a81e08f44372'::uuid, 'Cefixime (400mg)'),  -- ZIFI 400 TAB => Zifi 400 Tablet
    ('55aa0958-52f6-4a83-93c2-2ee9ae07897c'::uuid, 'Dorzolamide (2% w/v)'),  -- DORZOX T PF => Dorzox T  PF Eye Drop
    ('ea50f9f2-6d22-4dc7-a164-7c1304596666'::uuid, 'Pregabalin (75mg)')  -- PREGABA-D 75/20 CAP => Pregaba-D 75/20 Capsule DR
;

UPDATE master_medicines m
SET requires_prescription = true
WHERE m.requires_prescription = false
  AND (
        EXISTS (SELECT 1 FROM _first_ingredient f
                WHERE f.seller_id = m.id AND lower(f.first_ingredient) ~ '(cillin|mycin|micin|cef|ceph|floxacin|oxacin|cycline|clav|azithro|clarithro|linezolid|nitrofur|metronid|tinidaz|ornidaz|sulfameth|trimeth|acyclo|valacyclo|oseltam|fluconaz|itraconaz|voriconaz|terbinaf|ivermec|albendaz|hydroxychlor|predni|dexameth|dexona|betameth|methylpred|hydrocort|cortil|solone|deflaz|clobeta|mometa|flutica|budeso|beclometh|triamcin|testost|estradi|progest|dydrogest|gestofit|hmg|clomiph|letroz|levonorg|norethist|medroxy|alpraz|clonaz|lorazep|diazep|nitrazep|zolpid|tramad|tapent|codein|morphin|fentan|buprenor|pregab|gabapen|olanz|quetia|risperi|aripip|haloper|escitalo|citalo|sertral|fluoxet|paroxet|duloxet|venlafax|amitrip|nortrip|imipram|mirtaz|lithium|valpro|divalpro|levetir|carbamaz|oxcarb|phenyto|lamotr|topira|donepez|ropinir|pramipex|metform|glimep|glicl|glibencl|sitaglip|vildag|teneligl|linaglip|dapaglif|empaglif|pioglit|voglib|acarbose|insulin|telmis|amlod|losart|olmes|valsart|ramipr|enalapr|atenol|metopro|bisopro|carvedil|nebivol|propranol|cilnid|nifedip|torsem|furosem|spironol|hydrochlorot|chlorthal|indapam|atorvas|rosuvas|simvas|fenofib|clopidog|prasug|ticagr|warfar|acenocou|apixab|rivarox|dabigat|aspirin 75|ecosprin|thyrox|levothy|carbimaz|methimaz|methotrex|tamox|anastroz|hydroxyurea|allopur|febuxo|colchic|sildenaf|tadalaf|tamsul|silodos|finaster|dutaster|ondanset|domperid|metoclop|levosulp|itopr|pantopr|rabepr|esomepr|omepr|lansopr|ranitid|famotid|montelu|levocetir|fexofen|bilast|salbut|levosalb|formot|tiotrop|theophyl|doxofyl|etoricox|aceclof|diclof|nimesul|ketorol|naproxen|piroxic|mefenam|tizanid|thiocolch|chlorzox|baclof|\minj|injection|vial|\mamp\M|respules|rotacap|inhaler)')
     OR (m.source = 'indian_dataset'
         AND nullif(btrim(m.salt_composition), '') IS NULL
         AND lower(coalesce(m.generic_name, '')) ~ '(cillin|mycin|micin|cef|ceph|floxacin|oxacin|cycline|clav|azithro|clarithro|linezolid|nitrofur|metronid|tinidaz|ornidaz|sulfameth|trimeth|acyclo|valacyclo|oseltam|fluconaz|itraconaz|voriconaz|terbinaf|ivermec|albendaz|hydroxychlor|predni|dexameth|dexona|betameth|methylpred|hydrocort|cortil|solone|deflaz|clobeta|mometa|flutica|budeso|beclometh|triamcin|testost|estradi|progest|dydrogest|gestofit|hmg|clomiph|letroz|levonorg|norethist|medroxy|alpraz|clonaz|lorazep|diazep|nitrazep|zolpid|tramad|tapent|codein|morphin|fentan|buprenor|pregab|gabapen|olanz|quetia|risperi|aripip|haloper|escitalo|citalo|sertral|fluoxet|paroxet|duloxet|venlafax|amitrip|nortrip|imipram|mirtaz|lithium|valpro|divalpro|levetir|carbamaz|oxcarb|phenyto|lamotr|topira|donepez|ropinir|pramipex|metform|glimep|glicl|glibencl|sitaglip|vildag|teneligl|linaglip|dapaglif|empaglif|pioglit|voglib|acarbose|insulin|telmis|amlod|losart|olmes|valsart|ramipr|enalapr|atenol|metopro|bisopro|carvedil|nebivol|propranol|cilnid|nifedip|torsem|furosem|spironol|hydrochlorot|chlorthal|indapam|atorvas|rosuvas|simvas|fenofib|clopidog|prasug|ticagr|warfar|acenocou|apixab|rivarox|dabigat|aspirin 75|ecosprin|thyrox|levothy|carbimaz|methimaz|methotrex|tamox|anastroz|hydroxyurea|allopur|febuxo|colchic|sildenaf|tadalaf|tamsul|silodos|finaster|dutaster|ondanset|domperid|metoclop|levosulp|itopr|pantopr|rabepr|esomepr|omepr|lansopr|ranitid|famotid|montelu|levocetir|fexofen|bilast|salbut|levosalb|formot|tiotrop|theophyl|doxofyl|etoricox|aceclof|diclof|nimesul|ketorol|naproxen|piroxic|mefenam|tizanid|thiocolch|chlorzox|baclof|\minj|injection|vial|\mamp\M|respules|rotacap|inhaler)'
         AND EXISTS (SELECT 1 FROM seller_inventory si
                     WHERE si.medicine_id = m.id AND si.seller_hidden = false
                       AND inventory_expiry_ok(si.expiry_date)))
      );

COMMIT;
-- <<< SECTION 2
