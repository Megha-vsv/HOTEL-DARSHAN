import { db } from './db.js';
import { parseSqliteTimestamp } from './time.js';

// OTP configuration
const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 3;
// How soon another OTP may be requested for the same number. Without this the
// Send button is a way to have the server send an SMS every second, which costs
// money and trains a real person to ignore the number. Thirty seconds is long
// enough that a rider who taps twice by accident is not blocked, and short enough
// that somebody who lost the first code is not waiting on it.
const RESEND_COOLDOWN_SECONDS = 30;

// Normalize phone number for consistent storage and lookup
export function normalizePhone(phone) {
  let cleaned = String(phone || '').trim();
  // Remove country code (+91), spaces, dashes, parentheses
  cleaned = cleaned.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  // Remove a leading 91 only when the number is longer than ten digits, so it
  // really is a country code. Stripping it unconditionally turned every genuine
  // mobile beginning 91 (9123456780) into 2345670 and refused it as invalid.
  if (cleaned.length > 10) {
    cleaned = cleaned.startsWith('91') ? cleaned.slice(2) : cleaned.slice(-10);
  }
  return cleaned;
}

// Validate phone number format
function isValidPhone(phone) {
  const phoneRegex = /^(\+91[-\s]?)?[6789]\d{9}$/;
  const cleaned = phone.replace(/[-\s]/g, '');
  return phoneRegex.test(cleaned);
}

// Clean up expired OTPs
function cleanupExpiredOTPs() {
  db.prepare(
    "DELETE FROM otp_verifications WHERE expires_at < datetime('now')"
  ).run();
}

/**
 * How long until another OTP may be requested for this number and purpose.
 *
 * Returns 0 when one may be sent now, and otherwise the whole seconds remaining.
 * Read before calling sendOTP, because sendOTP deletes the previous code for the
 * number - asking it first is the only way the record that times the resend still
 * exists to be read.
 */
export function otpCooldownRemaining(phone, purpose = 'registration') {
  try {
    const normalizedPhone = normalizePhone(phone);
    const latest = db
      .prepare(
        `SELECT created_at FROM otp_verifications
         WHERE phone = ? AND purpose = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(normalizedPhone, purpose);
    if (!latest) return 0;

    const sentAtMs = parseSqliteTimestamp(latest.created_at);
    if (sentAtMs === null) return 0;
    const elapsed = (Date.now() - sentAtMs) / 1000;
    if (elapsed >= RESEND_COOLDOWN_SECONDS) return 0;
    return Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
  } catch {
    // A cooldown that cannot be read must not become a door nobody can get
    // through, so an error here means "no cooldown".
    return 0;
  }
}

/**
 * Find any user by mobile number, whatever form the number was typed in.
 *
 * The obvious query - compare the normalised input to the stored column - misses
 * every account whose phone was saved with a country code or spaces, which is
 * every account somebody typed by hand. Those people could not sign in: the input
 * normalised to ten digits, the column held "+91 99240 88990", and the two never
 * met. The comparison is done on digits so the number that reaches the column is
 * the same number the person meant, however either side was written.
 */
export function findUserByMobile(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  return (
    db
      .prepare(
        `SELECT * FROM users
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+91','') = ?
         LIMIT 1`
      )
      .get(normalizedPhone) || null
  );
}

/**
 * Find the CUSTOMER account for a mobile number, if there is one.
 *
 * Scoped to `role = 'customer'` on purpose. A number can now belong to a staff
 * row and a customer row at the same time - somebody who works at the hotel also
 * orders from it - so an unscoped `LIMIT 1` would return whichever row the
 * planner reached first, and a rider's sign-in would intermittently resolve to
 * their staff identity. The customer flow asks about the customer account, and
 * this is the query that answers exactly that.
 *
 * `includeWithdrawn` returns a soft-deleted customer row too. Off by default:
 * a closed account is still holding its number, and reporting it as available
 * would send the customer to a registration page the database would then refuse.
 */
export function findCustomerByMobile(phone, { includeWithdrawn = false } = {}) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  return (
    db
      .prepare(
        `SELECT * FROM users
          WHERE role = 'customer'
            ${includeWithdrawn ? '' : 'AND deleted_at IS NULL'}
            AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+91','') = ?
          ORDER BY id
          LIMIT 1`
      )
      .get(normalizedPhone) || null
  );
}

/** The staff account on this number, if any. The mirror of the lookup above. */
export function findStaffByMobileUnscoped(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  return (
    db
      .prepare(
        `SELECT * FROM users
          WHERE role IN ('admin','chef','rider') AND deleted_at IS NULL
            AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+91','') = ?
          ORDER BY id
          LIMIT 1`
      )
      .get(normalizedPhone) || null
  );
}

/**
 * True when a live CUSTOMER account already holds this number.
 *
 * Not "when any account does". A rider's staff row is not evidence that they
 * have ordered from the hotel before, and treating it as such is what made the
 * customer screen refuse them instead of offering them registration.
 */
export function customerMobileIsTaken(phone, exceptUserId = null) {
  const existing = findCustomerByMobile(phone);
  if (!existing) return false;
  return exceptUserId === null ? true : existing.id !== Number(exceptUserId);
}

/** True when this number is on some account of any kind, in any format. */
export function mobileIsTaken(phone, exceptUserId = null) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return false;
  const expression = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+91','')`;
  const row =
    exceptUserId === null
      ? db.prepare(`SELECT id FROM users WHERE ${expression} = ? LIMIT 1`).get(normalizedPhone)
      : db.prepare(`SELECT id FROM users WHERE ${expression} = ? AND id != ? LIMIT 1`).get(normalizedPhone, Number(exceptUserId));
  return Boolean(row);
}

// The purposes that used to belong to a locally generated one-time code.
//
// A one-time code is generated, delivered and checked by MSG91 now - for customers
// and for staff alike - and this module is not part of that any more. These three
// names are listed here so that nothing in this file can quietly become a second way
// to hand out or accept a code: `sendOTP` and `verifyOTP` both refuse them outright,
// below.
//
// The staff purpose joined this set when staff moved onto MSG91. It is the reason a
// development code can no longer reach the staff portal even by accident: a route
// that asked for `staff_login` used to receive six digits, and would have received
// them in an HTTP response, on a server where NODE_ENV is not set. There is now no
// purpose left that this module will generate a code for, which is the clearest
// statement of the new arrangement that can be made in code.
const CUSTOMER_OTP_PURPOSES = new Set(['login', 'registration', 'staff_login']);

/** True when a purpose is one MSG91 now owns. */
export function isCustomerOtpPurpose(purpose) {
  return CUSTOMER_OTP_PURPOSES.has(purpose);
}

/**
 * The refusal both customer-facing entry points give.
 *
 * A specific reason and a specific code, not silence. "There is no local OTP any
 * more" is a fact an operator needs the first time they hit it, and a caller that
 * used to be told "invalid OTP" would otherwise conclude it had typed the wrong
 * digits and sit retrying a code that was never sent to anybody.
 */
function customerOtpRefused() {
  return {
    success: false,
    code: 'OTP_PROVIDED_BY_MSG91',
    message: 'One-time codes are issued and verified by MSG91, so they cannot be checked on this server.'
  };
}

/**
 * Send an OTP. Refused, unconditionally, for every purpose.
 *
 * This used to generate a six-digit code, write it to otp_verifications, print it
 * to the server log, and - outside production - hand it back in the HTTP response
 * so the sign-in screen could show "Development OTP: 618542". That last part is the
 * one that mattered most: on a server where NODE_ENV was never set, which is the
 * normal state of a development machine, a real staff member was authenticating with
 * digits that never travelled by SMS and never would.
 *
 * The body is gone rather than guarded, on purpose. A guard that refuses the three
 * known purposes still generates a code for a fourth one added later, and the whole
 * failure of that arrangement is that it looks correct until the moment it is not.
 * A function that cannot generate a code cannot leak one.
 *
 * The signature is kept so that the two legacy routes calling it - /send-otp and
 * /login - continue to answer with an explanation instead of a 404.
 */
export async function sendOTP(phone, purpose = 'registration') {
  return customerOtpRefused();
}

/**
 * Verify an OTP for a phone number.
 *
 * `purpose` scopes the lookup, and only staff purposes are accepted any more. The
 * customer flow used to arrive here with `purpose = null` - "match the phone's most
 * recent code whatever it was issued for" - so that the code proved control of a
 * number without deciding, on its own, what that number was entitled to. That flow
 * is MSG91's now, and the reason the old behaviour is not merely unused but
 * refused: an unscoped lookup on a number that also has a staff code would match
 * the STAFF row, and this function's answer would be about the wrong identity
 * entirely. A call with no purpose is refused rather than answered ambiguously.
 */
export async function verifyOTP(phone, otpCode, purpose = 'registration') {
  try {
    // The mirror of the refusal in sendOTP, and now unconditional. A code lives at
    // MSG91 and is confirmed through server/src/msg91.js against an access token
    // MSG91 itself issued - so accepting digits here would mean accepting a code
    // this server cannot account for, which is exactly the thing that must not
    // exist. Nothing in this project verifies a code by comparing it to a database
    // row any more.
    return customerOtpRefused();
  } catch (error) {
    console.error('VERIFY OTP ERROR:', error);
    return { success: false, message: 'Failed to verify OTP. Please try again.' };
  }
}


// Check if phone is verified for a specific purpose
export function isPhoneVerified(phone, purpose = 'registration') {
  try {
    const normalizedPhone = normalizePhone(phone);
    
    const verified = db
      .prepare(
        `SELECT * FROM otp_verifications
         WHERE phone = ? AND purpose = ? AND verified = 1
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(normalizedPhone, purpose);

    if (!verified) return false;

    // Check if verification is still valid (within 10 minutes).
    // `created_at` is a SQLite UTC string, so it is read through the shared
    // parser - this call site was appending 'Z' unconditionally, which would
    // have mis-read a value that already carried a zone.
    const verificationMs = parseSqliteTimestamp(verified.created_at);
    if (verificationMs === null) return false;
    const now = new Date();
    const diffMinutes = (now.getTime() - verificationMs) / (1000 * 60);

    return diffMinutes <= 10;
  } catch (error) {
    console.error('IS_PHONE_VERIFIED ERROR:', error);
    return false;
  }
}

// Clean up old verifications (run periodically)
export function cleanupOldVerifications() {
  // Delete verifications older than 24 hours
  db.prepare(
    `DELETE FROM otp_verifications
     WHERE created_at < datetime('now', '-24 hours')`
  ).run();
}
