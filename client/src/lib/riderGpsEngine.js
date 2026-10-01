// The rider GPS engine.
//
// Deliberately not a React hook. Everything with a decision in it lives here -
// when to send, when to refuse, what to do about a denied permission, when to
// fall back to HTTP - so it can be driven by a fake geolocation in a test rather
// than only by a real phone. `useRiderGps` is a thin adapter over this.
//
// The rule the whole file obeys: a position is either a real fix or it is absent.
// Nothing here invents, interpolates or smooths a coordinate, and there is no
// "last known position" fallback - a stale pin drawn on a map looks live and is
// not, which is the same reason the customer is told when the tracking is blind.

import {
  assessFix,
  classifyGeolocationError,
  isUsablePoint,
  locate,
  logicalStage,
  metresBetween,
  parseServerTimestamp
} from './geo.js';

export const GPS_IDLE = 'IDLE';
export const GPS_STARTING = 'STARTING';
export const GPS_TRACKING = 'TRACKING';
/**
 * A fix arrived, but its precision is not good enough to act on. Kept separate from
 * GPS_UNAVAILABLE because the two need different things from the rider: a weak
 * signal usually clears by itself in a second or two, whereas "unavailable" means
 * nothing is arriving at all. Reporting both as one state told a rider standing in
 * a basement with a working GPS that their GPS was unavailable.
 */
export const GPS_WEAK = 'WEAK';
/** Nothing usable is arriving: a timeout, a momentary loss, or a failed send. */
export const GPS_UNAVAILABLE = 'UNAVAILABLE';
export const GPS_DENIED = 'PERMISSION_DENIED';
export const GPS_UNSUPPORTED = 'UNSUPPORTED';

/**
 * Fix reasons that mean "GPS works, the reading is just not sharp enough".
 * Everything else that fails a fix means no usable position is arriving.
 */
const WEAK_FIX_REASONS = new Set(['POOR_ACCURACY', 'UNKNOWN_ACCURACY']);

export class RiderGpsEngine {
  /**
   * @param {object} deps
   * @param {object} deps.geolocation  `navigator.geolocation`, injected for tests.
   * @param {(payload, meta) => Promise<any>} deps.sendSocket  preferred transport.
   * @param {(payload) => Promise<any>} deps.sendHttp          used when the socket is down.
   * @param {() => boolean} deps.isSocketConnected
   * @param {() => number} [deps.now]
   * @param {(state) => void} [deps.onChange]
   */
  constructor({ geolocation, sendSocket, sendHttp, isSocketConnected, now, onChange } = {}) {
    this.geo = geolocation || (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    this.sendSocket = sendSocket || (() => Promise.resolve({ ok: false, error: 'No socket transport' }));
    this.sendHttp = sendHttp || (() => Promise.resolve({ ok: false, error: 'No HTTP transport' }));
    this.isSocketConnected = isSocketConnected || (() => false);
    this.now = now || (() => Date.now());
    this.onChange = onChange || (() => {});

    this.watchId = null;
    this.status = GPS_IDLE;
    this.orderId = null;
    this.config = null;
    this.order = null;
    this.lastSentAt = 0;
    this.lastSentPoint = null;
    this.lastError = null;
    this.unavailableReportedAt = 0;
    this.sentCount = 0;
    /**
     * The most recent real position this rider is known to have had, and when.
     *
     * This is deliberately kept separate from `snapshot.point`, which is only ever
     * a fix that has just arrived. `lastKnown` is what makes a phone that has just
     * been refreshed - or one whose GPS has dropped in a tunnel - able to say "your
     * position is out of date, it was updated 40 seconds ago" instead of going
     * blank, which reads as a broken screen.
     *
     * It is never sent to the server, never used to satisfy a geofence and never
     * allowed to mark an order as arrived at. Presenting it as a current fix is the
     * one mistake that would put a rider on a map where they are not; showing it
     * clearly labelled as old is the whole point of having it.
     */
    this.lastKnown = null;
    this.snapshot = this.blankSnapshot();
  }

  blankSnapshot() {
    return {
      status: GPS_IDLE,
      orderId: null,
      point: null,
      accuracy: null,
      atHotel: false,
      nearCustomer: false,
      distanceToHotelKm: null,
      distanceToCustomerKm: null,
      hasCustomerPin: false,
      logicalStage: null,
      lastError: null,
      sentCount: 0,
      transport: null,
      lastKnown: null
    };
  }

  /**
   * Remember a position as "the last one we know of", if it is genuinely newer
   * than what we already hold. Never used as a current fix.
   */
  rememberPosition(point, source) {
    if (!isUsablePoint(point)) return;
    const at = Number(point.at);
    if (!Number.isFinite(at) || at <= 0) return;
    if (this.lastKnown && this.lastKnown.at >= at) return;
    this.lastKnown = { lat: Number(point.lat), lng: Number(point.lng), at, accuracy: point.accuracy ?? null, source };
  }

  /**
   * Adopt the position the server already holds for this order, so a rider who
   * refreshes mid-delivery sees where they were rather than an empty map.
   *
   * Skipped unless the server gave a timestamp: a position whose age is unknown
   * cannot be honestly labelled as "last updated X ago", and a pin drawn without
   * one looks live. A fix this device has taken itself always wins, because it is
   * both newer and known to be this rider's.
   */
  seedLastKnownFromServer(order) {
    const rider = order?.map?.rider;
    if (!isUsablePoint(rider)) return;
    const at = parseServerTimestamp(order?.map?.riderAt);
    if (at == null) return;
    this.rememberPosition({ lat: rider.lat, lng: rider.lng, at }, 'server');
  }

  publish() {
    this.onChange(this.snapshot);
    return this.snapshot;
  }

  setStatus(status, error = null) {
    this.status = status;
    this.lastError = error;
    this.snapshot = { ...this.snapshot, status, lastError: error, lastKnown: this.lastKnown };
  }

  /**
   * Point the engine at one delivery, and start or stop to match.
   *
   * `enabled` is the rider's own switch AND the presence of a delivery, decided by
   * the caller: the engine is told the truth rather than working it out, because
   * "is this rider online" is a server fact and re-deriving it here from a
   * possibly stale local value is how a signed-out rider keeps being tracked.
   */
  configure({ enabled, orderId, order, config, pickedUp }) {
    const changedOrder = orderId !== this.orderId;
    this.order = order ?? this.order;
    this.config = config ?? this.config;
    this.pickedUp = pickedUp ?? this.pickedUp;
    // Seeded before anything can publish, so the very first snapshot the rider's
    // screen renders already carries the position the server was holding. On a
    // refresh mid-delivery that is the difference between "where was I" and a
    // blank map while the watch warms up.
    if (order) this.seedLastKnownFromServer(order);
    // Assigned before the branch below, not inside it: the engine needs to know
    // which delivery a fix belongs to before it can decide to send it, so leaving
    // it unset on the running path would silently stop every position.
    this.orderId = orderId ?? null;

    if (!enabled || !this.orderId || !this.config) {
      if (this.watchId !== null) this.stop({ reason: !enabled ? 'rider offline or no delivery' : 'no configuration' });
      // Forgotten, so a fix that arrives after tracking stopped - a queued
      // callback from a watch that has already been cleared, say - has no order to
      // be attributed to and cannot be sent against a delivery that is finished.
      if (!enabled) this.orderId = null;
      return this.snapshot;
    }
    if (this.watchId === null || changedOrder) this.start();
    return this.snapshot;
  }

  start() {
    if (this.watchId !== null) return;
    if (!this.geo || typeof this.geo.watchPosition !== 'function') {
      // No geolocation at all: say so once and do not pretend to track.
      this.setStatus(GPS_UNSUPPORTED, { code: 'UNSUPPORTED', recoverable: false, message: 'This device cannot report a location.' });
      this.reportUnavailable('This device cannot report a location.');
      this.publish();
      return;
    }
    this.setStatus(GPS_STARTING);
    this.publish();
    this.watchId = this.geo.watchPosition(
      (position) => this.handleFix(position),
      (error) => this.handleError(error),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }

  /** Stop watching. Safe to call when already stopped. */
  stop({ reason = 'stopped' } = {}) {    if (this.watchId !== null) {
      try { this.geo?.clearWatch?.(this.watchId); } catch { /* already gone */ }
      this.watchId = null;
    }
    this.lastSentPoint = null;
    // Forgotten with the rest. The next delivery is a different journey, and
    // carrying the previous rider position over would draw a dot from the last
    // order on a map for the new one. `setStatus` republishes `this.lastKnown`, so
    // the field has to go too, not just the snapshot field.
    this.lastKnown = null;
    this.snapshot = {
      ...this.blankSnapshot(),
      status: GPS_IDLE,
      // The reason is kept, so the screen can say why tracking ended rather than
      // just going quiet.
      lastError: reason ? { code: 'STOPPED', recoverable: true, message: reason } : null
    };
    this.setStatus(GPS_IDLE, this.snapshot.lastError);
    return this.publish();
  }

  get isRunning() {
    return this.watchId !== null;
  }

  /**
   * Ask for location permission again, at the rider's request.
   *
   * A denied permission is not a dead end: the rider can grant it in the browser's
   * settings and come back, and a plain retry while the page is still open is the
   * common case. This re-arms the watch, which is what makes the browser prompt
   * again.
   *
   * Deliberately does nothing when there is no delivery to report against. A
   * "Try Again" button that started a watch for an order the rider is not carrying
   * would collect a position with nowhere to send it, and would be tracking
   * somebody at all times - which is the one thing the lifecycle forbids.
   */
  retry() {
    if (!this.orderId || !this.config) {
      return this.publish();
    }
    // Tear the old watch down first so the browser is asked once, cleanly, rather
    // than a second watch running alongside the refused one.
    if (this.watchId !== null) {
      try { this.geo?.clearWatch?.(this.watchId); } catch { /* already gone */ }
      this.watchId = null;
    }
    this.unavailableReportedAt = 0;
    this.lastSentPoint = null;
    this.start();
    return this.publish();
  }

  /**
   * Ask the browser what the permission currently is, without starting a watch.
   *
   * Used to tell "you have not been asked yet" apart from "you said no" - two
   * states that look identical from the watch's point of view, and that the rider
   * needs to be told apart so the prompt can be offered again.
   */
  async permissionState() {
    const api = typeof navigator !== 'undefined' ? navigator.permissions : null;
    if (!api || typeof api.query !== 'function') return 'unknown';
    try {
      const status = await api.query({ name: 'geolocation' });
      return status?.state || 'unknown';
    } catch {
      // Not every browser implements the geolocation permission name. The engine
      // does not depend on the answer, so an unknown here is a real answer.
      return 'unknown';
    }
  }

  handleError(error) {
    const info = classifyGeolocationError(error);
    if (!info.recoverable) {
      // Keep watching: a rider can grant permission in settings and come back, and
      // the watch resumes delivering fixes on its own. What must not happen is
      // pretending to still be tracking.
      this.setStatus(GPS_DENIED, info);
      this.reportUnavailable(info.message);
      this.publish();
      return;
    }
    // Recoverable: a timeout or a momentary loss of signal. Reported to the
    // customer as blind, and the watch is left running so the next fix recovers
    // on its own.
    this.setStatus(GPS_UNAVAILABLE, info);
    this.reportUnavailable(info.message);
    this.publish();
  }

  /** Tell the server - and therefore the customer - that we have no position. */
  reportUnavailable(message) {
    if (!this.orderId) return;
    // At most once per interval, so a flapping signal does not become a stream of
    // identical "unavailable" events.
    const at = this.now();
    if (at - this.unavailableReportedAt < (this.config?.sendIntervalSeconds ?? 15) * 1000) return;
    this.unavailableReportedAt = at;
    const payload = { orderId: this.orderId, reason: message };
    // Sent over whichever transport is available, exactly like a position - and
    // over the same interval, so a rider driving through a tunnel produces one
    // notice rather than one per fix.
    if (this.isSocketConnected()) {
      Promise.resolve(this.sendSocket({ type: 'rider:location_unavailable', payload })).catch(() => {
        this.sendHttp({ __unavailable: true, orderId: payload.orderId, reason: message });
      });
    } else {
      this.sendHttp({ __unavailable: true, orderId: payload.orderId, reason: message });
    }
  }

  handleFix(position) {
    // A fix that lands after the watch was cleared is ignored outright. Geolocation
    // callbacks already in flight do still arrive after `clearWatch`, and letting
    // one through would draw a rider on a delivered order - the very thing the
    // customer tracker is not supposed to show.
    if (!this.isRunning) return;
    const coords = position?.coords || {};
    const fix = {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      // The device's own reading, not the browser clock, so a phone with a wrong
      // time still reports a position of the right age to the server.
      timestamp: position?.timestamp
    };
    const verdict = assessFix(fix, {
      maxAcceptableAccuracyMetres: this.config?.maxAcceptableAccuracyMetres ?? 100,
      maxFixAgeSeconds: this.config?.maxFixAgeSeconds ?? 60,
      now: this.now()
    });

    if (!verdict.usable) {
      // A fix we cannot trust is not sent and is not displayed as a position. The
      // rider is told why, because "the map is not moving" with no explanation is
      // the thing that makes riders disable tracking entirely.
      //
      // A poor reading and no reading at all are separated here. A 300 m fix means
      // GPS is working and the rider is indoors or under cover; a timeout means
      // nothing is arriving. Telling a rider with a working GPS that their GPS is
      // unavailable is wrong, and telling a rider in a tunnel that their signal is
      // merely weak is no better.
      const weak = WEAK_FIX_REASONS.has(verdict.reason);
      const info = { code: verdict.reason, recoverable: true, message: verdict.message, accuracy: verdict.accuracy ?? null };
      this.setStatus(weak ? GPS_WEAK : GPS_UNAVAILABLE, info);
      this.reportUnavailable(verdict.message);
      this.publish();
      return;
    }

    const point = { ...verdict.point, accuracy: verdict.accuracy, at: this.now() };
    const where = locate({ point, order: this.order, config: this.config || {} });
    const stage = logicalStage(where, { order: this.order, hasBeenPickedUp: this.pickedUp });

    // Only a fix good enough to act on becomes the remembered position. A 300 m
    // reading is a real reading but a poor "where you were", and remembering it
    // would let a later "last updated" line describe an imprecise fix as though it
    // were simply an old good one. Recorded before the snapshot is built so the
    // rider's screen sees the age in the same render as the state.
    this.rememberPosition(point, 'fix');

    this.snapshot = {
      ...this.snapshot,
      status: GPS_TRACKING,
      point: where.point,
      accuracy: where.accuracy,
      atHotel: where.atHotel,
      nearCustomer: where.nearCustomer,
      distanceToHotelKm: where.distanceToHotelKm,
      distanceToCustomerKm: where.distanceToCustomerKm,
      hasCustomerPin: where.hasCustomerPin,
      logicalStage: stage,
      lastError: null,
      lastKnown: this.lastKnown
    };
    this.status = GPS_TRACKING;
    this.publish();

    this.maybeSend(point);
  }

  /**
   * Throttle.
   *
   * A high-accuracy watch fires far more often than a moving dot needs to be
   * redrawn, so a fix is only sent when enough time has passed or the rider has
   * actually moved far enough to be worth the request. Sending every fix is how a
   * rider's battery and the server both end up paying for a position that did not
   * change.
   */
  maybeSend(point) {
    // Only a running engine may send. A fix that turns up after the watch was
    // cleared - which does happen, because a geolocation callback already in
    // flight still lands - must be dropped rather than sent against a delivery
    // that has been finished, cancelled or handed to somebody else.
    if (!this.isRunning) return false;
    if (!this.orderId || !this.config) return false;
    const at = this.now();
    const intervalMs = (this.config.sendIntervalSeconds ?? 15) * 1000;
    const movedM = this.lastSentPoint ? (metresBetween(this.lastSentPoint, point) ?? 0) : Infinity;

    const dueByTime = at - this.lastSentAt >= intervalMs;
    const dueByMovement = this.lastSentPoint !== null && movedM >= (this.config.resendAfterMetres ?? 40);
    if (!dueByTime && !dueByMovement) return false;

    this.lastSentAt = at;
    this.lastSentPoint = point;
    this.sentCount += 1;
    this.snapshot = { ...this.snapshot, sentCount: this.sentCount };
    this.publish();

    const payload = {
      latitude: point.lat,
      longitude: point.lng,
      accuracy: point.accuracy,
      timestamp: new Date(point.at).toISOString(),
      orderId: this.orderId
    };

    // The socket is the fast path, but a dropped socket must not silently end
    // tracking - the rider is still moving and the customer is still waiting. The
    // HTTP endpoint writes the same row.
    if (this.isSocketConnected()) {
      Promise.resolve(this.sendSocket({ type: 'rider:location_update', payload }))
        .then((res) => {
          if (res && res.ok === false) return this.sendOverHttp(payload);
          this.snapshot = { ...this.snapshot, transport: 'socket' };
          this.publish();
          return undefined;
        })
        .catch(() => this.sendOverHttp(payload));
    } else {
      this.sendOverHttp(payload);
    }
    return true;
  }

  sendOverHttp(payload) {
    return Promise.resolve(this.sendHttp(payload))
      .then((res) => {
        this.snapshot = { ...this.snapshot, transport: 'http' };
        this.publish();
        return res;
      })
      .catch((err) => {
        // A network failure is not a reason to invent a position or to hammer the
        // endpoint. The fix is retried on the next fix, which the throttle makes
        // no more frequent than the configured interval.
        this.setStatus(GPS_UNAVAILABLE, { code: 'NETWORK', recoverable: true, message: 'Could not send your position.' });
        this.snapshot = { ...this.snapshot, lastError: this.lastError };
        this.publish();
        return { ok: false, error: err?.message || 'network failure' };
      });
  }
}

export function createRiderGpsEngine(deps) {
  return new RiderGpsEngine(deps);
}
