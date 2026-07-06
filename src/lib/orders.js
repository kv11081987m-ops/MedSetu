import { supabase } from './supabase';

// ── Create order ───────────────────────────────────────────────
export const createOrder = async (orderData) => {
  const orderNumber = 'MED-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

  const { data, error } = await supabase
    .from('orders')
    .insert({
      order_number:     orderNumber,
      customer_id:      orderData.customerId   || null,
      customer_name:    orderData.customerName  || null,
      customer_phone:   orderData.customerPhone || null,
      seller_id:        orderData.sellerId      || null,
      buyer_id:         orderData.buyerId       || null,
      buyer_type:       orderData.buyerType     || 'customer',
      total_amount:     orderData.totalAmount,
      delivery_charge:  orderData.deliveryCharge ?? 30,
      discount:         orderData.discount       ?? 0,
      promo_code:       orderData.promoCode      || null,
      final_amount:     orderData.finalAmount,
      status:           'pending',
      payment_method:   orderData.paymentMethod,
      payment_status:   orderData.paymentMethod === 'cod' ? 'pending' : 'paid',
      delivery_type:    orderData.deliveryType,
      delivery_address: orderData.deliveryAddress || null,
      prescription_url: orderData.prescriptionUrl || null,
    })
    .select();

  if (error) console.error('[createOrder]', error.code, error.message, error.details);
  return { data, error };
};

// ── Create order items ─────────────────────────────────────────
// Maps cart items → order_items schema (name, unit_price, total_price).
// Also snapshots each item's current commission_band (admin-assigned, on
// master_medicines) at order time — mirrors unit_price already being a
// frozen snapshot rather than a live join, so a later admin reclassification
// can't retroactively change an already-placed order's tier-commission math.
export const createOrderItems = async (orderId, items, sellerId) => {
  if (!items?.length) return { data: [], error: null };

  let bandByMedicine = {};
  if (sellerId) {
    const medicineIds = items.map((item) => item.id).filter(Boolean);
    const { data: invRows } = await supabase
      .from('seller_inventory')
      .select('medicine_id, master_medicines(commission_band)')
      .eq('seller_id', sellerId)
      .in('medicine_id', medicineIds);
    (invRows || []).forEach((row) => { bandByMedicine[row.medicine_id] = row.master_medicines?.commission_band ?? null; });
  }

  const orderItems = items.map((item) => ({
    order_id:        orderId,
    medicine_id:     item.id              || null,
    name:            item.name            || item.medicine_name || 'Medicine',
    quantity:        item.quantity        ?? item.qty           ?? 1,
    unit_price:      item.price           ?? item.selling_price ?? 0,
    total_price:     (item.quantity       ?? item.qty           ?? 1) * (item.price ?? item.selling_price ?? 0),
    commission_band: bandByMedicine[item.id] ?? null,
  }));

  const { data, error } = await supabase
    .from('order_items')
    .insert(orderItems);

  return { data, error };
};

// ── Fetch B2B orders for a retailer (buyerId = retailer seller UUID) ─
export const fetchB2BOrders = async (buyerId) => {
  if (!buyerId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), sellers!seller_id(store_name, phone)')
    .eq('buyer_id', buyerId)
    .eq('buyer_type', 'retailer')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
};

// ── Mark a delivered B2B order as received by the buying retailer ──
// Guarded with .eq('received_by_buyer', false) so the UPDATE only ever
// matches (and returns rows for) the first call — a double-click or
// duplicate request loses the guard and gets back an empty array, telling
// the caller not to run the inventory auto-add a second time.
export const markOrderReceived = async (orderId) => {
  const { data, error } = await supabase
    .from('orders')
    .update({ received_by_buyer: true })
    .eq('id', orderId)
    .eq('received_by_buyer', false)
    .select();
  return { data, error };
};

// ── Fetch orders for a specific customer (customerId required) ─
export const fetchOrders = async (customerId) => {
  if (!customerId) return { data: [], error: new Error('customerId is required') };

  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (*),
      sellers!seller_id (
        store_name,
        address,
        phone
      )
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  return { data: data || [], error };
};

// ── Fetch single order (UUID or order_number) ─────────────────
export const fetchOrderById = async (orderIdentifier) => {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdentifier);

  const sel = `*, order_items (*), sellers!seller_id (store_name, address, phone, district)`;

  if (isUUID) {
    const { data, error } = await supabase
      .from('orders').select(sel).eq('id', orderIdentifier).maybeSingle();
    if (data) return { data, error };
    // UUID se nahi mila — order_number se retry
    const { data: d2, error: e2 } = await supabase
      .from('orders').select(sel).eq('order_number', orderIdentifier).maybeSingle();
    return { data: d2, error: e2 };
  }

  const { data, error } = await supabase
    .from('orders').select(sel).eq('order_number', orderIdentifier).maybeSingle();
  return { data, error };
};

// ── Update order status ────────────────────────────────────────
export const updateOrderStatus = async (orderId, status) => {
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .select();

  return { data, error };
};

// ── Map DB order row → UI shape ────────────────────────────────
export function mapOrder(row) {
  const itemNames = (row.order_items || []).map((i) => i.name);
  const statusMap = {
    pending:           'processing',
    confirmed:         'processing',
    preparing:         'processing',
    out_for_delivery:  'processing',
    delivered:         'delivered',
    cancelled:         'cancelled',
  };
  const date = row.created_at
    ? new Date(row.created_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : '';

  return {
    id:             row.order_number || row.id,
    dbId:           row.id,
    status:         statusMap[row.status] || 'processing',
    date,
    store:          row.sellers?.store_name || 'Unknown Store',
    items:          itemNames.length ? itemNames : ['Order items'],
    amount:         parseFloat(row.final_amount) || 0,
    payment:        row.payment_method || 'cod',
    paymentDone:    row.payment_status === 'paid',
    isPrescription: !!row.prescription_url,
    refund:         row.status === 'cancelled' ? row.final_amount : null,
  };
}
