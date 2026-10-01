import { db } from './src/db.js';
import bcrypt from 'bcryptjs';

// Test staff creation
const testStaff = {
  name: 'Test Staff',
  phone: '+91 98765 43210',
  email: 'teststaff@darshan.com',
  role: 'chef',
  password: 'password123'
};

// Check if email already exists
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(testStaff.email);
if (existing) {
  console.log('Email already exists, deleting existing test account');
  db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
}

// Insert test staff
const passwordHash = bcrypt.hashSync(testStaff.password, 10);
const result = db.prepare(`
  INSERT INTO users (email, password_hash, name, phone, role, addresses_json, favorites_json, is_active)
  VALUES (?, ?, ?, ?, ?, '[]', '[]', 1)
`).run(testStaff.email, passwordHash, testStaff.name, testStaff.phone, testStaff.role);

console.log('Staff created with ID:', result.lastInsertRowid);

// Verify
const created = db.prepare('SELECT id, name, phone, email, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
console.log('Created staff:', JSON.stringify(created, null, 2));

// Test all staff
const allStaff = db.prepare("SELECT id, name, phone, email, role, is_active, created_at FROM users WHERE role IN ('admin', 'chef', 'rider') ORDER BY is_active DESC, name ASC").all();
console.log('Total staff:', allStaff.length);
allStaff.forEach(s => console.log(`  ${s.name} (${s.email}) - ${s.role} - ${s.is_active ? 'Active' : 'Disabled'}`));