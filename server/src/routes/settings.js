import express from 'express';
import { db } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';
import { parseDeliverySlabs, parseMaxDeliveryKm } from '../deliveryPricing.js';

const router = express.Router();

// Get public restaurant settings
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => {
      // Don't leak secret keys to public
      if (r.key !== 'razorpay_key_secret') {
        settings[r.key] = r.value;
      }
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update settings
router.put('/', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const updates = req.body || {};
    const allowedKeys = new Set(['auto_confirm_orders','restaurant_open','tax_percent','delivery_fee','free_delivery_above','hotel_name','hotel_tagline','hotel_address','hotel_phone','hotel_coords','delivery_slabs','max_delivery_km']);
    const updateStmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    Object.entries(updates).forEach(([key, val]) => {
      if (!allowedKeys.has(key)) return;
      // Slabs are validated so a bad admin payload can never break pricing.
      if (key === 'delivery_slabs') {
        const slabs = parseDeliverySlabs(val);
        updateStmt.run(key, JSON.stringify(slabs));
        return;
      }
      if (key === 'max_delivery_km') {
        updateStmt.run(key, String(parseMaxDeliveryKm(val)));
        return;
      }
      updateStmt.run(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
    });

    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => {
      if (r.key !== 'razorpay_key_secret') {
        settings[r.key] = r.value;
      }
    });

    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
