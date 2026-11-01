import express from 'express';
import { db } from '../db.js';
import { authMiddleware, optionalAuthMiddleware, requireRole } from '../auth.js';
import { emitOrderCreated, emitOrderStatusUpdated, emitItemAvailabilityChanged, emitReviewCreated, emitRiderLocation, emitRiderAssigned, emitRiderReleased, emitRiderNeeded, emitRiderNotice } from '../socket.js';
import { quoteFromSettings } from '../deliveryPricing.js';
import {
  adminRiderFleet,
  applyStatusChange,
  assignRider,
  findEligibleRiders,
  getOrder,
  getRiderState,
  listRiderCandidates,
  trackingPayload,
  recordRiderLocation,
  riderQueue,
  setRiderAvailability,
  setRiderState,
  retryPendingAssignments,
  trackingConfig,
  recordHistory,
  refreshEta
} from '../orderTrackingService.js';
import { distanceKmBetween, rankRiderCandidates, riderCanReceiveOrders } from '../orderTracking.js';
import { istDateString, orderingStatus, ORDERING_HOURS } from '../time.js';

const router = express.Router();

// Generate unique order number with date prefix (e.g., HD-20260922-001, HD-20260922-002)
  function generateOrderNumber() {
    // The calendar day the restaurant is trading on, not the UTC one. These were
    // the same string before, which meant an order placed between midnight and
    // 05:30 IST was numbered with yesterday's date while its own created_at - read
    // back in IST for the customer - read as today. See server/src/time.js.
    const today = istDateString();
    const dateStr = today.replace(/-/g, ''); // YYYYMMDD

    // Atomic counter row for today
    const existing = db.prepare('SELECT value FROM order_counters WHERE counter_date = ?').get(today);
    let nextSeq;
    if (existing) {
      nextSeq = parseInt(existing.value, 10) + 1;
      db.prepare('UPDATE order_counters SET value = ? WHERE counter_date = ?').run(nextSeq, today);
    } else {
      nextSeq = 1;
      db.prepare('INSERT INTO order_counters (counter_date, value) VALUES (?, ?)').run(today, nextSeq);
    }

    // Format: HD-YYYYMMDD-001 (globally unique across days)
    return `HD-${dateStr}-${String(nextSeq).padStart(3, '0')}`;
  }

// Get system settings helper
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  return settings;
}

/**
 * Order numbers are stored as `HD-YYYYMMDD-NNN`, but people copy them out of the
 * UI as `#HD-YYYYMMDD-NNN` and type them in any case. Everything that accepts an
 * order number - lookups, search, the socket room - goes through this so those
 * all resolve to the same order. The stored value is never rewritten.
 */
export function normaliseOrderNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^#+/, '').trim().toUpperCase();
}

/**
 * The one place an order is looked up from whatever identifier a client sent.
 *
 * The visible order number (`HD-20260926-197`) and the database id are the only
 * two forms that exist, and they are two names for the same row - not two
 * identifiers. Accepting both here means every caller, the customer tracker,
 * My Orders, the review form and the admin list all resolve to the same order
 * instead of each inventing its own idea of what an order id is.
 */
export function resolveOrderRow(value) {
  const key = normaliseOrderNumber(value);
  if (!key) return null;
  return /^\d+$/.test(key)
    ? db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(key))
    : db.prepare('SELECT * FROM orders WHERE UPPER(order_number) = ?').get(key);
}

/**
 * May this user read this order?
 *
 * Staff (admin, chef, rider) may read any order. A customer may read only their
 * own - matched on either the linked account or the phone on the order, so an
 * order placed before sign-in is still theirs.
 */
function canViewOrder(req, order) {
  const user = req.user;
  if (!user) return false;
  if (['admin', 'chef', 'rider'].includes(user.role)) return true;
  if (order.user_id && order.user_id === user.id) return true;
  // Fall back to the phone so a guest order becomes visible once the same
  // customer signs in, and stays visible if the row predates user_id.
  const userPhone = String(user.phone || '').replace(/\D/g, '');
  const orderPhone = String(order.customer_phone || '').replace(/\D/g, '');
  return !!userPhone && userPhone === orderPhone;
}

/** Shape a stored order row for the API, including its parsed items/address. */
function formatOrder(o) {
  return {
    ...o,
    items: JSON.parse(o.items_json || '[]'),
    address: JSON.parse(o.address_json || '{}')
  };
}

/**
 * A refusal the customer is meant to see, raised from inside the order
 * transaction. Carries the exact response body so the route can answer with it
 * once the transaction has rolled back, instead of writing a response from
 * inside the transaction and then continuing as if the order had been created.
 */
class OrderRejectedError extends Error {
  constructor(status, payload) {
    super(payload?.error || 'Order rejected');
    this.name = 'OrderRejectedError';
    this.status = status;
    this.payload = payload;
  }
}

// Create Order with server-side pricing, inventory validation & atomic decrement
router.post('/create', optionalAuthMiddleware, (req, res) => {
  const {
    items,
    order_type, // 'delivery' or 'pickup'
    customer_name,
    customer_phone,
    address,
    coupon_code,
    payment_method, // 'online', 'cod', 'pay_at_hotel'
    special_instructions
  } = req.body;

  if (!items || !items.length) {
    return res.status(400).json({ error: 'Your cart is empty' });
  }
  if (!customer_name || !customer_phone) {
    return res.status(400).json({ error: 'Customer name and phone are required' });
  }
  if (!['online', 'cod', 'pay_at_hotel'].includes(payment_method)) {
    return res.status(400).json({ error: 'Please select a payment method before placing the order.' });
  }
  if (order_type === 'delivery' && (!address || !address.street)) {
    return res.status(400).json({ error: 'Delivery address is required' });
  }

  // Ordering-hours gate. This runs before any inventory is touched, so an
  // out-of-hours request never reserves stock or decrements anything. The
  // times come from settings.opening_time / settings.closing_time and fall back
  // to the module defaults (10:30 / 22:00 Asia/Kolkata), so the admin panel is
  // the single source of truth and the check cannot drift between files.
  const _settingsForHours = getSettings();
  const _hours = orderingStatus(_settingsForHours.opening_time, _settingsForHours.closing_time);
  if (!_hours.open) {
    return res.status(403).json({
      success: false,
      error: 'Ordering is currently closed',
      orderingHours: { opening: _hours.opening, closing: _hours.closing, timezone: ORDERING_HOURS.TIMEZONE }
    });
  }

  const settings = getSettings();
  const userId = req.user ? req.user.id : null;

  const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotency_key || null;
  if (idempotencyKey) {
    const existing = db.prepare('SELECT order_id FROM order_idempotency_keys WHERE key = ?').get(idempotencyKey);
    if (existing) {
      const existingOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(existing.order_id);
      if (existingOrder) {
        existingOrder.items = JSON.parse(existingOrder.items_json || '[]');
        existingOrder.address = JSON.parse(existingOrder.address_json || '{}');
        return res.status(200).json(existingOrder);
      }
    }
  }

  // Run everything in an ACID SQLite Transaction
  const executeOrderTransaction = db.transaction(() => {
    let calculatedItemTotal = 0;
    const validatedItems = [];
    const itemsToUpdateStock = [];

    // Verify each item in database
    for (const item of items) {
      const dbItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(item.id);
      if (!dbItem) {
        throw new OrderRejectedError(400, { success: false, error: `Item #${item.id} not found in our menu` });
      }

      if (!dbItem.is_available || dbItem.available_qty <= 0) {
        throw new OrderRejectedError(400, { success: false, error: `"${dbItem.name_en}" is currently unavailable. Please remove it from your cart.` });
      }

      if (dbItem.available_qty < item.quantity) {
        throw new OrderRejectedError(400, { success: false, error: `Only ${dbItem.available_qty} units of "${dbItem.name_en}" left in stock. Please adjust quantity.` });
      }

      const unitPrice = dbItem.discount_price && dbItem.discount_price > 0 ? dbItem.discount_price : dbItem.price;
      let customizationsPrice = 0;
      const selectedCustomizations = [];

      if (item.selectedCustomizations && item.selectedCustomizations.length) {
        const availableCustomizations = JSON.parse(dbItem.customizations_json || '[]');
        item.selectedCustomizations.forEach(c => {
          const matched = availableCustomizations.find(ac => ac.id === c.id);
          if (matched) {
            customizationsPrice += (matched.price || 0);
            selectedCustomizations.push(matched);
          }
        });
      }

      const itemTotalPrice = (unitPrice + customizationsPrice) * item.quantity;
      calculatedItemTotal += itemTotalPrice;

      validatedItems.push({
        id: dbItem.id,
        name_en: dbItem.name_en,
        name_hi: dbItem.name_hi,
        name_gu: dbItem.name_gu,
        image_url: dbItem.image_url,
        is_veg: dbItem.is_veg,
        unit_price: unitPrice,
        quantity: item.quantity,
        customizations: selectedCustomizations,
        item_total_price: itemTotalPrice
      });

      itemsToUpdateStock.push({
        id: dbItem.id,
        newQty: dbItem.available_qty - item.quantity,
        dbItem
      });
    }

    // Validate Coupon
    let discountAmount = 0;
    let validatedCouponCode = null;
    let validatedCouponId = null;
    if (coupon_code) {
      const coupon = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) AND is_active = 1').get(coupon_code.trim());
      if (coupon && calculatedItemTotal >= coupon.min_order_value) {
        if (coupon.discount_type === 'percentage') {
          discountAmount = (calculatedItemTotal * coupon.discount_value) / 100;
          if (coupon.max_discount && discountAmount > coupon.max_discount) {
            discountAmount = coupon.max_discount;
          }
        } else {
          discountAmount = coupon.discount_value;
        }
        if (discountAmount > calculatedItemTotal) discountAmount = calculatedItemTotal;
        discountAmount = Math.round(discountAmount * 100) / 100;
        validatedCouponCode = coupon.code;
        validatedCouponId = coupon.id;
      }
    }

    // Delivery Fee calculation - distance based, Home Delivery only.
    // Self Pickup is never charged a delivery fee and is never radius-restricted.
    let deliveryFee = 0;
    let deliveryDistanceKm = null;
    let deliveryQuote = null;

    if (order_type === 'delivery') {
      const quote = quoteFromSettings(settings, {
        coords: { latitude: address?.latitude, longitude: address?.longitude },
        itemTotal: calculatedItemTotal
      });
      deliveryQuote = quote;

      // Authoritative radius check: the client also hides the option, but this is
      // what actually stops an out-of-range home delivery from being created.
      // Thrown rather than returned: this runs inside the transaction, and
      // returning the response object here would make the transaction resolve to
      // `res` instead of the order, so the caller would carry on with garbage.
      if (!quote.allowed) {
        throw new OrderRejectedError(400, {
          success: false,
          error: quote.reason,
          // An address we could not locate is a different problem from one that is
          // genuinely too far, and the customer fixes them in different ways.
          code: quote.unresolved ? 'UNRESOLVED_DELIVERY_DISTANCE' : 'OUT_OF_DELIVERY_RANGE',
          max_delivery_km: quote.maxKm,
          delivery_distance_km: quote.distanceKm
        });
      }

      deliveryFee = quote.fee;
      deliveryDistanceKm = quote.distanceKm;
    }

    // Taxes (GST)
    const taxPercent = parseFloat(settings.tax_percent || '5');
    const taxableAmount = Math.max(0, calculatedItemTotal - discountAmount);
    const taxAmount = Math.round((taxableAmount * taxPercent / 100) * 100) / 100;

    // Grand total
    const grandTotal = Math.round((taxableAmount + deliveryFee + taxAmount) * 100) / 100;

    // Order status and payment status
    let initialStatus = 'ORDER_PLACED';
    let initialPaymentStatus = 'pending';

    if (payment_method === 'online') {
      initialPaymentStatus = 'pending';
      initialStatus = 'ORDER_PLACED';
    } else {
      // COD or Pay at Hotel
      initialPaymentStatus = 'pending';
      const autoConfirm = settings.auto_confirm_orders === 'true';
      if (autoConfirm) {
        initialStatus = 'ORDER_CONFIRMED';
      }
    }

    // Every validation has now passed, so the coupon use can be consumed. Doing
    // this any earlier would burn a use even when the order is rejected below
    // (for example when the address is outside the delivery radius).
    if (validatedCouponId !== null) {
      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(validatedCouponId);
    }

    // Decrement stock in database
    for (const stockUpdate of itemsToUpdateStock) {
      const isAvailable = stockUpdate.newQty > 0 ? 1 : 0;
      db.prepare('UPDATE menu_items SET available_qty = ?, is_available = ? WHERE id = ?')
        .run(stockUpdate.newQty, isAvailable, stockUpdate.id);

      if (isAvailable === 0) {
        const itemUpdated = { ...stockUpdate.dbItem, available_qty: 0, is_available: 0 };
        emitItemAvailabilityChanged(itemUpdated);
      }
    }

    // Insert Order record
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_number, user_id, customer_name, customer_phone, order_type,
        address_json, items_json, item_total, discount_amount, coupon_code,
        delivery_fee, tax_amount, grand_total, payment_method, payment_status,
        status, estimated_delivery_mins, special_instructions, delivery_distance_km
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Ensure user_id is set for logged-in customers
    const orderUserId = req.user && req.user.role === 'customer' ? req.user.id : userId;

    // Generate unique order number with collision handling
    let orderNumber;
    let result;
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      orderNumber = generateOrderNumber();
      attempts++;
      try {
        result = insertOrder.run(
          orderNumber,
          orderUserId,
          customer_name.trim(),
          customer_phone.trim(),
          order_type || 'delivery',
          JSON.stringify(address || {}),
          JSON.stringify(validatedItems),
          calculatedItemTotal,
          discountAmount,
          validatedCouponCode,
          deliveryFee,
          taxAmount,
          grandTotal,
          payment_method,
          initialPaymentStatus,
          initialStatus,
          order_type === 'pickup' ? 20 : 35,
          special_instructions || '',
          deliveryDistanceKm
        );
        // Success - break out of retry loop
        break;
      } catch (e) {
        // If UNIQUE constraint failed on order_number, retry with new number
        if (e.message && e.message.includes('UNIQUE constraint failed: orders.order_number')) {
          if (attempts >= maxAttempts) {
            throw new Error('Failed to generate unique order number after multiple attempts');
          }
          continue; // retry with new order number
        }
        throw e; // re-throw other errors
      }
    }

    const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
    if (idempotencyKey) {
      db.prepare('INSERT INTO order_idempotency_keys (key, order_id) VALUES (?, ?)').run(idempotencyKey, result.lastInsertRowid);
    }
    createdOrder.items = JSON.parse(createdOrder.items_json);
    createdOrder.address = JSON.parse(createdOrder.address_json);
    // Echo the authoritative pricing decision so the receipt shows exactly what
    // was charged and why.
    createdOrder.delivery_quote = deliveryQuote
      ? {
          distanceKm: deliveryQuote.distanceKm,
          fee: deliveryQuote.fee,
          maxKm: deliveryQuote.maxKm,
          freeDelivery: deliveryQuote.freeDelivery
        }
      : null;

    return createdOrder;
  });

  try {
    let order = executeOrderTransaction();

    // Open the tracking timeline and seed the first ETA, so the customer sees a
    // real estimate from the moment the order exists rather than after the first
    // status change.
    try {
      recordHistory(order.id, order.status, { name: order.customer_name, role: 'customer' }, 'Order placed');
      refreshEta(getOrder(order.id));
      // Re-read: the ETA is written after the insert, and both the socket event
      // and the HTTP response should carry it rather than a null estimate.
      // The pricing echo is kept, because the receipt quotes it back to the customer.
      order = { ...getOrder(order.id), delivery_quote: order.delivery_quote };
    } catch (trackError) {
      console.error('ORDER TRACKING INIT ERROR:', trackError);
    }

    // Emit notifications safely. A socket notification must never prevent
    // the HTTP order response from reaching the customer.
    // Always notify kitchen and admin for ALL new orders regardless of payment method.
    try {
      emitOrderCreated(order);
    } catch (socketError) {
      console.error('ORDER SOCKET NOTIFICATION ERROR:', socketError);
    }

    return res.status(201).json(order);
  } catch (err) {
    if (idempotencyKey && err && /UNIQUE constraint failed: order_idempotency_keys\.key/i.test(err.message || '')) {
      const existing = db.prepare('SELECT order_id FROM order_idempotency_keys WHERE key = ?').get(idempotencyKey);
      if (existing) {
        const existingOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(existing.order_id);
        if (existingOrder) {
          existingOrder.items = JSON.parse(existingOrder.items_json || '[]');
          existingOrder.address = JSON.parse(existingOrder.address_json || '{}');
          return res.status(200).json(existingOrder);
        }
      }
    }
    // A refusal raised inside the transaction is an expected answer, not a fault.
    if (err instanceof OrderRejectedError) {
      return res.status(err.status).json(err.payload);
    }
    console.error('ORDER CREATE ERROR:', err);
    return res.status(400).json({ success: false, error: err.message || 'Failed to create order' });
  }
});

// Get user's own orders
router.get('/my-orders', authMiddleware, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE user_id = ? OR customer_phone = ?
      ORDER BY id DESC
    `).all(req.user.id, req.user.phone);

    const formatted = orders.map(o => ({
      ...o,
      items: JSON.parse(o.items_json || '[]'),
      address: JSON.parse(o.address_json || '{}')
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single order for tracking
// Real order totals, so the admin badge reflects the database rather than the
// size of the page it happens to have loaded. Registered before `/:idOrNumber`.
router.get('/stats', authMiddleware, requireRole(['admin', 'chef']), (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
    const byStatus = {};
    for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all()) {
      byStatus[row.status] = row.c;
    }
    res.json({ total, byStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A single order. The token is optional only in the sense that a missing one is
// not a 401 at the middleware: it still has to pass canViewOrder, which denies
// anyone who is neither staff nor the owner. Reading an order exposes a phone
// number and a home address, so an anonymous caller is refused here.
router.get('/:idOrNumber', optionalAuthMiddleware, (req, res) => {
  try {
    const order = resolveOrderRow(req.params.idOrNumber);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (!canViewOrder(req, order)) {
      return res.status(403).json({ error: 'You can only view your own orders' });
    }

    order.items = JSON.parse(order.items_json || '[]');
    order.address = JSON.parse(order.address_json || '{}');

    // Get review if exists. The customer form checks this before it opens, so
    // an already-reviewed order is never offered for review twice.
    const review = db.prepare('SELECT * FROM reviews WHERE order_id = ?').get(order.id);
    order.review = review || null;

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin & Kitchen: List all orders with filters
// Deliberately not a rider route. This is the whole shop's book - names, phones,
// addresses - and the rider app reads only its own work from /api/rider. Letting a
// rider in here would hand every delivery rider the full customer list.
router.get('/', authMiddleware, requireRole(['admin', 'chef']), (req, res) => {
  try {
    const { status, type, limit, search } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (type && type !== 'all') {
      query += ' AND order_type = ?';
      params.push(type);
    }

    // Searching every stored order, not just the most recent page, so an older
    // order is still findable by its number. The `#` prefix is optional.
    const term = normaliseOrderNumber(search);
    if (term) {
      const like = `%${term}%`;
      query += ` AND (
        UPPER(order_number) LIKE ?
        OR UPPER(COALESCE(customer_name, '')) LIKE ?
        OR COALESCE(customer_phone, '') LIKE ?
        OR UPPER(COALESCE(items_json, '')) LIKE ?
      )`;
      params.push(like, like, like, like);
    }

    query += ' ORDER BY id DESC';
    if (limit) {
      // Clamped so a hand-typed limit cannot ask for the whole table.
      query += ' LIMIT ?';
      params.push(Math.min(Math.max(parseInt(limit, 10) || 0, 1), 5000));
    }

    const orders = db.prepare(query).all(...params);

    res.json(orders.map(formatOrder));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update order status.
//
// Every transition goes through the tracking service, which validates the move
// against the order's flow, checks the caller's role on the server, writes the
// history row and recomputes the ETA. The client cannot set an arbitrary status.
router.patch('/:id/status', authMiddleware, requireRole(['admin', 'chef', 'rider']), (req, res) => {
  try {
    const { status } = req.body;
    const result = applyStatusChange({
      orderId: req.params.id,
      to: status,
      actor: { id: req.user.id, name: req.user.name, role: req.user.role },
      note: req.body.note || null
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    // Fan out to every screen: customer tracker, admin, kitchen and rider.
    // The database write has already happened, so this only announces it.
    const tracked = trackingPayload(result.order);
    const changeContext = {
      changedBy: req.user?.name || null,
      changedByRole: req.user?.role || null,
      note: result.order?.status || null
    };
    emitOrderStatusUpdated(tracked, changeContext);

    // A rider is told they have been given this order, and told separately that
    // they no longer have whatever they were carrying before. Both happen only
    // after the write has committed.
    if (result.assignment) {
      emitRiderAssigned(tracked, { rider: result.assignment, method: result.assignment.method || 'auto', note: 'Rider auto-assigned' });
    }
    // The rider's own notice for this stage, pushed to their own room. The row was
    // written in the same commit as the status; this is what puts it on their
    // screen now instead of on their next refresh. Without it the feed is a thing
    // the app has to go and fetch whenever it happens to think to.
    if (result.notice) emitRiderNotice(result.notice);
    if (result.releasedRiderId) {
      emitRiderReleased(tracked, { riderId: result.releasedRiderId, reason: `Order ${tracked.status}` });
    }
    // A ready delivery nobody could take is a queue, and the admin board is told
    // so in words instead of being left to read a missing rider as a fault.
    if (tracked.awaitingRider) {
      emitRiderNeeded(tracked, { reasons: tracked.waitingReasons || [] });
    }

    if (['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(tracked.status)) {
      // A freed rider can take an order that has been waiting.
      for (const a of retryPendingAssignments()) {
        const filled = trackingPayload(getOrder(a.order_id));
        emitOrderStatusUpdated(filled, { note: 'Rider auto-assigned' });
        emitRiderAssigned(filled, { rider: a, method: 'auto', note: 'Rider auto-assigned' });
      }
    }

    res.json(tracked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assign a rider to an order.
//
// One service call, whether an admin is handing the order over or a rider is
// claiming it from the counter. The service checks the order is a home delivery
// that is actually ready for a rider, that nobody else has it, and that the rider
// is free to take it; then it writes the order, the history row and the rider's
// state together. The route never touches `rider_id` itself, so there is no
// second path that can skip those checks.
router.post('/:id/assign-rider', authMiddleware, requireRole(['admin', 'rider']), (req, res) => {
  try {
    // A rider can only ever assign themselves. An admin may name a rider.
    const riderId = req.user.role === 'rider'
      ? req.user.id
      : parseInt(req.body.rider_id, 10);
    if (!Number.isInteger(riderId)) {
      return res.status(400).json({ error: 'A rider must be given' });
    }

    const result = assignRider({
      orderId: req.params.id,
      riderId,
      actor: { id: req.user.id, name: req.user.name, role: req.user.role },
      note: req.body.note || (req.user.role === 'rider' ? 'Claimed by rider' : 'Assigned by admin')
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const tracked = trackingPayload(result.order);
    // Only announce a real change. A rider who taps their own order twice must
    // not make every other screen flash an update that says nothing. Every emit
    // here is after the assignment transaction has committed.
    if (!result.alreadyAssigned) {
      emitOrderStatusUpdated(tracked, { note: 'Rider assigned' });
      emitRiderAssigned(tracked, {
        rider: result.assignment,
        method: result.assignment?.method || (req.user.role === 'rider' ? 'claim' : 'manual'),
        note: 'Rider assigned'
      });
    }
    res.json(tracked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full live-tracking payload: status, flow, history, ETA and rider distances.
// This is what the customer tracker polls as its socket fallback, and what it
// re-reads after a reconnect, so it has to be answerable from the database alone.
router.get('/:id/track', optionalAuthMiddleware, (req, res) => {
  try {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // A customer may only follow their own order.
    if (!canViewOrder(req, order)) {
      return res.status(403).json({ error: 'You can only view your own orders' });
    }
    res.json(trackingPayload(order));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rider device position. Stored as the rider's current point, and used to
// advance the order automatically when a geofence is crossed.
router.post('/:id/rider-location', authMiddleware, requireRole(['rider', 'admin']), (req, res) => {
  try {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (req.user.role === 'rider' && order.rider_id !== req.user.id) {
      return res.status(403).json({ error: 'This order is assigned to another rider' });
    }

    const result = recordRiderLocation({
      riderId: req.user.role === 'rider' ? req.user.id : order.rider_id,
      lat: req.body.lat,
      lng: req.body.lng,
      orderId: order.id
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const tracked = result.order ? trackingPayload(result.order) : null;
    if (tracked) {
      emitRiderLocation(tracked);
      // A geofence crossing advanced the stage, so the new status is announced
      // only after that write has already been persisted.
      if (result.advanced) {
        emitOrderStatusUpdated(tracked, {
          changedBy: req.user?.name || 'Rider GPS',
          changedByRole: req.user?.role || 'rider',
          note: 'Advanced by rider location'
        });
      }
    }
    res.json({ ok: true, advanced: result.advanced, order: tracked });
  } catch (err) {
    console.error('RIDER LOCATION ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// A rider's working state: OFFLINE, ONLINE, AVAILABLE or BUSY.
//
// The four states replace the old two-value availability flag, because "signed
// out" and "signed in but carrying three orders" are different situations that
// both used to read as "not available". Coming back online retries anything that
// has been waiting; going offline hands back whatever the rider was carrying,
// since a signed-out rider is the only actor allowed to advance those orders.
router.post('/rider/state', authMiddleware, requireRole(['rider', 'admin']), (req, res) => {
  try {
    const riderId = req.user.role === 'rider' ? req.user.id : parseInt(req.body.rider_id, 10);
    if (!riderId) return res.status(400).json({ error: 'Rider id required' });

    const result = setRiderState({ riderId, state: req.body.state });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    // Anything handed back or newly assigned is now visible to other screens, so
    // each of those orders is announced after its write has landed.
    for (const id of result.returned) {
      const back = trackingPayload(getOrder(id));
      emitOrderStatusUpdated(back, { note: 'Rider went offline' });
      // The rider who lost it, and the customer who was following it, are both
      // told the delivery is no longer theirs to run.
      emitRiderReleased(back, { riderId, reason: 'Rider went offline' });
    }
    for (const a of result.assigned) {
      const filled = trackingPayload(getOrder(a.order_id));
      emitOrderStatusUpdated(filled, { note: 'Rider auto-assigned' });
      emitRiderAssigned(filled, { rider: a, method: 'auto', note: 'Rider auto-assigned' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The rider's own work list.
//
// This is rider-scoped on the server. The rider app used to fetch the whole admin
// order list and filter it in the browser, which put every delivery in the
// building on the rider's phone and hid the orders actually assigned to them,
// because assignment moves an order to RIDER_ASSIGNED - a stage that filter did
// not include.
router.get('/rider/queue', authMiddleware, requireRole(['rider', 'admin']), (req, res) => {
  try {
    const riderId = req.user.role === 'rider' ? req.user.id : parseInt(req.query.rider_id, 10);
    if (!riderId) return res.status(400).json({ error: 'Rider id required' });

    const queue = riderQueue(riderId);
    if (!queue) return res.status(404).json({ error: 'Rider not found' });
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The old two-value toggle, kept working for the existing rider screen.
router.post('/rider/availability', authMiddleware, requireRole(['rider', 'admin']), (req, res) => {
  try {
    const riderId = req.user.role === 'rider' ? req.user.id : parseInt(req.body.rider_id, 10);
    if (!riderId) return res.status(400).json({ error: 'Rider id required' });

    const result = setRiderAvailability({ riderId, available: !!req.body.available });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    for (const id of result.returned || []) {
      const back = trackingPayload(getOrder(id));
      emitOrderStatusUpdated(back, { note: 'Rider went offline' });
      emitRiderReleased(back, { riderId, reason: 'Rider went offline' });
    }
    for (const a of result.assigned) {
      const filled = trackingPayload(getOrder(a.order_id));
      emitOrderStatusUpdated(filled, { note: 'Rider auto-assigned' });
      emitRiderAssigned(filled, { rider: a, method: 'auto', note: 'Rider auto-assigned' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Riders the admin may choose from, with their live state, load and eligibility.
//
// `eligible` and `ineligibleReason` are the same verdict the auto-assigner uses,
// computed by the same code, so what the admin screen shows and what the server
// will actually do cannot disagree - which is the failure that makes an admin
// watch a rider she is told is free, and then see the order go to somebody else.
// Admin only.
//
// This was open to `rider` as well, which handed every rider the entire fleet:
// every colleague's name, phone number and live GPS position, plus who is carrying
// which order and how much work each of them has taken. A rider needs their own
// state, which `/api/rider/*` already gives them; the fleet is a management view.
router.get('/rider/fleet', authMiddleware, requireRole(['admin']), (req, res) => {
  try {
    // The shape is built in the service, beside the same rider_presence and
    // orders rows every other rider read uses, so the admin board cannot drift
    // away from what the assigner actually sees.
    res.json(adminRiderFleet());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Has this order already been reviewed? The feedback form asks before it opens,
// so a customer who already reviewed is told so instead of being shown a form
// that can only fail.
router.get('/:id/review', optionalAuthMiddleware, (req, res) => {
  try {
    const order = resolveOrderRow(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!canViewOrder(req, order)) {
      return res.status(403).json({ error: 'You can only view your own orders' });
    }
    const review = db.prepare('SELECT * FROM reviews WHERE order_id = ?').get(order.id) || null;
    res.json({
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      // Only a finished order can be reviewed - this is the same rule the
      // submit endpoint enforces, exposed up front so the UI agrees with it.
      canReview: ['DELIVERED', 'COMPLETED'].includes(order.status),
      review
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer submit 1-5 Star Review
router.post('/:id/review', optionalAuthMiddleware, (req, res) => {
  try {
    const { rating, comment, customer_name } = req.body;
    const order = resolveOrderRow(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // The order must belong to the caller. Checking this is what stops one
    // customer reviewing another customer's meal by changing the id in the URL.
    if (!canViewOrder(req, order)) {
      return res.status(403).json({ error: 'You can only review your own orders' });
    }
    // DELIVERED and COMPLETED are the same terminal state everywhere else in the
    // app (admin counts them together, and the customer is prompted for both), so
    // both have to be reviewable here or the prompt leads to a dead end.
    if (!['DELIVERED', 'COMPLETED'].includes(order.status)) {
      return res.status(400).json({ error: 'Can only review delivered orders' });
    }

    const existing = db.prepare('SELECT * FROM reviews WHERE order_id = ?').get(order.id);
    if (existing) {
      return res.status(400).json({ error: 'You have already reviewed this order', review: existing });
    }

    // A rating outside 1-5 is rejected rather than silently coerced, so a broken
    // client cannot write a value the admin star display cannot render.
    const stars = Number(rating);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
    }

    const name = customer_name || order.customer_name;
    const userId = req.user ? req.user.id : order.user_id;

    // The unique index on reviews(order_id) is the real guard against a second
    // review - two taps can both pass the check above before either inserts.
    let result;
    try {
      result = db.prepare(`
        INSERT INTO reviews (order_id, user_id, customer_name, rating, comment)
        VALUES (?, ?, ?, ?, ?)
      `).run(order.id, userId, name, stars, (comment || '').trim());
    } catch (insertError) {
      if (String(insertError.message || '').includes('UNIQUE')) {
        const raceWinner = db.prepare('SELECT * FROM reviews WHERE order_id = ?').get(order.id);
        return res.status(400).json({ error: 'You have already reviewed this order', review: raceWinner });
      }
      throw insertError;
    }

    const newReview = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);
    // Admin Reviews reads the same row, so it only needs telling that one exists.
    try {
      emitReviewCreated({ ...newReview, order_number: order.order_number });
    } catch (socketError) {
      // A socket failure must not fail the review the customer just saved.
    }
    res.status(201).json(newReview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
