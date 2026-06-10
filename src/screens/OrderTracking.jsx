import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { fetchOrderById } from '../lib/orders';
import {
  ArrowLeft, CheckCircle, Clock, Phone, MessageCircle,
  MapPin, Package, IndianRupee, CreditCard, Store,
  Home, Search, ShoppingBag, User, X,
} from 'lucide-react';

// ─── Steps ────────────────────────────────────────────────────
const STEPS = [
  {
    id: 1,
    title: 'Order Confirm Hua',
    sub: 'Shri Ram Medical Store ne accept kiya',
    time: '10:30 AM',
    state: 'done',
  },
  {
    id: 2,
    title: 'Taiyari Ho Rahi Hai',
    sub: 'Store aapki medicine pack kar raha hai',
    time: '10:45 AM',
    state: 'done',
  },
  {
    id: 3,
    title: 'Delivery Pe Hai',
    sub: 'Delivery boy aapke paas aa raha hai',
    time: 'Expected 11:15 AM',
    state: 'active',
  },
  {
    id: 4,
    title: 'Deliver Ho Gaya',
    sub: 'Order aapko mil jayega',
    time: '- -',
    state: 'pending',
  },
];

const ACTIVE_STEP = 3; // fallback when no real order

function getActiveStep(status) {
  const map = { pending: 1, confirmed: 2, preparing: 2, out_for_delivery: 3, delivered: 4, cancelled: 4 };
  return map[status] || 1;
}

function buildSteps(order) {
  const storeName  = order?.sellers?.store_name || 'Store';
  const activeStep = order ? getActiveStep(order.status) : ACTIVE_STEP;
  const fmt        = (d) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '- -';
  return [
    { id: 1, title: 'Order Confirm Hua',    sub: `${storeName} ne accept kiya`,           time: fmt(order?.created_at),  state: activeStep > 1 ? 'done' : activeStep === 1 ? 'active' : 'pending' },
    { id: 2, title: 'Taiyari Ho Rahi Hai',  sub: 'Store aapki medicine pack kar raha hai', time: '- -',                   state: activeStep > 2 ? 'done' : activeStep === 2 ? 'active' : 'pending' },
    { id: 3, title: 'Delivery Pe Hai',      sub: 'Delivery boy aapke paas aa raha hai',    time: 'Expected soon',         state: activeStep > 3 ? 'done' : activeStep === 3 ? 'active' : 'pending' },
    { id: 4, title: 'Deliver Ho Gaya',      sub: 'Order aapko mil gaya',                   time: '- -',                   state: activeStep >= 4 ? 'done' : 'pending' },
  ];
}

const NAV_TABS = [
  { id: 'home',    Icon: Home,        label: 'Home',    route: '/home' },
  { id: 'search',  Icon: Search,      label: 'Search',  route: '/medicine-search' },
  { id: 'orders',  Icon: ShoppingBag, label: 'Orders',  route: '/orders' },
  { id: 'profile', Icon: User,        label: 'Profile', route: '/profile' },
];

// ─── Bike icon (SVG) ──────────────────────────────────────────
function BikeIcon({ size = 20, color = '#EA6C00' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6h-5L8 11H2" />
      <path d="M15 6l3 5h1" />
      <path d="M8 11l2.5 6.5" />
    </svg>
  );
}

// ─── Step circle ──────────────────────────────────────────────
function StepCircle({ state }) {
  if (state === 'done') {
    return (
      <div style={s.circleDone}>
        <CheckCircle size={16} color="#FFFFFF" fill="#1A6B3C" />
      </div>
    );
  }
  if (state === 'active') {
    return (
      <div style={{ position: 'relative', width: '36px', height: '36px' }}>
        <div style={s.pulseRing} />
        <div style={s.circleActive}>
          <div style={s.activeDot} />
        </div>
      </div>
    );
  }
  return <div style={s.circlePending} />;
}

// ─── Cancel dialog ────────────────────────────────────────────
function CancelDialog({ onConfirm, onClose }) {
  return (
    <div style={s.dialogOverlay} onClick={onClose}>
      <div style={s.dialogBox} onClick={(e) => e.stopPropagation()}>
        <div style={s.dialogIcon}>
          <X size={28} color="#EF4444" />
        </div>
        <h3 style={s.dialogTitle}>Kya aap sure hain?</h3>
        <p style={s.dialogSub}>Order cancel hone ke baad wapas nahi aayega</p>
        <button style={s.dialogCancel} onClick={onConfirm}>Cancel Karo</button>
        <button style={s.dialogBack}  onClick={onClose}>Wapas Jaao</button>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function OrderTracking() {
  const navigate = useNavigate();
  const location = useLocation();
  const orderId  = location.state?.orderId;

  const [order,      setOrder]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelled, setCancelled]   = useState(false);
  const [bikeX, setBikeX]           = useState(0);
  const [activeTab]                 = useState('orders');

  useEffect(() => {
    if (!orderId) { setLoading(false); return; }
    fetchOrderById(orderId).then(({ data, error }) => {
      if (!error && data) setOrder(data);
      setLoading(false);
    });
  }, [orderId]);

  const activeStep = order ? getActiveStep(order.status) : ACTIVE_STEP;
  const steps      = buildSteps(order);

  const handleCancelConfirm = async () => {
    setShowCancel(false);
    if (orderId) await updateOrderStatus(orderId, 'cancelled');
    setCancelled(true);
  };

  // Subtle bike oscillation
  useEffect(() => {
    let dir = 1;
    const id = setInterval(() => {
      setBikeX((x) => {
        const next = x + dir * 0.4;
        if (Math.abs(next) > 12) dir *= -1;
        return next;
      });
    }, 60);
    return () => clearInterval(id);
  }, []);

  if (!loading && !orderId) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#F5F5F5' }}>
        <Package size={52} color="#CCCCCC" />
        <p style={{ fontSize: '16px', fontWeight: '700', color: '#333333', margin: 0 }}>Order nahi mila</p>
        <p style={{ fontSize: '13px', color: '#888888', margin: 0, textAlign: 'center' }}>Orders page se kisi order ko track karo</p>
        <button style={{ padding: '13px 28px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => navigate('/orders')}>
          Orders Dekho
        </button>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div style={s.wrapper}>
        <div style={s.screen}>
          <div style={s.header}>
            <button style={s.iconBtn} onClick={() => navigate('/home')}>
              <ArrowLeft size={22} color="#1A1A1A" />
            </button>
            <div>
              <p style={s.headerTitle}>Order Track Karo</p>
              <p style={s.headerSub}>#{order?.order_number || orderId || 'MED-XXXX'}</p>
            </div>
            <div style={{ width: 34 }} />
          </div>
          <div style={s.cancelledWrap}>
            <div style={s.cancelledIcon}>
              <X size={48} color="#EF4444" />
            </div>
            <h2 style={s.cancelledTitle}>Order Cancel Ho Gaya</h2>
            <p style={s.cancelledSub}>Refund 3–5 business days mein aayega</p>
            <button style={s.goHomeBtn} onClick={() => navigate('/home')}>Home Jaao</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <div style={{ textAlign: 'center' }}>
            <p style={s.headerTitle}>Order Track Karo</p>
            <p style={s.headerSub}>#MED-2024-017</p>
          </div>
          <div style={{ width: 34 }} />
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* ETA Banner */}
          <div style={s.etaBanner}>
            <Clock size={18} color="#FFFFFF" />
            <div style={{ flex: 1 }}>
              <p style={s.etaText}>Aapka order 15 min mein pahunchega</p>
              <div style={s.progressBar}>
                <div style={s.progressFill} />
              </div>
            </div>
          </div>

          {/* Stepper */}
          <div style={s.card}>
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              return (
                <div key={step.id} style={s.stepRow}>
                  {/* Left: circle + line */}
                  <div style={s.stepLeft}>
                    <StepCircle state={step.state} />
                    {!isLast && (
                      <div style={{
                        ...s.connector,
                        backgroundColor: step.state === 'done' ? '#1A6B3C' : 'transparent',
                        borderLeft: step.state === 'done'
                          ? 'none'
                          : '2px dashed #DDDDDD',
                      }} />
                    )}
                  </div>

                  {/* Right: content */}
                  <div style={{ ...s.stepContent, marginBottom: isLast ? 0 : '8px' }}>
                    <div style={s.stepTitleRow}>
                      <p style={{
                        ...s.stepTitle,
                        color: step.state === 'active'
                          ? '#1A6B3C'
                          : step.state === 'pending'
                            ? '#AAAAAA'
                            : '#1A1A1A',
                      }}>
                        {step.title}
                        {step.state === 'active' && <span style={s.liveTag}>LIVE</span>}
                      </p>
                      <span style={{
                        ...s.stepTime,
                        color: step.state === 'active' ? '#1A6B3C' : '#AAAAAA',
                        fontWeight: step.state === 'active' ? '600' : '400',
                      }}>
                        {step.time}
                      </span>
                    </div>
                    <p style={{
                      ...s.stepSub,
                      color: step.state === 'pending' ? '#CCCCCC' : '#888888',
                    }}>
                      {step.sub}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Delivery Person Card */}
          <div style={s.delivCard}>
            <div style={s.delivAvatar}>
              <span style={s.delivInitial}>R</span>
            </div>
            <div style={{ flex: 1 }}>
              <p style={s.delivName}>Rahul Kumar</p>
              <p style={s.delivRole}>Delivery Partner</p>
              <p style={s.delivPlate}>🏍️ UP 53 XX 1234</p>
            </div>
            <div style={s.delivActions}>
              <button style={s.callCircle} onClick={() => window.open('tel:+919876543210')}>
                <Phone size={17} color="#1A6B3C" />
              </button>
              <button style={s.msgCircle}>
                <MessageCircle size={17} color="#2563EB" />
              </button>
            </div>
          </div>

          {/* Live Map */}
          <div style={s.mapContainer}>
            {/* Grid lines */}
            <svg style={s.mapSvg} width="100%" height="100%">
              {[15,30,45,60,75,90].map((x) => (
                <line key={`v${x}`} x1={`${x}%`} y1="0" x2={`${x}%`} y2="100%"
                  stroke="#C8E6C9" strokeWidth="1" />
              ))}
              {[25,50,75].map((y) => (
                <line key={`h${y}`} x1="0" y1={`${y}%`} x2="100%" y2={`${y}%`}
                  stroke="#C8E6C9" strokeWidth="1" />
              ))}
              {/* Road */}
              <line x1="0" y1="55%" x2="100%" y2="55%"
                stroke="#B0BEC5" strokeWidth="4" strokeDasharray="10,4" />
            </svg>

            {/* Live badge */}
            <div style={s.liveBadge}>
              <span style={s.liveDot} />
              Live Tracking
            </div>

            {/* Home pin */}
            <div style={s.homePin}>
              <div style={s.homePinCircle}>
                <Home size={14} color="#FFFFFF" />
              </div>
              <div style={s.pinTail} />
            </div>

            {/* Bike marker */}
            <div style={{
              ...s.bikeMarker,
              transform: `translateX(${bikeX}px)`,
            }}>
              <div style={s.bikeBubble}>
                <BikeIcon size={18} color="#EA6C00" />
              </div>
            </div>

            {/* Distance pill */}
            <div style={s.distPill}>🛵 1.2 km door hai</div>

            {/* Watermark */}
            <span style={s.mapWatermark}>🗺️ Map View</span>
          </div>

          {/* Order Summary */}
          <div style={s.card}>
            <div style={s.summaryTitleRow}>
              <p style={s.cardTitle}>Order Summary</p>
              <button style={s.detailLink}>Order Details Dekho</button>
            </div>
            {[
              { Icon: Store,       text: order?.sellers?.store_name || 'Medical Store' },
              { Icon: Package,     text: `${(order?.order_items || []).length || '—'} items` },
              { Icon: IndianRupee, text: order ? `₹${parseFloat(order.final_amount || 0).toLocaleString('en-IN')}` : '—' },
              { Icon: CreditCard,  text: order?.payment_method === 'cod' ? 'Cash on Delivery' : (order?.payment_method || 'COD') },
              { Icon: MapPin,      text: order?.delivery_address || order?.sellers?.address || 'Delivery address' },
            ].map(({ Icon, text }) => (
              <div key={text} style={s.summaryRow}>
                <div style={s.summaryIconBox}>
                  <Icon size={14} color="#1A6B3C" />
                </div>
                <span style={s.summaryText}>{text}</span>
              </div>
            ))}
          </div>

          {/* Help Section */}
          <div style={s.card}>
            <p style={s.cardTitle}>Koi Samasya?</p>
            <div style={s.helpRow}>
              <button style={s.helpBtnGreen}
                onClick={() => window.open('tel:+919876543210')}>
                <Phone size={15} color="#1A6B3C" />
                Store Ko Call Karo
              </button>
              <button style={s.helpBtnBlue}>
                <MessageCircle size={15} color="#2563EB" />
                Support Se Baat Karo
              </button>
            </div>
          </div>

          {/* Cancel — only before out_for_delivery */}
          {activeStep < 3 && (
            <button style={s.cancelBtn} onClick={() => setShowCancel(true)}>
              Order Cancel Karo
            </button>
          )}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, route }) => {
            const isActive = activeTab === id;
            return (
              <button key={id} style={s.navTab}
                onClick={() => navigate(route)}>
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

        {/* Cancel Dialog */}
        {showCancel && (
          <CancelDialog
            onConfirm={handleCancelConfirm}
            onClose={() => setShowCancel(false)}
          />
        )}
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
    position: 'relative',
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
    fontSize: '16px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    textAlign: 'center',
  },
  headerSub: {
    fontSize: '12px',
    color: '#888888',
    margin: 0,
    textAlign: 'center',
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

  // ETA Banner
  etaBanner: {
    backgroundColor: '#1A6B3C',
    borderRadius: '14px',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  etaText: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#FFFFFF',
    margin: '0 0 8px',
  },
  progressBar: {
    height: '6px',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    width: '70%',
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: '3px',
  },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '16px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: '0 0 14px',
  },

  // Stepper
  stepRow: {
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start',
  },
  stepLeft: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flexShrink: 0,
    width: '36px',
  },
  circleDone: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#1A6B3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  circleActive: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    backgroundColor: '#1A6B3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    backgroundColor: '#FFFFFF',
  },
  pulseRing: {
    position: 'absolute',
    inset: '-4px',
    borderRadius: '50%',
    backgroundColor: 'rgba(26,107,60,0.25)',
    animation: 'pulse 1.6s ease-in-out infinite',
  },
  circlePending: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '2px solid #DDDDDD',
    backgroundColor: '#FFFFFF',
    flexShrink: 0,
  },
  connector: {
    width: '2px',
    flex: 1,
    minHeight: '32px',
    marginTop: '2px',
  },
  stepContent: {
    flex: 1,
    paddingBottom: '24px',
  },
  stepTitleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '4px',
  },
  stepTitle: {
    fontSize: '14px',
    fontWeight: '700',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  liveTag: {
    fontSize: '9px',
    fontWeight: '800',
    color: '#FFFFFF',
    backgroundColor: '#1A6B3C',
    padding: '2px 6px',
    borderRadius: '4px',
    letterSpacing: '0.5px',
  },
  stepTime: {
    fontSize: '12px',
    flexShrink: 0,
    marginTop: '1px',
  },
  stepSub: {
    fontSize: '12px',
    lineHeight: '1.5',
    margin: 0,
  },

  // Delivery card
  delivCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    borderLeft: '4px solid #1A6B3C',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
  },
  delivAvatar: {
    width: '46px',
    height: '46px',
    borderRadius: '23px',
    backgroundColor: '#1A6B3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  delivInitial: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#FFFFFF',
  },
  delivName: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
  },
  delivRole: {
    fontSize: '12px',
    color: '#888888',
    margin: '1px 0 3px',
  },
  delivPlate: {
    fontSize: '12px',
    color: '#666666',
    margin: 0,
  },
  delivActions: {
    display: 'flex',
    gap: '10px',
  },
  callCircle: {
    width: '40px',
    height: '40px',
    borderRadius: '20px',
    backgroundColor: '#E8F5EE',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  msgCircle: {
    width: '40px',
    height: '40px',
    borderRadius: '20px',
    backgroundColor: '#EAF2FF',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },

  // Mock map
  mapContainer: {
    position: 'relative',
    height: '180px',
    backgroundColor: '#E8F5E9',
    borderRadius: '14px',
    overflow: 'hidden',
    border: '1px solid #C8E6C9',
  },
  mapSvg: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
  liveBadge: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    fontSize: '10px',
    fontWeight: '700',
    padding: '4px 10px',
    borderRadius: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  liveDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#FFFFFF',
    display: 'inline-block',
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  homePin: {
    position: 'absolute',
    right: '28%',
    top: '30%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transform: 'translateX(50%)',
  },
  homePinCircle: {
    width: '28px',
    height: '28px',
    borderRadius: '50% 50% 50% 4px',
    backgroundColor: '#1A6B3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: 'rotate(-45deg)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeft: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderTop: '6px solid #1A6B3C',
    marginTop: '-1px',
  },
  bikeMarker: {
    position: 'absolute',
    left: '32%',
    top: '44%',
    transition: 'transform 0.12s ease-out',
  },
  bikeBubble: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#FFFFFF',
    border: '2px solid #EA6C00',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  distPill: {
    position: 'absolute',
    bottom: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#FFFFFF',
    fontSize: '12px',
    fontWeight: '600',
    padding: '5px 14px',
    borderRadius: '20px',
    whiteSpace: 'nowrap',
  },
  mapWatermark: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    fontSize: '10px',
    color: '#A5D6A7',
    pointerEvents: 'none',
    userSelect: 'none',
    fontWeight: '600',
  },

  // Order summary
  summaryTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '2px',
  },
  detailLink: {
    background: 'none',
    border: 'none',
    color: '#1A6B3C',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  },
  summaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    borderBottom: '1px solid #F5F5F5',
  },
  summaryIconBox: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  summaryText: {
    fontSize: '13px',
    color: '#333333',
  },

  // Help
  helpRow: {
    display: 'flex',
    gap: '10px',
  },
  helpBtnGreen: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '11px',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid #1A6B3C',
    borderRadius: '10px',
    color: '#1A6B3C',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  helpBtnBlue: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '11px',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid #2563EB',
    borderRadius: '10px',
    color: '#2563EB',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Cancel button
  cancelBtn: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#FFFFFF',
    color: '#EF4444',
    border: '1.5px solid #EF4444',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Cancel dialog
  dialogOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    padding: '24px',
  },
  dialogBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: '20px',
    padding: '28px 24px',
    width: '100%',
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  dialogIcon: {
    width: '64px',
    height: '64px',
    borderRadius: '32px',
    backgroundColor: '#FFEEEE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '4px',
  },
  dialogTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
  },
  dialogSub: {
    fontSize: '13px',
    color: '#888888',
    textAlign: 'center',
    margin: '0 0 8px',
  },
  dialogCancel: {
    width: '100%',
    padding: '13px',
    backgroundColor: '#EF4444',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  dialogBack: {
    width: '100%',
    padding: '13px',
    backgroundColor: '#FFFFFF',
    color: '#888888',
    border: '1.5px solid #E0E0E0',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Cancelled screen
  cancelledWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    padding: '40px 24px',
    backgroundColor: '#F5F5F5',
  },
  cancelledIcon: {
    width: '100px',
    height: '100px',
    borderRadius: '50px',
    backgroundColor: '#FFEEEE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelledTitle: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#1A1A1A',
    margin: 0,
  },
  cancelledSub: {
    fontSize: '14px',
    color: '#888888',
    margin: 0,
  },
  goHomeBtn: {
    padding: '14px 32px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: '8px',
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
