# Flow schema-migrations (Gate 1A0-F + unshipped 1A0-R-A cutover)

Append-only, ordered `NNNN_name.sql` migrations. `0000_baseline.sql` is the
**exact-catalog baseline** produced from the lossless, approval-gated 1A0-P
production catalog artifact at deployed Flow `926c1d56…`; it reproduces the
existing production application catalog as-is and contains no business rows.

`catalog.lock.json` is the stable semantic catalog expectation. It excludes
only environment-owned owners/ACLs/default privileges, database ACLs and PostgreSQL-generated RI
trigger identities (their exact FK constraints remain represented), and
canonicalizes PostgreSQL 16's default statistics target `-1` to PostgreSQL
17's equivalent `null`. `checksums.lock` pins both the catalog lock and every
migration byte-for-byte; the runtime manifest loader and CI guard enforce it.

Owners/ACLs are excluded from the portable lock, not from verification. Gate
1A0-R must provision a non-owner runtime role, grant it application DML/read +
sequence/routine access and read-only `schema_control` access, set matching
default privileges for future migration-owned objects, and withhold `CREATE`
on `public`. The read-only startup assertion checks those effective privileges
and rejects ownership or inherited ownership of application/control objects.

- Applied content is immutable; a repair is a new forward migration.
- The CI guard (`scripts/check-schema-control.mjs`) and runtime manifest loader
  reject a missing/edited catalog lock, missing/extra migration, or checksum
  change. A repair is always a new forward migration.
- The release runner (`server/migrate-release.ts` → `schema-control/runner.ts`)
  is the only path that applies these; ordinary startup runs only the read-only
  `server/schema-ready.ts` assertion.
- Existing production must **adopt** version `0000` after exact catalog
  comparison; it must never execute the baseline SQL. The guarded
  `db:adopt-existing` command may write only `schema_control`
  identity/ledger/run metadata and is not authorized to run until the separate
  1A0-R production gates are approved.

Supporting controls:

- [`ADOPTION_PLAN.md`](./ADOPTION_PLAN.md) freezes the zero-application-mutation
  contract implemented by the one-run adoption entrypoint. The checked-in
  command is inert without its production-only opt-in and does not itself
  authorize execution.
- [`LEGACY_BOOTSTRAP_CLASSIFICATION.md`](./LEGACY_BOOTSTRAP_CLASSIFICATION.md)
  classifies every old startup DML family so historical repairs, seeds, pricing
  policy, and privileged provisioning are not silently replayed.
