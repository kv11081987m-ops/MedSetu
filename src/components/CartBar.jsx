import { ShoppingCart } from 'lucide-react';

// R3-C0: extracted out of MedicineSearch.jsx (R3-B) — just the button's
// content/style, not its fixed-footer positioning. Positioning stays
// with each screen (they already each own their own footer/bottom-nav
// layout) — this only renders the bar itself, self-guarding on
// cartCount so callers don't need to repeat the `cartCount > 0` check.
export default function CartBar({ cartCount, onClick, style }) {
  if (!cartCount || cartCount <= 0) return null;
  return (
    <button style={{ ...s.cartBar, ...style }} onClick={onClick}>
      <ShoppingCart size={16} color="#FFFFFF" />
      <span style={{ flex: 1, textAlign: 'left' }}>Cart Dekho ({cartCount} items)</span>
      <span style={s.cartBarArrow}>Checkout →</span>
    </button>
  );
}

const s = {
  // Translucent + blurred (Kumar: "light color transparent type") —
  // content scrolling underneath stays faintly visible, text stays
  // readable at this opacity/contrast.
  cartBar: { display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(26,107,60,0.88)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', padding: '10px 16px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: '#FFFFFF', fontSize: '13px', fontWeight: '700', width: '100%', boxShadow: '0 -2px 12px rgba(0,0,0,0.12)' },
  cartBarArrow: { fontSize: '13px', fontWeight: '600', color: '#C8F5D8', flexShrink: 0 },
};
