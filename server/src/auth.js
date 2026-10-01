import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { staffStatus, STAFF_ROLES } from './staffIdentity.js';

const JWT_SECRET = process.env.JWT_SECRET || 'hotel-darshan-development-secret-change-this';

// Exported so the Socket.IO handshake verifies the same token against the same
// secret as the HTTP middleware, rather than keeping a second copy that can
// drift and reject a valid session.
export { JWT_SECRET };

/** Verify a bearer token and return the decoded claims, or null. */
export function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// The identity every protected request runs on. `is_active` and `deleted_at` are
// read here, on every request, rather than trusted from the token - that is the
// whole reason an admin disabling a rider takes effect immediately instead of
// whenever the seven-day token happens to expire.
const IDENTITY_COLUMNS = `id, email, name, phone, role, addresses_json, favorites_json, is_active, deleted_at, created_at`;

/**
 * Turn a refused staff account into a response the client can act on.
 *
 * A code is included because the app has to behave differently: a 401 clears the
 * session and sends the rider to the sign-in screen, and the rider needs to be
 * told *why* they are back at the sign-in screen. Without the code the only
 * honest thing the client could say is "please sign in again", which sends a
 * disabled rider round the same loop for ever.
 */
function refuseAccount(res, row) {
  const status = staffStatus(row);
  if (status === 'DELETED') {
    return res.status(403).json({
      error: 'Your staff account has been removed. Please contact the administrator.',
      code: 'STAFF_DELETED',
      staffStatus: status
    });
  }
  if (status === 'DISABLED') {
    return res.status(403).json({
      error: 'Your staff account has been disabled by the administrator.',
      code: 'STAFF_DISABLED',
      staffStatus: status
    });
  }
  return null;
}

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM users WHERE id = ?`).get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    // A staff account is stopped here rather than at sign-in, so that turning
    // somebody off takes effect on their next request instead of their next
    // login. A customer account is not affected: they have no staff state.
    if (STAFF_ROLES.includes(user.role)) {
      const refusal = refuseAccount(res, user);
      if (refusal) return refusal;
    } else if (user.is_active === 0) {
      // Customers have no staff status, so the flag itself is still the whole
      // answer for them, exactly as it was before staff accounts existed.
      return res.status(403).json({ error: 'This account is disabled. Contact the restaurant administrator.' });
    }
    user.addresses = JSON.parse(user.addresses_json || '[]');
    user.favorites = JSON.parse(user.favorites_json || '[]');
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, email, name, phone, role, addresses_json, favorites_json, is_active FROM users WHERE id = ?').get(decoded.id);
      if (user) {
        user.addresses = JSON.parse(user.addresses_json || '[]');
        user.favorites = JSON.parse(user.favorites_json || '[]');
        req.user = user;
      }
    } catch {
      // Ignore token parse error for optional auth
    }
  }
  next();
}

export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
}

export function loginUser(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (user.is_active === 0) {
    throw new Error('This account is disabled. Contact the restaurant administrator.');
  }

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) {
    throw new Error('Invalid email or password');
  }

  const safeUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    addresses: JSON.parse(user.addresses_json || '[]'),
    favorites: JSON.parse(user.favorites_json || '[]')
  };

  const token = generateToken(safeUser);
  return { user: safeUser, token };
}

export function registerUser(name, email, phone, password) {
  const cleanEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    throw new Error('An account with this email already exists');
  }

  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);

  const result = db.prepare(`
    INSERT INTO users (email, password_hash, name, phone, role, addresses_json, favorites_json)
    VALUES (?, ?, ?, ?, 'customer', '[]', '[]')
  `).run(cleanEmail, password_hash, name, phone);

  const safeUser = {
    id: result.lastInsertRowid,
    email: cleanEmail,
    name,
    phone,
    role: 'customer',
    addresses: [],
    favorites: []
  };

  const token = generateToken(safeUser);
  return { user: safeUser, token };
}
