import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getCurrentUser } from '../lib/auth';

const AuthContext = createContext({});

// ── Dev session helpers (sessionStorage) ──────────────────────
// Used when Supabase phone provider is not yet enabled.
// Cleared on tab close; cleared on real logout.
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

// ── Provider ───────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [devSession, setDevSessionState] = useState(getDevSession);
  const [userRole, setUserRole] = useState(() => getDevSession()?.role || 'customer');
  const [loading, setLoading]  = useState(true);

  useEffect(() => {
    // Initial user load
    getCurrentUser().then((u) => {
      setUser(u);
      setLoading(false);
    });

    // Listen for auth state changes (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
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
    await supabase.auth.signOut().catch(() => {});
    setUser(null);
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
