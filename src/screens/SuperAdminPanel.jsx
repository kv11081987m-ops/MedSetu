import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const TABS = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '🏠' },
  { id: 'sellers',      label: 'Sellers',       icon: '🏪' },
  { id: 'pharmacists',  label: 'Pharmacists',   icon: '💊' },
  { id: 'admins',       label: 'Admins',        icon: '👤' },
  { id: 'offers',       label: 'Offers',        icon: '🎁' },
  { id: 'settings',     label: 'Settings',      icon: '⚙️' },
];

const SELLER_FILTER_OPTS = ['pending', 'approved', 'rejected', 'all'];

export default function SuperAdminPanel() {
  const navigate = useNavigate();

  const [activeTab,         setActiveTab]         = useState('dashboard');
  const [pendingSellers,    setPendingSellers]     = useState([]);
  const [allSellers,        setAllSellers]         = useState([]);
  const [sellerFilter,      setSellerFilter]       = useState('pending');
  const [pendingPharmacists,setPendingPharmacists] = useState([]);
  const [admins,            setAdmins]             = useState([]);
  const [stats,             setStats]              = useState({ pendingSellers: 0, activeSellers: 0, pendingPharmacists: 0, totalOrders: 0 });
  const [loadingSellers,    setLoadingSellers]     = useState(false);
  const [loadingPharmacists,setLoadingPharmacists] = useState(false);

  // ── Settings state ────────────────────────────────────────
  const [settings, setSettings] = useState({
    newRegistrations: true, homeDelivery: true,
    pharmacistCalls: true, maintenanceMode: false,
    commission: 5, deliveryCharge: 30,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // ── Offer form state ──────────────────────────────────────
  const [offers, setOffers] = useState([]);
  const [offerForm, setOfferForm] = useState({
    title: '', discountType: 'percentage', discountValue: '',
    promoCode: '', minOrder: '', validFrom: '', validTill: '',
    applicableOn: 'all', maxUses: '',
  });

  // ── Admin form state ──────────────────────────────────────
  const [adminForm, setAdminForm] = useState({ naam: '', email: '', permissions: [] });
  const PERMISSIONS = ['approve_sellers', 'manage_orders', 'manage_disputes', 'view_reports', 'manage_pharmacists'];

  useEffect(() => {
    loadStats();
    loadSellers();
    loadPharmacists();
    loadAdmins();
  }, []);

  // ── Data loaders ──────────────────────────────────────────
  const loadStats = async () => {
    const [{ count: ps }, { count: as }, { count: pp }, { count: to }] = await Promise.all([
      supabase.from('seller_registrations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('sellers').select('*', { count: 'exact', head: true }),
      supabase.from('staff_whitelist').select('*', { count: 'exact', head: true }).eq('role', 'pharmacist').eq('is_approved', false),
      supabase.from('orders').select('*', { count: 'exact', head: true }),
    ]);
    setStats({ pendingSellers: ps || 0, activeSellers: as || 0, pendingPharmacists: pp || 0, totalOrders: to || 0 });
  };

  const loadSellers = async () => {
    setLoadingSellers(true);
    const { data } = await supabase.from('seller_registrations').select('*').order('created_at', { ascending: false });
    setAllSellers(data || []);
    setPendingSellers((data || []).filter((s) => s.status === 'pending'));
    setLoadingSellers(false);
  };

  const loadPharmacists = async () => {
    setLoadingPharmacists(true);
    const { data } = await supabase.from('staff_whitelist').select('*').eq('role', 'pharmacist').eq('is_approved', false).order('created_at', { ascending: false });
    setPendingPharmacists(data || []);
    setLoadingPharmacists(false);
  };

  const loadAdmins = async () => {
    const { data } = await supabase.from('staff_whitelist').select('*').eq('role', 'admin').eq('is_approved', true);
    setAdmins(data || []);
  };

  // ── Seller actions ────────────────────────────────────────
  const approveSeller = async (registrationId) => {
    const reg = allSellers.find((s) => s.id === registrationId);
    if (!reg) return;
    try {
      const { error } = await supabase.from('sellers').insert({
        store_name:      reg.store_name,
        owner_name:      reg.owner_name,
        phone:           reg.mobile,
        address:         reg.address,
        district:        reg.district,
        drug_license:    reg.drug_license_number,
        pharmacist_name: reg.pharmacist_name,
        is_verified:     true,
        is_open:         false,
      });
      if (error) throw error;
      await supabase.from('staff_whitelist').insert({ email: reg.email, role: 'seller', name: reg.owner_name, phone: reg.mobile, is_approved: true });
      await supabase.from('seller_registrations').update({ status: 'approved' }).eq('id', registrationId);
      setAllSellers((p) => p.map((s) => s.id === registrationId ? { ...s, status: 'approved' } : s));
      setPendingSellers((p) => p.filter((s) => s.id !== registrationId));
      setStats((p) => ({ ...p, pendingSellers: p.pendingSellers - 1, activeSellers: p.activeSellers + 1 }));
      alert('Seller approve ho gaya!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const rejectSeller = async (registrationId) => {
    const reason = window.prompt('Rejection reason daalo:') || 'Documents incomplete';
    await supabase.from('seller_registrations').update({ status: 'rejected', rejection_reason: reason }).eq('id', registrationId);
    setAllSellers((p) => p.map((s) => s.id === registrationId ? { ...s, status: 'rejected' } : s));
    setPendingSellers((p) => p.filter((s) => s.id !== registrationId));
    setStats((p) => ({ ...p, pendingSellers: p.pendingSellers - 1 }));
    alert('Seller reject kar diya.');
  };

  // ── Pharmacist actions ────────────────────────────────────
  const approvePharmacist = async (id) => {
    await supabase.from('staff_whitelist').update({ is_approved: true }).eq('id', id);
    setPendingPharmacists((p) => p.filter((ph) => ph.id !== id));
    setStats((p) => ({ ...p, pendingPharmacists: p.pendingPharmacists - 1 }));
    alert('Pharmacist approve ho gaya!');
  };

  const rejectPharmacist = async (id) => {
    await supabase.from('staff_whitelist').delete().eq('id', id);
    setPendingPharmacists((p) => p.filter((ph) => ph.id !== id));
    alert('Pharmacist reject kar diya.');
  };

  // ── Admin actions ─────────────────────────────────────────
  const addAdmin = async () => {
    if (!adminForm.naam || !adminForm.email) { alert('Naam aur email zaroori hai'); return; }
    const { data, error } = await supabase.from('staff_whitelist').insert({ email: adminForm.email, role: 'admin', name: adminForm.naam, is_approved: true }).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    setAdmins((p) => [...p, data]);
    setAdminForm({ naam: '', email: '', permissions: [] });
    alert('Admin add ho gaya!');
  };

  const removeAdmin = async (id) => {
    if (!window.confirm('Confirm: Is admin ko remove karo?')) return;
    await supabase.from('staff_whitelist').delete().eq('id', id);
    setAdmins((p) => p.filter((a) => a.id !== id));
  };

  // ── Logout ────────────────────────────────────────────────
  const handleLogout = async () => {
    localStorage.removeItem('medsetu_role');
    localStorage.removeItem('medsetu_user');
    await supabase.auth.signOut().catch(() => {});
    navigate('/login');
  };

  const filteredSellers = sellerFilter === 'all' ? allSellers : allSellers.filter((s) => s.status === sellerFilter);
  const displayedCount = sellerFilter === 'pending' ? stats.pendingSellers : sellerFilter === 'approved' ? stats.activeSellers : filteredSellers.length;

  return (
    <div style={s.wrapper}>

      {/* ── Top bar ── */}
      <div style={s.topBar}>
        <img src="/logo.png" alt="MedSetu" style={{ height: '32px' }} />
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={s.topTitle}>Super Admin Panel</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={s.adminName}>Kumar</span>
          <button style={s.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={s.content}>
        {activeTab === 'dashboard'   && <TabDashboard stats={stats} allSellers={allSellers} />}
        {activeTab === 'sellers'     && (
          <TabSellers
            sellers={filteredSellers} filter={sellerFilter} setFilter={setSellerFilter}
            loading={loadingSellers} onApprove={approveSeller} onReject={rejectSeller}
          />
        )}
        {activeTab === 'pharmacists' && (
          <TabPharmacists
            pharmacists={pendingPharmacists} loading={loadingPharmacists}
            onApprove={approvePharmacist} onReject={rejectPharmacist}
          />
        )}
        {activeTab === 'admins'      && (
          <TabAdmins
            admins={admins} adminForm={adminForm} setAdminForm={setAdminForm}
            onAdd={addAdmin} onRemove={removeAdmin} PERMISSIONS={PERMISSIONS}
          />
        )}
        {activeTab === 'offers'      && <TabOffers offers={offers} setOffers={setOffers} offerForm={offerForm} setOfferForm={setOfferForm} />}
        {activeTab === 'settings'    && (
          <TabSettings
            settings={settings} setSettings={setSettings}
            saving={savingSettings} setSaving={setSavingSettings}
            onLogout={handleLogout}
          />
        )}
      </div>

      {/* ── Bottom Nav ── */}
      <div style={s.bottomNav}>
        {TABS.map(({ id, label, icon }) => {
          const badge = id === 'sellers' ? stats.pendingSellers : id === 'pharmacists' ? stats.pendingPharmacists : 0;
          return (
            <button key={id} style={{ ...s.navBtn, ...(activeTab === id ? s.navBtnActive : {}) }} onClick={() => setActiveTab(id)}>
              <span style={{ position: 'relative', fontSize: '20px', lineHeight: 1 }}>
                {icon}
                {badge > 0 && <span style={s.badge}>{badge}</span>}
              </span>
              <span style={s.navLabel}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB: Dashboard
// ══════════════════════════════════════════════════════════════
function TabDashboard({ stats, allSellers }) {
  const statCards = [
    { label: 'Pending Sellers',      value: stats.pendingSellers,      color: '#F59E0B' },
    { label: 'Active Sellers',        value: stats.activeSellers,        color: '#10B981' },
    { label: 'Pending Pharmacists',   value: stats.pendingPharmacists,   color: '#3B82F6' },
    { label: 'Total Orders',          value: stats.totalOrders,          color: '#8B5CF6' },
  ];

  const recent = [...allSellers].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={s.welcomeCard}>
        <p style={{ fontSize: '18px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' }}>Namaste Kumar! 👋</p>
        <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Super Admin Dashboard</p>
      </div>

      <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
        {statCards.map(({ label, value, color }) => (
          <div key={label} style={{ ...s.statCard, borderTopColor: color, minWidth: '130px' }}>
            <p style={{ fontSize: '24px', fontWeight: '800', color, margin: '0 0 4px' }}>{value}</p>
            <p style={{ fontSize: '12px', color: '#888', margin: 0, lineHeight: '1.4' }}>{label}</p>
          </div>
        ))}
      </div>

      <div>
        <p style={s.sectionTitle}>Recent Registrations</p>
        {recent.length === 0 ? (
          <p style={s.emptyText}>Koi registration nahi</p>
        ) : (
          recent.map((r) => (
            <div key={r.id} style={s.activityItem}>
              <div>
                <p style={{ fontSize: '14px', fontWeight: '600', color: '#1A1A1A', margin: '0 0 2px' }}>{r.store_name}</p>
                <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>{r.owner_name} · {r.district}</p>
              </div>
              <span style={{ ...s.statusChip, backgroundColor: r.status === 'pending' ? '#FEF3C7' : r.status === 'approved' ? '#D1FAE5' : '#FEE2E2', color: r.status === 'pending' ? '#B45309' : r.status === 'approved' ? '#065F46' : '#991B1B' }}>
                {r.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB: Sellers
// ══════════════════════════════════════════════════════════════
function TabSellers({ sellers, filter, setFilter, loading, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={s.sectionTitle}>Seller Registrations</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {['pending', 'approved', 'rejected', 'all'].map((f) => (
          <button key={f} style={{ ...s.filterChip, ...(filter === f ? s.filterChipActive : {}) }} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p style={s.emptyText}>Load ho raha hai...</p>}
      {!loading && sellers.length === 0 && <p style={s.emptyText}>Koi record nahi</p>}

      {sellers.map((reg) => (
        <div key={reg.id} style={{ ...s.regCard, borderLeftColor: reg.status === 'pending' ? '#F59E0B' : reg.status === 'approved' ? '#10B981' : '#EF4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 2px' }}>{reg.store_name}</p>
              <p style={{ fontSize: '13px', color: '#555', margin: '0 0 2px' }}>{reg.owner_name}</p>
              <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>{reg.district} · {reg.pincode}</p>
            </div>
            <span style={{ ...s.statusChip, backgroundColor: reg.status === 'pending' ? '#FEF3C7' : reg.status === 'approved' ? '#D1FAE5' : '#FEE2E2', color: reg.status === 'pending' ? '#B45309' : reg.status === 'approved' ? '#065F46' : '#991B1B' }}>
              {reg.status}
            </span>
          </div>

          <div style={{ fontSize: '12px', color: '#666', display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            <span>📱 {reg.mobile}</span>
            <span>📧 {reg.email}</span>
            <span>📋 {reg.drug_license_number || '—'}</span>
          </div>

          <button style={s.expandBtn} onClick={() => setExpanded(expanded === reg.id ? null : reg.id)}>
            {expanded === reg.id ? '▲ Documents Chhupao' : '▼ Documents Dekho'}
          </button>

          {expanded === reg.id && (
            <div style={s.docsBox}>
              <DocRow label="Drug License"      value={reg.drug_license_number} />
              <DocRow label="Pharmacist"         value={reg.pharmacist_name} />
              <DocRow label="Pharmacist Reg#"   value={reg.pharmacist_reg_number} />
              <DocRow label="Bank"              value={reg.bank_name} />
              <DocRow label="IFSC"              value={reg.ifsc_code} />
              <DocRow label="License Expiry"    value={reg.drug_license_expiry} />
              {reg.rejection_reason && <DocRow label="Rejection Reason" value={reg.rejection_reason} />}
            </div>
          )}

          {reg.status === 'pending' && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button style={s.approveBtn} onClick={() => onApprove(reg.id)}>✓ Approve</button>
              <button style={s.rejectBtn}  onClick={() => onReject(reg.id)}>✗ Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DocRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #F0F0F0' }}>
      <span style={{ fontSize: '12px', color: '#888' }}>{label}</span>
      <span style={{ fontSize: '12px', color: '#1A1A1A', fontWeight: '600' }}>{value || '—'}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB: Pharmacists
// ══════════════════════════════════════════════════════════════
function TabPharmacists({ pharmacists, loading, onApprove, onReject }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={s.sectionTitle}>Pending Pharmacist Applications</p>
      {loading && <p style={s.emptyText}>Load ho raha hai...</p>}
      {!loading && pharmacists.length === 0 && <p style={s.emptyText}>Koi pending application nahi</p>}
      {pharmacists.map((ph) => (
        <div key={ph.id} style={{ ...s.regCard, borderLeftColor: '#3B82F6' }}>
          <p style={{ fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' }}>{ph.name || ph.email}</p>
          <div style={{ fontSize: '12px', color: '#666', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <span>📧 {ph.email}</span>
            {ph.phone && <span>📱 {ph.phone}</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button style={s.approveBtn} onClick={() => onApprove(ph.id)}>✓ Approve</button>
            <button style={s.rejectBtn}  onClick={() => onReject(ph.id)}>✗ Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB: Admins
// ══════════════════════════════════════════════════════════════
function TabAdmins({ admins, adminForm, setAdminForm, onAdd, onRemove, PERMISSIONS }) {
  const PERM_LABELS = {
    approve_sellers: 'Seller Approve/Reject', manage_orders: 'Order Management',
    manage_disputes: 'Dispute Resolution', view_reports: 'View Reports',
    manage_pharmacists: 'Pharmacist Management',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <p style={s.sectionTitle}>Admin Management</p>

      {/* Add Admin Form */}
      <div style={s.formCard}>
        <p style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 12px' }}>+ Naya Admin Add Karo</p>
        <input style={s.inputSm} placeholder="Admin naam" value={adminForm.naam} onChange={(e) => setAdminForm((p) => ({ ...p, naam: e.target.value }))} />
        <input style={{ ...s.inputSm, marginTop: '8px' }} type="email" placeholder="Admin email" value={adminForm.email} onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value }))} />
        <p style={{ fontSize: '12px', fontWeight: '600', color: '#444', margin: '12px 0 6px' }}>Permissions:</p>
        {PERMISSIONS.map((p) => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#555', marginBottom: '6px', cursor: 'pointer' }}>
            <input type="checkbox" style={{ accentColor: '#1A6B3C' }}
              checked={adminForm.permissions.includes(p)}
              onChange={() => setAdminForm((prev) => ({
                ...prev,
                permissions: prev.permissions.includes(p) ? prev.permissions.filter((x) => x !== p) : [...prev.permissions, p],
              }))}
            />
            {PERM_LABELS[p]}
          </label>
        ))}
        <button style={{ ...s.approveBtn, marginTop: '12px', width: '100%' }} onClick={onAdd}>Admin Add Karo</button>
      </div>

      {/* Active Admins List */}
      {admins.length === 0 ? (
        <p style={s.emptyText}>Koi admin nahi</p>
      ) : (
        admins.map((a) => (
          <div key={a.id} style={s.regCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 2px' }}>{a.name || '—'}</p>
                <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>{a.email}</p>
              </div>
              <button style={s.removeBtn} onClick={() => onRemove(a.id)}>Remove</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB: Offers
// ══════════════════════════════════════════════════════════════
function TabOffers({ offers, setOffers, offerForm, setOfferForm }) {
  const setField = (field) => (e) => setOfferForm((p) => ({ ...p, [field]: e.target.value }));

  const addOffer = () => {
    if (!offerForm.title || !offerForm.promoCode || !offerForm.discountValue) {
      alert('Title, promo code, aur discount value zaroori hai');
      return;
    }
    const newOffer = { ...offerForm, id: Date.now(), active: true, uses: 0 };
    setOffers((p) => [...p, newOffer]);
    setOfferForm({ title: '', discountType: 'percentage', discountValue: '', promoCode: '', minOrder: '', validFrom: '', validTill: '', applicableOn: 'all', maxUses: '' });
  };

  const toggleOffer = (id) => setOffers((p) => p.map((o) => o.id === id ? { ...o, active: !o.active } : o));
  const deleteOffer = (id) => setOffers((p) => p.filter((o) => o.id !== id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <p style={s.sectionTitle}>Offers Management</p>

      <div style={s.formCard}>
        <p style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 12px' }}>+ Naya Offer Banao</p>
        <input style={s.inputSm} placeholder="Offer title" value={offerForm.title} onChange={setField('title')} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <select style={{ ...s.inputSm, flex: 1 }} value={offerForm.discountType} onChange={setField('discountType')}>
            <option value="percentage">Percentage (%)</option>
            <option value="fixed">Fixed Amount (₹)</option>
          </select>
          <input style={{ ...s.inputSm, flex: 1 }} type="number" placeholder="Value" value={offerForm.discountValue} onChange={setField('discountValue')} />
        </div>
        <input style={{ ...s.inputSm, marginTop: '8px', textTransform: 'uppercase' }} placeholder="Promo code" value={offerForm.promoCode} onChange={(e) => setOfferForm((p) => ({ ...p, promoCode: e.target.value.toUpperCase() }))} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input style={{ ...s.inputSm, flex: 1 }} type="number" placeholder="Min order ₹" value={offerForm.minOrder} onChange={setField('minOrder')} />
          <input style={{ ...s.inputSm, flex: 1 }} type="number" placeholder="Max uses" value={offerForm.maxUses} onChange={setField('maxUses')} />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input style={{ ...s.inputSm, flex: 1 }} type="date" value={offerForm.validFrom} onChange={setField('validFrom')} />
          <input style={{ ...s.inputSm, flex: 1 }} type="date" value={offerForm.validTill} onChange={setField('validTill')} />
        </div>
        <select style={{ ...s.inputSm, marginTop: '8px' }} value={offerForm.applicableOn} onChange={setField('applicableOn')}>
          <option value="all">All</option>
          <option value="medicines">Medicines</option>
          <option value="equipment">Equipment</option>
        </select>
        <button style={{ ...s.approveBtn, marginTop: '12px', width: '100%' }} onClick={addOffer}>Offer Add Karo</button>
      </div>

      {offers.length === 0 ? (
        <p style={s.emptyText}>Koi active offer nahi</p>
      ) : (
        offers.map((o) => (
          <div key={o.id} style={s.regCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 2px' }}>{o.title}</p>
                <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                  {o.promoCode} · {o.discountValue}{o.discountType === 'percentage' ? '%' : '₹'} off · Valid till {o.validTill || '—'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button style={{ ...s.filterChip, ...(o.active ? s.filterChipActive : {}) }} onClick={() => toggleOffer(o.id)}>
                  {o.active ? 'Active' : 'Inactive'}
                </button>
                <button style={s.removeBtn} onClick={() => deleteOffer(o.id)}>Del</button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB: Settings
// ══════════════════════════════════════════════════════════════
function TabSettings({ settings, setSettings, saving, setSaving, onLogout }) {
  const toggle = (key) => setSettings((p) => ({ ...p, [key]: !p[key] }));

  const saveSettings = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    setSaving(false);
    alert('Settings save ho gayi!');
  };

  const TOGGLES = [
    { key: 'newRegistrations', label: 'New Registrations' },
    { key: 'homeDelivery',     label: 'Home Delivery' },
    { key: 'pharmacistCalls',  label: 'Pharmacist Calls' },
    { key: 'maintenanceMode',  label: 'Maintenance Mode' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <p style={s.sectionTitle}>Platform Settings</p>

      <div style={s.formCard}>
        <p style={{ fontSize: '13px', fontWeight: '700', color: '#444', margin: '0 0 12px' }}>Feature Toggles</p>
        {TOGGLES.map(({ key, label }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F0F0F0' }}>
            <span style={{ fontSize: '14px', color: '#333' }}>{label}</span>
            <div
              style={{ width: '48px', height: '26px', borderRadius: '13px', backgroundColor: settings[key] ? '#1A6B3C' : '#ccc', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}
              onClick={() => toggle(key)}
            >
              <div style={{ position: 'absolute', top: '3px', left: settings[key] ? '25px' : '3px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
            </div>
          </div>
        ))}
      </div>

      <div style={s.formCard}>
        <p style={{ fontSize: '13px', fontWeight: '700', color: '#444', margin: '0 0 12px' }}>Commission & Charges</p>
        <label style={{ fontSize: '13px', color: '#555', display: 'block', marginBottom: '4px' }}>Platform Commission (%)</label>
        <input style={s.inputSm} type="number" min="0" max="100" value={settings.commission} onChange={(e) => setSettings((p) => ({ ...p, commission: e.target.value }))} />
        <label style={{ fontSize: '13px', color: '#555', display: 'block', margin: '12px 0 4px' }}>Delivery Charge (₹)</label>
        <input style={s.inputSm} type="number" min="0" value={settings.deliveryCharge} onChange={(e) => setSettings((p) => ({ ...p, deliveryCharge: e.target.value }))} />
        <button style={{ ...s.approveBtn, marginTop: '16px', width: '100%', opacity: saving ? 0.7 : 1 }} onClick={saveSettings} disabled={saving}>
          {saving ? 'Save Ho Raha Hai...' : 'Save Karo'}
        </button>
      </div>

      <div style={{ ...s.formCard, textAlign: 'center' }}>
        <p style={{ fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' }}>Kumar</p>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 2px' }}>kv11081987m@gmail.com</p>
        <p style={{ fontSize: '12px', color: '#1A6B3C', fontWeight: '600', margin: '0 0 16px' }}>Super Admin</p>
        <button style={{ ...s.rejectBtn, width: '100%' }} onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = {
  wrapper:  { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', flexDirection: 'column', paddingBottom: '70px' },
  topBar:   { display: 'flex', alignItems: 'center', padding: '12px 16px', backgroundColor: '#FFFFFF', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', position: 'sticky', top: 0, zIndex: 50 },
  topTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A' },
  adminName:{ fontSize: '13px', color: '#555', fontWeight: '600' },
  logoutBtn:{ padding: '6px 12px', backgroundColor: '#FEE2E2', border: 'none', borderRadius: '6px', color: '#991B1B', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  content:  { flex: 1, padding: '16px', maxWidth: '600px', width: '100%', margin: '0 auto', boxSizing: 'border-box' },
  bottomNav:{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', display: 'flex', borderTop: '1px solid #E0E0E0', zIndex: 50 },
  navBtn:   { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '10px 4px 12px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: '#888' },
  navBtnActive: { color: '#1A6B3C' },
  navLabel: { fontSize: '10px', fontWeight: '600' },
  badge:    { position: 'absolute', top: '-4px', right: '-6px', backgroundColor: '#EF4444', color: '#fff', fontSize: '9px', fontWeight: '700', borderRadius: '9px', minWidth: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 },

  welcomeCard: { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  statCard:    { backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderTop: '4px solid', flexShrink: 0 },
  sectionTitle: { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  emptyText:    { fontSize: '14px', color: '#888', textAlign: 'center', padding: '24px 0' },
  activityItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', backgroundColor: '#FFFFFF', borderRadius: '10px', marginBottom: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' },
  statusChip:   { fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '12px' },

  regCard:   { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: '4px solid #E0E0E0' },
  filterChip: { padding: '6px 14px', borderRadius: '20px', border: '1.5px solid #E0E0E0', backgroundColor: '#FAFAFA', fontSize: '13px', fontWeight: '600', color: '#888', cursor: 'pointer', fontFamily: 'inherit' },
  filterChipActive: { borderColor: '#1A6B3C', backgroundColor: '#F0FDF4', color: '#1A6B3C' },
  expandBtn:  { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '12px', fontWeight: '600', cursor: 'pointer', padding: '6px 0 0', fontFamily: 'inherit' },
  docsBox:    { backgroundColor: '#F9FAFB', borderRadius: '8px', padding: '10px', marginTop: '8px' },
  approveBtn: { padding: '10px 16px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  rejectBtn:  { padding: '10px 16px', backgroundColor: 'transparent', color: '#DC2626', border: '1.5px solid #DC2626', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  removeBtn:  { padding: '6px 12px', backgroundColor: 'transparent', color: '#DC2626', border: '1px solid #DC2626', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },

  formCard:  { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  inputSm:   { width: '100%', padding: '10px 12px', border: '1.5px solid #E0E0E0', borderRadius: '8px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FAFAFA', boxSizing: 'border-box' },
};
