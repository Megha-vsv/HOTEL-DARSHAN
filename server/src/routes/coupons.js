import express from 'express';
import { db } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = express.Router();

// Get active coupons for customer view
router.get('/', (req, res) => {
  try {
    const coupons = db.prepare(`
      SELECT id, code, discount_type, discount_value, min_order_value, max_discount, valid_to
      FROM coupons
      WHERE is_active = 1
        AND (valid_to IS NULL OR datetime(valid_to) >= datetime('now'))
        AND (usage_limit IS NULL OR usage_limit <= 0 OR used_count < usage_limit)
      ORDER BY discount_value DESC
    `).all();
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get all coupons
router.get('/all', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const coupons = db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate coupon against cart total
router.post('/validate', (req, res) => {
  try {
    const { code, cartTotal } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Coupon code is required' });
    }

    const coupon = db.prepare(`
      SELECT * FROM coupons
      WHERE UPPER(code) = UPPER(?) AND is_active = 1
        AND (valid_to IS NULL OR datetime(valid_to) >= datetime('now'))
        AND (usage_limit IS NULL OR usage_limit <= 0 OR used_count < usage_limit)
    `).get(code.trim());

    if (!coupon) {
      return res.status(404).json({ error: 'Invalid or expired coupon code' });
    }

    const total = parseFloat(cartTotal) || 0;

    if (total < coupon.min_order_value) {
      return res.status(400).json({
        error: `Minimum order value of ₹${coupon.min_order_value} required for coupon ${coupon.code}`
      });
    }

    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (total * coupon.discount_value) / 100;
      if (coupon.max_discount && discount > coupon.max_discount) {
        discount = coupon.max_discount;
      }
    } else {
      discount = coupon.discount_value;
    }

    // Ensure discount doesn't exceed total
    if (discount > total) {
      discount = total;
    }

    res.json({
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        discount_amount: Math.round(discount * 100) / 100
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Create coupon
router.post('/', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const { code, discount_type, discount_value, min_order_value, max_discount, valid_to, usage_limit, is_active } = req.body;

    const result = db.prepare(`
      INSERT INTO coupons (code, discount_type, discount_value, min_order_value, max_discount, valid_to, usage_limit, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code.toUpperCase().trim(),
      discount_type || 'percentage',
      parseFloat(discount_value) || 0,
      parseFloat(min_order_value) || 0,
      max_discount ? parseFloat(max_discount) : null,
      valid_to || '2027-12-31',
      parseInt(usage_limit) || 500,
      is_active !== undefined ? (is_active ? 1 : 0) : 1
    );

    const newCoupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newCoupon);
  } catch (err) {
    const message = String(err.message || '');
    const status = message.includes('UNIQUE constraint failed') ? 409 : 500;
    res.status(status).json({ error: status === 409 ? 'Coupon code already exists' : message });
  }
});

// Admin: Edit coupon
router.put('/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const { code, discount_type, discount_value, min_order_value, max_discount, valid_to, usage_limit, is_active } = req.body;

    db.prepare(`
      UPDATE coupons SET
        code = ?, discount_type = ?, discount_value = ?,
        min_order_value = ?, max_discount = ?, valid_to = ?,
        usage_limit = ?, is_active = ?
      WHERE id = ?
    `).run(
      code.toUpperCase().trim(),
      discount_type,
      parseFloat(discount_value),
      parseFloat(min_order_value),
      max_discount ? parseFloat(max_discount) : null,
      valid_to,
      parseInt(usage_limit),
      is_active ? 1 : 0,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete coupon
router.delete('/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
