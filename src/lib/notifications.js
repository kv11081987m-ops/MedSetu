import { supabase } from './supabase';

// Notifications are secondary to the order flow — a failure here must never
// block accept/deliver/cancel/place. Every call swallows its own errors.
export const createNotification = async (userId, title, message, type, orderId = null) => {
  if (!userId) return;
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, title, body: message, type, ref_id: orderId, is_read: false });
    if (error) console.warn('[createNotification]', error.message);
  } catch (err) {
    console.warn('[createNotification]', err.message);
  }
};

// sellers.user_id exists in the schema but isn't populated by the current
// registration flow (every live seller row has user_id = null) — so a
// seller/wholesaler resolves to their own login the same way
// auth.js#getCurrentSeller does it in reverse: match phone (then email)
// against users.
export const getSellerUserId = async (sellerId) => {
  if (!sellerId) return null;
  try {
    const { data: seller } = await supabase
      .from('sellers').select('phone, email').eq('id', sellerId).maybeSingle();
    if (!seller) return null;

    if (seller.phone) {
      const { data: u } = await supabase.from('users').select('id').eq('phone', seller.phone).maybeSingle();
      if (u) return u.id;
    }
    if (seller.email) {
      const { data: u } = await supabase.from('users').select('id').eq('email', seller.email).maybeSingle();
      if (u) return u.id;
    }
    return null;
  } catch (err) {
    console.warn('[getSellerUserId]', err.message);
    return null;
  }
};

// The "other side" of an order: the customer for a normal B2C order, or the
// buying retailer (as a user) for a B2B order — same buyer_type/buyer_id
// convention orders.js already uses.
export const getOrderRecipientUserId = async (order) => {
  if (order.buyer_type === 'retailer' && order.buyer_id) {
    return getSellerUserId(order.buyer_id);
  }
  return order.customer_id || null;
};

// ── Phase 2: bell display ──────────────────────────────────────
export const fetchUserNotifications = async (userId, limit = 20) => {
  if (!userId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
};

export const markNotificationRead = async (notificationId) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
  return { error };
};

export const markAllNotificationsRead = async (userId) => {
  if (!userId) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  return { error };
};

// "30 Jun, 2:30 pm"
export const formatNotifTime = (dateString) =>
  new Date(dateString).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
