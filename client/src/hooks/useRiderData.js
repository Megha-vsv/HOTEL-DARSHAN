import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { riderApi, RiderApiError } from '../lib/riderApi';

/**
 * The rider app's single source of truth.
 *
 * Every screen reads from this one hook rather than fetching for itself, so the
 * dashboard, the order list and the delivery detail can never disagree about
 * which delivery is in hand - a rider pressing GO TO HOTEL on the detail screen
 * and seeing the dashboard still say RIDER_ASSIGNED is the kind of thing that
 * makes a rider stop trusting the app mid-round.
 *
 * Events are treated as a hint to re-read, not as the state. A socket message
 * tells this hook that something may have changed; the answer comes from the
 * server, which is the only place that knows. That is also what makes a dropped
 * connection harmless: reconnecting re-reads, and anything missed in between is
 * simply not needed.
 */
export function useRiderData() {
  const { token } = useAuth();
  const { socket } = useSocket();

  const [profile, setProfile] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState({ total: 0, limit: 50, offset: 0, orders: [] });
  const [notifications, setNotifications] = useState({ total: 0, unread: 0, notifications: [] });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  // An answer that arrives after the rider has navigated away, or after signing
  // out, is dropped rather than written into a screen that has moved on.
  //
  // The ref is set from the effect's *setup*, not only from its cleanup, and that
  // is the whole point. React runs a mount effect twice in StrictMode - setup,
  // cleanup, setup - to surface exactly this class of mistake. With only a
  // cleanup, the first cleanup set this to false and the second setup had nothing
  // to set it back, so from then on the hook believed it was unmounted for the
  // rest of the session: every refresh returned early at the `aliveRef` check and
  // the `finally` skipped `setLoading(false)`. Loading stayed true and the profile
  // stayed null, so the app sat on its loading state permanently and the rider
  // page was blank. The flag now describes "mounted right now", which is what it
  // is supposed to mean.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  /** Read everything the app shows. Called on mount, on reconnect, and on events. */
  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!token) {
      setProfile(null); setDashboard(null); setActive([]); setLoading(false);
      return;
    }
    if (!quiet) setError(null);
    try {
      const [me, dash, live, past, notes] = await Promise.all([
        riderApi.me(token),
        riderApi.dashboard(token),
        riderApi.activeOrders(token),
        riderApi.history(token, { limit: 50 }),
        riderApi.notifications(token, { limit: 30 })
      ]);
      if (!aliveRef.current) return;
      setProfile(me);
      setDashboard(dash);
      setActive(Array.isArray(live) ? live : []);
      setHistory(past || { total: 0, orders: [] });
      setNotifications(notes || { total: 0, unread: 0, notifications: [] });
    } catch (e) {
      if (!aliveRef.current) return;
      // A dead connection is not the rider's fault and is reported as its own
      // thing; anything else is a real failure with the server's own wording.
      setError(e instanceof RiderApiError ? e : new RiderApiError(e.message));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // Live updates. Reconnect re-reads everything, which is the point: the server
  // re-derives which rooms this socket belongs in, and a rider who slept through
  // three stage changes comes back to a correct screen rather than a stale one.
  useEffect(() => {
    if (!socket || !token) return undefined;
    setConnected(Boolean(socket.connected));
    const revalidate = () => { if (aliveRef.current) refresh({ quiet: true }); };
    const onConnect = () => { setConnected(true); revalidate(); };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    for (const event of [
      'sync', 'resync',
      'order:status_updated', 'order:riderAssigned', 'order:deliveryStarted',
      'order:riderNearCustomer', 'order:delivered',
      'rider:orderAssigned', 'rider:orderReleased', 'rider:availabilityChanged',
      'rider:location', 'rider:location_unavailable',
      'notification'
    ]) socket.on(event, revalidate);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const event of [
        'sync', 'resync',
        'order:status_updated', 'order:riderAssigned', 'order:deliveryStarted',
        'order:riderNearCustomer', 'order:delivered',
        'rider:orderAssigned', 'rider:orderReleased', 'rider:availabilityChanged',
        'rider:location', 'rider:location_unavailable',
        'notification'
      ]) socket.off(event, revalidate);
    };
  }, [socket, token, refresh]);

  return {
    profile, dashboard, active, history, notifications,
    activeOrder: active[0] || null,
    loading, error, connected,
    isOnline: profile?.riderState ? profile.riderState !== 'OFFLINE' : null,
    refresh
  };
}

export default useRiderData;
