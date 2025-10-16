# SpotAxis Railway Deployment Guide

## Quick Start

### Required Environment Variables

Set these in Railway Dashboard → authentic-motivation service → Variables:

```bash
# Django Core
SECRET_KEY=<your-generated-secret-key>
ALLOWED_HOSTS=*

# Platform Configuration
DISABLE_SUBDOMAIN_ENFORCEMENT=1  # ← CRITICAL for Railway!

# Database (auto-populated from Railway Postgres service)
db_engine=django.db.backends.postgresql
db_name=${{Postgres-TSWi.PGDATABASE}}
db_user=${{Postgres-TSWi.PGUSER}}
db_password=${{Postgres-TSWi.PGPASSWORD}}
db_host=${{Postgres-TSWi.PGHOST}}
db_port=${{Postgres-TSWi.PGPORT}}

# Timezone
TIME_ZONE=Asia/Kolkata

# Optional: Static/Media URLs (defaults work for most cases)
# media_url=https://your-domain.railway.app/media/
# static_root=/app/staticfiles
```

### Railway Service Configuration

**Build Settings:**
- Builder: `Dockerfile`
- Root Directory: Leave empty (uses repo root) OR set to `SpotAxis`
- Dockerfile Path: `Dockerfile` (at repo root)

**Deploy Settings:**
- Restart Policy: `ON_FAILURE`
- Max Retries: `10`
- Health Check Path: `/`
- Health Check Timeout: `300s`

## Why DISABLE_SUBDOMAIN_ENFORCEMENT=1 is Required

SpotAxis's `SubdomainMiddleware` normally enforces strict subdomain matching:
- It expects requests at `*.spotaxis.com` or exact `spotaxis.com`
- Railway routes traffic to `*.up.railway.app` domains
- Without the flag, middleware returns 404 for non-matching domains

**The Fix (lines 63-68 in TRM/middleware.py):**
```python
# Don't enforce subdomain suffix when:
allow_any = '*' in getattr(settings, 'ALLOWED_HOSTS', [])
disable_enforcement = os.getenv('DISABLE_SUBDOMAIN_ENFORCEMENT') == '1'
if not (allow_any or disable_enforcement):
    raise Http404()
```

## Deployment Architecture

```
┌─────────────────────────────────────────┐
│  Railway Project: alluring-balance      │
├─────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────┐     │
│  │ improved-tribble (VantaHire)   │     │
│  │ - Node.js + Express            │     │
│  │ - PostgreSQL: Postgres         │     │
│  │ - URL: improved-tribble...     │     │
│  └────────────────────────────────┘     │
│                                          │
│  ┌────────────────────────────────┐     │
│  │ authentic-motivation (SpotAxis)│     │
│  │ - Python 3.11 + Django 5.2     │     │
│  │ - PostgreSQL: Postgres-TSWi    │     │
│  │ - Gunicorn (3 workers)         │     │
│  │ - URL: authentic-motivation... │     │
│  └────────────────────────────────┘     │
│                                          │
└─────────────────────────────────────────┘
```

## VantaHire ↔ SpotAxis Integration

Set these in VantaHire (improved-tribble) environment:

```bash
SPOTAXIS_BASE_URL=https://authentic-motivation-production.up.railway.app
SPOTAXIS_CAREERS_URL=https://authentic-motivation-production.up.railway.app/jobs
```

## Verification Steps

### 1. Check Health Endpoint
```bash
curl https://authentic-motivation-production.up.railway.app/
# Should return 200 OK (or redirect to login)
```

### 2. Verify WeasyPrint (PDF Generation)
In Railway Shell:
```bash
python -c "import weasyprint; print('✓ WeasyPrint available')"
```

### 3. Check Database Connection
```bash
python manage.py migrate --check
```

### 4. Test Admin Panel
```
https://authentic-motivation-production.up.railway.app/admin/
```

### 5. Create Superuser (First Time)
In Railway Shell:
```bash
python manage.py createsuperuser
```

## Docker Build Details

The `Dockerfile` at repo root:
1. Uses `python:3.11-slim` base image
2. Installs WeasyPrint system dependencies:
   - `libpango-1.0-0`, `libpangocairo-1.0-0`
   - `libcairo2`, `libgdk-pixbuf-2.0-0`
   - `libglib2.0-0`, `libgobject-2.0-0`
   - `libharfbuzz0b`, `libffi8`
   - Font packages
3. Copies `SpotAxis/` directory to `/app`
4. Installs Python dependencies from `requirements.txt`
5. Runs: `collectstatic` → `migrate` → `gunicorn`

## Troubleshooting

### Health Check Still Failing?
1. ✅ Verify `DISABLE_SUBDOMAIN_ENFORCEMENT=1` is set
2. ✅ Check `ALLOWED_HOSTS=*` (default in settings.py)
3. ✅ Ensure healthcheckPath is `/` in railway.json
4. Redeploy and check logs

### Static Files Warnings?
Non-fatal. Django picks the first-found static file when duplicates exist.

### Missing Migrations Warning?
In local dev with Django installed:
```bash
python manage.py makemigrations common tagging
git add */migrations/*.py
git commit -m "Generate pending migrations"
git push
```

### WeasyPrint ImportError?
Check build logs for Cairo/Pango installation. If missing:
- Verify Dockerfile includes system dependencies (lines 4-10)
- Check that Railway is using the Dockerfile builder

## Success Indicators

✅ **Gunicorn Started:**
```
[INFO] Starting gunicorn 21.2.0
[INFO] Listening at: http://0.0.0.0:8080
[INFO] Using worker: sync
[INFO] Booting worker with pid: 166-168
```

✅ **Database Migrations Applied:**
```
Operations to perform:
  Apply all migrations: ...
Running migrations:
  ...
  OK
```

✅ **Static Files Collected:**
```
X static files copied to '/app/staticfiles'
```

✅ **Health Check Passing:**
Railway dashboard shows "Healthy" status

## Next Steps After Deployment

1. **Create Admin User**
   ```bash
   python manage.py createsuperuser
   ```

2. **Configure Organization Settings**
   - Login to `/admin/`
   - Set up company profiles
   - Configure job board settings

3. **Test VantaHire Integration**
   - Verify job listings appear in VantaHire
   - Test application submissions

4. **Test PDF Generation**
   - Visit `/api/vacancy/<id>/pdf/`
   - Should generate PDF without errors

## Support

For deployment issues:
- Check Railway logs: `railway logs`
- Review Django logs in Railway dashboard
- Verify all environment variables are set correctly

**Last Updated:** October 2025
