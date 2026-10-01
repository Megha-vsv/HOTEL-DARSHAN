// Hotel Darshan - order lifecycle, status history, ETA and geofencing.
//
// This module owns the rules that every screen depends on, so the customer
// tracker, the kitchen board, the rider app and the admin list cannot disagree
// about what stage an order is in or what may happen next. It is deliberately
// free of Express and Socket.IO concerns: it takes plain data and returns
// decisions, which keeps the rules testable on their own.

import { parseSqliteTimestamp } from './time.js';

/**
 * Home delivery: kitchen hands the order to a rider, who collects it and
 * delivers it.
 *
 * Self pickup: the customer collects it, so the rider stages never appear.
 * Mixing the two is the bug this prevents - a pickup order can never reach
 * RIDER_ASSIGNED.
 */
export const DELIVERY_FLOW = [
  'ORDER_PLACED',
  'ORDER_CONFIRMED',
  'PREPARING',
  'READY',
  'RIDER_ASSIGNED',
  'RIDER_GOING_TO_HOTEL',
  'RIDER_ARRIVED_AT_HOTEL',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'RIDER_NEAR_CUSTOMER',
  'DELIVERED',
  'COMPLETED'
];

export const PICKUP_FLOW = [
  'ORDER_PLACED',
  'ORDER_CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'COMPLETED'
];

/**
 * No further transition is allowed out of these.
 *
 * `DELIVERED` is deliberately *not* here: a home delivery is handed over and then
 * closed out as `COMPLETED`. Before this split, `DELIVERED` was treated as final
 * and the two ideas were conflated - "the customer has their food" (finished) and
 * "nothing more can happen" (terminal) are different questions.
 */
export const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

/** The order is over from the customer's point of view. */
export const FINISHED_STATUSES = ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'];

/** Statuses that mean the order is still being worked on. */
export const ACTIVE_STATUSES = [
  'ORDER_PLACED',
  'ORDER_CONFIRMED',
  'PREPARING',
  'READY',
  'READY_FOR_PICKUP',
  'RIDER_ASSIGNED',
  'RIDER_GOING_TO_HOTEL',
  'RIDER_ARRIVED_AT_HOTEL',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'RIDER_NEAR_CUSTOMER'
];

/** Kitchen board columns. Once an order leaves these it is history, not work. */
export const KITCHEN_ACTIVE_STATUSES = [
  'ORDER_PLACED',
  'ORDER_CONFIRMED',
  'PREPARING',
  'READY',
  'READY_FOR_PICKUP'
];

/** Every status the system recognises, across both flows. */
export const ALL_STATUSES = [
  ...new Set([...DELIVERY_FLOW, ...PICKUP_FLOW, 'CANCELLED', 'REJECTED'])
];

/**
 * Alternative spellings that resolve to a stored status.
 *
 * The database keeps the values above, unchanged, so no existing row is rewritten
 * and no history becomes unreadable. These are the other names the same stage is
 * known by - "PLACED" for "ORDER_PLACED", and so on. Accepting them here is what
 * stops two screens calling one stage by two names.
 */
export const STATUS_ALIASES = {
  PLACED: 'ORDER_PLACED',
  ORDERPLACED: 'ORDER_PLACED',
  NEW: 'ORDER_PLACED',
  CONFIRMED: 'ORDER_CONFIRMED',
  ORDERCONFIRMED: 'ORDER_CONFIRMED',
  ACCEPTED: 'ORDER_CONFIRMED',
  COOKING: 'PREPARING',
  KITCHEN_ACCEPTED: 'PREPARING',
  FOOD_READY: 'READY',
  READY_FOR_DELIVERY: 'READY',
  // Self pickup: the customer is the one who collects, which the shared
  // PICKED_UP status records. The alias keeps the pickup vocabulary honest
  // without inventing a second stored value for the same moment.
  PICKED_UP_BY_CUSTOMER: 'PICKED_UP',
  COLLECTED: 'PICKED_UP',
  ON_THE_WAY: 'OUT_FOR_DELIVERY',
  ARRIVING_NOW: 'RIDER_NEAR_CUSTOMER',
  RIDER_ARRIVED: 'RIDER_ARRIVED_AT_HOTEL',
  AT_HOTEL: 'RIDER_ARRIVED_AT_HOTEL',
  REJECTED_BY_RIDER: 'REJECTED'
};

/**
 * The one place a status name becomes the stored status.
 *
 * Case, spaces, hyphens and the `#` habit are all absorbed, and the recognised
 * aliases are folded onto the stored value. Anything unrecognised returns null
 * rather than a guess, so a typo is refused instead of quietly inventing a stage.
 */
export function resolveStatus(input) {
  if (input === null || input === undefined) return null;
  const key = String(input).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  const canonical = STATUS_ALIASES[key] || key;
  return ALL_STATUSES.includes(canonical) ? canonical : null;
}

// ------------------------------------------------------------------ riders

/** Statuses the server derives from the rider's position rather than a request. */
export const AUTO_DERIVED_STATUSES = new Set(['RIDER_ARRIVED_AT_HOTEL', 'RIDER_NEAR_CUSTOMER']);

/**
 * A rider's working state.
 *
 *   OFFLINE    not signed in to the app; must not be given work
 *   ONLINE     signed in but paused; not taking work
 *   AVAILABLE  signed in and willing to be given one order
 *   BUSY       already carrying the maximum number of orders
 *
 * Only AVAILABLE is eligible for assignment, which is what stops the "logged in
 * but resting" rider from being handed a delivery.
 */
export const RIDER_STATES = ['OFFLINE', 'ONLINE', 'AVAILABLE', 'BUSY'];

export function isRiderState(value) {
  return RIDER_STATES.includes(String(value ?? '').trim().toUpperCase());
}

/** May a rider in this state be given another order? */
export function riderCanReceiveOrders(state) {
  return String(state ?? '').trim().toUpperCase() === 'AVAILABLE';
}

/**
 * Why an order has no rider, in the words the admin screen shows.
 *
 * A ready delivery with nobody to take it is not an error and not a bug - it is
 * a queue. The admin needs to be told that plainly rather than shown a blank or,
 * worse, a fabricated assignment.
 */
export const ASSIGNMENT_STATES = {
  /** Ready at the counter, no eligible rider exists yet. */
  WAITING: 'WAITING_FOR_RIDER',
  /** A rider holds it. */
  ASSIGNED: 'RIDER_ASSIGNED',
  /** Self-pickup: no rider is ever involved. */
  NOT_REQUIRED: 'NOT_REQUIRED'
};

/** The admin-facing message for a given assignment state. */
export const ASSIGNMENT_MESSAGES = {
  [ASSIGNMENT_STATES.WAITING]: 'Waiting for delivery partner',
  [ASSIGNMENT_STATES.ASSIGNED]: 'Rider assigned',
  [ASSIGNMENT_STATES.NOT_REQUIRED]: 'Not required for self-pickup'
};

/**
 * Every reason a rider may be skipped, and the message each produces.
 *
 * Returning the reason rather than a bare false is the point: the admin screen
 * can say "3 riders online, all at capacity" instead of an unexplained silence,
 * and a test can assert on the specific rule rather than on a symptom.
 */
export const INELIGIBLE_REASONS = {
  NOT_FOUND: 'Rider not found',
  NOT_A_RIDER: 'That account is not a rider',
  DISABLED: 'This rider account is disabled',
  OFFLINE: 'Rider is signed out',
  PAUSED: 'Rider is online but not taking work',
  BUSY: 'Rider is already carrying a delivery',
  NO_LOCATION: 'Rider has not shared a location yet',
  STALE_LOCATION: 'Rider location is out of date',
  NOT_ASSIGNABLE: 'Rider is not available'
};

/**
 * Decide whether one rider may be given one delivery, and say why not.
 *
 * All of these are pure decisions over data the caller has already read, so the
 * rules can be checked without a database and every caller - the auto-assigner,
 * the admin fleet list and the tests - gets the same answer to the same question.
 *
 * The checks, in order:
 *  - the account exists, is a rider, and is not disabled
 *  - the rider is signed in: OFFLINE never qualifies
 *  - the rider is taking work: ONLINE means signed in but paused
 *  - the rider is below the one-delivery cap
 *  - if a location is required, it must be present and recent
 *
 * `now` is a parameter rather than a call to the clock so that "recent" is
 * testable rather than dependent on when the test happens to run.
 */
export function evaluateRiderEligibility(
  {
    rider,
    riderState,
    activeCount = 0,
    cap = 1,
    locationRequired = false,
    maxLocationAgeMinutes = 15,
    now = new Date()
  } = {}
) {
  if (!rider) return { eligible: false, reason: INELIGIBLE_REASONS.NOT_FOUND, code: 'NOT_FOUND' };
  if (String(rider.role || '').toLowerCase() !== 'rider') {
    return { eligible: false, reason: INELIGIBLE_REASONS.NOT_A_RIDER, code: 'NOT_A_RIDER' };
  }
  if (rider.is_active === 0) {
    return { eligible: false, reason: INELIGIBLE_REASONS.DISABLED, code: 'DISABLED' };
  }

  const state = String(riderState ?? '').trim().toUpperCase();
  if (!isRiderState(state) || state === 'OFFLINE') {
    return { eligible: false, reason: INELIGIBLE_REASONS.OFFLINE, code: 'OFFLINE' };
  }
  if (state === 'ONLINE') {
    return { eligible: false, reason: INELIGIBLE_REASONS.PAUSED, code: 'PAUSED' };
  }
  if (activeCount >= cap) {
    return { eligible: false, reason: INELIGIBLE_REASONS.BUSY, code: 'BUSY' };
  }

  if (locationRequired) {
    // Shared parser rather than an inline `replace(' ', 'T') + 'Z'`: the same
    // conversion was written out in four files, and this one is what decides
    // whether a rider's last fix is recent enough to assign an order.
    const atMs = parseSqliteTimestamp(rider?.location_at);
    const at = atMs === null ? null : new Date(atMs);
    if (!at) {
      return { eligible: false, reason: INELIGIBLE_REASONS.NO_LOCATION, code: 'NO_LOCATION' };
    }
    const ageMinutes = (now.getTime() - at.getTime()) / 60000;
    if (ageMinutes > maxLocationAgeMinutes) {
      return { eligible: false, reason: INELIGIBLE_REASONS.STALE_LOCATION, code: 'STALE_LOCATION' };
    }
  }

  if (!riderCanReceiveOrders(state)) {
    return { eligible: false, reason: INELIGIBLE_REASONS.NOT_ASSIGNABLE, code: 'NOT_ASSIGNABLE' };
  }
  return { eligible: true, reason: null, code: null };
}

/**
 * Order a set of candidates best-first.
 *
 * The ranking is the requirement, applied in order: how far the rider is from the
 * hotel, then whether they are free right now, then how many deliveries they are
 * already carrying, then how many they have taken recently. That last one is a
 * fairness term - with a small fleet, distance alone would hand every job to
 * whoever happens to live nearest, so a rider who has just finished waits behind
 * one who has been idle.
 *
 * A rider with no position sorts last at every level: an estimate is better than
 * a guess, but a guess that is never wrong is better than none.
 */
export function rankRiderCandidates(candidates) {
  return [...candidates].sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      Number(b.eligible ? 1 : 0) - Number(a.eligible ? 1 : 0) ||
      a.activeCount - b.activeCount ||
      a.recentAssignments - b.recentAssignments ||
      a.id - b.id
  );
}

/** Customer-facing copy for each stage, used by the tracking stepper. */
export const STATUS_LABELS = {
  ORDER_PLACED: 'Order Placed',
  ORDER_CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready',
  RIDER_ASSIGNED: 'Rider Assigned',
  RIDER_GOING_TO_HOTEL: 'Rider On The Way',
  RIDER_ARRIVED_AT_HOTEL: 'Rider At Hotel',
  PICKED_UP: 'Picked Up',
  OUT_FOR_DELIVERY: 'Out For Delivery',
  RIDER_NEAR_CUSTOMER: 'Arriving Now',
  DELIVERED: 'Delivered',
  READY_FOR_PICKUP: 'Ready For Pickup',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected'
};

/** Which flow an order follows. */
export function flowFor(orderType) {
  return orderType === 'pickup' ? PICKUP_FLOW : DELIVERY_FLOW;
}

/** Can nothing more happen to this order? */
export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/** Is the order over from the customer's point of view? */
export function isFinished(status) {
  return FINISHED_STATUSES.includes(status);
}

export function isActive(status) {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * The single authority on whether an order may move between two stages.
 *
 * Both names are resolved first, so `canTransition('ready', 'Placed')` and
 * `canTransition('READY', 'PICKED_UP_BY_CUSTOMER')` are answered the same way as
 * the stored spellings. A name that resolves to nothing is refused outright.
 *
 * Rules, in order:
 *  - an unrecognised stage is never allowed
 *  - cancellation and rejection are always allowed while the order is open,
 *    because a refusal has to be possible at any point
 *  - a terminal state is final (COMPLETED cannot go back to PREPARING)
 *  - the target must belong to the order's own flow, so a pickup order can never
 *    enter a rider stage
 *  - the target must be the very next stage in that flow. Allowing a jump would
 *    let PREPARING go straight to DELIVERED and skip the whole rider chain.
 *
 * The two automatic rider stages are the exception: they are derived from GPS
 * by the server, never requested by a client.
 */
export function canTransition(from, to, orderType, { allowAuto = false } = {}) {
  const fromStatus = resolveStatus(from);
  const toStatus = resolveStatus(to);

  if (!fromStatus) return { ok: false, reason: `Unknown current status "${from}"` };
  if (!toStatus) return { ok: false, reason: `Unknown status "${to}"` };

  // A refusal is always permitted while the order is still open.
  if (toStatus === 'CANCELLED' || toStatus === 'REJECTED') {
    if (isTerminal(fromStatus)) {
      return { ok: false, reason: `Order is already ${STATUS_LABELS[fromStatus] || fromStatus} and cannot change` };
    }
    return { ok: true };
  }

  if (isTerminal(fromStatus)) {
    return { ok: false, reason: `Order is already ${STATUS_LABELS[fromStatus] || fromStatus} and cannot change` };
  }

  const flow = flowFor(orderType);
  if (!flow.includes(toStatus)) {
    return { ok: false, reason: `"${STATUS_LABELS[toStatus] || toStatus}" is not a valid stage for a ${orderType} order` };
  }
  if (fromStatus === toStatus) {
    return { ok: false, reason: `Order is already ${STATUS_LABELS[toStatus] || toStatus}` };
  }

  const fromIndex = flow.indexOf(fromStatus);
  if (fromIndex === -1) {
    return { ok: false, reason: `Order is in "${fromStatus}", which is not a valid stage for a ${orderType} order` };
  }
  const toIndex = flow.indexOf(toStatus);

  // Geofence-derived stages may legitimately be recorded by the server only.
  if (AUTO_DERIVED_STATUSES.has(toStatus) && !allowAuto) {
    return { ok: false, reason: `"${STATUS_LABELS[toStatus] || toStatus}" is set automatically from the rider location` };
  }
  if (allowAuto && toIndex !== fromIndex + 1) {
    return { ok: false, reason: `"${STATUS_LABELS[toStatus] || toStatus}" does not follow ${STATUS_LABELS[fromStatus] || fromStatus}` };
  }

  if (toIndex !== fromIndex + 1) {
    return {
      ok: false,
      reason: `Cannot go from ${STATUS_LABELS[fromStatus] || fromStatus} straight to ${STATUS_LABELS[toStatus] || toStatus}`
    };
  }
  return { ok: true };
}

/**
 * The single next stage, plus cancellation, for a given actor.
 *
 * Only the immediately following stage is offered, so the rider and kitchen
 * screens can never present a button that the server would refuse. The status is
 * resolved first, so a caller holding an alias is answered from the same place.
 */
export function nextActions(status, orderType, role) {
  const current = resolveStatus(status);
  if (!current) return [];
  const flow = flowFor(orderType);
  const index = flow.indexOf(current);
  if (index === -1 || isTerminal(current)) return [];

  const upcoming = flow[index + 1];
  if (!upcoming) return [];

  const permitted = rolesForStatus(upcoming, orderType);
  if (role && !permitted.includes(role)) return [];

  // A stage the server sets from GPS is not a button.
  if (AUTO_DERIVED_STATUSES.has(upcoming)) {
    const after = flow[index + 2];
    if (!after) return [];
    return rolesForStatus(after, orderType).includes(role) ? [after] : [];
  }
  return [upcoming];
}

/**
 * Every stage the server would accept next for this order, whatever the caller's
 * role. The tracking payload publishes this so a screen can show the whole road
 * ahead without hardcoding a list of its own.
 */
export function upcomingStages(status, orderType) {
  const current = resolveStatus(status);
  if (!current) return [];
  const flow = flowFor(orderType);
  const index = flow.indexOf(current);
  if (index === -1) return [];
  return flow.slice(index + 1);
}

/**
 * Roles permitted to set a given status. Server-side authorisation, so a
 * tampered client request cannot promote itself.
 */
export function rolesForStatus(status, orderType) {
  if (orderType === 'pickup') {
    if (['ORDER_CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(status)) {
      return ['admin', 'chef'];
    }
    return ['admin'];
  }
  if (['ORDER_CONFIRMED', 'PREPARING', 'READY'].includes(status)) {
    return ['admin', 'chef'];
  }
  if (['RIDER_ASSIGNED', 'RIDER_GOING_TO_HOTEL', 'RIDER_ARRIVED_AT_HOTEL', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_NEAR_CUSTOMER', 'DELIVERED'].includes(status)) {
    return ['admin', 'rider'];
  }
  if (status === 'CANCELLED' || status === 'REJECTED') {
    return ['admin', 'chef'];
  }
  return ['admin'];
}

// ---------------------------------------------------------------- geofencing

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km; null when either point is unusable. */
export function distanceKmBetween(from, to) {
  const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const a = { lat: num(from?.lat), lng: num(from?.lng) };
  const b = { lat: num(to?.lat), lng: num(to?.lng) };
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  if (Math.abs(a.lat) > 90 || Math.abs(a.lng) > 180) return null;
  if (Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return null;

  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const DEFAULT_GEOfENCE = {
  hotelMetres: 150,
  nearCustomerMetres: 500
};

/**
 * Which automatic status change, if any, the rider's latest position implies.
 * Returns null when there is nothing to do - including when the GPS fix is
 * missing, so a lost signal can never invent progress.
 */
export function autoStatusForRiderLocation({ status, orderType, riderPoint, hotelPoint, customerPoint, geofence = DEFAULT_GEOfENCE }) {
  if (orderType === 'pickup') return null;
  if (!riderPoint) return null;

  const toCustomer = distanceKmBetween(riderPoint, customerPoint);
  const toHotel = distanceKmBetween(riderPoint, hotelPoint);

  if (status === 'RIDER_GOING_TO_HOTEL' && toHotel !== null && toHotel * 1000 <= geofence.hotelMetres) {
    return { status: 'RIDER_ARRIVED_AT_HOTEL', reason: 'Rider is within the hotel geofence' };
  }
  if (status === 'OUT_FOR_DELIVERY' && toCustomer !== null && toCustomer * 1000 <= geofence.nearCustomerMetres) {
    return { status: 'RIDER_NEAR_CUSTOMER', reason: 'Rider is within the customer geofence' };
  }
  return null;
}

// --------------------------------------------------------------------- ETA

export const DEFAULT_TIMING = {
  prepMinutes: 15,
  handoverMinutes: 2,
  /** Average delivery speed used to turn a straight-line distance into minutes. */
  kmh: 25
};

/**
 * Estimate the minutes remaining.
 *
 * Computed as the sum of the legs that are still outstanding, rather than one
 * number per stage, so the estimate can only fall as real work completes and
 * never silently ignores the delivery run:
 *
 *   remaining preparation + rider-to-hotel + handover + hotel-to-customer
 *
 * A leg that has already happened is not counted. When a leg's distance is
 * unknown the estimate is flagged `approximate` instead of being invented.
 */
export function computeEta({
  status,
  orderType,
  distanceKm = null,
  riderToHotelKm = null,
  now = new Date(),
  timing = DEFAULT_TIMING
} = {}) {
  const t = { ...DEFAULT_TIMING, ...timing };
  const travelMinutes = (km) => {
    if (km === null || km === undefined || !Number.isFinite(Number(km))) return null;
    // Short hops still cost time to start, park and hand over.
    return Math.max(1, Math.round((Number(km) / t.kmh) * 60));
  };

  const breakdown = [];
  let minutes = 0;
  let known = true;

  const add = (label, value) => {
    if (value === null || value === undefined) {
      known = false;
      return;
    }
    minutes += value;
    breakdown.push({ label, minutes: value });
  };

  // A delivered-but-not-yet-closed order is over for the customer, so it has no
  // time remaining. `isFinished` rather than `isTerminal`, because DELIVERED can
  // still be closed out as COMPLETED but the food has already arrived.
  const finished = isFinished(status);
  if (finished) {
    return { minutes: 0, breakdown: [], approximate: false, at: now.toISOString() };
  }

  const isPickup = orderType === 'pickup';
  const flow = flowFor(isPickup ? 'pickup' : 'delivery');
  const reached = (stage) => {
    const at = flow.indexOf(stage);
    const now2 = flow.indexOf(status);
    return at !== -1 && now2 !== -1 && now2 >= at;
  };

  // --- preparation ---
  if (!reached('PREPARING')) {
    add('Preparation', t.prepMinutes);
  } else if (status === 'PREPARING') {
    add('Finishing preparation', Math.max(2, Math.round(t.prepMinutes / 2)));
  }

  if (isPickup) {
    // The customer collects it; there is no rider and no travel leg.
    if (status === 'READY_FOR_PICKUP') add('Collection', 2);
    else if (status === 'PICKED_UP') add('Finishing up', 1);
  } else {
    // --- rider to the hotel, until the food is actually collected ---
    if (!reached('PICKED_UP')) {
      // Once the rider is standing at the hotel that leg is behind them.
      if (!reached('RIDER_ARRIVED_AT_HOTEL')) {
        if (riderToHotelKm !== null) add('Rider to hotel', travelMinutes(riderToHotelKm));
        // No rider position yet means the wait is genuinely unknown.
        else if (reached('RIDER_ASSIGNED')) known = false;
      }
      add('Handover', t.handoverMinutes);
    }
    // --- the run to the customer, until it is handed over ---
    if (!reached('DELIVERED')) {
      add('Delivery to customer', travelMinutes(distanceKm));
    }
  }

  return {
    minutes: Math.max(0, minutes),
    breakdown,
    approximate: !known,
    at: now.toISOString()
  };
}

/** Minutes between the order being placed and now, for the elapsed-time view. */
export function elapsedMinutes(order, now = new Date()) {
  const startMs = parseSqliteTimestamp(order?.created_at);
  if (startMs === null) return null;
  return Math.max(0, Math.round((now.getTime() - startMs) / 60000));
}
