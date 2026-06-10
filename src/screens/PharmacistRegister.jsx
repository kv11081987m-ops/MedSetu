import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';

const TOTAL_STEPS = 3;
const STEP_TITLES = ['Personal Jankari', 'Professional Jankari', 'Additional Info'];
const QUALIFICATIONS = ['B.Pharm', 'M.Pharm', 'D.Pharm', 'Other'];
const LANGUAGES = ['Hindi', 'English', 'Bhojpuri'];

const INITIAL_FORM = {
  naam: '', mobile: '', email: '', dob: '', gender: '',
  qualification: '', regNumber: '', regExpiry: '', experience: '', workplace: '',
  languages: [], timing: '', medicalCondition: '',
};

export default function PharmacistRegister() {
  const navigate = useNavigate();

  const [step,       setStep]       = useState(1);
  const [formData,   setFormData]   = useState(INITIAL_FORM);
  const [agreed,     setAgreed]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [errors,     setErrors]     = useState({});

  const set = (field) => (e) => {
    setFormData((p) => ({ ...p, [field]: e.target.value }));
    setErrors((p) => ({ ...p, [field]: '' }));
  };

  const toggleLanguage = (lang) => {
    setFormData((p) => ({
      ...p,
      languages: p.languages.includes(lang)
        ? p.languages.filter((l) => l !== lang)
        : [...p.languages, lang],
    }));
  };

  const validateStep = () => {
    const e = {};
    if (step === 1) {
      if (!formData.naam.trim())                                    e.naam   = 'Naam zaroori hai';
      if (!/^\d{10}$/.test(formData.mobile))                       e.mobile = '10-digit number daalo';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))     e.email  = 'Valid email daalo';
      if (!formData.dob)                                           e.dob    = 'Date of birth daalo';
      if (!formData.gender)                                        e.gender = 'Gender select karo';
    }
    if (step === 2) {
      if (!formData.qualification)        e.qualification = 'Qualification select karo';
      if (!formData.regNumber.trim())     e.regNumber     = 'Registration number zaroori hai';
      if (!formData.regExpiry)            e.regExpiry     = 'Expiry date daalo';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const nextStep = () => { if (validateStep()) setStep((s) => s + 1); };
  const prevStep = () => setStep((s) => s - 1);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.from('staff_whitelist').insert({
        email:       formData.email,
        role:        'pharmacist',
        name:        formData.naam,
        phone:       formData.mobile,
        is_approved: false,
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
            <h1 style={s.title}>Pharmacist Registration</h1>
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
          {step === 3 && (
            <Step3
              formData={formData} set={set} errors={errors}
              toggleLanguage={toggleLanguage} agreed={agreed} setAgreed={setAgreed}
            />
          )}

          <button
            style={{ ...s.nextBtn, opacity: (step === 3 && !agreed) || submitting ? 0.5 : 1 }}
            onClick={step === TOTAL_STEPS ? handleSubmit : nextStep}
            disabled={(step === 3 && !agreed) || submitting}
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
      <Field label="Poora Naam *" error={errors.naam}>
        <input style={inp} value={formData.naam} onChange={set('naam')} placeholder="Aapka poora naam" />
      </Field>
      <Field label="Mobile *" error={errors.mobile}>
        <input style={inp} type="tel" inputMode="numeric" maxLength={10} value={formData.mobile} onChange={set('mobile')} placeholder="10-digit mobile" />
      </Field>
      <Field label="Email ID *" error={errors.email}>
        <input style={inp} type="email" value={formData.email} onChange={set('email')} placeholder="aapka@email.com" />
      </Field>
      <Field label="Date of Birth *" error={errors.dob}>
        <input style={inp} type="date" value={formData.dob} onChange={set('dob')} />
      </Field>
      <Field label="Gender *" error={errors.gender}>
        <div style={{ display: 'flex', gap: '10px' }}>
          {['Male', 'Female', 'Other'].map((g) => (
            <button
              key={g} type="button"
              style={{ ...s.genderBtn, ...(formData.gender === g ? s.genderBtnActive : {}) }}
              onClick={() => set('gender')({ target: { value: g } })}
            >
              {g}
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

// ── Step 2 — Professional Info ────────────────────────────────
function Step2({ formData, set, errors }) {
  return (
    <>
      <Field label="Qualification *" error={errors.qualification}>
        <select style={inp} value={formData.qualification} onChange={set('qualification')}>
          <option value="">-- Select karo --</option>
          {['B.Pharm', 'M.Pharm', 'D.Pharm', 'Other'].map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </Field>
      <Field label="Registration Number *" error={errors.regNumber}>
        <input style={inp} value={formData.regNumber} onChange={set('regNumber')} placeholder="UP-PH-XXXX-XXXXX" />
      </Field>
      <Field label="Registration Expiry *" error={errors.regExpiry}>
        <input style={inp} type="date" value={formData.regExpiry} onChange={set('regExpiry')} />
      </Field>
      <Field label="Experience (Saal mein)" error={errors.experience}>
        <input style={inp} type="number" min="0" value={formData.experience} onChange={set('experience')} placeholder="0" />
      </Field>
      <Field label="Certificate Upload *" error={errors.cert}>
        <div style={s.fileNote}>📎 File upload — Supabase Storage baad mein connect hoga</div>
      </Field>
      <Field label="Current/Previous Workplace (optional)" error={errors.workplace}>
        <input style={inp} value={formData.workplace} onChange={set('workplace')} placeholder="Dukaan ya hospital ka naam" />
      </Field>
    </>
  );
}

// ── Step 3 — Additional Info ──────────────────────────────────
function Step3({ formData, set, errors, toggleLanguage, agreed, setAgreed }) {
  return (
    <>
      <Field label="Languages Known" error={errors.languages}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {['Hindi', 'English', 'Bhojpuri'].map((lang) => {
            const selected = formData.languages.includes(lang);
            return (
              <label key={lang} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px', color: selected ? '#1A6B3C' : '#555' }}>
                <input type="checkbox" checked={selected} onChange={() => toggleLanguage(lang)} style={{ accentColor: '#1A6B3C' }} />
                {lang}
              </label>
            );
          })}
        </div>
      </Field>
      <Field label="Available Timing" error={errors.timing}>
        <input style={inp} value={formData.timing} onChange={set('timing')} placeholder="9AM - 6PM" />
      </Field>
      <Field label="Koi Medical Condition jo kaam ko affect kare? (optional)" error={errors.medicalCondition}>
        <textarea style={{ ...inp, minHeight: '70px', resize: 'vertical' }} value={formData.medicalCondition} onChange={set('medicalCondition')} placeholder="Agar koi ho to likhiye..." />
      </Field>

      <label style={s.checkRow}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#1A6B3C', flexShrink: 0 }} />
        <span style={s.checkText}>
          Main confirm karta/karti hoon ki meri pharmacist registration valid hai aur di gayi jankari sahi hai.
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

// ── Helpers ───────────────────────────────────────────────────
function Field({ label, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '13px', fontWeight: '600', color: '#444' }}>{label}</label>
      {children}
      {error && <span style={{ fontSize: '12px', color: '#e53935' }}>{error}</span>}
    </div>
  );
}

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
  genderBtn:       { flex: 1, padding: '10px', border: '1.5px solid #E0E0E0', borderRadius: '8px', background: '#FAFAFA', fontSize: '14px', color: '#555', cursor: 'pointer', fontFamily: 'inherit' },
  genderBtnActive: { borderColor: '#1A6B3C', color: '#1A6B3C', backgroundColor: '#F0FDF4' },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', backgroundColor: '#F0FDF4', borderRadius: '10px', border: '1px solid #A7F3D0' },
  checkText: { fontSize: '13px', color: '#1A6B3C', lineHeight: '1.5' },
  fileNote: { padding: '12px 14px', border: '1.5px dashed #E0E0E0', borderRadius: '10px', fontSize: '13px', color: '#888', backgroundColor: '#FAFAFA' },
};
