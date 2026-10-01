import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [orders, setOrders] = useState([]);
  // `null` until the socket has had a chance to connect, so a screen can tell
  // "not connected yet" from "connected and then dropped" - the first is normal
  // on a cold start, the second is worth telling a rider about.
  const [connected, setConnected] = useState(null);
  const audioCtxRef = useRef(null);

  // Play pleasant acoustic chime using Web Audio API
  const playNotificationSound = (type = 'ding') => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'kitchen_alert') {
        // High attention kitchen bell: 2 short pulses
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.setValueAtTime(1174, now + 0.35);
        gain2.gain.setValueAtTime(0.3, now + 0.35);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
        osc2.start(now + 0.35);
        osc2.stop(now + 0.7);
      } else {
        // Subtle customer chime
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.2); // A5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    } catch (e) {
      // Audio autoplay policy fallback
    }
  };

  const addNotification = (title, message, type = 'info') => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [{ id, title, message, type, time: new Date() }, ...prev.slice(0, 4)]);
    playNotificationSound(type === 'alert' ? 'kitchen_alert' : 'ding');

    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  };

  const dismissNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const getToken = () => {
    try {
      return localStorage.getItem('hotelDarshanToken');
    } catch {
      return null;
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update order status');
    }
    return res.json();
  };

  useEffect(() => {
    // The server identifies the socket from this token, the same one the HTTP
    // API uses. Without it the socket is anonymous and cannot be given an order
    // room, so the tracker would silently receive nothing.
    const token = getToken();
    const socketInstance = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      auth: token ? { token } : {},
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    // A reconnect is a fresh session: the server has forgotten which rooms this
    // socket was in and every update sent while it was down was lost. Each view
    // re-joins its own room on `connect` and re-reads its data, so the UI
    // converges on the database again instead of trusting events it may have
    // missed. Nothing joins a staff room from here - a customer must not be
    // pushed other people's orders, so the kitchen and admin rooms are joined by
    // the views that are actually allowed in them.
    socketInstance.on('connect', () => {
      setConnected(true);
      if (token) {
        socketInstance.auth = { token: getToken() || token };
      }
    });
    socketInstance.on('disconnect', () => setConnected(false));
    socketInstance.on('connect_error', () => setConnected(false));

    socketInstance.on('notification', (notif) => {
      addNotification(notif.title, notif.message, notif.type || 'info');
    });

    const handleNewOrder = (newOrder) => {
      setOrders((prev) => [newOrder, ...prev.filter((o) => o.id !== newOrder.id)]);
    };

    const handleStatusUpdate = (updatedOrder) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o))
      );
    };

    socketInstance.on('order:created', handleNewOrder);
    socketInstance.on('order:status_updated', handleStatusUpdate);

    setSocket(socketInstance);

    return () => {
      socketInstance.off('order:created', handleNewOrder);
      socketInstance.off('order:status_updated', handleStatusUpdate);
      socketInstance.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected, notifications, orders, addNotification, dismissNotification, playNotificationSound, updateOrderStatus }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
