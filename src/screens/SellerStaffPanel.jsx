import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Package, LogOut, MapPin, Phone, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { generateInvoicePDF } from '../lib/invoicePdf';

const STATUS_LABEL = { pending: 'Naya Order', confirmed: 'Accept Ho Gaya', preparing: 'Packing Complete' };
const STATUS_COLOR = { pending: '#E65100', confirmed: '#2563EB', preparing: '#7C3AED' };
const STATUS_BG    = { pending: '#FFF3E0', confirmed: '#EAF2FF', preparing: '#F3EEFF' };

export default function SellerStaffPanel() {
  const navigate = useNavigate();
  const { handleLogout } = useAuth();

  const [context,       setContext]       = useState(null); // my_seller_staff_context() row
  const [storeName,     setStoreName]     = useState('');
  const [orders,        setOrders]        = useState([]);
  const [myLog,         setMyLog]         = useState([]);
  // Single-id expand tracker, same shape as SuperAdminPanel.jsx's own
  // `expanded === id ? null : id` toggle (the established pattern in this
  // codebase — there's no chevron-rotate precedent anywhere, the closest
  // existing convention is a ▲/▼ label swap; this uses a swapped
  // ChevronUp/ChevronDown icon instead since the card itself is the
  // tap target here, not a separate labeled button).
  const [expandedLogOrder, setExpandedLogOrder] = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [busyId,        setBusyId]        = useState(null);
  const [billLoadingId, setBillLoadingId] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: ctx, error } = await supabase.rpc('my_seller_staff_context');
      if (error || !ctx?.success) { setLoading(false); return; }
      setContext(ctx);

      // sellers SELECT is wide open (sellers_select_all) — safe for any
      // authenticated staff session to read the store name for the header.
      const { data: seller } = await supabase.from('sellers').select('store_name').eq('id', ctx.seller_id).maybeSingle();
      setStoreName(seller?.store_name || '');

      await Promise.all([fetchPool(ctx.seller_id), fetchMyLog(ctx.staff_id)]);
      setLoading(false);
    })();
  }, []);

  const fetchPool = async (sellerId) => {
    // sellers!seller_id embed included here (not fetched separately at
    // print time) so "Bill Print Karo" can call generateInvoicePDF(order)
    // directly on the already-loaded row — same shape lib/orders.js's
    // fetchOrderById returns, which is what OrderHistory.jsx/OrderTracking.jsx
    // already pass to generateInvoicePDF.
    // delivered_staff embed (074_staffPhoneAndReach.sql) — a delivery
    // partner can claim as early as 'confirmed'/'preparing'
    // (062_earlyClaimFlow.sql), so a rider can already be assigned while
    // this staff member is still packing; delivered_by_staff_id and
    // rider_reached_at themselves ride along on the `*` select already.
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items (*), sellers!seller_id (store_name, address, phone, district, owner_name, drug_license, gst_number, invoice_prefix), delivered_staff:delivered_by_staff_id(name, phone)')
      .eq('seller_id', sellerId)
      .in('status', ['pending', 'confirmed', 'preparing'])
      .order('created_at', { ascending: true });
    if (error) { console.error('fetchPool error:', error); return; }
    setOrders(data || []);
  };

  // "Mera Log" — everything this staff member has ever accepted, no status
  // filter (unlike fetchPool's pool, this is a history view — an order can
  // legitimately show up here AND in the pool above while still active).
  // seller_staff_view_orders RLS (056_sellerStaffSimple.sql) scopes by
  // seller_id, not status, so every status is already readable here.
  const fetchMyLog = async (staffId) => {
    const { data, error } = await supabase
      .from('orders')
      .select('order_number, customer_name, customer_phone, final_amount, status, payment_method, payment_status, updated_at, order_items(name, quantity, unit_price, total_price), delivered_staff:delivered_by_staff_id(name)')
      .eq('accepted_by_staff_id', staffId)
      .order('updated_at', { ascending: false })
      .limit(30);
    if (error) { console.error('fetchMyLog error:', error); return; }
    setMyLog(data || []);
  };

  const runAction = async (order, rpcName) => {
    setBusyId(order.id);
    const { data, error } = await supabase.rpc(rpcName, { p_order_id: order.id });
    setBusyId(null);
    if (error || !data?.success) {
      alert(data?.message || error?.message || 'Kuch galat hua');
      return;
    }
    await Promise.all([fetchPool(context.seller_id), fetchMyLog(context.staff_id)]);
  };

  const handlePrint = async (order) => {
    setBillLoadingId(order.id);
    try {
      await generateInvoicePDF(order);
    } catch (e) {
      console.error('[bill print]', e);
      alert('Bill print nahi hua, dobara try karo');
    } finally {
      setBillLoadingId(null);
    }
  };

  const doLogout = () => { handleLogout(); navigate('/login'); };

  if (loading) {
    return (
      <div style={s.wrapper}><div style={s.screen}>
        <p style={s.hintText}>Load ho raha hai...</p>
      </div></div>
    );
  }

  if (!context) {
    return (
      <div style={s.wrapper}><div style={s.screen}>
        <p style={s.hintText}>Active staff record nahi mila. Apne seller se sampark karein.</p>
        <button style={s.logoutBtn} onClick={doLogout}><LogOut size={16} color="#FFFFFF" /> Logout</button>
      </div></div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>{context.name || context.staff_code || 'Staff'}</p>
            <p style={s.headerSub}>{storeName}</p>
          </div>
          <button style={s.logoutIconBtn} onClick={doLogout}>
            <LogOut size={16} color="#FFFFFF" />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>
          <p style={s.tabTitle}>Order Pool</p>

          {orders.length === 0 && <p style={s.hintText}>Abhi koi order nahi</p>}

          {orders.map((order) => {
            const busy     = busyId === order.id;
            const printing = billLoadingId === order.id;
            return (
              <div key={order.id} style={s.pendCard}>
                <div style={s.pendTop}>
                  <span style={s.pendId}>#{order.order_number}</span>
                  <span style={{ ...s.statusBadge, color: STATUS_COLOR[order.status] || '#888888', backgroundColor: STATUS_BG[order.status] || '#F5F5F5' }}>
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                </div>

                <div style={s.pendInfoRow}>
                  <MapPin size={13} color="#888888" />
                  <span style={s.pendInfoText}>{order.customer_name || 'Customer'} — {order.delivery_address || order.delivery_pincode || '—'}</span>
                </div>
                {order.customer_phone && (
                  <div style={s.pendInfoRow}>
                    <Phone size={13} color="#888888" />
                    <span style={s.pendInfoText}>{order.customer_phone}</span>
                  </div>
                )}

                {/* 074_staffPhoneAndReach.sql — rider-visibility card, only
                    when a delivery partner has actually claimed this order
                    (early-claim, 062_earlyClaimFlow.sql, so this can show
                    even while still 'confirmed'/'preparing'). */}
                {order.delivered_staff?.name && (
                  order.rider_reached_at ? (
                    <div style={s.riderBoxReached}>
                      ✅ {order.delivered_staff.name} aa gaya hai — parcel handover karein
                    </div>
                  ) : (
                    <div style={s.riderBoxAssigned}>
                      🛵 {order.delivered_staff.name}{order.delivered_staff.phone ? ` ${order.delivered_staff.phone}` : ''} — Pickup ke liye assign ho gaya hai
                    </div>
                  )
                )}

                <div style={s.pendItems}>
                  {(order.order_items || []).map((it) => (
                    <p key={it.id} style={s.pendItem}>• {it.name || 'Item'} x{it.quantity || 1}</p>
                  ))}
                  <span style={s.pendAmount}>₹{Number(order.final_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>

                {order.status === 'pending' && (
                  <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => runAction(order, 'staff_accept_order')}>
                    <CheckCircle size={15} color="#FFFFFF" /> {busy ? '...' : 'Accept Karo'}
                  </button>
                )}

                {order.status === 'confirmed' && (
                  <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => runAction(order, 'staff_mark_packed')}>
                    <Package size={15} color="#FFFFFF" /> {busy ? '...' : 'Pack Kiya'}
                  </button>
                )}

                {order.status === 'preparing' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.acceptBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => runAction(order, 'staff_handover_order')}>
                      <CheckCircle size={15} color="#FFFFFF" /> {busy ? '...' : 'Handover Karo'}
                    </button>
                    <button style={{ ...s.printBtn, opacity: printing ? 0.6 : 1 }} disabled={printing} onClick={() => handlePrint(order)}>
                      <FileText size={15} color="#0C447C" /> {printing ? '...' : 'Bill Print Karo'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Mera Log — read-only history, every status, no actions ── */}
          <p style={s.tabTitle}>Mera Log</p>

          {myLog.length === 0 && <p style={s.hintText}>Abhi koi log nahi</p>}

          {myLog.map((order) => {
            const isOpen = expandedLogOrder === order.order_number;
            return (
              <div
                key={order.order_number}
                style={{ ...s.pendCard, borderLeftColor: '#AAAAAA', cursor: 'pointer' }}
                onClick={() => setExpandedLogOrder(isOpen ? null : order.order_number)}
              >
                <div style={s.pendTop}>
                  <span style={s.pendId}>#{order.order_number}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ ...s.statusBadge, color: STATUS_COLOR[order.status] || '#888888', backgroundColor: STATUS_BG[order.status] || '#F5F5F5' }}>
                      {STATUS_LABEL[order.status] || order.status}
                    </span>
                    {isOpen ? <ChevronUp size={16} color="#888888" /> : <ChevronDown size={16} color="#888888" />}
                  </div>
                </div>
                <div style={s.pendInfoRow}>
                  <span style={s.pendInfoText}>{order.customer_name || 'Customer'} · ₹{Number(order.final_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <p style={s.staffLine}>{new Date(order.updated_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>

                {isOpen && (
                  <div style={s.logExpanded}>
                    {(order.order_items || []).map((it, i) => (
                      <p key={i} style={s.pendItem}>
                        • {it.name || 'Item'} x{it.quantity || 1} — ₹{Number(it.total_price ?? it.unit_price * (it.quantity || 1)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                    ))}
                    <p style={s.logExpandedAmount}>Total: ₹{Number(order.final_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                    <p style={s.staffLine}>Payment: {order.payment_method === 'cod' ? 'COD' : 'Prepaid'}</p>
                    {order.delivered_staff?.name && <p style={s.staffLine}>Delivery Partner: {order.delivered_staff.name}</p>}
                    {order.customer_phone && <p style={s.staffLine}>Phone: {order.customer_phone}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const s = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  hintText:   { fontSize: '13px', color: '#888888', textAlign: 'center', padding: '32px 16px' },
  logoutBtn:  { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', margin: '0 16px', padding: '11px', backgroundColor: '#DC3545', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  header:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  headerTitle:    { fontSize: '17px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  headerSub:      { fontSize: '12px', color: '#888888', margin: '1px 0 0' },
  logoutIconBtn:  { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', backgroundColor: '#DC3545', border: 'none', borderRadius: '10px', cursor: 'pointer' },

  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },

  tabTitle: { fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: '4px 0 2px' },

  pendCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid #1A6B3C', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  pendTop:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  pendId:       { fontSize: '13px', fontWeight: '800', color: '#1A6B3C', fontFamily: 'monospace' },
  statusBadge:  { fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' },
  pendInfoRow:  { display: 'flex', alignItems: 'center', gap: '6px' },
  pendInfoText: { fontSize: '13px', color: '#444444' },
  pendItems:    { display: 'flex', flexDirection: 'column', gap: '3px' },
  pendItem:     { fontSize: '13px', color: '#333333', margin: 0 },
  pendAmount:   { fontSize: '16px', fontWeight: '800', color: '#1A6B3C', marginTop: '4px' },
  staffLine:    { fontSize: '11px', color: '#888888', margin: 0 },
  riderBoxAssigned: { fontSize: '12px', fontWeight: '600', color: '#0C447C', backgroundColor: '#EAF2FF', border: '1px solid #C7DDF5', borderRadius: '8px', padding: '8px 10px' },
  riderBoxReached:  { fontSize: '12px', fontWeight: '600', color: '#1A6B3C', backgroundColor: '#E8F5EE', border: '1px solid #B8E0C8', borderRadius: '8px', padding: '8px 10px' },
  logExpanded:       { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', paddingTop: '10px', borderTop: '1px solid #F0F0F0' },
  logExpandedAmount: { fontSize: '14px', fontWeight: '800', color: '#1A6B3C', margin: '2px 0' },

  acceptBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  printBtn:  { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#FFFFFF', color: '#0C447C', border: '1.5px solid #0C447C', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
};
