import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { sendFirebaseOTP, verifyFirebaseOTP } from '../lib/firebaseOTP';
import { updateUserPhone, isDuplicatePhoneError } from '../lib/auth';

const OTP_LENGTH = 6;

// Shared OTP-verified "attach phone to my account" modal — used by both the
// CustomerHome mandatory-phone gate and Checkout's mandatory-mobile prompt,
// replacing their old no-OTP text-field save. The logged-in user here is a
// Google/email customer with a live Supabase session; verifying via Firebase
// signs the phone number in as Firebase's own auth.currentUser, which the
// re-bridge listeners in AuthContext.jsx already refuse to bridge for an
// email session — but this modal still explicitly signs Firebase back out
// right after verifying, as belt-and-suspenders, and never touches the
// Supabase session (no setSession/signOut/bridgeFirebaseToSupabase here).
export default function AttachPhoneModal({ user, onSaved, onClose }) {
  const [step, setStep]       = useState('phone'); // 'phone' | 'otp'
  const [phone, setPhone]     = useState('');
  const [otp, setOtp]         = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError]     = useState('');

  const handleSendOtp = async () => {
    if (!/^\d{10}$/.test(phone)) {
      setError('Sahi 10-digit mobile daalein');
      return;
    }
    setSending(true);
    setError('');
    const result = await sendFirebaseOTP(phone);
    setSending(false);
    if (!result.success) {
      setError('OTP nahi gaya — dobara try karo');
      return;
    }
    setOtp('');
    setStep('otp');
  };

  const handleVerify = async () => {
    if (otp.length !== OTP_LENGTH) {
      setError('Pura OTP daalein');
      return;
    }
    setVerifying(true);
    setError('');

    const res = await verifyFirebaseOTP(otp);
    if (!res.success) {
      setVerifying(false);
      setError(res.error || 'Galat OTP — dobara try karo');
      return;
    }

    // End the stray Firebase phone session immediately — before writing
    // anything else — so nothing downstream (re-bridge timer, next app
    // start) ever finds a lingering phone-verified auth.currentUser.
    await signOut(auth).catch(() => {});

    // `phone` is the same 10-digit value sendFirebaseOTP() sent the OTP to
    // and Firebase just confirmed — it's locked/disabled on step 2 (below),
    // so this is guaranteed to be the verified number, not something typed
    // afterward.
    const { error: err } = await updateUserPhone(user?.id, phone);
    setVerifying(false);
    if (err) {
      if (isDuplicatePhoneError(err)) {
        setError('Yeh number kisi aur account se juda hai. Doosra number daalein.');
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
        {onClose && (
          <button style={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        )}

        {step === 'phone' ? (
          <>
            <p style={s.heading}>Apna Mobile Number Daalein</p>
            <p style={s.hint}>OTP se verify karke save karenge.</p>
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
              style={{ ...s.saveBtn, opacity: sending ? 0.6 : 1 }}
              onClick={handleSendOtp}
              disabled={sending}
            >
              {sending ? 'OTP bhej rahe hain...' : 'OTP Bhejein'}
            </button>
          </>
        ) : (
          <>
            <p style={s.heading}>OTP Verify Karo</p>
            <p style={s.hint}>+91 {phone} par bheja gaya OTP daalein</p>
            <input style={s.lockedInput} value={phone} disabled readOnly />
            <input
              style={{ ...s.input, border: error ? '1.5px solid #DC3545' : s.input.border, marginTop: '8px' }}
              placeholder="6-digit OTP"
              type="tel"
              inputMode="numeric"
              maxLength={OTP_LENGTH}
              value={otp}
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH)); setError(''); }}
              autoFocus
            />
            {error && <p style={s.error}>{error}</p>}
            <button
              style={{ ...s.saveBtn, opacity: verifying ? 0.6 : 1 }}
              onClick={handleVerify}
              disabled={verifying}
            >
              {verifying ? 'Verify ho raha hai...' : 'Verify Karo'}
            </button>
            <button style={s.backLink} onClick={() => { setStep('phone'); setOtp(''); setError(''); }}>
              Number badalna hai?
            </button>
          </>
        )}

        <div id="recaptcha-container" />
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
    width: '100%', maxWidth: '340px', backgroundColor: '#FFFFFF',
    borderRadius: '16px', padding: '22px', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: '6px',
  },
  closeBtn: {
    position: 'absolute', top: '10px', right: '10px',
    width: '28px', height: '28px', borderRadius: '50%',
    border: 'none', backgroundColor: '#F5F5F5', color: '#666666',
    fontSize: '18px', lineHeight: '28px', textAlign: 'center',
    cursor: 'pointer', padding: 0,
  },
  heading: { fontSize: '18px', fontWeight: '800', color: '#0C447C', margin: 0, textAlign: 'center' },
  hint: { fontSize: '13px', color: '#666666', margin: '0 0 10px', textAlign: 'center' },
  input: {
    width: '100%', border: '1.5px solid #E0E0E0', borderRadius: '10px',
    padding: '12px', fontSize: '15px', color: '#1A1A1A',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  },
  lockedInput: {
    width: '100%', border: '1.5px solid #E0E0E0', borderRadius: '10px',
    padding: '12px', fontSize: '15px', color: '#888888',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
    backgroundColor: '#F5F5F5',
  },
  error: { fontSize: '12px', color: '#DC3545', margin: '4px 0 0', fontWeight: '600' },
  saveBtn: {
    marginTop: '10px', padding: '14px', backgroundColor: '#F26C0A', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  backLink: {
    marginTop: '10px', padding: '6px', backgroundColor: 'transparent', color: '#0C447C',
    border: 'none', fontSize: '13px', fontWeight: '600', textDecoration: 'underline',
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
