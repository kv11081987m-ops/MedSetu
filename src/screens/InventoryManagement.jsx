import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, Plus, Package, AlertTriangle,
  XCircle, Calendar, ChevronDown, Edit2, MoreVertical,
  X, Check, Trash2, TrendingDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Constants ────────────────────────────────────────────────
const CATEGORIES   = ['Sab', 'Tablets', 'Syrup', 'Equipment', 'Ayurvedic'];
const SORT_OPTIONS = ['Naam (A-Z)', 'Low Stock Pehle', 'Expiry Date', 'Price'];

const PALETTE = [
  { color: '#1A6B3C', bg: '#E8F5EE' },
  { color: '#2563EB', bg: '#EAF2FF' },
  { color: '#EA6C00', bg: '#FFF3E8' },
  { color: '#7C3AED', bg: '#F3EEFF' },
  { color: '#DC3545', bg: '#FFEBEE' },
];

const STATUS_COLOR = {
  normal:   { bar: '#1A6B3C', label: null },
  low:      { bar: '#E65100', label: { text: 'Low Stock',     color: '#E65100', bg: '#FFF3E0' } },
  out:      { bar: '#DC3545', label: { text: 'Out of Stock',  color: '#DC3545', bg: '#FFEBEE' } },
  expiring: { bar: '#7C3AED', label: { text: 'Expiring Soon', color: '#7C3AED', bg: '#F3EEFF' } },
};

// ─── Helpers ──────────────────────────────────────────────────
function getItemStatus(stock, expiryDate) {
  if (stock === 0) return 'out';
  if (stock <= 10) return 'low';
  if (expiryDate) {
    const monthsLeft = (new Date(expiryDate) - Date.now()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsLeft <= 3) return 'expiring';
  }
  return 'normal';
}

function formatExpiry(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function mapMedicineItem(m, idx) {
  const { color, bg } = PALETTE[idx % PALETTE.length];
  return {
    id:        m.id,
    initial:   (m.name || 'M')[0].toUpperCase(),
    color,
    bg,
    name:      m.name || 'Unknown',
    brand:     m.brand || m.manufacturer || '—',
    category:  m.category || 'Tablets',
    stock:     m.stock ?? 0,
    maxStock:  m.max_stock || 60,
    mrp:       m.mrp || 0,
    selling:   m.selling_price || m.price || 0,
    expiry:    formatExpiry(m.expiry_date),
    expiryRaw: m.expiry_date || '',
    status:    getItemStatus(m.stock ?? 0, m.expiry_date),
  };
}

// ─── EditModal ────────────────────────────────────────────────
function EditModal({ item, onSave, onClose }) {
  const isNew = !item?.id;
  const [formData, setFormData] = useState({
    name:     item?.name     || '',
    brand:    item?.brand    || '',
    stock:    String(item?.stock   ?? ''),
    maxStock: String(item?.maxStock ?? '60'),
    mrp:      String(item?.mrp     ?? ''),
    selling:  String(item?.selling ?? ''),
    expiry:   item?.expiryRaw || '',
    category: item?.category  || 'Tablets',
  });

  const set = (field) => (e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = () => {
    if (isNew && !formData.name.trim()) { alert('Medicine naam daalna zaroori hai'); return; }
    if (!formData.stock.trim()) { alert('Stock quantity daalna zaroori hai'); return; }
    onSave({
      name:      formData.name.trim(),
      brand:     formData.brand.trim(),
      stock:     Number(formData.stock),
      max_stock: Number(formData.maxStock) || 60,
      mrp:       Number(formData.mrp) || 0,
      selling_price: Number(formData.selling) || 0,
      expiry_date: formData.expiry || null,
      category:  formData.category,
    }, item?.id || null);
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalSheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHandle} />
        <div style={s.modalHeader}>
          <p style={s.modalTitle}>{isNew ? 'Naya Medicine Add Karo' : `Edit: ${item.name}`}</p>
          <button style={s.modalClose} onClick={onClose}><X size={20} color="#888" /></button>
        </div>

        {isNew && (
          <div style={s.fieldWrap}>
            <label style={s.label}>Medicine Naam *</label>
            <input style={s.input} placeholder="e.g. Paracetamol 500mg"
              value={formData.name} onChange={set('name')} />
          </div>
        )}
        {isNew && (
          <div style={s.fieldWrap}>
            <label style={s.label}>Brand / Company</label>
            <input style={s.input} placeholder="e.g. Crocin — GSK"
              value={formData.brand} onChange={set('brand')} />
          </div>
        )}

        <div style={s.fieldRow}>
          <div style={{ ...s.fieldWrap, flex: 1 }}>
            <label style={s.label}>Stock Quantity *</label>
            <input style={s.input} type="number" value={formData.stock}
              onChange={set('stock')} placeholder="0" />
          </div>
          {isNew && (
            <div style={{ ...s.fieldWrap, flex: 1 }}>
              <label style={s.label}>Max Stock</label>
              <input style={s.input} type="number" value={formData.maxStock}
                onChange={set('maxStock')} placeholder="60" />
            </div>
          )}
        </div>

        <div style={s.fieldRow}>
          <div style={{ ...s.fieldWrap, flex: 1 }}>
            <label style={s.label}>MRP (₹)</label>
            <input style={s.input} type="number" value={formData.mrp}
              onChange={set('mrp')} placeholder="0.00" />
          </div>
          <div style={{ ...s.fieldWrap, flex: 1 }}>
            <label style={s.label}>Selling Price (₹)</label>
            <input style={s.input} type="number" value={formData.selling}
              onChange={set('selling')} placeholder="0.00" />
          </div>
        </div>

        <div style={s.fieldWrap}>
          <label style={s.label}>Expiry Date</label>
          <input style={s.input} type="month" value={formData.expiry}
            onChange={set('expiry')} />
        </div>

        {isNew && (
          <div style={s.fieldWrap}>
            <label style={s.label}>Category</label>
            <select style={s.select} value={formData.category} onChange={set('category')}>
              {CATEGORIES.filter((c) => c !== 'Sab').map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        )}

        <button style={s.saveBtn} onClick={handleSubmit}>
          <Check size={16} color="#FFFFFF" />
          {isNew ? 'Medicine Add Karo' : 'Update Karo'}
        </button>
      </div>
    </div>
  );
}

// ─── ItemCard ─────────────────────────────────────────────────
function ItemCard({ item, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pct = item.maxStock > 0 ? Math.round((item.stock / item.maxStock) * 100) : 0;
  const st  = STATUS_COLOR[item.status];

  return (
    <div style={s.itemCard}>
      <div style={{ ...s.itemInitialBox, backgroundColor: item.bg }}>
        <span style={{ ...s.itemInitial, color: item.color }}>{item.initial}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.itemTopRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={s.itemName}>{item.name}</p>
            <p style={s.itemBrand}>{item.brand}</p>
          </div>
          <div style={s.itemTopRight}>
            <span style={s.categoryBadge}>{item.category}</span>
            <div style={{ position: 'relative' }}>
              <button style={s.moreBtn} onClick={() => setMenuOpen((v) => !v)}>
                <MoreVertical size={16} color="#AAAAAA" />
              </button>
              {menuOpen && (
                <div style={s.menu}>
                  <button style={s.menuItem} onClick={() => { setMenuOpen(false); onEdit(item); }}>
                    <Edit2 size={13} color="#1A6B3C" /> Edit
                  </button>
                  <button style={{ ...s.menuItem, color: '#DC3545' }}
                    onClick={() => { setMenuOpen(false); onDelete(item.id); }}>
                    <Trash2 size={13} color="#DC3545" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={s.stockInfoRow}>
          <span style={s.stockNum}>
            Stock:{' '}
            <strong style={{ color: item.status === 'out' ? '#DC3545' : '#1A1A1A' }}>
              {item.stock === 0 ? 'N/A' : `${item.stock} strips`}
            </strong>
          </span>
          {st.label && (
            <span style={{ ...s.statusTag, color: st.label.color, backgroundColor: st.label.bg }}>
              {item.status === 'low'      && <TrendingDown size={10} />}
              {item.status === 'out'      && <XCircle size={10} />}
              {item.status === 'expiring' && <Calendar size={10} />}
              {st.label.text}
            </span>
          )}
        </div>

        <div style={s.barTrack}>
          <div style={{ ...s.barFill, width: `${pct}%`, backgroundColor: st.bar }} />
        </div>

        <div style={s.itemFooter}>
          <span style={s.priceText}>
            MRP <span style={s.mrpVal}>₹{item.mrp}</span>
            {' · '}
            Sell <span style={s.sellVal}>₹{item.selling}</span>
          </span>
          <span style={{
            ...s.expiryText,
            color:      item.status === 'expiring' ? '#7C3AED' : '#AAAAAA',
            fontWeight: item.status === 'expiring' ? '700'     : '400',
          }}>
            Exp: {item.expiry}
          </span>
        </div>

        <div style={s.quickStockRow}>
          <button style={s.stockAdjBtn} onClick={() => onEdit(item)}>
            <Edit2 size={12} color="#1A6B3C" />
            Stock Update Karo
          </button>
          {item.status === 'out' && <span style={s.reorderTag}>Reorder Karo!</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function InventoryManagement() {
  const navigate = useNavigate();

  const [medicines, setMedicines] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [sellerId,  setSellerId]  = useState(null);

  const [query,      setQuery]      = useState('');
  const [category,   setCategory]   = useState('Sab');
  const [sort,       setSort]       = useState('Naam (A-Z)');
  const [searchOpen, setSearchOpen] = useState(false);
  const [editItem,   setEditItem]   = useState(null);

  // ── Fetch ────────────────────────────────────────────────────
  const fetchInventory = async (sid) => {
    const { data, error } = await supabase
      .from('medicines')
      .select('*')
      .eq('seller_id', sid)
      .order('name');
    if (!error && data) setMedicines(data);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const { data: seller } = await supabase
          .from('sellers').select('id').eq('is_verified', true).limit(1).single();
        if (seller) {
          setSellerId(seller.id);
          await fetchInventory(seller.id);
        }
      } catch (err) {
        console.error('Inventory load:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── CRUD ─────────────────────────────────────────────────────
  const handleSave = async (formData, itemId) => {
    if (!sellerId) return;
    if (itemId) {
      const { error } = await supabase
        .from('medicines')
        .update({
          stock:         formData.stock,
          max_stock:     formData.max_stock,
          mrp:           formData.mrp,
          selling_price: formData.selling_price,
          expiry_date:   formData.expiry_date,
        })
        .eq('id', itemId);
      if (error) { alert('Update nahi hua: ' + error.message); return; }
      setMedicines((prev) => prev.map((m) => m.id === itemId ? { ...m, ...formData } : m));
    } else {
      const { data, error } = await supabase
        .from('medicines')
        .insert({ ...formData, seller_id: sellerId })
        .select()
        .single();
      if (error) { alert('Add nahi hua: ' + error.message); return; }
      if (data) setMedicines((prev) => [...prev, data]);
    }
    setEditItem(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Kya aap sach mein is medicine ko delete karna chahte ho?')) return;
    const { error } = await supabase.from('medicines').delete().eq('id', id);
    if (error) { alert('Delete nahi hua: ' + error.message); return; }
    setMedicines((prev) => prev.filter((m) => m.id !== id));
  };

  // ── Derived state ─────────────────────────────────────────────
  const items = useMemo(() => medicines.map(mapMedicineItem), [medicines]);

  const summary = useMemo(() => ({
    total:    items.length,
    low:      items.filter((i) => i.status === 'low').length,
    out:      items.filter((i) => i.status === 'out').length,
    expiring: items.filter((i) => i.status === 'expiring').length,
  }), [items]);

  const filtered = useMemo(() => {
    let list = items.filter((i) => {
      const matchCat = category === 'Sab' || i.category === category;
      const q = query.toLowerCase();
      const matchQ  = !q || i.name.toLowerCase().includes(q) || i.brand.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
    if (sort === 'Naam (A-Z)')       list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'Low Stock Pehle')  list = [...list].sort((a, b) => a.stock - b.stock);
    if (sort === 'Price')            list = [...list].sort((a, b) => a.selling - b.selling);
    if (sort === 'Expiry Date')      list = [...list].sort((a, b) => (a.expiryRaw || '').localeCompare(b.expiryRaw || ''));
    return list;
  }, [items, query, category, sort]);

  const SUMMARY_CARDS = [
    { Icon: Package,       val: summary.total,    label: 'Total Items',   color: '#1A6B3C', bg: '#E8F5EE' },
    { Icon: AlertTriangle, val: summary.low,       label: 'Low Stock',     color: '#E65100', bg: '#FFF3E0' },
    { Icon: XCircle,       val: summary.out,       label: 'Out of Stock',  color: '#DC3545', bg: '#FFEBEE' },
    { Icon: Calendar,      val: summary.expiring,  label: 'Expiring Soon', color: '#2563EB', bg: '#EAF2FF' },
  ];

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/seller-dashboard')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Inventory</span>
          <div style={s.headerRight}>
            <button style={s.iconBtn} onClick={() => setSearchOpen((v) => !v)}>
              <Search size={20} color="#555555" />
            </button>
            <button style={s.addBtn} onClick={() => setEditItem({})}>
              <Plus size={18} color="#FFFFFF" />
            </button>
          </div>
        </div>

        {/* Collapsible search */}
        {searchOpen && (
          <div style={s.searchWrap}>
            <Search size={15} color="#AAAAAA" />
            <input
              style={s.searchInput}
              placeholder="Medicine dhundho..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button style={s.clearBtn} onClick={() => setQuery('')}>
                <X size={14} color="#AAAAAA" />
              </button>
            )}
          </div>
        )}

        {/* ── Body ── */}
        {loading ? (
          <div style={s.loadingState}>
            <p style={{ color: '#888888', fontSize: '14px' }}>Inventory load ho rahi hai...</p>
          </div>
        ) : (
          <div style={s.body}>

            {/* Summary cards */}
            <div style={s.summaryScroll}>
              {SUMMARY_CARDS.map(({ Icon, val, label, color, bg }) => (
                <div key={label} style={{ ...s.summaryCard, backgroundColor: bg }}>
                  <Icon size={18} color={color} />
                  <p style={{ ...s.summaryVal, color }}>{val}</p>
                  <p style={s.summaryLabel}>{label}</p>
                </div>
              ))}
            </div>

            {/* Filter + sort */}
            <div style={s.filterRow}>
              <div style={s.selectWrap}>
                <select style={s.catSelect} value={category}
                  onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <ChevronDown size={13} color="#888888" style={s.selectIcon} />
              </div>
              <span style={s.countText}>{filtered.length} items</span>
            </div>

            {/* Sort pills */}
            <div style={s.sortScroll}>
              {SORT_OPTIONS.map((opt) => (
                <button key={opt}
                  style={{ ...s.sortPill, ...(sort === opt ? s.sortActive : s.sortInactive) }}
                  onClick={() => setSort(opt)}>
                  {opt}
                </button>
              ))}
            </div>

            {/* List or empty state */}
            {medicines.length === 0 ? (
              <div style={s.emptyState}>
                <Package size={48} color="#CCCCCC" />
                <p style={s.emptyTitle}>Pehli medicine add karo</p>
                <p style={{ fontSize: '13px', color: '#AAAAAA', margin: 0, textAlign: 'center' }}>
                  Apni dukaan ka sara stock yahan manage karo
                </p>
                <button style={s.emptyAddBtn} onClick={() => setEditItem({})}>
                  <Plus size={14} color="#1A6B3C" /> Medicine Add Karo
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div style={s.emptyState}>
                <Package size={48} color="#CCCCCC" />
                <p style={s.emptyTitle}>Koi item nahi mila</p>
                <button style={s.emptyAddBtn} onClick={() => setEditItem({})}>
                  <Plus size={14} color="#1A6B3C" /> Medicine Add Karo
                </button>
              </div>
            ) : (
              <div style={s.itemsList}>
                {filtered.map((item) => (
                  <ItemCard key={item.id} item={item}
                    onEdit={(it) => setEditItem(it)}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            <div style={{ height: '24px' }} />
          </div>
        )}

        {/* Edit / Add Modal */}
        {editItem !== null && (
          <EditModal
            item={editItem?.id ? editItem : null}
            onSave={handleSave}
            onClose={() => setEditItem(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5', position: 'relative' },

  // Header
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 12px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 20 },
  headerTitle: { fontSize: '17px', fontWeight: '700', color: '#1A1A1A' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '6px' },
  iconBtn: { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  addBtn:  { width: '34px', height: '34px', borderRadius: '10px', backgroundColor: '#1A6B3C', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },

  // Search
  searchWrap:  { display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', padding: '10px 16px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '14px', color: '#1A1A1A', fontFamily: 'inherit', backgroundColor: 'transparent' },
  clearBtn:    { background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' },

  // Body
  body:         { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },
  loadingState: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px' },

  // Summary
  summaryScroll: { display: 'flex', gap: '10px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '2px' },
  summaryCard:   { minWidth: '110px', flexShrink: 0, borderRadius: '14px', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '4px' },
  summaryVal:    { fontSize: '26px', fontWeight: '800', margin: '2px 0 0', lineHeight: 1 },
  summaryLabel:  { fontSize: '11px', color: '#555555', fontWeight: '500', margin: 0 },

  // Filter
  filterRow:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
  selectWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  catSelect:  { appearance: 'none', padding: '8px 32px 8px 12px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '13px', fontWeight: '500', color: '#333333', backgroundColor: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit', outline: 'none' },
  selectIcon: { position: 'absolute', right: '10px', pointerEvents: 'none' },
  countText:  { fontSize: '13px', color: '#888888', whiteSpace: 'nowrap' },

  // Sort
  sortScroll:  { display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '2px' },
  sortPill:    { flexShrink: 0, padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', fontFamily: 'inherit', border: 'none', whiteSpace: 'nowrap' },
  sortActive:  { backgroundColor: '#1A6B3C', color: '#FFFFFF', fontWeight: '600' },
  sortInactive:{ backgroundColor: '#FFFFFF',  color: '#555555', border: '1.5px solid #E0E0E0' },

  // Items list
  itemsList: { display: 'flex', flexDirection: 'column', gap: '8px' },

  // Item card
  itemCard:       { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px', display: 'flex', gap: '12px', boxShadow: '0 1px 5px rgba(0,0,0,0.05)' },
  itemInitialBox: { width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-start', marginTop: '2px' },
  itemInitial:    { fontSize: '18px', fontWeight: '800' },
  itemTopRow:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px', marginBottom: '6px' },
  itemName:       { fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0, lineHeight: '1.3' },
  itemBrand:      { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  itemTopRight:   { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 },
  categoryBadge:  { fontSize: '10px', fontWeight: '600', color: '#2563EB', backgroundColor: '#EAF2FF', padding: '2px 8px', borderRadius: '20px' },
  moreBtn:        { background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', borderRadius: '6px' },
  menu:           { position: 'absolute', top: '100%', right: 0, zIndex: 30, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: '120px' },
  menuItem:       { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 10px', background: 'none', border: 'none', fontSize: '13px', fontWeight: '600', color: '#333333', cursor: 'pointer', borderRadius: '6px', fontFamily: 'inherit' },

  // Stock
  stockInfoRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' },
  stockNum:     { fontSize: '13px', color: '#555555' },
  statusTag:    { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' },
  barTrack:     { height: '5px', backgroundColor: '#F0F0F0', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' },
  barFill:      { height: '100%', borderRadius: '3px', transition: 'width 0.4s ease' },
  itemFooter:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  priceText:    { fontSize: '12px', color: '#888888' },
  mrpVal:       { color: '#AAAAAA', textDecoration: 'line-through' },
  sellVal:      { color: '#1A6B3C', fontWeight: '700' },
  expiryText:   { fontSize: '11px' },
  quickStockRow:{ display: 'flex', alignItems: 'center', gap: '8px' },
  stockAdjBtn:  { display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', backgroundColor: '#F0FBF4', color: '#1A6B3C', border: '1px solid #C8E6C9', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  reorderTag:   { fontSize: '11px', fontWeight: '700', color: '#DC3545', backgroundColor: '#FFEBEE', padding: '4px 10px', borderRadius: '20px' },

  // Empty state
  emptyState:   { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', boxShadow: '0 1px 5px rgba(0,0,0,0.05)' },
  emptyTitle:   { fontSize: '15px', color: '#888888', fontWeight: '600', margin: 0 },
  emptyAddBtn:  { display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', backgroundColor: '#FFFFFF', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  modalSheet:   { width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '24px 24px 0 0', padding: '16px 20px 40px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '90vh', overflowY: 'auto' },
  modalHandle:  { width: '40px', height: '4px', backgroundColor: '#E0E0E0', borderRadius: '2px', alignSelf: 'center', marginBottom: '4px' },
  modalHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle:   { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  modalClose:   { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' },
  fieldWrap:    { display: 'flex', flexDirection: 'column', gap: '5px' },
  fieldRow:     { display: 'flex', gap: '10px' },
  label:        { fontSize: '12px', fontWeight: '600', color: '#555555' },
  input:        { padding: '10px 12px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FFFFFF', width: '100%', boxSizing: 'border-box' },
  select:       { padding: '10px 12px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FFFFFF', width: '100%' },
  saveBtn:      { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', marginTop: '4px' },
};
