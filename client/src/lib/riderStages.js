// How a delivery stage becomes something a rider can read and press.
//
// This is the rider's own map, and it is deliberately written out rather than
// derived. The server has `nextActions`, but that list answers a different
// question: it lists the next stage, and it omits the stages that are derived
// from GPS because "a stage the server sets from GPS is not a button". A rider
// pressing CONFIRM ARRIVAL is not asserting that they have arrived - the server
// checks their stored position and refuses them if it does not support it. So
// the button belongs here, with the stage it names, and the two that the server
// gates on distance say so.
//
// Nothing here is a status name the server has not told us about. Every label is
// looked up by the order's own `status` at render time, and a stage that is not
// listed renders as a read-only row rather than a button that would be refused.

/** Where a rider is in a delivery, in their own words. */
export const STAGE_LABELS = {
  RIDER_ASSIGNED: 'Assigned',
  RIDER_GOING_TO_HOTEL: 'On the way to the hotel',
  RIDER_ARRIVED_AT_HOTEL: 'At the hotel',
  PICKED_UP: 'Collected',
  OUT_FOR_DELIVERY: 'On the way to the customer',
  RIDER_NEAR_CUSTOMER: 'At the customer',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected'
};

/** The order of the stages, for the progress rail. */
export const STAGE_ORDER = [
  'RIDER_ASSIGNED',
  'RIDER_GOING_TO_HOTEL',
  'RIDER_ARRIVED_AT_HOTEL',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'RIDER_NEAR_CUSTOMER',
  'DELIVERED'
];

/** How a stage is coloured. One place, so a stage cannot look like two things. */
const STAGE_TONE = {
  RIDER_ASSIGNED: 'bg-sky-100 text-sky-800',
  RIDER_GOING_TO_HOTEL: 'bg-indigo-100 text-indigo-800',
  RIDER_ARRIVED_AT_HOTEL: 'bg-violet-100 text-violet-800',
  PICKED_UP: 'bg-amber-100 text-amber-800',
  OUT_FOR_DELIVERY: 'bg-orange-100 text-orange-800',
  RIDER_NEAR_CUSTOMER: 'bg-teal-100 text-teal-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-neutral-200 text-neutral-600',
  REJECTED: 'bg-neutral-200 text-neutral-600'
};

export const stageTone = (status) => STAGE_TONE[status] || 'bg-neutral-100 text-neutral-700';

export const stageLabel = (status) => STAGE_LABELS[status] || status || 'Unknown';

export const isFinished = (status) => ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(status);

/**
 * The one control a rider is offered at each stage.
 *
 * `action` is the server's own action name, sent to
 * `POST /api/rider/orders/:id/actions/:action`. `geofence` marks the two that
 * the server verifies against the rider's stored position, and `distanceKey`
 * says which measured distance the screen shows next to the button while it is
 * still disabled - so a rider who cannot press it can see how far they still
 * have to go, which is the actual reason.
 *
 * `kind: 'navigate'` is the one step that is not a status: reaching the customer
 * is opening the map, and the server derives that stage from the rider's own
 * position rather than being told.
 */
export const PRIMARY_ACTION = {
  RIDER_ASSIGNED: { action: 'start_trip', label: 'GO TO HOTEL', kind: 'status' },
  RIDER_GOING_TO_HOTEL: {
    action: 'arrived_at_hotel', label: 'CONFIRM ARRIVAL', kind: 'status',
    geofence: 'hotel', distanceKey: 'distanceToHotelKm'
  },
  RIDER_ARRIVED_AT_HOTEL: { action: 'confirm_pickup', label: 'PICK UP ORDER', kind: 'status' },
  PICKED_UP: { action: 'start_delivery', label: 'START DELIVERY', kind: 'status' },
  OUT_FOR_DELIVERY: { action: null, label: 'NAVIGATE TO CUSTOMER', kind: 'navigate' },
  RIDER_NEAR_CUSTOMER: { action: 'mark_delivered', label: 'MARK DELIVERED', kind: 'status' }
};

/** What the delivery detail screen offers at this stage, or null. */
export function primaryActionFor(status) {
  return PRIMARY_ACTION[status] || null;
}

export const isDelivered = (status) => status === 'DELIVERED' || status === 'COMPLETED';

/**
 * Whether the food is in the rider's bag.
 *
 * This is what decides which pin the customer is watching: before the pickup the
 * rider is heading for the hotel, and after it they are heading for the customer.
 * Guessing it wrong would show a rider on the way to a customer map while the
 * food is still sitting on the counter.
 */
export const isPickedUpStage = (status) =>
  ['PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_NEAR_CUSTOMER'].includes(status);

