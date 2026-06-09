import { supabase } from './supabase';

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
