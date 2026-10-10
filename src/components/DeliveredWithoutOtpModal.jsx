import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { uploadHandoverPhoto, NO_OTP_REASONS } from '../lib/handoverProof';

// "OTP nahi mila" — COD B2C home delivery only (088). Collects reason, cash
// collected yes/no (+ amount) and one handover photo, then calls the
// deliver_without_otp RPC, which re-validates everything server-side.
export default function DeliveredWithoutOtpModal({ order, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [text,   setText]   = useState('');
  const [cash,   setCash]   = useState(null); // true | false
  const [amount, setAmount] = useState(order?.final_amount ? String(order.final_amount) : '');
  const [photo,  setPhoto]  = useState(null);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');

  const submit = async () => {
    setError('');
    if (!reason) return setError('Kaaran chuniye');
    if (reason === 'other' && text.trim().length < 3) return setError('"Other" ke liye kaaran likhein');
    if (cash === null) return setError('Cash mila ya nahi — chuniye');
    if (cash && !(Number(amount) > 0)) return setError('Cash ki rakam daalein');
    // Photo is optional; without one a written explanation is mandatory.
    if (!photo && text.trim().length < 10) return setError('Photo nahi hai to detail (kam se kam 10 akshar) likhna zaroori hai');

    setBusy(true);
    let path = null;
    if (photo) {
      const up = await uploadHandoverPhoto(order.id, photo);
      if (up.error) { setBusy(false); return setError('Photo upload nahi hui: ' + up.error.message); }
      path = up.path;
    }

    const { data, error: rpcErr } = await supabase.rpc('deliver_without_otp', {
      p_order_id: order.id,
      p_reason_code: reason,
      p_reason_text: text.trim() || null,
      p_cash_collected: cash,
      p_cash_amount: cash ? Number(amount) : 0,
      p_photo_path: path,
    });
    setBusy(false);
    if (rpcErr || !data?.success) return setError(data?.message || rpcErr?.message || 'Delivery save nahi hui');
    onDone?.(data);
  };

  const field = { width: '100%', padding: '10px 12px', border: '1.5px solid #E0E0E0', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: '6px' };
  const choice = (active) => ({
    flex: 1, padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
    border: `1.5px solid ${active ? '#1A6B3C' : '#E0E0E0'}`, background: active ? '#E8F5EE' : '#FFFFFF', color: active ? '#1A6B3C' : '#555',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '420px', maxHeight: '90vh', overflowY: 'auto' }}>
        <p style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>OTP nahi mila — #{order.order_number}</p>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 12px' }}>Sirf COD order ke liye. Photo optional hai; photo na ho to detail likhna zaroori hai.</p>

        <label style={{ fontSize: '12px', color: '#555', fontWeight: '600' }}>Kaaran
          <select style={field} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
            <option value="">— chuniye —</option>
            {NO_OTP_REASONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </label>
        {reason && (
          <input
            style={field}
            placeholder={
              !photo
                ? 'Aur detail likhein (zaroori — kam se kam 10 akshar, kyunki photo nahi hai)'
                : reason === 'other' ? 'Kaaran likhein (zaroori)' : 'Aur detail (optional)'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
        )}

        <p style={{ fontSize: '12px', color: '#555', fontWeight: '600', margin: '14px 0 0' }}>Cash mila?</p>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          <button style={choice(cash === true)}  onClick={() => setCash(true)}  disabled={busy}>Haan</button>
          <button style={choice(cash === false)} onClick={() => setCash(false)} disabled={busy}>Nahi</button>
        </div>
        {cash === true && (
          <input style={field} type="number" inputMode="decimal" min="0" placeholder="Cash ki rakam (₹)" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
        )}

        <label style={{ display: 'block', fontSize: '12px', color: '#555', fontWeight: '600', marginTop: '14px' }}>Handover ki photo (optional)
          <input style={field} type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} disabled={busy} />
        </label>

        {error && <p style={{ color: '#DC2626', fontSize: '13px', margin: '12px 0 0' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1.5px solid #E0E0E0', background: '#FFFFFF', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: '#1A6B3C', color: '#FFFFFF', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Save ho raha hai...' : 'Delivered (bina OTP)'}
          </button>
        </div>
      </div>
    </div>
  );
}
