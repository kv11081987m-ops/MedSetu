import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, CheckCircle, Star, Phone, Package,
  Clock, RefreshCw,
} from 'lucide-react';
import { fetchWholesalers, mapSeller } from '../lib/api';
import { getCurrentSeller } from '../lib/auth';

const DISTRICTS = ['Deoria', 'Gorakhpur', 'Kushinagar', 'Maharajganj', 'Sant Kabir Nagar', 'Basti', 'Azamgarh', 'Mau'];
const FILTERS   = ['Sab', 'Abhi Khule', 'Highest Rated', 'Verified Only'];

// ─── Map Pin ──────────────────────────────────────────────────
function MapPin_({ store, active, onTap }) {
  return (
    <button
      style={{ ...s.pin, top: store.pin.top, left: store.pin.left }}
      onClick={() => onTap(store.id)}
      aria-label={store.name}
    >
      <div style={{ ...s.pinBubble, ...(active ? s.pinBubbleActive : {}) }}>
        <Package size={12} color={active ? '#FFFFFF' : '#0C447C'} />
      </div>
      <div style={{ ...s.pinTail, ...(active ? s.pinTailActive : {}) }} />
      {active && (
        <div style={s.pinPopup}>
          <p style={s.pinPopupName}>{store.name}</p>
          <p style={s.pinPopupDist}>Wholesaler</p>
        </div>
      )}
    </button>
  );
}

// ─── Wholesaler Card ──────────────────────────────────────────
function WholesalerCard({ store, onCall, onViewInventory }) {
  return (
    <div style={s.card}>
      <div style={s.cardTop}>
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
            <Star size={12} fill="#F59E0B" color="#F59E0B" />
            <span style={s.ratingText}>{store.rating}</span>
            <span style={s.reviewText}>({store.reviews})</span>
            <span style={s.sep}>·</span>
            <CheckCircle size={12} color="#0C447C" />
            <span style={s.verifiedText}>Licensed Wholesaler</span>
          </div>

          <div style={s.timingRow}>
            <Clock size={12} color="#888888" />
            <span style={s.timingText}>{store.timing}</span>
          </div>
        </div>
      </div>

      <div style={s.btnRow}>
        <button style={s.callBtn} onClick={() => onCall(store.phone)}>
          <Phone size={14} color="#0C447C" />
          Call Karo
        </button>
        <button
          style={{
            ...s.contactBtn,
            opacity: store.open ? 1 : 0.45,
            cursor: store.open ? 'pointer' : 'not-allowed',
          }}
          onClick={() => store.open && onViewInventory(store)}
        >
          <Package size={14} color="#FFFFFF" />
          Medicines Dekho
        </button>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function WholesalerLocator() {
  const navigate = useNavigate();

  const [activeFilter,     setActiveFilter]     = useState('Sab');
  const [activePin,        setActivePin]        = useState(null);
  const [searchVal,        setSearchVal]        = useState('');
  const [sortBy,           setSortBy]           = useState('rating');
  const [stores,           setStores]           = useState([]);
  const [loadState,        setLoadState]        = useState('loading');
  const [selectedDistrict, setSelectedDistrict] = useState('Deoria');

  // Auto-detect seller's district
  useEffect(() => {
    getCurrentSeller().then((seller) => {
      if (seller?.district) setSelectedDistrict(seller.district);
    });
  }, []);

  const loadStores = (district) => {
    let cancelled = false;
    setLoadState('loading');
    fetchWholesalers(district).then(({ data, error }) => {
      if (cancelled) return;
      setStores(error ? [] : data.map(mapSeller));
      setLoadState(error ? 'error' : 'ok');
    });
    return () => { cancelled = true; };
  };

  useEffect(() => { return loadStores(selectedDistrict); }, [selectedDistrict]);

  const handlePinTap = (id) => setActivePin(activePin === id ? null : id);

  const filteredStores = stores
    .filter((st) => {
      if (activeFilter === 'Abhi Khule')    return st.open;
      if (activeFilter === 'Highest Rated') return st.rating >= 4.5;
      if (activeFilter === 'Verified Only') return st.verified !== false;
      return true;
    })
    .filter((st) =>
      searchVal === '' ||
      st.name.toLowerCase().includes(searchVal.toLowerCase()) ||
      st.address.toLowerCase().includes(searchVal.toLowerCase())
    );

  const sortedStores = [...filteredStores].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return b.rating - a.rating;
  });

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/seller-dashboard')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Wholesaler Se Khareedo</span>
          <div style={{ width: '34px' }} />
        </div>

        {/* ── Search ── */}
        <div style={s.searchWrap}>
          <div style={s.searchBox}>
            <Search size={16} color="#AAAAAA" />
            <input
              style={s.searchInput}
              placeholder="Wholesaler ka naam dhundho..."
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
                border: selectedDistrict === d ? '1.5px solid #0C447C' : '1.5px solid #E0E0E0',
                backgroundColor: selectedDistrict === d ? '#0C447C' : '#FFFFFF',
                color:           selectedDistrict === d ? '#FFFFFF' : '#555555',
              }}
            >{d}</button>
          ))}
        </div>

        {/* ── Mock Map ── */}
        <div style={s.mapContainer} onClick={() => setActivePin(null)}>
          <svg style={s.mapSvg} width="100%" height="100%">
            {[15, 30, 45, 60, 75, 90].map((x) => (
              <line key={`v${x}`} x1={`${x}%`} y1="0" x2={`${x}%`} y2="100%"
                stroke="#BBDEFB" strokeWidth="1" />
            ))}
            {[20, 40, 60, 80].map((y) => (
              <line key={`h${y}`} x1="0" y1={`${y}%`} x2="100%" y2={`${y}%`}
                stroke="#BBDEFB" strokeWidth="1" />
            ))}
            <line x1="0" y1="50%" x2="100%" y2="50%"
              stroke="#90CAF9" strokeWidth="3" strokeDasharray="8,4" />
            <line x1="40%" y1="0" x2="40%" y2="100%"
              stroke="#90CAF9" strokeWidth="2" strokeDasharray="6,3" />
            <line x1="70%" y1="0" x2="55%" y2="100%"
              stroke="#90CAF9" strokeWidth="1.5" strokeDasharray="5,3" />
          </svg>
          <span style={s.mapWatermark}>🗺️ Map View</span>
          <div style={s.userDot}>
            <div style={s.userDotInner} />
            <div style={s.userDotRing} />
          </div>
          <span style={s.userLabel}>Aap</span>
          {stores.map((store) => (
            <MapPin_ key={store.id} store={store} active={activePin === store.id} onTap={handlePinTap} />
          ))}
        </div>

        {/* ── Filter Chips ── */}
        <div style={s.filtersWrap}>
          <div style={s.filtersScroll}>
            {FILTERS.map((f) => (
              <button
                key={f}
                style={{ ...s.chip, ...(activeFilter === f ? s.chipActive : s.chipInactive) }}
                onClick={() => setActiveFilter(f)}
              >{f}</button>
            ))}
          </div>
        </div>

        {/* ── List Section ── */}
        <div style={s.listSection}>
          <div style={s.listHeader}>
            <span style={s.storeCount}>
              {sortedStores.length} Wholesaler{sortedStores.length !== 1 ? 's' : ''} Mile
            </span>
            <div style={s.sortBox}>
              <span style={s.sortLabel}>Sort:</span>
              <select style={s.sortSelect} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="rating">Rating</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {loadState === 'loading' && (
            <div style={s.infoBanner}>
              <RefreshCw size={14} color="#0C447C" style={{ animation: 'spin 1s linear infinite' }} />
              Wholesalers load ho rahe hain...
            </div>
          )}
          {loadState === 'error' && (
            <div style={{ ...s.infoBanner, color: '#DC3545', backgroundColor: '#FFEBEE' }}>
              Load nahi hua — dobara try karo
            </div>
          )}

          <div style={s.cardsList}>
            {loadState !== 'loading' && sortedStores.length === 0 ? (
              <div style={s.emptyState}>
                <Package size={36} color="#CCCCCC" />
                <p style={s.emptyText}>Aapke district mein abhi koi wholesaler nahi hai</p>
              </div>
            ) : (
              sortedStores.map((store) => (
                <WholesalerCard
                  key={store.id}
                  store={store}
                  onCall={(ph) => window.open(`tel:${ph}`)}
                  onViewInventory={(st) => navigate('/wholesaler-inventory', { state: { sellerId: st.id, storeName: st.name } })}
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
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#FFFFFF' },

  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0' },
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  headerTitle: { fontSize: '17px', fontWeight: '700', color: '#1A1A1A' },

  searchWrap:  { padding: '12px 16px', backgroundColor: '#FFFFFF' },
  searchBox:   { display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#F5F5F5', border: '1.5px solid #E8E8E8', borderRadius: '12px', padding: '11px 14px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#1A1A1A', fontFamily: 'inherit' },

  mapContainer: { position: 'relative', height: '42vh', minHeight: '220px', backgroundColor: '#E3F2FD', borderBottom: '2px solid #BBDEFB', overflow: 'hidden', flexShrink: 0 },
  mapSvg:       { position: 'absolute', inset: 0, pointerEvents: 'none' },
  mapWatermark: { position: 'absolute', bottom: '10px', right: '12px', fontSize: '12px', color: '#90CAF9', fontWeight: '600', letterSpacing: '0.5px', pointerEvents: 'none', userSelect: 'none' },

  userDot:      { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  userDotInner: { width: '10px', height: '10px', backgroundColor: '#0C447C', borderRadius: '50%', border: '2px solid #FFFFFF', boxShadow: '0 0 6px rgba(12,68,124,0.5)', position: 'absolute', zIndex: 2 },
  userDotRing:  { width: '26px', height: '26px', borderRadius: '50%', backgroundColor: 'rgba(12,68,124,0.15)', position: 'absolute', zIndex: 1 },
  userLabel:    { position: 'absolute', top: 'calc(50% + 16px)', left: '50%', transform: 'translateX(-50%)', fontSize: '10px', fontWeight: '700', color: '#0C447C', backgroundColor: '#FFFFFF', padding: '1px 6px', borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.12)', whiteSpace: 'nowrap', zIndex: 3 },

  pin:            { position: 'absolute', transform: 'translate(-50%, -100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', zIndex: 10, padding: '0' },
  pinPopup:       { position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '6px 10px', boxShadow: '0 2px 10px rgba(0,0,0,0.15)', whiteSpace: 'nowrap', marginBottom: '6px', zIndex: 20 },
  pinPopupName:   { fontSize: '11px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  pinPopupDist:   { fontSize: '10px', color: '#0C447C', margin: 0, fontWeight: '600' },
  pinBubble:      { width: '28px', height: '28px', borderRadius: '50% 50% 50% 4px', backgroundColor: '#FFFFFF', border: '2.5px solid #0C447C', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.15)', transform: 'rotate(-45deg)' },
  pinBubbleActive:{ backgroundColor: '#0C447C', border: '2.5px solid #092F56' },
  pinTail:        { width: '0', height: '0', borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid #0C447C', marginTop: '-1px' },
  pinTailActive:  { borderTopColor: '#092F56' },

  filtersWrap:  { backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', paddingBottom: '2px' },
  filtersScroll:{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '12px 16px', scrollbarWidth: 'none' },
  chip:         { flexShrink: 0, padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.15s ease' },
  chipActive:   { backgroundColor: '#0C447C', color: '#FFFFFF', border: '1.5px solid #0C447C', fontWeight: '600' },
  chipInactive: { backgroundColor: '#FFFFFF', color: '#555555', border: '1.5px solid #E0E0E0' },

  listSection: { flex: 1, overflowY: 'auto', backgroundColor: '#F5F5F5' },
  listHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' },
  storeCount:  { fontSize: '14px', fontWeight: '700', color: '#1A1A1A' },
  sortBox:     { display: 'flex', alignItems: 'center', gap: '4px' },
  sortLabel:   { fontSize: '12px', color: '#888888' },
  sortSelect:  { fontSize: '12px', color: '#0C447C', fontWeight: '600', border: 'none', background: 'none', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' },
  cardsList:   { display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 16px 24px' },

  card:        { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '12px' },
  cardTop:     { display: 'flex', gap: '12px', alignItems: 'flex-start' },
  avatar:      { width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#EAF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText:  { fontSize: '15px', fontWeight: '800', color: '#0C447C' },
  cardTitleRow:{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px', marginBottom: '2px' },
  cardName:    { fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0, flex: 1, lineHeight: '1.3' },
  cardAddr:    { fontSize: '12px', color: '#888888', margin: '0 0 6px' },
  metaRow:     { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginBottom: '5px' },
  ratingText:  { fontSize: '12px', fontWeight: '600', color: '#F59E0B' },
  reviewText:  { fontSize: '11px', color: '#AAAAAA' },
  verifiedText:{ fontSize: '11px', color: '#0C447C', fontWeight: '600' },
  sep:         { color: '#CCCCCC', fontSize: '11px' },
  timingRow:   { display: 'flex', alignItems: 'center', gap: '4px' },
  timingText:  { fontSize: '11px', color: '#888888' },
  statusBadge: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '20px', flexShrink: 0 },
  statusOpen:  { backgroundColor: '#E8F5EE', color: '#1A6B3C' },
  statusClosed:{ backgroundColor: '#FFEEEE', color: '#EF4444' },
  statusDot:   { width: '6px', height: '6px', borderRadius: '50%' },

  btnRow:    { display: 'flex', gap: '10px' },
  callBtn:   { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', backgroundColor: '#FFFFFF', border: '1.5px solid #0C447C', borderRadius: '10px', fontSize: '13px', fontWeight: '600', color: '#0C447C', cursor: 'pointer', fontFamily: 'inherit' },
  contactBtn:{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', backgroundColor: '#0C447C', border: '1.5px solid #0C447C', borderRadius: '10px', fontSize: '13px', fontWeight: '600', color: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit' },

  infoBanner: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#0C447C', fontWeight: '500', backgroundColor: '#EAF2FF', padding: '10px 14px', borderRadius: '10px', margin: '0 16px 8px' },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '48px 24px' },
  emptyText:  { fontSize: '14px', color: '#888888', textAlign: 'center', lineHeight: '1.5', margin: 0 },
};
