import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Store, ShoppingBag, Clock, IndianRupee,
  AlertTriangle, User, Phone, CheckCircle, X,
  BarChart2, Package, Settings, Plus, TrendingUp,
  Home, ClipboardList, Wallet, UserCircle, Edit3, LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { getCurrentSeller } from '../lib/auth';

// ─── Static helpers ───────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Sales Report', Icon: BarChart2, iconColor: '#1A6B3C', bg: '#E8F5EE', route: null },
  { label: 'Inventory',    Icon: Package,   iconColor: '#2563EB', bg: '#EAF2FF', route: '/inventory' },
  { label: 'Order History',Icon: Clock,     iconColor: '#7C3AED', bg: '#F3EEFF', route: null },
  { label: 'Settings',     Icon: Settings,  iconColor: '#555555', bg: '#F0F0F0', route: null },
  { label: 'Medicine Add', Icon: Plus,      iconColor: '#EA6C00', bg: '#FFF3E8', route: '/inventory' },
];

const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', delivered: 'Delivered', cancelled: 'Cancelled' };
const STATUS_COLOR = { pending: '#E65100', confirmed: '#2563EB', delivered: '#1A6B3C', cancelled: '#888888' };
const STATUS_BG    = { pending: '#FFF3E0', confirmed: '#EAF2FF', delivered: '#E8F5EE', cancelled: '#F5F5F5' };

const ORDER_FILTERS = [
  { label: 'Sab',       value: 'sab' },
  { label: 'Pending',   value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Delivered', value: 'delivered' },
];

const SELLER_NOTIFS = [
  { id: 1, icon: '🛒', title: 'Naya Order Aaya!',        sub: 'Ramesh Kumar ne 3 items order kiye — ₹459',      time: '2 min pehle',  read: false },
  { id: 2, icon: '💰', title: 'Payment Received',        sub: 'UPI payment ₹892 confirm ho gaya',               time: '15 min pehle', read: false },
  { id: 3, icon: '⚠️', title: 'Low Stock Alert',         sub: 'Paracetamol 500mg — sirf 5 strips bacha hai',    time: '1 ghanta pehle', read: true },
  { id: 4, icon: '✅', title: 'Order Delivered',         sub: 'MED-2024-013 successfully deliver ho gaya',      time: '2 ghante pehle', read: true },
];

const getTimeAgo = (dateStr) => {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)   return `${diff} sec pehle`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min pehle`;
  return `${Math.floor(diff / 3600)} ghante pehle`;
};

const mapOrderDisplay = (order) => ({
  id:       order.order_number || String(order.id).slice(0, 8).toUpperCase(),
  ago:      order.created_at ? getTimeAgo(order.created_at) : '',
  customer: order.customer_name || 'Customer',
  phone:    order.customer_phone || '',
  items:    order.order_items?.length
    ? order.order_items.map((i) => `${i.medicine_name || i.name || 'Item'} x${i.quantity || 1}`)
    : ['Order items'],
  amount:   order.final_amount || 0,
  status:   order.status,
  warning:  null,
  badges:   [{ label: '💊 Medicine', color: '#2563EB', bg: '#EAF2FF' }],
  _id:      order.id,
});

// ─── Sub-components ───────────────────────────────────────────
function OrderCard({ order, onAccept, onDecline }) {
  const statusColor = STATUS_COLOR[order.status] || '#888888';
  const statusBg    = STATUS_BG[order.status]    || '#F5F5F5';
  const statusLabel = STATUS_LABEL[order.status] || order.status;

  return (
    <div style={s.pendCard}>
      <div style={s.pendTop}>
        <div style={s.pendLeft}>
          <span style={s.pendId}>#{order.id}</span>
          <span style={{ fontSize: '11px', color: statusColor, fontWeight: '600' }}>
            🟡 {statusLabel}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <span style={s.pendAgo}>{order.ago}</span>
          <span style={{ ...s.statusBadge, color: statusColor, backgroundColor: statusBg }}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div style={s.pendCustomer}>
        <div style={s.pendInfoRow}><User size={13} color="#888888" /><span style={s.pendInfoText}>{order.customer}</span></div>
        {order.phone ? <div style={s.pendInfoRow}><Phone size={13} color="#888888" /><span style={s.pendInfoText}>{order.phone}</span></div> : null}
      </div>

      <div style={s.pendItems}>
        {order.items.map((it, i) => <p key={i} style={s.pendItem}>• {it}</p>)}
        <span style={s.pendAmount}>₹{order.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>

      <div style={s.badgeRow}>
        {order.badges.map((b) => (
          <span key={b.label} style={{ ...s.badge, color: b.color, backgroundColor: b.bg }}>{b.label}</span>
        ))}
      </div>

      {order.status === 'pending' && (
        <div style={s.pendBtns}>
          <button style={s.acceptBtn} onClick={() => onAccept(order._id)}>
            <CheckCircle size={15} color="#FFFFFF" /> Accept
          </button>
          <button style={s.declineBtn} onClick={() => onDecline(order._id)}>
            <X size={15} color="#DC3545" /> Decline
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function SellerDashboard() {
  const navigate = useNavigate();
  const { handleLogout } = useAuth();

  const [storeOpen,   setStoreOpen]   = useState(false);
  const [activeTab,   setActiveTab]   = useState('home');
  const [orderFilter, setOrderFilter] = useState('sab');
  const [showNotif,   setShowNotif]   = useState(false);
  const [notifs,      setNotifs]      = useState(SELLER_NOTIFS);
  const unreadCount = notifs.filter((n) => !n.read).length;

  const [sellerData,    setSellerData]    = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [allOrders,     setAllOrders]     = useState([]);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [todayStats,    setTodayStats]    = useState({ totalOrders: 0, pendingCount: 0, todayEarnings: 0, lowStockCount: 0 });
  const [loading,       setLoading]       = useState(true);

  // ── Fetch helpers ──────────────────────────────────────────
  const fetchPendingOrders = async (sellerId) => {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('seller_id', sellerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (data) setPendingOrders(data);
  };

  const fetchTodayStats = async (sellerId) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('orders')
      .select('status, final_amount')
      .eq('seller_id', sellerId)
      .gte('created_at', today.toISOString());
    if (data) {
      setTodayStats((prev) => ({
        ...prev,
        totalOrders:   data.length,
        pendingCount:  data.filter((o) => o.status === 'pending').length,
        todayEarnings: data
          .filter((o) => o.status !== 'cancelled')
          .reduce((sum, o) => sum + (o.final_amount || 0), 0),
      }));
    }
  };

  const fetchLowStock = async (sellerId) => {
    const { data } = await supabase
      .from('medicines')
      .select('name, stock')
      .eq('seller_id', sellerId)
      .lte('stock', 10)
      .gt('stock', 0)
      .order('stock');
    if (data) {
      setLowStockItems(data);
      setTodayStats((prev) => ({ ...prev, lowStockCount: data.length }));
    }
  };

  const fetchAllOrders = async (sellerId, filter) => {
    let query = supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    if (filter !== 'sab') query = query.eq('status', filter);
    const { data } = await query;
    if (data) setAllOrders(data);
  };

  const fetchSellerData = async () => {
    try {
      const seller = await getCurrentSeller();
      if (!seller) { navigate('/login'); return; }
      setSellerData(seller);
      setStoreOpen(seller.is_open ?? true);
      await Promise.all([
        fetchPendingOrders(seller.id),
        fetchTodayStats(seller.id),
        fetchLowStock(seller.id),
      ]);
    } catch (err) {
      console.error('Seller fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSellerData(); }, []);

  useEffect(() => {
    if (sellerData?.id && activeTab === 'orders') {
      fetchAllOrders(sellerData.id, orderFilter);
    }
  }, [activeTab, orderFilter, sellerData?.id]);

  // ── Actions ────────────────────────────────────────────────
  const toggleStoreStatus = async () => {
    if (!sellerData) return;
    const newStatus = !storeOpen;
    setStoreOpen(newStatus);
    const { error } = await supabase
      .from('sellers').update({ is_open: newStatus }).eq('id', sellerData.id);
    if (error) { setStoreOpen(!newStatus); alert('Update nahi hua — dobara try karo'); }
  };

  const acceptOrder = async (orderId) => {
    const { error } = await supabase
      .from('orders').update({ status: 'confirmed' }).eq('id', orderId);
    if (!error) {
      setPendingOrders((prev) => prev.filter((o) => o.id !== orderId));
      setTodayStats((prev) => ({ ...prev, pendingCount: Math.max(0, prev.pendingCount - 1) }));
    }
  };

  const declineOrder = async (orderId) => {
    const { error } = await supabase
      .from('orders').update({ status: 'cancelled' }).eq('id', orderId);
    if (!error) setPendingOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  const doLogout = () => { handleLogout(); navigate('/login'); };

  const pendingDisplayOrders = pendingOrders.map(mapOrderDisplay);
  const allDisplayOrders     = allOrders.map(mapOrderDisplay);

  const NAV_TABS = [
    { id: 'home',      Icon: Home,          label: 'Home',      badge: pendingOrders.length },
    { id: 'orders',    Icon: ClipboardList, label: 'Orders',    badge: pendingOrders.length },
    { id: 'inventory', Icon: Package,       label: 'Inventory', badge: null },
    { id: 'earnings',  Icon: Wallet,        label: 'Earnings',  badge: null },
    { id: 'profile',   Icon: UserCircle,    label: 'Profile',   badge: null },
  ];

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' }}>
        <p style={{ color: '#888888', fontSize: '14px' }}>Dashboard load ho raha hai...</p>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.greet}>Namaste 🙏</p>
            <p style={s.storeName}>{sellerData?.store_name || 'Medical Store'}</p>
            <p style={s.storeCity}>{sellerData?.district || sellerData?.address || 'Deoria, UP'}</p>
          </div>
          <div style={s.headerRight}>
            <button style={s.iconBtn} onClick={() => setShowNotif(true)}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                {unreadCount > 0 && <span style={s.notifDot} />}
              </div>
            </button>
            <div style={s.avatar}>
              <span style={s.avatarLetter}>{(sellerData?.store_name || 'S')[0].toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* ══ HOME TAB ══════════════════════════════════════ */}
          {activeTab === 'home' && <>

            {/* Store Status toggle */}
            <div style={s.storeCard}>
              <div style={s.storeCardLeft}>
                <div style={s.storeIconBox}><Store size={22} color="#1A6B3C" /></div>
                <div>
                  <p style={s.storeLabel}>Aapki Dukaan</p>
                  <p style={s.storeSince}>{sellerData?.store_name || 'Medical Store'}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: storeOpen ? '#1A6B3C' : '#DC3545' }}>
                  {storeOpen ? 'Khuli Hai' : 'Band Hai'}
                </span>
                <button
                  style={{ ...s.toggle, backgroundColor: storeOpen ? '#1A6B3C' : '#DC3545', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={toggleStoreStatus}
                  aria-label={storeOpen ? 'Store band karo' : 'Store kholo'}
                >
                  <div style={{ ...s.toggleThumb, left: storeOpen ? '28px' : '3px' }}>
                    <span style={{ fontSize: '7px', fontWeight: '800', color: storeOpen ? '#1A6B3C' : '#DC3545', userSelect: 'none', lineHeight: 1 }}>
                      {storeOpen ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Metrics */}
            <div style={s.metricsGrid}>
              {[
                { Icon: ShoppingBag,   val: todayStats.totalOrders,                                               label: 'Aaj Ke Orders',  bg: '#E8F5EE', color: '#1A6B3C', pulse: false },
                { Icon: Clock,         val: todayStats.pendingCount,                                               label: 'Pending Orders', bg: '#FFF3E0', color: '#E65100', pulse: true  },
                { Icon: IndianRupee,   val: '₹' + todayStats.todayEarnings.toLocaleString('en-IN'),               label: 'Aaj Ki Kamai',   bg: '#EAF2FF', color: '#2563EB', pulse: false },
                { Icon: AlertTriangle, val: todayStats.lowStockCount,                                              label: 'Low Stock',      bg: '#FFEBEE', color: '#DC3545', pulse: false },
              ].map(({ Icon, val, label, bg, color, pulse }) => (
                <div key={label} style={{ ...s.metricCard, backgroundColor: bg }}>
                  <div style={s.metricIconRow}>
                    <Icon size={18} color={color} />
                    {pulse && todayStats.pendingCount > 0 && <span style={{ ...s.pulseDot, backgroundColor: color }} />}
                  </div>
                  <p style={{ ...s.metricVal, color }}>{val}</p>
                  <p style={s.metricLabel}>{label}</p>
                </div>
              ))}
            </div>

            {/* Pending Orders */}
            <div style={s.section}>
              <div style={s.sectionHead}>
                <div style={s.sectionTitleRow}>
                  <span style={s.urgentDot} />
                  <span style={s.sectionTitle}>Turant Dhyan Den</span>
                </div>
                <span style={s.sectionSub}>{pendingOrders.length} pending</span>
              </div>
              {pendingOrders.length === 0 ? (
                <div style={s.noPending}>
                  <CheckCircle size={32} color="#1A6B3C" />
                  <p style={s.noPendingText}>Koi pending order nahi 🎉</p>
                </div>
              ) : (
                <div style={s.pendingList}>
                  {pendingDisplayOrders.map((o) => (
                    <OrderCard key={o._id} order={o} onAccept={acceptOrder} onDecline={declineOrder} />
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div style={s.section}>
              <p style={s.sectionTitle}>Quick Actions</p>
              <div style={s.quickScroll}>
                {QUICK_ACTIONS.map(({ label, Icon, iconColor, bg, route }) => (
                  <button key={label} style={s.quickCard} onClick={() => route && navigate(route)}>
                    <div style={{ ...s.quickIcon, backgroundColor: bg }}><Icon size={20} color={iconColor} /></div>
                    <span style={s.quickLabel}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Low Stock */}
            {lowStockItems.length > 0 && (
              <div style={s.stockCard}>
                <div style={s.stockHeader}>
                  <AlertTriangle size={16} color="#DC3545" />
                  <p style={s.stockTitle}>Stock Khatam Hone Wala</p>
                </div>
                <div style={s.stockList}>
                  {lowStockItems.map((item) => (
                    <div key={item.name} style={s.stockRow}>
                      <span style={s.stockName}>{item.name}</span>
                      <span style={{ ...s.stockLeft, color: item.stock <= 5 ? '#DC3545' : '#E65100' }}>
                        {item.stock} strips bache
                      </span>
                    </div>
                  ))}
                </div>
                <button style={s.stockBtn} onClick={() => navigate('/inventory')}>Inventory Update Karo</button>
              </div>
            )}

            {/* Today summary card */}
            <div style={s.chartCard}>
              <div style={s.chartHeader}>
                <p style={s.sectionTitle}>Aaj Ki Kamai</p>
                <div style={s.chartTotal}>
                  <TrendingUp size={14} color="#1A6B3C" />
                  <span style={s.chartTotalText}>Live data</span>
                </div>
              </div>
              <p style={s.chartGrand}>₹{todayStats.todayEarnings.toLocaleString('en-IN')}</p>
              <p style={{ fontSize: '13px', color: '#888888', margin: 0 }}>
                {todayStats.totalOrders} orders aaj · {todayStats.pendingCount} pending
              </p>
            </div>
          </>}

          {/* ══ ORDERS TAB ════════════════════════════════════ */}
          {activeTab === 'orders' && <>
            <p style={s.tabTitle}>Saare Orders</p>

            <div style={s.filterRow}>
              {ORDER_FILTERS.map(({ label, value }) => (
                <button
                  key={value}
                  style={{ ...s.filterChip, ...(orderFilter === value ? s.filterChipActive : {}) }}
                  onClick={() => setOrderFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {allDisplayOrders.length === 0 ? (
              <div style={s.noPending}>
                <CheckCircle size={32} color="#1A6B3C" />
                <p style={s.noPendingText}>Is filter mein koi orders nahi</p>
              </div>
            ) : (
              <div style={s.pendingList}>
                {allDisplayOrders.map((o) => (
                  <OrderCard key={o._id} order={o} onAccept={acceptOrder} onDecline={declineOrder} />
                ))}
              </div>
            )}
          </>}

          {/* ══ EARNINGS TAB ══════════════════════════════════ */}
          {activeTab === 'earnings' && <>
            <p style={s.tabTitle}>Kamai</p>

            <div style={s.earningsToday}>
              <div style={s.earningsStat}>
                <p style={s.earningsStatVal}>₹{todayStats.todayEarnings.toLocaleString('en-IN')}</p>
                <p style={s.earningsStatLabel}>Aaj Ki Kamai</p>
              </div>
              <div style={s.earningsDivider} />
              <div style={s.earningsStat}>
                <p style={{ ...s.earningsStatVal, color: '#2563EB' }}>{todayStats.totalOrders}</p>
                <p style={s.earningsStatLabel}>Aaj Ke Orders</p>
              </div>
            </div>

            <div style={s.monthlyCard}>
              <div>
                <p style={s.monthlyLabel}>Is Mahine Ki Total Kamai</p>
                <p style={s.monthlyVal}>— Jald Aayega</p>
              </div>
              <IndianRupee size={32} color="#1A6B3C" strokeWidth={1.5} />
            </div>

            <button style={s.withdrawBtn}>
              <IndianRupee size={16} color="#FFFFFF" />
              Withdrawal Request Karo
            </button>
          </>}

          {/* ══ PROFILE TAB ═══════════════════════════════════ */}
          {activeTab === 'profile' && <>
            <p style={s.tabTitle}>Store Profile</p>

            <div style={s.profileCard}>
              <div style={s.profileAvatar}>
                <span style={s.profileAvatarLetter}>{(sellerData?.store_name || 'S')[0].toUpperCase()}</span>
              </div>
              <p style={s.profileStoreName}>{sellerData?.store_name || 'Medical Store'}</p>
              <p style={s.profileSub}>{sellerData?.district || 'Deoria, Uttar Pradesh'}</p>
            </div>

            <div style={s.infoCard}>
              {[
                { label: 'Owner Naam',          value: sellerData?.owner_name    || '—' },
                { label: 'Phone Number',         value: sellerData?.phone         || '—' },
                { label: 'Drug License',         value: sellerData?.drug_license  || '—' },
                { label: 'GST Number',           value: sellerData?.gst_number    || '—' },
                { label: 'Rating',               value: sellerData?.rating ? `${sellerData.rating} ⭐` : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={s.infoRow}>
                  <p style={s.infoLabel}>{label}</p>
                  <p style={s.infoValue}>{value}</p>
                </div>
              ))}
            </div>

            <button style={s.editBtn} onClick={() => {}}>
              <Edit3 size={16} color="#1A6B3C" />
              Store Details Edit Karo
            </button>

            <button style={s.logoutBtn} onClick={doLogout}>
              <LogOut size={16} color="#FFFFFF" />
              Logout
            </button>
          </>}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, badge }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                style={s.navTab}
                onClick={() => {
                  if (id === 'inventory') { navigate('/inventory'); return; }
                  setActiveTab(id);
                }}
              >
                <div style={{ position: 'relative' }}>
                  <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'} strokeWidth={isActive ? 2.5 : 1.8} />
                  {badge > 0 && <span style={s.navBadge}>{badge}</span>}
                </div>
                <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA', fontWeight: isActive ? '600' : '400' }}>
                  {label}
                </span>
                {isActive && <span style={s.navDot} />}
              </button>
            );
          })}
        </nav>

        {/* ── Notification Sheet ── */}
        {showNotif && (
          <div style={s.notifOverlay} onClick={() => setShowNotif(false)}>
            <div style={s.notifSheet} onClick={(e) => e.stopPropagation()}>
              <div style={s.notifHandle} />
              <div style={s.notifHeader}>
                <span style={s.notifTitle}>Notifications</span>
                {unreadCount > 0 && (
                  <button style={s.markAllBtn} onClick={() => setNotifs((p) => p.map((n) => ({ ...n, read: true })))}>
                    Sab Read Karo
                  </button>
                )}
              </div>
              <div style={s.notifList}>
                {notifs.map((n) => (
                  <div
                    key={n.id}
                    style={{ ...s.notifRow, backgroundColor: n.read ? '#FFFFFF' : '#F0FBF4' }}
                    onClick={() => setNotifs((p) => p.map((x) => x.id === n.id ? { ...x, read: true } : x))}
                  >
                    <span style={s.notifIcon}>{n.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ ...s.notifRowTitle, fontWeight: n.read ? '500' : '700' }}>{n.title}</p>
                      <p style={s.notifRowSub}>{n.sub}</p>
                      <p style={s.notifRowTime}>{n.time}</p>
                    </div>
                    {!n.read && <span style={s.unreadDot} />}
                  </div>
                ))}
              </div>
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
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  // Header
  header:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 16px 14px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  greet:       { fontSize: '12px', color: '#888888', margin: 0 },
  storeName:   { fontSize: '16px', fontWeight: '800', color: '#1A1A1A', margin: '1px 0' },
  storeCity:   { fontSize: '12px', color: '#888888', margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  notifDot:    { position: 'absolute', top: '-2px', right: '-2px', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444', border: '1.5px solid #FFFFFF' },
  notifOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  notifSheet:   { width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '20px 20px 0 0', padding: '12px 0 40px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' },
  notifHandle:  { width: '40px', height: '4px', backgroundColor: '#E0E0E0', borderRadius: '2px', margin: '0 auto 12px' },
  notifHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 12px', borderBottom: '1px solid #F0F0F0' },
  notifTitle:   { fontSize: '17px', fontWeight: '700', color: '#1A1A1A' },
  markAllBtn:   { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },
  notifList:    { overflowY: 'auto', flex: 1 },
  notifRow:     { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 20px', borderBottom: '1px solid #F5F5F5', cursor: 'pointer' },
  notifIcon:    { fontSize: '22px', flexShrink: 0, lineHeight: 1, marginTop: '2px' },
  notifRowTitle:{ fontSize: '14px', color: '#1A1A1A', margin: '0 0 3px' },
  notifRowSub:  { fontSize: '12px', color: '#666666', margin: '0 0 4px', lineHeight: '1.4' },
  notifRowTime: { fontSize: '11px', color: '#AAAAAA', margin: 0 },
  unreadDot:    { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1A6B3C', flexShrink: 0, marginTop: '6px' },
  avatar:      { width: '38px', height: '38px', borderRadius: '19px', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  avatarLetter:{ fontSize: '16px', fontWeight: '800', color: '#FFFFFF' },

  // Body
  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },

  // Tab title
  tabTitle: { fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: '4px 0 2px' },

  // Store card & toggle
  storeCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderLeft: '4px solid #1A6B3C', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
  storeCardLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  storeIconBox:  { width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#E8F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  storeLabel:    { fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  storeSince:    { fontSize: '11px', color: '#888888', margin: 0, marginTop: '2px' },
  toggle: {
    width: '52px', height: '28px', borderRadius: '14px',
    position: 'relative', cursor: 'pointer',
    transition: 'background-color 0.3s ease', flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute', top: '3px',
    width: '22px', height: '22px', borderRadius: '50%',
    backgroundColor: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
    transition: 'left 0.3s ease',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  // Metrics
  metricsGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  metricCard:   { borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px' },
  metricIconRow:{ display: 'flex', alignItems: 'center', gap: '6px' },
  pulseDot:     { width: '8px', height: '8px', borderRadius: '50%', animation: 'pulse 1.4s ease-in-out infinite' },
  metricVal:    { fontSize: '26px', fontWeight: '800', margin: '4px 0 0', lineHeight: 1 },
  metricLabel:  { fontSize: '11px', color: '#555555', fontWeight: '500', margin: 0 },

  // Section
  section:        { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionHead:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow:{ display: 'flex', alignItems: 'center', gap: '8px' },
  urgentDot:      { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#DC3545', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0, display: 'inline-block' },
  sectionTitle:   { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sectionSub:     { fontSize: '12px', color: '#888888' },
  noPending:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 5px rgba(0,0,0,0.04)' },
  noPendingText:  { fontSize: '14px', color: '#1A6B3C', fontWeight: '600', margin: 0 },
  pendingList:    { display: 'flex', flexDirection: 'column', gap: '10px' },

  // Order card
  pendCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #E65100', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  pendTop:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  pendLeft:     { display: 'flex', flexDirection: 'column', gap: '3px' },
  pendId:       { fontSize: '13px', fontWeight: '800', color: '#1A6B3C', fontFamily: 'monospace' },
  pendAgo:      { fontSize: '11px', color: '#AAAAAA' },
  statusBadge:  { fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' },
  pendCustomer: { display: 'flex', flexDirection: 'column', gap: '5px' },
  pendInfoRow:  { display: 'flex', alignItems: 'center', gap: '6px' },
  pendInfoText: { fontSize: '13px', color: '#444444' },
  pendItems:    { display: 'flex', flexDirection: 'column', gap: '3px' },
  pendItem:     { fontSize: '13px', color: '#333333', margin: 0 },
  pendAmount:   { fontSize: '16px', fontWeight: '800', color: '#1A6B3C', marginTop: '4px' },
  badgeRow:     { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  badge:        { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '20px' },
  warningRow:   { display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#FFF3E0', padding: '7px 10px', borderRadius: '8px' },
  warningText:  { fontSize: '12px', color: '#E65100', fontWeight: '600' },
  pendBtns:     { display: 'flex', gap: '8px' },
  acceptBtn:    { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  declineBtn:   { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545', border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  // Filter chips
  filterRow:       { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  filterChip:      { padding: '7px 16px', borderRadius: '20px', border: '1.5px solid #E0E0E0', backgroundColor: '#FFFFFF', fontSize: '13px', fontWeight: '500', color: '#666666', cursor: 'pointer', fontFamily: 'inherit' },
  filterChipActive:{ borderColor: '#1A6B3C', backgroundColor: '#1A6B3C', color: '#FFFFFF', fontWeight: '700' },

  // Quick actions
  quickScroll: { display: 'flex', gap: '10px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '4px' },
  quickCard:   { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', backgroundColor: '#FFFFFF', border: 'none', borderRadius: '14px', padding: '14px 12px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 5px rgba(0,0,0,0.05)', minWidth: '76px' },
  quickIcon:   { width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  quickLabel:  { fontSize: '11px', fontWeight: '600', color: '#333333', textAlign: 'center', lineHeight: '1.2' },

  // Low stock
  stockCard:   { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #DC3545', padding: '14px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' },
  stockHeader: { display: 'flex', alignItems: 'center', gap: '8px' },
  stockTitle:  { fontSize: '14px', fontWeight: '700', color: '#DC3545', margin: 0 },
  stockList:   { display: 'flex', flexDirection: 'column', gap: '10px' },
  stockRow:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid #F5F5F5' },
  stockName:   { fontSize: '13px', fontWeight: '600', color: '#1A1A1A' },
  stockLeft:   { fontSize: '12px', fontWeight: '700' },
  stockBtn:    { width: '100%', padding: '12px', backgroundColor: '#FFFFFF', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  // Chart / summary card
  chartCard:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' },
  chartHeader:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  chartTotal:     { display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#E8F5EE', padding: '4px 10px', borderRadius: '20px' },
  chartTotalText: { fontSize: '11px', fontWeight: '700', color: '#1A6B3C' },
  chartGrand:     { fontSize: '26px', fontWeight: '800', color: '#1A6B3C', margin: 0 },

  // Earnings tab
  earningsToday:    { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '20px', display: 'flex', alignItems: 'center', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
  earningsStat:     { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' },
  earningsStatVal:  { fontSize: '26px', fontWeight: '800', color: '#1A6B3C', margin: 0 },
  earningsStatLabel:{ fontSize: '12px', color: '#888888', margin: 0 },
  earningsDivider:  { width: '1px', height: '48px', backgroundColor: '#E8E8E8', margin: '0 8px' },
  monthlyCard:      { backgroundColor: '#E8F5EE', borderRadius: '14px', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  monthlyLabel:     { fontSize: '12px', color: '#1A6B3C', fontWeight: '600', margin: '0 0 4px' },
  monthlyVal:       { fontSize: '22px', fontWeight: '800', color: '#1A6B3C', margin: 0 },
  withdrawBtn:      { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  // Profile tab
  profileCard:        { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
  profileAvatar:      { width: '72px', height: '72px', borderRadius: '36px', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  profileAvatarLetter:{ fontSize: '28px', fontWeight: '800', color: '#FFFFFF' },
  profileStoreName:   { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  profileSub:         { fontSize: '13px', color: '#888888', margin: 0 },
  infoCard:           { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '4px 0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', overflow: 'hidden' },
  infoRow:            { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #F5F5F5' },
  infoLabel:          { fontSize: '13px', color: '#888888', margin: 0 },
  infoValue:          { fontSize: '13px', fontWeight: '600', color: '#1A1A1A', margin: 0, textAlign: 'right' },
  editBtn:            { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: '#F0FDF4', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  logoutBtn:          { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: '#DC3545', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  // Bottom nav
  bottomNav: { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' },
  navTab:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', position: 'relative', fontFamily: 'inherit' },
  navBadge:  { position: 'absolute', top: '-4px', right: '-6px', minWidth: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#DC3545', color: '#FFFFFF', fontSize: '9px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' },
  navLabel:  { fontSize: '10px' },
  navDot:    { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
};
