// Renders each rider screen with real response shapes and asserts it draws.
//
// A passing build only proves the module parses. This proves the screens can
// actually be rendered, including the states that are easy to get wrong: no
// delivery, no history, a failed request, a GPS-gated button the rider is too
// far from, and a rider who has reported no position.
//
// It lives in the Vite root rather than in the temp folder because it contains
// JSX: it is loaded through Vite's own transform, which is the same transform
// the browser gets, so what is rendered here is what the app renders. It is not
// reachable from index.html, so it is not part of the shipped bundle.
//
// Run with: node ../verify_p7_render.mjs

let pass = 0;
const failures = [];
const check = (n, c, x = '') => {
  if (c) pass += 1;
  else failures.push(`${n} ${x}`.trim());
};
const section = (t) => console.log(`\n=== ${t} ===`);

export default async function run({ load, React, renderToString }) {
  const { RiderDashboard } = await load('components/rider/RiderDashboard.jsx');
  const { RiderOrders } = await load('components/rider/RiderOrders.jsx');
  const { RiderDeliveryDetail } = await load('components/rider/RiderDeliveryDetail.jsx');
  const { RiderEarnings } = await load('components/rider/RiderEarnings.jsx');
  const { RiderNotifications } = await load('components/rider/RiderNotifications.jsx');
  const { RiderNav } = await load('components/rider/RiderNav.jsx');
  const { RiderError, RiderLoading, RiderEmpty, ConnectionBanner } = await load('components/rider/RiderStates.jsx');
  const { PRIMARY_ACTION } = await load('lib/riderStages.js');
  const e = React.createElement;

  // Real shapes, as the server actually returns them.
  const order = {
    id: 355, order_number: 'HD-20260927-197', status: 'RIDER_GOING_TO_HOTEL', statusLabel: 'On the way to the hotel',
    order_type: 'delivery', customerName: 'Ada Lovelace', customerPhone: '9222000001',
    address: { address: '12 Residency Road', street: 'Residency Road', landmark: 'Near the lake', city: 'Surat', latitude: 21.6406, longitude: 73.5898, instructions: 'Ring the bell twice' },
    items: [{ name: 'Paneer Tikka', price: 250, quantity: 2 }],
    total_amount: 250, deliveryFee: 30, payment_method: 'cod', paymentStatus: 'pending',
    deliveryDistanceKm: 1.5, eta: { minutes: 6 }, riderToCustomerKm: 1.39, riderToHotelKm: 0.11,
    assignedAt: '2026-09-27 10:00:00', deliveredAt: null, history: [], nextActions: []
  };
  const profile = {
    id: 7, name: 'Meera Desai', mobile: '9876543210', email: 'rider@darshan.com',
    isOnline: true, isAvailable: true, riderState: 'BUSY', activeCount: 1, maxActive: 2,
    currentOrder: null, lastLocation: { lat: 21.6271, lng: 73.5898 }, lastLocationAt: '2026-09-27 10:00:00'
  };
  const dashboard = {
    rider: { id: 7, name: 'Meera Desai', riderState: 'BUSY' },
    activeOrder: order, activeCount: 1,
    today: {
      completedDeliveries: 3, distanceKm: 4.5, distanceSource: 'order_delivery_distance',
      travelDistanceKm: null, travelDistanceUnavailable: 'Only the current rider position is stored.'
    },
    earnings: { amount: null, currency: 'INR', configured: false, reason: 'No rider payout rate is configured, so no earnings figure can be calculated.' }
  };
  const gps = { status: 'TRACKING', accuracy: 12, lastError: null, config: { hotelArrivalMetres: 150, nearCustomerMetres: 250 } };
  const noGps = { status: 'PERMISSION_DENIED', accuracy: null, lastError: { message: 'Location permission denied' }, config: { hotelArrivalMetres: 150, nearCustomerMetres: 250 } };
  const farGps = { ...gps, distanceToHotelKm: 2.4, distanceToCustomerKm: 1.1 };
  const noop = () => {};
  const data = {
    profile, dashboard, active: [order],
    history: { total: 0, limit: 50, offset: 0, orders: [] },
    notifications: { total: 0, unread: 0, notifications: [] },
    loading: false, error: null, connected: true, isOnline: true
  };

  const draw = (name, element) => {
    try {
      const html = renderToString(element);
      // A component that legitimately renders nothing (a hidden banner) is not a
      // failure; only a thrown render is.
      check(name, typeof html === 'string');
      return html;
    } catch (err) {
      check(name, false, err.message);
      return '';
    }
  };

  // ------------------------------------------------------------- dashboard
  section('dashboard');
  let html = draw('dashboard with a delivery', e(RiderDashboard, { data, gps, onOpenDelivery: noop, onRefresh: noop }));
  check('it greets the rider using the server name', html.includes('Meera'));
  check('it shows the real order number', html.includes('HD-20260927-197'));
  check('it shows the real customer', html.includes('Ada Lovelace'));
  check('it offers OPEN DELIVERY', html.includes('OPEN DELIVERY'));
  check('it shows the completed count', html.includes('Completed today'));
  check('it shows GPS active', html.includes('GPS active'));
  check('it does not invent earnings', html.includes('Not set'));
  check('it never prints undefined', !html.includes('undefined'), html.slice(Math.max(0, html.indexOf('undefined') - 60), html.indexOf('undefined') + 30));

  const emptyData = { ...data, active: [], dashboard: { ...dashboard, activeOrder: null } };
  html = draw('dashboard with no delivery', e(RiderDashboard, { data: emptyData, gps, onOpenDelivery: noop, onRefresh: noop }));
  check('it says there is no active delivery', html.includes('No active delivery'));
  check('and that the rider is ready', html.includes('ready to receive orders'));
  check('and offers no OPEN DELIVERY button', !html.includes('OPEN DELIVERY'));

  html = draw('dashboard while offline', e(RiderDashboard, {
    data: { ...data, profile: { ...profile, riderState: 'OFFLINE' }, isOnline: false }, gps, onOpenDelivery: noop, onRefresh: noop
  }));
  check('an offline rider is told exactly what being offline means',
    /won&#x27;t receive new deliveries while offline/.test(html), '');
  check('and is not told to sign in', !/sign in/i.test(html));
  for (const [state, phrase] of [
    ['AVAILABLE', /available for new deliveries/i],
    ['BUSY', /carrying a delivery/i],
    ['ONLINE', /signed in/i]
  ]) {
    const h = draw(`dashboard at ${state}`, e(RiderDashboard, {
      data: { ...data, profile: { ...profile, riderState: state } }, gps, onOpenDelivery: noop, onRefresh: noop
    }));
    check(`the ${state} rider is told what that means`, phrase.test(h));
  }

  html = draw('dashboard with no GPS', e(RiderDashboard, { data, gps: noGps, onOpenDelivery: noop, onRefresh: noop }));
  check('it says the location is unavailable', html.includes('Location unavailable'));
  check('and does not claim GPS is active', !html.includes('GPS active'));
  check('and shows no coordinates at all', !html.includes('21.62') && !html.includes('73.58'));

  // ---------------------------------------------------------------- orders
  section('orders');
  html = draw('orders with an active delivery', e(RiderOrders, { data, onOpenOrder: noop, onRefresh: noop }));
  check('it shows the order number', html.includes('HD-20260927-197'));
  check('it shows the customer', html.includes('Ada Lovelace'));
  check('it shows the address', html.includes('Residency Road'));
  check('it shows the payment method', html.toLowerCase().includes('cod'));
  check('it shows the stage', html.includes('On the way to the hotel'));
  check('it never prints undefined', !html.includes('undefined'));

  html = draw('orders with nothing active', e(RiderOrders, { data: { ...data, active: [] }, onOpenOrder: noop, onRefresh: noop }));
  check('the empty state is the specified one', html.includes('No active delivery') && html.includes('next delivery'));
  check('and no history is shown on the active tab', !html.includes('No completed deliveries yet'));

  const doneOrder = { ...order, status: 'DELIVERED', statusLabel: 'Delivered', paymentStatus: 'paid', deliveredAt: '2026-09-27 11:20:00' };
  html = draw('orders history tab', e(RiderOrders, {
    data: { ...data, active: [], history: { total: 1, orders: [doneOrder] } },
    onOpenOrder: noop, onRefresh: noop, initialTab: 'history'
  }));
  check('the finished delivery is listed', html.includes('HD-20260927-197'));
  check('with its amount', html.includes('250'));
  check('and marked delivered', html.includes('Delivered'));
  check('and its delivered time', html.includes('11:20') || html.includes('27 Sep'), '');
  check('it never prints undefined', !html.includes('undefined'));

  html = draw('orders history with nothing in it', e(RiderOrders, {
    data: { ...data, active: [] }, onOpenOrder: noop, onRefresh: noop, initialTab: 'history'
  }));
  check('the history empty state is the specified one', html.includes('No completed deliveries yet'));

  // --------------------------------------------------------- delivery detail
  section('delivery detail');
  const detail = (o, g) => draw(`detail at ${o.status}`, e(RiderDeliveryDetail, {
    order: o, gps: g, busy: false, onAction: noop, onNavigate: noop, onCollectPayment: noop
  }));

  html = detail(order, gps);
  check('it shows the amount', html.includes('250'));
  check('it shows the payment method', html.toLowerCase().includes('cod'));
  check('it shows the restaurant', html.includes('Hotel Darshan'));
  check('it shows the customer address', html.includes('Residency Road'));
  check('it shows the delivery instructions', html.includes('Ring the bell twice'));
  check('it shows the distance', html.includes('1.5'));
  check('it never prints undefined', !html.includes('undefined'));

  // Each stage offers exactly one button, and it is that stage's.
  for (const [status, spec] of Object.entries(PRIMARY_ACTION)) {
    const h = detail({ ...order, status }, gps);
    check(`the ${status} screen offers ${spec.label}`, h.includes(spec.label));
    const others = Object.entries(PRIMARY_ACTION)
      .filter(([s]) => s !== status).map(([, x]) => x.label);
    const shown = others.filter((l) => h.includes(l));
    check(`and nothing else at ${status}`, shown.length === 0, shown.join(', '));
  }

  html = detail({ ...order, status: 'DELIVERED', paymentStatus: 'paid' }, gps);
  check('a delivered delivery says so', html.includes('Delivery completed'));
  check('and offers no action at all', !html.includes('MARK DELIVERED'));
  html = detail({ ...order, status: 'CANCELLED' }, gps);
  check('a cancelled delivery offers no action', !html.includes('MARK DELIVERED') && !html.includes('GO TO HOTEL'));

  html = draw('arrival claimed from too far', e(RiderDeliveryDetail, { order, gps: farGps, busy: false, onAction: noop, onNavigate: noop }));
  check('the GPS-gated button is disabled', /disabled/.test(html));
  check('and the measured distance is the stated reason', html.includes('2.4'));

  html = detail(order, noGps);
  check('with no position the button is still offered', html.includes('CONFIRM ARRIVAL'));
  check('and the missing position is stated', html.includes('Location unavailable'));

  // -------------------------------------------------------------- earnings
  section('earnings');
  html = draw('earnings with no payout configured', e(RiderEarnings, { data, onRefresh: noop }));
  check('it says earnings are not configured', /not configured/i.test(html));
  check('it shows no zero figure', !html.includes('₹0'));
  check('it states why', html.includes('No rider payout rate is configured'));
  const paid = { ...data, dashboard: { ...dashboard, earnings: { amount: 84.5, currency: 'INR', configured: true, basis: { perDelivery: 25, perKm: 7.5 } } } };
  html = draw('earnings with a payout configured', e(RiderEarnings, { data: paid, onRefresh: noop }));
  check('it shows the real figure', html.includes('84.5'));
  check('and the rates behind it', html.includes('25') && html.includes('7.5'));
  check('it shows the distance it can measure', html.includes('4.5'));

  // --------------------------------------------------------- notifications
  section('notifications');
  const notes = {
    total: 2, unread: 1,
    notifications: [
      { id: 2, orderId: 355, orderNumber: 'HD-20260927-197', type: 'delivery_assigned', title: 'New delivery assigned', message: 'Order HD-20260927-197 for Ada Lovelace is yours.', read: false, createdAt: '2026-09-27 10:00:00' },
      { id: 1, orderId: null, orderNumber: null, type: 'order_ready', title: 'Order ready', message: 'Order HD-1 is prepared.', read: true, createdAt: '2026-09-27 09:00:00' }
    ]
  };
  html = draw('notifications', e(RiderNotifications, {
    data: { ...data, notifications: notes }, onOpenOrder: noop, onMarkRead: noop, onMarkAllRead: noop, onRefresh: noop
  }));
  check('it lists the assignment', html.includes('New delivery assigned'));
  check('with the server wording', html.includes('is yours'));
  check('and the order number', html.includes('HD-20260927-197'));
  check('unread ones can be cleared', html.includes('Mark all read'));
  check('it never prints undefined', !html.includes('undefined'));

  html = draw('no notifications', e(RiderNotifications, { data, onOpenOrder: noop, onMarkRead: noop, onMarkAllRead: noop, onRefresh: noop }));
  check('the empty state is shown', html.includes('No notifications'));
  check('and there is nothing to mark read', !html.includes('Mark all read'));

  // --------------------------------------------------------- states and nav
  section('states and navigation');
  html = draw('a failure', e(RiderError, { error: { isOffline: false, message: 'Order not found' }, onRetry: noop }));
  check('it uses the specified heading', html.includes('Unable to load delivery'));
  check('it offers a retry', html.includes('Retry'));
  check('and shows the server wording', html.includes('Order not found'));
  html = draw('a dead connection', e(RiderError, { error: { isOffline: true, message: 'No connection to the server' }, onRetry: noop }));
  check('it says there is no connection', html.includes('No connection to the server'));
  html = draw('reconnecting', e(ConnectionBanner, { connected: false }));
  check('it says Reconnecting', html.includes('Reconnecting'));
  html = draw('connected', e(ConnectionBanner, { connected: true }));
  check('a connected socket shows no banner', !html.includes('Reconnecting'));
  draw('loading', e(RiderLoading, {}));
  draw('empty', e(RiderEmpty, { title: 'Nothing', body: 'Nothing here' }));

  html = draw('navigation', e(RiderNav, { tab: 'orders', onChange: noop, unread: 3 }));
  for (const label of ['Dashboard', 'Orders', 'Earnings', 'Notifications', 'Profile']) {
    check(`navigation has ${label}`, html.includes(label));
  }
  check('the unread badge is shown', html.includes('3'));
  html = draw('navigation with nothing unread', e(RiderNav, { tab: 'dashboard', onChange: noop, unread: 0 }));
  check('no badge when nothing is unread', !/>3</.test(html));

  return { pass, fail: failures.length, failures };
}
