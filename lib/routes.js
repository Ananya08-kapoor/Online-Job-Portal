import crypto from 'node:crypto';
import { query, mode } from './db.js';
import { HttpError, validate } from './http.js';
import { hashPassword, verifyPassword, DUMMY_HASH, issueSession, clearSession, passwordError } from './auth.js';
import { sendResetEmail } from './mail.js';

const JOB_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'];
const EXPERIENCE = ['Fresher', '0-1 years', '1-3 years', '3-5 years', '5+ years'];
const FLOW = ['applied', 'under_review', 'shortlisted', 'interview', 'selected', 'rejected'];
const canMove = (from, to) => !['selected', 'rejected'].includes(from) && from !== to && FLOW.indexOf(to) > FLOW.indexOf(from);

const ok = (data, status = 200) => ({ status, data });
const fail = (status, msg, fields) => new HttpError(status, msg, fields);
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const like = (s) => '%' + s.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';
const todayISO = () => new Date().toISOString().slice(0, 10);

const JOB_COLS = `j.id, j.employer_id, j.title, j.company, j.location, j.type, j.experience, j.salary_min, j.salary_max,
  j.description, to_char(j.deadline,'YYYY-MM-DD') AS deadline, j.status, j.remarks, j.created_at`;

const jobOut = (r) => ({
  id: r.id, employerId: r.employer_id, title: r.title, company: r.company, location: r.location, type: r.type,
  experience: r.experience, salaryMin: r.salary_min, salaryMax: r.salary_max, description: r.description,
  deadline: r.deadline, status: r.status, remarks: r.remarks, createdAt: r.created_at, applied: !!r.applied,
  applicants: r.applicants, newApplicants: r.new_applicants, employerName: r.employer_name, employerEmail: r.employer_email,
});

const jobSpec = {
  title: { label: 'Job title', required: true, min: 3, max: 120 },
  company: { label: 'Company', max: 120 },
  location: { label: 'Location', required: true, min: 2, max: 100 },
  type: { label: 'Job type', required: true, oneOf: JOB_TYPES },
  experience: { label: 'Experience', required: true, oneOf: EXPERIENCE },
  salaryMin: { label: 'Minimum salary', type: 'int', min: 0, max: 1000 },
  salaryMax: { label: 'Maximum salary', type: 'int', min: 0, max: 1000 },
  description: { label: 'Description', required: true, min: 30, max: 5000 },
  deadline: { label: 'Deadline', date: true },
};

function cleanJob(body, defaultCompany) {
  const v = validate(body, jobSpec);
  const errors = {};
  if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) errors.salaryMax = 'Maximum salary must be at least the minimum';
  if (v.deadline && v.deadline < todayISO()) errors.deadline = 'Deadline cannot be in the past';
  v.company = v.company || defaultCompany;
  if (!v.company) errors.company = 'Company is required (add it to your company profile)';
  if (Object.keys(errors).length) throw fail(400, 'Please fix the highlighted fields', errors);
  return v;
}

async function profileOf(id) {
  const r = await query('SELECT data FROM profiles WHERE user_id = $1', [id]);
  return r[0]?.data || {};
}

/* ---------------- auth ---------------- */

async function signup({ body, res }) {
  const v = validate(body, {
    name: { label: 'Name', required: true, min: 2, max: 80 },
    email: { label: 'Email', required: true, email: true, max: 120, lower: true },
    role: { label: 'Account type', required: true, oneOf: ['seeker', 'employer'] },
    companyName: { label: 'Company name', max: 120 },
  });
  const pwErr = passwordError(body.password);
  if (pwErr) throw fail(400, 'Please fix the highlighted fields', { password: pwErr });
  if (v.role === 'employer' && !v.companyName) throw fail(400, 'Please fix the highlighted fields', { companyName: 'Company name is required for employers' });
  if ((await query('SELECT 1 FROM users WHERE email = $1', [v.email])).length)
    throw fail(409, 'An account with this email already exists', { email: 'Already registered. Try logging in.' });
  const hash = await hashPassword(body.password);
  const [u] = await query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, status, token_version',
    [v.name, v.email, hash, v.role]);
  await query('INSERT INTO profiles (user_id, data) VALUES ($1, $2::jsonb)', [u.id, JSON.stringify(v.role === 'employer' ? { companyName: v.companyName } : {})]);
  await issueSession(res, u);
  return ok({ user: pub(u) }, 201);
}

async function login({ body, res }) {
  const email = String(body.email || '').trim().toLowerCase();
  const pw = String(body.password || '');
  if (!email || !pw) throw fail(400, 'Enter your email and password');
  const [u] = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (u?.locked_until && new Date(u.locked_until) > new Date())
    throw fail(429, 'Too many failed attempts. Please wait 15 minutes or reset your password.');
  const good = await verifyPassword(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !good) {
    if (u) {
      const n = u.failed_attempts + 1;
      await query('UPDATE users SET failed_attempts = $1, locked_until = $2::timestamptz WHERE id = $3',
        [n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, u.id]);
    }
    throw fail(401, 'Invalid email or password');
  }
  if (u.status !== 'active') throw fail(403, 'This account is suspended. Please contact the portal admin.');
  await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
  await issueSession(res, u);
  return ok({ user: pub(u) });
}

const logout = async ({ res }) => { clearSession(res); return ok({ ok: true }); };
const me = async ({ user }) => ok({ user: user ? pub(user) : null, mode: mode() });

async function forgot({ req, body }) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw fail(400, 'Enter a valid email address', { email: 'Enter a valid email address' });
  const generic = 'If an account exists for that email, a reset link has been sent.';
  const [u] = await query("SELECT id, email FROM users WHERE email = $1 AND status = 'active'", [email]);
  if (!u) return ok({ message: generic });
  const token = crypto.randomBytes(32).toString('hex');
  await query('DELETE FROM password_resets WHERE user_id = $1', [u.id]);
  await query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3::timestamptz)',
    [u.id, sha(token), new Date(Date.now() + 3600_000).toISOString()]);
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const base = (process.env.APP_URL || `${proto}://${req.headers.host}`).replace(/\/$/, '');
  const link = `${base}/#/reset?token=${token}`;
  const sent = await sendResetEmail(u.email, link).catch(() => false);
  const out = { message: generic };
  if (!sent && mode() === 'local-demo') out.devResetLink = link;          // local demo only: never returned in production
  if (!sent && mode() !== 'local-demo') console.warn('Password reset requested but email is not configured (set RESEND_API_KEY and MAIL_FROM).');
  return ok(out);
}

async function reset({ body }) {
  const token = String(body.token || '');
  const pwErr = passwordError(body.password);
  if (pwErr) throw fail(400, 'Please fix the highlighted fields', { password: pwErr });
  const [row] = await query('SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha(token)]);
  if (!row) throw fail(400, 'This reset link is invalid or has expired. Request a new one.');
  await query('UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = $2',
    [await hashPassword(body.password), row.user_id]);
  await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id]);
  return ok({ message: 'Password updated. You can log in now.' });
}

/* ---------------- profile ---------------- */

async function getProfile({ user }) {
  return ok({ user: pub(user), profile: await profileOf(user.id) });
}

async function putProfile({ user, body }) {
  const base = validate(body, { name: { label: 'Name', required: true, min: 2, max: 80 } });
  let data;
  if (user.role === 'seeker') {
    const v = validate(body, {
      headline: { label: 'Headline', max: 120 },
      phone: { label: 'Phone', pattern: /^[0-9+\-\s()]{7,20}$/, msg: 'Enter a valid phone number' },
      location: { label: 'Location', max: 100 },
      skills: { label: 'Skills', max: 500 },
      experience: { label: 'Experience', max: 2000 },
      education: { label: 'Education', max: 1000 },
      bio: { label: 'About you', max: 2000 },
      resumeUrl: { label: 'Resume link', url: true, max: 300 },
    });
    v.skills = (v.skills || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30).map((s) => s.slice(0, 40));
    data = v;
  } else if (user.role === 'employer') {
    data = validate(body, {
      companyName: { label: 'Company name', required: true, min: 2, max: 120 },
      website: { label: 'Website', url: true, max: 200 },
      location: { label: 'Location', max: 100 },
      about: { label: 'About the company', max: 2000 },
    });
  } else data = {};
  await query('UPDATE users SET name = $1 WHERE id = $2', [base.name, user.id]);
  await query(`INSERT INTO profiles (user_id, data) VALUES ($1, $2::jsonb)
               ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`, [user.id, JSON.stringify(data)]);
  return ok({ user: { ...pub(user), name: base.name }, profile: data });
}

/* ---------------- public jobs ---------------- */

async function listJobs({ user, query: q }) {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = 10;
  const where = ["j.status = 'approved'", '(j.deadline IS NULL OR j.deadline >= CURRENT_DATE)'];
  const p = [];
  const add = (sql, val) => { p.push(val); where.push(sql.replaceAll('?', () => '$' + p.length)); };
  if (q.q?.trim()) add('(j.title ILIKE ? OR j.company ILIKE ? OR j.description ILIKE ?)', like(q.q));
  if (q.location?.trim()) add('j.location ILIKE ?', like(q.location));
  if (JOB_TYPES.includes(q.type)) add('j.type = ?', q.type);
  if (EXPERIENCE.includes(q.experience)) add('j.experience = ?', q.experience);
  const min = parseInt(q.minSalary);
  if (min > 0) add('COALESCE(j.salary_max, j.salary_min, 0) >= ?', min);
  const W = where.join(' AND ');
  const total = (await query(`SELECT count(*)::int AS n FROM jobs j WHERE ${W}`, p))[0].n;
  const p2 = [...p];
  let applied = 'false AS applied';
  if (user?.role === 'seeker') {
    p2.push(user.id);
    applied = `EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.seeker_id = $${p2.length}) AS applied`;
  }
  const order = q.sort === 'salary' ? 'COALESCE(j.salary_max, j.salary_min, 0) DESC, j.id DESC' : 'j.created_at DESC, j.id DESC';
  const rows = await query(`SELECT ${JOB_COLS}, ${applied} FROM jobs j WHERE ${W} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, p2);
  return ok({ jobs: rows.map(jobOut), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}

async function getJob({ user, params }) {
  const id = Number(params.id);
  const [r] = await query(`SELECT ${JOB_COLS},
      EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.seeker_id = $2) AS applied
      FROM jobs j WHERE j.id = $1`, [id, user?.id ?? 0]);
  const visible = r && (r.status === 'approved' || user?.role === 'admin' || user?.id === r.employer_id);
  if (!visible) throw fail(404, 'Job not found');
  return ok({ job: jobOut(r) });
}

/* ---------------- seeker ---------------- */

async function applyToJob({ user, params, body }) {
  const id = Number(params.id);
  const [job] = await query("SELECT id, status, to_char(deadline,'YYYY-MM-DD') AS deadline FROM jobs WHERE id = $1", [id]);
  if (!job || job.status !== 'approved') throw fail(404, 'This job is not open for applications');
  if (job.deadline && job.deadline < todayISO()) throw fail(400, 'The application deadline for this job has passed');
  const v = validate(body, { coverLetter: { label: 'Cover letter', max: 2000 } });
  try {
    const [a] = await query('INSERT INTO applications (job_id, seeker_id, cover_letter) VALUES ($1,$2,$3) RETURNING id, status', [id, user.id, v.coverLetter]);
    return ok({ application: { id: a.id, status: a.status } }, 201);
  } catch (e) {
    if (e.code === '23505') throw fail(409, 'You have already applied to this job');
    throw e;
  }
}

async function myApplications({ user }) {
  const rows = await query(`SELECT a.id, a.status, a.cover_letter, a.created_at, a.updated_at,
      j.id AS job_id, j.title, j.company, j.location, j.type, j.status AS job_status
      FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.seeker_id = $1 ORDER BY a.created_at DESC`, [user.id]);
  return ok({ applications: rows.map((r) => ({
    id: r.id, status: r.status, coverLetter: r.cover_letter, createdAt: r.created_at, updatedAt: r.updated_at,
    jobId: r.job_id, title: r.title, company: r.company, location: r.location, type: r.type, jobStatus: r.job_status })) });
}

async function withdraw({ user, params }) {
  const [a] = await query('SELECT id, status FROM applications WHERE id = $1 AND seeker_id = $2', [Number(params.id), user.id]);
  if (!a) throw fail(404, 'Application not found');
  if (!['applied', 'under_review'].includes(a.status)) throw fail(400, 'This application can no longer be withdrawn');
  await query('DELETE FROM applications WHERE id = $1', [a.id]);
  return ok({ ok: true });
}

/* ---------------- employer ---------------- */

async function ownedJob(user, id) {
  const [j] = await query('SELECT * FROM jobs WHERE id = $1 AND employer_id = $2', [Number(id), user.id]);
  if (!j) throw fail(404, 'Job not found');
  return j;
}

async function employerJobs({ user }) {
  const rows = await query(`SELECT ${JOB_COLS},
      (SELECT count(*)::int FROM applications a WHERE a.job_id = j.id) AS applicants,
      (SELECT count(*)::int FROM applications a WHERE a.job_id = j.id AND a.status = 'applied') AS new_applicants
      FROM jobs j WHERE j.employer_id = $1 ORDER BY j.created_at DESC`, [user.id]);
  return ok({ jobs: rows.map(jobOut) });
}

async function createJob({ user, body }) {
  const prof = await profileOf(user.id);
  const v = cleanJob(body, prof.companyName);
  const [r] = await query(`INSERT INTO jobs (employer_id, title, company, location, type, experience, salary_min, salary_max, description, deadline)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date) RETURNING id`,
    [user.id, v.title, v.company, v.location, v.type, v.experience, v.salaryMin, v.salaryMax, v.description, v.deadline]);
  return ok({ id: r.id, message: 'Submitted for admin approval' }, 201);
}

async function updateJob({ user, params, body }) {
  const job = await ownedJob(user, params.id);
  if (job.status === 'closed') throw fail(400, 'Closed jobs cannot be edited');
  const prof = await profileOf(user.id);
  const v = cleanJob(body, prof.companyName);
  await query(`UPDATE jobs SET title=$1, company=$2, location=$3, type=$4, experience=$5, salary_min=$6, salary_max=$7,
      description=$8, deadline=$9::date, status='pending', remarks=NULL, updated_at=now() WHERE id=$10`,
    [v.title, v.company, v.location, v.type, v.experience, v.salaryMin, v.salaryMax, v.description, v.deadline, job.id]);
  return ok({ message: 'Saved. The job will be reviewed by the admin again before going live.' });
}

async function closeJob({ user, params }) {
  const job = await ownedJob(user, params.id);
  if (job.status !== 'approved') throw fail(400, 'Only live jobs can be closed');
  await query("UPDATE jobs SET status='closed', updated_at=now() WHERE id=$1", [job.id]);
  return ok({ ok: true });
}

async function deleteOwnJob({ user, params }) {
  const job = await ownedJob(user, params.id);
  await query('DELETE FROM jobs WHERE id = $1', [job.id]);
  return ok({ ok: true });
}

async function applicants({ user, params }) {
  const job = await ownedJob(user, params.id);
  const rows = await query(`SELECT a.id, a.status, a.cover_letter, a.created_at, u.name, u.email, p.data AS profile
      FROM applications a JOIN users u ON u.id = a.seeker_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE a.job_id = $1 ORDER BY a.created_at DESC`, [job.id]);
  return ok({
    job: { id: job.id, title: job.title, company: job.company, status: job.status },
    applicants: rows.map((r) => ({ id: r.id, status: r.status, coverLetter: r.cover_letter, createdAt: r.created_at,
      name: r.name, email: r.email, profile: r.profile || {} })),
  });
}

async function setApplicationStatus({ user, params, body }) {
  const status = String(body.status || '');
  if (!FLOW.includes(status)) throw fail(400, 'Choose a valid status');
  const [a] = await query(`SELECT a.id, a.status FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.id = $1 AND j.employer_id = $2`, [Number(params.id), user.id]);
  if (!a) throw fail(404, 'Application not found');
  if (!canMove(a.status, status)) throw fail(400, `Cannot move an application from "${a.status.replace('_', ' ')}" to "${status.replace('_', ' ')}"`);
  await query('UPDATE applications SET status = $1, updated_at = now() WHERE id = $2', [status, a.id]);
  return ok({ id: a.id, status });
}

/* ---------------- admin ---------------- */

async function adminJobs({ query: q }) {
  const where = [];
  const p = [];
  const add = (sql, val) => { p.push(val); where.push(sql.replaceAll('?', () => '$' + p.length)); };
  if (['pending', 'approved', 'rejected', 'closed'].includes(q.status)) add('j.status = ?', q.status);
  if (q.q?.trim()) add('(j.title ILIKE ? OR j.company ILIKE ? OR u.email ILIKE ?)', like(q.q));
  const rows = await query(`SELECT ${JOB_COLS}, u.name AS employer_name, u.email AS employer_email,
      (SELECT count(*)::int FROM applications a WHERE a.job_id = j.id) AS applicants
      FROM jobs j JOIN users u ON u.id = j.employer_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (j.status = 'pending') DESC, j.created_at DESC LIMIT 100`, p);
  return ok({ jobs: rows.map(jobOut) });
}

async function reviewJob({ params, body }) {
  const action = body.action;
  if (!['approve', 'reject'].includes(action)) throw fail(400, 'Choose approve or reject');
  const [job] = await query('SELECT id, status FROM jobs WHERE id = $1', [Number(params.id)]);
  if (!job) throw fail(404, 'Job not found');
  if (job.status !== 'pending') throw fail(400, 'Only jobs waiting for approval can be reviewed');
  if (action === 'approve') {
    await query("UPDATE jobs SET status='approved', remarks=NULL, updated_at=now() WHERE id=$1", [job.id]);
  } else {
    const v = validate(body, { remarks: { label: 'Remarks', required: true, min: 5, max: 500 } });
    await query("UPDATE jobs SET status='rejected', remarks=$1, updated_at=now() WHERE id=$2", [v.remarks, job.id]);
  }
  return ok({ ok: true });
}

async function adminDeleteJob({ params }) {
  const r = await query('DELETE FROM jobs WHERE id = $1 RETURNING id', [Number(params.id)]);
  if (!r.length) throw fail(404, 'Job not found');
  return ok({ ok: true });
}

async function adminUsers({ query: q }) {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = 15;
  const where = [];
  const p = [];
  const add = (sql, val) => { p.push(val); where.push(sql.replaceAll('?', () => '$' + p.length)); };
  if (['seeker', 'employer', 'admin'].includes(q.role)) add('role = ?', q.role);
  if (q.q?.trim()) add('(name ILIKE ? OR email ILIKE ?)', like(q.q));
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await query(`SELECT count(*)::int AS n FROM users ${W}`, p))[0].n;
  const rows = await query(`SELECT id, name, email, role, status, created_at FROM users ${W} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, p);
  return ok({ users: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, createdAt: r.created_at })),
    total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}

async function targetUser(admin, id) {
  const [t] = await query('SELECT id, role FROM users WHERE id = $1', [Number(id)]);
  if (!t) throw fail(404, 'User not found');
  if (t.id === admin.id || t.role === 'admin') throw fail(403, 'Admin accounts cannot be changed here');
  return t;
}

async function setUserStatus({ user, params, body }) {
  const status = body.status;
  if (!['active', 'suspended'].includes(status)) throw fail(400, 'Choose active or suspended');
  const t = await targetUser(user, params.id);
  await query('UPDATE users SET status = $1, token_version = token_version + 1 WHERE id = $2', [status, t.id]);
  return ok({ ok: true });
}

async function deleteUser({ user, params }) {
  const t = await targetUser(user, params.id);
  await query('DELETE FROM users WHERE id = $1', [t.id]);
  return ok({ ok: true });
}

/* ---------------- dashboards ---------------- */

const toMap = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.n]));

async function dashboard({ user }) {
  if (user.role === 'seeker') {
    const by = toMap(await query('SELECT status, count(*)::int AS n FROM applications WHERE seeker_id = $1 GROUP BY status', [user.id]), 'status');
    const recent = await query(`SELECT a.id, a.status, a.created_at, j.title, j.company FROM applications a
        JOIN jobs j ON j.id = a.job_id WHERE a.seeker_id = $1 ORDER BY a.updated_at DESC LIMIT 5`, [user.id]);
    const p = await profileOf(user.id);
    const fields = ['headline', 'phone', 'location', 'experience', 'education', 'bio', 'resumeUrl'];
    const done = fields.filter((f) => p[f]).length + (p.skills?.length ? 1 : 0);
    return ok({ role: 'seeker', byStatus: by, total: Object.values(by).reduce((a, b) => a + b, 0),
      profileComplete: Math.round((done / (fields.length + 1)) * 100),
      recent: recent.map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, title: r.title, company: r.company })) });
  }
  if (user.role === 'employer') {
    const jobs = toMap(await query('SELECT status, count(*)::int AS n FROM jobs WHERE employer_id = $1 GROUP BY status', [user.id]), 'status');
    const [c] = await query(`SELECT count(*)::int AS total, (count(*) FILTER (WHERE a.status = 'applied'))::int AS fresh
        FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = $1`, [user.id]);
    const recent = await query(`SELECT a.id, a.status, a.created_at, j.id AS job_id, j.title, u.name FROM applications a
        JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.seeker_id WHERE j.employer_id = $1
        ORDER BY a.created_at DESC LIMIT 5`, [user.id]);
    return ok({ role: 'employer', jobs, applicants: c.total, newApplicants: c.fresh,
      recent: recent.map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, jobId: r.job_id, title: r.title, name: r.name })) });
  }
  const users = toMap(await query('SELECT role, count(*)::int AS n FROM users GROUP BY role', []), 'role');
  const jobs = toMap(await query('SELECT status, count(*)::int AS n FROM jobs GROUP BY status', []), 'status');
  const [ap] = await query('SELECT count(*)::int AS n FROM applications', []);
  const pending = await query(`SELECT ${JOB_COLS}, u.name AS employer_name, u.email AS employer_email FROM jobs j
      JOIN users u ON u.id = j.employer_id WHERE j.status = 'pending' ORDER BY j.created_at LIMIT 5`, []);
  const recentUsers = await query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 5', []);
  return ok({ role: 'admin', users, jobs, applications: ap.n, pending: pending.map(jobOut),
    recentUsers: recentUsers.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, createdAt: r.created_at })) });
}

/* ---------------- route table ---------------- */

const S = ['seeker'], E = ['employer'], A = ['admin'];
export const routes = [
  { m: 'POST', p: '/auth/signup', auth: false, h: signup },
  { m: 'POST', p: '/auth/login', auth: false, h: login },
  { m: 'POST', p: '/auth/logout', auth: false, h: logout },
  { m: 'GET', p: '/auth/me', auth: false, h: me },
  { m: 'POST', p: '/auth/forgot', auth: false, h: forgot },
  { m: 'POST', p: '/auth/reset', auth: false, h: reset },
  { m: 'GET', p: '/profile', auth: true, h: getProfile },
  { m: 'PUT', p: '/profile', auth: true, h: putProfile },
  { m: 'GET', p: '/dashboard', auth: true, h: dashboard },
  { m: 'GET', p: '/jobs', auth: false, h: listJobs },
  { m: 'GET', p: '/jobs/:id', auth: false, h: getJob },
  { m: 'POST', p: '/jobs/:id/apply', auth: S, h: applyToJob },
  { m: 'GET', p: '/my/applications', auth: S, h: myApplications },
  { m: 'DELETE', p: '/applications/:id', auth: S, h: withdraw },
  { m: 'GET', p: '/employer/jobs', auth: E, h: employerJobs },
  { m: 'POST', p: '/employer/jobs', auth: E, h: createJob },
  { m: 'PUT', p: '/employer/jobs/:id', auth: E, h: updateJob },
  { m: 'POST', p: '/employer/jobs/:id/close', auth: E, h: closeJob },
  { m: 'DELETE', p: '/employer/jobs/:id', auth: E, h: deleteOwnJob },
  { m: 'GET', p: '/employer/jobs/:id/applicants', auth: E, h: applicants },
  { m: 'PUT', p: '/employer/applications/:id/status', auth: E, h: setApplicationStatus },
  { m: 'GET', p: '/admin/jobs', auth: A, h: adminJobs },
  { m: 'PUT', p: '/admin/jobs/:id/review', auth: A, h: reviewJob },
  { m: 'DELETE', p: '/admin/jobs/:id', auth: A, h: adminDeleteJob },
  { m: 'GET', p: '/admin/users', auth: A, h: adminUsers },
  { m: 'PUT', p: '/admin/users/:id', auth: A, h: setUserStatus },
  { m: 'DELETE', p: '/admin/users/:id', auth: A, h: deleteUser },
];
