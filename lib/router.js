import { HttpError, send, readBody } from './http.js';
import { sessionUser } from './auth.js';
import { mode } from './db.js';
import { routes } from './routes.js';

const compiled = routes.map((r) => {
  const keys = [];
  const re = new RegExp('^' + r.p.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { ...r, re, keys };
});

export async function route(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = (url.pathname.replace(/^\/api/, '').replace(/\/+$/, '')) || '/';
    const method = req.method || 'GET';

    if (path === '/health') return send(res, 200, { ok: true, mode: mode() });

    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (mutating && req.headers.origin) {
      let host = '';
      try { host = new URL(req.headers.origin).host; } catch { /* ignore */ }
      if (host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked');
    }

    let match = null;
    let pathExists = false;
    for (const r of compiled) {
      const m = path.match(r.re);
      if (!m) continue;
      pathExists = true;
      if (r.m === method) { match = { r, m }; break; }
    }
    if (!match) throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Method not allowed' : 'Not found');

    const { r, m } = match;
    const user = await sessionUser(req);
    if (r.auth === true && !user) throw new HttpError(401, 'Please log in to continue');
    if (Array.isArray(r.auth)) {
      if (!user) throw new HttpError(401, 'Please log in to continue');
      if (!r.auth.includes(user.role)) throw new HttpError(403, 'You do not have access to this action');
    }

    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const body = mutating ? await readBody(req) : {};
    const out = await r.h({ req, res, user, params, query: Object.fromEntries(url.searchParams), body });
    return send(res, out?.status || 200, out?.data ?? {});
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, fields: e.fields });
    if (e && e.code === '23505') return send(res, 409, { error: 'That record already exists' });
    console.error('API error:', e);
    return send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}
