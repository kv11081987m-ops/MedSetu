import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, Plus, Package, AlertTriangle,
  XCircle, Calendar, ChevronDown, Edit2, MoreVertical,
  X, Check, Trash2, TrendingDown, Upload, Download,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getCurrentSeller } from '../lib/auth';

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

// ─── BulkModal ────────────────────────────────────────────────
function BulkModal({ sellerId, onClose, onDone }) {
  const [csvData,       setCsvData]       = useState([]);
  const [uploadStatus,  setUploadStatus]  = useState('idle'); // idle|preview|uploading|done|error
  const [errorMsg,      setErrorMsg]      = useState('');

  const validateRow = (row) => {
    const errors = [];
    if (!row.name?.trim())                           errors.push('Naam required');
    if (!row.stock || isNaN(Number(row.stock)))      errors.push('Stock number chahiye');
    if (!row.mrp   || isNaN(Number(row.mrp)))        errors.push('MRP number chahiye');
    if (row.selling_price && isNaN(Number(row.selling_price))) errors.push('Selling price number chahiye');
    return errors;
  };

  const parseCSV = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = e.target.result.trim().split('\n');
      if (lines.length < 2) { setErrorMsg('CSV mein data nahi hai'); setUploadStatus('error'); return; }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/ /g, '_'));
      const rows = lines.slice(1)
        .map((line) => {
          const vals = line.split(',').map((v) => v.trim());
          const row  = {};
          headers.forEach((h, i) => { row[h] = vals[i] || ''; });
          const errs = validateRow(row);
          return { ...row, _errors: errs, _valid: errs.length === 0 };
        })
        .filter((r) => r.name);
      setCsvData(rows);
      setUploadStatus('preview');
    };
    reader.onerror = () => { setErrorMsg('File read nahi ho saka'); setUploadStatus('error'); };
    reader.readAsText(file);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) { setErrorMsg('Sirf .csv file allowed hai'); setUploadStatus('error'); return; }
    setUploadStatus('idle');
    parseCSV(file);
  };

  const bulkUpload = async () => {
    const validRows = csvData.filter((r) => r._valid);
    if (!validRows.length) return;
    setUploadStatus('uploading');
    const records = validRows.map((r) => ({
      name:          r.name.trim(),
      brand:         r.brand?.trim()         || '',
      category:      r.category?.trim()      || 'Tablets',
      stock:         Number(r.stock)         || 0,
      max_stock:     Number(r.max_stock)     || 60,
      mrp:           Number(r.mrp)           || 0,
      selling_price: Number(r.selling_price) || Number(r.mrp) || 0,
      expiry_date:   r.expiry_date           || null,
      seller_id:     sellerId,
      is_available:  true,
    }));
    const BATCH = 50;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error } = await supabase.from('medicines').insert(records.slice(i, i + BATCH));
      if (error) { setErrorMsg(error.message); setUploadStatus('error'); return; }
    }
    setUploadStatus('done');
    onDone();
  };

  const validCount   = csvData.filter((r) => r._valid).length;
  const invalidCount = csvData.filter((r) => !r._valid).length;

  return (
    <div style={bs.overlay} onClick={onClose}>
      <div style={bs.card} onClick={(e) => e.stopPropagation()}>

        <div style={bs.header}>
          <p style={bs.title}>Bulk Upload</p>
          <button style={s.modalClose} onClick={onClose}><X size={20} color="#888" /></button>
        </div>

        {uploadStatus === 'done' && (
          <div style={bs.centerBox}>
            <span style={bs.bigEmoji}>✅</span>
            <p style={bs.doneTitle}>{validCount} medicines add ho gayi!</p>
            <p style={bs.doneSub}>Inventory update ho gayi hai</p>
            <button style={bs.primaryBtn} onClick={onClose}>Done</button>
          </div>
        )}

        {uploadStatus === 'uploading' && (
          <div style={bs.centerBox}>
            <p style={{ fontSize: '14px', color: '#555555' }}>Upload ho raha hai... please wait</p>
          </div>
        )}

        {uploadStatus === 'error' && (
          <div style={bs.centerBox}>
            <span style={bs.bigEmoji}>❌</span>
            <p style={bs.doneTitle}>Error aaya</p>
            <p style={bs.doneSub}>{errorMsg}</p>
            <button style={bs.retryBtn} onClick={() => { setUploadStatus('idle'); setCsvData([]); setErrorMsg(''); }}>
              Dobara Try Karo
            </button>
          </div>
        )}

        {(uploadStatus === 'idle' || uploadStatus === 'preview') && (
          <>
            <div style={bs.infoCard}>
              <p style={bs.infoTitle}>CSV Format Guide</p>
              <p style={bs.infoLine}>Columns: <strong>name, brand, category, stock, max_stock, mrp, selling_price, expiry_date</strong></p>
              <p style={bs.infoLine}>• <strong>name, stock, mrp</strong> — required fields</p>
              <p style={bs.infoLine}>• expiry_date format: <strong>YYYY-MM</strong> (e.g. 2025-12)</p>
            </div>

            {uploadStatus === 'idle' && (
              <label style={bs.dropZone}>
                <Upload size={28} color="#2563EB" />
                <p style={bs.dropText}>CSV file select karo</p>
                <p style={bs.dropSub}>.csv files only</p>
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
              </label>
            )}

            {uploadStatus === 'preview' && csvData.length > 0 && (
              <>
                <div style={bs.previewSummary}>
                  <span style={bs.validBadge}>✅ {validCount} valid</span>
                  {invalidCount > 0 && <span style={bs.invalidBadge}>❌ {invalidCount} error</span>}
                </div>
                <div style={bs.tableWrap}>
                  <table style={bs.table}>
                    <thead>
                      <tr>
                        {['#', 'Naam', 'Stock', 'MRP', 'Status'].map((h) => (
                          <th key={h} style={bs.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.map((row, i) => (
                        <tr key={i} style={{ backgroundColor: row._valid ? '#F0FBF4' : '#FFF0F0' }}>
                          <td style={bs.td}>{i + 1}</td>
                          <td style={bs.td}>{row.name || '—'}</td>
                          <td style={bs.td}>{row.stock || '—'}</td>
                          <td style={bs.td}>{row.mrp ? `₹${row.mrp}` : '—'}</td>
                          <td style={bs.td}>
                            {row._valid
                              ? <span style={{ color: '#1A6B3C', fontWeight: '700' }}>✓</span>
                              : <span style={{ color: '#DC3545', fontSize: '11px' }}>✗ {row._errors[0]}</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {validCount > 0 && (
                  <button style={bs.primaryBtn} onClick={bulkUpload}>
                    <Upload size={15} color="#fff" />
                    {validCount} Medicines Upload Karo
                  </button>
                )}
                <button style={bs.retryBtn} onClick={() => { setCsvData([]); setUploadStatus('idle'); }}>
                  Doosri File Choose Karo
                </button>
              </>
            )}
          </>
        )}
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

  const [query,          setQuery]          = useState('');
  const [category,       setCategory]       = useState('Sab');
  const [sort,           setSort]           = useState('Naam (A-Z)');
  const [searchOpen,     setSearchOpen]     = useState(false);
  const [editItem,       setEditItem]       = useState(null);
  const [showBulkModal,  setShowBulkModal]  = useState(false);

  // ── Fetch ────────────────────────────────────────────────────
  const fetchInventory = async () => {
    setLoading(true);
    try {
      const seller = await getCurrentSeller();
      if (!seller) { setLoading(false); return; }
      setSellerId(seller.id);
      const { data, error } = await supabase
        .from('medicines')
        .select('*')
        .eq('seller_id', seller.id)
        .order('name');
      if (error) throw error;
      if (data) setMedicines(data);
    } catch (err) {
      console.error('Inventory error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInventory(); }, []);

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

  // ── CSV Template Download ─────────────────────────────────────
  const downloadTemplate = () => {
    const csv = [
      'name,brand,category,stock,max_stock,mrp,selling_price,expiry_date',
      'Paracetamol 500mg,Crocin,Tablets,100,200,15.00,12.00,2025-12',
      'Amoxicillin 250mg,Amoxil,Capsules,50,150,45.00,38.00,2026-06',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'medsetu_inventory_template.csv'; a.click();
    URL.revokeObjectURL(url);
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
            <button style={s.bulkBtn} onClick={() => setShowBulkModal(true)}>
              <Upload size={14} color="#2563EB" />
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#2563EB' }}>Bulk</span>
            </button>
            <button style={s.templateBtn} onClick={downloadTemplate}>
              <Download size={14} color="#555555" />
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

        {/* Bulk Upload Modal */}
        {showBulkModal && (
          <BulkModal
            sellerId={sellerId}
            onClose={() => setShowBulkModal(false)}
            onDone={async () => { await fetchInventory(); }}
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
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  addBtn:      { width: '34px', height: '34px', borderRadius: '10px', backgroundColor: '#1A6B3C', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  bulkBtn:     { display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', border: '1.5px solid #2563EB', borderRadius: '8px', backgroundColor: '#EAF2FF', cursor: 'pointer', fontFamily: 'inherit' },
  templateBtn: { display: 'flex', alignItems: 'center', padding: '6px 8px', border: '1.5px solid #E0E0E0', borderRadius: '8px', backgroundColor: '#FFFFFF', cursor: 'pointer' },

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

// ─── Bulk Modal Styles ────────────────────────────────────────
const bs = {
  overlay:        { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' },
  card:           { width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '80vh', overflowY: 'auto' },
  header:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title:          { fontSize: '17px', fontWeight: '700', color: '#1A1A1A', margin: 0 },

  infoCard:       { backgroundColor: '#F0F8FF', borderRadius: '12px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid #BBDEFB' },
  infoTitle:      { fontSize: '12px', fontWeight: '700', color: '#1565C0', margin: '0 0 4px' },
  infoLine:       { fontSize: '12px', color: '#1E3A5F', margin: 0, lineHeight: '1.5' },

  dropZone:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '28px', border: '2px dashed #2563EB', borderRadius: '14px', backgroundColor: '#F8FBFF', cursor: 'pointer' },
  dropText:       { fontSize: '14px', fontWeight: '600', color: '#2563EB', margin: 0 },
  dropSub:        { fontSize: '12px', color: '#AAAAAA', margin: 0 },

  previewSummary: { display: 'flex', gap: '10px', alignItems: 'center' },
  validBadge:     { fontSize: '12px', fontWeight: '700', color: '#1A6B3C', backgroundColor: '#E8F5EE', padding: '4px 10px', borderRadius: '20px' },
  invalidBadge:   { fontSize: '12px', fontWeight: '700', color: '#DC3545', backgroundColor: '#FFEBEE', padding: '4px 10px', borderRadius: '20px' },

  tableWrap:      { overflowX: 'auto', borderRadius: '10px', border: '1px solid #E0E0E0' },
  table:          { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th:             { padding: '8px 10px', backgroundColor: '#F5F5F5', color: '#555555', fontWeight: '600', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid #E0E0E0' },
  td:             { padding: '7px 10px', color: '#333333', borderBottom: '1px solid #F0F0F0', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  centerBox:      { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '20px 0' },
  bigEmoji:       { fontSize: '40px' },
  doneTitle:      { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: 0, textAlign: 'center' },
  doneSub:        { fontSize: '13px', color: '#888888', margin: 0, textAlign: 'center' },

  primaryBtn:     { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '13px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', width: '100%' },
  retryBtn:       { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px', backgroundColor: '#FFFFFF', color: '#555555', border: '1.5px solid #E0E0E0', borderRadius: '12px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', width: '100%' },
};
