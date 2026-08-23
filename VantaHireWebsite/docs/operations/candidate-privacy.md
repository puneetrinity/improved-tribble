# Candidate privacy operations (Phase 1A)

Flow implements reversible candidate restriction and delivery to the Memory privacy authority. Phase 1A does
not hard-delete candidate rows or files, run a retention purger, expose a manual purge endpoint, or represent
hard-purge eligibility.

## Intake and authority

- Candidate self-service requires a verified candidate session, CSRF protection and password confirmation no
  more than ten minutes before the request.
- Super-admin intake accepts an existing Flow subject plus an externally verified UUID evidence reference. It
  accepts no free-text evidence or arbitrary email lookup.
- `FLOW_CANDIDATE_PRIVACY_INTAKE_ENABLED=false` leaves status visible but makes both creation endpoints return
  `candidate_privacy_intake_disabled` without writing any ledger, link or outbox row.
- Application withdrawal and organization talent-pool removal are distinct from global privacy actions.

## Durable states

The append-only request event and current request projection commit together. A new request enters
`delivery_pending`; outbox delivery moves it to `memory_active` or `needs_review`. Delivery retry is leased and
auditable—outbox rows are never destructively dequeued. Error storage is a bounded code, not a provider body.

The Memory projection is consumed by ordered cursor. A cursor/version gap, unknown directive, disagreement,
stale feed, timeout or unavailable eligibility check fails closed for new global use. Snapshot reconciliation
builds a complete generation before atomically switching it active.

## Incident handling

1. Keep intake disabled if request authority, Memory delivery or projection reconciliation is uncertain.
2. Inspect aggregate request/outbox/sync states without printing request bodies, raw identity, evidence UUIDs,
   JWTs, signing keys or Memory response bodies.
3. Do not delete/rewrite event, outbox or projection history. Recover expired leases or run the authenticated
   snapshot reconciliation path.
4. Treat `needs_review` and `needs_reconciliation` as restrictive. Never convert them to an empty-success result.
5. Escalate any request for destructive deletion to the separately approved Phase 1B process. No Phase 1A
   operator action authorizes hard deletion.

## Expected controls

Flow readiness verifies the privacy tables, columns, append-only triggers and schema migration. The web runtime
owns the outbox/feed loop. The AI worker receives only non-secret authority configuration and enforces local
privacy decisions; it never runs delivery or receives Memory HMAC material.
