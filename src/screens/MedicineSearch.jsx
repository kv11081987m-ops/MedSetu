import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import {
  ArrowLeft, X, Clock, TrendingUp, Pill, Wrench,
  Search, Home, ShoppingBag, User, RefreshCw,
} from 'lucide-react';
import { searchMedicines, fetchPopularMedicines, mapMedicine, getRatePerDose } from '../lib/api';

const INITIAL_RECENT = [
  'Paracetamol 500mg', 'BP Machine', 'Crocin 650mg', 'ORS Powder',
];

const FILTERS = ['Sab', 'Tablets', 'Syrup', 'Injection', 'Equipment', 'Ayurvedic', 'Generic', 'Branded'];
const filterKey = { Tablets: 'tablet', Syrup: 'syrup', Equipment: 'equipment', Injection: 'injection', Ayurvedic: 'ayurvedic' };

// ─── MedicineCard ─────────────────────────────────────────────
function MedicineCard({ medicine, type }) {
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const med      = mapMedicine(medicine);
  const rateInfo = getRatePerDose(medicine);

  const borderColor = type === 'janaushadhi' ? '#1A6B3C'
                    : type === 'generic'      ? '#2563EB'
                    : '#FF8C00';

  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '14px 16px', marginBottom: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderLeft: `3px solid ${borderColor}` }}>

      {/* Name / brand / salt + price */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: '600', fontSize: '14px', color: '#1A1A1A', margin: '0 0 2px', lineHeight: '1.3' }}>{med.name}</p>
          {med.brand  && <p style={{ color: '#666', fontSize: '12px', margin: '0 0 1px' }}>{med.brand}</p>}
          {med.salt   && <p style={{ color: '#888', fontSize: '11px', margin: 0 }}>{med.salt.substring(0, 60)}</p>}
        </div>
        <div style={{ textAlign: 'right', marginLeft: '12px', flexShrink: 0 }}>
          <p style={{ color: borderColor, fontWeight: '700', fontSize: '16px', margin: 0 }}>₹{med.price || 0}</p>
        </div>
      </div>

      {/* Rate per dose */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#F8F8F8', borderRadius: '6px', marginBottom: '10px' }}>
        <span style={{ fontSize: '11px', color: '#666' }}>📦 {medicine.unit || 'Per unit'}</span>
        <span style={{ fontSize: '12px', color: borderColor, fontWeight: '500' }}>₹{rateInfo.perDose}/{rateInfo.unit}</span>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {medicine.is_generic && (
          <span style={badge('#E8F5E9', '#1A6B3C')}>✓ Generic</span>
        )}
        {medicine.source === 'janaushadhi' && (
          <span style={badge('#E8F5E9', '#1A6B3C')}>🏥 Jan Aushadhi</span>
        )}
        {med.rxRequired && (
          <span style={badge('#FFF3E0', '#FF8C00')}>Rx Required</span>
        )}
        {medicine.dosage_form && (
          <span style={badge('#F5F5F5', '#666')}>{medicine.dosage_form}</span>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => navigate('/medicine-detail', { state: { medicine } })}
          style={{ flex: 1, padding: '8px', background: '#fff', border: `1.5px solid ${borderColor}`, borderRadius: '8px', color: borderColor, fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Detail Dekho
        </button>
        <button
          onClick={() => { addToCart({ ...med, price: med.price || 0 }, null); navigate('/checkout'); }}
          style={{ flex: 1, padding: '8px', background: borderColor, border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Order Karo
        </button>
      </div>
    </div>
  );
}

const badge = (bg, color) => ({
  background: bg, color, fontSize: '10px', padding: '2px 8px', borderRadius: '99px', fontWeight: '500',
});

// ─── Section header ───────────────────────────────────────────
function SectionHeader({ bg, borderColor, icon, title, subtitle, tag }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: bg, borderLeft: `4px solid ${borderColor}`, marginBottom: '8px' }}>
      <span style={{ fontSize: '18px' }}>{icon}</span>
      <div>
        <p style={{ fontWeight: '700', color: borderColor, fontSize: '14px', margin: '0 0 1px' }}>{title}</p>
        <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{subtitle}</p>
      </div>
      {tag && (
        <span style={{ marginLeft: 'auto', background: borderColor, color: '#fff', fontSize: '10px', padding: '3px 10px', borderRadius: '99px', fontWeight: '600', flexShrink: 0 }}>
          {tag}
        </span>
      )}
    </div>
  );
}

// ─── PopularCard ──────────────────────────────────────────────
function PopularCard({ item, onAdd }) {
  const isEquip = item.type === 'equipment';
  return (
    <div style={s.popCard}>
      <div style={{ ...s.popIconBox, backgroundColor: isEquip ? '#EAF2FF' : '#E8F5EE' }}>
        {isEquip ? <Wrench size={18} color="#2563EB" /> : <Pill size={18} color="#1A6B3C" />}
      </div>
      <p style={s.popName}>{item.name}</p>
      <p style={s.popSalt}>{item.salt}</p>
      <div style={s.popFooter}>
        <span style={s.popPrice}>₹{item.price}</span>
        <button style={s.addBtn} onClick={() => onAdd(item)}>Add</button>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function MedicineSearch() {
  const navigate    = useNavigate();
  const { addToCart } = useCart();
  const inputRef    = useRef(null);
  const debounceRef = useRef(null);

  const [query, setQuery]             = useState('');
  const [activeFilter, setActiveFilter] = useState('Sab');
  const [recent, setRecent]           = useState(INITIAL_RECENT);
  const [activeTab, setActiveTab]     = useState('search');
  const [popularMeds, setPopularMeds] = useState([]);
  const [searchResults, setSearchResults] = useState({ branded: [], generic: [], janaushadhi: [] });
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    fetchPopularMedicines(12).then(({ data }) => {
      if (data?.length > 0) {
        setPopularMeds(data.map(m => {
          const mapped = mapMedicine(m);
          return { id: mapped.id, name: mapped.name, salt: mapped.salt, price: mapped.mrp, stores: mapped.stores, type: mapped.type, is_generic: mapped.is_generic };
        }));
      }
    });
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const removeRecent = (term) => setRecent(r => r.filter(x => x !== term));
  const addToRecent  = (term) => {
    if (!term.trim()) return;
    setRecent(r => [term, ...r.filter(x => x !== term)].slice(0, 6));
  };

  const handleSearch = useCallback((val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);

    if (!val.trim() || val.trim().length < 2) {
      setSearchResults({ branded: [], generic: [], janaushadhi: [] });
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchMedicines(val.trim());
      setSearchResults(results);
      setSearchLoading(false);
    }, 400);
  }, []);

  const handleRecentClick = (term) => { handleSearch(term); inputRef.current?.focus(); };

  const applyFilter = (list) => {
    if (activeFilter === 'Sab')     return list;
    if (activeFilter === 'Generic') return list.filter(m => m.is_generic === true);
    if (activeFilter === 'Branded') return list.filter(m => !m.is_generic);
    return list.filter(m => m.type === filterKey[activeFilter]);
  };

  const isSearching = query.trim().length >= 2;
  const hasResults  = searchResults.janaushadhi.length > 0 || searchResults.generic.length > 0 || searchResults.branded.length > 0;

  const NAV_TABS = [
    { id: 'home',    Icon: Home,        label: 'Home',    route: '/home' },
    { id: 'search',  Icon: Search,      label: 'Search',  route: '/medicine-search' },
    { id: 'orders',  Icon: ShoppingBag, label: 'Orders',  route: '/orders' },
    { id: 'profile', Icon: User,        label: 'Profile', route: '/profile' },
  ];

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={20} color="#1A1A1A" />
          </button>
          <div style={s.searchBox}>
            <Search size={15} color="#AAAAAA" style={{ flexShrink: 0 }} />
            <input
              ref={inputRef}
              style={s.searchInput}
              placeholder="Medicine ya salt name dhundho..."
              value={query}
              onChange={e => handleSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addToRecent(query)}
            />
            {query.length > 0 && (
              <button style={s.clearBtn} onClick={() => { handleSearch(''); }}>
                <X size={15} color="#888888" />
              </button>
            )}
          </div>
          <button style={s.cancelBtn} onClick={() => navigate('/home')}>Cancel</button>
        </div>

        {/* ── Filter Chips ── */}
        <div style={s.filtersWrap}>
          {FILTERS.map(f => (
            <button
              key={f}
              style={{ ...s.chip, ...(activeFilter === f ? s.chipActive : s.chipInactive) }}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div style={s.body}>
          {!isSearching ? (
            <>
              {/* Recent Searches */}
              {recent.length > 0 && (
                <div style={s.section}>
                  <div style={s.sectionHead}>
                    <Clock size={14} color="#888888" />
                    <span style={s.sectionTitle}>Recent Searches</span>
                  </div>
                  <div style={s.recentList}>
                    {recent.map(term => (
                      <div key={term} style={s.recentRow}>
                        <button style={s.recentTerm} onClick={() => handleRecentClick(term)}>
                          <Search size={13} color="#AAAAAA" />{term}
                        </button>
                        <button style={s.recentX} onClick={() => removeRecent(term)}>
                          <X size={13} color="#BBBBBB" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Popular Medicines */}
              <div style={s.section}>
                <div style={s.sectionHead}>
                  <TrendingUp size={14} color="#1A6B3C" />
                  <span style={s.sectionTitle}>Popular Medicines</span>
                </div>
                <div style={s.popGrid}>
                  {applyFilter(popularMeds).map(item => (
                    <PopularCard
                      key={item.id}
                      item={item}
                      onAdd={it => {
                        addToRecent(it.name);
                        addToCart({ ...it, price: it.price ?? 0 }, null);
                        navigate('/checkout');
                      }}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : searchLoading ? (
            /* ── Loading ── */
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#1A6B3C', fontWeight: '500', backgroundColor: '#E8F5EE', padding: '12px 16px', margin: '12px', borderRadius: '10px' }}>
              <RefreshCw size={14} color="#1A6B3C" style={{ animation: 'spin 1s linear infinite' }} />
              Medicines dhundh raha hai...
            </div>
          ) : hasResults ? (
            /* ── 3-Section Results ── */
            <div style={{ padding: '12px 12px 0' }}>

              {/* Jan Aushadhi */}
              {searchResults.janaushadhi.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <SectionHeader
                    bg="#E8F5E9" borderColor="#1A6B3C"
                    icon="🏥"
                    title="Jan Aushadhi — Sabse Sasti"
                    subtitle="Government approved generic medicines"
                    tag="💚 Best Value"
                  />
                  {searchResults.janaushadhi.map(med => (
                    <MedicineCard key={med.id} medicine={med} type="janaushadhi" />
                  ))}
                </div>
              )}

              {/* Generic */}
              {searchResults.generic.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <SectionHeader
                    bg="#E3F2FD" borderColor="#2563EB"
                    icon="💊"
                    title="Generic Medicines — Sasti"
                    subtitle="Same salt, lower price"
                  />
                  {searchResults.generic.map(med => (
                    <MedicineCard key={med.id} medicine={med} type="generic" />
                  ))}
                </div>
              )}

              {/* Branded */}
              {searchResults.branded.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <SectionHeader
                    bg="#FFF3E0" borderColor="#FF8C00"
                    icon="🏷️"
                    title="Branded Medicines"
                    subtitle="Popular brands"
                  />
                  {searchResults.branded.map(med => (
                    <MedicineCard key={med.id} medicine={med} type="branded" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── No Results ── */
            <div style={s.emptyState}>
              <p style={{ fontSize: '48px', margin: 0 }}>🔍</p>
              <p style={s.emptyTitle}>Koi result nahi mila</p>
              <p style={s.emptySubtitle}>"{query}" ke liye koi medicine nahi mili</p>
              <button style={s.prescBtn} onClick={() => navigate('/prescription')}>
                Prescription Upload Karo
              </button>
              <button style={s.pharmacistBtn} onClick={() => {
                const msg = encodeURIComponent('Namaste, mujhe medicine ke baare mein poochna tha. Kya aap help kar sakte hain?');
                window.open(`https://wa.me/919196103234?text=${msg}`, '_blank');
              }}>
                Pharmacist Se Poochho
              </button>
            </div>
          )}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, route }) => {
            const isActive = activeTab === id;
            return (
              <button key={id} style={s.navTab} onClick={() => { setActiveTab(id); navigate(route); }}>
                <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'} strokeWidth={isActive ? 2.5 : 1.8} />
                <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA', fontWeight: isActive ? '600' : '400' }}>
                  {label}
                </span>
                {isActive && <span style={s.navDot} />}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper:      { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:       { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#FFFFFF' },
  header:       { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0' },
  iconBtn:      { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center', flexShrink: 0 },
  searchBox:    { flex: 1, display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#F5F5F5', border: '1.5px solid #E8E8E8', borderRadius: '10px', padding: '9px 12px' },
  searchInput:  { flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#1A1A1A', fontFamily: 'inherit', minWidth: 0 },
  clearBtn:     { background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 },
  cancelBtn:    { background: 'none', border: 'none', fontSize: '14px', color: '#666666', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, padding: '6px 2px' },
  filtersWrap:  { display: 'flex', gap: '8px', overflowX: 'auto', padding: '10px 14px', borderBottom: '1px solid #F5F5F5', scrollbarWidth: 'none' },
  chip:         { flexShrink: 0, padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.15s ease' },
  chipActive:   { backgroundColor: '#1A6B3C', color: '#FFFFFF', border: '1.5px solid #1A6B3C', fontWeight: '600' },
  chipInactive: { backgroundColor: '#FFFFFF', color: '#555555', border: '1.5px solid #E0E0E0' },
  body:         { flex: 1, overflowY: 'auto', backgroundColor: '#F5F5F5' },
  section:      { backgroundColor: '#FFFFFF', marginBottom: '8px', padding: '16px' },
  sectionHead:  { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' },
  sectionTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A' },
  recentList:   { display: 'flex', flexDirection: 'column', gap: '2px' },
  recentRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F5F5F5' },
  recentTerm:   { display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', fontSize: '14px', color: '#444444', cursor: 'pointer', fontFamily: 'inherit', padding: 0, flex: 1, textAlign: 'left' },
  recentX:      { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' },
  popGrid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  popCard:      { border: '1.5px solid #F0F0F0', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px', backgroundColor: '#FAFAFA' },
  popIconBox:   { width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '4px' },
  popName:      { fontSize: '13px', fontWeight: '700', color: '#1A1A1A', margin: 0, lineHeight: '1.3' },
  popSalt:      { fontSize: '11px', color: '#888888', margin: 0 },
  popFooter:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' },
  popPrice:     { fontSize: '14px', fontWeight: '700', color: '#1A6B3C' },
  addBtn:       { backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '4px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  emptyState:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '60px 32px', backgroundColor: '#FFFFFF' },
  emptyTitle:   { fontSize: '17px', fontWeight: '700', color: '#333333', margin: 0 },
  emptySubtitle:{ fontSize: '13px', color: '#888888', margin: '0 0 12px', textAlign: 'center' },
  prescBtn:     { width: '100%', padding: '13px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  pharmacistBtn:{ width: '100%', padding: '13px', backgroundColor: '#FFFFFF', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  bottomNav:    { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' },
  navTab:       { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', position: 'relative', fontFamily: 'inherit' },
  navLabel:     { fontSize: '10px' },
  navDot:       { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
};
