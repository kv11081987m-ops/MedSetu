import { useState } from 'react';
import { updateUserPhone, isDuplicatePhoneError } from '../lib/auth';

// Hard-mandatory mobile-number gate for Google/magic-link customers whose
// users.phone is null (AuthContext's customer upsert never sets phone —
// Google OAuth sessions never carry one). Deliberately has no close/cross/
// "Baad me" button and the backdrop is inert — this is a gate, not a
// dismissible prompt, unlike Checkout.jsx's own mandatory-phone modal
// (~line 1089) which stays closable as a checkout-time backstop for
// anyone who slips past this one (e.g. pre-existing sessions from before
// this gate existed).
export default function PhoneCollectModal({ user, onSaved }) {
  const [phone, setPhone]     = useState('');
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  const handleSave = async () => {
    if (!/^\d{10}$/.test(phone)) {
      setError('Sahi 10-digit mobile daalein');
      return;
    }
    setSaving(true);
    setError('');
    const { error: err } = await updateUserPhone(user?.id, phone);
    setSaving(false);
    if (err) {
      if (isDuplicatePhoneError(err)) {
        setError('Yeh number pehle se registered hai');
      } else {
        setError('Save nahi hua, dobara try karein');
      }
      return;
    }

    try {
      const stored = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
      localStorage.setItem('medsetu_user', JSON.stringify({ ...stored, phone }));
    } catch {}

    onSaved(phone);
  };

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <p style={s.heading}>Apna Mobile Number Daalein</p>
        <p style={s.hint}>Order aur updates ke liye zaroori hai.</p>
        <input
          style={{ ...s.input, border: error ? '1.5px solid #DC3545' : s.input.border }}
          placeholder="10-digit mobile number"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          value={phone}
          onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(''); }}
          autoFocus
        />
        {error && <p style={s.error}>{error}</p>}
        <button
          style={{ ...s.saveBtn, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Save ho raha hai...' : 'Save Karo'}
        </button>
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
    width: '100%', maxWidth: '340px', backgroundColor: '#FFFFFF',
    borderRadius: '16px', padding: '22px', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: '6px',
  },
  heading: { fontSize: '18px', fontWeight: '800', color: '#0C447C', margin: 0, textAlign: 'center' },
  hint: { fontSize: '13px', color: '#666666', margin: '0 0 10px', textAlign: 'center' },
  input: {
    width: '100%', border: '1.5px solid #E0E0E0', borderRadius: '10px',
    padding: '12px', fontSize: '15px', color: '#1A1A1A',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  },
  error: { fontSize: '12px', color: '#DC3545', margin: '4px 0 0', fontWeight: '600' },
  saveBtn: {
    marginTop: '10px', padding: '14px', backgroundColor: '#F26C0A', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
