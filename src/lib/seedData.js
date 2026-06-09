import { supabase } from './supabase';

export const insertSeedData = async () => {
  console.log('🌱 Seed data insert ho raha hai...');

  // ── 1. Sellers ──────────────────────────────────────────────
  const { data: sellers, error: sellerErr } = await supabase
    .from('sellers')
    .insert([
      {
        store_name:       'Shri Ram Medical Store',
        owner_name:       'Ram Prasad Gupta',
        phone:            '9876543210',
        address:          'Civil Lines, Deoria',
        district:         'Deoria',
        drug_license:     'UP-DL-2024-001',
        pharmacist_name:  'Ravi Sharma',
        approval_status:  'approved',
        is_open:          true,
        rating:           4.5,
        total_reviews:    12,
        latitude:         26.5034,
        longitude:        83.7813,
      },
      {
        store_name:       'Arogya Medical Hall',
        owner_name:       'Suresh Kumar',
        phone:            '9876543211',
        address:          'Station Road, Deoria',
        district:         'Deoria',
        drug_license:     'UP-DL-2024-002',
        pharmacist_name:  'Anjali Singh',
        approval_status:  'approved',
        is_open:          true,
        rating:           4.2,
        total_reviews:    8,
        latitude:         26.5014,
        longitude:        83.7823,
      },
      {
        store_name:       'Gupta Medical Agency',
        owner_name:       'Mahesh Gupta',
        phone:            '9876543212',
        address:          'Collector Ganj, Deoria',
        district:         'Deoria',
        drug_license:     'UP-DL-2024-003',
        pharmacist_name:  'Priya Verma',
        approval_status:  'approved',
        is_open:          false,
        rating:           4.8,
        total_reviews:    24,
        latitude:         26.5044,
        longitude:        83.7793,
      },
    ])
    .select();

  if (sellerErr) {
    console.error('❌ Sellers insert failed:', sellerErr.message);
    return;
  }
  console.log('✅ Sellers inserted:', sellers?.length);

  // ── 2. Medicines ────────────────────────────────────────────
  if (!sellers || sellers.length === 0) {
    console.warn('⚠️ Sellers nahi mile — medicines skip');
    return;
  }

  const [s0, s1, s2] = sellers;

  const { error: medErr } = await supabase.from('medicines').insert([
    {
      seller_id:            s0.id,
      name:                 'Paracetamol 500mg',
      brand:                'Crocin',
      salt_name:            'Acetaminophen',
      category:             'Tablets',
      mrp:                  35.00,
      selling_price:        29.75,
      stock:                45,
      unit:                 'strips',
      requires_prescription: false,
      is_available:         true,
    },
    {
      seller_id:            s0.id,
      name:                 'Azithromycin 500mg',
      brand:                'Azee',
      salt_name:            'Azithromycin',
      category:             'Tablets',
      mrp:                  95.00,
      selling_price:        85.00,
      stock:                8,
      unit:                 'strips',
      requires_prescription: true,
      is_available:         true,
    },
    {
      seller_id:            s1.id,
      name:                 'ORS Powder',
      brand:                'Electral',
      salt_name:            'Electrolytes',
      category:             'Powder',
      mrp:                  18.00,
      selling_price:        15.00,
      stock:                0,
      unit:                 'packets',
      requires_prescription: false,
      is_available:         false,
    },
    {
      seller_id:            s1.id,
      name:                 'Digital BP Machine',
      brand:                'Omron HEM-7120',
      salt_name:            null,
      category:             'Equipment',
      mrp:                  1499.00,
      selling_price:        1299.00,
      stock:                3,
      unit:                 'units',
      requires_prescription: false,
      is_available:         true,
    },
    {
      seller_id:            s2.id,
      name:                 'Dolo 650mg',
      brand:                'Micro Labs',
      salt_name:            'Paracetamol',
      category:             'Tablets',
      mrp:                  32.00,
      selling_price:        28.00,
      stock:                23,
      unit:                 'strips',
      requires_prescription: false,
      is_available:         true,
    },
    {
      seller_id:            s2.id,
      name:                 'Amoxicillin 500mg',
      brand:                'Mox',
      salt_name:            'Amoxicillin',
      category:             'Tablets',
      mrp:                  95.00,
      selling_price:        78.00,
      stock:                15,
      unit:                 'strips',
      requires_prescription: true,
      is_available:         true,
    },
  ]);

  if (medErr) {
    console.error('❌ Medicines insert failed:', medErr.message);
    return;
  }

  console.log('✅ Medicines inserted!');
  console.log('🎉 Seed data complete! Ab dobara mat chalao (duplicate honge).');
};
