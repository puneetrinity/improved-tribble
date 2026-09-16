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
import { CANDIDATE_INDEX_TABLES, CANDIDATE_INDEX_FUNCTIONS,
  CANDIDATE_INDEX_TRIGGER_FUNCTION } from "../candidate-index/contracts";

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
  "public.decision_projection_delivery_state",
  "public.organization_candidate_references",
  "public.application_resume_versions",
  "public.organization_candidate_memory_outbox",
  "public.candidate_consent_subjects",
  "public.candidate_consent_sources",
  "public.candidate_consent_events",
  "public.candidate_consent_outbox",
  "public.candidate_index_outbox",
  "public.candidate_index_delivery_state",
] as const;

// Generated from the exercised PostgreSQL 16 migration; ACLs are checked separately.
export const CANDIDATE_INDEX_CATALOG_SHA256 = "f75235ac3066f21632519e2b6a241acd307d09873891b4c68a1337fa0e568c34";
export const CANDIDATE_INDEX_CATALOG_SQL = `WITH relations AS (
  SELECT c.oid,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'candidate_index_%'
), facts AS (
  SELECT jsonb_build_object(
    'relations',(SELECT jsonb_agg(jsonb_build_array(relname,relkind,relrowsecurity,relforcerowsecurity)
      ORDER BY relname) FROM relations),
    'columns',(SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attnum,
      pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum)
      FROM relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,k.contype,
      pg_catalog.pg_get_constraintdef(k.oid,false),k.convalidated,k.condeferrable,k.condeferred)
      ORDER BY c.relname,k.conname) FROM relations c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid),
    'indexes',(SELECT jsonb_agg(jsonb_build_array(c.relname,pg_catalog.pg_get_indexdef(i.indexrelid),
      i.indisvalid,i.indisready) ORDER BY c.relname,pg_catalog.pg_get_indexdef(i.indexrelid))
      FROM relations c JOIN pg_catalog.pg_index i ON i.indrelid=c.oid),
    'triggers',(SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,t.tgtype,
      pg_catalog.pg_get_triggerdef(t.oid,false)) ORDER BY c.relname,t.tgname)
      FROM relations c JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid WHERE NOT t.tgisinternal),
    'policies',(SELECT jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,
      pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
      ORDER BY c.relname,p.polname) FROM relations c JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid),
    'functions',(SELECT jsonb_agg(jsonb_build_array(p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid),
      pg_catalog.pg_get_function_result(p.oid),l.lanname,p.proconfig,p.prosecdef,p.proleakproof,
      p.provolatile,p.proparallel,p.proisstrict,p.proretset,p.prosrc) ORDER BY p.proname,p.oid::regprocedure::text)
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.proname LIKE 'flow_%candidate_index%')
  ) AS catalog
) SELECT encode(sha256(convert_to(catalog::text,'UTF8')),'hex') AS digest FROM facts`;

export async function candidateIndexPrivilegesReady(pg: PgLike, role: string, required: boolean): Promise<boolean> {
  const presence = await pg.query(`SELECT
    (SELECT count(*)::int FROM unnest($1::text[]) n WHERE to_regclass('public.'||n) IS NOT NULL) AS tables,
    (SELECT count(*)::int FROM unnest($2::text[]) n WHERE to_regprocedure(n) IS NOT NULL) AS functions`,
  [[...CANDIDATE_INDEX_TABLES], [...CANDIDATE_INDEX_FUNCTIONS, CANDIDATE_INDEX_TRIGGER_FUNCTION]]);
  const count = presence.rows[0];
  if (!required && count?.tables === 0 && count?.functions === 0) return true;
  if (count?.tables !== 2 || count?.functions !== 6) return false;
  const catalog = await pg.query(CANDIDATE_INDEX_CATALOG_SQL);
  if (catalog.rows[0]?.digest !== CANDIDATE_INDEX_CATALOG_SHA256) return false;
  const privileges = await pg.query(`SELECT
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v(privilege)
      WHERE c.oid=ANY(ARRAY['public.candidate_index_outbox'::regclass,'public.candidate_index_delivery_state'::regclass])
        AND has_table_privilege($1,c.oid,v.privilege) IS DISTINCT FROM
          (c.relname='candidate_index_outbox' AND v.privilege='INSERT')
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) v(privilege)
      WHERE c.oid=ANY(ARRAY['public.candidate_index_outbox'::regclass,'public.candidate_index_delivery_state'::regclass])
        AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege($1,c.oid,a.attnum,v.privilege)
          IS DISTINCT FROM (c.relname='candidate_index_outbox' AND v.privilege='INSERT')
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      WHERE c.oid=ANY(ARRAY['public.candidate_index_outbox'::regclass,'public.candidate_index_delivery_state'::regclass])
        AND (acl.grantee=0 OR (acl.grantee=to_regrole($1) AND acl.is_grantable))
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
      WHERE a.attrelid=ANY(ARRAY['public.candidate_index_outbox'::regclass,'public.candidate_index_delivery_state'::regclass])
        AND (acl.grantee=0 OR (acl.grantee=to_regrole($1) AND acl.is_grantable))
    ) AND NOT EXISTS (
      SELECT 1 FROM unnest($2::text[]) sig
      JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(sig)
      WHERE NOT p.prosecdef OR p.proconfig IS DISTINCT FROM CASE
        WHEN p.proname='flow_candidate_index_managed_application' THEN ARRAY['search_path=pg_catalog, public']
        ELSE ARRAY['search_path=pg_catalog, public','lock_timeout=1500ms','statement_timeout=3s'] END
        OR NOT has_function_privilege($1,p.oid,'EXECUTE')
    ) AND NOT has_function_privilege($1,to_regprocedure($3),'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid IN (SELECT to_regprocedure(sig) FROM unnest($2::text[] || ARRAY[$3]) sig)
        AND (acl.grantee=0 OR acl.grantee NOT IN (p.proowner,to_regrole($1))
          OR (acl.grantee=to_regrole($1) AND acl.is_grantable))
    ) AS ok`, [role, [...CANDIDATE_INDEX_FUNCTIONS], CANDIDATE_INDEX_TRIGGER_FUNCTION]);
  return privileges.rows[0]?.ok === true;
}

export const CANDIDATE_CONSENT_TABLES = ["candidate_consent_subjects", "candidate_consent_sources",
  "candidate_consent_events", "candidate_consent_outbox"] as const;
export const CANDIDATE_CONSENT_FUNCTIONS = [
  "public.flow_claim_candidate_consent_outbox(text,integer,integer,uuid)",
  "public.flow_ack_candidate_consent_outbox(uuid,integer,jsonb)",
  "public.flow_fail_candidate_consent_outbox(uuid,integer,text,boolean,timestamp with time zone)",
  "public.flow_candidate_consent_resume_ready(integer,uuid)",
] as const;
export const CANDIDATE_CONSENT_UPDATE_COLUMNS = ["version", "desired_action", "acknowledged_version",
  "acknowledged_action", "current_source_id", "effective_source_id", "delivery_status", "last_error_code", "updated_at"] as const;

export const CANDIDATE_CONSENT_CONSTRAINTS = [
  ["candidate_consent_events","candidate_consent_events_account_auth_version_check","c",false,false,"b70d60a269dd701721036be0a3806d21"],
  ["candidate_consent_events","candidate_consent_events_action_check","c",false,false,"f8baec0ffc2899951c35ca936fe97813"],
  ["candidate_consent_events","candidate_consent_events_check","c",false,false,"d63f7b13e1e0bf934279c53ff5d92692"],
  ["candidate_consent_events","candidate_consent_events_command_sha256_check","c",false,false,"961becf02fada29032a50ecc34e14725"],
  ["candidate_consent_events","candidate_consent_events_copy_sha256_check","c",false,false,"7868e2e17dd2299588997beeb4a9b46b"],
  ["candidate_consent_events","candidate_consent_events_copy_version_check","c",false,false,"e1fb59b2d3de11f2b37240e7639c3abf"],
  ["candidate_consent_events","candidate_consent_events_event_id_subject_id_version_key","u",false,false,"7b007e773a45c9c1c8f7e17a01d4411a"],
  ["candidate_consent_events","candidate_consent_events_pkey","p",false,false,"1e909a41847e2371a95110af439aa15e"],
  ["candidate_consent_events","candidate_consent_events_purpose_check","c",false,false,"4adae87552136aa5b4ddd45e8453d0fb"],
  ["candidate_consent_events","candidate_consent_events_purpose_version_check","c",false,false,"10ae93a6dc0cdd5c761e3db41a0e4d25"],
  ["candidate_consent_events","candidate_consent_events_request_sha256_check","c",false,false,"eff6e2f4f45ba4b3a68bc0bdb9927a6a"],
  ["candidate_consent_events","candidate_consent_events_schema_version_check","c",false,false,"082bc7d916e4cd09f835790c2342c81f"],
  ["candidate_consent_events","candidate_consent_events_subject_id_fkey","f",false,false,"b15ad560926ccecaf048783b43786ea0"],
  ["candidate_consent_events","candidate_consent_events_subject_id_request_id_key","u",false,false,"fd97103a82fcd69ed39dd3bf7dfbdd2e"],
  ["candidate_consent_events","candidate_consent_events_subject_id_version_key","u",false,false,"dc2d43626f963ecc84abeb2e0ec2a998"],
  ["candidate_consent_events","candidate_consent_events_subject_id_version_source_id_fkey","f",false,false,"c529a58bfafd6b1da0056e1f52cb8221"],
  ["candidate_consent_events","candidate_consent_events_user_id_check","c",false,false,"deab23ccfed667268b2de831540f681c"],
  ["candidate_consent_events","candidate_consent_events_verified_email_sha256_check","c",false,false,"ea3c6d94c4b5b0dc27dbee795355d5c0"],
  ["candidate_consent_events","candidate_consent_events_version_check","c",false,false,"72175895b5c5708506e5936cb1053585"],
  ["candidate_consent_outbox","candidate_consent_outbox_attempts_check","c",false,false,"fb63483a0561e910c8e8791830629335"],
  ["candidate_consent_outbox","candidate_consent_outbox_check","c",false,false,"b776cca83b59f68c492e9c447f5927d0"],
  ["candidate_consent_outbox","candidate_consent_outbox_check1","c",false,false,"ea5a8a0142fbf9ab7291a984d58ba32d"],
  ["candidate_consent_outbox","candidate_consent_outbox_check2","c",false,false,"bbdb912352673dcdf32d39668d9b5ae4"],
  ["candidate_consent_outbox","candidate_consent_outbox_command_sha256_check","c",false,false,"961becf02fada29032a50ecc34e14725"],
  ["candidate_consent_outbox","candidate_consent_outbox_event_id_key","u",false,false,"395c8305f7fa80a9de2416420ea7990f"],
  ["candidate_consent_outbox","candidate_consent_outbox_event_id_subject_id_version_fkey","f",false,false,"230d8f33d59a649539d12fd134aae52b"],
  ["candidate_consent_outbox","candidate_consent_outbox_idempotency_key_check","c",false,false,"4e6f49a4abb058a5eb136e4de2214b3b"],
  ["candidate_consent_outbox","candidate_consent_outbox_idempotency_key_key","u",false,false,"1edb563e32a4bf1046f01b8e99e8e3bd"],
  ["candidate_consent_outbox","candidate_consent_outbox_last_error_code_check","c",false,false,"504358715158a60c6f8729be30fba8b9"],
  ["candidate_consent_outbox","candidate_consent_outbox_lease_owner_check","c",false,false,"1ced6e04a7006b50a2a75159c157d0bf"],
  ["candidate_consent_outbox","candidate_consent_outbox_pkey","p",false,false,"8ae9004449b05d3bd62928f442ce4dc5"],
  ["candidate_consent_outbox","candidate_consent_outbox_receipt_check","c",false,false,"a5efa75ae761d2527ed1dd53ea660068"],
  ["candidate_consent_outbox","candidate_consent_outbox_state_check","c",false,false,"b3542ec63a4fbf959eed9bd0d061749d"],
  ["candidate_consent_sources","candidate_consent_sources_pkey","p",false,false,"fa7c89ca3643d31a04934ae436c5f197"],
  ["candidate_consent_sources","candidate_consent_sources_profile_sha256_check","c",false,false,"b64ffeb0bec2311b0243eb3c3aaa38eb"],
  ["candidate_consent_sources","candidate_consent_sources_resume_sha256_check","c",false,false,"f0c8293196e6150ca589ceec72a10333"],
  ["candidate_consent_sources","candidate_consent_sources_resume_version_id_fkey","f",false,false,"b33848c1c8aeda107920df08b3c4d2bb"],
  ["candidate_consent_sources","candidate_consent_sources_source_version_check","c",false,false,"788b8c6e78d44e34af3f92e22f2ca164"],
  ["candidate_consent_sources","candidate_consent_sources_subject_id_fkey","f",false,false,"b15ad560926ccecaf048783b43786ea0"],
  ["candidate_consent_sources","candidate_consent_sources_subject_id_source_id_key","u",false,false,"8dbb5372a90f123a8af83f540d9e32ed"],
  ["candidate_consent_sources","candidate_consent_sources_subject_id_source_version_key","u",false,false,"921c5df39333c3fd43e858be919ec149"],
  ["candidate_consent_sources","candidate_consent_sources_subject_id_source_version_source__key","u",false,false,"1dd14cdadaaf2cc4e3c094a3880e98eb"],
  ["candidate_consent_sources","consent_source_profile_shape","c",false,false,"fd9b8acc0a140c608516508821cb2d45"],
  ["candidate_consent_sources","consent_source_resume_shape","c",false,false,"dc1ad3e0eb7cb5cc8c953df8af9f31ea"],
  ["candidate_consent_subjects","candidate_consent_subjects_acknowledged_action_check","c",false,false,"0f3c2be2d6c8ac8e3e46c32e7c7ffc00"],
  ["candidate_consent_subjects","candidate_consent_subjects_acknowledged_version_check","c",false,false,"89bbb4946b79e96103dc4c9d5005be6f"],
  ["candidate_consent_subjects","candidate_consent_subjects_check","c",false,false,"be26672eb1b1f4f08a2df51e3f854e8c"],
  ["candidate_consent_subjects","candidate_consent_subjects_check1","c",false,false,"122788deff4a98367b4e8f0550e2551f"],
  ["candidate_consent_subjects","candidate_consent_subjects_check2","c",false,false,"fae99db47146213e153c607cc4291de4"],
  ["candidate_consent_subjects","candidate_consent_subjects_delivery_status_check","c",false,false,"cf1382e775043342127a0548eb3c960f"],
  ["candidate_consent_subjects","candidate_consent_subjects_desired_action_check","c",false,false,"9dadf8691d165bb3aa3b76566f93306f"],
  ["candidate_consent_subjects","candidate_consent_subjects_last_error_code_check","c",false,false,"504358715158a60c6f8729be30fba8b9"],
  ["candidate_consent_subjects","candidate_consent_subjects_pkey","p",false,false,"ed6a3b6ca977ba2af4edc138d1371ce3"],
  ["candidate_consent_subjects","candidate_consent_subjects_user_id_check","c",false,false,"deab23ccfed667268b2de831540f681c"],
  ["candidate_consent_subjects","candidate_consent_subjects_user_id_key","u",false,false,"180ab7ada944bc4434863ec0e09cc727"],
  ["candidate_consent_subjects","candidate_consent_subjects_version_check","c",false,false,"18c08a9796bc8592d32a620e0fb75cfd"],
  ["candidate_consent_subjects","consent_current_source_fk","f",true,true,"322ca17b0b00df224caf54190c1d37c6"],
  ["candidate_consent_subjects","consent_effective_source_fk","f",true,true,"5836ca6f11a5e051a59afb1b04783d4b"]
] as const;

/** Shared read-only postconditions: migration reconciliation and actual runtime startup use identical SQL. */
export async function candidateConsentPrivilegesReady(pg: PgLike, role: string, required: boolean): Promise<boolean> {
  const presence = await pg.query(`SELECT
    (SELECT count(*)::int FROM unnest($1::text[]) n WHERE to_regclass('public.'||n) IS NOT NULL) AS tables,
    (SELECT count(*)::int FROM unnest($2::text[]) n WHERE to_regprocedure(n) IS NOT NULL) AS functions`,
  [[...CANDIDATE_CONSENT_TABLES], [...CANDIDATE_CONSENT_FUNCTIONS]]);
  const counts = presence.rows[0];
  if (!required && counts?.tables === 0 && counts?.functions === 0) return true;
  if (counts?.tables !== 4 || counts?.functions !== 4) return false;
  const result = await pg.query(`SELECT
    NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE ns.nspname='public' AND c.relname=ANY($2::text[]) AND NOT (
        has_table_privilege($1,c.oid,'INSERT') AND NOT has_table_privilege($1,c.oid,'UPDATE')
        AND NOT has_table_privilege($1,c.oid,'DELETE') AND NOT has_table_privilege($1,c.oid,'TRUNCATE')
        AND NOT has_table_privilege($1,c.oid,'REFERENCES') AND NOT has_table_privilege($1,c.oid,'TRIGGER')
        AND has_table_privilege($1,c.oid,'SELECT')=(c.relname<>'candidate_consent_outbox')
        AND NOT EXISTS(SELECT 1 FROM aclexplode(c.relacl) acl WHERE acl.grantee=0)
        AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
          AND (has_column_privilege($1,c.oid,a.attnum,'UPDATE') IS DISTINCT FROM
            (c.relname='candidate_consent_subjects' AND a.attname=ANY($4::text[]))
            OR has_column_privilege($1,c.oid,a.attnum,'SELECT') IS DISTINCT FROM
              (c.relname<>'candidate_consent_outbox')
            OR has_column_privilege($1,c.oid,a.attnum,'REFERENCES')))
      )
    ) AND NOT EXISTS (
      SELECT 1 FROM unnest($3::text[]) f(signature)
      JOIN pg_proc p ON p.oid=to_regprocedure(f.signature)
      WHERE NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
        OR NOT has_function_privilege($1,p.oid,'EXECUTE')
        OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN
            (p.proowner,(SELECT oid FROM pg_roles WHERE rolname=$1)))
    ) AND (
      SELECT count(*)=5 FROM (VALUES
        ('candidate_consent_sources','consent_sources_append_only','flow_reject_candidate_consent_mutation',27),
        ('candidate_consent_sources','consent_sources_truncate','flow_reject_candidate_consent_mutation',34),
        ('candidate_consent_events','consent_events_append_only','flow_reject_candidate_consent_mutation',27),
        ('candidate_consent_events','consent_events_truncate','flow_reject_candidate_consent_mutation',34),
        ('candidate_consent_subjects','consent_subject_binding','flow_reject_candidate_consent_rebind',19)
      ) required(relation,trigger_name,function_name,trigger_type)
      JOIN pg_trigger t ON t.tgrelid=to_regclass('public.'||required.relation) AND t.tgname=required.trigger_name
      JOIN pg_proc p ON p.oid=t.tgfoid AND p.proname=required.function_name
      WHERE NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=required.trigger_type
    ) AND (
      SELECT count(*)=58 FROM jsonb_array_elements($5::jsonb) expected(value)
      JOIN pg_constraint c ON c.conrelid=to_regclass('public.'||(value->>0)) AND c.conname=value->>1
      WHERE c.contype::text=value->>2 AND c.convalidated
        AND c.condeferrable=(value->>3)::boolean AND c.condeferred=(value->>4)::boolean
        AND md5(pg_get_constraintdef(c.oid))=value->>5
    ) AS ok`, [role, [...CANDIDATE_CONSENT_TABLES], [...CANDIDATE_CONSENT_FUNCTIONS], [...CANDIDATE_CONSENT_UPDATE_COLUMNS],
      JSON.stringify(CANDIDATE_CONSENT_CONSTRAINTS)]);
  return result.rows[0]?.ok === true;
}

/** Minimum catalog facts every Flow web/worker process requires to start. */
export const FLOW_CRITICAL_POSTCONDITIONS: NonNullable<
  ReadinessInput["criticalPostconditions"]
> = [
  {
    name: "Candidate index catalog, insert-only intent and five fenced routines are exact",
    async check(pg) {
      const who = await pg.query("SELECT current_user AS role");
      return candidateIndexPrivilegesReady(pg, who.rows[0]?.role, true);
    },
  },
  {
    name: "Candidate consent tables, column privileges and four routines are exact",
    async check(pg) {
      const who = await pg.query("SELECT current_user AS role");
      return candidateConsentPrivilegesReady(pg, who.rows[0]?.role, true);
    },
  },
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
    name: "Decision-projection delivery functions and runtime boundary are exact",
    async check(pg) {
      const result = await pg.query(`
        SELECT
          to_regclass('public.decision_projection_delivery_state') IS NOT NULL
          AND (
            SELECT COUNT(*)=3
              FROM unnest(ARRAY[
                'public.claim_decision_projection_delivery(integer,integer)',
                'public.ack_decision_projection_delivery(uuid,uuid,bigint,bigint,text)',
                'public.fail_decision_projection_delivery(uuid,uuid,bigint,text,boolean,integer)'
              ]::text[]) AS expected(signature)
             WHERE to_regprocedure(expected.signature) IS NOT NULL
          )
          AND NOT has_table_privilege(current_user,'public.decision_projection_delivery_state','SELECT')
          AND NOT has_table_privilege(current_user,'public.decision_projection_delivery_state','INSERT')
          AND NOT has_table_privilege(current_user,'public.decision_projection_delivery_state','UPDATE')
          AND NOT has_table_privilege(current_user,'public.decision_projection_delivery_state','DELETE')
          AND NOT has_table_privilege(current_user,'public.decision_projection_delivery_state','TRUNCATE')
          AND has_function_privilege(current_user,'public.claim_decision_projection_delivery(integer,integer)','EXECUTE')
          AND has_function_privilege(current_user,'public.ack_decision_projection_delivery(uuid,uuid,bigint,bigint,text)','EXECUTE')
          AND has_function_privilege(current_user,'public.fail_decision_projection_delivery(uuid,uuid,bigint,text,boolean,integer)','EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public'
               AND p.proname IN (
                 'claim_decision_projection_delivery',
                 'ack_decision_projection_delivery',
                 'fail_decision_projection_delivery'
               )
               AND (
                 NOT p.prosecdef
                 OR p.proconfig <> ARRAY['search_path=pg_catalog, public']::text[]
                 OR pg_has_role(current_user, pg_get_userbyid(p.proowner), 'MEMBER')
               )
          ) AS ok
      `);
      return result.rows[0]?.ok === true;
    },
  },
  {
    name: "Organization-candidate evidence and delivery authority are exact",
    async check(pg) {
      const result = await pg.query(`
        SELECT
          to_regclass('public.organization_candidate_references') IS NOT NULL
          AND to_regclass('public.application_resume_versions') IS NOT NULL
          AND to_regclass('public.organization_candidate_memory_outbox') IS NOT NULL
          AND (
            SELECT COUNT(*)=3 FROM unnest(ARRAY[
              'public.claim_organization_candidate_memory_intents(text,integer,integer)',
              'public.ack_organization_candidate_memory_intent(uuid,integer,uuid)',
              'public.fail_organization_candidate_memory_intent(uuid,integer,text,timestamp with time zone)'
            ]::text[]) AS expected(signature)
            WHERE to_regprocedure(expected.signature) IS NOT NULL
          )
          AND (
            SELECT COUNT(*)=4 FROM pg_trigger t
             WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
               AND (
                 (t.tgrelid='public.organization_candidate_references'::regclass
                   AND t.tgname IN ('organization_candidate_references_append_only',
                     'organization_candidate_references_truncate_append_only'))
                 OR (t.tgrelid='public.application_resume_versions'::regclass
                   AND t.tgname IN ('application_resume_versions_append_only',
                     'application_resume_versions_truncate_append_only'))
               )
          )
          AND has_table_privilege(current_user,'public.organization_candidate_references','SELECT')
          AND has_table_privilege(current_user,'public.organization_candidate_references','INSERT')
          AND NOT has_table_privilege(current_user,'public.organization_candidate_references','UPDATE')
          AND has_table_privilege(current_user,'public.application_resume_versions','SELECT')
          AND has_table_privilege(current_user,'public.application_resume_versions','INSERT')
          AND NOT has_table_privilege(current_user,'public.application_resume_versions','UPDATE')
          AND NOT has_table_privilege(current_user,'public.organization_candidate_memory_outbox','SELECT')
          AND has_table_privilege(current_user,'public.organization_candidate_memory_outbox','INSERT')
          AND NOT has_table_privilege(current_user,'public.organization_candidate_memory_outbox','UPDATE')
          AND has_function_privilege(current_user,
            'public.claim_organization_candidate_memory_intents(text,integer,integer)','EXECUTE')
          AND has_function_privilege(current_user,
            'public.ack_organization_candidate_memory_intent(uuid,integer,uuid)','EXECUTE')
          AND has_function_privilege(current_user,
            'public.fail_organization_candidate_memory_intent(uuid,integer,text,timestamp with time zone)','EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public'
               AND p.proname IN (
                 'claim_organization_candidate_memory_intents',
                 'ack_organization_candidate_memory_intent',
                 'fail_organization_candidate_memory_intent'
               )
               AND (
                 NOT p.prosecdef
                 OR p.proconfig <> ARRAY['search_path=pg_catalog, public']::text[]
                 OR pg_has_role(current_user, pg_get_userbyid(p.proowner), 'MEMBER')
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
                   c.relname = 'decision_projection_delivery_state'
                   AND NOT has_table_privilege(current_user, c.oid, 'SELECT')
                   AND NOT has_table_privilege(current_user, c.oid, 'INSERT')
                   AND NOT has_table_privilege(current_user, c.oid, 'UPDATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'DELETE')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'REFERENCES')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRIGGER')
                 )
                 OR
                 (
                   c.relname IN ('organization_candidate_references','application_resume_versions')
                   AND has_table_privilege(current_user, c.oid, 'SELECT')
                   AND has_table_privilege(current_user, c.oid, 'INSERT')
                   AND NOT has_table_privilege(current_user, c.oid, 'UPDATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'DELETE')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'REFERENCES')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRIGGER')
                 )
                 OR
                 (
                   c.relname='organization_candidate_memory_outbox'
                   AND NOT has_table_privilege(current_user, c.oid, 'SELECT')
                   AND has_table_privilege(current_user, c.oid, 'INSERT')
                   AND NOT has_table_privilege(current_user, c.oid, 'UPDATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'DELETE')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'REFERENCES')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRIGGER')
                 )
                 OR
                 (
                   c.relname NOT IN (
                     'decision_events','decision_projection_outbox','decision_projection_delivery_state',
                     'organization_candidate_references','application_resume_versions',
                     'organization_candidate_memory_outbox','candidate_consent_subjects','candidate_consent_sources',
                     'candidate_consent_events','candidate_consent_outbox',
                     'candidate_index_outbox','candidate_index_delivery_state'
                   )
                   AND has_table_privilege(current_user, c.oid, 'SELECT')
                   AND has_table_privilege(current_user, c.oid, 'INSERT')
                   AND has_table_privilege(current_user, c.oid, 'UPDATE')
                   AND has_table_privilege(current_user, c.oid, 'DELETE')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE')
                   AND NOT has_table_privilege(current_user, c.oid, 'REFERENCES')
                   AND NOT has_table_privilege(current_user, c.oid, 'TRIGGER')
                 )
                 OR c.relname IN ('candidate_consent_subjects','candidate_consent_sources',
                   'candidate_consent_events','candidate_consent_outbox',
                   'candidate_index_outbox','candidate_index_delivery_state')
                 -- Exact consent table/column privileges are a separate mandatory postcondition above.
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
                 OR (p.proname<>'flow_candidate_index_evidence_guard'
                   AND NOT has_function_privilege(current_user, p.oid, 'EXECUTE'))
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
