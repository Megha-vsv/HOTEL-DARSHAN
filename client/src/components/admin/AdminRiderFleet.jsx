// The admin's live view of the rider fleet.
//
// This is the first consumer of `GET /api/orders/rider/fleet`. The endpoint
// existed and was correct, but nothing read it, so the admin's only picture of the
// riders was the roster in Staff Management - names and whether their accounts
// were enabled. Everything an admin actually needs to judge the fleet before
// assigning the next order was invisible: who is on shift, who is free, who is
// carrying what, and whose phone has stopped reporting.
//
// Nothing here computes rider state. Every value is a column the server already
// had, read from the same `rider_presence` and `orders` rows that assignment reads.
// The board does not keep a copy: it refetches, and a refresh that fails is
// reported as a failure rather than displayed as an empty fleet, because "every
// rider is offline" and "the board could not load" are very different things for
// someone deciding whether to take orders by hand.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bike,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  RefreshCw,
  TriangleAlert,
  UserX,
  XCircle
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';

// Why a rider cannot be given the next order, in the admin's language. The server
// sends a code; these are the readings of it. An unrecognised code falls through
// to the server's own reason text rather than being hidden, so a new reason shows
// up honestly instead of rendering as blank.
const INELIGIBLE_LABELS = {
  OFFLINE: 'Offline',
  BUSY: 'Carrying an order',
  AT_CAPACITY: 'At order capacity',
  DISABLED: 'Account disabled',
  LOCATION_REQUIRED: 'Has not shared location',
  LOCATION_STALE: 'Location is stale',
  RECENTLY_LOADED: 'Recently carried an order',
  INELIGIBLE: 'Not eligible'
};

// The four presence states, coloured the way an admin reads them: green is taking
// work, amber is on shift but not, slate is off, red is a state that means
// something is wrong rather than merely quiet.
const STATE_STYLES = {
  AVAILABLE: 'bg-emerald-100 text-emerald-700',
  ONLINE: 'bg-amber-100 text-amber-700',
  BUSY: 'bg-blue-100 text-blue-700',
  OFFLINE: 'bg-neutral-100 text-neutral-500'
};

/** "4 min ago", "2 h ago". Null when there is nothing to age - never "just now". */
function ageText(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * Whole minutes since a SQLite timestamp, or null when it cannot be read.
 *
 * SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, so the T and
 * the Z are both supplied here. Parsed the wrong way this returns NaN, and a NaN
 * age would render as a plausible-looking number of minutes.
 */
function ageOf(stamp) {
  if (!stamp) return null;
  const text = String(stamp);
  const then = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / 60000));
}

function LocationCell({ rider }) {
  // A missing position is shown as missing. Falling back to the hotel's own
  // coordinates - which is where an unreported rider would be assumed to be -
  // would put a plausible pin on the map for a rider nobody has heard from.
  if (!rider.lastLocation) {
    return (
      <span className="inline-flex items-center gap-1 text-neutral-400 font-semibold">
        <MapPin className="w-3.5 h-3.5" /> No position
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-neutral-600 font-semibold">
      <MapPin className="w-3.5 h-3.5" />
      {rider.distanceToHotelKm == null
        ? `${rider.lastLocation.lat.toFixed(4)}, ${rider.lastLocation.lng.toFixed(4)}`
        : `${rider.distanceToHotelKm.toFixed(1)} km out`}
    </span>
  );
}

function RiderRow({ rider }) {
  const carrying = rider.carryingOrders || [];
  return (
    <tr className="hover:bg-neutral-50/80 align-top">
      <td className="p-4">
        <p className="font-bold text-neutral-900">{rider.name}</p>
        {rider.phone && (
          <a href={`tel:${rider.phone}`} className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-[#e53935]">
            <Phone className="w-3 h-3" /> {rider.phone}
          </a>
        )}
      </td>

      <td className="p-4">
        <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] uppercase ${STATE_STYLES[rider.riderState] || STATE_STYLES.OFFLINE}`}>
          {rider.riderState || 'OFFLINE'}
        </span>
        {/* Why "available" is not the same as "can be given the next order". A
            rider can be available and still ineligible - a fresh account with no
            shared position, say - and an admin about to hand out work needs to see
            which of the two is the case. */}
        {rider.canReceiveOrders ? (
          <p className="mt-1.5 text-[11px] font-bold text-emerald-600">
            {rider.assignmentRank ? `Assignment rank #${rider.assignmentRank}` : 'Eligible'}
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] font-bold text-amber-600">
            {INELIGIBLE_LABELS[rider.ineligibleCode] || rider.ineligibleReason || 'Not eligible'}
          </p>
        )}
      </td>

      <td className="p-4">
        {carrying.length === 0 ? (
          <span className="text-neutral-400 font-semibold">—</span>
        ) : (
          <ul className="space-y-1">
            {carrying.map((o) => (
              <li key={o.id} className="text-[11px]">
                <span className="font-black text-neutral-900">{o.orderNumber}</span>
                <span className="text-neutral-500"> · {o.statusLabel || o.status}</span>
              </li>
            ))}
            {rider.activeCount > 1 && (
              <li className="text-[11px] text-amber-700 font-bold">
                {rider.activeCount} of {rider.maxActive} orders
              </li>
            )}
          </ul>
        )}
      </td>

      <td className="p-4">
        <LocationCell rider={rider} />
        {/* Two ages, because they answer different questions. A rider driving with
            a ten-minute-old fix is fine; a rider whose last state change was ten
            minutes ago while carrying nothing is not. The second is measured from
            `lastActiveAt`, which the server takes as the later of the two, so it
            still means something when there is no fix to measure from. */}
        <p className="mt-1 text-[11px] text-neutral-500 font-semibold">
          <Clock className="w-3 h-3 inline -mt-0.5" /> seen {ageText(rider.locationAgeMinutes)} ago
        </p>
        {rider.lastActiveAt && rider.locationAgeMinutes == null && (
          <p className="text-[11px] text-neutral-500 font-semibold">
            active {ageText(ageOf(rider.lastActiveAt))} ago
          </p>
        )}
      </td>
    </tr>
  );
}

export default function AdminRiderFleet() {
  const { token } = useAuth();
  const socket = useSocket();
  const [fleet, setFleet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // A request that comes back after the screen has moved on must not overwrite the
  // newer one; without this a slow first fetch can land on top of a refresh.
  const requestId = useRef(0);

  const load = useCallback(async ({ quiet } = {}) => {
    if (!token) return;
    const mine = ++requestId.current;
    if (!quiet) setLoading(true);
    setRefreshing(true);
    try {
      const res = await fetch('/api/orders/rider/fleet', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (mine !== requestId.current) return;
      if (!res.ok) throw new Error(`Fleet request failed (${res.status})`);
      setFleet(await res.json());
      setError('');
    } catch (err) {
      if (mine !== requestId.current) return;
      setError(err.message || 'Could not load the rider fleet.');
    } finally {
      if (mine === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // The fleet changes when riders come on shift, finish a delivery or report a
  // position, and each of those already announces itself to `admin_room`. Refetching
  // on those events beats a timer: the board is a live roster, and a fixed interval
  // would either lag the change or poll a quiet system for nothing.
  //
  // Only events the server really emits are listened for. `rider:location` is
  // throttled by the GPS engine, so it cannot be the trigger that causes the storm
  // it would be the sign of - the fetch is a single admin-scoped read.
  useEffect(() => {
    if (!socket) return undefined;
    // Re-join the admin room on every connection, not once on mount: room
    // membership is per socket, so after a reconnect the board would be listening
    // to a room it is not in and the fleet would go stale with no error anywhere.
    const joinAdmin = () => socket.emit('join_admin');
    const onChange = () => load({ quiet: true });
    joinAdmin();
    socket.on('connect', joinAdmin);
    socket.on('rider:availabilityChanged', onChange);
    socket.on('rider:location', onChange);
    socket.on('rider:orderAssigned', onChange);
    socket.on('rider:orderReleased', onChange);
    return () => {
      socket.off('connect', joinAdmin);
      socket.off('rider:availabilityChanged', onChange);
      socket.off('rider:location', onChange);
      socket.off('rider:orderAssigned', onChange);
      socket.off('rider:orderReleased', onChange);
    };
  }, [socket, load]);

  if (loading && !fleet) {
    return (
      <div className="rounded-3xl border border-neutral-200 bg-white p-10 text-center">
        <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin text-[#e53935]" />
        <p className="font-bold text-neutral-700 text-sm">Loading rider fleet...</p>
      </div>
    );
  }

  // A failed refresh keeps whatever was last loaded, and says so. Blanking the
  // board to an empty state on a transient error would tell the admin the whole
  // fleet had gone offline.
  if (error && !fleet) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
        <XCircle className="w-8 h-8 mx-auto mb-2 text-red-600" />
        <h3 className="font-black text-red-900">Could not load the rider fleet</h3>
        <p className="text-sm text-red-700 mt-1">{error}</p>
        <button
          onClick={() => load()}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold text-xs cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Try again
        </button>
      </div>
    );
  }

  const riders = Array.isArray(fleet?.riders) ? fleet.riders : [];
  const waiting = riders.filter((r) => !r.canReceiveOrders);
  const waitingSummary = fleet?.waitingSummary || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Riders" value={riders.length} icon={Bike} />
        <Stat
          label="Available now"
          value={fleet?.eligibleCount ?? 0}
          icon={CheckCircle2}
          tone="text-emerald-600"
        />
        <Stat label="Carrying orders" value={riders.reduce((n, r) => n + (r.activeCount || 0), 0)} icon={Clock} />
        <Stat label="Not available" value={waiting.length} icon={UserX} tone={waiting.length ? 'text-amber-600' : 'text-neutral-400'} />
      </div>

      {/* Riders exist, they are simply all busy or unreachable. That is a staffing
          problem, not a fault, and saying which is more useful than an empty list. */}
      {Object.keys(waitingSummary).length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
          <TriangleAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-amber-900">
            No rider is currently eligible for the next order:{' '}
            {Object.entries(waitingSummary)
              .map(([code, count]) => `${count} ${INELIGIBLE_LABELS[code] || code}`)
              .join(', ')}
            .
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs font-bold text-amber-700">
          Showing the last successful load. {error}
        </p>
      )}

      <div className="rounded-3xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="p-5 border-b border-neutral-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-base text-neutral-900">Rider Fleet</h2>
            <p className="text-xs text-neutral-500">
              Live presence, workload and last known position
            </p>
          </div>
          <button
            onClick={() => load()}
            className="inline-flex items-center gap-2 py-2.5 px-4 rounded-xl bg-neutral-100 text-neutral-700 font-bold text-xs hover:bg-neutral-200 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-bold uppercase tracking-wider">
              <tr>
                <th className="p-4">Rider</th>
                <th className="p-4">Status</th>
                <th className="p-4">Carrying</th>
                <th className="p-4">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {riders.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-10 text-center text-neutral-500 font-semibold">
                    No riders are registered yet.
                  </td>
                </tr>
              ) : (
                riders.map((rider) => <RiderRow key={rider.id} rider={rider} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = 'text-neutral-900' }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-2 text-neutral-400">
        <Icon className="w-4 h-4" />
        <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`mt-1.5 text-2xl font-black ${tone}`}>{value}</p>
    </div>
  );
}
