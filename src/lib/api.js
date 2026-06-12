import { supabase } from './supabase';

// Map Supabase seller row → UI shape used across screens
export function mapSeller(row, index = 0) {
  const words    = (row.store_name || '').split(' ');
  const initials = words.slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
  // Fixed mock-map pin positions (cycled if more than 3 stores)
  const PINS = [
    { top: '38%', left: '52%' },
    { top: '55%', left: '30%' },
    { top: '25%', left: '72%' },
    { top: '60%', left: '65%' },
    { top: '45%', left: '20%' },
  ];
  return {
    id:       row.id,
    initials,
    name:     row.store_name,
    address:  row.address || row.district || '',
    distance: null,
    rating:   parseFloat(row.rating)       || 4.0,
    reviews:  row.total_reviews            || 0,
    open:     row.is_open,
    timing:   '8AM – 9PM',
    phone:    row.phone || '',
    district: row.district || '',
    pin:      PINS[index % PINS.length],
  };
}

// Map master_medicines row → UI shape used across screens
export function mapMedicine(row) {
  const df   = (row.dosage_form || '').toLowerCase();
  const type = df.includes('tablet') || df.includes('capsule') ? 'tablet'
             : df.includes('syrup')  || df.includes('suspension') || df.includes('liquid') ? 'syrup'
             : df.includes('inject') ? 'injection'
             : df.includes('inhaler') ? 'injection'
             : df.includes('powder') ? 'syrup'
             : 'tablet';

  const mrp = parseFloat(row.mrp_max) || 0;

  return {
    id:          row.id,
    name:        row.name,
    brand:       row.brand_names || row.manufacturer || '',
    salt:        row.generic_name || row.salt_composition || '',
    mrp,
    price:       mrp,
    off:         0,
    rxRequired:  row.requires_prescription || false,
    stores:      1,
    storeInfo:   null,
    type,
    is_generic:  row.is_generic || false,
  };
}

// ── Fetch sellers by district ──────────────────────────────────
export async function fetchSellers(district = 'Deoria') {
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('district', district)
    .order('rating', { ascending: false });

  return { data: data || [], error };
}

// ── Search medicines — 3 sections: branded / generic / janaushadhi ──
export async function searchMedicines(query) {
  const empty = { branded: [], generic: [], janaushadhi: [] };
  if (!query || query.length < 2) return empty;

  const filter =
    `name.ilike.%${query}%,` +
    `generic_name.ilike.%${query}%,` +
    `salt_composition.ilike.%${query}%`;

  const [janRes, genericRes, brandedRes] = await Promise.all([
    supabase.from('master_medicines').select('*').or(filter)
      .eq('is_active', true).eq('source', 'janaushadhi').gt('mrp_max', 0)
      .order('mrp_max', { ascending: true }).limit(5),
    supabase.from('master_medicines').select('*').or(filter)
      .eq('is_active', true).eq('is_generic', true).neq('source', 'janaushadhi').gt('mrp_max', 0)
      .order('mrp_max', { ascending: true }).limit(5),
    supabase.from('master_medicines').select('*').or(filter)
      .eq('is_active', true).eq('is_generic', false).gt('mrp_max', 0)
      .order('mrp_max', { ascending: false }).limit(5),
  ]);

  return {
    janaushadhi: janRes.data     || [],
    generic:     genericRes.data || [],
    branded:     brandedRes.data || [],
  };
}

// ── Rate per dose ─────────────────────────────────────────────
export function getRatePerDose(med) {
  const price = parseFloat(med.mrp_max || med.mrp) || 0;
  const pack  = (med.unit || med.pack_size_label || '').toLowerCase();

  const tabMatch = pack.match(/(\d+)\s*tab/i) || pack.match(/strip of (\d+)/i);
  if (tabMatch) {
    const count = parseInt(tabMatch[1]);
    return { perDose: (price / count).toFixed(2), unit: 'tablet', total: count };
  }

  const mlMatch = pack.match(/(\d+)\s*ml/i);
  if (mlMatch) {
    const ml = parseInt(mlMatch[1]);
    return { perDose: (price / ml).toFixed(2), unit: 'ml', total: ml };
  }

  return { perDose: price.toFixed(2), unit: 'unit', total: 1 };
}

// ── Fetch popular medicines (for home/search landing) ─────────
export async function fetchPopularMedicines(limit = 12) {
  const { data, error } = await supabase
    .from('master_medicines')
    .select('*')
    .eq('is_active', true)
    .gt('mrp_max', 0)
    .order('mrp_max', { ascending: true })
    .limit(limit);

  if (error) return { data: [], error };
  return { data: data || [], error: null };
}
