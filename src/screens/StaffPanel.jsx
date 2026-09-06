import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { asUtcDate } from '../lib/formatTime';
import { LogOut, Package, MapPin, Phone } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────
// Same asUtcDate-based diffing as PharmacistPanel's getTimeAgo — a
// no-zone Supabase timestamp read as a naive Date on an IST-clock device
// would otherwise look ~5:30h older than it really is.
const getTimeAgo = (dateStr) => {
  const diff = Math.floor((Date.now() - asUtcDate(dateStr)) / 1000);
  if (diff < 60)   return `${diff} sec pehle`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min pehle`;
  return `${Math.floor(diff / 3600)} ghante pehle`;
};

const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing'];

const STATUS_LABEL = {
  pending:   'Naya Order',
  confirmed: 'Accept Ho Gaya',
  preparing: 'Pack Ho Raha',
};

// claimed_by ke teen states — informational badge, action button niche alag hai.
function claimBadge(order, myStaffId) {
  if (!order.claimed_by) {
    return { text: 'Pool me (koi ne nahi liya)', color: '#E65100', bg: '#FFF3E0' };
  }
  if (order.claimed_by === myStaffId) {
    return { text: 'Aapne liya hai', color: '#1A6B3C', bg: '#E8F5EE' };
  }
  return { text: 'Kisi aur ne liya', color: '#888888', bg: '#F0F0F0' };
}

// Ek hi jagah decide karta hai is card par KAUNSA (agar koi) action button
// dikhna chahiye — order.claimed_by/status aur is staff ke type (aggregator
// ya normal-seller) ke combination se. successKey = jis flag ko RPC ke
// response me check karna hai (har RPC ka apna naam hai: claimed/accepted/
// packed/handed) — variant sirf button ka rang decide karta hai.
function resolvePoolAction(order, myStaffId, isAggregator) {
  const mine = order.claimed_by === myStaffId;

  if (!order.claimed_by && order.status === 'pending') {
    return { label: 'Claim', rpc: 'claim_order', successKey: 'claimed', variant: 'primary' };
  }
  if (mine && order.status === 'pending') {
    return { label: 'Accept', rpc: 'staff_accept_order', successKey: 'accepted', variant: 'primary' };
  }
  if (mine && order.status === 'confirmed') {
    return isAggregator
      ? { label: 'Handover Office Ko', rpc: 'staff_mark_packed', successKey: 'packed', variant: 'secondary' }
      : { label: 'Pack', rpc: 'staff_mark_packed', successKey: 'packed', variant: 'secondary' };
  }
  if (mine && order.status === 'preparing' && !isAggregator) {
    // Aggregator staff ka kaam confirmed->preparing (handover office ko) par
    // hi khatam ho jaata hai — preparing par unke liye koi button nahi.
    return { label: 'Handover', rpc: 'staff_handover_order', successKey: 'handed', variant: 'secondary' };
  }
  return null;
}

// ─── Order Card ───────────────────────────────────────────────
function PoolOrderCard({ order, myStaffId, isAggregator, onAction }) {
  const [acting, setActing] = useState(false);
  const badge  = claimBadge(order, myStaffId);
  const name   = order.users?.name || order.customer_name || 'Customer';
  const items  = order.order_items || [];
  const action = resolvePoolAction(order, myStaffId, isAggregator);

  const handleAction = async () => {
    if (!action || acting) return; // double-click guard — button is also disabled while acting
    setActing(true);
    const { data, error } = await supabase.rpc(action.rpc, { p_order_id: order.id });
    setActing(false);
    const res = Array.isArray(data) ? data[0] : data;
    if (error || res?.[action.successKey] === false) {
      alert(res?.message || error?.message || 'Kuch galat hua');
      return; // do NOT reload on failure — pool stays as-is
    }
    onAction(); // success only — parent's reloadPool()
  };

  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        <div>
          <p style={s.cardName}>{name}</p>
          <div style={s.cardInfoRow}>
            <Phone size={12} color="#888888" />
            <span style={s.cardMeta}>{order.customer_phone || '—'}</span>
          </div>
          <div style={s.cardInfoRow}>
            <MapPin size={12} color="#888888" />
            <span style={s.cardMeta}>
              {order.delivery_pincode ? `PIN ${order.delivery_pincode}` : (order.delivery_address || '—')}
            </span>
            <span style={s.cardDot}>·</span>
            <span style={s.cardMeta}>#{order.order_number || String(order.id).slice(0, 8).toUpperCase()}</span>
          </div>
        </div>
        <div style={s.cardTopRight}>
          <span style={s.statusTag}>{STATUS_LABEL[order.status] || order.status}</span>
          <span style={s.timeTag}>{order.created_at ? getTimeAgo(order.created_at) : '—'}</span>
        </div>
      </div>

      <div style={s.itemsBox}>
        {items.length === 0 ? (
          <p style={s.itemLine}>Order items</p>
        ) : (
          items.map((it) => (
            <p key={it.id} style={s.itemLine}>• {it.name || 'Item'} x{it.quantity || 1}</p>
          ))
        )}
      </div>

      <span style={{ ...s.claimBadge, color: badge.color, backgroundColor: badge.bg }}>
        {badge.text}
      </span>

      {action && (
        <button
          style={{
            ...(action.variant === 'secondary' ? s.actionBtnSecondary : s.actionBtnPrimary),
            opacity: acting ? 0.7 : 1,
          }}
          onClick={handleAction}
          disabled={acting}
        >
          {acting ? '...' : action.label}
        </button>
      )}
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function StaffPanel() {
  const navigate = useNavigate();
  const { handleLogout: authLogout } = useAuth();

  const [staff,   setStaff]   = useState(null);   // my_staff_context() row: { staff_id, staff_code, name, seller_id, deployed_wholesaler_id, is_aggregator }
  const [pool,    setPool]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const handleLogout = async () => { await authLogout(); navigate('/login'); };

  // Mirrors the old effect-local `cancelled` flag, but as a ref so the same
  // guard works from a reusable function called both on mount and later
  // (5b-ii's action buttons will call reloadPool() after an RPC succeeds).
  const mountedRef = useRef(true);

  const reloadPool = useCallback(async () => {
    let medsetuUser = {};
    try { medsetuUser = JSON.parse(localStorage.getItem('medsetu_user') || '{}'); } catch {}
    const email = medsetuUser?.email || '';
    if (!email) { if (mountedRef.current) { setError(true); setLoading(false); } return; }

    // Apni active posting — my_staff_context() RPC (staff + staff_assignment
    // join, 059_myStaffContext.sql) — staff_id (claim-badge match ke liye),
    // seller_id/deployed_wholesaler_id/is_aggregator (pool query + header
    // subtitle ke liye). Koi active assignment nahi -> 0 rows.
    const { data: ctxRows, error: staffErr } = await supabase.rpc('my_staff_context');
    const staffRow = Array.isArray(ctxRows) ? ctxRows[0] : ctxRows;

    if (staffErr || !staffRow) { if (mountedRef.current) { setError(true); setLoading(false); } return; }
    if (!mountedRef.current) return;
    setStaff(staffRow);

    if (staffRow.is_aggregator && !staffRow.deployed_wholesaler_id) {
      // Aggregator staff jise abhi koi wholesaler assign nahi hua —
      // pool khaali dikhega (051's RLS bhi is case mein kuch nahi degi).
      // NOTE: normal-seller staff bhi deployed_wholesaler_id=NULL rakhte
      // hain by design (is_aggregator=false unke liye) — is_aggregator check
      // isi wajah se zaroori hai, warna unka pool bhi galti se khaali ho
      // jaata tha (purana bug, 5b-i me fix).
      setPool([]);
      setLoading(false);
      return;
    }

    // orders↔sellers embed jaan-boojhkar NAHI — orders ke do FK
    // (seller_id + buyer_id) sellers ki taraf jaate hain, PostgREST
    // embed ambiguous -> HTTP 300 "Multiple Choices" (PharmacistPanel
    // ka hi pehle se pakda hua gap, fetchCallQueue:371-373 dekho).
    // 051/055 ki RLS already isi wholesaler/dukan tak scope karti hai —
    // .eq() yahan bhi lagाya hai taaki query khud saaf/explicit rahe,
    // RLS ke upar hi bharosa na kiya jaaye.
    let query = supabase
      .from('orders')
      .select('*, users(name), order_items(*)')
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: true });

    // Aggregator staff deployed on a wholesaler -> that wholesaler's sourced
    // orders. Normal-seller staff (deployed_wholesaler_id always NULL) ->
    // their own shop's orders.
    query = staffRow.deployed_wholesaler_id
      ? query.eq('sourced_from_wholesaler_id', staffRow.deployed_wholesaler_id)
      : query.eq('seller_id', staffRow.seller_id);

    const { data, error: poolErr } = await query;

    if (!mountedRef.current) return;
    if (poolErr) { setError(true); setLoading(false); return; }
    setPool(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    reloadPool();
    return () => { mountedRef.current = false; };
  }, [reloadPool]);

  // Heading depends on what kind of posting this staff has — aggregator
  // staff deployed on a wholesaler see that wholesaler's orders, an
  // aggregator staff not yet deployed sees nothing, a normal-seller staff
  // sees their own shop's orders.
  const poolHeading = staff?.deployed_wholesaler_id
    ? 'Aapke Wholesaler Ke Orders'
    : staff?.is_aggregator
      ? 'Abhi kisi wholesaler par deploy nahi'
      : 'Aapki Dukan Ke Orders';

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>Staff Panel</p>
            <p style={s.headerSub}>{staff?.name || 'Staff'}</p>
          </div>
          <button style={s.logoutBtn} onClick={handleLogout}>
            <LogOut size={16} color="#FFFFFF" />
          </button>
        </div>

        {/* ── Content ── */}
        <div style={s.content}>
          {staff?.is_on_hold ? (
            <div style={s.holdBanner}>
              <p style={s.holdBannerTitle}>⏸ Aapki duty hold par hai</p>
              <p style={s.holdBannerText}>Filhaal aap orders par kaam nahi kar sakte. Apne seller se sampark karein.</p>
            </div>
          ) : (
            <>
              <div style={s.sectionHead}>
                <div style={s.sectionTitleRow}>
                  <Package size={16} color="#1A6B3C" />
                  <span style={s.sectionTitle}>{poolHeading}</span>
                </div>
                <span style={s.sectionSub}>{pool.length} active</span>
              </div>

              {loading ? (
                <p style={s.hintText}>Load ho raha hai...</p>
              ) : error ? (
                <div style={s.emptyCard}>
                  <p style={s.emptyText}>Kuch load nahi ho paya. Dobara try karein.</p>
                </div>
              ) : pool.length === 0 ? (
                <div style={s.emptyCard}>
                  <Package size={28} color="#AAAAAA" />
                  <p style={s.emptyText}>Abhi koi order nahi</p>
                </div>
              ) : (
                <div style={s.cardList}>
                  {pool.map((order) => (
                    <PoolOrderCard
                      key={order.id}
                      order={order}
                      myStaffId={staff?.staff_id}
                      isAggregator={!!staff?.is_aggregator}
                      onAction={reloadPool}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  headerSub:   { fontSize: '12px', color: '#888888', margin: 0 },
  logoutBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', backgroundColor: '#DC3545', border: 'none', borderRadius: '10px', cursor: 'pointer' },

  content: { flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },

  sectionHead:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow: { display: 'flex', alignItems: 'center', gap: '6px' },
  sectionTitle:    { fontSize: '15px', fontWeight: '700', color: '#1A1A1A' },
  sectionSub:      { fontSize: '12px', color: '#888888', fontWeight: '600' },

  holdBanner:      { backgroundColor: '#FFF3E0', border: '1.5px solid #F5A623', borderRadius: '14px', padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '6px' },
  holdBannerTitle: { fontSize: '15px', fontWeight: '800', color: '#B45309', margin: 0 },
  holdBannerText:  { fontSize: '13px', color: '#92400E', margin: 0, lineHeight: '1.5' },

  hintText:  { fontSize: '13px', color: '#888888', textAlign: 'center', padding: '24px 0' },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 5px rgba(0,0,0,0.04)' },
  emptyText: { fontSize: '14px', color: '#888888', fontWeight: '600', margin: 0, textAlign: 'center' },

  cardList: { display: 'flex', flexDirection: 'column', gap: '10px' },

  card:         { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #1A6B3C', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  cardTop:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardName:     { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  cardInfoRow:  { display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' },
  cardMeta:     { fontSize: '12px', color: '#666666' },
  cardDot:      { color: '#CCCCCC', fontSize: '12px' },
  cardTopRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' },
  statusTag:    { fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '20px', color: '#0C447C', backgroundColor: '#EAF2FF' },
  timeTag:      { fontSize: '11px', color: '#AAAAAA' },

  itemsBox: { display: 'flex', flexDirection: 'column', gap: '3px' },
  itemLine: { fontSize: '13px', color: '#333333', margin: 0 },

  claimBadge: { alignSelf: 'flex-start', fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '20px' },

  // primary = Claim/Accept (green, matches the app's main action color).
  // secondary = Pack/Handover-office/Handover (blue, visually distinct so a
  // staff can tell "claim/accept" apart from "move it along" at a glance).
  actionBtnPrimary:   { width: '100%', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  actionBtnSecondary: { width: '100%', padding: '11px', backgroundColor: '#0C447C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
};
