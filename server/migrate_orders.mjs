import { db } from './src/db.js';

// Update existing orders to link user_id based on phone number
const updateQuery = db.prepare(`
  UPDATE orders
  SET user_id = (
    SELECT u.id FROM users u
    WHERE u.phone = orders.customer_phone
    AND u.role = 'customer'
    LIMIT 1
  )
  WHERE user_id IS NULL
`);

const result = updateQuery.run();
console.log(`Updated ${result.changes} orders with user_id based on phone number`);

// Verify the update
const customers = db.prepare(`
  SELECT
        u.id, u.name, u.email, u.phone, u.created_at,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.grand_total), 0) as total_spent,
        MAX(o.created_at) as last_order_date
      FROM users u
      LEFT JOIN orders o ON (
        o.user_id = u.id
        OR (o.user_id IS NULL AND o.customer_phone = u.phone)
      ) AND o.status != 'CANCELLED'
      WHERE u.role = 'customer'
      GROUP BY u.id
      ORDER BY total_spent DESC
`).all();

console.log('Customers after update:');
customers.forEach(c => {
  console.log(`  ${c.name} (${c.phone}): ${c.order_count} orders, ₹${c.total_spent}, last order: ${c.last_order_date || 'Never'}`);
});