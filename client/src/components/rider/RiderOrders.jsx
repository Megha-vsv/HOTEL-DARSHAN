import React, { useState } from 'react';
import { History, MapPin, Package } from 'lucide-react';
import { formatKm } from '../../lib/geo';
import { formatDateTime, parseServerTimestamp } from '../../lib/time.js';
import { stageLabel } from '../../lib/riderStages';
import { RiderEmpty, RiderError, RiderLoading } from './RiderStates';
import { StatusPill } from './RiderShared';

/**
 * A finished delivery, as the rider remembers it: when, how much, how far.
 *
 * This normalised the space to a `T` but never added the `Z`, so it got the
 * format right and still read the server's UTC as local - the 5h30m error, just
 * via a shorter route than the other sites took.
 */
function whenDelivered(order) {
  const at = order.assignedAt || order.deliveredAt || null;
  if (parseServerTimestamp(at) === null) return null;
  return formatDateTime(at);
}

/**
 * The rider's deliveries: what they are carrying, and what they have carried.
 *
 * Both tabs are the rider's own - filtered by rider on the server, not by
 * whatever this phone happens to hold - so an order that was reassigned stops
 * appearing here without the rider having to be told to refresh.
 */
export function RiderOrders({ data, onOpenOrder, onRefresh, retrying, initialTab = 'active' }) {
  const { active, history, loading, error } = data;
  const [tab, setTab] = useState(initialTab === 'history' ? 'history' : 'active');

  if (loading && !active.length && !history.orders.length) return <RiderLoading label="Loading your orders" />;
  if (error && !active.length && !history.orders.length) {
    return <RiderError error={error} onRetry={onRefresh} retrying={retrying} />;
  }

  const past = history.orders || [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-black text-neutral-900">Orders</h1>

      <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-2xl border border-neutral-200">
        {[
          { id: 'active', label: 'Active', count: active.length },
          { id: 'history', label: 'History', count: past.length }
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-h-[44px] rounded-xl text-xs font-black transition cursor-pointer ${
              tab === t.id ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1.5 text-neutral-400">{t.count}</span>}
          </button>
        ))}
      </div>

      {error && <RiderError error={error} onRetry={onRefresh} retrying={retrying} />}

      {tab === 'active' && (
        active.length === 0 ? (
          <RiderEmpty icon={Package} title="No active delivery" body="You're ready for your next delivery." />
        ) : (
          <div className="space-y-3">
            {active.map((o) => <ActiveCard key={o.id} order={o} onOpen={() => onOpenOrder(o)} />)}
          </div>
        )
      )}

      {tab === 'history' && (
        past.length === 0 ? (
          <RiderEmpty icon={History} title="No completed deliveries yet." body="Deliveries you finish will appear here." />
        ) : (
          <div className="space-y-3">
            {past.map((o) => <HistoryCard key={o.id} order={o} onOpen={() => onOpenOrder(o)} />)}
          </div>
        )
      )}
    </div>
  );
}

function ActiveCard({ order, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-3xl bg-white border border-neutral-200 p-4 space-y-2.5 hover:border-[#e53935] transition cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-bold text-[11px] text-neutral-500">{order.order_number}</div>
          <div className="font-black text-sm text-neutral-900 truncate">{order.customerName}</div>
        </div>
        <StatusPill status={order.status} className="shrink-0" />
      </div>
      <div className="flex items-start gap-2 text-xs text-neutral-600">
        <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
        <span className="line-clamp-2">
          {[order.address?.address, order.address?.street, order.address?.landmark, order.address?.city]
            .filter(Boolean).join(', ') || 'No address on file'}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] font-bold text-neutral-500 pt-1 border-t border-neutral-100">
        <span>{order.deliveryDistanceKm != null ? formatKm(order.deliveryDistanceKm) : 'Distance unknown'}</span>
        <span className="uppercase">{order.paymentStatus === 'paid' ? 'Paid' : order.payment_method}</span>
        <span className="ml-auto text-neutral-400">{stageLabel(order.status)}</span>
      </div>
    </button>
  );
}

function HistoryCard({ order, onOpen }) {
  const when = whenDelivered(order);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-3xl bg-white border border-neutral-200 p-4 space-y-2.5 hover:border-neutral-300 transition cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-bold text-[11px] text-neutral-500">{order.order_number}</div>
          <div className="font-black text-sm text-neutral-900 truncate">{order.customerName}</div>
        </div>
        <StatusPill status={order.status} className="shrink-0" />
      </div>
      <div className="flex items-center gap-3 text-[11px] font-bold text-neutral-500 pt-1 border-t border-neutral-100">
        <span className="flex items-center gap-1">
          <IndianRupeeTiny /> {order.total_amount}
        </span>
        <span className="uppercase">{order.paymentStatus === 'paid' ? 'Paid' : order.payment_method}</span>
        <span>{order.deliveryDistanceKm != null ? formatKm(order.deliveryDistanceKm) : '—'}</span>
        {when && <span className="ml-auto text-neutral-400">{when}</span>}
      </div>
    </button>
  );
}

function IndianRupeeTiny() {
  return <span className="font-mono">₹</span>;
}

export default RiderOrders;
