import { db } from './src/db.js';
import bcrypt from 'bcryptjs';

// Test creating staff with admin role
const testStaff = {
  name: 'Paresh Vasava',
  phone: '9586132916',
  email: 'admin26@gmail.com',
  role: 'admin',
  password: 'password123'
};

// Check if email exists
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(testStaff.email);
if (existing) {
  console.log('Email exists, deleting old account');
  db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
}

// Validate
const STAFF_ROLES = ['admin', 'chef', 'rider'];
const role = testStaff.role.toLowerCase();
console.log('Role valid?', STAFF_ROLES.includes(role));
console.log('Password length:', testStaff.password.length);

// Create
const passwordHash = bcrypt.hashSync(testStaff.password, 10);
const result = db.prepare(`
  INSERT INTO users (email, password_hash, name, phone, role, addresses_json, favorites_json, is_active)
  VALUES (?, ?, ?, ?, ?, '[]', '[]', 1)
`).run(testStaff.email, passwordHash, testStaff.name, testStaff.phone, role);

console.log('Staff created:', result.lastInsertRowid);
const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
console.log('Created:', JSON.stringify({id: created.id, name: created.name, email: created.email, role: created.role, is_active: created.is_active}));