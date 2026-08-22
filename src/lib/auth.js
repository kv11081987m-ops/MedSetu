import { supabase } from './supabase';

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const storeOTP = (phone, otp) => {
  sessionStorage.setItem(
    'medsetu_otp',
    JSON.stringify({ phone, otp, expiry: Date.now() + 300000 })
  );
};

export const verifyStoredOTP = (phone, enteredOTP) => {
  const stored = JSON.parse(sessionStorage.getItem('medsetu_otp') || '{}');

  if (!stored.otp)        return { valid: false, message: 'OTP nahi mila' };
  if (Date.now() > stored.expiry) return { valid: false, message: 'OTP expire ho gaya' };
  if (stored.phone !== phone)     return { valid: false, message: 'Number match nahi kiya' };
  if (stored.otp !== enteredOTP)  return { valid: false, message: 'Galat OTP hai' };

  sessionStorage.removeItem('medsetu_otp');
  return { valid: true };
};

export const createOrLoginUser = async (phone) => {
  // Atomic insert-or-skip on phone (requires UNIQUE constraint on
  // users.phone) — avoids the check-then-insert race that let duplicate
  // rows through when this ran more than once for the same user.
  const { error: upsertErr } = await supabase
    .from('users')
    .upsert({ phone, role: 'customer' }, { onConflict: 'phone', ignoreDuplicates: true });
  if (upsertErr) throw upsertErr;

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (!user) throw new Error('User create nahi hua');
  localStorage.setItem('medsetu_user', JSON.stringify(user));
  return user;
};

export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

// Shared phone-update — same shape as UserProfile.jsx's updateProfile()
// uses for the phone field, extracted so Checkout.jsx's mandatory-mobile
// prompt can call the exact same DB write instead of duplicating it.
export const updateUserPhone = async (userId, phone) => {
  if (!userId) return { error: new Error('userId missing') };
  const { error } = await supabase.from('users').update({ phone }).eq('id', userId);
  return { error };
};

// Shared duplicate-phone detection — users.phone has a UNIQUE constraint
// (users_phone_key), and PostgREST reports a violation of it
// inconsistently: sometimes the Postgres SQLSTATE ('23505') lands in
// error.code, sometimes it's just a plain HTTP 409 (error.status, or
// error.code as a stringified '409') with the real reason only in the
// message/details text. Checked here once so Checkout.jsx's mandatory-
// mobile prompt and UserProfile.jsx's profile-edit save recognize the
// exact same set of shapes instead of two copies of this list drifting
// apart.
export const isDuplicatePhoneError = (error) => {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  return (
    error.code === '23505' ||
    error.status === 409 ||
    error.code === '409' ||
    msg.includes('duplicate') ||
    msg.includes('unique') ||
    msg.includes('already exists') ||
    msg.includes('conflict') ||
    msg.includes('phone')
  );
};

export const logout = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const onAuthStateChange = (callback) => {
  return supabase.auth.onAuthStateChange(callback);
};

export const getCurrentSeller = async () => {
  try {
    const user = JSON.parse(localStorage.getItem('medsetu_user') || '{}');

    if (user?.phone) {
      const { data } = await supabase
        .from('sellers')
        .select('*')
        .eq('phone', user.phone)
        .maybeSingle();
      if (data) return data;
    }

    if (user?.email) {
      const { data } = await supabase
        .from('sellers')
        .select('*')
        .eq('email', user.email)
        .maybeSingle();
      if (data) return data;
    }

    // Dev fallback — only in dev mode, return null in production
    if (!import.meta.env.DEV) return null;
    const { data: fallback } = await supabase
      .from('sellers')
      .select('*')
      .limit(1)
      .maybeSingle();
    return fallback || null;
  } catch {
    return null;
  }
};
