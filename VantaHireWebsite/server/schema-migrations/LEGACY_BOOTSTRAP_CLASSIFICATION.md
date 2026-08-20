# Legacy Flow bootstrap mutation classification

Gate 1A0-F replaces `server/bootstrapSchema.ts` as schema authority. The exact
production catalog is represented by `0000_baseline.sql`; **no business row is
part of that baseline**. This document classifies every DML family currently
reachable from the legacy bootstrap/startup path so the 1A0-R cutover cannot
silently replay it.

The classifications are deliberately conservative:

- **obsolete historical repair** — production already contains its effects;
  do not rerun it. Any future correction needs a new approved migration with
  explicit pre/postconditions.
- **separate seed/config command** — product/configuration policy, not schema;
  never run automatically at process startup.
- **write-boundary invariant** — enforce in the owning application transaction
  or constraint, not by periodically rewriting existing rows at boot.
- **catalog DDL** — represented exactly by the baseline catalog and future
  append-only schema migrations.

## `ensureAtsSchema()` DML

| Legacy mutation | Classification | 1A0 disposition |
|---|---|---|
| Pending jobs forced inactive; inactive jobs receive legacy deactivation metadata | Obsolete historical repair + write-boundary invariant | Do not replay. Job create/status-change paths must own future state consistency. Any cleanup of historical rows is a separately reviewed forward migration. |
| `users.role` rename `admin` → `super_admin` and the legacy admin username rewrite | Obsolete historical repair | Do not replay. Current identity/role creation and role changes must write the canonical values directly. |
| Default `automation_settings` inserts | Separate seed/config command | Excluded from the baseline and adoption. If defaults are still wanted, expose a separately authorized, idempotent provisioning command with an explicit target and audit result. |
| `subscription_plans` upsert from application constants | Separate seed/config command | Excluded. Pricing/entitlement policy must not be rewritten on every server boot; it needs its own approved configuration authority and change history. Candidate privacy 1A0 makes no pricing decision. |
| Existing job slug rewrite | Obsolete historical repair | Do not replay. Slug format belongs at the job write boundary; any catalog-wide correction is a separately approved forward migration. |
| Pending contact-resolution rows rewritten for missing Signal IDs or missing retry timestamps | Obsolete historical repair + write-boundary invariant | Do not replay. Queue/state writers must create complete retry state; later reconciliation is an explicit operational repair with bounded scope. |
| Existing outreach delivery status backfill | Obsolete historical repair | Do not replay. New delivery writes must carry the canonical status. |
| Historical outreach delivery correlation validation and `INSERT … SELECT … ON CONFLICT` backfill | Explicit one-time migration | The production catalog already contains the destination structure and production data already passed through the legacy path. Do not include rows in `0000`. If another environment requires this conversion, author a named forward data migration with the same fail-fast identity precondition, counts, rollback/compensation plan, and separate approval. |
| Historical scheduled campaigns copied into candidate schedules, then old pending campaigns cancelled | Explicit one-time migration | Do not replay. It changes active outreach state and therefore requires a separately approved data migration if ever needed elsewhere. Current scheduling writes must maintain the new model directly. |

All other `DO $$ … $$` bodies in `bootstrapSchema.ts` are conditional catalog
DDL (or the validation guard attached to the correlation backfill above). Their
resulting tables, columns, constraints, indexes, functions, and user triggers
are represented by the exact catalog baseline. The procedural legacy bodies
themselves are not a second migration authority.

## Other production startup DML

| Startup call | Classification | 1A0 disposition |
|---|---|---|
| `createAdminUser()` | Separate privileged provisioning command | Remove from normal startup at 1A0-R. Never create or rotate a privileged identity merely because an app process restarted. A future command must be explicit, target-bound, audited, and separately approved. |
| `seedDefaultWhatsAppTemplates()` | Separate seed/config command | Remove from normal startup at 1A0-R. Template creation/update belongs to an explicit configuration release because it changes outbound-message policy and provider-facing names. |
| Development `createTestRecruiter()`, `seedAllATSDefaults()`, `createTestJobs()` | Disposable-development seed only | Keep unavailable in production. CI guards must require both a development environment and an explicit disposable marker/seed opt-in. |

## Cutover invariant

After 1A0-R, web, worker, and AI-worker startup may perform only the read-only
schema readiness check before serving/consuming. No retired bootstrap, admin
provisioner, template seed, role rewrite, pricing upsert, business repair, or
backfill may be reachable from production startup. The schema-control caller
manifest and CI guard enforce that boundary; removing those assertions merely
to make the cutover green is forbidden.

The application credential is also no longer an object owner/migrator. 1A0-R
must establish the runtime grants/default privileges described in
`ADOPTION_PLAN.md`; readiness proves effective application access and rejects a
runtime role that can create public-schema objects or owns/inherits ownership of
application/control objects.
