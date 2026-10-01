import Database from 'better-sqlite3';
const db = new Database('C:\\Users\\Vasava Megha\\OneDrive\\Desktop\\Zip\\Hotel-Darshan-AccountSettings-Modified\\Food DeliveryApp\\server\\hotel_darshan.db', { readonly: true });
const rows = db.prepare('SELECT id, order_number, grand_total, payment_status FROM orders ORDER BY id DESC LIMIT 5').all();
for (const r of rows) {
  console.log(`id=${r.id} order_number=${r.order_number} grand_total=${r.grand_total} payment_status=${r.payment_status}`);
}