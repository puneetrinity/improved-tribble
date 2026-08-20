# Deploying to Railway

This guide covers deploying the VantaHireWebsite (Express + React) to Railway.

## 1) Prerequisites
- Railway project created
- A Postgres database (Railway Postgres or Neon). Capture the connection string.
- Node 18+ environment

## 2) Environment Variables
Set these in Railway → Variables:

### Required (Security Critical)
- `NODE_ENV=production` **[REQUIRED]**
- `PORT` (Railway injects this automatically; app reads it)
- `DATABASE_URL` **[REQUIRED]**
  - If using Railway Postgres: copy the full connection string from the Railway Postgres plugin.
    - Note: SSL/TLS is enabled by default in production
  - If using Neon: use the Neon connection string (often ends with `.neon.tech`), keep `sslmode=require`.
- `SESSION_SECRET` **[REQUIRED]** - Must be a random string (minimum 32 characters)
  - Generate with: `openssl rand -hex 32`
  - Application will fail to start in production if not set
- `ALLOWED_HOSTS` **[REQUIRED for production]**
  - Comma-separated list of allowed hostnames
  - Example: `improved-tribble-production.up.railway.app,vantahire.com,www.vantahire.com`
  - Prevents host header injection attacks
- `SEED_DEFAULTS=false` **[REQUIRED for production]**
  - Prevents test data from being created in production
  - Set to `true` only in development environments
- `ADMIN_PASSWORD` **[REQUIRED on first deployment]**
  - Set a secure password for the admin account
  - Used only for initial account creation; can be removed after first deployment
  - Password will be hashed using scrypt

### Optional Features
- Cloudinary for resume uploads (files validated using magic bytes):
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
- Email sending (choose one; defaults to Ethereal previews if unset):
  - Brevo (Sendinblue) via SMTP:
    - `EMAIL_PROVIDER=brevo`
    - `SEND_FROM_EMAIL=no-reply@yourdomain.com`
    - `SEND_FROM_NAME=VantaHire`
    - `NOTIFICATION_EMAIL=alerts@yourdomain.com` (optional)
    - `BREVO_SMTP_HOST=smtp-relay.brevo.com` (default)
    - `BREVO_SMTP_PORT=587` (default; use 465 for SSL)
    - `BREVO_SMTP_USER=apikey` (default)
    - `BREVO_SMTP_PASSWORD=<your-brevo-smtp-key>`
- Email automation (ATS):
  - `EMAIL_AUTOMATION_ENABLED` = `true` to auto-send emails on stage changes, scheduling, and application received
- Async AI fit scoring queue (optional):
  - `AI_QUEUE_ENABLED=true`
  - `REDIS_URL` (Redis connection string)
  - `AI_WORKER_INTERACTIVE_CONCURRENCY` (default: 2)
  - `AI_WORKER_BATCH_CONCURRENCY` (default: 1)
  - `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON path for resume downloads in the worker)
- Forms Feature (recruiter-sent candidate forms):
  - `FORM_INVITE_EXPIRY_DAYS` = Number of days until form invitations expire (default: 14)
  - `FORM_PUBLIC_RATE_LIMIT` = Rate limit for public form endpoints (requests per minute per IP, default: 10)
  - `FORM_INVITE_DAILY_LIMIT` = Rate limit for sending form invitations (per day per recruiter, default: 50)
  - `BASE_URL` = Base URL for generating form links in emails (REQUIRED for forms feature)
    - Example: `https://vantahire.com` or `https://improved-tribble-production.up.railway.app`
    - **IMPORTANT**: Must use HTTPS in production to avoid mixed-content warnings in form emails

### Database TLS Configuration (when provider uses self-signed certs)
- `DATABASE_CA_CERT` (PEM) — Paste the provider's CA bundle (PEM). This enables full certificate verification.
- `DATABASE_SSL_REJECT_UNAUTHORIZED` — Set to `false` only as a last resort if your provider uses a self-signed cert and you cannot supply a CA. Defaults to `true`.

Recommended: Prefer `DATABASE_CA_CERT` to maintain strict verification. Avoid global `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- Cron scheduler (job expiration, cleanup):
  - `ENABLE_SCHEDULER` = `true` to enable scheduled tasks (set on ONE instance only in multi-instance deployments)

## 3) Build & Deployment Configuration

**Important**: This service (VantaHireWebsite) uses **Nixpacks** for deployment.

### Configuration Files:
- `VantaHireWebsite/railway.json` - Defines the build/deploy configuration

### Build & Start Commands:
The repo already defines:
- Build: `npm run build`
- Start: `npm start`

Railway auto-detects Node via `VantaHireWebsite/railway.json` and runs these commands. No Procfile is required for this service.

## 4) Health Check
Configure Railway’s health check path to `/api/health` (200 OK when healthy).

## 5) Deploy Steps
- Connect the GitHub repo to Railway or push to a Railway Git repository.
- Set variables in Railway as described above.
- Do not place migration credentials or migration/adoption flags on a runtime
  service. Schema changes run only through the private, manual
  `flow-schema-release` service; runtime startup runs `schema-ready` read-only.
- Deploy. Railway builds the client to `dist/public` and the server to `dist/index.js`.
- On successful start, logs include the bound port and service startup confirmation.
- If using the async AI queue, create a separate worker service:
  - Start command: `npm run start:ai-worker`
  - Set `AI_QUEUE_ENABLED=true`, `REDIS_URL`, `GROQ_API_KEY`, and `GOOGLE_APPLICATION_CREDENTIALS`

## 6) Security Notes

### Phase 1 & 2 Security Improvements Implemented:
- ✅ **Session Security**: SameSite cookies, required SESSION_SECRET
- ✅ **Admin Endpoints**: Protected with role-based access control
- ✅ **PII Protection**: Response bodies never logged
- ✅ **Test Data**: Only created in development (gated by SEED_DEFAULTS)
- ✅ **Host Header Validation**: Prevents injection attacks (ALLOWED_HOSTS)
- ✅ **CSP**: Strict Content Security Policy in production
- ✅ **Database SSL**: Certificate verification enabled in production

### Phase 3 & 4 Improvements:
- ✅ **File Upload Security**: Magic byte validation (not just MIME type)
- ✅ **AI Model Metadata**: Accurate tracking (Groq llama-3.3-70b-versatile)
- ✅ **SEO**: robots.txt and sitemap.xml included
- ✅ **Code Cleanup**: Removed unused WhatsApp webhooks and duplicate email service

### Phase 5 Security & Infrastructure Improvements:
- ✅ **CSRF Protection**: Double-submit cookie pattern on all mutating endpoints (POST/PATCH/DELETE)
- ✅ **Candidate Authorization**: Applications bound to userId, not email comparison
- ✅ **Automation Settings**: Whitelisted valid keys to prevent arbitrary injection
- ✅ **Cron Scheduler**: Gated by ENABLE_SCHEDULER env var for multi-instance safety
- ✅ **Database Indexes**: Performance indexes on jobs (status, postedBy, isActive) and applications (status)
- ✅ **Test Stack**: Standardized on Vitest, removed Jest
- ✅ **Repository Hygiene**: Updated .gitignore for test artifacts and IDE files

### Verification Checklist:
Before deploying, verify:
- [ ] `SESSION_SECRET` is set (minimum 32 random characters)
- [ ] `ALLOWED_HOSTS` includes all production domains
- [ ] `SEED_DEFAULTS=false` in production
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` is correct and SSL-enabled
- [ ] `ADMIN_PASSWORD` is set for initial deployment

## 7) Database Migrations

### Release migration (required and separately approved)

Runtime web/worker processes never mutate the schema. A reviewed, private,
manual `flow-schema-release` service is the sole production migration
authority. After its target identity and catalog evidence are verified, it
runs:

```bash
npm run db:migrate:release
```

Every runtime start then runs `npm run schema:ready` with the restricted
runtime credential and fails closed on an incomplete, foreign, or
over-privileged database. Existing production uses the separately gated
one-time adoption procedure; it must never execute `0000_baseline.sql`.

### Seeding Default Data

After deployment, you can optionally seed default data:

```bash
# Seed default ATS pipeline stages and email templates
npm run seed:ats

# Seed default form templates (3 templates: Additional Info, Availability, References)
npm run seed:forms
```

**Note**: The seed scripts are idempotent - they skip existing data and only create missing items.

## 8) Troubleshooting
- Port binding: ensure the app logs show it's listening on the PORT Railway provided.
- Database: verify `DATABASE_URL` and SSL options.
  - Railway Postgres: set `DATABASE_URL` and (if needed) `DATABASE_SSL=true`.
  - Neon: ensure `DATABASE_URL` points to `.neon.tech` and includes `sslmode=require`.
- Missing tables (e.g., `relation "users" does not exist`):
  - Migrations run automatically on startup
  - Check logs for "✅ ATS schema ready" confirmation
  - If issues persist, run `npm run db:push` manually
- Cloudinary: if unset, file upload falls back to placeholders (info logged).
- Emails: current implementation uses Nodemailer Ethereal for testing; replace with a real provider for production.
- CSRF errors (403 on POST/PATCH/DELETE): Ensure client is fetching CSRF token from `/api/csrf-token` and including it in headers.
