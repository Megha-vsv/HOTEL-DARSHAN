import React from 'react';
import { Bell, Check, ChefHat, PackageCheck, PackageX, Truck } from 'lucide-react';
import { timeAgo } from '../../lib/time.js';
import { RiderEmpty, RiderError, RiderLoading } from './RiderStates';

/** The kind of thing this is, by the server's own type name. */
const TONE = {
  delivery_assigned: { icon: Truck, ring: 'bg-sky-100 text-sky-700' },
  order_ready: { icon: ChefHat, ring: 'bg-amber-100 text-amber-700' },
  order_cancelled: { icon: PackageX, ring: 'bg-red-100 text-red-700' },
  delivery_completed: { icon: PackageCheck, ring: 'bg-emerald-100 text-emerald-700' }
};

const FALLBACK = { icon: Bell, ring: 'bg-neutral-100 text-neutral-600' };

/**
 * A readable age.
 *
 * This one normalised the space to a `T` but never added the `Z`, so it parsed
 * the server's UTC as local time and every notification read 5h30m too old - a
 * rider saw "6 hrs ago" for something the kitchen had just sent. The bucketing
 * now lives in `lib/time.js` alongside the parser it depends on, so the two
 * cannot drift apart again.
 */
function ago(iso) {
  return timeAgo(iso);
}

/**
 * The rider's own feed, read from the database.
 *
 * Everything here is something the server actually did to one of this rider's
 * orders - a delivery was assigned, food reached the counter, a delivery was
 * cancelled, a delivery was completed. Tapping a row marks it read, and the badge
 * clears when they have all been seen. A rider who opens the app on a lift twenty
 * minutes after being given an order finds it here, which is the whole reason
 * this is a feed and not just a live toast.
 */
export function RiderNotifications({ data, onOpenOrder, onMarkRead, onMarkAllRead, onRefresh, retrying }) {
  const { notifications, loading, error } = data;
  const rows = notifications?.notifications || [];
  const unread = notifications?.unread || 0;

  if (loading && !rows.length) return <RiderLoading label="Loading notifications" />;
  if (error && !rows.length) return <RiderError error={error} onRetry={onRefresh} retrying={retrying} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-black text-neutral-900">Notifications</h1>
        {unread > 0 && (
          <button
            onClick={onMarkAllRead}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-xs font-black text-neutral-600 hover:text-neutral-900 cursor-pointer transition"
          >
            <Check className="w-4 h-4" /> Mark all read
          </button>
        )}
      </div>

      {error && <RiderError error={error} onRetry={onRefresh} retrying={retrying} />}

      {rows.length === 0 ? (
        <RiderEmpty icon={Bell} title="No notifications" body="Assignments, ready orders and cancellations will appear here." />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((n) => {
            const tone = TONE[n.type] || FALLBACK;
            const Icon = tone.icon;
            return (
              <li key={n.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onMarkRead(n.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMarkRead(n.id); } }}
                  className={`w-full text-left rounded-3xl border p-4 flex items-start gap-3 transition cursor-pointer ${
                    n.read ? 'bg-white border-neutral-200' : 'bg-sky-50/60 border-sky-200'
                  }`}
                >
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone.ring}`}>
                    <Icon className="w-4.5 h-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-black ${n.read ? 'text-neutral-700' : 'text-neutral-900'}`}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-neutral-400 shrink-0 pt-0.5">{ago(n.createdAt)}</span>
                    </div>
                    {n.message && <p className="text-[11px] text-neutral-600 mt-1 leading-relaxed">{n.message}</p>}
                    {n.orderNumber && (
                      <button
                        onClick={(e) => { e.stopPropagation(); if (n.orderId) onOpenOrder(n.orderId); }}
                        className="mt-2 font-mono text-[10px] font-bold text-[#e53935] hover:underline min-h-[32px]"
                      >
                        {n.orderNumber}
                      </button>
                    )}
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-[#e53935] shrink-0 mt-1.5" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default RiderNotifications;
