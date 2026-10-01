import React from 'react';
import { Navigation, NavigationOff } from 'lucide-react';
import { stageLabel, stageTone } from '../../lib/riderStages';

/** The stage a delivery is in, in the rider's words. */
export function StatusPill({ status, className = '' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-black ${stageTone(status)} ${className}`}>
      {stageLabel(status)}
    </span>
  );
}

/**
 * What the rider's GPS is doing, in words they can act on.
 *
 * The states are kept distinct because each one means something different about
 * whether the customer is seeing them, and because each one asks something
 * different of the rider:
 *
 *   active        a good fix just arrived - the customer sees them move
 *   weak          GPS works, the reading is too coarse to act on - usually clears
 *   denied        only the rider can fix this, and a button is offered
 *   unavailable   nothing usable is arriving - a timeout, a tunnel, a dead network
 *   lastLocation  nothing is arriving, but the server still holds where they were
 *   unsupported   this device can never report a location
 *
 * Collapsing the middle four into "unavailable" leaves a rider who has denied
 * permission with no idea that tapping a button would change anything, and tells a
 * rider with a perfectly good GPS indoors that their GPS is broken.
 *
 * `lastLocation` is not a claim that the rider is there. It is the server's most
 * recent real position for this delivery, shown with its age, and it only appears
 * when nothing better is available.
 */
export function gpsStateOf(gps) {
  // A refused permission outranks everything else, because it is the one state
  // the rider can act on directly. The last known position still renders under it.
  if (gps?.status === 'PERMISSION_DENIED') return 'denied';
  if (gps?.status === 'UNSUPPORTED') return 'unsupported';
  // Only ever reached with a fix that passed the accuracy and age checks, so this
  // cannot read "active" while the dot on the map is standing still.
  if (gps?.status === 'TRACKING') return 'active';
  if (gps?.status === 'WEAK') return 'weak';

  const hasLast = Boolean(gps?.lastKnown);
  if (gps?.status === 'STARTING') return hasLast ? 'lastLocation' : 'starting';
  // UNAVAILABLE with a position to fall back on is the LAST LOCATION case; without
  // one it is honestly just unavailable.
  if (gps?.status === 'UNAVAILABLE') return hasLast ? 'lastLocation' : 'unavailable';
  return 'off';
}

/** How old a position is, in the rider's own words. Null when there is none. */
export function lastSeenPhrase(gps) {
  const at = gps?.lastKnown?.at ?? gps?.point?.at;
  if (at == null) return null;
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

const GPS_STATES = {
  active: {
    label: 'GPS active',
    icon: Navigation,
    tone: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-800',
    iconTone: 'text-emerald-600',
    detail: (gps) => (gps.accuracy != null ? `Accurate to ${Math.round(gps.accuracy)} m` : 'Waiting for a GPS fix')
  },
  starting: {
    label: 'Starting GPS',
    icon: Navigation,
    tone: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    iconTone: 'text-amber-600',
    detail: () => 'Asking your phone for a position'
  },
  weak: {
    label: 'GPS weak',
    icon: NavigationOff,
    tone: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    iconTone: 'text-amber-600',
    detail: (gps) => gps?.lastError?.message || 'Your position is not accurate enough to share yet'
  },
  denied: {
    label: 'Location permission required',
    icon: NavigationOff,
    tone: 'bg-red-50 border-red-200',
    text: 'text-red-800',
    iconTone: 'text-red-600',
    detail: () => 'Location permission is required for live delivery tracking.'
  },
  unavailable: {
    label: 'Location temporarily unavailable',
    icon: NavigationOff,
    tone: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    iconTone: 'text-amber-600',
    detail: (gps) => gps?.lastError?.message || 'Your position is temporarily unavailable. It will resume on its own.'
  },
  lastLocation: {
    label: 'Showing your last location',
    icon: NavigationOff,
    tone: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    iconTone: 'text-amber-600',
    // Says plainly that this is not live. A map with a dot on it and no such
    // sentence is how a rider ends up riding to a position they left ten minutes
    // ago because nothing told them the dot had stopped moving.
    detail: (gps) =>
      gps?.lastError?.message
        ? `${gps.lastError.message} The dot on the map is your last known position, not a live one.`
        : 'GPS is not updating right now. The dot on the map is your last known position, not a live one.'
  },
  unsupported: {
    label: 'GPS unavailable',
    icon: NavigationOff,
    tone: 'bg-neutral-100 border-neutral-200',
    text: 'text-neutral-700',
    iconTone: 'text-neutral-400',
    detail: () => 'This device cannot report a location. The delivery still works.'
  },
  off: {
    label: 'Location not sharing',
    icon: NavigationOff,
    tone: 'bg-neutral-100 border-neutral-200',
    text: 'text-neutral-600',
    iconTone: 'text-neutral-400',
    detail: (gps) => gps?.lastError?.message || 'The customer cannot see your position'
  }
};

export function GpsStatus({ gps, onRetry, className = '' }) {
  const stateKey = gpsStateOf(gps);
  const state = GPS_STATES[stateKey] || GPS_STATES.off;
  const Icon = state.icon;
  const seen = lastSeenPhrase(gps);
  const detail = state.detail(gps);
  const isLive = stateKey === 'active';

  return (
    <div className={`rounded-2xl border px-3.5 py-3 ${state.tone} ${className}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${state.iconTone}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-black ${state.text}`}>{state.label}</p>
          <p className="text-[11px] text-neutral-500">{detail}</p>
          {/* How old the position on the map is, whenever there is one. Shown for
              every state and not only the live one: the age is the most useful
              thing on this card precisely when things are not working, and it is
              what tells the rider whether the dot is worth navigating by. */}
          {seen && (
            <p className="text-[10px] font-bold text-neutral-400 mt-0.5">
              Last updated: {seen}
            </p>
          )}
        </div>
        {/* Offered only where tapping it can change something: a refused
            permission, or a GPS that is failing and may recover. A rider whose
            GPS is working does not need a button that says nothing, and one is
            not shown. */}
        {onRetry && (state === GPS_STATES.denied || state === GPS_STATES.weak || state === GPS_STATES.unavailable) && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 min-h-[36px] px-3 rounded-xl bg-white border border-neutral-200 text-[11px] font-black text-neutral-800 shadow-sm cursor-pointer hover:bg-neutral-50"
          >
            Try Again
          </button>
        )}
      </div>
      {!isLive && !gps?.enabled && (
        <p className="text-[10px] text-neutral-400 mt-1.5">
          GPS starts when you take a delivery.
        </p>
      )}
    </div>
  );
}

export default StatusPill;
