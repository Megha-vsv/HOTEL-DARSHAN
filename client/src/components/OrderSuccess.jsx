import React, { useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { resolveFoodImage } from '../data/foodImages';
import {
  formatDateTime,
  getEstimatedMinutes,
  formatEstimatedArrival,
} from '../lib/time.js';
import {
  CheckCircle2,
  Clock,
  MapPin,
  ShoppingBag,
  Truck,
  Banknote,
  Landmark,
  ExternalLink,
  Calendar,
  Package
} from 'lucide-react';

const ORDER_TYPE_ICONS = {
  delivery: { icon: Truck, label: 'Home Delivery' },
  pickup: { icon: Landmark, label: 'Self Pickup' }
};

const PAYMENT_LABELS = {
  online: { label: 'Paytm / UPI / Cards', icon: Banknote },
  cod: { label: 'Cash on Delivery', icon: Banknote },
  pay_at_hotel: { label: 'Pay at Hotel Counter', icon: Landmark }
};

const STATUS_LABELS = {
  ORDER_PLACED: 'Order Placed',
  ORDER_CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing in Kitchen',
  READY: 'Food Ready',
  READY_FOR_PICKUP: 'Ready for Pickup',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  PICKED_UP: 'Picked Up',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

function money(value) {
  const amount = Number(value || 0);
  return `₹${amount.toFixed(2)}`;
}

/**
 * All order times come from `lib/time.js`.
 *
 * The two local helpers that used to live here each called `new Date(value)` on
 * the database's timezone-naive UTC string, which a browser reads as *local*
 * time. That is the whole of the reported bug: an order placed at 11:22 PM IST
 * is stored as 17:52 UTC, was re-read as 17:52 IST, and displayed as 05:52 pm.
 */

const OrderSuccess = ({ order, onViewOrder, onContinueShopping }) => {
  const { t } = useLanguage();

  // Auto-scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <div className="text-center p-8 bg-white rounded-3xl shadow-xl max-w-sm">
          <Package className="w-16 h-16 text-neutral-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-neutral-800 mb-2">
            Order information not found
          </h3>
          <p className="text-sm text-neutral-500 mb-4">
            Unable to load your order details. Please check your order history.
          </p>
          <button
            onClick={onContinueShopping}
            className="px-6 py-2.5 bg-[#e53939] hover:bg-[#c62828] text-white rounded-xl font-bold text-sm transition cursor-pointer"
          >
            {t('continueShopping') || 'Continue Shopping'}
          </button>
        </div>
      </div>
    );
  }

  const orderType = order.order_type || 'delivery';
  const typeConfig = ORDER_TYPE_ICONS[orderType] || ORDER_TYPE_ICONS.delivery;
  const TypeIcon = typeConfig.icon;

  const paymentMethod = order.payment_method || 'cod';
  const paymentConfig = PAYMENT_LABELS[paymentMethod] || PAYMENT_LABELS.cod;
  const PaymentIcon = paymentConfig.icon;

  const orderStatus = order.status || 'ORDER_PLACED';
  const statusLabel = STATUS_LABELS[orderStatus] || orderStatus;

  const items = order.items || order.items_json || [];
  const address = order.address || order.address_json || {};
  // The estimate checkout recorded on the order (20 for pickup, 35 for
  // delivery), and the clock time that implies: created_at plus that estimate,
  // rendered in IST.
  const estimatedMins = getEstimatedMinutes(order);
  const estimatedArrival = formatEstimatedArrival(order);

  const discountAmount = order.discount_amount || 0;
  const couponCode = order.coupon_code || '';

  return (
    <div className="min-h-screen bg-neutral-50 pb-8">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-12">
        {/* Success Confirmation Section */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-50 rounded-full mb-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              Confirmed
            </span>
          </div>
          <h1 className="text-2xl font-black text-neutral-900 mb-1">
            {t('orderPlacedSuccess') || 'Order successfully placed!'}
          </h1>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            Your order has been placed and is being processed. You will receive real-time updates on your order status.
          </p>
        </div>

        {/* Order Details Card */}
        <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 mb-6">
          {/* Hotel Darshan Header — stack on narrow screens to avoid clipping */}
          <div className="p-4 sm:p-5 border-b border-neutral-100 flex items-center gap-3 sm:gap-4">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-red-50 flex items-center justify-center text-[#e53939] shrink-0">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-black text-base sm:text-lg text-neutral-900 truncate">Hotel Darshan</h2>
              <p className="text-xs text-neutral-500 truncate">
                Char Rasta, Mosda Road, Dediapada, Gujarat - 393040
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Order ID</span>
              <p className="font-bold text-neutral-900 text-sm">
                {order.order_number || order.id || 'N/A'}
              </p>
            </div>
          </div>

          {/* Order Status */}
          <div className="p-5 border-b border-neutral-100 bg-neutral-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#e53939]/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-[#e53939]" />
                </div>
                <div>
                  <span className="text-xs text-neutral-400 uppercase tracking-wider">Current Status</span>
                  <p className="font-bold text-neutral-900 text-sm">{statusLabel}</p>
                </div>
              </div>
              <div className="text-right">
                {/*
                  This said "Estimated Time" and printed `created_at` - the moment
                  the order was placed. So a 11:22 PM order read "11:22 pm" and
                  looked like it was arriving then. The value now shown is what
                  the estimate actually implies, and the duration sits on its own
                  line so the two are not read as one time.
                */}
                <span className="text-xs text-neutral-400">Estimated Arrival</span>
                <p className="font-bold text-neutral-900 text-sm">
                  {estimatedArrival || '—'}
                  <span className="block text-[10px] font-medium text-neutral-400">
                    in about {estimatedMins} mins
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Order Type & Payment Method */}
          <div className="p-5 border-b border-neutral-100">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center">
                  <TypeIcon className="w-5 h-5 text-neutral-700" />
                </div>
                <div>
                  <p className="text-xs text-neutral-400 uppercase tracking-wider">Order Type</p>
                  <p className="font-semibold text-neutral-800 text-sm">{typeConfig.label}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center">
                  <PaymentIcon className="w-5 h-5 text-neutral-700" />
                </div>
                <div>
                  <p className="text-xs text-neutral-400 uppercase tracking-wider">Payment</p>
                  <p className="font-semibold text-neutral-800 text-sm">{paymentConfig.label}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Ordered Items */}
          <div className="p-4 sm:p-5 border-b border-neutral-100">
            <h3 className="font-bold text-neutral-900 text-sm mb-4 flex items-center gap-2">
              <Package className="w-4 h-4 text-neutral-500" />
              Ordered Items ({items.length})
            </h3>
            <div className="space-y-3">
              {items.map((item, index) => {
                const itemName = item.name_en || item.name || `Item ${item.id || ''}`;
                const quantity = item.quantity || item.qty || 1;
                const unitPrice = item.unit_price ?? item.price ?? 0;
                const itemTotal = item.item_total_price ?? item.total_price ?? unitPrice * quantity;
                // Order rows only snapshot the dish name + menu id, so resolve the
                // image through the central map to match the Menu/Cart exactly.
                const itemImage = resolveFoodImage(item);

                return (
                  <div key={`${item.id || ''}-${index}`} className="flex items-center gap-3 sm:gap-4">
                    <div className="w-14 h-11 sm:w-16 sm:h-12 rounded-xl overflow-hidden bg-neutral-100 border border-neutral-200 shrink-0">
                      <img
                        src={itemImage}
                        alt={itemName}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Never swap in a generic/placeholder asset - just hide it
                          // and let the neutral container show through.
                          e.currentTarget.style.visibility = 'hidden';
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-neutral-900 text-sm truncate">{itemName}</p>
                      <p className="text-xs text-neutral-500">Qty: {quantity} · ₹{unitPrice}</p>
                    </div>
                    <p className="font-black text-neutral-800 text-sm shrink-0">
                      {money(itemTotal)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Delivery Address (for delivery orders) */}
          {orderType === 'delivery' && address && (
            <div className="p-5 border-b border-neutral-100">
              <h3 className="font-bold text-neutral-900 text-sm mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-neutral-500" />
                Delivery Address
              </h3>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-neutral-700" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-800 text-sm">
                    {order.customer_name || order.name || address.name || 'Customer'}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {address.address || address.full_address || address.street || 'N/A'}
                  </p>
                  {address.city && (
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {address.city}{address.pincode ? ` - ${address.pincode}` : ''}
                    </p>
                  )}
                  {order.customer_phone && (
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Phone: {order.customer_phone}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Special Instructions */}
          {(order.special_instructions || order.special_cooking_instructions) && (
            <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/50">
              <p className="text-xs text-neutral-500">
                Special Instructions: {order.special_instructions || order.special_cooking_instructions}
              </p>
            </div>
          )}
        </div>

        {/* Price Summary */}
        <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 mb-6">
          <div className="p-4 sm:p-5">
            <h3 className="font-bold text-neutral-900 text-sm mb-4">Price Summary</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between text-neutral-600">
                <span>Item Total</span>
                <span>{money(order.item_total)}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount{couponCode ? ` (${couponCode})` : ''}</span>
                  <span>-{money(discountAmount)}</span>
                </div>
              )}

              {orderType === 'delivery' && order.delivery_distance_km != null && (
                <div className="flex justify-between text-neutral-600">
                  <span>Delivery Distance</span>
                  <span>{Number(order.delivery_distance_km).toFixed(2)} km</span>
                </div>
              )}

              {orderType === 'delivery' && order.delivery_fee > 0 && (
                <div className="flex justify-between text-neutral-600">
                  <span>Delivery Fee</span>
                  <span>{money(order.delivery_fee)}</span>
                </div>
              )}

              {orderType === 'delivery' && order.delivery_fee === 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Delivery Fee</span>
                  <span>FREE</span>
                </div>
              )}

              <div className="flex justify-between text-neutral-600">
                <span>GST / Taxes</span>
                <span>{money(order.tax_amount)}</span>
              </div>

              <div className="flex justify-between text-base sm:text-lg font-black text-neutral-900 pt-3 border-t border-neutral-200">
                <span>Grand Total</span>
                <span className="text-[#e53939]">₹{(Number(order.grand_total) || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons — stack vertically on mobile for touch-friendliness */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => {
                onViewOrder();
              }}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-black text-sm rounded-2xl transition cursor-pointer min-h-[44px]"
            >
              <ExternalLink className="w-4 h-4" />
              {t('viewOrder') || 'View Order'}
            </button>
            <button
              onClick={() => {
                onContinueShopping();
              }}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-[#e53939] hover:bg-[#c62828] text-white font-black text-sm rounded-2xl shadow-lg shadow-red-500/20 transition cursor-pointer min-h-[44px]"
            >
              <ShoppingBag className="w-4 h-4" />
              {t('continueShopping') || 'Continue Shopping'}
            </button>
          </div>
        </div>

        {/* Order Date */}
        <div className="mt-6 text-center">
          <p className="text-xs text-neutral-400 flex items-center justify-center gap-1.5">
            <Calendar className="w-3 h-3" />
            Order placed on {formatDateTime(order.created_at)}
          </p>
        </div>
      </div>
    </div>
  );
};

export default OrderSuccess;
