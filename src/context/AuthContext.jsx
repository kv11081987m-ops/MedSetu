import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getCurrentUser } from '../lib/auth';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { bridgeFirebaseToSupabase } from '../lib/session';

const AuthContext = createContext({});

// ── Dev session helpers (sessionStorage) ──────────────────────
const DEV_KEY = 'medsetu_dev';

// Re-bridge the Firebase session into a fresh Supabase one this many seconds
// before the current 1-hour firebase-bridge token expires.
const REBRIDGE_MARGIN_SEC = 300;

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

  // Background re-bridge state — see the init useEffect below.
  const refreshTimerRef = useRef(null);
  // undefined = not checked yet, null = checked and no user, object = user present.
  // Used to gate the "clear stale localStorage" cleanup on BOTH Supabase and
  // Firebase confirming logged-out, so a phone-OTP user whose 1hr Supabase
  // token already expired doesn't get flashed to /login while the Firebase
  // re-bridge (still valid, persisted) is about to restore their session.
  const supabaseUserRef = useRef(undefined);
  const firebaseUserRef = useRef(undefined);

  // H4: time this provider mounted — our "last known-good session" marker.
  // A medsetu_logout_at newer than this means a logout fired elsewhere
  // (another tab) after we established our session, so ours is stale too.
  // Stamped at the top of the mount effect below (Date.now() can't run in
  // render); re-baselined on every fresh SIGNED_IN/INITIAL_SESSION so a
  // logout-then-login in the same tab doesn't kill the new session.
  const mountedAtRef = useRef(0);

  const markResolved = () => {
    if (!authResolvedRef.current) {
      authResolvedRef.current = true;
      setAuthResolved(true);
    }
  };

  // ── H4 cross-tab logout safety-net ─────────────────────────────
  // One teardown for every logout path: the button (handleLogout), the
  // staff-rejection kick-out (SIGNED_OUT-intentional branch), and a
  // logout that happened in ANOTHER tab and reached us via the storage
  // event below. Replaces three copy-pasted removeItem triplets.
  const clearLocalSession = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    // end the persistent Firebase session so re-bridge can't silently log back in
    firebaseSignOut(auth).catch((e) => console.warn('[Auth] Firebase signOut failed', e));
    localStorage.removeItem('medsetu_user');
    localStorage.removeItem('medsetu_role');
    localStorage.removeItem('staff_pending_role');
    localStorage.removeItem('pharmacist_available');
    setUser(null);
    setUserRole('customer');
  };

  const isLoggedOutElsewhere = () =>
    Number(localStorage.getItem('medsetu_logout_at')) > mountedAtRef.current;

  useEffect(() => {
    // H4: stamp mount time here — this is the baseline every cross-tab
    // logout check compares against (see isLoggedOutElsewhere / onStorage).
    mountedAtRef.current = Date.now();

    // Initial user load. The stale-role/user cleanup only runs once BOTH
    // Supabase AND Firebase have reported "no user" (see refs above) — a
    // phone-OTP user's Supabase access token can already be expired at this
    // point while their Firebase session (persisted, long-lived) is still
    // alive and about to be re-bridged, so clearing on Supabase alone would
    // flash them to a logged-out state for no reason.
    const maybeCleanupStaleSession = () => {
      if (supabaseUserRef.current === undefined) return;
      if (firebaseUserRef.current === undefined) return;
      if (supabaseUserRef.current || firebaseUserRef.current) return;
      const dev = (() => { try { return JSON.parse(sessionStorage.getItem(DEV_KEY) || 'null'); } catch { return null; } })();
      if (!dev) {
        localStorage.removeItem('medsetu_role');
        localStorage.removeItem('medsetu_user');
      }
    };

    getCurrentUser()
      .then((u) => {
        supabaseUserRef.current = u || null;
        setUser(u);
        setLoading(false);
        // Only resolve here when not waiting for an OAuth code exchange
        if (!pendingOAuthRef.current) markResolved();
        maybeCleanupStaleSession();
      })
      .catch(() => {
        supabaseUserRef.current = null;
        setLoading(false);
        if (!pendingOAuthRef.current) markResolved();
        maybeCleanupStaleSession();
      });

    // A Supabase session that carries an email is a Google/email login,
    // which supabase-js auto-refreshes on its own. The Firebase re-bridge
    // is only for phone-origin sessions (no email claim).
    const isEmailSession = (session) => !!session?.user?.email;

    // Schedules the next silent re-bridge ~5 min before the current
    // firebase-bridge access token (1hr TTL, unchanged) expires.
    const scheduleRebridge = (expiresAtSec) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (!expiresAtSec) return;
      const fireInMs = Math.max(1000, (expiresAtSec - REBRIDGE_MARGIN_SEC) * 1000 - Date.now());
      refreshTimerRef.current = setTimeout(doRebridge, fireInMs);
    };

    const doRebridge = async () => {
      // H4: don't silently re-establish a session that was logged out elsewhere.
      if (isLoggedOutElsewhere()) { clearLocalSession(); return; }
      const fbUser = auth.currentUser;
      if (!fbUser) return; // Firebase itself is logged out — nothing to refresh
      const { data: { session } } = await supabase.auth.getSession();
      if (isEmailSession(session)) return; // Google/email session — supabase-js refreshes this itself
      try {
        await bridgeFirebaseToSupabase(fbUser); // setSession → fires onAuthStateChange → reschedules
      } catch (e) {
        console.warn('[Auth] Re-bridge failed; will retry on next app focus', e);
      }
    };

    // Firebase's persisted session is the long-lived side of a phone-OTP
    // login. This listener drives the startup re-bridge (Supabase's own
    // 1hr token may already be gone by the time this fires) without
    // touching any of the role-resolution logic below — a successful
    // bridgeFirebaseToSupabase() call just calls setSession(), which fires
    // the existing supabase.auth.onAuthStateChange handler as SIGNED_IN,
    // same as a fresh OTP login.
    const fbUnsub = onAuthStateChanged(auth, async (fbUser) => {
      firebaseUserRef.current = fbUser || null;
      maybeCleanupStaleSession();

      if (!fbUser) return;
      // H4: don't re-bridge into a session that was logged out elsewhere.
      if (isLoggedOutElsewhere()) { clearLocalSession(); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (isEmailSession(session)) return; // Google/email session — supabase-js refreshes this itself
      const nowSec = Math.floor(Date.now() / 1000);
      const needsBridge = !session || (session.expires_at && session.expires_at - nowSec < REBRIDGE_MARGIN_SEC);
      if (needsBridge) {
        try {
          await bridgeFirebaseToSupabase(fbUser);
        } catch (e) {
          console.warn('[Auth] Startup re-bridge failed', e);
        }
      } else {
        scheduleRebridge(session.expires_at);
      }
    });

    // Re-bridge on foreground return if the token is near/past expiry — a
    // backgrounded tab's setTimeout above can be throttled or suspended, so
    // this is the fallback for whenever the user actually comes back.
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const fbUser = auth.currentUser;
      if (!fbUser) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (isEmailSession(session)) return; // Google/email session — supabase-js refreshes this itself
      const nowSec = Math.floor(Date.now() / 1000);
      if (!session || (session.expires_at && session.expires_at - nowSec < REBRIDGE_MARGIN_SEC)) {
        doRebridge();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // ── H4: cross-tab logout ──────────────────────────────────────
    // Another tab writing medsetu_logout_at (logout button or staff
    // kick-out) fires this in every OTHER tab. A timestamp newer than
    // our mount means our session is stale too — tear it down locally.
    // The > mountedAtRef check stops an older logout stamp still sitting
    // in localStorage from killing a fresh login in this tab.
    const onStorage = (e) => {
      if (e.key !== 'medsetu_logout_at' || !e.newValue) return;
      if (Number(e.newValue) > mountedAtRef.current) clearLocalSession();
    };
    window.addEventListener('storage', onStorage);

    // Listen for auth state changes (login / logout / magic link callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);

        // Keep the background re-bridge timer in sync with whatever session
        // Supabase just reported (fresh login, tab-focus re-check, or its
        // own TOKEN_REFRESHED) — a no-op whenever there's no session.
        if (session?.expires_at) scheduleRebridge(session.expires_at);

        if (event === 'SIGNED_OUT') {
          if (intentionalSignOut.current) {
            // Real logout (button click, staff-rejection kick-out) — full cleanup.
            intentionalSignOut.current = false;
            // H4: broadcast to other tabs (picked up by the storage listener).
            localStorage.setItem('medsetu_logout_at', String(Date.now()));
            clearLocalSession();
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

        // INITIAL_SESSION with no session yet — resolve immediately unless
        // we're mid-OAuth code exchange (waiting for the real session).
        if (event === 'INITIAL_SESSION' && !session && !pendingOAuthRef.current) {
          markResolved();
        }

        // INITIAL_SESSION can also arrive WITH an already-valid session —
        // confirmed live via [DIAG] logs: when the OAuth code exchange
        // finishes before this listener attaches, Supabase reports the
        // already-established session as INITIAL_SESSION, never SIGNED_IN.
        // Role-resolution used to be SIGNED_IN-only, so that session's role
        // never got resolved — userRole silently fell back to the
        // 'customer' default from getSavedRole() at mount (the SuperAdmin
        // regression). Route INITIAL_SESSION-with-session through the exact
        // same resolution as SIGNED_IN: every branch below already has an
        // "already X" guard (alreadySuperAdmin / alreadyThisRole / savedRole
        // already-set) built for repeat SIGNED_IN events (tab focus, token
        // refresh), so a normal reload with already-correct localStorage
        // state still redirects nowhere and does nothing extra — only a
        // session/localStorage mismatch (today's bug) now actually resolves.
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
          // H4: a real, current session — drop any stale cross-tab logout
          // marker and re-baseline our known-good time so the storage
          // listener and re-bridge guards don't kill THIS session (e.g.
          // logout-then-login in the same tab).
          localStorage.removeItem('medsetu_logout_at');
          mountedAtRef.current = Date.now();

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
            // super_admin owns two routes, not just /super-admin (see
            // App.jsx SuperAdminRoute) — either one counts as "already there".
            const alreadyOnOwnRoute = ['/super-admin', '/medicine-import'].includes(window.location.pathname);
            localStorage.setItem('medsetu_role', 'super_admin');
            localStorage.setItem('medsetu_user', JSON.stringify({ email: emailUser.email, role: 'super_admin', name: 'Kumar' }));
            localStorage.removeItem('staff_pending_role');
            setUserRole('super_admin');
            markResolved();
            // Only hard-redirect on a genuinely fresh sign-in. alreadySuperAdmin
            // (localStorage-based) was the original guard, built for repeat
            // SIGNED_IN events (tab focus, token refresh). Now that
            // INITIAL_SESSION-with-session also runs this same resolution (see
            // the L4.1 fix above), it fires on every plain page load while a
            // session is valid — INCLUDING the reload this very redirect
            // causes — and [DIAG] showed alreadySuperAdmin still reading false
            // on that fresh reload, turning one redirect into an infinite
            // loop. alreadyOnOwnRoute checks the browser's actual current path
            // directly, which can never be wrong about where we already are,
            // regardless of what localStorage says — added as a second,
            // independent guard so either one blocks the redirect.
            if (!alreadySuperAdmin && !alreadyOnOwnRoute) {
              window.location.href = '/super-admin';
            }
            return;
          }

          // ── 1. Super Admin via pendingRole (secondary safety path) ──
          if (pendingRole === 'super_admin') {
            const alreadyOnOwnRoute = ['/super-admin', '/medicine-import'].includes(window.location.pathname);
            localStorage.setItem('medsetu_role', 'super_admin');
            localStorage.setItem('medsetu_user', JSON.stringify({ email: emailUser.email, role: 'super_admin', name: 'Kumar' }));
            localStorage.removeItem('staff_pending_role');
            setUserRole('super_admin');
            markResolved();
            if (!alreadyOnOwnRoute) {
              window.location.href = '/super-admin';
            }
            return;
          }

          // ── 2. Staff role — pendingRole se ya whitelist fallback ──
          // pendingRole missing = magic link was opened in a different browser,
          // so we check staff_whitelist directly as a fallback.
          let staffRole = (pendingRole && pendingRole !== 'customer') ? pendingRole : null;

          if (!staffRole) {
            // Whitelist fallback: email se role uthao. Row ho par
            // is_approved false ho, to yeh customer branch mein chupchaap
            // gir jaata tha (is_approved=true filter dono cases mein — row
            // hi nahi, ya row hai par unapproved — same null deta hai).
            // Do-step check taaki dono case alag pehchaane jaayein: row
            // exist karta hai to reject karo saaf message ke saath; row
            // hai hi nahi to hi customer flow chale (unchanged).
            try {
              const { data: wl } = await supabase
                .from('staff_whitelist')
                .select('role, is_approved')
                .eq('email', emailUser.email)
                .maybeSingle();
              if (wl) {
                if (wl.is_approved) {
                  staffRole = wl.role;
                } else {
                  intentionalSignOut.current = true;
                  await supabase.auth.signOut();
                  localStorage.removeItem('staff_pending_role');
                  markResolved();
                  alert('⏳ Aapka account abhi approval pending hai.\n\nSuperAdmin approval ka wait karo, phir dobara login karo.');
                  window.location.href = '/login';
                  return;
                }
              }
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
            const ROLE_OWN_ROUTES = {
              seller:     ['/seller-dashboard', '/inventory', '/wholesalers', '/wholesaler-inventory', '/b2b-checkout'],
              pharmacist: ['/pharmacist'],
              admin:      ['/admin'],
            };
            const alreadyOnOwnRoute = (ROLE_OWN_ROUTES[staffRole] || []).includes(window.location.pathname);
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
            // and this used to redirect unconditionally every time. Now that
            // INITIAL_SESSION-with-session also runs this same resolution,
            // alreadyThisRole (localStorage) is joined by alreadyOnOwnRoute
            // (actual browser path) as a second, race-immune guard — see the
            // SuperAdmin branch above for why the path check was necessary.
            if (!alreadyThisRole && !alreadyOnOwnRoute) {
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

    return () => {
      subscription.unsubscribe();
      fbUnsub();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
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
    // H4: broadcast to other tabs (picked up by the storage listener).
    localStorage.setItem('medsetu_logout_at', String(Date.now()));
    clearDevSession();
    setDevSessionState(null);
    clearLocalSession();
    await supabase.auth.signOut().catch(() => {});
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
