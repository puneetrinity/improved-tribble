// Gate 1A0-F — Flow schema-control: read-only startup readiness assertion.
//
// Ordinary web/worker/ai-worker startup runs THIS and nothing else against the
// schema. It performs zero DDL, zero seeds, zero business-row writes: it only
// reads the control-plane and asserts the database is exactly the expected,
// fully-migrated target. On any mismatch it fails closed so the process never
// begins serving/consuming against an incomplete or foreign schema.

import { loadManifest, type MigrationEntry } from "./manifest";
import { readApplied, readIdentity, readRunHealth, type PgLike } from "./ledger";
import { SYSTEM, safeTargetFingerprint, type ResolvedEnvironment } from "./targetIdentity";

export class SchemaNotReadyError extends Error {}

export interface ReadinessInput {
  pg: PgLike;
  migrationsDir: string;
  environment: ResolvedEnvironment;
  /** Expected opaque target id for this environment (runtime-safe config). */
  expectedTargetId: string;
  /**
   * Minimum critical postconditions the app cannot start without. Each returns
   * true when satisfied. These are read-only checks (e.g. a required table or
   * policy exists). Kept small and injected so this module stays pure.
   */
  criticalPostconditions?: Array<{ name: string; check: (pg: PgLike) => Promise<boolean> }>;
}

const FLOW_CORE_RELATIONS = [
  "public.users",
  "public.organizations",
  "public.organization_members",
  "public.jobs",
  "public.applications",
  "public.pipeline_stages",
  "public.candidate_resumes",
  "public.candidate_privacy_requests",
  "public.candidate_privacy_request_events",
  "public.candidate_privacy_subject_links",
  "public.candidate_privacy_outbox",
  "public.candidate_privacy_remote_projection",
  "public.candidate_privacy_sync_state",
  "public.talent_pool_membership_events",
  "public.decision_events",
  "public.decision_projection_outbox",
] as const;

/** Minimum catalog facts every Flow web/worker process requires to start. */
export const FLOW_CRITICAL_POSTCONDITIONS: NonNullable<
  ReadinessInput["criticalPostconditions"]
> = [
  {
    name: "Flow core application relations exist",
    async check(pg) {
      const result = await pg.query(
        `SELECT COUNT(*)::integer AS missing
           FROM unnest($1::text[]) AS required_relation(name)
          WHERE to_regclass(required_relation.name) IS NULL`,
        [[...FLOW_CORE_RELATIONS]],
      );
      return Number(result.rows[0]?.missing ?? FLOW_CORE_RELATIONS.length) === 0;
    },
  },
  {
    name: "Candidate privacy tables and append-only guards are exact",
    async check(pg) {
      const result = await pg.query(`
        SELECT
          (SELECT COUNT(*) = 7
             FROM unnest(ARRAY[
               'public.candidate_privacy_requests',
               'public.candidate_privacy_request_events',
               'public.candidate_privacy_subject_links',
               'public.candidate_privacy_outbox',
               'public.candidate_privacy_remote_projection',
               'public.candidate_privacy_sync_state',
               'public.talent_pool_membership_events'
             ]::text[]) AS expected(name)
            WHERE to_regclass(expected.name) IS NOT NULL)
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid='public.talent_pool'::regclass AND attname='removed_at' AND NOT attisdropped
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid='public.talent_pool'::regclass AND attname='removed_by_user_id' AND NOT attisdropped
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid='public.talent_pool'::regclass AND attname='removal_reason' AND NOT attisdropped
          )
          AND (
            SELECT COUNT(*) = 2
              FROM pg_catalog.pg_trigger t
             WHERE NOT t.tgisinternal
               AND t.tgname IN (
                 'candidate_privacy_request_events_append_only',
                 'talent_pool_membership_events_append_only'
               )
               AND t.tgenabled <> 'D'
          ) AS ok
      `);
      return result.rows[0]?.ok === true;
    },
  },
  {
    name: "Decision-event spine and append-only guards are exact",
    async check(pg) {
      const result = await pg.query(`
        SELECT
          to_regclass('public.decision_events') IS NOT NULL
          AND to_regclass('public.decision_event_sequence') IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc p
              JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public'
               AND p.proname='flow_reject_decision_event_mutation'
          )
          AND (
            SELECT COUNT(*)=2
              FROM pg_catalog.pg_trigger t
             WHERE t.tgrelid='public.decision_events'::regclass
               AND NOT t.tgisinternal
               AND t.tgenabled <> 'D'
               AND (
                 (t.tgname='decision_events_append_only' AND t.tgtype=27)
                 OR (t.tgname='decision_events_truncate_append_only' AND t.tgtype=34)
               )
          ) AS ok
      `);
      return result.rows[0]?.ok === true;
    },
  },
  {
    name: "Decision-projection outbox and append-only guards are exact",
    async check(pg) {
      const result = await pg.query(`
        SELECT
          to_regclass('public.decision_projection_outbox') IS NOT NULL
          AND to_regclass('public.decision_projection_outbox_sequence') IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc p
              JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public'
               AND p.proname='flow_reject_decision_projection_outbox_mutation'
          )
          AND (
            SELECT COUNT(*)=2
              FROM pg_catalog.pg_trigger t
             WHERE t.tgrelid='public.decision_projection_outbox'::regclass
               AND NOT t.tgisinternal
               AND t.tgenabled <> 'D'
               AND (
                 (t.tgname='decision_projection_outbox_append_only' AND t.tgtype=27)
                 OR (t.tgname='decision_projection_outbox_truncate_append_only' AND t.tgtype=34)
               )
          ) AS ok
      `);
      return result.rows[0]?.ok === true;
    },
  },
  {
    name: "Runtime role has application rights without DDL or ownership authority",
    async check(pg) {
      // ACL/owner names are environment-owned and intentionally excluded from
      // the portable catalog lock. Prove the effective runtime credential here
      // instead: it can use every application table/sequence/routine, can read
      // schema-control evidence, cannot create new public-schema objects, and
      // neither owns nor inherits ownership of the schemas/objects it uses.
      const result = await pg.query(`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_roles r
             WHERE r.rolname=current_user
               AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
               AND NOT r.rolreplication AND NOT r.rolbypassrls
               AND NOT EXISTS (
                 SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid
               )
          )
          AND has_database_privilege(current_user, current_database(), 'CONNECT')
          AND has_schema_privilege(current_user, 'public', 'USAGE')
          AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
          AND has_schema_privilege(current_user, 'schema_control', 'USAGE')
          AND NOT pg_has_role(
            current_user,
            pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname = 'public')),
            'MEMBER'
          )
          AND NOT pg_has_role(
            current_user,
            pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname = 'schema_control')),
            'MEMBER'
          )
          AND NOT EXISTS (
            SELECT 1
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'schema_control' AND c.relkind IN ('r','p')
               AND NOT (
                 has_table_privilege(current_user, c.oid, 'SELECT')
                 AND NOT has_table_privilege(current_user, c.oid, 'INSERT')
                 AND NOT has_table_privilege(current_user, c.oid, 'UPDATE')
                 AND NOT has_table_privilege(current_user, c.oid, 'DELETE')
                 AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE')
                 AND NOT has_table_privilege(current_user, c.oid, 'REFERENCES')
                 AND NOT has_table_privilege(current_user, c.oid, 'TRIGGER')
               )
          )
          AND NOT EXISTS (
            SELECT 1
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('public', 'schema_control')
               AND c.relkind IN ('r','p','S','v','m')
               AND pg_has_role(current_user, pg_get_userbyid(c.relowner), 'MEMBER')
          )
          AND NOT EXISTS (
            SELECT 1
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind IN ('r','p')
               AND NOT (
                 (
                   c.relname IN ('decision_events','decision_projection_outbox')
                   AND has_table_privilege(current_user, c.oid, 'INSERT')
                   AND NOT has_table_privilege(current_user, c.oid, 'SELECT')
                   AND NOT has_table_privilege(current_user, c.oid, 'UPDATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'DELETE')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'REFERENCES')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRIGGER')
                 )
                 OR
                 (
                   c.relname NOT IN ('decision_events','decision_projection_outbox')
                   AND has_table_privilege(current_user, c.oid, 'SELECT')
                   AND has_table_privilege(current_user, c.oid, 'INSERT')
                   AND has_table_privilege(current_user, c.oid, 'UPDATE')
                   AND has_table_privilege(current_user, c.oid, 'DELETE')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'REFERENCES')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRIGGER')
                 )
               )
          )
          AND NOT EXISTS (
            SELECT 1
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'S'
               AND NOT (
                 (
                   c.relname IN ('decision_event_sequence','decision_projection_outbox_sequence')
                   AND has_sequence_privilege(current_user, c.oid, 'USAGE')
                   AND NOT has_sequence_privilege(current_user, c.oid, 'SELECT')
                   AND NOT has_sequence_privilege(current_user, c.oid, 'UPDATE')
                 )
                 OR
                 (
                   c.relname NOT IN ('decision_event_sequence','decision_projection_outbox_sequence')
                   AND has_sequence_privilege(current_user, c.oid, 'USAGE')
                   AND has_sequence_privilege(current_user, c.oid, 'SELECT')
                   AND has_sequence_privilege(current_user, c.oid, 'UPDATE')
                 )
               )
          )
          AND NOT EXISTS (
            SELECT 1
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND (
                 pg_has_role(current_user, pg_get_userbyid(p.proowner), 'MEMBER')
                 OR NOT has_function_privilege(current_user, p.oid, 'EXECUTE')
               )
          ) AS ok
      `);
      return result.rows[0]?.ok === true;
    },
  },
];

/**
 * Assert schema readiness. Throws SchemaNotReadyError on any problem; returns
 * a small summary on success. Never writes.
 */
export async function assertSchemaReady(input: ReadinessInput): Promise<{
  version: string;
  applied: number;
}> {
  const { pg, migrationsDir, environment, expectedTargetId } = input;

  // 1. Identity: the connected database must be the expected target.
  const identity = await readIdentity(pg);
  if (!identity) {
    throw new SchemaNotReadyError(
      `Schema-control not initialized for ${safeTargetFingerprint(expectedTargetId)} — run the release migration before starting the app.`,
    );
  }
  if (
    identity.system !== SYSTEM ||
    identity.environment !== environment ||
    identity.target_id !== expectedTargetId
  ) {
    throw new SchemaNotReadyError(
      `Refusing to start: database identity does not match expected target ${safeTargetFingerprint(expectedTargetId)}.`,
    );
  }

  // 2. Manifest vs applied ledger: exact ordered names + checksums, no gaps.
  const manifest: MigrationEntry[] = loadManifest(migrationsDir);
  const applied = await readApplied(pg);
  if (applied.length !== manifest.length) {
    throw new SchemaNotReadyError(
      `Schema not fully migrated: ${applied.length}/${manifest.length} applied — a pending or partial migration blocks startup.`,
    );
  }
  for (let i = 0; i < manifest.length; i++) {
    // Lengths are equal (checked above) and i is in range, so both are defined.
    const m = manifest[i]!;
    const a = applied[i]!;
    if (a.version !== m.version || a.file !== m.file || a.checksum !== m.checksum) {
      throw new SchemaNotReadyError(
        `Schema drift at version ${m.version} (${m.file}): applied ledger does not match the committed manifest.`,
      );
    }
  }

  // 3. Attempt state: no abandoned run and the latest completed run succeeded.
  const runHealth = await readRunHealth(pg);
  if (!runHealth.tablePresent) {
    throw new SchemaNotReadyError("Schema-control run ledger is missing.");
  }
  if (runHealth.unfinished > 0) {
    throw new SchemaNotReadyError(
      `Schema migration has ${runHealth.unfinished} unfinished attempt(s); operator reconciliation is required.`,
    );
  }
  if (runHealth.latestOutcome !== "success") {
    throw new SchemaNotReadyError(
      "The latest completed schema migration attempt is absent or failed; a successful release migration is required.",
    );
  }

  // 4. Minimum critical postconditions (read-only). Production/staging callers
  // may extend the built-in set, but may never omit catalog checks entirely.
  const postconditions = input.criticalPostconditions ?? [];
  if (environment !== "development" && postconditions.length === 0) {
    throw new SchemaNotReadyError(
      "No critical schema postconditions were supplied outside development.",
    );
  }
  for (const pc of postconditions) {
    let ok = false;
    try {
      ok = await pc.check(pg);
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new SchemaNotReadyError(`Critical schema postcondition failed: ${pc.name}.`);
    }
  }

  // loadManifest throws on an empty manifest, so the last entry is defined.
  return { version: manifest[manifest.length - 1]!.version, applied: applied.length };
}
