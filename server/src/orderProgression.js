import { db } from './db.js';
import { applyStatusChange } from './orderTrackingService.js';

/**
 * Optional demo timer.
 *
 * This only ever advances the stages that represent time passing in the kitchen.
 * It stops at READY / READY_FOR_PICKUP and never marks an order delivered:
 * a delivery is a real rider's work, and a pickup is the customer's, so
 * inventing either one would tell the customer their food arrived when it had not
 * - and would open the feedback prompt for an order that was never eaten.
 *
 * Every step goes through `applyStatusChange`, so the same validation and the
 * same status history apply as for a kitchen or rider action. Nothing is written
 * with raw SQL here.
 */
const KITCHEN_STEPS = [
  { from: 'ORDER_CONFIRMED', to: 'PREPARING' },
  { from: 'PREPARING', to: 'READY' },
  { from: 'PREPARING', to: 'READY_FOR_PICKUP' }
];

// Delay after an order enters `from` before it is moved to `to`.
const DEV_DELAY_MS = 6 * 1000;
const PROD_DELAY_MS = 3 * 60 * 1000;

const isDev = process.env.NODE_ENV !== 'production';
const DELAY_MS = isDev ? DEV_DELAY_MS : PROD_DELAY_MS;

/**
 * Off unless explicitly asked for. `ORDER_AUTO_PROGRESS=1` enables it.
 * A demo aid must never drive real orders behind the operator's back.
 */
const ENABLED = process.env.ORDER_AUTO_PROGRESS === '1' || process.env.ORDER_AUTO_PROGRESS === 'true';

let timerHandle = null;

function advanceOrder(order, step) {
  const result = applyStatusChange({
    orderId: order.id,
    to: step.to,
    actor: { id: null, name: 'Kitchen (auto)', role: 'chef' },
    note: 'Advanced by the demo timer',
    allowSystem: true,
    method: 'auto'
  });
  if (!result.ok) {
    console.warn(`[OrderProgression] #${order.id} ${order.status} -> ${step.to} refused: ${result.error}`);
  }
  return result;
}

function tick() {
  try {
    for (const step of KITCHEN_STEPS) {
      // `created_at` is stored in UTC by SQLite's CURRENT_TIMESTAMP, so the cut-off
      // is compared in UTC too. Mixing in localtime advanced orders far too early.
      const cutoff = new Date(Date.now() - DELAY_MS).toISOString().replace('T', ' ').slice(0, 19);
      const orders = db.prepare(`
        SELECT * FROM orders
        WHERE status = ? AND created_at <= ?
          AND status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED')
      `).all(step.from, cutoff);

      for (const order of orders) {
        // A pickup order never enters the home-delivery kitchen stages and vice versa.
        if (step.to === 'READY' && order.order_type !== 'delivery') continue;
        if (step.to === 'READY_FOR_PICKUP' && order.order_type !== 'pickup') continue;
        advanceOrder(order, step);
      }
    }
  } catch (err) {
    console.error('ORDER PROGRESSION TICK ERROR:', err.message);
  }
}

export function startOrderProgression(intervalMs = 15000) {
  if (!ENABLED) {
    console.log('[OrderProgression] Demo timer off (set ORDER_AUTO_PROGRESS=1 to enable kitchen auto-advance)');
    return;
  }
  if (timerHandle) return;
  timerHandle = setInterval(tick, intervalMs);
  console.log(`[OrderProgression] Kitchen auto-advance enabled (${isDev ? 'DEV' : 'PROD'} timeline, tick every ${intervalMs}ms)`);
}

export function stopOrderProgression() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}
