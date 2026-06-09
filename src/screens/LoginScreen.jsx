import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Phone, CheckCircle } from 'lucide-react';
import { sendOTP, sendEmailOTP } from '../lib/auth';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const navigate = useNavigate();
  const { applyDevSession } = useAuth();

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

  // Demo mode modal
  const [showDemo, setShowDemo] = useState(false);

  // ── Phone handler ──────────────────────────────────────────
  const handlePhoneChange = (e) => {
    setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
    if (error) setError('');
  };

  const handleSendOTP = async () => {
    if (phone.length !== 10) { setError('Sahi 10-digit number daalo'); return; }

    setLoading(true); setError('');
    const { error: otpErr } = await sendOTP(phone);
    setLoading(false);

    if (otpErr) {
      // Phone provider not set up → fall through to dev OTP mode
      navigate('/otp', { state: { phone, dev: true } });
      return;
    }
    navigate('/otp', { state: { phone, dev: false } });
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

  // ── Demo mode ──────────────────────────────────────────────
  const handleDemoRole = (role) => {
    applyDevSession('9999999999', role);
    setShowDemo(false);
    navigate(role === 'seller' ? '/seller-dashboard' : '/home');
  };

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

        {/* ── Brand header ── */}
        <div style={s.header}>
          <div style={s.iconCircle}>
            <svg width="40" height="40" viewBox="0 0 80 80" fill="none">
              <rect x="6" y="26" width="68" height="28" rx="14"
                stroke="white" strokeWidth="4" fill="none" />
              <line x1="40" y1="26" x2="40" y2="54" stroke="white" strokeWidth="4" />
              <rect x="6" y="26" width="34" height="28" rx="14"
                fill="white" fillOpacity="0.3" />
            </svg>
          </div>
          <h1 style={s.appName}>MedSetu</h1>
          <p style={s.tagline}>Aapki Dawai, Aapke Dwar</p>
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
                  disabled={loading}
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
              <p style={s.hintText}>
                💡 Dev: OTP screen pe <strong>123456</strong> enter karo
              </p>
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

          {/* ── Divider ── */}
          <div style={s.divRow}>
            <div style={s.divLine} />
            <span style={s.divText}>ya</span>
            <div style={s.divLine} />
          </div>

          {/* ── Demo Mode button ── */}
          <button style={s.demoBtn} onClick={() => setShowDemo(true)}>
            <span style={s.demoBtnIcon}>🚀</span>
            <div style={s.demoBtnText}>
              <span style={s.demoBtnLabel}>Demo Mode mein Enter Karo</span>
              <span style={s.demoBtnSub}>Real auth ke bina testing</span>
            </div>
          </button>

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

      {/* ── Demo Role Modal ── */}
      {showDemo && (
        <div style={s.overlay} onClick={() => setShowDemo(false)}>
          <div style={s.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={s.sheetHandle} />
            <p style={s.sheetTitle}>Demo Mode</p>
            <p style={s.sheetSub}>
              Kaun si view test karni hai?
            </p>

            <button style={s.roleBtn} onClick={() => handleDemoRole('customer')}>
              <span style={s.roleIcon}>🛒</span>
              <div>
                <p style={s.roleName}>Customer View</p>
                <p style={s.roleHint}>Medicines order karo, prescriptions upload karo</p>
              </div>
            </button>

            <button
              style={{ ...s.roleBtn, ...s.roleBtnOutline }}
              onClick={() => handleDemoRole('seller')}
            >
              <span style={s.roleIcon}>🏪</span>
              <div>
                <p style={{ ...s.roleName, color: '#1A6B3C' }}>Seller View</p>
                <p style={s.roleHint}>Dashboard, inventory, orders manage karo</p>
              </div>
            </button>

            <button style={s.cancelBtn} onClick={() => setShowDemo(false)}>
              Wapas Jao
            </button>
          </div>
        </div>
      )}
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

  // Divider
  divRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  divLine: { flex: 1, height: '1px', backgroundColor: '#E0E0E0' },
  divText: { fontSize: '13px', color: '#999999', flexShrink: 0 },

  // Demo button
  demoBtn: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 16px', backgroundColor: '#F0FDF4',
    border: '1.5px dashed #1A6B3C', borderRadius: '14px',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
  },
  demoBtnIcon:  { fontSize: '24px', flexShrink: 0 },
  demoBtnText:  { display: 'flex', flexDirection: 'column', gap: '2px' },
  demoBtnLabel: { fontSize: '14px', fontWeight: '700', color: '#1A6B3C' },
  demoBtnSub:   { fontSize: '12px', color: '#4B9E6F' },

  // Terms
  terms:    { fontSize: '12px', color: '#999999', textAlign: 'center', lineHeight: '1.6', margin: 0 },
  termLink: { color: '#1A6B3C', fontWeight: '600', cursor: 'pointer' },

  // Demo modal
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  sheet: { width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '24px 24px 0 0', padding: '16px 20px 40px', display: 'flex', flexDirection: 'column', gap: '12px' },
  sheetHandle: { width: '40px', height: '4px', backgroundColor: '#E0E0E0', borderRadius: '2px', alignSelf: 'center', marginBottom: '4px' },
  sheetTitle:  { fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: 0, textAlign: 'center' },
  sheetSub:    { fontSize: '14px', color: '#888888', margin: 0, textAlign: 'center' },

  roleBtn: {
    display: 'flex', alignItems: 'center', gap: '14px', padding: '16px',
    backgroundColor: '#1A6B3C', border: 'none', borderRadius: '16px',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
  },
  roleBtnOutline: { backgroundColor: '#FFFFFF', border: '2px solid #1A6B3C' },
  roleIcon: { fontSize: '28px', flexShrink: 0 },
  roleName: { fontSize: '16px', fontWeight: '700', color: '#FFFFFF', margin: '0 0 3px' },
  roleHint: { fontSize: '12px', color: 'rgba(255,255,255,0.75)', margin: 0 },

  cancelBtn: {
    padding: '14px', backgroundColor: '#F5F5F5', border: 'none',
    borderRadius: '14px', fontSize: '14px', fontWeight: '600',
    color: '#555555', cursor: 'pointer', fontFamily: 'inherit',
  },
};
