// Every call the rider app makes, in one place.
//
// The rider screens read from the rider API and nothing else. There is no sample
// order and no fallback figure anywhere in this file or in the screens that use
// it: if the server has not answered, the screen says it is loading or that it
// could not load, and it never falls back to something that looks like data.

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * A failure that carries the server's own words.
 *
 * The status and code matter to the screens: a 409 from a geofence check is
 * something to show the rider next to the button they pressed, while a 0 is a
 * dead connection and the honest response is "reconnecting", not an error the
 * rider caused.
 */
export class RiderApiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'RiderApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** The request never reached the server. */
  get isOffline() {
    return this.status === 0;
  }

  /** The rider pressed something the server would not allow, with a reason. */
  get isRefusal() {
    return this.status >= 400 && this.status < 500;
  }
}

async function request(path, { method = 'GET', token, body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    // A thrown fetch means the request did not complete: no status, no server
    // wording, nothing to show but the truth, which is that we are not talking
    // to the server right now.
    throw new RiderApiError('No connection to the server', { status: 0, code: 'OFFLINE' });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new RiderApiError(
      payload?.error || `Request failed (${response.status})`,
      { status: response.status, code: payload?.code || null, body: payload }
    );
  }
  return payload;
}

// ------------------------------------------------------------------ endpoints

export const riderApi = {
  /** Who am I, and what state am I in. Also the last known position and its age. */
  me: (token) => request('/rider/me', { token }),

  /** The home screen: the job in hand and today's tally. */
  dashboard: (token) => request('/rider/dashboard', { token }),

  /** The deliveries this rider is carrying right now. */
  activeOrders: (token) => request('/rider/orders/active', { token }),

  /** Finished deliveries, newest first. */
  history: (token, { limit = 50, offset = 0 } = {}) =>
    request(`/rider/orders/history?limit=${limit}&offset=${offset}`, { token }),

  /**
   * Sign in to, or out of, taking work.
   *
   * ONLINE is the choice; what that becomes is derived by the server, which is
   * why the response is returned rather than assumed.
   */
  setAvailability: (token, state) =>
    request('/rider/availability', { method: 'PATCH', token, body: { state } }),

  /**
   * Move a delivery on by one named step.
   *
   * The rider never names a status. `action` is checked against the server's
   * table, and the two steps that depend on where the rider actually is are
   * refused with a reason if the position does not support them.
   */
  riderAction: (token, id, action) =>
    request(`/rider/orders/${id}/actions/${action}`, { method: 'POST', token }),

  /** Record cash taken at the door. Separate from the status, on purpose. */
  collectPayment: (token, id) =>
    request(`/rider/orders/${id}/payment-collected`, { method: 'POST', token }),

  /** The rider's own feed, with the unread count the top bar badge needs. */
  notifications: (token, { limit = 30, unreadOnly = false } = {}) =>
    request(`/rider/notifications?limit=${limit}${unreadOnly ? '&unreadOnly=true' : ''}`, { token }),

  markNotificationRead: (token, id) =>
    request(`/rider/notifications/${id}/read`, { method: 'POST', token }),

  markAllNotificationsRead: (token) =>
    request('/rider/notifications/read-all', { method: 'POST', token }),

  /** The hotel's own GPS thresholds, so the app never hard-codes a radius. */
  gpsConfig: (token) => request('/rider/gps-config', { token })
};

export default riderApi;
