import { useState, useEffect } from 'react';
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

// claimed_by ke teen states — button/action Chunk 5b me, abhi sirf badge.
function claimBadge(order, myStaffId) {
  if (!order.claimed_by) {
    return { text: 'Pool me (koi ne nahi liya)', color: '#E65100', bg: '#FFF3E0' };
  }
  if (order.claimed_by === myStaffId) {
    return { text: 'Aapne liya hai', color: '#1A6B3C', bg: '#E8F5EE' };
  }
  return { text: 'Kisi aur ne liya', color: '#888888', bg: '#F0F0F0' };
}

// ─── Order Card ───────────────────────────────────────────────
function PoolOrderCard({ order, myStaffId }) {
  const badge = claimBadge(order, myStaffId);
  const name  = order.users?.name || order.customer_name || 'Customer';
  const items = order.order_items || [];

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
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function StaffPanel() {
  const navigate = useNavigate();
  const { handleLogout: authLogout } = useAuth();

  const [staff,   setStaff]   = useState(null);   // { id, aggregator_seller_id, deployed_wholesaler_id, name }
  const [pool,    setPool]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const handleLogout = async () => { await authLogout(); navigate('/login'); };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let medsetuUser = {};
      try { medsetuUser = JSON.parse(localStorage.getItem('medsetu_user') || '{}'); } catch {}
      const email = medsetuUser?.email || '';
      if (!email) { if (!cancelled) { setError(true); setLoading(false); } return; }

      // Apni seller_staff row — id (claim-badge match ke liye), aggregator/
      // deployed wholesaler (pool query + header subtitle ke liye).
      const { data: staffRow, error: staffErr } = await supabase
        .from('seller_staff')
        .select('id, aggregator_seller_id, deployed_wholesaler_id, name')
        .eq('email', email)
        .eq('is_active', true)
        .maybeSingle();

      if (staffErr || !staffRow) { if (!cancelled) { setError(true); setLoading(false); } return; }
      if (cancelled) return;
      setStaff(staffRow);

      if (!staffRow.deployed_wholesaler_id) {
        // Aggregator staff jise abhi koi wholesaler assign nahi hua —
        // pool khaali dikhega (051's RLS bhi is case mein kuch nahi dega).
        setPool([]);
        setLoading(false);
        return;
      }

      // orders↔sellers embed jaan-boojhkar NAHI — orders ke do FK
      // (seller_id + buyer_id) sellers ki taraf jaate hain, PostgREST
      // embed ambiguous -> HTTP 300 "Multiple Choices" (PharmacistPanel
      // ka hi pehle se pakda hua gap, fetchCallQueue:371-373 dekho).
      // 051_staffPoolVisibility.sql ki RLS already isi wholesaler tak
      // scope karti hai — .eq() yahan bhi lagाya hai taaki query khud
      // saaf/explicit rahe, RLS ke upar hi bharosa na kiya jaaye.
      const { data, error: poolErr } = await supabase
        .from('orders')
        .select('*, users(name), order_items(*)')
        .eq('sourced_from_wholesaler_id', staffRow.deployed_wholesaler_id)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: true });

      if (cancelled) return;
      if (poolErr) { setError(true); setLoading(false); return; }
      setPool(data || []);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, []);

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
          <div style={s.sectionHead}>
            <div style={s.sectionTitleRow}>
              <Package size={16} color="#1A6B3C" />
              <span style={s.sectionTitle}>Aapke Wholesaler Ke Orders</span>
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
                <PoolOrderCard key={order.id} order={order} myStaffId={staff?.id} />
              ))}
            </div>
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
};
