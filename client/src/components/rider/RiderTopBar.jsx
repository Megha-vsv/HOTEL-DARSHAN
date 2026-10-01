import React from 'react';
import { Bell, LogOut, User } from 'lucide-react';
import BrandLogo from '../BrandLogo';
import { useAuth } from '../../context/AuthContext';

/**
 * The rider's own top bar.
 *
 * The availability switch is here rather than on the dashboard because it is the
 * one control a rider reaches for between deliveries, and because the reason
 * turning it off stops deliveries is the sort of thing that gets forgotten. It
 * states the consequence next to the control, not in a help page.
 *
 * The switch is a real control, not a label: it is disabled only while the
 * server is being asked, because a rider who is told their state changed when it
 * has not will keep working an hour later expecting orders.
 */
export function RiderTopBar({ isOnline, onToggleAvailability, busy, unread = 0, onOpenNotifications, onOpenProfile }) {
  const { user, logout } = useAuth();
  const goingOnline = !isOnline;

  return (
    <header className="sticky top-0 z-40 bg-neutral-950 text-white border-b border-neutral-800">
      <div className="mx-auto max-w-5xl px-3 sm:px-5 py-2.5 flex items-center gap-2 sm:gap-3">
        <BrandLogo size="sm" className="sm:w-10 sm:h-10" />
        <div className="min-w-0 flex-1">
          <div className="font-black text-xs sm:text-sm truncate leading-tight">Hotel Darshan Rider</div>
          <div className="text-[10px] text-neutral-400 truncate">{user?.name || 'Rider'}</div>
        </div>

        <button
          onClick={onToggleAvailability}
          disabled={busy || isOnline === null}
          aria-pressed={Boolean(isOnline)}
          title={goingOnline ? 'Go online to receive deliveries' : 'Go offline'}
          className={`shrink-0 min-h-[44px] px-3 sm:px-4 rounded-xl font-black text-[11px] sm:text-xs tracking-wide transition disabled:opacity-60 cursor-pointer ${
            isOnline
              ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700'
          }`}
        >
          {isOnline === null ? '…' : isOnline ? 'ONLINE' : 'OFFLINE'}
        </button>

        <button
          onClick={onOpenNotifications}
          className="relative shrink-0 w-11 h-11 rounded-xl bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center cursor-pointer transition"
          title="Notifications"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        >
          <Bell className="w-4.5 h-4.5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#e53935] text-white text-[10px] font-black flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        <button
          onClick={onOpenProfile}
          className="shrink-0 w-11 h-11 rounded-xl bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center cursor-pointer transition"
          title="Profile"
          aria-label="Profile"
        >
          <User className="w-4.5 h-4.5" />
        </button>

        <button
          onClick={logout}
          className="hidden sm:flex shrink-0 w-11 h-11 rounded-xl bg-neutral-800 hover:bg-neutral-700 items-center justify-center cursor-pointer transition"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="w-4.5 h-4.5" />
        </button>
      </div>
    </header>
  );
}

export default RiderTopBar;
