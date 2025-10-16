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
- `DATABASE_URL` (e.g. `postgresql://...` with `sslmode=require` when needed)
- `SESSION_SECRET` (random string)

Optional
- Cloudinary for resume uploads:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
- SpotAxis integration:
  - `SPOTAXIS_BASE_URL` (e.g. `https://your-spotaxis-app.railway.app`)
  - `SPOTAXIS_CAREERS_URL` (e.g. `https://org-subdomain.your-spotaxis.com/jobs/`)

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
- Database: verify `DATABASE_URL` and SSL options; Neon commonly needs `?sslmode=require`.
- Cloudinary: if unset, file upload falls back to placeholders (info logged).
- Emails: current implementation uses Nodemailer Ethereal for testing; replace with a real provider for production.

