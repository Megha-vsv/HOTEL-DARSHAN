import express from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { db, dbPath } from '../db.js';

const router = express.Router();
router.use(authMiddleware, requireRole(['admin']));

router.get('/payment-status', (req, res) => {
  const orders = db.prepare('SELECT order_number, status, payment_method, payment_status, grand_total FROM orders').all();
  const counts = db.prepare('SELECT payment_status, COUNT(*) AS count FROM orders GROUP BY payment_status').all();
  res.json({
    dbPath,
    hotelDarshanDbConfigured: Boolean(process.env.HOTEL_DARSHAN_DB),
    totalOrders: orders.length,
    paymentStatusCounts: counts,
    orders
  });
});

export default router;