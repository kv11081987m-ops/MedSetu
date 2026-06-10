import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, SlidersHorizontal, Search,
  CheckCircle, Star, Phone, ShoppingBag,
  MapPin, Clock, RefreshCw,
} from 'lucide-react';
import { fetchSellers, mapSeller } from '../lib/api';

// ─── Districts ────────────────────────────────────────────────
const DISTRICTS = ['Deoria', 'Gorakhpur', 'Kushinagar', 'Maharajganj', 'Sant Kabir Nagar', 'Basti', 'Azamgarh', 'Mau'];

function getUserDistrict() {
  try {
    const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
    return user?.district || 'Deoria';
  } catch {
    return 'Deoria';
  }
}

// ─── Dummy fallback (shown while loading or on error) ─────────
const FALLBACK_STORES = [
  { id: 'f1', initials: 'SR', name: 'Shri Ram Medical Store',  address: 'Civil Lines, Deoria',    distance: '0.8 km', rating: 4.5, reviews: 128, open: true,  verified: true, timing: '8AM – 9PM', phone: '9876543210', pin: { top: '38%', left: '52%' } },
  { id: 'f2', initials: 'AM', name: 'Arogya Medical Hall',     address: 'Station Road, Deoria',   distance: '1.2 km', rating: 4.2, reviews: 86,  open: true,  verified: true, timing: '9AM – 8PM', phone: '9812345678', pin: { top: '55%', left: '30%' } },
  { id: 'f3', initials: 'GM', name: 'Gupta Medical Agency',    address: 'Collector Ganj, Deoria', distance: '2.1 km', rating: 4.8, reviews: 214, open: false, verified: true, timing: '8AM – 6PM', phone: '9800112233', pin: { top: '25%', left: '72%' } },
];

const FILTERS = ['Sab', 'Abhi Khule', '5km ke andar', 'Highest Rated', 'Verified Only'];

// ─── Map Pin Component ────────────────────────────────────────
function MapPin_({ store, active, onTap }) {
  return (
    <button
      style={{ ...s.pin, top: store.pin.top, left: store.pin.left }}
      onClick={() => onTap(store.id)}
      aria-label={store.name}
    >
      <div style={{ ...s.pinBubble, ...(active ? s.pinBubbleActive : {}) }}>
        <ShoppingBag size={12} color={active ? '#FFFFFF' : '#1A6B3C'} />
      </div>
      <div style={{ ...s.pinTail, ...(active ? s.pinTailActive : {}) }} />
      {active && (
        <div style={s.pinPopup}>
          <p style={s.pinPopupName}>{store.name}</p>
          <p style={s.pinPopupDist}>{store.distance}</p>
        </div>
      )}
    </button>
  );
}

// ─── Store Card ───────────────────────────────────────────────
function StoreCard({ store, onOrder, onCall }) {
  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        {/* Avatar */}
        <div style={s.avatar}>
          <span style={s.avatarText}>{store.initials}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.cardTitleRow}>
            <p style={s.cardName}>{store.name}</p>
            <span style={{ ...s.statusBadge, ...(store.open ? s.statusOpen : s.statusClosed) }}>
              <span style={{ ...s.statusDot, backgroundColor: store.open ? '#22C55E' : '#EF4444' }} />
              {store.open ? 'Khula Hai' : 'Band Hai'}
            </span>
          </div>

          <p style={s.cardAddr}>{store.address}</p>

          <div style={s.metaRow}>
            {/* Distance */}
            <span style={s.distPill}>{store.distance}</span>

            <span style={s.sep}>·</span>

            {/* Rating */}
            <Star size={12} fill="#F59E0B" color="#F59E0B" />
            <span style={s.ratingText}>{store.rating}</span>
            <span style={s.reviewText}>({store.reviews})</span>

            <span style={s.sep}>·</span>

            {/* Verified */}
            <CheckCircle size={12} color="#1A6B3C" />
            <span style={s.verifiedText}>Licensed</span>
          </div>

          {/* Timing */}
          <div style={s.timingRow}>
            <Clock size={12} color="#888888" />
            <span style={s.timingText}>{store.timing}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={s.btnRow}>
        <button style={s.callBtn} onClick={() => onCall(store.phone)}>
          <Phone size={14} color="#1A6B3C" />
          Call Karo
        </button>
        <button
          style={{
            ...s.orderBtn,
            opacity: store.open ? 1 : 0.45,
            cursor: store.open ? 'pointer' : 'not-allowed',
          }}
          onClick={() => store.open && onOrder(store)}
        >
          <ShoppingBag size={14} color="#FFFFFF" />
          Order Karo
        </button>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function StoreLocator() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('Sab');
  const [activePin, setActivePin] = useState(null);
  const [searchVal, setSearchVal] = useState('');
  const [sortBy, setSortBy]       = useState('distance');
  const [stores, setStores]           = useState(FALLBACK_STORES);
  const [loadState, setLoadState]     = useState('loading'); // 'loading' | 'ok' | 'error'
  const [selectedDistrict, setSelectedDistrict] = useState(getUserDistrict);

  const loadStores = (district) => {
    let cancelled = false;
    setLoadState('loading');
    fetchSellers(district).then(({ data, error }) => {
      if (cancelled) return;
      if (error || data.length === 0) {
        setStores(FALLBACK_STORES);
        setLoadState(error ? 'error' : 'ok');
      } else {
        setStores(data.map(mapSeller));
        setLoadState('ok');
      }
    });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    return loadStores(selectedDistrict);
  }, [selectedDistrict]);

  const handlePinTap = (id) => setActivePin(activePin === id ? null : id);

  const filteredStores = stores.filter((st) => {
    if (activeFilter === 'Abhi Khule')    return st.open;
    if (activeFilter === 'Highest Rated') return st.rating >= 4.5;
    if (activeFilter === '5km ke andar')  return parseFloat(st.distance) <= 5;
    if (activeFilter === 'Verified Only') return st.verified !== false;
    return true;
  }).filter((st) =>
    searchVal === '' ||
    st.name.toLowerCase().includes(searchVal.toLowerCase()) ||
    st.address.toLowerCase().includes(searchVal.toLowerCase())
  );

  const sortedStores = [...filteredStores].sort((a, b) => {
    if (sortBy === 'rating') return b.rating - a.rating;
    if (sortBy === 'name')   return a.name.localeCompare(b.name);
    return parseFloat(a.distance) - parseFloat(b.distance);
  });

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Paas Ke Stores</span>
          <button style={s.iconBtn}>
            <SlidersHorizontal size={20} color="#1A6B3C" />
          </button>
        </div>

        {/* ── Search ── */}
        <div style={s.searchWrap}>
          <div style={s.searchBox}>
            <Search size={16} color="#AAAAAA" />
            <input
              style={s.searchInput}
              placeholder="Locality ya area dhundho..."
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
            />
          </div>
        </div>

        {/* ── District Picker ── */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '8px 14px 4px', scrollbarWidth: 'none', borderBottom: '1px solid #F0F0F0' }}>
          {DISTRICTS.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDistrict(d)}
              style={{
                flexShrink: 0, padding: '5px 12px', borderRadius: '20px', fontSize: '12px',
                fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                border: '1.5px solid',
                borderColor: selectedDistrict === d ? '#1A6B3C' : '#E0E0E0',
                backgroundColor: selectedDistrict === d ? '#1A6B3C' : '#FFFFFF',
                color: selectedDistrict === d ? '#FFFFFF' : '#555555',
              }}
            >{d}</button>
          ))}
        </div>

        {/* ── Mock Map ── */}
        <div style={s.mapContainer} onClick={() => setActivePin(null)}>
          {/* Grid lines */}
          <svg style={s.mapSvg} width="100%" height="100%">
            {/* Vertical lines */}
            {[15, 30, 45, 60, 75, 90].map((x) => (
              <line key={`v${x}`} x1={`${x}%`} y1="0" x2={`${x}%`} y2="100%"
                stroke="#C8E6C9" strokeWidth="1" />
            ))}
            {/* Horizontal lines */}
            {[20, 40, 60, 80].map((y) => (
              <line key={`h${y}`} x1="0" y1={`${y}%`} x2="100%" y2={`${y}%`}
                stroke="#C8E6C9" strokeWidth="1" />
            ))}
            {/* Mock roads */}
            <line x1="0" y1="50%" x2="100%" y2="50%"
              stroke="#B0BEC5" strokeWidth="3" strokeDasharray="8,4" />
            <line x1="40%" y1="0" x2="40%" y2="100%"
              stroke="#B0BEC5" strokeWidth="2" strokeDasharray="6,3" />
            <line x1="70%" y1="0" x2="55%" y2="100%"
              stroke="#B0BEC5" strokeWidth="1.5" strokeDasharray="5,3" />
          </svg>

          {/* Watermark */}
          <span style={s.mapWatermark}>🗺️ Map View</span>

          {/* User location dot */}
          <div style={s.userDot}>
            <div style={s.userDotInner} />
            <div style={s.userDotRing} />
          </div>
          <span style={s.userLabel}>Aap</span>

          {/* Store pins */}
          {stores.map((store) => (
            <MapPin_
              key={store.id}
              store={store}
              active={activePin === store.id}
              onTap={handlePinTap}
            />
          ))}
        </div>

        {/* ── Filter Chips ── */}
        <div style={s.filtersWrap}>
          <div style={s.filtersScroll}>
            {FILTERS.map((f) => (
              <button
                key={f}
                style={{
                  ...s.chip,
                  ...(activeFilter === f ? s.chipActive : s.chipInactive),
                }}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* ── List Section ── */}
        <div style={s.listSection}>
          {/* Count + Sort */}
          <div style={s.listHeader}>
            <span style={s.storeCount}>
              {sortedStores.length} Store{sortedStores.length !== 1 ? 's' : ''} Mile Aapke Paas
            </span>
            <div style={s.sortBox}>
              <span style={s.sortLabel}>Sort:</span>
              <select style={s.sortSelect} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="distance">Distance</option>
                <option value="rating">Rating</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {/* Loading / Error banners */}
          {loadState === 'loading' && (
            <div style={s.infoBanner}>
              <RefreshCw size={14} color="#1A6B3C" style={{ animation: 'spin 1s linear infinite' }} />
              Stores load ho rahe hain...
            </div>
          )}
          {loadState === 'error' && (
            <div style={{ ...s.infoBanner, color: '#DC3545', backgroundColor: '#FFEBEE' }}>
              Stores load nahi hue — dummy data dikh raha hai
            </div>
          )}

          {/* Cards */}
          <div style={s.cardsList}>
            {sortedStores.length === 0 ? (
              <div style={s.emptyState}>
                <MapPin size={36} color="#CCCCCC" />
                <p style={s.emptyText}>Koi store nahi mila</p>
              </div>
            ) : (
              sortedStores.map((store) => (
                <StoreCard
                  key={store.id}
                  store={store}
                  onOrder={(st) => navigate('/medicine-search', { state: { store: st } })}
                  onCall={(ph) => window.open(`tel:${ph}`)}
                />
              ))
            )}
          </div>
        </div>
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
    justifyContent: 'space-between',
    padding: '16px 16px 12px',
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
  },
  headerTitle: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#1A1A1A',
  },

  // Search
  searchWrap: {
    padding: '12px 16px',
    backgroundColor: '#FFFFFF',
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#F5F5F5',
    border: '1.5px solid #E8E8E8',
    borderRadius: '12px',
    padding: '11px 14px',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    fontSize: '14px',
    color: '#1A1A1A',
    fontFamily: 'inherit',
  },

  // Mock Map
  mapContainer: {
    position: 'relative',
    height: '42vh',
    minHeight: '220px',
    backgroundColor: '#E8F5E9',
    borderBottom: '2px solid #C8E6C9',
    overflow: 'hidden',
    flexShrink: 0,
  },
  mapSvg: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
  mapWatermark: {
    position: 'absolute',
    bottom: '10px',
    right: '12px',
    fontSize: '12px',
    color: '#A5D6A7',
    fontWeight: '600',
    letterSpacing: '0.5px',
    pointerEvents: 'none',
    userSelect: 'none',
  },

  // User dot
  userDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '16px',
    height: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDotInner: {
    width: '10px',
    height: '10px',
    backgroundColor: '#2563EB',
    borderRadius: '50%',
    border: '2px solid #FFFFFF',
    boxShadow: '0 0 6px rgba(37,99,235,0.5)',
    position: 'absolute',
    zIndex: 2,
  },
  userDotRing: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    backgroundColor: 'rgba(37,99,235,0.15)',
    position: 'absolute',
    zIndex: 1,
  },
  userLabel: {
    position: 'absolute',
    top: 'calc(50% + 16px)',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '10px',
    fontWeight: '700',
    color: '#2563EB',
    backgroundColor: '#FFFFFF',
    padding: '1px 6px',
    borderRadius: '4px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
    whiteSpace: 'nowrap',
    zIndex: 3,
  },

  // Map pins
  pin: {
    position: 'absolute',
    transform: 'translate(-50%, -100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    zIndex: 10,
    padding: '0',
  },
  pinPopup: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    padding: '6px 10px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
    whiteSpace: 'nowrap',
    marginBottom: '6px',
    zIndex: 20,
  },
  pinPopupName: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
  },
  pinPopupDist: {
    fontSize: '10px',
    color: '#1A6B3C',
    margin: 0,
    fontWeight: '600',
  },
  pinBubble: {
    width: '28px',
    height: '28px',
    borderRadius: '50% 50% 50% 4px',
    backgroundColor: '#FFFFFF',
    border: '2.5px solid #1A6B3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    transform: 'rotate(-45deg)',
  },
  pinBubbleActive: {
    backgroundColor: '#1A6B3C',
    border: '2.5px solid #0D4A29',
  },
  pinTail: {
    width: '0',
    height: '0',
    borderLeft: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderTop: '7px solid #1A6B3C',
    marginTop: '-1px',
  },
  pinTailActive: {
    borderTopColor: '#0D4A29',
  },

  // Filter chips
  filtersWrap: {
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0',
    paddingBottom: '2px',
  },
  filtersScroll: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    padding: '12px 16px',
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

  // List section
  listSection: {
    flex: 1,
    overflowY: 'auto',
    backgroundColor: '#F5F5F5',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px 8px',
  },
  storeCount: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  sortBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  sortLabel: {
    fontSize: '12px',
    color: '#888888',
  },
  sortSelect: {
    fontSize: '12px',
    color: '#1A6B3C',
    fontWeight: '600',
    border: 'none',
    background: 'none',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cardsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '0 16px 24px',
  },

  // Store card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '14px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  cardTop: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
  },
  avatar: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: '15px',
    fontWeight: '800',
    color: '#1A6B3C',
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '6px',
    marginBottom: '2px',
  },
  cardName: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    flex: 1,
    lineHeight: '1.3',
  },
  cardAddr: {
    fontSize: '12px',
    color: '#888888',
    margin: '0 0 6px',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexWrap: 'wrap',
    marginBottom: '5px',
  },
  distPill: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#1A6B3C',
    backgroundColor: '#E8F5EE',
    padding: '2px 8px',
    borderRadius: '20px',
  },
  sep: {
    color: '#CCCCCC',
    fontSize: '11px',
  },
  ratingText: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#F59E0B',
  },
  reviewText: {
    fontSize: '11px',
    color: '#AAAAAA',
  },
  verifiedText: {
    fontSize: '11px',
    color: '#1A6B3C',
    fontWeight: '600',
  },
  timingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  timingText: {
    fontSize: '11px',
    color: '#888888',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
    fontWeight: '700',
    padding: '3px 8px',
    borderRadius: '20px',
    flexShrink: 0,
  },
  statusOpen: {
    backgroundColor: '#E8F5EE',
    color: '#1A6B3C',
  },
  statusClosed: {
    backgroundColor: '#FFEEEE',
    color: '#EF4444',
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
  },

  // Action buttons
  btnRow: {
    display: 'flex',
    gap: '10px',
  },
  callBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid #1A6B3C',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#1A6B3C',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  orderBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px',
    backgroundColor: '#1A6B3C',
    border: '1.5px solid #1A6B3C',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  infoBanner: {
    display: 'flex', alignItems: 'center', gap: '8px',
    fontSize: '13px', color: '#1A6B3C', fontWeight: '500',
    backgroundColor: '#E8F5EE', padding: '10px 14px',
    borderRadius: '10px', marginBottom: '8px',
  },

  // Empty state
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    padding: '48px 0',
  },
  emptyText: {
    fontSize: '14px',
    color: '#AAAAAA',
  },
};
