# Deployment Checklist - Phase A & Phase 2 SEO

> **Historical snapshot — do not execute its migration steps.** The listed
> `bootstrapSchema.ts`, `MIGRATE_ON_START`, and startup migration authority are
> retired by Flow Gate 1A0-R; current instructions live in `DEPLOY_RAILWAY.md`.

## ✅ Pre-Deployment Verification (Completed)

### **1. Railway Environment Variables**

**Current Status:** Reviewed `railway-vars.json`

**✅ Already Set (Do Not Change):**
- `DATABASE_URL` ✅
- `SESSION_SECRET` ✅
- `BASE_URL` ✅ (https://improved-tribble-production.up.railway.app)
- `MIGRATE_ON_START=true` ✅
- `NODE_ENV=production` ✅
- `CLOUDINARY_*` ✅ (API keys present)
- `BREVO_SMTP_*` ✅ (Email configured)
- `ENABLE_SCHEDULER=true` ✅
- All other application settings ✅

**Optional (Async AI Fit Scoring Queue):**
```bash
AI_QUEUE_ENABLED=true
REDIS_URL=redis://...
AI_WORKER_INTERACTIVE_CONCURRENCY=2
AI_WORKER_BATCH_CONCURRENCY=1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```
If enabled, deploy a separate worker service with start command:
```bash
npm run start:ai-worker
```

**⚠️ MISSING - Need to Add to Railway:**
```bash
SEO_ENABLE_SITEMAP_JOBS=true
```

**How to Add:**
1. Go to Railway Dashboard → Your Project
2. Click on "Variables" tab
3. Add new variable: `SEO_ENABLE_SITEMAP_JOBS` = `true`
4. Save (will redeploy automatically)

**Optional (already defaults to true):**
- Can explicitly set `SEO_ENABLE_SITEMAP_JOBS=true` for clarity

---

### **2. Assets in client/public/ - ✅ ALL PRESENT**

| Asset | Status | Size | Purpose |
|-------|--------|------|---------|
| `og-image.jpg` | ✅ | 45K | Facebook/LinkedIn sharing (1200x630) |
| `twitter-image.jpg` | ✅ | 48K | Twitter Card preview (1200x600) |
| `apple-touch-icon.png` | ✅ | 25K | iOS home screen icon (180x180) |
| `logo.png` | ✅ | 25K | JSON-LD Organization logo (180x180) |
| `favicon.svg` | ✅ | 2.9K | Browser favicon |
| `llms.txt` | ✅ | - | AI crawler resource |
| `robots.txt` | ✅ | - | Search engine directives |

**Note:** `logo.png` was created from `apple-touch-icon.png` (both 180x180, meets minimum 112x112 requirement)

---

### **3. robots.txt Verification - ✅ CORRECT**

**File:** `client/public/robots.txt`

**✅ Verified Content:**
```txt
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin-dashboard
# ... other admin routes

# AI Crawler Resources
Allow: /llms.txt          ✅
Allow: /llms-full.txt     ✅
Allow: /llms-small.txt    ✅

# Sitemap locations
Sitemap: https://www.vantahire.com/sitemap.xml          ✅
Sitemap: https://www.vantahire.com/sitemap-jobs.xml     ✅
```

**Status:** Perfect - both sitemaps listed, llms.txt allowed

---

## 📋 Code Review & Commit

### **Files Modified:**

**Core SEO Implementation:**
- ✅ `shared/schema.ts` - Added slug + updatedAt columns
- ✅ `server/bootstrapSchema.ts` - Added base tables + SEO column migrations
- ✅ `server/storage.ts` - Added slug generation + updatedAt bumps
- ✅ `server/routes.ts` - Added sitemap-jobs.xml endpoint
- ✅ `server/seoUtils.ts` - NEW: Server-side SEO utilities
- ✅ `client/src/lib/seoHelpers.ts` - NEW: Client-side SEO helpers

**Route-Level Meta (Phase A):**
- ✅ `client/src/pages/jobs-page.tsx` - Added Helmet with dynamic meta
- ✅ `client/src/pages/job-details-page.tsx` - Added OG/Twitter images

**Configuration:**
- ✅ `client/index.html` - Updated base meta tags
- ✅ `client/src/main.tsx` - Wrapped with HelmetProvider
- ✅ `package.json` + `package-lock.json` - Added dependencies
- ✅ `.env.example` - Added SEO_ENABLE_SITEMAP_JOBS

**Assets:**
- ✅ `client/public/logo.png` - NEW: Created for JSON-LD

---

### **Git Commands:**

```bash
# 1. Check status
git status

# 2. Stage modified files (exclude temp docs)
git add \
  .env.example \
  client/index.html \
  client/src/main.tsx \
  client/src/pages/job-details-page.tsx \
  client/src/pages/jobs-page.tsx \
  client/src/lib/seoHelpers.ts \
  client/public/logo.png \
  package.json \
  package-lock.json \
  server/bootstrapSchema.ts \
  server/routes.ts \
  server/storage.ts \
  server/seoUtils.ts \
  shared/schema.ts

# 3. Commit with comprehensive message
git commit -m "SEO Phase A & Phase 2: Complete Google Jobs integration

Phase A - Route-level Meta Tags:
- Add dynamic title/description to jobs listing page
- Generate canonical URLs with query params for filters
- Add OG/Twitter images for social sharing previews
- Support location, type, search, and skills filters in meta

Phase 2 - Core SEO Implementation:
- Add slug + updatedAt columns to jobs table (with indexes)
- Generate SEO-friendly URLs: /jobs/{id}-{slug}
- Create dynamic sitemap: GET /sitemap-jobs.xml
- Add JobPosting JSON-LD with validation (client + server)
- Update timestamps on job mutations (accurate lastmod)
- Add social sharing images to job detail pages
- Wrap app with HelmetProvider for dynamic meta tags

Database Changes (Safe):
- CREATE TABLE IF NOT EXISTS for base tables
- ALTER TABLE ADD COLUMN IF NOT EXISTS for slug/updatedAt
- No destructive operations (no DROP/TRUNCATE/DELETE)
- Backward compatible (NULL slugs fallback to ID-only URLs)

Assets Added:
- logo.png (180x180 for JSON-LD Organization schema)

Technical Improvements:
- Use typed columns in sitemap query (type-safe)
- Validate JSON-LD before rendering (prevent Rich Results errors)
- Support feature flag: SEO_ENABLE_SITEMAP_JOBS
- Add noscript fallback content
- Cache sitemap responses (1 hour)

Files Changed:
- server/bootstrapSchema.ts: Add base tables + SEO columns
- server/storage.ts: Slug generation + updatedAt bumps
- server/routes.ts: Dynamic sitemap endpoint + typed queries
- server/seoUtils.ts: NEW - Server-side SEO utilities
- client/src/lib/seoHelpers.ts: NEW - Client-side SEO helpers
- client/src/pages/jobs-page.tsx: Dynamic meta for listing
- client/src/pages/job-details-page.tsx: Social images + JSON-LD
- client/src/main.tsx: HelmetProvider wrapper
- client/index.html: Updated base meta tags
- shared/schema.ts: Add slug + updatedAt to jobs table

Dependencies Added:
- react-helmet-async (dynamic meta tags)
- slugify (URL slug generation)
- isomorphic-dompurify (HTML sanitization)

All changes are backward-compatible and non-breaking.
Existing jobs work without slugs (fallback to ID-only URLs).
No data loss risk - migrations use IF NOT EXISTS pattern.

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>"

# 4. Push to origin
git push origin master
```

---

## 🚀 Build & Deploy

### **Railway Deployment Process:**

Railway uses **Nixpacks** with automatic build detection:

```bash
# Build command (automatic)
npm install && npm run build

# Start command (from package.json)
npm run start
```

### **Optional: Local Pre-flight Check**

```bash
# 1. Clean build
rm -rf dist/
npm run build

# 2. Test production build locally
NODE_ENV=production \
DATABASE_URL="postgresql://vantahire_user:devpass123@localhost:5433/vantahire_dev" \
SESSION_SECRET="42f42b71b37b767cabebd6784dacd51f42b7466c396446e8f843fb6b4aee19f4" \
BASE_URL="http://localhost:5000" \
SEO_ENABLE_SITEMAP_JOBS=true \
npm run start

# 3. Health check
curl http://localhost:5000/api/health
# Expected: 200 OK

# 4. Test sitemap
curl http://localhost:5000/sitemap-jobs.xml
# Expected: 200 OK, XML content

# 5. Test jobs page
curl -I http://localhost:5000/jobs
# Expected: 200 OK
```

### **Railway Deployment Steps:**

1. **Push to GitHub:**
   ```bash
   git push origin master
   ```

2. **Railway Auto-Deploy:**
   - Railway detects push automatically
   - Runs build: `npm install && npm run build`
   - Runs migrations: `ensureAtsSchema()` (via `MIGRATE_ON_START=true`)
   - Starts server: `npm run start`

3. **Add Missing Environment Variable:**
   - Go to Railway Dashboard
   - Navigate to Variables
   - Add: `SEO_ENABLE_SITEMAP_JOBS=true`
   - Save (triggers redeploy)

4. **Monitor Deployment:**
   - Watch Railway logs for:
     - ✅ "✅ ATS schema ready"
     - ✅ "Adding SEO columns to jobs table..."
     - ✅ "serving on port"
     - ❌ Check for errors

---

## ✅ Post-Deploy Verification

### **1. Sitemaps**

```bash
# Test sitemap-jobs.xml
curl -I https://vantahire.com/sitemap-jobs.xml
# Expected: 200 OK, Content-Type: application/xml

# View content
curl https://vantahire.com/sitemap-jobs.xml | head -30
# Expected:
# - Only approved + active jobs
# - <lastmod> shows recent dates
# - URLs format: /jobs/{id}-{slug}
```

### **2. Robots.txt**

```bash
curl https://vantahire.com/robots.txt
# Expected:
# - Sitemap: https://www.vantahire.com/sitemap.xml
# - Sitemap: https://www.vantahire.com/sitemap-jobs.xml
# - Allow: /llms.txt
```

### **3. Jobs Listing Page Meta**

**Test URLs:**
- https://vantahire.com/jobs
- https://vantahire.com/jobs?location=Bangalore
- https://vantahire.com/jobs?type=full-time
- https://vantahire.com/jobs?location=Bangalore&type=full-time&search=React

**View Page Source for Each:**
- ✅ Check `<title>` shows filters
- ✅ Check `<meta name="description">` has job count
- ✅ Check `<link rel="canonical">` includes query params
- ✅ Check `<meta property="og:image">` points to /og-image.jpg
- ✅ Check `<meta name="twitter:image">` points to /twitter-image.jpg

### **4. Job Detail Page SEO**

**Visit:** https://vantahire.com/jobs/1

**View Page Source:**
- ✅ `<title>` shows job title
- ✅ `<meta name="description">` shows truncated description
- ✅ `<link rel="canonical">` shows job URL
- ✅ `<meta property="og:image">` present
- ✅ `<meta name="twitter:image">` present
- ✅ `<script type="application/ld+json">` with JobPosting schema

### **5. Rich Results Validation**

**Google Rich Results Test:**
1. Go to: https://search.google.com/test/rich-results
2. Enter job URL: `https://vantahire.com/jobs/1`
3. Click "Test URL"
4. Expected: ✅ Green checkmarks, "JobPosting" detected
5. Fix any warnings immediately

**Test 3-5 different job pages**

### **6. Social Sharing Debuggers**

**Facebook Debugger:**
1. Go to: https://developers.facebook.com/tools/debug/
2. Enter: `https://vantahire.com/jobs/1`
3. Click "Debug"
4. Expected:
   - ✅ Shows og-image.jpg preview
   - ✅ Shows job title + description
   - ✅ Image dimensions: 1200x630

**Twitter Card Validator:**
1. Go to: https://cards-dev.twitter.com/validator
2. Enter: `https://vantahire.com/jobs/1`
3. Expected:
   - ✅ Shows twitter-image.jpg
   - ✅ Card type: summary_large_image

**LinkedIn Post Inspector:**
1. Go to: https://www.linkedin.com/post-inspector/
2. Enter: `https://vantahire.com/jobs/1`
3. Expected:
   - ✅ Shows og-image.jpg
   - ✅ Shows title + description

### **7. Google Search Console**

**Submit Sitemaps:**
1. Go to: https://search.google.com/search-console
2. Select property: vantahire.com
3. Navigate to: Sitemaps
4. Submit:
   - `https://vantahire.com/sitemap.xml`
   - `https://vantahire.com/sitemap-jobs.xml`

**Monitor:**
- Index Coverage → watch for new job pages
- Enhancements → Job postings → fix warnings quickly
- Performance → track job page impressions

---

## 🔧 Operational Flags & Rollback

### **Feature Flags:**

**Disable Jobs Sitemap (Emergency):**
```bash
# In Railway Dashboard:
SEO_ENABLE_SITEMAP_JOBS=false

# Redeploy (or will auto-deploy)
# Sitemap endpoint returns 404
```

**Re-enable:**
```bash
SEO_ENABLE_SITEMAP_JOBS=true
```

### **Code Rollback:**

**If deployment has issues:**
```bash
# 1. Find commit to revert
git log --oneline -5

# 2. Revert the SEO commit
git revert <commit-hash>

# 3. Push revert
git push origin master

# Railway will auto-deploy the revert
```

**Partial Rollback (Sitemap Only):**
- Set `SEO_ENABLE_SITEMAP_JOBS=false` in Railway
- Keeps other SEO improvements active
- Disables only the dynamic sitemap

---

## 📊 Success Metrics (Monitor After Deployment)

### **Immediate (Day 1-3):**
- ✅ No 5xx errors in Railway logs
- ✅ Sitemap accessible (200 OK)
- ✅ Rich Results validation passes
- ✅ Social sharing previews work

### **Short-term (Week 1-2):**
- GSC shows both sitemaps indexed
- Job pages appear in GSC coverage
- No warnings in Job postings enhancement report

### **Medium-term (Month 1):**
- Increased organic impressions for job-related keywords
- Job pages ranking for "{job title} {location}" queries
- Google Jobs integration showing VantaHire listings

---

## 🐛 Troubleshooting

### **Sitemap Returns 404:**
- Check Railway env: `SEO_ENABLE_SITEMAP_JOBS=true`
- Check logs for migration errors
- Verify route registered: grep "sitemap-jobs.xml" in logs

### **Sitemap Shows No Jobs:**
- Check database: `SELECT COUNT(*) FROM jobs WHERE is_active = true AND status = 'approved';`
- Ensure at least one approved active job exists
- Check logs for query errors

### **Rich Results Test Fails:**
- View page source → verify JSON-LD present
- Check JSON-LD syntax (no trailing commas, valid dates)
- Ensure description length >= 120 characters
- Verify required fields: title, location, datePosted

### **Social Images Don't Show:**
- Verify files exist: `curl -I https://vantahire.com/og-image.jpg`
- Check image sizes (og-image: 1200x630, twitter: 1200x600)
- Clear Facebook cache: https://developers.facebook.com/tools/debug/
- Check meta tag syntax (property vs name)

### **Migration Errors:**
- Check logs: `ALTER TABLE` errors
- Verify PostgreSQL version compatibility
- Check disk space on Railway
- Rollback if needed: `SEO_ENABLE_SITEMAP_JOBS=false`

---

## 🎯 Optional Backlog (Future Enhancements)

**When Traffic Increases:**
1. **Dynamic Rendering for Bots**
   - Use Rendertron or Prerender.io
   - Serve pre-rendered HTML to crawlers
   - Improves SPA crawlability

2. **City/Role Landing Pages**
   - `/jobs/bangalore` → Bangalore jobs listing
   - `/jobs/developer` → Developer jobs
   - Add unique content (not just filtered views)
   - Internal links improve crawlability

3. **IndexNow Integration**
   - Ping Bing on job create/approve/deactivate
   - Faster indexing for new content
   - Free API: https://www.indexnow.org/

4. **Structured Data Expansion**
   - Add BreadcrumbList for navigation
   - Add FAQPage for job details
   - Add Organization schema with real logo

---

## ✅ Deployment Checklist Summary

- ✅ Railway environment variables reviewed (need to add `SEO_ENABLE_SITEMAP_JOBS=true`)
- ✅ All assets present in `client/public/` (og-image, twitter-image, logo.png, etc.)
- ✅ `robots.txt` correct (both sitemaps, llms.txt allowed)
- ✅ `logo.png` created (180x180 from apple-touch-icon)
- ✅ Code reviewed and ready for commit
- ✅ Git commit message prepared
- ✅ Deployment process documented
- ✅ Post-deploy verification steps ready
- ✅ Rollback plan in place

**Status:** Ready for deployment 🚀

**Estimated Deployment Time:** 5-10 minutes (build + migration + start)

**Risk Level:** Low (all migrations use IF NOT EXISTS, backward compatible)
