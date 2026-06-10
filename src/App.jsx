import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { testSupabaseConnection } from './lib/testConnection';
// import { insertSeedData } from './lib/seedData';
// ↑ Comment hatao, ek baar chalao, phir wapas comment karo

import SplashScreen        from './screens/SplashScreen';
import OnboardingScreen    from './screens/OnboardingScreen';
import LoginScreen         from './screens/LoginScreen';
import OTPScreen           from './screens/OTPScreen';
import CustomerHome        from './screens/CustomerHome';
import SellerDashboard     from './screens/SellerDashboard';
import StoreLocator        from './screens/StoreLocator';
import MedicineSearch      from './screens/MedicineSearch';
import MedicineDetail      from './screens/MedicineDetail';
import PrescriptionUpload  from './screens/PrescriptionUpload';
import Checkout            from './screens/Checkout';
import OrderTracking       from './screens/OrderTracking';
import OrderHistory        from './screens/OrderHistory';
import InventoryManagement from './screens/InventoryManagement';
import PharmacistPanel     from './screens/PharmacistPanel';
import AdminPanel          from './screens/AdminPanel';
import UserProfile         from './screens/UserProfile';
import StaffLogin          from './screens/StaffLogin';
import SellerRegister      from './screens/SellerRegister';
import PharmacistRegister  from './screens/PharmacistRegister';
import SuperAdminPanel     from './screens/SuperAdminPanel';

// Fire connection test once on module load
testSupabaseConnection();
// insertSeedData(); // ← uncomment once, run, then comment back

// ── Scroll to top on route change ─────────────────────────────
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// ── Full-screen loading spinner ───────────────────────────────
function LoadingScreen() {
  return (
    <div style={ls.wrapper}>
      <div style={ls.spinner} />
      <p style={ls.text}>Loading...</p>
    </div>
  );
}
const ls = {
  wrapper:  { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5', gap: '16px' },
  spinner:  { width: '40px', height: '40px', borderRadius: '50%', border: '4px solid #E8F5EE', borderTopColor: '#1A6B3C', animation: 'spin 0.8s linear infinite' },
  text:     { fontSize: '14px', color: '#888888', margin: 0 },
};

// ── Role → home page mapping ──────────────────────────────────
function roleHome(role) {
  if (role === 'seller')      return '/seller-dashboard';
  if (role === 'admin')       return '/admin';
  if (role === 'pharmacist')  return '/pharmacist';
  return '/home';
}

// ── Protected Route ───────────────────────────────────────────
function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, loading, userRole } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(userRole)) {
    return <Navigate to={roleHome(userRole)} replace />;
  }
  return children;
}

// ── Redirect if already logged in ────────────────────────────
function PublicOnlyRoute({ children }) {
  const { isAuthenticated, loading, userRole } = useAuth();
  if (loading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to={roleHome(userRole)} replace />;
  return children;
}

// ── Super Admin Route ─────────────────────────────────────────
function SuperAdminRoute({ children }) {
  const role  = localStorage.getItem('medsetu_role');
  const user  = (() => { try { return JSON.parse(localStorage.getItem('medsetu_user') || '{}'); } catch { return {}; } })();
  const isSA  = role === 'super_admin' || user?.email === 'kv11081987m@gmail.com';
  if (!isSA) return <Navigate to="/login" replace />;
  return children;
}

// ── 404 ───────────────────────────────────────────────────────
function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={nf.wrapper}>
      <div style={nf.box}>
        <p style={nf.emoji}>🔍</p>
        <p style={nf.title}>Page Nahi Mila</p>
        <p style={nf.sub}>Yeh URL exist nahi karta ya aap galat jagah aa gaye hain.</p>
        <button style={nf.btn} onClick={() => navigate('/home')}>Home Jaao</button>
        <button style={nf.link} onClick={() => navigate(-1)}>Wapas Jao</button>
      </div>
    </div>
  );
}
const nf = {
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  box:     { maxWidth: '320px', width: '100%', textAlign: 'center', padding: '32px 24px', backgroundColor: '#FFFFFF', borderRadius: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' },
  emoji:   { fontSize: '52px', margin: 0 },
  title:   { fontSize: '22px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  sub:     { fontSize: '14px', color: '#888888', margin: 0, lineHeight: '1.5' },
  btn:     { width: '100%', padding: '14px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  link:    { background: 'none', border: 'none', color: '#1A6B3C', fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
};

// ── CSS spin keyframe (injected once) ─────────────────────────
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(spinStyle);

// ── Routes ────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* ── Always public ── */}
        <Route path="/"           element={<SplashScreen />} />
        <Route path="/onboarding" element={<OnboardingScreen />} />

        {/* ── Public only (redirect if logged in) ── */}
        <Route path="/login"       element={<PublicOnlyRoute><LoginScreen /></PublicOnlyRoute>} />
        <Route path="/otp"         element={<PublicOnlyRoute><OTPScreen /></PublicOnlyRoute>} />
        <Route path="/staff-login" element={<PublicOnlyRoute><StaffLogin /></PublicOnlyRoute>} />

        {/* ── Customer (protected) ── */}
        <Route path="/home"            element={<ProtectedRoute allowedRoles={['customer']}><CustomerHome /></ProtectedRoute>} />
        <Route path="/store-locator"   element={<ProtectedRoute allowedRoles={['customer']}><StoreLocator /></ProtectedRoute>} />
        <Route path="/medicine-search" element={<ProtectedRoute allowedRoles={['customer']}><MedicineSearch /></ProtectedRoute>} />
        <Route path="/medicine-detail" element={<ProtectedRoute allowedRoles={['customer']}><MedicineDetail /></ProtectedRoute>} />
        <Route path="/prescription"    element={<ProtectedRoute allowedRoles={['customer']}><PrescriptionUpload /></ProtectedRoute>} />
        <Route path="/checkout"        element={<ProtectedRoute allowedRoles={['customer']}><Checkout /></ProtectedRoute>} />
        <Route path="/order-tracking"  element={<ProtectedRoute allowedRoles={['customer']}><OrderTracking /></ProtectedRoute>} />
        <Route path="/orders"          element={<ProtectedRoute allowedRoles={['customer']}><OrderHistory /></ProtectedRoute>} />
        <Route path="/profile"         element={<ProtectedRoute allowedRoles={['customer']}><UserProfile /></ProtectedRoute>} />

        {/* ── Seller / Staff (protected) ── */}
        <Route path="/seller-dashboard" element={<ProtectedRoute allowedRoles={['seller']}><SellerDashboard /></ProtectedRoute>} />
        <Route path="/inventory"        element={<ProtectedRoute allowedRoles={['seller']}><InventoryManagement /></ProtectedRoute>} />
        <Route path="/pharmacist"       element={<ProtectedRoute allowedRoles={['pharmacist']}><PharmacistPanel /></ProtectedRoute>} />
        <Route path="/admin"            element={<ProtectedRoute allowedRoles={['admin']}><AdminPanel /></ProtectedRoute>} />

        {/* ── Registration (public) ── */}
        <Route path="/seller-register"     element={<SellerRegister />} />
        <Route path="/pharmacist-register" element={<PharmacistRegister />} />

        {/* ── Super Admin (special protected) ── */}
        <Route path="/super-admin" element={<SuperAdminRoute><SuperAdminPanel /></SuperAdminRoute>} />

        {/* ── 404 ── */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <AppRoutes />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
