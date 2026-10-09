import fs from 'node:fs';
import pg from 'pg';
import { SCHEMA } from './schema.js';
import { HttpError } from './http.js';

/**
 * 'postgres'     : DATABASE_URL is set (production, Neon/Supabase/any Postgres)
 * 'local-demo'   : no DATABASE_URL and not on Vercel: an embedded Postgres (PGlite) stored in .data/ for testing only
 * 'unconfigured' : on Vercel without DATABASE_URL (API answers with a clear error)
 */
export function mode() {
  if (process.env.DATABASE_URL) return 'postgres';
  return process.env.VERCEL ? 'unconfigured' : 'local-demo';
}

let ready = null;

function init() {
  if (ready) return ready;
  ready = (async () => {
    let impl;
    if (mode() === 'postgres') {
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 3,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 8000,
      });
      impl = { query: async (t, p) => (await pool.query(t, p)).rows, exec: (s) => pool.query(s), close: () => pool.end() };
    } else if (mode() === 'local-demo') {
      const name = '@electric-sql/pglite';   // variable import so Vercel never bundles it
      let PGlite;
      try { ({ PGlite } = await import(name)); }
      catch { throw new HttpError(503, 'Local demo database missing. Run: npm install'); }
      const dir = process.env.LOCAL_DB_DIR || '.data/pglite';
      fs.mkdirSync(dir, { recursive: true });
      const db = new PGlite(dir);
      await db.waitReady;
      impl = { query: async (t, p) => (await db.query(t, p)).rows, exec: (s) => db.exec(s), close: () => db.close() };
    } else {
      throw new HttpError(503, 'The database is not configured. Add DATABASE_URL in your Vercel project settings, then redeploy.');
    }
    try { await impl.exec(SCHEMA); }
    catch { await new Promise((r) => setTimeout(r, 400)); await impl.exec(SCHEMA); }
    return impl;
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

export const query = async (text, params = []) => (await init()).query(text, params);

export async function closeDb() {
  if (ready) { const i = await ready; await i.close(); ready = null; }
}
