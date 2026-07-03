import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SUPER_ADMIN_EMAIL } from '../context/AuthContext';

const ROLES = [
  { id: 'admin',      label: 'Admin' },
  { id: 'pharmacist', label: 'Pharmacist' },
  { id: 'seller',     label: 'Seller' },
];

const PLACEHOLDER = {
  admin:      'admin@medsetu.in',
  pharmacist: 'pharma@medsetu.in',
  seller:     'seller@medsetu.in',
};

const REDIRECT_ROUTE = {
  admin:       '/admin',
  pharmacist:  '/pharmacist',
  seller:      '/seller-dashboard',
  super_admin: '/super-admin',
};

export default function StaffLogin() {
  const navigate = useNavigate();

  const [selectedRole, setSelectedRole] = useState('');
  const [email,        setEmail]        = useState('');
  const [emailFocus,   setEmailFocus]   = useState(false);
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [emailSent,    setEmailSent]    = useState(false);

  const getRedirectRoute = () => REDIRECT_ROUTE[selectedRole] || '/login';

  const handleGoogleLogin = async () => {
    if (!selectedRole) { setError('Pehle role select karo'); return; }
    try {
      localStorage.setItem('staff_pending_role', selectedRole);
      const { error: authErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + getRedirectRoute(),
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (authErr) throw authErr;
    } catch (err) {
      setError('Google login error: ' + err.message);
    }
  };

  const handleLogin = async () => {
    if (!selectedRole) { setError('Pehle role select karo'); return; }
    if (!email.trim() || !email.includes('@')) { setError('Valid email daalo'); return; }

    setLoading(true); setError('');

    try {
      const trimmedEmail = email.trim().toLowerCase();

      // ── Super Admin fast-path ──────────────────────────
      if (trimmedEmail === SUPER_ADMIN_EMAIL) {
        localStorage.setItem('staff_pending_role', 'super_admin');
        const { error: authErr } = await supabase.auth.signInWithOtp({
          email: trimmedEmail,
          options: { emailRedirectTo: window.location.origin + '/super-admin' },
        });
        if (authErr) throw authErr;
        setEmailSent(true);
        return;
      }

      // ── Whitelist check ────────────────────────────────
      const { data: whitelisted } = await supabase
        .from('staff_whitelist')
        .select('*')
        .eq('email', trimmedEmail)
        .eq('role', selectedRole)
        .eq('is_approved', true)
        .maybeSingle();

      if (!whitelisted) {
        setError(
          'Aapka account approved nahi hai. ' +
          'Pehli baar? Neeche "Account Banao" pe click karo.'
        );
        return;
      }

      // ── Approved — send magic link ─────────────────────
      localStorage.setItem('staff_pending_role', selectedRole);
      const { error: authErr } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { emailRedirectTo: window.location.origin + getRedirectRoute() },
      });
      if (authErr) throw authErr;
      setEmailSent(true);

    } catch (err) {
      setError('Email nahi bheja: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

        {/* ── Logo ── */}
        <div style={{ background: '#FFFFFF', borderRadius: '14px', padding: '10px 18px', display: 'block', margin: '0 auto 8px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', textAlign: 'center', width: 'fit-content' }}>
          <img src="/logo.png" alt="MedSetu" style={{ width: '130px', height: 'auto', display: 'block' }} />
        </div>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.backBtn} onClick={() => navigate('/login')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <div>
            <h1 style={s.title}>Staff Login</h1>
            <p style={s.subtitle}>Sirf authorized staff ke liye</p>
          </div>
        </div>

        {/* ── Role Selector ── */}
        <div style={s.roleRow}>
          {ROLES.map(({ id, label }) => {
            const active = selectedRole === id;
            return (
              <button
                key={id}
                style={{ ...s.roleBtn, ...(active ? s.roleBtnActive : {}) }}
                onClick={() => { setSelectedRole(id); setError(''); setEmailSent(false); }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Registration shortcut buttons ── */}
        {selectedRole === 'seller' && (
          <button style={s.registerBtn} onClick={() => navigate('/seller-register')}>
            🏪 Pehli Baar? Seller Account Banao
          </button>
        )}
        {selectedRole === 'pharmacist' && (
          <button style={s.registerBtn} onClick={() => navigate('/pharmacist-register')}>
            💊 Pehli Baar? Pharmacist Account Banao
          </button>
        )}

        {/* ── Form Card ── */}
        <div style={s.card}>
          {emailSent ? (
            <div style={s.successBox}>
              <p style={s.successIcon}>📧</p>
              <p style={s.successTitle}>Magic Link Bhej Diya!</p>
              <p style={s.successSub}>
                <strong>{email}</strong> pe link bheja gaya hai.
                Email check karo aur link pe click karo.
              </p>
              <button style={s.retryBtn} onClick={() => { setEmailSent(false); setEmail(''); }}>
                Dobara Try Karo
              </button>
            </div>
          ) : (
            <>
              <div>
                <p style={s.label}>Email ID</p>
                <div style={{ ...s.inputRow, border: emailFocus ? '1.5px solid #1A6B3C' : error ? '1.5px solid #e53935' : '1.5px solid #E0E0E0' }}>
                  <div style={s.iconBox}>
                    <Mail size={16} color="#888888" />
                  </div>
                  <input
                    type="email"
                    placeholder={selectedRole ? PLACEHOLDER[selectedRole] : 'staff@medsetu.in'}
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    onFocus={() => setEmailFocus(true)}
                    onBlur={() => setEmailFocus(false)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    style={s.textInput}
                    disabled={loading}
                  />
                </div>
              </div>

              {error && <p style={s.errorText}>{error}</p>}

              <button
                style={{ ...s.loginBtn, opacity: (!selectedRole || loading) ? 0.6 : 1 }}
                onClick={handleLogin}
                disabled={!selectedRole || loading}
              >
                {loading ? 'Link Bheja Ja Raha Hai...' : '🔗 Magic Link Bhejo'}
              </button>

              <p style={s.hintText}>
                Email mein link aayega — click karo aur login ho jaao
              </p>

              {(selectedRole === 'seller' || selectedRole === 'pharmacist') && (
                <>
                  <div style={s.dividerRow}>
                    <div style={s.dividerLine} />
                    <span style={s.dividerText}>ya</span>
                    <div style={s.dividerLine} />
                  </div>

                  <button style={s.googleBtn} onClick={handleGoogleLogin} disabled={loading}>
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Google se Login Karo
                  </button>
                </>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}

const s = {
  wrapper:    { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center', padding: '0 16px' },
  container:  { width: '100%', maxWidth: '480px', paddingTop: '24px', paddingBottom: '40px', display: 'flex', flexDirection: 'column', gap: '16px' },

  header:   { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  backBtn:  { background: 'none', border: 'none', padding: '4px', cursor: 'pointer', borderRadius: '8px', marginTop: '2px', flexShrink: 0 },
  title:    { fontSize: '22px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  subtitle: { fontSize: '13px', color: '#888888', margin: 0 },

  roleRow:       { display: 'flex', gap: '10px' },
  roleBtn:       { flex: 1, padding: '10px 0', borderRadius: '10px', border: '1.5px solid #E0E0E0', backgroundColor: '#FFFFFF', fontSize: '14px', fontWeight: '600', color: '#888888', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s ease' },
  roleBtnActive: { border: '1.5px solid #1A6B3C', color: '#1A6B3C', backgroundColor: '#F0FDF4' },

  registerBtn: {
    width: '100%', padding: '12px', background: 'transparent',
    border: '2px dashed #1A6B3C', borderRadius: '10px', color: '#1A6B3C',
    cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit',
  },

  card:      { backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '16px' },
  label:     { fontSize: '13px', fontWeight: '600', color: '#444444', margin: '0 0 6px' },
  inputRow:  { display: 'flex', alignItems: 'center', border: '1.5px solid #E0E0E0', borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.2s' },
  iconBox:   { padding: '0 12px', display: 'flex', alignItems: 'center', backgroundColor: '#F5F5F5', alignSelf: 'stretch' },
  textInput: { flex: 1, border: 'none', outline: 'none', padding: '13px 12px', fontSize: '15px', color: '#1A1A1A', backgroundColor: 'transparent', fontFamily: 'inherit' },

  errorText: { fontSize: '13px', color: '#e53935', margin: '-4px 0 0' },
  hintText:  { fontSize: '12px', color: '#888888', textAlign: 'center', backgroundColor: '#FFFBEB', padding: '8px 12px', borderRadius: '8px', margin: 0 },

  loginBtn: {
    width: '100%', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600',
    cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.2s',
  },

  successBox:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '8px 0', textAlign: 'center' },
  successIcon:  { fontSize: '40px', margin: 0 },
  successTitle: { fontSize: '18px', fontWeight: '700', color: '#1A6B3C', margin: 0 },
  successSub:   { fontSize: '13px', color: '#555555', margin: 0, lineHeight: '1.6' },
  retryBtn: {
    marginTop: '4px', padding: '8px 20px', background: 'transparent',
    border: '1.5px solid #1A6B3C', borderRadius: '8px', color: '#1A6B3C',
    fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
  },

  dividerRow:  { display: 'flex', alignItems: 'center', gap: '10px' },
  dividerLine: { flex: 1, height: '1px', backgroundColor: '#EEEEEE' },
  dividerText: { fontSize: '13px', color: '#999999', flexShrink: 0 },

  googleBtn: {
    width: '100%', padding: '12px', backgroundColor: '#FFFFFF',
    border: '1.5px solid #DDDDDD', borderRadius: '10px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
    cursor: 'pointer', fontSize: '15px', fontWeight: '500', color: '#333333',
    fontFamily: 'inherit', transition: 'box-shadow 0.15s ease',
  },
};
