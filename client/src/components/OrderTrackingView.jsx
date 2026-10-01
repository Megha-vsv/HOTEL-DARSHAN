import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  CheckCircle2,
  Clock3,
  CookingPot,
  MapPin,
  PackageCheck,
  RefreshCw,
  Truck,
  XCircle,
  Phone
} from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { flowOf, stageIndex, isFinished as isFinishedStatus } from '../lib/orderStatus';
import { parseServerTimestamp, formatDateTime, formatEstimatedArrival } from '../lib/time.js';
import DeliveryMap from './DeliveryMap';

// Expected minutes at each status boundary, aligned with DELIVERY_STATUS_STEPS.
// Only used for the shape of the countdown; the minutes actually shown come
// from the server's ETA, which is derived from real distances and speeds.
const DELIVERY_STATUS_TIMELINE_MIN = [
  { key: 'ORDER_PLACED', minutes: 0 },
  { key: 'ORDER_CONFIRMED', minutes: 1 },
  { key: 'PREPARING', minutes: 4 },
  { key: 'READY', minutes: 10 },
  { key: 'RIDER_ASSIGNED', minutes: 12 },
  { key: 'RIDER_GOING_TO_HOTEL', minutes: 13 },
  { key: 'RIDER_ARRIVED_AT_HOTEL', minutes: 16 },
  { key: 'PICKED_UP', minutes: 17 },
  { key: 'OUT_FOR_DELIVERY', minutes: 19 },
  { key: 'RIDER_NEAR_CUSTOMER', minutes: 28 },
  { key: 'DELIVERED', minutes: 30 }
];

// Expected minutes at each status boundary (25-minute total pickup promise)
const PICKUP_STATUS_TIMELINE_MIN = [
  { key: 'ORDER_PLACED', minutes: 0 },
  { key: 'ORDER_CONFIRMED', minutes: 1 },
  { key: 'PREPARING', minutes: 2 },
  { key: 'READY_FOR_PICKUP', minutes: 10 },
  { key: 'PICKED_UP', minutes: 20 },
  { key: 'COMPLETED', minutes: 25 }
];

// How each stage is labelled and which icon stands for it.
//
// This is presentation only - the ORDER of the stages comes from the server, via
// `flowOf`. Keeping the two apart is the point: a new stage on the server appears
// in the rail as soon as it is in the flow, and falls back to its own name here
// rather than being dropped from the rail or, worse, mistaken for the first step.
const STEP_META = {
  ORDER_PLACED: { label: 'Order Placed', icon: Clock3 },
  ORDER_CONFIRMED: { label: 'Restaurant Confirmed', icon: CheckCircle2 },
  PREPARING: { label: 'Preparing', icon: CookingPot },
  READY: { label: 'Food Ready', icon: PackageCheck },
  READY_FOR_PICKUP: { label: 'Ready for Pickup', icon: PackageCheck },
  RIDER_ASSIGNED: { label: 'Rider Assigned', icon: Bike },
  RIDER_GOING_TO_HOTEL: { label: 'Rider On The Way', icon: Bike },
  RIDER_ARRIVED_AT_HOTEL: { label: 'Rider At Restaurant', icon: Bike },
  PICKED_UP: { label: 'Picked Up', icon: PackageCheck },
  OUT_FOR_DELIVERY: { label: 'Out for Delivery', icon: Truck },
  RIDER_NEAR_CUSTOMER: { label: 'Arriving Now', icon: MapPin },
  DELIVERED: { label: 'Delivered', icon: CheckCircle2 },
  COMPLETED: { label: 'Completed', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', icon: XCircle },
  REJECTED: { label: 'Rejected', icon: XCircle }
};

function money(value) {
  const amount = Number(value || 0);
  return `₹${amount.toFixed(2)}`;
}

/**
 * The server's timestamps, read correctly. This used to call `new Date(value)`
 * on the database's timezone-naive UTC string, which a browser reads as local
 * time - so a 11:22 PM IST order parsed as 17:52 IST. That was not only a
 * mislabelled time on screen: `elapsedMin` below is measured from `created_at`,
 * so the 5h30m error made the progress bar read 100% and the countdown negative
 * the instant the page opened, for every IST evening order.
 */
function formatDate(value) {
  return formatDateTime(value);
}

function formatCountdown(minutes) {
  if (minutes <= 0) return 'Now';
  const m = Math.floor(minutes);
  const s = Math.floor((minutes - m) * 60);
  return `${m}m ${s}s`;
}

function Countdown({ order }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!order || isFinishedStatus(order.status)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [order?.status]);

  if (!order?.created_at) return null;

  // `parseServerTimestamp` rather than `new Date(...)`: `created_at` is UTC
  // written as a space-separated string with no zone marker, and read as local
  // it is 5h30m out - which is what made this countdown start at -330 minutes.
  const createdMs = parseServerTimestamp(order.created_at);
  if (createdMs === null) return null;

  const elapsedMin = (now - createdMs) / 60000;
  // The stage index from the shared flow, not a lookup in this component's own
  // copy of the steps - a REJECTED order is -1 here, and must not be treated as
  // stage 0 when working out how long the previous stage took.
  const currentIdx = stageIndex(order.status, order.order_type);
  const timelineMin = order.order_type === 'pickup' ? PICKUP_STATUS_TIMELINE_MIN : DELIVERY_STATUS_TIMELINE_MIN;
  const nextStep = timelineMin[currentIdx + 1];
  const prevStep = timelineMin[currentIdx];

  if (order.status === 'DELIVERED' || order.status === 'COMPLETED') {
    return <span className="text-emerald-600 font-black text-sm">Completed ✓</span>;
  }
  if (isFinishedStatus(order.status)) {
    return (
      <span className="text-red-600 font-black text-sm">
        {STEP_META[order.status]?.label || order.status}
      </span>
    );
  }

  const remainingToNext = nextStep ? nextStep.minutes - elapsedMin : 50 - elapsedMin;
  const progressPct = prevStep ? Math.min(100, Math.max(0, (elapsedMin - prevStep.minutes) / (nextStep.minutes - prevStep.minutes) * 100)) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-500 font-bold uppercase tracking-wider">Estimated time remaining</span>
        <span className="text-[#e53935] font-black">{formatCountdown(remainingToNext)}</span>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#e53935] transition-all duration-1000 ease-linear"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * One order shape from every source.
 *
 * The tracking endpoint returns the order flat, while a socket event nests it
 * under `order` alongside who changed it and when. Both describe the same row,
 * so they are flattened to the order's own fields plus the event context.
 */
function normaliseOrderPayload(payload) {
  if (!payload) return null;
  const base = payload.order && typeof payload.order === 'object' ? payload.order : payload;
  const { order: _nested, ...context } = payload;
  return { ...base, ...context };
}

export default function OrderTrackingView({ orderIdOrNumber, onBackToMenu, onOrderAgain, onRequestReview }) {
  const { socket } = useSocket();
  const { token } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  // The rider's position as last reported by the server, or null while we have
  // none. `available: false` is a real state, not an absence: it is the server
  // telling us it is not receiving a position.
  const [riderLocation, setRiderLocation] = useState(null);

  /**
   * Which order to track.
   *
   * Always the id in the URL, and nothing else. This component used to fall back
   * to guessing when the id was missing - first from a localStorage key, then by
   * asking the server for this customer's newest unfinished order. Both were
   * wrong in the same way: the address bar said /orders/41/tracking and the page
   * could render a different order, or none at all, because the thing it actually
   * consulted was not the URL. Refreshing a tracking page emptied the id and
   * triggered exactly that guess.
   *
   * The route now always supplies the id, and the server applies the same
   * ownership check as every other order endpoint, so a stale or hand-typed link
   * can never point the page at somebody else's order.
   */
  const targetId = orderIdOrNumber ?? null;

  const loadOrder = async ({ quiet = false } = {}) => {
    if (!targetId) {
      setLoading(false);
      setError('This tracking link has no order in it.');
      return;
    }

    try {
      // Quiet refreshes (reconnect, tab focus) must not blank the screen or flash
      // the loading state, or the page appears to reload every time it wakes up.
      if (!quiet) setLoading(true);
      setError('');
      const response = await fetch(`/api/orders/${encodeURIComponent(targetId)}/track`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load order details.');
      setOrder(normaliseOrderPayload(data));
      setLastUpdated(new Date());
    } catch (err) {
      if (!quiet) setError(err.message || 'Unable to load order.');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  // Hold the loader in a ref so the resync effects can call the latest version
  // without re-subscribing on every render.
  const loadRef = useRef(loadOrder);
  loadRef.current = loadOrder;

  useEffect(() => {
    loadRef.current();
  }, [targetId]);

  /**
   * Live updates, plus the resync that makes them trustworthy.
   *
   * Socket.IO delivery is at-most-once, so an event sent while the tab was
   * backgrounded, the laptop was asleep or the connection dropped is gone for
   * good. The tracker therefore treats the socket as a fast path and the
   * database as the truth: it re-reads the order on reconnect, whenever the tab
   * becomes visible again, and on a slow interval as a backstop. A missed event
   * costs a few seconds, it cannot leave the page permanently stale.
   */
  useEffect(() => {
    if (!socket || !targetId) return undefined;

    const join = () => {
      socket.emit('join_order', targetId);
      loadRef.current({ quiet: true });
    };

    const matches = (payload) => {
      const candidate = payload?.order || payload;
      if (!candidate) return false;
      if (String(candidate.id) === String(targetId)) return true;
      return !!candidate.order_number && candidate.order_number === String(targetId).replace(/^#/, '');
    };

    // The server answers `join_order` with the order as it stands right now.
    const handleSnapshot = (payload) => {
      if (matches(payload)) {
        setOrder(normaliseOrderPayload(payload));
        setLastUpdated(new Date());
      }
    };

    const handleStatusUpdate = (updatedOrder) => {
      if (matches(updatedOrder)) {
        setOrder(normaliseOrderPayload(updatedOrder));
        setLastUpdated(new Date());
      }
    };

    /**
     * The rider's live position.
     *
     * The pin is only redrawn from a position the server actually stored. When the
     * server says it has none - no permission, GPS off, no signal - the last pin is
     * dropped and the tracker says so, rather than leaving a stale dot on the map
     * that looks live and is not. This is also the one event that updates the map
     * without changing the order, so it is handled separately from the status
     * feed: it must never replace the order object wholesale, or it would discard
     * the history and the ETA that came with it.
     */
    const handleRiderLocation = (payload) => {
      if (!payload) return;
      if (String(payload.order_id) !== String(targetId) &&
          !(payload.order_number && payload.order_number === String(targetId).replace(/^#/, ''))) return;
      setRiderLocation(payload);
      setLastUpdated(new Date());
    };

    const handleRiderAssigned = (payload) => {
      if (!matches(payload)) return;
      // The event names who is bringing the order, and carries the order itself, so
      // the tracker can show a rider before the status feed catches up. It went
      // unhandled here: the customer watched a delivery sit on "Food Ready" until
      // the follow-up status event happened to arrive, which is the moment the
      // "where is my rider" question is actually asked.
      const arrived = payload?.order || payload;
      if (arrived?.id) setOrder(normaliseOrderPayload(arrived));
      setLastUpdated(new Date());
    };

    const handleReconnect = () => {
      // Room membership is lost on reconnect, so re-join and re-read. The server
      // also re-joins us from the database and sends a `sync`, but asking again
      // costs nothing and closes the gap if the socket came back before the
      // snapshot was sent.
      join();
    };

    const handleVisible = () => {
      if (document.visibilityState === 'visible') loadRef.current({ quiet: true });
    };

    socket.on('connect', handleReconnect);
    socket.on('order:snapshot', handleSnapshot);
    socket.on('order:status_updated', handleStatusUpdate);
    socket.on('rider:location', handleRiderLocation);
    socket.on('order:riderAssigned', handleRiderAssigned);
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);

    join();

    // Backstop only: slow enough not to hammer the API, quick enough that a
    // silent socket failure is corrected within half a minute.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        loadRef.current({ quiet: true });
      }
    }, 15000);

    return () => {
      socket.off('connect', handleReconnect);
      socket.off('order:snapshot', handleSnapshot);
      socket.off('order:status_updated', handleStatusUpdate);
      socket.off('rider:location', handleRiderLocation);
      socket.off('order:riderAssigned', handleRiderAssigned);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
      clearInterval(poll);
      socket.emit('leave_order', targetId);
    };
  }, [socket, targetId]);

  const currentIndex = useMemo(() => {
    if (!order?.status) return -1;
    // -1 when the status is not in the flow, rather than 0. Defaulting to the
    // first step is what makes a cancelled or rejected order render as though it
    // had just been placed: the bar fills to "Order Placed" and stays there.
    return stageIndex(order.status, order.order_type);
  }, [order?.status, order?.order_type]);

  // Both of these used to be three independent hand-written lists: the flow, the
  // steps, and the label lookup for the history timeline. A stage that was in one
  // and not another was a stage that rendered wrong somewhere - the history
  // timeline in particular printed "undefined" for any status its own list had not
  // heard of, which is every GPS-derived stage.
  //
  // The order's own flow from the server, so the rail cannot end one stage short.
  // This sits with the other hooks rather than further down beside the rendering
  // that uses it: below the loading and not-found returns it was conditional, and
  // a hook that is only reached on some renders takes React's internal hook order
  // with it. Navigating from a live order to the not-found screen - or the other
  // way, a fetch that fails and then succeeds - changes the number of hooks
  // between renders, which is exactly the crash this rule exists to prevent.
  const statusSteps = useMemo(
    () => flowOf(order).map((key) => ({ key, ...(STEP_META[key] || { label: key, icon: Clock3 }) })),
    [order?.flow, order?.order_type]
  );

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-8 sm:py-12">
        <div className="bg-white border border-neutral-200 rounded-3xl p-10 sm:p-12 text-center shadow-xs">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 text-[#e53935] animate-spin" />
          <p className="font-bold text-neutral-700">Fetching live order status...</p>
        </div>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-8 sm:py-12">
        <div className="bg-white border border-neutral-200 rounded-3xl p-8 sm:p-10 text-center shadow-xs">
          <XCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
          {/* Not "no active order": this page is opened for one specific order,
              named in the URL, so the only thing that can be wrong here is that
              this order could not be read. */}
          <h2 className="text-xl font-black text-neutral-900">Could not load this order</h2>
          {targetId && (
            <p className="font-mono text-xs font-bold text-neutral-400 mt-1">#{targetId}</p>
          )}
          <p className="text-sm text-neutral-500 mt-2">{error || 'Something went wrong reading this order.'}</p>
          <div className="flex justify-center gap-3 mt-6">
            {/*
              Retry re-issues this one tracking request and nothing else. It must
              not navigate: the customer is on the page they asked for, the
              request is the thing that failed, and a retry that also moved them
              somewhere else would hide the fact that the retry happened.
            */}
            <button
              onClick={() => loadOrder()}
              className="px-5 py-2.5 rounded-xl bg-neutral-100 font-bold text-sm hover:bg-neutral-200 cursor-pointer"
            >
              Retry
            </button>
            <button onClick={onBackToMenu} className="px-5 py-2.5 rounded-xl bg-[#e53935] text-white font-bold text-sm hover:bg-red-700 cursor-pointer">
              Back to Menu
            </button>
          </div>
        </div>
      </main>
    );
  }

  const isCancelled = order.status === 'CANCELLED';
  const isRejected = order.status === 'REJECTED';
  const isDelivered = order.status === 'DELIVERED' || order.status === 'COMPLETED';
  const isFinished = isDelivered || isCancelled || isRejected;
  const items = Array.isArray(order.items) ? order.items : [];
  const address = typeof order.address === 'object' ? order.address : { address: order.address };

  /**
   * What the map draws.
   *
   * Two sources, in a deliberate order. The socket event is the freshest thing we
   * have and wins while it is arriving; the order payload carries the last stored
   * position and its age, which is what a page refresh, a reconnect or a dropped
   * socket has to fall back on. Without that second source, refreshing the page
   * mid-delivery would show an empty map until the rider happened to move again.
   *
   * The server decides whether the rider is visible at all (`riderVisibleToCustomer`).
   * That is a privacy decision and it is not re-derived here.
   */
  const mapData = order.map || {};
  const liveRider = riderLocation?.available && riderLocation.rider_lat != null && riderLocation.rider_lng != null
    ? { lat: riderLocation.rider_lat, lng: riderLocation.rider_lng }
    : mapData.rider || null;
  const riderSeenAt = riderLocation?.available ? riderLocation.at : mapData.riderAt || null;
  const showMap = order.order_type === 'delivery' && !isFinished;
  const riderVisible = Boolean(mapData.riderVisibleToCustomer);

  return (
    <main className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-5 pb-6">
      <button onClick={onBackToMenu} className="inline-flex items-center gap-2 text-sm font-bold text-neutral-600 hover:text-[#e53935] cursor-pointer min-h-[44px]">
        <ArrowLeft className="w-4 h-4" /> Back to Menu
      </button>

      <section className="bg-white border border-neutral-200 rounded-3xl shadow-xs overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-neutral-400">Live Order Tracking</p>
            <h1 className="text-xl sm:text-2xl font-black text-neutral-900 mt-1 truncate">#{order.order_number || order.id}</h1>
            {order.created_at && <p className="text-xs text-neutral-500 mt-1">Placed {formatDate(order.created_at)}</p>}
          </div>
          <button onClick={() => loadOrder()} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-100 text-neutral-700 font-bold text-xs hover:bg-neutral-200 cursor-pointer min-h-[44px]">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {isCancelled || isRejected ? (
          <div className="m-4 sm:m-6 p-4 sm:p-5 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3">
            <XCircle className="w-6 h-6 text-red-600 shrink-0" />
            <div>
              {/* A rejected order is not a cancelled one. Both used to fall into
                  the same "Order Cancelled" banner, so a customer whose order the
                  restaurant declined was told it had been cancelled - and a
                  rejected order matched no step at all, so the rail beneath it
                  showed a full progress bar for a meal that was never made. */}
              <h2 className="font-black text-red-900">{isRejected ? 'Order Rejected' : 'Order Cancelled'}</h2>
              <p className="text-sm text-red-700 mt-1">
                {isRejected
                  ? 'The restaurant could not accept this order. Any amount charged is refunded.'
                  : 'This order was cancelled by the restaurant or user.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3">
              {statusSteps.map((step, index) => {
                const Icon = step.icon;
                const completed = index <= currentIndex;
                const active = index === currentIndex;
                return (
                  <div key={step.key} className="relative text-center">
                    <div className={`mx-auto w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 transition ${completed ? 'bg-[#e53935] border-[#e53935] text-white shadow-xs' : 'bg-white border-neutral-200 text-neutral-300'}`}>
                      <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <p className={`mt-1.5 text-[10px] sm:text-[11px] font-black ${active ? 'text-[#e53935]' : completed ? 'text-neutral-700' : 'text-neutral-400'}`}>
                      {step.label}
                    </p>
                    {index < statusSteps.length - 1 && (
                      <div className={`hidden sm:block absolute top-4 left-[calc(50%+22px)] right-[calc(-50%+22px)] md:top-5 md:left-[calc(50%+25px)] md:right-[calc(-50%+25px)] h-0.5 ${index < currentIndex ? 'bg-[#e53935]' : 'bg-neutral-200'}`} />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 p-4 rounded-2xl bg-neutral-50 border border-neutral-100 flex items-start gap-3">
              <Clock3 className="w-5 h-5 text-[#e53935] shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                {/* The server owns the wording for each stage, so the label here
                    always matches the status stored in the database. */}
                <p className="text-sm font-black text-neutral-800">{order.statusLabel || String(order.status || '').replace(/_/g, ' ')}</p>
                {order.order_type === 'pickup' && order.status === 'READY_FOR_PICKUP' && (
                  <p className="text-xs text-amber-600 font-bold mt-1">Your order is ready! Please collect it from the hotel counter.</p>
                )}
                <p className="text-xs text-neutral-500">Live updates are automatically synced with the kitchen.</p>
                <div className="mt-3">
                  <Countdown order={order} />
                </div>
              </div>
            </div>

            {/* Feedback belongs to a finished meal, so it is offered here and
                nowhere earlier in the journey. The review is read from the
                database first, so an order that is already rated says so
                instead of offering a form that could only be rejected. */}
            {isFinished && (
              <div className="mt-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-amber-900">Rate your order</p>
                  {order.review ? (
                    <p className="text-xs text-amber-700 font-bold mt-1">
                      You already reviewed this order ({order.review.rating} star{order.review.rating === 1 ? '' : 's'}).
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700 mt-1">Tell us how the food and delivery were.</p>
                  )}
                </div>
                {!order.review && onRequestReview && (
                  <button
                    onClick={onRequestReview}
                    className="shrink-0 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs cursor-pointer min-h-[44px]"
                  >
                    Write a review
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <section className="lg:col-span-2 bg-white border border-neutral-200 rounded-3xl shadow-xs p-4 sm:p-6">
          <h2 className="font-black text-base sm:text-lg text-neutral-900 mb-4">Order Summary</h2>
          <div className="divide-y divide-neutral-100">
            {items.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4">No item details available.</p>
            ) : items.map((item, index) => (
              <div key={`${item.id || item.item_id || 'item'}-${index}`} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm text-neutral-800 truncate">{item.name_en || item.name || `Item ${item.id || ''}`}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Qty: {item.quantity || item.qty || 1}</p>
                </div>
                <p className="font-black text-sm text-neutral-800 shrink-0">
                  {money((item.item_total_price ?? item.total_price ?? (item.unit_price ?? item.price ?? 0) * (item.quantity || item.qty || 1)))}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t border-neutral-200 mt-4 pt-4 space-y-2 text-sm">
            <div className="flex justify-between text-neutral-700">
              <span>Item Total</span>
              <span className="font-bold">{money(order.item_total ?? order.item_total_amount ?? 0)}</span>
            </div>
            {order.discount_amount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</span>
                <span className="font-bold">- {money(order.discount_amount)}</span>
              </div>
            )}
            {order.order_type === 'delivery' && order.delivery_distance_km != null && (
              <div className="flex justify-between text-neutral-700">
                <span>Delivery Distance</span>
                <span className="font-bold">{Number(order.delivery_distance_km).toFixed(2)} km</span>
              </div>
            )}
            {order.order_type === 'delivery' && (
              <div className="flex justify-between text-neutral-700">
                <span>Delivery Fee</span>
                <span className="font-bold">{order.delivery_fee === 0 ? 'FREE' : money(order.delivery_fee)}</span>
              </div>
            )}
            <div className="flex justify-between text-neutral-700">
              <span>GST / Taxes</span>
              <span className="font-bold">{money(order.tax_amount ?? order.tax ?? 0)}</span>
            </div>
          </div>
          <div className="border-t border-neutral-200 mt-3 pt-4 flex justify-between items-center">
            <span className="font-black text-neutral-900">Grand Total</span>
            <span className="font-black text-[#e53935] text-lg">{money(order.grand_total ?? order.total_amount ?? order.total ?? 0)}</span>
          </div>
        </section>

      {showMap && (
        <section className="bg-white border border-neutral-200 rounded-3xl shadow-xs p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-black text-base sm:text-lg text-neutral-900">Live Delivery</h2>
            {order.rider_name && (
              <span className="text-xs font-bold text-neutral-500">
                Rider: <span className="text-neutral-800">{order.rider_name}</span>
              </span>
            )}
          </div>
          <DeliveryMap
            hotel={mapData.hotel}
            customer={mapData.customer}
            rider={liveRider}
            riderName={order.rider_name}
            riderVisible={riderVisible}
            lastSeenAt={riderSeenAt}
            riderLocationMessage={riderLocation?.message}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] font-semibold text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#e53935]" /> Hotel Darshan
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]" /> Your address
            </span>
            {riderVisible && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Rider
              </span>
            )}
            {order.eta?.minutes != null && (
              <span className="ml-auto">ETA: {order.eta.minutes} min</span>
            )}
          </div>

          {/*
            The server's ETA is a *duration* ("25 min"), which is useful but never
            answers "what time do I get it?". This pairs it with the clock time
            that duration implies, built from the order's real `created_at` plus
            the estimate recorded on the row.
          */}
          {formatEstimatedArrival(order) && (
            <p className="mt-1.5 text-[11px] font-semibold text-neutral-500">
              Expected at{' '}
              <span className="text-[#e53935]">{formatEstimatedArrival(order)}</span> IST
            </p>
          )}
        </section>
      )}

      <section className="bg-white border border-neutral-200 rounded-3xl shadow-xs p-4 sm:p-6">
        <h2 className="font-black text-base sm:text-lg text-neutral-900 mb-4">Delivery & Contact</h2>
          <div className="space-y-4 text-sm">
            <div className="flex gap-3">
              <MapPin className="w-5 h-5 text-[#e53935] shrink-0" />
              <div>
                <p className="font-bold text-neutral-800">Delivery Address</p>
                <p className="text-neutral-500 mt-1 break-words">{address.address || address.full_address || address.street || 'Char Rasta, Mosda Road, Dediapada, Gujarat 393040'}</p>
                {address.city && <p className="text-neutral-500">{address.city}{address.pincode ? ` - ${address.pincode}` : ''}</p>}
              </div>
            </div>

            {order.rider_name && (
              <div className="border-t border-neutral-100 pt-4">
                <p className="text-xs font-black uppercase tracking-wider text-neutral-400">Delivery Partner</p>
                <p className="font-bold text-neutral-800 mt-1">{order.rider_name}</p>
                {order.rider_phone && (
                  <a href={`tel:${order.rider_phone}`} className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold mt-1">
                    <Phone className="w-3.5 h-3.5" /> {order.rider_phone}
                  </a>
                )}

                {/*
                  Shown only when the server says it has no position, and only
                  while the order is still in the rider's hands. Once delivered the
                  rider's position is deliberately cleared - there is nobody left to
                  track - so the message would be a lie at exactly the moment the
                  customer most wants good news.
                */}
                {order.order_type === 'delivery'
                  && !isFinishedStatus(order.status)
                  && riderLocation
                  && riderLocation.available === false && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    {riderLocation.message || 'Rider location temporarily unavailable'}
                  </p>
                )}

                {riderLocation?.available && Number.isFinite(Number(riderLocation.rider_to_customer_km)) && (
                  <p className="text-xs text-neutral-500 mt-3">
                    {Number(riderLocation.rider_to_customer_km).toFixed(2)} km away
                    {riderLocation.rider_nearby ? ' · almost at your door' : ''}
                  </p>
                )}
              </div>
            )}
            
            {lastUpdated && <p className="text-[11px] text-neutral-400 border-t border-neutral-100 pt-4">Last updated {formatDate(lastUpdated)}</p>}
          </div>

          {/* The stored timeline, read back from the database. This is what makes
              the page survive a refresh or a missed socket event: it is the same
              record every other screen sees, not local state. */}
          {Array.isArray(order.history) && order.history.length > 0 && (
            <div className="border-t border-neutral-100 mt-5 pt-4">
              <p className="text-xs font-black uppercase tracking-wider text-neutral-400">Order Timeline</p>
              <ol className="mt-3 space-y-2">
                {order.history.map((entry, i) => (
                  <li key={`${entry.status}-${i}`} className="flex items-start gap-2 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#e53935] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-bold text-neutral-800">
                        {/* From the metadata table, not from the rail. The rail only
                            holds the stages in this order's own flow, and the
                            timeline holds every stage the order ever passed through -
                            including ones that are not in the flow, such as a
                            cancellation or a rejection. Looking in the rail found no
                            match for those and printed the raw enum. */}
                        {STEP_META[entry.status]?.label
                          || String(entry.status || '').replace(/_/g, ' ')}
                      </p>
                      <p className="text-neutral-500">
                        {entry.changedBy || entry.changed_by || 'Hotel Darshan'}
                        {entry.changedByRole || entry.changed_by_role ? ` (${entry.changedByRole || entry.changed_by_role})` : ''}
                        {entry.timestamp || entry.created_at ? ` - ${formatDate(entry.timestamp || entry.created_at)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>

      {order.status === 'DELIVERED' && order.order_type === 'delivery' && onOrderAgain && (
        <div className="flex justify-center pb-6">
          <button onClick={onOrderAgain} className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#e53935] text-white font-black text-sm hover:bg-red-700 cursor-pointer shadow-md min-h-[44px]">
            Order Again
          </button>
        </div>
      )}
    </main>
  );
}