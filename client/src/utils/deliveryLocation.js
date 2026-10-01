// Single place for reading and publishing the customer's delivery location.
//
// The distance shown in the cart and at checkout is priced from the coordinates
// stored here, so this module also owns the change notification that keeps those
// figures in step with whichever address is actually selected.

const STORAGE_KEY = 'hotelDarshanLocation';
export const LOCATION_CHANGE_EVENT = 'hd-location-change';

// GPS jitter is well under a metre, so anything tighter than this is the same point.
const SAME_POINT_EPSILON = 1e-6;

const toNumber = (value) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Normalise anything coordinate-shaped into `{ lat, lng }`, or null. */
export function normaliseCoords(value) {
  if (!value) return null;
  const lat = toNumber(value.lat ?? value.latitude);
  const lng = toNumber(value.lng ?? value.longitude);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

/** True when both points are the same location (null only matches null). */
export function sameCoords(a, b) {
  if (!a || !b) return !a && !b;
  return Math.abs(a.lat - b.lat) < SAME_POINT_EPSILON && Math.abs(a.lng - b.lng) < SAME_POINT_EPSILON;
}

/** The stored delivery location, or null when absent/corrupt. */
export function readStoredLocation() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...parsed, coords: normaliseCoords(parsed.coords) };
  } catch {
    return null;
  }
}

/**
 * Store the location and tell the rest of the app. Nothing is written when the
 * coordinates are unchanged, so repeated renders cannot resurrect a stale value.
 */
export function writeStoredLocation(next) {
  const current = readStoredLocation();
  if (current && sameCoords(current.coords, next.coords) && current.address === next.address) {
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...(current || {}),
      address: next.address ?? current?.address ?? '',
      coords: next.coords ?? null,
      updatedAt: new Date().toISOString()
    }));
  } catch {
    return false;
  }
  notifyLocationChange();
  return true;
}

/** Announce that the delivery location changed. */
export function notifyLocationChange() {
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

const API_BASE = '/api';

/**
 * Look up the coordinates of a typed address so it is priced from where the
 * address actually is, rather than from wherever the device happens to be.
 *
 * The lookup runs on our own API because OpenStreetMap requires a User-Agent
 * header, which a browser is not allowed to set.
 *
 * Returns `{ coords, label }`, or null when the lookup cannot be trusted, so the
 * caller can fall back to the current location instead of guessing.
 */
export async function forwardGeocode(parts = {}, token = null) {
  const query = new URLSearchParams();
  for (const key of ['street', 'landmark', 'city', 'state', 'pincode']) {
    const value = (parts[key] || '').trim();
    if (value) query.set(key, value);
  }
  if (!query.toString()) return null;

  try {
    const res = await fetch(`${API_BASE}/geocode?${query.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) return null;
    const data = await res.json();
    const coords = normaliseCoords(data ? { lat: data.lat, lng: data.lng } : null);
    if (!coords) return null;
    return { coords, label: data.label || '' };
  } catch {
    // Offline or unavailable: the caller keeps the current location.
    return null;
  }
}
