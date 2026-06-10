import { supabase } from './supabase';

// ── Create order ───────────────────────────────────────────────
export const createOrder = async (orderData) => {
  const orderNumber = 'MED-' + Date.now();

  const { data, error } = await supabase
    .from('orders')
    .insert({
      order_number:     orderNumber,
      customer_id:      orderData.customerId   || null,
      seller_id:        orderData.sellerId      || null,
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

  return { data, error };
};

// ── Create order items ─────────────────────────────────────────
// Maps cart items → order_items schema (name, unit_price, total_price)
export const createOrderItems = async (orderId, items) => {
  const orderItems = items.map((item) => ({
    order_id:      orderId,
    medicine_id:   item.id              || null,
    medicine_name: item.name            || item.medicine_name || 'Medicine',
    name:          item.name            || item.medicine_name || 'Medicine',
    quantity:      item.quantity        ?? item.qty           ?? 1,
    unit_price:    item.price           ?? item.selling_price ?? 0,
    total_price:   (item.quantity       ?? item.qty           ?? 1) * (item.price ?? item.selling_price ?? 0),
  }));

  const { data, error } = await supabase
    .from('order_items')
    .insert(orderItems);

  return { data, error };
};

// ── Fetch all orders (for order history) ──────────────────────
export const fetchOrders = async (customerId = null) => {
  let query = supabase
    .from('orders')
    .select(`
      *,
      order_items (*),
      sellers (
        store_name,
        address,
        phone
      )
    `)
    .order('created_at', { ascending: false });

  if (customerId) query = query.eq('customer_id', customerId);

  const { data, error } = await query;
  return { data: data || [], error };
};

// ── Fetch single order ─────────────────────────────────────────
export const fetchOrderById = async (orderId) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (*),
      sellers (
        store_name,
        address,
        phone,
        district
      )
    `)
    .eq('id', orderId)
    .single();

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
