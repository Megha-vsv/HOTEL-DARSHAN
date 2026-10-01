import express from 'express';
import { db } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';
import { emitItemAvailabilityChanged } from '../socket.js';

const router = express.Router();

// Get categories
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT c.*, COUNT(m.id) as item_count
      FROM categories c
      LEFT JOIN menu_items m ON c.id = m.category_id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC
    `).all();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Add category
router.post('/categories', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const { name_en, name_hi, name_gu, image_url, sort_order, is_active } = req.body;
    if (!name_en || !name_hi || !name_gu) {
      return res.status(400).json({ error: 'Category names in all 3 languages are required' });
    }
    const result = db.prepare(`
      INSERT INTO categories (name_en, name_hi, name_gu, image_url, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name_en.trim(),
      name_hi.trim(),
      name_gu.trim(),
      image_url || '',
      sort_order || 0,
      is_active !== undefined ? (is_active ? 1 : 0) : 1
    );

    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Edit category
router.put('/categories/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    const { name_en, name_hi, name_gu, image_url, sort_order, is_active } = req.body;
    db.prepare(`
      UPDATE categories
      SET name_en = ?, name_hi = ?, name_gu = ?, image_url = ?, sort_order = ?, is_active = ?
      WHERE id = ?
    `).run(
      name_en,
      name_hi,
      name_gu,
      image_url,
      sort_order,
      is_active ? 1 : 0,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete category
router.delete('/categories/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Menu Items with filters
router.get('/items', (req, res) => {
  try {
    const { category_id, search, veg_only, popular, special, available_only } = req.query;

    let query = `
      SELECT m.*, c.name_en as category_name_en, c.name_hi as category_name_hi, c.name_gu as category_name_gu
      FROM menu_items m
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (category_id && category_id !== 'all') {
      query += ` AND m.category_id = ?`;
      params.push(category_id);
    }

    if (search) {
      const searchTerm = `%${search.trim()}%`;
      query += ` AND (m.name_en LIKE ? OR m.name_hi LIKE ? OR m.name_gu LIKE ? OR m.ingredients_en LIKE ? OR m.desc_en LIKE ?)`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (veg_only === 'true' || veg_only === '1') {
      query += ` AND m.is_veg = 1`;
    }

    if (popular === 'true' || popular === '1') {
      query += ` AND m.is_popular = 1`;
    }

    if (special === 'true' || special === '1') {
      query += ` AND m.is_special = 1`;
    }

    if (available_only === 'true' || available_only === '1') {
      query += ` AND m.is_available = 1 AND m.available_qty > 0`;
    }

    query += ` ORDER BY m.is_available DESC, m.is_popular DESC, m.sort_order ASC, m.id ASC`;

    // Note: in sqlite, we order by m.id if sort_order isn't in menu_items
    query = query.replace('m.sort_order ASC, ', '');

    const items = db.prepare(query).all(...params);

    const formatted = items.map(item => ({
      ...item,
      customizations: JSON.parse(item.customizations_json || '[]')
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single item
router.get('/items/:id', (req, res) => {
  try {
    const item = db.prepare(`
      SELECT m.*, c.name_en as category_name_en, c.name_hi as category_name_hi, c.name_gu as category_name_gu
      FROM menu_items m
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE m.id = ?
    `).get(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    item.customizations = JSON.parse(item.customizations_json || '[]');
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Add menu item
router.post('/items', authMiddleware, requireRole(['admin', 'chef']), (req, res) => {
  try {
    const {
      category_id, name_en, name_hi, name_gu,
      desc_en, desc_hi, desc_gu,
      ingredients_en, ingredients_hi, ingredients_gu,
      price, discount_price, is_veg, prep_time_mins, image_url,
      is_available, available_qty, is_popular, is_special,
      customizations
    } = req.body;

    const result = db.prepare(`
      INSERT INTO menu_items (
        category_id, name_en, name_hi, name_gu,
        desc_en, desc_hi, desc_gu,
        ingredients_en, ingredients_hi, ingredients_gu,
        price, discount_price, is_veg, prep_time_mins, image_url,
        is_available, available_qty, is_popular, is_special,
        customizations_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      category_id, name_en, name_hi || name_en, name_gu || name_en,
      desc_en || '', desc_hi || '', desc_gu || '',
      ingredients_en || '', ingredients_hi || '', ingredients_gu || '',
      parseFloat(price) || 0,
      discount_price ? parseFloat(discount_price) : null,
      is_veg !== undefined ? (is_veg ? 1 : 0) : 1,
      parseInt(prep_time_mins) || 15,
      image_url || 'https://images.unsplash.com/photo-1610057099431-d73a1c9d2f2f?w=600&auto=format&fit=crop&q=80',
      is_available !== undefined ? (is_available ? 1 : 0) : 1,
      parseInt(available_qty) || 50,
      is_popular ? 1 : 0,
      is_special ? 1 : 0,
      JSON.stringify(customizations || [])
    );

    const newItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid);
    newItem.customizations = JSON.parse(newItem.customizations_json || '[]');
    emitItemAvailabilityChanged(newItem);

    res.status(201).json(newItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Edit menu item
router.put('/items/:id', authMiddleware, requireRole(['admin', 'chef']), (req, res) => {
  try {
    const {
      category_id, name_en, name_hi, name_gu,
      desc_en, desc_hi, desc_gu,
      ingredients_en, ingredients_hi, ingredients_gu,
      price, discount_price, is_veg, prep_time_mins, image_url,
      is_available, available_qty, is_popular, is_special,
      customizations
    } = req.body;

    const existing = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Menu item not found' });

    db.prepare(`
      UPDATE menu_items SET
        category_id = ?, name_en = ?, name_hi = ?, name_gu = ?,
        desc_en = ?, desc_hi = ?, desc_gu = ?,
        ingredients_en = ?, ingredients_hi = ?, ingredients_gu = ?,
        price = ?, discount_price = ?, is_veg = ?, prep_time_mins = ?, image_url = ?,
        is_available = ?, available_qty = ?, is_popular = ?, is_special = ?,
        customizations_json = ?
      WHERE id = ?
    `).run(
      category_id, name_en, name_hi, name_gu,
      desc_en, desc_hi, desc_gu,
      ingredients_en, ingredients_hi, ingredients_gu,
      parseFloat(price),
      discount_price ? parseFloat(discount_price) : null,
      is_veg ? 1 : 0,
      parseInt(prep_time_mins),
      image_url,
      is_available ? 1 : 0,
      parseInt(available_qty),
      is_popular ? 1 : 0,
      is_special ? 1 : 0,
      JSON.stringify(customizations || []),
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Menu item not found after update' });
    updated.customizations = JSON.parse(updated.customizations_json || '[]');
    emitItemAvailabilityChanged(updated);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin/Chef: Quick 1-tap toggle availability (🟢 Available / 🔴 Unavailable)
router.patch('/items/:id/availability', authMiddleware, requireRole(['admin', 'chef']), (req, res) => {
  try {
    const { is_available } = req.body;
    const newStatus = is_available ? 1 : 0;

    db.prepare('UPDATE menu_items SET is_available = ? WHERE id = ?').run(newStatus, req.params.id);

    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
    updated.customizations = JSON.parse(updated.customizations_json || '[]');

    // Broadcast instant update over WebSockets to all customers
    emitItemAvailabilityChanged(updated);

    res.json({
      success: true,
      id: updated.id,
      name_en: updated.name_en,
      is_available: updated.is_available
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin/Chef: Update available stock quantity
router.patch('/items/:id/stock', authMiddleware, requireRole(['admin', 'chef']), (req, res) => {
  try {
    const { available_qty } = req.body;
    const qty = parseInt(available_qty);
    const isAvailable = qty > 0 ? 1 : 0;

    db.prepare('UPDATE menu_items SET available_qty = ?, is_available = ? WHERE id = ?').run(qty, isAvailable, req.params.id);

    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
    updated.customizations = JSON.parse(updated.customizations_json || '[]');

    emitItemAvailabilityChanged(updated);

    res.json({
      success: true,
      id: updated.id,
      available_qty: updated.available_qty,
      is_available: updated.is_available
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete item
router.delete('/items/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
    emitItemAvailabilityChanged({ id: parseInt(req.params.id), deleted: true });
    res.json({ success: true, message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
