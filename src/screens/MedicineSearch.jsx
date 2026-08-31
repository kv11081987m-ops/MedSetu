import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import {
  ArrowLeft, X, Clock, TrendingUp,
  Search, RefreshCw,
} from 'lucide-react';
import { searchMedicines, fetchPopularMedicines, mapMedicine, fetchSupportWhatsapp, fetchMrpMode } from '../lib/api';
import MedicineCard from '../components/MedicineCard';
import CartBar from '../components/CartBar';
import BottomNav from '../components/BottomNav';

const INITIAL_RECENT = [
  'Paracetamol 500mg', 'BP Machine', 'Crocin 650mg', 'ORS Powder',
];

const FILTERS = ['Sab', 'Tablets', 'Syrup', 'Injection', 'Equipment', 'Ayurvedic', 'Generic', 'Branded'];
const filterKey = { Tablets: 'tablet', Syrup: 'syrup', Equipment: 'equipment', Injection: 'injection', Ayurvedic: 'ayurvedic' };

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

// ─── Main Screen ──────────────────────────────────────────────
export default function MedicineSearch() {
  const navigate = useNavigate();
  const { cartCount } = useCart();
  const inputRef    = useRef(null);
  const debounceRef = useRef(null);

  const [query, setQuery]             = useState('');
  const [activeFilter, setActiveFilter] = useState('Sab');
  const [recent, setRecent]           = useState(INITIAL_RECENT);
  const [popularMeds, setPopularMeds] = useState([]);
  const [searchResults, setSearchResults] = useState({ branded: [], generic: [], janaushadhi: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const [supportWhatsapp, setSupportWhatsapp] = useState('919196103234');
  const [mrpMode, setMrpMode] = useState(false);
  const [popularError, setPopularError] = useState(false);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => {
    fetchSupportWhatsapp().then(setSupportWhatsapp);
  }, []);

  // Popular feed loader — extracted so the error-retry line can re-run it.
  // A real RPC failure sets popularError (retry prompt); a genuinely empty
  // result just leaves popularMeds = [] (the seedling line).
  const loadPopular = useCallback(async (mrpModeOn) => {
    const { data, error } = await fetchPopularMedicines(12, mrpModeOn);
    if (error) { setPopularError(true); return; }
    setPopularError(false);
    // Raw rows (same shape searchMedicines' sections and Home already
    // pass straight into MedicineCard) plus a derived `.type` — kept
    // only so the existing Tablets/Syrup/Injection filter chips above
    // keep matching the same way they always have (applyFilter below).
    setPopularMeds((data || []).map(m => ({ ...m, type: mapMedicine(m).type })));
  }, []);

  // mrpMode must be known BEFORE fetching popular meds — the fetch's
  // stock-vs-seller_hidden filter depends on it, so this can't be two
  // independent parallel effects.
  useEffect(() => {
    (async () => {
      const mrpModeOn = await fetchMrpMode();
      setMrpMode(mrpModeOn);
      await loadPopular(mrpModeOn);
    })();
  }, [loadPopular]);

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
      setSearchError(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchMedicines(val.trim(), mrpMode);
      setSearchError(!!results.error);
      setSearchResults({
        janaushadhi: results.janaushadhi,
        generic:     results.generic,
        branded:     results.branded,
      });
      setSearchLoading(false);
    }, 400);
  }, [mrpMode]);

  const handleRecentClick = (term) => { handleSearch(term); inputRef.current?.focus(); };

  const applyFilter = (list) => {
    if (activeFilter === 'Sab')     return list;
    if (activeFilter === 'Generic') return list.filter(m => m.is_generic === true);
    if (activeFilter === 'Branded') return list.filter(m => !m.is_generic);
    return list.filter(m => m.type === filterKey[activeFilter]);
  };

  const isSearching = query.trim().length >= 2;
  const hasResults  = searchResults.janaushadhi.length > 0 || searchResults.generic.length > 0 || searchResults.branded.length > 0;

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
                    <Clock size={14} color="#0C447C" />
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
                {popularError ? (
                  <p style={{ fontSize: '13px', color: '#B4232C', textAlign: 'center', padding: '16px 0', margin: 0 }}>
                    ⚠️ Load nahi ho paayi.{' '}
                    <button
                      onClick={() => { setPopularError(false); loadPopular(mrpMode); }}
                      style={{ background: 'none', border: 'none', color: '#0C447C', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
                    >
                      Dobara try karein
                    </button>
                  </p>
                ) : applyFilter(popularMeds).length === 0 ? (
                  <p style={{ fontSize: '13px', color: '#AAAAAA', textAlign: 'center', padding: '16px 0', margin: 0 }}>
                    🌱 Jald hi naye medicines available honge
                  </p>
                ) : (
                  <div>
                    {applyFilter(popularMeds).map(item => (
                      <MedicineCard
                        key={item.id}
                        medicine={item}
                        type={item.source === 'janaushadhi' ? 'janaushadhi' : item.is_generic ? 'generic' : 'branded'}
                        mrpMode={mrpMode}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : searchLoading ? (
            /* ── Loading ── */
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#1A6B3C', fontWeight: '500', backgroundColor: '#E8F5EE', padding: '12px 16px', margin: '12px', borderRadius: '10px' }}>
              <RefreshCw size={14} color="#1A6B3C" style={{ animation: 'spin 1s linear infinite' }} />
              Medicines dhundh raha hai...
            </div>
          ) : searchError ? (
            /* ── Search failed (RPC error) — distinct from a real "no match" ── */
            <div style={s.emptyState}>
              <p style={{ fontSize: '48px', margin: 0 }}>⚠️</p>
              <p style={s.emptyTitle}>Kuch galat hua</p>
              <p style={s.emptySubtitle}>
                Search abhi load nahi ho paayi — thodi der baad dobara try karein.
              </p>
              <button style={s.prescBtn} onClick={() => handleSearch(query)}>
                Dobara try karein
              </button>
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
                    <MedicineCard key={med.id} medicine={med} type="janaushadhi" mrpMode={mrpMode} />
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
                    <MedicineCard key={med.id} medicine={med} type="generic" mrpMode={mrpMode} />
                  ))}
                </div>
              )}

              {/* Branded — no banner (B15): generic/sasta is the mission,
                  branded results still show, just without a promoted
                  header pushing them. Cards start straight after
                  Jan Aushadhi/Generic above. */}
              {searchResults.branded.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  {searchResults.branded.map(med => (
                    <MedicineCard key={med.id} medicine={med} type="branded" mrpMode={mrpMode} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── No Results ── */
            <div style={s.emptyState}>
              <p style={{ fontSize: '48px', margin: 0 }}>🔍</p>
              <p style={s.emptyTitle}>"{query}" abhi available nahi</p>
              <p style={s.emptySubtitle}>
                Yeh medicine abhi kisi store mein available nahi hai.{'\n'}
                Hum lagatar naye stores jod rahe hain — baad mein dobara dekhein.
              </p>
              <button style={s.prescBtn} onClick={() => navigate('/prescription')}>
                Prescription Upload Karo
              </button>
              <button style={s.pharmacistBtn} onClick={() => {
                const msg = encodeURIComponent('Namaste, mujhe medicine ke baare mein poochna tha. Kya aap help kar sakte hain?');
                window.open(`https://wa.me/${supportWhatsapp}?text=${msg}`, '_blank');
              }}>
                Pharmacist Se Poochho
              </button>
            </div>
          )}

          {/* Clearance for the fixed footer below — taller when the cart
              bar is also floating (nav + cart bar), so the last list item
              never ends up hidden underneath it. */}
          <div style={{ height: cartCount > 0 ? '140px' : '80px' }} />
        </div>

        {/* ── Cart bar + shared bottom-nav (R3-C3) ──
            The page itself scrolls (screen uses minHeight, not height —
            .body's overflowY:auto never actually clips), so a plain
            in-flow element only appears at the very bottom of a long
            list. Both CartBar and BottomNav are independently
            position:fixed to the viewport (not nested inside one shared
            fixed wrapper — nesting fixed-in-fixed has containing-block
            quirks) — CartBar sits at a fixed offset (~nav height) above
            BottomNav, which self-positions at bottom:0. */}
        <CartBar
          cartCount={cartCount}
          onClick={() => navigate('/checkout')}
          style={{ position: 'fixed', bottom: '58px', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', zIndex: 49 }}
        />
        <BottomNav />
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
  filtersWrap:  { display: 'flex', gap: '8px', overflowX: 'auto', padding: '10px 14px', borderBottom: '1px solid #F5F5F5', scrollbarWidth: 'none' },
  chip:         { flexShrink: 0, padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.15s ease' },
  chipActive:   { backgroundColor: '#1A6B3C', color: '#FFFFFF', border: '1.5px solid #1A6B3C', fontWeight: '600' },
  chipInactive: { backgroundColor: '#FFFFFF', color: '#555555', border: '1.5px solid rgba(12,68,124,0.18)' },
  body:         { flex: 1, overflowY: 'auto', backgroundColor: '#F5F5F5' },
  section:      { backgroundColor: '#FFFFFF', marginBottom: '8px', padding: '16px' },
  sectionHead:  { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' },
  sectionTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A' },
  recentList:   { display: 'flex', flexDirection: 'column', gap: '2px' },
  recentRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F5F5F5' },
  recentTerm:   { display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', fontSize: '14px', color: '#444444', cursor: 'pointer', fontFamily: 'inherit', padding: 0, flex: 1, textAlign: 'left' },
  recentX:      { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' },
  emptyState:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '60px 32px', backgroundColor: '#FFFFFF' },
  emptyTitle:   { fontSize: '17px', fontWeight: '700', color: '#333333', margin: 0 },
  emptySubtitle:{ fontSize: '13px', color: '#888888', margin: '0 0 12px', textAlign: 'center' },
  prescBtn:     { width: '100%', padding: '13px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  pharmacistBtn:{ width: '100%', padding: '13px', backgroundColor: '#FFFFFF', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
};
