import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cartItems, setCartItems] = useState(() => {
    try {
      const saved = localStorage.getItem('medsetu_cart');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [cartSellerId, setCartSellerId] = useState(() => {
    try { return localStorage.getItem('medsetu_cart_seller') || null; } catch { return null; }
  });
  const [cartSellerName, setCartSellerName] = useState(() => {
    try { return localStorage.getItem('medsetu_cart_seller_name') || ''; } catch { return ''; }
  });

  // ── Persist cart to localStorage on every change ─────────────
  useEffect(() => {
    try {
      localStorage.setItem('medsetu_cart', JSON.stringify(cartItems));
      localStorage.setItem('medsetu_cart_seller', cartSellerId || '');
      localStorage.setItem('medsetu_cart_seller_name', cartSellerName || '');
    } catch (e) { console.error('cart save error:', e); }
  }, [cartItems, cartSellerId, cartSellerName]);

  // ── Add to cart ──────────────────────────────────────────────
  // seller = { id, name } — enforces single-seller cart
  const addToCart = useCallback((medicine, seller) => {
    if (seller && cartSellerId && seller.id !== cartSellerId) {
      const ok = window.confirm(
        `Cart mein pehle se ${cartSellerName} ki items hain.\n\n` +
        `Kya aap cart clear karke ${seller.name} se naya order shuru karna chahte hain?`
      );
      if (!ok) return;
      setCartItems([]);
      setCartSellerId(seller?.id || null);
      setCartSellerName(seller?.name || '');
    }

    if (seller && !cartSellerId) {
      setCartSellerId(seller.id || null);
      setCartSellerName(seller.name || '');
    }

    setCartItems((prev) => {
      const existing = prev.find((i) => i.id === medicine.id);
      if (existing) {
        return prev.map((i) =>
          i.id === medicine.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...medicine, quantity: medicine.quantity || 1 }];
    });
  }, [cartSellerId, cartSellerName]);

  // ── Remove from cart ──────────────────────────────────────────
  const removeFromCart = useCallback((medicineId) => {
    setCartItems((prev) => {
      const next = prev.filter((i) => i.id !== medicineId);
      if (next.length === 0) { setCartSellerId(null); setCartSellerName(''); }
      return next;
    });
  }, []);

  // ── Update quantity ───────────────────────────────────────────
  const updateQuantity = useCallback((medicineId, qty) => {
    if (qty <= 0) {
      removeFromCart(medicineId);
      return;
    }
    setCartItems((prev) =>
      prev.map((i) => (i.id === medicineId ? { ...i, quantity: qty } : i))
    );
  }, [removeFromCart]);

  // ── Clear cart ────────────────────────────────────────────────
  const clearCart = useCallback(() => {
    setCartItems([]);
    setCartSellerId(null);
    setCartSellerName('');
    try {
      localStorage.removeItem('medsetu_cart');
      localStorage.removeItem('medsetu_cart_seller');
      localStorage.removeItem('medsetu_cart_seller_name');
    } catch { /* ignore */ }
  }, []);

  const cartTotal = (cartItems || []).reduce(
    (sum, i) => sum + (i.price ?? i.selling_price ?? 0) * i.quantity, 0
  );
  const cartCount = (cartItems || []).reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{
      cartItems,
      cartSellerId,
      cartSellerName,
      cartTotal,
      cartCount,
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
};
