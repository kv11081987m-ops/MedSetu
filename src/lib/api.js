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

// ── Search medicines (master_medicines, 248K) ─────────────────
export async function searchMedicines(query) {
  if (!query || query.length < 2) return { data: [], error: null };

  const { data, error } = await supabase
    .from('master_medicines')
    .select('*')
    .or(
      `name.ilike.%${query}%,` +
      `generic_name.ilike.%${query}%,` +
      `salt_composition.ilike.%${query}%`
    )
    .eq('is_active', true)
    .order('name')
    .limit(50);

  if (error) { console.error(error); return { data: [], error }; }

  const seen = new Set();
  const unique = (data || []).filter(med => {
    const key = med.name.toLowerCase().split(' ')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { data: unique.slice(0, 20), error: null };
}

// ── Fetch popular medicines (for home/search landing) ─────────
export async function fetchPopularMedicines(limit = 12) {
  const { data, error } = await supabase
    .from('master_medicines')
    .select('*')
    .eq('is_active', true)
    .order('mrp_max', { ascending: true })
    .limit(limit);

  if (error) return { data: [], error };
  return { data: data || [], error: null };
}
