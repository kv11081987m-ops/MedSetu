import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ShoppingCart, Store, MapPin, Pill,
  Monitor, Truck, Tag, CheckCircle, Clock,
  Trash2, Plus, Banknote, Smartphone, CreditCard,
  Wallet, ChevronRight, PartyPopper, Gift, X,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { createOrder, createOrderItems } from '../lib/orders';
import { getSellerUserId } from '../lib/notifications';
import { supabase } from '../lib/supabase';


const PAYMENT_OPTS = [
  { id: 'cod',    Icon: Banknote,    label: 'Cash on Delivery', hint: 'Delivery pe cash dein' },
  { id: 'upi',    Icon: Smartphone,  label: 'UPI',              hint: 'Google Pay, PhonePe, Paytm' },
  { id: 'card',   Icon: CreditCard,  label: 'Card',             hint: 'Credit / Debit card' },
  { id: 'wallet', Icon: Wallet,      label: 'Wallet',           hint: 'MedSetu wallet' },
];


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
  const subtotal = ((item.price || 0) * (item.qty || 0)).toFixed(2);
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

// ─── Offers Modal — tap-to-apply list of active offers ─────────
function OffersModal({ offers, cartTotal, onApply, onClose }) {
  return (
    <div style={s.offersOverlay} onClick={onClose}>
      <div style={s.offersSheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.offersHeader}>
          <span style={s.offersTitle}>Available Offers</span>
          <button style={s.offersCloseBtn} onClick={onClose}>
            <X size={18} color="#666666" />
          </button>
        </div>

        {offers.length === 0 ? (
          <p style={s.offersEmpty}>Abhi koi active offer nahi hai</p>
        ) : (
          <div style={s.offersList}>
            {offers.map((o) => {
              const notEligible = o.min_order && cartTotal < o.min_order;
              const desc = o.discount_type === 'percentage'
                ? `${o.discount_value}% off${o.min_order ? `, min ₹${o.min_order}` : ''}`
                : `₹${o.discount_value} off${o.min_order ? `, min ₹${o.min_order}` : ''}`;
              return (
                <div key={o.id} style={{ ...s.offerItem, opacity: notEligible ? 0.5 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <p style={s.offerCode}>{o.promo_code}</p>
                    <p style={s.offerDesc}>{o.title ? `${o.title} — ${desc}` : desc}</p>
                    {notEligible && (
                      <p style={s.offerReason}>Aur ₹{(o.min_order - cartTotal).toFixed(0)} ka order karo isse apply karne ke liye</p>
                    )}
                  </div>
                  <button
                    style={{ ...s.offerApplyBtn, opacity: notEligible ? 0.5 : 1 }}
                    onClick={() => onApply(o.promo_code)}
                    disabled={notEligible}
                  >
                    Apply
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function Checkout() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { cartItems, cartSellerId, cartSellerName, clearCart, updateQuantity, removeFromCart } = useCart();

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

  const [selectedAddress,     setSelectedAddress]     = useState('');
  const [addressLoading,      setAddressLoading]      = useState(true);
  const [prescriptionUploaded, setPrescriptionUploaded] = useState(
    !!location.state?.prescriptionUrl
  );
  // The URL for *this* order only comes from a fresh upload just now
  // (location.state) — the fallback "has this customer uploaded ever"
  // check below only unlocks the button, it never supplies a URL to attach.
  const prescriptionUrl = location.state?.prescriptionUrl || null;
  const [delivery, setDelivery]         = useState('home');
  const [payment, setPayment]           = useState('cod');
  const [promoInput, setPromoInput]     = useState('');
  const [appliedOffer, setAppliedOffer] = useState(null);
  const [promoError, setPromoError]     = useState('');
  const [showOffers, setShowOffers]     = useState(false);
  const [availableOffers, setAvailableOffers] = useState([]);
  const [success, setSuccess]           = useState(false);
  const [orderId, setOrderId]           = useState('');
  const [ordering, setOrdering]         = useState(false);
  const [orderError, setOrderError]     = useState('');
  const [orderDbId, setOrderDbId]       = useState('');
  const [platformDelivery, setPlatformDelivery] = useState({ charge: 30, threshold: 0 });

  // ── Fetch platform delivery settings ──────────────────────
  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('delivery_charge, free_delivery_threshold')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPlatformDelivery({
          charge:    data.delivery_charge         ?? 30,
          threshold: data.free_delivery_threshold ?? 0,
        });
      });
  }, []);

  // ── Fetch active offers (for "Offers Dekho" picker) ────────
  // Same active + valid_from/valid_till check CustomerHome.jsx uses.
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA');
    supabase
      .from('offers')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const valid = (data || []).filter((o) => {
          const okFrom = !o.valid_from || o.valid_from <= today;
          const okTill = !o.valid_till || o.valid_till >= today;
          return okFrom && okTill;
        });
        setAvailableOffers(valid);
      });
  }, []);

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

  // ── Calculations (must be before the Rx useEffect) ──
  const hasRxItems     = items.some((it) => it.rx);
  const cartTotal      = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const isFreeDelivery = delivery === 'home' && platformDelivery.threshold > 0 && cartTotal >= platformDelivery.threshold;
  const delivFee       = delivery === 'home' && !isFreeDelivery ? platformDelivery.charge : 0;
  const amountForFree  = delivery === 'home' && platformDelivery.threshold > 0 && !isFreeDelivery
    ? platformDelivery.threshold - cartTotal
    : 0;
  const discount     = appliedOffer
    ? (appliedOffer.discount_type === 'percentage'
        ? cartTotal * (Number(appliedOffer.discount_value) / 100)
        : Number(appliedOffer.discount_value))
    : 0;
  const safeDiscount = Math.min(discount, cartTotal);
  const grandTotal   = cartTotal + delivFee - safeDiscount;
  const totalItems  = items.reduce((sum, it) => sum + it.qty, 0);

  // ── Check if user has uploaded a prescription (for Rx items) ──
  useEffect(() => {
    if (!hasRxItems || prescriptionUploaded) return;
    const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');
    if (!user?.id) return;
    supabase
      .from('prescriptions')
      .select('id')
      .eq('customer_id', user.id)
      .limit(1)
      .then(({ data }) => {
        if (data?.length) setPrescriptionUploaded(true);
      })
      .catch((err) => console.error('Prescription check failed:', err));
  }, [hasRxItems, prescriptionUploaded]);

  const handleQty = (id, delta) => {
    const current = items.find((it) => it.id === id);
    if (!current) return;
    const newQty = Math.min(10, Math.max(1, current.qty + delta));
    updateQuantity(id, newQty);
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, qty: newQty } : it));
  };

  const handleRemove = (id) => {
    removeFromCart(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // Accepts an optional code (used by the Offers picker's tap-to-apply);
  // falls back to the manually typed promoInput. Returns whether it applied,
  // so callers (like the picker) know when it's safe to close.
  const applyPromo = async (codeOverride) => {
    const code = (codeOverride ?? promoInput).trim();
    if (!code) { setPromoError('Promo code daaliye'); return false; }

    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .ilike('promo_code', code)
      .eq('active', true)
      .maybeSingle();

    if (error) { console.error('promo lookup error:', error); setPromoError('Kuch galat hua, dobara try karein'); setAppliedOffer(null); return false; }
    if (!data)  { setPromoError('Invalid ya inactive promo code'); setAppliedOffer(null); return false; }

    const todayStr = new Date().toLocaleDateString('en-CA');
    const fromStr  = data.valid_from ? String(data.valid_from).slice(0, 10) : null;
    const tillStr  = data.valid_till ? String(data.valid_till).slice(0, 10) : null;
    if (fromStr && fromStr > todayStr) { setPromoError('Yeh offer abhi shuru nahi hua'); setAppliedOffer(null); return false; }
    if (tillStr && tillStr < todayStr) { setPromoError('Yeh offer expire ho gaya'); setAppliedOffer(null); return false; }
    if (data.min_order && cartTotal < data.min_order) { setPromoError(`Yeh code ₹${data.min_order} se zyada ke order pe lagega`); setAppliedOffer(null); return false; }
    if (data.max_uses && data.max_uses > 0 && data.uses >= data.max_uses) { setPromoError('Yeh offer khatam ho gaya'); setAppliedOffer(null); return false; }

    setAppliedOffer(data);
    setPromoInput(data.promo_code);
    setPromoError('');
    return true;
  };

  const applyOfferFromList = async (code) => {
    const ok = await applyPromo(code);
    if (ok) setShowOffers(false);
  };

  // ── Derived: prescription verified if no Rx items or user uploaded one ──
  const rxVerified = !hasRxItems || prescriptionUploaded;

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
      customerName:   storedUser?.name  || null,
      customerPhone:  storedUser?.phone || null,
      sellerId:       cartSellerId || null,
      totalAmount:    cartTotal,
      deliveryCharge: delivFee,
      discount:       safeDiscount,
      promoCode:      appliedOffer ? appliedOffer.promo_code : null,
      finalAmount:    grandTotal,
      paymentMethod:  payment,
      deliveryType:   delivery,
      deliveryAddress: delivery === 'home' ? selectedAddress : 'Store Pickup',
      prescriptionUrl,
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

      const { error: itemsErr } = await createOrderItems(newOrder.id, orderItems, cartSellerId);
      if (itemsErr) {
        console.error('createOrderItems failed:', itemsErr);
        alert('Order toh ban gaya par items save nahi hue. Support se sampark karein. Order ID: ' + newOrder.order_number);
      }

      // Best-effort back-link: give the prescriptions row a real order_id
      // now that the order exists. Never blocks the order on failure.
      if (prescriptionUrl) {
        supabase
          .from('prescriptions')
          .update({ order_id: newOrder.id })
          .eq('image_url', prescriptionUrl)
          .then(({ error: linkErr }) => { if (linkErr) console.warn('[prescription order_id link]', linkErr); });
      }

      // Notify seller — fire-and-forget, must not block checkout success.
      getSellerUserId(newOrder.seller_id)
        .then((sellerUserId) => sellerUserId && supabase.rpc('create_notification', {
          p_user_id: sellerUserId, p_title: 'Naya Order! 🛒',
          p_body: `Aapko naya order mila — ${newOrder.order_number}`,
          p_type: 'order_placed', p_ref_id: newOrder.id,
        }))
        .catch((err) => console.warn('[notify seller]', err));

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
        onTrack={() => navigate('/order-tracking', { state: { orderId: orderId || orderDbId } })}
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
              <button style={s.changeLink} onClick={() => navigate('/profile', { state: { openAddress: true } })}>Change</button>
            </div>
            <button style={s.addAddrBtn} onClick={() => navigate('/profile', { state: { openAddress: true } })}>
              <Plus size={14} color="#1A6B3C" />
              Naya Address Add Karo
            </button>
          </div>

          {/* Delivery Type */}
          <div style={s.card}>
            <p style={s.cardTitle}>Delivery Type</p>
            <div style={s.deliveryGrid}>
              {[
                { id: 'home',   Icon: Truck,  label: 'Home Delivery',   hint: '30–60 min mein', charge: isFreeDelivery ? 'FREE Delivery 🎉' : `₹${platformDelivery.charge} delivery charge` },
                { id: 'pickup', Icon: Store,  label: 'Store Se Pickup', hint: 'Ready in 15 min', charge: 'Free' },
              ].map(({ id, Icon, label, hint, charge }) => (
                <button
                  key={id}
                  style={{
                    ...s.delivOption,
                    border: delivery === id ? '1.5px solid #1A6B3C' : '1.5px solid #E0E0E0',
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

          {/* Free delivery nudge */}
          {amountForFree > 0 && (
            <div style={s.freeDelivNudge}>
              <span>🛵</span>
              <span>
                <strong>₹{Math.ceil(amountForFree)} aur jodein</strong> — delivery bilkul FREE hogi!
              </span>
            </div>
          )}
          {isFreeDelivery && delivery === 'home' && (
            <div style={{ ...s.freeDelivNudge, backgroundColor: '#E8F5EE', border: '1px solid #1A6B3C' }}>
              <span>🎉</span>
              <span style={{ color: '#1A6B3C' }}>Is order pe <strong>Muft Delivery</strong> mili!</span>
            </div>
          )}

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
                <button style={s.uploadRxBtn} onClick={() =>
                  navigate('/prescription', { state: { returnTo: '/checkout' } })
                }>
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
              <button style={s.viewOffersBtn} onClick={() => setShowOffers(true)}>
                <Gift size={13} color="#1A6B3C" />
                Offers Dekho
              </button>
            </div>
            {appliedOffer ? (
              <div style={s.promoApplied}>
                <CheckCircle size={16} color="#1A6B3C" />
                <span style={s.promoAppliedText}>
                  {appliedOffer.promo_code} applied! ₹{safeDiscount.toFixed(0)} off
                </span>
                <button style={s.removePromo} onClick={() => { setAppliedOffer(null); setPromoInput(''); }}>
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
                    onClick={() => applyPromo()}
                    disabled={!promoInput}
                  >Apply</button>
                </div>
                {promoError && <p style={s.promoError}>{promoError}</p>}
                <p style={s.promoHint}>Promo code hai to daaliye</p>
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
              {appliedOffer && (
                <div style={s.summaryRow}>
                  <span style={s.summaryKey}>Discount ({appliedOffer.promo_code})</span>
                  <span style={{ ...s.summaryVal, color: '#1A6B3C' }}>− ₹{safeDiscount.toFixed(2)}</span>
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
                    border: payment === id ? '1.5px solid #1A6B3C' : '1.5px solid #F0F0F0',
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
                    border: payment === id ? '2px solid #1A6B3C' : '2px solid #CCCCCC',
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

        {/* Offers Modal */}
        {showOffers && (
          <OffersModal
            offers={availableOffers}
            cartTotal={cartTotal}
            onApply={applyOfferFromList}
            onClose={() => setShowOffers(false)}
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
    border: '1.5px solid #E0E0E0',
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

  // Free delivery nudge
  freeDelivNudge: {
    backgroundColor: '#FFFBEA',
    border: '1px solid #F59E0B',
    borderRadius: '10px',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    color: '#92400E',
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
  viewOffersBtn: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '6px 12px',
    backgroundColor: '#E8F5EE',
    border: 'none',
    borderRadius: '20px',
    color: '#1A6B3C',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Offers modal
  offersOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 210,
  },
  offersSheet: {
    width: '100%',
    maxWidth: '480px',
    maxHeight: '75vh',
    backgroundColor: '#FFFFFF',
    borderRadius: '20px 20px 0 0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  offersHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 18px 14px',
    borderBottom: '1px solid #F0F0F0',
  },
  offersTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  offersCloseBtn: {
    background: '#F5F5F5',
    border: 'none',
    borderRadius: '50%',
    width: '30px',
    height: '30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  offersEmpty: {
    fontSize: '14px',
    color: '#888888',
    textAlign: 'center',
    padding: '32px 24px',
  },
  offersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px 18px 24px',
    overflowY: 'auto',
  },
  offerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px',
    border: '1.5px dashed #C8E6C9',
    borderRadius: '12px',
    backgroundColor: '#FAFFFC',
  },
  offerCode: {
    fontSize: '14px',
    fontWeight: '800',
    color: '#1A6B3C',
    margin: '0 0 3px',
    letterSpacing: '0.5px',
  },
  offerDesc: {
    fontSize: '12px',
    color: '#555555',
    margin: 0,
    lineHeight: '1.5',
  },
  offerReason: {
    fontSize: '11px',
    color: '#EF4444',
    margin: '4px 0 0',
  },
  offerApplyBtn: {
    padding: '9px 16px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
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
    border: '1.5px solid #F0F0F0',
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
    border: '2px solid #CCCCCC',
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
