// Local development server: serves /public and routes /api/* to the same code Vercel runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './lib/env.js';
loadEnv();
const { route } = await import('./lib/router.js');
const { mode } = await import('./lib/db.js');

const PUB = path.resolve('public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

export const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') return route(req, res);
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(PUB, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('dev.js')) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`WorkSpark running at http://localhost:${port}`);
    if (mode() === 'local-demo') console.log('LOCAL DEMO MODE: using an embedded test database in .data/. Set DATABASE_URL for a real database.');
  });
}
