import React, { useMemo, useState, useEffect } from 'react';
import BrandLogo from './BrandLogo';
import {
  Clock,
  CheckCircle2,
  RefreshCw,
  Flame,
  Volume2,
  VolumeX,
  Truck,
  Building,
  ShieldAlert,
  Search,
  Maximize,
  Minimize,
  ChefHat,
  UserRound,
  MapPin,
  ClipboardCheck,
  NotebookText,
  Utensils,
  Bell,
  LogOut,
  Power
} from 'lucide-react';

import { resolveFoodImage } from '../data/foodImages';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { FINISHED_STATUSES, isFinished } from '../lib/orderStatus';
import { parseServerTimestamp, formatClockTime, formatDateTime, formatDayDate, minutesSince } from '../lib/time.js';
import { apiBase as API_BASE } from '../lib/apiBase';

const NEW_STATUSES = ['ORDER_PLACED', 'ORDER_CONFIRMED'];

/**
 * The stages at which the order has left the kitchen but is still in progress.
 *
 * For a delivery these are live: the food has left the building but the customer
 * does not have it. They belong in the "handed over" column, which is about the
 * kitchen's own handoff rather than about the order being over - but they are not
 * completed, and the dashboard count below must not include them.
 */
const WITH_RIDER_STATUSES = [
  'RIDER_ASSIGNED',
  'RIDER_GOING_TO_HOTEL',
  'RIDER_ARRIVED_AT_HOTEL',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'RIDER_NEAR_CUSTOMER'
];

// Configurable limit for recently completed orders shown in HANDED OVER column
const RECENT_COMPLETED_LIMIT = 5;

/**
 * Which part of the kitchen this order is in.
 *
 * `REJECTED` used to be missing from the list this function tested, so a rejected
 * order fell through to 'new' and the kitchen saw it as one it had just been
 * handed. The finished statuses now come from the shared module, which is the same
 * list the server and the customer screens use.
 */
function getOrderGroup(order) {
  if (NEW_STATUSES.includes(order?.status)) {
    return 'new';
  }

  if (order?.status === 'PREPARING') {
    return 'cooking';
  }

  if (
    order?.order_type === 'pickup' &&
    order?.status === 'READY_FOR_PICKUP'
  ) {
    return 'ready';
  }

  if (
    order?.order_type === 'delivery' &&
    order?.status === 'READY'
  ) {
    return 'ready';
  }

  if (isFinished(order?.status) || WITH_RIDER_STATUSES.includes(order?.status)) {
    return 'completed';
  }

  return 'new';
}

function getItemName(item) {
  return item?.name_en || item?.name || 'Kitchen item';
}

function getItemCustomizations(item) {
  if (!Array.isArray(item?.customizations)) {
    return '';
  }

  return item.customizations
    .map(
      (customization) =>
        customization?.name_en ||
        customization?.name ||
        customization
    )
    .filter(Boolean)
    .join(', ');
}

function getOrderAddress(order) {
  const address = order?.address || {};

  return [
    address.street,
    address.landmark,
    address.city,
  ]
    .filter(Boolean)
    .join(', ');
}

function formatStatus(status) {
  return String(status || 'ORDER_PLACED')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The kitchen runs in the restaurant, so its clock is IST regardless of whatever
 * tablet or phone the display is on. These used to build `new Date(timestamp)`
 * from the server's UTC string and render it in the *device's* zone - a 5h30m
 * error, and one that also drove `getElapsedMinutes` below. A ticket placed at
 * 11:22 PM was read as 17:52, making it read as 5 and a half hours old and
 * immediately "overdue" against the 20-minute threshold.
 */
function formatOrderTime(timestamp) {
  return formatClockTime(timestamp);
}

function getElapsedMinutes(timestamp) {
  return minutesSince(timestamp) ?? 0;
}

function getFoodImage(item) {
  // Central map first (same as Menu/Cart/Orders) so the kitchen never shows a
  // different picture for a dish than the customer does.
  return resolveFoodImage({ ...item, name_en: getItemName(item) }) || null;
}

function formatKitchenDateTime(timestamp) {
  return formatDateTime(timestamp);
}

function getPaymentStatus(order) {
  if (order?.payment_status === 'paid') return 'Paid';
  if (order?.payment_method === 'online') return 'Awaiting Payment';
  if (order?.payment_method === 'cod') return 'Cash on Delivery';
  if (order?.payment_method === 'pay_at_hotel') return 'Pay at Counter';
  return 'Pending';
}

function CompletedOrdersHistory({ orders, onClose }) {
  const allCompleted = Array.isArray(orders) ? orders : [];
  // Sorting is by instant, so it goes through the shared parser. A constant
  // 5h30m offset would not change the ordering, but reading the value as local
  // time is still wrong and would matter the moment a value carried a real
  // timezone instead of the database's bare UTC.
  const activityOf = (o) => parseServerTimestamp(o?.updated_at || o?.created_at) ?? 0;
  const completedOrders = allCompleted.filter((o) => COMPLETED_STATUSES.includes(o?.status))
    .sort((a, b) => activityOf(b) - activityOf(a));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div
        className="relative bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-neutral-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-5 sm:px-6 py-4 border-b border-neutral-200 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-600 transition cursor-pointer"
              title="Back to KDS"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
            <div>
              <h2 className="text-lg font-black text-neutral-900 leading-tight">
                Recent Completed Orders
              </h2>
              <p className="text-xs text-neutral-400">Showing the {completedOrders.length} most recent completed orders</p>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-3">
          {completedOrders.length === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-3xl p-10 text-center shadow-xs">
              <svg className="w-14 h-14 bg-blue-50 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              <h3 className="text-xl font-black text-neutral-900">No Completed Orders</h3>
              <p className="text-xs text-neutral-500 mt-1">Completed orders will appear here.</p>
            </div>
          ) : (
            completedOrders.map((order, index) => {
              const orderId = getOrderId(order);
              const orderType = getOrderType(order);
              const items = Array.isArray(order?.items) ? order.items : [];
              const total = Number(order?.total_amount || order?.grand_total || 0);
              const completedTime = order?.updated_at || order?.created_at;
              const paymentStatus = getPaymentStatus(order);

              return (
                <div
                  key={`${order.id || order.order_number || 'order'}-${index}`}
                  className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-xs hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-black text-neutral-900">#{orderId}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${orderType === 'pickup' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                        {orderType === 'pickup' ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 11l-3 3m0 0l3 3m-3-3h12" /></svg>
                            Pickup
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a2 2 0 00-2-2H6a2 2 0 00-2 2v4m16-4l-4 4m4-4H2" /></svg>
                            Delivery
                          </>
                        )}
                      </span>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <svg className="w-3.5 h-3.5 fill-emerald-600" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
                      {formatStatus(order?.status)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="font-medium text-neutral-500 mb-0.5">Customer</p>
                      <p className="font-bold text-neutral-900">{order?.customer_name || order?.customerName || 'Customer'}</p>
                    </div>
                    <div>
                      <p className="font-medium text-neutral-500 mb-0.5">Items</p>
                      <p className="font-bold text-neutral-900">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div>
                      <p className="font-medium text-neutral-500 mb-0.5">Total</p>
                      <p className="font-black text-neutral-900">₹{total.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="font-medium text-neutral-500 mb-0.5">Payment</p>
                      <p className="font-bold text-neutral-900">{paymentStatus}</p>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <p className="font-medium text-neutral-500 mb-0.5">Items Detail</p>
                      <p className="text-neutral-700 line-clamp-2">
                        {items.map((item) => `${item?.quantity || 1}x ${getItemName(item)}`).join(', ')}
                      </p>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <p className="font-medium text-neutral-500 mb-0.5">Completed</p>
                      <p className="font-bold text-neutral-900">{formatKitchenDateTime(completedTime)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function getOrderId(order) {
  return (
    order?.order_number ||
    order?.orderNumber ||
    order?.id ||
    'N/A'
  );
}

function getOrderType(order) {
  return String(order?.order_type || 'delivery').toLowerCase();
}

function isUrgent(order) {
  if (order?.is_urgent) {
    return true;
  }

  if (!order?.created_at) {
    return false;
  }

  // Parse through the shared reader rather than `new Date(...)`. Reading the
  // server's UTC string as local time made every IST evening order look hours
  // old on arrival, so this fired "overdue" immediately for exactly the orders
  // placed in the evening service.
  const createdAt = parseServerTimestamp(order.created_at);

  if (createdAt === null) {
    return false;
  }

  const minutesPassed = (Date.now() - createdAt) / 60000;

  return minutesPassed >= 20;
}

const COLUMN_CONFIG = {
  new: {
    title: 'NEW ORDERS',
    subtitle: 'Incoming orders',
    icon: ClipboardCheck,
    color: 'neutral',
    bg: 'bg-neutral-50',
    header: 'bg-neutral-900',
  },

  cooking: {
    title: 'COOKING',
    subtitle: 'Currently preparing',
    icon: ChefHat,
    color: 'orange',
    bg: 'bg-orange-50/30',
    header: 'bg-orange-900',
  },

  ready: {
    title: 'READY',
    subtitle: 'Ready for handover',
    icon: CheckCircle2,
    color: 'emerald',
    bg: 'bg-emerald-50/30',
    header: 'bg-emerald-900',
  },

  completed: {
    title: 'HANDED OVER',
    subtitle: 'Completed orders',
    icon: Utensils,
    color: 'blue',
    bg: 'bg-blue-50/30',
    header: 'bg-neutral-800',
  },
};

function KitchenOrderCard({
  order,
  onMoveOrder,
  isNew,
}) {
  const items = Array.isArray(order?.items)
    ? order.items
    : [];

  const urgent = isUrgent(order);
  const orderType = getOrderType(order);
  const orderId = getOrderId(order);
  const elapsedMins = getElapsedMinutes(order?.created_at || order?.createdAt || order?.order_time);

  return (
    <article
      className={[
        'relative rounded-2xl border bg-white shadow-sm overflow-hidden transition-transform hover:translate-y-[-1px]',
        isNew
          ? 'border-[#e53935] ring-2 ring-[#e53935]/20 animate-pulse-subtle'
          : urgent
          ? 'border-red-300 ring-1 ring-red-200'
          : 'border-neutral-200',
      ].join(' ')}
    >
      {/* NEW pulse indicator */}
      {isNew && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#e53935] animate-pulse"></div>
      )}
      {/* Urgent pulse indicator */}
      {urgent && !isNew && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-red-500 animate-pulse"></div>
      )}

      {/* Header */}
      <div className="border-b border-neutral-100 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-black text-neutral-900">
              #{orderId}
            </span>

            {isNew && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e53935] px-2 py-1 text-[10px] font-black uppercase text-white animate-pulse-subtle">
                <Bell size={10} />
                NEW
              </span>
            )}

            {urgent && !isNew && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-[10px] font-black uppercase text-red-700">
                <ShieldAlert size={12} />
                Urgent
              </span>
            )}
          </div>

          <span
            className={[
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
              orderType === 'pickup'
                ? 'bg-blue-50 text-blue-700'
                : 'bg-orange-50 text-orange-700',
            ].join(' ')}
          >
            {orderType === 'pickup' ? (
              <Building size={13} />
            ) : (
              <Truck size={13} />
            )}

            {orderType === 'pickup'
              ? 'Pickup'
              : 'Delivery'}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500">
          <div className="flex items-center gap-1">
            <Clock size={13} />
            <span>{formatOrderTime(order?.created_at || order?.createdAt || order?.order_time || '')}</span>
            {elapsedMins > 0 && (
              <>
                <span className="text-neutral-300">·</span>
                <span className="font-medium text-neutral-600">{elapsedMins}m ago</span>
              </>
            )}
          </div>

           <span
             className={[
               'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase',
               order?.payment_status === 'paid'
                 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                 : order?.payment_method === 'online'
                 ? 'bg-amber-50 text-amber-700 border border-amber-200'
                 : 'bg-neutral-900 text-neutral-100',
             ].join(' ')}
             title={
               'Payment: ' +
               (order?.payment_method === 'cod'
                 ? 'Cash on Delivery'
                 : order?.payment_method === 'pay_at_hotel'
                 ? 'Pay at Counter'
                 : 'Online') +
               ' — ' +
               (order?.payment_status === 'paid' ? 'Paid' : 'Pending')
             }
           >
             {order?.payment_status === 'paid'
               ? 'Paid'
               : order?.payment_method === 'online'
               ? 'Awaiting Payment'
               : 'Cash on Delivery'}
           </span>
        </div>
      </div>

      {/* Customer */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100">
            <UserRound
              size={16}
              className="text-neutral-600"
            />
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-neutral-900">
              {order?.customer_name ||
                order?.customerName ||
                'Customer'}
            </p>

            {order?.customer_phone && (
              <p className="text-xs text-neutral-500">
                {order.customer_phone}
              </p>
            )}
          </div>
        </div>

        {orderType === 'delivery' &&
          getOrderAddress(order) && (
            <div className="mt-3 flex gap-2 rounded-xl bg-neutral-50 p-3">
              <MapPin
                size={15}
                className="mt-0.5 shrink-0 text-neutral-500"
              />

              <p className="text-xs leading-5 text-neutral-600">
                {getOrderAddress(order)}
              </p>
            </div>
          )}
      </div>

      {/* Food items */}
      <div className="space-y-2 px-4 pb-3">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        {items.length === 0 ? (
          <div className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-500">
            No items found for this order.
          </div>
        ) : (
          items.map((item, index) => {
            const image = getFoodImage(item);
            const customizations =
              getItemCustomizations(item);

            return (
              <div
                key={
                  item?.id ||
                  item?.item_id ||
                  `${getItemName(item)}-${index}`
                }
                className="flex gap-3 rounded-xl border border-neutral-100 bg-neutral-50 p-2.5"
              >
                {image ? (
                  <img
                    src={image}
                    alt={getItemName(item)}
                    className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-200">
                    <Utensils size={20} className="text-neutral-400" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-neutral-900">
                      {getItemName(item)}
                    </p>

                    <span className="shrink-0 rounded-md bg-neutral-900 px-2 py-1 text-xs font-black text-white">
                      ×{item?.quantity || 1}
                    </span>
                  </div>

                  {customizations && (
                    <p className="mt-1 text-xs text-neutral-500">
                      {customizations}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Special Instructions (customer) */}
      {order?.special_instructions ? (
        <div className="mx-4 mb-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex gap-2">
            <NotebookText
              size={15}
              className="mt-0.5 shrink-0 text-neutral-500"
            />

            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-neutral-600">
                Special Instructions
              </p>

              <p className="mt-1 text-xs leading-5 text-neutral-800">
                {order.special_instructions}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delivery instructions (customer) */}
      {order?.delivery_instructions ||
      order?.address?.instructions ? (
        <div className="mx-4 mb-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex gap-2">
            <MapPin
              size={15}
              className="mt-0.5 shrink-0 text-neutral-500"
            />

            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-neutral-600">
                Delivery Instructions
              </p>

              <p className="mt-1 text-xs leading-5 text-neutral-800">
                {order?.delivery_instructions ||
                  order?.address?.instructions}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Chef Note (kitchen-internal) */}
      {order?.chef_notes || order?.notes ? (
        <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex gap-2">
            <Flame
              size={15}
              className="mt-0.5 shrink-0 text-amber-600"
            />

            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">
                Chef Note
              </p>

              <p className="mt-1 text-xs leading-5 text-amber-900">
                {order?.chef_notes || order?.notes}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Footer */}
      <div className="border-t border-neutral-100 bg-neutral-50 p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-500">
            Status: {formatStatus(order?.status)}
          </span>

          {order?.total_amount !== undefined && (
            <span className="text-sm font-black text-neutral-900">
              ₹{Number(order.total_amount || 0).toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {order?.status === 'ORDER_PLACED' ||
          order?.status === 'ORDER_CONFIRMED' ? (
            <button
              type="button"
              onClick={() =>
                onMoveOrder(order, 'PREPARING')
              }
              className="flex-1 rounded-xl bg-orange-500 px-3 py-2.5 text-xs font-black text-white transition hover:bg-orange-600"
            >
              <span className="flex items-center justify-center gap-2">
                <ChefHat size={15} />
                Start Cooking
              </span>
            </button>
          ) : null}

          {order?.status === 'PREPARING' ? (
            <button
              type="button"
              onClick={() =>
                onMoveOrder(
                  order,
                  orderType === 'pickup'
                    ? 'READY_FOR_PICKUP'
                    : 'READY'
                )
              }
              className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700"
            >
              <span className="flex items-center justify-center gap-2">
                <CheckCircle2 size={15} />
                Mark Ready
              </span>
            </button>
          ) : null}

          {order?.status === 'READY_FOR_PICKUP' &&
          orderType === 'pickup' ? (
            <button
              type="button"
              onClick={() =>
                onMoveOrder(
                  order,
                  'PICKED_UP'
                )
              }
              className="flex-1 rounded-xl bg-neutral-900 px-3 py-2.5 text-xs font-black text-white transition hover:bg-neutral-800"
            >
              <span className="flex items-center justify-center gap-2">
                <ClipboardCheck size={15} />
                Picked Up
              </span>
            </button>
          ) : order?.status === 'READY' &&
            orderType === 'delivery' ? (
            <div className="flex-1 rounded-xl bg-neutral-100 px-3 py-2.5 text-xs font-medium text-neutral-500 flex items-center justify-center gap-2">
              <Clock size={13} />
              Awaiting Rider
            </div>
          ) : null}

          {COMPLETED_STATUSES.includes(
            order?.status
          ) ? (
            <div className="flex-1 rounded-xl bg-green-50 px-3 py-2.5 text-center text-xs font-black text-green-700">
              <span className="flex items-center justify-center gap-2">
                <CheckCircle2 size={15} />
                Completed
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function KitchenView() {
  const { socket, orders, updateOrderStatus, addNotification, playNotificationSound } = useSocket();
  const { user, logout } = useAuth();

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [tick, setTick] = useState(0);
  const [kitchenOpen, setKitchenOpen] = useState(true);
  const [viewedNewOrderIds, setViewedNewOrderIds] = useState(() => new Set());
  const [now, setNow] = useState(Date.now());
  const [activeSection, setActiveSection] = useState('orders');
  const [showCompletedHistory, setShowCompletedHistory] = useState(false);

  // Live clock used by the header time display
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Join the kitchen room from the view that actually needs it, and re-join
  // after a reconnect, since the server forgets room membership when the
  // connection drops.
  useEffect(() => {
    if (!socket) return undefined;
    socket.emit('join_kitchen');
    socket.on('connect', () => socket.emit('join_kitchen'));
    return () => { socket.off('connect'); };
  }, [socket]);

  // Kitchen open/closed status, sourced from the existing restaurant_open setting
  useEffect(() => {
    let cancelled = false;
    const fetchKitchenStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          const s = await res.json();
          if (!cancelled) {
            setKitchenOpen(
              s.restaurant_open === true ||
                s.restaurant_open === 'true' ||
                s.restaurant_open === '1' ||
                s.restaurant_open === 1
            );
          }
        }
      } catch {
        // keep last known value
      }
    };
    fetchKitchenStatus();
    const poll = setInterval(fetchKitchenStatus, 15000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  // Update elapsed time every 30 seconds (drives the urgent timer)
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(prev => prev + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // New order notification: toast + sound when a new order arrives
  useEffect(() => {
    const allOrders = Array.isArray(orders) ? orders : [];
    const newOrders = allOrders.filter((o) => NEW_STATUSES.includes(o?.status));

    for (const order of newOrders) {
      if (!order?.id) continue;
      if (viewedNewOrderIds.has(order.id)) continue;

      // Mark as viewed immediately to prevent duplicate notifications
      setViewedNewOrderIds((prev) => {
        const next = new Set(prev);
        next.add(order.id);
        return next;
      });

      // Show toast notification
      if (typeof addNotification === 'function') {
        addNotification(
          'New Order Received',
          `Order #${getOrderId(order)} — ${order?.customer_name || 'Customer'} (${order?.items?.length || 0} items)`,
          'alert'
        );
      }

      // Play kitchen alert sound if enabled
      if (soundEnabled && typeof playNotificationSound === 'function') {
        playNotificationSound('kitchen_alert');
      }
    }
  }, [orders, viewedNewOrderIds, soundEnabled, addNotification, playNotificationSound]);

  const filteredOrders = useMemo(() => {
    const allOrders = Array.isArray(orders)
      ? orders
      : [];

    return allOrders.filter((order) => {
      const group = getOrderGroup(order);

      if (filter === 'new' && group !== 'new') {
        return false;
      }

      if (
        filter === 'cooking' &&
        group !== 'cooking'
      ) {
        return false;
      }

      if (filter === 'ready' && group !== 'ready') {
        return false;
      }

      if (
        filter === 'delivery' &&
        getOrderType(order) !== 'delivery'
      ) {
        return false;
      }

      if (
        filter === 'pickup' &&
        getOrderType(order) !== 'pickup'
      ) {
        return false;
      }

      if (filter === 'urgent' && !isUrgent(order)) {
        return false;
      }

      if (search.trim()) {
        const query = search
          .trim()
          .toLowerCase();

        const searchableText = [
          getOrderId(order),
          order?.customer_name,
          order?.customerName,
          order?.customer_phone,
          ...(Array.isArray(order?.items)
            ? order.items.map(getItemName)
            : []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!searchableText.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [orders, filter, search]);

  const groupedOrders = useMemo(() => {
    const groups = {
      new: [],
      cooking: [],
      ready: [],
      completed: [],
    };

    filteredOrders.forEach((order) => {
      const group = getOrderGroup(order);

      if (groups[group]) {
        groups[group].push(order);
      }
    });

    // Limit completed orders to RECENT_COMPLETED_LIMIT (most recent first)
    if (groups.completed.length > RECENT_COMPLETED_LIMIT) {
      const lastActivity = (o) => parseServerTimestamp(o?.updated_at || o?.created_at) ?? 0;
      groups.completed = groups.completed
        .sort((a, b) => lastActivity(b) - lastActivity(a))
        .slice(0, RECENT_COMPLETED_LIMIT);
    }

    return groups;
  }, [filteredOrders]);

  // Dashboard statistics, derived from the live socket order feed
  const stats = useMemo(() => {
    const all = Array.isArray(orders) ? orders : [];
    const byStatus = (statuses) =>
      all.filter((o) => statuses.includes(o?.status)).length;
    const byType = (type) =>
      all.filter((o) => String(o?.order_type) === type).length;

    return {
      newOrders: byStatus(NEW_STATUSES),
      cooking: byStatus(['PREPARING']),
      ready: byStatus(['READY', 'READY_FOR_PICKUP']),
      // Really finished, not merely handed over. This used to count
      // PICKED_UP and OUT_FOR_DELIVERY, so the kitchen's "completed" figure rose
      // every time a rider took an order out of the building and stayed high for
      // as long as the delivery was on the road.
      completed: all.filter((o) => FINISHED_STATUSES.includes(o?.status)).length,
      delivery: byType('delivery'),
      pickup: byType('pickup'),
      urgent: all.filter((o) => isUrgent(o)).length,
    };
  }, [orders, tick]);

  // New-order notification badge (cleared when the bell is clicked)
  const unreadNew = useMemo(() => {
    const currentNewIds = (Array.isArray(orders) ? orders : [])
      .filter((o) => NEW_STATUSES.includes(o?.status))
      .map((o) => o?.id);
    let count = 0;
    for (const id of currentNewIds) {
      if (!viewedNewOrderIds.has(id)) count += 1;
    }
    return count;
  }, [orders, viewedNewOrderIds]);

  async function handleMoveOrder(order, nextStatus) {
    if (!order || !nextStatus) {
      return;
    }

    try {
      if (typeof updateOrderStatus === 'function') {
        // The workflow requires an explicit confirmation before preparation.
        // New orders arrive as ORDER_PLACED, so advance through both valid stages
        // when the kitchen starts cooking directly from that card.
        if (order.status === 'ORDER_PLACED' && nextStatus === 'PREPARING') {
          await updateOrderStatus(order.id, 'ORDER_CONFIRMED');
        }
        await updateOrderStatus(
          order.id,
          nextStatus
        );
      }
    } catch (error) {
      console.error(
        'Failed to update kitchen order:',
        error
      );
      addNotification(
        'Order Update Failed',
        error.message || 'Unable to update the kitchen order status.',
        'error'
      );
    }
  }

  async function handleRefresh() {
    window.location.reload();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen?.();

      setFullscreen(true);
    } else {
      document.exitFullscreen?.();

      setFullscreen(false);
    }
  }

  const filterButtons = [
    { key: 'all', label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'cooking', label: 'Cooking' },
    { key: 'ready', label: 'Ready' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'pickup', label: 'Pickup' },
    { key: 'urgent', label: 'Urgent' },
  ];

  return (
    <section
      className="min-h-screen bg-neutral-100"
      aria-label="Kitchen Display System"
    >
      {/* Dashboard header */}
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <BrandLogo size="md" className="w-11 h-11" />
            <div className="min-w-0">
              <h1 className="text-lg font-black text-neutral-900 leading-tight">
                Hotel Darshan Kitchen
              </h1>
              <p className="text-[10px] text-neutral-500">
                Kitchen Display System
              </p>
            </div>
          </div>

          {/* Live date / time.
              `now` is already a real epoch value (see the ticking state above), so
              this one is not a parse bug - but it was rendering in the tablet's
              own timezone, which means a kitchen tablet set to anything other
              than IST showed a board whose clock disagreed with every ticket on
              it. Pinned to IST so the two always agree. */}
          <div className="flex items-center gap-2 text-neutral-700">
            <Clock size={15} className="text-neutral-400" />
            <span className="font-mono text-xs hidden sm:inline">
              {formatClockTime(now)}
            </span>
            <span className="font-mono text-xs sm:hidden">
              {formatClockTime(now)}
            </span>
            <span className="text-neutral-300">·</span>
            <span className="text-xs text-neutral-500 hidden sm:inline">
              {formatDayDate(now)}
            </span>
          </div>

          {/* Kitchen open / closed status (sourced from existing restaurant_open setting) */}
          <div
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black',
              kitchenOpen
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-[#e53939] border border-red-200',
            ].join(' ')}
            title={kitchenOpen ? 'Kitchen is Open' : 'Kitchen is Closed'}
          >
            <Power
              size={12}
              className={
                kitchenOpen ? 'text-emerald-600' : 'text-[#e53939]'
              }
            />
            <span>{kitchenOpen ? 'Open' : 'Closed'}</span>
          </div>

          {/* Staff, tools, notifications, logout */}
          <div className="flex items-center gap-1.5">
            <div className="hidden md:flex items-center gap-2 text-neutral-700">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100">
                <UserRound size={16} className="text-neutral-600" />
              </div>
              <div className="text-right min-w-0">
                <p className="text-xs font-black text-neutral-900 truncate">
                  {user?.name || 'Kitchen Staff'}
                </p>
                <p className="text-[10px] text-neutral-500">
                  {user?.role === 'chef'
                    ? 'Chef'
                    : user?.role === 'admin'
                    ? 'Admin'
                    : 'Staff'}
                </p>
              </div>
            </div>

            <div className="relative hidden sm:block">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order..."
                className="w-40 rounded-xl border border-neutral-200 bg-neutral-50 py-2 pl-8 pr-3 text-xs outline-none focus:border-neutral-400 lg:w-48"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                const newIds = new Set(
                  (Array.isArray(orders) ? orders : [])
                    .filter((o) => NEW_STATUSES.includes(o?.status))
                    .map((o) => o?.id)
                );
                setViewedNewOrderIds(newIds);
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              title="Notifications"
            >
              <Bell size={18} />
              {unreadNew > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#e53939] text-[10px] font-black text-white">
                  {unreadNew}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              title="Refresh"
            >
              <RefreshCw size={17} />
            </button>

            <button
              type="button"
              onClick={() => setSoundEnabled((c) => !c)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              title="Toggle sound"
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="hidden h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 sm:flex"
              title="Fullscreen"
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>

            <button
              type="button"
              onClick={logout}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-red-50 hover:text-[#e53939]"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* Mobile search */}
        <div className="px-4 pb-3 sm:hidden">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order..."
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-9 pr-3 text-sm outline-none"
            />
          </div>
        </div>

        {/* Main statistics */}
        <div className="grid grid-cols-3 gap-2 px-4 py-3 sm:grid-cols-4 lg:grid-cols-7 lg:px-6">
          {([
            { label: 'New Orders', value: stats.newOrders, icon: ClipboardCheck, tone: 'neutral' },
            { label: 'Cooking', value: stats.cooking, icon: ChefHat, tone: 'orange' },
            { label: 'Ready', value: stats.ready, icon: CheckCircle2, tone: 'emerald' },
            { label: 'Completed', value: stats.completed, icon: Utensils, tone: 'blue' },
            { label: 'Delivery', value: stats.delivery, icon: Truck, tone: 'neutral' },
            { label: 'Pickup', value: stats.pickup, icon: Building, tone: 'neutral' },
            { label: 'Urgent', value: stats.urgent, icon: ShieldAlert, tone: 'red' },
          ]).map((card) => {
            const Icon = card.icon;
            const toneMap = {
              neutral: 'bg-neutral-900 text-white',
              orange: 'bg-orange-500 text-white',
              emerald: 'bg-emerald-600 text-white',
              blue: 'bg-blue-600 text-white',
              red: 'bg-[#e53939] text-white',
            };
            return (
              <div
                key={card.label}
                className="flex items-center gap-2.5 rounded-xl bg-white border border-neutral-200 px-3 py-2.5"
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneMap[card.tone]}`}
                >
                  <Icon size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-black text-neutral-900 tabular-nums">
                    {card.value}
                  </div>
                  <div className="text-[10px] text-neutral-500 font-semibold">
                    {card.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <div className="overflow-x-auto border-t border-neutral-100">
          <div className="flex min-w-max gap-2 px-4 py-3 lg:px-6">
            {filterButtons.map((button) => {
              const active = filter === button.key;

              return (
                <button
                  key={button.key}
                  type="button"
                  onClick={() => setFilter(button.key)}
                  className={[
                    'rounded-full px-4 py-2 text-xs font-black transition',
                    active
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
                  ].join(' ')}
                >
                  {button.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* KDS Columns */}
      <main className="p-4 lg:p-6">
        {/* Mobile: horizontal swipeable columns */}
        <div className="hidden md:block">
          <div className="grid min-h-[calc(100vh-230px)] grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(COLUMN_CONFIG).map(
              ([key, config]) => {
                const Icon = config.icon;
                const columnOrders =
                  groupedOrders[key];

                return (
                  <section
                    key={key}
                    className={[
                      'flex min-h-[500px] flex-col rounded-2xl border border-neutral-200',
                      config.bg,
                    ].join(' ')}
                  >
                    {/* Column header */}
                    <div className="sticky top-0 z-10 rounded-t-2xl border-b border-neutral-200 bg-white px-4 py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${config.header}`}>
                            <Icon size={18} />
                          </div>

                          <div>
                            <h2 className="text-sm font-black text-neutral-900">
                              {config.title}
                            </h2>

                            <p className="text-[11px] text-neutral-500">
                              {config.subtitle}
                            </p>
                          </div>
                        </div>

                        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-neutral-100 px-2.5 text-xs font-black text-neutral-700">
                          {columnOrders.length}
                        </span>
                      </div>
                    </div>

                    {/* Orders */}
                    <div className="flex-1 space-y-3 overflow-y-auto p-3">
                      {columnOrders.length === 0 ? (
                        <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white px-4 text-center">
                          <Utensils
                            size={24}
                            className="mb-2 text-neutral-300"
                          />

                          <p className="text-xs font-bold text-neutral-400">
                            No orders in this column
                          </p>
                        </div>
                      ) : (
                        columnOrders.map((order) => {
                          const isNewOrder =
                            NEW_STATUSES.includes(order?.status) &&
                            !viewedNewOrderIds.has(order?.id);
                          return (
                            <KitchenOrderCard
                              key={
                                order?.id ||
                                order?.order_number
                              }
                              order={order}
                              onMoveOrder={
                                handleMoveOrder
                              }
                              isNew={isNewOrder}
                            />
                          );
                        })
                      )}
                    </div>

                    {/* View All Completed Orders button - only for completed column */}
                    {key === 'completed' && (
                      <div className="border-t border-neutral-200 p-3 bg-white/50">
                        <button
                          type="button"
                          onClick={() => setShowCompletedHistory(true)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium text-xs transition cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                          View Recent Completed Orders
                        </button>
                      </div>
                    )}
                  </section>
                );
              }
            )}
          </div>
        </div>

        {/* Mobile horizontal swipe columns */}
        <div className="md:hidden">
          <div className="flex gap-4 overflow-x-auto snap-x p-4 pb-6 -mx-4" style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
            {Object.entries(COLUMN_CONFIG).map(
              ([key, config]) => {
                const Icon = config.icon;
                const columnOrders =
                  groupedOrders[key];

                return (
                  <section
                    key={key}
                    className={[
                      'flex min-w-[280px] max-w-[320px] flex-1 min-h-[calc(100vh-200px)] flex-col rounded-2xl border border-neutral-200 shrink-0 snap-center',
                      config.bg,
                    ].join(' ')}
                    style={{ scrollSnapAlign: 'center' }}
                  >
                    {/* Column header */}
                    <div className="sticky top-0 z-10 rounded-t-2xl border-b border-neutral-200 bg-white px-3 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-xl text-white ${config.header}`}>
                            <Icon size={16} />
                          </div>

                          <div className="min-w-0">
                            <h2 className="text-sm font-black text-neutral-900 truncate">
                              {config.title}
                            </h2>

                            <p className="text-[10px] text-neutral-500 truncate">
                              {config.subtitle}
                            </p>
                          </div>
                        </div>

                        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-neutral-100 px-2 text-[10px] font-black text-neutral-700">
                          {columnOrders.length}
                        </span>
                      </div>
                    </div>

                    {/* Orders */}
                    <div className="flex-1 space-y-2 overflow-y-auto p-2">
                      {columnOrders.length === 0 ? (
                        <div className="flex min-h-24 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white px-2 text-center">
                          <Utensils
                            size={20}
                            className="mb-1 text-neutral-300"
                          />

                          <p className="text-[10px] font-bold text-neutral-400">
                            No orders
                          </p>
                        </div>
                      ) : (
                        columnOrders.map((order) => {
                          const isNewOrder =
                            NEW_STATUSES.includes(order?.status) &&
                            !viewedNewOrderIds.has(order?.id);
                          return (
                            <KitchenOrderCard
                              key={
                                order?.id ||
                                order?.order_number
                              }
                              order={order}
                              onMoveOrder={
                                handleMoveOrder
                              }
                              isNew={isNewOrder}
                            />
                          );
                        })
                      )}
                    </div>

                    {/* View All Completed Orders button - only for completed column */}
                    {key === 'completed' && (
                      <div className="border-t border-neutral-200 p-2 bg-white/50">
                        <button
                          type="button"
                          onClick={() => setShowCompletedHistory(true)}
                          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium text-[10px] transition cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                          View Recent Completed Orders
                        </button>
                      </div>
                    )}
                  </section>
                );
              }
            )}
          </div>
          
          {/* Scroll indicator */}
          <div className="flex items-center justify-center gap-1 px-4 pb-4">
            {Object.keys(COLUMN_CONFIG).map((_, i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-neutral-300"
              />
            ))}
          </div>
        </div>
      </main>
      {showCompletedHistory && (
        <CompletedOrdersHistory
          orders={orders}
          onClose={() => setShowCompletedHistory(false)}
        />
      )}
    </section>
  );
}

export default KitchenView;
