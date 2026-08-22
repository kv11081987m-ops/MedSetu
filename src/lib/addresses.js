import { supabase } from './supabase';

// A3b: DB-write core extracted out of UserProfile.jsx's addAddress() so
// Checkout.jsx (A4+) can call the exact same writes instead of a second
// copy. Pure DB calls only — no UI/state, callers own their own local
// state updates and refresh logic (same split as lib/auth.js's
// updateUserPhone/isDuplicatePhoneError).

// ── Insert a new address ────────────────────────────────────────
// `address` should already include is_default — the caller decides that
// (e.g. UserProfile.jsx's "first address ever becomes default" rule),
// this helper just writes whatever it's given.
export const saveAddress = async ({ userId, address }) => {
  const { data, error } = await supabase
    .from('addresses')
    .insert({ user_id: userId, ...address })
    .select();
  return { data: data?.[0] || null, error };
};

// ── Edit an existing address ────────────────────────────────────
// Never touches is_default — same as before this helper existed, editing
// an address's other fields has never changed which address is default.
export const updateAddress = async ({ addressId, address }) => {
  const { error } = await supabase
    .from('addresses')
    .update(address)
    .eq('id', addressId);
  return { error };
};

// ── Set an address as default (038_setDefaultAddress.sql's RPC) ──
// Atomic — unsets the user's current default and sets this one inside a
// single DB transaction, so there's never a window with zero or two
// defaults. Passes the RPC's own {success, message} shape straight
// through; only wraps a transport-level error (RPC didn't run at all)
// into that same shape so callers only ever need to check `.success`.
export const setDefaultAddress = async (addressId) => {
  const { data, error } = await supabase.rpc('set_default_address', { p_address_id: addressId });
  if (error) return { success: false, message: error.message };
  return data;
};
