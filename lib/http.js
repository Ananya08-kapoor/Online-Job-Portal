export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    }
    if (Buffer.isBuffer(req.body)) {
      try { return JSON.parse(req.body.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 200_000) throw new HttpError(413, 'Request body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate and clean an input object.
 * spec: { field: { label, required, min, max, oneOf, email, url, date, type:'int', lower, pattern, msg } }
 */
export function validate(input, spec) {
  const out = {};
  const errors = {};
  input = input && typeof input === 'object' ? input : {};
  for (const [key, r] of Object.entries(spec)) {
    const label = r.label || key;
    let v = input[key];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (r.required) errors[key] = `${label} is required`;
      else out[key] = null;
      continue;
    }
    if (r.type === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n) || (r.min !== undefined && n < r.min) || (r.max !== undefined && n > r.max))
        errors[key] = `${label} must be a whole number between ${r.min ?? 0} and ${r.max ?? 'any'}`;
      else out[key] = n;
      continue;
    }
    if (typeof v !== 'string') { errors[key] = `${label} is invalid`; continue; }
    v = v.trim();
    if (r.min && v.length < r.min) errors[key] = `${label} must be at least ${r.min} characters`;
    else if (r.max && v.length > r.max) errors[key] = `${label} must be at most ${r.max} characters`;
    else if (r.oneOf && !r.oneOf.includes(v)) errors[key] = `${label} is not a valid choice`;
    else if (r.email && !EMAIL.test(v)) errors[key] = 'Enter a valid email address';
    else if (r.url && !validUrl(v)) errors[key] = `${label} must be a valid http(s) link`;
    else if (r.date && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))) errors[key] = `${label} must be a valid date`;
    else if (r.pattern && !r.pattern.test(v)) errors[key] = r.msg || `${label} is invalid`;
    if (!errors[key]) out[key] = r.lower ? v.toLowerCase() : v;
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields', errors);
  return out;
}

function validUrl(v) {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
