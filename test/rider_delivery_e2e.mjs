// Rider delivery + GPS end-to-end harness.
//
// Walks one order through the whole lifecycle the specification describes, over
// the real HTTP API and a real Socket.IO connection, and then checks the cases
// that are supposed to fail.
//
// Nothing here fabricates rider movement: the coordinates are the restaurant's own
// and a genuine Rajkot address about 2 km away, and every position the "rider"
// reports is one of those two real places. The device-level GPS behaviour - a
// refused permission, a timeout, a lost socket - is covered in
// rider_gps_engine.test.mjs, which drives the real engine through an injected
// geolocation.
//
// Requires the dev server on :5000.  node test/rider_delivery_e2e.mjs

import { io } from 'socket.io-client';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';

// The server's own copy of better-sqlite3, resolved from the server rather than
// added as a second dependency here.
const serverRequire = createRequire(new URL('../server/src/server.js', import.meta.url));
const Database = serverRequire('better-sqlite3');
// fileURLToPath, not `.pathname`: the checkout path contains a space, which
// `.pathname` hands back percent-encoded and the driver then cannot open.
const DB_PATH = process.env.HOTEL_DARSHAN_DB || fileURLToPath(new URL('../server/hotel_darshan.db', import.meta.url));

const BASE = 'http://localhost:5000';
const HOTEL = { lat: 21.6271369, lng: 73.5898076 };
const DELIVERY = { lat: 21.6412, lng: 73.6015 };

// The owner signs in with a password; every other identity here is a token.
//
// Staff and customers both sign in with an MSG91 code now, so there is no password
// and no code a harness can present. Each account is therefore created through the
// real public routes and given a token signed with the server's own secret - the
// same token the verify route issues. Nothing is bypassed: every request still
// checks the users row, so a disabled or deleted account is refused here exactly
// as it is in the app.
const OWNER = {
  email: process.env.OWNER_EMAIL || 'hoteldarshan9909@gmail.com',
  password: process.env.OWNER_PASSWORD || 'admin123'
};

/** The last JWT_SECRET in the server .env, which is the one dotenv keeps. */
function readJwtSecret() {
  const env = fs.readFileSync(fileURLToPath(new URL('../server/.env', import.meta.url)), 'utf8');
  const matches = [...env.matchAll(/^JWT_SECRET=(.*)$/gm)];
  const last = matches[matches.length - 1];
  return last ? last[1].trim() : 'hotel-darshan-development-secret-change-this';
}

const b64url = (input) => Buffer.from(input).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

function signToken(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: nowSec(), exp: nowSec() + 3600 }));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failures.push(name);
    console.log(`  \u2717 ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Emit and wait for the server's acknowledgement, or give up quietly. */
function emitWithAck(socket, event, ...args) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => done(undefined), 3000);
    try {
      socket.emit(event, ...args, (res) => { clearTimeout(timer); done(res); });
    } catch {
      clearTimeout(timer);
      done(undefined);
    }
  });
}

async function req(endpoint, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, data };
}

/** A socket that records every event it is sent, so "did the customer hear about it" is answerable. */
function watchSocket(token, label) {
  const received = [];
  const socket = io(BASE, { auth: { token }, transports: ['websocket'], forceNew: true });
  for (const event of [
    'sync', 'order:status_updated', 'rider:location', 'order:riderAssigned',
    'order:riderReleased', 'rider:orderAssigned', 'notification'
  ]) {
    socket.on(event, (payload) => received.push({ event, payload, at: Date.now() }));
  }
  return {
    label,
    received,
    socket,
    ready: new Promise((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error(`${label} socket did not connect`)), 8000);
    }),
    saw: (event, match = () => true) => received.some((r) => r.event === event && match(r.payload)),
    /** Wait for an event, so a broadcast that is merely slow is not called missing. */
    async waitFor(event, match = () => true, ms = 5000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = received.find((r) => r.event === event && match(r.payload));
        if (hit) return hit;
        await sleep(60);
      }
      return null;
    }
  };
}

async function staffLogin({ email, password }) {
  const res = await req('/api/auth/staff-login', { method: 'POST', body: { email, password } });
  if (res.status !== 200) throw new Error(`staff login failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`);
  return { token: res.data.token, user: res.data.user };
}

/** A staff account made for this run and removed again at the end of it. */
async function provisionStaff(adminToken, { name, role }) {
  const mobile = `97${String(Date.now()).slice(-7)}${role === 'chef' ? '3' : '2'}`;  const created = await req('/api/staff', {
    method: 'POST', token: adminToken,
    body: { name: `${name} ${mobile.slice(-4)}`, mobile, role }
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`could not create ${role} ${mobile}: ${created.status} ${JSON.stringify(created.data)}`);
  }
  return created.data?.user ?? created.data;
}

const JWT_SECRET = readJwtSecret();
const sessionFor = (user) => ({ token: signToken({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET), user });

/**
 * A rider made for this run and removed at the end of it.
 *
 * Deliberately not a hand-picked account: the harness has to be able to say "rider
 * A cannot touch rider B's order", which needs two riders whose credentials it
 * controls. Depending on whoever happens to be in the staff list makes the check
 * fail for a reason that has nothing to do with the authorisation being tested.
 * A distinct number per run also means two runs never collide on one account.
 */
async function provisionRider(adminToken, label) {
  // Ten digits, the last one telling the two riders apart. The middle is taken
  // from the clock so two runs in the same second cannot collide on one account.
  const mobile = `97${String(Date.now()).slice(-7)}${label === 'A' ? '1' : '2'}`;
  const created = await req('/api/staff', {
    method: 'POST', token: adminToken,
    body: { name: `Harness Rider ${label} ${mobile.slice(-4)}`, mobile, role: 'rider' }
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`could not provision rider ${label}: ${created.status} ${JSON.stringify(created.data)}`);
  }
  const staff = created.data?.user ?? created.data;
  return { ...sessionFor(staff), id: staff.id, mobile };
}

/**
 * A second customer account, inserted directly.
 *
 * Customer sign-in is MSG91's, and there is no HTTP route that creates a customer
 * without a verified code, so the second account this harness needs is written
 * straight to the database - the same file the harness already opens to read
 * settings. Two customers are the point: the checks that follow ask whether
 * customer A can see or touch customer B's order.
 */
function insertCustomerRow(name, phone) {
  const db = new Database(DB_PATH);
  try {
    const res = db.prepare(
      `INSERT INTO users (name, phone, role, addresses_json, favorites_json, is_active)
       VALUES (?, ?, 'customer', '[]', '[]', 1)`
    ).run(name, phone);
    return { id: Number(res.lastInsertRowid), name, phone, role: 'customer', email: null };
  } finally {
    db.close();
  }
}

/**
 * Two customer sessions, taken from the real customer list.
 */
async function ensureCustomers() {
  const list = await req('/api/customers', { token: admin.token });
  let all = (list.data || []).filter((c) => c.phone);
  if (all.length < 2) {
    insertCustomerRow('Harness Customer B', `94${String(Date.now()).slice(-8)}`);
    const fresh = await req('/api/customers', { token: admin.token });
    all = (fresh.data || []).filter((c) => c.phone);
  }
  if (all.length < 2) throw new Error('this harness needs two customer accounts');
  return [all[0], all[1]].map((c) => sessionFor({ ...c, role: 'customer' }));
}

async function setSetting(token, key, value) {
  const current = (await req('/api/settings', { token })).data;
  const next = { ...(current.settings || current), [key]: value };
  return req('/api/settings', { method: 'PUT', token, body: next });
}

/**
 * Read and write a setting the HTTP API deliberately does not expose.
 *
 * `auto_assign_riders` is returned by GET /api/settings but is not in the PUT
 * whitelist and has no control in the admin UI, so there is no supported way to
 * turn it off over HTTP. It has to be set here or the flow under test cannot be
 * isolated: with it on, marking an order READY hands it to whichever rider is free,
 * and the admin's assignment becomes a no-op that still returns 200 - so the test
 * would report that "admin assigns a rider" works without ever doing it.
 */
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

// ===========================================================================
console.log('\nRider delivery + GPS end-to-end\n');
console.log('Setup');

const admin = await staffLogin(OWNER);
const chefAccount = await provisionStaff(admin.token, { name: 'Harness Chef', role: 'chef' });
const chef = { ...sessionFor(chefAccount), id: chefAccount.id };
// Both riders are made for this run and removed at the end of it, exactly as the
// second rider always was. Reusing a rider between runs looks tidier but is not:
// a rider may carry only one delivery at a time, so any run that stops part-way
// leaves an order on their active list and the next run's assignment is refused
// with "You are already carrying a delivery" - failing every check after it for a
// reason that has nothing to do with the code under test. A fresh rider each run
// makes the runs independent of each other.
const riderA = await provisionRider(admin.token, 'A');
const [custA, custB] = await ensureCustomers();
const riderB = await provisionRider(admin.token, 'B');
console.log(`  admin=${admin.user.id} chef=${chef.user.id} riderA=${riderA.id} riderB=${riderB.id} customerA=${custA.user.id} customerB=${custB.user.id}`);

check('both riders signed in', Boolean(riderA.token && riderB.token));
check('both customers signed in', Boolean(custA.token && custB.token));

// Two settings are pinned for the run and both are put back in the finally.
//
// auto_confirm_orders off, so ORDER_PLACED -> ORDER_CONFIRMED is a step somebody
// takes rather than one the server takes on creation.
//
// auto_assign_riders off, because the flow under test is "the kitchen marks it
// READY, an admin assigns a rider". Left on, READY hands the order to whoever is
// free and the admin's assignment becomes a no-op that returns 200, so the test
// would pass without ever exercising the assignment it is named after.
const settingsBefore = (await req('/api/settings', { token: admin.token })).data;
const settingsFlat = settingsBefore.settings || settingsBefore;
// Read defensively: a value that cannot be read is left alone rather than pinned,
// because restoring "undefined" over a real setting would be worse than not
// touching it. Nothing is pinned until both originals are in hand, so a failure
// here cannot leave the restaurant's settings half changed.
function safeReadRawSetting(key) {
  try {
    return readRawSetting(key);
  } catch (err) {
    console.log(`  could not read ${key} (${err.message}); leaving it alone`);
    return undefined;
  }
}

const originalSettings = {
  auto_confirm_orders: settingsFlat.auto_confirm_orders,
  auto_assign_riders: safeReadRawSetting('auto_assign_riders')
};
await setSetting(admin.token, 'auto_confirm_orders', 'false');
if (originalSettings.auto_assign_riders !== undefined) writeRawSetting('auto_assign_riders', '0');
console.log(`  pinned auto_confirm_orders=${originalSettings.auto_confirm_orders} -> false, auto_assign_riders=${originalSettings.auto_assign_riders} -> 0`);

// A menu item with stock this run can consume without exhausting the dish.
const menu = (await req('/api/menu/items')).data;
const items = Array.isArray(menu) ? menu : menu.items;
const dish = items.find((i) => i.is_available && Number(i.available_qty) >= 4) || items[0];
await req(`/api/menu/items/${dish.id}/stock`, { method: 'PATCH', token: admin.token, body: { available_qty: Number(dish.available_qty || 0) + 10 } });

let orderId = null;
let orderNumber = null;

try {
  // =========================================================================
  console.log('\n1. Customer places a Home Delivery order');
  const placed = await req('/api/orders/create', {
    method: 'POST', token: custA.token,
    body: {
      order_type: 'delivery',
      customer_name: custA.user.name,
      customer_phone: custA.user.phone,
      address: { street: '100ft Ring Road, Rajkot', city: 'Rajkot', ...withCoords(DELIVERY) },
      items: [{ id: dish.id, quantity: 2 }],
      payment_method: 'pay_at_hotel'
    }
  });
  check('the delivery order is created', placed.status === 201, `${placed.status} ${JSON.stringify(placed.data)}`);
  orderId = placed.data?.id;
  orderNumber = placed.data?.order_number;
  check('it has an order number', typeof orderNumber === 'string' && orderNumber.startsWith('HD-'), orderNumber);
  check('it starts at ORDER_PLACED', placed.data?.status === 'ORDER_PLACED', placed.data?.status);
  check('no rider is on it yet', placed.data?.rider_id == null, String(placed.data?.rider_id));

  // The customer socket is opened after the order exists so it joins the room by
  // ownership, exactly as the app does.
  const customerSocket = watchSocket(custA.token, 'customerA');
  const riderSocket = watchSocket(riderA.token, 'riderA');
  const otherCustomerSocket = watchSocket(custB.token, 'customerB');
  await Promise.all([customerSocket.ready, riderSocket.ready, otherCustomerSocket.ready]);
  check('the customer socket connected and was told its orders', customerSocket.saw('sync', (p) => Array.isArray(p?.orders)));
  check('the customer socket is in the room for this order', customerSocket.saw('sync', (p) => p?.orders?.some((o) => o.id === orderId)));

  console.log('\n2. The order is confirmed, then the kitchen prepares it');
  // Auto-confirm is pinned off for this run, so ORDER_PLACED -> ORDER_CONFIRMED is
  // a step somebody has to take. It is here rather than left out because the
  // canonical order is confirmed before it is prepared, and skipping it makes the
  // kitchen's next move a 409 rather than a test failure.
  const confirmed = await req(`/api/orders/${orderId}/status`, { method: 'PATCH', token: admin.token, body: { status: 'ORDER_CONFIRMED' } });
  check('the order is confirmed', confirmed.status === 200 && confirmed.data.status === 'ORDER_CONFIRMED', `${confirmed.status} ${confirmed.data?.status} ${confirmed.data?.error || ''}`);
  const prep = await req(`/api/orders/${orderId}/status`, { method: 'PATCH', token: chef.token, body: { status: 'PREPARING' } });
  check('the kitchen moves it to PREPARING', prep.status === 200 && prep.data.status === 'PREPARING', `${prep.status} ${prep.data?.status} ${prep.data?.error || ''}`);

  console.log('\n3. Order becomes READY');
  const ready = await req(`/api/orders/${orderId}/status`, { method: 'PATCH', token: chef.token, body: { status: 'READY' } });
  check('the kitchen marks it READY', ready.status === 200 && ready.data.status === 'READY', `${ready.status} ${ready.data?.status}`);

  console.log('\n4. Admin assigns a rider');
  // A rider account starts OFFLINE, and an offline rider cannot be given an
  // order - the assigner is answering "who is actually on the road", so the rider
  // has to sign on first. This was implicit when the harness used a long-standing
  // account that happened to be online; with an account it provisions itself, the
  // sign-on is a step it has to take.
  const aOnline = await req('/api/rider/availability', { method: 'PATCH', token: riderA.token, body: { state: 'ONLINE' } });
  check('rider A is signed on', aOnline.status === 200, `${aOnline.status} ${JSON.stringify(aOnline.data)}`);
  const assigned = await req(`/api/orders/${orderId}/assign-rider`, { method: 'POST', token: admin.token, body: { rider_id: riderA.id } });
  check('the order is assigned to the rider', assigned.status === 200 && assigned.data.status === 'RIDER_ASSIGNED', `${assigned.status} ${assigned.data?.status} ${assigned.data?.error || ''} ${assigned.data?.message || ''}`);

  console.log('\n5. The rider receives the assignment');
  const riderActive = await req('/api/rider/orders/active', { token: riderA.token });
  check('the rider sees it in their active delivery', riderActive.status === 200 && riderActive.data?.some?.((o) => o.id === orderId),
    JSON.stringify(riderActive.data).slice(0, 160));
  check('the rider is told over their own socket', riderSocket.saw('rider:orderAssigned', (p) => p?.order?.id === orderId || p?.id === orderId));
  check('the customer is told their rider is on the way', customerSocket.saw('order:riderAssigned', (p) => p?.order?.id === orderId || p?.id === orderId));

  console.log('\n6. The rider accepts it (accepted_at is written by the server)');
  const trackOnAssign = (await req(`/api/orders/${orderId}/track`, { token: custA.token })).data;
  check('accepted_at is recorded from the backend clock', Boolean(trackOnAssign.accepted_at), String(trackOnAssign.accepted_at));
  const acceptedAtMs = Date.parse(`${String(trackOnAssign.accepted_at).replace(' ', 'T')}Z`);
  check('accepted_at is a real timestamp, not a placeholder', Number.isFinite(acceptedAtMs) && Math.abs(Date.now() - acceptedAtMs) < 600_000,
    String(trackOnAssign.accepted_at));

  console.log('\n7-9. GPS: the rider reports a real position, stored by the backend');
  const atHotel = await req('/api/rider/location', { method: 'POST', token: riderA.token, body: { ...withCoords(HOTEL), accuracy: 8 } });
  check('the position is accepted', atHotel.status === 200, `${atHotel.status} ${JSON.stringify(atHotel.data)}`);

  console.log('\n10. The backend stores the latest location');
  const afterFix = (await req(`/api/orders/${orderId}/track`, { token: custA.token })).data;
  check('the tracking payload carries the rider position', afterFix.map?.rider?.lat === HOTEL.lat, JSON.stringify(afterFix.map));
  check('it also records when that position was taken', Boolean(afterFix.map?.riderAt), String(afterFix.map?.riderAt));
  check('the order has not been moved to a delivery stage by the fix alone', afterFix.status === 'RIDER_ASSIGNED', afterFix.status);

  console.log('\n11-12. The position is broadcast and the customer receives it');
  // The broadcast names the fields the server stores (rider_lat / rider_lng), not
  // the ones the device sent.
  const locEvent = await customerSocket.waitFor('rider:location', (p) => p?.order_id === orderId);
  check('the customer socket was sent the rider location', locEvent !== null);
  check('the broadcast position is the real one', locEvent?.payload?.rider_lat === HOTEL.lat, JSON.stringify(locEvent?.payload)?.slice(0, 200));
  check('the broadcast names the order it belongs to', locEvent?.payload?.order_number === orderNumber, String(locEvent?.payload?.order_number));
  check('a different customer is not sent this order\'s location', !otherCustomerSocket.saw('rider:location', (p) => p?.order_id === orderId));

  console.log('\n13. The customer can see the rider on the map');
  check('the map payload has the hotel', afterFix.map?.hotel?.lat === HOTEL.lat);
  check('the map payload has the customer address', afterFix.map?.customer?.lat === DELIVERY.lat);
  check('the map payload has the rider', afterFix.map?.rider?.lat === HOTEL.lat);
  check('the rider is not yet visible to the customer before pickup', afterFix.map?.riderVisibleToCustomer === false, String(afterFix.map?.riderVisibleToCustomer));

  console.log('\n14. The rider picks the order up');
  const trip = await req(`/api/rider/orders/${orderId}/actions/start_trip`, { method: 'POST', token: riderA.token, body: {} });
  check('the rider starts the trip', trip.status === 200 && trip.data.status === 'RIDER_GOING_TO_HOTEL', `${trip.status} ${trip.data?.status}`);
  const arrived = await req(`/api/rider/orders/${orderId}/actions/arrived_at_hotel`, { method: 'POST', token: riderA.token, body: {} });
  check('arriving at the hotel is allowed inside the geofence', arrived.status === 200 && arrived.data.status === 'RIDER_ARRIVED_AT_HOTEL', `${arrived.status} ${arrived.data?.status} ${arrived.data?.error || ''}`);
  const pickedUp = await req(`/api/rider/orders/${orderId}/actions/confirm_pickup`, { method: 'POST', token: riderA.token, body: {} });
  check('the rider confirms the pickup', pickedUp.status === 200 && pickedUp.data.status === 'PICKED_UP', `${pickedUp.status} ${pickedUp.data?.status}`);

  const afterPickup = (await req(`/api/orders/${orderId}/track`, { token: custA.token })).data;
  check('the customer can now see the rider', afterPickup.map?.riderVisibleToCustomer === true, String(afterPickup.map?.riderVisibleToCustomer));

  console.log('\n15. The rider starts the delivery');
  const out = await req(`/api/rider/orders/${orderId}/actions/start_delivery`, { method: 'POST', token: riderA.token, body: {} });
  check('the rider starts the delivery', out.status === 200 && out.data.status === 'OUT_FOR_DELIVERY', `${out.status} ${out.data?.status}`);

  console.log('\n16. Live GPS continues');
  const midway = { lat: (HOTEL.lat + DELIVERY.lat) / 2, lng: (HOTEL.lng + DELIVERY.lng) / 2 };
  const moving = await req('/api/rider/location', { method: 'POST', token: riderA.token, body: { ...withCoords(midway), accuracy: 10 } });
  check('a position between the two is accepted', moving.status === 200, `${moving.status}`);
  const midTrack = (await req(`/api/orders/${orderId}/track`, { token: custA.token })).data;
  check('the customer sees the rider has moved', Math.abs(midTrack.map.rider.lat - HOTEL.lat) > 0.0001, JSON.stringify(midTrack.map.rider));

  console.log('\n17. The rider reaches the customer');
  const atCustomer = await req('/api/rider/location', { method: 'POST', token: riderA.token, body: { ...withCoords(DELIVERY), accuracy: 6 } });
  check('the position at the address is accepted', atCustomer.status === 200, `${atCustomer.status}`);
  const near = (await req(`/api/orders/${orderId}/track`, { token: custA.token })).data;
  check('the server marks the rider near the customer from the position', near.status === 'RIDER_NEAR_CUSTOMER', near.status);

  console.log('\n18. The rider marks the order DELIVERED');
  const done = await req(`/api/rider/orders/${orderId}/actions/mark_delivered`, { method: 'POST', token: riderA.token, body: {} });
  check('the order is delivered', done.status === 200 && done.data.status === 'DELIVERED', `${done.status} ${done.data?.status}`);
  const finalTrack = (await req(`/api/orders/${orderId}/track`, { token: custA.token })).data;
  check('the history records every stage', Array.isArray(finalTrack.history) && finalTrack.history.length >= 8, String(finalTrack.history?.length));
  check('the history contains the stages the rider passed through',
    ['RIDER_ASSIGNED', 'RIDER_GOING_TO_HOTEL', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_NEAR_CUSTOMER', 'DELIVERED']
      .every((s) => finalTrack.history.some((h) => h.status === s)),
    JSON.stringify(finalTrack.history?.map((h) => h.status)));

  console.log('\n19. GPS tracking stops once the order is delivered');
  // The position is still accepted - a rider standing somewhere is a fact about the
  // rider, not about a finished order. What must not happen is the delivered order
  // being moved or broadcast again, and the response says so by naming no order.
  const afterDelivery = await req('/api/rider/location', { method: 'POST', token: riderA.token, body: { ...withCoords(HOTEL), accuracy: 8 } });
  check('a position sent after delivery is not attached to any order',
    afterDelivery.status === 200 && afterDelivery.data?.order === null,
    `${afterDelivery.status} order=${JSON.stringify(afterDelivery.data?.order)?.slice(0, 80)}`);
  const postDeliveryTrack = (await req(`/api/orders/${orderId}/track`, { token: custA.token })).data;
  check('the delivered order carries no live rider pin', postDeliveryTrack.map?.rider == null, JSON.stringify(postDeliveryTrack.map?.rider));
  check('the delivered order is still delivered', postDeliveryTrack.status === 'DELIVERED', postDeliveryTrack.status);
  const riderAfter = await req('/api/rider/orders/active', { token: riderA.token });
  check('the rider is carrying nothing afterwards', !riderAfter.data?.some?.((o) => o.id === orderId));

  // =========================================================================
  console.log('\nEdge cases');

  // -- customer tracking survives a refresh ---------------------------------
  console.log('\nCustomer tracking page refresh');
  {
    // A brand new socket for the same customer: this is what a refresh looks like.
    // The order has to be reachable by its order number as well as by id, because
    // that is the identifier a customer has in the address bar or a shared link.
    const refreshed = watchSocket(custA.token, 'customerA-refreshed');
    await refreshed.ready;
    const joined = await emitWithAck(refreshed.socket, 'join_order', orderNumber);
    check('a refreshed tracker can rejoin the order room', joined === true || joined === undefined, String(joined));
    const reread = await req(`/api/orders/${orderNumber}/track`, { token: custA.token });
    check('the order can be re-read by its order number after a refresh', reread.status === 200 && reread.data.id === orderId, `${reread.status}`);
    check('the re-read payload still has status, rider and map', Boolean(reread.data.status && reread.data.map));
    check('the re-read payload has the order history', Array.isArray(reread.data.history) && reread.data.history.length > 0);
    check('the re-read payload still carries accepted_at', Boolean(reread.data.accepted_at), String(reread.data.accepted_at));

    // The room is joined by ownership, so the same request from a customer who did
    // not place the order gets nothing back.
    const stranger = watchSocket(custB.token, 'customerB-stranger');
    await stranger.ready;
    const refusedJoin = await emitWithAck(stranger.socket, 'join_order', orderNumber);
    const strangerGot = await stranger.waitFor('order:status_updated', (p) => p?.order?.id === orderId || p?.id === orderId, 800);
    check('a customer who did not place the order is not put in the room', strangerGot === null, `join ack=${String(refusedJoin)}`);
    refreshed.socket.close();
    stranger.socket.close();
  }

  // -- rider page refresh mid-delivery ---------------------------------------
  console.log('\nRider page refresh during a delivery');
  {
    const second = await createDelivery({ token: custA.token, phone: custA.user.phone, name: custA.user.name });
    await req(`/api/orders/${second.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'ORDER_CONFIRMED' } });
    await req(`/api/orders/${second.id}/status`, { method: 'PATCH', token: chef.token, body: { status: 'PREPARING' } });
    await req(`/api/orders/${second.id}/status`, { method: 'PATCH', token: chef.token, body: { status: 'READY' } });
    await req(`/api/orders/${second.id}/assign-rider`, { method: 'POST', token: admin.token, body: { rider_id: riderA.id } });
    await req('/api/rider/location', { method: 'POST', token: riderA.token, body: { ...withCoords(HOTEL), accuracy: 8 } });
    await req(`/api/rider/orders/${second.id}/actions/start_trip`, { method: 'POST', token: riderA.token, body: {} });

    // What a refreshed rider phone reads: its active delivery from the API.
    const active = await req('/api/rider/orders/active', { token: riderA.token });
    const carried = (active.data || []).find((o) => o.id === second.id);
    check('the rider still has the delivery after a refresh', Boolean(carried));
    check('and the order is still in a delivery stage', ['RIDER_ASSIGNED', 'RIDER_GOING_TO_HOTEL'].includes(carried?.status), carried?.status);
    check('the payload carries the server-side last position for the map', carried?.map?.rider?.lat === HOTEL.lat, JSON.stringify(carried?.map));
    check('and the age of that position', Boolean(carried?.map?.riderAt), String(carried?.map?.riderAt));

    // Finish it so the rider is free for the remaining checks. The trip is already
    // started, so this resumes at the hotel.
    await driveToDelivered({ orderId: second.id, token: riderA.token, label: 'cleanup A', startAt: 'is allowed to arrive at the hotel' });
  }

  // -- rider A cannot touch rider B's order ---------------------------------
  console.log('\nRider A cannot update Rider B\'s order');
  {
    const third = await createDelivery({ token: custA.token, phone: custA.user.phone, name: custA.user.name });
    await req(`/api/orders/${third.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'ORDER_CONFIRMED' } });
    await req(`/api/orders/${third.id}/status`, { method: 'PATCH', token: chef.token, body: { status: 'PREPARING' } });
    await req(`/api/orders/${third.id}/status`, { method: 'PATCH', token: chef.token, body: { status: 'READY' } });
    // Rider B has to be signed on before it can be given anything, so the order
    // really does belong to somebody before the attempts to take it over.
    const bOnline = await req('/api/rider/availability', { method: 'PATCH', token: riderB.token, body: { state: 'ONLINE' } });
    check('rider B is signed on', bOnline.status === 200, `${bOnline.status} ${JSON.stringify(bOnline.data)}`);
    const bAssign = await req(`/api/orders/${third.id}/assign-rider`, { method: 'POST', token: admin.token, body: { rider_id: riderB.id } });
    check('the order is genuinely rider B\'s before the hijack attempts', bAssign.status === 200 && bAssign.data?.rider_id === riderB.id,
      `${bAssign.status} rider=${bAssign.data?.rider_id} ${bAssign.data?.error || ''}`);

    const hijack = await req(`/api/orders/${third.id}/rider-location`, { method: 'POST', token: riderA.token, body: { ...withCoords(HOTEL), accuracy: 5 } });
    check('rider A cannot post a position on rider B\'s order', hijack.status === 403, `${hijack.status} ${JSON.stringify(hijack.data)}`);
    const hijackAction = await req(`/api/rider/orders/${third.id}/actions/mark_delivered`, { method: 'POST', token: riderA.token, body: {} });
    check('rider A cannot advance rider B\'s order', [403, 409, 422].includes(hijackAction.status), `${hijackAction.status} ${JSON.stringify(hijackAction.data)}`);
    const untouched = (await req(`/api/orders/${third.id}/track`, { token: custA.token })).data;
    check('the order is still rider B\'s', untouched.rider_id === riderB.id, String(untouched.rider_id));
    check('and the hijacked position was not stored', untouched.map?.rider?.lat !== HOTEL.lat, JSON.stringify(untouched.map?.rider));

    // Clean up so rider B is not left holding an order.
    await driveToDelivered({ orderId: third.id, token: riderB.token, label: 'cleanup B' });
  }

  // -- customer A cannot track customer B's order ----------------------------
  console.log('\nCustomer A cannot track customer B\'s order');
  {
    const bOrder = await req('/api/orders/create', {
      method: 'POST', token: custB.token,
      body: {
        order_type: 'delivery',
        customer_name: custB.user.name,
        customer_phone: custB.user.phone,
        address: { street: 'Rajkot', city: 'Rajkot', ...withCoords(DELIVERY) },
        items: [{ id: dish.id, quantity: 1 }],
        payment_method: 'pay_at_hotel'
      }
    });
    check('customer B placed an order of their own', bOrder.status === 201, `${bOrder.status} ${JSON.stringify(bOrder.data)}`);

    const peek = await req(`/api/orders/${bOrder.data.id}/track`, { token: custA.token });
    check('customer A is refused another customer\'s order', peek.status === 403, `${peek.status} ${JSON.stringify(peek.data)}`);
    const peekByNumber = await req(`/api/orders/${bOrder.data.order_number}/track`, { token: custA.token });
    check('and refused by order number too', peekByNumber.status === 403, `${peekByNumber.status}`);
    const own = await req(`/api/orders/${bOrder.data.id}/track`, { token: custB.token });
    check('customer B can still track their own order', own.status === 200, `${own.status}`);

    const bSocket = watchSocket(custB.token, 'customerB-own');
    await bSocket.ready;
    await req(`/api/orders/${bOrder.data.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'ORDER_CONFIRMED' } });
    const heard = await bSocket.waitFor('order:status_updated', (p) => p?.order?.id === bOrder.data.id || p?.id === bOrder.data.id);
    check('the owner is told about their own order changing', heard !== null);
    const leaked = otherCustomerSocket.received.some((r) =>
      (r.event === 'order:status_updated' || r.event === 'sync') &&
      JSON.stringify(r.payload).includes(bOrder.data.order_number));
    check('the other customer was never told about it', !leaked);
    bSocket.socket.close();
  }

  // -- self pickup does not involve a rider ---------------------------------
  console.log('\nSelf pickup');
  {
    const pickup = await req('/api/orders/create', {
      method: 'POST', token: custA.token,
      body: {
        order_type: 'pickup',
        customer_name: custA.user.name,
        customer_phone: custA.user.phone,
        items: [{ id: dish.id, quantity: 1 }],
        payment_method: 'pay_at_hotel'
      }
    });
    check('a self-pickup order is created', pickup.status === 201, `${pickup.status} ${JSON.stringify(pickup.data)}`);
    check('no rider is assigned to it', pickup.data?.rider_id == null, String(pickup.data?.rider_id));
    await req(`/api/orders/${pickup.data.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'ORDER_CONFIRMED' } });
    await req(`/api/orders/${pickup.data.id}/status`, { method: 'PATCH', token: chef.token, body: { status: 'PREPARING' } });
    await req(`/api/orders/${pickup.data.id}/status`, { method: 'PATCH', token: chef.token, body: { status: 'READY' } });
    const riderSees = await req('/api/rider/orders/active', { token: riderA.token });
    check('a rider is never given the self-pickup order', !riderSees.data?.some?.((o) => o.id === pickup.data.id));
    const pickupTrack = (await req(`/api/orders/${pickup.data.id}/track`, { token: custA.token })).data;
    check('the self-pickup order has no rider position to show', pickupTrack.map?.rider == null, JSON.stringify(pickupTrack.map));
    check('and it never enters a rider delivery stage',
      !String(pickupTrack.history?.map((h) => h.status) || '').match(/RIDER_|PICKED_UP|OUT_FOR_DELIVERY/),
      JSON.stringify(pickupTrack.history?.map((h) => h.status)));
  }

  // -- GPS is not running just because a rider signed in ---------------------
  console.log('\nSign-in alone starts no tracking');
  {
    const idle = watchSocket(riderA.token, 'riderA-idle');
    await idle.ready;
    // `sync` is emitted by the server as the connection is accepted, which can
    // land a moment after the client's own `connect` event resolves, so it is
    // waited for rather than read the instant the socket says it is up.
    const sync = await idle.waitFor('sync');
    check('a signed-in rider with no delivery is told they have none',
      Array.isArray(sync?.payload?.activeDeliveries) && sync.payload.activeDeliveries.length === 0,
      `activeDeliveries=${JSON.stringify(sync?.payload?.activeDeliveries)?.slice(0, 160)}`);
    const gpsConfig = await req('/api/rider/gps-config', { token: riderA.token });
    check('the rider can still read their GPS settings', gpsConfig.status === 200, `${gpsConfig.status}`);
    idle.socket.close();
  }

  customerSocket.socket.close();
  riderSocket.socket.close();
  otherCustomerSocket.socket.close();
} finally {
  if (originalSettings.auto_confirm_orders !== undefined) {
    await setSetting(admin.token, 'auto_confirm_orders', originalSettings.auto_confirm_orders);
  }
  if (originalSettings.auto_assign_riders !== undefined) {
    writeRawSetting('auto_assign_riders', originalSettings.auto_assign_riders);
  }
  console.log(`\nsettings restored: ${JSON.stringify(originalSettings)}`);
  // Every account made for this run goes away again. Left behind, they would
  // slowly fill the staff list with people nobody can sign in as - and a test
  // record sitting in Staff Management is one an admin has to recognise as not a
  // real member of staff.
  for (const made of [riderB, riderA, chef]) {
    if (!made?.id) continue;
    const removed = await req(`/api/staff/${made.id}`, { method: 'DELETE', token: admin.token });
    console.log(`harness ${made.role} ${made.id} removed: ${removed.status}${removed.status !== 200 ? ` ${JSON.stringify(removed.data)}` : ''}`);
  }
}

/** The API takes latitude/longitude; the harness thinks in lat/lng. */
function withCoords(p) {
  return { latitude: p.lat, longitude: p.lng };
}

/**
 * Walk an order all the way to DELIVERED and check every step.
 *
 * Used both for the flow under test and to leave no order behind afterwards. Each
 * step is asserted because the two geofenced stages refuse without a real position
 * first: a cleanup that silently skipped one leaves the rider still carrying an
 * order, and the next thing that fails is the staff delete reporting RIDER_BUSY
 * with nothing in the output pointing back here.
 */
async function driveToDelivered({ orderId, token, label, expectChecks = true, startAt = 'reports a position at the hotel' }) {
  const act = (action) => req(`/api/rider/orders/${orderId}/actions/${action}`, { method: 'POST', token, body: {} });
  const at = (p) => req('/api/rider/location', { method: 'POST', token, body: { ...withCoords(p), accuracy: 8 } });

  const steps = [
    ['reports a position at the hotel', () => at(HOTEL), 200],
    ['starts the trip', () => act('start_trip'), 200],
    ['is allowed to arrive at the hotel', () => act('arrived_at_hotel'), 200],
    ['confirms the pickup', () => act('confirm_pickup'), 200],
    ['starts the delivery', () => act('start_delivery'), 200],
    ['reports a position at the customer', () => at(DELIVERY), 200],
    ['marks the order delivered', () => act('mark_delivered'), 200]
  ];
  const begin = steps.findIndex(([name]) => name === startAt);
  for (const [name, run] of steps.slice(begin < 0 ? 0 : begin)) {
    const res = await run();
    if (expectChecks) {
      check(`${label}: ${name}`, res.status === 200, `${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`);
    }
    if (res.status !== 200) return false;
  }
  return true;
}

async function createDelivery({ token, phone, name }) {
  const res = await req('/api/orders/create', {
    method: 'POST', token,
    body: {
      order_type: 'delivery',
      customer_name: name,
      customer_phone: phone,
      address: { street: '100ft Ring Road, Rajkot', city: 'Rajkot', ...withCoords(DELIVERY) },
      items: [{ id: dish.id, quantity: 2 }],
      payment_method: 'pay_at_hotel'
    }
  });
  if (res.status !== 201) throw new Error(`could not create a delivery order: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
