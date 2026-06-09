import { supabase } from './supabase';

export async function testSupabaseConnection() {
  try {
    // Lightweight ping — fetch session (no DB query needed)
    const { error } = await supabase.auth.getSession();

    if (error) {
      console.error('❌ Supabase connection failed:', error.message);
      return false;
    }

    console.log(
      '%c✅ Supabase Connected!',
      'color: #1A6B3C; font-weight: bold; font-size: 14px;'
    );
    console.log('   URL:', import.meta.env.VITE_SUPABASE_URL);
    return true;
  } catch (err) {
    console.error('❌ Supabase connection error:', err.message);
    return false;
  }
}
