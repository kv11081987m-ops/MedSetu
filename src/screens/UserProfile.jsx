import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Pencil, Camera, User, Phone, Mail,
  Home, Briefcase, Heart, AlertCircle, Activity,
  FileText, ChevronRight, Trash2, LogOut, Bell, Shield,
  HelpCircle, Star, Plus, Pill, MapPin,
} from 'lucide-react';

// ─── Data ─────────────────────────────────────────────────────

const SETTINGS_ROWS = [
  { Icon: Bell,       label: 'Notifications',      sub: 'Order updates, offers',    color: '#E65100', bg: '#FFF3E0' },
  { Icon: Shield,     label: 'Privacy & Security',  sub: 'Password, data',          color: '#2563EB', bg: '#EAF2FF' },
  { Icon: Star,       label: 'Rate App',            sub: 'Humein 5★ do!',           color: '#F59E0B', bg: '#FFFBEB' },
  { Icon: HelpCircle, label: 'Help & Support',      sub: 'FAQ, contact us',         color: '#7C3AED', bg: '#F3EEFF' },
];

// ─── Main Screen ──────────────────────────────────────────────
export default function UserProfile() {
  const navigate  = useNavigate();
  const { handleLogout: authLogout, devSession } = useAuth();

  const [userData,       setUserData]       = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [editMode,       setEditMode]       = useState(false);
  const [showLogout,     setShowLogout]     = useState(false);
  const [addresses,      setAddresses]      = useState([]);
  const [showAddAddress,  setShowAddAddress]  = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [newAddress,      setNewAddress]      = useState({
    label: 'Ghar', address_line: '', city: 'Deoria',
    district: 'Deoria', state: 'Uttar Pradesh', pincode: '',
  });
  const [orderStats,     setOrderStats]     = useState({ totalOrders: 0, totalSpent: 0 });
  const [prescriptions,  setPrescriptions]  = useState([]);

  // ── Fetch user ───────────────────────────────────────────────
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const stored = localStorage.getItem('medsetu_user');
        if (!stored) {
          if (devSession?.phone) {
            setUserData({ name: 'Demo User', phone: devSession.phone, email: '', blood_group: '' });
          }
          setLoading(false);
          return;
        }
        const localUser = JSON.parse(stored);
        const { data, error } = await supabase
          .from('users').select('*').eq('id', localUser.id).maybeSingle();
        if (!error && data) setUserData(data);
        else setUserData(localUser);
      } catch {
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };
    const fetchAddresses = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
        if (!user?.id) return;
        const { data } = await supabase
          .from('addresses')
          .select('*')
          .eq('user_id', user.id)
          .order('is_default', { ascending: false });
        if (data) setAddresses(data);
      } catch {}
    };
    const fetchOrderStats = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
        if (!user?.id) return;
        const { data } = await supabase
          .from('orders')
          .select('final_amount, status')
          .eq('customer_id', user.id);
        if (data) {
          const notCancelled = data.filter((o) => o.status !== 'cancelled');
          setOrderStats({
            totalOrders: data.length,
            totalSpent: notCancelled.reduce((sum, o) => sum + (parseFloat(o.final_amount) || 0), 0),
          });
        }
      } catch {}
    };
    const fetchPrescriptions = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
        if (!user?.id) return;
        const { data } = await supabase
          .from('prescriptions')
          .select('id, doctor_name, hospital_name, prescribed_date, review_notes, image_url')
          .eq('customer_id', user.id)
          .order('prescribed_date', { ascending: false })
          .limit(5);
        if (data) setPrescriptions(data);
      } catch {}
    };
    fetchUserProfile();
    fetchAddresses();
    fetchOrderStats();
    fetchPrescriptions();
  }, []);

  // ── Profile update ───────────────────────────────────────────
  const updateProfile = async () => {
    if (!userData) return;
    const { error } = await supabase
      .from('users')
      .update({ name: userData.name, email: userData.email, blood_group: userData.blood_group })
      .eq('id', userData.id);
    if (!error) {
      localStorage.setItem('medsetu_user', JSON.stringify(userData));
      setEditMode(false);
      alert('Profile update ho gaya!');
    } else {
      alert('Update nahi hua — dobara try karo');
    }
  };

  const setField = (field) => (e) =>
    setUserData((prev) => ({ ...prev, [field]: e.target.value }));

  // ── Logout ───────────────────────────────────────────────────
  const handleLogout = async () => {
    setShowLogout(false);
    localStorage.removeItem('medsetu_user');
    localStorage.removeItem('medsetu_role');
    await authLogout();
    navigate('/login', { replace: true });
  };

  const deleteAddress = async (addressId) => {
    if (!window.confirm('Address delete karna chahte hain?')) return;
    const { error } = await supabase.from('addresses').delete().eq('id', addressId);
    if (!error) setAddresses((prev) => prev.filter((a) => a.id !== addressId));
  };

  const addAddress = async () => {
    if (!newAddress.address_line.trim()) { alert('Address daalo'); return; }
    try {
      const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
      const resetForm = () => {
        setShowAddAddress(false);
        setEditingAddressId(null);
        setNewAddress({ label: 'Ghar', address_line: '', city: 'Deoria', district: 'Deoria', state: 'Uttar Pradesh', pincode: '' });
      };
      if (editingAddressId) {
        const { error } = await supabase
          .from('addresses')
          .update({ label: newAddress.label, address_line: newAddress.address_line, city: newAddress.city, district: newAddress.district, state: newAddress.state, pincode: newAddress.pincode })
          .eq('id', editingAddressId);
        if (!error) {
          setAddresses((prev) => prev.map((a) => a.id === editingAddressId ? { ...a, ...newAddress } : a));
          resetForm();
        }
      } else {
        const { data, error } = await supabase
          .from('addresses')
          .insert({ user_id: user.id, ...newAddress, is_default: addresses.length === 0 })
          .select();
        if (!error && data) {
          setAddresses((prev) => [...prev, data[0]]);
          resetForm();
        }
      }
    } catch (err) { alert('Save nahi hua: ' + err.message); }
  };

  // ── Loading / null states ────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' }}>
        <p style={{ color: '#888888', fontSize: '14px' }}>Profile load ho rahi hai...</p>
      </div>
    );
  }
  if (!userData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', backgroundColor: '#F5F5F5' }}>
        <p style={{ fontSize: '15px', color: '#888888' }}>User data nahi mila</p>
        <button onClick={() => navigate('/login')} style={{ padding: '12px 28px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}>
          Login Karo
        </button>
      </div>
    );
  }

  const initials = (userData.name || 'U').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <p style={s.headerTitle}>Mera Profile</p>
          <button style={s.iconBtn} onClick={() => setEditMode((v) => !v)}>
            <Pencil size={20} color={editMode ? '#1A6B3C' : '#1A1A1A'} />
          </button>
        </div>

        <div style={s.body}>

          {/* ── Hero Card ── */}
          <div style={s.hero}>
            {/* Avatar */}
            <div style={s.avatarWrap}>
              <div style={s.avatarCircle}>
                <span style={s.avatarInitials}>{initials}</span>
              </div>
              <button style={s.cameraBtn}>
                <Camera size={13} color="#FFFFFF" />
              </button>
            </div>

            <p style={s.heroName}>{userData.name || 'User'}</p>
            <p style={s.heroPhone}>{userData.phone ? `+91 ${userData.phone}` : '—'}</p>
            <p style={s.heroCity}>{userData.city || 'Deoria, Uttar Pradesh'}</p>
            <p style={s.heroMember}>
              {userData.created_at
                ? `Member since ${new Date(userData.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
                : 'Member since —'}
            </p>

            {/* Quick Stats */}
            <div style={s.statsRow}>
              {[
                { val: String(orderStats.totalOrders), label: 'Orders' },
                { val: '₹' + orderStats.totalSpent.toLocaleString('en-IN', { maximumFractionDigits: 0 }), label: 'Spent' },
                { val: String(addresses.length), label: 'Addresses' },
              ].map(({ val, label }) => (
                <div key={label} style={s.statPill}>
                  <span style={s.statVal}>{val}</span>
                  <span style={s.statLabel}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Personal Info ── */}
          <div style={s.card}>
            <div style={s.cardHead}>
              <p style={s.cardTitle}>Personal Jankari</p>
              <button style={s.editLink} onClick={() => editMode ? updateProfile() : setEditMode(true)}>
                {editMode ? 'Save Karo' : 'Edit Karo'}
              </button>
            </div>

            {/* Naam */}
            <div style={s.infoRow}>
              <div style={s.infoIconBox}><User size={15} color="#1A6B3C" /></div>
              <div style={s.infoText}>
                <p style={s.infoLabel}>Naam</p>
                {editMode
                  ? <input value={userData.name || ''} onChange={setField('name')} style={s.infoInput} placeholder="Apna naam daalo" />
                  : <p style={s.infoVal}>{userData.name || '—'}</p>}
              </div>
            </div>

            {/* Mobile (read-only) */}
            <div style={s.infoRow}>
              <div style={s.infoIconBox}><Phone size={15} color="#1A6B3C" /></div>
              <div style={s.infoText}>
                <p style={s.infoLabel}>Mobile</p>
                <p style={s.infoVal}>{userData.phone ? `+91 ${userData.phone}` : '—'}</p>
              </div>
            </div>

            {/* Email */}
            <div style={s.infoRow}>
              <div style={s.infoIconBox}><Mail size={15} color="#1A6B3C" /></div>
              <div style={s.infoText}>
                <p style={s.infoLabel}>Email</p>
                {editMode
                  ? <input value={userData.email || ''} onChange={setField('email')} style={s.infoInput} placeholder="Email daalo" type="email" />
                  : <p style={s.infoVal}>{userData.email || '—'}</p>}
              </div>
            </div>

            {/* Blood Group */}
            <div style={s.infoRow}>
              <div style={s.infoIconBox}><Heart size={15} color="#1A6B3C" /></div>
              <div style={s.infoText}>
                <p style={s.infoLabel}>Blood Group</p>
                {editMode
                  ? <input value={userData.blood_group || ''} onChange={setField('blood_group')} style={s.infoInput} placeholder="e.g. B+" />
                  : <p style={s.infoVal}>{userData.blood_group || '—'}</p>}
              </div>
            </div>

            {editMode && (
              <button style={{ padding: '10px', backgroundColor: '#F5F5F5', color: '#555555', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setEditMode(false)}>
                Cancel
              </button>
            )}
          </div>

          {/* ── Saved Addresses ── */}
          <div style={s.card}>
            <div style={s.cardHead}>
              <p style={s.cardTitle}>Mere Addresses</p>
              <button style={s.greenBtn} onClick={() => setShowAddAddress(true)}>
                <Plus size={13} color="#FFFFFF" />
                Naya Add
              </button>
            </div>

            {addresses.length === 0 ? (
              <p style={{ color: '#666666', textAlign: 'center', fontSize: '13px', margin: '8px 0' }}>
                Koi address nahi — pehla address add karo
              </p>
            ) : (
              addresses.map((addr) => {
                const LABEL_STYLES = {
                  Ghar:   { Icon: Home,      color: '#1A6B3C', bg: '#E8F5EE' },
                  Office: { Icon: Briefcase, color: '#2563EB', bg: '#EAF2FF' },
                };
                const { Icon: AddrIcon, color: ac, bg: abg } = LABEL_STYLES[addr.label] || { Icon: MapPin, color: '#EA6C00', bg: '#FFF3E8' };
                return (
                  <div key={addr.id} style={s.addrCard}>
                    <div style={{ ...s.addrIconBox, backgroundColor: abg }}>
                      <AddrIcon size={17} color={ac} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={s.addrBadgeRow}>
                        <span style={{ ...s.typeBadge, color: ac, backgroundColor: abg }}>{addr.label}</span>
                        {addr.is_default && <span style={s.defaultBadge}>Default</span>}
                      </div>
                      <p style={s.addrLine1}>{addr.address_line}</p>
                      <p style={s.addrLine2}>{addr.city} — {addr.pincode}</p>
                    </div>
                    <div style={s.addrActions}>
                      <button style={s.addrIconBtn} onClick={() => {
                        setEditingAddressId(addr.id);
                        setNewAddress({ label: addr.label, address_line: addr.address_line, city: addr.city, district: addr.district, state: addr.state, pincode: addr.pincode || '' });
                        setShowAddAddress(true);
                      }}><Pencil size={14} color="#888888" /></button>
                      <button style={s.addrIconBtn} onClick={() => deleteAddress(addr.id)}>
                        <Trash2 size={14} color="#DC3545" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            <button style={s.dashedAddBtn} onClick={() => setShowAddAddress(true)}>
              <Plus size={16} color="#1A6B3C" />
              Naya Address Add Karo
            </button>
          </div>

          {/* ── Health Profile ── */}
          <div style={{ ...s.card, backgroundColor: '#F9F9F9' }}>
            <div style={s.cardHead}>
              <div>
                <p style={s.cardTitle}>Health Profile</p>
                <p style={s.cardTitleSub}>(Optional)</p>
              </div>
              <button style={s.editLink} onClick={() => alert('Yeh feature jald aayega!')}>Edit</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px 0' }}>
              <Activity size={32} color="#CCCCCC" />
              <p style={{ fontSize: '14px', fontWeight: '600', color: '#888888', margin: 0 }}>Health Profile — Coming Soon</p>
              <p style={{ fontSize: '12px', color: '#AAAAAA', margin: 0, textAlign: 'center' }}>Apni allergies, blood group aur regular medicines yahan save kar sakenge</p>
            </div>
          </div>

          {/* ── Saved Prescriptions ── */}
          <div style={s.card}>
            <div style={s.cardHead}>
              <p style={s.cardTitle}>Saved Prescriptions</p>
              <button style={s.editLink} onClick={() => navigate('/orders')}>
                Sab Dekho
              </button>
            </div>
            {prescriptions.length === 0 ? (
              <p style={{ color: '#888888', fontSize: '13px', textAlign: 'center', margin: '8px 0' }}>
                Koi prescription nahi mili — Upload karo
              </p>
            ) : (
              prescriptions.map((rx) => (
                <div key={rx.id} style={s.rxRow}>
                  <div style={s.rxIconBox}>
                    <FileText size={18} color="#1A6B3C" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={s.rxDoctor}>{rx.doctor_name || 'Doctor'}</p>
                    <p style={s.rxHosp}>{rx.hospital_name || '—'}</p>
                    <div style={s.rxMeta}>
                      <span style={s.rxDate}>
                        {rx.prescribed_date
                          ? new Date(rx.prescribed_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </span>
                      {rx.review_notes && <span style={s.rxMeds}>{rx.review_notes}</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} color="#CCCCCC" />
                </div>
              ))
            )}
            <button style={s.dashedAddBtn} onClick={() => navigate('/prescription')}>
              <Plus size={16} color="#1A6B3C" />
              Naya Prescription Upload Karo
            </button>
          </div>

          {/* ── App Settings ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Settings</p>
            {SETTINGS_ROWS.map(({ Icon, label, sub, color, bg }) => (
              <button key={label} style={s.settingRow}>
                <div style={{ ...s.settingIconBox, backgroundColor: bg }}>
                  <Icon size={17} color={color} />
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <p style={s.settingLabel}>{label}</p>
                  <p style={s.settingSub}>{sub}</p>
                </div>
                <ChevronRight size={16} color="#CCCCCC" />
              </button>
            ))}
          </div>

          {/* ── Logout ── */}
          <button style={s.logoutBtn} onClick={() => setShowLogout(true)}>
            <LogOut size={18} color="#DC3545" />
            Logout
          </button>

          <p style={s.version}>MedSetu v1.0.0 · Made with ❤️ in India</p>

          <div style={{ height: '24px' }} />
        </div>

        {/* ── Add Address Sheet ── */}
        {showAddAddress && (
          <>
            <div style={{ ...s.overlay, zIndex: 59 }} onClick={() => { setShowAddAddress(false); setEditingAddressId(null); }} />
            <div style={{ ...s.modal, zIndex: 60, position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px' }}>
              <div style={s.modalHandle} />
              <p style={s.modalTitle}>{editingAddressId ? 'Address Edit Karo' : 'Naya Address Add Karo'}</p>

              {/* Label */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                {['Ghar', 'Office', 'Other'].map((lbl) => (
                  <button
                    key={lbl}
                    style={{
                      flex: 1, padding: '8px',
                      border: newAddress.label === lbl ? '1.5px solid #1A6B3C' : '1.5px solid #E0E0E0',
                      backgroundColor: newAddress.label === lbl ? '#E8F5EE' : '#FFFFFF',
                      color: newAddress.label === lbl ? '#1A6B3C' : '#888888',
                      borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                    onClick={() => setNewAddress((p) => ({ ...p, label: lbl }))}
                  >{lbl}</button>
                ))}
              </div>

              {/* Address Line */}
              <textarea
                style={{ ...s.infoInput, resize: 'none', lineHeight: '1.5', padding: '10px 12px' }}
                rows={3}
                placeholder="Gali, Mohalla, Landmark..."
                value={newAddress.address_line}
                onChange={(e) => setNewAddress((p) => ({ ...p, address_line: e.target.value }))}
              />

              {/* Pincode */}
              <input
                style={s.infoInput}
                placeholder="Pincode (6 digits)"
                maxLength={6}
                value={newAddress.pincode}
                onChange={(e) => setNewAddress((p) => ({ ...p, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
              />

              <button style={s.modalPrimary} onClick={addAddress}>Save Karo</button>
              <button style={s.modalSecondary} onClick={() => { setShowAddAddress(false); setEditingAddressId(null); }}>Cancel</button>
            </div>
          </>
        )}

        {/* ── Logout Confirm Modal ── */}
        {showLogout && (
          <div style={s.overlay} onClick={() => setShowLogout(false)}>
            <div style={s.modal} onClick={(e) => e.stopPropagation()}>
              <div style={s.modalHandle} />
              <p style={s.modalTitle}>Logout Karna Chahte Ho?</p>
              <p style={s.modalSub}>Aapko dobara login karna padega.</p>
              <button
                style={s.modalPrimary}
                onClick={handleLogout}
              >
                <LogOut size={16} color="#FFFFFF" />
                Haan, Logout Karo
              </button>
              <button style={s.modalSecondary} onClick={() => setShowLogout(false)}>
                Wapas Jao
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', backgroundColor: '#F5F5F5', display: 'flex', flexDirection: 'column', minHeight: '100vh' },

  // Header
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px', backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10,
  },
  headerTitle: { fontSize: '17px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  iconBtn: { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex' },

  // Body
  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 0 12px' },

  // Hero
  hero: {
    background: 'linear-gradient(160deg, #1A6B3C 0%, #2D9B5A 100%)',
    padding: '28px 20px 24px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
  },
  avatarWrap: { position: 'relative', marginBottom: '8px' },
  avatarCircle: {
    width: '80px', height: '80px', borderRadius: '40px',
    backgroundColor: 'rgba(255,255,255,0.25)',
    border: '3px solid #FFFFFF',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: '26px', fontWeight: '800', color: '#FFFFFF' },
  cameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: '26px', height: '26px', borderRadius: '13px',
    backgroundColor: '#1A6B3C', border: '2px solid #FFFFFF',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  heroName:   { fontSize: '20px', fontWeight: '800', color: '#FFFFFF', margin: 0 },
  heroPhone:  { fontSize: '14px', color: 'rgba(255,255,255,0.85)', margin: 0 },
  heroCity:   { fontSize: '12px', color: 'rgba(255,255,255,0.75)', margin: 0 },
  heroMember: { fontSize: '12px', color: 'rgba(255,255,255,0.6)',  margin: 0 },
  statsRow: { display: 'flex', gap: '10px', marginTop: '10px' },
  statPill: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: '20px',
    padding: '8px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
  },
  statVal:   { fontSize: '15px', fontWeight: '800', color: '#FFFFFF' },
  statLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.75)', fontWeight: '500' },

  // White card
  card: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)', margin: '0 12px',
    display: 'flex', flexDirection: 'column', gap: '12px',
  },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  cardTitleSub: { fontSize: '12px', color: '#888888', margin: '1px 0 0', fontWeight: '400' },
  editLink: {
    background: 'none', border: 'none', color: '#1A6B3C',
    fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', padding: 0,
  },
  greenBtn: {
    display: 'flex', alignItems: 'center', gap: '5px',
    padding: '6px 12px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '20px', fontSize: '12px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Info rows
  infoRow:    { display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '10px', borderBottom: '1px solid #F5F5F5' },
  infoIconBox: {
    width: '34px', height: '34px', borderRadius: '10px',
    backgroundColor: '#E8F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  infoText:  { flex: 1 },
  infoLabel: { fontSize: '11px', color: '#888888', fontWeight: '600', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.3px' },
  infoVal:   { fontSize: '14px', color: '#1A1A1A', fontWeight: '600', margin: 0 },
  infoInput: {
    width: '100%', border: '1.5px solid #1A6B3C', borderRadius: '8px',
    padding: '6px 10px', fontSize: '14px', color: '#1A1A1A',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  },

  // Address card
  addrCard: {
    display: 'flex', alignItems: 'flex-start', gap: '12px',
    padding: '12px', backgroundColor: '#F9F9F9', borderRadius: '12px',
  },
  addrIconBox: { width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  addrBadgeRow: { display: 'flex', gap: '6px', marginBottom: '5px' },
  typeBadge:    { fontSize: '11px', fontWeight: '700', padding: '2px 9px', borderRadius: '20px' },
  defaultBadge: { fontSize: '11px', fontWeight: '600', color: '#555555', backgroundColor: '#EEEEEE', padding: '2px 9px', borderRadius: '20px' },
  addrLine1:    { fontSize: '13px', color: '#1A1A1A', fontWeight: '600', margin: 0 },
  addrLine2:    { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  addrActions:  { display: 'flex', flexDirection: 'column', gap: '8px' },
  addrIconBtn:  { background: 'none', border: 'none', padding: '4px', cursor: 'pointer', display: 'flex' },
  dashedAddBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '12px', border: '1.5px dashed #1A6B3C', borderRadius: '12px',
    backgroundColor: 'transparent', color: '#1A6B3C', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Rx rows
  rxRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 0', borderBottom: '1px solid #F5F5F5',
  },
  rxIconBox: { width: '42px', height: '42px', borderRadius: '12px', backgroundColor: '#E8F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rxDoctor:  { fontSize: '13px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  rxHosp:    { fontSize: '11px', color: '#888888', margin: '2px 0 4px' },
  rxMeta:    { display: 'flex', gap: '10px', alignItems: 'center' },
  rxDate:    { fontSize: '11px', color: '#555555', fontWeight: '600' },
  rxMeds:    { fontSize: '11px', color: '#1A6B3C', fontWeight: '700', backgroundColor: '#E8F5EE', padding: '2px 8px', borderRadius: '20px' },

  // Settings
  settingRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '8px 0', borderBottom: '1px solid #F5F5F5',
    fontFamily: 'inherit', width: '100%',
  },
  settingIconBox: { width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  settingLabel:   { fontSize: '14px', fontWeight: '600', color: '#1A1A1A', margin: 0 },
  settingSub:     { fontSize: '12px', color: '#888888', margin: '1px 0 0' },

  // Logout
  logoutBtn: {
    margin: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '14px', backgroundColor: '#FFFFFF', color: '#DC3545',
    border: '1.5px solid #DC3545', borderRadius: '14px', fontSize: '15px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
  },
  version: { textAlign: 'center', fontSize: '12px', color: '#BBBBBB', margin: '4px 0 0' },

  // Logout modal
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  modal: {
    width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF',
    borderRadius: '24px 24px 0 0', padding: '16px 20px 36px',
    display: 'flex', flexDirection: 'column', gap: '12px',
  },
  modalHandle:    { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: '4px' },
  modalTitle:     { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0, textAlign: 'center' },
  modalSub:       { fontSize: '13px', color: '#888888', margin: 0, textAlign: 'center' },
  modalPrimary: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '14px', backgroundColor: '#DC3545', color: '#FFFFFF',
    border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  modalSecondary: {
    padding: '14px', backgroundColor: '#F5F5F5', color: '#555555',
    border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '600',
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
