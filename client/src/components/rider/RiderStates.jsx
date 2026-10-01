import React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import BrandLogo from '../BrandLogo';

/** A spinner with a label, for the first paint of a screen. */
export function RiderLoading({ label = 'Loading' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500">
      <BrandLogo size="md" />
      <Loader2 className="w-7 h-7 animate-spin" />
      <p className="text-xs font-bold">{label}</p>
    </div>
  );
}

/**
 * A failure the rider can act on.
 *
 * The heading names the kind of failure, because the rider's next move is
 * different for each and a single sentence for all of them was telling a rider
 * with a dead connection that their delivery could not be loaded, and a rider
 * whose session had expired that too. Only the genuine catch-all keeps the old
 * wording. Retry is offered wherever retrying could help; a 404 will not fix
 * itself, so it is not offered there and the rider is told what to do instead.
 */
export function RiderError({ error, onRetry, retrying = false }) {
  const status = error?.status ?? null;
  const offline = error?.isOffline || status === 0;
  const signedOut = status === 401 || status === 403;
  const missing = status === 404 || status === 405;

  const Icon = offline ? WifiOff : AlertTriangle;
  const heading = offline
    ? 'Unable to connect to server.'
    : signedOut
      ? 'Please sign in again.'
      : missing
        ? 'The server could not find this.'
        : 'Unable to load delivery.';
  // A missing route is the app being newer than the server it is talking to, so
  // retrying is worse than useless: it can only fail the same way again.
  const canRetry = !missing;

  return (
    <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center space-y-3">
      <Icon className="w-8 h-8 text-red-500 mx-auto" />
      <div>
        <p className="font-black text-red-900 text-sm">{heading}</p>
        <p className="text-xs text-red-700 mt-1">
          {offline
            ? 'No connection to the server.'
            : error?.message || 'Something went wrong.'}
        </p>
        {missing && (
          <p className="text-[10px] text-red-600 mt-1.5">
            The rider app is newer than the server it is talking to. Restart the backend and this will recover.
          </p>
        )}
      </div>
      {onRetry && canRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-[#e53935] hover:bg-[#d32f2f] disabled:opacity-60 text-white font-black text-xs cursor-pointer transition"
        >
          <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Retrying' : 'Retry'}
        </button>
      )}
    </div>
  );
}

/** Nothing here yet, said so plainly rather than left blank. */
export function RiderEmpty({ title, body, icon: Icon = Inbox, action = null }) {
  return (
    <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-8 text-center space-y-3">
      <Icon className="w-9 h-9 text-neutral-300 mx-auto" />
      <p className="font-black text-neutral-900 text-sm">{title}</p>
      {body && <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">{body}</p>}
      {action}
    </div>
  );
}

/** The connection banner. `connected === null` means we have not asked yet. */
export function ConnectionBanner({ connected }) {
  if (connected !== false) return null;
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-100 border-b border-amber-200 text-amber-900">
      <WifiOff className="w-3.5 h-3.5" />
      <span className="text-[11px] font-black">Reconnecting…</span>
    </div>
  );
}

export default RiderLoading;
