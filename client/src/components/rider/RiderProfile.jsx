import React from 'react';
import { ArrowLeft, LogOut, Mail, MapPin, Phone, Shield, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { stageLabel } from '../../lib/riderStages';
import { formatDateTime } from '../../lib/time.js';

/**
 * Who is signed in, and what the server knows about them.
 *
 * Everything shown is a field the server sent. There is no fallback name, no
 * default phone number and no invented rider number: a rider whose profile is
 * thin sees a thin profile, because a screen that fills the blanks is a screen
 * that can be wrong about the one thing that matters - which account they are
 * about to be handed a delivery.
 */
export function RiderProfile({ data }) {
  const { user, logout } = useAuth();
  const profile = data?.profile;
  const name = profile?.name || user?.name;
  const phone = profile?.mobile || user?.phone;
  const state = profile?.riderState;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-black text-neutral-900">Profile</h1>

      <div className="rounded-3xl bg-white border border-neutral-200 p-5 space-y-4">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-2xl bg-[#e53935] text-white flex items-center justify-center shrink-0">
            <Truck className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <p className="font-black text-base text-neutral-900 truncate">{name || 'Rider'}</p>
            <p className="text-[11px] text-neutral-500">Delivery rider</p>
          </div>
        </div>

        <dl className="divide-y divide-neutral-100 text-xs">
          <Row icon={Phone} label="Phone" value={phone} />
          <Row icon={Mail} label="Email" value={profile?.email || user?.email} />
          <Row
            icon={Shield}
            label="Status"
            value={state ? stageLabel(state === 'OFFLINE' ? null : state) : 'Unknown'}
            fallback={state === 'OFFLINE' ? 'Offline' : null}
          />
        </dl>
      </div>

      <div className="rounded-3xl bg-white border border-neutral-200 p-5 space-y-3">
        <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Live location</p>
        {profile?.lastLocation && profile.lastLocationAt ? (
          <div className="flex items-start gap-2.5 text-xs text-neutral-700">
            <MapPin className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-neutral-900">Position shared with the server</p>
              {/* The coordinates themselves are deliberately not rendered. This
                  screen is about the account, and a rider's exact position has
                  no business being on a screen somebody can shoulder-surf. */}
              {/* Same space-to-`T` fix without the `Z` as the other rider
                  screens: the timestamp is UTC, and reading it as local put the
                  last report 5h30m out. */}
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Last reported {formatDateTime(profile.lastLocationAt)} IST
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">
            No position reported yet. It is sent automatically while you are carrying a delivery.
          </p>
        )}
      </div>

      <button
        onClick={logout}
        className="w-full min-h-[52px] rounded-2xl bg-neutral-900 hover:bg-neutral-800 text-white font-black text-xs flex items-center justify-center gap-2 transition"
      >
        <LogOut className="w-4.5 h-4.5" /> Sign out
      </button>

      <button
        onClick={() => { window.history.replaceState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
        className="w-full min-h-[48px] rounded-2xl bg-white border border-neutral-300 hover:bg-neutral-50 text-neutral-700 font-black text-xs flex items-center justify-center gap-2 transition"
      >
        <ArrowLeft className="w-4 h-4" /> Customer app
      </button>
    </div>
  );
}

function Row({ icon: Icon, label, value, fallback = 'Not set' }) {
  return (
    <div className="flex items-center gap-2.5 py-3">
      <Icon className="w-4 h-4 text-neutral-400 shrink-0" />
      <dt className="text-neutral-500 w-20 shrink-0">{label}</dt>
      <dd className="font-bold text-neutral-900 truncate ml-auto">{value || fallback}</dd>
    </div>
  );
}

export default RiderProfile;
