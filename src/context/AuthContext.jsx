import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getCurrentUser } from '../lib/auth';

const AuthContext = createContext({});

// ── Dev session helpers (sessionStorage) ──────────────────────
const DEV_KEY = 'medsetu_dev';

// Single source of truth for SuperAdmin identity — checked against the
// authenticated Supabase session email, independent of any localStorage flag
// (which Google OAuth logins bypass since the email isn't known pre-redirect).
export const SUPER_ADMIN_EMAIL = 'kv11081987m@gmail.com';

// Module-level (not React state) — a plain side-channel flag any file can set
// right before calling supabase.auth.signOut(), so the SIGNED_OUT handler
// below can tell a real, user-initiated logout apart from a spurious
// SIGNED_OUT that Supabase's client can emit on its own during a token-
// refresh hiccup (network blip, multi-tab session contention). Doesn't need
// to be a React ref since it isn't tied to a single component instance.
export const intentionalSignOut = { current: false };

export function setDevSession(phone, role) {
  sessionStorage.setItem(DEV_KEY, JSON.stringify({ phone, role }));
}

export function clearDevSession() {
  sessionStorage.removeItem(DEV_KEY);
}

function getDevSession() {
  try {
    return JSON.parse(sessionStorage.getItem(DEV_KEY) || 'null');
  } catch {
    return null;
  }
}

function getSavedRole() {
  return localStorage.getItem('medsetu_role') || getDevSession()?.role || 'customer';
}

// ── Provider ───────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user, setUser]             = useState(null);
  const [devSession, setDevSessionState] = useState(getDevSession);
  const [userRole, setUserRole]     = useState(getSavedRole);
  const [loading, setLoading]       = useState(true);
  const [authResolved, setAuthResolved] = useState(false);

  // When a user lands via OAuth redirect, the URL has ?code=... (PKCE) or
  // #access_token=... (implicit). Supabase fires INITIAL_SESSION with null
  // BEFORE exchanging the code, so we must wait for SIGNED_IN to resolve auth.
  const pendingOAuthRef = useRef(
    new URLSearchParams(window.location.search).has('code') ||
    window.location.hash.includes('access_token=')
  );
  const authResolvedRef = useRef(false);

  const markResolved = () => {
    if (!authResolvedRef.current) {
      authResolvedRef.current = true;
      setAuthResolved(true);
    }
  };

  useEffect(() => {
    // Initial user load — clear stale role if no real session exists
    getCurrentUser()
      .then((u) => {
        if (!u) {
          const dev = (() => { try { return JSON.parse(sessionStorage.getItem(DEV_KEY) || 'null'); } catch { return null; } })();
          if (!dev) {
            localStorage.removeItem('medsetu_role');
            localStorage.removeItem('medsetu_user');
          }
        }
        setUser(u);
        setLoading(false);
        // Only resolve here when not waiting for an OAuth code exchange
        if (!pendingOAuthRef.current) markResolved();
      })
      .catch(() => {
        setLoading(false);
        if (!pendingOAuthRef.current) markResolved();
      });

    // Listen for auth state changes (login / logout / magic link callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);

        if (event === 'SIGNED_OUT') {
          if (intentionalSignOut.current) {
            // Real logout (button click, staff-rejection kick-out) — full cleanup.
            intentionalSignOut.current = false;
            localStorage.removeItem('medsetu_user');
            localStorage.removeItem('medsetu_role');
            localStorage.removeItem('staff_pending_role');
          } else {
            // Spurious SIGNED_OUT nobody asked for — most likely Supabase's
            // client recovering from a token-refresh hiccup, about to fire a
            // fresh SIGNED_IN moments later. Do NOT wipe medsetu_role/
            // medsetu_user: ProtectedRoute's lsLoggedIn fallback (App.jsx)
            // needs medsetu_user intact to avoid a soft redirect to /login
            // during this window, and the SIGNED_IN guards below need
            // medsetu_role intact to recognize "same role, no redirect
            // needed" instead of hard-reloading like a fresh login.
            console.warn('[Auth] Unexpected SIGNED_OUT — preserving session state, likely to self-recover.');
          }
          markResolved();
          return;
        }

        // INITIAL_SESSION: resolve immediately unless we're mid-OAuth code exchange
        if (event === 'INITIAL_SESSION' && !pendingOAuthRef.current) {
          markResolved();
        }

        if (event === 'SIGNED_IN' && session) {
          const emailUser   = session.user;
          const pendingRole = localStorage.getItem('staff_pending_role');

          // ── -1. Phone-authenticated customer (Firebase bridge, L3) ──
          // A session minted by the firebase-bridge Edge Function has a
          // phone and no email — Firebase phone auth never sets one, and
          // staff/SuperAdmin only ever authenticate by email. So this can
          // only ever be a customer; handled first, with an early return,
          // so none of the email-oriented branches below ever see it.
          if (!emailUser.email && emailUser.phone) {
            // GoTrue actually reports phone WITHOUT a leading '+' (confirmed
            // live via firebase-bridge's own auth.users lookup bug — it's
            // "919999999999", not "+919999999999" or bare "9999999999").
            // The existing phone-login path (auth.js#createOrLoginUser) has
            // always stored bare 10-digit numbers in public.users.phone, so
            // normalize in two steps: strip a leading '+' if present (in
            // case GoTrue's behavior ever differs from what we observed),
            // then strip a leading '91' ONLY when that leaves exactly 10
            // digits — i.e. only a true country-code prefix on a 12-digit
            // value, never the first two digits of a genuine 10-digit
            // number (a real number can legitimately start with "91").
            let rawPhone = emailUser.phone.replace(/^\+/, '');
            if (rawPhone.length === 12 && rawPhone.startsWith('91')) {
              rawPhone = rawPhone.slice(2);
            }

            if (!localStorage.getItem('medsetu_role')) {
              localStorage.setItem('medsetu_role', 'customer');
              setUserRole('customer');
            }

            try {
              // Same atomic insert-or-skip pattern as the email branches below.
              await supabase
                .from('users')
                .upsert({ phone: rawPhone, role: 'customer', auth_id: emailUser.id }, { onConflict: 'phone', ignoreDuplicates: true });
              let { data: row } = await supabase
                .from('users').select('*').eq('phone', rawPhone).maybeSingle();

              // Same backfill as the email branches — ignoreDuplicates means
              // an existing pre-bridge row never gets auth_id from the upsert.
              if (row && !row.auth_id) {
                const { data: patched } = await supabase
                  .from('users').update({ auth_id: emailUser.id }).eq('id', row.id).select().maybeSingle();
                if (patched) row = patched;
              }

              if (row) localStorage.setItem('medsetu_user', JSON.stringify(row));
            } catch {}

            markResolved();
            const currentPath = window.location.pathname;
            const onAuthPage  = ['/login', '/', '/otp', '/onboarding', '/staff-login'].includes(currentPath);
            if (onAuthPage) window.location.href = '/home';
            return;
          }

          // ── 0. Super Admin — email is the source of truth ─────
          // Works regardless of entry point (Google OAuth, magic link, any
          // role tab) since it checks the authenticated session email
          // directly instead of relying on a localStorage flag that Google
          // OAuth never sets (email isn't known until after the redirect).
          if (emailUser.email === SUPER_ADMIN_EMAIL) {
            const alreadySuperAdmin = localStorage.getItem('medsetu_role') === 'super_admin';
            localStorage.setItem('medsetu_role', 'super_admin');
            localStorage.setItem('medsetu_user', JSON.stringify({ email: emailUser.email, role: 'super_admin', name: 'Kumar' }));
            localStorage.removeItem('staff_pending_role');
            setUserRole('super_admin');
            markResolved();
            // Only hard-redirect on a genuinely fresh sign-in. Supabase
            // re-fires SIGNED_IN for an already-active session (tab focus,
            // token refresh) — without this guard that repeat event forced
            // a full-page reload (blink) and yanked the SuperAdmin back to
            // /super-admin from wherever they currently were, every time.
            if (!alreadySuperAdmin) {
              window.location.href = '/super-admin';
            }
            return;
          }

          // ── 1. Super Admin via pendingRole (secondary safety path) ──
          if (pendingRole === 'super_admin') {
            localStorage.setItem('medsetu_role', 'super_admin');
            localStorage.setItem('medsetu_user', JSON.stringify({ email: emailUser.email, role: 'super_admin', name: 'Kumar' }));
            localStorage.removeItem('staff_pending_role');
            setUserRole('super_admin');
            markResolved();
            window.location.href = '/super-admin';
            return;
          }

          // ── 2. Staff role — pendingRole se ya whitelist fallback ──
          // pendingRole missing = magic link was opened in a different browser,
          // so we check staff_whitelist directly as a fallback.
          let staffRole = (pendingRole && pendingRole !== 'customer') ? pendingRole : null;

          if (!staffRole) {
            // Whitelist fallback: email se role uthao
            try {
              const { data: wl } = await supabase
                .from('staff_whitelist')
                .select('role')
                .eq('email', emailUser.email)
                .eq('is_approved', true)
                .maybeSingle();
              if (wl?.role) staffRole = wl.role;
            } catch {}
          } else if (staffRole === 'seller' || staffRole === 'pharmacist' || staffRole === 'admin') {
            // pendingRole set hai — verify whitelist approval
            const { data: wl } = await supabase
              .from('staff_whitelist')
              .select('*')
              .eq('email', emailUser.email)
              .eq('role', staffRole)
              .eq('is_approved', true)
              .maybeSingle();
            if (!wl) {
              intentionalSignOut.current = true;
              await supabase.auth.signOut();
              localStorage.removeItem('staff_pending_role');
              markResolved();
              alert('❌ Aapka account approved nahi hai.\n\nPehle registration form bharke approval ka wait karo.');
              window.location.href = '/staff-login';
              return;
            }
          }

          if (staffRole && staffRole !== 'customer') {
            const alreadyThisRole = localStorage.getItem('medsetu_role') === staffRole;
            localStorage.setItem('medsetu_role', staffRole);
            localStorage.removeItem('staff_pending_role');
            setUserRole(staffRole);

            try {
              // Atomic insert-or-skip on email (requires UNIQUE constraint on
              // users.email) — avoids the check-then-insert race that created
              // duplicate rows when SIGNED_IN fired more than once.
              const { error: upsertErr } = await supabase
                .from('users')
                .upsert(
                  { email: emailUser.email, name: emailUser.user_metadata?.full_name || null, role: staffRole, phone: null, auth_id: emailUser.id },
                  { onConflict: 'email', ignoreDuplicates: true }
                );
              if (upsertErr) console.error('[AuthContext] users upsert failed:', upsertErr);
              let { data: row } = await supabase
                .from('users').select('*').eq('email', emailUser.email).maybeSingle();

              // ignoreDuplicates skips the insert entirely when the row
              // already existed (pre-Phase-0 row, or a repeat login) — patch
              // auth_id in now so it doesn't stay NULL forever.
              if (row && !row.auth_id) {
                const { data: patched } = await supabase
                  .from('users').update({ auth_id: emailUser.id }).eq('id', row.id).select().maybeSingle();
                if (patched) row = patched;
              }

              if (row) localStorage.setItem('medsetu_user', JSON.stringify(row));

              // sellers.user_id can only ever be linked once we know this
              // seller's own users.id — approval (SuperAdminPanel) happens
              // before they've ever logged in, so this is the first reliable
              // point it can be done. Backfills existing pre-Phase-0 rows too.
              if (staffRole === 'seller' && row?.email) {
                try {
                  const { data: sellerRow } = await supabase
                    .from('sellers')
                    .select('id')
                    .eq('email', row.email)
                    .is('user_id', null)
                    .maybeSingle();
                  if (sellerRow) {
                    await supabase.from('sellers').update({ user_id: row.id }).eq('id', sellerRow.id);
                  }
                } catch (e) {
                  console.error('[AuthContext] sellers.user_id backfill error:', e);
                }
              }
            } catch (e) {
              console.error('[AuthContext] users lookup/insert error:', e);
            }

            markResolved();
            // Same guard as the SuperAdmin branch above — this is the exact
            // path that caused Inventory→Home: the whitelist fallback above
            // re-resolves staffRole on every SIGNED_IN (including repeat
            // events from tab focus / token refresh, not just fresh logins),
            // and this used to redirect unconditionally every time.
            if (!alreadyThisRole) {
              const routes = { admin: '/admin', pharmacist: '/pharmacist', seller: '/seller-dashboard', super_admin: '/super-admin' };
              window.location.href = routes[staffRole] || '/home';
            }
            return;
          }

          // ── 3. Customer magic link login ──────────────────────
          const savedRole = localStorage.getItem('medsetu_role');
          if (!savedRole) {
            localStorage.setItem('medsetu_role', 'customer');
            setUserRole('customer');
          }
          try {
            // Same atomic insert-or-skip pattern as the staff branch above.
            await supabase
              .from('users')
              .upsert({ email: emailUser.email, role: 'customer', auth_id: emailUser.id }, { onConflict: 'email', ignoreDuplicates: true });
            let { data: row } = await supabase
              .from('users').select('*').eq('email', emailUser.email).maybeSingle();

            // Same backfill as the staff branch — ignoreDuplicates means an
            // existing pre-Phase-0 row never gets auth_id from the upsert.
            if (row && !row.auth_id) {
              const { data: patched } = await supabase
                .from('users').update({ auth_id: emailUser.id }).eq('id', row.id).select().maybeSingle();
              if (patched) row = patched;
            }

            if (row) localStorage.setItem('medsetu_user', JSON.stringify(row));
          } catch {}

          markResolved();
          const currentPath = window.location.pathname;
          const onAuthPage  = ['/login', '/', '/otp', '/onboarding', '/staff-login'].includes(currentPath);
          if (onAuthPage) window.location.href = '/home';
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Combined: real Supabase user OR dev bypass session
  const isAuthenticated = !!user || !!devSession;

  const applyDevSession = (phone, role) => {
    setDevSession(phone, role);
    setDevSessionState({ phone, role });
    setUserRole(role);
  };

  const handleLogout = async () => {
    intentionalSignOut.current = true;
    clearDevSession();
    setDevSessionState(null);
    localStorage.removeItem('medsetu_role');
    localStorage.removeItem('medsetu_user');
    localStorage.removeItem('staff_pending_role');
    await supabase.auth.signOut().catch(() => {});
    setUser(null);
    setUserRole('customer');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        devSession,
        isAuthenticated,
        userRole,
        setUserRole,
        loading,
        authResolved,
        applyDevSession,
        handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
