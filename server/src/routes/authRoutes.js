import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { db } from '../db.js';
import { sendOTP, verifyOTP, normalizePhone, findCustomerByMobile, customerMobileIsTaken } from '../otpService.js';
import { isMsg91Configured, widgetConfig, notConfiguredMessage, verifyWidgetAccessToken } from '../msg91.js';
import { throttle } from '../otpThrottle.js';
import {
  STAFF_ROLES,
  STAFF_ROLE_HOME,
  findStaffByMobile,
  isValidIndianMobile,
  normaliseMobile,
  staffBlockReason,
  staffStatus
} from '../staffIdentity.js';

const router = express.Router();

const JWT_SECRET =
  process.env.JWT_SECRET || 'hotel-darshan-development-secret-change-this';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ----------------------------------------------------
// The registration session.
//
// Verifying a code proves one thing: the person typing it controls the number.
// It does not create an account, and it is not evidence an account exists. So
// between proving the number and creating the account there is a step, and that
// step needs to carry its own proof - otherwise the registration screen has
// nothing to present and either re-checks the code (which by then is spent, so the
// customer is told their code expired one moment after it worked) or trusts a
// boolean from the browser (which anyone can send).
//
// This is that proof: a signed, short-lived, single-purpose claim on one phone
// number. It carries no OTP, so the spent code is not reused or replayed, and it
// cannot be used to sign in - only to create the one account it names, once.
// ----------------------------------------------------
const REGISTRATION_TOKEN_TTL = '30m';

/**
 * Mint the registration claim for a number whose code was just accepted.
 *
 * The `scope` is what stops this being mistaken for a login token: it is not
 * accepted by the auth middleware, and /register checks for it explicitly.
 */
function issueRegistrationToken(phone) {
  return jwt.sign({ phone, scope: 'customer_registration' }, JWT_SECRET, { expiresIn: REGISTRATION_TOKEN_TTL });
}

/**
 * Read a registration claim back, or explain why it cannot be used.
 *
 * `consumed` is the part that makes it single-use. The claim is a bearer token, so
 * the only way to stop it being replayed is to record that it has been spent; the
 * OTP table is reused for that because a row for a verified code already exists
 * and already belongs to this number. An account created from a claim cannot be
 * created twice, but the claim should also stop being a valid thing to hold.
 */
function readRegistrationToken(token) {
  if (!token) return { ok: false, message: 'Please verify your mobile number with OTP first' };

  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    // Expired, tampered with, or signed by something else. Deliberately vague:
    // which of those three it was is not something a caller needs to know.
    return { ok: false, message: 'This registration session has expired. Please request a new OTP.' };
  }

  if (claims.scope !== 'customer_registration' || !claims.phone) {
    return { ok: false, message: 'Invalid registration session. Please request a new OTP.' };
  }

  return { ok: true, phone: normalizePhone(claims.phone) };
}

/** Mark a registration claim spent, so the same one cannot create a second account. */
function consumeRegistrationToken(phone) {
  db.prepare(
    `UPDATE otp_verifications
        SET consumed_at = datetime('now')
      WHERE phone = ? AND purpose = 'registration' AND consumed_at IS NULL`
  ).run(phone);
}

// ----------------------------------------------------
// Helper: Convert database user into safe frontend user
// ----------------------------------------------------
function formatUser(user) {
  if (!user) return null;

  let addresses = [];
  let favorites = [];

  try {
    addresses = JSON.parse(user.addresses_json || '[]');
  } catch {
    addresses = [];
  }

  try {
    favorites = JSON.parse(user.favorites_json || '[]');
  } catch {
    favorites = [];
  }

  // Treat the old auto-generated mobile fallback email as "no email".
  // Customer auth uses phone + OTP only, so this value is never needed
  // for authentication and should not be shown as the customer's email.
  const email =
    user.email && !user.email.startsWith('mobile_') && user.email !== 'mobile_@hotel-darshan.local'
      ? user.email
      : null;

  return {
    id: user.id,
    email,
    name: user.name,
    phone: user.phone || '',
    role: user.role,
    // What the account is, and where it works. Sent by the server so the client
    // routes a staff member to the right platform from the role the server
    // decided, rather than from a role list each side keeps for itself.
    staffStatus: STAFF_ROLES.includes(user.role) ? staffStatus(user) : null,
    staffHome: STAFF_ROLE_HOME[user.role] || null,
    addresses,
    favorites,
    created_at: user.created_at
  };
}

// ----------------------------------------------------
// Helper: Create JWT
// ----------------------------------------------------
function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN
    }
  );
}

// ----------------------------------------------------
// Helper: Get Bearer token
// ----------------------------------------------------
function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader) return null;

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.substring(7);
}

// ----------------------------------------------------
// Middleware: Authenticate user
// ----------------------------------------------------
export function authenticateToken(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // `is_active` and `deleted_at` are read by the account-state check below, so
    // they have to be selected. Without them staffStatus() sees undefined, reads
    // it as "not active", and refuses every staff member on every route that uses
    // this middleware - including /auth/me, which the app calls on every sign-in.
    const user = db
      .prepare(
        `
        SELECT
          id,
          email,
          name,
          phone,
          role,
          is_active,
          deleted_at,
          addresses_json,
          favorites_json,
          created_at
        FROM users
        WHERE id = ?
        `
      )
      .get(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account no longer exists'
      });
    }

    // The same account-state check the rest of the API makes. It has to be here
    // too: this is the middleware the customer profile endpoints use, so without
    // it a staff account disabled by an admin would keep working on those routes
    // until its token expired. Disabling somebody has to mean it everywhere.
    if (STAFF_ROLES.includes(user.role)) {
      const status = staffStatus(user);
      if (status === 'DELETED') {
        return res.status(403).json({ success: false, message: 'Your staff account has been removed. Please contact the administrator.', code: 'STAFF_DELETED' });
      }
      if (status === 'DISABLED') {
        return res.status(403).json({ success: false, message: 'Your staff account has been disabled by the administrator.', code: 'STAFF_DISABLED' });
      }
    } else if (user.is_active === 0) {
      return res.status(403).json({ success: false, message: 'This account is disabled. Contact the restaurant administrator.' });
    }

    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token'
    });
  }
}

// ----------------------------------------------------
// Customer SMS verification, through MSG91.
//
// Two limits, both about money: how often one number may ask for a text, and how
// often one caller may try to turn a token into a session. The send limit is per
// number because that is who it protects - a person hammering "Continue" is texting
// one number repeatedly. The verify limit is per IP because at that point the number
// is not ours to trust; it is whatever MSG91 said, and the only thing the caller
// controls is where the request came from.
// ----------------------------------------------------
const CUSTOMER_SEND_LIMIT = { limit: 3, windowMs: 5 * 60 * 1000 };
const CUSTOMER_VERIFY_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

// How long a completed verification is recorded for. This row is not a code and
// never was - it is the receipt that keeps the registration claim's bookkeeping
// (consumeRegistrationToken) working exactly as it did when a local code filled the
// same role, and it is what makes the success visible to anyone reading the table.
const VERIFICATION_RECORD_MINUTES = 10;

/**
 * The browser-facing half of MSG91.
 *
 * This is the one endpoint in the project that hands anything to the client, and
 * what it hands over is the widget token - the credential MSG91's Web SDK is
 * documented to be configured with, and the one it was created for. The account
 * authkey is read one file away and deliberately not returned, not logged, and not
 * part of this response under any circumstance; the server is what asks MSG91
 * whether a verification is real.
 *
 * It is unauthenticated because the person using it has no account yet - that is the
 * entire situation the sign-in screen is in - and because the values in it are
 * meant to be visible. Nothing here grants access to anything: a caller holding both
 * values can ask MSG91 to text a number and can read back its own widget state, and
 * can do nothing at all to this application's data.
 */
router.get('/msg91-widget-config', (req, res) => {
  if (!isMsg91Configured()) {
    return res.status(503).json({
      success: false,
      code: 'MSG91_NOT_CONFIGURED',
      message: notConfiguredMessage()
    });
  }

  const { widgetId, tokenAuth } = widgetConfig();
  return res.json({ success: true, provider: 'msg91', widgetId, tokenAuth });
});

// ----------------------------------------------------
// THE STAFF PATH - MSG91, and deliberately separate from the customer path.
//
// Staff codes are issued and checked by the same MSG91 widget the customers use, and
// by nothing else. This server generates no code for anybody any more: not for a
// customer, and not for a member of staff.
//
//   the browser asks the widget to send, and the widget asks MSG91 to text;
//   the browser asks the widget to check what was typed, and the widget asks MSG91;
//   the widget hands back an access token, and THIS server asks MSG91 which number
//     that token actually verified.
//
// The two identities stay separate at the one place that decides who is signing in.
// The number is read out of MSG91's answer, never out of the request, and it is then
// matched against a staff row only. A customer who completes a real MSG91
// verification still cannot reach the staff portal, because being a customer is not
// a staff record; and a member of staff verifying their own number does not thereby
// become a customer. Neither flow can spend the other's verification.
//
// There is no development fallback anywhere on this path. When MSG91 is unconfigured
// the answer is a configuration error naming the missing keys, because the two
// alternatives are both worse: a code generated on this server would be a code
// nobody's SMS ever carried, and quietly falling back to it is how a real
// deployment ends up authenticating staff with digits printed in a browser.
// ----------------------------------------------------
//
// POST /api/auth/send-staff-otp
// Step one of staff sign-in: say whether this number may try.
//
// The staff record is looked up BEFORE a code is sent, and a number that is not
// staff gets nothing at all. That order is the whole security property: if the
// check came after the code was sent, any phone number in India could make this
// server send a message to it, and the only thing left to stop them signing in
// would be the check - so a bug in the check would also be a way to get an SMS
// out of the restaurant's account.
//
// This handler sends nothing itself, for the same reason the customer equivalent
// stopped sending: the code belongs to MSG91 and is sent by the widget in the
// browser. What remains here is policy - format, MSG91 availability, account state,
// and the cost of the request the widget is about to make.
// ----------------------------------------------------
router.post('/send-staff-otp', async (req, res) => {
  try {
    const cleanPhone = normalizePhone(req.body.phone);

    if (!/^([6789])\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit Indian mobile number' });
    }

    // A hard stop, said first. A server with no MSG91 credentials cannot send a
    // real code, and this path has no development code to fall back on any more -
    // which is the point. Saying so is the only honest answer, and it names the
    // keys an operator is missing without revealing any of their values.
    if (!isMsg91Configured()) {
      return res.status(503).json({
        success: false,
        code: 'MSG91_NOT_CONFIGURED',
        message: notConfiguredMessage()
      });
    }

    const staff = findStaffByMobile(db, cleanPhone);
    const blocked = staffBlockReason(staff, cleanPhone);
    if (blocked) {
      // 403 for an account that exists but must not sign in, 404 for one that
      // does not exist. Both refuse; they differ so an admin can tell a typo
      // from somebody trying a number they were given by a customer.
      const status = staff ? 403 : 404;
      return res.status(status).json({
        success: false,
        message: blocked,
        code: staff ? staffStatus(staff) : 'STAFF_NOT_FOUND'
      });
    }

    // Counted here, at the moment the screen asks, rather than when the widget
    // eventually sends - the gap between the two is a network call and a person
    // reading, and it is not a gap worth letting requests queue through. This
    // replaces a cooldown read from otp_verifications, which no longer receives a
    // row for staff because there is no local code to record.
    const gate = throttle(`staff-start:${cleanPhone}`, CUSTOMER_SEND_LIMIT);
    if (!gate.allowed) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${gate.retryAfter} seconds before requesting another code.`,
        code: 'OTP_COOLDOWN',
        retryAfter: gate.retryAfter
      });
    }

    return res.json({
      success: true,
      message: 'A verification code will be sent to this number.',
      // Tells the screen who sends the code and who checks it. There is no
      // console provider left to name.
      otpProvider: 'msg91'
    });
  } catch (error) {
    console.error('SEND STAFF OTP ERROR:', error);
    return res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ----------------------------------------------------
// POST /api/auth/staff-verify-msg91
// Step two: a completed MSG91 verification, and then a session.
//
// The request carries one thing: the access token the widget produced after MSG91
// accepted the code. It carries no phone number, and could not usefully - this
// handler never asks the caller which number it is signing in.
//
//   access token -> MSG91 (with the server's authkey) -> the number MSG91 verified
//
// Only then is a staff record looked up, and it is looked up for that number alone.
// That ordering is the security property, and it is what stops a customer from
// walking into the staff portal: completing a real MSG91 verification proves
// control of a phone, and says nothing whatever about whether that phone is on the
// staff list. The answer to that question is the users table.
//
// The account is also re-read at this moment rather than trusted from when the code
// was sent. Between the two requests an admin can disable or delete the account, and
// a verification that was legitimately completed a minute ago must not still be a
// ticket in.
// ----------------------------------------------------
router.post('/staff-verify-msg91', async (req, res) => {
  try {
    if (!isMsg91Configured()) {
      return res.status(503).json({
        success: false,
        code: 'MSG91_NOT_CONFIGURED',
        message: notConfiguredMessage()
      });
    }

    const gate = throttle(`staff-verify:${req.ip}`, CUSTOMER_VERIFY_LIMIT);
    if (!gate.allowed) {
      return res.status(429).json({
        success: false,
        code: 'OTP_VERIFY_RATE_LIMIT',
        message: `Too many attempts. Please wait ${gate.retryAfter}s before trying again.`,
        retryAfter: gate.retryAfter
      });
    }

    const verified = await verifyWidgetAccessToken(req.body.accessToken);
    if (!verified.ok) {
      // Each refusal gets its own code, because they are genuinely different
      // situations: a code that was mistyped is the person's to retype, a code that
      // has expired is gone, and MSG91 being unreachable is nobody's problem.
      const refusals = {
        missing: [400, 'MSG91_TOKEN_MISSING', 'The verification result was missing. Please request a new code.'],
        no_number: [400, 'OTP_INVALID', 'That code is not valid any more. Please request a new OTP.'],
        rejected: [400, 'OTP_INVALID', 'That code is not valid any more. Please request a new OTP.'],
        unreachable: [503, 'MSG91_UNAVAILABLE', 'We could not confirm your code just now. Please try again in a moment.']
      };
      const [status, code, message] = refusals[verified.reason] || refusals.rejected;
      return res.status(status).json({ success: false, code, message });
    }

    // The one number this request is allowed to act on, and it came from MSG91
    // rather than from anything the caller sent.
    const cleanPhone = verified.phone;

    const staff = findStaffByMobile(db, cleanPhone);
    const blocked = staffBlockReason(staff, cleanPhone);
    if (blocked) {
      // Deliberately the same 403/404 pair the send step uses, for the same
      // reason: a disabled or deleted account is refused, and a number that is not
      // staff at all is refused. Somebody who verifies their own number perfectly
      // still gets nowhere without a staff row behind it.
      const status = staff ? 403 : 404;
      return res.status(status).json({
        success: false,
        message: blocked,
        code: staff ? staffStatus(staff) : 'STAFF_NOT_FOUND'
      });
    }

    const token = createToken(staff);
    return res.json({
      success: true,
      message: 'Staff login successful',
      token,
      user: formatUser(staff)
    });
  } catch (error) {
    console.error('STAFF VERIFY MSG91 ERROR:', error);
    return res.status(500).json({ success: false, message: 'Unable to verify the code' });
  }
});

// ----------------------------------------------------
// POST /api/auth/staff-verify-otp
// Closed. A raw code is no longer proof of anything here.
//
// Staff codes now come from MSG91 and are checked by MSG91. This route used to
// compare six digits against a row this server had generated itself, and a build
// of the staff screen that still called it would be presenting a code the server
// can no longer confirm. Rather than answer it, the route says what happened.
//
// The code that replaces it is /staff-verify-msg91 above, which takes the access
// token the widget produces and asks MSG91 which number it verified.
// ----------------------------------------------------
router.post('/staff-verify-otp', (req, res) => {
  return res.status(410).json({
    success: false,
    code: 'OTP_PROVIDED_BY_MSG91',
    message: 'Staff one-time codes are issued and verified by MSG91, so they cannot be checked on this server. Please use the staff sign-in screen.'
  });
});

// ----------------------------------------------------
// POST /api/auth/staff-login
// Staff portal login is separate from customer OTP login.
// Only admin / chef / rider accounts can use this endpoint.
// ----------------------------------------------------
router.post('/staff-login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const staff = db.prepare(`
      SELECT id, email, name, phone, role, password_hash, addresses_json, favorites_json, created_at, is_active, deleted_at
      FROM users
      WHERE email = ? AND role IN ('admin', 'chef', 'rider')
    `).get(email);

    if (!staff || !staff.password_hash || !bcrypt.compareSync(password, staff.password_hash)) {
      return res.status(401).json({ success: false, message: 'Invalid staff credentials' });
    }
    // Kept working on purpose: this is how the owner account signs in, and it is
    // the same account state the OTP route enforces. Removing it would lock the
    // restaurant out of its own admin page on the grounds that a phone-based
    // sign-in is the nicer design.
    const blocked = staffBlockReason(staff, null);
    if (blocked) {
      return res.status(403).json({
        success: false,
        message: blocked,
        code: staff ? staffStatus(staff) : 'STAFF_NOT_FOUND'
      });
    }

    const token = createToken(staff);
    return res.json({ success: true, message: 'Staff login successful', token, user: formatUser(staff) });
  } catch (error) {
    console.error('STAFF LOGIN ERROR:', error);
    return res.status(500).json({ success: false, message: 'Unable to login to staff portal' });
  }
});

// ----------------------------------------------------
// POST /api/auth/send-otp
// Legacy, and now closed to the customer path.
//
// This used to be how a customer asked for a code. MSG91 does that now, through
// /customer-start-otp and the widget, so this endpoint is kept only so that an older
// build of the client fails with an explanation instead of a 404 - and it will fail,
// because otpService refuses the customer purposes outright. A caller reaching it is
// told what actually happened rather than being left to conclude it was refused a
// code for some reason of its own.
//
// The purpose is the literal 'registration', never one from the request. That used
// to be `req.body.purpose || 'registration'`, which let any caller name 'staff_login'
// and have a code minted for a number of their choosing - not usable to sign in as
// anybody, because every verify route checked a staff record first, but the code
// still came back in the response outside production. That mattered while staff had
// codes of their own, and it is moot now: no purpose reaches a generator at all.
// A route that exists to explain that codes moved to MSG91 has no business being
// able to create one.
// ----------------------------------------------------
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const result = await sendOTP(phone, 'registration');

    if (!result.success) {
      // `code` is passed through so the caller is told *why*. OTP_PROVIDED_BY_MSG91 is
      // the explanation this route exists to give, and dropping it left an older
      // client with a bare refusal and nothing to act on.
      return res.status(400).json({
        success: false,
        message: result.message,
        ...(result.code && { code: result.code })
      });
    }

    return res.json({
      success: true,
      message: result.message,
      ...(result.otp && { otp: result.otp })
    });
  } catch (error) {
    console.error('SEND OTP ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
});

// ----------------------------------------------------
// POST /api/auth/verify-otp
// Legacy, and closed to the customer path, for the same reason as /send-otp above.
// A customer's code is confirmed by MSG91 against an access token, never by
// comparing digits on this server, so this route refuses rather than accepting a
// code it cannot account for.
// ----------------------------------------------------
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }

    const result = await verifyOTP(phone, otp, 'registration');

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    return res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('VERIFY OTP ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
});

// ----------------------------------------------------
// POST /api/auth/register
// Create the customer account for a number whose code was already accepted.
//
// The caller presents a registration claim, not the code. The code was spent by
// the verification step, and re-checking it here is what produced the bug this
// replaced: a customer who had just been told "your number is verified" was then
// told the same code was no longer valid, because verifying it a second time can
// only ever fail. The claim carries that verification forward instead.
// ----------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const cleanName = String(req.body.name || '').trim();
    // Optional, and blank stays blank: nobody ordering dinner is required to own
    // an inbox, and a placeholder address made up from the phone number would end
    // up in delivery receipts as though it were real.
    const cleanEmail = String(req.body.email || '').trim().toLowerCase();
    const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';

    // The phone number is taken from the signed claim, not from the request body.
    // A body can be edited freely; a signed claim cannot, so this is what makes the
    // account land on a number somebody actually proved they control.
    const claim = readRegistrationToken(req.body.registrationToken);
    if (!claim.ok) {
      return res.status(400).json({ success: false, code: 'REGISTRATION_NOT_VERIFIED', message: claim.message });
    }
    const cleanPhone = claim.phone;

    if (!cleanName) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!/^([6789])\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit Indian mobile number' });
    }
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }
    if (cleanEmail) {
      const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND email IS NOT NULL').get(cleanEmail);
      if (emailTaken) return res.status(409).json({ success: false, message: 'This email address is already in use.' });
    }

    // A CUSTOMER account on this number, not any account. A staff row here is not
    // a reason to refuse: working at the hotel and ordering from it are separate,
    // and this call is the one that creates the second identity.
    if (customerMobileIsTaken(cleanPhone)) {
      return res.status(409).json({ success: false, message: 'This mobile number is already registered. Please login instead.' });
    }

    const addresses = address ? [address] : [];

    try {
      // `email` is NULL rather than a value derived from the phone number: NULLs
      // are distinct under the unique index, so customers without an address never
      // collide, and no synthetic address ends up in their account.
      const result = db.prepare(`
        INSERT INTO users (email, password_hash, name, phone, phone_verified, role, addresses_json, favorites_json)
        VALUES (?, ?, ?, ?, 1, 'customer', ?, '[]')
      `).run(cleanEmail || null, '', cleanName, cleanPhone, JSON.stringify(addresses));

      const newUser = db.prepare(`        SELECT
          id,
          email,
          name,
          phone,
          role,
          addresses_json,
          favorites_json,
          created_at,
          is_active,
          deleted_at
        FROM users
        WHERE id = ?`).get(result.lastInsertRowid);
      const user = formatUser(newUser);
      const token = createToken(newUser);

      // The claim has now been spent. Stamping it before the code row is cleared
      // matters only for ordering tidiness - but the row is deleted outright, so
      // there is no code left to replay and nothing about the account depends on
      // it any more. The customer is signed in by the token above, and the next
      // thing they see is the location screen.
      consumeRegistrationToken(cleanPhone);
      db.prepare('DELETE FROM otp_verifications WHERE phone = ? AND purpose = ?').run(cleanPhone, 'registration');

      return res.status(201).json({ success: true, message: 'Account created successfully', token, user });
    } catch (insertErr) {
      // Database-level UNIQUE constraint fallback
      if (String(insertErr.message || '').includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          success: false,
          message: 'This mobile number is already registered. Please login instead.'
        });
      }
      throw insertErr;
    }
  } catch (error) {
    console.error('REGISTER ERROR:', error);
    return res.status(500).json({ success: false, message: 'Unable to create account' });
  }
});

// ----------------------------------------------------
// Customer sign-in, one flow for everybody.
//
// The old screen made the customer choose "Login" or "Register" before they knew
// which one applied, and the choice decided which endpoint the code went to. A
// first-time customer who left it on Login was told "No account found" and never
// reached a code at all; one who switched tabs could have a login code silently
// destroyed by a registration code and then be told "No OTP found or OTP
// already verified", which is not what had happened to them.
//
// So the server decides, from the users table, what a number is entitled to, and
// says so in the reply. The number proves control of the phone; the account
// decides what happens next. Nothing here is keyed on a particular number.
// ----------------------------------------------------

/**
 * What this number is entitled to *as a customer*.
 *
 * Reads only the customer row. A staff row on the same number is not consulted
 * and cannot change the answer: working at the hotel says nothing about whether
 * someone has ordered from it, and the two are separate identities reached
 * through separate flows. This is the check that replaces the old behaviour,
 * where a rider was told to go and use the staff portal instead of being offered
 * the customer app they were standing in.
 */
function customerSituation(phone) {
  const user = findCustomerByMobile(phone);
  if (!user) return { state: 'new' };
  // A closed customer row still holds the number: the customer index is partial
  // on deleted_at, but the row is what reserves the number, so registering a
  // second account for it would be refused. Saying "new" would send the customer
  // to a page whose submit cannot succeed.
  if (user.deleted_at) return { state: 'withdrawn' };
  if (!user.is_active) return { state: 'inactive' };
  return { state: 'existing', id: user.id, name: user.name };
}

// POST /api/auth/customer-start-otp
// Open the customer sign-in step: tell the screen which account state this number
// is in, and let it start a real MSG91 verification.
//
// This no longer sends anything itself, and that is the change worth reading twice.
// It used to call sendOTP(), which generated a code on this server. Now the code
// belongs to MSG91: the screen asks here first - to be told whether this number
// already has a customer account, and whether it is allowed to try at all - and
// then the widget sends. So what remains in this handler is policy, not delivery:
// format, account state, and the rate limit on a request that will cost money a
// moment later.
//
// Ordering still matters, and it is the same ordering as before. The account state
// is decided BEFORE anything is sent, so a closed or disabled account is refused
// without a text ever going out. A number that is staff is not refused, and is not
// consulted: working at the hotel says nothing about ordering from it, and the two
// are separate identities reached through separate flows.
router.post('/customer-start-otp', async (req, res) => {
  try {
    const cleanPhone = normalizePhone(req.body.phone);
    if (!/^([6789])\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit Indian mobile number' });
    }

    // Said before anything else, and it is a hard stop rather than a warning. A
    // server with no MSG91 credentials has no way to send a real code, and the two
    // available alternatives are both unacceptable: pretending a code went out
    // strands every customer on a screen waiting for a text that will never arrive,
    // and generating one here is the thing this integration exists to remove.
    if (!isMsg91Configured()) {
      return res.status(503).json({
        success: false,
        code: 'MSG91_NOT_CONFIGURED',
        message: notConfiguredMessage()
      });
    }

    const situation = customerSituation(cleanPhone);

    if (situation.state === 'inactive') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'This account has been deactivated. Please contact support.'
      });
    }
    if (situation.state === 'withdrawn') {
      return res.status(410).json({
        success: false,
        code: 'ACCOUNT_WITHDRAWN',
        message: 'This account has been closed. Please contact support to reopen it.'
      });
    }

    // Counted here, at the moment the screen asks, rather than when the widget
    // eventually sends. The gap between the two is a network call and a person
    // reading, and it is not a gap worth letting requests queue through.
    const gate = throttle(`customer-start:${cleanPhone}`, CUSTOMER_SEND_LIMIT);
    if (!gate.allowed) {
      return res.status(429).json({
        success: false,
        code: 'COOLDOWN',
        message: `Please wait ${gate.retryAfter}s before requesting another code.`,
        retryAfter: gate.retryAfter
      });
    }

    return res.json({
      success: true,
      message: 'A verification code will be sent to this number.',
      // `exists` is what lets the screen say "sign in" rather than "verify your
      // number" before the customer has read a word of the code.
      exists: situation.state === 'existing',
      // Tells the screen who sends the code and who checks it. The only value this
      // integration emits is 'msg91'; the console provider that answered this
      // endpoint before no longer exists on the customer path.
      otpProvider: 'msg91'
    });
  } catch (error) {
    console.error('CUSTOMER START OTP ERROR:', error);
    return res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// POST /api/auth/customer-verify-msg91
// Exchange a completed MSG91 verification for a Hotel Darshan outcome.
//
// The request carries one thing: the access token the widget produced after MSG91
// accepted the code. It carries no phone number, and could not usefully: this
// handler never asks the caller which number it is signing in.
//
//   access token -> MSG91 (with the server's authkey) -> the number MSG91 verified
//
// Everything after that - which account, if any, that number has, whether it is
// closed or disabled, whether a registration claim is owed - is decided by the same
// `customerSituation()` the pre-MSG91 flow used, reading customer rows only. So
// working at the hotel still does not block ordering from it, and being a customer
// still does not grant the staff portal.
router.post('/customer-verify-msg91', async (req, res) => {
  try {
    if (!isMsg91Configured()) {
      return res.status(503).json({
        success: false,
        code: 'MSG91_NOT_CONFIGURED',
        message: notConfiguredMessage()
      });
    }

    const gate = throttle(`customer-verify:${req.ip}`, CUSTOMER_VERIFY_LIMIT);
    if (!gate.allowed) {
      return res.status(429).json({
        success: false,
        code: 'OTP_VERIFY_RATE_LIMIT',
        message: `Too many attempts. Please wait ${gate.retryAfter}s before trying again.`,
        retryAfter: gate.retryAfter
      });
    }

    const verified = await verifyWidgetAccessToken(req.body.accessToken);

    if (!verified.ok) {
      // Each refusal gets its own code, because they are genuinely different
      // situations and the screen should not say the same thing for all of them:
      // a code the user mistyped is their problem to fix, a code that has expired is
      // gone, and MSG91 being unreachable is nobody's problem at all.
      const refusals = {
        missing: [400, 'MSG91_TOKEN_MISSING', 'The verification result was missing. Please request a new code.'],
        no_number: [400, 'OTP_INVALID', 'That code is not valid any more. Please request a new OTP.'],
        rejected: [400, 'OTP_INVALID', 'That code is not valid any more. Please request a new OTP.'],
        unreachable: [503, 'MSG91_UNAVAILABLE', 'We could not confirm your code just now. Please try again in a moment.']
      };
      const [status, code, message] = refusals[verified.reason] || refusals.rejected;
      return res.status(status).json({ success: false, code, message });
    }

    // The one number this whole request is allowed to act on, and it came from
    // MSG91 rather than from anything the caller sent.
    const cleanPhone = verified.phone;

    const situation = customerSituation(cleanPhone);

    // Checked after the verification, not before: MSG91 has already confirmed the
    // person controls this number at this point, so these are account states
    // rather than questions about identity.
    if (situation.state === 'withdrawn') {
      return res.status(410).json({
        success: false,
        code: 'ACCOUNT_WITHDRAWN',
        message: 'This account has been closed. Please contact support to reopen it.'
      });
    }
    if (situation.state === 'inactive') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'This account has been deactivated. Please contact support.'
      });
    }

    // The receipt. No code is written - there is none on this server to write, and
    // `otp_code` stays empty rather than being filled with anything invented. What
    // the row carries is proof that this number was verified and when, which is what
    // `consumeRegistrationToken` stamps when the account is created from the claim
    // below. That function updates a purpose='registration' row; without this row
    // its UPDATE would simply match nothing and the single-use guarantee it is
    // there to provide would quietly stop existing.
    const purpose = situation.state === 'existing' ? 'login' : 'registration';
    db.prepare(
      `INSERT INTO otp_verifications (phone, otp_code, purpose, verified, expires_at)
       VALUES (?, '', ?, 1, datetime('now', ?))`
    ).run(cleanPhone, purpose, `+${VERIFICATION_RECORD_MINUTES} minutes`);

    if (situation.state === 'existing') {
      // Read the customer row directly rather than through any unscoped lookup. On a
      // number held by both a staff row and a customer row, an unscoped read would
      // return whichever the planner reached first, and a rider would be handed a
      // customer session carrying a staff role - which the client then rejects,
      // leaving the screen to reappear having said nothing.
      const user = findCustomerByMobile(cleanPhone);
      const token = createToken(user);
      return res.json({
        success: true,
        message: 'Login successful',
        needsRegistration: false,
        token,
        user: formatUser(user)
      });
    }

    // Verified, and there is no customer account for this number. Nothing is created
    // here: the code proved who holds the number, not that they wish to be an
    // account. What comes back instead is the same short-lived, single-purpose
    // claim as before, naming one number and one action.
    return res.json({
      success: true,
      message: 'Mobile number verified',
      needsRegistration: true,
      phone: cleanPhone,
      registrationToken: issueRegistrationToken(cleanPhone)
    });
  } catch (error) {
    console.error('CUSTOMER VERIFY MSG91 ERROR:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP. Please try again.' });
  }
});

// ----------------------------------------------------
// POST /api/auth/login
// Legacy, and closed to the customer path.
//
// Customer sign-in is /customer-verify-msg91. This route checked a code against this
// server's own table, which no customer code is in any more, so verifyOTP refuses
// the 'login' purpose and this answers with that explanation instead of a session.
// Kept, like /send-otp, so an older client gets a reason rather than a 404.
// ----------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const cleanPhone = normalizePhone(req.body.phone);
    if (!/^([6789])\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit Indian mobile number' });
    }

    const result = await verifyOTP(cleanPhone, req.body.otp, 'login');
    if (!result.success) return res.status(400).json({ success: false, message: result.message });

    // Customer account only. A staff row on this number is not the customer
    // account, and returning one here would hand a rider a customer-app token
    // carrying a staff role - which the client then rejects, leaving the screen
    // to reappear with nothing said. So the answer is either the customer or
    // nothing at all.
    const user = findCustomerByMobile(cleanPhone);
    if (!user) return res.status(404).json({ success: false, message: 'No customer account found for this mobile number. Please register first.' });

    const token = createToken(user);
    return res.json({ success: true, message: 'Login successful', token, user: formatUser(user) });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    return res.status(500).json({ success: false, message: 'Unable to login' });
  }
});

// Legacy, and closed to the customer path - see /login above. The customer lookup
// it still performs is correct and is deliberately left in place: it reads customer
// rows only, so it can never hand a rider a customer session. What refuses is the
// send, because there is no local customer code left to send.
router.post('/send-login-otp', async (req, res) => {
  try {
    const cleanPhone = normalizePhone(req.body.phone);
    if (!/^([6789])\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit Indian mobile number' });
    }
    const user = findCustomerByMobile(cleanPhone);
    if (!user) return res.status(404).json({ success: false, message: 'No customer account found. Please register first.' });

    const result = await sendOTP(cleanPhone, 'login');
    if (!result.success) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message, ...(result.otp && { otp: result.otp }) });
  } catch (error) {
    console.error('SEND LOGIN OTP ERROR:', error);
    return res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ----------------------------------------------------
// GET /api/auth/me
// ----------------------------------------------------
router.get('/me', authenticateToken, (req, res) => {
  return res.json({
    success: true,
    user: formatUser(req.user)
  });
});

// ----------------------------------------------------
// PUT /api/auth/profile
// ----------------------------------------------------
router.put('/profile', authenticateToken, (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      addresses,
      favorites
    } = req.body;

    const currentUser = req.user;

    const updatedName =
      name !== undefined
        ? String(name).trim()
        : currentUser.name;

    if (!updatedName) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    let updatedPhone;
    if (phone !== undefined && String(phone).trim() !== '') {
      updatedPhone = normalizePhone(phone);
      if (!/^([6789])\d{9}$/.test(updatedPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid 10-digit Indian mobile number'
        });
      }
      // Customer rows only, for the same reason as everywhere else on the
      // customer side: a staff row on the number is a separate identity, so
      // holding it is not a conflict. Two *customer* rows on one number still are.
      const phoneTaken = customerMobileIsTaken(updatedPhone, currentUser.id);
      if (phoneTaken) {
        return res.status(409).json({
          success: false,
          message: 'This mobile number is already linked to another account'
        });
      }
    } else {
      updatedPhone = currentUser.phone || null;
    }

    // Email is a real, optional profile field. It is never auto-generated.
    let updatedEmail;
    if (email !== undefined && email !== null) {
      const rawEmail = String(email).trim();
      if (rawEmail === '') {
        updatedEmail = null;
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid email address'
        });
      } else {
        updatedEmail = rawEmail.toLowerCase();
        const emailTaken = db
          .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
          .get(updatedEmail, currentUser.id);
        if (emailTaken) {
          return res.status(409).json({
            success: false,
            message: 'This email address is already linked to another account'
          });
        }
      }
    } else {
      updatedEmail = currentUser.email || null;
    }

    let updatedAddresses;

    if (addresses !== undefined) {
      updatedAddresses = JSON.stringify(addresses);
    } else {
      updatedAddresses = currentUser.addresses_json || '[]';
    }

    let updatedFavorites;

    if (favorites !== undefined) {
      updatedFavorites = JSON.stringify(favorites);
    } else {
      updatedFavorites = currentUser.favorites_json || '[]';
    }

    db.prepare(
      `
      UPDATE users
      SET
        name = ?,
        phone = ?,
        email = ?,
        addresses_json = ?,
        favorites_json = ?
      WHERE id = ?
      `
    ).run(
      updatedName,
      updatedPhone,
      updatedEmail,
      updatedAddresses,
      updatedFavorites,
      currentUser.id
    );

    const updatedUser = db
      .prepare(
        `
        SELECT
          id,
          email,
          name,
          phone,
          role,
          addresses_json,
          favorites_json,
          created_at
        FROM users
        WHERE id = ?
        `
      )
      .get(currentUser.id);

    return res.json({
      success: true,
      message: 'Your profile was updated successfully',
      user: formatUser(updatedUser)
    });
  } catch (error) {
    console.error('PROFILE UPDATE ERROR:', error);

    const rawMessage = String(error?.message || '');

    if (rawMessage.includes('UNIQUE constraint failed: users.email')) {
      return res.status(409).json({
        success: false,
        message: 'This email address is already linked to another account'
      });
    }
    if (rawMessage.includes('UNIQUE constraint failed: users.phone')) {
      return res.status(409).json({
        success: false,
        message: 'This mobile number is already linked to another account'
      });
    }

    return res.status(500).json({
      success: false,
      message: rawMessage || 'Unable to update profile'
    });
  }
});

// ----------------------------------------------------
// GET /api/auth/test
// ----------------------------------------------------
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Hotel Darshan authentication API is working'
  });
});

export default router;