# WorkSpark: Online Job Portal (Vercel + Postgres)

A working multi-user job portal with your WorkSpark design: sign up, log in, forgot password, three roles
(Job Seeker, Employer, Admin), profiles, job search and filters, applications, status tracking, admin approval,
and data that persists in a real Postgres database.

## Read this first: what I could and could not see

* I do **not** have access to your GitHub repository or your Vercel project, so I could not inspect your deployed
  files. This project is built from the WorkSpark design created in our conversation (same colours, fonts, logo,
  layouts, light and dark mode).
* The Java servlet/Tomcat version from earlier **cannot run on Vercel** (Vercel does not host Tomcat/WAR apps).
  This project is therefore Node.js + Postgres, which Vercel supports natively. Keep the Java project if your
  course needs a Java submission.
* If your repo uses a framework (Next.js, Vite, React...), you can still use this: the front end is plain HTML/JS
  in `public/` and the backend is one serverless function in `api/`. Tell me your repo's file list if you want
  it merged into that framework instead.

## What is implemented

| Requirement | Where |
|---|---|
| Sign up, log in, log out, forgot and reset password, validation | `lib/routes.js` (`/api/auth/*`), `public/js/app.js` (forms) |
| Secure auth: bcrypt hashes, signed HttpOnly cookie sessions, login lockout, sessions revoked on password reset or suspension | `lib/auth.js` |
| Three roles with separate dashboards and server-side access control | `lib/router.js`, `lib/routes.js` |
| Seeker: profile, browse, search and filter, apply, track, withdraw | `#/jobs`, `#/profile`, `#/applications` |
| Employer: company profile, create/edit/close/delete jobs, view applicants and profiles, update status | `#/employer/jobs`, `#/employer/jobs/:id/applicants` |
| Admin: dashboard, approve/reject (with remarks), remove listings, view/suspend/delete users | `#/admin/jobs`, `#/admin/users` |
| Loading states, success and error messages on every action | toasts, busy buttons, inline field errors |
| Persistent data | Postgres (schema auto-creates on first request, `lib/schema.js`) |
| Responsive | CSS breakpoints, mobile menu, scrollable tables |

Workflow: employer posts a job (pending) -> admin approves or rejects with remarks -> seekers search and apply ->
employer reviews and updates the status -> seeker sees the new status. Editing a live job sends it back for approval.

## Project structure

```
api/[...path].js      one Vercel serverless function that serves every /api/* request
lib/                  router, route handlers, auth, database, validation, email
public/               the website (index.html, css/app.css, js/app.js)
scripts/              create-admin.js, smoke-test.js
dev.js                local server
vercel.json           output directory, function settings, security headers
.env.example          every setting explained
```

## Run it on your computer (LOCAL DEMO MODE)

Requires Node.js 20 or newer.

```
npm install
npm run dev
```

Open http://localhost:3000. With no `DATABASE_URL`, the app uses an embedded test database stored in `.data/`
and shows a yellow "LOCAL DEMO MODE" banner. This mode is for testing only and is disabled on Vercel.
In demo mode the forgot-password page shows the reset link on screen (no email service needed); in production
the link is only ever emailed.

Create a local admin (there is no built-in admin account and no credentials in the source code):

```
ADMIN_EMAIL=admin@local.test ADMIN_PASSWORD='ChangeMe-12345' npm run create-admin
```

Windows PowerShell:

```
$env:ADMIN_EMAIL="admin@local.test"; $env:ADMIN_PASSWORD="ChangeMe-12345"; npm run create-admin
```

`npm test` runs 58 automated checks of the whole API (roles, workflow, validation, lockout, reset, etc.).

## Deploy to Vercel through your GitHub repository

1. **Put the project in your repo.** In your local clone, remove the old static files (for example the old
   `index.html`), copy everything from this project into the repo root (keep your `.git` folder), then:
   ```
   git add -A
   git commit -m "Make WorkSpark a functional job portal"
   git push origin main
   ```
   Tip: push to a new branch first. Vercel will build a Preview deployment you can test before merging.
2. **Project settings** (Vercel dashboard -> your project -> Settings -> General): Framework Preset **Other**,
   Build Command empty, Output Directory `public` (already set in `vercel.json`), Node.js 20.x or newer.
3. **Create the database.** Vercel dashboard -> your project -> Storage -> Create Database -> **Neon (Postgres)** ->
   connect it to the project. This adds a `DATABASE_URL` environment variable. If it only adds `POSTGRES_URL`,
   add a new variable named `DATABASE_URL` with the same value. (Any Postgres works: Supabase, Railway, etc.)
4. **Set the secrets** (Settings -> Environment Variables, for Production and Preview):
   * `JWT_SECRET`: a long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   * `APP_URL`: your site address, for example `https://workspark.vercel.app` (used in reset emails)
   * `RESEND_API_KEY` and `MAIL_FROM`: for real password-reset emails (see below). Optional but needed for forgot password.
5. **Redeploy.** Environment variables only apply to new deployments: Deployments -> the latest one -> menu ->
   Redeploy (or push another commit).
6. **Check it:** open `https://YOUR-SITE/api/health`. You should see `{"ok":true,"mode":"postgres"}`.
   The tables are created automatically on the first request.
7. **Create your admin account** from your computer, pointing at the production database (copy the connection
   string from Vercel -> Storage -> your database; never commit it):
   ```
   DATABASE_URL='postgres://...' ADMIN_EMAIL='you@example.com' ADMIN_PASSWORD='a-long-strong-password' npm run create-admin
   ```
   Then log in at your site with that email and password.

If the site shows a red "Setup needed" banner, `DATABASE_URL` or `JWT_SECRET` is missing or you have not redeployed.

## Password reset emails (Resend)

1. Create a free account at https://resend.com and an API key.
2. For testing you can send from `onboarding@resend.dev` (it only delivers to your own Resend account email).
   To email anyone, verify your own domain in Resend and use an address on it.
3. Set `RESEND_API_KEY` and `MAIL_FROM` (for example `WorkSpark <no-reply@your-domain.com>`) in Vercel and redeploy.

Without these, forgot password still responds with the standard message but no email is sent (a warning is
written to the Vercel function logs). The reset link is never shown on screen in production.

## Security notes

* Passwords: bcrypt (cost 10). Never stored or logged in plain text. No credentials are hardcoded anywhere.
* Sessions: signed JWT in an HttpOnly, SameSite=Lax, Secure cookie. Every request re-checks the user in the
  database, so suspending a user or resetting a password logs old sessions out immediately.
* Brute force: 5 wrong passwords lock that account for 15 minutes. Reset links are random, hashed in the database,
  single-use and expire in 1 hour. Responses do not reveal whether an email exists.
* Admin accounts cannot be self-registered; they are created only with `npm run create-admin`.
* All SQL is parameterised. Output is HTML-escaped. Cross-site POSTs are rejected. Security headers and a strict
  Content-Security-Policy are set in `vercel.json`.

## Known limits (honest list)

* Resumes are links (Google Drive, LinkedIn, etc.), not file uploads. File upload would need storage such as Vercel Blob.
* No email verification at signup and no per-IP rate limiting (only per-account lockout).
* I tested the API end to end (58 checks) and the real front-end code in a simulated browser (23 checks across all
  three roles), but I could not open a real browser here, so please check the phone layout yourself.
* Local demo mode uses an embedded Postgres that is only for testing; production must use a real `DATABASE_URL`.
