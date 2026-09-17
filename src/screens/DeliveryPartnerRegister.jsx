import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { sendFirebaseOTP, verifyFirebaseOTP } from '../lib/firebaseOTP';
import { supabase } from '../lib/supabase';
import { uploadAadharImage } from '../lib/deliveryDocs';

const VEHICLE_TYPES = [
  { value: 'bike',    label: 'Bike / Scooter' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'on_foot', label: 'Paidal (On Foot)' },
  { value: 'other',   label: 'Other' },
];

const INITIAL_FORM = {
  name: '', email: '', address: '', aadharNumber: '', vehicleType: '',
};

export default function DeliveryPartnerRegister() {
  const navigate = useNavigate();

  // ── Step 1: mobile + OTP ──
  const [mobile,         setMobile]         = useState('');
  const [otpSent,        setOtpSent]        = useState(false);
  const [otp,            setOtp]            = useState('');
  const [mobileVerified, setMobileVerified] = useState(false);
  const [sendingOtp,     setSendingOtp]     = useState(false);
  const [verifyingOtp,   setVerifyingOtp]   = useState(false);
  const [otpError,       setOtpError]       = useState('');

  // ── Step 2: details (shown only after verification) ──
  const [formData,   setFormData]   = useState(INITIAL_FORM);
  const [aadharFile, setAadharFile] = useState(null);
  const [errors,     setErrors]     = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const fileRef = useRef(null);

  const set = (field) => (e) => {
    setFormData((p) => ({ ...p, [field]: e.target.value }));
    setErrors((p) => ({ ...p, [field]: '' }));
  };

  const handleSendOtp = async () => {
    setOtpError('');
    if (!/^\d{10}$/.test(mobile)) { setOtpError('10-digit mobile number daalo'); return; }
    setSendingOtp(true);
    const result = await sendFirebaseOTP(mobile);
    setSendingOtp(false);
    if (!result.success) { setOtpError(result.error || 'OTP nahi gaya — dobara try karo'); return; }
    setOtpSent(true);
  };

  const handleVerifyOtp = async () => {
    setOtpError('');
    if (!/^\d{6}$/.test(otp)) { setOtpError('6-digit OTP daalo'); return; }
    setVerifyingOtp(true);
    const result = await verifyFirebaseOTP(otp);
    setVerifyingOtp(false);
    if (!result.success) { setOtpError(result.error || 'Galat OTP'); return; }

    // Only phone ownership needed to be proven — no actual login wanted
    // here (this is a pending registration, not a session). Sign back
    // out of the Firebase session verifyFirebaseOTP just created so
    // nothing lingers in the browser.
    firebaseSignOut(auth).catch(() => {});
    setMobileVerified(true);
  };

  const onFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('File 5MB se badi hai. Chhoti file select karo.'); e.target.value = ''; return; }
    setAadharFile(file);
  };

  const validate = () => {
    const e = {};
    if (!formData.name.trim())    e.name    = 'Naam zaroori hai';
    if (!formData.address.trim()) e.address = 'Address zaroori hai';
    if (!/^\d{12}$/.test(formData.aadharNumber)) e.aadharNumber = '12-digit Aadhar daalo';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      let aadharImageUrl = null;
      if (aadharFile) {
        const { path, error } = await uploadAadharImage(aadharFile, mobile);
        if (error) throw error;
        aadharImageUrl = path;
      }

      const { error } = await supabase.from('delivery_partner_registrations').insert({
        name:             formData.name.trim(),
        mobile,
        mobile_verified:  true,
        email:            formData.email.trim() || null,
        address:          formData.address.trim(),
        aadhar_number:    formData.aadharNumber,
        aadhar_image_url: aadharImageUrl,
        vehicle_type:     formData.vehicleType || null,
        status:           'pending',
      });
      if (error) throw error;
      setSubmitted(true);
    } catch (err) {
      alert('Submit nahi hua: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ maxWidth: '400px', width: '100%', backgroundColor: '#FFFFFF', borderRadius: '24px', padding: '40px 28px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '64px' }}>✅</div>
          <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: 0 }}>Aapki application submit ho gayi!</h2>
          <p style={{ fontSize: '14px', color: '#555', margin: 0 }}>SuperAdmin review karega, approval ke baad aap login kar sakenge.</p>
          <button style={{ width: '100%', padding: '14px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => navigate('/login')}>
            Login Page Pe Jaao
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

        <div style={s.header}>
          <button style={s.backBtn} onClick={() => navigate('/login')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <div>
            <h1 style={s.title}>Delivery Partner Registration</h1>
            <p style={s.subtitle}>Apna mobile verify karke registration bharo</p>
          </div>
        </div>

        <div style={s.card}>
          {/* ── Step 1: Mobile + OTP ── */}
          <Field label="Mobile Number *">
            <input
              style={inp} type="tel" inputMode="numeric" maxLength={10}
              value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              placeholder="10-digit mobile" disabled={mobileVerified}
            />
          </Field>

          {!mobileVerified && !otpSent && (
            <button style={s.actionBtn} onClick={handleSendOtp} disabled={sendingOtp}>
              {sendingOtp ? 'Bhej Rahe Hain...' : 'OTP Bhejo'}
            </button>
          )}

          {!mobileVerified && otpSent && (
            <>
              <Field label="OTP *">
                <input
                  style={inp} type="tel" inputMode="numeric" maxLength={6}
                  value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit OTP"
                />
              </Field>
              <button style={s.actionBtn} onClick={handleVerifyOtp} disabled={verifyingOtp}>
                {verifyingOtp ? 'Verify Ho Raha Hai...' : 'Verify Karo'}
              </button>
              <button style={s.linkBtn} onClick={handleSendOtp} disabled={sendingOtp}>
                OTP nahi aaya? Dobara Bhejo
              </button>
            </>
          )}

          {otpError && <p style={s.errorText}>{otpError}</p>}

          {mobileVerified && (
            <>
              <div style={s.verifiedBadge}>✓ Mobile Verified</div>

              {/* ── Step 2: Details ── */}
              <Field label="Poora Naam *" error={errors.name}>
                <input style={inp} value={formData.name} onChange={set('name')} placeholder="Aapka naam" />
              </Field>
              <Field label="Email (optional)">
                <input style={inp} type="email" value={formData.email} onChange={set('email')} placeholder="aapka@email.com" />
              </Field>
              <Field label="Pura Address *" error={errors.address}>
                <textarea style={{ ...inp, minHeight: '80px', resize: 'vertical' }} value={formData.address} onChange={set('address')} placeholder="Ghar number, mohalla, landmark..." />
              </Field>
              <Field label="Aadhar Number *" error={errors.aadharNumber}>
                <input style={inp} type="tel" inputMode="numeric" maxLength={12} value={formData.aadharNumber} onChange={set('aadharNumber')} placeholder="12-digit Aadhar" />
              </Field>
              <Field label="Vehicle Type">
                <select style={inp} value={formData.vehicleType} onChange={set('vehicleType')}>
                  <option value="">-- Vehicle chuniye (optional) --</option>
                  {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </Field>

              <Field label="Aadhar Image (optional)">
                <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }} onChange={onFileChange} />
                <button type="button" onClick={() => fileRef.current?.click()} style={fileUploadBtn(!!aadharFile)}>
                  {aadharFile ? `✅ ${aadharFile.name}` : '📎 Aadhar Image Upload Karo (JPG / PNG / PDF)'}
                </button>
                {aadharFile && (
                  <button type="button" onClick={() => { setAadharFile(null); fileRef.current.value = ''; }} style={fileRemoveBtn}>
                    × Hatao
                  </button>
                )}
              </Field>

              <button style={{ ...s.actionBtn, opacity: submitting ? 0.6 : 1 }} onClick={handleSubmit} disabled={submitting}>
                {submitting ? (aadharFile ? 'File Upload Ho Rahi Hai...' : 'Submit Ho Raha Hai...') : 'Submit Karo'}
              </button>
            </>
          )}
        </div>

      </div>

      <div id="recaptcha-container" />
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '13px', fontWeight: '600', color: '#444' }}>{label}</label>
      {children}
      {error && <span style={{ fontSize: '12px', color: '#e53935' }}>{error}</span>}
    </div>
  );
}

const fileUploadBtn = (hasFile) => ({
  width: '100%', padding: '12px 14px', fontFamily: 'inherit',
  border: `2px dashed ${hasFile ? '#1A6B3C' : '#C8C8C8'}`,
  borderRadius: '10px', cursor: 'pointer', fontSize: '14px', textAlign: 'left',
  backgroundColor: hasFile ? '#E8F5E9' : '#FAFAFA',
  color: hasFile ? '#1A6B3C' : '#888888',
  fontWeight: hasFile ? '600' : '400',
  transition: 'all 0.2s',
  wordBreak: 'break-all',
});

const fileRemoveBtn = {
  marginTop: '4px', background: 'none', border: 'none', cursor: 'pointer',
  fontSize: '12px', color: '#e53935', fontFamily: 'inherit', padding: '0',
};

const inp = {
  width: '100%', padding: '12px 14px', border: '1.5px solid #E0E0E0', borderRadius: '10px',
  fontSize: '15px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit',
  backgroundColor: '#FAFAFA', boxSizing: 'border-box',
};

const s = {
  wrapper:   { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center', padding: '0 16px' },
  container: { width: '100%', maxWidth: '520px', paddingTop: '24px', paddingBottom: '40px', display: 'flex', flexDirection: 'column', gap: '16px' },
  header:    { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  backBtn:   { background: 'none', border: 'none', padding: '4px', cursor: 'pointer', borderRadius: '8px', marginTop: '4px', flexShrink: 0 },
  title:     { fontSize: '19px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 2px' },
  subtitle:  { fontSize: '13px', color: '#888888', margin: 0 },
  card:      { backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '16px' },
  actionBtn: { width: '100%', padding: '14px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.2s' },
  linkBtn:   { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', padding: 0, textAlign: 'center' },
  errorText: { fontSize: '12px', color: '#e53935', margin: '-8px 0 0' },
  verifiedBadge: { textAlign: 'center', padding: '8px', backgroundColor: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: '10px', color: '#1A6B3C', fontSize: '13px', fontWeight: '700' },
};
