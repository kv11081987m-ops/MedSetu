import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Search, X, Package, AlertTriangle, ShoppingCart, Star } from 'lucide-react';
import { fetchStoreInventory } from '../lib/inventory';
import { supabase } from '../lib/supabase';
import { useCart } from '../context/CartContext';

const PALETTE = [
  { color: '#1A6B3C', bg: '#E8F5EE' },
  { color: '#2563EB', bg: '#EAF2FF' },
  { color: '#EA6C00', bg: '#FFF3E8' },
  { color: '#7C3AED', bg: '#F3EEFF' },
  { color: '#DC3545', bg: '#FFEBEE' },
];

function formatExpiry(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function mapItem(item, idx) {
  const { color, bg } = PALETTE[idx % PALETTE.length];
  const med = item.master_medicines || {};
  return {
    id:           item.id,                        // inventory row UUID
    medicineId:   item.medicine_id || null,       // master_medicines UUID (for cart)
    initial:      (med.name || 'M')[0].toUpperCase(),
    color, bg,
    name:         med.name || 'Unknown',
    genericName:  med.generic_name || med.salt_composition || '',
    category:     med.category || 'Other',
    mrp:          med.mrp_max || 0,
    selling:      item.selling_price || 0,
    unit:         item.unit || 'strips',
    available:    (item.stock_quantity ?? 0) - (item.reserved_quantity ?? 0),
    expiry:       formatExpiry(item.expiry_date),
    isJanAushadhi: med.source === 'janaushadhi',
    requiresRx:   med.requires_prescription || false,
  };
}

// ─── Medicine Card ─────────────────────────────────────────────
function MedicineCard({ item, onAddToCart, added }) {
  return (
    <div style={s.card}>
      {/* Top row: avatar + name + category */}
      <div style={s.cardTop}>
        <div style={{ ...s.initial, backgroundColor: item.bg }}>
          <span style={{ ...s.initialText, color: item.color }}>{item.initial}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px', marginBottom: '2px' }}>
            <p style={s.name}>{item.name}</p>
            <span style={s.catBadge}>{item.category}</span>
          </div>
          {item.genericName ? <p style={s.generic}>{item.genericName}</p> : null}
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '4px' }}>
            {item.isJanAushadhi && <span style={s.jaBadge}>Jan Aushadhi</span>}
            {item.requiresRx   && <span style={s.rxBadge}>Rx Required</span>}
          </div>
        </div>
      </div>

      {/* Pricing block */}
      <div style={s.priceBlock}>
        <div>
          <p style={s.priceLabel}>MRP</p>
          <p style={s.mrp}>₹{item.mrp}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={s.priceLabel}>Store Price</p>
          <p style={s.sellingPrice}>₹{item.selling}</p>
        </div>
      </div>

      {/* Meta: stock + expiry */}
      <div style={s.metaRow}>
        <span style={s.stockText}>{item.available} {item.unit} available</span>
        {item.expiry && <span style={s.expiryText}>Exp: {item.expiry}</span>}
      </div>

      {/* Add to cart button */}
      <button
        style={{ ...s.cartBtn, backgroundColor: added ? '#0F5C30' : '#1A6B3C' }}
        onClick={() => !added && onAddToCart(item)}
      >
        <ShoppingCart size={15} color="#FFFFFF" />
        {added ? 'Added ✓' : 'Cart Mein Daalo'}
      </button>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function CustomerStoreInventory() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { sellerId, storeName } = location.state || {};

  const { addToCart, cartCount } = useCart();

  const [store,      setStore]      = useState(null);
  const [inventory,  setInventory]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [query,      setQuery]      = useState('');
  const [addedItems, setAddedItems] = useState({});

  useEffect(() => {
    if (!sellerId) { setLoading(false); return; }
    Promise.all([
      fetchStoreInventory(sellerId),
      supabase.from('sellers').select('store_name, is_open, rating').eq('id', sellerId).maybeSingle(),
    ]).then(([inv, sellerRes]) => {
      setInventory(inv);
      setStore(sellerRes.data || null);
      setLoading(false);
    });
  }, [sellerId]);

  const items = useMemo(() => inventory.map(mapItem), [inventory]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((i) =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.genericName || '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const handleAddToCart = (item) => {
    addToCart(
      { id: item.medicineId, name: item.name, price: item.selling, quantity: 1, unit: item.unit },
      { id: sellerId, name: storeName || store?.store_name || 'Store' }
    );
    setAddedItems((prev) => ({ ...prev, [item.id]: true }));
    setTimeout(() => {
      setAddedItems((prev) => ({ ...prev, [item.id]: false }));
    }, 2000);
  };

  const handleCartPress = () => navigate('/checkout');

  // ── No sellerId guard ────────────────────────────────────────
  if (!sellerId) {
    return (
      <div style={s.wrapper}>
        <div style={s.screen}>
          <div style={s.header}>
            <button style={s.iconBtn} onClick={() => navigate(-1)}>
              <ArrowLeft size={22} color="#1A1A1A" />
            </button>
            <div style={{ flex: 1 }} />
          </div>
          <div style={s.centerBox}>
            <AlertTriangle size={36} color="#CCCCCC" />
            <p style={s.emptyTitle}>Store ka data nahi mila</p>
            <button style={s.backBtn} onClick={() => navigate(-1)}>Wapas Jao</button>
          </div>
        </div>
      </div>
    );
  }

  const displayName = storeName || store?.store_name || 'Store';

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate(-1)}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={s.headerTitle}>{displayName}</p>
            {store && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1px' }}>
                <span style={{ ...s.statusBadge, ...(store.is_open ? s.statusOpen : s.statusClosed) }}>
                  {store.is_open ? 'Open' : 'Closed'}
                </span>
                {store.rating > 0 && (
                  <span style={s.ratingText}>
                    <Star size={11} color="#F59E0B" fill="#F59E0B" /> {store.rating}
                  </span>
                )}
              </div>
            )}
          </div>
          <button style={s.iconBtn} onClick={() => navigate('/checkout')}>
            <div style={{ position: 'relative', display: 'flex' }}>
              <ShoppingCart size={22} color="#1A6B3C" />
              {cartCount > 0 && (
                <span style={s.cartBadge}>{cartCount > 99 ? '99+' : cartCount}</span>
              )}
            </div>
          </button>
        </div>

        {/* ── Search ── */}
        <div style={s.searchWrap}>
          <div style={s.searchBox}>
            <Search size={15} color="#AAAAAA" />
            <input
              style={s.searchInput}
              placeholder="Is store mein medicine dhundho..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.length > 0 && (
              <button style={s.clearBtn} onClick={() => setQuery('')}>
                <X size={14} color="#AAAAAA" />
              </button>
            )}
          </div>
        </div>

        {/* ── Cart bar — visible when cart has items ── */}
        {cartCount > 0 && (
          <button style={s.cartBar} onClick={handleCartPress}>
            <ShoppingCart size={16} color="#FFFFFF" />
            <span style={{ flex: 1, textAlign: 'left' }}>Cart ({cartCount} items)</span>
            <span style={s.cartBarArrow}>Checkout →</span>
          </button>
        )}

        {/* ── Body ── */}
        <div style={s.body}>
          {loading ? (
            <div style={s.centerBox}>
              <p style={{ color: '#888', fontSize: '14px' }}>Load ho raha hai...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={s.centerBox}>
              <Package size={40} color="#CCCCCC" />
              <p style={s.emptyTitle}>
                {inventory.length === 0
                  ? 'Is store ne abhi medicines add nahi ki hain'
                  : `"${query}" nahi mili is store mein`}
              </p>
            </div>
          ) : (
            <>
              <p style={s.countText}>{filtered.length} medicines available</p>
              {filtered.map((item) => (
                <MedicineCard
                  key={item.id}
                  item={item}
                  onAddToCart={handleAddToCart}
                  added={!!addedItems[item.id]}
                />
              ))}
              <div style={{ height: '24px' }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  header:      { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px 12px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center', flexShrink: 0 },
  headerTitle: { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusBadge: { fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', flexShrink: 0 },
  statusOpen:  { backgroundColor: '#E8F5EE', color: '#1A6B3C' },
  statusClosed:{ backgroundColor: '#FFEEEE', color: '#EF4444' },
  ratingText:  { fontSize: '11px', fontWeight: '600', color: '#555555', display: 'flex', alignItems: 'center', gap: '2px' },

  searchWrap:  { padding: '10px 14px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0' },
  searchBox:   { display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#F5F5F5', border: '1.5px solid #E8E8E8', borderRadius: '10px', padding: '9px 12px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#1A1A1A', fontFamily: 'inherit' },
  clearBtn:    { background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' },

  cartBar:      { display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#1A6B3C', padding: '10px 16px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: '#FFFFFF', fontSize: '13px', fontWeight: '700', width: '100%' },
  cartBarArrow: { fontSize: '13px', fontWeight: '600', color: '#C8F5D8', flexShrink: 0 },

  body:      { flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  centerBox: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '48px 24px' },
  emptyTitle:{ fontSize: '14px', color: '#888888', textAlign: 'center', lineHeight: '1.5', margin: 0 },
  countText: { fontSize: '12px', color: '#888888', margin: '0 0 4px' },
  backBtn:   { padding: '12px 24px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },

  card:        { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px', boxShadow: '0 1px 5px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  cardTop:     { display: 'flex', gap: '10px', alignItems: 'flex-start' },
  initial:     { width: '42px', height: '42px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  initialText: { fontSize: '18px', fontWeight: '800' },
  name:        { fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0, lineHeight: '1.3', flex: 1 },
  generic:     { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  catBadge:    { fontSize: '10px', fontWeight: '600', color: '#1A6B3C', backgroundColor: '#E8F5EE', padding: '2px 8px', borderRadius: '20px', flexShrink: 0 },
  jaBadge:     { fontSize: '10px', fontWeight: '700', color: '#1A6B3C', backgroundColor: '#E8F5E9', padding: '1px 7px', borderRadius: '99px' },
  rxBadge:     { fontSize: '10px', fontWeight: '700', color: '#E65100', backgroundColor: '#FFF3E0', padding: '1px 7px', borderRadius: '99px' },

  priceBlock:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', backgroundColor: '#F0FBF4', borderRadius: '10px', padding: '10px 14px', border: '1px solid #DAF0E2' },
  priceLabel:  { fontSize: '11px', color: '#888888', margin: '0 0 2px', fontWeight: '500' },
  mrp:         { fontSize: '13px', color: '#AAAAAA', textDecoration: 'line-through', margin: 0, fontWeight: '500' },
  sellingPrice:{ fontSize: '24px', fontWeight: '800', color: '#1A6B3C', margin: 0, lineHeight: 1 },

  metaRow:   { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
  stockText: { fontSize: '11px', color: '#555555', fontWeight: '500' },
  expiryText:{ fontSize: '11px', color: '#AAAAAA' },

  cartBtn:   { width: '100%', padding: '12px', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'background-color 0.25s ease' },
  cartBadge: { position: 'absolute', top: '-6px', right: '-7px', backgroundColor: '#DC3545', color: '#FFFFFF', fontSize: '9px', fontWeight: '700', minWidth: '16px', height: '16px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 },
};
