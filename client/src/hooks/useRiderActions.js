import { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { riderApi, RiderApiError } from '../lib/riderApi';

/**
 * Everything the rider app does, in one place.
 *
 * Each action returns a result the screen can show rather than throwing into a
 * render: `{ ok: false, error }` carries the server's own wording, which for a
 * geofence check is the sentence that explains why the rider cannot press the
 * button yet. A rider who is told "you are still 400 m from the hotel" learns
 * something; a generic failure teaches them to tap harder.
 */
export function useRiderActions({ onChanged } = {}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(null);
  const [lastRefusal, setLastRefusal] = useState(null);

  const run = useCallback(async (key, work) => {
    setBusy(key);
    setLastRefusal(null);
    try {
      const result = await work();
      // The screen re-reads rather than trusting this response, so a delivery
      // cannot be shown in a stage the server has not actually committed.
      if (onChanged) await onChanged();
      return { ok: true, result };
    } catch (e) {
      const failure = e instanceof RiderApiError ? e : new RiderApiError(e.message);
      setLastRefusal({ key, message: failure.message, code: failure.code, status: failure.status });
      return { ok: false, error: failure };
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  const setAvailability = useCallback((state) =>
    run(`availability:${state}`, () => riderApi.setAvailability(token, state)), [run, token]);

  const riderAction = useCallback((orderId, action) =>
    run(`action:${action}`, () => riderApi.riderAction(token, orderId, action)), [run, token]);

  const collectPayment = useCallback((orderId) =>
    run('payment', () => riderApi.collectPayment(token, orderId)), [run, token]);

  const markRead = useCallback(async (id) => {
    if (!token) return { ok: false };
    try {
      await riderApi.markNotificationRead(token, id);
      if (onChanged) await onChanged();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e };
    }
  }, [token, onChanged]);

  const markAllRead = useCallback(() =>
    run('read-all', () => riderApi.markAllNotificationsRead(token)), [run, token]);

  const clearRefusal = useCallback(() => setLastRefusal(null), []);

  return {
    busy, lastRefusal, clearRefusal,
    setAvailability, riderAction, collectPayment, markRead, markAllRead
  };
}

export default useRiderActions;
