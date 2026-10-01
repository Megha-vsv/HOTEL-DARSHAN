const jwt = require('jsonwebtoken');
const {db} = require('./src/db.js');

// Generate admin token using the SAME secret as auth.js
const JWT_SECRET = 'hotel-darshan-development-secret-change-this';
const admin = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@darshan.com');
const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, JWT_SECRET, { expiresIn: '7d' });

// Simulate the authMiddleware verification
const decoded = jwt.verify(token, JWT_SECRET);
console.log('1. JWT verification works:', decoded.email, decoded.role);

// Test orders query (what AdminView fetchOrders does)
const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all();
console.log('2. Orders found:', orders.length);

// Test customers query (what AdminView fetchCustomersAndReviews does)
const customers = db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.created_at,
         COUNT(o.id) as order_count,
         COALESCE(SUM(o.grand_total), 0) as total_spent,
         MAX(o.created_at) as last_order_date
  FROM users u
  LEFT JOIN orders o ON u.id = o.user_id AND o.status != 'CANCELLED'
  WHERE u.role = 'customer'
  GROUP BY u.id
  ORDER BY total_spent DESC
`).all();
console.log('3. Customers found:', customers.length);

// Check if orders have user_id
const ordersWithUserId = orders.filter(o => o.user_id !== null).length;
console.log('4. Orders with user_id:', ordersWithUserId, 'out of', orders.length);

// Show sample customer data
if (customers.length > 0) {
  console.log('5. Sample customer:', JSON.stringify(customers[0], null, 2));
}

// Show sample order data
if (orders.length > 0) {
  console.log('6. Sample order:', JSON.stringify({
    id: orders[0].id,
    order_number: orders[0].order_number,
    customer_name: orders[0].customer_name,
    customer_phone: orders[0].customer_phone,
    order_type: orders[0].order_type,
    status: orders[0].status,
    grand_total: orders[0].grand_total
  }, null, 2));
}