// Creates (or resets) an admin account. Credentials come from environment variables, never from source code.
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-strong-password' npm run create-admin
// To create the admin in your production database, run it with DATABASE_URL pointing at that database.
import { loadEnv } from '../lib/env.js';
loadEnv();
const { query, closeDb, mode } = await import('../lib/db.js');
const { hashPassword } = await import('../lib/auth.js');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('Set ADMIN_EMAIL to a valid email address.'); process.exit(1); }
if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error('Set ADMIN_PASSWORD to at least 12 characters including letters and numbers.'); process.exit(1);
}
const hash = await hashPassword(password);
const rows = await query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Administrator', $1, $2, 'admin')
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', status = 'active',
  failed_attempts = 0, locked_until = NULL, token_version = users.token_version + 1 RETURNING id`, [email, hash]);
await query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
console.log(`Admin ready: ${email} (database: ${mode()})`);
await closeDb();
process.exit(0);
