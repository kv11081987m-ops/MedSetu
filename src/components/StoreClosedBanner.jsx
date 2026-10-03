// Shown on CustomerHome + Checkout when is_any_seller_open() is false.
// nextOpenLabel comes from formatNextOpen(next_service_open_time()), e.g.
// "kal subah 9 baje" / "Somvar subah 9 baje"; empty → no "Agla samay" part.
export default function StoreClosedBanner({ nextOpenLabel, style }) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      backgroundColor: '#FFF4E5', border: '1px solid #EA6C00', color: '#8A4B00',
      borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.4,
      ...style,
    }}>
      <span>🌙</span>
      <span>
        Abhi sevayen band hain.{nextOpenLabel ? ` Agla samay: ${nextOpenLabel}` : ''}
      </span>
    </div>
  );
}
