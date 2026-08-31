import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { fetchOrderById } from '../lib/orders';
import { fetchSupportWhatsapp } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatIST } from '../lib/formatTime';
import { generateInvoicePDF } from '../lib/invoicePdf';
import BottomNav from '../components/BottomNav';
import {
  ArrowLeft, CheckCircle, Clock, Phone, MessageCircle,
  MapPin, Package, IndianRupee, CreditCard, Store, X, Download,
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

const ACTIVE_STEP = 1; // fallback while loading — show step 1 (not fake "delivery pe hai")

function getActiveStep(status) {
  // 'cancelled' deliberately has no entry — it must never map to step 4
  // (that reads as "delivered", the exact wrong impression this fixes).
  // A cancelled order never reaches buildSteps()/this timeline at all
  // (see the early-return below), so the `|| 1` fallback is never
  // actually shown for it — this just keeps the map itself honest.
  const map = { pending: 1, confirmed: 2, preparing: 2, out_for_delivery: 3, delivered: 4 };
  return map[status] || 1;
}

function getEtaBanner(status) {
  if (!status || status === 'pending')                   return { text: 'Store aapke order ko dekh raha hai...', progress: 25 };
  if (status === 'confirmed' || status === 'preparing')  return { text: '✅ Order accept ho gaya! Store taiyari kar raha hai.', progress: 50 };
  if (status === 'out_for_delivery')                     return { text: 'Aapka order raaste mein hai', progress: 75 };
  return { text: 'Order process ho raha hai...', progress: 25 };
}

function buildSteps(order) {
  const activeStep = order ? getActiveStep(order.status) : ACTIVE_STEP;
  const fmt        = (d) => d ? formatIST(d, { hour: '2-digit', minute: '2-digit' }) : '- -';
  return [
    // Bug fix: step 1 used to always read "Order Confirm Hua" / "Order
    // Accept Ho Gaya" — including while status is still 'pending' (seller
    // hasn't confirmed yet), which falsely told the customer their order
    // was already accepted. It's "Order Placed" now, always — same
    // wording OrderHistory.jsx's STATUS_MAP uses for 'pending' — active
    // (LIVE) while pending, done (green ✓) once confirmed+, so the
    // "order got confirmed" moment is now communicated by step 2 turning
    // LIVE instead of by relabeling step 1.
    { id: 1, title: 'Order Placed',         sub: 'Store confirm karega',                   time: fmt(order?.created_at),  state: activeStep > 1 ? 'done' : activeStep === 1 ? 'active' : 'pending' },
    { id: 2, title: 'Taiyari Ho Rahi Hai',  sub: 'Store aapki medicine pack kar raha hai', time: '- -',                   state: activeStep > 2 ? 'done' : activeStep === 2 ? 'active' : 'pending' },
    { id: 3, title: 'Delivery Pe Hai',      sub: 'Delivery boy aapke paas aa raha hai',    time: 'Expected soon',         state: activeStep > 3 ? 'done' : activeStep === 3 ? 'active' : 'pending' },
    { id: 4, title: 'Deliver Ho Gaya',      sub: 'Order aapko mil gaya',                   time: '- -',                   state: activeStep >= 4 ? 'done' : 'pending' },
  ];
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
function CancelDialog({ onConfirm, onClose, cancelling }) {
  return (
    <div style={s.dialogOverlay} onClick={cancelling ? undefined : onClose}>
      <div style={s.dialogBox} onClick={(e) => e.stopPropagation()}>
        <div style={s.dialogIcon}>
          <X size={28} color="#EF4444" />
        </div>
        <h3 style={s.dialogTitle}>Kya aap sure hain?</h3>
        <p style={s.dialogSub}>Order cancel hone ke baad wapas nahi aayega</p>
        <button style={{ ...s.dialogCancel, opacity: cancelling ? 0.6 : 1 }} disabled={cancelling} onClick={onConfirm}>
          {cancelling ? 'Cancel ho raha hai...' : 'Cancel Karo'}
        </button>
        <button style={s.dialogBack} disabled={cancelling} onClick={onClose}>Wapas Jaao</button>
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
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled]   = useState(false);
  const [supportWhatsapp, setSupportWhatsapp] = useState('919196103234');
  const [billLoading, setBillLoading] = useState(false);

  const handleDownloadBill = async () => {
    if (!order || billLoading) return;
    setBillLoading(true);
    try {
      await generateInvoicePDF(order);
    } catch (e) {
      console.error('[bill download]', e);
      alert('Bill download nahi hua, dobara try karo');
    } finally {
      setBillLoading(false);
    }
  };

  useEffect(() => {
    fetchSupportWhatsapp().then(setSupportWhatsapp);
  }, []);

  useEffect(() => {
    if (!orderId) { setLoading(false); return; }
    fetchOrderById(orderId)
      .then(({ data, error }) => {
        if (!error && data) setOrder(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [orderId]);

  const activeStep = order ? getActiveStep(order.status) : ACTIVE_STEP;
  const steps      = buildSteps(order);

  const handleCancelConfirm = async () => {
    if (cancelling) return; // guards a double-tap landing before the dialog unmounts
    setCancelling(true);
    const targetId = order?.id || orderId;
    if (!targetId) { setCancelling(false); return; }
    try {
      // RPC, not a plain UPDATE — a confirmed order has reserved stock that
      // must be released, and a customer session can't call release_stock
      // directly (owning-seller-only RLS on seller_inventory).
      const { data, error } = await supabase.rpc('cancel_order', { p_order_id: targetId });
      const result = data?.[0];
      if (error || !result?.success) {
        alert('Order cancel nahi hua: ' + (result?.message || error?.message || 'Unknown error'));
        return;
      }
      if (result.message && result.message !== 'Order cancel ho gaya') {
        alert(result.message);
      }
      setShowCancel(false);
      setCancelled(true);
    } finally {
      setCancelling(false);
    }
  };

  // Realtime subscription — instant update when seller changes this order's status.
  // Depends only on order?.id — recreating on every status change would cause rapid
  // same-name channel conflict. Subscription stays alive until unmount; harmless after delivery.
  useEffect(() => {
    if (!order?.id) return;
    const channel = supabase
      .channel(`order-tracking-${order.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${order.id}` },
        () => { fetchOrderById(order.id).then(({ data }) => { if (data) setOrder(data); }); }
      )
      .subscribe((status, err) => { if (import.meta.env.DEV) console.log('[OrderTracking Realtime]', status, err ?? ''); });
    return () => { supabase.removeChannel(channel); };
  }, [order?.id]);

  if (!loading && !orderId) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px 32px 100px', backgroundColor: '#F5F5F5' }}>
        <Package size={52} color="#CCCCCC" />
        <p style={{ fontSize: '16px', fontWeight: '700', color: '#333333', margin: 0 }}>Order nahi mila</p>
        <p style={{ fontSize: '13px', color: '#888888', margin: 0, textAlign: 'center' }}>Orders page se kisi order ko track karo</p>
        <button style={{ padding: '13px 28px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => navigate('/orders')}>
          Orders Dekho
        </button>
        <BottomNav />
      </div>
    );
  }

  if (!loading && orderId && !order) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px 32px 100px', backgroundColor: '#F5F5F5' }}>
        <Package size={52} color="#CCCCCC" />
        <p style={{ fontSize: '16px', fontWeight: '700', color: '#333333', margin: 0 }}>Yeh order nahi mila</p>
        <p style={{ fontSize: '13px', color: '#888888', margin: 0, textAlign: 'center' }}>Shayad purana ya delete ho gaya. Order History se dekhein.</p>
        <button style={{ padding: '13px 28px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => navigate('/orders')}>
          Order History Dekho
        </button>
        <BottomNav />
      </div>
    );
  }

  // Covers two cases with one screen: `cancelled` (local state) is set
  // right after THIS session's own cancel action; `order?.status ===
  // 'cancelled'` covers an order that was already cancelled before this
  // screen loaded (page reload, seller/pharmacist decline, another
  // session) — previously only the first case short-circuited here, so
  // the second fell through to the normal timeline below and hit the
  // getActiveStep('cancelled') bug (all 4 steps shown green/done).
  if (cancelled || order?.status === 'cancelled') {
    return (
      <div style={s.wrapper}>
        <div style={s.screen}>
          <div style={s.header}>
            <button style={s.iconBtn} onClick={() => navigate('/home')}>
              <ArrowLeft size={22} color="#0C447C" />
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
            {order?.cancel_reason && (
              <p style={s.cancelledReason}>Cancel wajah: {order.cancel_reason}</p>
            )}
            <button style={s.goHomeBtn} onClick={() => navigate('/home')}>Home Jaao</button>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/home')}>
            <ArrowLeft size={22} color="#0C447C" />
          </button>
          <div style={{ textAlign: 'center' }}>
            <p style={s.headerTitle}>Order Track Karo</p>
            <p style={s.headerSub}>#{order?.order_number || orderId || 'MED-XXXX'}</p>
          </div>
          <div style={{ width: 34 }} />
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* ETA Banner — conditional on real order status */}
          {order?.status === 'delivered' ? (
            <div style={s.etaBanner}>
              <CheckCircle size={18} color="#FFFFFF" />
              <p style={{ ...s.etaText, margin: 0 }}>🎉 Order deliver ho gaya!</p>
            </div>
          ) : order?.status === 'cancelled' ? null : (
            <div style={s.etaBanner}>
              {/* Seller ne accept kar liya (confirmed+) — checkmark; abhi tak pending hai to clock */}
              {order?.status && order.status !== 'pending'
                ? <CheckCircle size={18} color="#FFFFFF" />
                : <Clock size={18} color="#FFFFFF" />}
              <div style={{ flex: 1 }}>
                <p style={s.etaText}>{getEtaBanner(order?.status).text}</p>
                <div style={s.progressBar}>
                  <div style={{ ...s.progressFill, width: `${getEtaBanner(order?.status).progress}%` }} />
                </div>
              </div>
            </div>
          )}

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
                          ? '#F26C0A'
                          : step.state === 'pending'
                            ? '#AAAAAA'
                            : '#1A1A1A',
                      }}>
                        {step.title}
                        {step.state === 'active' && <span style={s.liveTag}>LIVE</span>}
                      </p>
                      <span style={{
                        ...s.stepTime,
                        color: step.state === 'active' ? '#F26C0A' : '#AAAAAA',
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
          {activeStep === 3 && (
            <div style={s.delivCard}>
              <div style={s.delivAvatar}>
                <span style={s.delivInitial}>D</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={s.delivName}>
                  {order?.delivery_partner_name || 'Delivery Partner'}
                </p>
                <p style={s.delivRole}>Delivery Partner</p>
                <p style={s.delivPlate}>
                  {order?.delivery_vehicle_number || 'Assigned'}
                </p>
              </div>
              <div style={s.delivActions}>
                {order?.delivery_partner_phone && (
                  <button style={s.callCircle} onClick={() => window.open(`tel:${order.delivery_partner_phone}`)}>
                    <Phone size={17} color="#1A6B3C" />
                  </button>
                )}
                <button style={s.msgCircle} onClick={() => {
                  const msg = encodeURIComponent('Namaste, mera order kahan hai?');
                  window.open(`https://wa.me/${supportWhatsapp}?text=${msg}`, '_blank');
                }}>
                  <MessageCircle size={17} color="#2563EB" />
                </button>
              </div>
            </div>
          )}

          {/* Order Summary */}
          <div style={s.card}>
            <div style={s.summaryTitleRow}>
              <p style={s.cardTitle}>Order Summary</p>
              <button style={s.detailLink}>Order Details Dekho</button>
            </div>
            {[
              { Icon: Store,       text: `Fulfilled by ${order?.sellers?.store_name || 'a verified pharmacy'}` },
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

            {/* R4-B: bill download — delivered B2C orders only */}
            {order?.status === 'delivered' && order?.buyer_type !== 'retailer' && (
              <button style={s.billBtn} onClick={handleDownloadBill} disabled={billLoading}>
                <Download size={14} color="#FFFFFF" />
                {billLoading ? 'Bill Ban Raha Hai...' : 'Bill Download (PDF)'}
              </button>
            )}
          </div>

          {/* Help Section */}
          <div style={s.card}>
            <p style={s.cardTitle}>Koi Samasya?</p>
            <div style={s.helpRow}>
              {order?.sellers?.phone && (
                <button style={s.helpBtnGreen}
                  onClick={() => window.open(`tel:${order.sellers.phone}`)}>
                  <Phone size={15} color="#1A6B3C" />
                  Store Ko Call Karo
                </button>
              )}
              <button style={s.helpBtnBlue} onClick={() => {
                const msg = encodeURIComponent('Namaste, mujhe apne order ke baare mein poochna tha. Kya aap help kar sakte hain?');
                window.open(`https://wa.me/${supportWhatsapp}?text=${msg}`, '_blank');
              }}>
                <MessageCircle size={15} color="#0C447C" />
                Support Se Baat Karo
              </button>
            </div>
          </div>

          {/* Cancel — only before the seller accepts (status still
              'pending' / step 1). getEtaBanner's own "Order accept ho
              gaya!" message fires at 'confirmed', so that's the accept
              moment — activeStep is 2 from there on (confirmed and
              preparing share step 2), so `=== 1` is the exact cutoff. */}
          {activeStep === 1 && (
            <button style={s.cancelBtn} onClick={() => setShowCancel(true)}>
              Order Cancel Karo
            </button>
          )}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav (shared, R3-C3) ── */}
        <BottomNav />

        {/* Cancel Dialog */}
        {showCancel && (
          <CancelDialog
            onConfirm={handleCancelConfirm}
            onClose={() => setShowCancel(false)}
            cancelling={cancelling}
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

  // Header — same soft gradient patti as Home/Categories/Checkout/OrderHistory
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
    fontSize: '16px',
    fontWeight: '700',
    color: '#0C447C',
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

  // ETA Banner — same soft green->blue gradient as OrderHistory's summary card
  etaBanner: {
    background: 'linear-gradient(135deg, #1A6B3C 0%, #156B4A 45%, #0C447C 100%)',
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
    backgroundColor: '#E0A818',
    borderRadius: '3px',
  },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '16px',
    border: '1px solid rgba(12,68,124,0.08)',
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
  // Active/LIVE stage = brand orange (distinct from done=green, pending=grey)
  circleActive: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    backgroundColor: '#F26C0A',
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
    backgroundColor: 'rgba(242,108,10,0.25)',
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
    backgroundColor: '#F26C0A',
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
  billBtn: {
    width: '100%',
    marginTop: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '11px',
    backgroundColor: '#1A6B3C',
    border: 'none',
    borderRadius: '10px',
    color: '#FFFFFF',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
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
    border: '1.5px solid #0C447C',
    borderRadius: '10px',
    color: '#0C447C',
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
    padding: '40px 24px 100px',
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
  cancelledReason: {
    fontSize: '13px',
    color: '#DC2626',
    backgroundColor: '#FEF2F2',
    padding: '8px 14px',
    borderRadius: '10px',
    margin: 0,
    textAlign: 'center',
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
};
