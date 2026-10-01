import React from 'react';
import { ArrowRight, CheckCircle2, IndianRupee, MapPin, Package, Route, Wallet } from 'lucide-react';
import { formatKm } from '../../lib/geo';
import { RiderEmpty, RiderError, RiderLoading } from './RiderStates';
import { StatusPill, GpsStatus } from './RiderShared';

/** "Good evening" is the rider's own clock, not the server's. */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The rider's home screen.
 *
 * Every number here is the server's. The one thing this screen is careful about
 * is the two figures it does not have: earnings are shown only when a payout
 * rate has actually been configured, and a rider with nothing in hand is told
 * they are ready rather than shown a zero. A dashboard that fills every tile
 * whether or not it has anything true to say is how a rider learns to ignore it.
 */
export function RiderDashboard({ data, gps, onOpenDelivery, onRefresh, retrying }) {
  const { profile, dashboard, loading, error } = data;

  if (loading && !profile) return <RiderLoading label="Loading your shift" />;
  if (error && !profile) return <RiderError error={error} onRetry={onRefresh} retrying={retrying} />;
  if (!profile) return null;

  const name = (profile.name || '').split(' ')[0] || profile.name;
  const active = dashboard?.activeOrder || null;
  const today = dashboard?.today;
  const earnings = dashboard?.earnings;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-neutral-900">{greeting()}, {name}</h1>
        <p className="text-xs text-neutral-500 mt-0.5">{riderStateLine(profile.riderState)}</p>
      </div>

      {error && <RiderError error={error} onRetry={onRefresh} retrying={retrying} />}

      <div className="grid grid-cols-2 gap-3">
        <Tile icon={Package} label="Active delivery" value={active ? '1' : '0'} tone={active ? 'text-[#e53935]' : 'text-neutral-400'} />
        <Tile icon={CheckCircle2} label="Completed today" value={today?.completedDeliveries ?? '0'} tone="text-emerald-600" />
        <Tile
          icon={Route}
          label="Distance today"
          // The measured delivery distance the server summed. No trail of fixes
          // exists to total up, so this is what the day actually was.
          value={today?.distanceKm != null ? formatKm(today.distanceKm) : '—'}
          tone="text-indigo-600"
        />
        <Tile
          icon={IndianRupee}
          label="Earnings today"
          // Shown only when somebody has configured a payout rate. A zero here
          // would read as "you earned nothing", which is a different claim.
          value={earnings?.configured ? `₹${earnings.amount}` : 'Not set'}
          tone={earnings?.configured ? 'text-emerald-600' : 'text-neutral-400'}
          small={!earnings?.configured}
        />
      </div>

      {active ? (
        <button
          onClick={onOpenDelivery}
          className="w-full text-left rounded-3xl bg-white border-2 border-[#e53935] p-5 space-y-3 shadow-sm transition hover:shadow-md cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#e53935]">Active delivery</span>
            <StatusPill status={active.status} />
          </div>
          <div>
            <div className="font-mono text-xs text-neutral-500">{active.order_number}</div>
            <div className="font-black text-base text-neutral-900 mt-0.5">{active.customerName}</div>
          </div>
          <div className="flex items-start gap-2 text-xs text-neutral-600">
            <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{active.address?.address || active.address?.street || 'No address on file'}</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-bold text-neutral-500">
            <span>{active.deliveryDistanceKm != null ? formatKm(active.deliveryDistanceKm) : 'Distance unknown'}</span>
            <span>{active.eta?.minutes != null ? `ETA ${active.eta.minutes} min` : 'ETA —'}</span>
          </div>
          <div className="min-h-[52px] w-full rounded-2xl bg-[#e53935] text-white font-black text-sm flex items-center justify-center gap-2">
            OPEN DELIVERY <ArrowRight className="w-4 h-4" />
          </div>
        </button>
      ) : (
        <RiderEmpty
          icon={Wallet}
          title="No active delivery"
          body="You're ready to receive orders."
        />
      )}

      {active && <GpsStatus gps={gps} />}
    </div>
  );
}

/**
 * One line saying what the rider's state means for them.
 *
 * Written as a plain switch rather than derived from the stage labels: "offline"
 * is not a stage of a delivery, and folding it into that vocabulary is what
 * ended up showing an offline rider a message about signing in.
 */
function riderStateLine(state) {
  switch (state) {
    case 'OFFLINE':
      return "You won't receive new deliveries while offline.";
    case 'ONLINE':
      return 'You are signed in. Go available to receive deliveries.';
    case 'BUSY':
      return 'You are carrying a delivery.';
    case 'AVAILABLE':
      return 'You are available for new deliveries.';
    default:
      return 'Go online to start receiving deliveries.';
  }
}

function Tile({ icon: Icon, label, value, tone, small }) {
  return (
    <div className="rounded-3xl bg-white border border-neutral-200 p-4">
      <Icon className={`w-4.5 h-4.5 ${tone}`} />
      <div className={`font-black text-neutral-900 mt-2 leading-none ${small ? 'text-sm' : 'text-xl'}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mt-1.5">{label}</div>
    </div>
  );
}

export default RiderDashboard;
