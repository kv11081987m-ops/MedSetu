import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Phone, CheckCircle } from 'lucide-react';
import { sendEmailOTP, generateOTP, storeOTP } from '../lib/auth';

export default function LoginScreen() {
  const navigate = useNavigate();

  // Tab: 'phone' | 'email'
  const [tab, setTab]       = useState('phone');

  // Phone state
  const [phone,     setPhone]     = useState('');
  const [phoneFocus, setPhoneFocus] = useState(false);

  // Email state
  const [email,     setEmail]     = useState('');
  const [emailFocus, setEmailFocus] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Shared state
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // ── Phone handler ──────────────────────────────────────────
  const handlePhoneChange = (e) => {
    setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
    if (error) setError('');
  };

  const handleSendOTP = async () => {
    if (phone.length !== 10) { setError('Sahi 10-digit number daalo'); return; }

    setLoading(true);
    setError('');

    try {
      const otp = generateOTP();
      storeOTP(phone, otp);

      const response = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });

      const data = await response.json();

      if (!data.success) {
        console.warn('SMS failed:', data.message);
        setError('SMS nahi gaya — dev mode mein try karo');
      }

      navigate('/otp', { state: { phone } });
    } catch (err) {
      console.error(err);
      navigate('/otp', { state: { phone } });
    } finally {
      setLoading(false);
    }
  };

  // ── Email handler ──────────────────────────────────────────
  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleSendMagicLink = async () => {
    if (!isValidEmail(email)) { setError('Sahi email address daalo'); return; }

    setLoading(true); setError('');
    const { error: emailErr } = await sendEmailOTP(email);
    setLoading(false);

    if (emailErr) {
      setError('Email bhejne mein dikkat: ' + emailErr.message);
      return;
    }
    setEmailSent(true);
  };

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

        {/* ── Brand header ── */}
        <div style={s.header}>
          <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '12px 20px', display: 'inline-block', marginBottom: '8px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <img
              src="/logo.png"
              alt="MedSetu Logo"
              style={{ width: '180px', height: 'auto', display: 'block' }}
            />
          </div>
        </div>

        {/* ── Login card ── */}
        <div style={s.card}>

          {/* Tab toggle */}
          <div style={s.tabBar}>
            <button
              style={{ ...s.tab, ...(tab === 'phone' ? s.tabActive : {}) }}
              onClick={() => { setTab('phone'); setError(''); setEmailSent(false); }}
            >
              <Phone size={14} />
              Phone se Login
            </button>
            <button
              style={{ ...s.tab, ...(tab === 'email' ? s.tabActive : {}) }}
              onClick={() => { setTab('email'); setError(''); }}
            >
              <Mail size={14} />
              Email se Login
            </button>
          </div>

          {/* ── Phone tab ── */}
          {tab === 'phone' && (
            <div style={s.tabContent}>
              <p style={s.inputLabel}>Mobile Number</p>
              <div style={{
                ...s.inputRow,
                borderColor: phoneFocus ? '#1A6B3C' : error ? '#e53935' : '#E0E0E0',
              }}>
                <span style={s.prefix}>+91</span>
                <div style={s.vDivider} />
                <input
                  type="tel" inputMode="numeric"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={handlePhoneChange}
                  onFocus={() => setPhoneFocus(true)}
                  onBlur={() => setPhoneFocus(false)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
                  style={s.textInput}
                />
              </div>
              {error && <p style={s.errorText}>{error}</p>}
              <button
                style={{ ...s.primaryBtn, opacity: loading ? 0.7 : 1 }}
                onClick={handleSendOTP}
                disabled={loading}
              >
                {loading ? 'OTP Bheja Ja Raha Hai...' : 'OTP Bhejo'}
              </button>
            </div>
          )}

          {/* ── Email tab ── */}
          {tab === 'email' && (
            <div style={s.tabContent}>
              {emailSent ? (
                /* Success state */
                <div style={s.emailSuccessBox}>
                  <CheckCircle size={40} color="#1A6B3C" />
                  <p style={s.emailSuccessTitle}>Email Bhej Diya! 📬</p>
                  <p style={s.emailSuccessSub}>
                    <strong>{email}</strong> pe magic link bheja gaya hai.
                    Inbox check karo aur link pe click karo.
                  </p>
                  <p style={s.emailSuccessNote}>
                    Link 1 ghante mein expire ho jaayega.
                  </p>
                  <button
                    style={s.resendLink}
                    onClick={() => { setEmailSent(false); setEmail(''); }}
                  >
                    Doosri email se try karo
                  </button>
                </div>
              ) : (
                <>
                  <p style={s.inputLabel}>Email Address</p>
                  <div style={{
                    ...s.inputRow,
                    borderColor: emailFocus ? '#1A6B3C' : error ? '#e53935' : '#E0E0E0',
                  }}>
                    <div style={s.emailIconBox}>
                      <Mail size={16} color="#888888" />
                    </div>
                    <input
                      type="email"
                      placeholder="aapka@email.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                      onFocus={() => setEmailFocus(true)}
                      onBlur={() => setEmailFocus(false)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMagicLink()}
                      style={s.textInput}
                      disabled={loading}
                    />
                  </div>
                  {error && <p style={s.errorText}>{error}</p>}
                  <button
                    style={{ ...s.primaryBtn, opacity: loading ? 0.7 : 1 }}
                    onClick={handleSendMagicLink}
                    disabled={loading}
                  >
                    {loading ? 'Email Bheja Ja Raha Hai...' : '✉️ Magic Link Bhejo'}
                  </button>
                  <p style={s.hintText}>
                    Inbox mein link aayega — click karo aur login ho jaao
                  </p>
                </>
              )}
            </div>
          )}

          {/* Terms */}
          <p style={s.terms}>
            Login karke aap hamare{' '}
            <span style={s.termLink}>Terms &amp; Conditions</span>
            {' '}aur{' '}
            <span style={s.termLink}>Privacy Policy</span>
            {' '}se agree karte hain
          </p>
        </div>
      </div>

      {/* ── Staff Login link ── */}
      <div style={{ position: 'fixed', bottom: '16px', right: '16px' }}>
        <span onClick={() => navigate('/staff-login')} style={s.staffLink}>
          Staff Login
        </span>
      </div>

    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────
const s = {
  wrapper: {
    minHeight: '100vh', backgroundColor: '#F5F5F5',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
  },
  container: { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '24px' },

  // Brand
  header:     { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' },
  iconCircle: { width: '80px', height: '80px', borderRadius: '50%', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '4px', boxShadow: '0 4px 16px rgba(26,107,60,0.3)' },
  appName:    { fontSize: '32px', fontWeight: '700', color: '#1A1A1A', margin: 0, letterSpacing: '-0.5px' },
  tagline:    { fontSize: '14px', color: '#666666', margin: 0 },

  // Card
  card: { backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '18px' },

  // Tab bar
  tabBar: { display: 'flex', backgroundColor: '#F5F5F5', borderRadius: '12px', padding: '4px', gap: '4px' },
  tab: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '10px 8px', borderRadius: '9px', border: 'none', backgroundColor: 'transparent',
    fontSize: '13px', fontWeight: '600', color: '#888888', cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  },
  tabActive: { backgroundColor: '#FFFFFF', color: '#1A6B3C', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },

  // Tab content
  tabContent: { display: 'flex', flexDirection: 'column', gap: '10px' },
  inputLabel: { fontSize: '13px', fontWeight: '600', color: '#444444', margin: 0 },

  // Input row
  inputRow: {
    display: 'flex', alignItems: 'center', border: '1.5px solid',
    borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.2s',
  },
  prefix: { padding: '14px', backgroundColor: '#F5F5F5', color: '#666', fontSize: '15px', fontWeight: '600', flexShrink: 0 },
  emailIconBox: { padding: '0 12px', display: 'flex', alignItems: 'center', backgroundColor: '#F5F5F5', alignSelf: 'stretch' },
  vDivider: { width: '1px', height: '48px', backgroundColor: '#E0E0E0', flexShrink: 0 },
  textInput: { flex: 1, border: 'none', outline: 'none', padding: '14px 12px', fontSize: '15px', color: '#1A1A1A', backgroundColor: 'transparent', fontFamily: 'inherit' },

  errorText: { fontSize: '12px', color: '#e53935', margin: 0 },
  hintText:  { fontSize: '12px', color: '#888888', textAlign: 'center', backgroundColor: '#FFFBEB', padding: '8px 12px', borderRadius: '8px', margin: 0 },

  primaryBtn: {
    width: '100%', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Email success
  emailSuccessBox:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '12px 0', textAlign: 'center' },
  emailSuccessTitle: { fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  emailSuccessSub:   { fontSize: '14px', color: '#555555', margin: 0, lineHeight: '1.6' },
  emailSuccessNote:  { fontSize: '12px', color: '#888888', margin: 0 },
  resendLink: { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },

  // Terms
  terms:    { fontSize: '12px', color: '#999999', textAlign: 'center', lineHeight: '1.6', margin: 0 },
  termLink:  { color: '#1A6B3C', fontWeight: '600', cursor: 'pointer' },
  staffLink: { fontSize: '11px', color: '#999999', cursor: 'pointer', textDecoration: 'underline' },
};
