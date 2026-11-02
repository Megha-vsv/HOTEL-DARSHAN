import { db } from './db.js';
import { verifyToken } from './auth.js';
import {
  recordRiderLocation,
  getOrder,
  getRiderState,
  riderActiveOrders,
  riderProfile,
  trackingPayload
} from './orderTrackingService.js';

let ioInstance = null;

/**
 * The one place an order room name is built.
 *
 * Every join and every publish goes through here, so a room can never be joined
 * under one spelling and published to under another - which is the failure mode
 * that produces a tracker that silently stops updating.
 */
const orderRoom = (orderId) => `order:${orderId}`;
const riderRoom = (riderId) => `rider:${riderId}`;

/** The rider's own orders, and (for a customer) the ones they placed. */
function ordersForUser(user) {
  if (!user) return [];
  if (user.role === 'rider') {
    return db.prepare(`
      SELECT id FROM orders
      WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
      ORDER BY id ASC
    `).all(user.id);
  }
  // A customer's rooms come from the orders they placed, matched on the account
  // or on the phone number, so an order placed before sign-in is still theirs.
  // The parentheses matter: without them `AND` binds tighter than `OR` and every
  // order this customer ever placed comes back, finished ones included.
  return db.prepare(`
    SELECT id FROM orders
    WHERE (user_id = ? OR (customer_phone IS NOT NULL AND REPLACE(customer_phone,' ','') = ?))
      AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
    ORDER BY id ASC
  `).all(user.id, String(user.phone || '').replace(/\D/g, ''));
}

/**
 * Who is this socket?
 *
 * A socket used to be anonymous, which meant anyone could join any order room
 * and every customer was pushed every other customer's order. The token is the
 * same JWT the HTTP API uses, so the socket and the REST endpoints agree on
 * identity and an order can be checked for ownership in one place.
 */
function identifySocket(socket) {
  const token =
    socket.handshake?.auth?.token ||
    socket.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
    null;
  const claims = verifyToken(token);
  if (!claims) return null;
  return db.prepare('SELECT id, name, phone, role FROM users WHERE id = ?').get(claims.id) || null;
}

/** Can this user be told about this order? Staff see everything; customers see their own. */
function mayFollowOrder(user, order) {
  if (!user || !order) return false;
  if (['admin', 'chef', 'rider'].includes(user.role)) return true;
  if (order.user_id && order.user_id === user.id) return true;
  const a = String(user.phone || '').replace(/\D/g, '');
  const b = String(order.customer_phone || '').replace(/\D/g, '');
  return !!a && a === b;
}

/**
 * Put a freshly connected socket in the rooms the database says it belongs in.
 *
 * Room membership does not survive a reconnect, so a client that has to
 * remember to re-ask will eventually stop receiving updates - and it will look
 * like the server went quiet rather than like a client bug. Reading the
 * membership from the database instead means a rider who reconnects is back in
 * their order room and the customer who reconnects is back in theirs, whether or
 * not their code re-emitted anything.
 *
 * What it also means is that a client cannot widen its own reach: membership is
 * decided by ownership of the order, not by what the socket asks to join.
 */
function autoJoinRooms(socket, user) {
  if (!user) return;
  if (user.role === 'rider') {
    socket.join('riders_room');
    socket.join(riderRoom(user.id));
  }
  // Staff rooms are re-joined here rather than left to each client to ask for.
  //
  // Room membership does not survive a reconnect: the server holds it per socket,
  // and a new socket starts in no rooms at all. The admin and kitchen screens did
  // emit `join_admin` / `join_kitchen` on mount, but only on mount - so a dropped
  // connection silently moved them out of their own rooms, and everything published
  // only to those rooms stopped arriving: the rider board went stale, availability
  // changes went unseen, and the orders list was left to a poll. Deriving the room
  // from the authenticated role means a reconnection cannot leave a staff screen
  // listening to nothing, whatever the client does or forgets to do.
  if (user.role === 'admin') socket.join('admin_room');
  if (user.role === 'chef' || user.role === 'kitchen') socket.join('kitchen_room');
  for (const { id } of ordersForUser(user)) socket.join(orderRoom(id));
}

function kitchenBoardOrders() {
  const rows = db.prepare(`
    SELECT id FROM orders
    WHERE status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
       OR id IN (
         SELECT id FROM orders
         WHERE status IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
         ORDER BY id DESC LIMIT 50
       )
    ORDER BY id DESC
  `).all();
  return rows.map(({ id }) => trackingPayload(getOrder(id))).filter(Boolean);
}

/**
 * The state a reconnecting client cannot have got from the events it missed.
 *
 * Sent unprompted on every connection, so a rider whose laptop slept through
 * three stage changes still comes back to a correct screen. It is the
 * authoritative read: the client is told what is true now, not what it was told
 * earlier.
 */
function resyncPayload(user) {
  if (!user) return { ok: false, reason: 'Not authenticated' };
  if (user.role === 'rider') {
    return {
      ok: true,
      role: 'rider',
      rider: riderProfile(user.id),
      state: getRiderState(user.id).rider_state,
      // The delivery in hand, if there is one. This is what the rider app needs
      // to redraw itself after a drop, rather than waiting to be told again.
      activeDeliveries: riderActiveOrders(user.id) || [],
      orders: ordersForUser(user).map((r) => trackingPayload(getOrder(r.id))).filter(Boolean),
      at: new Date().toISOString()
    };
  }
  if (user.role === 'admin' || user.role === 'chef') {
    return {
      ok: true,
      role: user.role,
      orders: kitchenBoardOrders(),
      at: new Date().toISOString()
    };
  }
  return {
    ok: true,
    role: user.role,
    orders: ordersForUser(user).map((r) => trackingPayload(getOrder(r.id))).filter(Boolean),
    // The ones that just finished. Without these, a customer who refreshes two
    // seconds after the handover is shown nothing at all - the order they are
    // looking for has already left the live set, and the live set is all that is
    // left to recover.
    recent: db.prepare(`
      SELECT id FROM orders
      WHERE user_id = ? OR (customer_phone IS NOT NULL AND REPLACE(customer_phone,' ','') = ?)
      ORDER BY id DESC LIMIT 5
    `).all(user.id, String(user.phone || '').replace(/\D/g, ''))
      .map((r) => trackingPayload(getOrder(r.id))).filter(Boolean),
    at: new Date().toISOString()
  };
}

export function initSocketIO(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    const user = identifySocket(socket);
    socket.data.user = user;

    // Membership first, then the state that goes with it. Joining before replying
    // means a client that acts on this snapshot cannot miss an event caused by its
    // own reaction.
    autoJoinRooms(socket, user);
    if (user) socket.emit('sync', resyncPayload(user));

    // Room joining
    socket.on('join_order', (orderId) => {
    // Accept an id or an order number in any of the forms people copy, and
    // always join the room the status updates are published to.
    const raw = String(orderId ?? '').trim();
    if (!raw) return;
    let id = raw;
    if (!/^\d+$/.test(raw)) {
      const order = db
        .prepare('SELECT id FROM orders WHERE UPPER(order_number) = ?')
        .get(raw.replace(/^#+/, '').trim().toUpperCase());
      if (!order) return;
      id = order.id;
    }
    const order = getOrder(id);
    if (!mayFollowOrder(user, order)) return;

    socket.join(orderRoom(order.id));

    // Hand back the current state immediately. Without this the tracker has to
    // wait for the next change and shows nothing until one happens, and any
    // update sent while the socket was down is simply lost.
    socket.emit('order:snapshot', trackingPayload(order));
    });

    socket.on('leave_order', (orderId) => {
    const raw = String(orderId ?? '').trim();
    if (/^\d+$/.test(raw)) socket.leave(orderRoom(Number(raw)));
    });

    /**
     * Ask for the current state again.
     *
     * The connection already sends this unprompted, so a client only needs this
     * when it wants to be certain after something it did - the acknowledgement is
     * the same shape, which keeps the client from having two resync paths.
     */
    socket.on('resync', (ack) => {
      const payload = resyncPayload(socket.data.user);
      if (typeof ack === 'function') ack(payload);
      else if (socket.data.user) socket.emit('sync', payload);
    });

    socket.on('join_kitchen', () => {
      // Kitchen sees the whole board, so this is a staff-only room.
      if (!user || !['admin', 'chef'].includes(user.role)) return;
      socket.join('kitchen_room');
    });

    socket.on('join_admin', () => {
      if (!user || !['admin', 'chef'].includes(user.role)) return;
      socket.join('admin_room');
    });

    socket.on('join_rider', (riderId) => {
      if (!user || !['admin', 'rider'].includes(user.role)) return;
      // The counter feed, where ready orders are offered to whoever is free.
      socket.join('riders_room');
      // A rider's own room, which carries the updates for the orders they hold.
      // The id is taken from the authenticated socket, never from the argument:
      // a rider who could name somebody else's id would be told about another
      // rider's customer, name and position.
      const own = user.role === 'rider' ? user.id : Number(riderId) || user.id;
      if (own) socket.join(`rider_${own}`);
    });

    /**
     * A rider's live position.
     *
     * This used to be a broadcast of whatever coordinates the client sent, which
     * meant a rider could be made to "move" anywhere - or move while carrying
     * nothing - and nothing was ever stored. It now goes through the same service
     * the HTTP endpoint uses: the position is validated, saved, and only the
     * rider's own active order can be advanced by it.
     *
     * It also publishes, which it did not used to do at all: a rider whose app
     * pushes its position over the socket was storing it and telling nobody, so
     * the customer watched a rider frozen at the hotel for the whole delivery.
     */
    socket.on('rider:location_update', (payload = {}, ack) => {
      const reply = (r) => (typeof ack === 'function' ? ack(r) : undefined);
      try {
        if (!user || !['rider', 'admin'].includes(user.role)) {
          return reply({ ok: false, error: 'Not allowed' });
        }
        // Both spellings are accepted, and the long ones first.
        //
        // The rider's GPS engine sends `latitude`/`longitude` - the same names the
        // HTTP endpoint takes - and this handler used to read `lat`/`lng`. Every
        // position sent over the socket therefore arrived as `undefined`, was
        // refused as an unusable coordinate, and was announced to the customer as
        // "rider location unavailable" while the rider was standing in plain view
        // moving. The engine then quietly fell back to HTTP, so tracking limped
        // along on the slow path and nothing ever looked broken. A wire-format
        // disagreement must not be able to fail this silently, so the short forms
        // are still honoured for other senders and the long ones are authoritative.
        const {
          orderId,
          lat = payload?.latitude,
          lng = payload?.longitude,
          accuracy
        } = payload;
        // A position is only attached to an order the rider is actually
        // carrying. Without this an idle rider could move somebody else's
        // delivery, and a stored point would be shown to customers as their
        // rider's location.
        let order = orderId ? getOrder(orderId) : null;
        if (order && user.role === 'rider' && order.rider_id !== user.id) {
          return reply({ ok: false, error: 'This order is assigned to another rider' });
        }
        if (!order && user.role === 'rider') {
          order = db.prepare(`
            SELECT * FROM orders
            WHERE rider_id = ? AND order_type = 'delivery'
              AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
            ORDER BY id DESC LIMIT 1
          `).get(user.id) || null;
        }

        // An admin may report for a rider they name explicitly.
        const riderId = user.role === 'rider' ? user.id : Number(payload.riderId) || order?.rider_id;
        if (!riderId) return reply({ ok: false, error: 'No rider for this position' });

        // A rider with nothing to carry still reports a position, so the assigner
        // knows where they are instead of ranking them last for having no point.
        // It is stored against the rider, never published as a customer's rider.
        const result = recordRiderLocation({ riderId, lat, lng, orderId: order?.id });
        if (!result.ok) {
          // The rider has a delivery and the position they sent was unusable. That
          // is different from having no delivery: the customer is expecting a
          // position and is not getting one, so they are told the tracking is
          // blind rather than left looking at a stale pin.
          if (order) emitRiderLocationUnavailable(trackingPayload(getOrder(order.id)), { reason: result.error });
          return reply({ ok: false, error: result.error });
        }

        // Published only when there is a live order to publish it for. A rider
        // waiting at the counter generating a fix every few seconds must not wake
        // a customer tracker with an update that changes nothing.
        if (order) {
          // The tracking payload, not the raw row: the payload is what carries the
          // distance to the customer, the ETA and the nearby flag, and publishing
          // the row instead would send an event with those fields missing.
          const fresh = trackingPayload(getOrder(order.id));
          emitRiderLocation(fresh);
          // A position that crossed a geofence has also moved the order on, and
          // the status event is what carries the history that came with it.
          if (result.advanced) emitOrderStatusUpdated(fresh, { changedByRole: 'rider', note: 'Rider location' });
        }

        return reply({
          ok: true,
          advanced: result.advanced,
          accuracy: accuracy ?? null,
          state: result.riderState || null
        });
      } catch (err) {
        return reply({ ok: false, error: err.message });
      }
    });

    /**
     * The rider says they have no fix - no permission, GPS off, no signal.
     *
     * Recorded as a fact about the order rather than as coordinates, because a
     * tracker that keeps showing the last known point is quietly lying: it looks
     * live and is not. The customer is told the position is unavailable.
     */
    socket.on('rider:location_unavailable', (payload = {}, ack) => {
      const reply = (r) => (typeof ack === 'function' ? ack(r) : undefined);
      if (!user || !['rider', 'admin'].includes(user.role)) {
        return reply({ ok: false, error: 'Not allowed' });
      }
      const riderId = user.role === 'rider' ? user.id : Number(payload.riderId) || null;
      if (!riderId) return reply({ ok: false, error: 'No rider for this position' });

      const order = payload.orderId
        ? getOrder(payload.orderId)
        : db.prepare(`
            SELECT * FROM orders
            WHERE rider_id = ? AND status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
            ORDER BY id DESC LIMIT 1
          `).get(riderId);
      if (!order || order.rider_id !== riderId) {
        return reply({ ok: false, error: 'No active delivery for this rider' });
      }
      emitRiderLocationUnavailable(trackingPayload(order), { reason: payload.reason || 'No GPS fix' });
      return reply({ ok: true });
    });

    socket.on('disconnect', () => {
    // Clean disconnect
    });
  });

  return io;
}

export function getIO() {
  return ioInstance;
}

export function emitOrderCreated(order) {
  if (!ioInstance) return;
  ioInstance.to('kitchen_room').emit('order:created', order);
  ioInstance.to('admin_room').emit('order:created', order);
}

/**
 * Publish a status change.
 *
 * The order's own fields stay at the top level because the admin list, the
 * kitchen board and the cart already read `payload.status` and `payload.id`.
 * The envelope keys are added alongside them so a consumer that wants to know
 * who changed the stage and when does not have to diff two events to find out.
 *
 * Callers must have written the database change first - this only announces it.
 */
export function emitOrderStatusUpdated(order, context = {}) {
  if (!ioInstance) return;
  const payload = {
    ...order,
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    timestamp: context.timestamp || new Date().toISOString(),
    changedBy: context.changedBy || null,
    changedByRole: context.changedByRole || null,
    note: context.note || null,
    order
  };
  ioInstance.to(orderRoom(order.id)).emit('order:status_updated', payload);
  ioInstance.to('kitchen_room').emit('order:status_updated', payload);
  ioInstance.to('admin_room').emit('order:status_updated', payload);
  // Notify all riders when order is READY for pickup (delivery only)
  if (order.status === 'READY' && order.order_type === 'delivery') {
    ioInstance.to('riders_room').emit('order:status_updated', payload);
  }
  if (order.rider_id && order.order_type === 'delivery') {
    ioInstance.to(riderRoom(order.rider_id)).emit('order:status_updated', payload);
  }

  // The named milestones, derived from the stage that was just written.
  //
  // Fanning out from here rather than from each call site is deliberate: every
  // status change in the system already passes through this function, after the
  // database commit and the history row. Putting the specific events here is what
  // makes the order database -> history -> socket structural rather than a
  // convention somebody has to remember at each of the six call sites.
  emitMilestones(order, payload);
}

/**
 * The events a screen wants for one particular moment, as opposed to every
 * change. `order:status_updated` is the general feed; these say what happened
 * without the consumer having to switch on the status itself.
 */
function emitMilestones(order, payload) {
  const stage = {
    RIDER_GOING_TO_HOTEL: 'order:deliveryStarted',
    OUT_FOR_DELIVERY: 'order:deliveryStarted',
    RIDER_NEAR_CUSTOMER: 'order:riderNearCustomer',
    DELIVERED: 'order:delivered',
    COMPLETED: 'order:delivered'
  }[order.status];
  if (!stage || order.order_type !== 'delivery') return;

  ioInstance.to(orderRoom(order.id)).emit(stage, payload);
  ioInstance.to('admin_room').emit(stage, payload);
  if (order.rider_id) ioInstance.to(riderRoom(order.rider_id)).emit(stage, payload);

  // The rider is also told in their own vocabulary, because that is the app that
  // has to change a screen, and the customer's copy of the same fact is a
  // different message.
  if (order.rider_id) {
    ioInstance.to(riderRoom(order.rider_id)).emit('notification', {
      type: stage,
      order_id: order.id,
      order_number: order.order_number,
      message: MILESTONE_NOTES[order.status] || 'Order updated',
      at: payload.timestamp,
      order
    });
  }
  ioInstance.to(orderRoom(order.id)).emit('notification', {
    type: stage,
    order_id: order.id,
    order_number: order.order_number,
    message: CUSTOMER_MILESTONE_NOTES[order.status] || 'Your order was updated',
    at: payload.timestamp,
    order
  });
}

const MILESTONE_NOTES = {
  RIDER_GOING_TO_HOTEL: 'Head to the hotel to collect your order',
  OUT_FOR_DELIVERY: 'On the way to the customer',
  RIDER_NEAR_CUSTOMER: 'You are close to the customer',
  DELIVERED: 'Delivered. Collect payment if the order is cash on delivery',
  COMPLETED: 'Delivery complete'
};

const CUSTOMER_MILESTONE_NOTES = {
  RIDER_GOING_TO_HOTEL: 'Your rider is on the way to the restaurant',
  OUT_FOR_DELIVERY: 'Your order is on the way',
  RIDER_NEAR_CUSTOMER: 'Your rider is almost at your door',
  DELIVERED: 'Your order has been delivered',
  COMPLETED: 'Your order is complete'
};

/**
 * A rider went online, offline, or moved between taking work and carrying it.
 *
 * The admin board shows who can take work, so this is what stops it showing a
 * rider who has gone home. Emitted after the state is committed, for the same
 * reason as every other event here: a board that flickers to AVAILABLE and then
 * back is worse than one that is briefly late.
 */
export function emitRiderAvailabilityChanged(rider, { previousState = null, reason = null } = {}) {
  if (!ioInstance || !rider) return;
  const id = rider.id ?? rider.rider_id;
  const state = rider.riderState ?? rider.rider_state ?? null;
  if (!id || !state) return;
  const payload = {
    rider_id: id,
    name: rider.name ?? null,
    state,
    previousState,
    isOnline: state !== 'OFFLINE',
    isAvailable: state === 'AVAILABLE',
    reason,
    at: new Date().toISOString()
  };
  ioInstance.to('admin_room').emit('rider:availabilityChanged', payload);
  ioInstance.to('riders_room').emit('rider:availabilityChanged', payload);
  ioInstance.to(riderRoom(id)).emit('rider:availabilityChanged', payload);
}

/**
 * A rider has been given this order.
 *
 * Three audiences, three different things to do, so three events rather than one
 * they all have to filter:
 *
 *  - the order room and the admin room learn who is carrying the order
 *  - the rider learns they have a new delivery, and is told to start tracking
 *  - every rider learns the counter queue changed, so a claim list that still
 *    shows this order disappears without a refresh
 *
 * Only ever called after the assignment transaction has committed. A rider that
 * is told about a delivery that was then rolled back would drive to a restaurant
 * for nothing, and the customer would be watching a rider who is not coming.
 */
export function emitRiderAssigned(order, { rider, method = 'auto', note = null } = {}) {
  if (!ioInstance || !order) return;
  const at = new Date().toISOString();
  const base = {
    order_id: order.id,
    order_number: order.order_number,
    status: order.status,
    assigned_at: order.assigned_at || at,
    method,
    note,
    at
  };

  // Customer and admin: who is bringing this order.
  const forWatcher = {
    ...base,
    rider: {
      id: rider?.id ?? order.rider_id ?? null,
      name: order.rider_name ?? rider?.name ?? null,
      phone: order.rider_phone ?? rider?.phone ?? null,
      distance_km: rider?.distanceKm ?? null
    },
    order
  };
  ioInstance.to(orderRoom(order.id)).emit('order:riderAssigned', forWatcher);
  ioInstance.to('admin_room').emit('order:riderAssigned', forWatcher);
  ioInstance.to('kitchen_room').emit('order:riderAssigned', forWatcher);

  // The rider who was given the work.
  if (order.rider_id) {
    ioInstance.to(riderRoom(order.rider_id)).emit('rider:orderAssigned', forWatcher);
  }
  // Everyone at the counter, so the claimable list stays honest.
  ioInstance.to('riders_room').emit('rider:orderAssigned', {
    ...base,
    order_id: order.id,
    order_number: order.order_number,
    status: order.status,
    // Explicit, because the other listeners for this event are not the rider.
    for_rider_id: order.rider_id
  });
}

/**
 * The rider no longer has this order - it was cancelled, rejected, or handed to
 * somebody else.
 *
 * Without this the rider's app keeps tracking a delivery that will never happen,
 * and the customer keeps watching a rider who has turned back.
 */
export function emitRiderReleased(order, { riderId, reason = 'Order no longer active' } = {}) {
  if (!ioInstance || !order) return;
  const payload = {
    order_id: order.id,
    order_number: order.order_number,
    status: order.status,
    rider_id: riderId ?? null,
    reason,
    at: new Date().toISOString(),
    order
  };
  if (riderId) ioInstance.to(riderRoom(riderId)).emit('rider:orderReleased', payload);
  ioInstance.to(orderRoom(order.id)).emit('order:riderReleased', payload);
  ioInstance.to('admin_room').emit('order:riderReleased', payload);
  ioInstance.to('riders_room').emit('rider:orderReleased', payload);
}

/**
 * A ready delivery that nobody could take.
 *
 * Sent to the admin room so the board can say "waiting for delivery partner"
 * immediately, instead of leaving a rider-less order to be read as a bug.
 */
export function emitRiderNeeded(order, { reasons = [] } = {}) {
  if (!ioInstance || !order) return;
  const payload = {
    order_id: order.id,
    order_number: order.order_number,
    status: order.status,
    assignment_state: 'WAITING_FOR_RIDER',
    message: 'Waiting for delivery partner',
    reasons,
    at: new Date().toISOString(),
    order
  };
  ioInstance.to('admin_room').emit('order:riderNeeded', payload);
  ioInstance.to('riders_room').emit('order:riderNeeded', payload);
}

/**
 * A rider's live position. Sent to the order room (for the customer tracker) and
 * the admin room (for the orders list) so the shrinking distance is shown
 * without a page refresh.
 *
 * `available` is explicit rather than left to the client to infer from missing
 * coordinates, because a client cannot tell "the rider is not moving" from "we
 * have not heard from the rider" by looking at a pair of numbers.
 */
export function emitRiderLocation(order) {
  if (!ioInstance) return;
  const hasFix = order.rider_lat != null && order.rider_lng != null;
  const payload = {
    order_id: order.id,
    order_number: order.order_number,
    available: hasFix,
    rider_lat: order.rider_lat ?? null,
    rider_lng: order.rider_lng ?? null,
    rider_to_customer_km: order.riderToCustomerKm ?? null,
    rider_nearby: Boolean(order.riderNearby),
    eta: order.eta ?? null,
    message: hasFix ? null : LOCATION_UNAVAILABLE_MESSAGE,
    at: new Date().toISOString()
  };
  ioInstance.to(orderRoom(order.id)).emit('rider:location', payload);
  ioInstance.to('admin_room').emit('rider:location', payload);
  if (order.rider_id) ioInstance.to(riderRoom(order.rider_id)).emit('rider:location', payload);
}

/** What the customer is told instead of a position the server does not have. */
export const LOCATION_UNAVAILABLE_MESSAGE = 'Rider location temporarily unavailable';

/**
 * Tell the tracker its rider's position is not being reported.
 *
 * No coordinates are sent, and none are invented: the last known point is not
 * republished as though it were live, because a stale pin drawn on a map is a
 * claim the server cannot support. The customer is told the position is
 * unavailable, which is true and actionable - they know not to trust the pin.
 */
export function emitRiderLocationUnavailable(order, { reason = null } = {}) {
  if (!ioInstance || !order) return;
  const payload = {
    order_id: order.id,
    order_number: order.order_number,
    available: false,
    rider_lat: null,
    rider_lng: null,
    rider_to_customer_km: null,
    rider_nearby: false,
    eta: order.eta ?? null,
    message: LOCATION_UNAVAILABLE_MESSAGE,
    reason,
    at: new Date().toISOString()
  };
  ioInstance.to(orderRoom(order.id)).emit('rider:location', payload);
  ioInstance.to('admin_room').emit('rider:location', payload);
  if (order.rider_id) ioInstance.to(riderRoom(order.rider_id)).emit('rider:location', payload);
}

/** Tell the admin panel a customer review was saved, so it shows up without a reload. */
export function emitReviewCreated(review) {
  if (!ioInstance) return;
  ioInstance.to('admin_room').emit('review:created', review);
}

export function emitItemAvailabilityChanged(item) {  if (!ioInstance) return;
  // Broadcast to all clients (customers, kitchen, admin)
  ioInstance.emit('menu:availability_changed', item);
}

export function emitNotification(room, notification) {
  if (!ioInstance) return;
  if (room) {
    ioInstance.to(room).emit('notification', notification);
  } else {
    ioInstance.emit('notification', notification);
  }
}

/**
 * Push one of a rider's own feed entries to that rider.
 *
 * Scoped to the rider's own room, so a notice about somebody else's delivery can
 * never reach a phone that is not theirs. Call this only after the row has
 * committed: a rider told about a cancellation that then rolled back would drive
 * to an order that no longer exists.
 */
export function emitRiderNotice(notice) {
  if (!ioInstance || !notice?.riderId) return;
  ioInstance.to(riderRoom(notice.riderId)).emit('notification', {
    type: notice.type,
    title: notice.title,
    message: notice.message,
    // Snake case, matching the shape the other socket events on this channel use.
    order_id: notice.orderId,
    order_number: notice.orderNumber,
    at: notice.at
  });
}
