import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMrpMode, fetchPopularMedicines } from '../lib/api';
import { useCart } from '../context/CartContext';
import { supabase } from '../lib/supabase';
import { fetchUserNotifications, markNotificationRead, markAllNotificationsRead, formatNotifTime } from '../lib/notifications';
import MedicineCard from '../components/MedicineCard';
import BottomNav from '../components/BottomNav';
import PhoneCollectModal from '../components/PhoneCollectModal';
import logo from '../assets/logo.png';
import slogan from '../assets/slogan.png';
import {
  Bell, MapPin, Search, Camera, X,
  Pill, ShoppingCart,
  Droplet, Leaf, Phone, Calendar,
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

// R3-CORE: hardcoded for now — 026_serviceablePincodes.sql already has a
// serviceable_pincodes table with these same 2 rows, but nothing reads it
// yet. Move this to a platform_settings/table read later instead of
// duplicating the list.
const SERVICEABLE_PINCODES = ['274001', '274201'];

// R3-C1: colourful horizontal service tabs — each its own MedSetu-palette
// colour. Allopath is the only one with real content (best-selling
// medicines below, shared MedicineCard); the rest show a "Jald Aa Raha
// Hai" placeholder via `desc`. The two-pane left-rail version of this
// (R3-C1-purana) was the wrong screen — that's Categories (R3-C2), not
// Home — this replaces it outright.
const SERVICE_TABS = [
  { id: 'allopath',    label: 'Allopath',         Icon: Pill,     color: '#1A6B3C', bg: '#E8F5EE', desc: null },
  { id: 'homeopath',   label: 'Homeopath',        Icon: Droplet,  color: '#0C447C', bg: '#EAF2FF', desc: 'Yeh feature jald available hoga' },
  { id: 'ayurved',     label: 'Ayurved',          Icon: Leaf,     color: '#E0A818', bg: '#FFF8E1', desc: 'Yeh feature jald available hoga' },
  { id: 'pharmacist',  label: 'Call Pharmacist',  Icon: Phone,    color: '#F26C0A', bg: '#FFF1E8', desc: 'Yeh feature jald available hoga' },
  { id: 'appointment', label: 'Book Appointment', Icon: Calendar, color: '#B54708', bg: '#FDECE3', desc: 'Yeh feature jald available hoga' },
];

// ─── Sub-components ───────────────────────────────────────────

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
  const [activeServiceTab, setActiveServiceTab] = useState('allopath');
  const [showNotif, setShowNotif]     = useState(false);
  const [notifs, setNotifs]           = useState([]);
  const [offers, setOffers]           = useState([]);
  const [mrpMode, setMrpMode]         = useState(false);
  const [popularMeds, setPopularMeds] = useState([]);
  const [pincode, setPincode]         = useState(null);
  const [addressLabel, setAddressLabel] = useState('');
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [modalPincode, setModalPincode] = useState('');
  // Hard-mandatory mobile gate (Fix 1) — Google/magic-link customers land
  // here with users.phone still null (AuthContext's customer upsert never
  // sets it). phoneGateUser holds the cached user row so the modal has an
  // id to update; stays null/unused for anyone who already has a phone.
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneGateUser, setPhoneGateUser] = useState(null);
  const unreadCount = notifs.filter((n) => !n.is_read).length;
  const activeTabData = SERVICE_TABS.find((t) => t.id === activeServiceTab);
  // null = no default address/pincode on file yet (neutral display).
  // true/false = pincode known, in/out of the serviceable list. `pincode`
  // doubles as the "Change" popup's live-preview value (R3-CORE, not
  // persisted — see modalPincode's onChange below) as well as the real
  // default address's pincode fetched on load.
  const isPincodeServiceable = pincode ? SERVICEABLE_PINCODES.includes(pincode) : null;
  const modalIsServiceable = modalPincode.length === 6 ? SERVICEABLE_PINCODES.includes(modalPincode) : null;

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

        // Fix 1 — Google/magic-link customer with no phone on file yet.
        // devSession/no-id sessions have nothing to update, so skip them.
        if (!cancelled && storedUser?.id && !storedUser?.phone) {
          setPhoneGateUser(storedUser);
          setShowPhoneModal(true);
        }

        // mrpMode must be known before fetching best-selling medicines —
        // fetchPopularMedicines' stock-vs-seller_hidden filter depends on
        // it (same ordering MedicineSearch.jsx's Popular Medicines uses).
        const mrpOn = await fetchMrpMode();
        if (!cancelled) setMrpMode(mrpOn);

        try {
          const { data: popData } = await fetchPopularMedicines(12, mrpOn);
          if (!cancelled && popData) setPopularMeds(popData);
        } catch {}

        // Fetch real notifications (only if user has a DB id)
        const userId = storedUser?.id;

        // Default address's pincode — same table/query shape as
        // Checkout.jsx's fetchDefaultAddress. No pincode on file leaves
        // `pincode` at its null default (neutral display, no green/red).
        if (userId) {
          try {
            const { data: addrData } = await supabase
              .from('addresses')
              .select('pincode, city, state')
              .eq('user_id', userId)
              .eq('is_default', true)
              .maybeSingle();
            if (!cancelled) {
              setPincode(addrData?.pincode || null);
              setAddressLabel(addrData?.city && addrData?.state ? `${addrData.city}, ${addrData.state}` : '');
            }
          } catch {}
        }

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
      }
    };

    initPage();
    return () => { cancelled = true; };
  }, [navigate]);

  // Realtime — new notification INSERT updates the bell instantly.
  // Purely additive on top of the fetch-on-mount above.
  useEffect(() => {
    let myUserId;
    try { myUserId = JSON.parse(localStorage.getItem('medsetu_user') || '{}')?.id; } catch {}
    if (!myUserId) return;

    const channel = supabase
      .channel(`notifs-${myUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${myUserId}` },
        (payload) => {
          setNotifs((prev) => prev.some((n) => n.id === payload.new.id) ? prev : [payload.new, ...prev]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);


  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <img src={logo} alt="MedSetu" style={s.headerLogo} />
          <div style={s.headerSloganWrap}>
            <img src={slogan} alt="Aapki Dawai Aapke Dwar" style={s.headerSlogan} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
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

        {/* ── Scrollable body ── */}
        <div style={s.scrollBody}>

          {/* Service Tabs — colourful, horizontal, scrollable */}
          <div style={s.serviceTabsRow}>
            {SERVICE_TABS.map(({ id, label, Icon, color, bg }) => {
              const isActive = activeServiceTab === id;
              return (
                <button key={id} style={s.serviceTab} onClick={() => setActiveServiceTab(id)}>
                  <div style={{
                    ...s.serviceTabIconBox,
                    backgroundColor: bg,
                    border: isActive ? `2px solid ${color}` : '2px solid transparent',
                  }}>
                    <Icon size={22} color={color} />
                  </div>
                  <span style={{ ...s.serviceTabLabel, color: isActive ? color : '#666666', fontWeight: isActive ? '700' : '500' }}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Location block — gradient-bordered pincode/address + Change,
              serviceability check (R3-CORE, no GPS auto-detect yet) shown
              as a thin line just below. Tap on the row itself does nothing yet. */}
          <div style={s.locationBlock}>
            <div style={s.addressRowWrap}>
              <div style={s.addressRowInner}>
                <div style={s.addressInfoGroup}>
                  <MapPin size={13} color="#888888" style={{ flexShrink: 0 }} />
                  <span style={s.addressText}>
                    {pincode ? `${pincode}${addressLabel ? ' · ' + addressLabel : ''}` : '274001 · Deoria, Uttar Pradesh'}
                  </span>
                </div>
                <button
                  style={s.changeBtn}
                  onClick={() => { setModalPincode(pincode || ''); setShowChangeModal(true); }}
                >
                  Change
                </button>
              </div>
            </div>

            {isPincodeServiceable !== null && (
              <p style={{
                ...s.serviceabilityLine,
                color: isPincodeServiceable ? '#1A6B3C' : '#DC3545',
              }}>
                {isPincodeServiceable
                  ? '✓ Aapke area me delivery uplabdh hai'
                  : 'Abhi aapke area me service uplabdh nahi hai. Ham jald hi shuru karenge.'}
              </p>
            )}
          </div>

          {/* Search Bar + Camera (prescription scan entry) */}
          <div style={s.searchRow}>
            <button style={s.searchBar} onClick={() => navigate('/medicine-search')}>
              <Search size={18} color="#AAAAAA" />
              <span style={s.searchPlaceholder}>Kya dhundh rahe hain?</span>
            </button>
            <button style={s.cameraBtn} aria-label="Prescription Upload" onClick={() => navigate('/prescription')}>
              <Camera size={20} color="#FFFFFF" />
            </button>
          </div>

          {/* Best-Selling Medicines (Allopath) / Coming Soon (other tabs) */}
          <div style={s.section}>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>
                {activeServiceTab === 'allopath' ? 'Best-Selling Medicines' : activeTabData?.label}
              </span>
            </div>
            {activeServiceTab === 'allopath' ? (
              popularMeds.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#AAAAAA', textAlign: 'center', padding: '16px 0', margin: 0 }}>
                  🌱 Jald hi naye medicines available honge
                </p>
              ) : (
                <div>
                  {popularMeds.map((med) => (
                    <MedicineCard
                      key={med.id}
                      medicine={med}
                      type={med.source === 'janaushadhi' ? 'janaushadhi' : med.is_generic ? 'generic' : 'branded'}
                      mrpMode={mrpMode}
                    />
                  ))}
                </div>
              )
            ) : (
              activeTabData && (
                <div style={s.comingSoonBox}>
                  <activeTabData.Icon size={32} color="#CCCCCC" />
                  <p style={s.comingSoonTitle}>{activeTabData.label} — Jald Aa Raha Hai</p>
                  <p style={s.comingSoonDesc}>{activeTabData.desc}</p>
                </div>
              )
            )}
          </div>

          {/* Offers — sirf tab dikhe jab active offers ho, aur mrp_mode OFF ho */}
          {!mrpMode && offers.length > 0 && (
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

        {/* ── Bottom Nav (shared, R3-C3) ── */}
        <BottomNav />

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

        {/* ── Pincode "Change" Popup (R3-CORE) ──
            Local-only preview: typing a 6-digit pincode here just updates
            `pincode` (in-memory, same state the location block already
            reads) so the serviceability line reflects it immediately —
            nothing is written to the addresses table. Saving a real
            address is left entirely to the existing R6 form on
            /profile — this only links there. */}
        {showChangeModal && (
          <div style={s.modalOverlay} onClick={() => setShowChangeModal(false)}>
            <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
              <div style={s.modalHeader}>
                <span style={s.modalTitle}>Pincode Check Karein</span>
                <button style={s.modalCloseBtn} onClick={() => setShowChangeModal(false)} aria-label="Band karein">
                  <X size={18} color="#888888" />
                </button>
              </div>
              <input
                style={s.modalInput}
                type="text"
                inputMode="numeric"
                placeholder="6-digit pincode"
                value={modalPincode}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setModalPincode(digits);
                  if (digits.length === 6) setPincode(digits);
                }}
                maxLength={6}
                autoFocus
              />
              {modalIsServiceable !== null && (
                <p style={{
                  ...s.modalServiceMsg,
                  color: modalIsServiceable ? '#1A6B3C' : '#DC3545',
                  backgroundColor: modalIsServiceable ? '#E8F5EE' : '#FDEDED',
                }}>
                  {modalIsServiceable
                    ? '✓ Aapke area me delivery uplabdh hai'
                    : 'Abhi aapke area me service uplabdh nahi hai. Ham jald hi shuru karenge.'}
                </p>
              )}
              <button
                style={s.modalAddressLink}
                onClick={() => { setShowChangeModal(false); navigate('/profile', { state: { openAddress: true } }); }}
              >
                Poora address add karna hai? → Address form kholein
              </button>
            </div>
          </div>
        )}

        {showPhoneModal && (
          <PhoneCollectModal
            user={phoneGateUser}
            onSaved={(phone) => {
              setPhoneGateUser((p) => ({ ...p, phone }));
              setShowPhoneModal(false);
            }}
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
    position: 'relative',
    minHeight: '100vh',
    backgroundColor: '#F5F5F5',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 16px',
    background: 'linear-gradient(90deg, #FFF1E6 0%, #EAF2FB 100%)',
    borderBottom: '1px solid rgba(12,68,124,0.08)',
  },
  headerLogo: {
    height: '36px',
    width: 'auto',
    display: 'block',
    flexShrink: 0,
  },
  headerSloganWrap: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 10px',
  },
  headerSlogan: {
    height: '22px',
    width: 'auto',
    maxWidth: '100%',
    objectFit: 'contain',
    display: 'block',
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

  // Scroll body
  scrollBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },

  // Service Tabs (R3-C1) — colourful row, edge-to-edge
  serviceTabsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
  },
  serviceTab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    width: '64px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  },
  serviceTabIconBox: {
    width: '52px',
    height: '52px',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.15s ease',
  },
  serviceTabLabel: {
    fontSize: '10.5px',
    textAlign: 'center',
    lineHeight: '1.25',
  },

  // Location block — gradient-bordered pincode/address row + Change,
  // plus a thin serviceability line just below it. Edges match the
  // search bar underneath (same width, no extra outer padding).
  locationBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  addressRowWrap: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '1.5px',
    borderRadius: '10px',
    background: 'linear-gradient(90deg, #F26C0A 0%, #0C447C 50%, #E0A818 100%)',
  },
  addressRowInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    borderRadius: '8.5px',
    padding: '8px 12px',
    backgroundColor: '#FFFFFF',
  },
  addressInfoGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
    flex: 1,
  },
  addressText: {
    fontSize: '11.5px',
    color: '#666666',
    lineHeight: '1.4',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  changeBtn: {
    flexShrink: 0,
    background: '#EAF2FB',
    border: 'none',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '11.5px',
    fontWeight: '700',
    color: '#0C447C',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  serviceabilityLine: {
    fontSize: '11px',
    fontWeight: '600',
    margin: 0,
    padding: '0 4px',
    lineHeight: '1.4',
  },

  // Pincode "Change" popup
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: '20px',
  },
  modalBox: {
    width: '100%',
    maxWidth: '340px',
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1A1A1A',
  },
  modalCloseBtn: {
    background: 'none',
    border: 'none',
    padding: '2px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  modalInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1.5px solid rgba(12,68,124,0.25)',
    borderRadius: '10px',
    padding: '11px 14px',
    fontSize: '15px',
    letterSpacing: '1px',
    color: '#1A1A1A',
    fontFamily: 'inherit',
    outline: 'none',
  },
  modalServiceMsg: {
    fontSize: '12.5px',
    fontWeight: '600',
    margin: 0,
    padding: '8px 10px',
    borderRadius: '8px',
    lineHeight: '1.4',
  },
  modalAddressLink: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '12.5px',
    fontWeight: '600',
    color: '#F26C0A',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },

  // Search + Camera
  searchRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid rgba(12,68,124,0.25)',
    borderRadius: '12px',
    padding: '13px 16px',
    flex: 1,
    minWidth: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  searchPlaceholder: {
    fontSize: '14px',
    color: '#AAAAAA',
  },
  cameraBtn: {
    flexShrink: 0,
    width: '46px',
    height: '46px',
    borderRadius: '12px',
    backgroundColor: '#1A6B3C',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },

  comingSoonBox: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    textAlign: 'center',
    padding: '24px 20px',
  },
  comingSoonTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#555555',
    margin: 0,
  },
  comingSoonDesc: {
    fontSize: '12px',
    color: '#999999',
    margin: 0,
    maxWidth: '220px',
    lineHeight: '1.5',
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
};
