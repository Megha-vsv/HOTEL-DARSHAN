import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useRiderData } from '../../hooks/useRiderData';
import { useRiderActions } from '../../hooks/useRiderActions';
import { useRiderGps } from '../../hooks/useRiderGps';
import { RiderTopBar } from './RiderTopBar';
import { RiderNav } from './RiderNav';
import { ConnectionBanner, RiderLoading } from './RiderStates';
import { RiderDashboard } from './RiderDashboard';
import { RiderOrders } from './RiderOrders';
import { RiderDeliveryDetail } from './RiderDeliveryDetail';
import { RiderEarnings } from './RiderEarnings';
import { RiderNotifications } from './RiderNotifications';
import { RiderProfile } from './RiderProfile';
import { isPickedUpStage } from '../../lib/riderStages';

/**
 * The rider app.
 *
 * One fetch for the whole app, one GPS engine, and five destinations. The
 * screens are switched on state rather than by URL because there is nothing to
 * link to: a rider has one delivery at a time and the app is opened from the
 * home screen, so a route that survives a reload would only mean re-deriving the
 * server state on every entry.
 *
 * GPS lives here rather than in a screen so it keeps running while the rider is
 * on the orders list looking at something else - the customer is watching, and a
 * tracker that stops because the rider tapped another tab is a tracker that lies.
 */
export function RiderApp() {
  const [tab, setTab] = useState('dashboard');
  const [openOrderId, setOpenOrderId] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const data = useRiderData();
  const actions = useRiderActions({ onChanged: data.refresh });

  const activeOrder = data.activeOrder;
  const openOrder = useMemo(() => {
    if (openOrderId == null) return null;
    // An order opened from a notification may have finished in the meantime, so
    // the live list and the history list are both searched before giving up.
    return data.active.find((o) => o.id === openOrderId)
      || (data.history.orders || []).find((o) => o.id === openOrderId)
      || null;
  }, [openOrderId, data.active, data.history.orders]);

  // GPS runs on the same rule as the server: signed in, online, carrying
  // something that has not finished. The hook reads all of that from `data`.
  const gps = useRiderGps({
    activeOrder,
    online: data.isOnline,
    pickedUp: isPickedUpStage(activeOrder?.status)
  });

  const retry = useCallback(async () => {
    setRetrying(true);
    try { await data.refresh(); } finally { setRetrying(false); }
  }, [data]);

  const toggleAvailability = useCallback(() => {
    if (data.isOnline == null) return;
    actions.setAvailability(data.isOnline ? 'OFFLINE' : 'ONLINE');
  }, [actions, data.isOnline]);

  const openOrderById = useCallback((id) => setOpenOrderId(id), []);

  const navigateToCustomer = useCallback((address) => {
    if (!address) return;
    if (address.hasPin) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${address.lat},${address.lng}`,
        '_blank', 'noopener,noreferrer'
      );
      return;
    }
    // No pin: send the address text rather than a coordinate, and never a made-up
    // one. The hotel is not the customer's address, so it is not used as a
    // substitute.
    const q = encodeURIComponent(address.line || '');
    if (q) window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank', 'noopener,noreferrer');
  }, []);

  const showDetail = openOrder != null;
  const busyKey = actions.busy;
  const refusal = actions.lastRefusal;

  if (data.loading && !data.profile) {
    return (
      <div className="min-h-screen bg-neutral-100">
        <RiderLoading label="Hotel Darshan Rider" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <RiderTopBar
        isOnline={data.isOnline}
        onToggleAvailability={toggleAvailability}
        busy={busyKey?.startsWith('availability')}
        unread={data.notifications.unread}
        onOpenNotifications={() => setTab('notifications')}
        onOpenProfile={() => setTab('profile')}
      />
      <ConnectionBanner connected={data.connected} />

      <div className="mx-auto max-w-5xl flex md:gap-0">
        <RiderNav tab={tab} onChange={(t) => { setTab(t); setOpenOrderId(null); }} unread={data.notifications.unread} />

        <main className="flex-1 min-w-0 px-4 pt-4 pb-28 md:pb-8">
          {/* A refusal is shown where it happened, not swallowed. */}
          {refusal && (
            <div className="mb-4 rounded-2xl bg-amber-50 border border-amber-200 p-3.5 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-amber-900">{refusal.message}</p>
                {refusal.code && <p className="text-[10px] text-amber-700 mt-0.5 font-mono">{refusal.code}</p>}
              </div>
              <button
                onClick={actions.clearRefusal}
                className="text-[10px] font-black text-amber-700 shrink-0 min-h-[32px] px-2 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {showDetail ? (
            openOrder ? (
              <RiderDeliveryDetail
                order={openOrder}
                gps={gps}
                busy={Boolean(busyKey)}
                onBack={() => setOpenOrderId(null)}
                onAction={actions.riderAction}
                onNavigate={navigateToCustomer}
                onCollectPayment={actions.collectPayment}
                onRetryGps={gps.retry}
              />
            ) : (
              <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center space-y-3">
                <p className="font-black text-neutral-900 text-sm">This delivery is no longer available</p>
                <p className="text-xs text-neutral-500">
                  It may have been reassigned or cancelled. Pull the list again to see your current deliveries.
                </p>
                <button
                  onClick={retry}
                  disabled={retrying}
                  className="min-h-[44px] px-5 rounded-xl bg-[#e53935] hover:bg-[#d32f2f] disabled:opacity-60 text-white font-black text-xs cursor-pointer"
                >
                  {retrying ? 'Refreshing' : 'Refresh'}
                </button>
              </div>
            )
          ) : (
            <>
              {tab === 'dashboard' && (
                <RiderDashboard
                  data={data}
                  gps={gps}
                  onOpenDelivery={() => { setOpenOrderId(activeOrder.id); setTab('orders'); }}
                  onRefresh={retry}
                  retrying={retrying}
                />
              )}
              {tab === 'orders' && (
                <RiderOrders
                  data={data}
                  onOpenOrder={openOrderById}
                  onRefresh={retry}
                  retrying={retrying}
                />
              )}
              {tab === 'earnings' && (
                <RiderEarnings data={data} onRefresh={retry} retrying={retrying} />
              )}
              {tab === 'notifications' && (
                <RiderNotifications
                  data={data}
                  onOpenOrder={openOrderById}
                  onMarkRead={actions.markRead}
                  onMarkAllRead={actions.markAllRead}
                  onRefresh={retry}
                  retrying={retrying}
                />
              )}
              {tab === 'profile' && <RiderProfile data={data} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default RiderApp;
