import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendFirebaseOTP } from '../lib/firebaseOTP';
import { supabase } from '../lib/supabase';

// L3 mein isse true karna hai jab phone-OTP dobara live karni ho — poora
// UI/logic neeche pehle se bana hua hai, sirf render se hide hai. Flag
// flip karte hi phone section dikhne lagega, koi aur wiring nahi chahiye.
const PHONE_LOGIN_ENABLED = false;

const ORANGE = '#F26C0A';
const BLUE   = '#0C447C';

export default function UnifiedLogin() {
  const navigate = useNavigate();

  const [phone,   setPhone]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Same OAuth call as the old LoginScreen.jsx — no staff_pending_role is
  // set here (that's StaffLogin.jsx's mechanism, untouched). Role
  // resolution after this is entirely AuthContext's existing SIGNED_IN
  // handler: SuperAdmin fast-path checks the session email directly, and
  // the "whitelist fallback" branch (originally built for magic-link-in-
  // another-browser) already resolves any approved seller/pharmacist/admin
  // to their real role purely from a missing/absent pendingRole — which is
  // exactly this screen's situation. Confirmed by trace, not changed here.
  const handleGoogleLogin = async () => {
    setError('');
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/home' },
      });
      if (err) throw err;
    } catch (err) {
      setError('Google login error: ' + err.message);
    }
  };

  const handleSendOTP = async () => {
    if (phone.length !== 10) return;

    setLoading(true);
    setError('');

    const result = await sendFirebaseOTP(phone);

    if (result.success) {
      navigate('/otp', { state: { phone, method: 'firebase' } });
    } else {
      setError('OTP nahi gaya — dobara try karo');
      console.error(result.error);
    }

    setLoading(false);
  };

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

        {/* Brand */}
        <div style={s.header}>
          <div style={s.logoBox}>
            <img src="/logo.png" alt="MedSetu" style={s.logo} />
          </div>
          <p style={s.tagline}>Aapke mohalle ki dawai dukaan, ab online</p>
        </div>

        {/* Card */}
        <div style={s.card}>

          {/* Google Login */}
          <button onClick={handleGoogleLogin} style={s.googleBtn}>
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            Google se Login Karo
          </button>
          <p style={s.hint}>Recommended — Sabse aasaan login</p>

          {PHONE_LOGIN_ENABLED && (
            <>
              <div style={s.divider}>
                <div style={s.dividerLine} />
                <span style={s.dividerText}>ya</span>
                <div style={s.dividerLine} />
              </div>

              <div style={s.phoneRow}>
                <div style={s.prefix}>+91</div>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                    if (error) setError('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  style={s.phoneInput}
                />
              </div>

              <button
                onClick={handleSendOTP}
                disabled={loading || phone.length !== 10}
                style={{
                  ...s.otpBtn,
                  background: phone.length === 10 ? BLUE : '#ccc',
                  cursor: phone.length === 10 ? 'pointer' : 'not-allowed',
                }}
              >
                {loading ? 'OTP Bhej Raha Hai...' : 'OTP Bhejein'}
              </button>
            </>
          )}

          {error && <p style={s.errorText}>{error}</p>}

          {/* Terms */}
          <p style={s.terms}>
            Login karke aap hamare{' '}
            <span style={s.termLink}>Terms &amp; Conditions</span>
            {' '}aur{' '}
            <span style={s.termLink}>Privacy Policy</span>
            {' '}se agree karte hain
          </p>
        </div>

        {/* Registration shortcuts */}
        <div style={s.registerRow}>
          <span style={s.registerText}>Dukaan ya pharmacy hai?</span>
          <span style={s.registerLink} onClick={() => navigate('/seller-register')}>Seller banein</span>
          <span style={s.registerDot}>·</span>
          <span style={s.registerLink} onClick={() => navigate('/pharmacist-register')}>Pharmacist banein</span>
        </div>
      </div>

      {/* Staff Login — same small fallback link the old LoginScreen.jsx
          had, carried over as-is (not removed, per instruction). */}
      <div style={{ position: 'fixed', bottom: '16px', right: '16px' }}>
        <span onClick={() => navigate('/staff-login')} style={s.staffLink}>
          Staff Login
        </span>
      </div>

      <div id="recaptcha-container" />
    </div>
  );
}

const s = {
  wrapper:    { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' },
  container:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '20px' },
  header:     { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' },
  logoBox:    { background: '#FFFFFF', borderRadius: '16px', padding: '12px 20px', display: 'inline-block', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
  logo:       { width: '180px', height: 'auto', display: 'block' },
  tagline:    { fontSize: '13px', fontWeight: '600', color: BLUE, margin: 0, textAlign: 'center' },
  card:       { backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '0' },
  googleBtn:  { width: '100%', padding: '16px', background: 'white', border: `2px solid ${ORANGE}`, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', cursor: 'pointer', fontSize: '16px', fontWeight: '600', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' },
  hint:       { textAlign: 'center', color: '#666', fontSize: '12px', marginTop: '6px', marginBottom: 0 },
  divider:    { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '20px', marginBottom: '16px' },
  dividerLine:{ flex: 1, height: '1px', background: '#eee' },
  dividerText:{ color: '#999', fontSize: '13px' },
  phoneRow:   { display: 'flex', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' },
  prefix:     { padding: '12px', background: '#f5f5f5', color: '#333', fontWeight: '500', borderRight: '1px solid #ddd', flexShrink: 0 },
  phoneInput: { flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '16px', fontFamily: 'inherit' },
  otpBtn:     { width: '100%', padding: '13px', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '500', fontFamily: 'inherit' },
  errorText:  { color: 'red', fontSize: '13px', textAlign: 'center', marginTop: '8px', marginBottom: 0 },
  terms:      { fontSize: '12px', color: '#999999', textAlign: 'center', lineHeight: '1.6', marginTop: '20px', marginBottom: 0 },
  termLink:   { color: BLUE, fontWeight: '600', cursor: 'pointer' },

  registerRow:  { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '13px' },
  registerText: { color: '#666666' },
  registerLink: { color: ORANGE, fontWeight: '700', cursor: 'pointer', textDecoration: 'underline' },
  registerDot:  { color: '#CCCCCC' },

  staffLink:  { fontSize: '11px', color: '#999999', cursor: 'pointer', textDecoration: 'underline' },
};
