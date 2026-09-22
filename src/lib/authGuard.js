// Proactive session-expiry detection for write-action error handling.
// Deliberately standalone — does NOT import AuthContext (which already
// imports lib/session.js) to avoid a circular import, and because
// AuthContext's own cleanup (clearLocalSession) is a private closure
// inside AuthProvider, not something exportable. Callers pass their own
// `handleLogout` (from useAuth()) instead.

export const isAuthError = (error) => {
  return error?.code === '401' || error?.status === 401 ||
         error?.message?.includes('JWT') ||
         error?.message?.includes('row-level security');
};

export const handleAuthExpiry = async (handleLogout) => {
  alert('Aapka session expire ho gaya hai. Kripya dobara login karein.');
  await handleLogout();
  window.location.href = '/login';
};
