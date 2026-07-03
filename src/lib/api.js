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

// ── Support WhatsApp number (platform_settings) ─────────────────
// Falls back to the old hardcoded number if the column/row isn't there.
const FALLBACK_SUPPORT_WHATSAPP = '919196103234';
export async function fetchSupportWhatsapp() {
  const { data } = await supabase
    .from('platform_settings')
    .select('support_whatsapp')
    .eq('id', 1)
    .maybeSingle();
  return data?.support_whatsapp || FALLBACK_SUPPORT_WHATSAPP;
}

// ── Fetch sellers by district ──────────────────────────────────
export async function fetchSellers(district = 'Deoria') {
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('district', district)
    .eq('seller_type', 'retailer')
    .order('rating', { ascending: false });

  return { data: data || [], error };
}

// ── Fetch wholesalers by district ─────────────────────────────
export async function fetchWholesalers(district = 'Deoria') {
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('district', district)
    .eq('seller_type', 'wholesaler')
    .order('rating', { ascending: false });

  return { data: data || [], error };
}

// ── Search medicines — 3 sections: branded / generic / janaushadhi ──
// Only medicines stocked by at least one seller are shown.
// TODO: if availableIds grows to thousands, replace .in() with a Postgres RPC for performance.
export async function searchMedicines(query) {
  const empty = { branded: [], generic: [], janaushadhi: [] };
  if (!query || query.length < 2) return empty;

  const { data: invData } = await supabase
    .from('seller_inventory')
    .select('medicine_id')
    .eq('is_available', true)
    .gt('stock_quantity', 0);
  const availableIds = [...new Set((invData || []).map(r => r.medicine_id).filter(Boolean))];
  if (availableIds.length === 0) return empty;

  const filter =
    `name.ilike.%${query}%,` +
    `generic_name.ilike.%${query}%,` +
    `salt_composition.ilike.%${query}%`;

  const [janRes, genericRes, brandedRes] = await Promise.all([
    supabase.from('master_medicines').select('*').or(filter)
      .eq('is_active', true).eq('source', 'janaushadhi').gt('mrp_max', 0)
      .in('id', availableIds).order('mrp_max', { ascending: true }).limit(5),
    supabase.from('master_medicines').select('*').or(filter)
      .eq('is_active', true).eq('is_generic', true).neq('source', 'janaushadhi').gt('mrp_max', 0)
      .in('id', availableIds).order('mrp_max', { ascending: true }).limit(5),
    supabase.from('master_medicines').select('*').or(filter)
      .eq('is_active', true).eq('is_generic', false).gt('mrp_max', 0)
      .in('id', availableIds).order('mrp_max', { ascending: false }).limit(5),
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

// ── Sellers stocking a specific medicine (medicine-first order flow) ──
export async function fetchSellersForMedicine(medicineId) {
  if (!medicineId) return [];
  const { data, error } = await supabase
    .from('seller_inventory')
    .select('selling_price, stock_quantity, reserved_quantity, sellers(id, store_name, address, phone, rating, is_open, seller_type)')
    .eq('medicine_id', medicineId)
    .eq('is_available', true)
    .order('selling_price', { ascending: true });
  if (error) { console.error('fetchSellersForMedicine error:', error); return []; }
  return (data || [])
    .map((row) => ({ ...row, available: (row.stock_quantity || 0) - (row.reserved_quantity || 0) }))
    .filter((row) => row.available > 0 && row.sellers?.seller_type === 'retailer');
}

// ── Fetch popular medicines (for home/search landing) ─────────
// Only medicines stocked by at least one seller are shown.
// TODO: if availableIds grows to thousands, replace .in() with a Postgres RPC for performance.
export async function fetchPopularMedicines(limit = 12) {
  const { data: invData } = await supabase
    .from('seller_inventory')
    .select('medicine_id')
    .eq('is_available', true)
    .gt('stock_quantity', 0);
  const availableIds = [...new Set((invData || []).map(r => r.medicine_id).filter(Boolean))];
  if (availableIds.length === 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from('master_medicines')
    .select('*')
    .eq('is_active', true)
    .gt('mrp_max', 0)
    .in('id', availableIds)
    .order('mrp_max', { ascending: true })
    .limit(limit);

  if (error) return { data: [], error };
  return { data: data || [], error: null };
}
