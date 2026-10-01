import React from 'react';
import { IndianRupee, Route, Wallet } from 'lucide-react';
import { formatKm } from '../../lib/geo';
import { RiderEmpty, RiderError, RiderLoading } from './RiderStates';

/**
 * What the rider has done today, and what it is worth.
 *
 * When no payout rate has been configured, this screen says so and says why,
 * rather than showing ₹0. There is no rate card in this system, so a zero would
 * be read as "you earned nothing today" - a claim about the rider's work rather
 * than about the absence of a setting, and the kind of thing that ends a shift
 * with somebody phoning the restaurant to ask.
 */
export function RiderEarnings({ data, onRefresh, retrying }) {
  const { dashboard, loading, error } = data;

  if (loading && !dashboard) return <RiderLoading label="Loading today's totals" />;
  if (error && !dashboard) return <RiderError error={error} onRetry={onRefresh} retrying={retrying} />;
  if (!dashboard) return null;

  const today = dashboard.today || {};
  const earnings = dashboard.earnings || {};

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-black text-neutral-900">Earnings</h1>

      {error && <RiderError error={error} onRetry={onRefresh} retrying={retrying} />}

      <div className="rounded-3xl bg-white border border-neutral-200 p-5 space-y-4">
        <div className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Today</div>

        <div className="flex items-baseline gap-2">
          <IndianRupee className="w-5 h-5 text-neutral-400" />
          <span className="text-3xl font-black text-neutral-900">
            {earnings.configured ? earnings.amount : '—'}
          </span>
        </div>

        {earnings.configured ? (
          <p className="text-[11px] text-neutral-500">
            ₹{earnings.basis.perDelivery} per delivery plus ₹{earnings.basis.perKm} per km.
          </p>
        ) : (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5">
            <p className="text-xs font-black text-amber-900">Earnings are not configured</p>
            <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
              {earnings.reason || 'No rider payout rate is configured, so no earnings figure can be calculated.'}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-white border border-neutral-200 p-4">
          <Route className="w-4.5 h-4.5 text-indigo-600" />
          <div className="font-black text-xl text-neutral-900 mt-2 leading-none">
            {today.distanceKm != null ? formatKm(today.distanceKm) : '—'}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mt-1.5">Distance today</div>
        </div>
        <div className="rounded-3xl bg-white border border-neutral-200 p-4">
          <Wallet className="w-4.5 h-4.5 text-emerald-600" />
          <div className="font-black text-xl text-neutral-900 mt-2 leading-none">
            {today.completedDeliveries ?? 0}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mt-1.5">Completed today</div>
        </div>
      </div>

      {today.travelDistanceUnavailable && (
        <RiderEmpty
          icon={Route}
          title="Distance travelled"
          body={today.travelDistanceUnavailable}
        />
      )}
    </div>
  );
}

export default RiderEarnings;
