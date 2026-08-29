import { supabase } from './supabase'

// Mints a fresh Supabase session from a persistent Firebase user.
// Used by initial OTP login AND by the background re-bridge/refresh.
export async function bridgeFirebaseToSupabase(firebaseUser) {
  if (!firebaseUser) throw new Error('No Firebase user to bridge')
  const idToken = await firebaseUser.getIdToken() // Firebase auto-refreshes if near expiry
  const { data, error } = await supabase.functions.invoke('firebase-bridge', {
    body: { idToken },
  })
  if (error || !data?.access_token) {
    throw new Error(error?.message || 'Session bridge failed')
  }
  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: 'firebase-bridge-session', // placeholder; real refresh is the Firebase re-bridge
  })
  if (sessionErr) throw sessionErr
  return data // { access_token, expires_in, user_id }
}
