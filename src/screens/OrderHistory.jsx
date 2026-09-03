import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOrders, mapOrder } from '../lib/orders';
import { supabase } from '../lib/supabase';
import { generateInvoicePDF } from '../lib/invoicePdf';
import BottomNav from '../components/BottomNav';
import {
  ArrowLeft, Search, CheckCircle,
  Clock, XCircle, RefreshCw, ChevronRight,
  ShoppingBag, MapPin, RotateCcw,
  Banknote, Smartphone, FileText, Download,
  Package, PackageCheck, Truck,
} from 'lucide-react';


// Bug fix: every real orders.status used to collapse into one
// "processing" bucket here (lib/orders.js's mapOrder() did the collapsing)
// — that's why sellers saw "Pending" while customers saw "Processing" for
// the exact same order. Each real status now gets its own label/colour,
// matching OrderTracking.jsx's per-status language (getEtaBanner/
// buildSteps) instead of contradicting it.
const STATUS_MAP = {
  pending:           { label: 'Order Placed',   sub: 'Store confirm karega',                   color: '#0C447C', bg: '#EAF2FB', Icon: Package      },
  awaiting_pharmacist:{ label: 'Rx Review',      sub: 'Pharmacist prescription verify kar raha hai', color: '#EA6C00', bg: '#FFF1E8', Icon: Clock    },
  confirmed:         { label: 'Confirmed',       sub: 'Taiyari ho rahi hai',                    color: '#F26C0A', bg: '#FFF1E8', Icon: Clock        },
  preparing:         { label: 'Pack ho raha hai', sub: 'Store aapki medicine pack kar raha hai', color: '#F26C0A', bg: '#FFF1E8', Icon: PackageCheck },
  out_for_delivery:  { label: 'Raaste mein',      sub: 'Delivery boy aapke paas aa raha hai',    color: '#7C3AED', bg: '#F3EEFF', Icon: Truck        },
  delivered:         { label: 'Delivered',        sub: 'Order mil gaya',                         color: '#1A6B3C', bg: '#E8F5EE', Icon: CheckCircle  },
  cancelled:         { label: 'Cancelled',        sub: 'Order cancel ho gaya',                    color: '#C62828', bg: '#FFEBEE', Icon: XCircle      },
};

// "Chal Rahe" (was "Processing") now covers every not-yet-delivered,
// not-cancelled status — the filter chip's own grouping, and the same
// grouping OrderCard's action buttons below use so Track/Cancel Karo
// still show up for all of them (previously gated on the now-gone
// 'processing' bucket value).
const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery'];

const FILTERS = ['Sab', 'Delivered', 'Chal Rahe', 'Cancelled'];

const FILTER_STATUS = {
  'Sab': null, 'Delivered': ['delivered'], 'Chal Rahe': ACTIVE_STATUSES, 'Cancelled': ['cancelled'],
};

// ─── Order Card ───────────────────────────────────────────────
function OrderCard({ order, onTrack, onReorder, onCancel, onDetail, onDownloadBill, downloadingId }) {
  const [expanded, setExpanded] = useState(false);
  const st = STATUS_MAP[order.status];
  const displayItems = order.items.slice(0, 2);
  const extra = order.items.length - 2;

  return (
    <div style={{ ...s.orderCard, borderLeft: `4px solid ${st.color}`, backgroundColor: st.bg }}>
      {/* Top row */}
      <div style={s.cardTop}>
        <div style={s.statusCol}>
          <div style={{ ...s.statusBadge, backgroundColor: st.bg }}>
            <st.Icon size={12} color={st.color} />
            <span style={{ ...s.statusText, color: st.color }}>{st.label}</span>
          </div>
          {st.sub && <span style={{ ...s.statusSub, color: st.color }}>{st.sub}</span>}
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
        {ACTIVE_STATUSES.includes(order.status) && (
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
            <button style={s.btnFilled} onClick={() => onReorder(order)}>
              <RotateCcw size={13} color="#FFFFFF" />
              Dobara Order Karo
            </button>
            <button style={s.btnTextGray} onClick={() => onDetail(order)}>
              Detail Dekho
            </button>
            {/* R4-B: bill download — delivered B2C orders only */}
            {order.raw?.buyer_type !== 'retailer' && (
              <button
                style={s.btnFilled}
                onClick={() => onDownloadBill(order)}
                disabled={downloadingId === order.dbId}
              >
                <Download size={13} color="#FFFFFF" />
                {downloadingId === order.dbId ? 'Bill Ban Raha Hai...' : 'Bill (PDF)'}
              </button>
            )}
          </>
        )}

        {order.status === 'cancelled' && (
          <>
            <button style={s.btnGreenOutlined} onClick={() => onReorder(order)}>
              <RotateCcw size={13} color="#1A6B3C" />
              Dobara Order Karo
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
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    const userId = getCurrentUserId();
    fetchOrders(userId)
      .then(({ data, error }) => {
        if (!error && data.length > 0) {
          setDbOrders(data.map(mapOrder));
        }
        setDbLoading(false);
      })
      .catch(() => setDbLoading(false));
  }, []);

  const handleCancel = async (order) => {
    if (!order.dbId) return;
    if (!window.confirm('Kya aap ye order cancel karna chahte hain?')) return;
    // RPC, not a raw UPDATE — a confirmed order has reserved stock that must
    // be released (a customer session can't call release_stock directly),
    // and the raw UPDATE silently no-ops for preparing/out_for_delivery
    // orders (protect_order_sensitive_columns trigger) while returning no
    // error, which used to flash a false "cancelled + refund ₹X processed".
    // Same call shape as OrderTracking.jsx's handleCancelConfirm.
    const { data, error } = await supabase.rpc('cancel_order', { p_order_id: order.dbId });
    const result = data?.[0];
    if (error || !result?.success) {
      alert('Order cancel nahi hua: ' + (result?.message || error?.message || 'Unknown error'));
      return;
    }
    if (result.message && result.message !== 'Order cancel ho gaya') {
      alert(result.message);
    }
    setDbOrders((prev) =>
      prev.map((o) => o.dbId === order.dbId ? { ...o, status: 'cancelled', refund: o.amount } : o)
    );
  };

  const handleDownloadBill = async (order) => {
    if (!order.raw || downloadingId) return;
    setDownloadingId(order.dbId);
    try {
      await generateInvoicePDF(order.raw);
    } catch (e) {
      console.error('[bill download]', e);
      alert('Bill download nahi hua, dobara try karo');
    } finally {
      setDownloadingId(null);
    }
  };

  const allOrders = dbOrders;

  const filtered = useMemo(() => {
    const statuses = FILTER_STATUS[activeFilter];
    return allOrders.filter((o) => {
      const matchStatus = !statuses || statuses.includes(o.status);
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
            <ArrowLeft size={22} color="#0C447C" />
          </button>
          <span style={s.headerTitle}>Order History</span>
          {/* Non-functional filter/hamburger icon removed (B15) — had no
              onClick at all, and the filter chips + search below already
              cover it. Spacer keeps the title visually centered the same
              way the old 3-icon layout did. */}
          <div style={{ width: '34px' }} />
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Summary Card */}
          <div style={s.summaryCard}>
            <p style={s.summaryLabel}>Aapke Saare Orders</p>
            <div style={s.metricsRow}>
              {[
                { label: `${allOrders.length} Total`, Icon: ShoppingBag, accent: '#FFFFFF' },
                { label: `${allOrders.filter(o => o.status === 'delivered').length} Delivered`, Icon: CheckCircle, accent: '#E0A818' },
                { label: `₹${allOrders.reduce((s, o) => s + (o.amount || 0), 0).toLocaleString('en-IN')} Spent`, Icon: Banknote, accent: '#F26C0A' },
              ].map(({ label, Icon, accent }) => (
                <div key={label} style={{ ...s.metricPill, borderColor: accent }}>
                  <Icon size={12} color={accent} />
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
              const statuses = FILTER_STATUS[f];
              const count = statuses
                ? allOrders.filter((o) => statuses.includes(o.status)).length
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
                      : 'rgba(12,68,124,0.08)',
                    color: activeFilter === f ? '#FFFFFF' : '#0C447C',
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Orders, Loading, or Empty */}
          {dbLoading ? (
            <div style={s.emptyState}>
              <RefreshCw size={32} color="#1A6B3C" style={{ animation: 'spin 1s linear infinite' }} />
              <p style={s.emptyTitle}>Orders load ho rahe hain...</p>
            </div>
          ) : filtered.length === 0 ? (
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
              {filtered.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onTrack={(o) => navigate('/order-tracking', { state: { orderId: o.dbId } })}
                  onReorder={() => navigate('/medicine-search')}
                  onCancel={handleCancel}
                  onDetail={(o) => navigate('/order-tracking', { state: { orderId: o.dbId } })}
                  onDownloadBill={handleDownloadBill}
                  downloadingId={downloadingId}
                />
              ))}
            </div>
          )}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav (shared, R3-C3) ── */}
        <BottomNav />
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

  // Header — same soft gradient patti as Home/Categories/Checkout
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    background: 'linear-gradient(90deg, #FFF1E6 0%, #EAF2FB 100%)',
    borderBottom: '1px solid rgba(12,68,124,0.08)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerTitle: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#0C447C',
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
    background: 'linear-gradient(135deg, #1A6B3C 0%, #156B4A 45%, #0C447C 100%)',
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
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 12px',
    borderRadius: '20px',
    backgroundColor: 'rgba(255,255,255,0.2)',
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
    border: '1.5px solid rgba(12,68,124,0.25)',
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
    border: '1.5px solid rgba(12,68,124,0.18)',
  },
  chipCount: {
    fontSize: '11px',
    fontWeight: '700',
    padding: '1px 6px',
    borderRadius: '10px',
    minWidth: '18px',
    textAlign: 'center',
  },

  // Orders list — each order is now its own separated card (own border/
  // radius/shadow below), so this is just a gapped column, not a shared box.
  ordersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },

  // Order card
  // Base border is thin brand-tinted on all sides; the inline
  // borderLeft override (status colour, thicker) + backgroundColor
  // (status tint) are applied per-card in OrderCard below.
  orderCard: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    borderRadius: '14px',
    border: '1px solid rgba(12,68,124,0.1)',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
  },
  statusCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    alignItems: 'flex-start',
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
  statusSub: {
    fontSize: '10.5px',
    fontWeight: '500',
    opacity: 0.85,
    margin: 0,
    paddingLeft: '2px',
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
    color: '#C4581E',
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
  btnTextGray: {
    background: 'none',
    border: 'none',
    color: '#0C447C',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: '8px 4px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
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
};
