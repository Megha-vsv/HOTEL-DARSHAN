import express from 'express';
import bcrypt from 'bcryptjs';
import { db, ensureRiderPresence } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';
import {
  STAFF_ROLES,
  isValidIndianMobile,
  normaliseMobile,
  staffStatus
} from '../staffIdentity.js';

const router = express.Router();
const adminOnly = [authMiddleware, requireRole(['admin'])];

// The only reason a password is ever written here is to keep an account that
// already has one signable. New staff accounts have no password at all: staff
// sign in with a mobile number and an OTP, so asking an admin to invent a password
// for somebody they will never see type it would be asking for a secret that
// nobody is going to use and that would then have to be reset, rotated and
// remembered. One way in is one thing to get wrong.
const PASSWORD_LOGIN_ROLES = new Set(['admin']);

const SELECT_STAFF = `id, name, phone, email, role, is_active, deleted_at, created_at, updated_at`;

/**
 * A staff record as the admin screen reads it.
 *
 * `mobile` is what was stored, normalised. `status` is the real derived state,
 * and `hasMobile` is separate from it, because a staff member with no number on
 * file is ACTIVE but cannot sign in - folding that into the status would report
 * a working account as broken, or worse, report a broken one as working.
 */
function formatStaff(row) {
  const status = staffStatus(row);
  const mobile = normaliseMobile(row.phone);
  return {
    id: row.id,
    name: row.name,
    mobile,
    hasMobile: Boolean(mobile),
    // The value as it was typed, kept so an admin can see what is actually in
    // the column when the normalised form is empty.
    phone: row.phone || '',
    email: row.email || null,
    role: row.role,
    status,
    is_active: row.is_active === 1,
    // An account nobody can sign in with, whatever the status says.
    needsMobile: !mobile,
    canUsePasswordLogin: PASSWORD_LOGIN_ROLES.has(row.role) && Boolean(row.password_hash),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/** Validate the fields an admin form can send. Returns { value } or { error }. */
function readStaffInput(body, current) {
  const name = String(body.name ?? current?.name ?? '').trim();
  const rawMobile = body.mobile ?? body.phone ?? current?.phone ?? '';
  const mobile = normaliseMobile(rawMobile);
  const email = body.email === undefined
    ? (current?.email ?? null)
    : (String(body.email || '').trim().toLowerCase() || null);
  const role = String(body.role ?? current?.role ?? '').trim().toLowerCase();

  if (!name) return { error: 'Full name is required' };
  if (!rawMobile || !String(rawMobile).trim()) return { error: 'Mobile number is required' };
  if (!mobile || !/^([6789])\d{9}$/.test(mobile)) {
    return { error: 'Please enter a valid 10-digit Indian mobile number' };
  }
  if (!role) return { error: 'Role is required' };
  if (!STAFF_ROLES.includes(role)) {
    return { error: `Role must be one of: ${STAFF_ROLES.join(', ')}` };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email address' };
  }
  return { value: { name, mobile, email, role } };
}

/**
 * Refuse a mobile number that is already on a live staff account.
 *
 * Checked across the whole table rather than only on insert, so it also catches
 * an edit that moves one account onto another's number. There is no longer a
 * "deleted but still holding the number" case: Delete removes the row outright,
 * so a number stops being held the moment its holder is deleted.
 */
function duplicateMobile(mobile, exceptId = null) {
  const clash = db
    .prepare(
      `SELECT id, name, role FROM users
       WHERE role IN ('admin','chef','rider')
         AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+91','') = ?
         AND (? IS NULL OR id != ?)`
    )
    .get(mobile, exceptId, exceptId);
  if (!clash) return null;
  return clash;
}

// ------------------------------------------------------------------------ list
router.get('/', ...adminOnly, (req, res) => {
  try {
    // Only live accounts. Delete is permanent now, so there is no "removed" row to
    // list and nothing to restore: what an admin sees is exactly what exists.
    const staff = db
      .prepare(
        `SELECT ${SELECT_STAFF} FROM users
         WHERE role IN ('admin','chef','rider') AND deleted_at IS NULL
         ORDER BY is_active DESC, name ASC`
      )
      .all();
    res.json(staff.map(formatStaff));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------- add staff
router.post('/', ...adminOnly, (req, res) => {
  try {
    const read = readStaffInput(req.body, null);
    if (read.error) return res.status(400).json({ error: read.error });
    const { name, mobile, email, role } = read.value;

    const duplicate = duplicateMobile(mobile);
    if (duplicate) {
      return res.status(409).json({
        error: 'This mobile number is already registered.',
        code: 'DUPLICATE_MOBILE',
        conflictWith: { id: duplicate.id, name: duplicate.name, role: duplicate.role }
      });
    }
    if (email) {
      const emailClash = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
      if (emailClash) {
        return res.status(409).json({ error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' });
      }
    }

    // Adding somebody always makes a new row. This used to look for a soft-deleted
    // record with the same number and bring it back instead, so that rejoining
    // would not create a second person out of one phone number. Delete is
    // permanent now, so there is nothing left to find: the number is free because
    // the row that held it is gone, and re-adding is a genuinely new account.
    //
    // Status is read from the body so an admin can add somebody already disabled
    // (hired, not started yet). Default is active, which is the common case.
    const isActive = req.body.is_active === undefined ? 1 : (req.body.is_active ? 1 : 0);
    const result = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, phone, role, addresses_json, favorites_json, is_active, phone_verified)
         VALUES (?, '', ?, ?, ?, '[]', '[]', ?, 0)`
      )
      .run(email, name, mobile, role, isActive);
    const id = result.lastInsertRowid;

    // A rider needs an explicit OFFLINE state, not the absence of one, or the
    // assigner has nothing to read and cannot tell them apart from a non-rider.
    if (role === 'rider') ensureRiderPresence(id);

    const staff = db.prepare(`SELECT ${SELECT_STAFF} FROM users WHERE id = ?`).get(id);
    res.status(201).json(formatStaff(staff));
  } catch (error) {
    // The unique index on staff mobile numbers is the last line of defence for
    // two requests arriving together, so its error is reported as the same thing
    // the check above would have said rather than as a server fault.
    if (String(error.message || '').includes('idx_users_staff_mobile')) {
      return res.status(409).json({ error: 'This mobile number is already registered.', code: 'DUPLICATE_MOBILE' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------- edit staff
router.put('/:id', ...adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare(`SELECT ${SELECT_STAFF} FROM users WHERE id = ? AND role IN ('admin','chef','rider')`).get(id);
    if (!current) return res.status(404).json({ error: 'Staff account not found' });

    const read = readStaffInput(req.body, current);
    if (read.error) return res.status(400).json({ error: read.error });
    const { name, mobile, email, role } = read.value;

    // An admin must not be able to switch themselves off, or to demote
    // themselves, because the next thing that happens is that nobody can undo it.
    // Matched on the id in the token, not the role: refusing to touch a second
    // admin would be wrong, but refusing to touch your own account is not.
    if (id === req.user.id) {
      if (role !== 'admin') {
        return res.status(400).json({ error: 'You cannot change your own role', code: 'SELF_ROLE_CHANGE' });
      }
      if (req.body.is_active === false) {
        return res.status(400).json({ error: 'You cannot disable your own account', code: 'SELF_DISABLE' });
      }
    }

    const duplicate = duplicateMobile(mobile, id);
    if (duplicate) {
      return res.status(409).json({
        error: 'This mobile number is already registered.',
        code: 'DUPLICATE_MOBILE',
        conflictWith: { id: duplicate.id, name: duplicate.name, role: duplicate.role }
      });
    }

    // A password is only set for an admin, and only when one was sent. Everyone
    // else signs in by OTP and does not need one.
    const password = String(req.body.password || '');
    if (password && password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const setsPassword = Boolean(password) && PASSWORD_LOGIN_ROLES.has(role);

    const isActive = req.body.is_active === undefined ? current.is_active : (req.body.is_active ? 1 : 0);

    if (setsPassword) {
      db.prepare(
        `UPDATE users SET name = ?, phone = ?, email = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?`
      ).run(name, mobile, email, role, isActive, bcrypt.hashSync(password, 10), id);
    } else {
      db.prepare(
        `UPDATE users SET name = ?, phone = ?, email = ?, role = ?, is_active = ? WHERE id = ?`
      ).run(name, mobile, email, role, isActive, id);
    }

    // A role change into or out of rider has to bring the presence row with it:
    // a rider who is not there is invisible to the assigner.
    if (role === 'rider' && current.role !== 'rider') ensureRiderPresence(id);

    const staff = db.prepare(`SELECT ${SELECT_STAFF} FROM users WHERE id = ?`).get(id);
    res.json(formatStaff(staff));
  } catch (error) {
    if (String(error.message || '').includes('idx_users_staff_mobile')) {
      return res.status(409).json({ error: 'This mobile number is already registered.', code: 'DUPLICATE_MOBILE' });
    }
    res.status(500).json({ error: error.message });
  }
});

// --------------------------------------------------------- enable / disable
router.patch('/:id/status', ...adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare(`SELECT ${SELECT_STAFF} FROM users WHERE id = ? AND role IN ('admin','chef','rider')`).get(id);
    if (!current) return res.status(404).json({ error: 'Staff account not found' });

    // Your own account, by the id in the token rather than by role. Checking the
    // role would also refuse disabling a second admin, which is legitimate; what
    // must never happen is an admin switching off the account they are using.
    if (id === req.user.id && req.body.is_active === false) {
      return res.status(400).json({
        error: 'You cannot disable the account you are signed in with.',
        code: 'SELF_DISABLE'
      });
    }

    const isActive = req.body.is_active ? 1 : 0;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive, id);
    if (current.role === 'rider' && !isActive) {
      // A rider who is taken off the road must not keep a presence row claiming
      // they are available, or the assigner can still hand them an order.
      db.prepare('UPDATE rider_presence SET is_available = 0 WHERE rider_id = ?').run(id);
    }
    const staff = db.prepare(`SELECT ${SELECT_STAFF} FROM users WHERE id = ?`).get(id);
    res.json(formatStaff(staff));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------------- delete
/**
 * Delete a staff member for good.
 *
 * The row is removed from `users`, not flagged. Three things have to stay true
 * while that happens, and the schema is what makes them true rather than care
 * taken in this handler:
 *
 *   - Past orders survive. `orders.rider_id` and `orders.released_rider_id` carry
 *     no foreign key, so removing the user does not cascade into order history,
 *     and every order already stores the rider's name in `rider_name` beside the
 *     id - so a delivery still reads "Delivered by Jayesh Vaghela" afterwards.
 *   - The rider's live state goes. `rider_presence.rider_id` does cascade, which
 *     is what we want: a row saying rider 3 is available would be a ghost.
 *   - Any session dies at once. The auth guard re-reads this row on every
 *     request, so a token minted a second ago stops working on its next use, and
 *     an OTP already sent to that number is thrown away below.
 *
 * The only account that cannot be deleted is the one making the request, and it
 * is identified by `req.user.id` - the id the auth guard read off the token.
 * Nothing here inspects a name, a role, an email or a mobile number to decide
 * whether a delete is allowed, so no account is protected because of what it is
 * called or what it used to be used for, and none is singled out either.
 *
 * A rider who still holds an un-finished order is deletable like anyone else.
 * The order keeps its `rider_id` and its `rider_name`, so it stays in the admin
 * list showing who was carrying it and can be reassigned from there; the orders
 * table is never touched by a delete.
 */
router.delete('/:id', ...adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare(`SELECT ${SELECT_STAFF} FROM users WHERE id = ? AND role IN ('admin','chef','rider')`).get(id);
    if (!current) return res.status(404).json({ error: 'Staff account not found' });

    if (id === req.user.id) {
      return res.status(400).json({
        error: 'You cannot delete the account you are signed in with.',
        code: 'SELF_DELETE'
      });
    }

    const history = db
      .prepare('SELECT COUNT(*) AS c FROM orders WHERE rider_id = ? OR released_rider_id = ?')
      .get(id, id).c;

    // One transaction: the OTP codes and the account go together, so there is no
    // window where the person is deleted but a still-valid code survives.
    const remove = db.transaction(() => {
      db.prepare("DELETE FROM otp_verifications WHERE phone = ? AND purpose = 'staff_login'")
        .run(normaliseMobile(current.phone));
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
    remove();

    res.json({
      success: true,
      message: `${current.name} has been permanently deleted`,
      deleted: { id: current.id, name: current.name, role: current.role },
      // Said out loud, because an admin who thinks Delete removed a person's
      // history should be told that it did not.
      historyPreserved: history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Read and validate a list of staff ids from a bulk request.
 *
 * Bulk actions are refused whole rather than half-applied. An admin who ticks
 * four names and presses Delete must not end up with two gone, one refused and no
 * idea which, so every id is resolved and checked before anything is written.
 * Returns { ids, rows } or { error, status, code }.
 */
function readBulkSelection(body) {
  const raw = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) {
    return { error: 'Select at least one staff member.', status: 400, code: 'NO_SELECTION' };
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ${SELECT_STAFF} FROM users
       WHERE id IN (${placeholders}) AND role IN ('admin','chef','rider') AND deleted_at IS NULL`
    )
    .all(...ids);

  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((i) => !found.has(i));
    return {
      error: `No staff account with ${missing.join(', ')}. Refresh the list and try again.`,
      status: 404,
      code: 'NOT_FOUND'
    };
  }
  return { ids, rows };
}

/**
 * Everything that would make one of these accounts undeletable, as a sentence.
 *
 * The signed-in admin is the only one. That account is matched on `selfId`, which
 * comes from `req.user.id` - the id the auth guard resolved from the token - so
 * the protection follows whoever is actually logged in and nothing else.
 *
 * Returned instead of acting so the refusal can name the person, not just say
 * "some of these cannot be deleted".
 */
function deletionBlockers(rows, selfId) {
  const problems = [];
  for (const row of rows) {
    if (row.id === selfId) {
      problems.push(`${row.name} is the account you are signed in with`);
    }
  }
  return problems;
}

/** Permanently delete several staff accounts, or none of them. */
router.post('/bulk/delete', ...adminOnly, (req, res) => {
  try {
    const read = readBulkSelection(req.body);
    if (read.error) return res.status(read.status).json({ error: read.error, code: read.code });

    const problems = deletionBlockers(read.rows, req.user.id);
    if (problems.length) {
      return res.status(409).json({
        error: `Nothing was deleted. ${problems.join('; ')}.`,
        code: 'DELETE_BLOCKED',
        blockers: problems
      });
    }

    const phones = read.rows.map((r) => normaliseMobile(r.phone)).filter(Boolean);
    const history = db
      .prepare(
        `SELECT COUNT(*) AS c FROM orders
         WHERE rider_id IN (${read.ids.map(() => '?').join(',')})
            OR released_rider_id IN (${read.ids.map(() => '?').join(',')})`
      )
      .get(...read.ids, ...read.ids).c;

    const removeAll = db.transaction(() => {
      const clearOtp = db.prepare("DELETE FROM otp_verifications WHERE phone = ? AND purpose = 'staff_login'");
      for (const phone of phones) clearOtp.run(phone);
      const drop = db.prepare('DELETE FROM users WHERE id = ?');
      for (const id of read.ids) drop.run(id);
    });
    removeAll();

    res.json({
      success: true,
      message: `${read.rows.length} staff account${read.rows.length === 1 ? '' : 's'} permanently deleted`,
      deletedIds: read.ids,
      historyPreserved: history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Enable or disable several staff accounts together. */
router.post('/bulk/status', ...adminOnly, (req, res) => {
  try {
    const read = readBulkSelection(req.body);
    if (read.error) return res.status(read.status).json({ error: read.error, code: read.code });

    const isActive = Boolean(req.body.is_active);

    // Disabling yourself is refused; enabling or disabling anybody else, yourself
    // included, is allowed.
    if (!isActive && read.ids.includes(req.user.id)) {
      return res.status(400).json({
        error: 'You cannot disable the account you are signed in with.',
        code: 'SELF_DISABLE'
      });
    }

    const apply = db.transaction(() => {
      const setOne = db.prepare('UPDATE users SET is_active = ? WHERE id = ?');
      for (const id of read.ids) setOne.run(isActive ? 1 : 0, id);
      if (!isActive) {
        const parkRider = db.prepare('UPDATE rider_presence SET is_available = 0 WHERE rider_id = ?');
        for (const id of read.ids) parkRider.run(id);
      }
    });
    apply();

    const updated = read.ids.map(
      (id) => formatStaff(db.prepare(`SELECT ${SELECT_STAFF} FROM users WHERE id = ?`).get(id))
    );
    res.json({
      success: true,
      message: `${updated.length} staff account${updated.length === 1 ? '' : 's'} ${isActive ? 'enabled' : 'disabled'}`,
      staff: updated
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
