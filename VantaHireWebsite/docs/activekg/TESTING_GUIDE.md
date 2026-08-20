# ActiveKG Testing Guide

Step-by-step instructions for verifying the Vanta <-> ActiveKG integration works end-to-end.

---

## Production URLs

| Service | URL |
|---|---|
| **Vanta (VantaHire)** | https://web-production-fdb1d.up.railway.app/ |
| **ActiveKG API** | https://web-production-9418.up.railway.app/ |

---

## Prerequisites

Before testing, ensure these env vars are set in your `.env`:

```bash
# Required
ACTIVEKG_BASE_URL=https://web-production-9418.up.railway.app
VANTAHIRE_JWT_PRIVATE_KEY=<RSA private key: PEM text or base64-encoded PEM>
ACTIVEKG_SYNC_ENABLED=true

# Optional (defaults shown)
ACTIVEKG_TENANT_STRATEGY=shared          # or 'org_scoped'
ACTIVEKG_SYNC_BATCH_SIZE=20
ACTIVEKG_SYNC_INTERVAL_MS=5000
ACTIVEKG_SYNC_MAX_ATTEMPTS=8
ACTIVEKG_SYNC_CONCURRENCY=2
```

On the ActiveKG side, ensure:

```bash
JWT_ENABLED=true
JWT_ALGORITHM=RS256
JWT_ISSUER=vantahire
JWT_AUDIENCE=activekg
JWT_PUBLIC_KEY=<matching RSA public key PEM>
```

Before running DB queue diagnostics (`npm run check:activekg-sync`), prepare the
database through the explicit schema-release path and require `schema:ready` to
pass. Starting a web or worker process never creates the queue table.

---

## Test 1: Smoke Test (JWT + Read/Write/Search)

**What it tests**: JWT signing works, ActiveKG accepts our tokens, we can write nodes, read them back, and search for them.

### Run

```bash
cd VantaHireWebsite

# Basic — uses shared tenant "default"
npm run test:activekg

# With org ID (for org-scoped tenant testing)
npm run test:activekg -- --org-id 1

# Override tenant directly
npm run test:activekg -- --tenant-id default

# Require search hit (wait for embedding to complete)
npm run test:activekg -- --require-search-hit --search-attempts 8 --search-interval-ms 5000
```

### What it does (4 steps)

```
Step 1: Unauthenticated /search probe
  → Sends POST /search WITHOUT a JWT token
  → Expects 401 or 403 (proves JWT is enforced on ActiveKG)
  → This is informational — WARN is fine here

Step 2: Authenticated createNode (scope: kg:write)
  → Signs JWT with VANTAHIRE_JWT_PRIVATE_KEY
  → POST /nodes with a smoke test node
  → Expects 201 with a node ID

Step 3: Authenticated getNodeByExternalId (scope: kg:write)
  → GET /nodes/by-external-id?external_id=<smoke_node_external_id>
  → Expects 200 with matching node ID

Step 4: Authenticated search (scope: search:read)
  → POST /search for the smoke test marker
  → Polls up to N attempts (embeddings take time)
  → Expects to find the node in search results
```

### Expected output (all passing)

```
--- ActiveKG Integration Smoke Test ---
ActiveKG URL: https://your-activekg-url.up.railway.app
Tenant strategy: shared
Resolved tenant: default
Org ID: n/a
Marker: vh_activekg_smoke_1739894123456_a1b2c3d4
Step 1 unauthenticated /search probe: PASS (JWT enforced, status 401)
Step 2 createNode: PASS (nodeId=d4f7a8b2-...)
Step 3 getNodeByExternalId: PASS (nodeId=d4f7a8b2-...)
Step 4 search: PASS (attempt 1, count=1)

--- Summary ---
1) Unauthenticated probe: 401
2) Authenticated write (/nodes): PASS
3) Authenticated lookup (/nodes/by-external-id): PASS
4) Authenticated search hit (/search): PASS
```

### Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Step 2 FAIL, status=401 | JWT rejected | Check `JWT_ISSUER=vantahire`, `JWT_AUDIENCE=activekg` on ActiveKG. Ensure public key matches private key. |
| Step 2 FAIL, status=403 | Wrong scope | Check `activekg-client.ts` sends `kg:write` for `/nodes` |
| Step 2 FAIL, `econnrefused` | Wrong URL | Verify `ACTIVEKG_BASE_URL` is correct and ActiveKG is running |
| Step 3 FAIL, status=404 | Node not found | Step 2 might have silently failed — check ActiveKG logs |
| Step 4 WARN (no hit) | Embedding latency | Normal — try `--search-attempts 10 --search-interval-ms 8000` |

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--org-id <N>` | — | Use org-scoped tenant (`org_<N>`) |
| `--tenant-id <str>` | — | Override tenant ID directly |
| `--tenant-format <fmt>` | `underscore` | `underscore` → `org_1`, `colon` → `org:1` |
| `--search-attempts <N>` | `6` | How many times to poll for search hit |
| `--search-interval-ms <ms>` | `5000` | Delay between search attempts |
| `--require-search-hit` | `false` | Exit non-zero if search hit not found |

---

## Test 2: Check Sync Queue (DB diagnostic)

**What it tests**: Nothing against ActiveKG — this is a DB-only diagnostic. Shows what the sync queue looks like: how many jobs are pending, succeeded, failed, stuck.

### Run

```bash
cd VantaHireWebsite
npm run check:activekg-sync
```

### Expected output

```
=== ActiveKG Sync Queue Status ===

Status counts:
  [OK] succeeded: 15
  [..] pending: 2
  [!!] failed: 1
  Total: 18

Recent failures:
  Job 7 (app=12): attempts=3, error="ActiveKG /nodes returned 500: internal ..."

Recent jobs (last 10):
  ID | App | Status      | Attempts | Tenant  | Node ID                              | Chunks | Error
  ---------------------------------------------------------------------------------------------------------------
   18 |  42 | succeeded   |        1 | default | d4f7a8b2-1234-5678-9abc-def012345678 |      3 | -
   17 |  41 | succeeded   |        1 | default | ...                                  |      1 | -
   ...

=== Done ===
```

### What each status means

| Status | Icon | Meaning |
|---|---|---|
| `pending` | `..` | Waiting to be claimed by the processor |
| `processing` | `>>` | Currently being processed |
| `succeeded` | `OK` | Successfully synced to ActiveKG |
| `failed` | `!!` | Failed but will retry with backoff |
| `dead_letter` | `XX` | Permanently failed — won't retry |

### Red flags to look for

- **Many `pending` jobs**: Processor may not be running. Check `ACTIVEKG_SYNC_ENABLED=true` and look for `[ACTIVEKG_SYNC] Starting background processor` in logs.
- **Stale `processing` jobs** (stuck > 5 min): Processor crashed mid-job. Will auto-reclaim after `ACTIVEKG_SYNC_PROCESSING_LEASE_MS` (default 5 min).
- **Many `failed` jobs with 401 error**: JWT configuration mismatch. Check keys and issuer/audience.
- **`dead_letter` with "text too short"**: Resume text extraction failed upstream. Check if `extractedResumeText` exists on the application.

---

## Test 3: Full End-to-End Sync (real application flow)

**What it tests**: The complete pipeline — application submit triggers enqueue, background processor picks it up, syncs to ActiveKG.

### Option A: Via the application UI

1. Go to your Vanta instance and apply for a job with a resume
2. Wait ~10 seconds
3. Check the queue:

```bash
npm run check:activekg-sync
```

Look for the latest job — it should be `succeeded` with a `parentNodeId` and `chunkCount`.

### Option B: Via direct DB insert (for testing without UI)

```sql
-- Connect to your Vanta database

-- 1. Find a valid application with extracted resume text
SELECT id, job_id, organization_id, length(extracted_resume_text) as text_len
FROM applications
WHERE extracted_resume_text IS NOT NULL
  AND length(extracted_resume_text) > 50
ORDER BY id DESC LIMIT 5;

-- 2. Manually enqueue a sync job (use IDs from above)
INSERT INTO application_graph_sync_jobs
  (application_id, organization_id, job_id, effective_recruiter_id, activekg_tenant_id, status)
VALUES
  (42, 1, 7, 3, 'default', 'pending');

-- 3. Wait 5-10 seconds for the processor to pick it up

-- 4. Check the result
SELECT id, status, activekg_parent_node_id, chunk_count, last_error
FROM application_graph_sync_jobs
WHERE application_id = 42;
```

### Option C: Manual single sync cycle (no background poller needed)

```bash
cd VantaHireWebsite
npx tsx --env-file=.env server/scripts/run-one-sync-cycle.ts
```

This claims pending jobs and processes them in one shot. Output:

```
=== Single Sync Cycle ===
Claimed 1 job(s)

Processing job 1 (app=42, tenant=default):
  Creating parent node...
  Parent created: d4f7a8b2-...
  Chunks: 3
  SUCCEEDED: parentNodeId=d4f7a8b2-..., chunks=3

=== Final DB state ===
  Job 1: status=succeeded, parentNode=d4f7a8b2-..., chunks=3, error=none
```

### Verify the node in ActiveKG

After a successful sync, verify the node exists in ActiveKG:

```bash
# Generate a JWT (you need the private key)
JWT=$(npx tsx -e "
  import { signServiceJwt } from './server/lib/services/jwt-signer.ts';
  signServiceJwt('activekg', { tenantId: 'default', scopes: 'kg:write' })
    .then(t => process.stdout.write(t));
")

# Look up by external ID
curl -s "$ACTIVEKG_BASE_URL/nodes/by-external-id?external_id=vantahire:org_1:application:42:resume" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" | jq .
```

Expected response: the parent node with `resume_text`, `application_id`, etc. — and **no** `gcs_path`.

### Verify search works

```bash
JWT=$(npx tsx -e "
  import { signServiceJwt } from './server/lib/services/jwt-signer.ts';
  signServiceJwt('activekg', { tenantId: 'default', scopes: 'search:read' })
    .then(t => process.stdout.write(t));
")

curl -s "$ACTIVEKG_BASE_URL/search" \
  -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "senior engineer",
    "top_k": 5,
    "use_hybrid": true,
    "metadata_filters": { "source": "vantahire", "org_id": 1 }
  }' | jq .
```

---

## Test 4: JWT Verification (manual)

If you need to debug JWT issues, generate and decode one manually:

```bash
cd VantaHireWebsite

# Generate a JWT
npx tsx --env-file=.env -e "
  import { signServiceJwt } from './server/lib/services/jwt-signer.ts';
  const token = await signServiceJwt('activekg', {
    tenantId: 'default',
    scopes: 'kg:write',
  });
  console.log(token);
"

# Decode the JWT payload (without verification) to inspect claims
node -e "const t='<paste-jwt-here>'; const p=t.split('.')[1]; const b=p.replace(/-/g,'+').replace(/_/g,'/'); const s=b.padEnd(Math.ceil(b.length/4)*4,'='); console.log(Buffer.from(s,'base64').toString('utf8')); " | jq .
```

Expected decoded payload:

```json
{
  "tenant_id": "default",
  "scopes": "kg:write",
  "actor_type": "service",
  "iss": "vantahire",
  "sub": "vantahire-backend",
  "aud": "activekg",
  "iat": 1739894123,
  "exp": 1739894423,
  "jti": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Things to check in the JWT

- `iss` = `"vantahire"` (must match `JWT_ISSUER` on ActiveKG side)
- `aud` = `"activekg"` (must match `JWT_AUDIENCE` on ActiveKG side)
- `exp` > current time (JWT not expired)
- `scopes` matches what the endpoint requires

---

## Troubleshooting Cheatsheet

| Problem | Quick diagnosis |
|---|---|
| "Is ActiveKG reachable?" | `curl -s $ACTIVEKG_BASE_URL/health` |
| "Is JWT accepted?" | Run smoke test: `npm run test:activekg` |
| "Are jobs being enqueued?" | `npm run check:activekg-sync` — look for `pending` count |
| "Is the processor running?" | Check logs for `[ACTIVEKG_SYNC] Starting background processor` |
| "Why did a job fail?" | `SELECT last_error FROM application_graph_sync_jobs WHERE status='failed'` |
| "Is a node in ActiveKG?" | `curl` with JWT to `/nodes/by-external-id?external_id=...` |
| "Why no search results?" | Embeddings take time. Wait 30s, retry. Check `metadata_filters.org_id` matches. |
