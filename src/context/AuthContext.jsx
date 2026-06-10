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
    getCurrentUser().then((u) => {
      if (!u) {
        const dev = (() => { try { return JSON.parse(sessionStorage.getItem(DEV_KEY) || 'null'); } catch { return null; } })();
        if (!dev) {
          // No Supabase session and no dev session — clear stale localStorage
          localStorage.removeItem('medsetu_role');
          localStorage.removeItem('medsetu_user');
        }
      }
      setUser(u);
      setLoading(false);
    });

    // Listen for auth state changes (login / logout / magic link callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);

        if (event === 'SIGNED_IN' && session) {
          const emailUser = session.user;
          const pendingRole = localStorage.getItem('staff_pending_role');

          if (pendingRole === 'super_admin') {
            // ── Super Admin login ──
            localStorage.setItem('medsetu_role', 'super_admin');
            localStorage.setItem('medsetu_user', JSON.stringify({ email: emailUser.email, role: 'super_admin', name: 'Kumar' }));
            localStorage.removeItem('staff_pending_role');
            setUserRole('super_admin');
            window.location.href = '/super-admin';
            return;
          }

          if (pendingRole) {
            // ── Staff magic link login ──
            localStorage.setItem('medsetu_role', pendingRole);
            localStorage.removeItem('staff_pending_role');
            setUserRole(pendingRole);

            // Upsert user record with staff role
            const { data: existing } = await supabase
              .from('users')
              .select('*')
              .eq('email', emailUser.email)
              .maybeSingle();

            if (!existing) {
              const { data: newUser } = await supabase
                .from('users')
                .insert({ email: emailUser.email, role: pendingRole })
                .select()
                .single();
              if (newUser) localStorage.setItem('medsetu_user', JSON.stringify(newUser));
            } else {
              localStorage.setItem('medsetu_user', JSON.stringify(existing));
            }

            // Redirect to role dashboard
            const routes = { admin: '/admin', pharmacist: '/pharmacist', seller: '/seller-dashboard' };
            if (routes[pendingRole]) window.location.href = routes[pendingRole];

          } else {
            // ── Customer magic link login ──
            const savedRole = localStorage.getItem('medsetu_role');
            if (!savedRole) {
              localStorage.setItem('medsetu_role', 'customer');
              setUserRole('customer');
            }

            const { data: existing } = await supabase
              .from('users')
              .select('*')
              .eq('email', emailUser.email)
              .maybeSingle();

            if (!existing) {
              const { data: newUser } = await supabase
                .from('users')
                .insert({ email: emailUser.email, role: 'customer' })
                .select()
                .single();
              if (newUser) localStorage.setItem('medsetu_user', JSON.stringify(newUser));
            } else {
              localStorage.setItem('medsetu_user', JSON.stringify(existing));
            }

            // Redirect to home only if on login/splash page
            const currentPath = window.location.pathname;
            if (currentPath === '/login' || currentPath === '/' || currentPath === '/otp') {
              window.location.href = '/home';
            }
          }
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
