import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Share2, Heart, Pill, ChevronDown,
  ChevronUp, AlertTriangle, ShoppingCart, CheckCircle,
  XCircle, Bell,
} from 'lucide-react';

// ─── Dummy Data ───────────────────────────────────────────────
const STORES = [
  { id: 1, initials: 'SR', name: 'Shri Ram Medical Store', distance: '0.8 km', price: 29.75, inStock: true,  color: '#1A6B3C', bg: '#E8F5EE' },
  { id: 2, initials: 'AM', name: 'Arogya Medical Hall',    distance: '1.2 km', price: 30.0,  inStock: true,  color: '#2563EB', bg: '#EAF2FF' },
  { id: 3, initials: 'GM', name: 'Gupta Medical Agency',   distance: '2.1 km', price: 28.5,  inStock: false, color: '#EA6C00', bg: '#FFF3E8' },
];

const ACCORDION = [
  {
    id: 'uses',
    title: 'Upyog / Uses',
    icon: null,
    content: 'Paracetamol bukhaar aur dard mein rahat deta hai. Sar dard, body pain, aur bukhar ke liye upyogi hai. Dental pain aur post-surgery pain mein bhi use hota hai.',
  },
  {
    id: 'dosage',
    title: 'Kaise Lein / Dosage',
    icon: null,
    content: 'Adult: 1–2 tablet har 4–6 ghante mein.\nDin mein 8 se zyada tablet na lein.\nKhane ke saath ya baad mein lein.\nBacche ke liye doctor se poochhein.',
  },
  {
    id: 'side',
    title: 'Side Effects',
    icon: null,
    content: 'Aam taur par safe hai.\nRare cases mein: nausea, rash ya allergic reaction.\nOverdose se liver damage ho sakta hai — recommended dose se zyada na lein.',
  },
  {
    id: 'warning',
    title: 'Savdhani / Warning',
    icon: 'alert',
    content: 'Liver ki bimari mein doctor se poochhkar lein.\nAlcohol ke saath na lein.\n3 din se zyada na lein bina doctor ke.\nGarbhavastha mein upyog se pehle doctor se salah lein.',
  },
];

const SIMILAR = [
  { id: 1, name: 'Calpol 500mg', price: 32 },
  { id: 2, name: 'Dolo 650mg',   price: 28 },
  { id: 3, name: 'Metacin',      price: 18 },
  { id: 4, name: 'Febrex Plus',  price: 42 },
];

// ─── Accordion Item ───────────────────────────────────────────
function AccordionItem({ item, open, onToggle }) {
  return (
    <div style={s.accItem}>
      <button style={s.accHeader} onClick={onToggle}>
        <div style={s.accTitleRow}>
          {item.icon === 'alert' && (
            <AlertTriangle size={15} color="#EA6C00" />
          )}
          <span style={s.accTitle}>{item.title}</span>
        </div>
        {open
          ? <ChevronUp size={18} color="#888888" />
          : <ChevronDown size={18} color="#888888" />}
      </button>
      {open && (
        <div style={s.accBody}>
          {item.content.split('\n').map((line, i) => (
            <p key={i} style={s.accLine}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Store Card ───────────────────────────────────────────────
function StoreCard({ store, onOrder }) {
  return (
    <div style={s.storeCard}>
      <div style={{ ...s.storeAvatar, backgroundColor: store.bg }}>
        <span style={{ ...s.storeInitials, color: store.color }}>{store.initials}</span>
      </div>
      <p style={s.storeName}>{store.name}</p>
      <span style={s.storeDist}>{store.distance}</span>
      <p style={s.storePrice}>₹{store.price.toFixed(2)}</p>
      <div style={s.stockRow}>
        {store.inStock
          ? <><CheckCircle size={12} color="#1A6B3C" /><span style={s.inStock}>In Stock</span></>
          : <><XCircle size={12} color="#EF4444" /><span style={s.outStock}>Out of Stock</span></>}
      </div>
      {store.inStock ? (
        <button style={s.storeOrderBtn} onClick={() => onOrder(store)}>Order Karo</button>
      ) : (
        <button style={s.notifyBtn} disabled>
          <Bell size={12} color="#AAAAAA" />
          Notify Karo
        </button>
      )}
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function MedicineDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const med = location.state?.medicine;

  const { addToCart, cartCount } = useCart();
  const [qty, setQty]         = useState(1);
  const [saved, setSaved]     = useState(false);
  const [openAcc, setOpenAcc] = useState('uses');
  const [cartAdded, setCartAdded] = useState(false);
  const [availableStores, setAvailableStores] = useState(STORES);
  const [similarMedicines, setSimilarMedicines] = useState(SIMILAR);

  const toggleAcc = (id) => setOpenAcc((prev) => (prev === id ? null : id));

  // ── Fetch real stores + similar medicines ──────────────────
  useEffect(() => {
    if (!med) return;
    const keyword = med.name.split(' ')[0];

    supabase
      .from('medicines')
      .select('selling_price, stock, sellers(id, store_name, address)')
      .ilike('name', `%${keyword}%`)
      .gt('stock', 0)
      .not('seller_id', 'is', null)
      .limit(8)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const COLORS = ['#1A6B3C', '#2563EB', '#EA6C00', '#9333EA'];
          const BGS    = ['#E8F5EE', '#EAF2FF', '#FFF3E8', '#F3E8FF'];
          const mapped = data
            .filter((r) => r.sellers)
            .map((r, i) => ({
              id:       r.sellers.id,
              initials: r.sellers.store_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
              name:     r.sellers.store_name,
              distance: r.sellers.address ? r.sellers.address.split(',')[0] : 'Nearby',
              price:    parseFloat(r.selling_price) || 0,
              inStock:  (r.stock || 0) > 0,
              color:    COLORS[i % COLORS.length],
              bg:       BGS[i % BGS.length],
            }));
          if (mapped.length > 0) setAvailableStores(mapped);
        }
      });

    if (med.category) {
      supabase
        .from('medicines')
        .select('id, name, selling_price, price')
        .ilike('category', `%${med.category.split(' ')[0]}%`)
        .neq('id', med.id)
        .limit(4)
        .then(({ data }) => {
          if (data && data.length > 0) {
            setSimilarMedicines(data.map((r) => ({
              id:    r.id,
              name:  r.name,
              price: parseFloat(r.selling_price ?? r.price) || 0,
            })));
          }
        });
    }
  }, [med?.id]);

  if (!med) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#F5F5F5' }}>
        <Pill size={52} color="#CCCCCC" />
        <p style={{ fontSize: '16px', fontWeight: '700', color: '#333333', margin: 0 }}>Medicine nahi mili</p>
        <p style={{ fontSize: '13px', color: '#888888', margin: 0, textAlign: 'center' }}>Search se medicine select karke detail dekho</p>
        <button
          style={{ padding: '13px 28px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => navigate('/medicine-search')}
        >
          Wapas Jaao
        </button>
      </div>
    );
  }

  const price    = med.price ?? med.selling_price ?? 0;
  const mrp      = med.mrp ?? 0;
  const discount = mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : (med.off || 0);
  const totalPrice = (price * qty).toFixed(2);

  const handleShare = async () => {
    const url  = window.location.href;
    const text = `${med.name} - ₹${price.toFixed(2)} | MedSetu`;
    if (navigator.share) {
      try { await navigator.share({ title: med.name, text, url }); } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert('Link copy ho gaya! 📋');
      } catch {
        alert(`Share karo: ${url}`);
      }
    }
  };

  const handleAddToCart = (store = null) => {
    const medicine = {
      ...med,
      id: med.id ?? `local-${med.name}`,
      quantity: qty,
    };
    const seller = store
      ? { id: store.id, name: store.name }
      : med.storeInfo
        ? { id: med.storeInfo.id, name: med.storeInfo.store_name }
        : null;
    addToCart(medicine, seller);
    setCartAdded(true);
  };

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <button style={s.iconBtn} onClick={() => navigate('/medicine-search')}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </button>
          <span style={s.headerTitle}>Medicine Detail</span>
          <div style={s.headerRight}>
            <button style={s.iconBtn} onClick={handleShare}>
              <Share2 size={20} color="#1A1A1A" />
            </button>
            <button style={s.iconBtn} onClick={() => setSaved((v) => !v)}>
              <Heart
                size={20}
                color={saved ? '#EF4444' : '#1A1A1A'}
                fill={saved ? '#EF4444' : 'none'}
              />
            </button>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div style={s.body}>

          {/* Hero */}
          <div style={s.hero}>
            <div style={s.heroInner}>
              <Pill size={80} color="#1A6B3C" strokeWidth={1.4} />
            </div>
          </div>

          {/* Medicine Info */}
          <div style={s.infoBlock}>
            <h1 style={s.medName}>{med.name}</h1>
            <p style={s.medBrand}>{med.brand || med.salt || ''}</p>
            <div style={s.tagRow}>
              {med.category && <span style={s.tagGreen}>{med.category}</span>}
              {!med.category && med.salt && <span style={s.tagGreen}>{med.salt}</span>}
              {med.rxRequired && <span style={s.tagOrange}>Rx Required</span>}
            </div>
          </div>

          {/* Price Card */}
          <div style={s.card}>
            <div style={s.priceRow}>
              <div>
                {mrp > 0 && <span style={s.mrpText}>MRP ₹{mrp.toFixed(2)}</span>}
                <div style={s.priceMain}>
                  <span style={s.priceText}>₹{price.toFixed(2)}</span>
                  {discount > 0 && <span style={s.offBadge}>{discount}% OFF</span>}
                </div>
                <span style={s.perStrip}>Per strip: {med.perStrip || med.per_strip || '10 tablets'}</span>
              </div>
              {med.stock !== 0 && (
              <div style={s.stockPill}>
                <CheckCircle size={14} color="#1A6B3C" />
                <span style={s.stockText}>In Stock</span>
              </div>
            )}
            </div>

            <div style={s.divider} />

            <div style={s.qtyRow}>
              <span style={s.qtyLabel}>Quantity</span>
              <div style={s.qtyControl}>
                <button
                  style={s.qtyBtn}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                >−</button>
                <span style={s.qtyNum}>{qty}</span>
                <button
                  style={s.qtyBtn}
                  onClick={() => setQty((q) => Math.min(10, q + 1))}
                >+</button>
              </div>
            </div>
          </div>

          {/* Available Stores */}
          <div style={s.section}>
            <div style={s.sectionHead}>
              <p style={s.sectionTitle}>Kahan Milegi?</p>
              <p style={s.sectionSub}>{availableStores.length} stores mein available</p>
            </div>
            <div style={s.hScroll}>
              {availableStores.map((store) => (
                <StoreCard
                  key={store.id}
                  store={store}
                  onOrder={() => {
                    handleAddToCart(store);
                    navigate('/checkout');
                  }}
                />
              ))}
            </div>
          </div>

          {/* Accordion */}
          <div style={s.section}>
            <p style={s.sectionTitle}>Medicine Ki Jaankari</p>
            <div style={s.accordion}>
              {ACCORDION.map((item) => (
                <AccordionItem
                  key={item.id}
                  item={item}
                  open={openAcc === item.id}
                  onToggle={() => toggleAcc(item.id)}
                />
              ))}
            </div>
          </div>

          {/* Similar Medicines */}
          {similarMedicines.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionTitle}>Milti Julti Medicines</p>
            <div style={s.hScroll}>
              {similarMedicines.map((sim) => (
                <div key={sim.id} style={s.simCard}>
                  <div style={s.simIconBox}>
                    <Pill size={22} color="#1A6B3C" />
                  </div>
                  <p style={s.simName}>{sim.name}</p>
                  <div style={s.simFooter}>
                    <span style={s.simPrice}>₹{sim.price}</span>
                    <button style={s.simAddBtn} onClick={() => addToCart({ id: sim.id, name: sim.name, price: sim.price, quantity: 1 }, null)}>Add</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Bottom spacer */}
          <div style={{ height: '88px' }} />
        </div>

        {/* ── Fixed Bottom Bar ── */}
        <div style={s.bottomBar}>
          <div style={s.bottomPrice}>
            <span style={s.bottomPriceLabel}>Total</span>
            <span style={s.bottomPriceVal}>₹{totalPrice}</span>
          </div>
          {cartAdded ? (
            <button style={{ ...s.cartBtn, backgroundColor: '#2563EB' }}
              onClick={() => navigate('/checkout')}>
              <ShoppingCart size={18} color="#FFFFFF" />
              Checkout Karo ({cartCount})
            </button>
          ) : (
            <button style={s.cartBtn} onClick={() => handleAddToCart()}>
              <ShoppingCart size={18} color="#FFFFFF" />
              Cart Mein Daalo
            </button>
          )}
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
    backgroundColor: '#FFFFFF',
    position: 'relative',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 12px',
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
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    display: 'flex',
    gap: '2px',
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
  },

  // Hero
  hero: {
    height: '200px',
    backgroundColor: '#E8F5E9',
    borderRadius: '0 0 28px 28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  heroInner: {
    width: '120px',
    height: '120px',
    borderRadius: '60px',
    backgroundColor: 'rgba(255,255,255,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Info
  infoBlock: {
    padding: '20px 16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  medName: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#1A1A1A',
    margin: 0,
    lineHeight: '1.2',
  },
  medBrand: {
    fontSize: '14px',
    color: '#666666',
    margin: 0,
  },
  tagRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '4px',
  },
  tagGreen: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#1A6B3C',
    backgroundColor: '#E8F5EE',
    padding: '4px 12px',
    borderRadius: '20px',
  },
  tagOrange: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#EA6C00',
    backgroundColor: '#FFF3E8',
    padding: '4px 12px',
    borderRadius: '20px',
  },

  // Card
  card: {
    margin: '0 16px 16px',
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '16px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    border: '1px solid #F0F0F0',
  },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  mrpText: {
    fontSize: '13px',
    color: '#AAAAAA',
    textDecoration: 'line-through',
    display: 'block',
    marginBottom: '2px',
  },
  priceMain: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  priceText: {
    fontSize: '28px',
    fontWeight: '800',
    color: '#1A6B3C',
    lineHeight: 1,
  },
  offBadge: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#EA6C00',
    backgroundColor: '#FFF3E8',
    padding: '3px 8px',
    borderRadius: '6px',
  },
  perStrip: {
    fontSize: '12px',
    color: '#888888',
    marginTop: '4px',
    display: 'block',
  },
  stockPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: '#E8F5EE',
    padding: '6px 10px',
    borderRadius: '20px',
    alignSelf: 'flex-start',
  },
  stockText: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#1A6B3C',
  },
  divider: {
    height: '1px',
    backgroundColor: '#F0F0F0',
    margin: '14px 0',
  },
  qtyRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  qtyLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1A1A1A',
  },
  qtyControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    border: '1.5px solid #E0E0E0',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  qtyBtn: {
    width: '38px',
    height: '36px',
    background: '#F5F5F5',
    border: 'none',
    fontSize: '18px',
    fontWeight: '600',
    color: '#1A6B3C',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  },
  qtyNum: {
    width: '40px',
    textAlign: 'center',
    fontSize: '16px',
    fontWeight: '700',
    color: '#1A1A1A',
    borderLeft: '1px solid #E0E0E0',
    borderRight: '1px solid #E0E0E0',
    lineHeight: '36px',
  },

  // Section
  section: {
    padding: '0 16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
  },
  sectionSub: {
    fontSize: '13px',
    color: '#888888',
    margin: 0,
  },

  // Horizontal scroll
  hScroll: {
    display: 'flex',
    gap: '12px',
    overflowX: 'auto',
    paddingBottom: '4px',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    marginLeft: '-16px',
    paddingLeft: '16px',
    marginRight: '-16px',
    paddingRight: '16px',
  },

  // Store card
  storeCard: {
    minWidth: '160px',
    backgroundColor: '#FAFAFA',
    border: '1.5px solid #F0F0F0',
    borderRadius: '14px',
    padding: '14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flexShrink: 0,
  },
  storeAvatar: {
    width: '38px',
    height: '38px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '2px',
  },
  storeInitials: {
    fontSize: '14px',
    fontWeight: '800',
  },
  storeName: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    lineHeight: '1.3',
  },
  storeDist: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#1A6B3C',
    backgroundColor: '#E8F5EE',
    padding: '2px 8px',
    borderRadius: '20px',
    alignSelf: 'flex-start',
  },
  storePrice: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A6B3C',
    margin: 0,
  },
  stockRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  inStock: {
    fontSize: '11px',
    color: '#1A6B3C',
    fontWeight: '600',
  },
  outStock: {
    fontSize: '11px',
    color: '#EF4444',
    fontWeight: '600',
  },
  storeOrderBtn: {
    width: '100%',
    padding: '8px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: '4px',
  },
  notifyBtn: {
    width: '100%',
    padding: '8px',
    backgroundColor: '#F5F5F5',
    color: '#AAAAAA',
    border: '1.5px solid #E0E0E0',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'not-allowed',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    marginTop: '4px',
  },

  // Accordion
  accordion: {
    display: 'flex',
    flexDirection: 'column',
    border: '1.5px solid #F0F0F0',
    borderRadius: '14px',
    overflow: 'hidden',
  },
  accItem: {
    borderBottom: '1px solid #F0F0F0',
  },
  accHeader: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    backgroundColor: '#FFFFFF',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  accTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  accTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1A1A1A',
  },
  accBody: {
    padding: '4px 16px 16px',
    backgroundColor: '#FAFAFA',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  accLine: {
    fontSize: '13px',
    color: '#555555',
    lineHeight: '1.6',
    margin: 0,
  },

  // Similar
  simCard: {
    minWidth: '130px',
    backgroundColor: '#FAFAFA',
    border: '1.5px solid #F0F0F0',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flexShrink: 0,
  },
  simIconBox: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  simName: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    lineHeight: '1.3',
  },
  simFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '2px',
  },
  simPrice: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1A6B3C',
  },
  simAddBtn: {
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '3px 10px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
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
  bottomPrice: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    flexShrink: 0,
  },
  bottomPriceLabel: {
    fontSize: '11px',
    color: '#888888',
  },
  bottomPriceVal: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#1A6B3C',
    lineHeight: 1,
  },
  cartBtn: {
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
  },
};
