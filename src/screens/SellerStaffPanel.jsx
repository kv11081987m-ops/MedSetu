import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Package, LogOut, MapPin, Phone, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { generateInvoicePDF } from '../lib/invoicePdf';

const STATUS_LABEL = { pending: 'Naya Order', confirmed: 'Accept Ho Gaya', preparing: 'Pack Ho Raha' };
const STATUS_COLOR = { pending: '#E65100', confirmed: '#2563EB', preparing: '#7C3AED' };
const STATUS_BG    = { pending: '#FFF3E0', confirmed: '#EAF2FF', preparing: '#F3EEFF' };

export default function SellerStaffPanel() {
  const navigate = useNavigate();
  const { handleLogout } = useAuth();

  const [context,       setContext]       = useState(null); // my_seller_staff_context() row
  const [storeName,     setStoreName]     = useState('');
  const [orders,        setOrders]        = useState([]);
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

      await fetchPool(ctx.seller_id);
      setLoading(false);
    })();
  }, []);

  const fetchPool = async (sellerId) => {
    // sellers!seller_id embed included here (not fetched separately at
    // print time) so "Bill Print Karo" can call generateInvoicePDF(order)
    // directly on the already-loaded row — same shape lib/orders.js's
    // fetchOrderById returns, which is what OrderHistory.jsx/OrderTracking.jsx
    // already pass to generateInvoicePDF.
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items (*), sellers!seller_id (store_name, address, phone, district, owner_name, drug_license, gst_number, invoice_prefix)')
      .eq('seller_id', sellerId)
      .in('status', ['pending', 'confirmed', 'preparing'])
      .order('created_at', { ascending: true });
    if (error) { console.error('fetchPool error:', error); return; }
    setOrders(data || []);
  };

  const runAction = async (order, rpcName) => {
    setBusyId(order.id);
    const { data, error } = await supabase.rpc(rpcName, { p_order_id: order.id });
    setBusyId(null);
    if (error || !data?.success) {
      alert(data?.message || error?.message || 'Kuch galat hua');
      return;
    }
    await fetchPool(context.seller_id);
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

  acceptBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  printBtn:  { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#FFFFFF', color: '#0C447C', border: '1.5px solid #0C447C', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
};
