import express from 'express';
import { db } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = express.Router();

// Admin: View customers list with metrics
router.get('/', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
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

    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: View all customer reviews
router.get('/reviews', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const reviews = db.prepare(`
SELECT r.*, o.order_number, o.created_at as order_date, o.items_json
       FROM reviews r
       LEFT JOIN orders o ON r.order_id = o.id
      ORDER BY r.id DESC
    `).all();
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
