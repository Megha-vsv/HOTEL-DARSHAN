import express from 'express';
import { db } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = express.Router();

// Every order column is stored in UTC. The dashboard, however, reports on the
// restaurant's *days* and *hours* - "today's sales", "peak ordering hours" - and
// those are IST. Grouping by raw `created_at` labelled the busiest hour of the
// evening service as 5h30m earlier than it was, and put the first 5h30m of every
// trading day into the previous day's total.
//
// So the stored value is shifted into IST before anything is grouped or bucketed
// by it. SQLite takes the two modifiers separately; `+5 hours 30 minutes` in one
// string is not honoured the way that reads.
//
// The window bounds used `datetime('now', 'localtime')`, which is correct only
// on a server whose own clock is set to India time. The server is not required
// to be, so that dependency is gone: the offset is applied explicitly instead.
const IST_SHIFT = "'+5 hours', '+30 minutes'";

/** `created_at` rendered in IST, for grouping and bucketing. */
const IST_STAMP = `created_at, ${IST_SHIFT}`;

/**
 * Resolve the requested analytics window into an IST-relative SQLite range.
 * Supported values: today (default), week (last 7 days), month (last 30 days).
 */
function resolveRange(range) {
  switch (range) {
    case 'week':
      return { label: 'This Week', back: "'-6 days'" };
    case 'month':
      return { label: 'This Month', back: "'-29 days'" };
    case 'today':
    default:
      return { label: 'Today', back: null };
  }
}

router.get('/', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const range = resolveRange(req.query.range);

    // The window start, in IST. With no `back` this is IST midnight of today,
    // so "today" is the restaurant's trading day and not the server's UTC one.
    const sinceSql = range.back
      ? `datetime('now', '+5 hours', '+30 minutes', ${range.back})`
      : `datetime('now', '+5 hours', '+30 minutes', 'start of day')`;

    // Total sales for the selected window (excludes cancelled orders)
    const todaySalesRow = db.prepare(`
      SELECT
        COALESCE(SUM(grand_total), 0) as total_sales,
        COUNT(id) as total_orders
      FROM orders
      WHERE date(${IST_STAMP}) >= date(${sinceSql}) AND status != 'CANCELLED'
    `).get();

    // Completed vs Cancelled (all time breakdown, kept consistent)
    const orderBreakdown = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_orders,
        COUNT(id) as all_orders,
        COALESCE(AVG(grand_total), 0) as aov
      FROM orders
    `).get();

    // Daily revenue/orders trend for the selected window, by IST day
    const weeklySales = db.prepare(`
      SELECT date(${IST_STAMP}) as order_date, COALESCE(SUM(grand_total), 0) as daily_revenue, COUNT(id) as order_count
      FROM orders
      WHERE date(${IST_STAMP}) >= date(${sinceSql}) AND status != 'CANCELLED'
      GROUP BY date(${IST_STAMP})
      ORDER BY order_date ASC
    `).all();

    // Most ordered food items (all time, kept consistent across filters)
    const allOrders = db.prepare("SELECT items_json FROM orders WHERE status != 'CANCELLED'").all();
    const itemMap = {};

    allOrders.forEach(o => {
      try {
        const items = JSON.parse(o.items_json || '[]');
        items.forEach(it => {
          if (!itemMap[it.name_en]) {
            itemMap[it.name_en] = { name: it.name_en, count: 0, revenue: 0 };
          }
          itemMap[it.name_en].count += (it.quantity || 1);
          itemMap[it.name_en].revenue += (it.item_total_price || (it.unit_price * it.quantity));
        });
      } catch (e) {}
    });

    const popularItems = Object.values(itemMap).sort((a, b) => b.count - a.count).slice(0, 6);
    const leastOrdered = Object.values(itemMap).sort((a, b) => a.count - b.count).slice(0, 5);

    // Peak ordering hours for the selected window, as IST hours.
    // `strftime('%H')` returns a zero-padded string, which is what the dashboard
    // chart already expects.
    const hourlyOrders = db.prepare(`
      SELECT strftime('%H', ${IST_STAMP}) as hour, COUNT(id) as count
      FROM orders
      WHERE date(${IST_STAMP}) >= date(${sinceSql})
      GROUP BY strftime('%H', ${IST_STAMP})
      ORDER BY hour ASC
    `).all();

    const paymentSummary = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN payment_method = 'online' AND payment_status = 'paid' THEN grand_total ELSE 0 END), 0) as online_paid_amount,
        COUNT(CASE WHEN payment_method = 'online' AND payment_status = 'paid' THEN 1 END) as online_paid_orders,
        COALESCE(SUM(CASE WHEN payment_method = 'cod' THEN grand_total ELSE 0 END), 0) as cod_order_value,
        COUNT(CASE WHEN payment_method = 'cod' THEN 1 END) as cod_orders,
        COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_payments
      FROM orders
      WHERE status != 'CANCELLED'
    `).get();

    const statusSummary = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM orders
      GROUP BY status
      ORDER BY count DESC
    `).all();

    res.json({
      range: range.label,
      today_sales: todaySalesRow.total_sales,
      today_orders: todaySalesRow.total_orders,
      completed_orders: orderBreakdown.completed_orders || 0,
      cancelled_orders: orderBreakdown.cancelled_orders || 0,
      all_orders: orderBreakdown.all_orders || 0,
      average_order_value: Math.round((orderBreakdown.aov || 0) * 100) / 100,
      weekly_sales: weeklySales,
      popular_items: popularItems,
      least_ordered: leastOrdered,
      hourly_orders: hourlyOrders,
      payment_summary: paymentSummary,
      status_summary: statusSummary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
