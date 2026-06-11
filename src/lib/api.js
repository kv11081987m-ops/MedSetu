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
    distance: `~${((index + 1) * 0.8).toFixed(1)} km`,  // placeholder — GPS calc later
    rating:   parseFloat(row.rating)       || 4.0,
    reviews:  row.total_reviews            || 0,
    open:     row.is_open,
    timing:   '8AM – 9PM',
    phone:    row.phone || '',
    district: row.district || '',
    pin:      PINS[index % PINS.length],
  };
}

// Map Supabase medicine row → UI shape used across screens
export function mapMedicine(row) {
  const cat  = (row.category || '').toLowerCase();
  const type = cat.includes('tablet') ? 'tablet'
             : cat.includes('syrup')  ? 'syrup'
             : cat.includes('equip')  ? 'equipment'
             : cat.includes('inject') ? 'injection'
             : cat.includes('powder') ? 'syrup'
             : 'tablet';

  const mrp   = parseFloat(row.mrp)           || 0;
  const price = parseFloat(row.selling_price)  || 0;
  const off   = mrp > 0 ? Math.round((1 - price / mrp) * 100) : 0;

  return {
    id:           row.id,
    name:         row.name,
    brand:        row.brand        || '',
    salt:         row.salt_name    || '',
    mrp,
    price,
    off,
    rxRequired:   row.requires_prescription || false,
    stores:       row.sellers ? 1 : 0,
    storeInfo:    row.sellers || null,
    type,
    stock:        row.stock || 0,
    isAvailable:  row.is_available,
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

// ── Search medicines ───────────────────────────────────────────
export async function searchMedicines(query) {
  const { data, error } = await supabase
    .from('medicines')
    .select(`
      *,
      sellers (
        store_name,
        district,
        rating,
        is_open
      )
    `)
    .ilike('name', `%${query}%`)
    .order('selling_price', { ascending: true });

  return { data: data || [], error };
}

// ── Fetch all available medicines (for home/popular) ──────────
export async function fetchPopularMedicines(limit = 6) {
  const { data, error } = await supabase
    .from('medicines')
    .select('*, sellers(store_name)')
    .order('stock', { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}
