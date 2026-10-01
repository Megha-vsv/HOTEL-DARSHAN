/**
 * Staff identity, in one place.
 *
 * There is no staff table. Staff are rows in `users` with a staff role, and that
 * is deliberate: a rider who is also a customer is one person with one id, and an
 * order that names a rider names the id that the rider signs in as. Splitting staff
 * into their own table would mean every order, every notification and every
 * assignment would have to join across two identities to answer a question that
 * one row already answers.
 *
 * So the three things that make an account a staff account - which roles count,
 * what a mobile number normalises to, and what state the account is in - are
 * defined once here, and the auth routes, the admin staff routes, the guard
 * middleware and the database migration all read them. When they are defined in
 * four places they drift, and a staff member ends up able to log in but not to be
 * disabled, which is the failure that matters.
 */

/** The roles that may sign in to the staff portal. */
export const STAFF_ROLES = ['admin', 'chef', 'rider'];

/** Where each staff role works. The backend sends this; the client follows it. */
export const STAFF_ROLE_HOME = {
  admin: '/staff/admin',
  chef: '/staff/kitchen',
  rider: '/staff/rider'
};

/**
 * Reduce a mobile number to its ten digits.
 *
 * The database was filled by people typing numbers by hand, so the same person
 * exists once as "9825011223" and once as "+91 98250 33445". Both have to find
 * the same staff record, and both have to collide with each other when the number
 * is already taken - so the number is stored in exactly one form.
 *
 * An unparseable number normalises to '', which is falsy. That is deliberate:
 * "no mobile on file" and "a mobile we cannot read" are the same problem to the
 * person who has to fix it, and neither is allowed to be treated as a number.
 */
export function normaliseMobile(phone) {
  let cleaned = String(phone || '').trim().replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  // The country code is only removed from a number that actually carries one -
  // that is, one longer than ten digits. Stripping it unconditionally ate the
  // first two digits of every genuine mobile beginning 91 (9123456780 became
  // 2345670), so those staff could not be created and could not sign in. The
  // length test is what makes the strip safe, and it is the same rule the phone
  // fields on the client apply.
  if (cleaned.length > 10) {
    cleaned = cleaned.startsWith('91') ? cleaned.slice(2) : cleaned.slice(-10);
  }
  return /^\d{10}$/.test(cleaned) ? cleaned : '';
}

/** A real, dialable Indian mobile number. Indian numbers start 6-9. */
export function isValidIndianMobile(phone) {
  return /^([6789])\d{9}$/.test(normaliseMobile(phone));
}

/**
 * A staff account's state, from the two columns that hold it.
 *
 * Derived rather than stored, because a stored status column is a second answer
 * to the same question: an admin who disables a rider and a status column that
 * still says ACTIVE is a rider who is off the road and still walking into the
 * building. `is_active` and `deleted_at` are the record; this is only how it is
 * worded for a person to read.
 *
 *   DELETED  - soft-deleted. Kept, because orders name this person.
 *   DISABLED - switched off by an admin, and can be switched back on.
 *   ACTIVE   - may sign in, and may be given work.
 */
export function staffStatus(row) {
  if (!row) return null;
  if (row.deleted_at) return 'DELETED';
  return row.is_active === 1 || row.is_active === true ? 'ACTIVE' : 'DISABLED';
}

/** An account that may sign in and hold a session. */
export function isStaffUsable(row) {
  return staffStatus(row) === 'ACTIVE' && STAFF_ROLES.includes(row.role);
}

/**
 * Why a staff account cannot sign in, in the rider's own terms.
 *
 * Separate messages for separate situations on purpose. "Not registered as staff"
 * tells somebody they have the wrong number; "disabled" tells them to stop and
 * phone the restaurant; "no longer active" tells them an account that used to
 * exist is gone. Collapsing all three into "login failed" leaves a disabled rider
 * retrying forever.
 */
export function staffBlockReason(row, mobile) {
  if (!row) {
    return 'This mobile number is not registered as staff.';
  }
  const status = staffStatus(row);
  if (status === 'DELETED') {
    return 'This staff account is no longer active. Please contact the administrator.';
  }
  if (status === 'DISABLED') {
    return 'Your staff account is disabled. Please contact the administrator.';
  }
  if (!STAFF_ROLES.includes(row.role)) {
    // A customer account that is not staff. Never promoted: a customer stays a
    // customer, and this is the refusal that keeps it that way.
    return 'This mobile number is not registered as staff.';
  }
  return null;
}

/** Find the staff record for a mobile number, whatever form it was typed in. */
export function findStaffByMobile(db, phone) {
  const mobile = normaliseMobile(phone);
  if (!mobile) return null;
  // Compared on the stored value, which is kept normalised, but the LIKE covers
  // any row an older build wrote in "+91 98790 55667" form before normalisation.
  return (
    db
      .prepare(
        `SELECT id, name, phone, email, role, is_active, deleted_at, created_at, updated_at
         FROM users
         WHERE role IN ('admin','chef','rider')
           AND (phone = ? OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+91','') = ?)
         LIMIT 1`
      )
      .get(mobile, mobile) || null
  );
}
