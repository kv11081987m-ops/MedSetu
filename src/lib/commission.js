import { supabase } from './supabase';

// ── Shared commission-approval logic — used by both SuperAdminPanel
// (always allowed) and AdminPanel (only when delegated). Keeping the actual
// DB reads/writes here means both panels stay in sync automatically instead
// of each carrying its own copy of the same approve/reject rules.

// ── Every seller with a pending commission change request ─────
export const fetchPendingCommissionRequests = async () => {
  const { data, error } = await supabase
    .from('sellers')
    .select('id, store_name, seller_type, commission_pending_mode, commission_pending_rate')
    .eq('commission_status', 'pending')
    .order('store_name');
  return { data: data || [], error };
};

// ── Approve — pending_* becomes the live mode/rate ─────────────
export const approveCommissionRequest = async (sellerId, pendingMode, pendingRate) => {
  const { error } = await supabase
    .from('sellers')
    .update({
      commission_mode:         pendingMode,
      commission_flat_rate:    pendingMode === 'flat' ? pendingRate : null,
      commission_status:       'active',
      commission_pending_mode: null,
      commission_pending_rate: null,
    })
    .eq('id', sellerId);
  return { error };
};

// ── Reject — clear the pending fields, live mode/rate untouched ─
export const rejectCommissionRequest = async (sellerId) => {
  const { error } = await supabase
    .from('sellers')
    .update({ commission_status: 'active', commission_pending_mode: null, commission_pending_rate: null })
    .eq('id', sellerId);
  return { error };
};

// ── Platform-level: has SuperAdmin delegated approval to 'admin' role? ──
export const fetchCommissionDelegation = async () => {
  const { data } = await supabase
    .from('platform_settings')
    .select('commission_approval_delegated_to_admin')
    .eq('id', 1)
    .maybeSingle();
  return data?.commission_approval_delegated_to_admin || false;
};
