import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'http://localhost:5000';
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');

/**
 * The same secret the server signs with, read from its own .env.
 *
 * Staff sign in with an MSG91 code, so there is no password a test can present
 * to become a chef or a rider. The suite signs a token for the accounts it just
 * created with that secret instead, which is the same token the verify route
 * would have issued. It is a test-only convenience and grants nothing: the token
 * is still checked against the users row on every request, so a disabled or
 * deleted account is refused here exactly as it is in the app.
 *
 * The signature is produced with Node's own crypto, so the suite needs nothing
 * installed beyond what it already runs on.
 */
function readJwtSecret() {
  const env = fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8');
  // The LAST occurrence, not the first. The .env lists the key twice, and dotenv
  // keeps the last one, so a suite that read the first would sign with a secret
  // the server does not use and every token it made would come back 401.
  const matches = [...env.matchAll(/^JWT_SECRET=(.*)$/gm)];
  const last = matches[matches.length - 1];
  return last ? last[1].trim() : 'hotel-darshan-development-secret-change-this';
}

const b64url = (input) => Buffer.from(input).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

/** An HS256 JWT, identical in shape to the one jsonwebtoken signs. */
function signToken(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

// The customer is resolved from the real customer list at run time rather than
// hardcoded here: a number typed into a test is a number that goes stale the
// moment somebody registers, deletes or replaces the account behind it.

// Real Rajkot coordinates. The hotel point is the restaurant's own; the delivery
// point is a genuine address ~2 km away, so the 6 km delivery radius is satisfied
// by a real distance rather than by a coordinate invented to pass.
const HOTEL_POINT = { lat: 21.6271369, lng: 73.5898076 };
const DELIVERY_POINT = { lat: 21.6412, lng: 73.6015 };

// The owner's real sign-in. Read from the environment so the suite follows the
// account rather than a copy of its address frozen into the test.
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'hoteldarshan9909@gmail.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'admin123';

// The chef and rider this suite drives.
//
// It used to sign in as chef@darshan.com and rider@darshan.com, accounts that
// were seeded once and then depended on forever: an admin who deleted a staff
// member, or an owner who replaced one, broke the suite for a reason that had
// nothing to do with the code under test. They are created here through the same
// public Add Staff route an admin uses, which also means this suite exercises
// that route.
//
// Both are made for this run and removed at the end of it. A reused account is
// tidier in principle but wrong in practice twice over: a rider keeps an
// unfinished order from a run that stopped early, so the next run's assignment is
// refused with "You are already carrying a delivery"; and a test account left in
// the staff list is a record an admin has to recognise as not a real member of
// staff, which is the same problem the hardcoded credentials used to be.
const PROBE_CHEF = { name: 'E2E Chef', role: 'chef' };

// What this run made, and the auto-assign setting it pinned, held here so the
// failure handler can undo them. A failed run must not leave the restaurant with
// automatic rider assignment switched off, or a test chef in the staff list.
let originalAutoAssign;
let rider;
let chef;

/** A staff account made for this run and removed again at the end of it. */
async function provisionStaff(adminToken, { name, role }) {
  // Ten digits exactly: "90", seven from the clock, and one telling the chef and
  // the rider apart. Two accounts created in the same millisecond would otherwise
  // ask for the same number, and the second would be refused as a duplicate.
  const mobile = `90${String(Date.now()).slice(-7)}${role === 'rider' ? '1' : '2'}`;
  const created = await request('/api/staff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { name: `${name} ${mobile.slice(-4)}`, mobile, role }
  });
  assert(created.status === 201, `Created ${role} account ${name}`);
  return created.data;
}

// The server's own copy of better-sqlite3, resolved from the server rather than
// added as a second dependency here.
const serverRequire = createRequire(new URL('../server/src/server.js', import.meta.url));
const Database = serverRequire('better-sqlite3');
// fileURLToPath, not `.pathname`: the checkout path contains a space, which
// `.pathname` hands back percent-encoded and the driver then cannot open.
const DB_PATH = fileURLToPath(new URL('../server/hotel_darshan.db', import.meta.url));

function readRawSetting(key) {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  } finally {
    db.close();
  }
}

function writeRawSetting(key, value) {
  const db = new Database(DB_PATH);
  try {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  } finally {
    db.close();
  }
}

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = res.headers.get('content-type');
  let data;
  if (contentType && contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, ok: res.ok, data };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('   HOTEL DARSHAN PLATFORM END-TO-END VERIFICATION     ');
  console.log('======================================================\n');

  // Test 1: Health check
  console.log('Test 1: Health Check Endpoint');
  const health = await request('/api/health');
  assert(health.status === 200, 'Server responds with status 200');
  assert(health.data.restaurant === 'Hotel Darshan', 'Reports restaurant as Hotel Darshan');

  // Test 2: Auth Login
  console.log('\nTest 2: Authentication & Roles');
  const adminLogin = await request('/api/auth/staff-login', {
    method: 'POST',
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD }
  });
  assert(adminLogin.status === 200, 'Admin login succeeded');
  assert(adminLogin.data.user.role === 'admin', 'User has admin role');
  const adminToken = adminLogin.data.token;
  const secret = readJwtSecret();

  // The customer this suite places orders as.
  //
  // It cannot sign in with a code: customer codes are issued and verified by
  // MSG91 in the browser, so there is nothing a test can present to become a
  // customer. It used to rely on a development OTP this server no longer returns.
  // The account is therefore looked up from the real customer list and given a
  // token signed with the server's own secret - the same token the verify route
  // issues. Nothing is bypassed: the token is checked against the users row on
  // every request, and only an account that is really a customer is accepted.
  const customers = await request('/api/customers', { headers: { Authorization: `Bearer ${adminToken}` } });
  const customer = (customers.data || []).find((c) => c.phone);
  assert(Boolean(customer), 'A customer account exists to order as');
  const customerToken = signToken(
    { id: customer.id, email: customer.email, role: 'customer', name: customer.name, iat: now(), exp: now() + 3600 },
    secret
  );
  const CUSTOMER_PHONE = customer.phone;
  assert(Boolean(CUSTOMER_PHONE), 'Customer has a mobile number on file');

  chef = await provisionStaff(adminToken, PROBE_CHEF);
  rider = await provisionStaff(adminToken, { name: 'E2E Rider', role: 'rider' });
  const sign = (u) => signToken(
    { id: u.id, email: u.email, role: u.role, name: u.name, iat: now(), exp: now() + 3600 },
    secret
  );
  const chefToken = sign(chef);
  const riderToken = sign(rider);
  const riderUserId = rider.id;
  assert(chef.role === 'chef', 'Chef account is a chef');
  assert(rider.role === 'rider', 'Rider account is a rider');

  // The rider is given nothing until the admin assigns them, which is the flow
  // under test in Test 8.
  //
  // That needs auto-assignment off. It is a setting the HTTP API deliberately does
  // not expose for writing - there is no control for it in the admin UI - so it is
  // read and written straight in the database, the same way rider_delivery_e2e.mjs
  // does it, and put back in the finally below. With it on, a rider who signs on
  // is handed whatever READY order is oldest, and the admin's assignment is then
  // refused with "You are already carrying a delivery" - so the suite would report
  // that assignment works without ever performing it.
  //
  // Held at module scope so the failure handler can put it back too.
  originalAutoAssign = readRawSetting('auto_assign_riders');
  writeRawSetting('auto_assign_riders', 0);
  console.log(`  pinned auto_assign_riders=${originalAutoAssign} -> 0`);

  // Test 3: Categories & Menu Multilingual
  console.log('\nTest 3: Multilingual Categories & Menu');
  const categoriesRes = await request('/api/menu/categories');
  assert(categoriesRes.status === 200, 'Categories endpoint returns 200');
  assert(categoriesRes.data.length >= 7, `Found ${categoriesRes.data.length} categories`);
  const firstCat = categoriesRes.data[0];
  assert(Boolean(firstCat.name_en && firstCat.name_hi && firstCat.name_gu), 'Categories contain EN, HI, GU names');

  const itemsRes = await request('/api/menu/items');
  assert(itemsRes.status === 200, 'Menu items endpoint returns 200');
  assert(itemsRes.data.length >= 10, `Found ${itemsRes.data.length} menu items`);
  const firstItem = itemsRes.data[0];
  assert(Boolean(firstItem.name_en && firstItem.name_hi && firstItem.name_gu), 'Dishes contain EN, HI, GU names');
  assert(Boolean(firstItem.desc_en && firstItem.desc_hi && firstItem.desc_gu), 'Dishes contain EN, HI, GU descriptions');

  // Test 4: 1-Tap Availability Toggle
  console.log('\nTest 4: Real-Time Availability Toggle');
  const toggleRes = await request(`/api/menu/items/${firstItem.id}/availability`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { is_available: 0 }
  });
  assert(toggleRes.status === 200, 'Toggled item availability to unavailable (🔴)');
  assert(toggleRes.data.is_available === 0, 'Item is now unavailable');

  // Toggle back to available (🟢)
  await request(`/api/menu/items/${firstItem.id}/availability`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { is_available: 1 }
  });
  console.log('  ✓ Toggled item back to available (🟢)');

  // Test 5: Coupon Validation
  console.log('\nTest 5: Coupon Rules & Validation');
  const validCoupon = await request('/api/coupons/validate', {
    method: 'POST',
    body: { code: 'DARSHAN50', cartTotal: 300 }
  });
  assert(validCoupon.status === 200, 'Coupon DARSHAN50 validated successfully');
  assert(validCoupon.data.coupon.discount_amount === 100, 'Max discount capped at ₹100');

  const minOrderFailed = await request('/api/coupons/validate', {
    method: 'POST',
    body: { code: 'DARSHAN50', cartTotal: 100 }
  });
  assert(minOrderFailed.status === 400, 'Rejects coupon below minimum order value');

  // Test 6: Order Placement (Delivery & Pickup)
  console.log('\nTest 6: Order Creation & Server-Side Pricing Verification');
  // DARSHAN50 only applies above its minimum order value, so the quantity is
  // derived from the item's own price rather than fixed. A fixed small quantity
  // silently produced discount_amount 0 and failed the discount assertion for a
  // reason that had nothing to do with pricing being wrong. The effective price is
  // discount_price where one is set, because that is the figure the server bills.
  const COUPON_MIN = 199;
  const stock = (i) => Number(i.available_qty);
  const unit = (i) => Number(i.discount_price || i.price || 0);

  // Order from an item that can actually supply the quantity the coupon needs.
  // Ordering 14 of the cheapest dish to reach the minimum runs the real stock out,
  // so the next run of the suite fails for a reason that has nothing to do with
  // pricing either.
  const sellable = itemsRes.data
    .filter((i) => i.is_available && unit(i) > 0)
    .sort((a, b) => unit(b) - unit(a)); // priciest first => smallest quantity needed
  let couponItem = sellable[0] || firstItem;
  let couponQuantity = Math.max(2, Math.ceil((COUPON_MIN + 1) / Math.max(unit(couponItem), 1)));
  for (const candidate of sellable) {
    const q = Math.max(2, Math.ceil((COUPON_MIN + 1) / unit(candidate)));
    if (stock(candidate) >= q) { couponItem = candidate; couponQuantity = q; break; }
  }

  // This suite creates real orders against the real database, so stock it needs is
  // topped up first. Without that the suite can only be run once.
  await request(`/api/menu/items/${couponItem.id}/stock`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { available_qty: couponQuantity + 20 }
  });

  const orderRes = await request('/api/orders/create', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: {
      order_type: 'delivery',
      customer_name: 'Megha Vasava',
      customer_phone: '+91 99240 88990',
      address: {
        street: 'B-204, Shivalik Residency, 150ft Ring Road',
        landmark: 'Near Big Bazaar',
        city: 'Rajkot',
        // A delivery order is only priced when the distance to the address can be
        // resolved. The server refuses with UNRESOLVED_DELIVERY_DISTANCE rather than
        // inventing a fee, so a valid order has to carry real coordinates.
        latitude: 21.6271369,
        longitude: 73.5898076
      },
      items: [
        {
          id: couponItem.id,
          quantity: couponQuantity,
          selectedCustomizations: [
            { id: 'extra_cheese', name_en: 'Extra Cheese', price: 35 }
          ]
        }
      ],
      coupon_code: 'DARSHAN50',
      payment_method: 'online'
    }
  });
  assert(orderRes.status === 201, 'Delivery order created successfully');
  const order = orderRes.data;
  assert(order.order_number.startsWith('HD-'), `Generated unique order number: ${order.order_number}`);
  assert(order.payment_status === 'pending', 'Initial online payment status is pending');
  assert(order.discount_amount > 0, `Applied discount: ₹${order.discount_amount}`);
  assert(order.tax_amount > 0, `Applied 5% GST tax: ₹${order.tax_amount}`);

  // Test 7: Payment Gateway State
  console.log('\nTest 7: Payment Gateway (Paytm) & Razorpay Removal');
  // This platform settles through Paytm and verifies server-side, so the Razorpay
  // endpoints are retired on purpose and answer 410 rather than 404 - a client that
  // still calls them gets a reason, not a dead end. There is no offline way to
  // "verify" a Paytm payment: /paytm/status asks Paytm's real API and needs real
  // credentials, so the lifecycle below is driven with pay-at-hotel instead of
  // pretending a payment happened.
  for (const [ep, label] of [
    ['/api/payment/create-razorpay-order', 'create-razorpay-order'],
    ['/api/payment/verify', 'verify']
  ]) {
    const gone = await request(ep, { method: 'POST', body: { order_id: order.id } });
    assert(gone.status === 410, `Retired Razorpay endpoint ${label} answers 410 Gone`);
  }
  const paytmNoKeys = await request('/api/payment/paytm/create', { method: 'POST', body: { order_id: order.id } });
  assert(paytmNoKeys.status === 500 && /not configured/i.test(paytmNoKeys.data.error || ''),
    'Paytm checkout refuses cleanly when merchant keys are absent');

  // Test 8: Order Lifecycle & Rider Assignment
  console.log('\nTest 8: Order Lifecycle & Rider Assignment');
  // The lifecycle needs ORDER_PLACED -> ORDER_CONFIRMED to be a real step under
  // test, so auto-confirm is pinned off for this run and restored afterwards.
  const settingsRes = await request('/api/settings', { headers: { Authorization: `Bearer ${adminToken}` } });
  const settingsBody = settingsRes.data.settings || settingsRes.data;
  const originalAutoConfirm = settingsBody.auto_confirm_orders;
  await request('/api/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { ...settingsBody, auto_confirm_orders: 'false' }
  });
  // Declared out here because the review below reads it, and the block it is built
  // in is a try/finally whose own scope does not reach past the closing brace.
  let live = null;
  try {
    // A pay-at-hotel order needs no gateway, which is what makes the delivery stages
    // reachable in a test at all.
    const lifecycleItem = itemsRes.data.find((i) => Number(i.available_qty) >= 2) || firstItem;
    const lifecycleRes = await request('/api/orders/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: {
        order_type: 'delivery',
        customer_name: 'Megha Vasava',
        customer_phone: CUSTOMER_PHONE,
        address: {
          street: '100ft Ring Road',
          city: 'Rajkot',
          latitude: DELIVERY_POINT.lat,
          longitude: DELIVERY_POINT.lng
        },
        items: [{ id: lifecycleItem.id, quantity: 2 }],
        payment_method: 'pay_at_hotel'
      }
    });
    assert(lifecycleRes.status === 201, 'Pay-at-hotel delivery order created for the lifecycle');
    live = lifecycleRes.data;

    const confirmRes = await request(`/api/orders/${live.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'ORDER_CONFIRMED' }
    });
    assert(confirmRes.status === 200, 'Admin confirmed the order with auto-confirm off');

    const prepRes = await request(`/api/orders/${live.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${chefToken}` },
      body: { status: 'PREPARING' }
    });
    assert(prepRes.status === 200, 'Kitchen transitioned order to PREPARING');

    const readyRes = await request(`/api/orders/${live.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${chefToken}` },
      body: { status: 'READY' }
    });
    assert(readyRes.status === 200, 'Kitchen marked order as READY');

    const onlineRes = await request('/api/rider/availability', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${riderToken}` },
      body: { state: 'ONLINE' }
    });
    assert(onlineRes.status === 200, 'Rider signed on as ONLINE');

    const assignRes = await request(`/api/orders/${live.id}/assign-rider`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { rider_id: riderUserId }
    });
    assert(assignRes.status === 200, 'Rider assigned to the order');
    assert(assignRes.data.status === 'RIDER_ASSIGNED', 'Order entered RIDER_ASSIGNED');

    // Test 9: Delivery Rider Workflow (canonical stage chain)
    console.log('\nTest 9: Delivery Rider Route & Delivery Completion');
    // The two geofenced stages are derived from where the rider actually is, so the
    // rider's real position is reported first rather than the status being asserted
    // directly - the server refuses to let a client name RIDER_NEAR_CUSTOMER.
    const atHotel = await request('/api/rider/location', {
      method: 'POST',
      headers: { Authorization: `Bearer ${riderToken}` },
      body: { latitude: HOTEL_POINT.lat, longitude: HOTEL_POINT.lng, accuracy: 8 }
    });
    assert(atHotel.status === 200, 'Rider reported a position at the hotel');

    const riderAction = async (action) =>
      request(`/api/rider/orders/${live.id}/actions/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${riderToken}` },
        body: {}
      });

    for (const [action, expect] of [
      ['start_trip', 'RIDER_GOING_TO_HOTEL'],
      ['arrived_at_hotel', 'RIDER_ARRIVED_AT_HOTEL'],
      ['confirm_pickup', 'PICKED_UP'],
      ['start_delivery', 'OUT_FOR_DELIVERY']
    ]) {
      const res = await riderAction(action);
      assert(res.status === 200 && res.data.status === expect, `Rider action ${action} -> ${expect}`);
    }

    // Moving onto the customer is what advances this stage; the server, not the
    // phone, decides the rider is near.
    const atCustomer = await request('/api/rider/location', {
      method: 'POST',
      headers: { Authorization: `Bearer ${riderToken}` },
      body: { latitude: DELIVERY_POINT.lat, longitude: DELIVERY_POINT.lng, accuracy: 8 }
    });
    assert(atCustomer.status === 200, 'Rider reported a position at the customer');
    const nearRes = await request(`/api/orders/${live.id}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(nearRes.data.status === 'RIDER_NEAR_CUSTOMER',
      'Server derived RIDER_NEAR_CUSTOMER from the rider position');

    const delivRes = await riderAction('mark_delivered');
    assert(delivRes.status === 200, 'Rider marked order as DELIVERED');

    const collectedRes = await request(`/api/rider/orders/${live.id}/payment-collected`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${riderToken}` },
      body: { method: 'cash' }
    });
    assert(collectedRes.status === 200, 'Rider collected payment at the door');
    assert(collectedRes.data.paymentStatus === 'paid', 'Pay-at-hotel order is settled as paid');
    assert(collectedRes.data.order.payment_status === 'paid', 'Order row records the payment as paid');

    const trackRes = await request(`/api/orders/${live.id}/track`, { headers: { Authorization: `Bearer ${customerToken}` } });
    assert(trackRes.status === 200, 'Customer can read the finished order');
    assert(Boolean(trackRes.data.accepted_at), `Rider acceptance recorded at ${trackRes.data.accepted_at}`);
  } finally {
    // Put the restaurant's own setting back even when an assertion above threw.
    // Without this a failed run leaves the live restaurant auto-confirming orders
    // that the next run then believes is the original setting.
    await request('/api/settings', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { ...settingsBody, auto_confirm_orders: originalAutoConfirm }
    });
  }

  // Test 10: Customer Review Submission
  console.log('\nTest 10: Customer 5-Star Rating & Review');
  const reviewRes = await request(`/api/orders/${live.id}/review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: {
      rating: 5,
      comment: 'Super delicious and steaming hot authentic Gujarati food! Fast delivery.'
    }
  });
  assert(reviewRes.status === 201, 'Review submitted successfully with 5 stars');

  // Test 11: Analytics Verification
  console.log('\nTest 11: Restaurant Analytics Calculation');
  const analyticsRes = await request('/api/analytics', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(analyticsRes.status === 200, 'Analytics fetched');
  assert(analyticsRes.data.today_sales > 0, `Recorded today sales: ₹${analyticsRes.data.today_sales}`);
  assert(analyticsRes.data.completed_orders > 0, `Recorded completed orders: ${analyticsRes.data.completed_orders}`);

  // Test 12: Concurrency & Inventory Double-Booking Prevention
  console.log('\nTest 12: High Order Volume & Stock Concurrency (Simulating 10 simultaneous orders on limited stock)');
  // Create a limited stock item: 5 units
  const testDishRes = await request('/api/menu/items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      category_id: 1,
      name_en: 'Limited Special Sweet Box',
      name_hi: 'लिमिटेड स्वीट बॉक्स',
      name_gu: 'લિમિટેડ સ્વીટ બોક્સ',
      price: 150,
      available_qty: 5,
      is_available: 1
    }
  });
  const limitedItemId = testDishRes.data.id;

  // 10 concurrent customer order promises requesting 1 unit each
  const orderPromises = Array.from({ length: 10 }).map((_, i) => {
    return request('/api/orders/create', {
      method: 'POST',
      body: {
        order_type: 'pickup',
        customer_name: `Concurrent User ${i + 1}`,
        customer_phone: `+91 98000 0000${i}`,
        items: [{ id: limitedItemId, quantity: 1 }],
        payment_method: 'pay_at_hotel'
      }
    });
  });

  const concurrentResults = await Promise.all(orderPromises);
  const successfulOrders = concurrentResults.filter(r => r.status === 201);
  const rejectedOrders = concurrentResults.filter(r => r.status === 400);

  console.log(`  Concurrent Results: ${successfulOrders.length} succeeded, ${rejectedOrders.length} rejected when stock was exhausted.`);
  assert(successfulOrders.length === 5, 'Exactly 5 orders succeeded matching initial stock of 5');
  assert(rejectedOrders.length === 5, 'Remaining 5 orders safely rejected with unavailable message');

  // Check that item is now automatically marked unavailable
  const checkItemRes = await request(`/api/menu/items/${limitedItemId}`);
  assert(checkItemRes.data.available_qty === 0, 'Available stock reached 0');
  assert(checkItemRes.data.is_available === 0, 'Item automatically transitioned to Currently Unavailable (🔴)');

  // Put the pinned setting back, then remove the rider made for this run. Both
  // happen on the way out of a passing run AND on the way out of a failing one:
  // leaving auto-assignment off would change how the restaurant behaves, and
  // leaving the rider behind would hold an order nothing will ever finish.
  if (originalAutoAssign !== undefined) {
    writeRawSetting('auto_assign_riders', originalAutoAssign);
    console.log(`\n  auto_assign_riders restored to ${originalAutoAssign}`);
  }
  for (const made of [rider, chef]) {
    if (!made?.id) continue;
    const removed = await request(`/api/staff/${made.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } });
    console.log(`  E2E ${made.role} removed: ${removed.status}`);
  }

  console.log('\n======================================================');
  console.log('   ALL 12 TESTS PASSED PERFECTLY!                    ');
  console.log('   HOTEL DARSHAN SYSTEM IS PRODUCTION-READY!          ');
  console.log('======================================================\n');
}

// A failed run must put the pinned setting back too, or the restaurant is left
// with automatic rider assignment switched off.
runTests()
  .catch(async (err) => {
    console.error('\nVerification failed:', err);
    try {
      if (originalAutoAssign !== undefined) writeRawSetting('auto_assign_riders', originalAutoAssign);
    } catch { /* the assertion is what matters; report that first */ }
    process.exit(1);
  });
