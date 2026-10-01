import React from 'react';
import {
  ArrowLeft, Banknote, CheckCircle2, MapPin, Navigation, Phone, Receipt, Store
} from 'lucide-react';
import { primaryActionFor, stageLabel, isDelivered } from '../../lib/riderStages';
import { formatKm } from '../../lib/geo';
import { StatusPill, GpsStatus } from './RiderShared';
import DeliveryMap from '../DeliveryMap';

/** Where the customer's address is, or why it cannot be shown. */
function addressOf(order) {
  const a = order?.address;
  if (!a) return null;
  // `address` and `street` are frequently the same text - the order form writes
  // both - so they are de-duplicated rather than printed twice, which reads as
  // though the customer lived at two addresses.
  const parts = [a.address, a.street, a.landmark, a.city, a.state, a.pincode]
    .filter(Boolean)
    .filter((v, i, all) => all.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
  const hasPin = a.latitude != null && a.longitude != null && a.latitude !== '' && a.longitude !== '';
  return {
    line: parts.join(', ') || 'No address on file',
    hasPin,
    lat: a.latitude,
    lng: a.longitude,
    instructions: a.instructions || null
  };
}

/**
 * The delivery in hand, and the one control that moves it.
 *
 * The button is derived from the order's own stage, so there is no way to reach a
 * screen with two actions offered at once, and no way to see "MARK DELIVERED"
 * before the food is in the bag. The two GPS-derived steps are shown disabled,
 * with the measured distance, until the rider is actually close enough - the
 * server would refuse them otherwise, and a button that always fails teaches a
 * rider that the app is broken.
 */
export function RiderDeliveryDetail({ order, gps, onAction, busy, onBack, onNavigate, onCollectPayment, onRetryGps }) {
  const address = addressOf(order);
  const action = primaryActionFor(order.status);
  const done = isDelivered(order.status);
  const awaitingCash = order.payment_method !== 'cod' && order.payment_status !== 'paid' && done;

  // A step the server gates on position. It is only offered when the measured
  // distance says the rider is close; otherwise the distance is the message.
  const geofenceBlocked = action?.geofence && gps?.[action.distanceKey] != null && !gpsReady(gps, action.geofence);

  const press = () => {
    if (!action) return;
    if (action.kind === 'navigate') return onNavigate(address);
    return onAction(order.id, action.action);
  };

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 -ml-1 rounded-xl text-xs font-black text-neutral-600 hover:text-neutral-900 cursor-pointer transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}

      {/* What this is. */}
      <div className="rounded-3xl bg-white border border-neutral-200 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono font-bold text-xs text-neutral-500">{order.order_number}</div>
            <h2 className="font-black text-lg text-neutral-900 truncate mt-0.5">{order.customerName}</h2>
          </div>
          <StatusPill status={order.status} className="shrink-0" />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-neutral-50 rounded-2xl p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Status</dt>
            <dd className="font-black text-neutral-900 mt-0.5">{stageLabel(order.status)}</dd>
          </div>
          <div className="bg-neutral-50 rounded-2xl p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Distance</dt>
            <dd className="font-black text-neutral-900 mt-0.5">
              {order.deliveryDistanceKm != null ? formatKm(order.deliveryDistanceKm) : 'Not measured'}
            </dd>
          </div>
          <div className="bg-neutral-50 rounded-2xl p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Amount</dt>
            <dd className="font-black text-neutral-900 mt-0.5">₹{order.total_amount}</dd>
          </div>
          <div className="bg-neutral-50 rounded-2xl p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Payment</dt>
            <dd className="font-black text-neutral-900 mt-0.5 uppercase">
              {order.paymentStatus === 'paid' ? 'Paid' : order.payment_method}
            </dd>
          </div>
        </dl>

        <div className="flex items-start gap-2.5 text-xs text-neutral-700">
          <Store className="w-4 h-4 text-[#e53935] shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Restaurant</div>
            <div className="font-black text-neutral-900">Hotel Darshan</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 text-xs text-neutral-700">
          <MapPin className="w-4 h-4 text-[#e53935] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Customer address</div>
            <div className="font-bold text-neutral-900 leading-relaxed">{address?.line || 'No address on file'}</div>
            {address?.hasPin === false && (
              <p className="text-[11px] text-amber-700 mt-1">
                No map pin for this address - use the Navigate button.
              </p>
            )}
            {address?.instructions && (
              <p className="text-[11px] text-[#e53935] font-semibold mt-1">"{address.instructions}"</p>
            )}
          </div>
        </div>
      </div>

      {/* What is in the bag. */}
      <div className="rounded-3xl bg-white border border-neutral-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="w-4 h-4 text-neutral-400" />
          <h3 className="font-black text-sm text-neutral-900">Items</h3>
        </div>
        {Array.isArray(order.items) && order.items.length ? (
          <ul className="divide-y divide-neutral-100">
            {order.items.map((item, i) => (
              <li key={item.id ?? `${item.name}-${i}`} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                <span className="font-bold text-neutral-800">
                  <span className="text-neutral-400 font-black mr-1.5">{item.quantity ?? item.qty ?? 1}×</span>
                  {item.name || item.name_en || 'Item'}
                </span>
                <span className="font-mono text-neutral-500">₹{item.price ?? 0}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-neutral-500">No items on this order.</p>
        )}
      </div>

      {/* The ride, on a map the rider can read while stopped at a light.
          The rider's own dot is theirs at every stage - this is the one view where
          that is right, because they are the one navigating by it. */}
      <div className="rounded-3xl bg-white border border-neutral-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-neutral-400" />
          <h3 className="font-black text-sm text-neutral-900">Where you are going</h3>
        </div>
        <DeliveryMap
          hotel={order.map?.hotel}
          customer={order.map?.customer}
          // The live fix when there is one, and the server's last real position when
          // there is not - a phone that has just been refreshed, or one that has
          // lost signal. Passing the fallback with its own timestamp is what makes
          // the map mark it stale instead of drawing a dot that looks live.
          rider={gps?.point ?? gps?.lastKnown ?? null}
          riderName="You"
          ownPosition
          lastSeenAt={gps?.point?.at ?? gps?.lastKnown?.at ?? null}
          staleMessage={
            gps?.point
              ? 'Your position is out of date'
              : 'Not tracking live - this is your last known position'
          }
          className="h-56"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-neutral-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#e53935]" /> Hotel Darshan</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]" /> Customer</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> You</span>
        </div>
      </div>

      {/* Where the customer can see the rider. */}
      <GpsStatus gps={gps} onRetry={onRetryGps} />

      {order.customerPhone && (
        <a
          href={`tel:${order.customerPhone}`}
          className="flex items-center justify-center gap-2 min-h-[52px] rounded-2xl border-2 border-neutral-300 hover:bg-neutral-50 text-neutral-800 font-black text-sm transition"
        >
          <Phone className="w-4.5 h-4.5 text-emerald-600" /> Call customer
        </a>
      )}

      {/* The one control this stage offers. */}
      {action && (
        <div className="space-y-2">
          <button
            onClick={press}
            disabled={Boolean(busy) || Boolean(geofenceBlocked) || !address?.hasPin && action.kind === 'navigate'}
            className="w-full min-h-[60px] rounded-2xl bg-[#e53935] hover:bg-[#d32f2f] disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm tracking-wide flex items-center justify-center gap-2 transition"
          >
            {action.kind === 'navigate' ? <Navigation className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            {busy ? 'Working…' : action.label}
          </button>
          {geofenceBlocked && (
            <p className="text-[11px] font-bold text-amber-700 text-center">
              {action.geofence === 'hotel' ? 'Hotel' : 'Customer'} {formatKm(gps[action.distanceKey])} away — get closer to confirm.
            </p>
          )}
        </div>
      )}

      {done && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <p className="font-black text-emerald-900 text-sm">Delivery completed</p>
            <p className="text-[11px] text-emerald-700">Order {order.order_number} is closed.</p>
          </div>
        </div>
      )}

      {awaitingCash && onCollectPayment && (
        <button
          onClick={() => onCollectPayment(order.id)}
          disabled={Boolean(busy)}
          className="w-full min-h-[52px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs flex items-center justify-center gap-2 transition"
        >
          <Banknote className="w-4.5 h-4.5" /> Mark payment collected
        </button>
      )}
    </div>
  );
}

/**
 * Whether the rider's own last fix is inside the radius the server will accept.
 *
 * The threshold is the one the server told this app to use, so the button is
 * disabled for the same reason the request would be refused - and for no other.
 * An absent distance is not a block: the rider has no fix yet, which is a
 * different problem, and the server's own message is a better answer than a
 * button that is disabled for no stated reason.
 */
function gpsReady(gps, which) {
  const km = which === 'hotel' ? gps.distanceToHotelKm : gps.distanceToCustomerKm;
  if (km == null) return true;
  const limit = which === 'hotel' ? gps.config?.hotelArrivalMetres : gps.config?.nearCustomerMetres;
  if (limit == null) return true;
  return km * 1000 <= limit;
}

export default RiderDeliveryDetail;
