'use strict';
/* WorkSpark front end: vanilla JS single-page app (hash routing) talking to the /api backend. */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { user: null, mode: '', next: null, confirm: null, filters: { q: '', location: '', type: '', experience: '', minSalary: '', sort: '' },
  jobs: [], jobPage: 1, jobPages: 1, jobTotal: 0, aj: { status: '', q: '' }, au: { q: '', role: '', page: 1 }, applicants: [], apps: [] };
let NAV = 0;
const STALE = new Error('stale');

const JOB_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'];
const EXPERIENCE = ['Fresher', '0-1 years', '1-3 years', '3-5 years', '5+ years'];
const FLOW = ['applied', 'under_review', 'shortlisted', 'interview', 'selected', 'rejected'];
const APP_ST = { applied: ['Applied', 'if'], under_review: ['Under review', 'if'], shortlisted: ['Shortlisted', 'ok'], interview: ['Interview', 'wt'], selected: ['Selected', 'ok'], rejected: ['Not selected', 'no'] };
const JOB_ST = { pending: ['Pending approval', 'wt'], approved: ['Live', 'ok'], rejected: ['Rejected', 'no'], closed: ['Closed', 'no'] };
const USER_ST = { active: ['Active', 'ok'], suspended: ['Suspended', 'no'] };
const LOGO = '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#0B7A75"/><path d="M14 5L16.2 11.8L23 14L16.2 16.2L14 23L11.8 16.2L5 14L11.8 11.8Z" fill="#F5B83D"/></svg>WorkSpark';

/* ---------- helpers ---------- */
const badge = (map, k) => { const [l, c] = map[k] || [k, '']; return `<span class="b ${c}">${esc(l)}</span>`; };
const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const money = (a, b) => a && b ? `₹${a}–${b} LPA` : a ? `From ₹${a} LPA` : b ? `Up to ₹${b} LPA` : 'Salary not disclosed';
const loading = (t = 'Loading…') => `<div class="card mut" role="status"><span class="spin"></span>${t}</div>`;
const empty = (t, cta = '') => `<div class="card g"><p class="mut">${t}</p>${cta}</div>`;
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

function setMain(html, full = false) { const m = $('#main'); m.className = full ? 'full' : 'wrap'; m.innerHTML = html; }

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.setAttribute('role', type === 'err' ? 'alert' : 'status');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

function setBusy(btn, on) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Working…'; }
  else if (btn.dataset.label !== undefined) { btn.disabled = false; btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
}

async function api(path, { method = 'GET', body } = {}) {
  const n = NAV;
  let res;
  try {
    res = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Network problem. Check your connection and try again.'); }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (method === 'GET' && n !== NAV) throw STALE;
  if (!res.ok) {
    if (res.status === 401 && S.user && !path.startsWith('/auth/')) {
      S.user = null; renderNav(); toast('Your session expired. Please log in again.', 'err'); go('#/login');
    }
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status; e.fields = data.fields;
    throw e;
  }
  return data;
}

/* ---------- forms ---------- */
function fld(name, label, o = {}) {
  const id = 'f_' + name, v = o.value ?? '';
  const c = ` id="${id}" name="${name}"${o.required ? ' required' : ''}${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.attrs || ''}`;
  let ctl;
  if (o.options) ctl = `<select class="in"${c}>${o.options.map((x) => { const [val, txt] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(txt)}</option>`; }).join('')}</select>`;
  else if (o.area) ctl = `<textarea class="in" rows="${o.rows || 5}"${c}>${esc(v)}</textarea>`;
  else ctl = `<input class="in" type="${o.type || 'text'}" value="${esc(v)}"${c}>`;
  return `<div class="fld${o.cls ? ' ' + o.cls : ''}"><label for="${id}">${esc(label)}${o.required ? ' *' : ''}</label>${ctl}<p class="ferr" data-err="${name}" role="alert"></p>${o.hint ? `<p class="mut" style="font-size:12px;margin-top:4px">${esc(o.hint)}</p>` : ''}</div>`;
}
const clearErrors = (f) => { f.querySelectorAll('.ferr').forEach((p) => { p.textContent = ''; }); f.querySelectorAll('.in.bad').forEach((i) => i.classList.remove('bad')); };
function showErrors(f, fields) {
  let first = null;
  for (const [k, m] of Object.entries(fields)) {
    const p = f.querySelector(`[data-err="${k}"]`), i = f.querySelector(`[name="${k}"]`);
    if (p) p.textContent = m;
    if (i) { i.classList.add('bad'); first = first || i; }
  }
  if (first) first.focus();
}

/* ---------- dialog ---------- */
const dlg = $('#dlg');
const openDlg = (html) => { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); };
const closeDlg = () => { if (dlg.open) dlg.close(); };
dlg.addEventListener('close', () => { if (S.confirm) { S.confirm(false); S.confirm = null; } dlg.innerHTML = ''; });
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(); });
const confirmDlg = (msg, label = 'Confirm') => new Promise((res) => {
  S.confirm = res;
  openDlg(`<div class="dlg"><p>${esc(msg)}</p><div class="row"><button class="btn d" data-act="dlgYes">${esc(label)}</button><button class="btn o" data-act="dlgNo">Cancel</button></div></div>`);
});

/* ---------- navigation ---------- */
function renderNav() {
  const u = S.user, cur = (location.hash || '#/').split('?')[0];
  const links = !u ? [['#/jobs', 'Browse jobs']]
    : u.role === 'seeker' ? [['#/dashboard', 'Dashboard'], ['#/jobs', 'Find jobs'], ['#/applications', 'My applications'], ['#/profile', 'My profile']]
    : u.role === 'employer' ? [['#/dashboard', 'Dashboard'], ['#/employer/jobs', 'My jobs'], ['#/employer/jobs/new', 'Post a job'], ['#/profile', 'Company profile']]
    : [['#/dashboard', 'Dashboard'], ['#/admin/jobs', 'Job listings'], ['#/admin/users', 'Users']];
  $('#nav').innerHTML = `<a class="logo" href="#/" aria-label="WorkSpark home">${LOGO}</a>
    <button class="menu" data-act="menu" aria-label="Menu" aria-expanded="false">☰</button>
    <nav class="links" aria-label="Main">${links.map(([h, t]) => `<a href="${h}" class="${cur === h ? 'on' : ''}"${cur === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <span class="sp"></span>
    <div class="who">${u ? `<span class="mut">${esc(u.name)} · ${esc(u.role)}</span><button class="btn o sm" data-act="logout">Log out</button>`
      : '<a class="btn o sm a" href="#/login">Log in</a><a class="btn sm a" href="#/signup">Sign up</a>'}</div>`;
}
function renderBanner() {
  const b = $('#banner');
  if (S.mode === 'local-demo') b.innerHTML = '<div class="banner wt">LOCAL DEMO MODE: data is saved in a test database on this computer only. Not for production.</div>';
  else if (S.mode === 'unconfigured') b.innerHTML = '<div class="banner no">Setup needed: the database is not configured. Add DATABASE_URL and JWT_SECRET in your Vercel project settings and redeploy.</div>';
  else b.innerHTML = '';
}

/* ---------- auth views ---------- */
function authShell(inner) {
  return `<div class="login"><section class="hero"><span class="logo" style="color:#5CD6CC;font-size:24px">${LOGO}</span>
    <h1 style="font-size:38px;line-height:1.15">Hiring, organised from posting to offer.</h1>
    <p>Employers post vacancies, admins keep listings genuine, and candidates find and apply to the right roles.</p>
    <ol style="margin:0;padding-left:20px;display:grid;gap:8px"><li>Employer posts a job</li><li>Admin approves it</li><li>Candidates search and apply</li><li>Employer reviews and updates status</li></ol>
    <p><a href="#/jobs" style="color:#5CD6CC">Browse open jobs without an account</a></p></section>
    <section style="align-items:center"><div style="width:100%;max-width:420px" class="g">${inner}</div></section></div>`;
}
const PW_ATTRS = ' minlength="8" maxlength="72" pattern="(?=.*[A-Za-z])(?=.*\\d).{8,72}" title="At least 8 characters, with a letter and a number"';

function vLogin() {
  setMain(authShell(`<div class="card g" style="padding:28px;gap:16px"><h2 style="font-size:26px">Welcome back</h2>
    <form class="g" data-form="login">${fld('email', 'Email', { type: 'email', required: true, attrs: ' autocomplete="email"' })}
    ${fld('password', 'Password', { type: 'password', required: true, attrs: ' autocomplete="current-password"' })}
    <button class="btn" type="submit">Log in</button></form>
    <p class="mut"><a href="#/forgot">Forgot password?</a></p><p class="mut">New to WorkSpark? <a href="#/signup">Create an account</a></p></div>`), true);
}
function vSignup() {
  setMain(authShell(`<div class="card g" style="padding:28px;gap:16px"><h2 style="font-size:26px">Create your account</h2>
    <form class="g" data-form="signup"><div class="fld"><label>I am a</label><div class="row" style="gap:18px">
      <label class="rad"><input type="radio" name="role" value="seeker" checked data-role-toggle> Job seeker</label>
      <label class="rad"><input type="radio" name="role" value="employer" data-role-toggle> Employer</label></div></div>
    ${fld('name', 'Full name', { required: true, attrs: ' minlength="2" maxlength="80" autocomplete="name"' })}
    ${fld('companyName', 'Company name', { cls: 'hidden', attrs: ' maxlength="120"' })}
    ${fld('email', 'Email', { type: 'email', required: true, attrs: ' autocomplete="email"' })}
    ${fld('password', 'Password', { type: 'password', required: true, hint: 'At least 8 characters, with a letter and a number', attrs: PW_ATTRS + ' autocomplete="new-password"' })}
    ${fld('confirm', 'Confirm password', { type: 'password', required: true, attrs: ' autocomplete="new-password"' })}
    <button class="btn" type="submit">Create account</button></form>
    <p class="mut">Already registered? <a href="#/login">Log in</a></p></div>`), true);
}
function vForgot() {
  setMain(authShell(`<div class="card g" style="padding:28px;gap:16px"><h2 style="font-size:26px">Reset your password</h2>
    <p class="mut">Enter your email and we will send you a link to choose a new password.</p>
    <div id="forgotBox"><form class="g" data-form="forgot">${fld('email', 'Email', { type: 'email', required: true })}
    <button class="btn" type="submit">Send reset link</button></form></div>
    <p class="mut"><a href="#/login">Back to log in</a></p></div>`), true);
}
function vReset() {
  const token = new URLSearchParams((location.hash.split('?')[1]) || '').get('token') || '';
  setMain(authShell(`<div class="card g" style="padding:28px;gap:16px"><h2 style="font-size:26px">Choose a new password</h2>
    ${token ? `<form class="g" data-form="reset" data-token="${esc(token)}">
    ${fld('password', 'New password', { type: 'password', required: true, hint: 'At least 8 characters, with a letter and a number', attrs: PW_ATTRS + ' autocomplete="new-password"' })}
    ${fld('confirm', 'Confirm new password', { type: 'password', required: true, attrs: ' autocomplete="new-password"' })}
    <button class="btn" type="submit">Update password</button></form>` : '<p class="mut">This reset link is incomplete. Request a new one.</p><a class="btn a" href="#/forgot">Request a reset link</a>'}</div>`), true);
}

/* ---------- jobs (public + seeker) ---------- */
const jobCard = (j) => `<article class="card row sb"><div class="g" style="gap:8px;flex:1;min-width:240px">
  <h3 style="font-size:18px">${esc(j.title)}</h3><p class="mut">${esc(j.company)} · ${esc(j.location)}</p>
  <p style="font-size:15px">${esc(j.description.slice(0, 170))}${j.description.length > 170 ? '…' : ''}</p>
  <div class="row" style="gap:8px"><span class="tag">${esc(j.type)}</span><span class="tag">${esc(j.experience)}</span><span class="tag">${esc(money(j.salaryMin, j.salaryMax))}</span>${j.deadline ? `<span class="tag">Apply by ${fmtDate(j.deadline)}</span>` : ''}</div></div>
  <div class="g" style="gap:8px;justify-items:start">${j.applied ? '<span class="b ok">Applied</span>' : ''}<button class="btn" data-act="openJob" data-id="${j.id}">${j.applied ? 'View' : 'View &amp; apply'}</button></div></article>`;

function filterForm() {
  const f = S.filters;
  return `<form class="card g" data-form="jobsearch" role="search"><div class="row end">
    <div class="f" style="flex:2;min-width:200px">${fld('q', 'Job title, company or skill', { value: f.q, ph: 'e.g. Java developer' })}</div>
    <div class="f">${fld('location', 'Location', { value: f.location, ph: 'City or remote' })}</div>
    <button class="btn" type="submit">Search</button></div>
    <div class="row end"><div class="f">${fld('type', 'Job type', { value: f.type, options: [['', 'All types'], ...JOB_TYPES] })}</div>
    <div class="f">${fld('experience', 'Experience', { value: f.experience, options: [['', 'Any experience'], ...EXPERIENCE] })}</div>
    <div class="f">${fld('minSalary', 'Min salary (LPA)', { value: f.minSalary, type: 'number', attrs: ' min="0" max="1000"', ph: 'e.g. 6' })}</div>
    <div class="f">${fld('sort', 'Sort by', { value: f.sort, options: [['', 'Newest first'], ['salary', 'Highest salary']] })}</div>
    <button class="btn o" type="button" data-act="clearFilters">Clear</button></div></form>`;
}
async function loadJobs(reset) {
  const page = reset ? 1 : S.jobPage + 1;
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(S.filters).filter(([, v]) => v)), page });
  const d = await api('/jobs?' + qs);
  S.jobPage = d.page; S.jobPages = d.pages; S.jobTotal = d.total;
  S.jobs = reset ? d.jobs : [...S.jobs, ...d.jobs];
  renderResults();
}
function renderResults() {
  const box = $('#results'); if (!box) return;
  box.innerHTML = S.jobs.length ? `<p class="mut" role="status">${S.jobTotal} job${S.jobTotal === 1 ? '' : 's'} found</p>` + S.jobs.map(jobCard).join('')
    : empty('No jobs match your search. Try different keywords or clear the filters.');
  $('#more').innerHTML = S.jobPage < S.jobPages ? '<button class="btn o" data-act="moreJobs">Load more jobs</button>' : '';
}
async function vJobs() {
  setMain(`<h1>${S.user?.role === 'seeker' ? 'Find your next role' : 'Browse open jobs'}</h1>${filterForm()}<div id="results" class="g">${loading()}</div><div id="more" class="row" style="justify-content:center"></div>`);
  await loadJobs(true);
}
function jobDialog(j, readOnly = false) {
  const u = S.user;
  let action;
  if (readOnly) action = '';
  else if (!u) action = '<a class="btn a" href="#/login" data-act="loginToApply">Log in to apply</a>';
  else if (u.role !== 'seeker') action = '<p class="mut">Only job seeker accounts can apply for jobs.</p>';
  else if (j.applied) action = '<span class="b ok">You have already applied</span> <a href="#/applications">Track it</a>';
  else action = `<form class="g" data-form="apply" data-id="${j.id}">${fld('coverLetter', 'Cover letter (optional)', { area: true, rows: 4, attrs: ' maxlength="2000"', ph: 'Tell the employer why you are a good fit' })}
    <div class="row"><button class="btn" type="submit">Apply now</button></div></form>`;
  return `<div class="dlg"><div class="page-h"><h2 style="font-size:22px">${esc(j.title)}</h2><button class="btn o sm" data-act="closeDlg">Close</button></div>
    <p class="mut">${esc(j.company)} · ${esc(j.location)}</p>
    <div class="row" style="gap:8px"><span class="tag">${esc(j.type)}</span><span class="tag">${esc(j.experience)}</span><span class="tag">${esc(money(j.salaryMin, j.salaryMax))}</span>${j.deadline ? `<span class="tag">Apply by ${fmtDate(j.deadline)}</span>` : ''}</div>
    <p class="pre" style="font-size:15px;line-height:1.55">${esc(j.description)}</p>${action}</div>`;
}

/* ---------- dashboards ---------- */
const stat = (n, label) => `<div class="card stat"><b>${n}</b><span>${label}</span></div>`;
async function vDashboard() {
  setMain(loading());
  const d = await api('/dashboard');
  const u = S.user;
  if (d.role === 'seeker') {
    const n = (k) => d.byStatus[k] || 0;
    setMain(`<div class="page-h"><h1>Welcome, ${esc(u.name.split(' ')[0])}</h1><a class="btn a" href="#/jobs">Find jobs</a></div>
      <div class="stats">${stat(d.total, 'Applications')}${stat(n('applied') + n('under_review'), 'In review')}${stat(n('shortlisted') + n('interview'), 'Shortlisted or interview')}${stat(n('selected'), 'Selected')}</div>
      <div class="card g"><div class="page-h"><h3 style="font-size:17px">Profile ${d.profileComplete}% complete</h3><a class="btn o sm a" href="#/profile">Edit profile</a></div><div class="bar" aria-hidden="true"><i style="width:${d.profileComplete}%"></i></div>
      <p class="mut">A complete profile helps employers shortlist you.</p></div>
      <div class="card g"><h3 style="font-size:17px">Recent applications</h3>${d.recent.length ? d.recent.map((r) => `<div class="row sb"><span>${esc(r.title)} <span class="mut">· ${esc(r.company)}</span></span>${badge(APP_ST, r.status)}</div>`).join('') + '<a href="#/applications">See all applications</a>' : '<p class="mut">No applications yet. Browse jobs and apply to get started.</p>'}</div>`);
  } else if (d.role === 'employer') {
    const j = (k) => d.jobs[k] || 0;
    setMain(`<div class="page-h"><h1>Employer dashboard</h1><a class="btn a" href="#/employer/jobs/new">Post a job</a></div>
      <div class="stats">${stat(j('approved'), 'Live jobs')}${stat(j('pending'), 'Awaiting approval')}${stat(d.applicants, 'Total applicants')}${stat(d.newApplicants, 'New applicants')}</div>
      <div class="card g"><h3 style="font-size:17px">Latest applicants</h3>${d.recent.length ? d.recent.map((r) => `<div class="row sb"><span>${esc(r.name)} <span class="mut">applied to ${esc(r.title)}</span></span><span class="row" style="gap:8px">${badge(APP_ST, r.status)}<a class="btn o sm a" href="#/employer/jobs/${r.jobId}/applicants">Review</a></span></div>`).join('') : '<p class="mut">No applicants yet. Once a job is approved, candidates can apply.</p>'}<a href="#/employer/jobs">Manage all jobs</a></div>`);
  } else {
    const us = (k) => d.users[k] || 0, js = (k) => d.jobs[k] || 0;
    setMain(`<h1>Admin dashboard</h1><div class="stats">${stat(us('seeker'), 'Job seekers')}${stat(us('employer'), 'Employers')}${stat(js('approved'), 'Live jobs')}${stat(js('pending'), 'Pending approval')}${stat(d.applications, 'Applications')}</div>
      <div class="card g"><div class="page-h"><h3 style="font-size:17px">Waiting for approval</h3><a href="#/admin/jobs">All listings</a></div>${d.pending.length ? d.pending.map(adminJobRow).join('') : '<p class="mut">Nothing to review right now.</p>'}</div>
      <div class="card g"><h3 style="font-size:17px">Newest users</h3>${d.recentUsers.map((r) => `<div class="row sb"><span>${esc(r.name)} <span class="mut">${esc(r.email)}</span></span><span class="tag">${esc(r.role)}</span></div>`).join('')}<a href="#/admin/users">Manage users</a></div>`);
  }
}

/* ---------- seeker: applications + profile ---------- */
function tracker(st) {
  const steps = ['applied', 'under_review', 'shortlisted', 'interview', 'selected'], idx = st === 'rejected' ? 0 : steps.indexOf(st);
  return `<div class="steps">${steps.map((s, i) => `<div class="st ${i <= idx ? 'on' : ''}"><div class="dot">${i + 1}</div>${APP_ST[s][0]}</div>`).join('')}</div>${st === 'rejected' ? '<p class="mut">The employer did not take this application forward.</p>' : ''}`;
}
async function vApplications() {
  setMain(loading());
  const { applications } = await api('/my/applications');
  S.apps = applications;
  if (!applications.length) { setMain('<h1>My applications</h1>' + empty('You have not applied to any jobs yet.', '<div><a class="btn a" href="#/jobs">Find jobs</a></div>')); return; }
  setMain(`<h1>My applications</h1><div class="card tw"><table><thead><tr><th>Job</th><th>Company</th><th>Applied</th><th>Status</th><th></th></tr></thead><tbody>
    ${applications.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.company)}</td><td>${fmtDate(a.createdAt)}</td><td>${badge(APP_ST, a.status)}</td>
    <td><div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn o sm" data-act="track" data-id="${a.id}">Track</button>${['applied', 'under_review'].includes(a.status) ? `<button class="btn d sm" data-act="withdraw" data-id="${a.id}">Withdraw</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`);
}
async function vProfile() {
  setMain(loading());
  const { profile: p } = await api('/profile');
  const u = S.user;
  const common = fld('name', 'Full name', { value: u.name, required: true, attrs: ' minlength="2" maxlength="80"' });
  const body = u.role === 'seeker'
    ? `${fld('headline', 'Headline', { value: p.headline, ph: 'e.g. Java developer with 2 years experience', attrs: ' maxlength="120"' })}
       <div class="g" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${fld('phone', 'Phone', { value: p.phone, type: 'tel' })}${fld('location', 'Location', { value: p.location })}</div>
       ${fld('skills', 'Skills', { value: (p.skills || []).join(', '), hint: 'Separate skills with commas', ph: 'Java, SQL, Spring Boot' })}
       ${fld('experience', 'Experience', { value: p.experience, area: true, rows: 4 })}${fld('education', 'Education', { value: p.education, area: true, rows: 3 })}
       ${fld('bio', 'About you', { value: p.bio, area: true, rows: 4 })}${fld('resumeUrl', 'Resume link', { value: p.resumeUrl, type: 'url', ph: 'https://drive.google.com/…', hint: 'Link to your resume (Google Drive, Dropbox, LinkedIn, etc.)' })}`
    : u.role === 'employer'
      ? `${fld('companyName', 'Company name', { value: p.companyName, required: true })}${fld('website', 'Website', { value: p.website, type: 'url', ph: 'https://' })}${fld('location', 'Location', { value: p.location })}${fld('about', 'About the company', { value: p.about, area: true, rows: 5 })}`
      : '';
  setMain(`<h1>${u.role === 'employer' ? 'Company profile' : u.role === 'admin' ? 'My account' : 'My profile'}</h1>
    <form class="card g" data-form="profile" style="max-width:720px">${common}<p class="mut">Email: ${esc(u.email)}</p>${body}<div><button class="btn" type="submit">Save changes</button></div></form>`);
}

/* ---------- employer ---------- */
async function vEmpJobs() {
  setMain(loading());
  const { jobs } = await api('/employer/jobs');
  setMain(`<div class="page-h"><h1>My jobs</h1><a class="btn a" href="#/employer/jobs/new">Post a job</a></div>${!jobs.length ? empty('You have not posted any jobs yet.', '<div><a class="btn a" href="#/employer/jobs/new">Post your first job</a></div>') :
    `<div class="card tw"><table><thead><tr><th>Job</th><th>Status</th><th>Applicants</th><th>Posted</th><th></th></tr></thead><tbody>${jobs.map((j) => `<tr>
    <td><b>${esc(j.title)}</b><br><span class="mut">${esc(j.location)} · ${esc(j.type)}</span>${j.status === 'rejected' && j.remarks ? `<br><span class="mut" style="color:var(--not)">Admin remarks: ${esc(j.remarks)}</span>` : ''}</td>
    <td>${badge(JOB_ST, j.status)}</td><td>${j.applicants}${j.newApplicants ? ` <span class="b if">${j.newApplicants} new</span>` : ''}</td><td>${fmtDate(j.createdAt)}</td>
    <td><div class="row" style="gap:8px;flex-wrap:nowrap"><a class="btn o sm a" href="#/employer/jobs/${j.id}/applicants">Applicants</a>
    ${j.status !== 'closed' ? `<a class="btn o sm a" href="#/employer/jobs/${j.id}/edit">Edit</a>` : ''}
    ${j.status === 'approved' ? `<button class="btn o sm" data-act="closeJob" data-id="${j.id}">Close</button>` : ''}
    <button class="btn d sm" data-act="deleteJob" data-id="${j.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`}`);
}
async function vJobForm(id) {
  let j = {};
  if (id) { setMain(loading()); ({ job: j } = await api('/jobs/' + id)); }
  const today = new Date().toISOString().slice(0, 10);
  setMain(`<h1>${id ? 'Edit job' : 'Post a job'}</h1><div class="cols"><form class="card g r" data-form="job" data-id="${id || ''}" style="gap:16px">
    <div class="g" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
    ${fld('title', 'Job title', { value: j.title, required: true, ph: 'e.g. Java Backend Developer', attrs: ' minlength="3" maxlength="120"' })}
    ${fld('company', 'Company', { value: j.company, hint: 'Leave blank to use your company profile name', attrs: ' maxlength="120"' })}
    ${fld('location', 'Location', { value: j.location, required: true, ph: 'City or remote', attrs: ' minlength="2" maxlength="100"' })}
    ${fld('type', 'Job type', { value: j.type, options: JOB_TYPES, required: true })}
    ${fld('experience', 'Experience required', { value: j.experience, options: EXPERIENCE, required: true })}
    ${fld('deadline', 'Application deadline', { value: j.deadline, type: 'date', attrs: ` min="${today}"` })}
    ${fld('salaryMin', 'Minimum salary (LPA)', { value: j.salaryMin, type: 'number', attrs: ' min="0" max="1000"' })}
    ${fld('salaryMax', 'Maximum salary (LPA)', { value: j.salaryMax, type: 'number', attrs: ' min="0" max="1000"' })}</div>
    ${fld('description', 'Job description', { value: j.description, area: true, rows: 8, required: true, attrs: ' minlength="30" maxlength="5000"', ph: 'Responsibilities, required skills, benefits' })}
    <div class="row"><button class="btn" type="submit">${id ? 'Save and resubmit for approval' : 'Submit for approval'}</button><a class="btn o a" href="#/employer/jobs">Cancel</a></div></form>
    <aside class="card g l"><h3 style="font-size:16px">What happens next</h3><div class="row"><span class="b wt">Pending</span><span class="mut">Admin reviews your post</span></div>
    <div class="row"><span class="b ok">Live</span><span class="mut">Candidates can search and apply</span></div><div class="row"><span class="b no">Rejected</span><span class="mut">You see the admin's remarks and can edit</span></div></aside></div>`);
}
const allowedNext = (cur) => FLOW.filter((s) => s === cur || (!['selected', 'rejected'].includes(cur) && FLOW.indexOf(s) > FLOW.indexOf(cur)));
async function vApplicants(id) {
  setMain(loading());
  const d = await api(`/employer/jobs/${id}/applicants`);
  S.applicants = d.applicants;
  const rows = d.applicants.map((a) => `<tr><td><b>${esc(a.name)}</b><br><span class="mut">${esc(a.profile.headline || a.email)}</span></td>
    <td>${(a.profile.skills || []).slice(0, 4).map((s) => `<span class="tag">${esc(s)}</span>`).join(' ') || '<span class="mut">—</span>'}</td><td>${fmtDate(a.createdAt)}</td>
    <td>${['selected', 'rejected'].includes(a.status) ? badge(APP_ST, a.status) : `<form class="sel-wrap" data-form="appStatus" data-id="${a.id}" data-job="${id}"><select class="in" name="status" aria-label="Status for ${esc(a.name)}">${allowedNext(a.status).map((s) => `<option value="${s}"${s === a.status ? ' selected' : ''}>${APP_ST[s][0]}</option>`).join('')}</select><button class="btn sm" type="submit">Update</button></form>`}</td>
    <td><button class="btn o sm" data-act="candidate" data-id="${a.id}">Profile</button></td></tr>`).join('');
  setMain(`<div class="page-h"><div><a href="#/employer/jobs">← My jobs</a><h1>${esc(d.job.title)}</h1></div>${badge(JOB_ST, d.job.status)}</div>
    ${d.applicants.length ? `<div class="card tw"><table><thead><tr><th>Candidate</th><th>Skills</th><th>Applied</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><p class="mut">Updating a status changes what the candidate sees in My applications.</p>`
      : empty(d.job.status === 'approved' ? 'No applications yet.' : 'Applicants appear here once this job is approved and live.')}`);
}
function candidateDialog(a) {
  const p = a.profile || {};
  const line = (l, v) => v ? `<p><span class="mut">${l}:</span> ${esc(v)}</p>` : '';
  return `<div class="dlg"><div class="page-h"><h2 style="font-size:22px">${esc(a.name)}</h2><button class="btn o sm" data-act="closeDlg">Close</button></div>
    <p><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>${line('Headline', p.headline)}${line('Phone', p.phone)}${line('Location', p.location)}
    ${p.skills?.length ? `<div class="row" style="gap:6px">${p.skills.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>` : ''}
    ${p.experience ? `<div><b>Experience</b><p class="pre">${esc(p.experience)}</p></div>` : ''}${p.education ? `<div><b>Education</b><p class="pre">${esc(p.education)}</p></div>` : ''}
    ${p.bio ? `<div><b>About</b><p class="pre">${esc(p.bio)}</p></div>` : ''}
    ${p.resumeUrl ? `<p><a href="${esc(p.resumeUrl)}" target="_blank" rel="noopener noreferrer">Open resume</a></p>` : ''}
    ${a.coverLetter ? `<div><b>Cover letter</b><p class="pre">${esc(a.coverLetter)}</p></div>` : ''}</div>`;
}

/* ---------- admin ---------- */
const adminJobRow = (j) => `<div class="card g" style="gap:8px"><div class="row sb"><div><b>${esc(j.title)}</b> <span class="mut">· ${esc(j.company)} · ${esc(j.location)}</span><br><span class="mut">By ${esc(j.employerName || '')} (${esc(j.employerEmail || '')}) · ${fmtDate(j.createdAt)}${j.applicants != null ? ` · ${j.applicants} applicant${j.applicants === 1 ? '' : 's'}` : ''}</span></div>${badge(JOB_ST, j.status)}</div>
  ${j.remarks ? `<p class="mut">Remarks: ${esc(j.remarks)}</p>` : ''}
  <div class="row" style="gap:8px"><button class="btn o sm" data-act="viewJob" data-id="${j.id}">View details</button>
  ${j.status === 'pending' ? `<button class="btn sm" data-act="approve" data-id="${j.id}">Approve</button><button class="btn d sm" data-act="rejectDlg" data-id="${j.id}">Reject</button>` : ''}
  <button class="btn d sm" data-act="removeJob" data-id="${j.id}">Remove</button></div></div>`;
async function vAdminJobs() {
  setMain(`<h1>Job listings</h1><form class="card row end" data-form="adminjobs"><div class="f">${fld('status', 'Status', { value: S.aj.status, options: [['', 'All'], ['pending', 'Pending approval'], ['approved', 'Live'], ['rejected', 'Rejected'], ['closed', 'Closed']] })}</div>
    <div class="f" style="flex:2">${fld('q', 'Search title, company or employer email', { value: S.aj.q })}</div><button class="btn" type="submit">Filter</button></form><div id="ajList" class="g">${loading()}</div>`);
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(S.aj).filter(([, v]) => v)));
  const { jobs } = await api('/admin/jobs?' + qs);
  $('#ajList').innerHTML = jobs.length ? jobs.map(adminJobRow).join('') : empty('No job listings match.');
}
async function vAdminUsers() {
  setMain(`<h1>Users</h1><form class="card row end" data-form="adminusers"><div class="f" style="flex:2">${fld('q', 'Search name or email', { value: S.au.q })}</div>
    <div class="f">${fld('role', 'Account type', { value: S.au.role, options: [['', 'All'], ['seeker', 'Job seekers'], ['employer', 'Employers'], ['admin', 'Admins']] })}</div><button class="btn" type="submit">Filter</button></form><div id="auList">${loading()}</div>`);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(S.au).filter(([k, v]) => v && k !== 'page')), page: S.au.page });
  const d = await api('/admin/users?' + qs);
  $('#auList').innerHTML = d.users.length ? `<div class="card tw"><table><thead><tr><th>User</th><th>Type</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>${d.users.map((u) => `<tr><td><b>${esc(u.name)}</b><br><span class="mut">${esc(u.email)}</span></td><td><span class="tag">${esc(u.role)}</span></td><td>${badge(USER_ST, u.status)}</td><td>${fmtDate(u.createdAt)}</td>
    <td>${u.role === 'admin' ? '<span class="mut">—</span>' : `<div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn o sm" data-act="toggleUser" data-id="${u.id}" data-status="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Activate'}</button><button class="btn d sm" data-act="deleteUser" data-id="${u.id}">Delete</button></div>`}</td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="justify-content:center;margin-top:12px"><button class="btn o sm" data-act="usersPage" data-p="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><span class="mut">Page ${d.page} of ${d.pages} · ${d.total} users</span><button class="btn o sm" data-act="usersPage" data-p="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div>` : empty('No users match.');
}

/* ---------- form handlers ---------- */
const FORMS = {
  async login(d) { const r = await api('/auth/login', { method: 'POST', body: d }); afterLogin(r.user); },
  async signup(d, f) {
    if (d.password !== d.confirm) { showErrors(f, { confirm: 'Passwords do not match' }); return; }
    const r = await api('/auth/signup', { method: 'POST', body: { name: d.name, email: d.email, password: d.password, role: d.role, companyName: d.companyName } });
    afterLogin(r.user, true);
  },
  async forgot(d) {
    const r = await api('/auth/forgot', { method: 'POST', body: d });
    $('#forgotBox').innerHTML = `<div class="msg ok" role="status">${esc(r.message)}</div>${r.devResetLink ? `<p class="mut">Local demo only (no email service is configured): <a href="${esc(r.devResetLink)}">open your reset link</a></p>` : ''}`;
  },
  async reset(d, f) {
    if (d.password !== d.confirm) { showErrors(f, { confirm: 'Passwords do not match' }); return; }
    const r = await api('/auth/reset', { method: 'POST', body: { token: f.dataset.token, password: d.password } });
    toast(r.message); go('#/login');
  },
  async profile(d) {
    const r = await api('/profile', { method: 'PUT', body: d });
    S.user = { ...S.user, name: r.user.name }; renderNav(); toast('Profile saved');
  },
  async jobsearch(d) { S.filters = { q: d.q || '', location: d.location || '', type: d.type || '', experience: d.experience || '', minSalary: d.minSalary || '', sort: d.sort || '' }; await loadJobs(true); },
  async apply(d, f) {
    const id = Number(f.dataset.id);
    await api(`/jobs/${id}/apply`, { method: 'POST', body: { coverLetter: d.coverLetter } });
    S.jobs.forEach((j) => { if (j.id === id) j.applied = true; });
    closeDlg(); renderResults(); toast('Application submitted. Track it under My applications.');
  },
  async job(d, f) {
    const id = f.dataset.id;
    const r = await api(id ? `/employer/jobs/${id}` : '/employer/jobs', { method: id ? 'PUT' : 'POST', body: d });
    toast(r.message); go('#/employer/jobs');
  },
  async appStatus(d, f) {
    await api(`/employer/applications/${f.dataset.id}/status`, { method: 'PUT', body: { status: d.status } });
    toast('Status updated'); await vApplicants(f.dataset.job);
  },
  async adminjobs(d) { S.aj = { status: d.status || '', q: d.q || '' }; await vAdminJobs(); },
  async adminusers(d) { S.au = { q: d.q || '', role: d.role || '', page: 1 }; await vAdminUsers(); },
  async reject(d, f) {
    await api(`/admin/jobs/${f.dataset.id}/review`, { method: 'PUT', body: { action: 'reject', remarks: d.remarks } });
    closeDlg(); toast('Job rejected. The employer can see your remarks.'); route();
  },
};
function afterLogin(user, isNew) {
  S.user = user; renderNav();
  toast(isNew ? 'Account created. Welcome to WorkSpark!' : `Welcome back, ${user.name.split(' ')[0]}`);
  const dest = S.next || '#/dashboard'; S.next = null; go(dest);
}

/* ---------- click actions ---------- */
const ACT = {
  menu(el) { const nav = $('#nav'); const open = nav.classList.toggle('open'); el.setAttribute('aria-expanded', open); },
  async logout() { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } S.user = null; renderNav(); toast('You have been logged out'); go('#/login'); },
  closeDlg, dlgNo: closeDlg,
  dlgYes() { const r = S.confirm; S.confirm = null; closeDlg(); if (r) r(true); },
  loginToApply() { S.next = location.hash; closeDlg(); },
  retry() { route(); },
  async moreJobs(el) { setBusy(el, true); try { await loadJobs(false); } finally { setBusy(el, false); } },
  clearFilters() { S.filters = { q: '', location: '', type: '', experience: '', minSalary: '', sort: '' }; route(); },
  async openJob(el) { const { job } = await api('/jobs/' + el.dataset.id); openDlg(jobDialog(job)); },
  async viewJob(el) { const { job } = await api('/jobs/' + el.dataset.id); openDlg(jobDialog(job, true)); },
  track(el) { const a = S.apps.find((x) => x.id == el.dataset.id); if (!a) return;
    openDlg(`<div class="dlg"><div class="page-h"><h2 style="font-size:20px">${esc(a.title)}</h2><button class="btn o sm" data-act="closeDlg">Close</button></div><p class="mut">${esc(a.company)} · Applied ${fmtDate(a.createdAt)} · Updated ${fmtDate(a.updatedAt)}</p>${tracker(a.status)}${a.coverLetter ? `<div><b>Your cover letter</b><p class="pre">${esc(a.coverLetter)}</p></div>` : ''}</div>`); },
  async withdraw(el) { if (!await confirmDlg('Withdraw this application? You can apply again later.', 'Withdraw')) return; await api('/applications/' + el.dataset.id, { method: 'DELETE' }); toast('Application withdrawn'); route(); },
  candidate(el) { const a = S.applicants.find((x) => x.id == el.dataset.id); if (a) openDlg(candidateDialog(a)); },
  async closeJob(el) { if (!await confirmDlg('Close this job? It will no longer accept applications.', 'Close job')) return; await api(`/employer/jobs/${el.dataset.id}/close`, { method: 'POST' }); toast('Job closed'); route(); },
  async deleteJob(el) { if (!await confirmDlg('Delete this job and all its applications? This cannot be undone.', 'Delete')) return; await api('/employer/jobs/' + el.dataset.id, { method: 'DELETE' }); toast('Job deleted'); route(); },
  async approve(el) { setBusy(el, true); try { await api(`/admin/jobs/${el.dataset.id}/review`, { method: 'PUT', body: { action: 'approve' } }); toast('Approved. The job is now live.'); route(); } finally { setBusy(el, false); } },
  rejectDlg(el) { openDlg(`<div class="dlg"><h2 style="font-size:20px">Reject this job</h2><form class="g" data-form="reject" data-id="${el.dataset.id}">${fld('remarks', 'Reason shown to the employer', { area: true, rows: 4, required: true, attrs: ' minlength="5" maxlength="500"' })}<div class="row"><button class="btn d" type="submit">Reject job</button><button class="btn o" type="button" data-act="closeDlg">Cancel</button></div></form></div>`); },
  async removeJob(el) { if (!await confirmDlg('Remove this job listing and its applications permanently?', 'Remove')) return; await api('/admin/jobs/' + el.dataset.id, { method: 'DELETE' }); toast('Listing removed'); route(); },
  async toggleUser(el) { const s = el.dataset.status; if (!await confirmDlg(s === 'suspended' ? 'Suspend this user? They will be logged out and unable to sign in.' : 'Reactivate this user?', s === 'suspended' ? 'Suspend' : 'Activate')) return; await api('/admin/users/' + el.dataset.id, { method: 'PUT', body: { status: s } }); toast(s === 'suspended' ? 'User suspended' : 'User reactivated'); route(); },
  async deleteUser(el) { if (!await confirmDlg('Delete this user and all of their data permanently?', 'Delete user')) return; await api('/admin/users/' + el.dataset.id, { method: 'DELETE' }); toast('User deleted'); route(); },
  usersPage(el) { S.au.page = Math.max(1, Number(el.dataset.p)); route(); },
};

document.addEventListener('click', async (e) => {
  const link = e.target.closest('a[href^="#/"]');
  if (link && link.getAttribute('href') === location.hash) route();   // clicking the current page refreshes it
  const el = e.target.closest('[data-act]');
  if (!el || !ACT[el.dataset.act]) return;
  try { await ACT[el.dataset.act](el, e); } catch (err) { if (err !== STALE) toast(err.message, 'err'); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  clearErrors(f);
  if (!f.checkValidity()) { f.reportValidity(); return; }
  const btn = f.querySelector('[type=submit]');
  setBusy(btn, true);
  try { await FORMS[f.dataset.form](Object.fromEntries(new FormData(f)), f); }
  catch (err) { if (err === STALE) return; if (err.fields) showErrors(f, err.fields); toast(err.message, 'err'); }
  finally { setBusy(btn, false); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-role-toggle]')) {
    const box = $('#f_companyName'); if (!box) return;
    const emp = t.value === 'employer';
    box.closest('.fld').classList.toggle('hidden', !emp); box.required = emp;
  }
  if (t.tagName === 'SELECT' && t.closest('form[data-form="jobsearch"]')) t.closest('form').requestSubmit();
});

/* ---------- router ---------- */
const R = [
  [/^#?\/?$/, false, () => location.replace(S.user ? '#/dashboard' : '#/login')],
  [/^#\/login$/, 'guest', vLogin], [/^#\/signup$/, 'guest', vSignup], [/^#\/forgot$/, 'guest', vForgot], [/^#\/reset$/, false, vReset],
  [/^#\/jobs$/, false, vJobs], [/^#\/dashboard$/, true, vDashboard], [/^#\/profile$/, true, vProfile],
  [/^#\/applications$/, ['seeker'], vApplications],
  [/^#\/employer\/jobs$/, ['employer'], vEmpJobs], [/^#\/employer\/jobs\/new$/, ['employer'], () => vJobForm()],
  [/^#\/employer\/jobs\/(\d+)\/edit$/, ['employer'], (m) => vJobForm(m[1])], [/^#\/employer\/jobs\/(\d+)\/applicants$/, ['employer'], (m) => vApplicants(m[1])],
  [/^#\/admin\/jobs$/, ['admin'], vAdminJobs], [/^#\/admin\/users$/, ['admin'], vAdminUsers],
];
async function route() {
  NAV++;
  const raw = location.hash || '#/', path = raw.split('?')[0];
  closeDlg(); $('#nav').classList.remove('open');
  const hit = R.map(([re, roles, fn]) => [path.match(re), roles, fn]).find(([m]) => m);
  renderNav();
  if (!hit) { setMain(empty('Page not found.', '<div><a class="btn a" href="#/">Go to the home page</a></div>')); return; }
  const [m, roles, fn] = hit, u = S.user;
  if (roles === 'guest' && u) return go('#/dashboard');
  if ((roles === true || Array.isArray(roles)) && !u) { S.next = raw; toast('Please log in to continue', 'err'); return go('#/login'); }
  if (Array.isArray(roles) && !roles.includes(u.role)) { toast('That page is for a different account type', 'err'); return go('#/dashboard'); }
  window.scrollTo(0, 0);
  try { await fn(m); }
  catch (err) { if (err === STALE) return; setMain(`<div class="card g" role="alert"><p>${esc(err.message)}</p><div><button class="btn" data-act="retry">Try again</button></div></div>`); }
  $('#main').focus({ preventScroll: true });
}

(async function boot() {
  try { const me = await api('/auth/me'); S.user = me.user; S.mode = me.mode; }
  catch (e) { renderNav(); setMain(`<div class="card g" role="alert"><h2>Cannot reach the WorkSpark server</h2><p class="mut">${esc(e.message)}</p><p class="mut">If you opened this file directly, run the project with <code>npm run dev</code> or deploy it to Vercel.</p><div><button class="btn" data-act="retry">Try again</button></div></div>`); return; }
  renderBanner();
  window.addEventListener('hashchange', route);
  await route();
})();
