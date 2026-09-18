import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, Phone, IndianRupee, CheckCircle,
  ClipboardList, Wallet, LogOut, Package,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { getCurrentStaff } from '../lib/auth';

const STATUS_LABEL = { pending: 'Pending', settled: 'Settled' };
const STATUS_COLOR = { pending: '#E65100', settled: '#1A6B3C' };
const STATUS_BG    = { pending: '#FFF3E0', settled: '#E8F5EE' };

export default function DeliveryPartnerPanel() {
  const navigate = useNavigate();
  const { handleLogout } = useAuth();

  const [staff,      setStaff]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState('available');

  const [orders,     setOrders]     = useState([]);
  const [earnings,   setEarnings]   = useState([]);

  // Per-order UI state — which cards have an OTP already sent (input
  // shown) and what's currently typed into each one.
  const [otpSentIds, setOtpSentIds] = useState(() => new Set());
  const [otpInputs,  setOtpInputs]  = useState({});
  const [busyId,     setBusyId]     = useState(null);

  const fetchAvailableOrders = async () => {
    // delivery_pincode / delivery_enabled scoping is enforced server-side
    // by the orders SELECT RLS policy (053_deliveryPartnerOrdersRLS.sql) —
    // this query only adds the status/unclaimed filter on top of that.
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, delivery_address, delivery_pincode, final_amount, delivery_otp')
      .eq('status', 'out_for_delivery')
      .is('delivered_by_staff_id', null)
      .order('assigned_at', { ascending: true });
    if (error) { console.error('fetchAvailableOrders error:', error); return; }
    setOrders(data || []);
    // An order that already has an OTP (e.g. partner refreshed mid-flow
    // after tapping "Pickup Karo") should reopen straight into the
    // OTP-entry state instead of showing "Pickup Karo" again.
    setOtpSentIds((prev) => {
      const next = new Set(prev);
      (data || []).forEach((o) => { if (o.delivery_otp) next.add(o.id); });
      return next;
    });
  };

  const fetchEarnings = async (staffId) => {
    const { data, error } = await supabase
      .from('delivery_earnings')
      .select('id, order_id, amount, status, created_at, orders:order_id(order_number)')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false });
    if (error) { console.error('fetchEarnings error:', error); return; }
    setEarnings(data || []);
  };

  useEffect(() => {
    (async () => {
      const s = await getCurrentStaff();
      if (!s) { setLoading(false); return; }
      setStaff(s);
      await Promise.all([fetchAvailableOrders(), fetchEarnings(s.id)]);
      setLoading(false);
    })();
  }, []);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayEarning = earnings
    .filter((e) => new Date(e.created_at) >= today)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalPending = earnings
    .filter((e) => e.status === 'pending')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const handlePickup = async (order) => {
    setBusyId(order.id);
    if (!order.delivery_otp) {
      const { data, error } = await supabase.rpc('generate_delivery_otp', { p_order_id: order.id });
      if (error || !data?.success) {
        alert('OTP generate nahi hua: ' + (data?.message || error?.message || 'Unknown error'));
        setBusyId(null);
        return;
      }
    }
    setOtpSentIds((prev) => new Set(prev).add(order.id));
    setBusyId(null);
  };

  const handleConfirm = async (order) => {
    const entered = (otpInputs[order.id] || '').trim();
    if (!/^\d{4}$/.test(entered)) { alert('4-digit OTP daalo'); return; }

    setBusyId(order.id);
    const { data, error } = await supabase.rpc('confirm_delivery', {
      p_order_id: order.id,
      p_otp_entered: entered,
    });
    setBusyId(null);

    if (error || !data?.success) {
      alert(data?.message || error?.message || 'Confirm nahi hua');
      return;
    }

    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    setOtpInputs((prev) => { const next = { ...prev }; delete next[order.id]; return next; });
    alert(`✅ Delivered! ₹${data.amount ?? 25} kamaye`);
    await fetchEarnings(staff.id);
  };

  const doLogout = () => { handleLogout(); navigate('/login'); };

  if (loading) {
    return (
      <div style={s.wrapper}><div style={s.screen}>
        <p style={s.loadingText}>Load ho raha hai...</p>
      </div></div>
    );
  }

  if (!staff) {
    return (
      <div style={s.wrapper}><div style={s.screen}>
        <p style={s.loadingText}>Staff record nahi mila. SuperAdmin se sampark karein.</p>
        <button style={s.logoutBtn} onClick={doLogout}><LogOut size={16} /> Logout</button>
      </div></div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.greet}>Namaste,</p>
            <p style={s.staffName}>{staff.name || staff.email}</p>
          </div>
          <div style={s.earningBadge}>
            <p style={s.earningBadgeVal}>₹{todayEarning.toLocaleString('en-IN')}</p>
            <p style={s.earningBadgeLabel}>Aaj Ki Kamai</p>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>
          {activeTab === 'available' && <>
            <p style={s.tabTitle}>Available Orders</p>

            {orders.length === 0 && <p style={s.emptyText}>Abhi koi order available nahi hai</p>}

            {orders.map((order) => {
              const otpStage = otpSentIds.has(order.id);
              const busy = busyId === order.id;
              return (
                <div key={order.id} style={s.pendCard}>
                  <div style={s.pendTop}>
                    <span style={s.pendId}>#{order.order_number}</span>
                    <span style={s.pendAmount}>₹{Number(order.final_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>

                  <div style={s.pendInfoRow}>
                    <MapPin size={13} color="#888888" />
                    <span style={s.pendInfoText}>{order.customer_name || 'Customer'} — {order.delivery_address || order.delivery_pincode}</span>
                  </div>
                  {order.customer_phone && (
                    <div style={s.pendInfoRow}>
                      <Phone size={13} color="#888888" />
                      <span style={s.pendInfoText}>{order.customer_phone}</span>
                    </div>
                  )}

                  {!otpStage && (
                    <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => handlePickup(order)}>
                      <Package size={15} color="#FFFFFF" /> {busy ? '...' : 'Pickup Karo'}
                    </button>
                  )}

                  {otpStage && (
                    <>
                      <p style={s.otpHint}>OTP bhej diya, customer ko batao ki delivery partner ko OTP bataye</p>
                      <input
                        style={s.otpInput}
                        type="tel"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="4-digit OTP"
                        value={otpInputs[order.id] || ''}
                        onChange={(e) => setOtpInputs((prev) => ({ ...prev, [order.id]: e.target.value.replace(/\D/g, '') }))}
                        disabled={busy}
                      />
                      <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => handleConfirm(order)}>
                        <CheckCircle size={15} color="#FFFFFF" /> {busy ? '...' : 'Confirm Delivery'}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </>}

          {activeTab === 'earnings' && <>
            <p style={s.tabTitle}>Meri Kamai</p>

            <div style={s.pendingCard}>
              <p style={s.pendingLabel}>Total Pending</p>
              <p style={s.pendingVal}>₹{totalPending.toLocaleString('en-IN')}</p>
            </div>

            {earnings.length === 0 && <p style={s.emptyText}>Abhi koi kamai nahi hai</p>}

            {earnings.map((e) => (
              <div key={e.id} style={s.earnRow}>
                <div>
                  <p style={s.earnOrderNo}>#{e.orders?.order_number || e.order_id}</p>
                  <p style={s.earnDate}>{new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <span style={s.earnAmount}>₹{Number(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  <span style={{ ...s.statusBadge, color: STATUS_COLOR[e.status] || '#888888', backgroundColor: STATUS_BG[e.status] || '#F5F5F5' }}>
                    {STATUS_LABEL[e.status] || e.status}
                  </span>
                </div>
              </div>
            ))}
          </>}
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          <button style={s.navTab} onClick={() => setActiveTab('available')}>
            <ClipboardList size={22} color={activeTab === 'available' ? '#1A6B3C' : '#AAAAAA'} />
            <span style={{ fontSize: '11px', fontWeight: '600', color: activeTab === 'available' ? '#1A6B3C' : '#AAAAAA' }}>Available Orders</span>
          </button>
          <button style={s.navTab} onClick={() => setActiveTab('earnings')}>
            <Wallet size={22} color={activeTab === 'earnings' ? '#1A6B3C' : '#AAAAAA'} />
            <span style={{ fontSize: '11px', fontWeight: '600', color: activeTab === 'earnings' ? '#1A6B3C' : '#AAAAAA' }}>Meri Kamai</span>
          </button>
          <button style={s.navTab} onClick={doLogout}>
            <LogOut size={22} color="#AAAAAA" />
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#AAAAAA' }}>Logout</span>
          </button>
        </nav>

      </div>
    </div>
  );
}

const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  loadingText: { fontSize: '14px', color: '#888888', textAlign: 'center', padding: '40px 16px' },
  logoutBtn:   { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', margin: '0 16px', padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545', border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  header:            { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 14px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  greet:             { fontSize: '12px', color: '#888888', margin: 0 },
  staffName:         { fontSize: '17px', fontWeight: '800', color: '#1A1A1A', margin: '1px 0' },
  earningBadge:      { textAlign: 'right' },
  earningBadgeVal:   { fontSize: '18px', fontWeight: '800', color: '#1A6B3C', margin: 0 },
  earningBadgeLabel: { fontSize: '11px', color: '#888888', margin: 0 },

  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },

  tabTitle:  { fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: '4px 0 2px' },
  emptyText: { fontSize: '13px', color: '#AAAAAA', textAlign: 'center', padding: '32px 16px' },

  pendCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #7C3AED', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  pendTop:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  pendId:       { fontSize: '13px', fontWeight: '800', color: '#1A6B3C', fontFamily: 'monospace' },
  pendAmount:   { fontSize: '16px', fontWeight: '800', color: '#1A6B3C' },
  pendInfoRow:  { display: 'flex', alignItems: 'center', gap: '6px' },
  pendInfoText: { fontSize: '13px', color: '#444444' },

  acceptBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  otpHint:  { fontSize: '12px', color: '#7C3AED', margin: 0, fontWeight: '600' },
  otpInput: { width: '100%', padding: '10px', fontSize: '18px', fontWeight: '700', letterSpacing: '4px', textAlign: 'center', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontFamily: 'inherit', boxSizing: 'border-box' },

  pendingCard:  { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', borderLeft: '4px solid #E65100' },
  pendingLabel: { fontSize: '12px', color: '#888888', margin: '0 0 2px' },
  pendingVal:   { fontSize: '24px', fontWeight: '800', color: '#E65100', margin: 0 },

  earnRow:      { backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' },
  earnOrderNo:  { fontSize: '13px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 2px', fontFamily: 'monospace' },
  earnDate:     { fontSize: '11px', color: '#AAAAAA', margin: 0 },
  earnAmount:   { fontSize: '15px', fontWeight: '800', color: '#1A6B3C' },
  statusBadge:  { fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' },

  bottomNav: { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' },
  navTab:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit' },
};
