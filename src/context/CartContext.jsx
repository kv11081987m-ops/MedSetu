import { createContext, useContext, useState, useCallback } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cartItems, setCartItems] = useState([]);
  const [cartSellerId, setCartSellerId] = useState(null);
  const [cartSellerName, setCartSellerName] = useState('');

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
  }, []);

  const cartTotal = cartItems.reduce(
    (sum, i) => sum + (i.price ?? i.selling_price ?? 0) * i.quantity, 0
  );
  const cartCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);

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
