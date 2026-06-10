import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOrders, mapOrder, updateOrderStatus } from '../lib/orders';
import {
  ArrowLeft, SlidersHorizontal, Search, CheckCircle,
  Clock, XCircle, RefreshCw, Star, ChevronRight,
  ShoppingBag, MapPin, Home, User, RotateCcw,
  Banknote, Smartphone, FileText,
} from 'lucide-react';

// ─── Dummy Orders ─────────────────────────────────────────────
const ORDERS = [
  {
    id: 'MED-2024-015',
    status: 'delivered',
    date: 'Aaj, 11:30 AM',
    store: 'Shri Ram Medical Store',
    items: ['Paracetamol 500mg', 'Crocin 650mg', 'ORS Powder'],
    amount: 459.50,
    payment: 'Cash on Delivery',
    paymentDone: true,
    isPrescription: false,
    refund: null,
  },
  {
    id: 'MED-2024-016',
    status: 'processing',
    date: 'Aaj, 10:15 AM',
    store: 'Arogya Medical Hall',
    items: ['Azithromycin 500mg', 'Digital BP Machine'],
    amount: 1384.00,
    payment: 'UPI — PhonePe',
    paymentDone: true,
    isPrescription: false,
    refund: null,
  },
  {
    id: 'MED-2024-014',
    status: 'cancelled',
    date: 'Kal, 3:45 PM',
    store: 'Gupta Medical Agency',
    items: ['ORS Powder x3'],
    amount: 45.00,
    payment: 'UPI',
    paymentDone: false,
    isPrescription: false,
    refund: 45.00,
  },
  {
    id: 'MED-2024-013',
    status: 'delivered',
    date: '2 din pehle',
    store: 'Shri Ram Medical Store',
    items: ['Prescription Order'],
    amount: 892.00,
    payment: 'Cash on Delivery',
    paymentDone: true,
    isPrescription: true,
    refund: null,
  },
];

const FILTERS = ['Sab', 'Delivered', 'Processing', 'Cancelled'];

const STATUS_MAP = {
  delivered:  { label: 'Delivered',  color: '#1A6B3C', bg: '#E8F5EE', Icon: CheckCircle },
  processing: { label: 'Processing', color: '#E65100', bg: '#FFF3E0', Icon: Clock      },
  cancelled:  { label: 'Cancelled',  color: '#C62828', bg: '#FFEBEE', Icon: XCircle    },
};

const FILTER_STATUS = {
  'Sab': null, 'Delivered': 'delivered', 'Processing': 'processing', 'Cancelled': 'cancelled',
};

// ─── Order Card ───────────────────────────────────────────────
function OrderCard({ order, onTrack, onReorder, onCancel, onDetail }) {
  const [expanded, setExpanded] = useState(false);
  const st = STATUS_MAP[order.status];
  const displayItems = order.items.slice(0, 2);
  const extra = order.items.length - 2;

  return (
    <div style={s.orderCard}>
      {/* Top row */}
      <div style={s.cardTop}>
        <div style={{ ...s.statusBadge, backgroundColor: st.bg }}>
          <st.Icon size={12} color={st.color} />
          <span style={{ ...s.statusText, color: st.color }}>{st.label}</span>
        </div>
        <div style={s.cardTopRight}>
          <span style={s.orderId}>#{order.id}</span>
          <span style={s.orderDate}>{order.date}</span>
        </div>
      </div>

      {/* Middle */}
      <div style={s.cardMid}>
        <div style={s.storeRow}>
          <span style={s.storeEmoji}>🏪</span>
          <span style={s.storeName}>{order.store}</span>
        </div>

        <div style={s.itemsRow}>
          <span style={s.itemsList}>
            {displayItems.join(', ')}
            {extra > 0 && <span style={s.extraItems}> +{extra} aur item</span>}
          </span>
          {order.isPrescription && (
            <span style={s.rxTag}>
              <FileText size={10} color="#1A6B3C" /> Prescription ✓
            </span>
          )}
        </div>

        <div style={s.amountRow}>
          <span style={s.amount}>₹{order.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <span style={s.payment}>
            {order.payment === 'Cash on Delivery'
              ? <><Banknote size={12} color="#888888" /> {order.payment}{order.paymentDone ? ' ✓' : ''}</>
              : <><Smartphone size={12} color="#888888" /> {order.payment}</>}
          </span>
        </div>

        {order.refund && (
          <p style={s.refundText}>
            ✓ Refund: ₹{order.refund.toFixed(2)} processed
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={s.cardActions}>
        {order.status === 'processing' && (
          <>
            <button style={s.btnFilled} onClick={() => onTrack(order)}>
              <MapPin size={13} color="#FFFFFF" />
              Track Karo
            </button>
            <button style={s.btnRedOutlined} onClick={() => onCancel(order)}>
              <XCircle size={13} color="#DC3545" />
              Cancel Karo
            </button>
          </>
        )}

        {order.status === 'delivered' && (
          <>
            <button style={s.btnGreenOutlined} onClick={() => onReorder(order)}>
              <RotateCcw size={13} color="#1A6B3C" />
              Dobara Order Karo
            </button>
            <button style={s.btnOrangeOutlined}>
              <Star size={13} color="#E65100" />
              Review Karo
            </button>
            <button style={s.btnTextGray} onClick={() => onDetail(order)}>
              Detail Dekho
            </button>
          </>
        )}

        {order.status === 'cancelled' && (
          <>
            <button style={s.btnGreenOutlined} onClick={() => onReorder(order)}>
              <RotateCcw size={13} color="#1A6B3C" />
              Dobara Order Karo
            </button>
            <button style={s.btnBlueText}>
              Refund Status
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const getCurrentUserId = () => {
  try {
    const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
    return user?.id || null;
  } catch {
    return null;
  }
};

// ─── Main Screen ──────────────────────────────────────────────
export default function OrderHistory() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('Sab');
  const [query, setQuery]               = useState('');
  const [dbOrders, setDbOrders]         = useState([]);
  const [dbLoading, setDbLoading]       = useState(true);

  useEffect(() => {
    const userId = getCurrentUserId();
    fetchOrders(userId).then(({ data, error }) => {
      if (!error && data.length > 0) {
        setDbOrders(data.map(mapOrder));
      }
      setDbLoading(false);
    });
  }, []);

  const handleCancel = async (order) => {
    if (!order.dbId) return;
    if (!window.confirm('Kya aap ye order cancel karna chahte hain?')) return;
    const { error } = await updateOrderStatus(order.dbId, 'cancelled');
    if (!error) {
      setDbOrders((prev) =>
        prev.map((o) => o.dbId === order.dbId ? { ...o, status: 'cancelled', refund: o.amount } : o)
      );
    }
  };

  // Show DB orders if fetched, else dummy data
  const allOrders = dbLoading ? ORDERS : (dbOrders.length > 0 ? dbOrders : ORDERS);

  const filtered = useMemo(() => {
    const statusKey = FILTER_STATUS[activeFilter];
    return allOrders.filter((o) => {
      const matchStatus = !statusKey || o.status === statusKey;
      const q = query.toLowerCase();
      const matchQuery = !q || o.id.toLowerCase().includes(q)
        || o.items.some((it) => it.toLowerCase().includes(q))
        || o.store.toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });
  }, [activeFilter, query, allOrders]);

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Order History</span>
          <button style={s.iconBtn}>
            <SlidersHorizontal size={20} color="#1A6B3C" />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Summary Card */}
          <div style={s.summaryCard}>
            <p style={s.summaryLabel}>Aapke Saare Orders</p>
            <div style={s.metricsRow}>
              {[
                { label: `${allOrders.length} Total` },
                { label: `${allOrders.filter(o => o.status === 'delivered').length} Delivered` },
                { label: `₹${allOrders.reduce((s, o) => s + (o.amount || 0), 0).toLocaleString('en-IN')} Spent` },
              ].map(({ label }) => (
                <div key={label} style={{ ...s.metricPill, backgroundColor: 'rgba(255,255,255,0.25)' }}>
                  <span style={s.metricText}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Search */}
          <div style={s.searchBox}>
            <Search size={16} color="#AAAAAA" />
            <input
              style={s.searchInput}
              placeholder="Order ID ya medicine dhundho..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button style={s.clearBtn} onClick={() => setQuery('')}>
                <XCircle size={16} color="#CCCCCC" />
              </button>
            )}
          </div>

          {/* Filter Chips */}
          <div style={s.filtersScroll}>
            {FILTERS.map((f) => {
              const statusKey = FILTER_STATUS[f];
              const count = statusKey
                ? allOrders.filter((o) => o.status === statusKey).length
                : allOrders.length;
              return (
                <button
                  key={f}
                  style={{
                    ...s.chip,
                    ...(activeFilter === f ? s.chipActive : s.chipInactive),
                  }}
                  onClick={() => setActiveFilter(f)}
                >
                  {f}
                  <span style={{
                    ...s.chipCount,
                    backgroundColor: activeFilter === f
                      ? 'rgba(255,255,255,0.3)'
                      : '#F0F0F0',
                    color: activeFilter === f ? '#FFFFFF' : '#888888',
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Orders or Empty */}
          {filtered.length === 0 ? (
            <div style={s.emptyState}>
              <div style={s.emptyIconRing}>
                <ShoppingBag size={48} color="#CCCCCC" />
              </div>
              <p style={s.emptyTitle}>
                {query || activeFilter !== 'Sab'
                  ? 'Koi order nahi mila'
                  : 'Abhi Tak Koi Order Nahi'}
              </p>
              <p style={s.emptySub}>
                {query || activeFilter !== 'Sab'
                  ? 'Filter ya search badal ke dekhein'
                  : 'Apni pehli medicine order karo'}
              </p>
              {(!query && activeFilter === 'Sab') && (
                <button style={s.orderNowBtn} onClick={() => navigate('/medicine-search')}>
                  <ShoppingBag size={15} color="#FFFFFF" />
                  Order Karo
                </button>
              )}
            </div>
          ) : (
            <div style={s.ordersList}>
              {filtered.map((order, i) => (
                <div key={order.id}>
                  <OrderCard
                    order={order}
                    onTrack={(o) => navigate('/order-tracking', { state: { orderId: o.dbId } })}
                    onReorder={() => navigate('/medicine-search')}
                    onCancel={handleCancel}
                    onDetail={(o) => navigate('/order-tracking', { state: { orderId: o.dbId } })}
                  />
                  {i < filtered.length - 1 && <div style={s.divider} />}
                </div>
              ))}
            </div>
          )}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {[
            { id: 'home',    Icon: Home,        label: 'Home',    route: '/home' },
            { id: 'search',  Icon: Search,      label: 'Search',  route: '/medicine-search' },
            { id: 'orders',  Icon: ShoppingBag, label: 'Orders',  route: '/orders' },
            { id: 'profile', Icon: User,        label: 'Profile', route: '/profile' },
          ].map(({ id, Icon, label, route }) => {
            const isActive = id === 'orders';
            return (
              <button key={id} style={s.navTab} onClick={() => navigate(route)}>
                <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'}
                  strokeWidth={isActive ? 2.5 : 1.8} />
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 14px 12px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerTitle: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#1A1A1A',
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

  // Body
  body: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px',
  },

  // Summary card
  summaryCard: {
    backgroundColor: '#1A6B3C',
    borderRadius: '16px',
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  summaryLabel: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#FFFFFF',
    margin: 0,
    opacity: 0.9,
  },
  metricsRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  metricPill: {
    padding: '5px 12px',
    borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.3)',
  },
  metricText: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Search
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid #E8E8E8',
    borderRadius: '12px',
    padding: '11px 14px',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    fontSize: '14px',
    color: '#1A1A1A',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
  },

  // Filter chips
  filtersScroll: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    paddingBottom: '2px',
  },
  chip: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '7px 14px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: 'none',
    transition: 'all 0.15s ease',
  },
  chipActive: {
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    fontWeight: '600',
  },
  chipInactive: {
    backgroundColor: '#FFFFFF',
    color: '#555555',
    border: '1.5px solid #E0E0E0',
  },
  chipCount: {
    fontSize: '11px',
    fontWeight: '700',
    padding: '1px 6px',
    borderRadius: '10px',
    minWidth: '18px',
    textAlign: 'center',
  },

  // Orders list
  ordersList: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  divider: {
    height: '1px',
    backgroundColor: '#F5F5F5',
    margin: '0 16px',
  },

  // Order card
  orderCard: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '4px 10px',
    borderRadius: '20px',
    flexShrink: 0,
  },
  statusText: {
    fontSize: '12px',
    fontWeight: '700',
  },
  cardTopRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '2px',
  },
  orderId: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#555555',
    fontFamily: 'monospace',
  },
  orderDate: {
    fontSize: '11px',
    color: '#AAAAAA',
  },

  // Middle
  cardMid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  storeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  storeEmoji: {
    fontSize: '14px',
  },
  storeName: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  itemsRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  itemsList: {
    fontSize: '13px',
    color: '#555555',
    lineHeight: '1.4',
  },
  extraItems: {
    color: '#AAAAAA',
    fontSize: '12px',
  },
  rxTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#1A6B3C',
    backgroundColor: '#E8F5EE',
    padding: '2px 8px',
    borderRadius: '20px',
    alignSelf: 'flex-start',
  },
  amountRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amount: {
    fontSize: '16px',
    fontWeight: '800',
    color: '#1A6B3C',
  },
  payment: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    color: '#888888',
  },
  refundText: {
    fontSize: '12px',
    color: '#1A6B3C',
    fontWeight: '600',
    margin: 0,
  },

  // Action buttons
  cardActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  btnFilled: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '9px 14px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '10px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnGreenOutlined: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '8px 12px',
    backgroundColor: '#FFFFFF',
    color: '#1A6B3C',
    border: '1.5px solid #1A6B3C',
    borderRadius: '10px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnRedOutlined: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '8px 12px',
    backgroundColor: '#FFFFFF',
    color: '#DC3545',
    border: '1.5px solid #DC3545',
    borderRadius: '10px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnOrangeOutlined: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '8px 12px',
    backgroundColor: '#FFFFFF',
    color: '#E65100',
    border: '1.5px solid #E65100',
    borderRadius: '10px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnTextGray: {
    background: 'none',
    border: 'none',
    color: '#888888',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: '8px 4px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  btnBlueText: {
    background: 'none',
    border: 'none',
    color: '#2563EB',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: '8px 4px',
  },

  // Empty state
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '56px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
  },
  emptyIconRing: {
    width: '100px',
    height: '100px',
    borderRadius: '50px',
    backgroundColor: '#F5F5F5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8px',
  },
  emptyTitle: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#333333',
    margin: 0,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: '13px',
    color: '#AAAAAA',
    margin: '0 0 8px',
    textAlign: 'center',
  },
  orderNowBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '13px 28px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
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
