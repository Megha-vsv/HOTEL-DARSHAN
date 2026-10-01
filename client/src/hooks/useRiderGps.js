import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { RiderGpsEngine } from '../lib/riderGpsEngine.js';
import { apiBase as API_BASE } from '../lib/apiBase';

/**
 * The rider's GPS, wired to the server's version of the truth.
 *
 * All of the decisions are in `RiderGpsEngine`; this only supplies the browser's
 * geolocation, the two transports, and the answer to "should GPS be running at
 * all" - which comes from the server, because the rider's online state and their
 * delivery are both server facts. A signed-out rider, or one whose delivery has
 * been cancelled or handed to somebody else, is told so by `enabled` going false
 * and the watch is torn down.
 */
export function useRiderGps({ activeOrder, online, pickedUp }) {
  const { token } = useAuth();
  const { socket } = useSocket();
  const [snapshot, setSnapshot] = useState({
    status: 'IDLE', point: null, accuracy: null, atHotel: false, nearCustomer: false,
    distanceToHotelKm: null, distanceToCustomerKm: null, hasCustomerPin: false,
    logicalStage: null, lastError: null, sentCount: 0, transport: null
  });
  const [config, setConfig] = useState(null);

  // The engine outlives renders, so a fix arriving does not restart the watch.
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new RiderGpsEngine({ onChange: setSnapshot });
  }
  const engine = engineRef.current;

  // Config comes from the server rather than being written down here, so the
  // radius the rider reads and the radius the server decides on are the same
  // number. If it cannot be fetched the engine simply does not run, rather than
  // running with made-up thresholds.
  useEffect(() => {
    let cancelled = false;
    if (!token) return undefined;
    fetch(`${API_BASE}/rider/gps-config`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => { if (!cancelled && cfg) setConfig(cfg); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  // The transports. A socket that is down falls back to the same HTTP endpoint,
  // so a dropped connection degrades the speed of tracking and not its existence.
  useEffect(() => {
    engine.sendSocket = ({ type, payload }) =>
      new Promise((resolve) => {
        if (!socket) return resolve({ ok: false, error: 'no socket' });
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; resolve({ ok: false, error: 'no acknowledgement' }); }
        }, 6000);
        socket.emit(type, payload, (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(res || { ok: true });
        });
      });
    engine.isSocketConnected = () => Boolean(socket?.connected);
    engine.sendHttp = (payload) => {
      if (!token) return Promise.resolve({ ok: false, error: 'not signed in' });
      // "We have no position" is not a coordinate, so it takes its own endpoint
      // shape rather than being sent as a latitude of zero.
      if (payload?.__unavailable) {
        return fetch(`${API_BASE}/rider/location-unavailable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderId: payload.orderId, reason: payload.reason || 'No GPS fix' })
        }).then((r) => ({ ok: r.ok })).catch((e) => ({ ok: false, error: e.message }));
      }
      return fetch(`${API_BASE}/rider/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
        .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }))
        .catch((e) => ({ ok: false, error: e.message }));
    };
  }, [engine, socket, token]);

  // GPS runs only when the rider is signed in, online, and actually holding a
  // delivery. Any of those going false tears the watch down - which is how
  // signing out, finishing, being cancelled or losing the order all stop tracking
  // without each of them having to remember to.
  const orderId = activeOrder?.id ?? null;
  const isTerminal = useMemo(
    () => ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(activeOrder?.status),
    [activeOrder?.status]
  );
  const enabled = Boolean(token) && Boolean(online) && Boolean(orderId) && !isTerminal;

  useEffect(() => {
    engine.configure({ enabled, orderId, order: activeOrder, config, pickedUp });
    return undefined;
  }, [engine, enabled, orderId, activeOrder, config, pickedUp]);

  // Unmount is a logout or a navigation away: the watch must not outlive it.
  useEffect(() => () => engine.stop({ reason: 'Rider signed out' }), [engine]);

  const stop = useCallback((reason) => engine.stop({ reason }), [engine]);

  // Asking again, at the rider's request. Exposed rather than handled inside the
  // engine so the button that offers it lives in the screen with the copy, not in
  // the GPS layer.
  const retry = useCallback(() => engine.retry(), [engine]);
  const permissionState = useCallback(() => engine.permissionState(), [engine]);

  return { ...snapshot, enabled, config, stop, retry, permissionState };
}

export default useRiderGps;
