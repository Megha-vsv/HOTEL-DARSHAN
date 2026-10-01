// Order tracking service: the single place that changes an order's status.
//
// Every status change in the system goes through `applyStatusChange`, which
// validates the transition and the caller's role, writes the history row,
// recomputes the ETA, and returns the order for broadcasting. Because there is
// exactly one write path, the customer tracker, admin, kitchen and rider cannot
// drift apart: they all read what this wrote.

import { db } from './db.js';
import { parseSqliteTimestamp } from './time.js';
import { staffStatus } from './staffIdentity.js';
import {
  canTransition,
  isFinished,
  isRiderState,
  nextActions,
  upcomingStages,
  DELIVERY_FLOW,
  resolveStatus,
  rolesForStatus,
  computeEta,
  distanceKmBetween,
  autoStatusForRiderLocation,
  evaluateRiderEligibility,
  flowFor,
  rankRiderCandidates,
  riderCanReceiveOrders,
  ASSIGNMENT_MESSAGES,
  ASSIGNMENT_STATES,
  INELIGIBLE_REASONS,
  STATUS_LABELS
} from './orderTracking.js';

/**
 * Order statuses that a client may not set directly. They are derived from the
 * rider's position by the server, so a request naming one is refused.
 */
export const AUTO_STATUSES = new Set(['RIDER_ARRIVED_AT_HOTEL', 'RIDER_NEAR_CUSTOMER']);

const num = (v, fallback) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

/** Tracking tunables, read fresh so an admin change takes effect immediately. */
export function trackingConfig() {
  const s = getSettings();
  return {
    hotel: JSON.parse(s.hotel_coords || '{"lat":21.6271369,"lng":73.5898076}'),
    nearCustomerMetres: num(s.rider_near_customer_m, 500),
    hotelMetres: num(s.rider_hotel_geofence_m, 150),
    prepMinutes: num(s.prep_time_mins, 15),
    speedKmh: num(s.delivery_speed_kmh, 25),
    autoAssign: String(s.auto_assign_riders ?? '1') !== '0',
    // One rider, one active delivery. The floor is 1 and never 0: a cap of zero
    // would make every order permanently unassignable.
    maxActivePerRider: Math.max(1, num(s.rider_max_active_orders, 1)),
    // A rider must have shared a position, and it must be recent, before they are
    // given a delivery. Off by default: refusing work because a phone has not
    // checked in yet would be worse than assigning on distance-known-elsewhere.
    locationRequired: String(s.rider_location_required ?? '0') !== '0',
    maxLocationAgeMinutes: num(s.rider_location_max_age_mins, 15),
    recentLoadWindowMinutes: num(s.rider_recent_load_window_mins, 60)
  };
}

export function formatOrder(o) {
  if (!o) return o;
  return {
    ...o,
    items: JSON.parse(o.items_json || '[]'),
    address: JSON.parse(o.address_json || '{}')
  };
}

export function getOrder(idOrNumber) {
  const raw = String(idOrNumber ?? '').trim();
  const key = raw.replace(/^#+/, '').toUpperCase();
  const order = /^\d+$/.test(raw)
    ? db.prepare('SELECT * FROM orders WHERE id = ?').get(raw)
    : db.prepare('SELECT * FROM orders WHERE UPPER(order_number) = ?').get(key);
  return order ? formatOrder(order) : null;
}

export function getHistory(orderId) {
  const rows = db.prepare(
    'SELECT status, changed_by, changed_by_role, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY id ASC'
  ).all(orderId);
  // Each entry is exposed in both the stored column names and the camelCase names
  // the tracking UI uses, so a consumer can read either without translating.
  return rows.map((r) => ({
    ...r,
    changedBy: r.changed_by,
    changedByRole: r.changed_by_role,
    timestamp: r.created_at
  }));
}

/**
 * The customer's destination coordinates, as stored with the order.
 *
 * Accepts either a formatted order or a raw row, because the address lives in
 * `address_json` and only `formatOrder` parses it. Reading it from a raw row
 * silently yields no point, which would quietly disable the geofence.
 */
export function customerPoint(order) {
  const a = order?.address || (order?.address_json ? JSON.parse(order.address_json || '{}') : {}) || {};
  const lat = parseFloat(a.latitude);
  const lng = parseFloat(a.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

/** Recompute and store the ETA for the order's current stage. */
export function refreshEta(order) {
  const cfg = trackingConfig();
  const rider = order.rider_id
    ? db.prepare('SELECT lat, lng FROM rider_presence WHERE rider_id = ?').get(order.rider_id)
    : null;
  const riderPoint = rider && rider.lat != null ? { lat: rider.lat, lng: rider.lng } : null;

  const eta = computeEta({
    status: order.status,
    orderType: order.order_type,
    distanceKm: order.delivery_distance_km,
    riderToHotelKm: riderPoint ? distanceKmBetween(riderPoint, cfg.hotel) : null,
    timing: { prepMinutes: cfg.prepMinutes, kmh: cfg.speedKmh }
  });

  db.prepare('UPDATE orders SET eta_minutes = ?, eta_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(eta.minutes, order.id);
  return eta;
}

/**
 * Record a status change. Does not validate - callers must go through
 * `applyStatusChange`, which is the only path that broadcasts.
 *
 * A stage that is already the last one recorded is not written again, so two
 * callers racing on the same order, or a retried request, cannot fill the
 * timeline with identical rows and show the customer a stage "change" that never
 * happened. The comparison is against the previous row rather than the order's
 * current status, because this runs after the status has already been written -
 * and because a genuine later return to a stage (an order handed back and
 * reassigned) must still be recorded.
 */
function writeStatus(orderId, status, actor, note) {
  const previous = db.prepare(
    'SELECT status FROM order_status_history WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orderId);
  if (previous && previous.status === status) return false;
  db.prepare(`
    INSERT INTO order_status_history (order_id, status, changed_by, changed_by_role, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, status, actor?.name || 'system', actor?.role || 'system', note || null);
  return true;
}

/**
 * Record a status change that did not itself move the order along - for example
 * a rider being attached to an order that is still being prepared. Keeps the
 * timeline complete without inventing a stage.
 */
export function recordHistory(orderId, status, actor, note) {
  writeStatus(orderId, status, actor, note);
  return getHistory(orderId);
}

/** Timestamp columns written when an order enters a given stage. */
const STAGE_TIMESTAMP_COLUMN = {
  RIDER_GOING_TO_HOTEL: 'started_route_at',
  RIDER_ARRIVED_AT_HOTEL: 'rider_arrived_hotel_at',
  PICKED_UP: 'picked_up_at',
  RIDER_NEAR_CUSTOMER: 'near_customer_at',
  DELIVERED: 'delivered_at',
  COMPLETED: 'completed_at',
  CANCELLED: 'cancelled_at',
  REJECTED: 'cancelled_at'
};

/**
 * The single status write path.
 *
 * `actor` is the authenticated user. Validation covers the transition, the role
 * permitted to set it, and - for a rider - that the order is actually theirs.
 * Returns `{ ok, order, eta, history }` or `{ ok: false, status, error }`.
 *
 * Every check runs first and writes nothing. Only once all of them have passed
 * does the change commit, and the commit is one transaction: the status, the
 * stage timestamp, the history row, the ETA and any rider bookkeeping either all
 * land or none of them do. Callers broadcast only after this returns, so no
 * screen is ever told about a change that was then rolled back.
 */
export function applyStatusChange({ orderId, to, actor, note = null, allowSystem = false, method = 'manual' }) {
  const target = resolveStatus(to);
  if (!target) return { ok: false, status: 400, error: `Unknown status "${to}"` };

  const order = getOrder(orderId);
  if (!order) return { ok: false, status: 404, error: 'Order not found' };

  if (AUTO_STATUSES.has(target) && !allowSystem) {
    return { ok: false, status: 400, error: 'This stage is set automatically from the rider location' };
  }

  // `allowSystem` marks a server-derived stage, so the transition check has to be
  // told the same thing. Without this the geofence stages are rejected as
  // "set automatically from the rider location" by the very code that derives them.
  const check = canTransition(order.status, target, order.order_type, { allowAuto: allowSystem });
  if (!check.ok) return { ok: false, status: 409, error: check.reason };

  // Server-side authorisation. Never trust a role or id supplied by the client.
  const permitted = rolesForStatus(target, order.order_type);
  if (!allowSystem && !permitted.includes(actor.role)) {
    return { ok: false, status: 403, error: `A ${actor.role} cannot set this order to ${STATUS_LABELS[target] || target}` };
  }
  if (actor.role === 'rider') {
    if (order.order_type === 'pickup') {
      return { ok: false, status: 403, error: 'Riders cannot manage self-pickup orders' };
    }
    if (order.rider_id !== actor.id) {
      return { ok: false, status: 403, error: 'This order is assigned to another rider' };
    }
  }

  const isPickup = order.order_type === 'pickup';

  // A delivery order cannot be marked delivered before it was actually collected.
  if (target === 'DELIVERED' && !isPickup && !order.picked_up_at) {
    return { ok: false, status: 409, error: 'The order has not been picked up yet' };
  }
  // Self pickup completes on collection.
  if (target === 'COMPLETED' && isPickup && order.status !== 'PICKED_UP') {
    return { ok: false, status: 409, error: 'The customer has not collected this order yet' };
  }

  // Which rider, if any, this change takes work away from. Reported so the caller
  // can tell that rider their delivery is over, after the commit.
  let releasedRiderId = null;

  const commit = db.transaction(() => {
    const sets = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [target];

    const tsColumn = STAGE_TIMESTAMP_COLUMN[target];
    if (tsColumn) sets.push(`${tsColumn} = CURRENT_TIMESTAMP`);

    // The moment a rider takes responsibility for the job. Normally already written
    // by the assignment that put the order in their hands, and guarded here so it is
    // never overwritten - it stays the acceptance time even though there is no
    // separate ACCEPTED stage in this status machine, because the project has one
    // flow and a second vocabulary here would be the duplicate status system the
    // rider lifecycle deliberately avoids.
    //
    // The guard also covers an order that reached RIDER_ASSIGNED without going
    // through assignRider, so acceptance is never left unstamped.
    if (actor.role === 'rider' && order.status === 'RIDER_ASSIGNED' && !order.accepted_at) {
      sets.push('accepted_at = CURRENT_TIMESTAMP');
    }

    if (target === 'DELIVERED') {
      sets.push('completion_method = ?');
      params.push(method);
      if (!isPickup && order.payment_status !== 'paid') sets.push("payment_status = 'paid'");
    }
    if (target === 'DELIVERED' || target === 'COMPLETED' || target === 'CANCELLED' || target === 'REJECTED') {
      // The delivery is over, so the rider is carrying nothing. The rider is
      // captured now, but released below - after the status has been written.
      // Releasing first would still count this order as active load and leave the
      // rider marked BUSY on a delivery that no longer exists.
      if (order.rider_id) releasedRiderId = order.rider_id;
      if (target === 'CANCELLED' || target === 'REJECTED') {
        // The rider is released by clearing the columns that answer "who is
        // carrying this now" - and with them goes any record that they ever were.
        // The rider they actually were is kept, so a cancellation does not erase
        // the delivery from the shift they spent getting there.
        sets.push('rider_id = NULL', 'rider_name = NULL', 'rider_phone = NULL', 'assigned_at = NULL', 'accepted_at = NULL');
        if (order.rider_id) {
          sets.push('released_rider_id = ?');
          params.push(order.rider_id);
        }
      }
    }

    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...params, order.id);

    // Now the order reads as finished, so the rider's load is genuinely zero and
    // the derived state is correct. Clearing the pointer, stopping the tracking
    // and moving BUSY -> AVAILABLE all happen in this same commit as the status,
    // so no reader can ever see a finished order with its rider still busy.
    if (releasedRiderId) releaseRider(releasedRiderId, order.id);

    writeStatus(order.id, target, actor, note);

    // The rider's own feed, written in the same commit as the status it describes.
    // The pre-update row is used on purpose: a cancellation clears `rider_id` as
    // part of the write above, so asking the new row who to notify would find
    // nobody and the rider who was actually carrying it would never be told.
    // The row is kept so the caller can push it once the commit has landed.
    const notice = target !== 'RIDER_ASSIGNED' ? recordNotificationForRider(order, target) : null;

    let updated = getOrder(order.id);
    const eta = refreshEta(updated);

    // Food ready for delivery looks for a rider; if there is none the order stays
    // READY and is picked up automatically when one frees up.
    let assignment = null;
    if (target === 'READY' && !isPickup) {
      assignment = autoAssignRider(updated);
      if (assignment) {
        updated = getOrder(order.id);
        refreshEta(updated);
        // The rider's own notices for this - "the order is yours" and "the food is
        // ready at the counter" - are raised by `assignRider`, which is the one
        // place a rider becomes attached, whichever path got them there.
      }
    }

    return { order: updated, eta, assignment, notice, releasedRiderId };
  });

  const committed = commit();
  return {
    ok: true,
    order: committed.order,
    eta: committed.eta,
    history: getHistory(order.id),
    assignment: committed.assignment,
    // The rider's own notice for this stage, if one was written. Returned rather
    // than emitted so the caller can publish it only after the commit, alongside
    // the other announcements for this change.
    notice: committed.notice,
    releasedRiderId: committed.releasedRiderId
  };
}

// ------------------------------------------------------------ rider assignment

/**
 * How many orders a rider is currently carrying.
 *
 * Read from the orders table rather than from `rider_presence.active_order_id`,
 * because that column holds one pointer while a rider may hold several, and it is
 * the orders that decide whether the rider is actually busy.
 */
export function activeOrderCount(riderId) {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM orders
    WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
  `).get(riderId).c;
}

/** A rider's row, with the state normalised to a known value. */
export function getRiderState(riderId) {
  const row = db.prepare('SELECT * FROM rider_presence WHERE rider_id = ?').get(riderId);
  if (!row) return { rider_id: riderId, rider_state: 'OFFLINE', is_available: 0, lat: null, lng: null, location_at: null, active_order_id: null, active_count: 0 };
  const active = activeOrderCount(riderId);
  const state = ['OFFLINE', 'ONLINE', 'AVAILABLE', 'BUSY'].includes(row.rider_state)
    ? row.rider_state
    : (row.is_available ? 'AVAILABLE' : 'OFFLINE');
  return { ...row, rider_state: state, is_available: state === 'AVAILABLE' ? 1 : 0, active_count: active };
}

/**
 * Write a rider's state, keeping the legacy `is_available` flag as a projection
 * of it so anything still reading that column agrees with the real state.
 */
function writeRiderState(riderId, state) {
  db.prepare(`
    INSERT INTO rider_presence (rider_id, is_available, rider_state, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(rider_id) DO UPDATE SET
      is_available = excluded.is_available,
      rider_state = excluded.rider_state,
      updated_at = CURRENT_TIMESTAMP
  `).run(riderId, state === 'AVAILABLE' ? 1 : 0, state);
}

/**
 * Work out what a rider's state should be, and write it.
 *
 * OFFLINE and ONLINE are chosen by the rider. BUSY and AVAILABLE are derived from
 * how much they are carrying, because a rider cannot be AVAILABLE while already
 * at the cap - and a rider who finishes a delivery becomes AVAILABLE again
 * without having to remember to press anything.
 *
 * `respectRiderChoice` is for the rider's own explicit request: when they say
 * AVAILABLE they mean it, so the stored OFFLINE must not win. Bookkeeping driven
 * by an order moving (assignment, completion, a GPS ping) leaves it on, because
 * then the rider's choice is the thing being preserved.
 */
export function syncRiderState(riderId, { respectRiderChoice = true } = {}) {
  const row = db.prepare('SELECT rider_state, is_available FROM rider_presence WHERE rider_id = ?').get(riderId);
  if (!row) return null;
  const current = ['OFFLINE', 'ONLINE', 'AVAILABLE', 'BUSY'].includes(row.rider_state) ? row.rider_state : 'OFFLINE';
  // A rider who has paused or signed out stays that way whatever their load.
  if (respectRiderChoice && (current === 'OFFLINE' || current === 'ONLINE')) {
    if (current !== row.rider_state) writeRiderState(riderId, current);
    return current;
  }
  const cap = trackingConfig().maxActivePerRider;
  const next = activeOrderCount(riderId) >= cap ? 'BUSY' : 'AVAILABLE';
  if (next !== current) writeRiderState(riderId, next);
  return next;
}

/**
 * End a rider's active delivery: stop tracking it and free the rider up.
 *
 * Two different things are cleared, and the difference matters. The rider's own
 * position is kept - the rider is still standing somewhere, and discarding it
 * would make them rank last for the next order. What stops is the link to the
 * order: the active pointer, and the order's copy of the rider's position. Left
 * behind, that stale point would keep the customer's tracker showing a rider
 * standing at the last place they were, on an order nobody is delivering any
 * more.
 *
 * The rider's state is then re-derived rather than assumed. A rider who was
 * carrying this and is still signed in becomes AVAILABLE; one who signed out
 * stays OFFLINE, because telling a signed-out rider they are available is how
 * they get given work they will never collect.
 */
function releaseRider(riderId, orderId = null) {
  if (!riderId) return;
  const pointer = db.prepare('SELECT active_order_id FROM rider_presence WHERE rider_id = ?').get(riderId);
  const orderBeingDropped = orderId || pointer?.active_order_id || null;

  db.prepare('UPDATE rider_presence SET active_order_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE rider_id = ?').run(riderId);
  if (orderBeingDropped) {
    // Matched on the order id alone: on a cancellation the order's own `rider_id`
    // has already been cleared, and the caller has verified this rider held it.
    db.prepare(`
      UPDATE orders SET rider_lat = NULL, rider_lng = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(orderBeingDropped);
  }
  return syncRiderState(riderId);
}

/**
 * Every rider, with everything needed to judge them, and the verdict.
 *
 * The reason is kept for every rider, not just the chosen one, so the admin
 * screen can explain an empty queue: "4 riders online, 3 at capacity, 1 has no
 * location" rather than nothing at all. That is also what makes a stuck order
 * diagnosable instead of merely broken.
 */
export function listRiderCandidates({ now = new Date() } = {}) {
  const cfg = trackingConfig();
  const rows = db.prepare(`
    SELECT u.id, u.name, u.phone, u.role, u.is_active,
           p.rider_state, p.is_available, p.lat, p.lng, p.location_at, p.active_order_id
    FROM users u
    LEFT JOIN rider_presence p ON p.rider_id = u.id
    WHERE u.role = 'rider' AND u.is_active = 1
  `).all();

  return rows.map((r) => {
    const activeCount = activeOrderCount(r.id);
    const recentAssignments = recentAssignmentCount(r.id, cfg.recentLoadWindowMinutes);
    const verdict = evaluateRiderEligibility({
      rider: r,
      riderState: r.rider_state,
      activeCount,
      cap: cfg.maxActivePerRider,
      locationRequired: cfg.locationRequired,
      maxLocationAgeMinutes: cfg.maxLocationAgeMinutes,
      now
    });
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      role: r.role,
      rider_state: isRiderState(r.rider_state) ? r.rider_state : 'OFFLINE',
      activeCount,
      recentAssignments,
      active_order_id: r.active_order_id,
      lat: r.lat,
      lng: r.lng,
      location_at: r.location_at,
      // No stored position means an unknown distance, which sorts last rather than
      // being invented. Nothing here is ever fabricated to make a choice possible.
      distanceKm: r.lat == null || r.lng == null
        ? Infinity
        : distanceKmBetween({ lat: r.lat, lng: r.lng }, cfg.hotel),
      eligible: verdict.eligible,
      ineligibleReason: verdict.reason,
      ineligibleCode: verdict.code
    };
  });
}

/**
 * How many deliveries this rider was given in the recent window.
 *
 * Counted from the order's own history rather than from an assignment counter, so
 * it cannot drift from reality: a rider handed back an order still counts it, and
 * one that was never assigned does not.
 */
export function recentAssignmentCount(riderId, windowMinutes = 60) {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM orders
    WHERE rider_id = ?
      AND assigned_at IS NOT NULL
      AND assigned_at >= datetime('now', ?)
  `).get(riderId, `-${Math.max(0, Math.round(windowMinutes))} minutes`).c;
}

/**
 * The riders who could take a delivery right now, best candidate first.
 *
 * Returns the ranked list and the rejected ones with reasons, so a caller can
 * either take the first name or explain the silence. `pick()` is a convenience
 * for the common case of wanting only the chosen rider.
 */
export function findEligibleRiders({ now = new Date() } = {}) {
  const all = listRiderCandidates({ now });
  const eligible = rankRiderCandidates(all.filter((r) => r.eligible));
  const rejected = all.filter((r) => !r.eligible);
  return { eligible, rejected, all };
}

/** The single best rider for a delivery, or null with the reasons why not. */
export function findEligibleRider({ now = new Date() } = {}) {
  const { eligible, rejected } = findEligibleRiders({ now });
  return eligible.length ? eligible[0] : null;
}

/**
 * Choose the nearest rider who is actually able to take the order.
 *
 * Kept as the name the rest of the service already uses. Returns null when nobody
 * qualifies, in which case the order simply stays READY and
 * `retryPendingAssignments` will pick it up later. Assignment is never random and
 * never falls back to a rider who is signed out, paused, disabled or at capacity.
 */
export function findAvailableRider() {
  return findEligibleRider();
}

/**
 * Attach a rider to an order. The one place `rider_id` is ever written.
 *
 * Every condition is checked before anything is written - the order exists, it is
 * a home delivery, it is actually ready for a rider, it is not already someone
 * else's, the rider is an active rider account, and they are not already at the
 * cap - and then the order, the history and the rider's state are written
 * together. A rider arriving at the cap is marked BUSY in the same commit that
 * gave them the order, so they cannot be handed a second one by a race.
 *
 * `riderId` must already be the authenticated identity. This function does not
 * accept a rider chosen by the caller.
 */
export function assignRider({ orderId, riderId, actor, note = null, method = 'manual' }) {
  const order = getOrder(orderId);
  if (!order) return { ok: false, status: 404, error: 'Order not found' };
  if (order.order_type === 'pickup') {
    return { ok: false, status: 400, error: 'Self-pickup orders do not need a rider' };
  }

  const rider = db.prepare("SELECT id, name, phone FROM users WHERE id = ? AND role = 'rider' AND is_active = 1").get(riderId);
  if (!rider) return { ok: false, status: 404, error: 'Rider not found' };

  // Already this rider's order: nothing to do, and reporting it as an assignment
  // would add a second history row for a stage the order is already in.
  if (order.rider_id === rider.id) {
    return { ok: true, order, alreadyAssigned: true, assignment: { rider_id: rider.id, rider_name: rider.name } };
  }
  if (order.rider_id) {
    return { ok: false, status: 409, error: 'This order already has a rider' };
  }

  // The order has to actually be waiting for a rider. A pickup order, or one the
  // kitchen has not finished, is refused here rather than half-assigned.
  const check = canTransition(order.status, 'RIDER_ASSIGNED', order.order_type, { allowAuto: true });
  if (!check.ok) return { ok: false, status: 409, error: check.reason };

  // A rider may only take an order when they are actually free to. The full rule
  // set is evaluated here, not just the state, so a disabled account or a stale
  // position is refused with its own reason rather than slipping through.
  const verdict = riderEligibilityFor(rider.id);
  if (!verdict.eligible) {
    return { ok: false, status: 409, error: verdict.error, ineligibleCode: verdict.code };
  }

  const commit = db.transaction(() => {
    // Re-check inside the transaction. The checks above ran a moment earlier, and
    // a second rider claiming this order, or a cancellation, can land in between.
    // `status = 'READY'` and `rider_id IS NULL` together mean: only the first
    // writer proceeds, and everyone else updates zero rows and is told 409.
    const updated = db.prepare(`
      UPDATE orders
      SET rider_id = ?, rider_name = ?, rider_phone = ?,
          status = 'RIDER_ASSIGNED', assigned_at = CURRENT_TIMESTAMP,
          accepted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND rider_id IS NULL AND status = 'READY'
    `).run(rider.id, rider.name, rider.phone, order.id);
    if (updated.changes === 0) {
      const error = new Error('This order is no longer waiting for a rider');
      error.assignConflict = true;
      throw error;
    }

    writeStatus(order.id, 'RIDER_ASSIGNED', actor, note);
    // Same commit as the assignment, so the rider's feed can never claim they were
    // given an order that the transaction then rolled back.
    const attached = getOrder(order.id);
    recordNotificationForRider(attached, 'RIDER_ASSIGNED');
    // An order is only assignable once it is READY, so this rider is being handed
    // something that is already waiting at the counter.
    if (order.status === 'READY') recordNotificationForRider(attached, 'READY');

    // The rider is marked BUSY in the same commit that gave them the order, so
    // there is no window in which a second assigner can see them as still free.
    writeRiderState(rider.id, 'BUSY');
    db.prepare(`
      UPDATE rider_presence
      SET active_order_id = ?, is_available = 0, rider_state = 'BUSY',
          updated_at = CURRENT_TIMESTAMP
      WHERE rider_id = ?
    `).run(order.id, rider.id);

    return getOrder(order.id);
  });

  let updated;
  try {
    updated = commit();
  } catch (err) {
    if (err.assignConflict) return { ok: false, status: 409, error: err.message };
    throw err;
  }
  refreshEta(updated);

  return {
    ok: true,
    order: updated,
    assignment: {
      rider_id: rider.id,
      rider_name: rider.name,
      rider_phone: rider.phone,
      method,
      distanceKm: verdict.distanceKm
    }
  };
}

/**
 * The full eligibility verdict for one rider, phrased as an assignment refusal.
 *
 * Wraps the pure rule so the assigner, the fleet list and the tests all read the
 * same verdict, and so a refusal carries a message a rider can act on.
 */
export function riderEligibilityFor(riderId) {
  const candidate = listRiderCandidates().find((r) => r.id === riderId);
  if (!candidate) {
    return { eligible: false, error: INELIGIBLE_REASONS.NOT_FOUND, code: 'NOT_FOUND', distanceKm: null };
  }
  if (candidate.eligible) {
    return { eligible: true, error: null, code: null, distanceKm: candidate.distanceKm, candidate };
  }
  return {
    eligible: false,
    error: candidate.ineligibleCode === 'BUSY'
      ? 'You are already carrying a delivery'
      : candidate.ineligibleReason,
    code: candidate.ineligibleCode,
    distanceKm: candidate.distanceKm,
    candidate
  };
}

/**
 * Attach the nearest eligible rider to a READY delivery order.
 *
 * Returns a summary, or null when the order should simply stay READY. Runs
 * inside the caller's transaction when there is one, so a kitchen marking an
 * order ready either commits the stage and the assignment together, or neither.
 *
 * When nobody can be found the reasons are logged rather than swallowed, because
 * "no rider" and "four riders, all at capacity" need different responses from the
 * admin, and a silent null makes them indistinguishable.
 */
export function autoAssignRider(order) {
  if (!trackingConfig().autoAssign) return null;
  if (!order || order.order_type === 'pickup') return null;
  if (order.rider_id) return null;
  if (resolveStatus(order.status) !== 'READY') return null;

  // A rider already holding this order is filtered out by the caller's
  // `order.rider_id` check, so there is nothing to exclude here.
  const { eligible, rejected } = findEligibleRiders();
  const rider = eligible.length ? eligible[0] : null;
  if (!rider) {
    if (rejected.length) {
      const tally = rejected.reduce((acc, r) => {
        acc[r.ineligibleCode] = (acc[r.ineligibleCode] || 0) + 1;
        return acc;
      }, {});
      console.log(
        `[RiderAssignment] Order ${order.id} stays READY - no eligible rider ` +
        `(${Object.entries(tally).map(([code, n]) => `${n}x ${code}`).join(', ')})`
      );
    } else {
      console.log(`[RiderAssignment] Order ${order.id} stays READY - no rider accounts exist`);
    }
    return null;
  }

  const where = rider.distanceKm === Infinity
    ? 'position unknown'
    : `${rider.distanceKm.toFixed(2)} km from the hotel`;

  const result = assignRider({
    orderId: order.id,
    riderId: rider.id,
    actor: { name: 'Auto assignment', role: 'system' },
    note: `Nearest available rider (${where})`,
    method: 'auto'
  });
  // A refusal here is a race, not a bug: another claim won between choosing and
  // committing. The order stays READY and the next retry picks it up.
  if (!result.ok) return null;
  return { order_id: order.id, ...result.assignment, distanceKm: rider.distanceKm };
}

/**
 * Try to place a rider on every delivery order that is READY and unassigned.
 * Called when a rider comes online or finishes a delivery, so an order that was
 * waiting does not stay stuck.
 *
 * Each attempt is its own transaction: one order that cannot be filled does not
 * abandon the rest of the queue.
 */
export function retryPendingAssignments() {
  const pending = db.prepare(`
    SELECT id FROM orders
    WHERE status = 'READY' AND order_type = 'delivery' AND rider_id IS NULL
    ORDER BY id ASC
  `).all();
  const results = [];
  for (const o of pending) {
    let a = null;
    try {
      a = autoAssignRider(getOrder(o.id));
    } catch (err) {
      console.error(`RIDER ASSIGNMENT FAILED for order ${o.id}:`, err.message);
    }
    if (a) results.push(a);
  }
  return results;
}

/**
 * Hand an order back to the pool when the rider holding it cannot finish it.
 *
 * A rider who goes offline mid-delivery would otherwise leave the order stranded
 * in their name with nobody able to move it, because the rider is the only actor
 * permitted to advance it. The order returns to READY so the next eligible rider
 * can be given it, and the timeline records why.
 */
export function returnOrderToPool(orderId, { actor, reason = 'Rider became unavailable' } = {}) {
  const order = getOrder(orderId);
  if (!order) return { ok: false, status: 404, error: 'Order not found' };
  if (!order.rider_id) return { ok: false, status: 409, error: 'This order has no rider' };
  if (isFinished(order.status)) {
    return { ok: false, status: 409, error: 'This order is already finished' };
  }

  const previousRider = order.rider_id;
  // The order has to go back to a stage a rider can be found for.
  const target = order.order_type === 'pickup' ? 'READY_FOR_PICKUP' : 'READY';

  const commit = db.transaction(() => {
    db.prepare(`
      UPDATE orders
    SET status = ?, rider_id = NULL, rider_name = NULL, rider_phone = NULL,
        rider_lat = NULL, rider_lng = NULL, assigned_at = NULL, accepted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND rider_id = ?
    `).run(target, order.id, previousRider);

    // The RIDER_ASSIGNED row is left in place. It genuinely happened, and a
    // customer watching the timeline should not see a stage disappear because the
    // order was handed back. Who holds the order now is `rider_id`, not history.
    writeStatus(order.id, target, actor, reason);

    releaseRider(previousRider, order.id);
    return getOrder(order.id);
  });

  const updated = commit();
  refreshEta(updated);
  const assignment = autoAssignRider(updated);
  return { ok: true, order: assignment ? getOrder(order.id) : updated, assignment };
}

// ------------------------------------------------------------- rider location

/**
 * Store a rider position and advance the order automatically if the rider has
 * entered a geofence. Only the current position is kept, so tracking does not
 * accumulate an endless trail of GPS fixes.
 */
export function recordRiderLocation({ riderId, lat, lng, orderId }) {
  const rider = db.prepare('SELECT id, name, role FROM users WHERE id = ? AND role = ?').get(riderId, 'rider');
  if (!rider) return { ok: false, status: 404, error: 'Rider not found' };

  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
    // 422, not 400: the request and its fields arrived, they were not usable
    // values. Matches `validateCoordinatePair`, so both location endpoints answer
    // the same question the same way.
    return { ok: false, status: 422, error: 'Invalid coordinates', code: 'INVALID_LOCATION' };
  }

  db.prepare(`
    INSERT INTO rider_presence (rider_id, is_available, rider_state, lat, lng, location_at, updated_at)
    VALUES (?, 0, 'OFFLINE', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(rider_id) DO UPDATE SET
      lat = excluded.lat, lng = excluded.lng,
      location_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  `).run(riderId, la, ln);

  // Only the rider's own active delivery can be advanced by their position. The
  // order is looked up by the rider's own id, so a client cannot point a position
  // at somebody else's order and move it.
  const carried = db.prepare(`
    SELECT * FROM orders
    WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
    ORDER BY id ASC
  `).all(riderId);

  // The order the rider named, but only if it is genuinely one of theirs. Falling
  // back to their most recent job keeps a plain GPS ping useful when the client
  // did not know which order it was reporting for. Read through `getOrder` so the
  // row is formatted - the geofence needs the parsed address.
  const active = orderId
    ? carried.map((o) => getOrder(o.id)).find((o) => o.id === Number(orderId))
    : carried.length
      ? getOrder(carried[carried.length - 1].id)
      : null;

  if (!active) {
    return { ok: true, order: null, advanced: null, riderState: getRiderState(riderId).rider_state };
  }

  db.prepare('UPDATE orders SET rider_lat = ?, rider_lng = ? WHERE id = ?').run(la, ln, active.id);

  // The pointer and the rider's state move together, so the two cannot disagree
  // about what this rider is doing right now.
  const commitPointer = db.transaction(() => {
    db.prepare('UPDATE rider_presence SET active_order_id = ? WHERE rider_id = ?').run(active.id, riderId);
    syncRiderState(riderId);
  });
  commitPointer();

  const tcfg = trackingConfig();
  const auto = autoStatusForRiderLocation({
    status: active.status,
    orderType: active.order_type,
    riderPoint: { lat: la, lng: ln },
    hotelPoint: tcfg.hotel,
    customerPoint: customerPoint(active),
    geofence: { hotelMetres: tcfg.hotelMetres, nearCustomerMetres: tcfg.nearCustomerMetres }
  });

  if (!auto) {
    const eta = refreshEta(getOrder(active.id));
    return { ok: true, order: getOrder(active.id), advanced: null, eta, riderState: getRiderState(riderId).rider_state };
  }

  const result = applyStatusChange({
    orderId: active.id,
    to: auto.status,
    actor: { id: riderId, name: rider.name, role: 'rider' },
    note: auto.reason,
    allowSystem: true,
    method: 'geofence'
  });

  // `status` has to travel with the result: the route turns a refusal into
  // `res.status(result.status)`, and a missing status becomes a 500. `advanced`
  // is only reported when the change actually landed, so a caller never advances
  // a screen on a stage the server refused to write.
  return {
    ok: result.ok,
    status: result.status,
    order: result.order || getOrder(active.id),
    advanced: result.ok ? auto.status : null,
    error: result.error,
    eta: result.eta,
    riderState: getRiderState(riderId).rider_state
  };
}

/**
 * Put a rider into a state of their own choosing.
 *
 * OFFLINE and ONLINE are what a rider selects. Coming back online retries any
 * order that has been waiting, so a rider who signs on actually gets work.
 * AVAILABLE and BUSY are derived from their load, so asking for AVAILABLE while
 * already at the cap is answered as BUSY rather than a lie the assigner would
 * then have to work around.
 *
 * Going offline mid-delivery hands those orders back to the pool, because a
 * signed-out rider is the only actor permitted to advance them.
 */
export function setRiderState({ riderId, state }) {
  const rider = db.prepare('SELECT id, name FROM users WHERE id = ? AND role = ?').get(riderId, 'rider');
  if (!rider) return { ok: false, status: 404, error: 'Rider not found' };

  const requested = String(state ?? '').trim().toUpperCase();
  if (!['OFFLINE', 'ONLINE', 'AVAILABLE', 'BUSY'].includes(requested)) {
    return { ok: false, status: 400, error: 'State must be one of OFFLINE, ONLINE, AVAILABLE, BUSY' };
  }

  // An admin (or a rider) may ask for a state the load does not support; the load
  // wins, so the stored state is always truthful.
  const chosen = ['OFFLINE', 'ONLINE'].includes(requested) ? requested : null;

  const commit = db.transaction(() => {
    db.prepare(`
      INSERT INTO rider_presence (rider_id, is_available, rider_state, updated_at)
      VALUES (?, 0, 'OFFLINE', CURRENT_TIMESTAMP)
      ON CONFLICT(rider_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `).run(riderId);

    if (chosen) writeRiderState(riderId, chosen);
    // The rider asked for a load-derived state, so it is derived from the load
    // rather than from whatever they were before.
    else syncRiderState(riderId, { respectRiderChoice: false });
  });

  // The state is committed first, so the hand-back below sees the rider as
  // offline and cannot immediately re-derive them back to AVAILABLE.
  commit();

  let returned = [];
  if (chosen === 'OFFLINE') {
    // Anything this rider was carrying goes back to the waiting list.
    const carrying = db.prepare(`
      SELECT id FROM orders
      WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
      ORDER BY id ASC
    `).all(riderId);
    for (const o of carrying) {
      try {
        const res = returnOrderToPool(o.id, { actor: { name: rider.name, role: 'rider' }, reason: 'Rider went offline' });
        if (res.ok) returned.push(o.id);
      } catch (err) {
        console.error(`RETURN TO POOL FAILED for order ${o.id}:`, err.message);
      }
    }
  }

  const after = getRiderState(riderId);
  const assigned = riderCanReceiveOrders(after.rider_state) ? retryPendingAssignments() : [];

  return { ok: true, state: after.rider_state, available: after.rider_state === 'AVAILABLE', returned, assigned };
}

/**
 * Backwards-compatible wrapper over `setRiderState`.
 *
 * The old flag only had two values, so it maps onto the new state machine:
 * available means "take work", unavailable means "signed out".
 */
export function setRiderAvailability({ riderId, available }) {
  return setRiderState({ riderId, state: available ? 'AVAILABLE' : 'OFFLINE' });
}

/**
 * The rider app's on/off switch.
 *
 * Deliberately not `setRiderState`. There, ONLINE means exactly what it says -
 * signed in, not taking work - and a rider left in it is ineligible for orders on
 * purpose, which is how the admin board pauses somebody without signing them out.
 * A rider app has only a two-position toggle, so "I'm working" has to mean
 * AVAILABLE when there is nothing to carry and BUSY when there is, and this is
 * where that is decided. The stored state ends on one of those two, never on the
 * ambiguous ONLINE, so what the assigner sees and what the rider's own screen
 * shows are the same value.
 *
 * Signing out still hands back any delivery in progress: a rider who has gone off
 * shift is the only actor allowed to move their order, and leaving it with them
 * would strand the customer.
 */
export function riderAvailability({ riderId, online }) {
  if (!online) return setRiderState({ riderId, state: 'OFFLINE' });

  const rider = db.prepare('SELECT id, name FROM users WHERE id = ? AND role = ?').get(riderId, 'rider');
  if (!rider) return { ok: false, status: 404, error: 'Rider not found' };

  const commit = db.transaction(() => {
    // Clears OFFLINE first, which is what makes the rider eligible to be derived
    // at all; `syncRiderState` leaves an OFFLINE rider exactly as it finds them.
    db.prepare(`
      INSERT INTO rider_presence (rider_id, is_available, rider_state, updated_at)
      VALUES (?, 0, 'ONLINE', CURRENT_TIMESTAMP)
      ON CONFLICT(rider_id) DO UPDATE SET
        rider_state = 'ONLINE', updated_at = CURRENT_TIMESTAMP
    `).run(riderId);
    // Then the load decides, and the rider's choice is deliberately not consulted:
    // they asked to be working, not to be in a particular state.
    return syncRiderState(riderId, { respectRiderChoice: false });
  });
  const state = commit();

  // A rider who just signed in gets whatever has been waiting, which is what makes
  // pressing the button worth anything.
  const assigned = riderCanReceiveOrders(state) ? retryPendingAssignments() : [];
  return { ok: true, state, available: state === 'AVAILABLE', returned: [], assigned };
}

/**
 * The orders a rider should see: what they are carrying, and what is waiting at
 * the counter for anybody to take.
 *
 * Rider-scoped on purpose. The rider app used to read the admin order list and
 * filter it in the browser, which showed every delivery in the building and hid
 * the ones actually assigned to them, because assignment moves an order to a
 * stage that filter did not include.
 */
export function riderQueue(riderId) {
  const rider = db.prepare('SELECT id, name, phone FROM users WHERE id = ? AND role = ?').get(riderId, 'rider');
  if (!rider) return null;

  const state = getRiderState(riderId);

  const pool = db.prepare(`
    SELECT * FROM orders
    WHERE status = 'READY' AND order_type = 'delivery' AND rider_id IS NULL
    ORDER BY id ASC
  `).all().map((o) => formatOrder(o));

  return {
    rider: { id: rider.id, name: rider.name, phone: rider.phone },
    state: state.rider_state,
    available: state.rider_state === 'AVAILABLE',
    activeCount: state.active_count,
    maxActive: trackingConfig().maxActivePerRider,
    lat: state.lat,
    lng: state.lng,
    locationAt: state.location_at,
  // Everything the rider is carrying, already split into the stage it is in. Read
  // through the rider API's own function so the two endpoints cannot disagree
  // about which orders are active.
  active: riderActiveOrders(riderId).map((o) => ({ ...o, ...trackingPayload(getOrder(o.id)), nextActions: nextActions(o.status, o.order_type, 'rider') })),
    // Ready at the counter, claimable. Ordered oldest first, so the longest wait
    // is the first thing offered.
    available_orders: pool.map((o) => ({
      ...formatOrder(o),
      order_number: o.order_number,
      nextActions: nextActions(o.status, o.order_type, 'rider')
    }))
  };
}

// ------------------------------------------------------------ tracking payload

/**
 * May the customer be shown exactly where the rider is, at this point in the order?
 *
 * True from the moment the food is picked up. Before that the rider is riding to
 * the restaurant, not to the customer, and the customer only needs to know that -
 * "Rider is heading to the restaurant" - not a live dot. That is a privacy
 * decision about somebody's ride, so it is made once, here, from the same flow
 * array the status machine validates against, rather than re-derived by each
 * screen.
 *
 * A self-pickup order never has a rider, and a finished one is over: the rider's
 * position is cleared on delivery, so showing it would be showing nothing.
 */
export function isRiderPositionVisible(order) {
  if (!order) return false;
  if (order.order_type !== 'delivery') return false;
  if (isFinished(order.status)) return false;
  const at = DELIVERY_FLOW.indexOf(order.status);
  const from = DELIVERY_FLOW.indexOf('PICKED_UP');
  // An unknown status is not treated as permission. If the flow ever gains a
  // stage this does not know about, the rider is hidden rather than exposed.
  if (at < 0 || from < 0) return false;
  return at >= from;
}

/**
 * Everything a tracking screen needs, in one payload, so the customer, admin and
 * rider read exactly the same numbers instead of each deriving their own.
 */
/**
 * Everything a map needs for one order, in one place.
 *
 * Shared by the full tracking payload and by the rider's order card, because both
 * are read by a screen that draws a map: the customer's tracker and the rider's
 * own delivery screen. Built once here so the two can never disagree about where
 * the restaurant is, or about whether the rider has a position to show.
 *
 * `customer` is null when the address has no coordinates. That is not filled in
 * with the hotel or with anything else: a screen that cannot measure the distance
 * says so rather than drawing a pin somewhere invented.
 */
function mapFor(order, tcfg, point) {
  const hasRider = order.rider_lat != null && order.rider_lng != null;
  return {
    hotel: tcfg.hotel,
    customer: point,
    rider: hasRider ? { lat: order.rider_lat, lng: order.rider_lng } : null,
    // When that position was recorded. The `orders` row mirrors the coordinates
    // but not their age, so it is read from the rider's own row. Without it a page
    // that has just been refreshed cannot tell a rider who is moving from a pin
    // left behind by a phone that died an hour ago, and would draw the stale one
    // as though it were live.
    riderAt: hasRider && order.rider_id
      ? (db.prepare('SELECT location_at FROM rider_presence WHERE rider_id = ?').get(order.rider_id)?.location_at || null)
      : null,
    // Whether the rider's position is the customer's to see yet. Before pickup
    // the rider is on the way to the restaurant and the customer is told that in
    // words; the exact position is the rider's business until the food is in their
    // hands. The rule lives here so no screen can disagree with it.
    riderVisibleToCustomer: isRiderPositionVisible(order)
  };
}

export function trackingPayload(order) {
  if (!order) return null;
  const tcfg = trackingConfig();
  const fresh = getOrder(order.id) || order;
  const point = customerPoint(fresh);

  let riderToCustomerKm = null;
  let riderToHotelKm = null;
  if (fresh.rider_lat != null && fresh.rider_lng != null) {
    const riderPoint = { lat: fresh.rider_lat, lng: fresh.rider_lng };
    riderToCustomerKm = point ? distanceKmBetween(riderPoint, point) : null;
    riderToHotelKm = distanceKmBetween(riderPoint, tcfg.hotel);
  }

  const eta = computeEta({
    status: fresh.status,
    orderType: fresh.order_type,
    distanceKm: fresh.delivery_distance_km,
    riderToHotelKm,
    timing: { prepMinutes: tcfg.prepMinutes, kmh: tcfg.speedKmh }
  });

  return {
    ...fresh,
    statusLabel: STATUS_LABELS[fresh.status] || fresh.status,
    flow: flowFor(fresh.order_type),
    // The road ahead, straight from the same table the validator uses, so a screen
    // never has to keep its own copy of the lifecycle.
    upcoming: upcomingStages(fresh.status, fresh.order_type),
    history: getHistory(fresh.id),
    // The customer's own review travels with the order so the tracker can say
    // "you already reviewed this" instead of offering the form a second time.
    review: db.prepare('SELECT id, rating, comment, created_at FROM reviews WHERE order_id = ?').get(fresh.id) || null,
    eta,
    riderToCustomerKm,
    riderToHotelKm,
    // Everything a map needs, in one place, so no screen keeps its own copy of
    // where the restaurant is.
    map: mapFor(fresh, tcfg, point),
    // "Nearby" is derived from the same threshold the automatic status uses.
    riderNearby: riderToCustomerKm !== null && riderToCustomerKm * 1000 <= tcfg.nearCustomerMetres,
    nextActions: nextActions(fresh.status, fresh.order_type, 'admin'),
    ...assignmentStatus(fresh)
  };
}

/**
 * What the rider's phone needs to run GPS correctly.
 *
 * The hotel coordinates and both radii come from the same settings the server
 * geofences with, so the distance the rider reads on their screen and the
 * distance the server decides on are the same two numbers. A client that hard
 * coded the hotel position would drift out of agreement with the geofence the
 * moment an admin corrected either one.
 */
export function riderGpsConfig() {
  const cfg = trackingConfig();
  const s = getSettings();
  return {
    hotel: cfg.hotel,
    hotelArrivalMetres: cfg.hotelMetres,
    nearCustomerMetres: cfg.nearCustomerMetres,
    // How often a position may be sent. `watchPosition` can fire several times a
    // second; a rider app that forwarded every fix would spend a rider's battery
    // and the server's request budget to draw a dot that has not moved.
    sendIntervalSeconds: Math.max(5, num(s.rider_gps_send_interval_s, 15)),
    // A fix is refused when its own error circle is wider than the circle it is
    // being used to prove the rider has entered. Without this a 400 m fix can
    // satisfy a 150 m arrival and report a rider at the hotel who is two streets
    // away.
    maxAcceptableAccuracyMetres: Math.max(10, num(s.rider_gps_max_accuracy_m, 100)),
    // A fix older than this is not worth sending either.
    maxFixAgeSeconds: Math.max(5, num(s.rider_gps_max_fix_age_s, 60)),
    // Beyond this much movement since the last send, send immediately rather than
    // waiting out the interval: a rider who has actually turned a corner should
    // not wait fifteen seconds for the map to catch up.
    resendAfterMetres: Math.max(5, num(s.rider_gps_resend_after_m, 40)),
    maxLocationAgeMinutes: cfg.maxLocationAgeMinutes
  };
}

// ------------------------------------------------------------- rider API core

/**
 * The stages that make up a delivery, and the tap that reaches each one.
 *
 * The rider app sends the name of the action, never a status: a client that could
 * name `DELIVERED` directly could also name a status out of order, and the one
 * write path would be answering to whatever the phone felt like sending. Every
 * name here is checked against the transition table before anything is written.
 *
 * `RIDER_GOING_TO_HOTEL` is included even though the rider-facing list is usually
 * described as arrival/pickup/delivery: without it the chain has no entry point,
 * because nothing transitions into `RIDER_ARRIVED_AT_HOTEL` from `RIDER_ASSIGNED`
 * on its own.
 */
export const RIDER_ACTIONS = {
  start_trip: { status: 'RIDER_GOING_TO_HOTEL', label: 'Start trip to the hotel' },
  arrived_at_hotel: { status: 'RIDER_ARRIVED_AT_HOTEL', label: 'Arrived at the hotel', geofence: 'hotel' },
  confirm_pickup: { status: 'PICKED_UP', label: 'Confirm pickup' },
  start_delivery: { status: 'OUT_FOR_DELIVERY', label: 'Start delivery' },
  near_customer: { status: 'RIDER_NEAR_CUSTOMER', label: 'Near the customer', geofence: 'customer' },
  mark_delivered: { status: 'DELIVERED', label: 'Mark delivered' }
};

/** A rider's own row, or null. A user who is not a rider has no rider API. */
function riderRow(riderId) {
  return db.prepare('SELECT id, name, email, phone, role, is_active, deleted_at FROM users WHERE id = ? AND role = ?')
    .get(riderId, 'rider') || null;
}

/**
 * A rider's profile, in the shape the rider app needs to render its own header.
 *
 * The last position and its age are part of this rather than something the app
 * fetches separately: "your location is 40 minutes old" is the reason an order
 * cannot be assigned to somebody, so it has to be visible next to the toggle that
 * would explain it.
 */
export function riderProfile(riderId) {
  const rider = riderRow(riderId);
  if (!rider) return null;
  const state = getRiderState(riderId);
  const active = db.prepare(`
    SELECT id FROM orders
    WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
    ORDER BY id ASC LIMIT 1
  `).get(riderId);

  return {
    id: rider.id,
    name: rider.name,
    mobile: rider.phone,
    email: rider.email,
    role: rider.role,
    // Two different things, and the profile screen shows both because they answer
    // two different questions. `accountStatus` is whether the restaurant allows
    // this person to work here at all - ACTIVE, DISABLED or DELETED, set by an
    // admin and nothing else. `riderState` is whether they are taking orders right
    // now. A rider can be ACTIVE and OFFLINE, which is a person who is allowed to
    // sign in and is not currently available, and reading either field as the
    // other is how an admin's "disable" gets reported to the rider as "you are
    // offline" - or an idle rider as disabled.
    accountStatus: staffStatus(rider),
    isOnline: state.rider_state !== 'OFFLINE',
    isAvailable: state.rider_state === 'AVAILABLE',
    // The real state, not just the two booleans. `isAvailable` is false for a
    // rider who is BUSY, which is true but hides whether they are working.
    riderState: state.rider_state,
    activeCount: state.active_count,
    maxActive: trackingConfig().maxActivePerRider,
    currentOrder: active ? riderOrderCard(active.id) : null,
    lastLocation: state.lat == null ? null : { lat: state.lat, lng: state.lng },
    lastLocationAt: state.location_at
  };
}

/** The compact order shape the rider list and dashboard render. */
function riderOrderCard(orderId) {
  const o = getOrder(orderId);
  if (!o) return null;
  const tcfg = trackingConfig();
  const point = customerPoint(o);
  return {
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status] || o.status,
    order_type: o.order_type,
    flow: flowFor(o.order_type),
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    address: o.address,
    items: o.items,
    // Named for the rider screen rather than for the column. The column is
    // `grand_total`, and a card that exposed it under a name the column does not
    // have rendered "₹undefined" on the delivery the rider is actually holding.
    total_amount: o.grand_total,
    deliveryFee: o.delivery_fee,
    // The method as well as the status: the rider screen has to know whether to
    // collect cash at the door, and `payment_status` alone does not say that.
    payment_method: o.payment_method,
    deliveryDistanceKm: o.delivery_distance_km,
    paymentStatus: o.payment_status,
    // The rider's delivery screen draws a map, and it is this card - not the
    // customer's tracking payload - that it is given. Without the map here the
    // rider's own screen had no hotel to navigate to and no customer pin, and
    // after a refresh it had no way to show the last position the server was
    // holding, which is the one thing that tells a rider where they were.
    map: mapFor(o, tcfg, point),
    // When the order became this rider's, so the screen can show it beside the
    // other order information rather than the rider having to remember.
    accepted_at: o.accepted_at ?? null,
    assigned_at: o.assigned_at ?? null,
    eta: refreshEta(o),
    riderToCustomerKm: point && o.rider_lat != null
      ? distanceKmBetween({ lat: o.rider_lat, lng: o.rider_lng }, point)
      : null,
    riderToHotelKm: o.rider_lat != null
      ? distanceKmBetween({ lat: o.rider_lat, lng: o.rider_lng }, tcfg.hotel)
      : null,
    assignedAt: o.assigned_at,
    // When it was actually handed over. The rider's history is a list of shifts
    // they worked, and a list of finished orders with no times on them cannot
    // answer "how much did I do today" or be compared against a payslip.
    deliveredAt: o.delivered_at,
    cancelledAt: o.cancelled_at,
    nextActions: nextActions(o.status, o.order_type, 'rider'),
    // The stored timeline, so a rider who refreshes or reconnects sees the same
    // history the customer does rather than a bare status. It comes from the
    // database, which is the point: this is recovery, not a replay of what the
    // socket happened to deliver.
    history: getHistory(o.id)
  };
}

/**
 * The orders this rider is carrying right now.
 *
 * Written as an explicit list of the live delivery stages rather than
 * "everything that is not finished": the second version would put an order that
 * was cancelled and reassigned, or one sitting in an admin-only stage, in a
 * rider's active list. The list is the one in the specification, and the
 * specification is also what the rider app renders buttons for.
 */
const RIDER_ACTIVE_STATUSES = [
  'RIDER_ASSIGNED',
  'RIDER_GOING_TO_HOTEL',
  'RIDER_ARRIVED_AT_HOTEL',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'RIDER_NEAR_CUSTOMER'
];

export function riderActiveOrders(riderId) {
  const rider = riderRow(riderId);
  if (!rider) return null;
  const placeholders = RIDER_ACTIVE_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id FROM orders
    WHERE rider_id = ? AND status IN (${placeholders})
    ORDER BY id ASC
  `).all(riderId, ...RIDER_ACTIVE_STATUSES);
  return rows.map((r) => riderOrderCard(r.id)).filter(Boolean);
}

/**
 * This rider's finished orders, newest first.
 *
 * Filtered by `rider_id` as well as by status. A delivery that was cancelled and
 * handed to a different rider has had its `rider_id` cleared, so the first rider
 * correctly stops seeing it, and the one who did carry it sees it.
 */
export function riderOrderHistory(riderId, { limit = 50, offset = 0 } = {}) {
  const rider = riderRow(riderId);
  if (!rider) return null;
  const capped = Math.min(Math.max(1, num(limit, 50)), 200);
  const from = Math.max(0, num(offset, 0));
  // Both columns, because cancellation clears `rider_id` to release the rider and
  // `released_rider_id` is the one that remembers who they were. Reading only
  // `rider_id` meant a cancelled delivery - the job the rider drove to the counter
  // for - could never appear in the shift it belonged to, and the CANCELLED and
  // REJECTED statuses in this filter were unreachable.
  const rows = db.prepare(`
    SELECT id FROM orders
    WHERE (rider_id = ? OR released_rider_id = ?)
      AND status IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(riderId, riderId, capped, from);
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM orders
    WHERE (rider_id = ? OR released_rider_id = ?)
      AND status IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
  `).get(riderId, riderId).c;
  return { total, limit: capped, offset: from, orders: rows.map((r) => riderOrderCard(r.id)).filter(Boolean) };
}

/**
 * Start and end of "today" for the counters below.
 *
 * `CURRENT_TIMESTAMP` is UTC in SQLite, so the day boundary is computed the same
 * way and the two can never straddle. Using the machine's local time here would
 * silently disagree with the timestamps it is counting.
 */
function todayRange() {
  return {
    start: db.prepare("SELECT datetime('now','start of day') AS s").get().s,
    end: db.prepare("SELECT datetime('now','start of day','+1 day') AS e").get().e
  };
}

/**
 * How a rider is paid, or null when nobody has decided yet.
 *
 * There is no payout column, rate card or ledger in this database, so there is no
 * honest number to report and the dashboard reports that instead of a zero that
 * would read as "you earned nothing today". The moment an admin adds a rate to
 * `settings`, the same code starts computing a figure - the gate is a
 * configuration check, not a stub.
 */
function earningsConfig() {
  const s = getSettings();
  const perDelivery = num(s.rider_pay_per_delivery, 0);
  const perKm = num(s.rider_pay_per_km, 0);
  if (!(perDelivery > 0) && !(perKm > 0)) return null;
  return { perDelivery, perKm };
}

/**
 * What the rider needs on their home screen: the job in hand, today's tally, and
 * an honest answer about the two things that are not configured.
 */
export function riderDashboard(riderId) {
  const rider = riderRow(riderId);
  if (!rider) return null;
  const { start, end } = todayRange();
  const state = getRiderState(riderId);

  const active = db.prepare(`
    SELECT id FROM orders
    WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
    ORDER BY id ASC LIMIT 1
  `).get(riderId);

  const done = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(delivery_distance_km), 0) AS km
    FROM orders
    WHERE rider_id = ? AND delivered_at IS NOT NULL AND delivered_at >= ? AND delivered_at < ?
  `).get(riderId, start, end);

  // Distance actually covered, summed from the delivery distance the server
  // measured for each finished order. This is hotel-to-customer, not the rider's
  // whole route: there is no trail of fixes to total up, and inventing one by
  // assuming a straight line from wherever the rider last checked in would be a
  // number with no source behind it.
  const pay = earningsConfig();
  const distanceKm = round1(done.km);

  return {
    rider: { id: rider.id, name: rider.name, riderState: state.rider_state },
    activeOrder: active ? riderOrderCard(active.id) : null,
    activeCount: state.active_count,
    today: {
      completedDeliveries: done.c,
      distanceKm,
      distanceSource: 'order_delivery_distance',
      // The one figure a rider app usually shows that this database cannot supply.
      travelDistanceKm: null,
      travelDistanceUnavailable: 'Only the current rider position is stored, not a trail of fixes, so distance travelled during a shift cannot be measured.'
    },
    earnings: pay
      ? {
          amount: round2(done.c * pay.perDelivery + distanceKm * pay.perKm),
          currency: 'INR',
          configured: true,
          basis: { perDelivery: pay.perDelivery, perKm: pay.perKm }
        }
      : {
          amount: null,
          currency: 'INR',
          configured: false,
          reason: 'No rider payout rate is configured, so no earnings figure can be calculated.'
        }
  };
}

/**
 * The rider board the admin screen reads.
 *
 * Six things an admin looks at when deciding whether the riders can be trusted
 * with the next order: who they are, whether they are on shift, whether they are
 * free, what they are carrying, where they were last, and how long ago that was.
 * Each is read from the same `rider_presence` row and the same `orders` table
 * the rest of the system uses - there is no admin-side copy of rider state, and
 * nothing here is computed from anything the rider app reported about itself.
 *
 * `lastActiveAt` is the later of the last position and the last state change. A
 * rider who is online and carrying an order but whose phone has not reported
 * since is a real thing an admin needs to see, and a column that only existed
 * for GPS fixes would have hidden it.
 */
export function adminRiderFleet() {
  const cfg = trackingConfig();
  const { eligible, rejected } = findEligibleRiders();
  const ranked = new Map(rankRiderCandidates(eligible).map((r, i) => [r.id, i + 1]));
  const now = new Date();

  const riders = listRiderCandidates().map((r) => {
    // Every order this rider is carrying, not just the single pointer in
    // `rider_presence.active_order_id`: that column holds one id while a rider may
    // hold several, and an admin asking "what is this rider doing" wants the lot.
    const carrying = db.prepare(`
      SELECT id, order_number, status, customer_name, delivery_distance_km, updated_at
      FROM orders
      WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
      ORDER BY id ASC
    `).all(r.id);
    const primary = carrying[0] || null;
    const lastStateChange = db.prepare('SELECT updated_at FROM rider_presence WHERE rider_id = ?')
      .get(r.id)?.updated_at || null;

    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      // The two facts an admin reads first, named so the screen does not have to
      // derive one from the other.
      isOnline: r.rider_state !== 'OFFLINE',
      isAvailable: r.rider_state === 'AVAILABLE',
      riderState: r.rider_state,
      // The order in hand, with the stage it has actually reached.
      currentOrder: primary ? {
        id: primary.id,
        orderNumber: primary.order_number,
        status: primary.status,
        statusLabel: STATUS_LABELS[primary.status] || primary.status,
        customerName: primary.customer_name,
        distanceKm: primary.delivery_distance_km,
        updatedAt: primary.updated_at
      } : null,
      // Every one of them, because the pointer above is only the first.
      carryingOrders: carrying.map((o) => ({
        id: o.id, orderNumber: o.order_number, status: o.status,
        statusLabel: STATUS_LABELS[o.status] || o.status
      })),
      activeCount: r.activeCount,
      maxActive: cfg.maxActivePerRider,
      // Where the rider was last seen, and how stale that is. A null position is
      // reported as null: an admin is told the rider has not reported, not shown
      // a pin at the hotel because that is where the missing one would be.
      lastLocation: r.lat == null || r.lng == null ? null : { lat: r.lat, lng: r.lng },
      lastLocationAt: r.location_at,
      lastActiveAt: later(r.location_at, lastStateChange),
      locationAgeMinutes: r.location_at ? ageMinutes(r.location_at, now) : null,
      distanceToHotelKm: r.distanceKm === Infinity ? null : r.distanceKm,
      recentAssignments: r.recentAssignments,
      atCapacity: r.activeCount >= cfg.maxActivePerRider,
      canReceiveOrders: r.eligible,
      ineligibleCode: r.ineligibleCode,
      ineligibleReason: r.ineligibleReason,
      assignmentRank: ranked.get(r.id) || null
    };
  });

  return {
    maxActivePerRider: cfg.maxActivePerRider,
    locationRequired: cfg.locationRequired,
    eligibleCount: eligible.length,
    riders,
    // Riders exist, they are simply all busy or unreachable. That is a staffing
    // problem rather than an error, and saying which of which is more useful to
    // an admin than an empty list.
    waitingSummary: rejected.length
      ? rejected.reduce((acc, r) => {
        acc[r.ineligibleCode] = (acc[r.ineligibleCode] || 0) + 1;
        return acc;
      }, {})
      : {}
  };
}

/** The later of two SQLite timestamps, tolerating either being absent. */
function later(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) >= String(b) ? a : b;
}

/** Whole minutes since a SQLite timestamp, or null when there is nothing to age. */
function ageMinutes(stamp, now) {
  const then = parseSqliteTimestamp(stamp);
  if (then === null) return null;
  return Math.max(0, Math.round((now.getTime() - then) / 60000));
}

const round1 = (v) => Math.round(num(v, 0) * 10) / 10;
const round2 = (v) => Math.round(num(v, 0) * 100) / 100;

/**
 * What a rider is told about an order, per stage.
 *
 * Keyed on the stage rather than written at each call site, so "order ready" means
 * the same thing whether the kitchen pressed the button over HTTP or the status
 * moved from a rider's own GPS crossing a geofence. The words are the rider's
 * ("your order", "you"), not the customer's, because this is the rider's feed.
 */
const RIDER_NOTICES = {
  RIDER_ASSIGNED: {
    type: 'delivery_assigned',
    title: 'New delivery assigned',
    message: (o) => `Order ${o.order_number} for ${o.customer_name} is yours. Head to Hotel Darshan.`
  },
  READY: {
    type: 'order_ready',
    title: 'Order ready',
    message: (o) => `Order ${o.order_number} is prepared and waiting at the counter.`
  },
  CANCELLED: {
    type: 'order_cancelled',
    title: 'Order cancelled',
    message: (o) => `Order ${o.order_number} has been cancelled.`
  },
  REJECTED: {
    type: 'order_cancelled',
    title: 'Order rejected',
    message: (o) => `Order ${o.order_number} was rejected.`
  },
  DELIVERED: {
    type: 'delivery_completed',
    title: 'Delivery completed',
    message: (o) => `Order ${o.order_number} was delivered to ${o.customer_name}.`
  },
  COMPLETED: {
    type: 'delivery_completed',
    title: 'Delivery completed',
    message: (o) => `Order ${o.order_number} is complete.`
  }
};

/**
 * Write one notification, if there is somebody to write it for.
 *
 * Called from inside the transaction that moves the order, so the feed can only
 * ever describe work that was actually committed. A missing rider - an order that
 * is still sitting on the ready board, say - is not an error: there is simply
 * nobody to notify yet, and the notice is written when the rider is attached.
 */
/**
 * Write the rider's own notice for a stage, and return enough to publish it.
 *
 * The returned notice is what the caller sends over the socket after the commit.
 * It used to return only an id, and nothing sent anything: the row was written and
 * the rider's screen never learned of it until it happened to re-read the feed. A
 * cancellation - the one notice a rider most needs to see while they are standing
 * at a customer's door with somebody else's food - arrived on their phone only
 * after a refresh.
 */
function recordNotificationForRider(order, stage) {
  const riderId = order?.rider_id;
  if (!riderId) return null;
  const notice = RIDER_NOTICES[stage];
  if (!notice) return null;
  const info = db.prepare(`
    INSERT INTO notifications (user_id, order_id, type, title, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(riderId, order.id, notice.type, notice.title, notice.message(order));
  return {
    id: info.lastInsertRowid,
    riderId,
    orderId: order.id,
    orderNumber: order.order_number || null,
    type: notice.type,
    title: notice.title,
    message: notice.message(order),
    at: new Date().toISOString()
  };
}

export { recordNotificationForRider };

/**
 * Every key in the notice table has to be a stage the order flow actually uses.
 *
 * A typo here is invisible: `RIDER_NOTICES['order_reay']` simply never matches,
 * the notice is never written, and the rider's feed is quietly short a row with
 * nothing in the log to explain it. Checked once at load, where it costs nothing.
 */
for (const stage of Object.keys(RIDER_NOTICES)) {
  if (!resolveStatus(stage)) {
    throw new Error(`RIDER_NOTICES has "${stage}", which is not a stage of the order flow`);
  }
}

/** A rider's feed, newest first, with the unread count that the top bar badge needs. */
export function riderNotifications(riderId, { limit = 30, unreadOnly = false } = {}) {
  const rider = riderRow(riderId);
  if (!rider) return null;
  const capped = Math.min(Math.max(1, num(limit, 30)), 100);
  const rows = db.prepare(`
    SELECT n.id, n.order_id, n.type, n.title, n.message, n.read_at, n.created_at,
           o.order_number
    FROM notifications n
    LEFT JOIN orders o ON o.id = n.order_id
    WHERE n.user_id = ? ${unreadOnly ? 'AND n.read_at IS NULL' : ''}
    ORDER BY n.id DESC LIMIT ?
  `).all(riderId, capped);
  const unread = db.prepare(`
    SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL
  `).get(riderId).c;
  return {
    total: rows.length,
    unread,
    notifications: rows.map((n) => ({
      id: n.id,
      orderId: n.order_id,
      orderNumber: n.order_number || null,
      type: n.type,
      title: n.title,
      message: n.message,
      read: Boolean(n.read_at),
      readAt: n.read_at,
      createdAt: n.created_at
    }))
  };
}

/** Mark one notification read. Scoped to the owner, so nobody reads another's feed. */
export function markNotificationRead(riderId, notificationId) {
  const id = num(notificationId, 0);
  const info = db.prepare(`
    UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
    WHERE id = ? AND user_id = ?
  `).run(id, riderId);
  if (!info.changes) return { ok: false, status: 404, error: 'Notification not found', code: 'NOT_FOUND' };
  return { ok: true };
}

/** Clear the unread badge in one go. */
export function markAllNotificationsRead(riderId) {
  const info = db.prepare(`
    UPDATE notifications SET read_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND read_at IS NULL
  `).run(riderId);
  return { ok: true, updated: info.changes };
}

/**
 * Validate a coordinate report.
 *
 * Returns 422 rather than 400: the request was understood and the fields were
 * present, they were not usable values. That distinction is what lets a phone
 * tell "you are offline" apart from "the server rejected what you sent".
 */
function validateCoordinatePair(latitude, longitude) {
  if (latitude === undefined || latitude === null || latitude === '' ||
      longitude === undefined || longitude === null || longitude === '') {
    return { error: 'latitude and longitude are required' };
  }
  const la = parseFloat(latitude);
  const ln = parseFloat(longitude);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    return { error: 'latitude and longitude must be numbers' };
  }
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) {
    return { error: 'latitude must be within -90 to 90 and longitude within -180 to 180' };
  }
  return { lat: la, lng: ln };
}

/**
 * Accept a position report from the rider app.
 *
 * `accuracy` and `timestamp` are validated and echoed back, but neither is
 * persisted and neither decides anything: there is no column for either, and a
 * client clock can be wrong. Ageing is measured from when the server received the
 * fix, so a phone with a fast clock cannot make its own position look fresh, and a
 * position that decides an order's stage is always one this server wrote.
 */
export function riderLocationReport({ riderId, latitude, longitude, accuracy, timestamp, orderId }) {
  const point = validateCoordinatePair(latitude, longitude);
  if (point.error) return { ok: false, status: 422, error: point.error, code: 'INVALID_LOCATION' };

  const acc = accuracy === undefined || accuracy === null || accuracy === '' ? null : parseFloat(accuracy);
  if (acc !== null && !Number.isFinite(acc)) {
    return { ok: false, status: 422, error: 'accuracy must be a number of metres', code: 'INVALID_ACCURACY' };
  }
  if (acc !== null && acc < 0) {
    return { ok: false, status: 422, error: 'accuracy cannot be negative', code: 'INVALID_ACCURACY' };
  }

  const reportedAt = timestamp === undefined || timestamp === null || timestamp === '' ? null : String(timestamp);
  if (reportedAt && !Number.isFinite(Date.parse(reportedAt))) {
    return { ok: false, status: 422, error: 'timestamp must be an ISO-8601 date', code: 'INVALID_TIMESTAMP' };
  }

  // An order named by the client has to be one this rider is actually carrying.
  // Without this a rider gets `ok: true` for a delivery they were told to report
  // against and were refused - the position is stored against the rider, correctly,
  // but the answer lies about what it did. The socket path already refuses this.
  if (orderId) {
    const requested = getOrder(orderId);
    if (!requested) return { ok: false, status: 404, error: 'Order not found', code: 'ORDER_NOT_FOUND' };
    if (requested.rider_id !== riderId) {
      return { ok: false, status: 403, error: 'This order is not assigned to you', code: 'NOT_ASSIGNED' };
    }
  }

  const result = recordRiderLocation({ riderId, lat: point.lat, lng: point.lng, orderId });
  if (!result.ok) return { ...result, code: result.code || 'LOCATION_REJECTED' };

  return {
    ok: true,
    stored: {
      lat: point.lat,
      lng: point.lng,
      accuracyMetres: acc,
      reportedAt,
      at: getRiderState(riderId).location_at
    },
    order: result.order,
    advanced: result.advanced,
    eta: result.eta,
    riderState: result.riderState,
    // True only when this report advanced a live order, which is the only case
    // where a subscriber needs to hear about it.
    broadcast: Boolean(result.advanced)
  };
}

/**
 * How far the rider's stored position is from a place the order cares about.
 *
 * A stale position fails on purpose. A rider who drove away twenty minutes ago is
 * still sitting in the geofence according to the last fix, and accepting that
 * would mark them arrived at a hotel they left.
 */
function geofenceCheck(order, target) {
  const tcfg = trackingConfig();
  const presence = db.prepare('SELECT lat, lng, location_at FROM rider_presence WHERE rider_id = ?').get(order.rider_id);
  if (!presence || presence.lat == null) {
    return { ok: false, reason: 'Share your location before marking this stage.' };
  }
  // The rider's fix must be recent. Parsed through the shared reader: this one
  // was `replace(' ', 'T') + 'Z'` without the guard the other three copies had,
  // so a location_at that already carried a zone marker would have been read as
  // UTC anyway.
  const locationAt = parseSqliteTimestamp(presence?.location_at);
  const ageMinutes = locationAt === null
    ? NaN
    : (Date.now() - locationAt) / 60000;
  if (!Number.isFinite(ageMinutes) || ageMinutes > tcfg.maxLocationAgeMinutes) {
    return {
      ok: false,
      reason: `Your last location is ${Math.round(ageMinutes)} minutes old. Refresh it, then try again.`
    };
  }
  const point = { lat: presence.lat, lng: presence.lng };
  const to = target === 'hotel'
    ? tcfg.hotel
    : customerPoint(order);
  if (!to) return { ok: false, reason: 'This order has no delivery coordinates, so arrival cannot be verified.' };
  const radius = target === 'hotel' ? tcfg.hotelMetres : tcfg.nearCustomerMetres;
  const metres = distanceKmBetween(point, to) * 1000;
  if (metres > radius) {
    return {
      ok: false,
      reason: target === 'hotel'
        ? `You are ${Math.round(metres)} m from the hotel. Get within ${radius} m first.`
        : `You are ${Math.round(metres / 10) / 100} km from the customer. Get within ${Math.round(radius / 10) / 100} km first.`
    };
  }
  return { ok: true, metres, radius };
}

/**
 * Perform one rider action on one order.
 *
 * The seven steps are all real checks, in this order: the rider exists, the order
 * exists, it is theirs, the position supports the claim, the stage is the one the
 * action names, and the lifecycle permits that move. Only then does the single
 * write path run, and the caller is told to broadcast afterwards rather than
 * before - a socket event for a status that was refused is worse than no event.
 */
export function riderAction({ orderId, action, actor, note = null }) {
  const rider = riderRow(actor.id);
  if (!rider) return { ok: false, status: 403, error: 'This account is not a rider', code: 'NOT_A_RIDER' };

  const spec = RIDER_ACTIONS[String(action ?? '').trim().toLowerCase()];
  if (!spec) {
    return {
      ok: false,
      status: 400,
      error: `Unknown action "${action}". Expected one of: ${Object.keys(RIDER_ACTIONS).join(', ')}`,
      code: 'UNKNOWN_ACTION'
    };
  }

  const order = getOrder(orderId);
  if (!order) return { ok: false, status: 404, error: 'Order not found', code: 'ORDER_NOT_FOUND' };
  if (order.rider_id !== rider.id) {
    return { ok: false, status: 403, error: 'This order is not assigned to you', code: 'NOT_ASSIGNED' };
  }

  // Every refusal below carries the stage the order is actually in. A phone that
  // was working from a stale screen can then resync from the refusal instead of
  // retrying a move that was never going to be allowed - which is the only way it
  // finds out the order has already moved on by itself.
  const refuse = (status, error, code) => ({ ok: false, status, error, code, order: getOrder(order.id) });

  const isGpsStage = Boolean(spec.geofence);
  if (isGpsStage) {
    // The rider may press the button, but the server decides whether it is true,
    // from a position it stored itself. This is what keeps a customer tracker
    // that says "rider has arrived" trustworthy: no phone can assert it.
    const check = geofenceCheck(order, spec.geofence);
    if (!check.ok) {
      return refuse(409, check.reason, 'OUTSIDE_GEOFENCE');
    }
  }

  const result = applyStatusChange({
    orderId: order.id,
    to: spec.status,
    actor: { id: rider.id, name: rider.name, role: 'rider' },
    note: note || spec.label,
    // Only ever true for a geofence stage that has just been verified above.
    allowSystem: isGpsStage,
    method: 'rider_action'
  });

  return {
    ok: result.ok,
    status: result.status,
    code: result.ok ? null : 'INVALID_STATE',
    error: result.error,
    order: result.order || getOrder(order.id),
    eta: result.eta,
    advanced: result.ok ? spec.status : null,
    releasedRiderId: result.releasedRiderId,
    gpsVerified: isGpsStage ? true : null
  };
}

/**
 * Record cash collected at the door.
 *
 * Not a status of its own - the order is already delivered by this point, and
 * inventing a stage for a payment would put a button in the tracker that means
 * nothing to the customer. Payment is a field, so this writes the field, refuses
 * to collect against an order that is not finished, and will not take the money
 * twice.
 */
export function collectRiderPayment({ orderId, actor, method = 'cash' }) {
  const rider = riderRow(actor.id);
  if (!rider) return { ok: false, status: 403, error: 'This account is not a rider', code: 'NOT_A_RIDER' };

  const order = getOrder(orderId);
  if (!order) return { ok: false, status: 404, error: 'Order not found', code: 'ORDER_NOT_FOUND' };
  if (order.rider_id !== rider.id) {
    return { ok: false, status: 403, error: 'This order is not assigned to you', code: 'NOT_ASSIGNED' };
  }
  if (order.payment_status === 'paid') {
    // Already collected. Reported as success so a retry on a flaky connection is
    // not shown to the rider as a failure they need to escalate.
    return { ok: true, order, alreadyCollected: true, paymentStatus: 'paid' };
  }
  if (!['DELIVERED', 'COMPLETED'].includes(order.status)) {
    return {
      ok: false,
      status: 409,
      error: 'Payment can only be collected once the order is delivered',
      code: 'INVALID_STATE',
      order
    };
  }
  const how = ['cash', 'upi', 'card'].includes(String(method).toLowerCase()) ? String(method).toLowerCase() : 'cash';
  db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(order.id);
  return { ok: true, order: getOrder(order.id), alreadyCollected: false, method: how, paymentStatus: 'paid' };
}

/**
 * Whether this order still needs a rider, and who is looking.
 *
 * A ready delivery with no rider is a queue, not a failure, so the admin screen is
 * told so in words rather than left to infer it from a missing rider. Self-pickup
 * is explicitly "not required" so no screen has to special-case it.
 */
export function assignmentStatus(order) {
  if (!order) return { assignmentState: null, assignmentMessage: null, awaitingRider: false };
  if (order.order_type === 'pickup') {
    return {
      assignmentState: ASSIGNMENT_STATES.NOT_REQUIRED,
      assignmentMessage: ASSIGNMENT_MESSAGES[ASSIGNMENT_STATES.NOT_REQUIRED],
      awaitingRider: false
    };
  }
  if (order.rider_id) {
    return {
      assignmentState: ASSIGNMENT_STATES.ASSIGNED,
      assignmentMessage: ASSIGNMENT_MESSAGES[ASSIGNMENT_STATES.ASSIGNED],
      awaitingRider: false
    };
  }
  if (resolveStatus(order.status) === 'READY') {
    const { rejected } = findEligibleRiders();
    return {
      assignmentState: ASSIGNMENT_STATES.WAITING,
      assignmentMessage: ASSIGNMENT_MESSAGES[ASSIGNMENT_STATES.WAITING],
      awaitingRider: true,
      // Why nobody could take it, without inventing a rider to fill the gap.
      waitingReasons: rejected.map((r) => ({ rider_id: r.id, name: r.name, code: r.ineligibleCode, reason: r.ineligibleReason }))
    };
  }
  // Anything earlier in the kitchen's flow is simply not ready for a rider yet.
  return { assignmentState: null, assignmentMessage: null, awaitingRider: false };
}
