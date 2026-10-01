// The order status vocabulary, in one place on the client.
//
// The server owns this list - `orderTracking.js` is where the flow is defined and
// it is the only thing that can move an order. This file does not restate the
// flow: it names the same two halves the server does, so a screen can sort a list
// it was given, and it deliberately does not define any new status of its own.
//
// The two lists below used to be retyped in four components, and they had already
// drifted apart in three directions: one treated a delivery that was out for
// delivery as finished, one omitted rejected orders, and one had its own copy of
// the stepper rail that ended one stage before the server's did. Anything that
// has to agree with the server has to be written down once.

/** Terminal: the order will not move again. The server's FINISHED_STATUSES. */
export const FINISHED_STATUSES = ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'];

/** Every stage a delivery passes through, in order. The server's DELIVERY_FLOW. */
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

/** The stages a self-pickup order passes through. */
export const PICKUP_FLOW = [
  'ORDER_PLACED',
  'ORDER_CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'COMPLETED'
];

/** Everything that is not finished. The server's ACTIVE_STATUSES, by exclusion. */
export const isActive = (status) => !FINISHED_STATUSES.includes(status);
export const isFinished = (status) => FINISHED_STATUSES.includes(status);

/**
 * Only a delivered or completed order can be reviewed.
 *
 * This mirrors the check the review endpoint makes, so the customer is never shown
 * a form that would be refused. `DELIVERED` and `COMPLETED` are the same terminal
 * pair everywhere else in the app, so both are reviewable.
 */
export const canReview = (status) => status === 'DELIVERED' || status === 'COMPLETED';

/** The flow that applies to an order, from the order type the server sent. */
export const flowFor = (orderType) => (orderType === 'pickup' ? PICKUP_FLOW : DELIVERY_FLOW);

/**
 * Where a status sits in its flow, or -1 when it is not in it.
 *
 * A status the client does not recognise is -1 rather than 0 on purpose. Falling
 * back to "the first step" is what makes a cancelled or rejected order render as
 * though it had just been placed.
 */
export const stageIndex = (status, orderType) => flowFor(orderType).indexOf(status);

/**
 * Prefer the order's own `flow` from the server.
 *
 * The tracking payload carries the flow and the stages still to come, so a screen
 * showing one order should read them from there instead of keeping its own copy.
 * This returns the server's list when there is one, and only falls back to the
 * shared list above for the optimistic first paint before the payload arrives.
 */
export const flowOf = (order) => {
  const fromServer = Array.isArray(order?.flow) && order.flow.length ? order.flow : null;
  return fromServer || flowFor(order?.order_type);
};
