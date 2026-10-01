// The rider's own API.
//
// Everything here answers for one rider and nothing else. The rider is taken from
// the verified token, never from a parameter, so there is no endpoint on this
// router that can be pointed at somebody else's work: an action names an order,
// and the order has to already belong to the caller.
//
// The status changes these routes make all go through the same single write path
// the admin, kitchen and customer tracker use. What this file adds is the rider's
// vocabulary for it - a named action, rather than a status the phone chose - and
// the rule that a socket event is only sent once the database has committed.

import express from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import {
  emitOrderStatusUpdated,
  emitRiderAssigned,
  emitRiderAvailabilityChanged,
  emitRiderLocation,
  emitRiderLocationUnavailable,
  emitRiderNeeded,
  emitRiderNotice,
  emitRiderReleased
} from '../socket.js';
import { normaliseOrderNumber, resolveOrderRow } from './orders.js';
import {
  RIDER_ACTIONS,
  collectRiderPayment,
  getOrder,
  getRiderState,
  riderAction,
  riderActiveOrders,
  riderDashboard,
  markAllNotificationsRead,
  markNotificationRead,
  riderLocationReport,
  riderNotifications,
  riderOrderHistory,
  riderProfile,
  retryPendingAssignments,
  riderAvailability,
  riderGpsConfig,
  trackingPayload
} from '../orderTrackingService.js';

const router = express.Router();

// Step one of every action: the caller is a signed-in rider. `requireRole` and the
// service both check this; the route check exists so a customer who is poking at
// the rider API gets 403 rather than a confusing 404 about an order.
router.use(authMiddleware, requireRole('rider'));

/**
 * Turn a service refusal into a response.
 *
 * The service already decided the status - 404 for a missing order, 403 for
 * somebody else's, 409 for a move the lifecycle forbids, 422 for unusable input.
 * Passing that through unchanged is the point: the rider app can tell "not your
 * order" from "too early" from "your GPS is wrong" and say something useful,
 * instead of receiving one generic failure for all three.
 */
function refuse(res, result) {
  return res.status(result.status || 400).json({
    error: result.error,
    code: result.code || null,
    // The stage the order is actually in, so a stale app can resync from the
    // refusal rather than retrying a move that was never going to be allowed.
    currentStatus: result.order?.status || null
  });
}

// -------------------------------------------------------- GET /api/rider/gps-config
/**
 * The hotel position, both radii, and the sending rules for the rider's own
 * device. Read from the same settings the server geofences with, so the distance
 * on the rider's screen and the distance the server decides on cannot drift apart.
 */
router.get('/gps-config', (req, res) => {
  res.json(riderGpsConfig());
});

// -------------------------------------------------------------- GET /api/rider/me
router.get('/me', (req, res) => {
  const profile = riderProfile(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Rider not found', code: 'RIDER_NOT_FOUND' });
  res.json(profile);
});

// -------------------------------------------------------- GET /api/rider/dashboard
router.get('/dashboard', (req, res) => {
  const dash = riderDashboard(req.user.id);
  if (!dash) return res.status(404).json({ error: 'Rider not found', code: 'RIDER_NOT_FOUND' });
  res.json(dash);
});

// ------------------------------------------------- GET /api/rider/orders/active
router.get('/orders/active', (req, res) => {
  const orders = riderActiveOrders(req.user.id);
  if (!orders) return res.status(404).json({ error: 'Rider not found', code: 'RIDER_NOT_FOUND' });
  // A plain array, because this is the list the rider screen renders directly.
  // The dashboard is the one that wraps its numbers in an object.
  res.json(orders);
});

// ------------------------------------------------ GET /api/rider/orders/history
router.get('/orders/history', (req, res) => {
  const page = riderOrderHistory(req.user.id, {
    limit: req.query.limit,
    offset: req.query.offset
  });
  if (!page) return res.status(404).json({ error: 'Rider not found', code: 'RIDER_NOT_FOUND' });
  res.json(page);
});

// ------------------------------------------ GET /api/rider/notifications
/**
 * The rider's own feed: things that actually happened to their deliveries.
 *
 * Read from the database rather than replayed from socket traffic, because a
 * notification that only exists while the app happens to be open is not a feed.
 * The socket `notification` event still arrives for a live screen; this is what
 * the screen recovers from.
 */
router.get('/notifications', (req, res) => {
  const feed = riderNotifications(req.user.id, {
    limit: req.query.limit,
    unreadOnly: String(req.query.unreadOnly ?? '') === 'true'
  });
  if (!feed) return res.status(404).json({ error: 'Rider not found', code: 'RIDER_NOT_FOUND' });
  res.json(feed);
});

/** Mark one notification read. Scoped by the token's rider, so a guessed id is 404. */
router.post('/notifications/:id/read', (req, res) => {
  const result = markNotificationRead(req.user.id, req.params.id);
  if (!result.ok) return refuse(res, result);
  res.json(result);
});

/** Clear the badge in one go. */
router.post('/notifications/read-all', (req, res) => {
  res.json(markAllNotificationsRead(req.user.id));
});

// --------------------------------------------- PATCH /api/rider/availability
/**
 * Sign in to, or out of, taking work.
 *
 * `ONLINE` is a choice: signed in and willing to be given an order. What that
 * turns into is derived, not chosen - with no delivery in hand it is AVAILABLE,
 * with one it is BUSY. The response reports the derived state, so the rider sees
 * the same thing the assigner will see.
 */
router.patch('/availability', (req, res) => {
  const raw = req.body?.state ?? req.body?.status ?? req.body?.availability;
  const requested = String(raw ?? '').trim().toUpperCase();

  if (!['ONLINE', 'OFFLINE'].includes(requested)) {
    return res.status(422).json({
      error: 'state must be ONLINE or OFFLINE',
      code: 'INVALID_STATE_VALUE',
      allowed: ['ONLINE', 'OFFLINE']
    });
  }

  // Read before the change, so the event can say what it was as well as what it
  // is now. An admin board that only learns the new state cannot tell a rider who
  // just signed on from one who was already working.
  const before = getRiderState(req.user.id).rider_state;

  const result = riderAvailability({ riderId: req.user.id, online: requested === 'ONLINE' });
  if (!result.ok) return refuse(res, result);

  // After the state is committed, so the board is never ahead of the database.
  emitRiderAvailabilityChanged(
    { id: req.user.id, name: req.user.name, riderState: result.state },
    { previousState: before, reason: `Rider went ${requested.toLowerCase()}` }
  );

  // Any order handed back when the rider signed out has genuinely changed status,
  // so those subscribers hear about it here rather than only in the database.
  for (const orderId of result.returned || []) {
    const tracked = trackingPayload(getOrder(orderId));
    if (!tracked) continue;
    emitOrderStatusUpdated(tracked, { note: 'Rider went offline' });
    emitRiderReleased(tracked, { riderId: req.user.id, reason: 'Rider went offline' });
  }
  // Coming back online retries anything that has been waiting, which is what makes
  // signing in worth doing. Only announced after the state is committed.
  for (const a of result.assigned || []) {
    const filled = trackingPayload(getOrder(a.order_id));
    if (!filled) continue;
    emitOrderStatusUpdated(filled, { note: 'Rider online - order assigned' });
    emitRiderAssigned(filled, { rider: a, method: 'retry', note: 'Rider came online' });
  }

  res.json({
    state: result.state,
    isOnline: result.state !== 'OFFLINE',
    isAvailable: result.state === 'AVAILABLE',
    returned: result.returned || [],
    assigned: (result.assigned || []).map((a) => a.order_id)
  });
});

// -------------------------------------------------- POST /api/rider/location
/**
 * Report a position. This is the endpoint a rider app calls on a timer.
 *
 * It is the only route that can move an order on its own, because a real fix
 * crossing a geofence is evidence. That is why the order's stage is decided here
 * rather than by the phone - see `autoStatusForRiderLocation`.
 */
router.post('/location', (req, res) => {
  const result = riderLocationReport({
    riderId: req.user.id,
    latitude: req.body?.latitude,
    longitude: req.body?.longitude,
    accuracy: req.body?.accuracy,
    timestamp: req.body?.timestamp,
    // Optional, and only ever honoured if the order really is this rider's.
    orderId: req.body?.orderId ?? req.body?.order_id
  });

  if (!result.ok) return refuse(res, result);

  // A position that crosses a geofence has also moved the order on, and the
  // status event is what carries the history that came with it.
  if (result.order) {
    const tracked = trackingPayload(result.order);
    // Every accepted position is published, not only the ones that change the
    // stage. A tracker that only redraws when the order advances is not a
    // tracker: the customer watches a rider drive several kilometres with the pin
    // frozen at the restaurant, and then jumps. Deciding how often a position is
    // worth sending belongs to the device, which throttles by interval and by
    // distance; the server publishes what it is actually given.
    emitRiderLocation(tracked);
    if (result.advanced) {
      emitOrderStatusUpdated(tracked, { note: 'Rider location', changedByRole: 'rider' });
    }
  }

  res.json({
    ok: true,
    stored: result.stored,
    // The live order, if there is one, so the rider screen can redraw the tracker
    // from the same response instead of issuing a second request.
    order: result.order ? trackingPayload(result.order) : null,
    advanced: result.advanced,
    eta: result.eta,
    riderState: result.riderState
  });
});

// ------------------------------------------- POST /api/rider/location-unavailable
/**
 * The rider's device has no fix - permission refused, no signal, indoors.
 *
 * A separate endpoint because this is not a coordinate and must not be allowed to
 * become one. It records that the tracking is blind, and the customer is told so,
 * rather than the last known point being republished as though it were live.
 */
router.post('/location-unavailable', (req, res) => {
  const row = req.body?.orderId ? resolveOrderRow(req.body.orderId) : null;
  if (row && row.rider_id !== req.user.id) {
    // Same rule as reporting a position: a rider may only speak about a delivery
    // they are carrying. Without this, any rider could tell a customer's tracker
    // that their rider has no position - on somebody else's order.
    return res.status(403).json({ error: 'This order is not assigned to you', code: 'NOT_ASSIGNED' });
  }
  if (row && ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(row.status)) {
    return res.status(409).json({ error: 'This delivery has already finished', code: 'INVALID_STATE' });
  }
  const target = row || riderActiveOrders(req.user.id)?.[0];
  if (!target) {
    return res.status(404).json({ error: 'No active delivery for this rider', code: 'NO_ACTIVE_ORDER' });
  }
  emitRiderLocationUnavailable(trackingPayload(target), {
    reason: req.body?.reason || 'No GPS fix'
  });
  res.json({ ok: true, orderId: target.id });
});

// --------------------------------- POST /api/rider/orders/:id/actions/:action
/**
 * One named step of a delivery.
 *
 * The seven steps are enforced in `riderAction` and are worth restating here,
 * because this is the route where it matters:
 *   1. authenticated      - the rider router's `authMiddleware`/`requireRole`
 *   2. the order exists   - 404 otherwise
 *   3. it is this rider's - 403 otherwise
 *   4. the position is real for GPS stages - 409, refused rather than believed
 *   5. the stage is the one the action names
 *   6. the lifecycle allows the move - 409 otherwise
 *   7. write, record history, then broadcast
 *
 * Steps 2-6 all happen before anything is written, and step 7's write is the same
 * atomic `applyStatusChange` every other part of the system uses, so a rider
 * cannot put an order into a state the kitchen or admin screen cannot explain.
 */
router.post('/orders/:id/actions/:action', (req, res) => {
  const action = String(req.params.action || '').trim().toLowerCase();
  if (!RIDER_ACTIONS[action]) {
    return res.status(422).json({
      error: `Unknown action "${action}"`,
      code: 'UNKNOWN_ACTION',
      allowed: Object.keys(RIDER_ACTIONS)
    });
  }

  // The visible order number and the database id are two names for one row.
  const row = resolveOrderRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found', code: 'ORDER_NOT_FOUND' });

  const result = riderAction({
    orderId: row.id,
    action,
    actor: { id: req.user.id, name: req.user.name, role: 'rider' },
    note: req.body?.note || null
  });

  if (!result.ok) return refuse(res, result);

  const tracked = trackingPayload(result.order);
  const spec = RIDER_ACTIONS[action];

  // The commit is done, so this only announces it.
  emitOrderStatusUpdated(tracked, {
    changedBy: req.user.name,
    changedByRole: 'rider',
    note: result.eta ? `${spec.label} - about ${result.eta.minutes} min away` : spec.label
  });

  // The rider's own feed entry for this step, pushed to their own room so the
  // phone shows it without waiting to re-read. After the commit, like everything
  // else announced here.
  if (result.notice) emitRiderNotice(result.notice);

  // Delivering is the end of this rider's job, so the rest of the system is told
  // the rider is free before any waiting order is handed to somebody.
  if (result.releasedRiderId) {
    emitRiderReleased(tracked, { riderId: result.releasedRiderId, reason: `Order ${tracked.status}` });
    // The board's view of who can take work changes here too, not only when the
    // rider presses the switch. Emitted after the release has committed.
    const after = getRiderState(result.releasedRiderId);
    emitRiderAvailabilityChanged(
      { id: result.releasedRiderId, name: tracked.rider_name, riderState: after.rider_state },
      { previousState: 'BUSY', reason: 'Delivery completed' }
    );
    for (const a of retryPendingAssignments()) {
      const filled = trackingPayload(getOrder(a.order_id));
      if (!filled) continue;
      emitOrderStatusUpdated(filled, { note: 'Rider auto-assigned' });
      emitRiderAssigned(filled, { rider: a, method: 'auto', note: 'Rider auto-assigned' });
    }
  }
  if (tracked.awaitingRider) {
    emitRiderNeeded(tracked, { reasons: tracked.waitingReasons || [] });
  }

  res.json({
    ok: true,
    action,
    status: tracked.status,
    // True when the stage was only accepted because the rider's own stored
    // position was inside the geofence, and null for stages with no position
    // claim. The app can show the rider why the button did nothing.
    gpsVerified: result.gpsVerified,
    order: tracked,
    eta: result.eta
  });
});

// ------------------------------- POST /api/rider/orders/:id/payment-collected
/**
 * Cash taken at the door.
 *
 * Deliberately not a status: the order is already delivered, and giving payment
 * its own stage would put an entry on the customer's timeline that means nothing
 * to them. A repeat call answers successfully, because a retry over a poor
 * connection is not a second payment.
 */
router.post('/orders/:id/payment-collected', (req, res) => {
  const row = resolveOrderRow(normaliseOrderNumber(req.params.id));
  if (!row) return res.status(404).json({ error: 'Order not found', code: 'ORDER_NOT_FOUND' });

  const result = collectRiderPayment({
    orderId: row.id,
    actor: { id: req.user.id, name: req.user.name, role: 'rider' },
    method: req.body?.method
  });

  if (!result.ok) return refuse(res, result);
  if (result.alreadyCollected) {
    return res.json({ ok: true, order: result.order, alreadyCollected: true, paymentStatus: 'paid' });
  }
  res.json({ ok: true, order: result.order, alreadyCollected: false, paymentStatus: 'paid' });
});

export default router;
