// Geodesy for the rider's device.
//
// Plain functions with no React and no browser globals, so the same code that runs
// on a phone can be run in a test. The one rule everything here obeys: a point is
// either a real fix or it is nothing. There is no default position, no
// last-known fallback and no interpolation between two fixes, because every one
// of those would put a rider on a map somewhere they are not.

const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (Number(deg) * Math.PI) / 180;

export function isUsablePoint(point) {
  if (!point) return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Great-circle distance in kilometres, or null when either end is unusable.
 *
 * Null rather than zero: a caller that cannot measure the distance must not
 * display "0 km away", which would read as "the rider is here".
 */
export function distanceKm(from, to) {
  if (!isUsablePoint(from) || !isUsablePoint(to)) return null;
  const dLat = toRad(Number(to.lat) - Number(from.lat));
  const dLng = toRad(Number(to.lng) - Number(from.lng));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const metresBetween = (from, to) => {
  const km = distanceKm(from, to);
  return km === null ? null : km * 1000;
};

/** Read the delivery pin off an order, in the same shape the server uses. */
export function customerPointOf(order) {
  const a = order?.address || {};
  const lat = Number(a.latitude);
  const lng = Number(a.longitude);
  return isUsablePoint({ lat, lng }) ? { lat, lng } : null;
}

/**
 * Is this fix good enough to act on?
 *
 * Accuracy is the radius of the circle the fix is actually sure of. A fix wider
 * than the geofence it is being used to prove cannot prove anything, and sending
 * it would let a rider standing two streets away register as arrived at the
 * hotel. A fix with no accuracy reading is rejected too: unknown precision is
 * not good precision.
 */
export function assessFix(fix, { maxAcceptableAccuracyMetres = 100, maxFixAgeSeconds = 60, now = Date.now() } = {}) {
  if (!fix || !isUsablePoint(fix)) {
    return { usable: false, reason: 'NO_FIX', message: 'No position available' };
  }
  const accuracy = Number(fix.accuracy);
  if (!Number.isFinite(accuracy) || accuracy < 0) {
    return { usable: false, reason: 'UNKNOWN_ACCURACY', message: 'Position accuracy unknown' };
  }
  if (accuracy > maxAcceptableAccuracyMetres) {
    return {
      usable: false,
      reason: 'POOR_ACCURACY',
      accuracy,
      message: `Position is only accurate to ${Math.round(accuracy)} m`
    };
  }
  const at = Number(fix.timestamp);
  if (Number.isFinite(at) && at > 0) {
    const ageSeconds = (now - at) / 1000;
    // A negative age means the device clock is ahead of ours. Clamped rather than
    // rejected: a wrong clock is not a reason to discard a good fix.
    if (ageSeconds > maxFixAgeSeconds) {
      return { usable: false, reason: 'STALE_FIX', ageSeconds, message: 'Position is out of date' };
    }
  }
  return { usable: true, accuracy, point: { lat: Number(fix.lat), lng: Number(fix.lng) } };
}

/**
 * Where the rider is relative to the two places this delivery cares about.
 *
 * Both distances are reported, and `atHotel`/`nearCustomer` are only ever true
 * from a real fix inside a real radius. Reaching the hotel says the rider has
 * arrived - it does not say the food has been collected, and nothing here may be
 * used to claim that it has.
 */
export function locate({ point, order, config }) {
  const out = {
    point: point || null,
    accuracy: point?.accuracy ?? null,
    at: point?.at ?? null,
    distanceToHotelKm: null,
    distanceToHotelMetres: null,
    distanceToCustomerKm: null,
    distanceToCustomerMetres: null,
    atHotel: false,
    nearCustomer: false,
    hasCustomerPin: false
  };
  if (!isUsablePoint(point)) return out;

  const toHotel = metresBetween(point, config.hotel);
  if (toHotel !== null) {
    out.distanceToHotelKm = toHotel / 1000;
    out.distanceToHotelMetres = toHotel;
    out.atHotel = toHotel <= config.hotelArrivalMetres;
  }

  const customer = customerPointOf(order);
  if (customer) {
    out.hasCustomerPin = true;
    const toCustomer = metresBetween(point, customer);
    if (toCustomer !== null) {
      out.distanceToCustomerKm = toCustomer / 1000;
      out.distanceToCustomerMetres = toCustomer;
      out.nearCustomer = toCustomer <= config.nearCustomerMetres;
    }
  }
  return out;
}

/** The two geofence flags reduced to the one the rider's screen should react to. */
export function logicalStage(locateResult, { order, hasBeenPickedUp }) {
  if (!hasBeenPickedUp) {
    // Before the collection the only thing a position can mean is "at the hotel".
    // Reporting "near the customer" on the way to collect would be nonsense.
    return locateResult.atHotel ? 'RIDER_ARRIVED_AT_HOTEL' : null;
  }
  if (locateResult.nearCustomer) return 'RIDER_NEAR_CUSTOMER';
  return null;
}

/**
 * The device's own error, turned into something a rider can act on.
 *
 * `PERMISSION_DENIED` is the one that must not be retried into oblivion: the
 * rider has to change a setting, so continuing to poll produces a request stream
 * that can never succeed.
 */
export function classifyGeolocationError(error) {
  const code = error?.code;
  switch (code) {
    case 1:
      return { code: 'PERMISSION_DENIED', recoverable: false, message: 'Location permission denied. Enable it in your browser settings to share your position.' };
    case 2:
      return { code: 'POSITION_UNAVAILABLE', recoverable: true, message: 'Your position is unavailable right now.' };
    case 3:
      return { code: 'TIMEOUT', recoverable: true, message: 'Your device could not get a GPS fix in time.' };
    default:
      return {
        code: 'UNKNOWN',
        recoverable: true,
        message: error?.message || 'Your position could not be read.'
      };
  }
}

export function formatKm(km) {
  if (km === null || km === undefined || !Number.isFinite(Number(km))) return '—';
  const n = Number(km);
  if (n < 1) return `${Math.round(n * 1000)} m`;
  return `${n.toFixed(2)} km`;
}

/**
 * Read a timestamp the server wrote, as a number of milliseconds.
 *
 * The function itself moved to `lib/time.js` so that every order-time display
 * could share one correct parse instead of each reimplementing it: four sites
 * got this wrong and three of those grew their own partial fix. It is
 * re-exported here because the GPS call sites already import it from this file.
 */
export { parseServerTimestamp } from './time.js';
