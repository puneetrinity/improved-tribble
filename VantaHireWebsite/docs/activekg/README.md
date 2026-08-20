# ActiveKG Integration — Developer Bundle

Self-contained reference for the Vanta <-> ActiveKG resume sync pipeline.

## What is this?

When a candidate applies for a job (or a recruiter adds one), Vanta extracts the resume text and syncs it to **ActiveKG** — an external knowledge graph API backed by pgVector + embeddings. ActiveKG enables semantic search over resumes ("find me senior backend engineers with Kubernetes experience").

## How it works (30-second version)

```
Candidate applies  ──►  Vanta extracts resume text
                              │
                              ▼
                    DB queue (application_graph_sync_jobs)
                              │  background poller every 5s
                              ▼
                    POST /nodes  (parent node: full resume)
                    POST /nodes  (chunk nodes: ~8KB slices)
                    POST /edges  (DERIVED_FROM: chunk → parent)
                              │
                              ▼
                    ActiveKG indexes, embeds, ready for search
```

Auth: every request carries an RS256 JWT signed by Vanta, verified by ActiveKG.

## Production URLs

| Service | URL |
|---|---|
| **Vanta (VantaHire)** | https://web-production-fdb1d.up.railway.app/ |
| **ActiveKG API** | https://web-production-9418.up.railway.app/ |

## What's in this folder

```
docs/activekg/
├── README.md                                  ← you are here
├── ARCHITECTURE.md                            ← auth, sync flow, DB schema, env vars, troubleshooting
├── PAYLOAD_REFERENCE.md                       ← exact JSON for every API call
├── TESTING_GUIDE.md                           ← step-by-step testing instructions
└── scripts/
    ├── test-activekg-integration.ts           ← smoke test (JWT + write + read + search)
    ├── check-activekg-sync-status.ts          ← DB queue diagnostic
    └── run-one-sync-cycle.ts                  ← manual single sync cycle
```

### Docs

| File | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full architecture: auth model, sync flow, DB schema, env vars, deployment checklist, troubleshooting, code map |
| [PAYLOAD_REFERENCE.md](PAYLOAD_REFERENCE.md) | Exact JSON payloads Vanta sends to each ActiveKG endpoint, with response shapes |
| [TESTING_GUIDE.md](TESTING_GUIDE.md) | Step-by-step: how to run the smoke test, check sync queue, trigger a real sync, verify in ActiveKG |

### Scripts

These scripts are included here for reference. The runnable copies live in `server/scripts/` (they import server modules). Run from `VantaHireWebsite/`:

| Script | npm command | What it does |
|---|---|---|
| `test-activekg-integration.ts` | `npm run test:activekg` | Smoke test: JWT auth, write node, read node, search |
| `check-activekg-sync-status.ts` | `npm run check:activekg-sync` | DB-only diagnostic: status counts, stale jobs, recent failures |
| `run-one-sync-cycle.ts` | `npx tsx --env-file=.env server/scripts/run-one-sync-cycle.ts` | Manually claim + process pending jobs (no background poller) |

## Quick start for a new dev

1. **Read** [ARCHITECTURE.md](ARCHITECTURE.md) — understand the flow
2. **Check env** — ensure `ACTIVEKG_BASE_URL`, `VANTAHIRE_JWT_PRIVATE_KEY`, `ACTIVEKG_SYNC_ENABLED=true` are set
3. **Prepare the schema explicitly** — run the approved release migration for a disposable database, then require `npm run schema:ready` to pass (ordinary startup never creates tables)
4. **Run smoke test** — `npm run test:activekg` — confirms JWT + write + read + search work
5. **Check queue** — `npm run check:activekg-sync` — see what's pending/succeeded/failed
6. **Look at payloads** — [PAYLOAD_REFERENCE.md](PAYLOAD_REFERENCE.md) — see exactly what Vanta sends to ActiveKG

## Key source files

| File | Purpose |
|---|---|
| `server/lib/services/activekg-client.ts` | HTTP client — typed requests, scoped JWT per endpoint |
| `server/lib/services/jwt-signer.ts` | RS256 JWT signing (shared with Signal integration) |
| `server/lib/activekgChunker.ts` | Sentence-aware resume text chunker |
| `server/lib/applicationGraphSyncProcessor.ts` | Background poller: claim → process → succeed/fail |
| `server/applications.routes.ts` | Enqueue hooks in apply + recruiter-add flows |
| `server/storage.ts` | DB queue methods (enqueue, claim, succeed, retry, dead-letter) |
| `shared/schema.ts` | `applicationGraphSyncJobs` Drizzle table definition |
| `server/index.ts` | Processor start/stop lifecycle |
