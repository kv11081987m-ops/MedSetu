import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Bell, Users, Store, ShoppingBag, IndianRupee, AlertTriangle,
  FileText, Settings, Download, CheckCircle, X, ChevronRight,
  LayoutDashboard, LogOut, Trash2, Power,
} from 'lucide-react';

// ─── Static Data ──────────────────────────────────────────────
const METRIC_CARDS = [
  { Icon: Users,         val: '1,247',   label: 'Total Users',     sub: '+23 aaj',            subColor: '#1A6B3C', color: '#1A6B3C', bg: '#E8F5EE' },
  { Icon: Store,         val: '34',      label: 'Active Sellers',  sub: '3 pending approval', subColor: '#E65100', color: '#2563EB', bg: '#EAF2FF' },
  { Icon: ShoppingBag,   val: '89',      label: 'Aaj Ke Orders',   sub: '+12% kal se',         subColor: '#1A6B3C', color: '#7C3AED', bg: '#F3EEFF' },
  { Icon: IndianRupee,   val: '₹45,280', label: 'Aaj Ka GMV',      sub: '+18% kal se',         subColor: '#1A6B3C', color: '#E65100', bg: '#FFF3E0' },
  { Icon: AlertTriangle, val: '7',       label: 'Open Disputes',   sub: '2 urgent',            subColor: '#DC3545', color: '#DC3545', bg: '#FFEBEE' },
];

const WEEK_BARS = [
  { day: 'Mon', val: 45 }, { day: 'Tue', val: 67 }, { day: 'Wed', val: 89 },
  { day: 'Thu', val: 72 }, { day: 'Fri', val: 95 }, { day: 'Sat', val: 110 }, { day: 'Sun', val: 88 },
];
const MAX_BAR = 110;

const DISTRICTS = [
  { name: 'Deoria',      sellers: 18, pct: 75, color: '#1A6B3C' },
  { name: 'Gorakhpur',   sellers: 10, pct: 42, color: '#2563EB' },
  { name: 'Kushinagar',  sellers: 4,  pct: 17, color: '#E65100' },
  { name: 'Maharajganj', sellers: 2,  pct: 8,  color: '#888888' },
];

const TOP_MEDS = [
  'Paracetamol — 234 orders', 'ORS Powder — 187 orders',
  'Azithromycin — 156 orders', 'BP Machine — 89 orders',
];

const ACTIVITY = [
  { color: '#1A6B3C', text: 'New seller approved: Ram Medical, Deoria',       time: '10 min ago'      },
  { color: '#2563EB', text: 'Order #MED-2024-089 delivered',                   time: '15 min ago'      },
  { color: '#F59E0B', text: 'Dispute #D-089 opened',                          time: '32 min ago'      },
  { color: '#1A6B3C', text: 'New user registered: Sunita Devi',               time: '45 min ago'      },
  { color: '#DC3545', text: 'Seller rejected: XYZ Medical (incomplete docs)', time: '1 ghanta pehle'  },
];

const QUICK_ACTIONS = [
  { Icon: Users,    label: 'Users Manage',      color: '#2563EB', bg: '#EAF2FF' },
  { Icon: Store,    label: 'Sellers Manage',    color: '#1A6B3C', bg: '#E8F5EE' },
  { Icon: FileText, label: 'Reports',           color: '#7C3AED', bg: '#F3EEFF' },
  { Icon: Settings, label: 'Platform Settings', color: '#555555', bg: '#F0F0F0' },
  { Icon: Bell,     label: 'Notif Send',        color: '#E65100', bg: '#FFF3E0' },
  { Icon: Download, label: 'Data Export',       color: '#0D9488', bg: '#CCFBF1' },
];

const NAV_TABS_DEF = [
  { id: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'sellers',   Icon: Store,           label: 'Sellers'   },
  { id: 'orders',    Icon: ShoppingBag,     label: 'Orders'    },
  { id: 'disputes',  Icon: AlertTriangle,   label: 'Disputes'  },
  { id: 'settings',  Icon: Settings,        label: 'Settings'  },
];


const ALL_ORDERS = [
  { id: 'MED-2024-093', customer: 'Geeta Kumari', store: 'Ram Medical Store',  amount: '₹567',   status: 'pending',    time: 'Aaj, 2:30 PM'  },
  { id: 'MED-2024-092', customer: 'Mohan Lal',    store: 'Shyam Medical',      amount: '₹1,200', status: 'processing', time: 'Aaj, 1:45 PM'  },
  { id: 'MED-2024-091', customer: 'Sunita Devi',  store: 'City Medical',       amount: '₹234',   status: 'processing', time: 'Aaj, 12:20 PM' },
  { id: 'MED-2024-090', customer: 'Priya Singh',  store: 'Arogya Medical',     amount: '₹892',   status: 'delivered',  time: 'Aaj, 11:05 AM' },
  { id: 'MED-2024-089', customer: 'Ramesh Kumar', store: 'Ram Medical Store',  amount: '₹450',   status: 'delivered',  time: 'Kal, 4:30 PM'  },
  { id: 'MED-2024-088', customer: 'Raj Kumar',    store: 'City Medical Store', amount: '₹320',   status: 'cancelled',  time: 'Kal, 10:00 AM' },
];

const ALL_DISPUTES_INIT = [
  { id: 'D-089', customer: 'Ramesh Kumar', seller: 'Arogya Medical Hall', issue: 'Wrong medicine delivered', amount: '450', status: 'open'        },
  { id: 'D-088', customer: 'Priya Singh',  seller: 'City Medical Store',  issue: 'Delivery nahi hua',        amount: '892', status: 'in-progress'  },
  { id: 'D-087', customer: 'Mohan Lal',   seller: 'Ram Medical Store',   issue: 'Medicine expired thi',     amount: '234', status: 'resolved'     },
];

const INIT_NOTIFS = [
  { id: 1, dotColor: '#1A6B3C', title: 'Naya seller registration:', subtitle: 'Ram Medical, Deoria', time: '10 min pehle',   read: false },
  { id: 2, dotColor: '#E65100', title: 'Dispute #D-089 open hua',   subtitle: '',                    time: '32 min pehle',   read: false },
  { id: 3, dotColor: '#888888', title: 'Order #MED-089 delivered',  subtitle: '',                    time: '1 ghanta pehle', read: true  },
  { id: 4, dotColor: '#888888', title: 'Naya user registered',      subtitle: '',                    time: '2 ghante pehle', read: true  },
];

// ─── Status Badge ─────────────────────────────────────────────
const STATUS_MAP = {
  approved:      { bg: '#E8F5EE', color: '#1A6B3C', label: 'APPROVED'    },
  pending:       { bg: '#FFF3E0', color: '#E65100', label: 'PENDING'     },
  rejected:      { bg: '#FFEBEE', color: '#DC3545', label: 'REJECTED'    },
  processing:    { bg: '#EAF2FF', color: '#2563EB', label: 'PROCESSING'  },
  delivered:     { bg: '#E8F5EE', color: '#1A6B3C', label: 'DELIVERED'   },
  cancelled:     { bg: '#F5F5F5', color: '#888888', label: 'CANCELLED'   },
  open:          { bg: '#FFEBEE', color: '#DC3545', label: 'OPEN'        },
  'in-progress': { bg: '#FFF3E0', color: '#E65100', label: 'IN PROGRESS' },
  resolved:      { bg: '#E8F5EE', color: '#1A6B3C', label: 'RESOLVED'   },
};

function StatusBadge({ status }) {
  const { bg, color, label } = STATUS_MAP[status] || { bg: '#F5F5F5', color: '#888888', label: String(status).toUpperCase() };
  return (
    <span style={{ fontSize: '10px', fontWeight: '800', color, backgroundColor: bg, padding: '3px 9px', borderRadius: '20px', flexShrink: 0 }}>
      {label}
    </span>
  );
}

// ─── Filter Chips ─────────────────────────────────────────────
function FilterChips({ options, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
      {options.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          style={{
            padding: '6px 14px', borderRadius: '20px', flexShrink: 0,
            border: active === value ? '1.5px solid #1A6B3C' : '1.5px solid #E0E0E0',
            backgroundColor: active === value ? '#E8F5EE' : '#FFFFFF',
            color: active === value ? '#1A6B3C' : '#888888',
            fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Seller Approval Card (dashboard) ────────────────────────
function SellerCard({ seller, onApprove, onReject }) {
  const disabled = !seller.canApprove;
  return (
    <div style={{ ...s.sellerCard, borderLeftColor: '#E65100' }}>
      <div style={s.cardTopRow}>
        <div>
          <p style={s.sellerName}>{seller.name}</p>
          <p style={s.sellerSub}>Submitted: {seller.submitted}</p>
        </div>
        <span style={s.pendingBadge}>PENDING</span>
      </div>
      <div style={s.infoGrid}>
        {seller.info.map(({ label, val }) => (
          <div key={label} style={s.infoRow}>
            <span style={s.infoLabel}>{label}:</span>
            <span style={s.infoVal}>{val}</span>
          </div>
        ))}
      </div>
      <div style={s.docsBlock}>
        {seller.docs.map(({ text, ok }) => (
          <div key={text} style={s.docRow}>
            {ok ? <CheckCircle size={13} color="#1A6B3C" /> : <X size={13} color="#DC3545" />}
            <span style={{ fontSize: '12px', color: ok ? '#1A6B3C' : '#DC3545', fontWeight: '600' }}>{text}</span>
          </div>
        ))}
        <button style={s.viewDocsBtn}>View Documents →</button>
      </div>
      {seller.warning && (
        <div style={s.warnRow}>
          <X size={13} color="#DC3545" />
          <span style={s.warnText}>{seller.warning}</span>
        </div>
      )}
      <div style={s.sellerBtns}>
        <button
          style={{ ...s.approveBtn, opacity: disabled ? 0.45 : 1 }}
          disabled={disabled}
          onClick={() => !disabled && onApprove(seller.id)}
        >
          <CheckCircle size={14} color="#FFFFFF" /> Approve Karo
        </button>
        <button style={s.rejectBtn} onClick={() => onReject(seller.id)}>
          <X size={14} color="#DC3545" /> Reject Karo
        </button>
      </div>
      <button style={s.moreInfoBtn}>
        <AlertTriangle size={13} color="#E65100" /> More Info Maango
      </button>
    </div>
  );
}

// ─── Dispute Card (dashboard) ─────────────────────────────────
function DisputeCard({ d, onResolve }) {
  return (
    <div style={{ ...s.disputeCard, borderLeftColor: d.urgent ? '#DC3545' : '#E65100' }}>
      <div style={s.cardTopRow}>
        <div>
          <p style={s.disputeId}>{d.id}</p>
          <p style={s.disputeSub}>Customer: {d.customer} · Seller: {d.seller}</p>
        </div>
        {d.urgent && <span style={s.urgentBadge}>URGENT</span>}
      </div>
      <p style={s.disputeIssue}>"{d.issue}"</p>
      <div style={s.disputeMeta}>
        <span style={s.amtPill}>₹{d.amount}</span>
        <span style={{ fontSize: '12px', color: d.urgent ? '#DC3545' : '#E65100', fontWeight: '600' }}>{d.since}</span>
      </div>
      <div style={s.disputeBtns}>
        <button style={s.resolveBtn} onClick={() => onResolve(d.id)}>
          <CheckCircle size={14} color="#FFFFFF" /> Resolve Karo
        </button>
        <button style={s.detailsBtn}>Details Dekho <ChevronRight size={13} /></button>
      </div>
    </div>
  );
}

// ─── Seller List Card (sellers tab) ──────────────────────────
function SellerListCard({ seller, onApprove, onReject }) {
  const borderColor = seller.status === 'approved' ? '#1A6B3C' : seller.status === 'rejected' ? '#DC3545' : '#E65100';
  return (
    <div style={{ ...s.sellerCard, borderLeftColor: borderColor }}>
      <div style={s.cardTopRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={s.sellerName}>{seller.name}</p>
          <p style={s.sellerSub}>{seller.owner}</p>
        </div>
        <StatusBadge status={seller.status} />
      </div>
      <div style={s.infoGrid}>
        <div style={s.infoRow}>
          <span style={s.infoLabel}>Location:</span>
          <span style={s.infoVal}>{seller.location}</span>
        </div>
        <div style={s.infoRow}>
          <span style={s.infoLabel}>Drug License:</span>
          <span style={s.infoVal}>{seller.license}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {seller.status === 'pending' && (
          <>
            <button style={{ ...s.approveBtn, flex: 'none', padding: '9px 16px', fontSize: '12px' }} onClick={() => onApprove(seller.id)}>
              <CheckCircle size={13} color="#FFFFFF" /> Approve
            </button>
            <button style={{ ...s.rejectBtn, flex: 'none', padding: '9px 16px', fontSize: '12px' }} onClick={() => onReject(seller.id)}>
              <X size={13} color="#DC3545" /> Reject
            </button>
          </>
        )}
        <button style={{ ...s.detailsBtn, marginLeft: 'auto' }}>Details Dekho <ChevronRight size={13} /></button>
      </div>
    </div>
  );
}

// ─── Order Card (orders tab) ──────────────────────────────────
function OrderCard({ order }) {
  const borderColor = { pending: '#E65100', processing: '#2563EB', delivered: '#1A6B3C', cancelled: '#AAAAAA' }[order.status] || '#CCCCCC';
  return (
    <div style={{ ...s.disputeCard, borderLeftColor: borderColor }}>
      <div style={s.cardTopRow}>
        <div>
          <p style={s.disputeId}>{order.id}</p>
          <p style={s.disputeSub}>{order.customer}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: '#444444' }}>{order.store}</span>
        <span style={s.amtPill}>{order.amount}</span>
      </div>
      <p style={{ fontSize: '12px', color: '#888888', margin: 0 }}>{order.time}</p>
    </div>
  );
}

// ─── Dispute Tab Card ─────────────────────────────────────────
function DisputeTabCard({ d, onResolve }) {
  const borderColor = d.status === 'open' ? '#DC3545' : d.status === 'in-progress' ? '#E65100' : '#1A6B3C';
  return (
    <div style={{ ...s.disputeCard, borderLeftColor: borderColor }}>
      <div style={s.cardTopRow}>
        <div>
          <p style={s.disputeId}>Dispute #{d.id}</p>
          <p style={s.disputeSub}>Customer: {d.customer} · Seller: {d.seller}</p>
        </div>
        <StatusBadge status={d.status} />
      </div>
      <p style={s.disputeIssue}>"{d.issue}"</p>
      <div style={s.disputeMeta}>
        <span style={s.amtPill}>₹{d.amount}</span>
      </div>
      <div style={s.disputeBtns}>
        {d.status !== 'resolved' && (
          <button style={s.resolveBtn} onClick={() => onResolve(d.id)}>
            <CheckCircle size={14} color="#FFFFFF" /> Resolve Karo
          </button>
        )}
        <button style={s.detailsBtn}>Details Dekho <ChevronRight size={13} /></button>
      </div>
    </div>
  );
}

// ─── DB mappers ───────────────────────────────────────────────
const mapDispute = (d, i) => ({
  id:       `D-${String(d.id).slice(0, 8).toUpperCase()}`,
  customer: d.users?.name          || d.customer_name || 'Customer',
  seller:   d.sellers?.store_name  || d.seller_name   || 'Seller',
  issue:    d.description          || d.issue         || 'Issue reported',
  amount:   String(d.amount        || d.order_amount  || 0),
  status:   d.status               || 'open',
  since:    d.created_at ? `${Math.floor((Date.now() - new Date(d.created_at)) / 86400000)} din pehle` : '—',
  urgent:   i === 0 && d.status === 'open',
});

const mapOrderCard = (order) => ({
  id:       order.order_number || String(order.id).slice(0, 8).toUpperCase(),
  customer: order.customer_name || 'Customer',
  store:    order.sellers?.store_name || 'Store',
  amount:   `₹${(order.final_amount || 0).toLocaleString('en-IN')}`,
  status:   order.status,
  time:     order.created_at
    ? new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '—',
});

const mapSellerList = (s) => ({
  id:       s.id,
  name:     s.store_name  || 'Medical Store',
  owner:    s.owner_name  || '—',
  location: s.district    || s.address || '—',
  license:  s.drug_license || 'Pending',
  status:   s.is_verified ? 'approved' : 'pending',
});

// ─── Main Screen ──────────────────────────────────────────────
export default function AdminPanel() {
  const navigate = useNavigate();
  const { handleLogout: authLogout } = useAuth();

  // ── DB-driven state ──────────────────────────────────────────
  const [stats, setStats] = useState({
    totalUsers: 0, activeSellers: 0, pendingSellers: 0,
    todayOrders: 0, todayGMV: 0, openDisputes: 0,
  });
  const [pendingSellers,  setPendingSellers]  = useState([]);
  const [allDbSellers,    setAllDbSellers]    = useState([]);
  const [allOrders,       setAllOrders]       = useState([]);
  const [loading,         setLoading]         = useState(true);

  // ── UI state ─────────────────────────────────────────────────
  const [disputes,      setDisputes]     = useState([]);
  const [settings,      setSettings]     = useState({ registrations: true, delivery: true, pharmCall: true, maintenance: false });
  const [activeTab,     setActiveTab]    = useState('dashboard');
  const [sellerFilter,  setSellerFilter] = useState('sab');
  const [orderFilter,   setOrderFilter]  = useState('sab');
  const [allDisputes,   setAllDisputes]  = useState(ALL_DISPUTES_INIT);
  const [disputeFilter, setDisputeFilter]= useState('open');
  const [notifications, setNotifications]= useState(INIT_NOTIFS);
  const [notifOpen,     setNotifOpen]    = useState(false);

  // ── Fetch ────────────────────────────────────────────────────
  const fetchAdminData = async () => {
    try {
      const { count: userCount } = await supabase
        .from('users').select('*', { count: 'exact', head: true });

      const { data: sellers } = await supabase.from('sellers').select('*');
      const pending = sellers?.filter((s) => !s.is_verified) || [];
      const active  = sellers?.filter((s) =>  s.is_verified) || [];
      setPendingSellers(pending);
      setAllDbSellers(sellers || []);

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { data: orders } = await supabase
        .from('orders')
        .select('*, sellers(store_name)')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });
      setAllOrders(orders || []);

      const gmv = orders?.reduce((sum, o) => sum + (o.final_amount || 0), 0) || 0;

      // Fetch disputes (table may not exist — fail silently)
      let openDisputeCount = 0;
      try {
        const { data: dbDisputes } = await supabase
          .from('disputes')
          .select('*, users(name), sellers(store_name)')
          .order('created_at', { ascending: false });
        if (dbDisputes && dbDisputes.length > 0) {
          const mappedAll  = dbDisputes.map(mapDispute);
          const openOnly   = mappedAll.filter((d) => d.status === 'open');
          openDisputeCount = openOnly.length;
          setAllDisputes(mappedAll);
          setDisputes(openOnly);
        }
      } catch {}

      setStats({
        totalUsers:    userCount  || 0,
        activeSellers: active.length,
        pendingSellers:pending.length,
        todayOrders:   orders?.length || 0,
        todayGMV:      gmv,
        openDisputes:  openDisputeCount,
      });
    } catch (err) {
      console.error('Admin fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAdminData(); }, []);

  // ── Handlers ─────────────────────────────────────────────────
  const approveSeller = async (sellerId) => {
    const { error } = await supabase
      .from('sellers').update({ is_verified: true }).eq('id', sellerId);
    if (!error) {
      setPendingSellers((prev) => prev.filter((s) => s.id !== sellerId));
      setAllDbSellers((prev) => prev.map((s) => s.id === sellerId ? { ...s, is_verified: true } : s));
      setStats((prev) => ({ ...prev, activeSellers: prev.activeSellers + 1, pendingSellers: Math.max(0, prev.pendingSellers - 1) }));
      alert('Seller approve ho gaya!');
    }
  };

  const rejectSeller = async (sellerId) => {
    const { error } = await supabase.from('sellers').delete().eq('id', sellerId);
    if (!error) {
      setPendingSellers((prev) => prev.filter((s) => s.id !== sellerId));
      setAllDbSellers((prev) => prev.filter((s) => s.id !== sellerId));
      setStats((prev) => ({ ...prev, pendingSellers: Math.max(0, prev.pendingSellers - 1) }));
    }
  };

  const handleResolve       = (id) => setDisputes((d)  => d.filter((x) => x.id !== id));
  const toggleSetting       = (key)=> setSettings((prev)=> ({ ...prev, [key]: !prev[key] }));
  const handleResolveTab    = (id) => setAllDisputes((prev) => prev.map((d) => d.id === id ? { ...d, status: 'resolved' } : d));

  const unreadCount   = notifications.filter((n) => !n.read).length;
  const markAllRead   = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  const handleBellClick = () => setNotifOpen((prev) => !prev);
  const handleLogout  = async () => { await authLogout(); navigate('/login'); };

  const totalWeek = WEEK_BARS.reduce((a, b) => a + b.val, 0);

  const mappedSellers    = allDbSellers.map(mapSellerList);
  const filteredSellers  = sellerFilter === 'sab' ? mappedSellers : mappedSellers.filter((s) => s.status === sellerFilter);
  const mappedOrders     = allOrders.map(mapOrderCard);
  const filteredOrders   = orderFilter  === 'sab' ? mappedOrders  : mappedOrders.filter((o) => o.status === orderFilter);
  const filteredDisputes = allDisputes.filter((d) => d.status === disputeFilter);

  // ─── Tab renderers ────────────────────────────────────────
  const renderDashboard = () => (
    <>
      <div style={{ backgroundColor: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: '10px', padding: '8px 14px', margin: '0 0 4px', fontSize: '12px', color: '#E65100', textAlign: 'center', fontWeight: '600' }}>
        ⚠️ Kuch data abhi demo hai — real data jald aayega
      </div>
      <div style={s.hScroll}>
        {[
          { Icon: Users,         val: stats.totalUsers.toLocaleString('en-IN'), label: 'Total Users',    sub: 'Registered users',                        subColor: '#1A6B3C', color: '#1A6B3C', bg: '#E8F5EE' },
          { Icon: Store,         val: `${stats.activeSellers} (${stats.pendingSellers} pending)`, label: 'Sellers', sub: 'Verified + pending',            subColor: '#E65100', color: '#2563EB', bg: '#EAF2FF' },
          { Icon: ShoppingBag,   val: stats.todayOrders,                        label: 'Aaj Ke Orders',  sub: 'Today only',                              subColor: '#1A6B3C', color: '#7C3AED', bg: '#F3EEFF' },
          { Icon: IndianRupee,   val: `₹${stats.todayGMV.toLocaleString('en-IN')}`, label: 'Aaj Ka GMV', sub: 'Today revenue',                          subColor: '#1A6B3C', color: '#E65100', bg: '#FFF3E0' },
          { Icon: AlertTriangle, val: stats.openDisputes,                       label: 'Open Disputes',  sub: stats.openDisputes > 0 ? 'Needs attention' : 'All clear', subColor: '#DC3545', color: '#DC3545', bg: '#FFEBEE' },
        ].map(({ Icon, val, label, sub, subColor, color, bg }) => (
          <div key={label} style={{ ...s.metricCard, backgroundColor: bg }}>
            <Icon size={20} color={color} />
            <p style={{ ...s.metricVal, color }}>{val}</p>
            <p style={s.metricLabel}>{label}</p>
            <p style={{ ...s.metricSub, color: subColor }}>{sub}</p>
          </div>
        ))}
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={s.titleRow}>
            <span style={s.orangeDot} />
            <span style={s.sectionTitle}>Seller Approval Pending</span>
          </div>
          <span style={s.sectionSub}>{pendingSellers.length} pending</span>
        </div>
        {pendingSellers.length === 0 ? (
          <div style={s.emptyCard}><CheckCircle size={28} color="#1A6B3C" /><p style={s.emptyText}>Koi pending seller nahi! ✅</p></div>
        ) : (
          pendingSellers.map(mapSellerList).map((seller) => (
            <SellerListCard key={seller.id} seller={seller} onApprove={approveSeller} onReject={rejectSeller} />
          ))
        )}
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Platform Overview</p>
        <div>
          <div style={s.chartRow}>
            {WEEK_BARS.map(({ day, val }) => (
              <div key={day} style={s.barCol}>
                <span style={s.barVal}>{val}</span>
                <div style={s.barTrack}>
                  <div style={{ ...s.barFill, height: `${Math.round((val / MAX_BAR) * 80)}px` }} />
                </div>
                <span style={s.barDay}>{day}</span>
              </div>
            ))}
          </div>
          <p style={s.chartTotal}>This Week: <strong>{totalWeek} orders</strong></p>
        </div>
        <div>
          <p style={s.subTitle}>District Coverage</p>
          {DISTRICTS.map(({ name, sellers: cnt, pct, color }) => (
            <div key={name} style={s.distRow}>
              <div style={s.distMeta}>
                <span style={s.distName}>{name}</span>
                <span style={s.distCount}>{cnt} sellers</span>
              </div>
              <div style={s.progressTrack}>
                <div style={{ ...s.progressFill, width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          ))}
        </div>
        <div>
          <p style={s.subTitle}>Top Medicines</p>
          <div style={s.pillRow}>
            {TOP_MEDS.map((m) => <span key={m} style={s.medPill}>{m}</span>)}
          </div>
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={s.titleRow}>
            <span style={s.redDot} />
            <span style={s.sectionTitle}>Open Disputes</span>
          </div>
          <span style={s.sectionSub}>{disputes.length} open</span>
        </div>
        {disputes.length === 0 ? (
          <div style={s.emptyCard}><CheckCircle size={28} color="#1A6B3C" /><p style={s.emptyText}>Koi dispute nahi!</p></div>
        ) : (
          disputes.map((d) => <DisputeCard key={d.id} d={d} onResolve={handleResolve} />)
        )}
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Recent Activity</p>
        <div style={s.timeline}>
          {ACTIVITY.map(({ color, text, time }, i) => (
            <div key={i} style={s.timelineRow}>
              <div style={{ ...s.timelineDot, backgroundColor: color }} />
              <div style={s.timelineContent}>
                <p style={s.timelineText}>{text}</p>
                <p style={s.timelineTime}>{time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Quick Actions</p>
        <div style={s.actionGrid}>
          {QUICK_ACTIONS.map(({ Icon, label, color, bg }) => (
            <button key={label} style={{ ...s.actionBtn, backgroundColor: bg }}>
              <Icon size={22} color={color} />
              <span style={{ ...s.actionLabel, color }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Quick Settings</p>
        {[
          { key: 'registrations', label: 'Naye Registrations' },
          { key: 'delivery',      label: 'Home Delivery'       },
          { key: 'pharmCall',     label: 'Pharmacist Call'     },
          { key: 'maintenance',   label: 'Maintenance Mode'    },
        ].map(({ key, label }) => {
          const on = settings[key];
          return (
            <div key={key} style={s.toggleRow}>
              <span style={s.toggleLabel}>{label}</span>
              <button style={{ ...s.toggleTrack, backgroundColor: on ? '#1A6B3C' : '#CCCCCC' }} onClick={() => toggleSetting(key)}>
                <span style={{ ...s.toggleThumb, transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

  const renderSellers = () => (
    <>
      <p style={s.tabTitle}>Sellers Manage Karo</p>
      <FilterChips
        options={[
          { value: 'sab',      label: 'Sab'      },
          { value: 'approved', label: 'Approved' },
          { value: 'pending',  label: 'Pending'  },
          { value: 'rejected', label: 'Rejected' },
        ]}
        active={sellerFilter}
        onChange={setSellerFilter}
      />
      {filteredSellers.length === 0 ? (
        <div style={s.emptyCard}><CheckCircle size={28} color="#1A6B3C" /><p style={s.emptyText}>Koi seller nahi is category mein</p></div>
      ) : (
        <div style={s.section}>
          {filteredSellers.map((seller) => (
            <SellerListCard key={seller.id} seller={seller} onApprove={approveSeller} onReject={rejectSeller} />
          ))}
        </div>
      )}
    </>
  );

  const renderOrders = () => (
    <>
      <p style={s.tabTitle}>Saare Orders</p>
      <FilterChips
        options={[
          { value: 'sab',        label: 'Sab'        },
          { value: 'pending',    label: 'Pending'    },
          { value: 'processing', label: 'Processing' },
          { value: 'delivered',  label: 'Delivered'  },
          { value: 'cancelled',  label: 'Cancelled'  },
        ]}
        active={orderFilter}
        onChange={setOrderFilter}
      />
      {filteredOrders.length === 0 ? (
        <div style={s.emptyCard}><CheckCircle size={28} color="#1A6B3C" /><p style={s.emptyText}>Koi order nahi is category mein</p></div>
      ) : (
        <div style={s.section}>
          {filteredOrders.map((order) => <OrderCard key={order.id} order={order} />)}
        </div>
      )}
    </>
  );

  const renderDisputesTab = () => (
    <>
      <p style={s.tabTitle}>Disputes</p>
      <FilterChips
        options={[
          { value: 'open',        label: 'Open'        },
          { value: 'in-progress', label: 'In Progress' },
          { value: 'resolved',    label: 'Resolved'    },
        ]}
        active={disputeFilter}
        onChange={setDisputeFilter}
      />
      {filteredDisputes.length === 0 ? (
        <div style={s.emptyCard}><CheckCircle size={28} color="#1A6B3C" /><p style={s.emptyText}>Koi dispute nahi</p></div>
      ) : (
        <div style={s.section}>
          {filteredDisputes.map((d) => <DisputeTabCard key={d.id} d={d} onResolve={handleResolveTab} />)}
        </div>
      )}
    </>
  );

  const renderSettings = () => (
    <>
      <p style={s.tabTitle}>Platform Settings</p>

      <div style={s.whiteCard}>
        {[
          { key: 'registrations', label: 'Naye Registrations' },
          { key: 'delivery',      label: 'Home Delivery'       },
          { key: 'pharmCall',     label: 'Pharmacist Call'     },
          { key: 'maintenance',   label: 'Maintenance Mode'    },
        ].map(({ key, label }) => {
          const on = settings[key];
          return (
            <div key={key} style={s.toggleRow}>
              <span style={s.toggleLabel}>{label}</span>
              <button style={{ ...s.toggleTrack, backgroundColor: on ? '#1A6B3C' : '#CCCCCC' }} onClick={() => toggleSetting(key)}>
                <span style={{ ...s.toggleThumb, transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
          );
        })}
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Platform Info</p>
        {[
          ['App Version',    '1.0.0'],
          ['Total Users',    stats.totalUsers.toLocaleString('en-IN')],
          ['Active Sellers', stats.activeSellers],
          ['Aaj Ka GMV',     `₹${stats.todayGMV.toLocaleString('en-IN')}`],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F5F5F5' }}>
            <span style={{ fontSize: '14px', color: '#888888' }}>{label}</span>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A' }}>{val}</span>
          </div>
        ))}
      </div>

      <div style={{ ...s.whiteCard, border: '1.5px solid #FFCDD2' }}>
        <p style={{ ...s.sectionTitle, color: '#DC3545' }}>Danger Zone</p>
        <button style={s.dangerOutlineBtn}>
          <Trash2 size={16} color="#DC3545" /> Sab Cache Clear Karo
        </button>
        <button style={s.dangerFillBtn}>
          <Power size={16} color="#FFFFFF" /> Emergency Shutdown
        </button>
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Admin Profile</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[['Admin', 'Super Admin'], ['Email', 'admin@medsetu.in']].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: '#888888' }}>{label}</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#1A1A1A' }}>{val}</span>
            </div>
          ))}
        </div>
        <button style={s.logoutBtn} onClick={handleLogout}>
          <LogOut size={16} color="#FFFFFF" /> Logout
        </button>
      </div>
    </>
  );

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>MedSetu Admin</p>
            <p style={s.headerSub}>Super Admin</p>
          </div>
          <div style={s.headerRight}>
            <button style={s.iconBtn} onClick={handleBellClick}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                {unreadCount > 0 && <span style={s.notifBadge}>{unreadCount}</span>}
              </div>
            </button>
            <div style={s.avatar}><span style={s.avatarLetter}>A</span></div>
          </div>
        </div>

        {/* ── Notification Panel ── */}
        {notifOpen && (
          <>
            <div
              style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 100 }}
              onClick={() => setNotifOpen(false)}
            />
            <div style={s.notifPanel}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <p style={{ fontSize: '16px', fontWeight: '800', color: '#1A1A1A', margin: 0 }}>Notifications</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}
                    onClick={markAllRead}
                  >
                    Sab padhein
                  </button>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }} onClick={() => setNotifOpen(false)}>
                    <X size={18} color="#888888" />
                  </button>
                </div>
              </div>

              {notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 8px', borderBottom: '1px solid #F5F5F5', borderRadius: '8px',
                    backgroundColor: n.read ? '#FFFFFF' : '#F0FAF5',
                    marginBottom: '2px',
                  }}
                >
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: n.dotColor, flexShrink: 0, marginTop: '5px' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#1A1A1A', margin: 0 }}>
                      {n.title}
                      {n.subtitle && <span style={{ color: '#1A6B3C' }}> {n.subtitle}</span>}
                    </p>
                    <p style={{ fontSize: '11px', color: '#AAAAAA', margin: '2px 0 0' }}>{n.time}</p>
                  </div>
                </div>
              ))}

              <button
                style={{ display: 'block', width: '100%', textAlign: 'center', marginTop: '12px', background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Aur dekho →
              </button>
            </div>
          </>
        )}

        {/* ── Body ── */}
        <div style={s.body}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
              <p style={{ color: '#888888', fontSize: '14px' }}>Admin data load ho raha hai...</p>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && renderDashboard()}
              {activeTab === 'sellers'   && renderSellers()}
              {activeTab === 'orders'    && renderOrders()}
              {activeTab === 'disputes'  && renderDisputesTab()}
              {activeTab === 'settings'  && renderSettings()}
            </>
          )}
          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS_DEF.map(({ id, Icon, label }) => {
            const active = activeTab === id;
            const badge  = id === 'sellers' ? pendingSellers.length : id === 'disputes' ? allDisputes.filter((d) => d.status !== 'resolved').length : 0;
            return (
              <button key={id} style={s.navTab} onClick={() => setActiveTab(id)}>
                <div style={{ position: 'relative' }}>
                  <Icon size={22} color={active ? '#1A6B3C' : '#AAAAAA'} strokeWidth={active ? 2.5 : 1.8} />
                  {badge > 0 && <span style={s.navBadge}>{badge}</span>}
                </div>
                <span style={{ ...s.navLabel, color: active ? '#1A6B3C' : '#AAAAAA', fontWeight: active ? '600' : '400' }}>
                  {label}
                </span>
                {active && <span style={s.navActiveLine} />}
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
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5', position: 'relative' },

  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px 12px', backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10,
  },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  headerSub:   { fontSize: '12px', color: '#888888', margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex' },
  notifBadge:  {
    position: 'absolute', top: '-5px', right: '-6px',
    minWidth: '16px', height: '16px', borderRadius: '8px',
    backgroundColor: '#DC3545', color: '#FFFFFF',
    fontSize: '9px', fontWeight: '800',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
  },
  avatar:       { width: '36px', height: '36px', borderRadius: '18px', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#FFFFFF', fontWeight: '800', fontSize: '16px' },

  notifPanel: {
    position: 'fixed', top: '64px',
    left: '50%', transform: 'translateX(-50%)',
    width: '100%', maxWidth: '480px',
    backgroundColor: '#FFFFFF',
    borderRadius: '0 0 20px 20px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    zIndex: 101,
    padding: '16px',
    maxHeight: '65vh', overflowY: 'auto',
  },

  body:    { flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' },
  tabTitle: { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },

  hScroll:    { display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' },
  metricCard: { borderRadius: '14px', padding: '14px 16px', flexShrink: 0, width: '140px', display: 'flex', flexDirection: 'column', gap: '4px' },
  metricVal:   { fontSize: '28px', fontWeight: '800', margin: '4px 0 0', lineHeight: 1 },
  metricLabel: { fontSize: '12px', color: '#444444', fontWeight: '600', margin: 0 },
  metricSub:   { fontSize: '11px', fontWeight: '700', margin: 0 },

  section:     { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  titleRow:    { display: 'flex', alignItems: 'center', gap: '8px' },
  sectionTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sectionSub:   { fontSize: '12px', color: '#888888' },
  orangeDot: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#E65100', display: 'inline-block', animation: 'pulse 1.3s ease-in-out infinite', flexShrink: 0 },
  redDot:    { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#DC3545', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 5px rgba(0,0,0,0.04)' },
  emptyText: { fontSize: '14px', color: '#1A6B3C', fontWeight: '600', margin: 0 },

  sellerCard: { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  cardTopRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
  sellerName: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sellerSub:  { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  pendingBadge: { fontSize: '10px', fontWeight: '800', color: '#E65100', backgroundColor: '#FFF3E0', padding: '3px 9px', borderRadius: '20px', flexShrink: 0 },
  infoGrid:  { display: 'flex', flexDirection: 'column', gap: '5px' },
  infoRow:   { display: 'flex', gap: '6px' },
  infoLabel: { fontSize: '12px', color: '#888888', fontWeight: '600', minWidth: '90px' },
  infoVal:   { fontSize: '12px', color: '#1A1A1A', fontWeight: '500' },
  docsBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  docRow:    { display: 'flex', alignItems: 'center', gap: '6px' },
  viewDocsBtn: { background: 'none', border: 'none', color: '#2563EB', fontSize: '12px', fontWeight: '700', cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', textAlign: 'left' },
  warnRow: { display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#FFEBEE', padding: '8px 10px', borderRadius: '8px' },
  warnText: { fontSize: '12px', color: '#DC3545', fontWeight: '600' },
  sellerBtns: { display: 'flex', gap: '8px' },
  approveBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
  },
  rejectBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545',
    border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
  },
  moreInfoBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '10px', backgroundColor: '#FFFFFF', color: '#E65100',
    border: '1.5px solid #E65100', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
  },

  whiteCard: { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 5px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '14px' },
  subTitle:  { fontSize: '13px', fontWeight: '700', color: '#444444', margin: 0 },

  chartRow:  { display: 'flex', alignItems: 'flex-end', gap: '6px', justifyContent: 'space-between', paddingBottom: '4px' },
  barCol:    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: 1 },
  barVal:    { fontSize: '9px', fontWeight: '700', color: '#555555' },
  barTrack:  { width: '100%', height: '80px', backgroundColor: '#F0F0F0', borderRadius: '4px', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' },
  barFill:   { width: '100%', backgroundColor: '#1A6B3C', borderRadius: '4px 4px 0 0', transition: 'height 0.6s ease' },
  barDay:    { fontSize: '10px', color: '#888888', fontWeight: '600' },
  chartTotal: { fontSize: '13px', color: '#555555', margin: '6px 0 0', textAlign: 'center' },

  distRow:   { display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '8px' },
  distMeta:  { display: 'flex', justifyContent: 'space-between' },
  distName:  { fontSize: '12px', fontWeight: '600', color: '#1A1A1A' },
  distCount: { fontSize: '12px', color: '#888888' },
  progressTrack: { height: '7px', backgroundColor: '#F0F0F0', borderRadius: '4px', overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: '4px', transition: 'width 0.6s ease' },

  pillRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  medPill: { padding: '5px 12px', backgroundColor: '#E8F5EE', borderRadius: '20px', fontSize: '11px', fontWeight: '600', color: '#1A6B3C' },

  disputeCard:  { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '8px' },
  disputeId:    { fontSize: '14px', fontWeight: '800', color: '#1A1A1A', margin: 0, fontFamily: 'monospace' },
  disputeSub:   { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  urgentBadge:  { fontSize: '10px', fontWeight: '800', color: '#FFFFFF', backgroundColor: '#DC3545', padding: '3px 9px', borderRadius: '4px', flexShrink: 0, letterSpacing: '0.5px' },
  disputeIssue: { fontSize: '13px', color: '#333333', fontStyle: 'italic', margin: 0 },
  disputeMeta:  { display: 'flex', alignItems: 'center', gap: '10px' },
  amtPill:      { fontSize: '13px', fontWeight: '800', color: '#1A6B3C', backgroundColor: '#E8F5EE', padding: '3px 10px', borderRadius: '20px' },
  disputeBtns:  { display: 'flex', gap: '8px', alignItems: 'center' },
  resolveBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
  },
  detailsBtn: {
    display: 'flex', alignItems: 'center', gap: '2px',
    background: 'none', border: 'none', color: '#2563EB',
    fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0',
  },

  timeline:        { display: 'flex', flexDirection: 'column', gap: '0' },
  timelineRow:     { display: 'flex', gap: '12px', padding: '10px 0', borderBottom: '1px solid #F5F5F5', alignItems: 'flex-start' },
  timelineDot:     { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, marginTop: '4px' },
  timelineContent: { flex: 1 },
  timelineText:    { fontSize: '13px', color: '#1A1A1A', margin: 0, lineHeight: '1.4' },
  timelineTime:    { fontSize: '11px', color: '#AAAAAA', margin: '2px 0 0' },

  actionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  actionBtn:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '16px 8px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
  actionLabel: { fontSize: '12px', fontWeight: '700', textAlign: 'center' },

  toggleRow:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #F5F5F5' },
  toggleLabel: { fontSize: '14px', fontWeight: '500', color: '#1A1A1A' },
  toggleTrack: { width: '44px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background-color 0.3s ease', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: '3px', left: '3px', width: '20px', height: '20px', borderRadius: '10px', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'transform 0.3s ease' },

  dangerOutlineBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '12px', backgroundColor: '#FFFFFF', color: '#DC3545',
    border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
  },
  dangerFillBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '12px', backgroundColor: '#DC3545', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
  },
  logoutBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '12px', backgroundColor: '#DC3545', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', marginTop: '4px',
  },

  bottomNav: { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' },
  navTab:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', position: 'relative', fontFamily: 'inherit' },
  navBadge:  { position: 'absolute', top: '-4px', right: '-4px', minWidth: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#DC3545', color: '#FFFFFF', fontSize: '9px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' },
  navLabel:      { fontSize: '10px' },
  navActiveLine: { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
};
