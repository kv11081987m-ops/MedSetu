import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Supabase env vars missing: VITE_SUPABASE_URL aur VITE_SUPABASE_ANON_KEY set karo'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
