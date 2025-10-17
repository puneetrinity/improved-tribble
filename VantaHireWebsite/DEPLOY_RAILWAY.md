# Deploying to Railway

This guide covers deploying the VantaHireWebsite (Express + React) to Railway, with optional SpotAxis integration.

## 1) Prerequisites
- Railway project created
- A Postgres database (Railway Postgres or Neon). Capture the connection string.
- Node 18+ environment

## 2) Environment Variables
Set these in Railway → Variables:

Required
- `NODE_ENV=production`
- `PORT` (Railway injects this automatically; app reads it)
- `DATABASE_URL` (Required)
  - If using Railway Postgres: copy the full connection string from the Railway Postgres plugin.
    - Optionally set `DATABASE_SSL=true` if your instance requires SSL.
  - If using Neon: use the Neon connection string (often ends with `.neon.tech`), keep `sslmode=require`.
- `SESSION_SECRET` (random string)

Optional
- Cloudinary for resume uploads:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
- SpotAxis integration:
  - `SPOTAXIS_BASE_URL` (e.g. `https://your-spotaxis-app.railway.app`)
  - `SPOTAXIS_CAREERS_URL` (e.g. `https://org-subdomain.your-spotaxis.com/jobs/`)
 - Email automation (ATS):
   - `EMAIL_AUTOMATION_ENABLED` = `true` to auto-send emails on stage changes, scheduling, and application received

## 3) Build & Start Commands
The repo already defines:
- Build: `npm run build`
- Start: `npm start`

Railway auto-detects Node and runs these. No Procfile is required.

## 4) Health Check
Configure Railway’s health check path to `/api/health` (200 OK when healthy).

## 5) Deploy Steps
- Connect the GitHub repo to Railway or push to a Railway Git repository.
- Set variables in Railway as described above.
- Optional: set `MIGRATE_ON_START=true` in your Web service to auto-apply schema (drizzle-kit push) on boot.
- Deploy. Railway builds the client to `dist/public` and the server to `dist/index.js`.
- On successful start, logs include the bound port and optional SpotAxis config.

## 6) SpotAxis Integration (optional)
When `SPOTAXIS_BASE_URL` is set:
- VantaHire proxies SpotAxis job listings/details.
- Job details show “Apply on SpotAxis” if an application URL exists.
- Recruiter dashboard and job post page surface helper links:
  - `/spotaxis/admin`, `/spotaxis/recruiter`, `/spotaxis/job/new`, `/spotaxis/jobs`

If you deploy SpotAxis separately on Railway, use its public URL as `SPOTAXIS_BASE_URL`.

## 7) Troubleshooting
- Port binding: ensure the app logs show it’s listening on the PORT Railway provided.
- Database: verify `DATABASE_URL` and SSL options.
  - Railway Postgres: set `DATABASE_URL` and (if needed) `DATABASE_SSL=true`.
  - Neon: ensure `DATABASE_URL` points to `.neon.tech` and includes `sslmode=require`.
- Missing tables (e.g., `relation "users" does not exist`):
  - Run once in the service shell: `npm --prefix VantaHireWebsite run db:push`, or
  - Set `MIGRATE_ON_START=true` and redeploy to run migrations automatically.
- Cloudinary: if unset, file upload falls back to placeholders (info logged).
- Emails: current implementation uses Nodemailer Ethereal for testing; replace with a real provider for production.
