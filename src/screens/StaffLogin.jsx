import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { id: 'admin',      label: 'Admin' },
  { id: 'pharmacist', label: 'Pharmacist' },
  { id: 'seller',     label: 'Seller' },
];

const DEMO_CREDS = {
  admin:      { email: 'admin@medsetu.in',  password: 'admin123',  route: '/admin' },
  pharmacist: { email: 'pharma@medsetu.in', password: 'pharma123', route: '/pharmacist' },
  seller:     { email: 'seller@medsetu.in', password: 'seller123', route: '/seller-dashboard' },
};

export default function StaffLogin() {
  const navigate = useNavigate();
  const { applyDevSession } = useAuth();

  const [selectedRole, setSelectedRole] = useState('');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [emailFocus,   setEmailFocus]   = useState(false);
  const [passFocus,    setPassFocus]    = useState(false);

  const handleLogin = async () => {
    if (!selectedRole)  { setError('Pehle role select karo'); return; }
    if (!email.trim())  { setError('Email daalo'); return; }
    if (!password)      { setError('Password daalo'); return; }

    setLoading(true); setError('');
    await new Promise((r) => setTimeout(r, 600));

    const creds = DEMO_CREDS[selectedRole];
    if (email.trim() === creds.email && password === creds.password) {
      applyDevSession(email.trim(), selectedRole);
      navigate(creds.route);
    } else {
      setError('Email ya password galat hai');
    }
    setLoading(false);
  };

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

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

        {/* ── Form Card ── */}
        <div style={s.card}>

          {/* Email */}
          <div>
            <p style={s.label}>Email ID</p>
            <div style={{ ...s.inputRow, borderColor: emailFocus ? '#1A6B3C' : error && !email ? '#e53935' : '#E0E0E0' }}>
              <div style={s.iconBox}>
                <Mail size={16} color="#888888" />
              </div>
              <input
                type="email"
                placeholder="staff@medsetu.in"
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

          {/* Password */}
          <div>
            <p style={s.label}>Password</p>
            <div style={{ ...s.inputRow, borderColor: passFocus ? '#1A6B3C' : error && !password ? '#e53935' : '#E0E0E0' }}>
              <div style={s.iconBox}>
                <Lock size={16} color="#888888" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                onFocus={() => setPassFocus(true)}
                onBlur={() => setPassFocus(false)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                style={s.textInput}
                disabled={loading}
              />
              <button style={s.eyeBtn} onClick={() => setShowPassword((v) => !v)} tabIndex={-1}>
                {showPassword ? <EyeOff size={16} color="#888888" /> : <Eye size={16} color="#888888" />}
              </button>
            </div>
          </div>

          {error && <p style={s.errorText}>{error}</p>}

          {/* Login Button */}
          <button
            style={{ ...s.loginBtn, opacity: (!selectedRole || loading) ? 0.6 : 1 }}
            onClick={handleLogin}
            disabled={!selectedRole || loading}
          >
            {loading ? 'Login Ho Raha Hai...' : 'Login Karo'}
          </button>
        </div>


      </div>
    </div>
  );
}

const s = {
  wrapper:    { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center', padding: '0 16px' },
  container:  { width: '100%', maxWidth: '480px', paddingTop: '24px', paddingBottom: '40px', display: 'flex', flexDirection: 'column', gap: '20px' },

  header:  { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  backBtn: { background: 'none', border: 'none', padding: '4px', cursor: 'pointer', borderRadius: '8px', marginTop: '2px', flexShrink: 0 },
  title:   { fontSize: '22px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  subtitle: { fontSize: '13px', color: '#888888', margin: 0 },

  roleRow:       { display: 'flex', gap: '10px' },
  roleBtn:       { flex: 1, padding: '10px 0', borderRadius: '10px', border: '1.5px solid #E0E0E0', backgroundColor: '#FFFFFF', fontSize: '14px', fontWeight: '600', color: '#888888', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s ease' },
  roleBtnActive: { borderColor: '#1A6B3C', color: '#1A6B3C', backgroundColor: '#F0FDF4' },

  card:     { backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '16px' },
  label:    { fontSize: '13px', fontWeight: '600', color: '#444444', margin: '0 0 6px' },
  inputRow: { display: 'flex', alignItems: 'center', border: '1.5px solid', borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.2s' },
  iconBox:  { padding: '0 12px', display: 'flex', alignItems: 'center', backgroundColor: '#F5F5F5', alignSelf: 'stretch' },
  textInput: { flex: 1, border: 'none', outline: 'none', padding: '13px 12px', fontSize: '15px', color: '#1A1A1A', backgroundColor: 'transparent', fontFamily: 'inherit' },
  eyeBtn:   { background: 'none', border: 'none', padding: '0 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', alignSelf: 'stretch' },

  errorText: { fontSize: '13px', color: '#e53935', margin: '-4px 0 0' },

  loginBtn: {
    width: '100%', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600',
    cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.2s',
  },

};
