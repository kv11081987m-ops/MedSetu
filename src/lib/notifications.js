import { supabase } from './supabase';
import { formatIST } from './formatTime';

// Notification creation goes through the create_notification() SECURITY
// DEFINER RPC (019_notificationRpcV2.sql) — it resolves the recipient
// itself, server-side, from the referenced order's parties. Recipient
// resolution used to happen client-side here (getSellerUserId /
// getOrderRecipientUserId), but that required reading a DIFFERENT
// person's users row, which 014_rlsPhase5a.sql's users SELECT policy
// blocks for any non-owning, non-staff session — i.e. every real
// caller. Both functions were removed once the RPC took over resolving
// this itself (call sites now just pass p_title/p_body/p_type/p_ref_id).

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
  formatIST(dateString, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
