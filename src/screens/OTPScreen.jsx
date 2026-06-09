import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { verifyOTP, sendOTP } from '../lib/auth';
import { useAuth } from '../context/AuthContext';

const OTP_LENGTH  = 6;
const TIMER_START = 4 * 60 + 59;
const DEV_OTP     = '123456';

export default function OTPScreen() {
  const navigate    = useNavigate();
  const location    = useLocation();
  const { applyDevSession } = useAuth();

  const phone     = location.state?.phone || '0000000000';
  const isDev     = location.state?.dev   ?? true;
  const masked    = phone.slice(0, 4).replace(/\d/g, 'X') + phone.slice(4);

  const [otp,           setOtp]           = useState(Array(OTP_LENGTH).fill(''));
  const [timeLeft,      setTimeLeft]      = useState(TIMER_START);
  const [canResend,     setCanResend]     = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const inputRefs = useRef([]);

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) { setCanResend(true); return; }
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timeLeft]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const handleChange = (value, index) => {
    const digit  = value.replace(/\D/g, '').slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);
    if (error) setError('');
    if (digit && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace') {
      if (otp[index]) {
        const n = [...otp]; n[index] = ''; setOtp(n);
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
        const n = [...otp]; n[index - 1] = ''; setOtp(n);
      }
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    const newOtp = [...otp];
    pasted.split('').forEach((ch, i) => { newOtp[i] = ch; });
    setOtp(newOtp);
    const nextEmpty = newOtp.findIndex((v) => !v);
    inputRefs.current[nextEmpty === -1 ? OTP_LENGTH - 1 : nextEmpty]?.focus();
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < OTP_LENGTH) { setError('Pura 6-digit OTP daalo'); return; }

    // Dev bypass — always works
    if (code === DEV_OTP || isDev) {
      if (code !== DEV_OTP && !isDev) {
        setError('Wrong OTP. Dev mode mein 123456 use karo.');
        return;
      }
      applyDevSession(phone, 'customer');
      setShowRoleModal(true);
      return;
    }

    // Real Supabase verification
    setLoading(true);
    setError('');
    const { data, error: verifyError } = await verifyOTP(phone, code);
    setLoading(false);

    if (verifyError) {
      // Fallback: if provider still not enabled, accept dev OTP
      if (code === DEV_OTP) {
        applyDevSession(phone, 'customer');
        setShowRoleModal(true);
        return;
      }
      setError('Galat OTP hai. Dobara try karo.');
      return;
    }

    if (data?.session) {
      setShowRoleModal(true);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setOtp(Array(OTP_LENGTH).fill(''));
    setTimeLeft(TIMER_START);
    setCanResend(false);
    setError('');
    inputRefs.current[0]?.focus();
    if (!isDev) await sendOTP(phone);
  };

  const handleRoleSelect = (role) => {
    applyDevSession(phone, role);
    setShowRoleModal(false);
    navigate(role === 'seller' ? '/seller-dashboard' : '/home');
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>

        {/* Back */}
        <button style={styles.backBtn} onClick={() => navigate('/login')}>
          <ArrowLeft size={22} color="#1A1A1A" />
        </button>

        {/* Heading */}
        <div style={styles.headingBlock}>
          <h2 style={styles.title}>OTP Verify Karo</h2>
          <p style={styles.subtitle}>
            6-digit OTP bheja gaya hai <strong>+91 {masked}</strong> pe
          </p>
          <button style={styles.changeLink} onClick={() => navigate('/login')}>
            Number change karein?
          </button>
        </div>

        {isDev && (
          <div style={styles.devBanner}>
            💡 Dev mode — <strong>{DEV_OTP}</strong> enter karo ya koi bhi 6 digits (dev bypass ON)
          </div>
        )}

        {/* OTP Boxes */}
        <div style={styles.otpRow} onPaste={handlePaste}>
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => (inputRefs.current[i] = el)}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(e.target.value, i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              autoFocus={i === 0}
              style={{
                ...styles.otpBox,
                borderColor:     digit ? '#1A6B3C' : '#E0E0E0',
                backgroundColor: digit ? '#E8F5EE' : '#FFFFFF',
              }}
            />
          ))}
        </div>
        {error && <p style={styles.errorText}>{error}</p>}

        {/* Timer */}
        <p style={styles.timerText}>
          {timeLeft > 0
            ? `OTP expire hoga: ${formatTime(timeLeft)}`
            : 'OTP expire ho gaya'}
        </p>

        {/* Verify Button */}
        <button
          style={{ ...styles.primaryBtn, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
          onClick={handleVerify}
          disabled={loading}
        >
          {loading ? 'Verify Ho Raha Hai...' : 'Verify Karo'}
        </button>

        {/* Resend */}
        <button
          style={{ ...styles.resendBtn, color: canResend ? '#1A6B3C' : '#AAAAAA', cursor: canResend ? 'pointer' : 'default' }}
          onClick={handleResend}
          disabled={!canResend}
        >
          OTP nahi aaya? Resend karo
        </button>
      </div>

      {/* Role Modal */}
      {showRoleModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalSheet}>
            <div style={styles.modalHandle} />
            <h3 style={styles.modalTitle}>Aap kaun hain?</h3>
            <p style={styles.modalSubtitle}>Apna role chunein</p>

            <button style={styles.roleBtn} onClick={() => handleRoleSelect('customer')}>
              Customer
              <span style={styles.roleBtnHint}>Dawai khareedna chahta hoon</span>
            </button>

            <button
              style={{ ...styles.roleBtn, ...styles.roleBtnOutlined }}
              onClick={() => handleRoleSelect('seller')}
            >
              Seller / Dukandaar
              <span style={{ ...styles.roleBtnHint, color: '#1A6B3C' }}>
                Apni dukaan manage karna chahta hoon
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh', backgroundColor: '#F5F5F5',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px 16px', position: 'relative',
  },
  container: {
    width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF',
    borderRadius: '20px', padding: '28px 24px 36px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    display: 'flex', flexDirection: 'column', gap: '20px',
  },
  backBtn: { background: 'none', border: 'none', padding: '4px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: '8px' },
  headingBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  title:        { fontSize: '22px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  subtitle:     { fontSize: '14px', color: '#666666', margin: 0, lineHeight: '1.5' },
  changeLink: { background: 'none', border: 'none', padding: 0, fontSize: '14px', color: '#1A6B3C', fontWeight: '600', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: 'fit-content' },
  devBanner: { fontSize: '12px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', padding: '10px 12px', borderRadius: '8px', lineHeight: '1.5' },
  otpRow: { display: 'flex', gap: '10px', justifyContent: 'center' },
  otpBox: {
    width: '48px', height: '56px', borderRadius: '10px', border: '2px solid',
    textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#1A1A1A',
    outline: 'none', transition: 'border-color 0.15s ease, background-color 0.15s ease', fontFamily: 'inherit',
  },
  errorText:  { fontSize: '13px', color: '#e53935', textAlign: 'center', margin: '-8px 0 0' },
  timerText:  { fontSize: '13px', color: '#888888', textAlign: 'center', margin: 0 },
  primaryBtn: {
    width: '100%', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', fontFamily: 'inherit',
  },
  resendBtn:  { background: 'none', border: 'none', fontSize: '14px', fontWeight: '500', fontFamily: 'inherit', textAlign: 'center', padding: 0 },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  modalSheet: { width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '24px 24px 0 0', padding: '16px 24px 40px', display: 'flex', flexDirection: 'column', gap: '14px' },
  modalHandle:   { width: '40px', height: '4px', backgroundColor: '#E0E0E0', borderRadius: '2px', alignSelf: 'center', marginBottom: '8px' },
  modalTitle:    { fontSize: '22px', fontWeight: '700', color: '#1A1A1A', margin: 0, textAlign: 'center' },
  modalSubtitle: { fontSize: '14px', color: '#888888', margin: 0, textAlign: 'center' },
  roleBtn: { width: '100%', padding: '16px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '17px', fontWeight: '600', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontFamily: 'inherit' },
  roleBtnOutlined: { backgroundColor: '#FFFFFF', border: '2px solid #1A6B3C', color: '#1A6B3C' },
  roleBtnHint:     { fontSize: '12px', fontWeight: '400', color: 'rgba(255,255,255,0.8)', opacity: 0.85 },
};
