import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, Phone, IndianRupee, CheckCircle,
  ClipboardList, Wallet, LogOut, Package, Store, Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { getCurrentStaff } from '../lib/auth';
import { fetchUserNotifications, markNotificationRead, markAllNotificationsRead, formatNotifTime } from '../lib/notifications';

const STATUS_LABEL = { pending: 'Pending', settled: 'Settled' };
const STATUS_COLOR = { pending: '#E65100', settled: '#1A6B3C' };
const STATUS_BG    = { pending: '#FFF3E0', settled: '#E8F5EE' };

// Upcoming-tab order status — read-only preview, not the delivery_earnings
// status above (different table, different vocabulary).
const ORDER_STATUS_LABEL = { confirmed: 'Confirm hua hai', preparing: 'Pack ho raha hai' };
const ORDER_STATUS_COLOR = { confirmed: '#0C447C', preparing: '#E65100' };
const ORDER_STATUS_BG    = { confirmed: '#E7F0FA', preparing: '#FFF3E0' };

// Notification-sheet accent colours — same map shape as CustomerHome.jsx's
// (local/unexported there too, not shared via lib/notifications.js).
// delivery_upcoming is the only type this panel actually receives today
// (058_deliveryEarlyVisibility.sql's broadcast); everything else falls
// back to the same default blue CustomerHome.jsx uses.
const NOTIF_COLORS = { delivery_upcoming: '#F97316' };
const getNotifColor = (type) => NOTIF_COLORS[type] || '#2563EB';

export default function DeliveryPartnerPanel() {
  const navigate = useNavigate();
  const { handleLogout } = useAuth();

  const [staff,      setStaff]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState('orders');

  const [orders,     setOrders]     = useState([]);
  const [earnings,   setEarnings]   = useState([]);
  const [upcoming,   setUpcoming]   = useState([]);
  const [returnPickups, setReturnPickups] = useState([]);

  // notifications.user_id references users(id), not staff(id) — staff has
  // no users row of its own except via matching email (verified against
  // 001_schema.sql, same email-match precedent as 058's broadcast loop).
  // Resolved once on mount, then used for both the fetch and the realtime
  // filter below.
  const [notifUserId, setNotifUserId] = useState(null);
  const [showNotif,   setShowNotif]   = useState(false);
  const [notifs,      setNotifs]      = useState([]);
  const unreadCount = notifs.filter((n) => !n.is_read).length;

  // Per-order UI state — which cards have an OTP already sent (input
  // shown) and what's currently typed into each one.
  const [otpSentIds, setOtpSentIds] = useState(() => new Set());
  const [otpInputs,  setOtpInputs]  = useState({});
  const [busyId,     setBusyId]     = useState(null);

  const fetchAvailableOrders = async () => {
    // delivery_pincode / delivery_enabled scoping is enforced server-side
    // by the orders SELECT RLS policy (053_deliveryPartnerOrdersRLS.sql) —
    // this query only adds the status filter on top of that. No client-side
    // delivered_by_staff_id filter: 053's RLS already covers both the
    // unclaimed pool (delivered_by_staff_id IS NULL) AND orders THIS
    // partner just claimed (delivered_by_staff_id = self) — filtering
    // delivered_by_staff_id IS NULL here would hide a just-claimed order
    // right when it needs to show the "Pickup Karo" step. sellers!seller_id
    // / staff!accepted_by_staff_id — orders has more than one FK into both
    // tables, so the embed must name which FK to follow (same reason as
    // fetchUpcomingOrders below).
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, delivery_address, delivery_pincode, final_amount, delivery_otp, delivered_by_staff_id, sellers!seller_id(store_name), staff!accepted_by_staff_id(name)')
      .eq('status', 'out_for_delivery')
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

  const fetchReturnPickups = async () => {
    // RLS (067_returnPickupFlow.sql, order_returns_select_delivery_partner)
    // already scopes this to: unclaimed + accepted + serviceable-pincode
    // returns, OR ones this partner already claimed — no extra filtering
    // needed client-side, same division of labour as fetchAvailableOrders.
    // sellers!seller_id — orders has more than one FK into sellers
    // (seller_id + buyer_id), so the embed must name which FK to follow.
    const { data, error } = await supabase
      .from('order_returns')
      .select('id, order_id, reason, pickup_staff_id, pickup_confirmed_at, orders:order_id(order_number, customer_name, customer_phone, delivery_address, delivery_pincode, sellers!seller_id(store_name, address))')
      .order('seller_reviewed_at', { ascending: true });
    if (error) { console.error('fetchReturnPickups error:', error); return; }
    setReturnPickups(data || []);
  };

  const fetchUpcomingOrders = async () => {
    // Read-only preview pool — confirmed/preparing orders, scoped to
    // delivery_enabled pincodes entirely by RLS (the
    // orders_select_delivery_partner_preview policy,
    // 058_deliveryEarlyVisibility.sql), same as fetchAvailableOrders above
    // adds no pincode filter of its own. sellers!seller_id / staff!
    // accepted_by_staff_id — orders has more than one FK into both tables
    // (seller_id + buyer_id; delivered_by_staff_id + accepted_by_staff_id),
    // so the embed must name which FK to follow or PostgREST returns an
    // ambiguous-relationship error (same reason PharmacistPanel.jsx's
    // fetchCallQueue skips a bare sellers(...) embed).
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, delivered_by_staff_id, sellers!seller_id(store_name, address), staff!accepted_by_staff_id(name)')
      .in('status', ['confirmed', 'preparing'])
      .order('updated_at', { ascending: false });
    if (error) { console.error('fetchUpcomingOrders error:', error); return; }
    setUpcoming(data || []);
  };

  useEffect(() => {
    (async () => {
      const s = await getCurrentStaff();
      if (!s) { setLoading(false); return; }
      setStaff(s);

      // users.id resolve — same email-match AuthContext.jsx already uses
      // to upsert/read this same row on login, so it's known to work under
      // RLS for a staff session reading their own row.
      let resolvedUserId = null;
      if (s.email) {
        try {
          const { data: userRow } = await supabase
            .from('users').select('id').eq('email', s.email).maybeSingle();
          resolvedUserId = userRow?.id || null;
        } catch {}
      }
      setNotifUserId(resolvedUserId);

      const tasks = [fetchAvailableOrders(), fetchEarnings(s.id), fetchUpcomingOrders(), fetchReturnPickups()];
      if (resolvedUserId) {
        tasks.push(fetchUserNotifications(resolvedUserId).then(({ data }) => setNotifs(data || [])));
      }
      await Promise.all(tasks);
      setLoading(false);
    })();
  }, []);

  // Realtime — new notification INSERT updates the bell instantly. Same
  // pattern as CustomerHome.jsx's bell (INSERT-only, prepend payload.new),
  // just keyed off the resolved users.id instead of localStorage.
  useEffect(() => {
    if (!notifUserId) return;
    const channel = supabase
      .channel(`notifs-${notifUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${notifUserId}` },
        (payload) => {
          setNotifs((prev) => prev.some((n) => n.id === payload.new.id) ? prev : [payload.new, ...prev]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [notifUserId]);

  // Realtime — auto-move a claimed order between sections as the seller
  // advances it (confirmed -> preparing -> out_for_delivery), without a
  // manual refresh. Scoped to only THIS partner's claimed orders
  // (delivered_by_staff_id=eq.<own staff id>) — same postgres_changes
  // pattern as OrderTracking.jsx, re-running both fetches (cheap, and
  // simpler than patching a single row's status/embeds locally) on any
  // UPDATE to one of them.
  useEffect(() => {
    if (!staff?.id) return;
    const channel = supabase
      .channel(`dp-orders-${staff.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `delivered_by_staff_id=eq.${staff.id}` },
        () => { fetchUpcomingOrders(); fetchAvailableOrders(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [staff?.id]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Client-filtered subset of the already-fetched earnings array — no
  // separate DB call. Powers both the header badge amount and Section C's
  // "Aaj Ki History" list below (same today-cutoff, so they always agree).
  const todayEarnings = earnings.filter((e) => new Date(e.created_at) >= today);
  const todayEarning = todayEarnings.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalPending = earnings
    .filter((e) => e.status === 'pending')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const handleClaim = async (order) => {
    setBusyId(order.id);
    const { data, error } = await supabase.rpc('claim_delivery_order', { p_order_id: order.id });
    setBusyId(null);

    if (error || !data?.success) {
      alert(data?.message || error?.message || 'Order claim nahi hua');
    }

    // Refetch both, on success or failure — claimable from confirmed/
    // preparing/out_for_delivery now (062_earlyClaimFlow.sql), so a claim
    // (or someone else beating us to it) can move the order between
    // Section A (upcoming) and Section B (available); same recovery path
    // either way keeps both lists exactly matching the server.
    await Promise.all([fetchUpcomingOrders(), fetchAvailableOrders()]);
  };

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

  const handleClaimReturn = async (ret) => {
    setBusyId(ret.id);
    const { data, error } = await supabase.rpc('claim_return_pickup', { p_return_id: ret.id });
    setBusyId(null);
    if (error || !data?.success) {
      alert(data?.message || error?.message || 'Return pickup claim nahi hua');
    }
    await fetchReturnPickups();
  };

  const handleConfirmReturnPickup = async (ret) => {
    setBusyId(ret.id);
    const { data, error } = await supabase.rpc('confirm_return_pickup', { p_return_id: ret.id });
    setBusyId(null);
    if (error || !data?.success) {
      alert(data?.message || error?.message || 'Pickup confirm nahi hua');
      return;
    }
    alert(`✅ Return pickup confirm hua! ₹${data.amount ?? 18} kamaye`);
    await Promise.all([fetchReturnPickups(), fetchEarnings(staff.id)]);
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
          <div style={s.headerRight}>
            <button style={s.iconBtn} aria-label="Notifications" onClick={() => setShowNotif(true)}>
              <div style={{ position: 'relative' }}>
                <Bell size={20} color="#1A1A1A" />
                {unreadCount > 0 && <span style={s.notifDot} />}
              </div>
            </button>
            <div style={s.earningBadge}>
              <p style={s.earningBadgeVal}>₹{todayEarning.toLocaleString('en-IN')}</p>
              <p style={s.earningBadgeLabel}>Aaj Ki Kamai</p>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>
          {activeTab === 'orders' && <>
            {/* SECTION B — Pickup Ke Liye Ready (actionable, shown first) */}
            <p style={s.tabTitle}>Pickup Ke Liye Ready</p>

            {orders.length === 0 && <p style={s.emptyText}>Abhi koi order available nahi hai</p>}

            {orders.map((order) => {
              const claimedByMe = staff && order.delivered_by_staff_id === staff.id;
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
                  <div style={s.pendInfoRow}>
                    <Store size={13} color="#888888" />
                    <span style={s.pendInfoText}>Firm: {order.sellers?.store_name || '—'}</span>
                  </div>
                  {order.staff?.name && (
                    <div style={s.pendInfoRow}>
                      <Package size={13} color="#888888" />
                      <span style={s.pendInfoText}>Staff: {order.staff.name}</span>
                    </div>
                  )}
                  <p style={s.pendStatusNote}>Status: Packing Complete — Pickup Ready</p>

                  {/* Fallback safety net — normally an order is already
                      claimed by the time it reaches out_for_delivery (via
                      Section A's early-claim below); this only shows if
                      nobody claimed it earlier. */}
                  {!claimedByMe && (
                    <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => handleClaim(order)}>
                      <CheckCircle size={15} color="#FFFFFF" /> {busy ? '...' : 'Accept Karo'}
                    </button>
                  )}

                  {claimedByMe && !otpStage && (
                    <>
                      <p style={s.acceptedNote}>✅ Accepted — Ab Pickup Karo</p>
                      <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => handlePickup(order)}>
                        <Package size={15} color="#FFFFFF" /> {busy ? '...' : 'Pickup Karo'}
                      </button>
                    </>
                  )}

                  {claimedByMe && otpStage && (
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

            {/* SECTION D — Return Pickups (actionable, grouped with Section B) */}
            <p style={s.sectionHeading}>Return Pickups</p>

            {returnPickups.length === 0 && <p style={s.emptyText}>Abhi koi return pickup available nahi hai</p>}

            {returnPickups.map((ret) => {
              const o = ret.orders || {};
              const claimedByMe = staff && ret.pickup_staff_id === staff.id;
              const busy = busyId === ret.id;
              return (
                <div key={ret.id} style={s.pendCard}>
                  <div style={s.pendTop}>
                    <span style={s.pendId}>#{o.order_number || ret.order_id}</span>
                  </div>

                  <div style={s.pendInfoRow}>
                    <MapPin size={13} color="#888888" />
                    <span style={s.pendInfoText}>Pickup: {o.customer_name || 'Customer'} — {o.delivery_address || o.delivery_pincode}</span>
                  </div>
                  {o.customer_phone && (
                    <div style={s.pendInfoRow}>
                      <Phone size={13} color="#888888" />
                      <span style={s.pendInfoText}>{o.customer_phone}</span>
                    </div>
                  )}
                  <div style={s.pendInfoRow}>
                    <Store size={13} color="#888888" />
                    <span style={s.pendInfoText}>Wapas dena: {o.sellers?.store_name || '—'}{o.sellers?.address ? ` — ${o.sellers.address}` : ''}</span>
                  </div>
                  <p style={s.pendStatusNote}>Reason: {ret.reason}</p>

                  {!claimedByMe && (
                    <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => handleClaimReturn(ret)}>
                      <CheckCircle size={15} color="#FFFFFF" /> {busy ? '...' : 'Claim Karo'}
                    </button>
                  )}

                  {claimedByMe && !ret.pickup_confirmed_at && (
                    <>
                      <p style={s.acceptedNote}>✅ Aapne Claim Kiya — Customer Se Le Kar Seller Ko Wapas Karo</p>
                      <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => handleConfirmReturnPickup(ret)}>
                        <Package size={15} color="#FFFFFF" /> {busy ? '...' : 'Pickup Confirm Karo'}
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {/* SECTION A — Aa Rahe Hain (read-only preview, confirmed/preparing) */}
            <p style={s.sectionHeading}>Aa Rahe Hain</p>

            {upcoming.length === 0 && <p style={s.emptyText}>Abhi koi upcoming order nahi hai</p>}

            {upcoming.map((order) => {
              const claimedByMe = staff && order.delivered_by_staff_id === staff.id;
              const busy = busyId === order.id;
              return (
                <div key={order.id} style={s.upcomingCard}>
                  <div style={s.pendTop}>
                    <span style={s.pendId}>#{order.order_number}</span>
                    <span style={{ ...s.statusBadge, color: ORDER_STATUS_COLOR[order.status] || '#888888', backgroundColor: ORDER_STATUS_BG[order.status] || '#F5F5F5' }}>
                      {ORDER_STATUS_LABEL[order.status] || order.status}
                    </span>
                  </div>

                  <div style={s.pendInfoRow}>
                    <MapPin size={13} color="#888888" />
                    <span style={s.pendInfoText}>{order.sellers?.store_name || 'Seller'}{order.sellers?.address ? ` — ${order.sellers.address}` : ''}</span>
                  </div>
                  {order.staff?.name && (
                    <div style={s.pendInfoRow}>
                      <Package size={13} color="#888888" />
                      <span style={s.pendInfoText}>Staff: {order.staff.name}</span>
                    </div>
                  )}

                  {claimedByMe ? (
                    <p style={s.acceptedNote}>✅ Aapne Claim Kiya — Rasta Mein Nikal Sakte Hain</p>
                  ) : (
                    <>
                      <p style={s.pendStatusNote}>Jald Ready Hoga</p>
                      <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => handleClaim(order)}>
                        <CheckCircle size={15} color="#FFFFFF" /> {busy ? '...' : 'Claim Karo'}
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {/* SECTION C — Aaj Ki History (today's completed deliveries,
                client-filtered from the earnings array already fetched for
                the "Meri Kamai" tab — no separate DB call). */}
            <p style={s.sectionHeading}>Aaj Ki History</p>

            {todayEarnings.length === 0 && <p style={s.emptyText}>Aaj abhi tak koi delivery nahi hui</p>}

            {todayEarnings.map((e) => (
              <div key={e.id} style={s.earnRow}>
                <div>
                  <p style={s.earnOrderNo}>#{e.orders?.order_number || e.order_id}</p>
                  <p style={s.earnDate}>{new Date(e.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <span style={s.earnAmount}>₹{Number(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            ))}
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
          <button style={s.navTab} onClick={() => setActiveTab('orders')}>
            <ClipboardList size={22} color={activeTab === 'orders' ? '#1A6B3C' : '#AAAAAA'} />
            <span style={{ fontSize: '11px', fontWeight: '600', color: activeTab === 'orders' ? '#1A6B3C' : '#AAAAAA' }}>Orders</span>
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

        {/* ── Notification Sheet ── */}
        {showNotif && (
          <div style={s.notifOverlay} onClick={() => setShowNotif(false)}>
            <div style={s.notifSheet} onClick={(e) => e.stopPropagation()}>
              <div style={s.notifHandle} />
              <div style={s.notifHeader}>
                <span style={s.notifTitle}>Notifications</span>
                {unreadCount > 0 && (
                  <button
                    style={s.markAllBtn}
                    onClick={() => {
                      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
                      markAllNotificationsRead(notifUserId);
                    }}
                  >
                    Sab Read Karo
                  </button>
                )}
              </div>
              {notifs.length === 0 ? (
                <div style={s.notifEmpty}>
                  <Bell size={36} color="#CCCCCC" />
                  <p style={{ fontSize: '14px', color: '#AAAAAA', margin: 0 }}>Koi notification nahi</p>
                </div>
              ) : (
                <div style={s.notifList}>
                  {notifs.map((n) => (
                    <div
                      key={n.id}
                      style={{ ...s.notifRow, backgroundColor: n.is_read ? '#FFFFFF' : '#F0FBF4' }}
                      onClick={() => {
                        setNotifs((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
                        if (!n.is_read) markNotificationRead(n.id);
                        // Single-page layout now (no more tab-switch) — every
                        // section this notification could point to is already
                        // on screen, so tapping just marks it read and closes.
                        setShowNotif(false);
                      }}
                    >
                      <div style={{ width: '36px', height: '36px', borderRadius: '18px', backgroundColor: getNotifColor(n.type) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: getNotifColor(n.type) }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ ...s.notifRowTitle, fontWeight: n.is_read ? '500' : '700' }}>{n.title}</p>
                        <p style={s.notifRowSub}>{n.body}</p>
                        <p style={s.notifRowTime}>{formatNotifTime(n.created_at)}</p>
                      </div>
                      {!n.is_read && <span style={s.unreadDot} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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
  headerRight:       { display: 'flex', alignItems: 'center', gap: '10px' },
  iconBtn:           { background: 'none', border: 'none', padding: '4px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  earningBadge:      { textAlign: 'right' },
  earningBadgeVal:   { fontSize: '18px', fontWeight: '800', color: '#1A6B3C', margin: 0 },
  earningBadgeLabel: { fontSize: '11px', color: '#888888', margin: 0 },

  notifDot: { position: 'absolute', top: '-2px', right: '-2px', width: '8px', height: '8px', backgroundColor: '#EF4444', borderRadius: '50%', border: '1.5px solid #FFFFFF' },

  // Notification sheet — same layout/pattern as CustomerHome.jsx's
  notifOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  notifSheet:   { width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '20px 20px 0 0', padding: '12px 0 40px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' },
  notifHandle:  { width: '40px', height: '4px', backgroundColor: '#E0E0E0', borderRadius: '2px', margin: '0 auto 12px' },
  notifHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 12px', borderBottom: '1px solid #F0F0F0' },
  notifTitle:   { fontSize: '17px', fontWeight: '700', color: '#1A1A1A' },
  markAllBtn:   { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },
  notifList:    { overflowY: 'auto', flex: 1 },
  notifEmpty:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '40px 24px' },
  notifRow:     { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 20px', borderBottom: '1px solid #F5F5F5', cursor: 'pointer' },
  notifRowTitle:{ fontSize: '14px', color: '#1A1A1A', margin: '0 0 3px' },
  notifRowSub:  { fontSize: '12px', color: '#666666', margin: '0 0 4px', lineHeight: '1.4' },
  notifRowTime: { fontSize: '11px', color: '#AAAAAA', margin: 0 },
  unreadDot:    { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1A6B3C', flexShrink: 0, marginTop: '6px' },

  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },

  tabTitle:      { fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: '4px 0 2px' },
  sectionHeading:{ fontSize: '17px', fontWeight: '800', color: '#1A1A1A', margin: '18px 0 2px' },
  emptyText:     { fontSize: '13px', color: '#AAAAAA', textAlign: 'center', padding: '32px 16px' },

  pendCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #7C3AED', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  upcomingCard: { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #0C447C', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  pendTop:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  pendId:       { fontSize: '13px', fontWeight: '800', color: '#1A6B3C', fontFamily: 'monospace' },
  pendAmount:   { fontSize: '16px', fontWeight: '800', color: '#1A6B3C' },
  pendInfoRow:  { display: 'flex', alignItems: 'center', gap: '6px' },
  pendInfoText: { fontSize: '13px', color: '#444444' },
  pendStatusNote: { fontSize: '12px', color: '#0C447C', fontWeight: '600', margin: 0 },
  acceptedNote:   { fontSize: '12px', color: '#1A6B3C', fontWeight: '700', margin: 0 },

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
