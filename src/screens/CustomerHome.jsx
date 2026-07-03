import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSellers } from '../lib/api';
import { useCart } from '../context/CartContext';
import { supabase } from '../lib/supabase';
import { fetchUserNotifications, markNotificationRead, markAllNotificationsRead, formatNotifTime } from '../lib/notifications';
import {
  Bell, MapPin, ChevronDown, Search,
  FileText, Clock, Star, CheckCircle,
  Home, ShoppingBag, User, Pill, ShoppingCart,
} from 'lucide-react';

// ─── Notification helpers ─────────────────────────────────────
const NOTIF_COLORS = {
  order_placed:    '#2563EB',
  order_accepted:  '#2563EB',
  order_delivered: '#1A6B3C',
  order_cancelled: '#DC3545',
  b2b_order:       '#2563EB',
  b2b_update:      '#2563EB',
};
const getNotifColor = (type) => NOTIF_COLORS[type] || '#2563EB';

// ─── Dummy fallback stores ────────────────────────────────────

const CATEGORIES = [
  'Sab', 'Medicines', 'Equipment', 'Surgical', 'Ayurvedic', 'Baby Care',
];


const QUICK_ACTIONS = [
  { label: 'Store Dhundho',       Icon: MapPin,    bg: '#E8F5EE', color: '#1A6B3C', route: '/store-locator' },
  { label: 'Prescription Upload', Icon: FileText,  bg: '#EAF2FF', color: '#2563EB', route: '/prescription' },
  { label: 'Medicine Order',      Icon: Pill,      bg: '#FFF3E8', color: '#EA6C00', route: '/medicine-search' },
  { label: 'Order History',       Icon: Clock,     bg: '#F3EEFF', color: '#7C3AED', route: '/orders' },
];

// ─── Sub-components ───────────────────────────────────────────

function StarRating({ rating }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
      <Star size={12} fill="#F59E0B" color="#F59E0B" />
      <span style={{ fontSize: '12px', color: '#F59E0B', fontWeight: '600' }}>{rating}</span>
    </span>
  );
}

function StoreCard({ store, onOrder }) {
  return (
    <div style={s.storeCard}>
      {/* Store initial avatar */}
      <div style={s.storeAvatar}>
        <span style={s.storeInitial}>{(store.name || 'M')[0]}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
          <p style={s.storeName}>{store.name}</p>
          <span style={{ ...s.badge, ...(store.open ? s.badgeOpen : s.badgeClosed) }}>
            {store.open ? 'Open' : 'Closed'}
          </span>
        </div>

        <p style={s.storeAddress}>{store.address}</p>

        <div style={s.storeMetaRow}>
          <StarRating rating={store.rating} />
          <span style={s.dotSep}>·</span>
          <span style={s.reviewCount}>{store.reviews} reviews</span>
          {store.distance && (
            <>
              <span style={s.dotSep}>·</span>
              <span style={s.distanceBadge}>{store.distance}</span>
            </>
          )}
        </div>

        <div style={s.storeFooter}>
          <span style={s.verifiedTag}>
            <CheckCircle size={11} color="#1A6B3C" />
            Licensed
          </span>
          <button
            style={{
              ...s.orderBtn,
              opacity: store.open ? 1 : 0.45,
              cursor: store.open ? 'pointer' : 'not-allowed',
            }}
            onClick={() => store.open && onOrder(store)}
          >
            Order Karo
          </button>
        </div>
      </div>
    </div>
  );
}

const OFFER_COLORS = ['#1A6B3C', '#EA6C00', '#0C447C', '#E0A818'];

function OfferCard({ bg, title, sub, code, btnLabel, onPress }) {
  return (
    <div style={{ ...s.offerCard, backgroundColor: bg }}>
      <p style={s.offerTitle}>{title}</p>
      {sub && <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.85)', margin: '2px 0 6px' }}>{sub}</p>}
      <div style={s.offerCodeBox}>
        <span style={s.offerCode}>{code}</span>
      </div>
      <button style={s.offerBtn} onClick={onPress}>{btnLabel}</button>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function CustomerHome() {
  const navigate = useNavigate();
  const { cartCount } = useCart();
  const [activeCategory, setActiveCategory] = useState('Sab');
  const [activeTab, setActiveTab]           = useState('home');
  const [nearbyStores, setNearbyStores]     = useState([]);
  const [storesLoading, setStoresLoading]   = useState(true);
  const [showNotif, setShowNotif]     = useState(false);
  const [notifs, setNotifs]           = useState([]);
  const [offers, setOffers]           = useState([]);
  const unreadCount = notifs.filter((n) => !n.is_read).length;

  useEffect(() => {
    let cancelled = false;

    const initPage = async () => {
      try {
        // Auth check — any of these means logged in
        const { data: { session } } = await supabase.auth.getSession();
        const storedUser = (() => { try { return JSON.parse(localStorage.getItem('medsetu_user') || 'null'); } catch { return null; } })();
        const devSession = (() => { try { return JSON.parse(sessionStorage.getItem('medsetu_dev') || 'null'); } catch { return null; } })();
        const isLoggedIn = !!(session || storedUser?.id || storedUser?.phone || storedUser?.email || devSession);

        if (!isLoggedIn) {
          if (!cancelled) navigate('/login', { replace: true });
          return;
        }

        // Fetch sellers (primary page content)
        try {
          const { data } = await fetchSellers('Deoria');
          if (!cancelled && data && data.length > 0) {
            setNearbyStores(data.map((s) => ({
              id:       s.id,
              name:     s.store_name,
              address:  s.address || s.district || '',
              distance: null,
              rating:   parseFloat(s.rating) || 4.0,
              reviews:  s.total_reviews      || 0,
              open:     s.is_open,
            })));
          }
        } catch {}

        // Fetch real notifications (only if user has a DB id)
        const userId = storedUser?.id;
        if (userId) {
          try {
            const { data } = await fetchUserNotifications(userId);
            if (!cancelled) setNotifs(data);
          } catch {}
        }

        // Fetch active offers
        try {
          const today = new Date().toISOString().slice(0, 10);
          const { data: offerData, error: offerErr } = await supabase
            .from('offers')
            .select('*')
            .eq('active', true)
            .order('created_at', { ascending: false });
          if (!offerErr && !cancelled) {
            const valid = (offerData || []).filter((o) => {
              const okFrom = !o.valid_from || o.valid_from <= today;
              const okTill = !o.valid_till || o.valid_till >= today;
              return okFrom && okTill;
            });
            setOffers(valid);
          }
        } catch {}

      } catch (err) {
        console.error('CustomerHome init error:', err);
      } finally {
        if (!cancelled) setStoresLoading(false);
      }
    };

    initPage();
    return () => { cancelled = true; };
  }, [navigate]);

  const NAV_TABS = [
    { id: 'home',    Icon: Home,        label: 'Home',    route: '/home' },
    { id: 'search',  Icon: Search,      label: 'Search',  route: '/medicine-search' },
    { id: 'orders',  Icon: ShoppingBag, label: 'Orders',  route: '/orders' },
    { id: 'profile', Icon: User,        label: 'Profile', route: '/profile' },
  ];

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div style={{ background: '#FFFFFF', borderRadius: '8px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center' }}>
            <img src="/logo.png" alt="MedSetu Logo" style={{ height: '30px', width: 'auto', display: 'block' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button style={s.iconBtn} aria-label="Cart" onClick={() => navigate('/checkout')}>
              <div style={{ position: 'relative' }}>
                <ShoppingCart size={22} color="#1A1A1A" />
                {cartCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '-5px', right: '-7px',
                    minWidth: '16px', height: '16px', borderRadius: '8px',
                    backgroundColor: '#EF4444', color: '#FFFFFF',
                    fontSize: '10px', fontWeight: '700',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px', lineHeight: 1,
                  }}>
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </div>
            </button>
            <button style={s.iconBtn} aria-label="Notifications" onClick={() => { setShowNotif(true); }}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                {unreadCount > 0 && <span style={s.notifDot} />}
              </div>
            </button>
          </div>
        </div>

        {/* ── Location Bar ── */}
        <button style={s.locationBar}>
          <MapPin size={16} color="#1A6B3C" />
          <span style={s.locationText}>Deoria, Uttar Pradesh</span>
          <ChevronDown size={16} color="#666666" style={{ marginLeft: 'auto' }} />
        </button>

        {/* ── Scrollable body ── */}
        <div style={s.scrollBody}>

          {/* Search Bar */}
          <button style={s.searchBar} onClick={() => navigate('/medicine-search')}>
            <Search size={18} color="#AAAAAA" />
            <span style={s.searchPlaceholder}>Medicine ya store dhundho...</span>
          </button>

          {/* Quick Actions */}
          <div style={s.quickGrid}>
            {QUICK_ACTIONS.map(({ label, Icon, bg, color, route }) => (
              <button
                key={label}
                style={s.quickCard}
                onClick={() => navigate(route)}
              >
                <div style={{ ...s.quickIconBox, backgroundColor: bg }}>
                  <Icon size={24} color={color} />
                </div>
                <span style={s.quickLabel}>{label}</span>
              </button>
            ))}
          </div>

          {/* Nearby Stores */}
          <div style={s.section}>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>Aapke Paas Ke Stores</span>
              <button style={s.seeAllBtn} onClick={() => navigate('/store-locator')}>
                Sab Dekho
              </button>
            </div>
            {storesLoading ? (
              <p style={{ fontSize: '13px', color: '#AAAAAA', padding: '12px 0' }}>Stores load ho rahe hain...</p>
            ) : nearbyStores.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#888888', padding: '12px 0' }}>Aapke area mein koi store nahi mila</p>
            ) : (
              <div style={s.horizontalScroll}>
                {nearbyStores.map((store, idx) => (
                  <StoreCard
                    key={store?.id || store?.name || `store-${idx}`}
                    store={store}
                    onOrder={() => navigate('/medicine-search')}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Categories */}
          <div style={s.section}>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>Categories</span>
            </div>
            <div style={s.horizontalScroll}>
              {Array.isArray(CATEGORIES) && CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  style={{
                    ...s.categoryPill,
                    ...(activeCategory === cat ? s.categoryPillActive : s.categoryPillInactive),
                  }}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Offers — sirf tab dikhe jab active offers ho */}
          {offers.length > 0 && (
            <div style={s.section}>
              <div style={s.sectionHeader}>
                <span style={s.sectionTitle}>Offers</span>
              </div>
              <div style={s.horizontalScroll}>
                {offers.map((o, i) => (
                  <OfferCard
                    key={o.id}
                    bg={OFFER_COLORS[i % OFFER_COLORS.length]}
                    title={o.title}
                    sub={o.discount_type === 'percentage' ? `${o.discount_value}% OFF` : `₹${o.discount_value} OFF`}
                    code={o.promo_code}
                    btnLabel="Order Karo"
                    onPress={() => navigate('/medicine-search')}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Bottom spacer for nav bar */}
          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, route }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                style={s.navTab}
                onClick={() => { setActiveTab(id); navigate(route); }}
              >
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <Icon
                    size={22}
                    color={isActive ? '#1A6B3C' : '#AAAAAA'}
                    strokeWidth={isActive ? 2.5 : 1.8}
                  />
                </div>
                <span style={{
                  ...s.navLabel,
                  color: isActive ? '#1A6B3C' : '#AAAAAA',
                  fontWeight: isActive ? '600' : '400',
                }}>
                  {label}
                </span>
                {isActive && <span style={s.navActiveDot} />}
              </button>
            );
          })}
        </nav>

        {/* ── Notification Sheet ── */}
        {showNotif && (
          <div style={s.notifOverlay} onClick={() => setShowNotif(false)}>
            <div style={s.notifSheet} onClick={(e) => e.stopPropagation()}>
              <div style={s.notifHandle} />
              <div style={s.notifHeader}>
                <span style={s.notifTitle}>Notifications</span>
                {unreadCount > 0 && (
                  <button
                    style={s.markAllBtn}
                    onClick={() => {
                      const userId = notifs[0]?.user_id;
                      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
                      markAllNotificationsRead(userId);
                    }}
                  >
                    Sab Read Karo
                  </button>
                )}
              </div>
              {notifs.length === 0 ? (
                <div style={s.notifEmpty}>
                  <Bell size={36} color="#CCCCCC" />
                  <p style={{ fontSize: '14px', color: '#AAAAAA', margin: 0 }}>Koi notification nahi</p>
                </div>
              ) : (
                <div style={s.notifList}>
                  {notifs.map((n) => (
                    <div
                      key={n.id}
                      style={{ ...s.notifRow, backgroundColor: n.is_read ? '#FFFFFF' : '#F0FBF4' }}
                      onClick={() => {
                        setNotifs((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
                        if (!n.is_read) markNotificationRead(n.id);
                        setShowNotif(false);
                        if (n.ref_id) navigate('/order-tracking', { state: { orderId: n.ref_id } });
                      }}
                    >
                      <div style={{ width: '36px', height: '36px', borderRadius: '18px', backgroundColor: getNotifColor(n.type) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: getNotifColor(n.type) }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ ...s.notifRowTitle, fontWeight: n.is_read ? '500' : '700' }}>{n.title}</p>
                        <p style={s.notifRowSub}>{n.body}</p>
                        <p style={s.notifRowTime}>{formatNotifTime(n.created_at)}</p>
                      </div>
                      {!n.is_read && <span style={s.unreadDot} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
    position: 'relative',
    minHeight: '100vh',
    backgroundColor: '#F5F5F5',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    backgroundColor: '#FFFFFF',
  },
  logo: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#1A6B3C',
    letterSpacing: '-0.4px',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    padding: '6px',
    cursor: 'pointer',
    borderRadius: '8px',
  },
  notifDot: {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    width: '8px',
    height: '8px',
    backgroundColor: '#EF4444',
    borderRadius: '50%',
    border: '1.5px solid #FFFFFF',
  },

  // Notification sheet
  notifOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 100,
  },
  notifSheet: {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: '#FFFFFF',
    borderRadius: '20px 20px 0 0',
    padding: '12px 0 40px',
    maxHeight: '75vh',
    display: 'flex',
    flexDirection: 'column',
  },
  notifHandle: {
    width: '40px',
    height: '4px',
    backgroundColor: '#E0E0E0',
    borderRadius: '2px',
    margin: '0 auto 12px',
  },
  notifHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px 12px',
    borderBottom: '1px solid #F0F0F0',
  },
  notifTitle: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  markAllBtn: {
    background: 'none',
    border: 'none',
    color: '#1A6B3C',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  },
  notifList: {
    overflowY: 'auto',
    flex: 1,
  },
  notifEmpty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '40px 24px',
  },
  notifRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '14px 20px',
    borderBottom: '1px solid #F5F5F5',
    cursor: 'pointer',
  },
  notifIcon: {
    fontSize: '24px',
    flexShrink: 0,
    lineHeight: 1,
    marginTop: '2px',
  },
  notifRowTitle: {
    fontSize: '14px',
    color: '#1A1A1A',
    margin: '0 0 3px',
  },
  notifRowSub: {
    fontSize: '12px',
    color: '#666666',
    margin: '0 0 4px',
    lineHeight: '1.4',
  },
  notifRowTime: {
    fontSize: '11px',
    color: '#AAAAAA',
    margin: 0,
  },
  unreadDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#1A6B3C',
    flexShrink: 0,
    marginTop: '6px',
  },

  // Location bar
  locationBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#F0FAF4',
    border: 'none',
    borderBottom: '1px solid #E8F5EE',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  locationText: {
    fontSize: '13px',
    color: '#444444',
    fontWeight: '500',
  },

  // Scroll body
  scrollBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },

  // Search
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid #E8E8E8',
    borderRadius: '12px',
    padding: '13px 16px',
    width: '100%',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  searchPlaceholder: {
    fontSize: '14px',
    color: '#AAAAAA',
  },

  // Quick Actions
  quickGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  quickCard: {
    backgroundColor: '#FFFFFF',
    border: 'none',
    borderRadius: '14px',
    padding: '18px 14px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '10px',
    cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  quickIconBox: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1A1A1A',
    lineHeight: '1.3',
  },

  // Section
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  seeAllBtn: {
    background: 'none',
    border: 'none',
    color: '#1A6B3C',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  },

  // Horizontal scroll
  horizontalScroll: {
    display: 'flex',
    gap: '12px',
    overflowX: 'auto',
    paddingBottom: '4px',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },

  // Store Card
  storeCard: {
    minWidth: '240px',
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    padding: '14px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
    display: 'flex',
    gap: '12px',
    flexShrink: 0,
  },
  storeAvatar: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  storeInitial: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1A6B3C',
  },
  storeName: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: 0,
    lineHeight: '1.3',
    flex: 1,
  },
  storeAddress: {
    fontSize: '11px',
    color: '#888888',
    margin: '3px 0 6px',
  },
  storeMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginBottom: '8px',
  },
  dotSep: {
    color: '#CCCCCC',
    fontSize: '11px',
  },
  reviewCount: {
    fontSize: '11px',
    color: '#999999',
  },
  distanceBadge: {
    fontSize: '11px',
    color: '#1A6B3C',
    fontWeight: '600',
    backgroundColor: '#E8F5EE',
    padding: '1px 7px',
    borderRadius: '20px',
  },
  storeFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  verifiedTag: {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    fontSize: '11px',
    color: '#1A6B3C',
    fontWeight: '600',
  },
  badge: {
    fontSize: '10px',
    fontWeight: '700',
    padding: '2px 8px',
    borderRadius: '20px',
    flexShrink: 0,
  },
  badgeOpen: {
    backgroundColor: '#E8F5EE',
    color: '#1A6B3C',
  },
  badgeClosed: {
    backgroundColor: '#FFEEEE',
    color: '#EF4444',
  },
  orderBtn: {
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    padding: '5px 12px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Category Pills
  categoryPill: {
    flexShrink: 0,
    padding: '7px 16px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s ease, color 0.15s ease',
  },
  categoryPillActive: {
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    fontWeight: '600',
  },
  categoryPillInactive: {
    backgroundColor: '#FFFFFF',
    color: '#555555',
    border: '1.5px solid #E8E8E8',
  },

  // Offer Cards
  offerCard: {
    minWidth: '220px',
    borderRadius: '16px',
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flexShrink: 0,
  },
  offerTitle: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#FFFFFF',
    margin: 0,
    lineHeight: '1.4',
  },
  offerCodeBox: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    border: '1.5px dashed rgba(255,255,255,0.6)',
    borderRadius: '6px',
    padding: '4px 10px',
  },
  offerCode: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: '1px',
  },
  offerBtn: {
    backgroundColor: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    color: '#1A1A1A',
    alignSelf: 'flex-start',
    fontFamily: 'inherit',
  },

  // Bottom Nav
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
  navLabel: {
    fontSize: '10px',
  },
  navActiveDot: {
    position: 'absolute',
    top: '-8px',
    width: '20px',
    height: '3px',
    backgroundColor: '#1A6B3C',
    borderRadius: '2px',
  },
};
