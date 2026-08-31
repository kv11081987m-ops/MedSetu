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

// B15: same dosage_form -> colour mapping as MedicineCard.jsx's left
// strip (kept as its own local copy — MedicineCard isn't touched by this
// task — so the rail's per-category colour matches the cards it filters).
const DOSAGE_COLORS = {
  Tablet:    '#E0A818',
  Injection: '#0C447C',
  Syrup:     '#0D9488',
  Capsule:   '#F26C0A',
  Topical:   '#1A6B3C',
  Drops:     '#06B6D4',
  Solution:  '#7C3AED',
  Powder:    '#92400E',
  Inhaler:   '#0EA5E9',
};

export default function CategoriesScreen() {
  const navigate = useNavigate();
  const { cartCount } = useCart();

  const [activeCategory, setActiveCategory] = useState('Tablet');
  const [medicines,      setMedicines]      = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [mrpMode,        setMrpMode]        = useState(false);
  const [mrpModeReady,   setMrpModeReady]   = useState(false);
  const [categoryError,  setCategoryError]  = useState(false);
  const [retryTick,      setRetryTick]      = useState(0);

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
    fetchMedicinesByCategory(activeCategory, mrpMode).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setCategoryError(true); setLoading(false); return; }
      setCategoryError(false);
      setMedicines(data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeCategory, mrpMode, mrpModeReady, retryTick]);

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#0C447C" />
          </button>
          <span style={s.headerTitle}>Categories</span>
          <button style={s.iconBtn} aria-label="Cart" onClick={() => navigate('/checkout')}>
            <div style={{ position: 'relative' }}>
              <ShoppingCart size={22} color="#0C447C" />
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
                const color = DOSAGE_COLORS[id] || '#888888';
                return (
                  <button
                    key={id}
                    style={{
                      ...s.railTab,
                      backgroundColor: isActive ? '#FFFFFF' : 'transparent',
                      borderLeft: isActive ? `3px solid ${color}` : '3px solid transparent',
                    }}
                    onClick={() => setActiveCategory(id)}
                  >
                    <div style={{ ...s.railIconBox, backgroundColor: color + '1F' }}>
                      <Icon size={15} color={color} strokeWidth={isActive ? 2.4 : 1.8} />
                    </div>
                    <span style={{ ...s.railLabel, color: isActive ? color : '#888888', fontWeight: isActive ? '700' : '500' }}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={s.rightPanel}>
              {loading ? (
                <p style={s.stateText}>Load ho raha hai...</p>
              ) : categoryError ? (
                <p style={s.stateText}>
                  ⚠️ Load nahi ho paayi.{' '}
                  <button
                    onClick={() => { setCategoryError(false); setRetryTick((t) => t + 1); }}
                    style={{ background: 'none', border: 'none', color: '#0C447C', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
                  >
                    Dobara try karein
                  </button>
                </p>
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

  // Pinned to the viewport top — window-scroll pattern is unchanged
  // (same as every other screen in this app, .screen still uses
  // minHeight not height), this just sticks the header the same way
  // railCol already sticks: no ancestor clips/scrolls it, so top:0
  // pins it correctly. Rendered height is 55px (10px padding + 34px
  // iconBtn + 1px border) — railCol's `top` below is set to match, so
  // it sticks flush under this instead of behind it.
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px',
    background: 'linear-gradient(90deg, #FFF1E6 0%, #EAF2FB 100%)',
    borderBottom: '1px solid rgba(12,68,124,0.08)',
    position: 'sticky', top: 0, zIndex: 10,
  },
  iconBtn: { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  headerTitle: { fontSize: '16px', fontWeight: '700', color: '#0C447C' },
  cartBadge: {
    position: 'absolute', top: '-5px', right: '-7px',
    minWidth: '16px', height: '16px', borderRadius: '8px',
    backgroundColor: '#EF4444', color: '#FFFFFF',
    fontSize: '10px', fontWeight: '700',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 3px', lineHeight: 1,
  },

  // B15: no overflowY here anymore — it never actually clipped (.screen
  // uses minHeight not height, so the whole page/window scrolls, same as
  // MedicineSearch.jsx/CustomerHome.jsx), but its mere presence made
  // .body count as railCol's "nearest scrolling ancestor" for sticky
  // purposes, which broke stickiness since .body itself never scrolls.
  // Removing it lets railCol's position:sticky reference the real
  // scrolling context (the window) instead.
  body: { flex: 1, backgroundColor: '#F5F5F5', padding: '12px' },

  // Two-pane — same approach as R3-C1-purana (now removed from
  // CustomerHome.jsx, this screen is its real home). "height poori bache
  // hue screen ki": .screen uses minHeight not height (whole-page-scrolls,
  // same as MedicineSearch.jsx/CustomerHome.jsx) — 60vh is a pragmatic
  // stand-in, not pixel-exact fill. Polish later.
  // B15: dropped overflow:'hidden' — an overflow-clipping ancestor is the
  // other classic way to break position:sticky on a child, even when (as
  // here) it never actually clips anything. The rounded-corner look it
  // existed for is recreated below via railCol's own left corner radii
  // instead (rightPanel has no opaque background of its own, so twoPane's
  // white fill + radius already shows through correctly on the right).
  twoPane: { display: 'flex', minHeight: '60vh', backgroundColor: '#FFFFFF', borderRadius: '14px', border: '1px solid rgba(12,68,124,0.08)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  // Sticky. alignSelf:'flex-start' is deliberate, not the flex row's
  // default 'stretch' — position:sticky on a flex item that's also
  // stretched to match its tallest sibling (rightPanel) is a well-known
  // cross-browser flex+sticky bug (the stretched height throws off the
  // sticky offset calculation, so it silently never sticks). With
  // flex-start, railCol sizes to its own content instead, and its
  // "stuck" range is bounded by twoPane (the containing block, still as
  // tall as rightPanel) rather than by railCol's own box — same visual
  // result (pinned for as long as the medicine list scrolls, releases
  // once the last card has passed) without the bug.
  // Shrunk (all 9 tabs now fit one screen's height, ~60px/tab) — no
  // internal scroll needed any more, so overflowY is gone too.
  // top:'55px' matches header's rendered height exactly (see header's
  // comment above) — sticks flush under the now-also-sticky header
  // instead of being covered by it.
  railCol: {
    width: '84px', flexShrink: 0, backgroundColor: '#F7F7F7',
    borderRight: '1px solid #EFEFEF',
    borderTopLeftRadius: '14px', borderBottomLeftRadius: '14px',
    display: 'flex', flexDirection: 'column',
    position: 'sticky', top: '55px', alignSelf: 'flex-start', zIndex: 1,
  },
  railTab: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px 4px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' },
  railIconBox: { width: '28px', height: '28px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  railLabel: { fontSize: '9.5px', lineHeight: '1.2' },
  rightPanel: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  medicineList: { padding: '12px' },
  stateText: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 16px', fontSize: '13px', color: '#888888', margin: 0 },
};
