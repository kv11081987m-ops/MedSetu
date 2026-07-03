import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bell, Store, ShoppingBag, Clock, IndianRupee,
  AlertTriangle, User, Phone, CheckCircle, X, Check,
  BarChart2, Package, Settings, Plus, TrendingUp,
  Home, ClipboardList, Wallet, UserCircle, Edit3, LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { getCurrentSeller } from '../lib/auth';
import { reserveStock, deductStock, releaseStock, addLotToRetailerInventory } from '../lib/inventory';
import { updateOrderStatus, fetchB2BOrders, markOrderReceived } from '../lib/orders';
import { createNotification, getOrderRecipientUserId, fetchUserNotifications, markNotificationRead, markAllNotificationsRead, formatNotifTime } from '../lib/notifications';

// ─── Static helpers ───────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Sales Report', Icon: BarChart2, iconColor: '#1A6B3C', bg: '#E8F5EE', tab: 'earnings' },
  { label: 'Inventory',    Icon: Package,   iconColor: '#2563EB', bg: '#EAF2FF', route: '/inventory' },
  { label: 'Order History',Icon: Clock,     iconColor: '#7C3AED', bg: '#F3EEFF', tab: 'orders' },
  { label: 'Settings',     Icon: Settings,  iconColor: '#555555', bg: '#F0F0F0', tab: 'profile' },
  { label: 'Medicine Add', Icon: Plus,      iconColor: '#EA6C00', bg: '#FFF3E8', route: '/inventory' },
];

// In-panel tabs only — 'inventory'/'buy' in NAV_TABS below are route
// navigations (to /inventory, /wholesalers), never an activeTab value.
const VALID_TABS = ['home', 'orders', 'earnings', 'profile'];

const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', delivered: 'Delivered', cancelled: 'Cancelled' };
const STATUS_COLOR = { pending: '#E65100', confirmed: '#2563EB', delivered: '#1A6B3C', cancelled: '#888888' };
const STATUS_BG    = { pending: '#FFF3E0', confirmed: '#EAF2FF', delivered: '#E8F5EE', cancelled: '#F5F5F5' };

const ORDER_FILTERS = [
  { label: 'Sab',       value: 'sab' },
  { label: 'Pending',   value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled' },
];

const formatOrderTime = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const mapOrderDisplay = (order) => {
  const isB2B = order.buyer_type === 'retailer';
  return {
    id:       order.order_number || String(order.id).slice(0, 8).toUpperCase(),
    ago:      order.created_at ? formatOrderTime(order.created_at) : '',
    customer: isB2B ? (order.buyer?.store_name || 'Retailer') : (order.customer_name || 'Customer'),
    phone:    isB2B ? (order.buyer?.phone      || '')          : (order.customer_phone  || ''),
    items:    order.order_items?.length
      ? order.order_items.map((i) => `${i.medicine_name || i.name || 'Item'} x${i.quantity || 1}`)
      : ['Order items'],
    amount:   order.final_amount || 0,
    status:   order.status,
    warning:  null,
    badges:   isB2B
      ? [
          { label: '🏪 B2B - Retailer', color: '#0C447C', bg: '#EAF2FF' },
          { label: '💊 Medicine',        color: '#2563EB', bg: '#EAF2FF' },
        ]
      : [{ label: '💊 Medicine', color: '#2563EB', bg: '#EAF2FF' }],
    prescriptionUrl: order.prescription_url || null,
    _id:      order.id,
  };
};

const mapB2BPurchase = (order) => ({
  id:              order.order_number || String(order.id).slice(0, 8).toUpperCase(),
  ago:             order.created_at ? formatOrderTime(order.created_at) : '',
  wholesaler:      order.sellers?.store_name || 'Wholesaler',
  wholesalerPhone: order.sellers?.phone || '',
  items:           order.order_items?.length
    ? order.order_items.map((i) => `${i.medicine_name || i.name || 'Item'} x${i.quantity || 1}`)
    : ['Order items'],
  amount:          order.final_amount || 0,
  status:          order.status,
  receivedByBuyer: order.received_by_buyer || false,
  _id:             order.id,
});

// ─── Sub-components ───────────────────────────────────────────
function OrderCard({ order, onAccept, onDecline, onDeliver, onCancelConfirmed }) {
  const statusColor = STATUS_COLOR[order.status] || '#888888';
  const statusBg    = STATUS_BG[order.status]    || '#F5F5F5';
  const statusLabel = STATUS_LABEL[order.status] || order.status;

  return (
    <div style={s.pendCard}>
      <div style={s.pendTop}>
        <div style={s.pendLeft}>
          <span style={s.pendId}>#{order.id}</span>
          <span style={{ fontSize: '11px', color: statusColor, fontWeight: '600' }}>
            🟡 {statusLabel}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <span style={s.pendAgo}>{order.ago}</span>
          <span style={{ ...s.statusBadge, color: statusColor, backgroundColor: statusBg }}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div style={s.pendCustomer}>
        <div style={s.pendInfoRow}><User size={13} color="#888888" /><span style={s.pendInfoText}>{order.customer}</span></div>
        {order.phone ? <div style={s.pendInfoRow}><Phone size={13} color="#888888" /><span style={s.pendInfoText}>{order.phone}</span></div> : null}
      </div>

      <div style={s.pendItems}>
        {order.items.map((it, i) => <p key={i} style={s.pendItem}>• {it}</p>)}
        <span style={s.pendAmount}>₹{order.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>

      <div style={s.badgeRow}>
        {order.badges.map((b) => (
          <span key={b.label} style={{ ...s.badge, color: b.color, backgroundColor: b.bg }}>{b.label}</span>
        ))}
        {order.prescriptionUrl && (
          <span
            style={{ ...s.badge, color: '#7C3AED', backgroundColor: '#F3EEFF', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => window.open(order.prescriptionUrl, '_blank', 'noopener,noreferrer')}
          >
            🩺 Rx Dekho
          </span>
        )}
      </div>

      {order.status === 'pending' && (
        <div style={s.pendBtns}>
          <button style={s.acceptBtn} onClick={() => onAccept(order._id)}>
            <CheckCircle size={15} color="#FFFFFF" /> Accept
          </button>
          <button style={s.declineBtn} onClick={() => onDecline(order._id)}>
            <X size={15} color="#DC3545" /> Decline
          </button>
        </div>
      )}

      {order.status === 'confirmed' && (
        <div style={s.pendBtns}>
          <button style={s.acceptBtn} onClick={() => onDeliver(order._id)}>
            <CheckCircle size={15} color="#FFFFFF" /> Mark Delivered
          </button>
          <button style={s.declineBtn} onClick={() => onCancelConfirmed(order._id)}>
            <X size={15} color="#DC3545" /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function B2BPurchaseCard({ order, onReceive, receiving }) {
  const statusColor = STATUS_COLOR[order.status] || '#888888';
  const statusBg    = STATUS_BG[order.status]    || '#F5F5F5';
  const statusLabel = STATUS_LABEL[order.status] || order.status;

  return (
    <div style={{ ...s.pendCard, borderLeft: '4px solid #0C447C' }}>
      <div style={s.pendTop}>
        <div style={s.pendLeft}>
          <span style={{ ...s.pendId, color: '#0C447C' }}>#{order.id}</span>
          <span style={{ fontSize: '11px', color: '#0C447C', fontWeight: '600' }}>🏪 Wholesale Purchase</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <span style={s.pendAgo}>{order.ago}</span>
          <span style={{ ...s.statusBadge, color: statusColor, backgroundColor: statusBg }}>{statusLabel}</span>
        </div>
      </div>

      <div style={s.pendCustomer}>
        <div style={s.pendInfoRow}>
          <Store size={13} color="#888888" />
          <span style={s.pendInfoText}>{order.wholesaler}</span>
        </div>
        {order.wholesalerPhone ? (
          <div style={s.pendInfoRow}>
            <Phone size={13} color="#888888" />
            <span style={s.pendInfoText}>{order.wholesalerPhone}</span>
          </div>
        ) : null}
      </div>

      <div style={s.pendItems}>
        {order.items.map((it, i) => <p key={i} style={s.pendItem}>• {it}</p>)}
        <span style={{ ...s.pendAmount, color: '#0C447C' }}>₹{order.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>

      {order.status === 'delivered' && (
        order.receivedByBuyer ? (
          <div style={s.receivedBadge}>
            <CheckCircle size={14} color="#1A6B3C" /> Received ✓
          </div>
        ) : (
          <button
            style={{ ...s.acceptBtn, width: '100%', backgroundColor: '#0C447C', opacity: receiving ? 0.7 : 1 }}
            onClick={() => onReceive(order._id)}
            disabled={receiving}
          >
            <CheckCircle size={15} color="#FFFFFF" />
            {receiving ? 'Inventory Update Ho Rahi Hai...' : '✅ Maal Mila (Received)'}
          </button>
        )
      )}
    </div>
  );
}

// ─── Rate Confirm Modal — shown right after "Received" ─────────
// New items are blocked (is_available=false) until a price is set here;
// existing/restocked items are pre-filled with their current price and can
// be left as-is (no-op) or updated — satisfies "retailer reviews rate every
// time" without forcing an already-live listing offline during a restock.
function RateConfirmModal({ items, onConfirm, onClose }) {
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(items.map((it) => [
      it.inventoryId,
      it.isNew ? '' : String(it.existingSellingPrice ?? ''),
    ]))
  );
  const [saving, setSaving] = useState(false);

  const newItemsMissingPrice = items.some((it) => it.isNew && !String(prices[it.inventoryId] || '').trim());

  const handleConfirm = async () => {
    if (newItemsMissingPrice) { alert('Naye items ka selling price daalna zaroori hai'); return; }
    setSaving(true);
    try {
      await onConfirm(prices);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={saving ? undefined : onClose}>
      <div style={s.modalSheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <p style={s.modalTitle}>Selling Rate Confirm Karo</p>
        </div>
        <p style={s.modalSub}>
          Naye items customer ko tab tak nahi dikhenge jab tak rate set na ho.
        </p>

        <div style={s.rateList}>
          {items.map((it) => (
            <div key={it.inventoryId} style={s.rateRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={s.rateItemName}>{it.name}</p>
                <p style={s.rateItemMeta}>
                  Qty: {it.quantity} · Cost: ₹{it.costPrice}
                  {it.isNew ? <span style={s.newTag}> NAYA</span> : null}
                </p>
              </div>
              <div style={s.ratePriceBox}>
                <span style={s.rateRupee}>₹</span>
                <input
                  style={s.rateInput}
                  type="number"
                  placeholder={it.isNew ? 'Rate' : ''}
                  value={prices[it.inventoryId]}
                  onChange={(e) => setPrices((p) => ({ ...p, [it.inventoryId]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>

        <button style={{ ...s.acceptBtn, width: '100%', backgroundColor: '#0C447C', opacity: saving ? 0.7 : 1 }} onClick={handleConfirm} disabled={saving}>
          <CheckCircle size={16} color="#FFFFFF" />
          {saving ? 'Save Ho Raha Hai...' : 'Confirm Karo'}
        </button>
        <button style={s.laterBtn} onClick={onClose} disabled={saving}>
          Baad Mein Karunga
        </button>
      </div>
    </div>
  );
}

// ─── Edit Store Details Modal (Profile tab) ────────────────────
function EditStoreModal({ seller, onSave, onClose }) {
  const [formData, setFormData] = useState({
    owner_name:   seller?.owner_name   || '',
    phone:        seller?.phone        || '',
    drug_license: seller?.drug_license || '',
    gst_number:   seller?.gst_number   || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (field) => (e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async () => {
    setError('');
    if (!formData.owner_name.trim()) { setError('Owner naam khaali nahi ho sakta'); return; }
    if (!/^\d{10}$/.test(formData.phone.trim())) { setError('Phone number 10 digit ka hona chahiye'); return; }

    setSaving(true);
    try {
      await onSave({
        owner_name:   formData.owner_name.trim(),
        phone:        formData.phone.trim(),
        drug_license: formData.drug_license.trim() || null,
        gst_number:   formData.gst_number.trim()   || null,
      });
    } catch (err) {
      setError(err?.message || 'Save nahi hua — dobara try karo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={saving ? undefined : onClose}>
      <div style={s.modalSheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <p style={s.modalTitle}>Store Details Edit Karo</p>
        </div>

        <div style={s.fieldWrap}>
          <label style={s.label}>Owner Naam *</label>
          <input style={s.commRateInput} value={formData.owner_name} onChange={set('owner_name')} placeholder="Owner ka naam" disabled={saving} />
        </div>

        <div style={s.fieldWrap}>
          <label style={s.label}>Phone Number *</label>
          <input style={s.commRateInput} type="tel" value={formData.phone} onChange={set('phone')} placeholder="10 digit number" maxLength={10} disabled={saving} />
        </div>

        <div style={s.fieldWrap}>
          <label style={s.label}>Drug License</label>
          <input style={s.commRateInput} value={formData.drug_license} onChange={set('drug_license')} placeholder="Optional" disabled={saving} />
        </div>

        <div style={s.fieldWrap}>
          <label style={s.label}>GST Number</label>
          <input style={s.commRateInput} value={formData.gst_number} onChange={set('gst_number')} placeholder="Optional" disabled={saving} />
        </div>

        {error && <p style={{ fontSize: '12px', color: '#DC3545', margin: 0, fontWeight: '600' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{ ...s.acceptBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSubmit} disabled={saving}>
            <Check size={16} color="#FFFFFF" />
            {saving ? 'Save Ho Raha Hai...' : 'Save Karo'}
          </button>
          <button style={s.declineBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function SellerDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { handleLogout } = useAuth();

  const [storeOpen,   setStoreOpen]   = useState(false);
  // Tab lives in the URL (?tab=) so a reload keeps you where you were —
  // falls back to 'home' silently if the query param is missing or names
  // a tab that doesn't exist (or a route-nav entry like 'inventory'/'buy').
  const [activeTab, setActiveTabState] = useState(() => {
    const fromUrl = searchParams.get('tab');
    return VALID_TABS.includes(fromUrl) ? fromUrl : 'home';
  });
  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    setSearchParams({ tab }, { replace: true });
  };
  const [orderFilter, setOrderFilter] = useState('sab');
  const [showNotif,   setShowNotif]   = useState(false);
  const [notifs,      setNotifs]      = useState([]);
  const unreadCount = notifs.filter((n) => !n.is_read).length;

  const [sellerData,    setSellerData]    = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [allOrders,     setAllOrders]     = useState([]);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [todayStats,       setTodayStats]       = useState({ totalOrders: 0, pendingCount: 0, todayEarnings: 0, lowStockCount: 0, todayCommission: 0 });
  const [platformCommission, setPlatformCommission] = useState(5);
  const [tierSettings, setTierSettings] = useState({ lowMax: 30, modMax: 70, lowRate: 5, modRate: 10, highRate: 20 });
  const [loading,            setLoading]            = useState(true);
  const [ordersSubTab,  setOrdersSubTab]  = useState('selling');
  const [b2bPurchases,  setB2bPurchases]  = useState([]);
  const [b2bLoading,    setB2bLoading]    = useState(false);
  const [receivingOrderId, setReceivingOrderId] = useState(null);
  const [rateConfirmItems, setRateConfirmItems] = useState(null); // null = closed, array = open
  const [showEditStore,    setShowEditStore]    = useState(false);
  const [showCommRequest,  setShowCommRequest]  = useState(false);
  const [reqMode,          setReqMode]          = useState('flat');
  const [reqRate,          setReqRate]          = useState('');
  const [reqSubmitting,    setReqSubmitting]    = useState(false);

  // ── Fetch helpers ──────────────────────────────────────────
  const fetchPendingOrders = async (sellerId) => {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*), buyer:buyer_id ( store_name, phone )')
      .eq('seller_id', sellerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (data) setPendingOrders(data);
  };

  const fetchTodayStats = async (sellerId) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('orders')
      .select('status, final_amount, delivery_charge, payment_method, payment_status, commission_amount, seller_earning')
      .eq('seller_id', sellerId)
      .gte('created_at', today.toISOString());
    if (data) {
      const earnedOrders = data.filter((o) =>
        (o.payment_method === 'cod' && o.status === 'delivered') ||
        (o.payment_method !== 'cod' && o.payment_status === 'paid' && o.status !== 'cancelled')
      );
      setTodayStats((prev) => ({
        ...prev,
        totalOrders:     data.length,
        pendingCount:    data.filter((o) => o.status === 'pending').length,
        todayEarnings:   earnedOrders.reduce((sum, o) => sum + (o.seller_earning != null ? o.seller_earning : (o.final_amount || 0)), 0),
        todayCommission: earnedOrders.reduce((sum, o) => sum + (o.commission_amount || 0), 0),
      }));
    }
  };

  const fetchLowStock = async (sellerId) => {
    const { data, error } = await supabase
      .from('seller_inventory')
      .select('stock_quantity, reserved_quantity, master_medicines(name)')
      .eq('seller_id', sellerId)
      .gt('stock_quantity', 0)
      .order('stock_quantity');
    if (error) { console.error('fetchLowStock error:', error); return; }
    if (data) {
      const normalized = data
        .map((d) => ({
          name:  d.master_medicines?.name || 'Medicine',
          stock: (d.stock_quantity || 0) - (d.reserved_quantity || 0),
        }))
        .filter((d) => d.stock > 0 && d.stock <= 10);
      setLowStockItems(normalized);
      setTodayStats((prev) => ({ ...prev, lowStockCount: normalized.length }));
    }
  };

  const fetchAllOrders = async (sellerId, filter) => {
    let query = supabase
      .from('orders')
      .select('*, order_items(*), buyer:buyer_id ( store_name, phone )')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    if (filter !== 'sab') query = query.eq('status', filter);
    const { data } = await query;
    if (data) setAllOrders(data);
  };

  const fetchSellerData = async () => {
    try {
      const seller = await getCurrentSeller();
      if (!seller) { navigate('/login'); return; }
      setSellerData(seller);
      setStoreOpen(seller.is_open ?? true);
      const { data: ps } = await supabase
        .from('platform_settings')
        .select('commission, tier_low_max, tier_mod_max, tier_low_rate, tier_mod_rate, tier_high_rate')
        .eq('id', 1)
        .maybeSingle();
      if (ps?.commission != null) setPlatformCommission(ps.commission);
      if (ps) {
        setTierSettings((prev) => ({
          lowMax:   ps.tier_low_max   ?? prev.lowMax,
          modMax:   ps.tier_mod_max   ?? prev.modMax,
          lowRate:  ps.tier_low_rate  ?? prev.lowRate,
          modRate:  ps.tier_mod_rate  ?? prev.modRate,
          highRate: ps.tier_high_rate ?? prev.highRate,
        }));
      }
      await Promise.all([
        fetchPendingOrders(seller.id),
        fetchTodayStats(seller.id),
        fetchLowStock(seller.id),
      ]);
    } catch (err) {
      console.error('Seller fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSellerData(); }, []);

  // Own notifications — medsetu_user.id is this seller's resolved users.id,
  // set by AuthContext at SIGNED_IN (email upsert), same as PharmacistPanel.
  useEffect(() => {
    try {
      const myUserId = JSON.parse(localStorage.getItem('medsetu_user') || '{}')?.id;
      if (myUserId) fetchUserNotifications(myUserId).then(({ data }) => setNotifs(data));
    } catch {}
  }, []);

  useEffect(() => {
    if (sellerData?.id && activeTab === 'orders') {
      fetchAllOrders(sellerData.id, orderFilter);
    }
  }, [activeTab, orderFilter, sellerData?.id]);

  useEffect(() => {
    if (sellerData?.id && activeTab === 'orders' && ordersSubTab === 'buying' && sellerData?.seller_type !== 'wholesaler') {
      setB2bLoading(true);
      fetchB2BOrders(sellerData.id).then(({ data }) => {
        if (data) setB2bPurchases(data);
        setB2bLoading(false);
      });
    }
  }, [activeTab, ordersSubTab, sellerData?.id, sellerData?.seller_type]);

  // Keep a ref so realtime callback always uses the latest filter value
  const orderFilterRef = useRef(orderFilter);
  useEffect(() => { orderFilterRef.current = orderFilter; }, [orderFilter]);

  // Realtime subscription — instant refresh when any order for this seller changes
  useEffect(() => {
    if (!sellerData?.id) return;
    const sid = sellerData.id;
    const channel = supabase
      .channel(`seller-orders-${sid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `seller_id=eq.${sid}` },
        () => {
          fetchPendingOrders(sid);
          fetchAllOrders(sid, orderFilterRef.current);
          fetchTodayStats(sid);
        }
      )
      // Buyer-side: retailers watching their own B2B purchases ("Meri
      // Khareedari") are the buyer_id, not seller_id, on those orders — so
      // the wholesaler marking one delivered never matched the filter above.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `buyer_id=eq.${sid}` },
        () => {
          fetchB2BOrders(sid).then(({ data }) => { if (data) setB2bPurchases(data); });
        }
      )
      .subscribe((status, err) => console.log('[SellerDashboard Realtime]', status, err ?? ''));
    return () => { supabase.removeChannel(channel); };
  }, [sellerData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────
  const toggleStoreStatus = async () => {
    if (!sellerData) return;
    const newStatus = !storeOpen;
    setStoreOpen(newStatus);
    const { error } = await supabase
      .from('sellers').update({ is_open: newStatus }).eq('id', sellerData.id);
    if (error) { setStoreOpen(!newStatus); alert('Update nahi hua — dobara try karo'); }
  };

  const handleSaveStoreDetails = async (updates) => {
    const { error } = await supabase
      .from('sellers').update(updates).eq('id', sellerData.id);
    if (error) throw error;
    setSellerData((prev) => ({ ...prev, ...updates }));
    setShowEditStore(false);
  };

  const acceptOrder = async (orderId) => {
    const { error } = await supabase
      .from('orders').update({ status: 'confirmed' }).eq('id', orderId);
    if (!error) {
      setPendingOrders((prev) => prev.filter((o) => o.id !== orderId));
      setTodayStats((prev) => ({ ...prev, pendingCount: Math.max(0, prev.pendingCount - 1) }));

      const acceptedOrder = pendingOrders.find((o) => o.id === orderId);
      if (acceptedOrder && sellerData?.id) {
        await reserveStock(sellerData.id, acceptedOrder.order_items || []);
      }
      if (acceptedOrder) {
        const isB2B = acceptedOrder.buyer_type === 'retailer';
        getOrderRecipientUserId(acceptedOrder)
          .then((uid) => uid && createNotification(
            uid, 'Order Accept! ✅',
            isB2B ? 'Wholesaler ne order accept kiya' : 'Store ne aapka order accept kar liya',
            isB2B ? 'b2b_update' : 'order_accepted', orderId
          ))
          .catch((err) => console.warn('[notify accept]', err));
      }
      if (sellerData?.id) await fetchAllOrders(sellerData.id, orderFilter);
    } else {
      console.error('acceptOrder failed:', error);
      alert('Order accept nahi hua: ' + (error.message || 'Unknown error'));
    }
  };

  const declineOrder = async (orderId) => {
    const declinedOrder = pendingOrders.find((o) => o.id === orderId);
    const { error } = await supabase
      .from('orders').update({ status: 'cancelled' }).eq('id', orderId);
    if (!error) {
      setPendingOrders((prev) => prev.filter((o) => o.id !== orderId));
      if (declinedOrder) {
        getOrderRecipientUserId(declinedOrder)
          .then((uid) => uid && createNotification(uid, 'Order Cancel', 'Aapka order cancel ho gaya', 'order_cancelled', orderId))
          .catch((err) => console.warn('[notify decline]', err));
      }
      if (sellerData?.id) await fetchAllOrders(sellerData.id, orderFilter);
    } else {
      console.error('declineOrder failed:', error);
      alert('Order decline nahi hua: ' + (error.message || 'Unknown error'));
    }
  };

  const markDelivered = async (orderId) => {
    const { error } = await updateOrderStatus(orderId, 'delivered');
    if (error) { console.error('markDelivered failed:', error); return; }
    const rawOrder = allOrders.find((o) => o.id === orderId);
    // Commission calculation — also check pendingOrders (home tab may not have allOrders loaded)
    const orderForComm = rawOrder || pendingOrders.find((o) => o.id === orderId);
    if (orderForComm?.commission_amount == null) {
      const subtotal = (orderForComm.final_amount || 0) - (orderForComm.delivery_charge || 0);
      let commAmt, rateToStore;

      if (sellerData?.commission_mode === 'tier') {
        // Item-wise: each order_item's admin-assigned commission_band
        // (snapshotted at order-placement time) decides its tier rate.
        let tierCommAmt = 0;
        for (const item of orderForComm.order_items || []) {
          let itemRate;
          if (item.commission_band === 'high') {
            itemRate = tierSettings.highRate;
          } else if (item.commission_band === 'moderate') {
            itemRate = tierSettings.modRate;
          } else if (item.commission_band === 'low') {
            itemRate = tierSettings.lowRate;
          } else {
            // Unclassified medicine (admin hasn't assigned a band yet) —
            // fall back to this seller's flat rate so tier calc can't
            // stall or crash.
            itemRate = sellerData?.commission_flat_rate ?? platformCommission;
          }
          tierCommAmt += (item.unit_price || 0) * (item.quantity || 0) * (itemRate / 100);
        }
        commAmt = parseFloat(tierCommAmt.toFixed(2));
        // Store the blended effective rate (numeric) rather than the literal
        // word "tier" — keeps commission_rate consistently numeric whether
        // the seller is flat or tier, for any downstream sorting/reporting.
        rateToStore = subtotal > 0 ? parseFloat(((commAmt / subtotal) * 100).toFixed(2)) : 0;
      } else {
        // Flat mode — existing calc, untouched.
        const rate = sellerData?.commission_flat_rate ?? platformCommission;
        commAmt     = parseFloat((subtotal * (rate / 100)).toFixed(2));
        rateToStore = rate;
      }

      const earning = parseFloat((subtotal - commAmt).toFixed(2));
      await supabase.from('orders').update({ commission_rate: rateToStore, commission_amount: commAmt, seller_earning: earning }).eq('id', orderId);
    }
    // Existing stock deduction (unchanged)
    if (rawOrder && sellerData?.id) {
      await deductStock(sellerData.id, rawOrder.order_items || []);
    }
    if (orderForComm) {
      const isB2B = orderForComm.buyer_type === 'retailer';
      getOrderRecipientUserId(orderForComm)
        .then((uid) => uid && createNotification(
          uid, 'Order Deliver! 🎉',
          isB2B ? 'Aapka B2B order deliver ho gaya — Maal Mila confirm karein' : 'Aapka order deliver ho gaya',
          isB2B ? 'b2b_update' : 'order_delivered', orderId
        ))
        .catch((err) => console.warn('[notify delivered]', err));
    }
    await fetchAllOrders(sellerData.id, orderFilter);
  };

  const cancelConfirmedOrder = async (orderId) => {
    const { error } = await updateOrderStatus(orderId, 'cancelled');
    if (error) { console.error('cancelConfirmedOrder failed:', error); return; }
    const rawOrder = allOrders.find((o) => o.id === orderId);
    if (rawOrder && sellerData?.id) {
      await releaseStock(sellerData.id, rawOrder.order_items || []);
    }
    if (rawOrder) {
      getOrderRecipientUserId(rawOrder)
        .then((uid) => uid && createNotification(uid, 'Order Cancel', 'Aapka order cancel ho gaya', 'order_cancelled', orderId))
        .catch((err) => console.warn('[notify cancel]', err));
    }
    await fetchAllOrders(sellerData.id, orderFilter);
  };

  // ── B2B Lot Auto-Add: retailer confirms receipt of a delivered order ──
  const handleReceiveLot = async (orderId) => {
    if (!sellerData?.id) return;
    const order = b2bPurchases.find((o) => o.id === orderId);
    if (!order || order.received_by_buyer) return;

    setReceivingOrderId(orderId);
    try {
      // Guarded update — only the first call for this order gets rows back.
      const { data: guardRows, error: guardErr } = await markOrderReceived(orderId);
      if (guardErr) { alert('Error: ' + guardErr.message); return; }
      if (!guardRows?.length) {
        // Lost the race (already received) — just resync the list.
        const { data } = await fetchB2BOrders(sellerData.id);
        if (data) setB2bPurchases(data);
        return;
      }

      const results = await addLotToRetailerInventory(sellerData.id, order);

      const { data } = await fetchB2BOrders(sellerData.id);
      if (data) setB2bPurchases(data);

      if (results.length) {
        setRateConfirmItems(results);
      } else {
        alert('Maal inventory mein add ho gaya!');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setReceivingOrderId(null);
    }
  };

  const handleConfirmRates = async (prices) => {
    const updates = Object.entries(prices)
      .filter(([, val]) => String(val).trim() !== '')
      .map(([inventoryId, val]) => ({ inventoryId, price: Number(val) }));

    for (const { inventoryId, price } of updates) {
      await supabase
        .from('seller_inventory')
        .update({ selling_price: price, is_available: price > 0 })
        .eq('id', inventoryId);
    }
    setRateConfirmItems(null);
  };

  // ── Commission change request (seller side) ────────────────
  const submitCommissionRequest = async () => {
    if (!sellerData?.id) return;
    const update = { commission_pending_mode: reqMode, commission_status: 'pending' };
    if (reqMode === 'flat') {
      const trimmed = reqRate.trim();
      const rate = trimmed === '' ? null : Number(trimmed);
      if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 100)) {
        alert('Rate 0-100 ke beech ek number hona chahiye');
        return;
      }
      update.commission_pending_rate = rate;
    } else {
      update.commission_pending_rate = null;
    }

    setReqSubmitting(true);
    try {
      const { error } = await supabase.from('sellers').update(update).eq('id', sellerData.id);
      if (error) { alert('Request bhejne mein error: ' + error.message); return; }
      setSellerData((prev) => ({ ...prev, ...update }));
      setShowCommRequest(false);
      alert('Request bhej diya gaya! Super Admin approval ka wait karo.');
    } finally {
      setReqSubmitting(false);
    }
  };

  const doLogout = () => { handleLogout(); navigate('/login'); };

  const pendingDisplayOrders = pendingOrders.map(mapOrderDisplay);
  const allDisplayOrders     = allOrders.map(mapOrderDisplay);
  const isWholesaler         = sellerData?.seller_type === 'wholesaler';

  const NAV_TABS = [
    { id: 'home',      Icon: Home,          label: 'Home',      badge: pendingOrders.length },
    { id: 'orders',    Icon: ClipboardList, label: 'Orders',    badge: pendingOrders.length },
    { id: 'inventory', Icon: Package,       label: 'Inventory', badge: null },
    { id: 'buy',       Icon: Store,         label: 'Khareedo',  badge: null },
    { id: 'earnings',  Icon: Wallet,        label: 'Earnings',  badge: null },
    { id: 'profile',   Icon: UserCircle,    label: 'Profile',   badge: null },
  ];
  const visibleTabs = NAV_TABS.filter((tab) => !(tab.id === 'buy' && isWholesaler));

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' }}>
        <p style={{ color: '#888888', fontSize: '14px' }}>Dashboard load ho raha hai...</p>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.greet}>Namaste 🙏</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '1px 0' }}>
              <span style={s.storeName}>{sellerData?.store_name || 'Medical Store'}</span>
              <span style={{
                fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px',
                backgroundColor: isWholesaler ? '#0C447C' : '#F26C0A',
                color: '#FFFFFF', letterSpacing: '0.5px', flexShrink: 0,
              }}>
                {isWholesaler ? 'WHOLESALER' : 'RETAILER'}
              </span>
            </div>
            <p style={s.storeCity}>{sellerData?.district || sellerData?.address || 'Deoria, UP'}</p>
          </div>
          <div style={s.headerRight}>
            <button style={s.iconBtn} onClick={() => setShowNotif(true)}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                {unreadCount > 0 && <span style={s.notifDot} />}
              </div>
            </button>
            <div style={s.avatar}>
              <span style={s.avatarLetter}>{(sellerData?.store_name || 'S')[0].toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* ══ HOME TAB ══════════════════════════════════════ */}
          {activeTab === 'home' && <>

            {/* Store Status toggle */}
            <div style={s.storeCard}>
              <div style={s.storeCardLeft}>
                <div style={s.storeIconBox}><Store size={22} color="#1A6B3C" /></div>
                <div>
                  <p style={s.storeLabel}>Aapki Dukaan</p>
                  <p style={s.storeSince}>{sellerData?.store_name || 'Medical Store'}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: storeOpen ? '#1A6B3C' : '#DC3545' }}>
                  {storeOpen ? 'Khuli Hai' : 'Band Hai'}
                </span>
                <button
                  style={{ ...s.toggle, backgroundColor: storeOpen ? '#1A6B3C' : '#DC3545', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={toggleStoreStatus}
                  aria-label={storeOpen ? 'Store band karo' : 'Store kholo'}
                >
                  <div style={{ ...s.toggleThumb, left: storeOpen ? '28px' : '3px' }}>
                    <span style={{ fontSize: '7px', fontWeight: '800', color: storeOpen ? '#1A6B3C' : '#DC3545', userSelect: 'none', lineHeight: 1 }}>
                      {storeOpen ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Metrics */}
            <div style={s.metricsGrid}>
              {[
                { Icon: ShoppingBag,   val: todayStats.totalOrders,                                               label: 'Aaj Ke Orders',  bg: '#E8F5EE', color: '#1A6B3C', pulse: false, onClick: () => { setActiveTab('orders'); setOrderFilter('sab'); } },
                { Icon: Clock,         val: todayStats.pendingCount,                                               label: 'Pending Orders', bg: '#FFF3E0', color: '#E65100', pulse: true,  onClick: () => { setActiveTab('orders'); setOrderFilter('pending'); } },
                { Icon: IndianRupee,   val: '₹' + todayStats.todayEarnings.toLocaleString('en-IN'),               label: 'Aaj Ki Kamai',   bg: '#EAF2FF', color: '#2563EB', pulse: false, onClick: () => setActiveTab('earnings') },
                { Icon: AlertTriangle, val: todayStats.lowStockCount,                                              label: 'Low Stock',      bg: '#FFEBEE', color: '#DC3545', pulse: false, onClick: () => navigate('/inventory') },
              ].map(({ Icon, val, label, bg, color, pulse, onClick }) => (
                <div key={label} style={{ ...s.metricCard, backgroundColor: bg, cursor: 'pointer' }} onClick={onClick}>
                  <div style={s.metricIconRow}>
                    <Icon size={18} color={color} />
                    {pulse && todayStats.pendingCount > 0 && <span style={{ ...s.pulseDot, backgroundColor: color }} />}
                  </div>
                  <p style={{ ...s.metricVal, color }}>{val}</p>
                  <p style={s.metricLabel}>{label}</p>
                </div>
              ))}
            </div>

            {/* Pending Orders */}
            <div style={s.section}>
              <div style={s.sectionHead}>
                <div style={s.sectionTitleRow}>
                  <span style={s.urgentDot} />
                  <span style={s.sectionTitle}>Turant Dhyan Den</span>
                </div>
                <span style={s.sectionSub}>{pendingOrders.length} pending</span>
              </div>
              {pendingOrders.length === 0 ? (
                <div style={s.noPending}>
                  <CheckCircle size={32} color="#1A6B3C" />
                  <p style={s.noPendingText}>Koi pending order nahi 🎉</p>
                </div>
              ) : (
                <div style={s.pendingList}>
                  {pendingDisplayOrders.map((o) => (
                    <OrderCard key={o._id} order={o} onAccept={acceptOrder} onDecline={declineOrder} onDeliver={markDelivered} onCancelConfirmed={cancelConfirmedOrder} />
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div style={s.section}>
              <p style={s.sectionTitle}>Quick Actions</p>
              <div style={s.quickScroll}>
                {QUICK_ACTIONS.map(({ label, Icon, iconColor, bg, route, tab }) => (
                  <button key={label} style={s.quickCard} onClick={() => { if (route) navigate(route); else if (tab) setActiveTab(tab); }}>
                    <div style={{ ...s.quickIcon, backgroundColor: bg }}><Icon size={20} color={iconColor} /></div>
                    <span style={s.quickLabel}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Low Stock */}
            {lowStockItems.length > 0 && (
              <div style={s.stockCard}>
                <div style={s.stockHeader}>
                  <AlertTriangle size={16} color="#DC3545" />
                  <p style={s.stockTitle}>Stock Khatam Hone Wala</p>
                </div>
                <div style={s.stockList}>
                  {lowStockItems.map((item) => (
                    <div key={item.name} style={s.stockRow}>
                      <span style={s.stockName}>{item.name}</span>
                      <span style={{ ...s.stockLeft, color: item.stock <= 5 ? '#DC3545' : '#E65100' }}>
                        {item.stock} strips bache
                      </span>
                    </div>
                  ))}
                </div>
                <button style={s.stockBtn} onClick={() => navigate('/inventory')}>Inventory Update Karo</button>
              </div>
            )}

            {/* Today summary card */}
            <div style={s.chartCard}>
              <div style={s.chartHeader}>
                <p style={s.sectionTitle}>Aaj Ki Kamai</p>
                <div style={s.chartTotal}>
                  <TrendingUp size={14} color="#1A6B3C" />
                  <span style={s.chartTotalText}>Live data</span>
                </div>
              </div>
              <p style={s.chartGrand}>₹{todayStats.todayEarnings.toLocaleString('en-IN')}</p>
              <p style={{ fontSize: '13px', color: '#888888', margin: 0 }}>
                {todayStats.totalOrders} orders aaj · {todayStats.pendingCount} pending
              </p>
              {todayStats.todayCommission > 0 && (
                <p style={{ fontSize: '11px', color: '#DC3545', margin: '6px 0 0' }}>
                  Platform commission: ₹{todayStats.todayCommission.toLocaleString('en-IN')} aaj
                </p>
              )}
            </div>
          </>}

          {/* ══ ORDERS TAB ════════════════════════════════════ */}
          {activeTab === 'orders' && <>
            <p style={s.tabTitle}>Saare Orders</p>

            {/* Sub-tab toggle — retailers only */}
            {!isWholesaler && (
              <div style={s.subTabRow}>
                <button
                  style={{ ...s.subTab, ...(ordersSubTab === 'selling' ? s.subTabActive : {}) }}
                  onClick={() => setOrdersSubTab('selling')}
                >
                  Customer Orders
                </button>
                <button
                  style={{ ...s.subTab, ...(ordersSubTab === 'buying' ? s.subTabActive : {}) }}
                  onClick={() => setOrdersSubTab('buying')}
                >
                  Meri Khareedari
                </button>
              </div>
            )}

            {/* ── Customer Orders sub-tab ── */}
            {(isWholesaler || ordersSubTab === 'selling') && <>
              <div style={s.filterRow}>
                {ORDER_FILTERS.map(({ label, value }) => (
                  <button
                    key={value}
                    style={{ ...s.filterChip, ...(orderFilter === value ? s.filterChipActive : {}) }}
                    onClick={() => setOrderFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {allDisplayOrders.length === 0 ? (
                <div style={s.noPending}>
                  <CheckCircle size={32} color="#1A6B3C" />
                  <p style={s.noPendingText}>Is filter mein koi orders nahi</p>
                </div>
              ) : (
                <div style={s.pendingList}>
                  {allDisplayOrders.map((o) => (
                    <OrderCard key={o._id} order={o} onAccept={acceptOrder} onDecline={declineOrder} onDeliver={markDelivered} onCancelConfirmed={cancelConfirmedOrder} />
                  ))}
                </div>
              )}
            </>}

            {/* ── Meri Khareedari sub-tab ── */}
            {!isWholesaler && ordersSubTab === 'buying' && <>
              {b2bLoading ? (
                <div style={s.noPending}>
                  <p style={{ ...s.noPendingText, color: '#888888' }}>Load ho raha hai...</p>
                </div>
              ) : b2bPurchases.length === 0 ? (
                <div style={s.noPending}>
                  <Package size={32} color="#CCCCCC" />
                  <p style={{ ...s.noPendingText, color: '#888888' }}>Abhi koi khareedari nahi</p>
                  <button
                    style={{ padding: '11px 24px', backgroundColor: '#0C447C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}
                    onClick={() => navigate('/wholesalers')}
                  >
                    Wholesaler se Khareedein
                  </button>
                </div>
              ) : (
                <div style={s.pendingList}>
                  {b2bPurchases.map((o) => (
                    <B2BPurchaseCard
                      key={o.id}
                      order={mapB2BPurchase(o)}
                      onReceive={handleReceiveLot}
                      receiving={receivingOrderId === o.id}
                    />
                  ))}
                </div>
              )}
            </>}
          </>}

          {/* ══ EARNINGS TAB ══════════════════════════════════ */}
          {activeTab === 'earnings' && <>
            <p style={s.tabTitle}>Kamai</p>

            <div style={s.earningsToday}>
              <div style={s.earningsStat}>
                <p style={s.earningsStatVal}>₹{todayStats.todayEarnings.toLocaleString('en-IN')}</p>
                <p style={s.earningsStatLabel}>Aaj Ki Kamai</p>
                {todayStats.todayCommission > 0 && (
                  <p style={{ fontSize: '11px', color: '#DC3545', margin: '4px 0 0', textAlign: 'center' }}>
                    Platform commission: ₹{todayStats.todayCommission.toLocaleString('en-IN')} aaj
                  </p>
                )}
              </div>
              <div style={s.earningsDivider} />
              <div style={s.earningsStat}>
                <p style={{ ...s.earningsStatVal, color: '#2563EB' }}>{todayStats.totalOrders}</p>
                <p style={s.earningsStatLabel}>Aaj Ke Orders</p>
              </div>
            </div>

            <div style={s.monthlyCard}>
              <div>
                <p style={s.monthlyLabel}>Is Mahine Ki Total Kamai</p>
                <p style={s.monthlyVal}>— Jald Aayega</p>
              </div>
              <IndianRupee size={32} color="#1A6B3C" strokeWidth={1.5} />
            </div>

            <button style={s.withdrawBtn}>
              <IndianRupee size={16} color="#FFFFFF" />
              Withdrawal Request Karo
            </button>
          </>}

          {/* ══ PROFILE TAB ═══════════════════════════════════ */}
          {activeTab === 'profile' && <>
            <p style={s.tabTitle}>Store Profile</p>

            <div style={s.profileCard}>
              <div style={s.profileAvatar}>
                <span style={s.profileAvatarLetter}>{(sellerData?.store_name || 'S')[0].toUpperCase()}</span>
              </div>
              <p style={s.profileStoreName}>{sellerData?.store_name || 'Medical Store'}</p>
              <p style={s.profileSub}>{sellerData?.district || 'Deoria, Uttar Pradesh'}</p>
            </div>

            <div style={s.infoCard}>
              {[
                { label: 'Owner Naam',          value: sellerData?.owner_name    || '—' },
                { label: 'Phone Number',         value: sellerData?.phone         || '—' },
                { label: 'Drug License',         value: sellerData?.drug_license  || '—' },
                { label: 'GST Number',           value: sellerData?.gst_number    || '—' },
                { label: 'Rating',               value: sellerData?.rating ? `${sellerData.rating} ⭐` : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={s.infoRow}>
                  <p style={s.infoLabel}>{label}</p>
                  <p style={s.infoValue}>{value}</p>
                </div>
              ))}
            </div>

            {/* ── Commission ── */}
            <div style={s.infoCard}>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: '14px 16px 4px' }}>Commission</p>
              <div style={s.infoRow}>
                <p style={s.infoLabel}>Mode</p>
                <p style={s.infoValue}>{sellerData?.commission_mode === 'tier' ? 'Tier (Margin-Based)' : 'Flat'}</p>
              </div>
              {sellerData?.commission_mode !== 'tier' && (
                <div style={s.infoRow}>
                  <p style={s.infoLabel}>Rate</p>
                  <p style={s.infoValue}>
                    {sellerData?.commission_flat_rate != null
                      ? `${sellerData.commission_flat_rate}%`
                      : `Platform Default (${platformCommission}%)`}
                  </p>
                </div>
              )}

              <div style={{ padding: '12px 16px' }}>
                {sellerData?.commission_status === 'pending' ? (
                  <div style={s.commPendingBox}>
                    <p style={{ fontSize: '12px', color: '#92400E', margin: 0 }}>
                      🔔 Aapka request approval mein hai: <strong>
                        {sellerData.commission_pending_mode === 'tier'
                          ? 'Tier (Margin-Based)'
                          : `Flat${sellerData.commission_pending_rate != null ? ` ${sellerData.commission_pending_rate}%` : ' (rate Super Admin decide karega)'}`}
                      </strong>
                    </p>
                  </div>
                ) : showCommRequest ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={s.subTabRow}>
                      {['flat', 'tier'].map((m) => (
                        <button key={m}
                          style={{ ...s.subTab, ...(reqMode === m ? s.subTabActive : {}) }}
                          onClick={() => setReqMode(m)}
                        >
                          {m === 'flat' ? 'Flat' : 'Tier'}
                        </button>
                      ))}
                    </div>
                    {reqMode === 'flat' && (
                      <input
                        style={s.commRateInput}
                        type="number" min="0" max="100" step="0.1"
                        placeholder="Proposed rate % (optional)"
                        value={reqRate}
                        onChange={(e) => setReqRate(e.target.value)}
                      />
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        style={{ ...s.acceptBtn, opacity: reqSubmitting ? 0.7 : 1 }}
                        onClick={submitCommissionRequest}
                        disabled={reqSubmitting}
                      >
                        {reqSubmitting ? 'Bhej Raha Hai...' : 'Request Bhejein'}
                      </button>
                      <button style={s.declineBtn} onClick={() => setShowCommRequest(false)} disabled={reqSubmitting}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button style={{ ...s.editBtn, padding: '11px' }} onClick={() => setShowCommRequest(true)}>
                    Change Request Bhejein
                  </button>
                )}
              </div>
            </div>

            <button style={s.editBtn} onClick={() => setShowEditStore(true)}>
              <Edit3 size={16} color="#1A6B3C" />
              Store Details Edit Karo
            </button>

            <button style={s.logoutBtn} onClick={doLogout}>
              <LogOut size={16} color="#FFFFFF" />
              Logout
            </button>
          </>}

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {visibleTabs.map(({ id, Icon, label, badge }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                style={s.navTab}
                onClick={() => {
                  if (id === 'inventory') { navigate('/inventory'); return; }
                  if (id === 'buy')       { navigate('/wholesalers'); return; }
                  setActiveTab(id);
                }}
              >
                <div style={{ position: 'relative' }}>
                  <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'} strokeWidth={isActive ? 2.5 : 1.8} />
                  {badge > 0 && <span style={s.navBadge}>{badge}</span>}
                </div>
                <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA', fontWeight: isActive ? '600' : '400' }}>
                  {label}
                </span>
                {isActive && <span style={s.navDot} />}
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
                      const myUserId = notifs[0]?.user_id;
                      setNotifs((p) => p.map((n) => ({ ...n, is_read: true })));
                      markAllNotificationsRead(myUserId);
                    }}
                  >
                    Sab Read Karo
                  </button>
                )}
              </div>
              <div style={s.notifList}>
                {notifs.length === 0 ? (
                  <div style={s.notifEmpty}>
                    <p style={s.notifEmptyTitle}>Abhi koi notification nahi 🔔</p>
                    <p style={s.notifEmptySub}>Naye orders aur updates yahan dikhenge</p>
                  </div>
                ) : (
                  notifs.map((n) => (
                    <div
                      key={n.id}
                      style={{ ...s.notifRow, backgroundColor: n.is_read ? '#FFFFFF' : '#F0FBF4' }}
                      onClick={() => {
                        setNotifs((p) => p.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
                        if (!n.is_read) markNotificationRead(n.id);
                      }}
                    >
                      <span style={s.notifIcon}>🔔</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ ...s.notifRowTitle, fontWeight: n.is_read ? '500' : '700' }}>{n.title}</p>
                        <p style={s.notifRowSub}>{n.body}</p>
                        <p style={s.notifRowTime}>{formatNotifTime(n.created_at)}</p>
                      </div>
                      {!n.is_read && <span style={s.unreadDot} />}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Rate Confirm Modal (after receiving a B2B lot) ── */}
        {rateConfirmItems && (
          <RateConfirmModal
            items={rateConfirmItems}
            onConfirm={handleConfirmRates}
            onClose={() => setRateConfirmItems(null)}
          />
        )}

        {/* ── Edit Store Details Modal (Profile tab) ── */}
        {showEditStore && (
          <EditStoreModal
            seller={sellerData}
            onSave={handleSaveStoreDetails}
            onClose={() => setShowEditStore(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  // Header
  header:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 16px 14px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  greet:       { fontSize: '12px', color: '#888888', margin: 0 },
  storeName:   { fontSize: '16px', fontWeight: '800', color: '#1A1A1A', margin: '1px 0' },
  storeCity:   { fontSize: '12px', color: '#888888', margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  notifDot:    { position: 'absolute', top: '-2px', right: '-2px', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444', border: '1.5px solid #FFFFFF' },
  notifOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  notifSheet:   { width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '20px 20px 0 0', padding: '12px 0 40px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' },
  notifHandle:  { width: '40px', height: '4px', backgroundColor: '#E0E0E0', borderRadius: '2px', margin: '0 auto 12px' },
  notifHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 12px', borderBottom: '1px solid #F0F0F0' },
  notifTitle:   { fontSize: '17px', fontWeight: '700', color: '#1A1A1A' },
  markAllBtn:   { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },
  notifList:    { overflowY: 'auto', flex: 1 },
  notifRow:     { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 20px', borderBottom: '1px solid #F5F5F5', cursor: 'pointer' },
  notifIcon:    { fontSize: '22px', flexShrink: 0, lineHeight: 1, marginTop: '2px' },
  notifRowTitle:{ fontSize: '14px', color: '#1A1A1A', margin: '0 0 3px' },
  notifRowSub:  { fontSize: '12px', color: '#666666', margin: '0 0 4px', lineHeight: '1.4' },
  notifRowTime: { fontSize: '11px', color: '#AAAAAA', margin: 0 },
  unreadDot:      { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1A6B3C', flexShrink: 0, marginTop: '6px' },
  notifEmpty:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: '8px' },
  notifEmptyTitle:{ fontSize: '15px', fontWeight: '600', color: '#1A1A1A', margin: 0, textAlign: 'center' },
  notifEmptySub:  { fontSize: '13px', color: '#AAAAAA', margin: 0, textAlign: 'center' },
  avatar:      { width: '38px', height: '38px', borderRadius: '19px', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  avatarLetter:{ fontSize: '16px', fontWeight: '800', color: '#FFFFFF' },

  // Body
  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },

  // Tab title
  tabTitle: { fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: '4px 0 2px' },

  // Store card & toggle
  storeCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderLeft: '4px solid #1A6B3C', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
  storeCardLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  storeIconBox:  { width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#E8F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  storeLabel:    { fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  storeSince:    { fontSize: '11px', color: '#888888', margin: 0, marginTop: '2px' },
  toggle: {
    width: '52px', height: '28px', borderRadius: '14px',
    position: 'relative', cursor: 'pointer',
    transition: 'background-color 0.3s ease', flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute', top: '3px',
    width: '22px', height: '22px', borderRadius: '50%',
    backgroundColor: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
    transition: 'left 0.3s ease',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  // Metrics
  metricsGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  metricCard:   { borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px' },
  metricIconRow:{ display: 'flex', alignItems: 'center', gap: '6px' },
  pulseDot:     { width: '8px', height: '8px', borderRadius: '50%', animation: 'pulse 1.4s ease-in-out infinite' },
  metricVal:    { fontSize: '26px', fontWeight: '800', margin: '4px 0 0', lineHeight: 1 },
  metricLabel:  { fontSize: '11px', color: '#555555', fontWeight: '500', margin: 0 },

  // Section
  section:        { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionHead:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow:{ display: 'flex', alignItems: 'center', gap: '8px' },
  urgentDot:      { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#DC3545', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0, display: 'inline-block' },
  sectionTitle:   { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sectionSub:     { fontSize: '12px', color: '#888888' },
  noPending:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 5px rgba(0,0,0,0.04)' },
  noPendingText:  { fontSize: '14px', color: '#1A6B3C', fontWeight: '600', margin: 0 },
  pendingList:    { display: 'flex', flexDirection: 'column', gap: '10px' },

  // Order card
  pendCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #E65100', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  pendTop:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  pendLeft:     { display: 'flex', flexDirection: 'column', gap: '3px' },
  pendId:       { fontSize: '13px', fontWeight: '800', color: '#1A6B3C', fontFamily: 'monospace' },
  pendAgo:      { fontSize: '11px', color: '#AAAAAA' },
  statusBadge:  { fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' },
  pendCustomer: { display: 'flex', flexDirection: 'column', gap: '5px' },
  pendInfoRow:  { display: 'flex', alignItems: 'center', gap: '6px' },
  pendInfoText: { fontSize: '13px', color: '#444444' },
  pendItems:    { display: 'flex', flexDirection: 'column', gap: '3px' },
  pendItem:     { fontSize: '13px', color: '#333333', margin: 0 },
  pendAmount:   { fontSize: '16px', fontWeight: '800', color: '#1A6B3C', marginTop: '4px' },
  badgeRow:     { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  badge:        { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '20px' },
  warningRow:   { display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#FFF3E0', padding: '7px 10px', borderRadius: '8px' },
  warningText:  { fontSize: '12px', color: '#E65100', fontWeight: '600' },
  pendBtns:     { display: 'flex', gap: '8px' },
  acceptBtn:    { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  declineBtn:   { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545', border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  receivedBadge:{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', backgroundColor: '#E8F5EE', color: '#1A6B3C', borderRadius: '10px', fontSize: '13px', fontWeight: '700' },

  // Rate Confirm Modal
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 210 },
  modalSheet:   { width: '100%', maxWidth: '480px', maxHeight: '85vh', backgroundColor: '#FFFFFF', borderRadius: '20px 20px 0 0', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' },
  modalHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle:   { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  modalSub:     { fontSize: '12px', color: '#888888', margin: 0, lineHeight: '1.5' },
  fieldWrap:    { display: 'flex', flexDirection: 'column', gap: '5px' },
  label:        { fontSize: '12px', fontWeight: '600', color: '#555555' },
  rateList:     { display: 'flex', flexDirection: 'column', gap: '10px' },
  rateRow:      { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: '#F8FAFF', borderRadius: '10px', border: '1px solid #E8EEF7' },
  rateItemName: { fontSize: '13px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 2px' },
  rateItemMeta: { fontSize: '11px', color: '#888888', margin: 0 },
  newTag:       { fontSize: '9px', fontWeight: '800', color: '#0C447C', backgroundColor: '#EAF2FF', padding: '1px 6px', borderRadius: '4px', marginLeft: '4px' },
  ratePriceBox: { display: 'flex', alignItems: 'center', gap: '4px', border: '1.5px solid #E0E0E0', borderRadius: '8px', padding: '6px 10px', backgroundColor: '#FFFFFF', flexShrink: 0 },
  rateRupee:    { fontSize: '13px', color: '#888888' },
  rateInput:    { width: '70px', border: 'none', outline: 'none', fontSize: '14px', fontWeight: '700', color: '#1A1A1A', fontFamily: 'inherit' },
  laterBtn:     { width: '100%', padding: '12px', backgroundColor: '#F5F5F5', color: '#555555', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },

  // Sub-tab toggle
  subTabRow:    { display: 'flex', gap: '4px', backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '4px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  subTab:       { flex: 1, padding: '9px', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', color: '#888888', backgroundColor: 'transparent' },
  subTabActive: { backgroundColor: '#1A6B3C', color: '#FFFFFF' },

  // Filter chips
  filterRow:       { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  filterChip:      { padding: '7px 16px', borderRadius: '20px', border: '1.5px solid #E0E0E0', backgroundColor: '#FFFFFF', fontSize: '13px', fontWeight: '500', color: '#666666', cursor: 'pointer', fontFamily: 'inherit' },
  filterChipActive:{ border: '1.5px solid #1A6B3C', backgroundColor: '#1A6B3C', color: '#FFFFFF', fontWeight: '700' },

  // Quick actions
  quickScroll: { display: 'flex', gap: '10px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '4px' },
  quickCard:   { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', backgroundColor: '#FFFFFF', border: 'none', borderRadius: '14px', padding: '14px 12px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 5px rgba(0,0,0,0.05)', minWidth: '76px' },
  quickIcon:   { width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  quickLabel:  { fontSize: '11px', fontWeight: '600', color: '#333333', textAlign: 'center', lineHeight: '1.2' },

  // Low stock
  stockCard:   { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #DC3545', padding: '14px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' },
  stockHeader: { display: 'flex', alignItems: 'center', gap: '8px' },
  stockTitle:  { fontSize: '14px', fontWeight: '700', color: '#DC3545', margin: 0 },
  stockList:   { display: 'flex', flexDirection: 'column', gap: '10px' },
  stockRow:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid #F5F5F5' },
  stockName:   { fontSize: '13px', fontWeight: '600', color: '#1A1A1A' },
  stockLeft:   { fontSize: '12px', fontWeight: '700' },
  stockBtn:    { width: '100%', padding: '12px', backgroundColor: '#FFFFFF', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  // Chart / summary card
  chartCard:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' },
  chartHeader:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  chartTotal:     { display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#E8F5EE', padding: '4px 10px', borderRadius: '20px' },
  chartTotalText: { fontSize: '11px', fontWeight: '700', color: '#1A6B3C' },
  chartGrand:     { fontSize: '26px', fontWeight: '800', color: '#1A6B3C', margin: 0 },

  // Earnings tab
  earningsToday:    { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '20px', display: 'flex', alignItems: 'center', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
  earningsStat:     { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' },
  earningsStatVal:  { fontSize: '26px', fontWeight: '800', color: '#1A6B3C', margin: 0 },
  earningsStatLabel:{ fontSize: '12px', color: '#888888', margin: 0 },
  earningsDivider:  { width: '1px', height: '48px', backgroundColor: '#E8E8E8', margin: '0 8px' },
  monthlyCard:      { backgroundColor: '#E8F5EE', borderRadius: '14px', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  monthlyLabel:     { fontSize: '12px', color: '#1A6B3C', fontWeight: '600', margin: '0 0 4px' },
  monthlyVal:       { fontSize: '22px', fontWeight: '800', color: '#1A6B3C', margin: 0 },
  withdrawBtn:      { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '15px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  // Profile tab
  profileCard:        { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
  profileAvatar:      { width: '72px', height: '72px', borderRadius: '36px', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  profileAvatarLetter:{ fontSize: '28px', fontWeight: '800', color: '#FFFFFF' },
  profileStoreName:   { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  profileSub:         { fontSize: '13px', color: '#888888', margin: 0 },
  infoCard:           { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '4px 0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', overflow: 'hidden' },
  infoRow:            { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #F5F5F5' },
  infoLabel:          { fontSize: '13px', color: '#888888', margin: 0 },
  infoValue:          { fontSize: '13px', fontWeight: '600', color: '#1A1A1A', margin: 0, textAlign: 'right' },
  editBtn:            { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: '#F0FDF4', color: '#1A6B3C', border: '1.5px solid #1A6B3C', borderRadius: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  logoutBtn:          { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: '#DC3545', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  commPendingBox:     { backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '10px 12px' },
  commRateInput:      { width: '100%', padding: '10px 12px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FAFAFA', boxSizing: 'border-box' },

  // Bottom nav
  bottomNav: { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' },
  navTab:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', position: 'relative', fontFamily: 'inherit' },
  navBadge:  { position: 'absolute', top: '-4px', right: '-6px', minWidth: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#DC3545', color: '#FFFFFF', fontSize: '9px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' },
  navLabel:  { fontSize: '10px' },
  navDot:    { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
};
