// Shown on orders where the customer had no phone on file at placement
// (orders.customer_unverified, migration 084). Flag only — never blocks.
export default function UnverifiedCustomerBadge({ show }) {
  if (!show) return null;
  return (
    <div
      style={{
        display: 'inline-block', margin: '6px 0', padding: '4px 10px',
        background: '#FFF4E5', color: '#B45309', border: '1px solid #F59E0B',
        borderRadius: '8px', fontSize: '12px', fontWeight: '700',
      }}
    >
      ⚠️ Unverified customer — call recipient before dispatch
    </div>
  );
}
