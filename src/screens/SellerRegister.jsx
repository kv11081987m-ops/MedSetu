import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';

const DISTRICTS = [
  'Deoria', 'Gorakhpur', 'Kushinagar', 'Maharajganj',
  'Sant Kabir Nagar', 'Basti', 'Azamgarh', 'Mau', 'Other',
];

const TOTAL_STEPS = 4;
const STEP_TITLES = [
  'Personal Jankari',
  'Dukaan Ki Jankari',
  'Kaanooni Dastavej',
  'Bank Ki Jankari',
];

const INITIAL_FORM = {
  ownerName: '', mobile: '', email: '', aadharNumber: '',
  storeName: '', address: '', district: '', city: '', pincode: '', mapsLink: '',
  drugLicenseNumber: '', drugLicenseExpiry: '', pharmacistName: '', pharmacistRegNumber: '',
  bankName: '', accountNumber: '', ifscCode: '', upiId: '',
};

export default function SellerRegister() {
  const navigate = useNavigate();

  const [step,        setStep]        = useState(1);
  const [formData,    setFormData]    = useState(INITIAL_FORM);
  const [agreed,      setAgreed]      = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [errors,      setErrors]      = useState({});

  const set = (field) => (e) => {
    setFormData((p) => ({ ...p, [field]: e.target.value }));
    setErrors((p) => ({ ...p, [field]: '' }));
  };

  const validateStep = () => {
    const e = {};
    if (step === 1) {
      if (!formData.ownerName.trim())                           e.ownerName = 'Naam zaroori hai';
      if (!/^\d{10}$/.test(formData.mobile))                   e.mobile    = '10-digit number daalo';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email     = 'Valid email daalo';
      if (!/^\d{12}$/.test(formData.aadharNumber))             e.aadharNumber = '12-digit Aadhar daalo';
    }
    if (step === 2) {
      if (!formData.storeName.trim()) e.storeName = 'Dukaan ka naam zaroori hai';
      if (!formData.address.trim())   e.address   = 'Address zaroori hai';
      if (!formData.district)         e.district  = 'District select karo';
      if (!/^\d{6}$/.test(formData.pincode)) e.pincode = '6-digit pincode daalo';
    }
    if (step === 3) {
      if (!formData.drugLicenseNumber.trim()) e.drugLicenseNumber = 'License number zaroori hai';
      if (!formData.drugLicenseExpiry)        e.drugLicenseExpiry = 'Expiry date daalo';
      if (!formData.pharmacistName.trim())    e.pharmacistName    = 'Pharmacist naam zaroori hai';
      if (!formData.pharmacistRegNumber.trim()) e.pharmacistRegNumber = 'Reg. number zaroori hai';
    }
    if (step === 4) {
      if (!formData.bankName.trim())     e.bankName     = 'Bank naam zaroori hai';
      if (!formData.accountNumber.trim()) e.accountNumber = 'Account number zaroori hai';
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.ifscCode.toUpperCase())) e.ifscCode = 'Valid IFSC code daalo';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const nextStep = () => { if (validateStep()) setStep((s) => s + 1); };
  const prevStep = () => setStep((s) => s - 1);

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('seller_registrations').insert({
        owner_name:             formData.ownerName,
        mobile:                 formData.mobile,
        email:                  formData.email,
        aadhar_number:          formData.aadharNumber,
        store_name:             formData.storeName,
        address:                formData.address,
        district:               formData.district,
        city:                   formData.city,
        pincode:                formData.pincode,
        maps_link:              formData.mapsLink || null,
        drug_license_number:    formData.drugLicenseNumber,
        drug_license_expiry:    formData.drugLicenseExpiry,
        pharmacist_name:        formData.pharmacistName,
        pharmacist_reg_number:  formData.pharmacistRegNumber,
        bank_name:              formData.bankName,
        account_number:         formData.accountNumber,
        ifsc_code:              formData.ifscCode.toUpperCase(),
        upi_id:                 formData.upiId || null,
        status:                 'pending',
      });
      if (error) throw error;
      setSubmitted(true);
    } catch (err) {
      alert('Submit nahi hua: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) return <SuccessScreen onBack={() => navigate('/staff-login')} />;

  const progress = (step / TOTAL_STEPS) * 100;

  return (
    <div style={s.wrapper}>
      <div style={s.container}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.backBtn} onClick={step === 1 ? () => navigate('/staff-login') : prevStep}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={s.title}>Seller Registration</h1>
            <p style={s.stepLabel}>Step {step} of {TOTAL_STEPS} — {STEP_TITLES[step - 1]}</p>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div style={s.progressTrack}>
          <div style={{ ...s.progressFill, width: progress + '%' }} />
        </div>

        {/* ── Step Content ── */}
        <div style={s.card}>
          {step === 1 && <Step1 formData={formData} set={set} errors={errors} />}
          {step === 2 && <Step2 formData={formData} set={set} errors={errors} />}
          {step === 3 && <Step3 formData={formData} set={set} errors={errors} />}
          {step === 4 && (
            <Step4
              formData={formData} set={set} errors={errors}
              agreed={agreed} setAgreed={setAgreed}
            />
          )}

          <button
            style={{ ...s.nextBtn, opacity: (step === 4 && !agreed) || submitting ? 0.5 : 1 }}
            onClick={step === TOTAL_STEPS ? handleSubmit : nextStep}
            disabled={(step === 4 && !agreed) || submitting}
          >
            {submitting ? 'Submit Ho Raha Hai...' : step === TOTAL_STEPS ? 'Registration Submit Karo' : 'Aage Badho →'}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Step 1 — Personal Info ────────────────────────────────────
function Step1({ formData, set, errors }) {
  return (
    <>
      <Field label="Owner Ka Naam *" error={errors.ownerName}>
        <input style={inp} value={formData.ownerName} onChange={set('ownerName')} placeholder="Poora naam" />
      </Field>
      <Field label="Mobile Number *" error={errors.mobile}>
        <input style={inp} type="tel" inputMode="numeric" maxLength={10} value={formData.mobile} onChange={set('mobile')} placeholder="10-digit mobile" />
      </Field>
      <Field label="Email ID *" error={errors.email}>
        <input style={inp} type="email" value={formData.email} onChange={set('email')} placeholder="aapka@email.com" />
      </Field>
      <Field label="Aadhar Number *" error={errors.aadharNumber}>
        <input style={inp} type="tel" inputMode="numeric" maxLength={12} value={formData.aadharNumber} onChange={set('aadharNumber')} placeholder="12-digit Aadhar" />
      </Field>
    </>
  );
}

// ── Step 2 — Store Info ───────────────────────────────────────
function Step2({ formData, set, errors }) {
  return (
    <>
      <Field label="Dukaan Ka Naam *" error={errors.storeName}>
        <input style={inp} value={formData.storeName} onChange={set('storeName')} placeholder="Dukaan ka naam" />
      </Field>
      <Field label="Pura Address *" error={errors.address}>
        <textarea style={{ ...inp, minHeight: '80px', resize: 'vertical' }} value={formData.address} onChange={set('address')} placeholder="Ghar number, mohalla, landmark..." />
      </Field>
      <Field label="District *" error={errors.district}>
        <select style={inp} value={formData.district} onChange={set('district')}>
          <option value="">-- District chuniye --</option>
          {['Deoria','Gorakhpur','Kushinagar','Maharajganj','Sant Kabir Nagar','Basti','Azamgarh','Mau','Other'].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </Field>
      <Field label="Shehar / Kasba" error={errors.city}>
        <input style={inp} value={formData.city} onChange={set('city')} placeholder="Shehar ya kasba ka naam" />
      </Field>
      <Field label="Pincode *" error={errors.pincode}>
        <input style={inp} type="tel" inputMode="numeric" maxLength={6} value={formData.pincode} onChange={set('pincode')} placeholder="6-digit pincode" />
      </Field>
      <Field label="Google Maps Link (optional)" error={errors.mapsLink}>
        <input style={inp} value={formData.mapsLink} onChange={set('mapsLink')} placeholder="https://maps.google.com/..." />
      </Field>
    </>
  );
}

// ── Step 3 — Legal Documents ──────────────────────────────────
function Step3({ formData, set, errors }) {
  return (
    <>
      <Field label="Drug License Number *" error={errors.drugLicenseNumber}>
        <input style={inp} value={formData.drugLicenseNumber} onChange={set('drugLicenseNumber')} placeholder="UP-DL-XXXX-XXXXX" />
      </Field>
      <Field label="Drug License Expiry Date *" error={errors.drugLicenseExpiry}>
        <input style={inp} type="date" value={formData.drugLicenseExpiry} onChange={set('drugLicenseExpiry')} />
      </Field>
      <Field label="Drug License Image *" error={errors.drugLicenseImage}>
        <div style={s.fileNote}>📎 File upload — Supabase Storage baad mein connect hoga</div>
      </Field>
      <Field label="Pharmacist Ka Naam *" error={errors.pharmacistName}>
        <input style={inp} value={formData.pharmacistName} onChange={set('pharmacistName')} placeholder="Registered pharmacist ka naam" />
      </Field>
      <Field label="Pharmacist Reg. Number *" error={errors.pharmacistRegNumber}>
        <input style={inp} value={formData.pharmacistRegNumber} onChange={set('pharmacistRegNumber')} placeholder="UP-PH-XXXX-XXXXX" />
      </Field>
      <Field label="Pharmacist Certificate *" error={errors.pharmacistCert}>
        <div style={s.fileNote}>📎 File upload — Supabase Storage baad mein connect hoga</div>
      </Field>
    </>
  );
}

// ── Step 4 — Bank Details ─────────────────────────────────────
function Step4({ formData, set, errors, agreed, setAgreed }) {
  return (
    <>
      <Field label="Bank Ka Naam *" error={errors.bankName}>
        <input style={inp} value={formData.bankName} onChange={set('bankName')} placeholder="State Bank of India" />
      </Field>
      <Field label="Account Number *" error={errors.accountNumber}>
        <input style={inp} type="tel" inputMode="numeric" value={formData.accountNumber} onChange={set('accountNumber')} placeholder="Bank account number" />
      </Field>
      <Field label="IFSC Code *" error={errors.ifscCode}>
        <input
          style={inp} value={formData.ifscCode}
          onChange={(e) => set('ifscCode')({ target: { value: e.target.value.toUpperCase() } })}
          placeholder="SBIN0001234"
        />
      </Field>
      <Field label="UPI ID (optional)" error={errors.upiId}>
        <input style={inp} value={formData.upiId} onChange={set('upiId')} placeholder="mobile@upi" />
      </Field>

      <label style={s.checkRow}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#1A6B3C', flexShrink: 0 }} />
        <span style={s.checkText}>
          Main confirm karta/karti hoon ki upar di gayi saari jankari sahi hai aur mera drug license valid hai.
        </span>
      </label>
    </>
  );
}

// ── Success Screen ────────────────────────────────────────────
function SuccessScreen({ onBack }) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ maxWidth: '400px', width: '100%', backgroundColor: '#FFFFFF', borderRadius: '24px', padding: '40px 28px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div style={{ fontSize: '64px' }}>✅</div>
        <h2 style={{ fontSize: '22px', fontWeight: '800', color: '#1A1A1A', margin: 0 }}>Registration Submit Ho Gayi!</h2>
        <p style={{ fontSize: '15px', color: '#555', margin: 0 }}>Aapki application review mein hai</p>
        <div style={{ backgroundColor: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: '12px', padding: '16px', width: '100%' }}>
          <p style={{ fontSize: '13px', color: '#1A6B3C', margin: '0 0 4px', fontWeight: '600' }}>Super Admin approval ke baad aapko email aayega</p>
          <p style={{ fontSize: '12px', color: '#4B9E6F', margin: 0 }}>Expected time: 24–48 ghante</p>
        </div>
        <button style={{ width: '100%', padding: '14px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }} onClick={onBack}>
          Login Page Pe Jaao
        </button>
      </div>
    </div>
  );
}

// ── Reusable Field wrapper ────────────────────────────────────
function Field({ label, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '13px', fontWeight: '600', color: '#444' }}>{label}</label>
      {children}
      {error && <span style={{ fontSize: '12px', color: '#e53935' }}>{error}</span>}
    </div>
  );
}

// ── Shared input style ────────────────────────────────────────
const inp = {
  width: '100%', padding: '12px 14px', border: '1.5px solid #E0E0E0', borderRadius: '10px',
  fontSize: '15px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit',
  backgroundColor: '#FAFAFA', boxSizing: 'border-box',
};

const s = {
  wrapper:    { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center', padding: '0 16px' },
  container:  { width: '100%', maxWidth: '520px', paddingTop: '24px', paddingBottom: '40px', display: 'flex', flexDirection: 'column', gap: '16px' },
  header:     { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  backBtn:    { background: 'none', border: 'none', padding: '4px', cursor: 'pointer', borderRadius: '8px', marginTop: '4px', flexShrink: 0 },
  title:      { fontSize: '20px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 2px' },
  stepLabel:  { fontSize: '13px', color: '#888888', margin: 0 },
  progressTrack: { height: '6px', backgroundColor: '#E0E0E0', borderRadius: '3px', overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: '#1A6B3C', borderRadius: '3px', transition: 'width 0.3s ease' },
  card:    { backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '16px' },
  nextBtn: { width: '100%', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.2s', marginTop: '4px' },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', backgroundColor: '#F0FDF4', borderRadius: '10px', border: '1px solid #A7F3D0' },
  checkText: { fontSize: '13px', color: '#1A6B3C', lineHeight: '1.5' },
  fileNote: { padding: '12px 14px', border: '1.5px dashed #E0E0E0', borderRadius: '10px', fontSize: '13px', color: '#888', backgroundColor: '#FAFAFA' },
};
