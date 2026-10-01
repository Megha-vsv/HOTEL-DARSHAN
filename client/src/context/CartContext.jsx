import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { resolveFoodImage } from '../data/foodImages';
import { quoteFromSettings } from '../data/deliveryPricing';
import { readStoredLocation, LOCATION_CHANGE_EVENT } from '../utils/deliveryLocation';
import { useSocket } from './SocketContext';
import { FINISHED_STATUSES } from '../lib/orderStatus';
import { apiBase as API_BASE } from '../lib/apiBase';

const CartContext = createContext();

export function CartProvider({ children }) {
  const { token } = useAuth();
  const { socket, addNotification } = useSocket();

  // Safe localStorage initializer
  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem('hotel_darshan_cart');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      localStorage.removeItem('hotel_darshan_cart');
      return [];
    }
  });

  const [orderType, setOrderType] = useState('delivery'); // 'delivery' or 'pickup'
  const [coupon, setCoupon] = useState(null);
  
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem('hotel_darshan_favorites');
      return saved ? JSON.parse(saved) : [1, 4, 7];
    } catch (e) {
      localStorage.removeItem('hotel_darshan_favorites');
      return [1, 4, 7];
    }
  });

  // A finished order is not "active". Restoring one from localStorage made the
  // feedback prompt open on load for a meal that was already over, which is what
  // made it appear alongside a brand new, still-confirmed order.
  //
  // The shared list, not a local copy: it must be the server's FINISHED_STATUSES,
  // and this file used to be one of four places that had retyped it.
  const [activeOrder, setActiveOrder] = useState(() => {
    // Nothing is restored from storage on the first render. What is stored is a
    // pointer, not an order, and the order behind it is fetched in the effect
    // below - so the tracker opens on the server's current stage or not at all.
    return null;
  });

  const [settings, setSettings] = useState({
    delivery_fee: '35',
    free_delivery_above: '499',
    tax_percent: '5',
    auto_confirm_orders: 'true'
  });

  const [activeCoupons, setActiveCoupons] = useState([]);

  const fetchActiveCoupons = async () => {
    try {
      const res = await fetch(`${API_BASE}/coupons`);
      if (res.ok) setActiveCoupons(await res.json());
    } catch (e) {}
  };

  // Save cart to local storage
  useEffect(() => {
    try {
      localStorage.setItem('hotel_darshan_cart', JSON.stringify(cart));
    } catch (e) {}
  }, [cart]);

  // Save favorites to local storage
  useEffect(() => {
    try {
      localStorage.setItem('hotel_darshan_favorites', JSON.stringify(favorites));
    } catch (e) {}
  }, [favorites]);

  // Remember only WHICH order is being followed, never a copy of it.
  //
  // This used to write the whole order row into localStorage and read it back as
  // the initial state. That is a second copy of the order, and it is the kind
  // that lies: it was written when the order was placed and never reconciled, so
  // a customer who closed the app mid-delivery came back to a tracker that said
  // "preparing" while the rider was at the customer's door. What survives a reload
  // now is the identity of the order - nothing more - and the row behind it is
  // re-read from the server, which is where every other surface reads it from.
  useEffect(() => {
    try {
      if (activeOrder) {
        localStorage.setItem(
          'hotel_darshan_active_order',
          JSON.stringify({ id: activeOrder.id, order_number: activeOrder.order_number })
        );
      } else {
        localStorage.removeItem('hotel_darshan_active_order');
      }
    } catch (e) {}
  }, [activeOrder]);

  // Re-read a remembered order from the server on load, so the first paint of the
  // tracker is the order's real current stage rather than a remembered one.
  useEffect(() => {
    let cancelled = false;
    if (!token) return undefined;
    let ref = null;
    try {
      ref = JSON.parse(localStorage.getItem('hotel_darshan_active_order') || 'null');
    } catch (e) {
      return undefined;
    }
    if (!ref?.id) return undefined;

    fetch(`${API_BASE}/orders/${ref.id}/track`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((fresh) => {
        if (cancelled || !fresh) return;
        if (FINISHED_STATUSES.includes(fresh.status)) {
          // Finished while they were away. The pointer is dropped, and My Orders
          // will show it from the server on its next load.
          localStorage.removeItem('hotel_darshan_active_order');
          return;
        }
        setActiveOrder({ ...fresh, id: fresh.id ?? ref.id, order_number: fresh.order_number ?? ref.order_number });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  // Fetch hotel settings and active coupons from backend API
  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then(res => (res.ok ? res.json() : {}))
      .then(data => setSettings(prev => ({ ...prev, ...data })))
      .catch(() => {});
    fetchActiveCoupons();
  }, []);

  // Listen for real-time menu availability changes and sync cart items
  useEffect(() => {
    if (!socket) return;

    const handleAvailabilityChange = (updatedItem) => {
      if (updatedItem?.deleted) {
        setCart(prev => prev.filter(item => item.id !== updatedItem.id));
        if (addNotification) {
          addNotification('Item Removed', 'An item in your cart has been removed from the menu.', 'alert');
        }
        return;
      }
      const isAvailable = updatedItem.is_available !== false && (updatedItem.available_qty === undefined || updatedItem.available_qty > 0);
      setCart(prev =>
        prev.map(item =>
          item.id === updatedItem.id
            ? { ...item, is_available: isAvailable, available_qty: updatedItem.available_qty }
            : item
        )
      );
      if (!isAvailable && addNotification) {
        addNotification('Item Unavailable', `${updatedItem.name_en || 'An item'} is no longer available.`, 'alert');
      }
    };

    socket.on('menu:availability_changed', handleAvailabilityChange);

    return () => {
      socket.off('menu:availability_changed', handleAvailabilityChange);
    };
  }, [socket, addNotification]);

// Listen for real-time active order status updates via Socket.IO
  useEffect(() => {
    if (!socket || !activeOrder?.id) return undefined;

    socket.emit('join_order', activeOrder.id);

    const handleStatusUpdate = (updatedOrder) => {
      if (updatedOrder && (String(updatedOrder.id) === String(activeOrder.id) || updatedOrder.order_number === activeOrder.order_number)) {
        // Only a genuinely finished order ends the live tracker. PICKED_UP is
        // still on the road, so treating it as the end archived the order while
        // the rider was halfway to the customer.
        const wasActive = !FINISHED_STATUSES.includes(activeOrder.status);
        const nowCompleted = FINISHED_STATUSES.includes(updatedOrder.status);

        setActiveOrder(updatedOrder);

        // The order simply stops being active once it is finished. There is no
        // browser-side archive of it: `hotel_darshan_order_history` used to be
        // written here and read back as a fallback by the My Orders screens, which
        // meant a second copy of every finished order that could disagree with the
        // server's - and did, because what it stored was a socket envelope rather
        // than the order. My Orders reads `${API_BASE}/orders/my-orders`, which is the
        // same row the kitchen, the admin and the rider are reading.
        if (wasActive && nowCompleted) {
          try {
            localStorage.removeItem('hotel_darshan_active_order');
            localStorage.removeItem('hotel_darshan_order_history');
          } catch (e) {}
          // Small delay so the final status is visible before switching views
          setTimeout(() => setActiveOrder(null), 3000);
        }

        if (addNotification) {
          addNotification(
            `Order #${updatedOrder.order_number || updatedOrder.id}`,
            `Status updated to ${String(updatedOrder.status || '').replace(/_/g, ' ')}`,
            nowCompleted ? 'info' : 'alert'
          );
        }
      }
    };

    socket.on('order:status_updated', handleStatusUpdate);

    return () => {
      socket.off('order:status_updated', handleStatusUpdate);
      socket.emit('leave_order', activeOrder.id);
    };
  }, [socket, activeOrder?.id, addNotification]);

  // Add Item to Cart
  const addToCart = (item, quantity = 1, selectedCustomizations = [], specialInstructions = '') => {
    if (item.is_available === false || item.available_qty <= 0) {
      if (addNotification) {
        addNotification('Item Unavailable', `Sorry, ${item.name_en || item.name} is currently unavailable.`, 'alert');
      }
      return;
    }

    const parsedUnitPrice = Number(item.discount_price && item.discount_price > 0 ? item.discount_price : item.price) || 0;
    const customizationsPrice = selectedCustomizations.reduce((sum, c) => sum + (Number(c.price) || 0), 0);
    const parsedQty = Math.max(1, parseInt(quantity, 10) || 1);

    // Unique identifier for item + customization combo
    const custKey = selectedCustomizations.map(c => c.id).sort().join('-');
    const cartItemId = `${item.id}_${custKey}`;
    const isItemAvailable = item.is_available !== false && (item.available_qty === undefined || item.available_qty > 0);

    setCart(prev => {
      const existingIndex = prev.findIndex(ci => ci.cartItemId === cartItemId);
      if (existingIndex > -1) {
        const updated = [...prev];
        const newQty = updated[existingIndex].quantity + parsedQty;
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: newQty,
          itemTotalPrice: (parsedUnitPrice + customizationsPrice) * newQty
        };
        return updated;
      } else {
        return [
          ...prev,
          {
            cartItemId,
            id: item.id,
            name_en: item.name_en || item.name,
            name_hi: item.name_hi,
            name_gu: item.name_gu,
            image_url: resolveFoodImage(item),
            is_veg: item.is_veg !== undefined ? item.is_veg : true,
            is_available: isItemAvailable,
            available_qty: item.available_qty,
            unitPrice: parsedUnitPrice,
            customizationsPrice,
            selectedCustomizations,
            specialInstructions,
            quantity: parsedQty,
            itemTotalPrice: (parsedUnitPrice + customizationsPrice) * parsedQty
          }
        ];
      }
    });

    if (addNotification) {
      addNotification('Added to Cart', `${parsedQty}x ${item.name_en || item.name}`, 'info');
    }
  };

  const updateQuantity = (cartItemId, newQuantity) => {
    const qty = parseInt(newQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      removeFromCart(cartItemId);
      return;
    }
    setCart(prev =>
      prev.map(item => {
        if (item.cartItemId === cartItemId) {
          const unit = Number(item.unitPrice) || 0;
          const cust = Number(item.customizationsPrice) || 0;
          return {
            ...item,
            quantity: qty,
            itemTotalPrice: (unit + cust) * qty
          };
        }
        return item;
      })
    );
  };

  const removeFromCart = (cartItemId) => {
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  const clearCart = () => {
    setCart([]);
    setCoupon(null);
  };

  // Validate that all cart items are still available
  const validateCart = () => {
    const unavailable = cart.filter(item =>
      item.is_available === false ||
      (item.available_qty !== undefined && item.available_qty <= 0)
    );
    return {
      isValid: unavailable.length === 0,
      unavailableItems: unavailable,
      unavailableNames: unavailable.map(item => item.name_en || item.id)
    };
  };

  // Toggle favorite status
  const toggleFavorite = async (itemId) => {
    const id = parseInt(itemId, 10);
    if (isNaN(id)) return;

    const isFav = favorites.includes(id);
    const newFavorites = isFav ? favorites.filter(f => f !== id) : [...favorites, id];
    setFavorites(newFavorites);

    if (token) {
      try {
        await fetch(`${API_BASE}/auth/favorites/toggle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ item_id: id })
        });
      } catch (e) {
        console.error("Failed to sync favorite with backend:", e);
      }
    }
  };

  // Apply Coupon
  const applyCoupon = async (code) => {
    const currentItemTotal = cart.reduce((sum, item) => sum + (Number(item.itemTotalPrice) || 0), 0);
    try {
      const res = await fetch(`${API_BASE}/coupons/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, cartTotal: currentItemTotal })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply coupon');

      setCoupon(data.coupon);
      if (addNotification) {
        addNotification('Coupon Applied!', `Saved ₹${data.coupon.discount_amount}`, 'info');
      }
      return { success: true, discount: data.coupon.discount_amount };
    } catch (err) {
      if (addNotification) {
        addNotification('Coupon Error', err.message, 'alert');
      }
      return { success: false, error: err.message };
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
  };

  // Distance from the customer's selected delivery location to the hotel. The
  // location is published by LocationGate / checkout and is what the server
  // prices the order from, so the cart and checkout always agree with the final
  // charge and both update the moment the selected location changes.
  const [deliveryCoords, setDeliveryCoords] = useState(() => readStoredLocation()?.coords || null);

  // Re-read whenever the selected location changes from anywhere in the app.
  useEffect(() => {
    const sync = () => setDeliveryCoords(readStoredLocation()?.coords || null);
    window.addEventListener(LOCATION_CHANGE_EVENT, sync);
    return () => window.removeEventListener(LOCATION_CHANGE_EVENT, sync);
  }, []);

  // --- Total Calculations ---
  const itemTotal = cart.reduce((sum, item) => sum + (Number(item.itemTotalPrice) || 0), 0);

  let discount = 0;
  if (coupon) {
    if (coupon.discount_type === 'percentage') {
      const perc = Number(coupon.discount_value) || 0;
      discount = (itemTotal * perc) / 100;
      if (coupon.max_discount && discount > Number(coupon.max_discount)) {
        discount = Number(coupon.max_discount);
      }
    } else {
      discount = Number(coupon.discount_value) || 0;
    }
    if (discount > itemTotal) discount = itemTotal;
    discount = Math.round(discount * 100) / 100;
  }

  // Distance-based delivery charge. Mirrors the server exactly: the same slab
  // table, the same radius, and Self Pickup is never charged.
  const deliveryQuote = useMemo(
    () => quoteFromSettings(settings, { coords: deliveryCoords, itemTotal }),
    [settings, deliveryCoords, itemTotal]
  );

  const deliveryFee = orderType === 'delivery' && cart.length > 0 ? deliveryQuote.fee : 0;

  const taxPercent = parseFloat(settings.tax_percent || '5');
  const taxableAmount = Math.max(0, itemTotal - discount);
  const tax = Math.round((taxableAmount * taxPercent / 100) * 100) / 100;
  const grandTotal = Math.round((taxableAmount + deliveryFee + tax) * 100) / 100;

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        validateCart,
        orderType,
        setOrderType,
        coupon,
        applyCoupon,
        removeCoupon,
        favorites,
        toggleFavorite,
        activeOrder,
        setActiveOrder,
        settings,
        activeCoupons,
        fetchActiveCoupons,
        totals: {
          itemTotal,
          discount,
          deliveryFee,
          tax,
          grandTotal,
          // Distance + eligibility for the Home Delivery option, so every surface
          // (cart, checkout, summary) can render the same figures.
          deliveryDistanceKm: deliveryQuote.distanceKm,
          deliveryMaxKm: deliveryQuote.maxKm,
          // Self Pickup is always allowed: the radius only ever restricts Home
          // Delivery, so consumers can safely test this flag alone.
          deliveryAllowed: orderType === 'pickup' ? true : deliveryQuote.allowed,
          deliveryReason: orderType === 'pickup' ? null : deliveryQuote.reason,
          deliveryDistanceKnown: deliveryQuote.distanceKnown
        }
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}