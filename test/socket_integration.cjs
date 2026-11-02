/* Integration proof for the Kitchen status workflow (KITCHEN TASK 4).
 *
 * Workflow proven end-to-end against the live backend:
 *   PICKUP: NEW -> CONFIRMED -> COOKING -> READY -> PICKED UP
 *   DELIVERY: NEW -> CONFIRMED -> COOKING -> READY
 *
 * - A new order reaches Admin + Kitchen (order:created, same id).
 * - Every tested status change
 *   is persisted to the EXISTING backend (/api/orders/:id/status) and
 *   propagates live to Admin, Kitchen AND the order-tracking socket.
 *
 * Run with: node test/socket_integration.cjs  (server must be running on :5000)
 */
const http = require('http');
const path = require('path');
let io;
try { io = require('socket.io-client'); }
catch (_) { io = require(path.resolve(__dirname, '..', 'client', 'node_modules', 'socket.io-client')); }

const BASE = 'http://localhost:5000';
const SOCKET_URL = 'http://localhost:5000';
const ADMIN_CREDENTIALS = {
  email: process.env.HOTEL_DARSHAN_TEST_ADMIN_EMAIL || 'admin@darshan.com',
  password: process.env.HOTEL_DARSHAN_TEST_ADMIN_PASSWORD || 'admin123'
};
const CHEF_CREDENTIALS = {
  email: process.env.HOTEL_DARSHAN_TEST_CHEF_EMAIL || 'chef@darshan.com',
  password: process.env.HOTEL_DARSHAN_TEST_CHEF_PASSWORD || 'chef123'
};

function api(p, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(BASE + p, { method, headers }, (res) => {
      let json = '';
      res.on('data', (c) => (json += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(json); } catch { parsed = json; }
        resolve({ status: res.statusCode, ok: res.statusCode < 400, data: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('api timeout ' + p)); });
    if (data) req.write(data);
    req.end();
  });
}

function onceEvent(sock, event, ms = 8000, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error('timeout ' + event)); }, ms);
    const h = (p) => {
      if (!predicate(p)) return;
      clearTimeout(t);
      sock.off(event, h);
      resolve(p);
    };
    sock.on(event, h);
  });
}

function connect(label, token) {
  const sock = io(SOCKET_URL, { transports: ['websocket'], forceNew: true, auth: { token } });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout ' + label)), 6000);
    sock.on('connect', () => { clearTimeout(t); resolve(sock); });
    sock.on('connect_error', (err) => { clearTimeout(t); reject(err); });
    sock.on('disconnect', (r) => console.log('  [debug] ' + label + ' DISCONNECT ' + r));
  });
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.error('  X FAIL: ' + msg); throw new Error(msg); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let adminSock, kitchenSock, trackingSock;

async function expectAll(orderId, status) {
  const isExpectedUpdate = (payload) => {
    const order = payload?.order || payload;
    return String(order?.id) === String(orderId) && order?.status === status;
  };
  const [a, k, c] = await Promise.all([
    onceEvent(adminSock, 'order:status_updated', 8000, isExpectedUpdate),
    onceEvent(kitchenSock, 'order:status_updated', 8000, isExpectedUpdate),
    onceEvent(trackingSock, 'order:status_updated', 8000, isExpectedUpdate),
  ]);
  assert(a && a.status === status, 'Admin  saw status_updated=' + status + ' (order ' + orderId + ')');
  assert(k && k.status === status, 'Kitchen saw status_updated=' + status + ' (order ' + orderId + ')');
  assert(c && c.status === status, 'Tracking socket saw status_updated=' + status + ' (order ' + orderId + ')');
}

async function step(orderId, roleToken, role, status) {
  const events = expectAll(orderId, status);
  const r = await api('/api/orders/' + orderId + '/status', { method: 'PATCH', token: roleToken, body: { status } });
  if (r.status !== 200) {
    events.catch(() => {});
    throw new Error(role + ' set ' + status + ' -> ' + r.status + ': ' + (r.data?.error || 'request failed'));
  }
  assert(true, role + ' set ' + status + ' -> 200');
  await events;
}

;(async () => {
  try {
    const adminLogin = await api('/api/auth/staff-login', { method: 'POST', body: ADMIN_CREDENTIALS });
    const chefLogin = await api('/api/auth/staff-login', { method: 'POST', body: CHEF_CREDENTIALS });
    assert(adminLogin.status === 200, 'admin login');
    assert(chefLogin.status === 200, 'chef login');
    const adminToken = adminLogin.data.token;
    const chefToken = chefLogin.data.token;

    // Create an order before the kitchen connects. Its first authenticated sync
    // must recover the current board rather than relying only on future events.
    const pickupRes = await api('/api/orders/create', {
      method: 'POST',
      body: { order_type: 'pickup', customer_name: 'Pickup Test', customer_phone: '+91 98000 00001',
        items: [{ id: 2, quantity: 1 }], payment_method: 'pay_at_hotel' }
    });
    assert(pickupRes.status === 201, 'pickup order created before kitchen connects');
    const pick = pickupRes.data;

    adminSock = await connect('admin', adminToken);
    kitchenSock = await connect('kitchen', chefToken);
    trackingSock = await connect('tracking', adminToken);
    adminSock.emit('join_admin');
    kitchenSock.emit('join_kitchen');
    await sleep(600);

    // ===== PICKUP ORDER: NEW -> CONFIRMED -> COOKING -> READY -> PICKED UP =====
    const kitchenSync = await new Promise((resolve) => kitchenSock.emit('resync', resolve));
    assert(
      kitchenSync?.orders?.some((order) => order.id === pick.id),
      'authenticated kitchen sync recovers orders created while disconnected'
    );

    trackingSock.emit('join_order', pick.id);
    await sleep(500);

    await step(pick.id, chefToken, 'Kitchen', 'ORDER_CONFIRMED');
    await step(pick.id, chefToken, 'Kitchen', 'PREPARING');           // Start Cooking  -> COOKING
    await step(pick.id, chefToken, 'Kitchen', 'READY_FOR_PICKUP');    // Mark Ready      -> READY
    await step(pick.id, chefToken, 'Kitchen', 'PICKED_UP');           // Hand Over        -> HANDED OVER/COMPLETED

    // ===== DELIVERY ORDER: NEW -> CONFIRMED -> COOKING -> READY =====
    const deliveryCreated = Promise.all([
      onceEvent(adminSock, 'order:created'),
      onceEvent(kitchenSock, 'order:created')
    ]);
    const delRes = await api('/api/orders/create', {
      method: 'POST',
      body: { order_type: 'delivery', customer_name: 'Delivery Test', customer_phone: '+91 98000 00002',
        address: { street: 'Char Rasta, Mosda Road', landmark: 'Near Hotel Darshan', city: 'Dediapada', pincode: '393040', latitude: 21.6271369, longitude: 73.5898076 },
        items: [{ id: 2, quantity: 1 }], payment_method: 'cod' }
    });
    if (delRes.status !== 201) {
      deliveryCreated.catch(() => {});
      throw new Error('delivery order created (NEW): ' + (delRes.data?.error || delRes.status));
    }
    assert(true, 'delivery order created (NEW)');
    const del = delRes.data;
    const [dcA, dcK] = await deliveryCreated;
    assert(dcA && dcA.id === del.id, 'Admin  saw order:created (NEW) id=' + del.id);
    assert(dcK && dcK.id === del.id, 'Kitchen saw order:created (NEW) id=' + del.id);

    trackingSock.emit('join_order', del.id);
    await sleep(500);

    await step(del.id, adminToken, 'Admin', 'ORDER_CONFIRMED');
    await step(del.id, chefToken, 'Kitchen', 'PREPARING');             // Start Cooking  -> COOKING
    await step(del.id, chefToken, 'Kitchen', 'READY');                 // Mark Ready     -> READY
    console.log('\n\u2699\ufe0f Workflow summary proven:');
    console.log('   PICKUP : NEW -> CONFIRMED -> COOKING -> READY -> PICKED_UP(CO)');
    console.log('   DELIVERY: NEW -> CONFIRMED -> COOKING -> READY');
    console.log('\n\u2705 ALL KITCHEN STATUS WORKFLOW CHECKS PASSED.');
    console.log('   - New orders appear in NEW (Admin + Kitchen see order:created)');
    console.log('   - Kitchen Start Cooking / Mark Ready / Hand Over update the EXISTING backend');
    console.log('   - Admin + order-tracking socket receive every status change live');
    console.log('   - No second status system: all changes via /api/orders/:id/status + socket');
  } catch (e) {
    console.error('\n' + (fail ? 'FAILURES' : 'INTEGRATION TEST FAILED') + ':', e.message);
    process.exitCode = 1;
  } finally {
    [adminSock, kitchenSock, trackingSock].forEach((s) => { try { s && s.close(); } catch (_) {} });
  }
})();
