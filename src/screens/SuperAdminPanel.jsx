import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { intentionalSignOut } from '../context/AuthContext';
import {
  approveCommissionRequest as approveCommissionRequestDb,
  rejectCommissionRequest  as rejectCommissionRequestDb,
} from '../lib/commission';
import MedicineBandsTab from './MedicineBandsTab';

const TABS = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '🏠' },
  { id: 'sellers',      label: 'Sellers',       icon: '🏪' },
  { id: 'pharmacists',  label: 'Pharmacists',   icon: '💊' },
  { id: 'admins',       label: 'Admins',        icon: '👤' },
  { id: 'offers',       label: 'Offers',        icon: '🎁' },
  { id: 'bands',        label: 'Bands',         icon: '🏷️' },
  { id: 'settings',     label: 'Settings',      icon: '⚙️' },
];

const SELLER_FILTER_OPTS = ['pending', 'approved', 'rejected', 'all'];

export default function SuperAdminPanel() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab lives in the URL (?tab=) so a reload keeps you where you were —
  // falls back to 'dashboard' silently if the query param is missing or
  // names a tab that doesn't exist.
  const [activeTab, setActiveTabState] = useState(() => {
    const fromUrl = searchParams.get('tab');
    return TABS.some((t) => t.id === fromUrl) ? fromUrl : 'dashboard';
  });
  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    setSearchParams({ tab }, { replace: true });
  };
  const [pendingSellers,    setPendingSellers]     = useState([]);
  const [allSellers,        setAllSellers]         = useState([]);
  const [sellerFilter,      setSellerFilter]       = useState('pending');
  const [pendingPharmacists,setPendingPharmacists] = useState([]);
  const [admins,            setAdmins]             = useState([]);
  const [stats,             setStats]              = useState({ pendingSellers: 0, activeSellers: 0, pendingPharmacists: 0, totalOrders: 0, totalCommission: 0 });
  const [loadingSellers,      setLoadingSellers]      = useState(false);
  const [loadingPharmacists,  setLoadingPharmacists]  = useState(false);
  const [sellerCommissions,   setSellerCommissions]   = useState([]);

  // ── Settings state ────────────────────────────────────────
  const [settings, setSettings] = useState({
    newRegistrations: true, homeDelivery: true,
    pharmacistCalls: true, maintenanceMode: false,
    commission: 5, deliveryCharge: 30, freeDeliveryThreshold: 500,
    commissionDelegatedToAdmin: false,
    tierHighRate: 20, tierModRate: 10, tierLowRate: 5,
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
    loadSellerCommissions();
    loadSellers();
    loadPharmacists();
    loadAdmins();
    loadSettings();
    loadOffers();
  }, []);

  // Realtime: refresh stats whenever any order changes (delivered → commission updated)
  useEffect(() => {
    const channel = supabase
      .channel('superadmin-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => { loadStats(); loadSellerCommissions(); }
      )
      // Commission change requests write to sellers, not orders — watch it
      // too so a new pending request shows up live without a manual refresh.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sellers' },
        () => { loadSellerCommissions(); }
      )
      .subscribe((status, err) => console.log('[SuperAdmin Realtime]', status, err ?? ''));
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Data loaders ──────────────────────────────────────────
  const loadStats = async () => {
    const [{ count: ps }, { count: as }, { count: pp }, { count: to }, { data: commData }] = await Promise.all([
      supabase.from('seller_registrations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('sellers').select('*', { count: 'exact', head: true }),
      supabase.from('staff_whitelist').select('*', { count: 'exact', head: true }).eq('role', 'pharmacist').eq('is_approved', false),
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase.from('orders').select('commission_amount').eq('status', 'delivered').not('commission_amount', 'is', null),
    ]);
    const totalCommission = (commData || []).reduce((sum, o) => sum + (o.commission_amount || 0), 0);
    setStats({ pendingSellers: ps || 0, activeSellers: as || 0, pendingPharmacists: pp || 0, totalOrders: to || 0, totalCommission });
  };

  const loadSellerCommissions = async () => {
    const [{ data: sellerRows }, { data: orderRows }] = await Promise.all([
      supabase.from('sellers').select('id, store_name, seller_type, commission_mode, commission_flat_rate, commission_status, commission_pending_mode, commission_pending_rate'),
      supabase.from('orders')
        .select('seller_id, commission_amount, final_amount, delivery_charge')
        .eq('status', 'delivered')
        .not('commission_amount', 'is', null),
    ]);
    const byId = {};
    (orderRows || []).forEach((o) => {
      if (!o.seller_id) return;
      if (!byId[o.seller_id]) byId[o.seller_id] = { sales: 0, commission: 0 };
      byId[o.seller_id].sales      += (o.final_amount || 0) - (o.delivery_charge || 0);
      byId[o.seller_id].commission += (o.commission_amount || 0);
    });
    // Show every active seller (retailer + wholesaler) so a rate can be set
    // before they ever have a delivered order — not just those with sales.
    setSellerCommissions(
      (sellerRows || []).map((s) => ({
        id:          s.id,
        name:        s.store_name,
        type:        s.seller_type || 'retailer',
        mode:        s.commission_mode || 'flat',
        rate:        s.commission_flat_rate,
        status:      s.commission_status || 'active',
        pendingMode: s.commission_pending_mode,
        pendingRate: s.commission_pending_rate,
        sales:  parseFloat((byId[s.id]?.sales     || 0).toFixed(2)),
        earned: parseFloat((byId[s.id]?.commission || 0).toFixed(2)),
      }))
    );
  };

  // ── Commission rate write path ─────────────────────────────
  // Sets a seller's commission mode + (for flat mode) rate. Blank rate input
  // clears it back to null, which falls through to the platform default in
  // markDelivered. Tier mode ignores rate entirely — tier rates are global,
  // read from platform_settings.
  const saveSellerCommission = async (sellerId, mode, rawRate) => {
    const update = { commission_mode: mode };
    if (mode === 'flat') {
      const trimmed = String(rawRate ?? '').trim();
      const rate = trimmed === '' ? null : Number(trimmed);
      if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 100)) {
        alert('Rate 0-100 ke beech ek number hona chahiye');
        return;
      }
      update.commission_flat_rate = rate;
    }
    const { error } = await supabase
      .from('sellers')
      .update(update)
      .eq('id', sellerId);
    if (error) { alert('Commission setting save nahi hui: ' + error.message); return; }
    await loadSellerCommissions();
  };

  // ── Seller-requested commission change: approve/reject ────────
  // This is separate from saveSellerCommission above — that's SuperAdmin's
  // own direct authority (no approval needed for their own changes). This
  // path only applies commission_pending_mode/rate that a SELLER requested.
  // The actual DB reads/writes live in lib/commission.js, shared with
  // AdminPanel.jsx so both panels apply the exact same approve/reject rules.
  const approveCommissionRequest = async (sellerId, pendingMode, pendingRate) => {
    const { error } = await approveCommissionRequestDb(sellerId, pendingMode, pendingRate);
    if (error) { alert('Approve nahi hua: ' + error.message); return; }
    await loadSellerCommissions();
  };

  const rejectCommissionRequest = async (sellerId) => {
    const { error } = await rejectCommissionRequestDb(sellerId);
    if (error) { alert('Reject nahi hua: ' + error.message); return; }
    await loadSellerCommissions();
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

  const loadOffers = async () => {
    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('loadOffers error:', error); return; }
    setOffers(data || []);
  };

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) { console.error('loadSettings error:', error); return; }
    if (data) {
      setSettings({
        newRegistrations: data.new_registrations,
        homeDelivery:     data.home_delivery,
        pharmacistCalls:  data.pharmacist_calls,
        maintenanceMode:  data.maintenance_mode,
        commission:            data.commission,
        deliveryCharge:        data.delivery_charge,
        freeDeliveryThreshold: data.free_delivery_threshold ?? 500,
        commissionDelegatedToAdmin: data.commission_approval_delegated_to_admin || false,
        tierHighRate: data.tier_high_rate ?? 20,
        tierModRate:  data.tier_mod_rate  ?? 10,
        tierLowRate:  data.tier_low_rate  ?? 5,
      });
    }
  };

  // ── Seller actions ────────────────────────────────────────
  const approveSeller = async (registrationId) => {
    const reg = pendingSellers.find((s) => s.id === registrationId);
    if (!reg) return;
    try {
      // 1. sellers table mein add karo
      const { data: seller, error: sellerError } = await supabase
        .from('sellers')
        .insert({
          store_name:      reg.store_name,
          owner_name:      reg.owner_name,
          phone:           reg.mobile,
          email:           reg.email,
          address:         reg.address,
          district:        reg.district,
          drug_license:    reg.drug_license_number,
          pharmacist_name: reg.pharmacist_name,
          seller_type:     reg.seller_type || 'retailer',
          commission_mode: reg.commission_mode || 'flat',
          is_verified:     true,
          is_open:         false,
        })
        .select()
        .maybeSingle();
      if (sellerError) throw sellerError;

      // 2. staff_whitelist mein upsert karo (duplicate email safe)
      const { error: whitelistError } = await supabase
        .from('staff_whitelist')
        .upsert(
          {
            email:         reg.email,
            role:          'seller',
            name:          reg.owner_name,
            phone:         reg.mobile,
            is_approved:   true,
            approval_date: new Date().toISOString(),
          },
          { onConflict: 'email' }
        );
      if (whitelistError) throw whitelistError;

      // 3. registration status update
      const { error: regError } = await supabase
        .from('seller_registrations')
        .update({ status: 'approved', review_date: new Date().toISOString() })
        .eq('id', registrationId);
      if (regError) throw regError;

      // 4. UI update
      setAllSellers((p) => p.map((s) => s.id === registrationId ? { ...s, status: 'approved' } : s));
      setPendingSellers((p) => p.filter((s) => s.id !== registrationId));
      setStats((p) => ({ ...p, pendingSellers: p.pendingSellers - 1, activeSellers: p.activeSellers + 1 }));

      alert(
        '✅ Seller approve ho gaya!\n' +
        reg.store_name + '\n\n' +
        'Ab seller apne email se Google login kar sakta hai:\n' +
        reg.email
      );
    } catch (err) {
      alert('❌ Error: ' + err.message);
      console.error(err);
    }
  };

  const rejectSeller = async (registrationId) => {
    const reasonText = window.prompt('Rejection ka reason batao:') || 'Documents incomplete hain';
    if (reasonText === null) return; // user pressed Cancel

    try {
      const { error } = await supabase
        .from('seller_registrations')
        .update({
          status:           'rejected',
          rejection_reason: reasonText,
          review_date:      new Date().toISOString(),
        })
        .eq('id', registrationId);
      if (error) throw error;

      setAllSellers((p) => p.map((s) => s.id === registrationId ? { ...s, status: 'rejected' } : s));
      setPendingSellers((p) => p.filter((s) => s.id !== registrationId));
      setStats((p) => ({ ...p, pendingSellers: p.pendingSellers - 1 }));

      alert('Seller reject kar diya.\nReason: ' + reasonText);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // ── Pharmacist actions ────────────────────────────────────
  const approvePharmacist = async (pharmacistId) => {
    const pharma = pendingPharmacists.find((p) => p.id === pharmacistId);
    if (!pharma) return;
    try {
      const { error } = await supabase
        .from('staff_whitelist')
        .update({ is_approved: true, approval_date: new Date().toISOString() })
        .eq('id', pharmacistId);
      if (error) throw error;

      setPendingPharmacists((p) => p.filter((ph) => ph.id !== pharmacistId));
      setStats((p) => ({ ...p, pendingPharmacists: p.pendingPharmacists - 1 }));

      alert(
        '✅ Pharmacist approve ho gaya!\n' +
        pharma.name + '\n\n' +
        'Ab pharmacist apne email se Google login kar sakta hai:\n' +
        pharma.email
      );
    } catch (err) {
      alert('❌ Error: ' + err.message);
    }
  };

  const rejectPharmacist = async (id) => {
    const reasonText = window.prompt('Rejection ka reason batao:') || 'Credentials verify nahi ho sake';
    if (reasonText === null) return; // user pressed Cancel

    try {
      const { error } = await supabase
        .from('staff_whitelist')
        .update({
          is_approved:      false,
          rejection_reason: reasonText,
          review_date:      new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;

      setPendingPharmacists((p) => p.filter((ph) => ph.id !== id));
      alert('Pharmacist reject kar diya.\nReason: ' + reasonText);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // ── Admin actions ─────────────────────────────────────────
  const addAdmin = async () => {
    if (!adminForm.naam || !adminForm.email) { alert('Naam aur email zaroori hai'); return; }
    try {
      const { data, error } = await supabase.from('staff_whitelist').insert({ email: adminForm.email, role: 'admin', name: adminForm.naam, is_approved: true }).select().maybeSingle();
      if (error) { alert('Error: ' + error.message); return; }
      setAdmins((p) => [...p, data]);
      setAdminForm({ naam: '', email: '', permissions: [] });
      alert('Admin add ho gaya!');
    } catch (err) { alert('Error: ' + err.message); }
  };

  const removeAdmin = async (id) => {
    if (!window.confirm('Confirm: Is admin ko remove karo?')) return;
    await supabase.from('staff_whitelist').delete().eq('id', id);
    setAdmins((p) => p.filter((a) => a.id !== id));
  };

  // ── Logout ────────────────────────────────────────────────
  const handleLogout = async () => {
    intentionalSignOut.current = true;
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
        <div style={{ background: '#FFFFFF', borderRadius: '8px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="MedSetu" style={{ height: '26px', width: 'auto', display: 'block' }} />
        </div>
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
        {activeTab === 'dashboard'   && (
          <TabDashboard
            stats={stats} allSellers={allSellers} sellerCommissions={sellerCommissions}
            onSaveCommission={saveSellerCommission}
            onApproveRequest={approveCommissionRequest}
            onRejectRequest={rejectCommissionRequest}
          />
        )}
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
        {activeTab === 'offers'      && <TabOffers offers={offers} setOffers={setOffers} offerForm={offerForm} setOfferForm={setOfferForm} loadOffers={loadOffers} />}
        {activeTab === 'bands'       && <MedicineBandsTab />}
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
function TabDashboard({ stats, allSellers, sellerCommissions, onSaveCommission, onApproveRequest, onRejectRequest }) {
  const [commFilter, setCommFilter] = useState('all'); // 'all' | 'pending'
  const statCards = [
    { label: 'Pending Sellers',      value: stats.pendingSellers,      color: '#F59E0B' },
    { label: 'Active Sellers',       value: stats.activeSellers,       color: '#10B981' },
    { label: 'Pending Pharmacists',  value: stats.pendingPharmacists,  color: '#3B82F6' },
    { label: 'Total Orders',         value: stats.totalOrders,         color: '#8B5CF6' },
    { label: 'Platform Commission',  value: '₹' + stats.totalCommission.toLocaleString('en-IN'), color: '#059669' },
  ];

  const recent = [...allSellers].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  const pendingCommCount   = sellerCommissions.filter((s) => s.status === 'pending').length;
  const visibleCommissions = commFilter === 'pending'
    ? sellerCommissions.filter((s) => s.status === 'pending')
    : sellerCommissions;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={s.welcomeCard}>
        <p style={{ fontSize: '18px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' }}>Namaste Kumar! 👋</p>
        <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Super Admin Dashboard</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {statCards.map(({ label, value, color }) => (
          <div key={label} style={{ ...s.statCard, borderTopColor: color }}>
            <p style={{ fontSize: '22px', fontWeight: '800', color, margin: '0 0 4px' }}>{value}</p>
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

      {/* Seller Commission Breakdown */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <p style={s.sectionTitle}>Seller Commission Breakdown</p>
          {pendingCommCount > 0 && (
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#B45309', backgroundColor: '#FEF3C7', padding: '3px 9px', borderRadius: '10px', flexShrink: 0 }}>
              🔔 {pendingCommCount} Pending
            </span>
          )}
        </div>
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 10px' }}>
          Har seller (retailer + wholesaler) ka apna commission rate set karo
        </p>
        {pendingCommCount > 0 && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            {['all', 'pending'].map((f) => (
              <button key={f} style={{ ...s.filterChip, ...(commFilter === f ? s.filterChipActive : {}) }} onClick={() => setCommFilter(f)}>
                {f === 'all' ? 'Sab' : `Pending Requests (${pendingCommCount})`}
              </button>
            ))}
          </div>
        )}
        {visibleCommissions.length === 0 ? (
          <p style={s.emptyText}>{commFilter === 'pending' ? 'Koi pending request nahi' : 'Koi seller nahi'}</p>
        ) : (
          visibleCommissions.map((sel) => (
            <SellerCommissionRow
              key={sel.id} sel={sel}
              onSave={onSaveCommission}
              onApprove={onApproveRequest}
              onReject={onRejectRequest}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SellerCommissionRow({ sel, onSave, onApprove, onReject }) {
  const [mode,      setMode]      = useState(sel.mode === 'tier' ? 'tier' : 'flat');
  const [rateInput, setRateInput] = useState(sel.rate != null ? String(sel.rate) : '');
  const [saving,    setSaving]    = useState(false);
  const [deciding,  setDeciding]  = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(sel.id, mode, rateInput);
    setSaving(false);
  };

  const handleApprove = async () => {
    setDeciding(true);
    await onApprove(sel.id, sel.pendingMode, sel.pendingRate);
    setDeciding(false);
  };

  const handleReject = async () => {
    setDeciding(true);
    await onReject(sel.id);
    setDeciding(false);
  };

  const isPending  = sel.status === 'pending';
  const badgeText  = mode === 'tier' ? 'Tier' : (sel.rate != null ? `Flat ${sel.rate}%` : 'Flat (default)');
  const pendingText = sel.pendingMode === 'tier'
    ? 'Tier (Margin-Based)'
    : `Flat${sel.pendingRate != null ? ` ${sel.pendingRate}%` : ' (rate SuperAdmin decide karega)'}`;

  return (
    <div style={{ ...s.activityItem, flexDirection: 'column', alignItems: 'flex-start', gap: '8px', ...(isPending ? { border: '1.5px solid #F59E0B' } : {}) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <p style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0 }}>{sel.name}</p>
          <span style={{
            fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px',
            backgroundColor: sel.type === 'wholesaler' ? '#0C447C' : '#F26C0A',
            color: '#FFFFFF', letterSpacing: '0.5px',
          }}>
            {sel.type === 'wholesaler' ? 'WHOLESALER' : 'RETAILER'}
          </span>
          {isPending && (
            <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#F59E0B', color: '#FFFFFF', letterSpacing: '0.5px' }}>
              🔔 PENDING
            </span>
          )}
        </div>
        <span style={{
          fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '8px',
          backgroundColor: mode === 'tier' ? '#EAF2FF' : (sel.rate != null ? '#E8F5EE' : '#F5F5F5'),
          color:           mode === 'tier' ? '#0C447C' : (sel.rate != null ? '#1A6B3C' : '#888'),
        }}>
          {badgeText}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '20px', width: '100%' }}>
        <div>
          <p style={{ fontSize: '11px', color: '#888', margin: '0 0 2px' }}>Sales</p>
          <p style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0 }}>₹{sel.sales.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <p style={{ fontSize: '11px', color: '#888', margin: '0 0 2px' }}>Commission</p>
          <p style={{ fontSize: '14px', fontWeight: '700', color: '#059669', margin: 0 }}>₹{sel.earned.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <p style={{ fontSize: '11px', color: '#888', margin: '0 0 2px' }}>Seller Net</p>
          <p style={{ fontSize: '14px', fontWeight: '700', color: '#2563EB', margin: 0 }}>₹{(sel.sales - sel.earned).toLocaleString('en-IN')}</p>
        </div>
      </div>

      {/* Seller-requested change — approve/reject */}
      {isPending && (
        <div style={{ width: '100%', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '10px 12px' }}>
          <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 8px' }}>
            Seller ne request kiya hai: <strong>{pendingText}</strong>
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...s.approveBtn, flex: 1, opacity: deciding ? 0.7 : 1 }} onClick={handleApprove} disabled={deciding}>
              {deciding ? '...' : 'Approve'}
            </button>
            <button style={{ ...s.rejectBtn, flex: 1, opacity: deciding ? 0.7 : 1 }} onClick={handleReject} disabled={deciding}>
              {deciding ? '...' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
        {['flat', 'tier'].map((m) => (
          <button
            key={m}
            style={{ ...s.filterChip, ...(mode === m ? s.filterChipActive : {}), flex: 1, textAlign: 'center' }}
            onClick={() => setMode(m)}
          >
            {m === 'flat' ? 'Flat' : 'Tier'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center' }}>
        {mode === 'flat' ? (
          <input
            style={{ ...s.inputSm, flex: 1, padding: '8px 10px' }}
            type="number" min="0" max="100" step="0.1"
            placeholder="Blank = platform default"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
          />
        ) : (
          <p style={{ flex: 1, fontSize: '12px', color: '#888', margin: 0 }}>
            Tier rates global hain — item ke margin ke hisaab se auto decide honge
          </p>
        )}
        <button
          style={{ ...s.approveBtn, padding: '8px 14px', opacity: saving ? 0.7 : 1 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <p style={{ fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: 0 }}>{reg.store_name}</p>
                <span style={{
                  fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '4px',
                  backgroundColor: reg.seller_type === 'wholesaler' ? '#0C447C' : '#F26C0A',
                  color: '#FFFFFF', letterSpacing: '0.5px', flexShrink: 0,
                }}>
                  {reg.seller_type === 'wholesaler' ? 'WHOLESALER' : 'RETAILER'}
                </span>
              </div>
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
function TabOffers({ offers, setOffers, offerForm, setOfferForm, loadOffers }) {
  const setField = (field) => (e) => setOfferForm((p) => ({ ...p, [field]: e.target.value }));

  const addOffer = async () => {
    if (!offerForm.title || !offerForm.promoCode || !offerForm.discountValue) {
      alert('Title, promo code, aur discount value zaroori hai');
      return;
    }
    const { error } = await supabase
      .from('offers')
      .insert({
        title:          offerForm.title,
        discount_type:  offerForm.discountType,
        discount_value: Number(offerForm.discountValue),
        promo_code:     offerForm.promoCode.toUpperCase(),
        min_order:      Number(offerForm.minOrder) || 0,
        max_uses:       Number(offerForm.maxUses) || 0,
        applicable_on:  offerForm.applicableOn || 'all',
        valid_from:     offerForm.validFrom || null,
        valid_till:     offerForm.validTill || null,
        active:         true,
      })
      .select();
    if (error) {
      console.error('addOffer error:', error);
      if (error.code === '23505') alert('Yeh promo code pehle se hai, doosra chuniye');
      else alert('Offer save nahi hua: ' + (error.message || 'error'));
      return;
    }
    await loadOffers();
    setOfferForm({ title: '', discountType: 'percentage', discountValue: '', promoCode: '', minOrder: '', validFrom: '', validTill: '', applicableOn: 'all', maxUses: '' });
    alert('Offer ban gaya!');
  };

  const toggleOffer = async (id, currentActive) => {
    const { error } = await supabase.from('offers').update({ active: !currentActive }).eq('id', id);
    if (error) { alert('Toggle nahi hua: ' + error.message); return; }
    await loadOffers();
  };

  const deleteOffer = async (id) => {
    const { error } = await supabase.from('offers').delete().eq('id', id);
    if (error) { alert('Delete nahi hua: ' + error.message); return; }
    await loadOffers();
  };

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
                  {o.promo_code} · {o.discount_value}{o.discount_type === 'percentage' ? '%' : '₹'} off · Valid till {o.valid_till || '—'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button style={{ ...s.filterChip, ...(o.active ? s.filterChipActive : {}) }} onClick={() => toggleOffer(o.id, o.active)}>
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
  const navigate = useNavigate()
  const toggle = (key) => setSettings((p) => ({ ...p, [key]: !p[key] }));

  const saveSettings = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('platform_settings')
      .update({
        new_registrations: settings.newRegistrations,
        home_delivery:     settings.homeDelivery,
        pharmacist_calls:  settings.pharmacistCalls,
        maintenance_mode:  settings.maintenanceMode,
        commission:               Number(settings.commission),
        delivery_charge:          Number(settings.deliveryCharge),
        free_delivery_threshold:  Number(settings.freeDeliveryThreshold),
        commission_approval_delegated_to_admin: settings.commissionDelegatedToAdmin,
        tier_high_rate: Number(settings.tierHighRate),
        tier_mod_rate:  Number(settings.tierModRate),
        tier_low_rate:  Number(settings.tierLowRate),
        updated_at:               new Date().toISOString(),
      })
      .eq('id', 1);
    setSaving(false);
    if (error) {
      console.error('saveSettings error:', error);
      alert('Settings save nahi hui: ' + (error.message || 'error'));
    } else {
      alert('Settings save ho gayi!');
    }
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
        <label style={{ fontSize: '13px', color: '#555', display: 'block', margin: '12px 0 4px' }}>Free Delivery Above (₹)</label>
        <input style={s.inputSm} type="number" min="0" value={settings.freeDeliveryThreshold} onChange={(e) => setSettings((p) => ({ ...p, freeDeliveryThreshold: e.target.value }))} />
        <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>Is amount se zyada order pe delivery free hogi (0 = hamesha charge lagega)</p>

        <div style={{ padding: '14px 0 0', marginTop: '12px', borderTop: '1px solid #F0F0F0' }}>
          <p style={{ fontSize: '13px', color: '#555', margin: '0 0 2px' }}>Tier Commission Band Rates</p>
          <p style={{ fontSize: '11px', color: '#888', margin: '0 0 10px' }}>
            Har medicine ka band (Bands tab mein set hota hai) is rate se commission decide karta hai. Unclassified medicine seller ke flat rate se calculate hoti hai.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#DC2626', fontWeight: '700', display: 'block', marginBottom: '4px' }}>High (%)</label>
              <input style={s.inputSm} type="number" min="0" max="100" step="0.1" value={settings.tierHighRate} onChange={(e) => setSettings((p) => ({ ...p, tierHighRate: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#D97706', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Moderate (%)</label>
              <input style={s.inputSm} type="number" min="0" max="100" step="0.1" value={settings.tierModRate} onChange={(e) => setSettings((p) => ({ ...p, tierModRate: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#059669', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Low (%)</label>
              <input style={s.inputSm} type="number" min="0" max="100" step="0.1" value={settings.tierLowRate} onChange={(e) => setSettings((p) => ({ ...p, tierLowRate: e.target.value }))} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 0', marginTop: '12px', borderTop: '1px solid #F0F0F0' }}>
          <div style={{ flex: 1, paddingRight: '12px' }}>
            <p style={{ fontSize: '14px', color: '#333', margin: 0 }}>Commission Approval Admin Ko De</p>
            <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>
              On karne pe Admin bhi commission requests approve/reject kar sakega
            </p>
          </div>
          <div
            style={{ width: '48px', height: '26px', borderRadius: '13px', backgroundColor: settings.commissionDelegatedToAdmin ? '#1A6B3C' : '#ccc', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
            onClick={() => toggle('commissionDelegatedToAdmin')}
          >
            <div style={{ position: 'absolute', top: '3px', left: settings.commissionDelegatedToAdmin ? '25px' : '3px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
          </div>
        </div>

        <button style={{ ...s.approveBtn, marginTop: '16px', width: '100%', opacity: saving ? 0.7 : 1 }} onClick={saveSettings} disabled={saving}>
          {saving ? 'Save Ho Raha Hai...' : 'Save Karo'}
        </button>
      </div>

      <div style={s.formCard}>
        <p style={{ fontSize: '13px', fontWeight: '700', color: '#444', margin: '0 0 12px' }}>Data Management</p>
        <button
          onClick={() => navigate('/medicine-import')}
          style={{ width: '100%', padding: '12px', background: '#1A6B3C', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}
        >
          💊 Jan Aushadhi Import
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
  filterChipActive: { border: '1.5px solid #1A6B3C', backgroundColor: '#F0FDF4', color: '#1A6B3C' },
  expandBtn:  { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '12px', fontWeight: '600', cursor: 'pointer', padding: '6px 0 0', fontFamily: 'inherit' },
  docsBox:    { backgroundColor: '#F9FAFB', borderRadius: '8px', padding: '10px', marginTop: '8px' },
  approveBtn: { padding: '10px 16px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  rejectBtn:  { padding: '10px 16px', backgroundColor: 'transparent', color: '#DC2626', border: '1.5px solid #DC2626', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  removeBtn:  { padding: '6px 12px', backgroundColor: 'transparent', color: '#DC2626', border: '1px solid #DC2626', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },

  formCard:  { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  inputSm:   { width: '100%', padding: '10px 12px', border: '1.5px solid #E0E0E0', borderRadius: '8px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FAFAFA', boxSizing: 'border-box' },
};
