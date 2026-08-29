import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ROLES = [
  { id: 'admin',      label: 'Admin' },
  { id: 'pharmacist', label: 'Pharmacist' },
  { id: 'seller',     label: 'Seller' },
];

const REDIRECT_ROUTE = {
  admin:       '/admin',
  pharmacist:  '/pharmacist',
  seller:      '/seller-dashboard',
  super_admin: '/super-admin',
};

export default function StaffLogin() {
  const navigate = useNavigate();

  const [selectedRole, setSelectedRole] = useState('');
  const [error,        setError]        = useState('');

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

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

        {/* ── Logo ── */}
        <div style={{ background: '#FFFFFF', borderRadius: '14px', padding: '10px 18px', display: 'block', margin: '0 auto 8px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', textAlign: 'center', width: 'fit-content' }}>
          <img src="/logo.png" alt="MedSetu" style={{ width: '130px', height: 'auto', display: 'block' }} />
        </div>

        {/* ── Pilot notice ── */}
        <div style={s.pilotNotice}>
          <p style={s.pilotTitle}>यह एक पायलट प्रोजेक्ट है</p>
          <p style={s.pilotSub}>आपका फीडबैक हमें बेहतर बनाता है</p>
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
                onClick={() => { setSelectedRole(id); setError(''); }}
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
          {error && <p style={s.errorText}>{error}</p>}

          {selectedRole ? (
            <button style={s.googleBtn} onClick={handleGoogleLogin}>
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google se Login Karo
            </button>
          ) : (
            <p style={s.hintText}>Pehle upar se role select karo</p>
          )}
        </div>

      </div>
    </div>
  );
}

const s = {
  wrapper:    { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center', padding: '0 16px' },
  container:  { width: '100%', maxWidth: '480px', paddingTop: '24px', paddingBottom: '40px', display: 'flex', flexDirection: 'column', gap: '16px' },

  pilotNotice:{ background: '#FFF4E5', border: '1px solid #F26C0A33', borderRadius: '10px', padding: '6px 14px', textAlign: 'center' },
  pilotTitle: { fontSize: '13px', fontWeight: '700', color: '#F26C0A', margin: 0 },
  pilotSub:   { fontSize: '11px', fontWeight: '400', color: '#666', margin: '2px 0 0' },

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

  errorText: { fontSize: '13px', color: '#e53935', margin: '-4px 0 0' },
  hintText:  { fontSize: '12px', color: '#888888', textAlign: 'center', backgroundColor: '#FFFBEB', padding: '8px 12px', borderRadius: '8px', margin: 0 },

  googleBtn: {
    width: '100%', padding: '12px', backgroundColor: '#FFFFFF',
    border: '1.5px solid #DDDDDD', borderRadius: '10px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
    cursor: 'pointer', fontSize: '15px', fontWeight: '500', color: '#333333',
    fontFamily: 'inherit', transition: 'box-shadow 0.15s ease',
  },
};
