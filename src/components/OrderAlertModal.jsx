export default function OrderAlertModal({ order, onViewOrders, onClose }) {
  if (!order) return null;

  const itemsCount = order.items?.length || 0;
  const customerArea = order.delivery_address || 'Address unavailable';

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.iconBox}>🎉</div>

        <p style={s.heading}>Naya Order Aaya Hai!</p>

        <div style={s.summaryBox}>
          <div style={s.summaryRow}>
            <span style={s.summaryLabel}>Items:</span>
            <span style={s.summaryValue}>{itemsCount}</span>
          </div>
          <div style={s.summaryRow}>
            <span style={s.summaryLabel}>Area:</span>
            <span style={s.summaryValue} title={customerArea}>{customerArea.slice(0, 30)}{customerArea.length > 30 ? '...' : ''}</span>
          </div>
        </div>

        <div style={s.buttonGroup}>
          <button style={s.primaryBtn} onClick={onViewOrders}>
            Dekho
          </button>
          <button style={s.secondaryBtn} onClick={onClose}>
            Band Karo
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000, padding: '20px', boxSizing: 'border-box',
  },
  card: {
    position: 'relative',
    width: '100%', maxWidth: '320px', backgroundColor: '#FFFFFF',
    borderRadius: '16px', padding: '24px', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: '12px',
    alignItems: 'center', textAlign: 'center',
  },
  iconBox: {
    fontSize: '48px', lineHeight: '48px',
  },
  heading: {
    fontSize: '18px', fontWeight: '800', color: '#0C447C',
    margin: 0, marginBottom: '4px',
  },
  summaryBox: {
    width: '100%', backgroundColor: '#F5F5F5', borderRadius: '12px',
    padding: '12px', boxSizing: 'border-box', marginBottom: '8px',
  },
  summaryRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: '13px', color: '#333333', marginBottom: '8px',
  },
  summaryLabel: {
    fontWeight: '600', color: '#666666',
  },
  summaryValue: {
    fontWeight: '700', color: '#0C447C', wordBreak: 'break-word',
  },
  buttonGroup: {
    display: 'flex', gap: '10px', width: '100%', marginTop: '6px',
  },
  primaryBtn: {
    flex: 1, padding: '12px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  secondaryBtn: {
    flex: 1, padding: '12px', backgroundColor: '#E8E8E8', color: '#333333',
    border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
