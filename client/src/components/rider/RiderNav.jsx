import React from 'react';
import BrandLogo from '../BrandLogo';
import { RIDER_TABS } from '../../lib/riderTabs';

/**
 * Mobile: a bottom bar, because that is where a thumb is while one hand is on
 * the handlebars of a scooter. Every target is 64px tall - the platform
 * minimum is 44px, and a rider tapping this with a glove on is not the
 * 44px edge case.
 *
 * Desktop: a compact rail. Not the admin dashboard's full sidebar - the rider
 * surface has five destinations and none of them are administrative, so a rail
 * that takes a fifth of a laptop screen for five words would be absurd.
 */
export function RiderNav({ tab, onChange, unread = 0 }) {
  return (
    <>
      {/* Compact rail, desktop and tablet. */}
      <nav className="hidden md:flex md:w-[76px] lg:w-56 shrink-0 flex-col gap-1 p-2 lg:p-3">
        <div className="hidden lg:flex items-center gap-2.5 px-3 py-3 mb-2">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <div className="font-black text-[11px] text-neutral-900 leading-tight">Hotel Darshan</div>
            <div className="text-[10px] text-neutral-500">Rider</div>
          </div>
        </div>
        {RIDER_TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex md:flex-col lg:flex-row items-center justify-center lg:justify-start gap-2 min-h-[48px] px-2 lg:px-3 rounded-xl text-xs font-black transition cursor-pointer ${
                active
                  ? 'bg-[#e53935] text-white shadow-sm'
                  : 'text-neutral-600 hover:bg-neutral-200/70'
              }`}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {id === 'notifications' && unread > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-[#e53935] text-white text-[9px] font-black flex items-center justify-center border border-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>
              <span className="hidden md:inline lg:inline">{label}</span>
              <span className="md:hidden lg:hidden sr-only">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom bar, mobile. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-neutral-200 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {RIDER_TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => onChange(id)}
                aria-current={active ? 'page' : undefined}
                className="min-h-[64px] flex flex-col items-center justify-center gap-1 cursor-pointer transition"
              >
                <span className="relative">
                  <Icon className={`w-5 h-5 ${active ? 'text-[#e53935]' : 'text-neutral-400'}`} />
                  {id === 'notifications' && unread > 0 && (
                    <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-[#e53935] text-white text-[9px] font-black flex items-center justify-center">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                <span className={`text-[10px] font-black leading-none ${active ? 'text-[#e53935]' : 'text-neutral-400'}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export default RiderNav;
