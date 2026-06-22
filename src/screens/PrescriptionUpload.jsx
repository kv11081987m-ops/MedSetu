import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, HelpCircle, Info, Upload, Camera, Image,
  FileText, CheckCircle, X, AlertCircle, Stethoscope,
  Calendar, Home, Search, ShoppingBag, User, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

const NAV_TABS = [
  { id: 'home',    Icon: Home,        label: 'Home',   route: '/home' },
  { id: 'search',  Icon: Search,      label: 'Search', route: '/medicine-search' },
  { id: 'orders',  Icon: ShoppingBag, label: 'Orders', route: '/orders' },
  { id: 'profile', Icon: User,        label: 'Profile',route: '/profile' },
];

// ─── Success Screen ───────────────────────────────────────────
function SuccessScreen({ rxNumber, onTrack, onHome }) {
  return (
    <div style={s.successWrap}>
      <div style={s.successIconRing}>
        <CheckCircle size={64} color="#1A6B3C" />
      </div>
      <h2 style={s.successTitle}>Prescription Submit Ho Gaya!</h2>
      <div style={s.orderIdBox}>
        <span style={s.orderIdLabel}>Rx ID</span>
        <span style={s.orderId}>#{rxNumber}</span>
      </div>
      <p style={s.successMsg}>
        Hamare pharmacist{' '}
        <strong>30 min mein</strong> call karenge aur
        order confirm karenge.
      </p>
      <button style={s.trackBtn} onClick={onTrack}>
        <ShoppingBag size={16} color="#FFFFFF" />
        Order Track Karo
      </button>
      <button style={s.homeBtn} onClick={onHome}>
        <Home size={16} color="#1A6B3C" />
        Home Jaao
      </button>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function PrescriptionUpload() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [file, setFile]           = useState(null);
  const [preview, setPreview]     = useState(null);
  const [dragOver, setDragOver]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rxNumber, setRxNumber]   = useState('');
  const [activeTab, setActiveTab] = useState('');
  const [delivery, setDelivery]   = useState('home');
  const [selectedStore, setSelectedStore] = useState('');
  const [realStores, setRealStores] = useState([]);
  const [form, setForm]           = useState({ doctor: '', date: '', medicines: '' });

  // ── Fetch real stores ──────────────────────────────────────
  useEffect(() => {
    supabase
      .from('sellers')
      .select('id, store_name, address')
      .eq('seller_type', 'retailer')
      .limit(10)
      .then(({ data }) => { if (data) setRealStores(data); });
  }, []);

  // ── File handling ──────────────────────────────────────────
  const processFile = (f) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      alert('File 5MB se badi hai — chhoti file upload karo');
      return;
    }
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowed.includes(f.type)) {
      alert('Sirf JPG, PNG, PDF allowed hai');
      return;
    }
    setFile(f);
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  };

  const handleFileInput = (e) => processFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };
  const removeFile = () => { setFile(null); setPreview(null); };
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Submit handler ─────────────────────────────────────────
  const handleSubmit = async () => {
    if (!file) { alert('Pehle prescription file select karo'); return; }
    setSubmitting(true);
    try {
      const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
      const storeId = realStores.find((st) => st.store_name === selectedStore)?.id || null;

      // Upload file to Supabase Storage
      let imageUrl = file.name;
      const fileExt = file.name.split('.').pop();
      const filePath = `${user?.id || 'anonymous'}/rx_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('prescriptions')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) {
        console.warn('Storage upload failed:', uploadError.message);
        // Storage bucket not set up yet — save filename only
      } else {
        const { data: urlData } = supabase.storage
          .from('prescriptions')
          .getPublicUrl(filePath);
        imageUrl = urlData.publicUrl;
      }

      const { data, error } = await supabase
        .from('prescriptions')
        .insert({
          customer_id:       user?.id            || null,
          seller_id:         storeId,
          doctor_name:       form.doctor         || null,
          prescription_date: form.date           || null,
          notes:             form.medicines      || null,
          status:            'pending',
          image_url:         imageUrl,
          delivery_type:     delivery,
        })
        .select()
        .maybeSingle();

      if (error) throw error;

      const rx = 'RX-' + (data?.id ? String(data.id).slice(0, 8).toUpperCase() : Date.now());
      setRxNumber(rx);
      setSubmitted(true);
    } catch (err) {
      alert('Submit nahi hua: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={s.wrapper}>
        <div style={s.screen}>
          <div style={s.header}>
            <button style={s.iconBtn} onClick={() => navigate('/home')}>
              <ArrowLeft size={22} color="#1A1A1A" />
            </button>
            <span style={s.headerTitle}>Prescription Upload</span>
            <div style={{ width: 34 }} />
          </div>
          <SuccessScreen
            rxNumber={rxNumber}
            onTrack={() => navigate('/orders')}
            onHome={() => navigate('/home')}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Prescription Upload</span>
          <button style={s.iconBtn}>
            <HelpCircle size={20} color="#1A6B3C" />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Info Banner */}
          <div style={s.infoBanner}>
            <Info size={16} color="#1565C0" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={s.infoText}>
              Prescription upload karne ke baad hamare pharmacist verify karenge
              aur order confirm karenge.
            </p>
          </div>

          {/* Upload Card */}
          <div style={s.card}>

            {!file ? (
              <div
                style={{
                  ...s.uploadBox,
                  borderColor: dragOver ? '#1A6B3C' : '#4CAF50',
                  backgroundColor: dragOver ? '#D0EED8' : '#E8F5E9',
                  transform: dragOver ? 'scale(1.01)' : 'scale(1)',
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Upload size={52} color="#1A6B3C" strokeWidth={1.5} />
                <p style={s.uploadTitle}>Prescription Upload Karo</p>
                <p style={s.uploadSub}>Ya yahan drag karke chhodein</p>
                <p style={s.uploadFormats}>JPG, PNG, PDF • Max 5MB</p>
              </div>
            ) : (
              <div style={s.previewBox}>
                {preview ? (
                  <img src={preview} alt="prescription" style={s.previewImg} />
                ) : (
                  <div style={s.pdfThumb}>
                    <FileText size={32} color="#EA6C00" />
                  </div>
                )}
                <div style={s.previewInfo}>
                  <CheckCircle size={18} color="#1A6B3C" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={s.previewName}>{file.name}</p>
                    <p style={s.previewSize}>{formatSize(file.size)}</p>
                  </div>
                </div>
                <div style={s.previewActions}>
                  <button style={s.removeLink} onClick={removeFile}>
                    <X size={12} color="#EF4444" /> Hataao
                  </button>
                  <button style={s.reuploadLink} onClick={() => fileInputRef.current?.click()}>
                    Dobara Upload
                  </button>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />

            <div style={s.optionRow}>
              <button style={{ ...s.optBtn, borderColor: '#1A6B3C' }}
                onClick={() => fileInputRef.current?.click()}>
                <Camera size={18} color="#1A6B3C" />
                <span style={{ ...s.optLabel, color: '#1A6B3C' }}>Camera Se</span>
              </button>
              <button style={{ ...s.optBtn, borderColor: '#2563EB' }}
                onClick={() => fileInputRef.current?.click()}>
                <Image size={18} color="#2563EB" />
                <span style={{ ...s.optLabel, color: '#2563EB' }}>Gallery Se</span>
              </button>
              <button style={{ ...s.optBtn, borderColor: '#EA6C00' }}
                onClick={() => fileInputRef.current?.click()}>
                <FileText size={18} color="#EA6C00" />
                <span style={{ ...s.optLabel, color: '#EA6C00' }}>PDF Upload</span>
              </button>
            </div>
          </div>

          {/* Form Card */}
          <div style={s.card}>
            <p style={s.cardTitle}>Thodi Aur Jankari</p>

            <div style={s.fieldWrap}>
              <label style={s.label}>
                Doctor Ka Naam <span style={s.optional}>(optional)</span>
              </label>
              <input
                style={s.input}
                placeholder="Dr. Sharma"
                value={form.doctor}
                onChange={(e) => setForm({ ...form, doctor: e.target.value })}
              />
            </div>

            <div style={s.fieldWrap}>
              <label style={s.label}>Date of Prescription</label>
              <div style={s.inputIcon}>
                <input
                  style={{ ...s.input, paddingRight: '40px' }}
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
                <Calendar size={16} color="#888888" style={s.inputIconRight} />
              </div>
            </div>

            <div style={s.fieldWrap}>
              <label style={s.label}>
                Kaunsi Medicines Chahiye?{' '}
                <span style={s.optional}>(optional)</span>
              </label>
              <textarea
                style={s.textarea}
                rows={3}
                placeholder="Prescription mein likhi medicines yahan likhein..."
                value={form.medicines}
                onChange={(e) => setForm({ ...form, medicines: e.target.value })}
              />
            </div>

            <div style={s.fieldWrap}>
              <label style={s.label}>Delivery Type</label>
              <div style={s.radioGroup}>
                {[
                  { val: 'home',   label: 'Home Delivery' },
                  { val: 'pickup', label: 'Store Pickup' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    style={{
                      ...s.radioBtn,
                      borderColor: delivery === val ? '#1A6B3C' : '#E0E0E0',
                      backgroundColor: delivery === val ? '#E8F5EE' : '#FFFFFF',
                    }}
                    onClick={() => setDelivery(val)}
                  >
                    <div style={{ ...s.radioCircle, borderColor: delivery === val ? '#1A6B3C' : '#CCCCCC' }}>
                      {delivery === val && <div style={s.radioDot} />}
                    </div>
                    <span style={{ ...s.radioLabel, color: delivery === val ? '#1A6B3C' : '#444444', fontWeight: delivery === val ? '600' : '400' }}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Preferred Store — real DB stores */}
            <div style={s.fieldWrap}>
              <label style={s.label}>Preferred Store</label>
              <select
                style={s.select}
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
              >
                <option value="">Koi bhi (Auto assign)</option>
                {realStores.map((st) => (
                  <option key={st.id} value={st.store_name}>
                    {st.store_name}{st.address ? ` — ${st.address}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Pharmacist Note */}
          <div style={s.pharmacistCard}>
            <div style={s.pharmacistHead}>
              <Stethoscope size={18} color="#EA6C00" />
              <span style={s.pharmacistTitle}>Hamare Pharmacist Karenge:</span>
            </div>
            <div style={s.checkList}>
              {[
                'Prescription verify karenge',
                'Medicines check karenge',
                'Call karke confirm karenge',
                'Order place karenge',
              ].map((item) => (
                <div key={item} style={s.checkRow}>
                  <div style={s.checkIcon}>
                    <Check size={10} color="#FFFFFF" strokeWidth={3} />
                  </div>
                  <span style={s.checkText}>{item}</span>
                </div>
              ))}
            </div>
            <p style={s.callbackNote}>⏱ Usually 30 min mein callback aata hai</p>
          </div>

          {/* Important Rules */}
          <div style={s.rulesCard}>
            <div style={s.rulesHead}>
              <AlertCircle size={16} color="#D32F2F" />
              <span style={s.rulesTitle}>Yaad Rakhein:</span>
            </div>
            <div style={s.rulesList}>
              {[
                'Sirf valid doctor prescription accept hogi',
                'Prescription 6 mahine se purani na ho',
                'Schedule H/X medicines ke liye original prescription zaroori',
              ].map((rule) => (
                <div key={rule} style={s.ruleRow}>
                  <span style={s.ruleBullet}>•</span>
                  <span style={s.ruleText}>{rule}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            style={{
              ...s.submitBtn,
              opacity: (file && !submitting) ? 1 : 0.45,
              cursor: (file && !submitting) ? 'pointer' : 'not-allowed',
            }}
            onClick={handleSubmit}
            disabled={!file || submitting}
          >
            <Upload size={18} color="#FFFFFF" />
            {submitting ? 'Submit Ho Raha Hai...' : 'Prescription Submit Karo'}
          </button>

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, route }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                style={s.navTab}
                onClick={() => { setActiveTab(id); navigate(route); }}
              >
                <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'} strokeWidth={isActive ? 2.5 : 1.8} />
                <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA', fontWeight: isActive ? '600' : '400' }}>
                  {label}
                </span>
                {isActive && <span style={s.navDot} />}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 12px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  headerTitle: { fontSize: '16px', fontWeight: '700', color: '#1A1A1A' },
  iconBtn: { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },

  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px', paddingBottom: 0 },

  infoBanner: { display: 'flex', gap: '10px', alignItems: 'flex-start', backgroundColor: '#E3F2FD', borderRadius: '12px', padding: '12px 14px' },
  infoText:   { fontSize: '13px', color: '#1565C0', lineHeight: '1.5', margin: 0 },

  card:      { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '14px' },
  cardTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },

  uploadBox:   { border: '2px dashed', borderRadius: '14px', padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.2s ease', userSelect: 'none' },
  uploadTitle: { fontSize: '15px', fontWeight: '700', color: '#1A6B3C', margin: '4px 0 0' },
  uploadSub:   { fontSize: '13px', color: '#666666', margin: 0 },
  uploadFormats:{ fontSize: '11px', color: '#AAAAAA', margin: 0, marginTop: '2px' },

  previewBox:     { border: '1.5px solid #E8F5EE', borderRadius: '12px', overflow: 'hidden', backgroundColor: '#FAFFF9' },
  previewImg:     { width: '100%', maxHeight: '160px', objectFit: 'cover', display: 'block' },
  pdfThumb:       { height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF3E8' },
  previewInfo:    { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderTop: '1px solid #F0F0F0' },
  previewName:    { fontSize: '13px', fontWeight: '600', color: '#1A1A1A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  previewSize:    { fontSize: '11px', color: '#888888', margin: 0 },
  previewActions: { display: 'flex', gap: '16px', padding: '6px 14px 12px' },
  removeLink:     { background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: '600', color: '#EF4444', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
  reuploadLink:   { background: 'none', border: 'none', fontSize: '12px', color: '#888888', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },

  optionRow: { display: 'flex', gap: '8px' },
  optBtn:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 8px', backgroundColor: '#FFFFFF', border: '1.5px solid', borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit' },
  optLabel:  { fontSize: '11px', fontWeight: '600' },

  fieldWrap: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label:     { fontSize: '13px', fontWeight: '600', color: '#333333' },
  optional:  { fontWeight: '400', color: '#AAAAAA', fontSize: '12px' },
  input:     { width: '100%', padding: '11px 14px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FFFFFF', boxSizing: 'border-box' },
  inputIcon:      { position: 'relative' },
  inputIconRight: { position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' },
  textarea:  { width: '100%', padding: '11px 14px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', resize: 'none', lineHeight: '1.5', boxSizing: 'border-box' },
  radioGroup:{ display: 'flex', gap: '10px' },
  radioBtn:  { flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 12px', border: '1.5px solid', borderRadius: '10px', cursor: 'pointer', background: 'none', fontFamily: 'inherit', transition: 'all 0.15s ease' },
  radioCircle:{ width: '18px', height: '18px', borderRadius: '50%', border: '2px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  radioDot:  { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1A6B3C' },
  radioLabel:{ fontSize: '13px' },
  select:    { width: '100%', padding: '11px 14px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FFFFFF', cursor: 'pointer', appearance: 'auto' },

  pharmacistCard:  { backgroundColor: '#FFF3E0', borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid #FFE0B2' },
  pharmacistHead:  { display: 'flex', alignItems: 'center', gap: '8px' },
  pharmacistTitle: { fontSize: '14px', fontWeight: '700', color: '#E65100' },
  checkList:   { display: 'flex', flexDirection: 'column', gap: '8px' },
  checkRow:    { display: 'flex', alignItems: 'center', gap: '10px' },
  checkIcon:   { width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkText:   { fontSize: '13px', color: '#5D4037' },
  callbackNote:{ fontSize: '12px', color: '#EA6C00', fontWeight: '600', margin: 0, paddingTop: '4px', borderTop: '1px solid #FFD180' },

  rulesCard:  { backgroundColor: '#FFEBEE', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid #FFCDD2' },
  rulesHead:  { display: 'flex', alignItems: 'center', gap: '8px' },
  rulesTitle: { fontSize: '14px', fontWeight: '700', color: '#C62828' },
  rulesList:  { display: 'flex', flexDirection: 'column', gap: '6px' },
  ruleRow:    { display: 'flex', gap: '8px', alignItems: 'flex-start' },
  ruleBullet: { color: '#D32F2F', fontWeight: '700', fontSize: '14px', flexShrink: 0, lineHeight: '1.5' },
  ruleText:   { fontSize: '13px', color: '#B71C1C', lineHeight: '1.5' },

  submitBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '16px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700', fontFamily: 'inherit', transition: 'opacity 0.2s ease' },

  successWrap:     { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: '16px', backgroundColor: '#F5F5F5' },
  successIconRing: { width: '120px', height: '120px', borderRadius: '60px', backgroundColor: '#E8F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' },
  successTitle:    { fontSize: '22px', fontWeight: '800', color: '#1A1A1A', textAlign: 'center', margin: 0 },
  orderIdBox:      { backgroundColor: '#FFFFFF', border: '1.5px dashed #1A6B3C', borderRadius: '10px', padding: '10px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' },
  orderIdLabel:    { fontSize: '11px', color: '#888888', textTransform: 'uppercase', letterSpacing: '0.5px' },
  orderId:         { fontSize: '18px', fontWeight: '800', color: '#1A6B3C' },
  successMsg:      { fontSize: '14px', color: '#555555', textAlign: 'center', lineHeight: '1.6', margin: 0 },
  trackBtn:        { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', marginTop: '8px' },
  homeBtn:         { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '15px', backgroundColor: '#FFFFFF', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  bottomNav: { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' },
  navTab:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', position: 'relative', fontFamily: 'inherit' },
  navLabel:  { fontSize: '10px' },
  navDot:    { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
};
