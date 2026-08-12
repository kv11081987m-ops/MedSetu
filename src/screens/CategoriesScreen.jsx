import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { fetchMedicinesByCategory, fetchMrpMode } from '../lib/api';
import MedicineCard from '../components/MedicineCard';
import CartBar from '../components/CartBar';
import BottomNav from '../components/BottomNav';
import {
  ArrowLeft, ShoppingCart,
  Pill, PillBottle, Syringe, GlassWater, SprayCan,
  Droplet, FlaskConical, Package, Wind,
} from 'lucide-react';

// R3-C2: dosage_form values, ordered by real frequency in master_medicines
// (checked live — Tablet 152,666 / Injection 30,926 / Syrup 25,653 /
// Capsule 21,475 / Topical 8,136 / Drops 5,512 / Solution 1,141 /
// Powder 370 / Inhaler 227). category is not usable (98%+ "Other").
const CATEGORY_TABS = [
  { id: 'Tablet',    label: 'Tablet',    Icon: Pill },
  { id: 'Injection', label: 'Injection', Icon: Syringe },
  { id: 'Syrup',     label: 'Syrup',     Icon: GlassWater },
  { id: 'Capsule',   label: 'Capsule',   Icon: PillBottle },
  { id: 'Topical',   label: 'Topical',   Icon: SprayCan },
  { id: 'Drops',     label: 'Drops',     Icon: Droplet },
  { id: 'Solution',  label: 'Solution',  Icon: FlaskConical },
  { id: 'Powder',    label: 'Powder',    Icon: Package },
  { id: 'Inhaler',   label: 'Inhaler',   Icon: Wind },
];

export default function CategoriesScreen() {
  const navigate = useNavigate();
  const { cartCount } = useCart();

  const [activeCategory, setActiveCategory] = useState('Tablet');
  const [medicines,      setMedicines]      = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [mrpMode,        setMrpMode]        = useState(false);
  const [mrpModeReady,   setMrpModeReady]   = useState(false);

  useEffect(() => {
    fetchMrpMode().then((on) => { setMrpMode(on); setMrpModeReady(true); });
  }, []);

  // mrpMode must be known before fetching — the fetch's stock-vs-
  // seller_hidden filter depends on it (same ordering as MedicineSearch.jsx
  // /CustomerHome.jsx's medicine fetches).
  useEffect(() => {
    if (!mrpModeReady) return;
    let cancelled = false;
    setLoading(true);
    fetchMedicinesByCategory(activeCategory, mrpMode).then(({ data }) => {
      if (!cancelled) { setMedicines(data || []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [activeCategory, mrpMode, mrpModeReady]);

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Categories</span>
          <button style={s.iconBtn} aria-label="Cart" onClick={() => navigate('/checkout')}>
            <div style={{ position: 'relative' }}>
              <ShoppingCart size={22} color="#1A1A1A" />
              {cartCount > 0 && (
                <span style={s.cartBadge}>{cartCount > 9 ? '9+' : cartCount}</span>
              )}
            </div>
          </button>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Two-pane: left rail (dosage_form categories) + right panel
              (that category's medicine list). Same shape as R3-C1-purana's
              two-pane (now Home's, not this screen's — same styles reused). */}
          <div style={s.twoPane}>
            <div style={s.railCol}>
              {CATEGORY_TABS.map(({ id, label, Icon }) => {
                const isActive = activeCategory === id;
                return (
                  <button
                    key={id}
                    style={{ ...s.railTab, ...(isActive ? s.railTabActive : {}) }}
                    onClick={() => setActiveCategory(id)}
                  >
                    <Icon size={20} color={isActive ? '#1A6B3C' : '#888888'} strokeWidth={isActive ? 2.4 : 1.8} />
                    <span style={{ ...s.railLabel, color: isActive ? '#1A6B3C' : '#888888', fontWeight: isActive ? '700' : '500' }}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={s.rightPanel}>
              {loading ? (
                <p style={s.stateText}>Load ho raha hai...</p>
              ) : medicines.length === 0 ? (
                <p style={s.stateText}>Is category mein abhi medicine nahi</p>
              ) : (
                <div style={s.medicineList}>
                  {medicines.map((med) => (
                    <MedicineCard
                      key={med.id}
                      medicine={med}
                      type={med.source === 'janaushadhi' ? 'janaushadhi' : med.is_generic ? 'generic' : 'branded'}
                      mrpMode={mrpMode}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Clearance for the fixed footer below — taller when the cart
              bar is also floating (same reasoning as MedicineSearch.jsx). */}
          <div style={{ height: cartCount > 0 ? '140px' : '80px' }} />
        </div>

        {/* ── Cart bar + shared bottom-nav (R3-C3) — independently
            position:fixed, not nested (see MedicineSearch.jsx for why). ── */}
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
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#FFFFFF' },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0' },
  iconBtn: { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  headerTitle: { fontSize: '16px', fontWeight: '700', color: '#1A1A1A' },
  cartBadge: {
    position: 'absolute', top: '-5px', right: '-7px',
    minWidth: '16px', height: '16px', borderRadius: '8px',
    backgroundColor: '#EF4444', color: '#FFFFFF',
    fontSize: '10px', fontWeight: '700',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 3px', lineHeight: 1,
  },

  body: { flex: 1, overflowY: 'auto', backgroundColor: '#F5F5F5', padding: '12px' },

  // Two-pane — same approach as R3-C1-purana (now removed from
  // CustomerHome.jsx, this screen is its real home). "height poori bache
  // hue screen ki": .screen uses minHeight not height (whole-page-scrolls,
  // same as MedicineSearch.jsx/CustomerHome.jsx) — 60vh is a pragmatic
  // stand-in, not pixel-exact fill. Polish later.
  twoPane: { display: 'flex', minHeight: '60vh', backgroundColor: '#FFFFFF', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  railCol: { width: '84px', flexShrink: 0, backgroundColor: '#F7F7F7', borderRight: '1px solid #EFEFEF', display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  railTab: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '16px 6px', border: 'none', borderLeft: '3px solid transparent', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' },
  railTabActive: { backgroundColor: '#FFFFFF', borderLeft: '3px solid #1A6B3C' },
  railLabel: { fontSize: '10px', lineHeight: '1.3' },
  rightPanel: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  medicineList: { padding: '12px' },
  stateText: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 16px', fontSize: '13px', color: '#888888', margin: 0 },
};
