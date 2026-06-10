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
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (existing) {
    localStorage.setItem('medsetu_user', JSON.stringify(existing));
    return existing;
  }

  const { data: newUser } = await supabase
    .from('users')
    .insert({ phone, role: 'customer' })
    .select()
    .single();

  localStorage.setItem('medsetu_user', JSON.stringify(newUser));
  return newUser;
};

export const sendOTP = async (phone) => {
  const { data, error } = await supabase.auth.signInWithOtp({
    phone: '+91' + phone,
  });
  return { data, error };
};

export const verifyOTP = async (phone, otp) => {
  const { data, error } = await supabase.auth.verifyOtp({
    phone: '+91' + phone,
    token: otp,
    type: 'sms',
  });
  return { data, error };
};

export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

export const logout = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const sendEmailOTP = async (email) => {
  const { data, error } = await supabase.auth.signInWithOtp({
    email: email,
    options: {
      emailRedirectTo: window.location.origin + '/home',
    },
  });
  return { data, error };
};

export const onAuthStateChange = (callback) => {
  return supabase.auth.onAuthStateChange(callback);
};
