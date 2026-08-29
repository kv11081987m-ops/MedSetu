import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Supabase env vars missing: VITE_SUPABASE_URL aur VITE_SUPABASE_ANON_KEY set karo'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true, // Google/email (admin+staff) sessions need supabase-js auto-refresh. Phone sessions stay fresh via the Firebase re-bridge timer (~5 min before expiry, ahead of supabase-js's ~90s window), so the phone placeholder refresh token is never exercised.
    detectSessionInUrl: true,
  },
});
