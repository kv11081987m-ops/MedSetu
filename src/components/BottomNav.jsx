import { useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { Home, LayoutGrid, ShoppingCart, ShoppingBag, User } from 'lucide-react';

// R3-C3: shared, permanent bottom-nav for every customer screen — self-
// positioned (position:fixed) so it never depends on a screen's own
// layout being scroll-bound correctly (the "whole page scrolls, not an
// internal region" issue found in R3-B). Active tab comes from the real
// route (useLocation), not per-screen local state, so it can never drift
// out of sync with what's actually on screen.
const TABS = [
  { id: 'home',       label: 'Home',       Icon: Home,         route: '/home' },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid,   route: '/categories' },
  { id: 'cart',       label: 'Cart',       Icon: ShoppingCart, route: '/checkout' },
  { id: 'orders',     label: 'Orders',     Icon: ShoppingBag,  route: '/orders' },
  { id: 'profile',    label: 'Profile',    Icon: User,         route: '/profile' },
];

// onNavigate: optional callback fired right before navigating away, for
// a screen that needs to run its own cleanup on exit — e.g.
// PrescriptionUpload.jsx clears a sessionStorage flag it uses to survive
// a mobile camera-kill reload, and must not leave it dangling if the
// customer leaves via a nav tap instead of the screen's own buttons.
export default function BottomNav({ onNavigate }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { cartCount } = useCart();

  return (
    <nav style={s.bottomNav}>
      {TABS.map(({ id, label, Icon, route }) => {
        const isActive = location.pathname === route;
        return (
          <button key={id} style={s.navTab} onClick={() => { onNavigate?.(); navigate(route); }}>
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'} strokeWidth={isActive ? 2.5 : 1.8} />
              {id === 'cart' && cartCount > 0 && (
                <span style={s.cartBadge}>{cartCount > 9 ? '9+' : cartCount}</span>
              )}
            </div>
            <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA', fontWeight: isActive ? '600' : '400' }}>
              {label}
            </span>
            {isActive && <span style={s.navDot} />}
          </button>
        );
      })}
    </nav>
  );
}

const s = {
  // position:fixed to the viewport, centered to the app's own mobile-width
  // container (not full browser width) — same reasoning as CartBar.jsx.
  bottomNav: {
    position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
    width: '100%', maxWidth: '480px', zIndex: 50,
    backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0',
    display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
  },
  navTab: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', position: 'relative', fontFamily: 'inherit' },
  navLabel: { fontSize: '10px' },
  navDot: { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
  cartBadge: {
    position: 'absolute', top: '-6px', right: '-8px',
    minWidth: '15px', height: '15px', borderRadius: '8px',
    backgroundColor: '#EF4444', color: '#FFFFFF',
    fontSize: '9px', fontWeight: '700',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 3px', lineHeight: 1,
  },
};
