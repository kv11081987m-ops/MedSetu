import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShoppingBag, Store, Truck,
  CheckCircle, Package, Banknote,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { getCurrentSeller } from '../lib/auth';
import { createOrder, createOrderItems } from '../lib/orders';
import { createNotification, getSellerUserId } from '../lib/notifications';

const BLUE = '#0C447C';

// ─── Success View ─────────────────────────────────────────────
function SuccessView({ orderId, onDashboard }) {
  return (
    <div style={s.successWrap}>
      <div style={s.successCard}>
        <div style={s.successRing}>
          <CheckCircle size={60} color={BLUE} />
        </div>
        <p style={s.successTitle}>Order Place Ho Gaya!</p>
        <p style={s.successSub}>Wholesaler confirm karega aur delivery arrange karega.</p>
        <div style={s.orderIdBox}>
          <span style={s.orderIdLabel}>Order ID</span>
          <span style={s.orderIdVal}>#{orderId}</span>
        </div>
        <button style={s.primaryBtn} onClick={onDashboard}>
          <ShoppingBag size={16} color="#FFFFFF" />
          Mere Orders
        </button>
        <button style={s.secondaryBtn} onClick={onDashboard}>
          Dashboard Jaao
        </button>
      </div>
    </div>
  );
}

// ─── Cart Item Row ─────────────────────────────────────────────
function CartItemRow({ item, onQtyChange, onQtyInput }) {
  const moq      = item.moq || 1;
  const atMoq    = item.quantity <= moq;
  const subtotal = (item.price * item.quantity).toFixed(2);

  const [qtyInput, setQtyInput] = useState(String(item.quantity));
  const [error,    setError]    = useState('');

  // Keep the typed value in sync when quantity changes from elsewhere —
  // the +/- buttons, or the cart updating from another tab.
  useEffect(() => {
    setQtyInput(String(item.quantity));
    setError('');
  }, [item.quantity]);

  const handleInputChange = (e) => {
    const raw = e.target.value;
    setQtyInput(raw);
    const parsed = parseInt(raw, 10);
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      setError('Valid quantity daalo');
      return;
    }
    if (parsed < moq) {
      setError(`Minimum ${moq} zaroori hai`);
      return;
    }
    setError('');
    onQtyInput(item, parsed);
  };

  // Blur = final chance to fix an invalid/below-MOQ value — clamp it back
  // rather than leaving the cart's actual quantity untouched with a stale
  // error showing. Guarantees the stored quantity is never below MOQ.
  const handleBlur = () => {
    const parsed = parseInt(qtyInput, 10);
    if (qtyInput.trim() === '' || Number.isNaN(parsed) || parsed < moq) {
      const clamped = Math.max(moq, item.quantity);
      setQtyInput(String(clamped));
      setError('');
      if (clamped !== item.quantity) onQtyInput(item, clamped);
    }
  };

  return (
    <div style={s.itemRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={s.itemName}>{item.name}</p>
        <p style={s.itemSub}>₹{item.price} / {item.unit || 'unit'} · Min: {moq}</p>
        <div style={s.qtyControl}>
          <button
            style={{ ...s.qtyBtn, opacity: atMoq ? 0.3 : 1 }}
            disabled={atMoq}
            onClick={() => onQtyChange(item, -1)}
          >−</button>
          <input
            style={s.qtyInputField}
            type="number"
            min={moq}
            value={qtyInput}
            onChange={handleInputChange}
            onBlur={handleBlur}
          />
          <button style={s.qtyBtn} onClick={() => onQtyChange(item, 1)}>+</button>
        </div>
        {error && <p style={s.qtyError}>{error}</p>}
      </div>
      <span style={s.itemTotal}>₹{subtotal}</span>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function B2BCheckout() {
  const navigate = useNavigate();
  const { cartItems, cartSellerId, cartSellerName, cartTotal, cartCount, clearCart, updateQuantity } = useCart();

  const [retailer,     setRetailer]     = useState(null);
  const [retailerLoad, setRetailerLoad] = useState(true);
  const [deliveryType, setDeliveryType] = useState('pickup');
  const [ordering,     setOrdering]     = useState(false);
  const [success,      setSuccess]      = useState(false);
  const [orderId,      setOrderId]      = useState('');
  const [orderError,   setOrderError]   = useState('');

  useEffect(() => {
    getCurrentSeller().then((seller) => {
      setRetailer(seller);
      setRetailerLoad(false);
    });
  }, []);

  // ── Empty cart guard ─────────────────────────────────────────
  if (!retailerLoad && cartCount === 0 && !success) {
    return (
      <div style={s.wrapper}>
        <div style={s.screen}>
          <div style={s.header}>
            <button style={s.iconBtn} onClick={() => navigate(-1)}>
              <ArrowLeft size={22} color="#1A1A1A" />
            </button>
            <span style={s.headerTitle}>Order Confirm Karein</span>
            <div style={{ width: '34px' }} />
          </div>
          <div style={s.centerBox}>
            <Package size={40} color="#CCCCCC" />
            <p style={s.emptyTitle}>Cart khaali hai</p>
            <button style={s.blueBtn} onClick={() => navigate('/wholesalers')}>
              Wholesaler Dekho
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Success view ─────────────────────────────────────────────
  if (success) {
    return (
      <div style={s.wrapper}>
        <div style={s.screen}>
          <SuccessView
            orderId={orderId}
            onDashboard={() => navigate('/seller-dashboard')}
          />
        </div>
      </div>
    );
  }

  // MOQ floor: never let quantity drop below the wholesaler's min_order_quantity
  // for that item (carried on the cart item as `moq` since WholesalerInventory.jsx).
  const handleQtyChange = (item, delta) => {
    const moq = item.moq || 1;
    const newQty = Math.max(moq, item.quantity + delta);
    updateQuantity(item.id, newQty);
  };

  // Direct-type version — takes an absolute quantity instead of a delta.
  // Still floors at MOQ as a defensive backstop (the input's own onChange
  // already blocks calling this below MOQ, but this keeps the guarantee
  // even if that check is ever bypassed).
  const handleQtyInput = (item, newQty) => {
    const moq = item.moq || 1;
    updateQuantity(item.id, Math.max(moq, newQty));
  };

  const deliveryAddress = deliveryType === 'pickup'
    ? 'Self Pickup'
    : [retailer?.store_name, retailer?.address, retailer?.district].filter(Boolean).join(', ');

  const handlePlaceOrder = async () => {
    if (cartCount === 0 || !retailer || ordering) return;
    setOrdering(true);
    setOrderError('');

    try {
      const { data: orderRows, error: orderErr } = await createOrder({
        buyerId:         retailer.id,
        buyerType:       'retailer',
        sellerId:        cartSellerId || null,
        customerId:      null,
        totalAmount:     cartTotal,
        deliveryCharge:  0,
        discount:        0,
        finalAmount:     cartTotal,
        paymentMethod:   'cod',
        deliveryType,
        deliveryAddress,
      });

      if (orderErr || !orderRows?.length) {
        setOrderError(orderErr?.message || 'Order nahi ho saka. Dobara try karo.');
        return;
      }

      const newOrder = orderRows[0];
      const { error: itemsErr } = await createOrderItems(newOrder.id, cartItems, cartSellerId);
      if (itemsErr) {
        console.error('createOrderItems failed:', itemsErr);
        alert('Order toh ban gaya par items save nahi hue. Support se sampark karein. Order ID: ' + newOrder.order_number);
      }

      // Notify wholesaler — fire-and-forget, must not block checkout success.
      getSellerUserId(newOrder.seller_id)
        .then((sellerUserId) => sellerUserId && createNotification(
          sellerUserId, 'Naya B2B Order 📦', `Retailer se naya purchase order — ${newOrder.order_number}`, 'b2b_order', newOrder.id
        ))
        .catch((err) => console.warn('[notify wholesaler]', err));

      clearCart();
      setOrderId(newOrder.order_number || String(newOrder.id).slice(0, 8).toUpperCase());
      setSuccess(true);
    } catch (err) {
      setOrderError(err?.message || 'Order nahi ho saka. Dobara try karo.');
    } finally {
      setOrdering(false);
    }
  };

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate(-1)}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Order Confirm Karein</span>
          <div style={{ width: '34px' }} />
        </div>

        <div style={s.body}>

          {/* Wholesaler info */}
          <div style={s.card}>
            <p style={s.cardLabel}>Order ja raha hai</p>
            <div style={s.wholesalerRow}>
              <div style={s.wsIconBox}>
                <Store size={18} color={BLUE} />
              </div>
              <div>
                <p style={s.wsName}>{cartSellerName || 'Wholesaler'}</p>
                <p style={s.wsNote}>Wholesale supplier</p>
              </div>
            </div>
          </div>

          {/* Items list */}
          <div style={s.card}>
            <p style={s.cardLabel}>Order Items ({cartCount} units)</p>
            <div style={s.itemsList}>
              {cartItems.map((item, i) => (
                <div key={item.id ?? i}>
                  <CartItemRow item={item} onQtyChange={handleQtyChange} onQtyInput={handleQtyInput} />
                  {i < cartItems.length - 1 && <div style={s.divider} />}
                </div>
              ))}
            </div>
            <div style={s.totalRow}>
              <span style={s.totalLabel}>Kul Amount</span>
              <span style={s.totalVal}>₹{cartTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Delivery mode */}
          <div style={s.card}>
            <p style={s.cardLabel}>Delivery Mode</p>
            <div style={s.deliveryGrid}>
              {[
                { id: 'pickup',   Icon: Store, label: 'Wholesaler se Pickup',       hint: 'Aap khud le aayenge' },
                { id: 'delivery', Icon: Truck, label: 'Wholesaler Delivery Karega', hint: 'Aapke store pe aayega' },
              ].map(({ id, Icon, label, hint }) => (
                <button
                  key={id}
                  style={{
                    ...s.delivOption,
                    border:          deliveryType === id ? `1.5px solid ${BLUE}` : '1.5px solid #E0E0E0',
                    backgroundColor: deliveryType === id ? '#EAF2FF' : '#FFFFFF',
                  }}
                  onClick={() => setDeliveryType(id)}
                >
                  <Icon size={20} color={deliveryType === id ? BLUE : '#888888'} />
                  <span style={{ ...s.delivLabel, color: deliveryType === id ? BLUE : '#1A1A1A' }}>
                    {label}
                  </span>
                  <span style={s.delivHint}>{hint}</span>
                  {deliveryType === id && (
                    <div style={s.delivCheck}>
                      <CheckCircle size={14} color={BLUE} fill={BLUE} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Retailer shop address */}
          <div style={s.card}>
            <p style={s.cardLabel}>
              {deliveryType === 'pickup' ? 'Aapki Shop (Reference)' : 'Delivery Address'}
            </p>
            {retailerLoad ? (
              <p style={s.addrText}>Load ho raha hai...</p>
            ) : retailer ? (
              <div style={s.addrBox}>
                <p style={s.addrStoreName}>{retailer.store_name}</p>
                {retailer.address  && <p style={s.addrText}>{retailer.address}{retailer.district ? `, ${retailer.district}` : ''}</p>}
                {retailer.phone    && <p style={s.addrText}>{retailer.phone}</p>}
              </div>
            ) : (
              <p style={s.addrText}>Shop info nahi mili</p>
            )}
          </div>

          {/* Payment */}
          <div style={s.card}>
            <p style={s.cardLabel}>Payment</p>
            <div style={s.payRow}>
              <div style={s.payIconBox}>
                <Banknote size={18} color={BLUE} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={s.payLabel}>Cash on Delivery (COD)</p>
                <p style={s.payHint}>Delivery pe cash dein</p>
              </div>
              <div style={s.radioSelected} />
            </div>
            <p style={s.payNote}>Online payment jald aayega.</p>
          </div>

          {orderError ? <div style={s.errorBox}>{orderError}</div> : null}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom bar ── */}
        <div style={s.bottomBar}>
          <div>
            <p style={s.bottomLabel}>Kul Amount</p>
            <p style={s.bottomTotal}>₹{cartTotal.toFixed(2)}</p>
          </div>
          <button
            style={{ ...s.placeBtn, opacity: (!retailer || cartCount === 0 || ordering) ? 0.45 : 1 }}
            onClick={handlePlaceOrder}
            disabled={!retailer || cartCount === 0 || ordering}
          >
            <ShoppingBag size={16} color="#FFFFFF" />
            {ordering ? 'Place ho raha hai...' : 'Order Place Karo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5', position: 'relative' },

  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  headerTitle: { fontSize: '16px', fontWeight: '700', color: '#1A1A1A' },

  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },

  card:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 5px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' },
  cardLabel: { fontSize: '12px', fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 },

  wholesalerRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  wsIconBox:     { width: '40px', height: '40px', borderRadius: '10px', backgroundColor: '#EAF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  wsName:        { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  wsNote:        { fontSize: '12px', color: '#888888', margin: '2px 0 0' },

  itemsList: { display: 'flex', flexDirection: 'column' },
  itemRow:   { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0' },
  itemName:  { fontSize: '14px', fontWeight: '600', color: '#1A1A1A', margin: 0 },
  itemSub:   { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  itemTotal: { fontSize: '14px', fontWeight: '700', color: BLUE, flexShrink: 0 },
  divider:   { height: '1px', backgroundColor: '#F5F5F5', margin: '4px 0' },

  qtyControl:{ display: 'flex', alignItems: 'center', border: '1.5px solid #DAEAFF', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#F8FAFF', width: 'fit-content', marginTop: '6px' },
  qtyBtn:    { width: '28px', height: '28px', background: 'none', border: 'none', fontSize: '15px', fontWeight: '700', color: BLUE, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', lineHeight: 1 },
  qtyInputField: { width: '40px', height: '28px', textAlign: 'center', fontSize: '13px', fontWeight: '700', color: '#1A1A1A', border: 'none', borderLeft: '1px solid #DAEAFF', borderRight: '1px solid #DAEAFF', backgroundColor: 'transparent', outline: 'none', fontFamily: 'inherit', MozAppearance: 'textfield' },
  qtyError:  { fontSize: '11px', color: '#DC3545', fontWeight: '600', margin: '4px 0 0' },
  totalRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1.5px solid #F0F0F0', paddingTop: '10px' },
  totalLabel:{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A' },
  totalVal:  { fontSize: '20px', fontWeight: '800', color: BLUE },

  deliveryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  delivOption:  { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', padding: '12px', border: '1.5px solid #E0E0E0', borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit', position: 'relative', background: 'none', textAlign: 'left' },
  delivLabel:   { fontSize: '12px', fontWeight: '700', margin: 0 },
  delivHint:    { fontSize: '11px', color: '#888888' },
  delivCheck:   { position: 'absolute', top: '8px', right: '8px' },

  addrBox:       { backgroundColor: '#F5F9FF', borderRadius: '10px', padding: '12px', border: '1px solid #DAEAFF' },
  addrStoreName: { fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  addrText:      { fontSize: '13px', color: '#555555', margin: '2px 0 0' },

  payRow:       { display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#EAF2FF', borderRadius: '10px', padding: '12px', border: '1.5px solid ' + BLUE },
  payIconBox:   { width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  payLabel:     { fontSize: '14px', fontWeight: '600', color: BLUE, margin: 0 },
  payHint:      { fontSize: '12px', color: '#555555', margin: '2px 0 0' },
  radioSelected:{ width: '18px', height: '18px', borderRadius: '9px', backgroundColor: BLUE, border: '3px solid #FFFFFF', boxShadow: '0 0 0 2px ' + BLUE, flexShrink: 0 },
  payNote:      { fontSize: '12px', color: '#AAAAAA', margin: 0 },

  errorBox: { backgroundColor: '#FFEBEE', padding: '12px 14px', borderRadius: '10px', fontSize: '13px', color: '#C62828' },

  bottomBar:   { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 -4px 16px rgba(0,0,0,0.08)' },
  bottomLabel: { fontSize: '11px', color: '#888888', margin: 0 },
  bottomTotal: { fontSize: '20px', fontWeight: '800', color: BLUE, margin: 0, lineHeight: 1 },
  placeBtn:    { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: BLUE, color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.2s ease' },

  centerBox:  { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '48px 24px' },
  emptyTitle: { fontSize: '16px', fontWeight: '600', color: '#888888', margin: 0 },
  blueBtn:    { padding: '13px 28px', backgroundColor: BLUE, color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  successWrap:  { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', backgroundColor: '#F5F5F5', minHeight: '100vh' },
  successCard:  { width: '100%', backgroundColor: '#FFFFFF', borderRadius: '20px', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' },
  successRing:  { width: '100px', height: '100px', borderRadius: '50px', backgroundColor: '#EAF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: '22px', fontWeight: '800', color: '#1A1A1A', margin: 0, textAlign: 'center' },
  successSub:   { fontSize: '14px', color: '#888888', margin: 0, textAlign: 'center', lineHeight: '1.5' },
  orderIdBox:   { backgroundColor: '#EAF2FF', border: '1.5px dashed ' + BLUE, borderRadius: '10px', padding: '10px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' },
  orderIdLabel: { fontSize: '10px', color: '#888888', textTransform: 'uppercase', letterSpacing: '0.8px' },
  orderIdVal:   { fontSize: '18px', fontWeight: '800', color: BLUE },
  primaryBtn:   { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: BLUE, color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  secondaryBtn: { width: '100%', padding: '14px', backgroundColor: '#FFFFFF', color: BLUE, border: '1.5px solid ' + BLUE, borderRadius: '12px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
};
