import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Store, ShoppingBag, Clock, IndianRupee,
  AlertTriangle, User, Phone, CheckCircle, X,
  BarChart2, Package, Settings, Plus, TrendingUp,
  Home, ClipboardList, Wallet, UserCircle,
} from 'lucide-react';

// ─── Data ─────────────────────────────────────────────────────
const PENDING_ORDERS = [
  {
    id: 'MED-2024-018',
    ago: '8 min pehle',
    status: 'New Order',
    customer: 'Rahul Kumar',
    phone: '+91 98765XXXXX',
    items: ['Paracetamol 500mg x2', 'Crocin 650mg x1'],
    amount: 125.0,
    badges: [
      { label: '💊 Medicine',    color: '#2563EB', bg: '#EAF2FF' },
      { label: 'Rx ✓',          color: '#1A6B3C', bg: '#E8F5EE' },
      { label: 'Home Delivery', color: '#555555', bg: '#F0F0F0' },
    ],
    warning: null,
  },
  {
    id: 'MED-2024-019',
    ago: '15 min pehle',
    status: 'New Order',
    customer: 'Priya Singh',
    phone: '+91 87654XXXXX',
    items: ['Digital BP Machine x1'],
    amount: 1800.0,
    badges: [
      { label: '🏥 Equipment', color: '#7C3AED', bg: '#F3EEFF' },
      { label: 'No Rx',        color: '#1A6B3C', bg: '#E8F5EE' },
      { label: 'Store Pickup', color: '#555555', bg: '#F0F0F0' },
    ],
    warning: '⏳ Pharmacist Call Pending',
  },
  {
    id: 'MED-2024-020',
    ago: '22 min pehle',
    status: 'New Order',
    customer: 'Amit Verma',
    phone: '+91 76543XXXXX',
    items: ['Prescription Order — 4 items'],
    amount: 892.0,
    badges: [
      { label: '📋 Prescription', color: '#EA6C00', bg: '#FFF3E8' },
      { label: 'Rx Verified ✓',  color: '#1A6B3C', bg: '#E8F5EE' },
      { label: 'Home Delivery',  color: '#555555', bg: '#F0F0F0' },
    ],
    warning: null,
  },
];

const LOW_STOCK = [
  { name: 'Paracetamol 500mg',  left: '10 strips bachi',    urgent: false },
  { name: 'Crocin 650mg',       left: '5 strips bachi',     urgent: true  },
  { name: 'ORS Powder',         left: '3 packets bache',    urgent: true  },
  { name: 'Azithromycin 500mg', left: '8 strips bachi',     urgent: false },
];

const CHART_DATA = [
  { label: '9AM',  value: 450  },
  { label: '11AM', value: 820  },
  { label: '1PM',  value: 1200 },
  { label: '3PM',  value: 980  },
  { label: '5PM',  value: 800  },
];
const CHART_MAX = Math.max(...CHART_DATA.map((d) => d.value));

const QUICK_ACTIONS = [
  { label: 'Sales Report', Icon: BarChart2,  iconColor: '#1A6B3C', bg: '#E8F5EE', route: null },
  { label: 'Inventory',    Icon: Package,    iconColor: '#2563EB', bg: '#EAF2FF', route: '/inventory' },
  { label: 'Order History',Icon: Clock,      iconColor: '#7C3AED', bg: '#F3EEFF', route: '/orders' },
  { label: 'Settings',     Icon: Settings,   iconColor: '#555555', bg: '#F0F0F0', route: null },
  { label: 'Medicine Add', Icon: Plus,       iconColor: '#EA6C00', bg: '#FFF3E8', route: null },
];

const NAV_TABS = [
  { id: 'home',      Icon: Home,          label: 'Home',      badge: null, route: '/seller-dashboard' },
  { id: 'orders',    Icon: ClipboardList, label: 'Orders',    badge: 3,    route: '/orders'           },
  { id: 'inventory', Icon: Package,       label: 'Inventory', badge: null, route: '/inventory'        },
  { id: 'earnings',  Icon: Wallet,        label: 'Earnings',  badge: null, route: null                },
  { id: 'profile',   Icon: UserCircle,    label: 'Profile',   badge: null, route: '/profile'          },
];

// ─── Pending Order Card ───────────────────────────────────────
function PendingCard({ order, onAccept, onDecline }) {
  return (
    <div style={s.pendCard}>
      {/* Top */}
      <div style={s.pendTop}>
        <div style={s.pendLeft}>
          <span style={s.pendId}>#{order.id}</span>
          <span style={s.pendStatusDot}>🟡 {order.status}</span>
        </div>
        <span style={s.pendAgo}>{order.ago}</span>
      </div>

      {/* Customer */}
      <div style={s.pendCustomer}>
        <div style={s.pendInfoRow}>
          <User size={13} color="#888888" />
          <span style={s.pendInfoText}>{order.customer}</span>
        </div>
        <div style={s.pendInfoRow}>
          <Phone size={13} color="#888888" />
          <span style={s.pendInfoText}>{order.phone}</span>
        </div>
      </div>

      {/* Items */}
      <div style={s.pendItems}>
        {order.items.map((it) => (
          <p key={it} style={s.pendItem}>• {it}</p>
        ))}
        <span style={s.pendAmount}>₹{order.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>

      {/* Badges */}
      <div style={s.badgeRow}>
        {order.badges.map((b) => (
          <span key={b.label} style={{ ...s.badge, color: b.color, backgroundColor: b.bg }}>
            {b.label}
          </span>
        ))}
      </div>

      {/* Warning */}
      {order.warning && (
        <div style={s.warningRow}>
          <AlertTriangle size={13} color="#EA6C00" />
          <span style={s.warningText}>{order.warning}</span>
        </div>
      )}

      {/* Buttons */}
      <div style={s.pendBtns}>
        <button style={s.acceptBtn} onClick={() => onAccept(order.id)}>
          <CheckCircle size={15} color="#FFFFFF" />
          Accept
        </button>
        <button style={s.declineBtn} onClick={() => onDecline(order.id)}>
          <X size={15} color="#DC3545" />
          Decline
        </button>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function SellerDashboard() {
  const navigate = useNavigate();
  const [storeOpen, setStoreOpen]     = useState(true);
  const [orders, setOrders]           = useState(PENDING_ORDERS);
  const [activeTab, setActiveTab]     = useState('home');

  const acceptOrder  = (id) => setOrders((o) => o.filter((x) => x.id !== id));
  const declineOrder = (id) => setOrders((o) => o.filter((x) => x.id !== id));

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.greet}>Namaste 🙏</p>
            <p style={s.storeName}>Shri Ram Medical Store</p>
            <p style={s.storeCity}>Deoria, UP</p>
          </div>
          <div style={s.headerRight}>
            <button
              style={s.pharmacistBtn}
              onClick={() => navigate('/pharmacist')}
            >
              Pharmacist View
            </button>
            <button
              style={s.adminBtn}
              onClick={() => navigate('/admin')}
            >
              Admin View
            </button>
            <button style={s.iconBtn}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                <span style={s.notifDot} />
              </div>
            </button>
            <div style={s.avatar}><span style={s.avatarLetter}>S</span></div>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Store Status */}
          <div style={s.storeCard}>
            <div style={s.storeCardLeft}>
              <div style={s.storeIconBox}>
                <Store size={22} color="#1A6B3C" />
              </div>
              <div>
                <p style={s.storeLabel}>Aapki Dukaan</p>
                <p style={s.storeSince}>Aaj 8:00 AM se khuli hai</p>
              </div>
            </div>
            <button
              style={{ ...s.toggle, backgroundColor: storeOpen ? '#1A6B3C' : '#DC3545' }}
              onClick={() => setStoreOpen((v) => !v)}
              aria-label="Toggle store"
            >
              <div style={{ ...s.toggleThumb, transform: storeOpen ? 'translateX(24px)' : 'translateX(0)' }} />
              <span style={s.toggleLabel}>{storeOpen ? 'Khuli Hai' : 'Band Hai'}</span>
            </button>
          </div>

          {/* Metrics Grid */}
          <div style={s.metricsGrid}>
            {[
              { Icon: ShoppingBag,    val: '12',    label: 'Aaj Ke Orders',  bg: '#E8F5EE', color: '#1A6B3C', pulse: false },
              { Icon: Clock,          val: orders.length, label: 'Pending Orders', bg: '#FFF3E0', color: '#E65100', pulse: true  },
              { Icon: IndianRupee,    val: '₹4,250', label: 'Aaj Ki Kamai',  bg: '#EAF2FF', color: '#2563EB', pulse: false },
              { Icon: AlertTriangle,  val: '5',     label: 'Low Stock',     bg: '#FFEBEE', color: '#DC3545', pulse: false },
            ].map(({ Icon, val, label, bg, color, pulse }) => (
              <div key={label} style={{ ...s.metricCard, backgroundColor: bg }}>
                <div style={s.metricIconRow}>
                  <Icon size={18} color={color} />
                  {pulse && orders.length > 0 && <span style={{ ...s.pulseDot, backgroundColor: color }} />}
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
              <span style={s.sectionSub}>{orders.length} order{orders.length !== 1 ? 's' : ''} pending</span>
            </div>

            {orders.length === 0 ? (
              <div style={s.noPending}>
                <CheckCircle size={32} color="#1A6B3C" />
                <p style={s.noPendingText}>Sab orders handle ho gaye!</p>
              </div>
            ) : (
              <div style={s.pendingList}>
                {orders.map((o) => (
                  <PendingCard key={o.id} order={o} onAccept={acceptOrder} onDecline={declineOrder} />
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div style={s.section}>
            <p style={s.sectionTitle}>Quick Actions</p>
            <div style={s.quickScroll}>
              {QUICK_ACTIONS.map(({ label, Icon, iconColor, bg, route }) => (
                <button
                  key={label}
                  style={s.quickCard}
                  onClick={() => route && navigate(route)}
                >
                  <div style={{ ...s.quickIcon, backgroundColor: bg }}>
                    <Icon size={20} color={iconColor} />
                  </div>
                  <span style={s.quickLabel}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Low Stock */}
          <div style={s.stockCard}>
            <div style={s.stockHeader}>
              <AlertTriangle size={16} color="#DC3545" />
              <p style={s.stockTitle}>Stock Khatam Hone Wala</p>
            </div>
            <div style={s.stockList}>
              {LOW_STOCK.map((item) => (
                <div key={item.name} style={s.stockRow}>
                  <span style={s.stockName}>{item.name}</span>
                  <span style={{ ...s.stockLeft, color: item.urgent ? '#DC3545' : '#E65100' }}>
                    {item.left}
                  </span>
                </div>
              ))}
            </div>
            <button style={s.stockBtn} onClick={() => navigate('/inventory')}>
              Inventory Update Karo
            </button>
          </div>

          {/* Earnings Chart */}
          <div style={s.chartCard}>
            <div style={s.chartHeader}>
              <p style={s.sectionTitle}>Aaj Ki Kamai</p>
              <div style={s.chartTotal}>
                <TrendingUp size={14} color="#1A6B3C" />
                <span style={s.chartTotalText}>Kal se 23% zyada</span>
              </div>
            </div>
            <p style={s.chartGrand}>₹4,250</p>

            {/* Bars */}
            <div style={s.chartArea}>
              {CHART_DATA.map((d) => {
                const pct = (d.value / CHART_MAX) * 100;
                return (
                  <div key={d.label} style={s.barCol}>
                    <span style={s.barVal}>
                      ₹{d.value >= 1000 ? `${(d.value / 1000).toFixed(1)}k` : d.value}
                    </span>
                    <div style={s.barTrack}>
                      <div style={{ ...s.barFill, height: `${pct}%` }} />
                    </div>
                    <span style={s.barLabel}>{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, badge, route }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                style={s.navTab}
                onClick={() => { setActiveTab(id); if (route) navigate(route); }}
              >
                <div style={{ position: 'relative' }}>
                  <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'}
                    strokeWidth={isActive ? 2.5 : 1.8} />
                  {badge > 0 && (
                    <span style={s.navBadge}>{badge}</span>
                  )}
                </div>
                <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA',
                  fontWeight: isActive ? '600' : '400' }}>
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
  wrapper: {
    minHeight: '100vh',
    backgroundColor: '#F5F5F5',
    display: 'flex',
    justifyContent: 'center',
  },
  screen: {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: '#F5F5F5',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '16px 16px 14px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  greet:     { fontSize: '12px', color: '#888888', margin: 0 },
  storeName: { fontSize: '16px', fontWeight: '800', color: '#1A1A1A', margin: '1px 0' },
  storeCity: { fontSize: '12px', color: '#888888', margin: 0 },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  pharmacistBtn: {
    padding: '5px 10px', backgroundColor: '#F3EEFF',
    border: '1px solid #7C3AED', borderRadius: '20px',
    fontSize: '11px', fontWeight: '700', color: '#7C3AED',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  adminBtn: {
    padding: '5px 10px', backgroundColor: '#FFEBEE',
    border: '1px solid #DC3545', borderRadius: '20px',
    fontSize: '11px', fontWeight: '700', color: '#DC3545',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    padding: '6px',
    cursor: 'pointer',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#EF4444',
    border: '1.5px solid #FFFFFF',
  },
  avatar: {
    width: '38px',
    height: '38px',
    borderRadius: '19px',
    backgroundColor: '#1A6B3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: '16px',
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Body
  body: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px',
  },

  // Store card
  storeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeft: '4px solid #1A6B3C',
    boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
  },
  storeCardLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  storeIconBox: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeLabel: { fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  storeSince: { fontSize: '11px', color: '#888888', margin: 0, marginTop: '2px' },
  toggle: {
    width: '72px',
    height: '32px',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    padding: '0 6px',
    flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute',
    left: '4px',
    width: '24px',
    height: '24px',
    borderRadius: '12px',
    backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    transition: 'transform 0.3s ease',
  },
  toggleLabel: {
    fontSize: '9px',
    fontWeight: '800',
    color: '#FFFFFF',
    marginLeft: 'auto',
    letterSpacing: '0.3px',
    userSelect: 'none',
  },

  // Metrics
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
  },
  metricCard: {
    borderRadius: '14px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metricIconRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    animation: 'pulse 1.4s ease-in-out infinite',
  },
  metricVal: {
    fontSize: '26px',
    fontWeight: '800',
    margin: '4px 0 0',
    lineHeight: 1,
  },
  metricLabel: {
    fontSize: '11px',
    color: '#555555',
    fontWeight: '500',
    margin: 0,
  },

  // Section
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  urgentDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#DC3545',
    animation: 'pulse 1.2s ease-in-out infinite',
    flexShrink: 0,
    display: 'inline-block',
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
  },
  sectionSub: {
    fontSize: '12px',
    color: '#888888',
  },
  noPending: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
  },
  noPendingText: {
    fontSize: '14px',
    color: '#1A6B3C',
    fontWeight: '600',
    margin: 0,
  },
  pendingList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },

  // Pending card
  pendCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    borderLeft: '4px solid #E65100',
    padding: '14px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  pendTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  pendLeft: { display: 'flex', flexDirection: 'column', gap: '3px' },
  pendId: { fontSize: '13px', fontWeight: '800', color: '#1A6B3C', fontFamily: 'monospace' },
  pendStatusDot: { fontSize: '12px', color: '#E65100', fontWeight: '600' },
  pendAgo: { fontSize: '11px', color: '#AAAAAA' },
  pendCustomer: { display: 'flex', flexDirection: 'column', gap: '5px' },
  pendInfoRow: { display: 'flex', alignItems: 'center', gap: '6px' },
  pendInfoText: { fontSize: '13px', color: '#444444' },
  pendItems: { display: 'flex', flexDirection: 'column', gap: '3px' },
  pendItem: { fontSize: '13px', color: '#333333', margin: 0 },
  pendAmount: { fontSize: '16px', fontWeight: '800', color: '#1A6B3C', marginTop: '4px' },
  badgeRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  badge: {
    fontSize: '11px',
    fontWeight: '600',
    padding: '3px 9px',
    borderRadius: '20px',
  },
  warningRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#FFF3E0',
    padding: '7px 10px',
    borderRadius: '8px',
  },
  warningText: { fontSize: '12px', color: '#E65100', fontWeight: '600' },
  pendBtns: { display: 'flex', gap: '8px' },
  acceptBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '11px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  declineBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '11px',
    backgroundColor: '#FFFFFF',
    color: '#DC3545',
    border: '1.5px solid #DC3545',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Quick actions
  quickScroll: {
    display: 'flex',
    gap: '10px',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    paddingBottom: '4px',
  },
  quickCard: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '7px',
    backgroundColor: '#FFFFFF',
    border: 'none',
    borderRadius: '14px',
    padding: '14px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
    minWidth: '76px',
  },
  quickIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#333333',
    textAlign: 'center',
    lineHeight: '1.2',
  },

  // Low stock
  stockCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    borderLeft: '4px solid #DC3545',
    padding: '14px 16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  stockHeader: { display: 'flex', alignItems: 'center', gap: '8px' },
  stockTitle: { fontSize: '14px', fontWeight: '700', color: '#DC3545', margin: 0 },
  stockList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  stockRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '10px',
    borderBottom: '1px solid #F5F5F5',
  },
  stockName: { fontSize: '13px', fontWeight: '600', color: '#1A1A1A' },
  stockLeft: { fontSize: '12px', fontWeight: '700' },
  stockBtn: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#FFFFFF',
    color: '#1A6B3C',
    border: '1.5px solid #1A6B3C',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Earnings chart
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  chartHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartTotal: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: '#E8F5EE',
    padding: '4px 10px',
    borderRadius: '20px',
  },
  chartTotalText: { fontSize: '11px', fontWeight: '700', color: '#1A6B3C' },
  chartGrand: { fontSize: '26px', fontWeight: '800', color: '#1A6B3C', margin: 0 },
  chartArea: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: '6px',
    height: '120px',
  },
  barCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    height: '100%',
  },
  barVal: {
    fontSize: '9px',
    color: '#888888',
    fontWeight: '600',
    whiteSpace: 'nowrap',
  },
  barTrack: {
    flex: 1,
    width: '100%',
    backgroundColor: '#F0F0F0',
    borderRadius: '6px 6px 0 0',
    display: 'flex',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#1A6B3C',
    borderRadius: '4px 4px 0 0',
    transition: 'height 0.6s ease',
  },
  barLabel: {
    fontSize: '10px',
    color: '#AAAAAA',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },

  // Bottom nav
  bottomNav: {
    position: 'sticky',
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTop: '1px solid #F0F0F0',
    display: 'flex',
    padding: '8px 0 12px',
    boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
  },
  navTab: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 0',
    position: 'relative',
    fontFamily: 'inherit',
  },
  navBadge: {
    position: 'absolute',
    top: '-4px',
    right: '-6px',
    minWidth: '16px',
    height: '16px',
    borderRadius: '8px',
    backgroundColor: '#DC3545',
    color: '#FFFFFF',
    fontSize: '9px',
    fontWeight: '800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 3px',
  },
  navLabel: { fontSize: '10px' },
  navDot: {
    position: 'absolute',
    top: '-8px',
    width: '20px',
    height: '3px',
    backgroundColor: '#1A6B3C',
    borderRadius: '2px',
  },
};
