import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, X, Clock, TrendingUp, Pill, Wrench,
  Search, SearchX, Home, ShoppingBag, User, ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { searchMedicines, mapMedicine } from '../lib/api';
import { supabase } from '../lib/supabase';

// ─── Dummy Data ───────────────────────────────────────────────
const INITIAL_RECENT = [
  'Paracetamol 500mg', 'BP Machine', 'Crocin 650mg', 'ORS Powder',
];

const POPULAR = [
  { id: 1, name: 'Paracetamol 500mg', salt: 'Acetaminophen',      price: 29,    stores: 3, type: 'tablet' },
  { id: 2, name: 'Crocin 650mg',      salt: 'Paracetamol',        price: 45,    stores: 2, type: 'tablet' },
  { id: 3, name: 'Azithromycin 500mg',salt: 'Azithromycin',       price: 85,    stores: 2, type: 'tablet' },
  { id: 4, name: 'ORS Powder',        salt: 'Electrolytes',       price: 15,    stores: 3, type: 'syrup'  },
  { id: 5, name: 'Omeprazole 20mg',   salt: 'Omeprazole',         price: 55,    stores: 1, type: 'tablet' },
  { id: 6, name: 'BP Machine (Digital)', salt: 'Medical Equipment', price: 1299, stores: 2, type: 'equipment' },
];

const ALL_MEDICINES = [
  { id: 1,  name: 'Paracetamol 500mg',    brand: 'Calpol',     salt: 'Acetaminophen',   mrp: 35,   price: 29,   off: 17, rxRequired: false, stores: 3, type: 'tablet'    },
  { id: 2,  name: 'Crocin 650mg',         brand: 'GSK',        salt: 'Paracetamol',     mrp: 52,   price: 45,   off: 13, rxRequired: false, stores: 2, type: 'tablet'    },
  { id: 3,  name: 'Azithromycin 500mg',   brand: 'Zithromax',  salt: 'Azithromycin',   mrp: 100,  price: 85,   off: 15, rxRequired: true,  stores: 2, type: 'tablet'    },
  { id: 4,  name: 'ORS Powder',           brand: 'Electral',   salt: 'Electrolytes',    mrp: 18,   price: 15,   off: 17, rxRequired: false, stores: 3, type: 'syrup'     },
  { id: 5,  name: 'Omeprazole 20mg',      brand: 'Omez',       salt: 'Omeprazole',      mrp: 65,   price: 55,   off: 15, rxRequired: true,  stores: 1, type: 'tablet'    },
  { id: 6,  name: 'BP Machine (Digital)', brand: 'Omron',      salt: 'Medical Equipment',mrp: 1499, price: 1299, off: 13, rxRequired: false, stores: 2, type: 'equipment' },
  { id: 7,  name: 'Amoxicillin 500mg',    brand: 'Mox',        salt: 'Amoxicillin',     mrp: 95,   price: 78,   off: 18, rxRequired: true,  stores: 2, type: 'tablet'    },
  { id: 8,  name: 'Cetrizine 10mg',       brand: 'Cetzine',    salt: 'Cetirizine',      mrp: 30,   price: 22,   off: 27, rxRequired: false, stores: 3, type: 'tablet'    },
  { id: 9,  name: 'Ibuprofen 400mg',      brand: 'Brufen',     salt: 'Ibuprofen',       mrp: 42,   price: 35,   off: 17, rxRequired: false, stores: 2, type: 'tablet'    },
  { id: 10, name: 'Dextromethorphan Syrup', brand: 'Benadryl', salt: 'DXM',             mrp: 95,   price: 80,   off: 16, rxRequired: false, stores: 2, type: 'syrup'     },
];

const FILTERS = ['Sab', 'Tablets', 'Syrup', 'Injection', 'Equipment', 'Ayurvedic'];

const filterKey = { Tablets: 'tablet', Syrup: 'syrup', Equipment: 'equipment', Injection: 'injection', Ayurvedic: 'ayurvedic' };

// ─── Sub-components ───────────────────────────────────────────
function PopularCard({ item, onAdd }) {
  const isEquip = item.type === 'equipment';
  return (
    <div style={s.popCard}>
      <div style={{ ...s.popIconBox, backgroundColor: isEquip ? '#EAF2FF' : '#E8F5EE' }}>
        {isEquip
          ? <Wrench size={18} color="#2563EB" />
          : <Pill size={18} color="#1A6B3C" />}
      </div>
      <p style={s.popName}>{item.name}</p>
      <p style={s.popSalt}>{item.salt}</p>
      <div style={s.popFooter}>
        <span style={s.popPrice}>₹{item.price}</span>
        <button style={s.addBtn} onClick={() => onAdd(item)}>Add</button>
      </div>
      <p style={s.popStores}>{item.stores} store{item.stores > 1 ? 's' : ''} mein available</p>
    </div>
  );
}

function ResultCard({ med, onDetail, onOrder }) {
  const isEquip = med.type === 'equipment';
  return (
    <div style={s.resultCard}>
      <div style={{ ...s.resultIcon, backgroundColor: isEquip ? '#EAF2FF' : '#E8F5EE' }}>
        {isEquip
          ? <Wrench size={20} color="#2563EB" />
          : <Pill size={20} color="#1A6B3C" />}
      </div>
      <div style={s.resultBody}>
        <div style={s.resultTopRow}>
          <p style={s.resultName}>{med.name}</p>
          <span style={{ ...s.rxBadge, ...(med.rxRequired ? s.rxRequired : s.rxNotRequired) }}>
            {med.rxRequired ? 'Rx Required' : 'No Rx'}
          </span>
        </div>
        <p style={s.resultBrand}>{med.brand}</p>
        <p style={s.resultSalt}>{med.salt}</p>

        <div style={s.priceRow}>
          <span style={s.price}>₹{med.price.toLocaleString('en-IN')}</span>
          <span style={s.mrp}>₹{med.mrp}</span>
          <span style={s.offBadge}>{med.off}% OFF</span>
        </div>
        <p style={s.storeAvail}>{med.stores} store{med.stores > 1 ? 's' : ''} mein available</p>

        <div style={s.resultBtnRow}>
          <button style={s.detailBtn} onClick={() => onDetail(med)}>Detail Dekho</button>
          <button style={s.orderBtnR} onClick={() => onOrder(med)}>Order Karo</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function MedicineSearch() {
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [query, setQuery]           = useState('');
  const [activeFilter, setActiveFilter] = useState('Sab');
  const [recent, setRecent]         = useState(INITIAL_RECENT);
  const [activeTab, setActiveTab]   = useState('search');
  const [dbResults, setDbResults]   = useState([]);
  const [searching, setSearching]   = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [popularMeds, setPopularMeds] = useState(POPULAR);
  const debounceRef = useRef(null);

  useEffect(() => {
    supabase
      .from('medicines')
      .select('id, name, salt_name, selling_price, stock, category, is_available')
      .order('stock', { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setPopularMeds(data.map((m) => {
            const cat  = (m.category || '').toLowerCase();
            const type = cat.includes('tablet')   ? 'tablet'
                       : cat.includes('syrup')    ? 'syrup'
                       : cat.includes('equip')    ? 'equipment'
                       : cat.includes('inject')   ? 'injection'
                       : 'tablet';
            return { id: m.id, name: m.name, salt: m.salt_name || '', price: parseFloat(m.selling_price) || 0, stores: 1, type };
          }));
        }
      });
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const removeRecent = (term) => setRecent((r) => r.filter((x) => x !== term));

  const addToRecent = (term) => {
    if (!term.trim()) return;
    setRecent((r) => [term, ...r.filter((x) => x !== term)].slice(0, 6));
  };

  const handleSearch = useCallback((val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);

    if (!val.trim()) {
      setDbResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const { data, error } = await searchMedicines(val.trim());
      setSearching(false);
      if (error) {
        setSearchError(true);
        // Fall back to local search on error
        const q = val.toLowerCase();
        setDbResults(
          ALL_MEDICINES.filter(
            (m) => m.name.toLowerCase().includes(q) ||
                   m.salt.toLowerCase().includes(q) ||
                   m.brand.toLowerCase().includes(q)
          )
        );
      } else {
        setSearchError(false);
        setDbResults(data.map(mapMedicine));
      }
    }, 400);
  }, []);

  const handleRecentClick = (term) => {
    handleSearch(term);
    inputRef.current?.focus();
  };

  // When DB results exist, apply local category filter on top of them
  // When no DB results yet (empty query), fall back to ALL_MEDICINES for category browsing
  const results = query.trim()
    ? dbResults.filter((m) => activeFilter === 'Sab' || m.type === filterKey[activeFilter])
    : ALL_MEDICINES.filter((m) => activeFilter !== 'Sab' && m.type === filterKey[activeFilter]);

  const isSearching = query.length > 0;

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
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addToRecent(query)}
            />
            {query.length > 0 && (
              <button style={s.clearBtn} onClick={() => { setQuery(''); setDbResults([]); setSearchError(false); }}>
                <X size={15} color="#888888" />
              </button>
            )}
          </div>

          <button
            style={s.cancelBtn}
            onClick={() => navigate('/home')}
          >
            Cancel
          </button>
        </div>

        {/* ── Filter Chips ── */}
        <div style={s.filtersWrap}>
          {FILTERS.map((f) => (
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
                    {recent.map((term) => (
                      <div key={term} style={s.recentRow}>
                        <button style={s.recentTerm} onClick={() => handleRecentClick(term)}>
                          <Search size={13} color="#AAAAAA" />
                          {term}
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
                  {popularMeds.map((item) => (
                    <PopularCard
                      key={item.id}
                      item={item}
                      onAdd={(it) => { addToRecent(it.name); setQuery(it.name); }}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : results.length === 0 ? (
            /* ── No Results ── */
            <div style={s.emptyState}>
              <SearchX size={52} color="#CCCCCC" />
              <p style={s.emptyTitle}>Koi result nahi mila</p>
              <p style={s.emptySubtitle}>
                "{query}" ke liye kuch nahi mila
              </p>
              <button style={s.prescBtn} onClick={() => navigate('/prescription')}>
                Prescription Upload Karo
              </button>
              <button style={s.pharmacistBtn} onClick={() => navigate('/pharmacist')}>
                Pharmacist Se Poochho
              </button>
            </div>
          ) : (
            /* ── Results ── */
            <div style={s.resultsWrap}>
              {/* Loading indicator */}
              {searching && (
                <div style={s.searchingRow}>
                  <RefreshCw size={13} color="#1A6B3C" style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Medicines dhundh raha hai...</span>
                </div>
              )}
              {searchError && (
                <div style={{ ...s.searchingRow, color: '#E65100', backgroundColor: '#FFF3E0' }}>
                  Supabase se fetch nahi hua — local results dikh rahe hain
                </div>
              )}

              <div style={s.resultsHeader}>
                <span style={s.resultsCount}>
                  {searching ? '...' : `${results.length} result${results.length !== 1 ? 's' : ''}`} mile "{query}" ke liye
                </span>
                <div style={s.sortRow}>
                  <span style={s.sortLabel}>Sort:</span>
                  <select style={s.sortSelect} defaultValue="distance">
                    <option value="distance">Distance</option>
                    <option value="price">Price</option>
                    <option value="rating">Rating</option>
                  </select>
                  <ChevronDown size={12} color="#1A6B3C" />
                </div>
              </div>

              <div style={s.resultsList}>
                {results.map((med) => (
                  <ResultCard
                    key={med.id}
                    med={med}
                    onDetail={(m) => navigate('/medicine-detail', { state: { medicine: m } })}
                    onOrder={(m) => navigate('/checkout', { state: { medicine: m } })}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, route }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                style={s.navTab}
                onClick={() => { setActiveTab(id); navigate(route); }}
              >
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
  wrapper: {
    minHeight: '100vh',
    backgroundColor: '#F5F5F5',
    display: 'flex',
    justifyContent: 'center',
  },
  screen: {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: '#FFFFFF',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    padding: '6px',
    cursor: 'pointer',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  searchBox: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#F5F5F5',
    border: '1.5px solid #E8E8E8',
    borderRadius: '10px',
    padding: '9px 12px',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    fontSize: '14px',
    color: '#1A1A1A',
    fontFamily: 'inherit',
    minWidth: 0,
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    padding: '0 2px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  cancelBtn: {
    background: 'none',
    border: 'none',
    fontSize: '14px',
    color: '#666666',
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
    padding: '6px 2px',
  },

  // Filter chips
  filtersWrap: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    padding: '10px 14px',
    borderBottom: '1px solid #F5F5F5',
    scrollbarWidth: 'none',
  },
  chip: {
    flexShrink: 0,
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
  },
  chipActive: {
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: '1.5px solid #1A6B3C',
    fontWeight: '600',
  },
  chipInactive: {
    backgroundColor: '#FFFFFF',
    color: '#555555',
    border: '1.5px solid #E0E0E0',
  },

  // Body
  body: {
    flex: 1,
    overflowY: 'auto',
    backgroundColor: '#F5F5F5',
  },

  // Section
  section: {
    backgroundColor: '#FFFFFF',
    marginBottom: '8px',
    padding: '16px',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '12px',
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
  },

  // Recent
  recentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  recentRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #F5F5F5',
  },
  recentTerm: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'none',
    border: 'none',
    fontSize: '14px',
    color: '#444444',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
    flex: 1,
    textAlign: 'left',
  },
  recentX: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
  },

  // Popular grid
  popGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
  },
  popCard: {
    border: '1.5px solid #F0F0F0',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    backgroundColor: '#FAFAFA',
  },
  popIconBox: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '4px',
  },
  popName: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    lineHeight: '1.3',
  },
  popSalt: {
    fontSize: '11px',
    color: '#888888',
    margin: 0,
  },
  popFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '6px',
  },
  popPrice: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1A6B3C',
  },
  addBtn: {
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  popStores: {
    fontSize: '10px',
    color: '#AAAAAA',
    margin: 0,
  },

  // Results
  resultsWrap: {
    backgroundColor: '#F5F5F5',
  },
  searchingRow: {
    display: 'flex', alignItems: 'center', gap: '8px',
    fontSize: '13px', color: '#1A6B3C', fontWeight: '500',
    backgroundColor: '#E8F5EE', padding: '9px 14px',
    borderRadius: '10px', marginBottom: '10px',
  },
  resultsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px 8px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0',
    marginBottom: '8px',
  },
  resultsCount: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#444444',
    flex: 1,
  },
  sortRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  sortLabel: {
    fontSize: '12px',
    color: '#888888',
  },
  sortSelect: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#1A6B3C',
    border: 'none',
    background: 'none',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    appearance: 'none',
    paddingRight: '2px',
  },
  resultsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '0 12px',
  },

  // Result card
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '14px',
    display: 'flex',
    gap: '12px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.06)',
  },
  resultIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  resultBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  resultTopRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '6px',
  },
  resultName: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    flex: 1,
    lineHeight: '1.3',
  },
  rxBadge: {
    fontSize: '10px',
    fontWeight: '700',
    padding: '2px 7px',
    borderRadius: '20px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  rxRequired: {
    backgroundColor: '#FFF3E8',
    color: '#EA6C00',
  },
  rxNotRequired: {
    backgroundColor: '#E8F5EE',
    color: '#1A6B3C',
  },
  resultBrand: {
    fontSize: '12px',
    color: '#666666',
    margin: 0,
  },
  resultSalt: {
    fontSize: '11px',
    color: '#AAAAAA',
    margin: 0,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
  },
  price: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A6B3C',
  },
  mrp: {
    fontSize: '12px',
    color: '#AAAAAA',
    textDecoration: 'line-through',
  },
  offBadge: {
    fontSize: '10px',
    fontWeight: '700',
    color: '#EA6C00',
    backgroundColor: '#FFF3E8',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  storeAvail: {
    fontSize: '11px',
    color: '#888888',
    margin: '2px 0 6px',
  },
  resultBtnRow: {
    display: 'flex',
    gap: '8px',
  },
  detailBtn: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid #1A6B3C',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#1A6B3C',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  orderBtnR: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#1A6B3C',
    border: '1.5px solid #1A6B3C',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Empty state
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    padding: '60px 32px',
    backgroundColor: '#FFFFFF',
  },
  emptyTitle: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#333333',
    margin: 0,
  },
  emptySubtitle: {
    fontSize: '13px',
    color: '#888888',
    margin: '0 0 12px',
    textAlign: 'center',
  },
  prescBtn: {
    width: '100%',
    padding: '13px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pharmacistBtn: {
    width: '100%',
    padding: '13px',
    backgroundColor: '#FFFFFF',
    color: '#1A6B3C',
    border: '1.5px solid #1A6B3C',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Bottom nav
  bottomNav: {
    position: 'sticky',
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTop: '1px solid #F0F0F0',
    display: 'flex',
    padding: '8px 0 12px',
    boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
  },
  navTab: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 0',
    position: 'relative',
    fontFamily: 'inherit',
  },
  navLabel: {
    fontSize: '10px',
  },
  navDot: {
    position: 'absolute',
    top: '-8px',
    width: '20px',
    height: '3px',
    backgroundColor: '#1A6B3C',
    borderRadius: '2px',
  },
};
