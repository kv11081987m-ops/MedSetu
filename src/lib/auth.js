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
