import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hotelDarshanCategories, hotelDarshanMenuItems } from './menuData.js';
// staffIdentity takes the database as an argument rather than importing it, so
// this direction has no cycle: the migration below can ask how a mobile number
// normalises without pulling the whole database module back into itself.
import { normaliseMobile } from './staffIdentity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// The override lets a test run against a throwaway copy of the database instead of
// the live one, so verification never writes to real orders.
const dbPath = process.env.HOTEL_DARSHAN_DB || path.join(__dirname, '..', 'hotel_darshan.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Give a rider their explicit starting state.
 *
 * Called when a rider account is created as well as during migration, because a
 * rider made after startup would otherwise have no row at all - and a missing row
 * reads as "not a real state", which is exactly what the rider state column
 * exists to remove. New riders start OFFLINE: they have to sign in themselves
 * before the assigner will give them an order.
 */
export function ensureRiderPresence(riderId) {
  db.prepare(`
    INSERT INTO rider_presence (rider_id, is_available, rider_state)
    VALUES (?, 0, 'OFFLINE')
    ON CONFLICT(rider_id) DO NOTHING
  `).run(riderId);
}

/**
 * Let one mobile number carry a staff row and a customer row at the same time.
 *
 * The `users` table said `phone TEXT UNIQUE`, which made a number belong to one
 * row and one row only. That is the wrong rule for this business: someone can
 * work at the hotel and order from it, and those are two separate identities
 * reached through two separate sign-in flows. Under the old rule a rider with no
 * customer row could not register one at all, and the customer screen answered
 * that by refusing them - answering a question nobody asked, instead of simply
 * looking for a customer account.
 *
 * The rebuild preserves every column, every id and every value. Ids matter: 377
 * orders point at `users.id`, and `rider_presence` cascades from it, so handing
 * out new ids would silently orphan real history.
 *
 * Foreign keys are suspended for the duration because SQLite refuses to rename a
 * table another table still references. They are restored in a `finally`, and
 * the caller re-checks integrity afterwards.
 */
function migratePhoneUniquenessToPerRole() {
  const columns = db
    .prepare(`SELECT name FROM pragma_table_info('users')`)
    .all()
    .map((r) => r.name);

  // Already migrated: no column-level UNIQUE left on phone.
  const phoneIsUnique = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`)
    .get()
    .sql.match(/phone\s+TEXT\s+UNIQUE/i);

  if (!phoneIsUnique) return;

  // Every column is carried across by name rather than restated, so a column added
  // by a later migration is not silently dropped by this one.
  const carried = columns.map((c) => `"${c}"`).join(', ');

  const hadForeignKeys = db.pragma('foreign_keys', { simple: true });
  try {
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');

    db.exec(`
      CREATE TABLE users_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password_hash TEXT,
        name TEXT NOT NULL,
        phone TEXT,
        role TEXT NOT NULL DEFAULT 'customer',
        addresses_json TEXT DEFAULT '[]',
        favorites_json TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1,
        phone_verified INTEGER DEFAULT 0,
        deleted_at DATETIME,
        updated_at DATETIME
      )
    `);

    db.exec(`INSERT INTO users_migrated (${carried}) SELECT ${carried} FROM users`);

    // Drop the global index before the rename; it is recreated below in its new,
    // narrower form. Leaving it in place would fail against the renamed table.
    db.exec('DROP INDEX IF EXISTS idx_users_phone');
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_migrated RENAME TO users');

    // Dropping the table also dropped every index that lived on it, including
    // idx_users_staff_mobile - so the "one staff row per number" rule would be
    // unenforced until something happened to re-create it. That index is also
    // built later in initDatabase, but only on a later run: between here and then
    // two staff records could share a number, and the rider add-account check
    // would be the only thing standing in the way. Recreate it now so the rule
    // never has a gap.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_mobile
      ON users (phone)
      WHERE role IN ('admin','chef','rider') AND deleted_at IS NULL AND phone IS NOT NULL AND TRIM(phone) != ''
    `);

    // One live customer row per number. Partial on deleted_at because a closed
    // account keeps the number on the record for history but is not holding it.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_customer_mobile
      ON users (phone)
      WHERE role = 'customer' AND deleted_at IS NULL AND phone IS NOT NULL AND TRIM(phone) != ''
    `);

    db.exec('COMMIT');
    console.log('[db] phone uniqueness is now per-role: a number may be both staff and customer');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* nothing to roll back */
    }
    throw e;
  } finally {
    db.pragma(`foreign_keys = ${hadForeignKeys ? 'ON' : 'OFF'}`);
  }
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      name TEXT NOT NULL,
       phone TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'customer',
      addresses_json TEXT DEFAULT '[]',
      favorites_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'registration',
      verified INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verifications(phone);
    CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_verifications(expires_at);
  `);

  // Create every remaining table before any migration code runs. On a fresh
  // database these tables do not exist yet, and the migrations below assume
  // they do (settings is queried at the tracking-setting seed, reviews is
  // cleaned before the unique index, order_status_history and rider_presence
  // reference orders and users through foreign keys). Creating them up front
  // makes initDatabase safe on a brand-new database while remaining a no-op
  // on every existing one because every statement uses IF NOT EXISTS.
  db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_en TEXT NOT NULL,
        name_hi TEXT NOT NULL,
        name_gu TEXT NOT NULL,
        image_url TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER,
        name_en TEXT NOT NULL,
        name_hi TEXT NOT NULL,
        name_gu TEXT NOT NULL,
        desc_en TEXT,
        desc_hi TEXT,
        desc_gu TEXT,
        ingredients_en TEXT,
        ingredients_hi TEXT,
        ingredients_gu TEXT,
        price REAL NOT NULL,
        discount_price REAL,
        is_veg INTEGER DEFAULT 1,
        prep_time_mins INTEGER DEFAULT 15,
        image_url TEXT,
        is_available INTEGER DEFAULT 1,
        available_qty INTEGER DEFAULT 50,
        is_popular INTEGER DEFAULT 0,
        is_special INTEGER DEFAULT 0,
        customizations_json TEXT DEFAULT '[]',
        rating REAL DEFAULT 4.8,
        review_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        order_type TEXT NOT NULL DEFAULT 'delivery',
        address_json TEXT DEFAULT '{}',
        items_json TEXT NOT NULL,
        item_total REAL NOT NULL,
        discount_amount REAL DEFAULT 0,
        coupon_code TEXT,
        delivery_fee REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        grand_total REAL NOT NULL,
        payment_method TEXT NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'pending',
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        status TEXT NOT NULL DEFAULT 'ORDER_PLACED',
        rider_id INTEGER,
        rider_name TEXT,
        rider_phone TEXT,
        rider_lat REAL,
        rider_lng REAL,
        estimated_delivery_mins INTEGER DEFAULT 30,
        special_instructions TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        discount_type TEXT NOT NULL,
        discount_value REAL NOT NULL,
        min_order_value REAL DEFAULT 0,
        max_discount REAL,
        valid_to DATETIME,
        usage_limit INTEGER DEFAULT 500,
        used_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        item_id INTEGER,
        user_id INTEGER,
        customer_name TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS order_counters (
        counter_date TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
    `);

  // A registration claim is a bearer token, so the only way to stop it being
  // It is stamped when an account is created from the claim, which is what makes
  // the claim single-use rather than a reusable key for the customer's number.
  try {
    db.exec('ALTER TABLE otp_verifications ADD COLUMN consumed_at DATETIME');
  } catch (e) {
    // Column already exists, ignore
  }

  // Add staff active-status column if it doesn't exist (migration)
  try {
    db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1');
  } catch (e) {
    // Column already exists, ignore
  }

  // Add phone_verified column if it doesn't exist (migration)
  try {
    db.exec('ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore
  }

  // Store the delivery distance an order was priced at, so admin order details
  // and the customer receipt always show the distance that was actually used.
  try {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_distance_km REAL');
  } catch (e) {
    // Column already exists, ignore
  }

  // ------------------------------------------------------------------
  // Order tracking: lifecycle timestamps, ETA, status history, rider presence.
  // All additive and idempotent, so an existing install upgrades in place and
  // no existing order, customer or review row is touched.
  // ------------------------------------------------------------------

  const ensureTrackingSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

  // Timestamps for the significant stages. Kept as columns (rather than only in
  // history) so operational queries do not have to aggregate.
  for (const [column, type] of [
    ['eta_minutes', 'INTEGER'],
    ['eta_updated_at', 'DATETIME'],
    ['started_route_at', 'DATETIME'],
    ['rider_arrived_hotel_at', 'DATETIME'],
    ['picked_up_at', 'DATETIME'],
    ['near_customer_at', 'DATETIME'],
    ['delivered_at', 'DATETIME'],
    ['completed_at', 'DATETIME'],
    ['cancelled_at', 'DATETIME'],
    ['completion_method', 'TEXT'],
    ['delivery_lat', 'REAL'],
    ['delivery_lng', 'REAL']
  ]) {
    try {
      db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${type}`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Every status change, with who made it. The database is the source of truth
  // for the timeline; the UI never reconstructs it from local state.
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      changed_by TEXT,
      changed_by_role TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id, id);
  `);

  // One review per order. The route checks for an existing review before
  // inserting, but two taps can both pass that check before either lands, so
  // the database is what actually guarantees a customer cannot review the same
  // meal twice. The index is built on the rows that survive any earlier
  // duplicates, so a legacy double-review cannot block the migration.
  db.exec(`
    DELETE FROM reviews
    WHERE order_id IS NOT NULL
      AND id NOT IN (SELECT MIN(id) FROM reviews WHERE order_id IS NOT NULL GROUP BY order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_order ON reviews(order_id)
      WHERE order_id IS NOT NULL;
  `);

  // Live rider state: availability, last known position and what they are
  // carrying. One row per rider, overwritten rather than appended, so tracking
  // does not grow an unbounded history of GPS fixes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rider_presence (
      rider_id INTEGER PRIMARY KEY,
      is_available INTEGER NOT NULL DEFAULT 1,
      lat REAL,
      lng REAL,
      location_at DATETIME,
      active_order_id INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ------------------------------------------------------------------
  // Rider working state: OFFLINE / ONLINE / AVAILABLE / BUSY.
  //
  // `rider_state` is the single source of truth for whether a rider may be given
  // an order. `is_available` is kept only as a projection of it
  // (available === state === 'AVAILABLE') so older readers keep working; it is
  // never read to make a decision. A rider with no row at all is OFFLINE.
  // ------------------------------------------------------------------
  try {
    db.exec(`ALTER TABLE rider_presence ADD COLUMN rider_state TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  // When a rider attached to an order, as opposed to merely being on the
  // order. Lets the admin and the rider's own history answer "since when".
  try {
    db.exec('ALTER TABLE orders ADD COLUMN assigned_at DATETIME');
  } catch (e) {
    // Column already exists, ignore
  }

  // When the rider first moved the order on themselves - pressed Accept, or took
  // any next step from an assigned order. Distinct from `assigned_at`: being given
  // a job and picking it up are two moments, and the gap between them is how long
  // food sat at the counter before anybody claimed it. Cleared with the
  // assignment, because it belongs to that assignment.
  try {
    db.exec('ALTER TABLE orders ADD COLUMN accepted_at DATETIME');
  } catch (e) {
    // Column already exists, ignore
  }

  // A rider's own notification feed.
  //
  // The socket already announces a new assignment or a cancellation, but an event
  // is only seen by a phone that happened to be connected at the time. This table
  // is what makes the Notifications screen a list of things that actually
  // happened rather than a list of things that happened to arrive while the app
  // was open: a rider who opens the app on a lift, twenty minutes after being
  // given an order, still finds it waiting.
  //
  // Rows are written by the same write path that changes the order, inside the
  // same transaction, so a notification can never describe a status that was
  // rolled back.
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      read_at TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);
  `);

  // Who was carrying an order at the moment it was taken away from them.
  //
  // A cancellation clears `rider_id`, which is how the rider is released - and that
  // erasure meant a cancelled delivery vanished from that rider's history. The
  // rider drove to the hotel, waited, and the order was cancelled: their shift
  // record showed nothing, and the day they are being paid for was short a job they
  // actually attended. The history query even listed CANCELLED and REJECTED, which
  // could never match once the rider had been cleared.
  //
  // So the rider is remembered here when they are let go, and the history reads
  // both columns. `rider_id` stays the single answer to "who is carrying this now" -
  // this column is never consulted for that, only for what a rider did.
  try {
    db.exec('ALTER TABLE orders ADD COLUMN released_rider_id INTEGER');
  } catch (e) {
    // Column already exists, ignore
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_released_rider ON orders(released_rider_id, status);
  `);

  // The rider-facing queries all filter on the rider and then on the stage, and
  // the board filters on stage and type. Without these every lookup is a full
  // scan of `orders`, which is the table that grows.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_rider_status ON orders(rider_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_status_type ON orders(status, order_type);
    CREATE INDEX IF NOT EXISTS idx_orders_number_upper ON orders(UPPER(order_number));
  `);

  // ------------------------------------------------------ staff account state
  //
  // Staff sign in with a mobile number, so a staff row is now an identity that
  // has to be looked up by phone rather than by email, and the number is the one
  // thing that must not be shared between two accounts. Three changes:
  //
  //   deleted_at  - a deleted staff member is a state, not a missing row.
  //   updated_at  - so "when was this account last touched" has an answer.
  //   phone norm  - one form of a number, so a person cannot be added twice by
  //                 typing their number with and without the country code.
  //
  // `deleted_at` is the reason the admin Delete button no longer deletes. Orders
  // name the rider who carried them, and a rider with a shift's worth of history
  // behind them cannot be removed from the table that history points at. The
  // account stops being able to sign in the moment it is deleted, which is what
  // deletion has to mean; the record itself stays, so a delivered order still
  // says who delivered it.
  try {
    db.exec('ALTER TABLE users ADD COLUMN deleted_at DATETIME');
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    // Added as a plain nullable column, then filled in. SQLite refuses a
    // non-constant default - CURRENT_TIMESTAMP is not one - on ADD COLUMN, so the
    // default and the backfill have to be separate steps.
    db.exec('ALTER TABLE users ADD COLUMN updated_at DATETIME');
  } catch (e) {
    // Column already exists, ignore
  }
  db.exec(`
    UPDATE users SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL;
    CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
    AFTER UPDATE ON users
    BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);

  // Put every staff number into the one stored form. Written with the same
  // normaliser the application uses, so what is stored here is exactly what a
  // later comparison will produce.
  const staffRows = db
    .prepare("SELECT id, phone FROM users WHERE role IN ('admin','chef','rider') AND phone IS NOT NULL AND TRIM(phone) != ''")
    .all();
  const setPhone = db.prepare('UPDATE users SET phone = ? WHERE id = ?');
  for (const row of staffRows) {
    const normalised = normaliseMobile(row.phone);
    // Only rewrite when a number was actually recovered. A row whose phone is
    // unreadable keeps what it had, so an admin can see and fix it rather than
    // finding it silently blanked.
    if (normalised && normalised !== row.phone) setPhone.run(normalised, row.id);
  }

  // Two live staff accounts cannot share a number, enforced by the database so
  // two requests arriving together cannot both pass an application check. The
  // index is partial on purpose: a deleted account keeps its number on the record
  // for history, but it is not holding it any more, so it must not block
  // somebody else being added afterwards.
  //
  // If an older database already has a duplicate, the index cannot be created and
  // that is reported rather than swallowed - the application still refuses the
  // duplicate, so this is a warning about the data, not a hole in the rule.
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_mobile
      ON users (phone)
      WHERE role IN ('admin','chef','rider') AND deleted_at IS NULL AND phone IS NOT NULL AND phone != '';
    `);
  } catch (e) {
    console.warn(
      `[db] could not enforce unique staff mobile numbers: ${e.message}. ` +
      'Duplicates will still be refused by the API, but fix the rows listed above.'
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active);
  `);

  // ------------------------------------------------------------------
  // One number = one account *of that kind*, not one account at all.
  //
  // `phone TEXT UNIQUE` and the global `idx_users_phone` said a mobile number
  // belonged to exactly one row in the table, whichever kind. That is wrong:
  // people work at the hotel and order from it, and the two are separate
  // identities. A rider ordering dinner is a rider *and* a customer, and the
  // schema has no way to record that - so a rider with no customer row could
  // not register one, and the sign-in screen answered a question nobody asked by
  // refusing them outright instead of simply looking for a customer account.
  //
  // SQLite cannot drop a column-level UNIQUE, so `users` is rebuilt: every column
  // is carried across with the same values, and ids are preserved because orders,
  // reviews and rider presence all point at them. `PRAGMA foreign_keys` is off for
  // the rebuild, because SQLite would otherwise refuse to rename a table that two
  // other tables still reference, and the references survive the rename by name.
  //
  // The rule this restores is per-role: one live staff row per number, one live
  // customer row per number, and the same number may be in both. Two live staff
  // rows still cannot collide, and two live customer rows still cannot either -
  // that second half is what stops a duplicate customer account being made.
  // ------------------------------------------------------------------
  migratePhoneUniquenessToPerRole();

  // Legacy soft-deleted staff accounts are preserved; only an authorized admin may delete/deactivate them.

  // Backfill rider state from the flag that predates it, once. A rider who was
  // flagged available and carrying an order is BUSY; available with nothing to
  // carry is AVAILABLE; not available is OFFLINE.
  db.exec(`
    UPDATE rider_presence
    SET rider_state = CASE
      WHEN is_available = 0 THEN 'OFFLINE'
      WHEN active_order_id IS NOT NULL THEN 'BUSY'
      ELSE 'AVAILABLE'
    END
    WHERE rider_state IS NULL OR rider_state NOT IN ('OFFLINE','ONLINE','AVAILABLE','BUSY');
  `);

  // A rider still holding an order that has since finished - a delivery, a
  // cancellation - is not busy. Left alone this hides them from assignment
  // forever, because a BUSY rider is never eligible.
  db.exec(`
    UPDATE rider_presence
    SET active_order_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE active_order_id IS NOT NULL
      AND active_order_id NOT IN (
        SELECT id FROM orders
        WHERE status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
      );
  `);

  // Anything still carrying an order is BUSY, and anything that just lost one is
  // AVAILABLE again so it can be given more work.
  db.exec(`
    UPDATE rider_presence
    SET rider_state = CASE
      WHEN is_available = 0 THEN 'OFFLINE'
      WHEN EXISTS (
        SELECT 1 FROM orders o
        WHERE o.rider_id = rider_presence.rider_id
          AND o.status NOT IN ('DELIVERED','COMPLETED','CANCELLED','REJECTED')
      ) THEN 'BUSY'
      ELSE 'AVAILABLE'
    END
    WHERE is_available = 1;
  `);

  // Every rider gets a row so their state is explicit rather than implied by the
  // absence of one. A rider who has never signed in to the app starts OFFLINE
  // and has to go online themselves before being given a delivery.
  for (const r of db.prepare("SELECT id FROM users WHERE role = 'rider'").all()) {
    ensureRiderPresence(r.id);
  }

  // Settings that drive the tracking behaviour. Defaults are conservative and
  // match the values compiled into server/src/orderTracking.js.
  for (const [key, value] of [
    ['rider_near_customer_m', '500'],
    ['rider_hotel_geofence_m', '150'],
    ['prep_time_mins', '15'],
    ['delivery_speed_kmh', '25'],
    ['auto_assign_riders', '1'],
    ['rider_max_active_orders', '1'],
    ['rider_location_required', '0'],
    ['rider_location_max_age_mins', '15'],
    ['rider_recent_load_window_mins', '60']
  ]) {
    ensureTrackingSetting.run(key, value);
  }

  // One rider, one active delivery.
  //
  // This is lowered rather than merely defaulted, because an installation created
  // before the rule existed already holds the old value of 3, and a cap that only
  // applies to new databases would leave the running one quietly handing a rider
  // three orders at once - which is exactly the situation the rider app cannot
  // represent and the reason the rule exists.
  db.prepare(`
    UPDATE settings SET value = '1'
    WHERE key = 'rider_max_active_orders'
      AND (CAST(value AS INTEGER) IS NULL OR CAST(value AS INTEGER) > 1)
  `).run();

  // One phone = one account *of that kind*. The per-role indexes were created by
  // migratePhoneUniquenessToPerRole() (staff) and here (customer).
  //
  // There is deliberately no global index on phone any more. A number may be held
  // by a staff row and a customer row at once, because a person can work at the
  // hotel and order from it. Recreating a global one here would silently undo that
  // and make the second of the two impossible to create.
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_customer_mobile
      ON users (phone)
      WHERE role = 'customer' AND deleted_at IS NULL AND phone IS NOT NULL AND TRIM(phone) != ''
    `);
  } catch (e) {
    // Index creation may fail if duplicate customer phones already exist.
    // The application-level check in authRoutes.js will still prevent
    // new duplicates; this is a best-effort database-level safeguard.
  }

  // Update existing admin user name if it's the old "Darshan Patel" name.
  // Keyed on the real owner email, which is what the account now uses. The old
  // test address is deliberately not looked up: a database that still has it is
  // not this account, and renaming that row would put a real-looking name on
  // somebody else's test record.
  const adminUser = db.prepare('SELECT id, name FROM users WHERE email = ?').get('hoteldarshan9909@gmail.com');
  if (adminUser && adminUser.name && adminUser.name.includes('Darshan Patel')) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run('Vasava Rameshbhai', adminUser.id);
    console.log('Updated admin user name to Vasava Rameshbhai');
  }

  // Older builds auto-generated a fake "mobile_<phone>@hotel-darshan.local"
  // address for customers who registered with name + mobile only. Customer
  // authentication is phone + OTP, so those placeholders are never required.
  // Clear them so the real, optional `email` profile field stays the only
  // source of a visible customer email.
  const clearedGeneratedEmails = db
    .prepare(
      `
      UPDATE users
      SET email = NULL
      WHERE email IS NOT NULL
        AND TRIM(email) <> ''
        AND (
          email LIKE 'mobile|_%@hotel-darshan.local' ESCAPE '|'
          OR email LIKE 'mobile|_%@hotel-darshan' ESCAPE '|'
          OR email LIKE 'mobile|_%@%' ESCAPE '|'
          OR email LIKE 'mobile|_%' ESCAPE '|'
        )
      `
    )
    .run().changes;

  if (clearedGeneratedEmails > 0) {
    console.log(
      `Cleared ${clearedGeneratedEmails} auto-generated customer email(s). Customers now have an empty optional email field.`
    );
  }

  seedData();
  normalizeMenuDatabase();
}

// Keep the database synchronized with the exact Hotel Darshan menu.
// The frontend and backend use the same item IDs, names, prices, flags and category IDs.
// Categories without menu items are intentionally retained because they are part of the menu.
function normalizeMenuDatabase() {
  const categoryRows = hotelDarshanCategories.map((category, index) => [
    category.id,
    category.name_en,
    category.name_hi,
    category.name_gu,
    category.image_url || null,
    index + 1
  ]);

  const upsertCategory = db.prepare(`
    INSERT INTO categories (id, name_en, name_hi, name_gu, image_url, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      name_en = excluded.name_en,
      name_hi = excluded.name_hi,
      name_gu = excluded.name_gu,
      image_url = excluded.image_url,
      sort_order = excluded.sort_order,
      is_active = 1
  `);

  const defaultCustomizations = JSON.stringify([
    { id: 'jain', name_en: 'Jain Preparation (No Onion / No Garlic)', price: 0 },
    { id: 'spicy_more', name_en: 'Extra Spicy', price: 0 },
    { id: 'spicy_less', name_en: 'Mild / Less Spicy', price: 0 },
    { id: 'extra_butter', name_en: 'Extra Amul Butter', price: 20 }
  ]);

  const getCategoryImage = (categoryId) => {
    const item = hotelDarshanMenuItems.find((menuItem) => menuItem.category_id === categoryId);
    return item?.image || '';
  };

  const existingItems = db.prepare(`
    SELECT id, category_id, name_en, price, discount_price, is_veg,
           is_available, is_popular, is_special, image_url
    FROM menu_items
    ORDER BY id
  `).all();

  const expectedById = new Map(
    hotelDarshanMenuItems.map((item) => [Number(item.id), item])
  );

  const menuMatchesExactly =
    existingItems.length === hotelDarshanMenuItems.length &&
    existingItems.every((row) => {
      const expected = expectedById.get(Number(row.id));
      if (!expected) return false;

      return (
        Number(row.category_id) === Number(expected.category_id) &&
        row.name_en === expected.name_en &&
        Number(row.price) === Number(expected.price) &&
        Number(row.discount_price) === Number(expected.base_price) &&
        Number(row.is_veg) === (expected.is_veg ? 1 : 0) &&
        Number(row.is_available) === (expected.is_available ? 1 : 0) &&
        Number(row.is_popular) === (expected.is_popular ? 1 : 0) &&
        Number(row.is_special) === (expected.is_special ? 1 : 0) &&
        row.image_url === expected.image
      );
    });

  const syncMenu = db.transaction(() => {
    // Keep category definitions synchronized, but never overwrite the
    // restaurant owner's runtime menu decisions (availability, stock,
    // specials, popularity, prices, etc.).
    for (const [id, en, hi, gu, imageUrl, order] of categoryRows) {
      upsertCategory.run(id, en, hi, gu, imageUrl, order);
    }

    const insertItem = db.prepare(`
      INSERT INTO menu_items (
        id, category_id, name_en, name_hi, name_gu,
        desc_en, desc_hi, desc_gu,
        ingredients_en, ingredients_hi, ingredients_gu,
        price, discount_price, is_veg, prep_time_mins, image_url,
        is_available, available_qty, is_popular, is_special,
        customizations_json, rating, review_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4.8, 25)
    `);

    // Remove legacy seeded rows that are no longer part of the current
    // Hotel Darshan master menu. IDs used for custom admin-created dishes
    // above the master-menu range are preserved.
    const masterIds = hotelDarshanMenuItems.map((item) => Number(item.id));
    const maxMasterId = Math.max(...masterIds);
    const placeholders = masterIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM menu_items WHERE id <= ? AND id NOT IN (${placeholders})`)
      .run(maxMasterId, ...masterIds);

    // Seed only missing dishes. Existing rows are intentionally preserved so
    // admin/chef changes survive server restarts.
    for (const item of hotelDarshanMenuItems) {
      const exists = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(Number(item.id));
      if (exists) continue;
      insertItem.run(
        Number(item.id), Number(item.category_id), item.name_en, item.name_en, item.name_en,
        `Authentic Hotel Darshan ${item.name_en}`, `स्वादिष्ट ${item.name_en}`, `સ્વાદિષ્ટ ${item.name_en}`,
        'Fresh ingredients, authentic spices', 'ताजा सामग्री, मसाले', 'તાજી સામગ્રી, દેશી મસાલા',
        Number(item.price), Number(item.base_price), item.is_veg ? 1 : 0, 15,
        item.image || '', item.is_available ? 1 : 0, 50,
        item.is_popular ? 1 : 0, item.is_special ? 1 : 0, defaultCustomizations
      );
    }
  });

  syncMenu();
}


// Complete item-level image resolver for Gujarati & North Indian cuisine
function getItemImageByName(name) {
  const lower = name.toLowerCase();

  // Tea, Coffee & Milk Drinks
  if (lower === 'tea') return 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=600&auto=format&fit=crop&q=80'; // Authentic Indian Milk Chai
  if (lower.includes('coffee')) return 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('chhas') || lower.includes('chaas')) return 'https://images.unsplash.com/photo-1556881286-fc6915169721?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('dahi') || lower.includes('milk') || lower.includes('dudh') || lower.includes('ghee') || lower.includes('butter')) return 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=600&auto=format&fit=crop&q=80';

  // Sweets
  if (lower.includes('gulab jamun')) return 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('rasgulla')) return 'https://images.unsplash.com/photo-1589270216117-71e3505b0dd2?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('churmo') || lower.includes('churma') || lower.includes('ladu')) return 'https://images.unsplash.com/photo-1605197586548-0ae9a3a1f114?w=600&auto=format&fit=crop&q=80';

  // Papad & Salad
  if (lower.includes('papad')) return 'https://images.unsplash.com/photo-1610057099431-d73a1c9d2f2f?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('salad')) return 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&auto=format&fit=crop&q=80';

  // Kathiyavadi Specialties
  if (lower.includes('ringan') || lower.includes('bharthu') || lower.includes('oro')) return 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('sev tameta') || lower.includes('save tomato') || lower.includes('tameta')) return 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('bhinda') || lower.includes('bhindi')) return 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('karela') || lower.includes('marcha') || lower.includes('mag masala') || lower.includes('dahi tikhari')) return 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&auto=format&fit=crop&q=80';

  // Breads (Roti, Bajri Rotlo, Parotha, Thepla)
  if (lower.includes('rotlo') || lower.includes('rotla')) return 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('roti') || lower.includes('parotha') || lower.includes('thepla')) return 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=600&auto=format&fit=crop&q=80';

  // Paneer Sabji
  if (lower.includes('paneer butter') || lower.includes('shahi paneer') || lower.includes('paneer pasanda')) return 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('paneer tikka')) return 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('palak paneer')) return 'https://images.unsplash.com/photo-1610057099431-d73a1c9d2f2f?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('paneer')) return 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&auto=format&fit=crop&q=80';

  // Panjabi Sabji, Dal & Kofta
  if (lower.includes('dal fry') || lower.includes('dal tadka') || lower.includes('dal')) return 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('kaju') || lower.includes('kofta') || lower.includes('sp. darshan')) return 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=600&auto=format&fit=crop&q=80';

  // Chinese & Starters
  if (lower.includes('noodle') || lower.includes('hakka')) return 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('manchurian') || lower.includes('chilli')) return 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('soup')) return 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600&auto=format&fit=crop&q=80';

  // Rice, Biryani & Khichdi
  if (lower.includes('biriyani') || lower.includes('pulav')) return 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80';
  if (lower.includes('khichdi') || lower.includes('khichadi') || lower.includes('rice') || lower.includes('chawel')) return 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=600&auto=format&fit=crop&q=80';

  // Fallback
  return 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80';
}

/**
 * Create the three starter staff accounts, but only on a database that has no
 * admin at all.
 *
 * This used to insert each account whose email was missing, on every boot. That
 * quietly undid a permanent delete: an admin who deleted the rider account found
 * it back - as a brand new row, with a new id, so the delivery history that named
 * the old id no longer pointed at anybody - the next time the server restarted.
 * The same would have happened to the chef, and to the admin account itself.
 *
 * The guard is "is there an admin?" rather than "is each email present?" because
 * a real installation always has an admin and the signed-in admin can never be
 * deleted. Once one exists, deletion is respected forever after.
 */
function ensureStaffAccounts() {
  const hasAdmin = db
    .prepare("SELECT 1 FROM users WHERE role = 'admin' AND deleted_at IS NULL LIMIT 1")
    .get();
  if (hasAdmin) return;

  const staff = [
    ['hoteldarshan9909@gmail.com', 'admin123', 'Vasava Rameshbhai', '+91 95861 32916', 'admin'],
    ['bhavikvasavablack@gmail.com', '', 'Bhavil Vasava', '+91 90548 62428', 'chef']
  ];
  const insert = db.prepare(`INSERT INTO users (email, password_hash, name, phone, role, addresses_json, favorites_json) VALUES (?, ?, ?, ?, ?, '[]', '[]')`);
  const tx = db.transaction(() => {
    for (const [email, password, name, phone, role] of staff) {
      const existing = db.prepare('SELECT id, role, password_hash, is_active FROM users WHERE email = ?').get(email);
      if (!existing) {
        insert.run(email, bcrypt.hashSync(password, 10), name, phone, role);
      }
    }
  });
  tx();
}

function seedData() {
  // 1. Check & Seed Users
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const salt = bcrypt.genSaltSync(10);
    const adminPass = bcrypt.hashSync('admin123', salt);
    const chefPass = bcrypt.hashSync('chef123', salt);

    const insertUser = db.prepare(`
      INSERT INTO users (email, password_hash, name, phone, role, addresses_json, favorites_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run('hoteldarshan9909@gmail.com', adminPass, 'Vasava Rameshbhai', '+91 95861 32916', 'admin', '[]', '[]');
    insertUser.run('bhavikvasavablack@gmail.com', chefPass, 'Bhavil Vasava', '+91 90548 62428', 'chef', '[]', '[]');
  }

  // Always make sure the three staff roles exist, even when an older database already has customers.
  ensureStaffAccounts();

// 2. Check & Seed Categories
  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (catCount === 0) {
    const insertCat = db.prepare(`
      INSERT INTO categories (id, name_en, name_hi, name_gu, image_url, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    const categoriesList = [
      { id: 1, en: 'Hotel Special', hi: 'होटल स्पेशल', gu: 'હોટેલ સ્પેશિયલ', order: 1 },
      { id: 2, en: 'Milk Items', hi: 'मिल्क आइटम्स', gu: 'દૂધ ની વાનગીઓ', order: 2 },
      { id: 3, en: 'Sweet', hi: 'मीठा', gu: 'મીઠાઈ', order: 3 },
      { id: 4, en: 'Tea & Coffee', hi: 'चाय और कॉफी', gu: 'ચા અને કોફી', order: 4 },
      { id: 5, en: 'Starter', hi: 'स्टार्टर', gu: 'સ્ટાર્ટર', order: 5 },
      { id: 6, en: 'Soup', hi: 'सूप', gu: 'સૂપ', order: 6 },
      { id: 7, en: 'Noodles', hi: 'नूडल્સ', gu: 'નૂડલ્સ', order: 7 },
      { id: 8, en: 'Chinese Rice', hi: 'ચાઇનીઝ રાઇસ', gu: 'ચાઇનીઝ રાઇસ', order: 8 },
      { id: 9, en: 'Kathiyavadi', hi: 'काठियावाड़ी', gu: 'કાઠિયાવાડી', order: 9 },
      { id: 10, en: 'Punjabi', hi: 'पंजाबी', gu: 'પંજાબી', order: 10 },
      { id: 11, en: 'Roti / Rotla / Parotha', hi: 'रोटी / रोटला / पराठा', gu: 'રોટલી / રોટલો / પરોઠા', order: 11 },
      { id: 12, en: 'Rice & Khichdi', hi: 'ભાત અને ખીચડી', gu: 'ભાત અને ખીચડી', order: 12 },
      { id: 13, en: 'Dal', hi: 'દાલ', gu: 'દાળ', order: 13 },
      { id: 14, en: 'Papad', hi: 'पापड़', gu: 'પાપડ', order: 14 },
      { id: 15, en: 'Salad', hi: 'सलाद', gu: 'સલાડ', order: 15 },
      { id: 16, en: 'Special Sabji', hi: 'विशेष सब्जी', gu: 'વિશેષ સબ્જી', order: 16 },
      { id: 17, en: 'Kofta', hi: 'कोफ्ता', gu: 'કોફ્તા', order: 17 },
      { id: 18, en: 'Cheese Items', hi: 'चीज़ आइटम्स', gu: 'ચીઝ ની વાનગીઓ', order: 18 }
    ];

    categoriesList.forEach((c) => {
      insertCat.run(c.id, c.en, c.hi, c.gu, getItemImageByName(c.en), c.order);
    });
  }

  // 3. Check & Seed Menu Items
  const itemCount = db.prepare('SELECT COUNT(*) as count FROM menu_items').get().count;
  if (itemCount === 0) {
    const insertItem = db.prepare(`
      INSERT INTO menu_items (
        category_id, name_en, name_hi, name_gu,
        desc_en, desc_hi, desc_gu,
        ingredients_en, ingredients_hi, ingredients_gu,
        price, discount_price, is_veg, prep_time_mins, image_url,
        is_available, available_qty, is_popular, is_special,
        customizations_json, rating, review_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 15, ?, 1, 50, ?, ?, ?, 4.8, 25)
    `);

    const defaultCustomizations = JSON.stringify([
      { id: 'jain', name_en: 'Jain Preparation (No Onion / No Garlic)', price: 0 },
      { id: 'spicy_more', name_en: 'Extra Spicy', price: 0 },
      { id: 'spicy_less', name_en: 'Mild / Less Spicy', price: 0 },
      { id: 'extra_butter', name_en: 'Extra Amul Butter', price: 20 }
    ]);

    const fullMenu = [
      // MILK ITEMS (Cat 1)
      { catId: 1, name: 'Simple Chhas', base: 10, pop: 0, spec: 0 },
      { catId: 1, name: 'Special Chhas', base: 15, pop: 1, spec: 0 },
      { catId: 1, name: 'Dahi', base: 20, pop: 0, spec: 0 },
      { catId: 1, name: 'Milk', base: 30, pop: 0, spec: 0 },
      { catId: 1, name: 'Ghee', base: 30, pop: 0, spec: 0 },
      { catId: 1, name: 'Gol', base: 20, pop: 0, spec: 0 },
      { catId: 1, name: 'Butter (Vadki)', base: 30, pop: 0, spec: 0 },

      // SWEET (Cat 2)
      { catId: 2, name: 'Rotlano Churmo', base: 70, pop: 1, spec: 1 },
      { catId: 2, name: 'Churma Ladoo', base: 20, pop: 0, spec: 0 },
      { catId: 2, name: 'Rasgulla', base: 20, pop: 0, spec: 0 },
      { catId: 2, name: 'Gulab Jamun', base: 20, pop: 1, spec: 0 },

      // TEA - COFFEE (Cat 3)
      { catId: 3, name: 'Tea', base: 20, pop: 1, spec: 0 },
      { catId: 3, name: 'Coffee', base: 25, pop: 0, spec: 0 },
      { catId: 3, name: 'Milk', base: 30, pop: 0, spec: 0 },

      // PAPAD (Cat 4)
      { catId: 4, name: 'Roasted Papad', base: 10, pop: 0, spec: 0 },
      { catId: 4, name: 'Fried Papad', base: 20, pop: 0, spec: 0 },
      { catId: 4, name: 'Masala Papad', base: 30, pop: 1, spec: 0 },
      { catId: 4, name: 'Nagli Papad', base: 20, pop: 0, spec: 0 },

      // RICE (Cat 5)
      { catId: 5, name: 'Jeera Rice', base: 70, pop: 0, spec: 0 },
      { catId: 5, name: 'Plain Rice', base: 50, pop: 0, spec: 0 },
      { catId: 5, name: 'Dal Rice', base: 50, pop: 0, spec: 0 },
      { catId: 5, name: 'Veg. Pulav', base: 80, pop: 0, spec: 0 },
      { catId: 5, name: 'Veg. Biriyani', base: 120, pop: 1, spec: 0 },
      { catId: 5, name: 'Veg. Haydrabadi', base: 150, pop: 0, spec: 0 },
      { catId: 5, name: 'Kaju Pulav', base: 140, pop: 0, spec: 0 },
      { catId: 5, name: 'Paneer Pulav', base: 140, pop: 0, spec: 0 },
      { catId: 5, name: 'Paneer Khichdi', base: 130, pop: 0, spec: 0 },
      { catId: 5, name: 'Butter Khichadi', base: 130, pop: 1, spec: 1 },
      { catId: 5, name: 'Cheese Khichadi', base: 140, pop: 0, spec: 0 },
      { catId: 5, name: 'Kadhi Khichadi', base: 50, pop: 1, spec: 0 },
      { catId: 5, name: 'Masala Rice', base: 80, pop: 0, spec: 0 },
      { catId: 5, name: 'Punjabi Khichadi', base: 100, pop: 0, spec: 0 },
      { catId: 5, name: 'Tadka Khichadi', base: 110, pop: 0, spec: 0 },

      // PANEER SABJI (Cat 6)
      { catId: 6, name: 'Palak Paneer', base: 150, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Matar', base: 150, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Chatpata', base: 150, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Kadhai', base: 160, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Handi', base: 160, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Balti', base: 170, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Bhurji', base: 160, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Butter Masala', base: 160, pop: 1, spec: 1 },
      { catId: 6, name: 'Paneer Tufani', base: 160, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Tikka', base: 140, pop: 1, spec: 0 },
      { catId: 6, name: 'Paneer Tawa', base: 160, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Pasanda', base: 200, pop: 0, spec: 1 },
      { catId: 6, name: 'Paneer Angara', base: 180, pop: 1, spec: 1 },
      { catId: 6, name: 'Cheese Angara', base: 200, pop: 0, spec: 0 },
      { catId: 6, name: 'Shahi Paneer', base: 150, pop: 0, spec: 0 },
      { catId: 6, name: 'Chana Paneer', base: 150, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Aflatun', base: 180, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Cheese', base: 180, pop: 0, spec: 0 },
      { catId: 6, name: 'Paneer Lasaniya', base: 160, pop: 0, spec: 0 },
      { catId: 6, name: 'Cheese Aflatun', base: 200, pop: 0, spec: 0 },

      // SOUP (Cat 7)
      { catId: 7, name: 'Manchow Soup', base: 80, pop: 1, spec: 0 },
      { catId: 7, name: 'Manchurian Soup', base: 90, pop: 0, spec: 0 },
      { catId: 7, name: 'Garlic Soup', base: 90, pop: 0, spec: 0 },

      // STARTER (Cat 8)
      { catId: 8, name: 'Dry Manchurian', base: 80, pop: 1, spec: 0 },
      { catId: 8, name: 'Paneer Chilli Dry', base: 150, pop: 1, spec: 0 },
      { catId: 8, name: 'Paneer Chilli Gravy', base: 160, pop: 0, spec: 0 },
      { catId: 8, name: 'Manchurian Gravy', base: 80, pop: 0, spec: 0 },

      // NOODLES (Cat 9)
      { catId: 9, name: 'Veg. Hakka Noodles', base: 80, pop: 1, spec: 0 },
      { catId: 9, name: 'Veg. Schezwan Noodles', base: 100, pop: 0, spec: 0 },
      { catId: 9, name: 'Manchurian Noodles', base: 90, pop: 0, spec: 0 },

      // CHINESE RICE (Cat 10)
      { catId: 10, name: 'Veg. Fried Rice', base: 90, pop: 0, spec: 0 },
      { catId: 10, name: 'Veg. Schezwan Fried Rice', base: 100, pop: 0, spec: 0 },
      { catId: 10, name: 'Manchurian Fried Rice', base: 90, pop: 0, spec: 0 },
      { catId: 10, name: 'Chinese Pulav', base: 80, pop: 0, spec: 0 },
      { catId: 10, name: 'Chinese Bhel', base: 130, pop: 1, spec: 0 },

      // SALAD (Cat 11)
      { catId: 11, name: 'Tomato Salad', base: 25, pop: 0, spec: 0 },
      { catId: 11, name: 'Green Salad', base: 35, pop: 0, spec: 0 },

      // KATHIYAVADI (Cat 12)
      { catId: 12, name: 'Sev Tameta', base: 80, pop: 1, spec: 0 },
      { catId: 12, name: 'Ringan Bharthu', base: 100, pop: 1, spec: 1 },
      { catId: 12, name: 'Mung Masala', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Bharela Ringan', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Bharela Karela', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Bharela Marcha', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Bharela Bhinda', base: 80, pop: 0, spec: 0 },
      { catId: 12, name: 'Sev Bhaji', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Sev Lasaniya', base: 100, pop: 0, spec: 0 },
      { catId: 12, name: 'Lasaniya Aloo', base: 100, pop: 0, spec: 0 },
      { catId: 12, name: 'Suki Bhaji', base: 80, pop: 0, spec: 0 },
      { catId: 12, name: 'Suki Bhaji (farfi)', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Bhindi Fry', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Bhindi Masala', base: 100, pop: 0, spec: 0 },
      { catId: 12, name: 'Tameta Bharta', base: 90, pop: 0, spec: 0 },
      { catId: 12, name: 'Dahi Tikhari', base: 80, pop: 1, spec: 1 },

      // PANJABI SABJI (Cat 13)
      { catId: 13, name: 'Special Darshan', base: 220, pop: 1, spec: 1 },
      { catId: 13, name: 'Dal Fry', base: 80, pop: 0, spec: 0 },
      { catId: 13, name: 'Dal Fry Butter', base: 90, pop: 0, spec: 0 },
      { catId: 13, name: 'Dal Tadka', base: 100, pop: 1, spec: 0 },
      { catId: 13, name: 'Dal Tadka Butter', base: 110, pop: 0, spec: 0 },
      { catId: 13, name: 'Aloo Matar', base: 80, pop: 0, spec: 0 },
      { catId: 13, name: 'Jeera Aloo', base: 90, pop: 0, spec: 0 },
      { catId: 13, name: 'Chana Masala', base: 100, pop: 0, spec: 0 },
      { catId: 13, name: 'Plain Palak', base: 80, pop: 0, spec: 0 },
      { catId: 13, name: 'Mix Veg.', base: 100, pop: 0, spec: 0 },
      { catId: 13, name: 'Veg. Kolhapuri', base: 160, pop: 0, spec: 0 },
      { catId: 13, name: 'Veg. Kadai', base: 110, pop: 0, spec: 0 },
      { catId: 13, name: 'Veg. Handi', base: 140, pop: 0, spec: 0 },
      { catId: 13, name: 'Veg. Jaipuri', base: 160, pop: 0, spec: 0 },
      { catId: 13, name: 'Veg. Tufani', base: 150, pop: 0, spec: 0 },
      { catId: 13, name: 'Veg. Tava', base: 160, pop: 0, spec: 0 },
      { catId: 13, name: 'Veg. Angara', base: 160, pop: 0, spec: 0 },

      // SPECIAL SABJI (Cat 14)
      { catId: 14, name: 'Kaju Masala', base: 160, pop: 1, spec: 0 },
      { catId: 14, name: 'Kaju Curry', base: 150, pop: 0, spec: 0 },
      { catId: 14, name: 'Paneer Kaju', base: 160, pop: 0, spec: 0 },
      { catId: 14, name: 'Butter Masala', base: 170, pop: 0, spec: 0 },

      // KOFTA (Cat 15)
      { catId: 15, name: 'Veg Kofta', base: 130, pop: 0, spec: 0 },
      { catId: 15, name: 'Malai Kofta (sweet)', base: 150, pop: 1, spec: 0 },
      { catId: 15, name: 'Kaju Kofta', base: 170, pop: 0, spec: 0 },
      { catId: 15, name: 'Cheese Kofta', base: 170, pop: 0, spec: 0 },

      // CHEESE ITEMS (Cat 16)
      { catId: 16, name: 'Cheese Butter Lasaniya', base: 150, pop: 0, spec: 0 },
      { catId: 16, name: 'Cheese Garlic Palak', base: 140, pop: 0, spec: 0 },
      { catId: 16, name: 'Cheese Butter Masala', base: 180, pop: 1, spec: 1 },

      // ROTI / ROTLA / PAROTHA (Cat 17)
      { catId: 17, name: 'Plain Roti', base: 10, pop: 0, spec: 0 },
      { catId: 17, name: 'Butter Roti', base: 15, pop: 1, spec: 0 },
      { catId: 17, name: 'Bajri Rotlo Plain', base: 20, pop: 0, spec: 0 },
      { catId: 17, name: 'Bajri Rotlo Butter', base: 25, pop: 1, spec: 0 },
      { catId: 17, name: 'Bajri Rotlo Lasaniya', base: 30, pop: 0, spec: 0 },
      { catId: 17, name: 'Bajri Rotlo Lasaniya Butter', base: 35, pop: 1, spec: 1 },
      { catId: 17, name: 'Rice Rotlo Plain', base: 20, pop: 0, spec: 0 },
      { catId: 17, name: 'Rice Rotlo Butter', base: 25, pop: 0, spec: 0 },
      { catId: 17, name: 'Juwar Rotlo Plain', base: 20, pop: 0, spec: 0 },
      { catId: 17, name: 'Juwar Rotlo Butter', base: 25, pop: 0, spec: 0 },
      { catId: 17, name: 'Juwar Lasaniya Rotlo', base: 30, pop: 0, spec: 0 },
      { catId: 17, name: 'Juwar Lasaniya Rotlo Butter', base: 35, pop: 0, spec: 0 },
      { catId: 17, name: 'Makai Rotlo Plain', base: 20, pop: 0, spec: 0 },
      { catId: 17, name: 'Makai Rotlo Butter', base: 25, pop: 0, spec: 0 },
      { catId: 17, name: 'Makai Lasaniya Rotlo', base: 30, pop: 0, spec: 0 },
      { catId: 17, name: 'Makai Lasaniya Rotlo Butter', base: 35, pop: 0, spec: 0 },
      { catId: 17, name: 'Tawa Parotha', base: 20, pop: 0, spec: 0 },
      { catId: 17, name: 'Tawa Butter Parotha', base: 25, pop: 0, spec: 0 },
      { catId: 17, name: 'Fry Rotla', base: 80, pop: 0, spec: 0 },
      { catId: 17, name: 'Fry Rotli Dry', base: 90, pop: 0, spec: 0 },
      { catId: 17, name: 'Methi Thepla', base: 50, pop: 1, spec: 0 },
      { catId: 17, name: 'Aloo Paratha', base: 50, pop: 0, spec: 0 }
    ];

    fullMenu.forEach((item) => {
      const deliveryPrice = Math.round(item.base * 1.10);
      const discountPrice = item.base;

      insertItem.run(
        item.catId,
        item.name, item.name, item.name,
        `Authentic Hotel Darshan ${item.name}`, `स्वादिष्ट ${item.name}`, `સ્વાદિષ્ટ ${item.name}`,
        'Fresh ingredients, authentic spices', 'ताजा सामग्री, मसाले', 'તાજી સામગ્રી, દેશી મસાલા',
        deliveryPrice,
        discountPrice,
        getItemImageByName(item.name),
        item.pop,
        item.spec,
        defaultCustomizations
      );
    });
  }

  // 4. Check & Seed Coupons
  const couponCount = db.prepare('SELECT COUNT(*) as count FROM coupons').get().count;
  if (couponCount === 0) {
    const insertCoupon = db.prepare(`
      INSERT INTO coupons (code, discount_type, discount_value, min_order_value, max_discount, valid_to, usage_limit, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertCoupon.run('DARSHAN50', 'percentage', 50, 199, 100, '2027-12-31', 500, 1);
    insertCoupon.run('WELCOME', 'flat', 75, 249, 75, '2027-12-31', 1000, 1);
    insertCoupon.run('FREEDEL', 'flat', 35, 199, 35, '2027-12-31', 500, 1);
  }

  // 5. Settings
  const settingCount = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
  if (settingCount === 0) {
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('auto_confirm_orders', 'true');
    insertSetting.run('restaurant_open', 'true');
    insertSetting.run('tax_percent', '5');
    insertSetting.run('delivery_fee', '35');
    insertSetting.run('free_delivery_above', '499');
    insertSetting.run('hotel_name', 'Hotel Darshan');
    insertSetting.run('hotel_tagline', 'Authentic Flavours, Exceptional Taste');
    insertSetting.run('hotel_address', 'Char Rasta, Mosda Road, Dediapada, Gujarat - 393040');
    insertSetting.run('hotel_phone', '+91 98250 11223');
    insertSetting.run('hotel_coords', JSON.stringify({ lat: 21.6271369, lng: 73.5898076 }));
  }

  // The original seeded hotel coordinates (21.533 / 73.999) point at Kukarmunda
  // Taluka in Tapi district, roughly 43 km from Dediapada, so every delivery was
  // measured from the wrong origin. Correct the stored value on existing installs
  // as well - but only while it still holds that old bad default, so an admin who
  // has since entered real coordinates is never overwritten.
  const STALE_HOTEL_COORDS = { lat: 21.533, lng: 73.999 };
  const currentHotelCoords = db.prepare("SELECT value FROM settings WHERE key = 'hotel_coords'").get();
  if (currentHotelCoords) {
    try {
      const stored = JSON.parse(currentHotelCoords.value);
      if (stored?.lat === STALE_HOTEL_COORDS.lat && stored?.lng === STALE_HOTEL_COORDS.lng) {
        db.prepare("UPDATE settings SET value = ? WHERE key = 'hotel_coords'")
          .run(JSON.stringify({ lat: 21.6271369, lng: 73.5898076 }));
      }
    } catch {
      // Unparseable value: leave it alone rather than guessing.
    }
  }

  // Distance-based delivery pricing. Ensured on every boot (not just on a fresh
  // database) so an existing install picks up the new keys without any manual SQL.
  // The defaults mirror server/src/deliveryPricing.js.
  const ensureSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  ensureSetting.run('delivery_slabs', JSON.stringify([
    { maxKm: 2, fee: 20 },
    { maxKm: 4, fee: 30 },
    { maxKm: 5, fee: 40 },
    { maxKm: 6, fee: 50 }
  ]));
  ensureSetting.run('max_delivery_km', '6');
}