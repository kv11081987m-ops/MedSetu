import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { mapMedicine, getRatePerDose, fetchSellersForMedicine } from '../lib/api';

// Small style-formatter shared with PopularCard (MedicineSearch.jsx) —
// exported so that sibling card lives elsewhere without duplicating this.
export const badge = (bg, color) => ({
  background: bg, color, fontSize: '10px', padding: '2px 8px', borderRadius: '99px', fontWeight: '500',
});

// R3-C0: extracted out of MedicineSearch.jsx so Home/Categories screens
// can reuse the exact same card — no visual/behavioral change from the
// R3-A/A2 redesign (no store picker, seller-grounded price/rate/pack-size,
// single Add button).
export default function MedicineCard({ medicine, type, mrpMode }) {
  const { addToCart } = useCart();
  const med      = mapMedicine(medicine);
  const rateInfo = getRatePerDose(medicine, med.price);
  const [added,      setAdded]      = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  const borderColor = type === 'janaushadhi' ? '#1A6B3C'
                    : type === 'generic'      ? '#2563EB'
                    : '#FF8C00';

  // Still a live fetch at add-time (stock/price can have moved since this
  // card's data loaded) — picks the cheapest currently-available seller,
  // same as before R3-A, just without a dropdown to cache it in.
  const handleQuickAdd = async () => {
    if (addLoading || added) return;
    setAddLoading(true);
    const sellerList = await fetchSellersForMedicine(med.id, mrpMode, med.mrp);
    setAddLoading(false);
    if (sellerList.length === 0) return;
    const cheapest = sellerList[0];
    addToCart({ ...med, price: cheapest.price, quantity: 1 });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '14px 16px', marginBottom: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderLeft: `3px solid ${borderColor}` }}>

      {/* Name / strength / brand / salt + price */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: '600', fontSize: '14px', color: '#1A1A1A', margin: '0 0 2px', lineHeight: '1.3' }}>
            {med.name}
            {med.strength && <span style={{ color: '#888', fontWeight: '500' }}> · {med.strength}</span>}
          </p>
          {med.brand  && <p style={{ color: '#666', fontSize: '12px', margin: '0 0 1px' }}>{med.brand}</p>}
          {med.salt   && <p style={{ color: '#888', fontSize: '11px', margin: 0 }}>{med.salt.substring(0, 60)}</p>}
        </div>
        {/* med.price = cheapest available seller's real price (mapMedicine,
            sourced from searchMedicines' sellerPrice) — same price
            handleQuickAdd below will actually charge, in both mrp_mode
            states. No longer master's stale mrp_max, no longer hidden
            under mrp_mode. */}
        <div style={{ textAlign: 'right', marginLeft: '12px', flexShrink: 0 }}>
          <p style={{ color: '#AAAAAA', fontSize: '10px', margin: '0 0 1px' }}>Price</p>
          <p style={{ color: borderColor, fontWeight: '700', fontSize: '16px', margin: 0 }}>₹{med.price || 0}</p>
        </div>
      </div>

      {/* Rate per dose — now divides the same seller-grounded med.price
          (getRatePerDose's priceOverride) instead of master mrp_max, so
          it's correct in both mrp_mode states — no longer hidden. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#F8F8F8', borderRadius: '6px', marginBottom: '10px' }}>
        {/* R3-A2: tablet/capsule packs show a real, computed count (from
            getRatePerDose's already-parsed rateInfo.total) instead of the
            raw unit string — clean "10 tablets/strip" regardless of how
            medicine.unit happens to be worded. Non-tablet packs (syrup/ml
            or unparseable) fall back to the raw unit string as-is — never
            a fabricated count for those. */}
        <span style={{ fontSize: '11px', color: '#666' }}>
          📦 {rateInfo.unit === 'tablet' && rateInfo.total > 0
            ? `${rateInfo.total} tablet${rateInfo.total > 1 ? 's' : ''}/strip`
            : (medicine.unit || 'Per unit')}
        </span>
        <span style={{ fontSize: '12px', color: borderColor, fontWeight: '500' }}>₹{rateInfo.perDose}/{rateInfo.unit}</span>
      </div>

      {/* Badges — Generic/Branded always shown (one or the other), plus
          Jan Aushadhi / Rx / dosage form when present (strength is shown
          next to the name above, pack size in the rate row above).
          commission_band is deliberately never surfaced here — internal. */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <span style={badge(medicine.is_generic ? '#E8F5E9' : '#F5F5F5', medicine.is_generic ? '#1A6B3C' : '#666666')}>
          {medicine.is_generic ? '✓ Generic' : 'Branded'}
        </span>
        {medicine.source === 'janaushadhi' && (
          <span style={badge('#E8F5E9', '#1A6B3C')}>🏥 Jan Aushadhi</span>
        )}
        {med.rxRequired && (
          <span style={badge('#FFF3E0', '#FF8C00')}>Rx Required</span>
        )}
        {medicine.dosage_form && (
          <span style={badge('#F5F5F5', '#666666')}>{medicine.dosage_form}</span>
        )}
      </div>

      {/* Add — sole action now, no Store dropdown */}
      <button
        onClick={handleQuickAdd}
        style={{ width: '100%', padding: '10px', background: added ? '#E8F5EE' : '#1A6B3C', border: 'none', borderRadius: '8px', color: added ? '#1A6B3C' : '#fff', fontSize: '13px', fontWeight: '600', cursor: addLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}
      >
        {addLoading ? 'Add ho raha hai...' : added ? 'Cart Mein Add Ho Gaya ✓' : 'Cart Mein Add Karo'}
      </button>
    </div>
  );
}
