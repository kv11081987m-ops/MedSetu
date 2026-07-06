import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { createOrLoginUser, verifyStoredOTP, generateOTP, storeOTP } from '../lib/auth';
import { verifyFirebaseOTP, sendFirebaseOTP } from '../lib/firebaseOTP';
import { useAuth } from '../context/AuthContext';
const OTP_LENGTH  = 6;
const TIMER_START = 30;

export default function OTPScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { applyDevSession } = useAuth();

  const phone  = location.state?.phone  || '';
  const method = location.state?.method || null;
  const devOtp = location.state?.otp    || null;
  const masked = phone ? phone.slice(0, 4).replace(/\d/g, 'X') + phone.slice(4) : 'XXXXXXXXXX';

  // Redirect if accessed directly without phone state
  useEffect(() => {
    if (!location.state?.phone) navigate('/login', { replace: true });
  }, [location.state, navigate]);

  const [otp,           setOtp]           = useState(Array(OTP_LENGTH).fill(''));
  const [timeLeft,      setTimeLeft]      = useState(TIMER_START);
  const [canResend,     setCanResend]     = useState(false);
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [resendMessage, setResendMessage] = useState('');
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

    if (!location.state?.phone) {
      setError('Phone number nahi mila');
      navigate('/login');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (method === 'firebase') {
        const result = await verifyFirebaseOTP(code);
        if (result.success) {
          applyDevSession(phone, 'customer');
          await createOrLoginUser(phone);
          navigate('/home', { replace: true });
        } else {
          setError(result.error);
          setOtp(Array(OTP_LENGTH).fill(''));
          inputRefs.current[0]?.focus();
        }
      } else {
        const result = verifyStoredOTP(phone, code);
        if (!result.valid) {
          setError(result.message);
          setOtp(Array(OTP_LENGTH).fill(''));
          inputRefs.current[0]?.focus();
          return;
        }
        applyDevSession(phone, 'customer');
        await createOrLoginUser(phone);
        navigate('/home', { replace: true });
      }
    } catch (err) {
      console.error('[DEBUG LOGIN] error:', err);
      setError('Login mein dikkat: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    if (!phone) { navigate('/login'); return; }

    setOtp(Array(OTP_LENGTH).fill(''));
    setTimeLeft(TIMER_START);
    setCanResend(false);
    setError('');
    inputRefs.current[0]?.focus();

    if (method === 'firebase') {
      const result = await sendFirebaseOTP(phone);
      setResendMessage(result.success ? 'Naya OTP bhej diya' : 'OTP nahi gaya — dobara try karo');
    } else {
      const newOtp = generateOTP();
      storeOTP(phone, newOtp);
      setResendMessage('Naya OTP generate ho gaya');
    }
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
            <strong>+91 {masked}</strong> ke liye OTP screen
          </p>
          <button style={styles.changeLink} onClick={() => navigate('/login')}>
            Number change karein?
          </button>
        </div>

        {/* Dev OTP hint — only shown in local dev mode, never in production */}
        {import.meta.env.DEV && devOtp && (
          <div style={styles.devBanner}>
            🔐 Dev OTP: <strong>{devOtp}</strong> — SMS integration active in production
          </div>
        )}
        {resendMessage && (
          <div style={{ ...styles.devBanner, backgroundColor: '#E8F5EE', borderColor: '#C8E6C9', color: '#1A6B3C' }}>
            ✓ {resendMessage}
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
                border:          digit ? '2px solid #1A6B3C' : '2px solid #E0E0E0',
                backgroundColor: digit ? '#E8F5EE' : '#FFFFFF',
              }}
            />
          ))}
        </div>
        {error && <p style={styles.errorText}>{error}</p>}

        {/* Timer */}
        <p style={styles.timerText}>
          {timeLeft > 0
            ? `Resend ${formatTime(timeLeft)} mein available hoga`
            : 'Resend available hai'}
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
  devBanner: { fontSize: '13px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', padding: '10px 14px', borderRadius: '10px', lineHeight: '1.6' },
  otpRow: { display: 'flex', gap: '10px', justifyContent: 'center' },
  otpBox: {
    width: '48px', height: '56px', borderRadius: '10px', border: '2px solid #E0E0E0',
    textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#1A1A1A',
    outline: 'none', transition: 'border-color 0.15s ease, background-color 0.15s ease', fontFamily: 'inherit',
  },
  errorText:  { fontSize: '13px', color: '#e53935', textAlign: 'center', margin: '-8px 0 0' },
  timerText:  { fontSize: '13px', color: '#888888', textAlign: 'center', margin: 0 },
  primaryBtn: {
    width: '100%', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', fontFamily: 'inherit',
  },
  resendBtn: { background: 'none', border: 'none', fontSize: '14px', fontWeight: '500', fontFamily: 'inherit', textAlign: 'center', padding: 0 },
};
