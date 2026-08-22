import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { mapMedicine, getRatePerDose, fetchSellersForMedicine } from '../lib/api';

// Small style-formatter shared with PopularCard (MedicineSearch.jsx) —
// exported so that sibling card lives elsewhere without duplicating this.
export const badge = (bg, color) => ({
  background: bg, color, fontSize: '10px', padding: '2px 8px', borderRadius: '99px', fontWeight: '500',
});

// B15 Part-3: dosage_form -> left strip colour. Covers every distinct
// dosage_form value actually in master_medicines (checked live) plus a
// neutral fallback for anything missing/unrecognised.
const DOSAGE_COLORS = {
  Tablet:    '#E0A818', // amber/gold
  Injection: '#0C447C', // blue
  Syrup:     '#0D9488', // teal
  Capsule:   '#F26C0A', // orange
  Drops:     '#06B6D4', // cyan
  Solution:  '#7C3AED', // purple
  Powder:    '#92400E', // brown
  Topical:   '#1A6B3C', // green
  Inhaler:   '#0EA5E9', // sky (in DB, not in the original mockup list)
};
const DOSAGE_COLOR_DEFAULT = '#9CA3AF'; // grey — unknown/missing dosage_form

// R3-C0: extracted out of MedicineSearch.jsx so Home/Categories screens
// can reuse the exact same card — no visual/behavioral change from the
// R3-A/A2 redesign (no store picker, seller-grounded price/rate/pack-size,
// single Add button).
// B15 Part-3: compact redesign — dosage-form colour strip, single tag
// line (BRANDED/GENERIC/JAN AUSHADHI · DOSAGE FORM), amber pack/rate
// chip, small inline Add button instead of the old full-width one.
// addToCart/handleQuickAdd logic is untouched from before this redesign.
export default function MedicineCard({ medicine, type, mrpMode }) {
  const { addToCart } = useCart();
  const med      = mapMedicine(medicine);
  const rateInfo = getRatePerDose(medicine, med.price);
  const [added,      setAdded]      = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  const stripColor = DOSAGE_COLORS[medicine.dosage_form] || DOSAGE_COLOR_DEFAULT;
  const tagLabel = type === 'janaushadhi' ? 'JAN AUSHADHI' : type === 'generic' ? 'GENERIC' : 'BRANDED';
  const packLabel = rateInfo.unit === 'tablet' && rateInfo.total > 0
    ? `${rateInfo.total} tablet${rateInfo.total > 1 ? 's' : ''}/strip`
    : (medicine.unit || 'Per unit');

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
    <div style={s.card}>
      {/* Left dosage-form colour strip — no image_url yet (R5 parked);
          this same slot is where a photo/icon-box would go later. */}
      <div style={{ ...s.strip, background: stripColor }} />

      <div style={s.body}>
        <div style={s.content}>
          <p style={s.name}>
            {med.name}
            {med.rxRequired && <span style={s.rxMark}>Rx</span>}
          </p>
          {med.salt && <p style={s.salt}>{med.salt.substring(0, 60)}</p>}
          <p style={s.tagLine}>{tagLabel} · {(medicine.dosage_form || '').toUpperCase()}</p>
          <span style={s.packChip}>📦 {packLabel} · ₹{rateInfo.perDose}/{rateInfo.unit}</span>
        </div>

        {/* med.price = cheapest available seller's real price (mapMedicine,
            sourced from searchMedicines' sellerPrice) — same price
            handleQuickAdd above will actually charge, in both mrp_mode
            states. */}
        <div style={s.right}>
          <div>
            <p style={s.priceLabel}>Price</p>
            <p style={s.price}>₹{med.price || 0}</p>
          </div>
          <button
            onClick={handleQuickAdd}
            style={{ ...s.addBtn, background: added ? '#E8F5EE' : '#1A6B3C', color: added ? '#1A6B3C' : '#fff', cursor: addLoading ? 'wait' : 'pointer' }}
          >
            {addLoading ? '...' : added ? '✓ Added' : '+ Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  card: {
    display: 'flex',
    alignItems: 'stretch',
    background: '#fff',
    borderRadius: '10px',
    marginBottom: '8px',
    border: '1px solid #F0F0F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  strip: {
    width: '4px',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '10px 12px',
  },
  content: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  name: {
    fontWeight: '600',
    fontSize: '13px',
    color: '#1A1A1A',
    margin: 0,
    lineHeight: '1.3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rxMark: {
    marginLeft: '6px',
    fontSize: '9px',
    fontWeight: '700',
    color: '#DC3545',
    verticalAlign: 'middle',
  },
  salt: {
    fontSize: '11px',
    color: '#888',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tagLine: {
    fontSize: '9.5px',
    fontWeight: '700',
    color: '#0C447C',
    letterSpacing: '0.4px',
    margin: '1px 0 2px',
  },
  packChip: {
    alignSelf: 'flex-start',
    fontSize: '10px',
    fontWeight: '500',
    color: '#8A6D1D',
    background: '#FFF8E1',
    padding: '2px 8px',
    borderRadius: '99px',
  },
  right: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
  },
  priceLabel: {
    color: '#AAAAAA',
    fontSize: '9px',
    margin: '0 0 1px',
    textAlign: 'right',
  },
  price: {
    color: '#C4581E',
    fontWeight: '700',
    fontSize: '16px',
    margin: 0,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  addBtn: {
    padding: '4px 12px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '600',
    fontFamily: 'inherit',
  },
};
