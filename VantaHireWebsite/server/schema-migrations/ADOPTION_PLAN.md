# Existing Flow database adoption plan (Gate 1A0-R only)

This is the zero-application-mutation contract for teaching the release
migrator that an existing Flow database already matches migration `0000`.
Gate 1A0-R-A implements it as the guarded `db:adopt-existing` command, but that
command remains uncommitted/unshipped and **authorizes no production write**.
Production adoption, configuration, commit, deploy, and health checks remain
separately gated by 1A0-R-P0 through P5.

## Safety contract

Existing production must never execute `0000_baseline.sql`. Adoption is allowed
only after the checked-in semantic catalog comparator proves exact equality to
`catalog.lock.json`. The adoption transaction may create/write only the
`schema_control` schema and its `identity`, `applied`, and `run` tables. It may
not create, alter, drop, or write any application object or business row.

## Frozen inputs

- Deployed Flow source: `926c1d56eb965265a480b911e390164886386cc7`.
- Lossless 1A0-P source catalog SHA-256:
  `6c80a60c9364543e1b01b20d339bd5fe4a49d2c5354c5d107fb6349643916546`.
- Baseline file SHA-256:
  `3fd883d6fb45d0c52acc69bff16949185948bb51e5d732f57247f542814aa129`.
- Catalog lock SHA-256:
  `999636b7722cc305b10f71b9a096cc75701400ff49aea91435f839cadf13b90c`.
- Migration version/file: `0000` / `0000_baseline.sql`.

`checksums.lock` is the machine authority for the last two values. Any byte
change invalidates this plan and requires re-authoring plus independent review.

## Preconditions (all fail closed)

1. Re-pin both deployed Flow services to the same healthy source SHA. Stop if
   they differ from one another or from the approved release.
2. Re-run the frozen, catalog-only 1A0-P census twice under `REPEATABLE READ,
   READ ONLY`; both normalized hashes must match one another and the approved
   lossless source hash above.
3. Compare the normalized production artifact to `catalog.lock.json`; require
   zero missing, extra, or changed semantic records.
4. Prove `schema_control.identity`, `.applied`, and `.run` are absent. An
   existing/partial control plane is an incident requiring reconciliation, not
   an adoption shortcut.
5. Hold application deploys on the last verified version. Use a dedicated
   migration credential, never a runtime credential.
6. Under a separately approved 1A0-R configuration step, provision/reconcile a
   non-owner runtime role for `DATABASE_URL`. The migration owner grants it
   `USAGE` (not `CREATE`) on `public`, application table DML/read privileges,
   sequence use/read/update, routine execute, and read-only access to all three
   `schema_control` tables. Matching `ALTER DEFAULT PRIVILEGES` for the migration
   owner must cover future tables, sequences and routines. The runtime role must
   not own application objects or inherit the migration/owner role.
7. Generate a new opaque random target identity outside the database and store
   it in approved secret/configuration storage. Do not derive it from a host,
   database name, repository, tenant, or environment; never print the raw value.
8. Acquire the same bounded advisory lock used by the release runner. A timeout
   aborts without retrying inside an application process.

## Single adoption transaction

With statement, lock, connection, and whole-run deadlines active, execute one
transaction that:

1. reasserts the database target marker and absence of `schema_control`;
2. creates exactly the checked-in `CONTROL_DDL` control-plane definitions;
3. completes the runtime role's read-only `schema_control` grants/default
   privileges inside the same transaction;
4. inserts the singleton identity (`system='flow'`, the approved environment,
   and the opaque target id) without `ON CONFLICT`;
5. inserts one immutable `schema_control.applied` row for version `0000`, exact
   file/checksum, and `apply_mode='adopted'`;
6. inserts and completes one `schema_control.run` row with `outcome='success'`
   and a bounded, redacted detail; and
7. re-reads the identity and ledger, proves via transaction-local PostgreSQL
   statistics that zero non-`schema_control` rows changed, and commits only on
   an exact match.

Any error rolls back the whole transaction. The transaction must not invoke the
release runner's baseline application loop and must not contain any statement
against `public.*` or another application schema.

## Immediate proof before cutover

1. Run the catalog census again. The semantic comparator result must remain
   unchanged. `schema_control` is excluded from the census, while the separately
   approved role cutover may add environment-owned `default_acl` records that the
   stable projection explicitly excludes; any other normalized-catalog delta is
   a failure requiring reconciliation.
2. Verify exactly one identity, one applied `0000` row, and one finished-success
   run; zero unfinished/failed-latest attempts.
3. With the runtime credential, prove effective access to every public table,
   sequence and routine plus read-only control-plane access, and prove it lacks
   `CREATE` on `public` and neither owns nor inherits ownership of application/
   control objects. A catalog match cannot substitute for this effective check.
4. Run the release migrator once. It must prove the target identity and return
   a no-op (`applied=[]`); it must not execute the baseline.
5. Run the runtime-credential readiness command. It must pass using reads only.
6. Reconfirm application business-row counts/hashes selected in the separately
   approved 1A0-R execution lock are unchanged. Raw personal/business values are
   neither required nor emitted.

The unshipped 1A0-R-A code switches all three Flow startup commands to read-only
readiness and removes the legacy authorities. That cutover may be published and
activated only after the authoring checks are independently verified and each
later production sub-gate is separately approved. A failed check keeps the
existing application release in place and triggers reconciliation; it never
authorizes a compensating business-data edit.

## Copied database rule

A copied/restored database carries the source target id and therefore must not
be migrated as another environment. Before it can become a permitted target, a
separately approved restore/adoption procedure must prove its catalog, replace
the copied control-plane identity with a newly issued identity under a bounded
transaction, update the expected secret, and independently verify the result.
Merely changing an environment variable cannot turn a copy into an adopted
target.
