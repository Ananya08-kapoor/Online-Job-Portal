import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { query } from './db.js';
import { HttpError } from './http.js';

const COOKIE = 'ws_session';
const isProd = () => !!process.env.VERCEL || process.env.NODE_ENV === 'production';

function secret() {
  let s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    if (isProd()) throw new HttpError(503, 'Server is not configured: set JWT_SECRET (32+ random characters) in Vercel, then redeploy.');
    s = 'local-development-only-secret-do-not-use-in-production';
  }
  return new TextEncoder().encode(s);
}

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
/** Used so that "unknown email" and "wrong password" take the same time. */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-for-timing', 10);

export function passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (Buffer.byteLength(pw) > 72) return 'Password must be at most 72 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must include at least one letter and one number';
  return null;
}

function setCookie(res, value, maxAge) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isProd()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function issueSession(res, user) {
  const jwt = await new SignJWT({ role: user.role, tv: user.token_version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
  setCookie(res, jwt, 7 * 86400);
}

export const clearSession = (res) => setCookie(res, '', 0);

/** Returns the logged-in user (re-checked against the database on every request) or null. */
export async function sessionUser(req) {
  const part = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  const token = part ? part.slice(COOKIE.length + 1) : '';
  if (!token) return null;
  let payload;
  try { ({ payload } = await jwtVerify(token, secret())); }
  catch (e) { if (e instanceof HttpError) throw e; return null; }
  const rows = await query('SELECT id, name, email, role, status, token_version FROM users WHERE id = $1', [Number(payload.sub)]);
  const u = rows[0];
  if (!u || u.status !== 'active' || u.token_version !== payload.tv) return null;
  return u;
}
