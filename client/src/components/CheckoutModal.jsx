import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { resolveFoodImage } from '../data/foodImages';
import {
  readStoredLocation,
  writeStoredLocation,
  sameCoords,
  normaliseCoords,
  forwardGeocode,
  LOCATION_CHANGE_EVENT
} from '../utils/deliveryLocation';
import FoodImage from './FoodImage';
import { UNRESOLVED_DISTANCE_REASON as UNRESOLVED_DISTANCE_MESSAGE } from '../data/deliveryPricing';
import { getEstimatedMinutes } from '../lib/time.js';
import { orderingStatus } from '../lib/time.js';
import { apiBase as API_BASE } from '../lib/apiBase';
import {
  MapPin,
  ShieldCheck,
  CreditCard,
  Banknote,
  Building,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Phone,
  User,
  Plus,
  Sparkles,
  Timer,
  Edit3
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function CheckoutModal({ isOpen, onClose, onOrderConfirmed }) {
  const { t, itemText } = useLanguage();
  const { user, token, updateUserProfile } = useAuth();
  const {
    cart,
    orderType,
    setOrderType,
    coupon,
    totals,
    clearCart,
    validateCart,
    setActiveOrder,
    settings
  } = useCart();

  const { isValid: cartValid, unavailableItems: checkoutUnavailable } = validateCart();

  // Form State
  const [customerName, setCustomerName] = useState(user?.name || '');
  const [customerPhone, setCustomerPhone] = useState(user?.phone || '');
  const [selectedAddressId, setSelectedAddressId] = useState('current_location');

  // Ordering-closed popup. Kept as component state rather than a window global
  // so it is rendered by React and cannot be left open by a stale reference.
  const [orderingClosedModal, setOrderingClosedModal] = useState(null);

  const [street, setStreet] = useState(() => readStoredLocation()?.address || user?.addresses?.[0]?.street || '');
  const [landmark, setLandmark] = useState(user?.addresses?.[0]?.landmark || '');
  const [city, setCity] = useState(user?.addresses?.[0]?.city || 'Dediapada, Gujarat - 393040');
  const [deliveryInstructions, setDeliveryInstructions] = useState('Please call when at the gate');

const [paymentMethod, setPaymentMethod] = useState('online');
const [isProcessing, setIsProcessing] = useState(false);
const [errorMessage, setErrorMessage] = useState('');

// Prevent multiple order submissions before React updates the UI.
const orderSubmissionLock = useRef(false);
  // "Add New Address" form. Addresses are persisted through the same profile
  // endpoint AccountSettings and LocationGate use, so there is only ever one
  // address book in the app.
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [addressNote, setAddressNote] = useState('');
const [resolvingAddressId, setResolvingAddressId] = useState(null);
  const [addressDraft, setAddressDraft] = useState({
    street: '', landmark: '', city: '', state: '', pincode: '', title: 'home'
  });
  const [paymentPendingModal, setPaymentPendingModal] = useState(false);

  // Coordinates of whichever address is being delivered to. This is the single
  // source of truth for the distance shown here and in the cart, and the server
  // prices the order from the same pair.
  const [addressCoords, setAddressCoords] = useState(() => readStoredLocation()?.coords || null);

  // Adopt a location that changed somewhere else (the location screen, another
  // tab). Without this, a freshly detected location would be masked by whatever
  // was selected before, and the old distance would stay on screen.
  useEffect(() => {
    const adopt = () => {
      const stored = readStoredLocation()?.coords || null;
      setAddressCoords((current) => (sameCoords(current, stored) ? current : stored));
    };
    window.addEventListener(LOCATION_CHANGE_EVENT, adopt);
    adopt();
    return () => window.removeEventListener(LOCATION_CHANGE_EVENT, adopt);
  }, []);

  // Publish the selected address so CartContext prices from the address that is
  // actually selected. Writing is skipped when nothing changed, so a stale
  // snapshot can never overwrite a newer location, and a null selection clears
  // the coordinates instead of silently keeping the previous ones.
  useEffect(() => {
    const current = readStoredLocation();
    if (!current || sameCoords(current.coords, addressCoords)) return;
    writeStoredLocation({ address: current.address, coords: addressCoords });
  }, [addressCoords]);

  const [deliveryType, setDeliveryType] = useState('standard');
  const [tipAmount, setTipAmount] = useState(0);
  const [customTip, setCustomTip] = useState('');

  const deliveryTypeOptions = [
    { id: 'express', name: 'Express', time: '15-20 min', charge: 15, desc: 'Fastest delivery' },
    { id: 'standard', name: 'Standard', time: '25-35 min', charge: 0, desc: 'Standard delivery' },
    { id: 'eco', name: 'Eco Saver', time: '40-50 min', charge: -5, desc: 'Economy delivery' }
  ];

  const tipOptions = [0, 10, 20, 50];

  // Persist coordinates that a background lookup has just resolved, so the
  // address carries its own position from then on and never needs looking up
  // again.
  const persistAddressCoords = useCallback(async (addressId, coords) => {
    if (!user) return;
    const existing = Array.isArray(user.addresses) ? user.addresses : [];
    if (!existing.some((a) => a.id === addressId)) return;
    const next = existing.map((a) =>
      a.id === addressId
        ? { ...a, latitude: coords.lat, longitude: coords.lng, location_source: 'address' }
        : a
    );
    try {
      await updateUserProfile({ addresses: next });
    } catch {
      // A failed write only means we look this address up again next time.
    }
  }, [user, updateUserProfile]);

  // The selection is read through a ref because a lookup is started in the same
  // tick the address is picked: state would still hold the previous selection
  // here, and a slow lookup must not overwrite the address the customer moved to.
  const selectedAddressIdRef = useRef(selectedAddressId);

  // Addresses saved before coordinates were captured are resolved here, the
  // first time they are used, so they are priced from their own text rather
  // than from wherever the device happens to be.
  const resolveMissingCoords = useCallback(async (addr) => {
    if (!user || normaliseCoords(addr)) return;
    setResolvingAddressId(addr.id);
    setAddressError('');
    setAddressNote('');
    try {
      const located = await forwardGeocode(addr, token);
      if (selectedAddressIdRef.current !== addr.id) return;
      if (located?.coords) {
        setAddressCoords(located.coords);
        setAddressNote(
          `Location matched from this address${located.label ? `: ${located.label}` : ''}.`
        );
        await persistAddressCoords(addr.id, located.coords);
      } else {
        setAddressCoords(null);
        setAddressNote(UNRESOLVED_DISTANCE_MESSAGE);
      }
    } catch {
      if (selectedAddressIdRef.current !== addr.id) return;
      setAddressCoords(null);
      setAddressNote(UNRESOLVED_DISTANCE_MESSAGE);
    } finally {
      setResolvingAddressId((cur) => (cur === addr.id ? null : cur));
    }
  }, [user, token, persistAddressCoords]);

  if (!isOpen) return null;

  // Saved addresses
  const savedAddresses = Array.isArray(user?.addresses) ? user.addresses : [];

  const handleSelectAddress = (addr, { skipResolve = false } = {}) => {
    selectedAddressIdRef.current = addr.id;
    setSelectedAddressId(addr.id);
    setStreet(addr.street);
    setLandmark(addr.landmark || '');
    setCity(addr.city || 'Dediapada');
    // The address's own coordinates are what the distance is measured from.
    // When it has none, the coordinates are cleared rather than carried over from
    // the previous selection, and the address is looked up in the background.
    setAddressCoords(normaliseCoords(addr) || null);
    setAddressError('');
    setAddressNote('');
    if (!skipResolve) resolveMissingCoords(addr);
  };

  const openAddressForm = () => {
    setAddressDraft({ street: '', landmark: '', city: '', state: '', pincode: '', title: 'home' });
    setAddressError('');
    setAddressNote('');
    setShowAddressForm(true);
  };

  const saveNewAddress = async (e) => {
    e.preventDefault();
    setAddressError('');

    if (!addressDraft.street.trim() || !addressDraft.city.trim()) {
      return setAddressError(`${t('streetAddress')} & ${t('city')} ${t('areRequired')}.`);
    }

    // Signed-in customers save into their profile address book, exactly like
    // AccountSettings does. Guests cannot persist an address, so the typed
    // details are simply used for this order.
    const label = t(addressDraft.title) || t('home');
    const newAddress = {
      id: `addr_${Date.now()}`,
      title: label,
      street: addressDraft.street.trim(),
      landmark: addressDraft.landmark.trim(),
      city: addressDraft.city.trim(),
      state: addressDraft.state.trim(),
      pincode: addressDraft.pincode.trim()
    };

    if (!user) {
      handleSelectAddress(newAddress);
      setShowAddressForm(false);
      return;
    }

    setSavingAddress(true);
    try {
      // A typed address is priced from the address itself, never from wherever
      // the device currently is. If it cannot be located we say so and leave the
      // address unpriced; guessing a distance here is what wrongly tells a
      // customer they are inside the radius.
      const located = await forwardGeocode(addressDraft, token);
      const coords = located?.coords || null;
      const existing = Array.isArray(user.addresses) ? user.addresses : [];
      const persisted = {
        ...newAddress,
        ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
        location_source: coords ? 'address' : 'unresolved'
      };
      await updateUserProfile({ addresses: [...existing, persisted] });
      // updateUserProfile refreshes `user`, so the chip list re-renders with the
      // new address; selecting it recalculates distance, fee and the radius check.
      // The lookup already just ran, so it is not repeated.
      handleSelectAddress(persisted, { skipResolve: true });
      // Set after selecting: selecting clears the note, and this is what tells the
      // customer where the distance came from, or why there is not one yet.
      setAddressNote(
        coords
          ? `Location matched from this address${located.label ? `: ${located.label}` : ''}.`
          : UNRESOLVED_DISTANCE_MESSAGE
      );
      setShowAddressForm(false);
    } catch (err) {
      setAddressError(err.message || t('addressUpdateFailed'));
    } finally {
      setSavingAddress(false);
    }
  };

  // The order cannot be placed while a Home Delivery address is out of range.
  const deliveryBlocked = orderType === 'delivery' && totals.deliveryAllowed === false;

  // Ordering-hours gate. The restaurant trades 10:30-22:00 IST; the times come
  // from the admin panel via settings.opening_time / settings.closing_time and
  // fall back to the module defaults. The check is against the restaurant's
  // clock, never the customer's device, so a phone set to the wrong timezone
  // cannot place an order the kitchen would never accept.
  const hours = orderingStatus(settings?.opening_time, settings?.closing_time);
  const orderingClosed = !hours.open;

  const showOrderingClosed = () => {
    setOrderingClosedModal({ opening: hours.opening, closing: hours.closing });
  };

  const handlePlaceOrder = async () => {
    if (orderSubmissionLock.current) return;

    setErrorMessage('');

    // Ordering-hours gate. This runs before every validation so the popup
    // appears even when the cart or address would otherwise block submission.
    if (orderingClosed) { showOrderingClosed(); return; }

    // Validate customer details
    if (!customerName.trim() || !customerPhone.trim()) {
      return setErrorMessage(t('customerName') + ' & ' + t('mobileNumber') + ' are required.');
    }
    if (orderType === 'delivery' && !street.trim()) {
      return setErrorMessage(t('streetAddress') + ' is required for delivery.');
    }

    // Delivery radius. Home Delivery only - Self Pickup is never restricted.
    if (orderType === 'delivery' && totals.deliveryAllowed === false) {
      return setErrorMessage(totals.deliveryReason);
    }

    // Validate cart item availability
    if (!cartValid) {
      const unavailableList = checkoutUnavailable.map(ui => ui.name_en || ui.id).join(', ');
      return setErrorMessage(
        `Some items in your cart are no longer available: ${unavailableList}. Please remove them from the cart before placing your order.`
      );
    }
    orderSubmissionLock.current = true;
    setIsProcessing(true);

    const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const orderPayload = {
      items: cart,
      order_type: orderType,
      delivery_type: deliveryType,
      tip_amount: tipAmount,
      customer_name: customerName,
      customer_phone: customerPhone,
      address: orderType === 'delivery' ? {
        street, landmark, city, instructions: deliveryInstructions,
        latitude: addressCoords?.lat, longitude: addressCoords?.lng
      } : { hotel: 'Hotel Darshan Counter', address: settings.hotel_address || 'Char Rasta, Mosda Road, Dediapada' },
      coupon_code: coupon ? coupon.code : null,
      payment_method: paymentMethod,
      special_instructions: deliveryInstructions
    };

    let orderCreated = false;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      headers['Idempotency-Key'] = idempotencyKey;

      const createRes = await fetch(`${API_BASE}/orders/create`, { method: 'POST', headers, body: JSON.stringify(orderPayload) });
      const orderData = await createRes.json();
      if (!createRes.ok) throw new Error(orderData.error || 'Failed to place order.');
      orderCreated = true;

      if (paymentMethod !== 'online') { completeOrderSuccess(orderData); return; }

      setPaymentPendingModal(true);
      const paytmHeaders = { 'Content-Type': 'application/json' };
      if (token) paytmHeaders['Authorization'] = `Bearer ${token}`;
      const paytmRes = await fetch(`${API_BASE}/payment/paytm/create`, { method: 'POST', headers: paytmHeaders, body: JSON.stringify({ order_id: orderData.id }) });
      const paytmData = await paytmRes.json();
      if (!paytmRes.ok || !paytmData.success) throw new Error(paytmData.error || 'Paytm payment is not configured yet.');

      if (!window.Paytm?.CheckoutJS) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          // checkoutHost comes from the backend so the browser loads the
          // CheckoutJS script from the same Paytm environment the transaction
          // token was created against. Hard coding the production host made a
          // staging MID load a script that never published a CheckoutJS object.
          script.src = `${paytmData.checkoutHost}/merchantpgpui/checkoutjs/merchants/${paytmData.mid}.js`;
          script.crossOrigin = 'anonymous'; script.onload = resolve; script.onerror = () => reject(new Error('Unable to load Paytm Checkout.'));
          document.body.appendChild(script);
        });
      }

      await window.Paytm.CheckoutJS.init({
        flow: 'DEFAULT',
        data: { orderId: paytmData.orderId, token: paytmData.txnToken, tokenType: 'TXN_TOKEN', amount: String(paytmData.amount) },
        merchant: { mid: paytmData.mid, name: 'Hotel Darshan', redirect: false },
        // payMode.order surfaces the payment options Paytm returns for this MID
        // in the order given here. UPI is listed first so it appears above Cards
        // and Net Banking; modes not returned by Paytm for this MID are simply
        // ignored. Leaving the array empty would let Paytm choose the order.
        payMode: { order: ['UPI', 'CARD', 'NB'] },
        handler: {
          notifyMerchant: (eventName) => { if (eventName === 'APP_CLOSED') { orderSubmissionLock.current = false; setPaymentPendingModal(false); setIsProcessing(false); } },
          transactionStatus: () => verifyPaytmOnServer(orderData.id)
        }
      });
      window.Paytm.CheckoutJS.invoke();
    } catch (err) {
      orderSubmissionLock.current = false;
      setIsProcessing(false); setPaymentPendingModal(false); setErrorMessage(err.message);
    }
  };

  const verifyPaytmOnServer = async (orderId) => {
    try {
      const verifyHeaders = { 'Content-Type': 'application/json' };
      if (token) verifyHeaders['Authorization'] = `Bearer ${token}`;
      const verifyRes = await fetch(`${API_BASE}/payment/paytm/status`, {
        method: 'POST', headers: verifyHeaders, body: JSON.stringify({ order_id: orderId })
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) throw new Error(verifyData.error || t('paymentFailed'));
      setPaymentPendingModal(false); completeOrderSuccess(verifyData.order);
    } catch (e) { orderSubmissionLock.current = false; setIsProcessing(false); setPaymentPendingModal(false); setErrorMessage(e.message); }
  };

  const completeOrderSuccess = (confirmedOrder) => {
    setIsProcessing(false);
    clearCart();
    setActiveOrder(confirmedOrder);

    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch (e) {}

    onClose();
    onOrderConfirmed(confirmedOrder);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div
        className="relative bg-neutral-50 rounded-3xl max-w-5xl w-full max-h-[95vh] flex flex-col overflow-hidden shadow-2xl border border-neutral-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Back button, Restaurant name, Location */}
        <div className="px-5 sm:px-6 py-4 border-b border-neutral-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-600 transition cursor-pointer"
              title="Back to cart"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="p-2 rounded-xl bg-red-50 text-[#e53939]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-neutral-900 leading-tight">
                {t('checkout')}
              </h2>
              <p className="text-xs text-neutral-400">Hotel Darshan • Dediapada, Gujarat 393040</p>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-5 sm:p-6">
            {/* Left: Order Form (8 cols) */}
            <div className="lg:col-span-8 space-y-6">
              {/* Out of delivery range - Home Delivery only, pickup is unaffected */}
              {orderType === 'delivery' && totals.deliveryAllowed === false && (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-red-700">{totals.deliveryReason}</p>
                    {totals.deliveryDistanceKnown ? (
                      <p className="text-xs text-red-600 mt-1">
                        Your location is {totals.deliveryDistanceKm} km from Hotel Darshan (limit {totals.deliveryMaxKm} km).
                        You can still order as <b>Self Pickup</b>.
                      </p>
                    ) : (
                      <p className="text-xs text-red-600 mt-1">
                        Check the address and try again, or order as <b>Self Pickup</b>.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Within range - confirms the distance was measured for this address */}
              {orderType === 'delivery' && totals.deliveryAllowed !== false && totals.deliveryDistanceKnown && (
                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-800">
                    Delivery available — your location is <b>{totals.deliveryDistanceKm} km</b> from Hotel Darshan.
                  </p>
                </div>
              )}

              {/* Order Type Toggle */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block mb-2">
                  {t('orderType')}
                </label>
                <div className="grid grid-cols-2 gap-3 p-1 bg-neutral-100 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setOrderType('delivery')}
                    aria-disabled={totals.deliveryAllowed === false}
                    title={totals.deliveryAllowed === false ? totals.deliveryReason : undefined}
                    className={`py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                      totals.deliveryAllowed === false
                        ? 'text-neutral-400 opacity-70 cursor-not-allowed'
                        : orderType === 'delivery'
                          ? 'bg-white text-[#e53939] shadow-xs'
                          : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <MapPin className="w-4 h-4" />
                    <span>{t('delivery')}</span>
                  </button>                  <button
                    type="button"
                    onClick={() => {
                      setOrderType('pickup');
                      if (paymentMethod === 'cod') setPaymentMethod('pay_at_hotel');
                    }}
                    className={`py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                      orderType === 'pickup'
                        ? 'bg-white text-[#e53939] shadow-xs'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <Building className="w-4 h-4" />
                    <span>{t('pickup')}</span>
                  </button>
                </div>
              </div>

              {/* Customer Basic Info */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs font-semibold text-neutral-700 block mb-1">
                    {t('customerName')} *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full pl-9 pr-3 py-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-neutral-700 block mb-1">
                    {t('mobileNumber')} *
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                      className="w-full pl-9 pr-3 py-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                    />
                  </div>
                </div>
              </div>

              {/* Delivery Address OR Pickup Details */}
              {orderType === 'delivery' ? (
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block">
                    {t('deliveryAddress')}
                  </label>

                  {/* Saved Addresses Chips */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {savedAddresses.map((addr) => (
                      <div
                        key={addr.id}
                        onClick={() => handleSelectAddress(addr)}
                        className={`p-3 rounded-2xl border transition cursor-pointer text-left ${
                          selectedAddressId === addr.id
                            ? 'bg-red-50/70 border-[#e53939] text-neutral-900 shadow-xs'
                            : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-[#e53939]" />
                            {addr.title}
                          </span>
                          {selectedAddressId === addr.id && (
                            <CheckCircle2 className="w-4 h-4 text-[#e53939]" />
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-600 line-clamp-2 leading-relaxed">
                          {addr.street}, {addr.landmark}
                        </p>
                      </div>
                    ))}

                    {/* Add New Address */}
                    <button
                      type="button"
                      onClick={openAddressForm}
                      className="p-3 rounded-2xl border-2 border-dashed border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 transition cursor-pointer flex flex-col items-center justify-center text-center"
                    >
                      <Plus className="w-5 h-5 mb-1 text-neutral-400" />
                      <span className="font-semibold text-xs">{t('addNewAddress')}</span>
                    </button>
                  </div>

                  {/* New address form */}
                  {showAddressForm && (
                    <form
                      onSubmit={saveNewAddress}
                      data-testid="new-address-form"
                      className="space-y-2.5 p-3.5 rounded-2xl border-2 border-[#e53939]/30 bg-red-50/40"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-xs text-neutral-900">{t('addNewAddress')}</p>
                        <button
                          type="button"
                          onClick={() => setShowAddressForm(false)}
                          aria-label={t('cancel')}
                          className="text-[11px] font-bold text-neutral-500 hover:text-neutral-800"
                        >
                          {t('cancel')}
                        </button>
                      </div>

                      <input
                        type="text"
                        value={addressDraft.street}
                        onChange={(e) => setAddressDraft((d) => ({ ...d, street: e.target.value }))}
                        placeholder={t('streetAddress')}
                        aria-label={t('streetAddress')}
                        className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                      />
                      <input
                        type="text"
                        value={addressDraft.landmark}
                        onChange={(e) => setAddressDraft((d) => ({ ...d, landmark: e.target.value }))}
                        placeholder={t('areaSociety')}
                        aria-label={t('areaSociety')}
                        className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={addressDraft.city}
                          onChange={(e) => setAddressDraft((d) => ({ ...d, city: e.target.value }))}
                          placeholder={t('city')}
                          aria-label={t('city')}
                          className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                        />
                        <input
                          type="text"
                          value={addressDraft.state}
                          onChange={(e) => setAddressDraft((d) => ({ ...d, state: e.target.value }))}
                          placeholder={t('state')}
                          aria-label={t('state')}
                          className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={addressDraft.pincode}
                          onChange={(e) => setAddressDraft((d) => ({ ...d, pincode: e.target.value }))}
                          placeholder={t('pincode')}
                          aria-label={t('pincode')}
                          className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                        />
                        <select
                          value={addressDraft.title}
                          onChange={(e) => setAddressDraft((d) => ({ ...d, title: e.target.value }))}
                          aria-label={t('addressTitle')}
                          className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                        >
                          <option value="home">{t('home')}</option>
                          <option value="work">{t('work')}</option>
                          <option value="other">{t('other')}</option>
                        </select>
                      </div>

                      {addressError && (
                        <p role="alert" className="text-[11px] font-semibold text-red-600">{addressError}</p>
                      )}

                      <button
                        type="submit"
                        disabled={savingAddress}
                        className="w-full py-3 rounded-xl bg-[#e53939] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {savingAddress ? t('savingAddress') : t('saveAddress')}
                      </button>
                    </form>
                  )}

                  {/* How the distance for the selected address was resolved. */}
                  {resolvingAddressId && !showAddressForm && (
                    <p className="text-[11px] text-neutral-600 leading-relaxed">
                      Finding the distance for this address...
                    </p>
                  )}
                  {addressNote && !showAddressForm && (
                    <p className="text-[11px] text-neutral-600 leading-relaxed">{addressNote}</p>
                  )}

                  {/* Address detail inputs */}
<div className="space-y-2 pt-2">
                     <div>
                       <input
                         type="text"
                         value={street}
                         onChange={(e) => setStreet(e.target.value)}
                         placeholder={t('streetAddress')}
                         className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                       />
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                       <input
                         type="text"
                         value={landmark}
                         onChange={(e) => setLandmark(e.target.value)}
                         placeholder={t('landmark')}
                         className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                       />
                       <input
                         type="text"
                         value={city}
                         onChange={(e) => setCity(e.target.value)}
                         placeholder={t('city')}
                         className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                       />
                     </div>
                     <div>
                       <input
                         type="text"
                         value={deliveryInstructions}
                         onChange={(e) => setDeliveryInstructions(e.target.value)}
                         placeholder={t('deliveryInstructions')}
                         className="w-full p-3 bg-white text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors min-h-[44px]"
                       />
                     </div>
                   </div>
                </div>
              ) : (
                /* Pickup Info Screen */
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-3">
                  <div className="flex items-start gap-3">
                    <Building className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-xs sm:text-sm text-neutral-900 mb-0.5">
                        {t('hotelName')} (Counter Takeaway)
                      </h4>
                      <p className="text-xs text-neutral-700 leading-relaxed">
                        {t('hotelAddress')}
                      </p>
                      <p className="text-xs text-neutral-600 mt-1">
                        Phone: <span className="font-semibold">{t('hotelPhone')}</span>
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between text-xs text-neutral-700">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Timer className="w-4 h-4 text-amber-700" />
                      Estimated Delivery Time:
                    </span>
                    {/*
                      This was the literal "15-20 mins", which agreed with nothing:
                      checkout records 35 minutes for a delivery and 20 for a
                      pickup, the `prep_time_mins` setting defaults to 15, and the
                      home banner said 25-35. The number shown to the customer at
                      checkout is the one the order's arrival time is later built
                      from, so it has to be the same one - see `getEstimatedMinutes`
                      in lib/time.js.
                    */}
                    <span className="font-bold text-amber-900">
                      {getEstimatedMinutes({ order_type: orderType || 'delivery' })} mins
                    </span>
                  </div>
                </div>
              )}

              {/* Payment Method Selector */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block">
                    {t('paymentMethod')}
                  </label>
                  {totals.discount > 0 && (
                    <span className="text-[10px] font-medium text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      You save ₹{totals.discount}
                    </span>
                  )}
                </div>

                <div className="space-y-2.5">
                  {/* Online (Paytm) */}
                  <div
                    onClick={() => setPaymentMethod('online')}
                    className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-start gap-3 min-h-[64px] ${
                      paymentMethod === 'online'
                        ? 'bg-red-50/80 border-[#e53939] text-neutral-900 shadow-xs'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300'
                    }`}
                  >
                    <CreditCard className={`w-5 h-5 mt-0.5 shrink-0 ${paymentMethod === 'online' ? 'text-[#e53939]' : 'text-neutral-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{t('payOnline')}</span>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                          Instant
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                        Paytm · UPI (Google Pay, PhonePe) · Cards · NetBanking
                      </p>
                    </div>
                    {paymentMethod === 'online' && (
                      <CheckCircle2 className="w-5 h-5 text-[#e53939] shrink-0 mt-0.5" />
                    )}
                  </div>

                  {/* Cash on Delivery or Pay at Hotel */}
                  {orderType === 'delivery' ? (
                    <div
                      onClick={() => setPaymentMethod('cod')}
                      className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-start gap-3 min-h-[64px] ${
                        paymentMethod === 'cod'
                          ? 'bg-red-50/80 border-[#e53939] text-neutral-900 shadow-xs'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300'
                      }`}
                    >
                      <Banknote className={`w-5 h-5 mt-0.5 shrink-0 ${paymentMethod === 'cod' ? 'text-[#e53939]' : 'text-neutral-400'}`} />
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-sm">{t('cashOnDelivery')}</span>
                        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                          {t('cashOnDeliveryDesc')}
                        </p>
                      </div>
                      {paymentMethod === 'cod' && (
                        <CheckCircle2 className="w-5 h-5 text-[#e53939] shrink-0 mt-0.5" />
                      )}
                    </div>
                  ) : (
                    <div
                      onClick={() => setPaymentMethod('pay_at_hotel')}
                      className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-start gap-3 min-h-[64px] ${
                        paymentMethod === 'pay_at_hotel'
                          ? 'bg-red-50/80 border-[#e53939] text-neutral-900 shadow-xs'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300'
                      }`}
                    >
                      <Building className={`w-5 h-5 mt-0.5 shrink-0 ${paymentMethod === 'pay_at_hotel' ? 'text-[#e53939]' : 'text-neutral-400'}`} />
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-sm">{t('payAtHotel')}</span>
                        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                          {t('payAtHotelDesc')}
                        </p>
                      </div>
                      {paymentMethod === 'pay_at_hotel' && (
                        <CheckCircle2 className="w-5 h-5 text-[#e53939] shrink-0 mt-0.5" />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Delivery Type (only for delivery) */}
              {orderType === 'delivery' && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block mb-2 mt-4">
                    Delivery Speed
                  </label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {deliveryTypeOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setDeliveryType(opt.id)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                          deliveryType === opt.id
                            ? 'bg-red-50/80 border-[#e53939] shadow-xs'
                            : 'bg-white border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs text-neutral-900 flex items-center gap-2">
                            <Timer className={`w-4 h-4 ${deliveryType === opt.id ? 'text-[#e53939]' : 'text-neutral-400'}`} />
                            {opt.name}
                          </span>
                          <span className={`text-xs font-bold ${opt.charge > 0 ? 'text-red-600' : opt.charge < 0 ? 'text-emerald-600' : 'text-neutral-500'}`}>
                            {opt.charge > 0 ? `+₹${opt.charge}` : opt.charge < 0 ? `₹${Math.abs(opt.charge)} savings` : 'Included'}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-500">
                          {opt.time} • {opt.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tip Section */}
              <div className="mt-4">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block mb-2 flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5 text-neutral-400" />
                  Add a Tip (Optional)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tipOptions.map((tip) => (
                    <button
                      key={tip}
                      type="button"
                      onClick={() => { setTipAmount(tip); setCustomTip(''); }}
                      className={`px-3 py-2 rounded-lg font-bold text-xs transition cursor-pointer min-h-[40px] ${
                        tipAmount === tip && customTip === ''
                          ? 'bg-[#e53939] text-white'
                          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }`}
                    >
                      {tip === 0 ? 'No Tip' : `₹${tip}`}
                    </button>
                  ))}
                  <div className="relative flex-1 min-w-[100px]">
                    <input
                      type="number"
                      value={customTip}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomTip(val);
                        const num = parseInt(val, 10);
                        if (!isNaN(num) && num >= 0) {
                          setTipAmount(num);
                        }
                      }}
                      placeholder="Custom"
                      className="w-full px-2.5 py-2 text-sm rounded-lg border border-neutral-200 outline-none focus:border-[#e53939] text-center font-mono min-h-[40px]"
                      min="0"
                    />
                  </div>
                </div>
                  {tipAmount > 0 && customTip === '' && (
                  <p className="text-[10px] text-neutral-500">Thank you for tipping!</p>
                )}
              </div>

              {/* Instructions section */}
              <div className="mt-4">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block mb-2 flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-neutral-400" />
                  Delivery Instructions
                </label>
                <textarea
                  value={deliveryInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                  placeholder={t('deliveryInstructions') || 'e.g. Ring bell, leave at door, etc.'}
                  className="w-full px-3 py-2.5 text-xs rounded-xl border border-neutral-200 outline-none focus:border-[#e53939] resize-none transition-colors"
                  rows={2}
                />
                {deliveryInstructions && (
                  <p className="text-[10px] text-neutral-400 mt-1">Added to your order</p>
                )}
              </div>

              {/* Error Banner */}
              {errorMessage && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            {/* Right: Order Summary (4 cols) */}
            <div className="lg:col-span-4">
              <div className="sticky top-0 bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
                {/* Summary Header */}
                <div className="p-4 border-b border-neutral-100">
                  <h3 className="font-black text-sm text-neutral-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#e53939]" />
                    Order Summary ({cart.reduce((s, i) => s + i.quantity, 0)} items)
                  </h3>
                </div>

                {/* Compact Cart Items */}
                <div className="max-h-80 overflow-y-auto p-3 space-y-2.5">
                  {cart.map((item) => (
                    <div key={item.cartItemId} className="flex items-center gap-2.5">
                      <div className="relative shrink-0">
                        <FoodImage
                          src={resolveFoodImage(item)}
                          alt={itemText(item, 'name')}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                        {item.is_veg !== undefined && (
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white flex items-center justify-center ${
                            item.is_veg ? 'bg-emerald-600' : 'bg-red-600'
                          }`}>
                            <span className="w-1 h-1 rounded-full bg-white"></span>
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-xs text-neutral-900 line-clamp-1">
                          {itemText(item, 'name')}
                        </p>
                        <p className="text-[10px] text-neutral-500">
                          ₹{Number(item.unitPrice)} × {item.quantity}
                        </p>
                      </div>
                      <span className="font-black text-xs text-neutral-900">
                        ₹{item.itemTotalPrice}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Bill Breakdown */}
                <div className="p-4 border-t border-neutral-100 space-y-1.5 text-xs text-neutral-600">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="font-semibold text-neutral-800">₹{totals.itemTotal}</span>
                  </div>

                  {totals.discount > 0 && (
                    <div className="flex justify-between text-emerald-600 font-medium">
                      <span>Discount</span>
                      <span>-₹{totals.discount}</span>
                    </div>
                  )}

                  {orderType === 'delivery' && (
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        Delivery Distance
                      </span>
                      <span className="font-semibold text-neutral-800">
                        {totals.deliveryDistanceKnown
                          ? `${totals.deliveryDistanceKm} km`
                          : 'Location unavailable'}
                      </span>
                    </div>
                  )}

                  {orderType === 'delivery' && (
                    <div className="flex justify-between">
                      <span>Delivery Fee</span>
                      {totals.deliveryAllowed === false ? (
                        <span className="font-bold text-red-600">Unavailable</span>
                      ) : totals.deliveryFee === 0 ? (
                        <span className="text-emerald-600 font-bold uppercase">Free</span>
                      ) : (
                        <span className="font-semibold text-neutral-800">₹{totals.deliveryFee}</span>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span>Tax (5%)</span>
                    <span className="font-semibold text-neutral-800">₹{totals.tax}</span>
                  </div>

                  {orderType === 'delivery' && (() => {
                    const selectedDelivery = deliveryTypeOptions.find((d) => d.id === deliveryType);
                    return selectedDelivery && selectedDelivery.charge !== 0 ? (
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5">
                          <Timer className="w-3.5 h-3.5" />
                          {selectedDelivery.name}
                        </span>
                        <span className={`font-semibold ${selectedDelivery.charge > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {selectedDelivery.charge > 0 ? `+₹${selectedDelivery.charge}` : `-₹${Math.abs(selectedDelivery.charge)}`}
                        </span>
                      </div>
                    ) : null;
                  })()}

                  {tipAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5">
                        <Banknote className="w-3.5 h-3.5" />
                        Tip
                      </span>
                      <span className="font-semibold text-neutral-800">+₹{tipAmount}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-base font-black text-neutral-900 pt-2 border-t border-neutral-200">
                    <span>Total Amount</span>
                    <span className="text-[#e53939]">
                      ₹{(() => {
                        const dtCharge = deliveryTypeOptions.find((d) => d.id === deliveryType)?.charge || 0;
                        return Number(totals.grandTotal) + dtCharge + tipAmount;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* Footer - Payment Summary & Checkout Button */}
         <div className="p-4 sm:p-5 bg-white border-t border-neutral-200">
           {/* Payment method summary */}
           <div className="flex items-center gap-2 text-xs text-neutral-500 mb-3">
             <span>Pay via</span>
             <span className="font-bold text-neutral-700 flex items-center gap-1">
               {paymentMethod === 'online' ? (
                 <>
                   <CreditCard className="w-3.5 h-3.5 text-[#e53939]" />
                   <span>Online (Paytm / UPI)</span>
                 </>
               ) : paymentMethod === 'cod' ? (
                 <>
                   <Banknote className="w-3.5 h-3.5 text-[#e53939]" />
                   <span>Cash on Delivery</span>
                 </>
               ) : (
                 <>
                   <Building className="w-3.5 h-3.5 text-[#e53939]" />
                   <span>Pay at Hotel Counter</span>
                 </>
               )}
             </span>
           </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] text-neutral-400 font-medium">{t('grandTotal')}</div>
                <div className="text-xl font-black text-neutral-900">
                  ₹{(() => {
                    const dtCharge = deliveryTypeOptions.find((d) => d.id === deliveryType)?.charge || 0;
                    return Number(totals.grandTotal) + dtCharge + tipAmount;
                  })()}
                </div>
              </div>

              {/* Ordering-hours hint. Always visible so the customer knows the
                  window before they try to submit; the popup only appears on
                  an actual attempt. */}
              <div className="flex items-center justify-center gap-2 mt-2 text-[11px] text-neutral-500 font-medium">
                <Timer className="w-3.5 h-3.5 text-amber-500" />
                <span>Ordering hours: {hours.opening} – {hours.closing} IST</span>
              </div>

              <button
                onClick={handlePlaceOrder}
                disabled={isProcessing || deliveryBlocked}
                className="flex-1 py-3.5 px-6 rounded-2xl bg-[#e53939] hover:bg-[#d32f2f] text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-500/25 transition cursor-pointer disabled:opacity-50 active:scale-98"
              >
                {isProcessing ? (
                  t('placingOrder')
                ) : deliveryBlocked ? (
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Delivery Unavailable
                  </span>
                ) : paymentMethod === 'online' ? (
                  <span className="flex items-center gap-2">
                    Pay ₹{(() => {
                      const dtCharge = deliveryTypeOptions.find((d) => d.id === deliveryType)?.charge || 0;
                      return Number(totals.grandTotal) + dtCharge + tipAmount;
                    })()}
                    <CreditCard className="w-4 h-4" />
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    {t('placeOrder')}
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Unavailable items warning in checkout */}
        {checkoutUnavailable.length > 0 && (
          <div className="absolute bottom-20 right-4 z-10 max-w-sm bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl p-3 shadow-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Unavailable items detected</span>
                <p className="mt-1">Remove unavailable items from your cart before placing the order.</p>
              </div>
            </div>
          </div>
        )}

        {/* Payment Verification Pending Overlay */}
        {paymentPendingModal && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-md z-30 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
            <div className="w-16 h-16 rounded-full border-4 border-red-100 border-t-[#e53939] animate-spin mb-4"></div>
            <h3 className="text-lg font-black text-neutral-900 mb-1">
              Verifying Payment with Provider
            </h3>
            <p className="text-xs text-neutral-500 max-w-sm leading-relaxed mb-4">
              Please do not close or refresh this window. Paytm is securely processing and verifying your payment. Please do not close this window.
            </p>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#e53939] bg-red-50 px-3 py-1 rounded-full">
              <ShieldCheck className="w-4 h-4" />
              <span>256-Bit Encrypted Secure Channel</span>
            </div>
          </div>
        )}

        {/* Ordering-closed popup. Shown only when the customer actually tries to
            place an order; browsing, cart edits and account views are unaffected. */}
        {orderingClosedModal && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center border border-neutral-200">
              <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <Timer className="w-7 h-7 text-amber-600" />
              </div>
              <h3 className="text-lg font-black text-neutral-900 mb-2">Ordering is currently closed</h3>
              <p className="text-sm text-neutral-600 leading-relaxed mb-1">
                You can place your order between <span className="font-semibold text-neutral-900">{orderingClosedModal.opening}</span> and <span className="font-semibold text-neutral-900">{orderingClosedModal.closing}</span>.
              </p>
              <p className="text-sm text-neutral-600 leading-relaxed mb-5">
                Please come back during our ordering hours. You can still browse the menu and manage your cart.
              </p>
              <button
                onClick={() => setOrderingClosedModal(null)}
                className="w-full py-3 px-4 rounded-xl bg-[#e53939] hover:bg-[#d32f2f] text-white font-black text-sm transition cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
