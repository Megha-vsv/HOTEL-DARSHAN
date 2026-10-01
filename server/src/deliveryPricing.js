// Hotel Darshan - distance based delivery pricing.
//
// This module is the single source of truth for "how far is this order and what
// does it cost". The server uses it to price and to enforce the delivery radius;
// client/src/data/deliveryPricing.js mirrors it so the cart, checkout and order
// summary show exactly the same numbers. tests/_tmp_delivery.test.mjs asserts the
// two stay in agreement.

export const DEFAULT_DELIVERY_SLABS = [
  { maxKm: 2, fee: 20 },
  { maxKm: 4, fee: 30 },
  { maxKm: 5, fee: 40 },
  { maxKm: 6, fee: 50 }
];

export const DEFAULT_MAX_DELIVERY_KM = 6;

// Fallback coordinates: Char Rasta, Mosda Road, Dediapada (Narmada district).
// Mirrors the seeded `hotel_coords` setting.
//
// These were previously 21.533 / 73.999, which reverse-geocodes to Kukarmunda
// Taluka in Tapi district - about 43 km from Dediapada. Measuring every
// delivery from the wrong origin put real Dediapada customers outside the
// radius, so the coordinates now point at Dediapada itself.
export const DEFAULT_HOTEL_COORDS = { lat: 21.6271369, lng: 73.5898076 };

const EARTH_RADIUS_KM = 6371;

/**
 * Shown when an address has no usable coordinates. Delivery is refused rather
 * than guessed at: charging the nearest slab for a pin point we never located
 * is how a customer ends up either overcharged or told they are in range when
 * they are not. Self Pickup is unaffected.
 */
export const UNRESOLVED_DISTANCE_REASON =
  'Unable to determine delivery distance for this address. Please verify the address.';

const toFiniteNumber = (value) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Normalise the `delivery_slabs` setting into a clean ascending list.
 * Accepts the stored JSON string, an array, or nothing at all.
 */
export function parseDeliverySlabs(raw) {
  let candidate = raw;

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) return DEFAULT_DELIVERY_SLABS.map((s) => ({ ...s }));
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return DEFAULT_DELIVERY_SLABS.map((s) => ({ ...s }));
    }
  }

  if (!Array.isArray(candidate) || candidate.length === 0) {
    return DEFAULT_DELIVERY_SLABS.map((s) => ({ ...s }));
  }

  const slabs = candidate
    .map((slab) => ({
      maxKm: toFiniteNumber(slab?.maxKm),
      fee: toFiniteNumber(slab?.fee)
    }))
    .filter((slab) => slab.maxKm !== null && slab.maxKm > 0 && slab.fee !== null && slab.fee >= 0)
    .sort((a, b) => a.maxKm - b.maxKm);

  return slabs.length ? slabs : DEFAULT_DELIVERY_SLABS.map((s) => ({ ...s }));
}

/** Maximum delivery radius, falling back to the seeded default. */
export function parseMaxDeliveryKm(raw) {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return DEFAULT_MAX_DELIVERY_KM;
  return value;
}

/** Hotel coordinates, stored as JSON in the `hotel_coords` setting. */
export function parseHotelCoords(raw) {
  let candidate = raw;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return { ...DEFAULT_HOTEL_COORDS };
    }
  }
  const lat = toFiniteNumber(candidate?.lat);
  const lng = toFiniteNumber(candidate?.lng);
  if (lat === null || lng === null) return { ...DEFAULT_HOTEL_COORDS };
  return { lat, lng };
}

function hasCoords(point) {
  const lat = toFiniteNumber(point?.lat ?? point?.latitude);
  const lng = toFiniteNumber(point?.lng ?? point?.longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Great-circle distance in kilometres. */
export function distanceKmBetween(from, to) {
  const a = hasCoords(from);
  const b = hasCoords(to);
  if (!a || !b) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Price a home-delivery order from its distance.
 *
 * - distance beyond `maxKm`  -> not allowed (no charge is ever applied)
 * - distance cannot be known -> not allowed, and the customer is asked to fix the
 *                               address, because an unlocated address can be
 *                               neither priced nor radius-checked honestly
 * - distance past the last slab -> charged the last (highest) slab, so raising
 *                               the radius never leaves a price gap
 *
 * `freeDeliveryAbove` (rupees) keeps the existing free-delivery behaviour: an order
 * at or above that amount is not charged a delivery fee. It never makes an
 * out-of-radius address deliverable.
 */
export function quoteDelivery({
  distanceKm,
  slabs,
  maxKm,
  freeDeliveryAbove = null,
  itemTotal = 0
} = {}) {
  const parsedSlabs = parseDeliverySlabs(slabs);
  const radius = parseMaxDeliveryKm(maxKm);
  const distance = toFiniteNumber(distanceKm);

  const base = {
    slabs: parsedSlabs,
    maxKm: radius,
    distanceKm: distance === null ? null : Math.round(distance * 100) / 100,
    distanceKnown: distance !== null
  };

  if (distance === null) {
    return {
      ...base,
      allowed: false,
      fee: 0,
      slab: null,
      freeDelivery: false,
      unresolved: true,
      reason: UNRESOLVED_DISTANCE_REASON
    };
  }

  if (distance > radius) {
    return {
      ...base,
      allowed: false,
      fee: 0,
      slab: null,
      freeDelivery: false,
      unresolved: false,
      reason: `Sorry, delivery is currently available only within ${formatKm(radius)} of Hotel Darshan.`
    };
  }

  const slab =
    parsedSlabs.find((entry) => distance <= entry.maxKm) ||
    parsedSlabs[parsedSlabs.length - 1];

  const threshold = toFiniteNumber(freeDeliveryAbove);
  const eligibleForFree =
    threshold !== null && threshold > 0 && toFiniteNumber(itemTotal) !== null && Number(itemTotal) >= threshold;

  return {
    ...base,
    allowed: true,
    fee: eligibleForFree ? 0 : slab.fee,
    slab,
    freeDelivery: eligibleForFree,
    unresolved: false,
    reason: null
  };
}

function formatKm(value) {
  return Number.isInteger(value) ? `${value} km` : `${Number(value.toFixed(2))} km`;
}

/** Convenience wrapper: resolve a quote straight from the settings row map. */
export function quoteFromSettings(settings, { coords, itemTotal } = {}) {
  const hotel = parseHotelCoords(settings?.hotel_coords);
  const distance = coords ? distanceKmBetween(coords, hotel) : null;

  return quoteDelivery({
    distanceKm: distance,
    slabs: settings?.delivery_slabs,
    maxKm: settings?.max_delivery_km,
    freeDeliveryAbove: settings?.free_delivery_above,
    itemTotal
  });
}
