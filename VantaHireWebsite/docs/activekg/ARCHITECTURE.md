# ActiveKG Integration — Vanta Resume Sync

## Production URLs

| Service | URL |
|---|---|
| **Vanta (VantaHire)** | https://web-production-fdb1d.up.railway.app/ |
| **ActiveKG API** | https://web-production-9418.up.railway.app/ |

## Architecture

```
                         Vanta (VantaHireWebsite)
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  POST /api/jobs/:id/apply ──┐                                    │
│                              ├─► enqueueApplicationGraphSyncJob  │
│  POST /api/jobs/:id/        │     (non-blocking, fire-and-forget)│
│    applications/recruiter-add┘            │                      │
│                                           ▼                      │
│                           ┌─────────────────────────┐            │
│                           │ application_graph_sync_  │            │
│                           │ jobs (PostgreSQL table)  │            │
│                           │                         │            │
│                           │ pending → processing →  │            │
│                           │ succeeded / failed /    │            │
│                           │ dead_letter             │            │
│                           └────────────┬────────────┘            │
│                                        │                         │
│                    applicationGraphSyncProcessor                 │
│                    (background poller, every 5s)                 │
│                                        │                         │
│                                        ▼                         │
│                    ┌──────────────────────────────┐              │
│                    │ activekg-client.ts            │              │
│                    │ signServiceJwt('activekg',…)  │              │
│                    │ RS256 scoped JWT per request  │              │
│                    └──────────────┬───────────────┘              │
└───────────────────────────────────┼──────────────────────────────┘
                                    │ HTTPS + Bearer JWT
                                    ▼
                    ┌──────────────────────────────┐
                    │   ActiveKG API (Railway)      │
                    │                              │
                    │   POST /nodes   (kg:write)   │
                    │   POST /edges   (kg:write)   │
                    │   GET  /nodes/  (kg:write)   │
                    │     by-external-id           │
                    │   POST /search  (search:read)│
                    │   POST /ask     (ask:read)   │
                    │                              │
                    │   pgVector + embeddings +    │
                    │   extraction + LLM (Groq)    │
                    └──────────────────────────────┘
```

## Auth Model

### RS256 JWT (asymmetric)

Vanta signs outbound JWTs with an RSA private key. ActiveKG verifies them with the matching public key.

| Side | Key | Env var |
|---|---|---|
| Vanta | Private key (signs) | `VANTAHIRE_JWT_PRIVATE_KEY` |
| ActiveKG | Public key (verifies) | `JWT_PUBLIC_KEY` |

### JWT claims

Every request to ActiveKG carries a JWT with these claims:

```json
{
  "tenant_id": "default",
  "scopes": "kg:write",
  "actor_type": "service",
  "iss": "vantahire",
  "sub": "vantahire-backend",
  "aud": "activekg",
  "iat": 1771472826,
  "exp": 1771473126,
  "jti": "uuid"
}
```

### Scopes per endpoint

| Endpoint | Scope |
|---|---|
| `POST /nodes` | `kg:write` |
| `POST /edges` | `kg:write` |
| `POST /nodes/batch` | `kg:write` |
| `POST /upload` | `kg:write` |
| `GET /nodes/by-external-id` | `kg:write` |
| `POST /search` | `search:read` |
| `POST /ask` | `ask:read` |

### Key generation

```bash
# Generate RSA key pair (if not already done for Signal)
openssl genpkey -algorithm RSA -out vantahire-private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -in vantahire-private.pem -pubout -out vantahire-public.pem

# Base64-encode private key for env var
cat vantahire-private.pem | base64 -w 0
# → set as VANTAHIRE_JWT_PRIVATE_KEY

# Extract public key from existing private key (if env var is base64-encoded PEM)
echo "$VANTAHIRE_JWT_PRIVATE_KEY" | base64 -d | openssl rsa -pubout
# → set as JWT_PUBLIC_KEY on ActiveKG

# If env var is raw PEM text instead of base64:
printf '%s\n' "$VANTAHIRE_JWT_PRIVATE_KEY" | openssl rsa -pubout
```

The same key pair is shared with Signal integration. The `audience` claim differentiates them (`signal` vs `activekg`).

---

## Sync Flow

### 1. Enqueue (application routes)

When a candidate applies or a recruiter adds a candidate:

```
applications.routes.ts
  └─► if ACTIVEKG_SYNC_ENABLED === 'true' && application.organizationId
        └─► storage.enqueueApplicationGraphSyncJob({
              applicationId, organizationId, jobId,
              effectiveRecruiterId, activekgTenantId
            })
```

- **Apply flow**: `effectiveRecruiterId = job.postedBy`
- **Recruiter-add flow**: `effectiveRecruiterId = req.user.id`
- Tenant resolved via `resolveActiveKGTenantId(orgId)` → `"default"` or `"org_<id>"`
- Upsert: if job already `succeeded`, keeps it unchanged; otherwise resets to `pending`

### 2. Process (background processor)

`applicationGraphSyncProcessor.ts` polls every `ACTIVEKG_SYNC_INTERVAL_MS` (default 5s):

```
Poll cycle:
  1. Claim batch of pending/failed jobs (FOR UPDATE SKIP LOCKED)
  2. For each job (bounded concurrency):
     a. Load application from DB
     b. Validate: has organizationId, has extractedResumeText (≥50 chars)
     c. Build external_id: vantahire:org_<orgId>:application:<appId>:resume
     d. Check if parent node exists (getNodeByExternalId) — idempotent
     e. If not: createNode (classes: Document, Resume)
     f. Chunk resume text (activekgChunker.ts)
     g. For each chunk: check exists → createNode (classes: Chunk, Resume)
     h. Create DERIVED_FROM edge (chunk → parent)
     i. Mark job succeeded (store parentNodeId + chunkCount)
  3. On failure:
     - Retryable (5xx, 429, network): mark failed + exponential backoff
     - Non-retryable (4xx): dead-letter immediately
     - Max attempts exceeded: dead-letter
```

### 3. Node structure in ActiveKG

```
Parent node (Document, Resume)
  ├── props.resume_text = full resume text
  ├── props.external_id = vantahire:org_1:application:42:resume
  ├── props.application_id, job_id, org_id
  ├── metadata.source = vantahire
  └── metadata.org_id = 1  (for search isolation)

Chunk node (Chunk, Resume)  ── DERIVED_FROM ──► Parent node
  ├── props.text = chunk text
  ├── props.chunk_index, total_chunks
  ├── props.external_id = ...#chunk0
  └── props.parent_id = parent external_id
```

**What is NOT sent**: `gcs_path`, `resumeUrl`, or any file storage paths.

---

## Tenant Strategies

### Shared (default)

```bash
ACTIVEKG_TENANT_STRATEGY=shared  # or omit (default)
```

All orgs index into `tenant_id = "default"`. Org isolation at query time via `metadata_filters.org_id`.

```ts
// Search with org isolation
await search('default', {
  query: 'senior engineer',
  metadata_filters: { org_id: currentUser.organizationId },
});
```

### Org-scoped

```bash
ACTIVEKG_TENANT_STRATEGY=org_scoped
```

Each org gets `tenant_id = "org_<id>"`. Hard isolation at tenant level.

```ts
// No metadata filter needed — tenant boundary handles isolation
const tenantId = resolveActiveKGTenantId(orgId); // "org_42"
await search(tenantId, { query: 'senior engineer' });
```

---

## DB Schema

### `application_graph_sync_jobs`

```sql
CREATE TABLE application_graph_sync_jobs (
  id                    SERIAL PRIMARY KEY,
  application_id        INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE UNIQUE,
  organization_id       INTEGER REFERENCES organizations(id),
  job_id                INTEGER NOT NULL REFERENCES jobs(id),
  effective_recruiter_id INTEGER NOT NULL REFERENCES users(id),
  status                TEXT NOT NULL DEFAULT 'pending',
  attempts              INTEGER NOT NULL DEFAULT 0,
  next_attempt_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  last_error            TEXT,
  activekg_tenant_id    TEXT NOT NULL,
  activekg_parent_node_id TEXT,
  chunk_count           INTEGER,
  created_at            TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at            TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### Status lifecycle

```
pending ──► processing ──► succeeded
                │
                ├──► failed (retryable, will retry with backoff)
                │       └──► pending (after backoff delay)
                │
                └──► dead_letter (non-retryable or max attempts exceeded)
```

### Retry schedule (exponential + jitter)

| Attempt | Base delay |
|---|---|
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4 | 1 hour |
| 5+ | 6 hours (cap) |

Dead-letter after `ACTIVEKG_SYNC_MAX_ATTEMPTS` (default: 8).

---

## Environment Variables

### Vanta side

| Variable | Required | Default | Description |
|---|---|---|---|
| `ACTIVEKG_SYNC_ENABLED` | Yes | `false` | Set `true` to activate sync |
| `ACTIVEKG_BASE_URL` | Yes | — | ActiveKG API URL |
| `ACTIVEKG_TENANT_STRATEGY` | No | `shared` | `shared` or `org_scoped` |
| `VANTAHIRE_JWT_PRIVATE_KEY` | Yes | — | PEM or base64-encoded RSA private key |
| `VANTAHIRE_JWT_ACTIVE_KID` | No | `v1` | Key ID in JWT header |
| `ACTIVEKG_SYNC_BATCH_SIZE` | No | `20` | Jobs per poll cycle |
| `ACTIVEKG_SYNC_INTERVAL_MS` | No | `5000` | Poll interval (ms) |
| `ACTIVEKG_SYNC_MAX_ATTEMPTS` | No | `8` | Max retries before dead-letter |
| `ACTIVEKG_SYNC_CONCURRENCY` | No | `2` | Parallel job processing |
| `ACTIVEKG_SYNC_PROCESSING_LEASE_MS` | No | `300000` | Stale job reclaim (5 min) |
| `ACTIVEKG_CHUNK_MAX_CHARS` | No | `8000` | Max chars per chunk |
| `ACTIVEKG_CHUNK_OVERLAP_CHARS` | No | `500` | Overlap between chunks |

### ActiveKG side

| Variable | Value |
|---|---|
| `JWT_ENABLED` | `true` |
| `JWT_ALGORITHM` | `RS256` |
| `JWT_AUDIENCE` | `activekg` |
| `JWT_ISSUER` | `vantahire` |
| `JWT_PUBLIC_KEY` | Matching RSA public key (PEM) |

---

## Deployment Checklist

1. **Generate key pair** (skip if reusing Signal keys)
   ```bash
   openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048
   openssl rsa -in private.pem -pubout -out public.pem
   ```

2. **Deploy ActiveKG** with JWT vars set → verify health endpoint

3. **Deploy Vanta** with:
   ```bash
   ACTIVEKG_SYNC_ENABLED=true
   ACTIVEKG_BASE_URL=https://web-production-9418.up.railway.app
   ACTIVEKG_TENANT_STRATEGY=shared
   ```

4. **Table is release-owned** by the append-only Flow schema manifest; ordinary startup only checks readiness

5. **Verify**: submit application → check DB:
   ```sql
   SELECT id, status, activekg_parent_node_id, chunk_count, last_error
   FROM application_graph_sync_jobs ORDER BY id DESC LIMIT 5;
   ```

---

## Operational Scripts

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for detailed usage of each script.

| Script | npm command | Purpose |
|---|---|---|
| `test-activekg-integration.ts` | `npm run test:activekg` | Smoke test: JWT + write + read + search |
| `check-activekg-sync-status.ts` | `npm run check:activekg-sync` | DB queue diagnostic |
| `run-one-sync-cycle.ts` | `npx tsx --env-file=.env server/scripts/run-one-sync-cycle.ts` | Manual single sync cycle |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No rows in `application_graph_sync_jobs` | `ACTIVEKG_SYNC_ENABLED` not `true`, or application has no `organizationId` | Set env var, ensure job has `organization_id` |
| `status = failed`, `last_error` contains `401` | JWT rejected — issuer/audience/key mismatch | Verify `JWT_ISSUER=vantahire`, `JWT_AUDIENCE=activekg`, public key matches private key |
| `status = failed`, `last_error` contains `403` | JWT valid but wrong scope | Check `activekg-client.ts` sends correct scope for the endpoint |
| `status = failed`, `last_error` contains `econnrefused` | Wrong `ACTIVEKG_BASE_URL` or ActiveKG down | Verify URL, check ActiveKG health |
| `status = dead_letter`, `last_error` = "text too short" | Application has no/short `extracted_resume_text` | Resume extraction failed upstream; check resume extractor |
| `status = processing` for >5 minutes | Processor crashed mid-job | Will auto-reclaim after `ACTIVEKG_SYNC_PROCESSING_LEASE_MS` |
| Processor not starting | Missing log `ActiveKG graph sync processor started` | Check `ACTIVEKG_SYNC_ENABLED=true` in env |

### Quick DB diagnostics

```sql
-- Status counts
SELECT status, count(*) FROM application_graph_sync_jobs GROUP BY status;

-- Recent failures
SELECT id, application_id, attempts, last_error, updated_at
FROM application_graph_sync_jobs
WHERE status IN ('failed', 'dead_letter')
ORDER BY updated_at DESC LIMIT 10;

-- Stale processing jobs (stuck > 5 min)
SELECT id, application_id, updated_at
FROM application_graph_sync_jobs
WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes';
```

---

## Code Map

| File | Purpose |
|---|---|
| `shared/schema.ts` | `applicationGraphSyncJobs` table + types |
| `server/storage.ts` | DB queue methods (enqueue, claim, succeed, retry, dead-letter) |
| `server/schema-migrations/0000_baseline.sql` | Exact existing-schema baseline (fresh disposable databases only; never execute against adopted production) |
| `server/schema-ready.ts` | Read-only startup assertion; it never creates or repairs the queue table |
| `server/lib/services/activekg-client.ts` | HTTP client with RS256 scoped JWT |
| `server/lib/services/jwt-signer.ts` | RS256 JWT signing (shared with Signal) |
| `server/lib/activekgChunker.ts` | Resume text chunker (sentence-aware splits) |
| `server/lib/applicationGraphSyncProcessor.ts` | Background poll processor |
| `server/applications.routes.ts` | Enqueue hooks in apply + recruiter-add |
| `server/index.ts` | Processor start/stop lifecycle |
| `server/scripts/test-activekg-integration.ts` | Smoke test script |
| `server/scripts/run-one-sync-cycle.ts` | Manual single-cycle processor |
| `server/scripts/check-activekg-sync-status.ts` | DB queue diagnostic |

---

## What NOT to do

- **No `gcs_path`** in node props or metadata — only `resume_text`
- **No HS256** — always RS256 via `signServiceJwt('activekg', ...)`
- **No raw tribble imports** — don't use `activekgAuth.ts` or `activekgClient.ts` from tribble
- **No `ACTIVEKG_JWT_SECRET`** — that's the HS256 path; we use `VANTAHIRE_JWT_PRIVATE_KEY`
- **Don't merge tribble branch** — port selective pieces only
