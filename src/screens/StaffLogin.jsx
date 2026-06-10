import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';

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

const SUPER_ADMIN_EMAIL = 'kv11081987m@gmail.com';

export default function StaffLogin() {
  const navigate = useNavigate();

  const [selectedRole, setSelectedRole] = useState('');
  const [email,        setEmail]        = useState('');
  const [emailFocus,   setEmailFocus]   = useState(false);
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [emailSent,    setEmailSent]    = useState(false);

  const getRedirectRoute = () => REDIRECT_ROUTE[selectedRole] || '/login';

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
        <img src="/logo.png" alt="MedSetu" style={{ width: '140px', height: 'auto', display: 'block', margin: '0 auto 4px' }} />

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
                <div style={{ ...s.inputRow, borderColor: emailFocus ? '#1A6B3C' : error ? '#e53935' : '#E0E0E0' }}>
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
  roleBtnActive: { borderColor: '#1A6B3C', color: '#1A6B3C', backgroundColor: '#F0FDF4' },

  registerBtn: {
    width: '100%', padding: '12px', background: 'transparent',
    border: '2px dashed #1A6B3C', borderRadius: '10px', color: '#1A6B3C',
    cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit',
  },

  card:      { backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '16px' },
  label:     { fontSize: '13px', fontWeight: '600', color: '#444444', margin: '0 0 6px' },
  inputRow:  { display: 'flex', alignItems: 'center', border: '1.5px solid', borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.2s' },
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
};
