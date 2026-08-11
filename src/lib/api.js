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
  // row.sellerPrice (attached by searchMedicines/fetchPopularMedicines —
  // cheapest available seller's real price, seller-grounded in both
  // mrp_mode states) is what checkout will actually charge — that's what
  // a card should show (R3-A). mrp_max is only a fallback for a caller
  // that hasn't resolved one, keeping this function safe standalone.
  const price = row.sellerPrice != null ? row.sellerPrice : mrp;

  return {
    id:          row.id,
    name:        row.name,
    brand:       row.brand_names || row.manufacturer || '',
    salt:        row.generic_name || row.salt_composition || '',
    strength:    row.strength || '',
    mrp,
    price,
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

// ── MRP Mode flag (platform_settings) ────────────────────────────
// Shared read used by every seller-side screen that needs to know
// whether to collect MRP instead of selling_price. Missing row/column
// (migration not yet run) falls back to false — old selling_price flow.
export async function fetchMrpMode() {
  const { data } = await supabase
    .from('platform_settings')
    .select('mrp_mode')
    .eq('id', 1)
    .maybeSingle();
  return !!data?.mrp_mode;
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

// ── Shared: cheapest-available-seller raw price per medicine, from a
// seller_inventory batch already fetched for availableIds filtering
// (searchMedicines/fetchPopularMedicines below) — avoids a second,
// per-card fetch just to show a real, seller-grounded price (R3-A).
// mrp_mode OFF: selling_price is already the real transactable price.
// mrp_mode ON: raw seller mrp only — combined with master's mrp_max via
// effectiveMrp() in attachSellerPrice() below, once each medicine's own
// mrp_max is known (same "seller wins, master is fallback" rule as
// fetchSellersForMedicine).
function buildPriceByMedicine(invRows, mrpMode) {
  const priceByMedicine = {};
  (invRows || []).forEach((row) => {
    const raw = mrpMode ? row.mrp : row.selling_price;
    if (raw == null || raw <= 0) return;
    if (priceByMedicine[row.medicine_id] == null || raw < priceByMedicine[row.medicine_id]) {
      priceByMedicine[row.medicine_id] = raw;
    }
  });
  return priceByMedicine;
}

function attachSellerPrice(rows, priceByMedicine, mrpMode) {
  return (rows || []).map((row) => ({
    ...row,
    sellerPrice: mrpMode
      ? effectiveMrp(priceByMedicine[row.id], row.mrp_max)
      : (priceByMedicine[row.id] ?? null),
  }));
}

// ── Search medicines — 3 sections: branded / generic / janaushadhi ──
// Only medicines stocked by at least one seller are shown.
// mrp_mode: stock no longer gates display — a medicine is listed as long
// as some seller hasn't manually hidden it (seller_hidden=false), stock
// quantity is irrelevant. mrp_mode OFF: unchanged (is_available + stock>0).
// TODO: if availableIds grows to thousands, replace .in() with a Postgres RPC for performance.
export async function searchMedicines(query, mrpMode = false) {
  const empty = { branded: [], generic: [], janaushadhi: [] };
  if (!query || query.length < 2) return empty;

  let invQuery = supabase.from('seller_inventory').select('medicine_id, selling_price, mrp');
  invQuery = mrpMode
    ? invQuery.eq('seller_hidden', false)
    : invQuery.eq('is_available', true).gt('stock_quantity', 0);
  const { data: invData } = await invQuery;
  const availableIds = [...new Set((invData || []).map(r => r.medicine_id).filter(Boolean))];
  if (availableIds.length === 0) return empty;
  const priceByMedicine = buildPriceByMedicine(invData, mrpMode);

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
    janaushadhi: attachSellerPrice(janRes.data,     priceByMedicine, mrpMode),
    generic:     attachSellerPrice(genericRes.data, priceByMedicine, mrpMode),
    branded:     attachSellerPrice(brandedRes.data, priceByMedicine, mrpMode),
  };
}

// ── Rate per dose ─────────────────────────────────────────────
// priceOverride: pass mapMedicine()'s already-resolved med.price (seller-
// grounded, R3-A) so rate/dose divides the real customer-facing price
// instead of always falling back to master's stale mrp_max. Omit it and
// this behaves exactly as before (med.mrp_max || med.mrp).
export function getRatePerDose(med, priceOverride) {
  const price = priceOverride != null ? priceOverride : (parseFloat(med.mrp_max || med.mrp) || 0);
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

// ── Effective customer-facing MRP under MRP Mode ─────────────────
// Seller's own seller_inventory.mrp is authoritative once set; master's
// mrp_max is only a fallback for rows a seller hasn't declared one for
// yet — same "seller wins, master is fallback" rule as the guard trigger
// (021_mrpGuard.sql / 022_mrpMode.sql) and the CSV bulk-upload path.
// Returns null when neither source has a usable value — callers must
// treat that as "don't show this, don't let it be ordered".
export function effectiveMrp(sellerMrp, masterMrpMax) {
  if (sellerMrp > 0) return sellerMrp;
  if (masterMrpMax > 0) return masterMrpMax;
  return null;
}

// ── Sellers stocking a specific medicine (medicine-first order flow) ──
// mrpMode/masterMrpMax: when mrp_mode is ON, each row's resolved `.price`
// is its effective MRP (seller's own mrp, falling back to the caller-
// supplied master mrp_max) instead of selling_price, and rows with no
// usable MRP at all are dropped — never surface a ₹0 orderable row.
// Stock no longer gates display under mrp_mode — a seller shows up as
// long as they haven't manually hidden this row (seller_hidden=false),
// regardless of stock_quantity/reserved_quantity. mrp_mode OFF: unchanged
// (is_available + available>0, exactly as before).
export async function fetchSellersForMedicine(medicineId, mrpMode = false, masterMrpMax = 0) {
  if (!medicineId) return [];
  let query = supabase
    .from('seller_inventory')
    .select('selling_price, mrp, seller_hidden, stock_quantity, reserved_quantity, sellers(id, store_name, address, phone, rating, is_open, seller_type)')
    .eq('medicine_id', medicineId);
  query = mrpMode ? query.eq('seller_hidden', false) : query.eq('is_available', true);

  const { data, error } = await query.order('selling_price', { ascending: true });
  if (error) { console.error('fetchSellersForMedicine error:', error); return []; }
  let rows = (data || [])
    .map((row) => ({ ...row, available: (row.stock_quantity || 0) - (row.reserved_quantity || 0) }))
    .filter((row) => row.sellers?.seller_type === 'retailer');
  if (!mrpMode) {
    rows = rows.filter((row) => row.available > 0);
  }

  if (mrpMode) {
    return rows
      .map((row) => ({ ...row, price: effectiveMrp(row.mrp, masterMrpMax) }))
      .filter((row) => row.price != null);
  }
  return rows.map((row) => ({ ...row, price: row.selling_price }));
}

// ── Fetch popular medicines (for home/search landing) ─────────
// Only medicines stocked by at least one seller are shown.
// mrp_mode: same stock-ignoring rule as searchMedicines above.
// TODO: if availableIds grows to thousands, replace .in() with a Postgres RPC for performance.
export async function fetchPopularMedicines(limit = 12, mrpMode = false) {
  let invQuery = supabase.from('seller_inventory').select('medicine_id, selling_price, mrp');
  invQuery = mrpMode
    ? invQuery.eq('seller_hidden', false)
    : invQuery.eq('is_available', true).gt('stock_quantity', 0);
  const { data: invData } = await invQuery;
  const availableIds = [...new Set((invData || []).map(r => r.medicine_id).filter(Boolean))];
  if (availableIds.length === 0) return { data: [], error: null };
  const priceByMedicine = buildPriceByMedicine(invData, mrpMode);

  const { data, error } = await supabase
    .from('master_medicines')
    .select('*')
    .eq('is_active', true)
    .gt('mrp_max', 0)
    .in('id', availableIds)
    .order('mrp_max', { ascending: true })
    .limit(limit);

  if (error) return { data: [], error };
  return { data: attachSellerPrice(data, priceByMedicine, mrpMode), error: null };
}
