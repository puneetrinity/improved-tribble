# Recruiter extra searches — owner operations

This adds searches to a named recruiter, not seats, subscription status or an
organisation-wide pool. The recruiter must have current sourcing access and an
active sourcing slot within capacity. No UI permission or recruiter action grants
credit. Existing usage is never reset.

## Plan, approve, apply, read back

Use the exact released checkout. Supply `FLOW_EXTRA_OWNER_URL` through protected
process configuration, never arguments or logs. Production additionally requires
`FLOW_EXTRA_CA_FILE` with a trusted certificate chain and matching hostname. URL
SSL overrides are refused. This tool does not resolve the existing Railway TLS
blocker or permit disabling certificate verification.

Input example (synthetic IDs/dates; replace with explicitly approved values):

```json
{
  "commandId": "10000000-0000-4000-8000-000000000001",
  "organizationId": 123,
  "recipientUserId": 456,
  "environment": "production",
  "targetId": "exact-flow-database-identity",
  "body": {
    "action": "issue",
    "quantity": 5,
    "validFrom": "2026-10-21T00:00:00Z",
    "validUntil": "2026-10-28T00:00:00Z",
    "operatorLabel": "self-declared operator name",
    "reason": "Approved design-partner allowance"
  }
}
```

```sh
node --import tsx scripts/sourcing-extra-searches.mjs plan request.json plan.json
node --import tsx scripts/sourcing-extra-searches.mjs apply plan.json --approve EXACT_PLAN_FINGERPRINT
node --import tsx scripts/sourcing-extra-searches.mjs read request.json
```

Plan is read-only and saved with mode 0600, refusing an existing output file.
Approval expires after 15 minutes and binds terms, database identity, owner role,
recipient eligibility, slots and existing grant balances. Apply rechecks the
catalog and identity, then serializes under the same organisation row lock used
by admissions. The immutable command receipt makes an exact replay idempotent;
changed terms with the same command ID are refused.

If the connection fails during COMMIT, **read the original command**, never invent
a new command ID or automatically retry. `found: true` confirms that command;
`found: false` is only a readback, not authorization to issue another grant. If the
original transaction may still be running, resolve it before proceeding. Re-plan
and obtain approval before a new apply. Readback does not require an unexpired
approval or an eligible recipient.

Revocation uses a new command ID and body containing only `action: "revoke"`,
`grantId`, `operatorLabel`, and `reason`. Plan/approve/apply/read are identical.
The label is explicitly self-declared; the actual PostgreSQL session user is
recorded independently. Expiry/revocation prevents new use, not completion of
work already reserved. A proven no-dispatch cancellation releases its original
balance once; it does not make expired or revoked credit usable again.

## Funding and release

Keep the existing payer order: job poster, then starter. Within each eligible
payer use included allowance first, then earliest-expiring extras. Grant expiry,
creation time and ID give deterministic ordering. Extras do not transfer to the
next slot occupant, replenish each month, or renew sourcing access.

Release requires migration 0023, permission refresh/readback, then coordinated
Flow web and AI-worker deployment. Readback must prove no runtime access to the
four new tables or five private routines. Old services fail readiness after the
new ledger entry; deploy promptly after schema/provisioning succeeds. New browser
and server use quote version 2 with an exact funding source and revision. Old
browser tabs must reload/reconfirm; old quotes cannot charge extras. Already
admitted work retains its original accounting; pre-migration admissions are
included-funded. No grant, renewal or paid search is part of deployment.

## Local verification

```sh
node --import tsx scripts/test-sourcing-extra-searches.mjs
# Requires a fresh loopback-only DB ending _extra_test and restricted owner ending _test:
node --import tsx scripts/test-sourcing-extra-searches-postgres.mjs
node scripts/check-sourcing-authority.mjs --test
node scripts/check-sourcing-authority.mjs --client
node scripts/check-sourcing-authority.mjs --pg
```

The operator PG test uses `FLOW_EXTRA_TEST_URL`; sourcing PG tests use the existing
`FLOW_SOURCING_DISPOSABLE`, `FLOW_SOURCING_OWNER_URL` and
`FLOW_SOURCING_CONCURRENCY_URL` fences. All are synthetic; no provider access.

**Commit inventory:** Flow ignores new script files. Force-add this runbook,
`sourcing-extra-searches.mjs`, `test-sourcing-extra-searches.mjs`, and
`test-sourcing-extra-searches-postgres.mjs`, then compare committed blob hashes
with the reviewed handoff. Do not assume a normal `git add` includes them.
