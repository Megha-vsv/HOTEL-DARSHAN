const BASE = 'http://localhost:5000';

let passed = 0, failed = 0;
function assert(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS:', name); }
  else { failed++; console.log('  FAIL:', name, extra); }
}

async function main() {
  const { io } = await import('socket.io-client');

  // Kitchen client
  const kitchen = io(BASE, { transports: ['websocket', 'polling'] });
  await new Promise(r => kitchen.on('connect', r));

  // Admin client
  const admin = io(BASE, { transports: ['websocket', 'polling'] });
  await new Promise(r => admin.on('connect', r));

  // Customer client (joins order room)
  const customer = io(BASE, { transports: ['websocket', 'polling'] });
  await new Promise(r => customer.on('connect', r));

  kitchen.emit('join_kitchen');
  admin.emit('join_admin');

  // Wait a tick for room joins
  await new Promise(r => setTimeout(r, 300));

  let receivedByKitchen = null;
  let receivedByAdmin = null;
  let receivedByCustomer = null;

  kitchen.on('order:created', (o) => { receivedByKitchen = o; });
  admin.on('order:created', (o) => { receivedByAdmin = o; });
  customer.on('order:created', (o) => { receivedByCustomer = o; });

  // Create an order via HTTP (triggers emitOrderCreated to kitchen_room + admin_room)
  const createRes = await fetch(BASE + '/api/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ id: 41, quantity: 1, selectedCustomizations: [] }],
      order_type: 'delivery',
      customer_name: 'Socket Test',
      customer_phone: '+91 90000 00001',
      address: { street: 'Test St', city: 'Test City' },
      payment_method: 'cod'
    })
  });
  const order = await createRes.json();
  assert('order created via HTTP', createRes.status === 201, order.error);

  // Wait for socket events
  await new Promise(r => setTimeout(r, 500));
  assert('kitchen received order:created', !!receivedByKitchen, 'kitchen did not receive');
  assert('admin received order:created', !!receivedByAdmin, 'admin did not receive');
  assert('kitchen order has id', receivedByKitchen && receivedByKitchen.id === order.id);
  assert('kitchen order has customer_name', receivedByKitchen && receivedByKitchen.customer_name === 'Socket Test');
  assert('kitchen order has items', receivedByKitchen && receivedByKitchen.items && receivedByKitchen.items.length === 1);
  assert('kitchen order has order_number', receivedByKitchen && !!receivedByKitchen.order_number);

  // Customer joins the order room
  customer.emit('join_order', order.id);
  await new Promise(r => setTimeout(r, 200));

  let statusUpdateByCustomer = null;
  customer.on('order:status_updated', (o) => { statusUpdateByCustomer = o; });

  // Admin updates status via HTTP -> emitOrderStatusUpdated broadcasts to order_{id}, kitchen_room, admin_room
  const adminToken = await getAdminToken();
  const statusRes = await fetch(BASE + '/api/orders/' + order.id + '/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
    body: JSON.stringify({ status: 'PREPARING' })
  });
  const statusOrder = await statusRes.json();
  assert('status updated via HTTP', statusRes.ok && statusOrder.status === 'PREPARING', statusOrder.error);

  await new Promise(r => setTimeout(r, 500));
  assert('customer received order:status_updated', !!statusUpdateByCustomer, 'customer did not receive status update');
  assert('customer status update has correct status', statusUpdateByCustomer && statusUpdateByCustomer.status === 'PREPARING');
  assert('customer status update preserves items', statusUpdateByCustomer && statusUpdateByCustomer.items && statusUpdateByCustomer.items.length === 1);
  assert('customer status update preserves address', statusUpdateByCustomer && statusUpdateByCustomer.address && statusUpdateByCustomer.address.street === 'Test St');

  // Cleanup
  kitchen.disconnect(); admin.disconnect(); customer.disconnect();

  console.log(`\n=== SOCKET RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

async function getAdminToken() {
  const r = await fetch(BASE + '/api/auth/staff-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@darshan.com', password: 'admin123' })
  });
  const d = await r.json();
  return d.token;
}

main().catch(e => { console.error('SOCKET TEST ERROR:', e); process.exit(2); });