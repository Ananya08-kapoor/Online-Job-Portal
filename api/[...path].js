import { route } from '../lib/router.js';

// One serverless function serves every /api/* request (keeps you under Vercel's function limits).
export default function handler(req, res) {
  return route(req, res);
}
