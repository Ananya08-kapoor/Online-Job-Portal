// End-to-end test of the whole API using the embedded local database (no setup needed): npm test
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
process.env.LOCAL_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
delete process.env.DATABASE_URL;
const { server } = await import('../dev.js');
const { query, closeDb } = await import('../lib/db.js');
const { hashPassword } = await import('../lib/auth.js');

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); if (!cond) failures++; };

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}
const seeker = client(), employer = client(), admin = client(), visitor = client(), other = client();
const PW = 'Passw0rdTest';
const jobBody = { title: 'Java Backend Developer', location: 'Bengaluru', type: 'Full-time', experience: '1-3 years', salaryMin: 8, salaryMax: 12, description: 'Build REST services with Spring Boot and PostgreSQL for our hiring platform.' };

let r = await visitor('GET', '/health'); check('health endpoint', r.status === 200 && r.data.mode === 'local-demo');
r = await visitor('GET', '/auth/me'); check('anonymous /me is null', r.data.user === null);
r = await visitor('GET', '/dashboard'); check('dashboard needs login (401)', r.status === 401);

r = await seeker('POST', '/auth/signup', { name: 'Sam Seeker', email: 'Sam@Example.com', password: 'short', role: 'seeker' });
check('weak password rejected with field error', r.status === 400 && r.data.fields?.password);
r = await seeker('POST', '/auth/signup', { name: 'Sam Seeker', email: 'sam@example.com', password: PW, role: 'seeker' });
check('seeker signup', r.status === 201 && r.data.user.role === 'seeker');
r = await visitor('POST', '/auth/signup', { name: 'Sam Two', email: 'SAM@example.com', password: PW, role: 'seeker' });
check('duplicate email rejected (409)', r.status === 409);
r = await visitor('POST', '/auth/signup', { name: 'Evil', email: 'evil@example.com', password: PW, role: 'admin' });
check('cannot self-register as admin', r.status === 400);
r = await employer('POST', '/auth/signup', { name: 'Erin Employer', email: 'erin@acme.com', password: PW, role: 'employer' });
check('employer needs company name', r.status === 400 && r.data.fields?.companyName);
r = await employer('POST', '/auth/signup', { name: 'Erin Employer', email: 'erin@acme.com', password: PW, role: 'employer', companyName: 'Acme Technologies' });
check('employer signup', r.status === 201);
await query("INSERT INTO users (name,email,password_hash,role) VALUES ('Root','root@ws.test',$1,'admin')", [await hashPassword('AdminPass12345')]);
r = await admin('POST', '/auth/login', { email: 'root@ws.test', password: 'AdminPass12345' }); check('admin login', r.status === 200 && r.data.user.role === 'admin');

r = await seeker('GET', '/auth/me'); check('session cookie keeps seeker logged in', r.data.user?.email === 'sam@example.com');
r = await seeker('POST', '/employer/jobs', jobBody); check('seeker blocked from employer API (403)', r.status === 403);
r = await employer('GET', '/admin/users'); check('employer blocked from admin API (403)', r.status === 403);

r = await employer('POST', '/employer/jobs', { ...jobBody, title: 'x' }); check('job validation errors', r.status === 400 && r.data.fields?.title);
r = await employer('POST', '/employer/jobs', jobBody); check('employer posts job', r.status === 201); const jobId = r.data.id;
r = await visitor('GET', '/jobs'); check('pending job hidden from public', r.data.total === 0);
r = await seeker('POST', `/jobs/${jobId}/apply`, {}); check('cannot apply to unapproved job', r.status === 404);
r = await admin('GET', '/admin/jobs?status=pending'); check('admin sees pending job', r.data.jobs.length === 1 && r.data.jobs[0].employerEmail === 'erin@acme.com');
r = await admin('PUT', `/admin/jobs/${jobId}/review`, { action: 'reject', remarks: '' }); check('rejection requires remarks', r.status === 400);
r = await admin('PUT', `/admin/jobs/${jobId}/review`, { action: 'approve' }); check('admin approves job', r.status === 200);
r = await visitor('GET', '/jobs?q=java&type=Full-time'); check('approved job is searchable by visitors', r.data.total === 1 && r.data.jobs[0].company === 'Acme Technologies');
r = await visitor('GET', '/jobs?q=python'); check('search filters out non-matches', r.data.total === 0);
r = await visitor('GET', '/jobs?minSalary=20'); check('salary filter works', r.data.total === 0);

r = await seeker('PUT', '/profile', { name: 'Sam Seeker', headline: 'Java developer', skills: 'Java, SQL, java ', phone: 'abc' }); check('profile validation', r.status === 400 && r.data.fields?.phone);
r = await seeker('PUT', '/profile', { name: 'Sam Seeker', headline: 'Java developer', skills: 'Java, SQL', location: 'Pune', resumeUrl: 'https://example.com/cv.pdf' });
check('seeker saves profile', r.status === 200 && r.data.profile.skills.length === 2);
r = await seeker('POST', `/jobs/${jobId}/apply`, { coverLetter: 'Hello' }); check('seeker applies', r.status === 201); 
r = await seeker('POST', `/jobs/${jobId}/apply`, {}); check('duplicate application rejected (409)', r.status === 409);
r = await seeker('GET', '/jobs'); check('job shows as applied for the seeker', r.data.jobs[0].applied === true);

r = await employer('GET', `/employer/jobs/${jobId}/applicants`); check('employer sees applicant with profile', r.data.applicants.length === 1 && r.data.applicants[0].profile.headline === 'Java developer');
const appId = r.data.applicants[0].id;
r = await other('POST', '/auth/signup', { name: 'Other Emp', email: 'other@corp.com', password: PW, role: 'employer', companyName: 'Corp' });
r = await other('PUT', `/employer/applications/${appId}/status`, { status: 'shortlisted' }); check("another employer cannot touch this application", r.status === 404);
r = await employer('PUT', `/employer/applications/${appId}/status`, { status: 'shortlisted' }); check('employer shortlists', r.status === 200);
r = await employer('PUT', `/employer/applications/${appId}/status`, { status: 'applied' }); check('backwards status move rejected', r.status === 400);
r = await seeker('GET', '/my/applications'); check('seeker tracks updated status', r.data.applications[0].status === 'shortlisted');
r = await seeker('DELETE', `/applications/${appId}`); check('shortlisted application cannot be withdrawn', r.status === 400);

r = await seeker('GET', '/dashboard'); check('seeker dashboard', r.data.total === 1 && r.data.profileComplete > 0);
r = await employer('GET', '/dashboard'); check('employer dashboard', r.data.applicants === 1 && r.data.jobs.approved === 1);
r = await admin('GET', '/dashboard'); check('admin dashboard', r.data.users.seeker === 1 && r.data.applications === 1);

r = await employer('PUT', `/employer/jobs/${jobId}`, { ...jobBody, title: 'Senior Java Developer' }); check('editing a live job sends it back for approval', r.status === 200);
r = await visitor('GET', '/jobs'); check('edited job is hidden until re-approved', r.data.total === 0);

r = await admin('GET', '/admin/users?q=sam'); const samId = r.data.users[0].id; check('admin lists users', r.data.total === 1);
r = await admin('PUT', `/admin/users/${samId}`, { status: 'suspended' }); check('admin suspends user', r.status === 200);
r = await seeker('GET', '/auth/me'); check('suspended user is logged out immediately', r.data.user === null);
r = await visitor('POST', '/auth/login', { email: 'sam@example.com', password: PW }); check('suspended user cannot log in (403)', r.status === 403);
r = await admin('PUT', `/admin/users/${samId}`, { status: 'active' }); check('admin reactivates user', r.status === 200);
const rootId = (await query("SELECT id FROM users WHERE email='root@ws.test'"))[0].id;
r = await admin('PUT', `/admin/users/${rootId}`, { status: 'suspended' }); check('admin cannot suspend admins/self', r.status === 403);

r = await visitor('POST', '/auth/forgot', { email: 'nobody@example.com' }); check('forgot: unknown email gets same generic answer', r.status === 200 && !r.data.devResetLink);
r = await visitor('POST', '/auth/forgot', { email: 'sam@example.com' }); check('forgot: local demo returns dev link', !!r.data.devResetLink);
const token = r.data.devResetLink.split('token=')[1];
r = await visitor('POST', '/auth/reset', { token, password: 'weak' }); check('reset validates password', r.status === 400);
r = await visitor('POST', '/auth/reset', { token, password: 'BrandNew123' }); check('password reset works', r.status === 200);
r = await visitor('POST', '/auth/reset', { token, password: 'BrandNew456' }); check('reset link is single-use', r.status === 400);
r = await seeker('GET', '/auth/me'); check('old sessions are invalidated after reset', r.data.user === null);
r = await visitor('POST', '/auth/login', { email: 'sam@example.com', password: PW }); check('old password no longer works', r.status === 401);
r = await seeker('POST', '/auth/login', { email: 'sam@example.com', password: 'BrandNew123' }); check('login with new password', r.status === 200);
for (let i = 0; i < 5; i++) await visitor('POST', '/auth/login', { email: 'erin@acme.com', password: 'wrongpass1' });
r = await visitor('POST', '/auth/login', { email: 'erin@acme.com', password: PW }); check('account locks after 5 failed logins (429)', r.status === 429);
const hash = (await query("SELECT password_hash FROM users WHERE email='sam@example.com'"))[0].password_hash;
check('passwords are stored as bcrypt hashes', hash.startsWith('$2') && !hash.includes('BrandNew'));
r = await seeker('POST', '/auth/logout'); r = await seeker('GET', '/auth/me'); check('logout clears the session', r.data.user === null);
r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' }); check('cross-site POST blocked (403)', r.status === 403);

await closeDb(); server.close();
console.log(failures ? `\n${failures} test(s) FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
