import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getCurrentUser } from '../lib/auth';

const AuthContext = createContext({});

// ── Dev session helpers (sessionStorage) ──────────────────────
const DEV_KEY = 'medsetu_dev';

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
  const [user, setUser]       = useState(null);
  const [devSession, setDevSessionState] = useState(getDevSession);
  const [userRole, setUserRole] = useState(getSavedRole);
  const [loading, setLoading]  = useState(true);

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
      })
      .catch(() => {
        setLoading(false);
      });

    // Listen for auth state changes (login / logout / magic link callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);

        if (event === 'SIGNED_OUT') {
          localStorage.removeItem('medsetu_user');
          localStorage.removeItem('medsetu_role');
          localStorage.removeItem('staff_pending_role');
          return;
        }

        if (event === 'SIGNED_IN' && session) {
          const emailUser   = session.user;
          const pendingRole = localStorage.getItem('staff_pending_role');

          // ── 1. Super Admin ────────────────────────────────────
          if (pendingRole === 'super_admin') {
            localStorage.setItem('medsetu_role', 'super_admin');
            localStorage.setItem('medsetu_user', JSON.stringify({ email: emailUser.email, role: 'super_admin', name: 'Kumar' }));
            localStorage.removeItem('staff_pending_role');
            setUserRole('super_admin');
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
          } else if (staffRole === 'seller' || staffRole === 'pharmacist') {
            // pendingRole set hai — verify whitelist approval
            const { data: wl } = await supabase
              .from('staff_whitelist')
              .select('*')
              .eq('email', emailUser.email)
              .eq('role', staffRole)
              .eq('is_approved', true)
              .maybeSingle();
            if (!wl) {
              await supabase.auth.signOut();
              localStorage.removeItem('staff_pending_role');
              alert('❌ Aapka account approved nahi hai.\n\nPehle registration form bharke approval ka wait karo.');
              window.location.href = '/staff-login';
              return;
            }
          }

          if (staffRole && staffRole !== 'customer') {
            localStorage.setItem('medsetu_role', staffRole);
            localStorage.removeItem('staff_pending_role');
            setUserRole(staffRole);

            try {
              const { data: existing } = await supabase
                .from('users').select('*').eq('email', emailUser.email).maybeSingle();
              if (existing) {
                localStorage.setItem('medsetu_user', JSON.stringify(existing));
              } else {
                const { data: newUser } = await supabase
                  .from('users')
                  .insert({ email: emailUser.email, name: emailUser.user_metadata?.full_name || null, role: staffRole })
                  .select().maybeSingle();
                if (newUser) localStorage.setItem('medsetu_user', JSON.stringify(newUser));
              }
            } catch {}

            const routes = { admin: '/admin', pharmacist: '/pharmacist', seller: '/seller-dashboard' };
            window.location.href = routes[staffRole] || '/home';
            return;
          }

          // ── 3. Customer magic link login ──────────────────────
          const savedRole = localStorage.getItem('medsetu_role');
          if (!savedRole) {
            localStorage.setItem('medsetu_role', 'customer');
            setUserRole('customer');
          }
          try {
            const { data: existing } = await supabase
              .from('users').select('*').eq('email', emailUser.email).maybeSingle();
            if (existing) {
              localStorage.setItem('medsetu_user', JSON.stringify(existing));
            } else {
              const { data: newUser } = await supabase
                .from('users').insert({ email: emailUser.email, role: 'customer' }).select().maybeSingle();
              if (newUser) localStorage.setItem('medsetu_user', JSON.stringify(newUser));
            }
          } catch {}

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
        applyDevSession,
        handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
