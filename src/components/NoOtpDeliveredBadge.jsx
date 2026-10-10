import { noOtpReasonLabel } from '../lib/handoverProof';

// Shown on orders delivered without the customer OTP (orders.delivered_without_otp).
export default function NoOtpDeliveredBadge({ show, reasonCode, reasonText, overrideReason }) {
  if (!show) return null;
  const detail = overrideReason
    ? `Override: ${overrideReason}`
    : [noOtpReasonLabel(reasonCode), reasonText].filter(Boolean).join(' — ');
  return (
    <div
      style={{
        display: 'inline-block', margin: '6px 0', padding: '4px 10px',
        background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5',
        borderRadius: '8px', fontSize: '12px', fontWeight: '700',
      }}
    >
      🔓 OTP ke bina delivered{detail ? ` · ${detail}` : ''}
    </div>
  );
}
