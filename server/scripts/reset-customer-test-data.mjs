/**
 * ONE-TIME test-data reset. Run it by hand, once, and delete it afterwards.
 *
 *   node scripts/reset-customer-test-data.mjs --confirm
 *
 * This is deliberately NOT wired into `server.js` or any startup path. A reset
 * that ran on boot would wipe real orders the next time the process restarted,
 * which is the one thing it must never do.
 *
 * What it removes: every customer account, every order, the status history and
 * reviews hanging off those orders, the daily order counters, and stale OTP rows.
 *
 * What it keeps: staff and admin accounts, rider presence, the menu, categories,
 * coupons, settings, and the schema itself.
 *
 * `--confirm` is required. Without it the script reports what it would delete and
 * exits, so the effect can be read before it happens.
 */
import fs from 'fs';
import path from 'path';
import { db } from '../src/db.js';

// The database file lives next to this project, not in scripts/.
const DB_PATH = path.resolve('hotel_darshan.db');
const CONFIRMED = process.argv.includes('--confirm');

const TABLES_KEPT = ['menu_items', 'categories', 'coupons', 'settings', 'rider_presence'];

function counts() {
  return {
    users_total: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    users_staff: db.prepare("SELECT COUNT(*) n FROM users WHERE role IN ('admin','chef','rider')").get().n,
    users_customer: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'customer'").get().n,
    orders: db.prepare('SELECT COUNT(*) n FROM orders').get().n,
    order_status_history: db.prepare('SELECT COUNT(*) n FROM order_status_history').get().n,
    reviews: db.prepare('SELECT COUNT(*) n FROM reviews').get().n,
    notifications: db.prepare('SELECT COUNT(*) n FROM notifications').get().n,
    otp_verifications: db.prepare('SELECT COUNT(*) n FROM otp_verifications').get().n,
    order_counters: db.prepare('SELECT COUNT(*) n FROM order_counters').get().n,
    rider_presence: db.prepare('SELECT COUNT(*) n FROM rider_presence').get().n,
    menu_items: db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,
    categories: db.prepare('SELECT COUNT(*) n FROM categories').get().n,
    coupons: db.prepare('SELECT COUNT(*) n FROM coupons').get().n,
    settings: db.prepare('SELECT COUNT(*) n FROM settings').get().n
  };
}

const before = counts();

console.log('========== WHAT THIS WILL DELETE ==========\n');
console.table([
  { table: 'users (role=customer)', rows: before.users_customer },
  { table: 'orders', rows: before.orders },
  { table: 'order_status_history', rows: before.order_status_history },
  { table: 'reviews', rows: before.reviews },
  { table: 'notifications', rows: before.notifications },
  { table: 'otp_verifications', rows: before.otp_verifications },
  { table: 'order_counters', rows: before.order_counters }
]);

console.log('\n========== WHAT WILL SURVIVE ==========\n');
console.table([
  { table: 'users (admin/chef/rider)', rows: before.users_staff },
  { table: 'rider_presence', rows: before.rider_presence },
  { table: 'menu_items', rows: before.menu_items },
  { table: 'categories', rows: before.categories },
  { table: 'coupons', rows: before.coupons },
  { table: 'settings', rows: before.settings }
]);
console.log('\n  staff accounts kept:');
console.table(db.prepare("SELECT id, name, phone, role FROM users WHERE role IN ('admin','chef','rider') ORDER BY id").all());

if (!CONFIRMED) {
  console.log('\n  DRY RUN. Nothing was deleted.');
  console.log('  Re-run with --confirm to actually do it.');
  process.exit(0);
}

// --------------------------------------------------------------- backup
// Taken before the first DELETE, not after. A backup written afterwards is a
// backup of whatever the script managed to leave behind.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.resolve(process.env.TEMP || '.', `hotel_darshan.before-reset.${stamp}.db`);
db.pragma('wal_checkpoint(TRUNCATE)');
fs.copyFileSync(DB_PATH, backupPath);
console.log(`\n  backup written: ${backupPath} (${fs.statSync(backupPath).size} bytes)`);

// --------------------------------------------------------------- delete
// Ordered so that nothing is ever orphaned. Three of these would also be handled
// by ON DELETE CASCADE, but they are deleted explicitly so the script is correct
// whether or not foreign keys are enforced, and so the intended order is visible
// rather than implied.
const run = db.transaction(() => {
  // A rider holding an order that is about to disappear should stop pointing at
  // it, or the rider app would be holding the id of an order that no longer exists.
  db.prepare('UPDATE rider_presence SET active_order_id = NULL WHERE active_order_id IS NOT NULL').run();

  db.prepare('DELETE FROM order_status_history').run();
  db.prepare('DELETE FROM reviews').run();
  db.prepare('DELETE FROM notifications').run();

  // Reviews and history are gone, so the orders they described can go too.
  db.prepare('DELETE FROM orders').run();

  // Only customers. The WHERE clause names the role rather than a list of ids, so
  // a staff account cannot be caught by this even if an id were misread.
  db.prepare("DELETE FROM users WHERE role = 'customer'").run();

  db.prepare('DELETE FROM order_counters').run();
  db.prepare('DELETE FROM otp_verifications').run();
});

try {
  run();
} catch (error) {
  console.error('\n  RESET FAILED and was rolled back:', error.message);
  console.error(`  The database is unchanged. Backup: ${backupPath}`);
  process.exit(1);
}

// --------------------------------------------------------------- verify
const after = counts();

console.log('\n========== AFTER ==========\n');
console.table([
  { table: 'users (role=customer)', before: before.users_customer, after: after.users_customer, gone: before.users_customer - after.users_customer },
  { table: 'orders', before: before.orders, after: after.orders, gone: before.orders - after.orders },
  { table: 'order_status_history', before: before.order_status_history, after: after.order_status_history, gone: before.order_status_history - after.order_status_history },
  { table: 'reviews', before: before.reviews, after: after.reviews, gone: before.reviews - after.reviews },
  { table: 'notifications', before: before.notifications, after: after.notifications, gone: before.notifications - after.notifications },
  { table: 'otp_verifications', before: before.otp_verifications, after: after.otp_verifications, gone: before.otp_verifications - after.otp_verifications },
  { table: 'order_counters', before: before.order_counters, after: after.order_counters, gone: before.order_counters - after.order_counters }
]);

console.log('\n========== PRESERVED (must be unchanged) ==========\n');
const preserved = [
  { table: 'users (admin/chef/rider)', before: before.users_staff, after: after.users_staff },
  { table: 'rider_presence', before: before.rider_presence, after: after.rider_presence },
  { table: 'menu_items', before: before.menu_items, after: after.menu_items },
  { table: 'categories', before: before.categories, after: after.categories },
  { table: 'coupons', before: before.coupons, after: after.coupons },
  { table: 'settings', before: before.settings, after: after.settings }
];
console.table(preserved);

let problems = 0;
for (const row of preserved) {
  if (row.before !== row.after) {
    console.error(`  CHANGED: ${row.table} ${row.before} -> ${row.after}`);
    problems++;
  }
}
for (const t of TABLES_KEPT) {
  if (!db.prepare(`SELECT 1 FROM "${t}" LIMIT 1`).get() && before[t] > 0) {
    console.error(`  EMPTIED: ${t}`);
    problems++;
  }
}

const emptied = ['orders', 'order_status_history', 'reviews', 'notifications', 'otp_verifications', 'order_counters'];
for (const t of emptied) {
  const n = db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
  if (n !== 0) {
    console.error(`  NOT EMPTY: ${t} still has ${n} rows`);
    problems++;
  }
}

const customersLeft = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'customer'").get().n;
if (customersLeft !== 0) {
  console.error(`  NOT EMPTY: ${customersLeft} customer accounts remain`);
  problems++;
}

console.log('\n  integrity_check     :', db.pragma('integrity_check', { simple: true }));
console.log('  foreign_key_check   :', db.pragma('foreign_key_check').length, 'violations');

console.log('\n  staff accounts now:');
console.table(db.prepare("SELECT id, name, phone, role FROM users ORDER BY id").all());

console.log(`\n  Backup kept at: ${backupPath}`);
console.log(problems === 0 ? '\n  RESULT: reset complete, everything as expected.' : `\n  RESULT: ${problems} problem(s) - review the output above.`);
process.exit(problems === 0 ? 0 : 1);
