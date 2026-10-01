// GPS engine harness.
//
// These cases are about what the rider's phone does, so they are driven through
// the engine's injected `geolocation` rather than through HTTP. That is a test
// double for the *device*, not invented data in the product: every coordinate the
// engine is given here is a real Rajkot point, and the engine's own rule - a
// position is either a real fix or it is absent - is what is under test.
//
// Run with the dev server up:  node test/rider_gps_engine.test.mjs

import { RiderGpsEngine, GPS_TRACKING, GPS_WEAK, GPS_UNAVAILABLE, GPS_DENIED, GPS_IDLE } from '../client/src/lib/riderGpsEngine.js';

// Real Rajkot coordinates. The hotel is the restaurant's own; the customer point is
// a genuine address about 2 km away.
const HOTEL = { lat: 21.6271369, lng: 73.5898076 };
const CUSTOMER = { lat: 21.6412, lng: 73.6015 };

const CONFIG = {
  hotel: HOTEL,
  hotelArrivalMetres: 150,
  nearCustomerMetres: 400,
  maxAcceptableAccuracyMetres: 100,
  maxFixAgeSeconds: 60,
  sendIntervalSeconds: 15,
  resendAfterMetres: 40
};

const ORDER = {
  id: 1,
  status: 'RIDER_ASSIGNED',
  order_type: 'delivery',
  address: { latitude: CUSTOMER.lat, longitude: CUSTOMER.lng },
  map: { hotel: HOTEL, customer: { lat: CUSTOMER.lat, lng: CUSTOMER.lng } }
};

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

/** Let the transport promises settle, so `transport` can be read. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * How many *positions* went out.
 *
 * Counted separately from the "tracking is blind" notice, because the two travel
 * the same socket event stream and conflating them hides the fact that a rider
 * with no permission still correctly tells the customer they are not being
 * tracked - which is the opposite of the failure these checks are looking for.
 */
const positionSends = (sent) =>
  sent.socket.filter((s) => s.type === 'rider:location_update').length +
  sent.http.filter((p) => !p.__unavailable).length;

const blindNotices = (sent) =>
  sent.socket.filter((s) => s.type === 'rider:location_unavailable').length +
  sent.http.filter((p) => p.__unavailable).length;

/**
 * A stand-in for `navigator.geolocation` whose answers the test controls, so
 * permission, timeout and weak-signal paths can each be produced on demand.
 */
function fakeGeolocation() {
  const api = {
    watchId: null,
    onSuccess: null,
    onError: null,
    cleared: 0,
    started: 0,
    watchPosition(success, error) {
      api.started += 1;
      api.watchId = api.started;
      api.onSuccess = success;
      api.onError = error;
      return api.watchId;
    },
    clearWatch(id) {
      api.cleared += 1;
      api.onSuccess = null;
      api.onError = null;
      api.watchId = null;
      void id;
    },
    /** Deliver a good fix. */
    fix({ lat, lng, accuracy = 8, ageSeconds = 0 } = {}) {
      api.onSuccess?.({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.now() - ageSeconds * 1000 });
    },
    /** Deliver a fix the device could not get. `code` is the real GeolocationError code. */
    fail(code) {
      api.onError?.({ code, message: `simulated geolocation error ${code}` });
    }
  };
  return api;
}

function build({ socketConnected = true, order = ORDER, online = true } = {}) {
  const geo = fakeGeolocation();
  const sent = { socket: [], http: [] };
  let clock = Date.now();
  const engine = new RiderGpsEngine({
    geolocation: geo,
    now: () => clock,
    isSocketConnected: () => socketConnected,
    sendSocket: ({ type, payload }) => { sent.socket.push({ type, payload }); return Promise.resolve({ ok: true }); },
    sendHttp: (payload) => { sent.http.push(payload); return Promise.resolve({ ok: true }); }
  });
  return {
    engine,
    geo,
    sent,
    tick: (ms) => { clock += ms; },
    setSocket: (v) => { socketConnected = v; },
    configure: (over = {}) => engine.configure({ enabled: online, orderId: order?.id ?? null, order, config: CONFIG, pickedUp: false, ...over })
  };
}

// ---------------------------------------------------------------------------
console.log('\nRider GPS engine\n');

// --- GPS does not run merely because the rider signed in (spec item 3) -------
console.log('Permission is requested on taking a delivery, not on sign-in');
{
  const h = build();
  h.engine.configure({ enabled: false, orderId: null, order: null, config: CONFIG });
  check('a signed-in rider with no delivery never opens a watch', h.geo.started === 0, `started=${h.geo.started}`);
  check('engine reports idle', h.engine.snapshot.status === GPS_IDLE, h.engine.snapshot.status);
}
{
  const h = build({ online: false });
  h.configure();
  check('an offline rider never opens a watch', h.geo.started === 0, `started=${h.geo.started}`);
  check('no position is sent while offline', h.sent.socket.length === 0 && h.sent.http.length === 0);
}
{
  const h = build();
  h.configure(); // online, holding RIDER_ASSIGNED
  check('accepting a delivery opens the watch that triggers the browser prompt', h.geo.started === 1, `started=${h.geo.started}`);
}

// --- permission granted ------------------------------------------------------
console.log('\nPermission granted');
{
  const h = build();
  h.configure();
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng });
  check('a good fix reports TRACKING', h.engine.snapshot.status === GPS_TRACKING, h.engine.snapshot.status);
  check('the fix is sent to the backend', h.sent.socket.length === 1, `sent=${h.sent.socket.length}`);
  check('the position sent is the real fix, unaltered', h.sent.socket[0]?.payload?.latitude === HOTEL.lat);
  check('a last known position is recorded with its age', typeof h.engine.snapshot.lastKnown?.at === 'number');
  check('the rider is inside the hotel geofence', h.engine.snapshot.atHotel === true);
}

// --- permission denied -------------------------------------------------------
console.log('\nPermission denied');
{
  const h = build();
  h.configure();
  h.geo.fail(1); // PERMISSION_DENIED
  check('a refused permission is reported as PERMISSION_DENIED', h.engine.snapshot.status === GPS_DENIED, h.engine.snapshot.status);
  check('no position is sent when permission is refused', positionSends(h.sent) === 0, `positions=${positionSends(h.sent)}`);
  check('the customer is told tracking is blind', blindNotices(h.sent) > 0, `notices=${blindNotices(h.sent)}`);
  check('the reason names the permission, not a network fault', /permission/i.test(h.engine.snapshot.lastError?.message || ''), h.engine.snapshot.lastError?.message);

  // Try Again must re-arm the watch; that is what re-prompts the browser.
  const before = h.geo.started;
  h.engine.retry();
  check('Try Again re-arms the watch', h.geo.started === before + 1, `started ${before} -> ${h.geo.started}`);
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng });
  check('granting permission afterwards recovers to TRACKING', h.engine.snapshot.status === GPS_TRACKING, h.engine.snapshot.status);
}
{
  // Try Again before accepting anything must not start tracking somebody for no
  // reason.
  const h = build();
  h.engine.configure({ enabled: false, orderId: null, order: null, config: CONFIG });
  h.engine.retry();
  check('Try Again with no delivery opens no watch', h.geo.started === 0, `started=${h.geo.started}`);
}

// --- GPS unavailable (timeout / position unavailable) ------------------------
console.log('\nGPS temporarily unavailable');
{
  const h = build();
  h.configure();
  h.geo.fail(3); // TIMEOUT
  check('a timeout is reported as UNAVAILABLE, not WEAK', h.engine.snapshot.status === GPS_UNAVAILABLE, h.engine.snapshot.status);
  h.geo.fail(2); // POSITION_UNAVAILABLE
  check('a momentary loss stays UNAVAILABLE', h.engine.snapshot.status === GPS_UNAVAILABLE, h.engine.snapshot.status);
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng });
  check('it recovers on its own once a fix arrives', h.engine.snapshot.status === GPS_TRACKING, h.engine.snapshot.status);
}

// --- GPS weak (available but inaccurate) -------------------------------------
console.log('\nGPS weak');
{
  const h = build();
  h.configure();
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng, accuracy: 400 });
  check('a poor reading is WEAK, not UNAVAILABLE', h.engine.snapshot.status === GPS_WEAK, h.engine.snapshot.status);
  check('an imprecise fix is never sent to the backend', positionSends(h.sent) === 0, `positions=${positionSends(h.sent)}`);
  check('an imprecise fix is not offered as the current position', h.engine.snapshot.point === null);
  check('an imprecise fix is not remembered as a last known position', h.engine.snapshot.lastKnown === null, JSON.stringify(h.engine.snapshot.lastKnown));
  check('the rider is told how coarse the reading is', /accurate to/i.test(h.engine.snapshot.lastError?.message || ''), h.engine.snapshot.lastError?.message);
}
{
  const h = build();
  h.configure();
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng, accuracy: 20 });
  check('a good reading is TRACKING, never WEAK', h.engine.snapshot.status === GPS_TRACKING, h.engine.snapshot.status);
}
{
  const h = build();
  h.configure();
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng, ageSeconds: 300 }); // fix is 5 minutes old
  check('a stale fix is UNAVAILABLE, not reported as a live position', h.engine.snapshot.status === GPS_UNAVAILABLE, h.engine.snapshot.status);
}

// --- LAST LOCATION ----------------------------------------------------------
console.log('\nLast known position');
{
  // A phone that refreshes mid-delivery: no fix has arrived yet, but the server
  // is holding where the rider was.
  const serverAt = new Date(Date.now() - 42_000).toISOString().slice(0, 19).replace('T', ' ');
  const order = { ...ORDER, map: { ...ORDER.map, rider: { lat: HOTEL.lat, lng: HOTEL.lng }, riderAt: serverAt } };
  const h = build({ order });
  h.configure();
  check('the server position is adopted so the rider sees where they were', h.engine.snapshot.lastKnown !== null);
  check('it is labelled as coming from the server', h.engine.snapshot.lastKnown?.source === 'server', h.engine.snapshot.lastKnown?.source);
  check('it is about 42 seconds old', Math.abs((Date.now() - h.engine.snapshot.lastKnown.at) / 1000 - 42) < 2, String((Date.now() - h.engine.snapshot.lastKnown?.at) / 1000));
  check('it is NOT treated as a current fix', h.engine.snapshot.point === null);
  check('it is not re-sent as a position', h.sent.socket.length === 0 && h.sent.http.length === 0);
  h.geo.fix({ lat: CUSTOMER.lat, lng: CUSTOMER.lng });
  check('a real fix takes over from it', h.engine.snapshot.lastKnown?.source === 'fix', h.engine.snapshot.lastKnown?.source);
}
{
  // A position with no timestamp cannot be honestly aged, so it is not shown at all.
  const order = { ...ORDER, map: { ...ORDER.map, rider: { lat: HOTEL.lat, lng: HOTEL.lng }, riderAt: null } };
  const h = build({ order });
  h.configure();
  check('a server position of unknown age is not adopted', h.engine.snapshot.lastKnown === null, JSON.stringify(h.engine.snapshot.lastKnown));
}
{
  // Stopping must not carry the previous delivery's position into the next one.
  const h = build();
  h.configure();
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng });
  check('a fix is remembered while delivering', h.engine.snapshot.lastKnown !== null);
  h.engine.stop({ reason: 'delivery finished' });
  check('the last position is forgotten when tracking stops', h.engine.snapshot.lastKnown === null, JSON.stringify(h.engine.snapshot.lastKnown));
  check('the reason tracking stopped is kept for display', /finished/.test(h.engine.snapshot.lastError?.message || ''), h.engine.snapshot.lastError?.message);
}

// --- socket down -> HTTP fallback (reconnect) --------------------------------
console.log('\nSocket disconnect and reconnect');
{
  const h = build();
  h.configure();
  h.setSocket(false);
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng });
  check('with the socket down the position goes over HTTP', h.sent.http.length === 1, `http=${h.sent.http.length}`);
  check('and not over the socket', h.sent.socket.length === 0);
  check('the HTTP payload is the real fix', h.sent.http[0]?.latitude === HOTEL.lat);
  // The transport is recorded when the request settles, not when it is issued.
  await flush();
  check('the transport is reported as http', h.engine.snapshot.transport === 'http', h.engine.snapshot.transport);

  h.setSocket(true); // reconnected
  h.tick(20_000);    // past the send interval
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng + 0.0005 });
  await flush();
  check('after reconnecting the socket is used again', h.sent.socket.length === 1, `socket=${h.sent.socket.length}`);
  check('the transport is reported as socket', h.engine.snapshot.transport === 'socket', h.engine.snapshot.transport);
}

// --- throttle ---------------------------------------------------------------
console.log('\nThrottling');
{
  const h = build();
  h.configure();
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng });
  h.geo.fix({ lat: HOTEL.lat, lng: HOTEL.lng }); // same spot, immediately
  check('a second fix in the same spot is not sent again', h.sent.socket.length === 1, `sent=${h.sent.socket.length}`);
  h.tick(20_000);
  h.geo.fix({ lat: HOTEL.lat + 0.002, lng: HOTEL.lng }); // moved well past the resend distance
  check('a fix after the interval is sent', h.sent.socket.length === 2, `sent=${h.sent.socket.length}`);
}

// --- a fix after the watch is cleared must not be sent ----------------------
console.log('\nA fix that arrives late');
{
  const h = build();
  h.configure();
  const lateSuccess = h.geo.onSuccess;
  h.engine.stop({ reason: 'delivered' });
  lateSuccess?.({ coords: { latitude: HOTEL.lat, longitude: HOTEL.lng, accuracy: 5 }, timestamp: Date.now() });
  check('a fix in flight when tracking stopped is ignored', h.sent.socket.length === 0 && h.sent.http.length === 0);
  check('and it does not put a rider back on a delivered order', h.engine.snapshot.point === null);
}

// --- self pickup must not start rider GPS -----------------------------------
console.log('\nSelf pickup');
{
  const pickup = { id: 2, status: 'ORDER_CONFIRMED', order_type: 'pickup', address: {}, map: { hotel: HOTEL, customer: null } };
  const h = build({ order: pickup });
  // The pickup order is not the rider's delivery, so there is no rider order to
  // track: the engine is told so rather than inferring it.
  h.engine.configure({ enabled: false, orderId: null, order: pickup, config: CONFIG });
  check('a self-pickup order opens no rider watch', h.geo.started === 0, `started=${h.geo.started}`);
  check('a self-pickup order sends no position', h.sent.socket.length === 0 && h.sent.http.length === 0);
  check('a self-pickup order is reported idle', h.engine.snapshot.status === GPS_IDLE, h.engine.snapshot.status);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
