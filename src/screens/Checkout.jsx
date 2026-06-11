import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShoppingCart, Store, MapPin, Pill,
  Monitor, Truck, Tag, CheckCircle, Clock,
  Trash2, Plus, Banknote, Smartphone, CreditCard,
  Wallet, ChevronRight, PartyPopper,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { createOrder, createOrderItems } from '../lib/orders';
import { supabase } from '../lib/supabase';


const PAYMENT_OPTS = [
  { id: 'cod',    Icon: Banknote,    label: 'Cash on Delivery', hint: 'Delivery pe cash dein' },
  { id: 'upi',    Icon: Smartphone,  label: 'UPI',              hint: 'Google Pay, PhonePe, Paytm' },
  { id: 'card',   Icon: CreditCard,  label: 'Card',             hint: 'Credit / Debit card' },
  { id: 'wallet', Icon: Wallet,      label: 'Wallet',           hint: 'MedSetu wallet' },
];

const PROMO_CODE   = 'FIRST10';
const PROMO_PCT    = 10;
const DELIVERY_FEE = 30;

// ─── Confetti dots ────────────────────────────────────────────
const CONFETTI_COLORS = ['#1A6B3C','#F59E0B','#EF4444','#2563EB','#EC4899','#8B5CF6'];
const CONFETTI_DOTS   = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  left:  `${Math.random() * 100}%`,
  delay: `${Math.random() * 0.8}s`,
  size:  `${6 + Math.random() * 8}px`,
  dur:   `${1.2 + Math.random() * 0.6}s`,
}));

// ─── Cart Item ────────────────────────────────────────────────
function CartItem({ item, onQtyChange, onRemove }) {
  const subtotal = (item.price * item.qty).toFixed(2);
  const { IconComp } = item;
  return (
    <div style={s.cartItem}>
      <div style={{ ...s.itemIcon, backgroundColor: item.iconBg }}>
        <IconComp size={20} color={item.iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.itemTopRow}>
          <p style={s.itemName}>{item.name}</p>
          <button style={s.trashBtn} onClick={() => onRemove(item.id)}>
            <Trash2 size={15} color="#EF4444" />
          </button>
        </div>
        <p style={s.itemSub}>{item.sub}</p>
        <span style={item.rx ? s.rxGreen : s.rxNone}>
          {item.rx ? 'Rx Required ✓' : 'No Rx Needed'}
        </span>
        <div style={s.itemFooter}>
          <span style={s.itemPrice}>₹{item.price.toFixed(2)}</span>
          <div style={s.qtyControl}>
            <button style={s.qtyBtn}
              onClick={() => onQtyChange(item.id, -1)} disabled={item.qty <= 1}>−</button>
            <span style={s.qtyNum}>{item.qty}</span>
            <button style={s.qtyBtn}
              onClick={() => onQtyChange(item.id, 1)} disabled={item.qty >= 10}>+</button>
          </div>
          <span style={s.subtotal}>₹{subtotal}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Success Overlay ──────────────────────────────────────────
function SuccessOverlay({ onTrack, onHome, orderId }) {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@keyframes confettiFall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(110vh) rotate(720deg); opacity: 0; } }`;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  return (
    <div style={s.overlay}>
      {/* Confetti */}
      {CONFETTI_DOTS.map((d) => (
        <div key={d.id} style={{
          ...s.confettiDot,
          width: d.size, height: d.size,
          backgroundColor: d.color,
          left: d.left,
          animationDuration: d.dur,
          animationDelay: d.delay,
        }} />
      ))}

      <div style={s.successCard}>
        <div style={s.successRing}>
          <CheckCircle size={64} color="#1A6B3C" />
        </div>
        <h2 style={s.successTitle}>Order Place Ho Gaya!</h2>
        <p style={s.successEmoji}>🎉</p>

        <div style={s.orderIdBox}>
          <span style={s.orderIdLabel}>Order ID</span>
          <span style={s.orderId}>#{orderId}</span>
        </div>

        <div style={s.etaBox}>
          <Truck size={16} color="#1A6B3C" />
          <span style={s.etaText}>Estimated Delivery: <strong>45 min</strong></span>
        </div>

        <button style={s.trackBtn} onClick={onTrack}>
          <ShoppingCart size={16} color="#FFFFFF" />
          Order Track Karo
        </button>
        <button style={s.homeBtn} onClick={onHome}>
          Home Jaao
        </button>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function Checkout() {
  const navigate = useNavigate();
  const { cartItems, cartSellerId, cartSellerName, clearCart } = useCart();

  const [items, setItems] = useState(() =>
    cartItems.map((i) => ({
      ...i,
      qty: i.quantity,
      iconBg: i.iconBg || '#E8F5EE',
      iconColor: i.iconColor || '#1A6B3C',
      IconComp: i.IconComp || Pill,
      sub: i.sub || `${i.type || 'Tablet'} — per strip`,
      rx: i.rx || false,
    }))
  );

  const [selectedAddress, setSelectedAddress] = useState('');
  const [addressLoading, setAddressLoading]   = useState(true);
  const [delivery, setDelivery]         = useState('home');
  const [payment, setPayment]           = useState('cod');
  const [promoInput, setPromoInput]     = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError]     = useState('');
  const [success, setSuccess]           = useState(false);
  const [orderId, setOrderId]           = useState('');
  const [ordering, setOrdering]         = useState(false);
  const [orderError, setOrderError]     = useState('');
  const [orderDbId, setOrderDbId]       = useState('');

  // ── Fetch default address ──────────────────────────────────
  useEffect(() => {
    const fetchDefaultAddress = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
        if (!user?.id) { setSelectedAddress(''); setAddressLoading(false); return; }
        const { data } = await supabase
          .from('addresses')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .maybeSingle();
        setSelectedAddress(
          data ? `${data.address_line}, ${data.city} — ${data.pincode}` : ''
        );
      } catch {
        setSelectedAddress('');
      } finally {
        setAddressLoading(false);
      }
    };
    fetchDefaultAddress();
  }, []);

  // ── Calculations ──
  const cartTotal  = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const delivFee   = delivery === 'home' ? DELIVERY_FEE : 0;
  const discount   = promoApplied ? cartTotal * (PROMO_PCT / 100) : 0;
  const grandTotal = cartTotal + delivFee - discount;
  const totalItems  = items.reduce((sum, it) => sum + it.qty, 0);
  const hasRxItems  = items.some((it) => it.rx);

  const handleQty = (id, delta) => {
    setItems((prev) => prev.map((it) =>
      it.id === id ? { ...it, qty: Math.min(10, Math.max(1, it.qty + delta)) } : it
    ));
  };

  const handleRemove = (id) => setItems((prev) => prev.filter((it) => it.id !== id));

  const applyPromo = () => {
    if (promoInput.trim().toUpperCase() === PROMO_CODE) {
      setPromoApplied(true);
      setPromoError('');
    } else {
      setPromoError('Invalid promo code');
      setPromoApplied(false);
    }
  };

  // ── Derived: prescription requirement check ──
  const rxVerified = !hasRxItems || items.every((it) => !it.rx);

  // ── Place Order (real Supabase) ──
  const placeOrder = async () => {
    if (!items.length || ordering) return;
    if (hasRxItems && !rxVerified) {
      setOrderError('Prescription required items ke liye pehle Rx upload karo');
      return;
    }
    if (delivery === 'home' && !selectedAddress) {
      setOrderError('Delivery address add karo');
      return;
    }
    setOrdering(true);
    setOrderError('');

    const storedUser   = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
    const customerId   = storedUser?.id || null;

    const orderData = {
      customerId,
      sellerId:       cartSellerId || null,
      totalAmount:    cartTotal,
      deliveryCharge: delivFee,
      discount,
      promoCode:      promoApplied ? PROMO_CODE : null,
      finalAmount:    grandTotal,
      paymentMethod:  payment,
      deliveryType:   delivery,
      deliveryAddress: delivery === 'home' ? selectedAddress : 'Store Pickup',
    };

    try {
      const { data: orderRows, error: orderErr } = await createOrder(orderData);

      if (orderErr || !orderRows?.length) {
        setOrderError(orderErr?.message || 'Order nahi ho saka. Dobara try karo.');
        setOrdering(false);
        return;
      }

      const newOrder = orderRows[0];
      setOrderDbId(newOrder.id);

      const orderItems = items.map((it) => ({
        id:       it.id,
        name:     it.name,
        quantity: it.qty,
        price:    it.price,
      }));

      await createOrderItems(newOrder.id, orderItems);

      setOrderId(newOrder.order_number || 'MED-' + Date.now());
      clearCart();
      setSuccess(true);
    } catch (err) {
      setOrderError(err?.message || 'Order nahi ho saka. Dobara try karo.');
    } finally {
      setOrdering(false);
    }
  };

  if (success) {
    return (
      <SuccessOverlay
        orderId={orderId}
        onTrack={() => navigate('/order-tracking', { state: { orderId: orderDbId || orderId } })}
        onHome={() => navigate('/home')}
      />
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate(-1)}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Aapka Cart</span>
          <div style={s.cartBadgeWrap}>
            <ShoppingCart size={22} color="#1A1A1A" />
            {totalItems > 0 && <span style={s.cartBadge}>{totalItems}</span>}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Store Banner */}
          <div style={s.storeBanner}>
            <div style={s.storeLeft}>
              <div style={s.storeIconBox}>
                <Store size={18} color="#1A6B3C" />
              </div>
              <div>
                <p style={s.storeName}>{cartSellerName ? `${cartSellerName} se order` : 'Store se order'}</p>
                <p style={s.storeAddr}>Deoria, UP</p>
              </div>
            </div>
            <button style={s.changeLink} onClick={() => navigate('/store-locator')}>
              Change
            </button>
          </div>

          {/* Cart Items */}
          {items.length > 0 ? (
            <div style={s.card}>
              <p style={s.cardTitle}>Cart Mein Hai ({totalItems} items)</p>
              <div style={s.itemsList}>
                {items.map((item, i) => (
                  <div key={item.id}>
                    <CartItem item={item} onQtyChange={handleQty} onRemove={handleRemove} />
                    {i < items.length - 1 && <div style={s.itemDivider} />}
                  </div>
                ))}
              </div>
              <button style={s.addMoreBtn} onClick={() => navigate('/medicine-search')}>
                <Plus size={15} color="#1A6B3C" />
                Aur Medicine Add Karo
              </button>
            </div>
          ) : (
            <div style={s.emptyCart}>
              <ShoppingCart size={48} color="#CCCCCC" />
              <p style={s.emptyText}>Cart khaali hai</p>
              <button style={s.shopBtn} onClick={() => navigate('/medicine-search')}>
                Medicines Dhundho
              </button>
            </div>
          )}

          {/* Delivery Address */}
          <div style={s.card}>
            <p style={s.cardTitle}>Delivery Kahan Karen?</p>
            <div style={s.addressRow}>
              <MapPin size={18} color="#1A6B3C" style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={s.addressText}>
                {addressLoading
                  ? 'Address load ho raha hai...'
                  : selectedAddress || 'Koi address nahi mila — naya add karo'}
              </p>
              <button style={s.changeLink}>Change</button>
            </div>
            <button style={s.addAddrBtn}>
              <Plus size={14} color="#1A6B3C" />
              Naya Address Add Karo
            </button>
          </div>

          {/* Delivery Type */}
          <div style={s.card}>
            <p style={s.cardTitle}>Delivery Type</p>
            <div style={s.deliveryGrid}>
              {[
                { id: 'home',   Icon: Truck,  label: 'Home Delivery', hint: '30–60 min mein', charge: '₹30 delivery charge' },
                { id: 'pickup', Icon: Store,  label: 'Store Se Pickup', hint: 'Ready in 15 min', charge: 'Free' },
              ].map(({ id, Icon, label, hint, charge }) => (
                <button
                  key={id}
                  style={{
                    ...s.delivOption,
                    borderColor: delivery === id ? '#1A6B3C' : '#E0E0E0',
                    backgroundColor: delivery === id ? '#E8F5EE' : '#FFFFFF',
                  }}
                  onClick={() => setDelivery(id)}
                >
                  <Icon size={22} color={delivery === id ? '#1A6B3C' : '#888888'} />
                  <span style={{ ...s.delivLabel, color: delivery === id ? '#1A6B3C' : '#1A1A1A' }}>
                    {label}
                  </span>
                  <span style={s.delivHint}>{hint}</span>
                  <span style={{ ...s.delivCharge, color: delivery === id ? '#1A6B3C' : '#888888' }}>
                    {charge}
                  </span>
                  {delivery === id && (
                    <div style={s.delivCheck}>
                      <CheckCircle size={14} color="#1A6B3C" fill="#1A6B3C" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Prescription Status */}
          {hasRxItems && <div style={rxVerified ? s.rxVerifiedCard : s.rxPendingCard}>
            {rxVerified ? (
              <>
                <CheckCircle size={18} color="#1A6B3C" />
                <div style={{ flex: 1 }}>
                  <p style={s.rxTitle}>Prescription Verified ✓</p>
                  <p style={s.rxSub}>Hamare pharmacist ne verify kar diya hai</p>
                </div>
              </>
            ) : (
              <>
                <Clock size={18} color="#EA6C00" />
                <div style={{ flex: 1 }}>
                  <p style={{ ...s.rxTitle, color: '#EA6C00' }}>Prescription Pending</p>
                  <p style={s.rxSub}>Rx items ke liye prescription zaroori hai</p>
                </div>
                <button style={s.uploadRxBtn} onClick={() => navigate('/prescription')}>
                  Upload Karo
                </button>
              </>
            )}
          </div>}

          {/* Promo Code */}
          <div style={s.card}>
            <div style={s.promoRow}>
              <Tag size={16} color="#1A6B3C" />
              <span style={s.promoHeading}>Promo Code</span>
            </div>
            {promoApplied ? (
              <div style={s.promoApplied}>
                <CheckCircle size={16} color="#1A6B3C" />
                <span style={s.promoAppliedText}>
                  {PROMO_CODE} — {PROMO_PCT}% off applied!
                </span>
                <button style={s.removePromo} onClick={() => { setPromoApplied(false); setPromoInput(''); }}>
                  <Trash2 size={13} color="#EF4444" />
                </button>
              </div>
            ) : (
              <>
                <div style={s.promoInputRow}>
                  <input
                    style={s.promoInput}
                    placeholder="Promo code daalo"
                    value={promoInput}
                    onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(''); }}
                  />
                  <button
                    style={{ ...s.applyBtn, opacity: promoInput ? 1 : 0.5 }}
                    onClick={applyPromo}
                    disabled={!promoInput}
                  >Apply</button>
                </div>
                {promoError && <p style={s.promoError}>{promoError}</p>}
                <p style={s.promoHint}>Try: <strong>FIRST10</strong> for 10% off</p>
              </>
            )}
          </div>

          {/* Order Summary */}
          <div style={s.card}>
            <p style={s.cardTitle}>Order Summary</p>
            <div style={s.summaryRows}>
              <div style={s.summaryRow}>
                <span style={s.summaryKey}>Cart Total</span>
                <span style={s.summaryVal}>₹{cartTotal.toFixed(2)}</span>
              </div>
              <div style={s.summaryRow}>
                <span style={s.summaryKey}>Delivery Charge</span>
                <span style={s.summaryVal}>{delivFee === 0 ? 'Free' : `₹${delivFee.toFixed(2)}`}</span>
              </div>
              {promoApplied && (
                <div style={s.summaryRow}>
                  <span style={s.summaryKey}>Discount ({PROMO_CODE})</span>
                  <span style={{ ...s.summaryVal, color: '#1A6B3C' }}>− ₹{discount.toFixed(2)}</span>
                </div>
              )}
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryTotal}>
              <span style={s.totalKey}>Kul Amount</span>
              <span style={s.totalVal}>₹{grandTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment Method */}
          <div style={s.card}>
            <p style={s.cardTitle}>Payment Kaise Karein?</p>
            <div style={s.paymentList}>
              {PAYMENT_OPTS.map(({ id, Icon, label, hint }) => (
                <button
                  key={id}
                  style={{
                    ...s.payOption,
                    borderColor: payment === id ? '#1A6B3C' : '#F0F0F0',
                    backgroundColor: payment === id ? '#F0FBF4' : '#FFFFFF',
                  }}
                  onClick={() => setPayment(id)}
                >
                  <div style={{ ...s.payIconBox, backgroundColor: payment === id ? '#E8F5EE' : '#F5F5F5' }}>
                    <Icon size={18} color={payment === id ? '#1A6B3C' : '#888888'} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ ...s.payLabel, color: payment === id ? '#1A6B3C' : '#1A1A1A' }}>{label}</p>
                    <p style={s.payHint}>{hint}</p>
                  </div>
                  <div style={{
                    ...s.radioCircle,
                    borderColor: payment === id ? '#1A6B3C' : '#CCCCCC',
                  }}>
                    {payment === id && <div style={s.radioDot} />}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: '90px' }} />
        </div>

        {/* ── Order error ── */}
        {orderError ? (
          <div style={{ backgroundColor: '#FFEBEE', padding: '10px 16px', margin: '0 12px', borderRadius: '10px', fontSize: '13px', color: '#C62828' }}>
            {orderError}
          </div>
        ) : null}

        {/* ── Fixed Bottom Bar ── */}
        <div style={s.bottomBar}>
          <div>
            <p style={s.bottomLabel}>Kul Amount</p>
            <p style={s.bottomPrice}>₹{grandTotal.toFixed(2)}</p>
          </div>
          <button
            style={{ ...s.placeBtn, opacity: (items.length && !ordering && !addressLoading) ? 1 : 0.45 }}
            onClick={placeOrder}
            disabled={!items.length || ordering || addressLoading}
          >
            <ShoppingCart size={17} color="#FFFFFF" />
            {ordering ? 'Order Ho Raha Hai...' : 'Order Place Karo'}
          </button>
        </div>
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
  cartBadgeWrap: {
    position: 'relative',
    padding: '6px',
  },
  cartBadge: {
    position: 'absolute',
    top: '0px',
    right: '0px',
    minWidth: '18px',
    height: '18px',
    borderRadius: '9px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    fontSize: '10px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
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

  // Store banner
  storeBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
  },
  storeLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  storeIconBox: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
  },
  storeAddr: {
    fontSize: '12px',
    color: '#888888',
    margin: 0,
  },
  changeLink: {
    background: 'none',
    border: 'none',
    color: '#1A6B3C',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
    flexShrink: 0,
  },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '16px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
  },

  // Cart items
  itemsList: {
    display: 'flex',
    flexDirection: 'column',
  },
  cartItem: {
    display: 'flex',
    gap: '12px',
    paddingBottom: '2px',
  },
  itemIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '2px',
  },
  itemTopRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '4px',
  },
  itemName: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    flex: 1,
    lineHeight: '1.3',
  },
  itemSub: {
    fontSize: '12px',
    color: '#888888',
    margin: '2px 0 4px',
  },
  rxGreen: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#1A6B3C',
  },
  rxNone: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#1A6B3C',
  },
  itemFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '8px',
  },
  itemPrice: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#888888',
    flexShrink: 0,
  },
  qtyControl: {
    display: 'flex',
    alignItems: 'center',
    border: '1.5px solid #E0E0E0',
    borderRadius: '8px',
    overflow: 'hidden',
    flexShrink: 0,
  },
  qtyBtn: {
    width: '28px',
    height: '28px',
    background: '#F5F5F5',
    border: 'none',
    fontSize: '16px',
    fontWeight: '700',
    color: '#1A6B3C',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    lineHeight: 1,
  },
  qtyNum: {
    width: '28px',
    textAlign: 'center',
    fontSize: '14px',
    fontWeight: '700',
    color: '#1A1A1A',
    borderLeft: '1px solid #E0E0E0',
    borderRight: '1px solid #E0E0E0',
    lineHeight: '28px',
  },
  subtotal: {
    fontSize: '14px',
    fontWeight: '800',
    color: '#1A6B3C',
    marginLeft: 'auto',
  },
  trashBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '6px',
    flexShrink: 0,
  },
  itemDivider: {
    height: '1px',
    backgroundColor: '#F5F5F5',
    margin: '12px 0',
  },
  addMoreBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    color: '#1A6B3C',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: '8px',
    borderRadius: '10px',
    backgroundColor: '#F0FBF4',
  },

  // Empty cart
  emptyCart: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '48px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
  },
  emptyText: {
    fontSize: '16px',
    color: '#AAAAAA',
    fontWeight: '600',
    margin: 0,
  },
  shopBtn: {
    padding: '12px 24px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: '4px',
  },

  // Address
  addressRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
  },
  addressText: {
    fontSize: '14px',
    color: '#333333',
    flex: 1,
    margin: 0,
    lineHeight: '1.5',
  },
  addAddrBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px',
    backgroundColor: '#FFFFFF',
    border: '1.5px dashed #1A6B3C',
    borderRadius: '10px',
    color: '#1A6B3C',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Delivery options
  deliveryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
  },
  delivOption: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    padding: '14px 12px',
    border: '1.5px solid',
    borderRadius: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    position: 'relative',
    transition: 'all 0.15s ease',
    textAlign: 'left',
    background: 'none',
  },
  delivLabel: {
    fontSize: '13px',
    fontWeight: '700',
    margin: 0,
  },
  delivHint: {
    fontSize: '11px',
    color: '#888888',
  },
  delivCharge: {
    fontSize: '12px',
    fontWeight: '600',
    marginTop: '2px',
  },
  delivCheck: {
    position: 'absolute',
    top: '8px',
    right: '8px',
  },

  // Rx status
  rxVerifiedCard: {
    backgroundColor: '#E8F5EE',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    border: '1px solid #C8E6C9',
  },
  rxPendingCard: {
    backgroundColor: '#FFF3E8',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    border: '1px solid #FFCC80',
  },
  rxTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1A6B3C',
    margin: 0,
  },
  rxSub: {
    fontSize: '12px',
    color: '#666666',
    margin: 0,
  },
  uploadRxBtn: {
    padding: '6px 12px',
    backgroundColor: '#EA6C00',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },

  // Promo
  promoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  promoHeading: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  promoInputRow: {
    display: 'flex',
    gap: '8px',
  },
  promoInput: {
    flex: 1,
    padding: '11px 14px',
    border: '1.5px solid #E0E0E0',
    borderRadius: '10px',
    fontSize: '14px',
    color: '#1A1A1A',
    outline: 'none',
    fontFamily: 'inherit',
    letterSpacing: '0.5px',
  },
  applyBtn: {
    padding: '11px 18px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  promoError: {
    fontSize: '12px',
    color: '#EF4444',
    margin: '-4px 0 0',
  },
  promoHint: {
    fontSize: '12px',
    color: '#888888',
    margin: 0,
  },
  promoApplied: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#E8F5EE',
    borderRadius: '10px',
    padding: '10px 14px',
    border: '1px solid #C8E6C9',
  },
  promoAppliedText: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1A6B3C',
    flex: 1,
  },
  removePromo: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px',
    display: 'flex',
  },

  // Summary
  summaryRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryKey: {
    fontSize: '14px',
    color: '#666666',
  },
  summaryVal: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1A1A1A',
  },
  summaryDivider: {
    height: '1px',
    backgroundColor: '#F0F0F0',
    margin: '2px 0',
  },
  summaryTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalKey: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  totalVal: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#1A6B3C',
  },

  // Payment
  paymentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  payOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    border: '1.5px solid',
    borderRadius: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: 'all 0.15s ease',
    background: 'none',
  },
  payIconBox: {
    width: '38px',
    height: '38px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  payLabel: {
    fontSize: '14px',
    fontWeight: '600',
    margin: 0,
    lineHeight: '1.3',
  },
  payHint: {
    fontSize: '12px',
    color: '#888888',
    margin: 0,
  },
  radioCircle: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#1A6B3C',
  },

  // Bottom bar
  bottomBar: {
    position: 'sticky',
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTop: '1px solid #F0F0F0',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
  },
  bottomLabel: {
    fontSize: '11px',
    color: '#888888',
    margin: 0,
  },
  bottomPrice: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#1A6B3C',
    margin: 0,
    lineHeight: 1,
  },
  placeBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.2s ease',
  },

  // Success overlay
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    overflow: 'hidden',
  },
  confettiDot: {
    position: 'absolute',
    top: '-10px',
    borderRadius: '2px',
    animation: 'confettiFall linear forwards',
  },
  successCard: {
    width: 'calc(100% - 48px)',
    maxWidth: '380px',
    backgroundColor: '#FFFFFF',
    borderRadius: '24px',
    padding: '32px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    zIndex: 201,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  successRing: {
    width: '110px',
    height: '110px',
    borderRadius: '55px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#1A1A1A',
    textAlign: 'center',
    margin: 0,
  },
  successEmoji: {
    fontSize: '28px',
    margin: '-8px 0 0',
  },
  orderIdBox: {
    backgroundColor: '#F0FBF4',
    border: '1.5px dashed #1A6B3C',
    borderRadius: '10px',
    padding: '10px 28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },
  orderIdLabel: {
    fontSize: '10px',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
  },
  orderId: {
    fontSize: '18px',
    fontWeight: '800',
    color: '#1A6B3C',
  },
  etaBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#E8F5EE',
    padding: '8px 16px',
    borderRadius: '20px',
  },
  etaText: {
    fontSize: '13px',
    color: '#1A6B3C',
  },
  trackBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: '4px',
  },
  homeBtn: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#FFFFFF',
    color: '#1A6B3C',
    border: '1.5px solid #1A6B3C',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
