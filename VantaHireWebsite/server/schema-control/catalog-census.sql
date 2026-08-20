\set ON_ERROR_STOP on
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\pset pager off
\pset footer off

-- Candidate Privacy Gate 1A0-P / Flow-only catalog preflight.
--
-- SAFETY CONTRACT:
--   * catalog metadata only; no business-row reads;
--   * one repeatable-read, READ ONLY transaction;
--   * bounded statement/lock/idle time;
--   * deterministic NDJSON output with no database/user/host/credential value;
--   * always ROLLBACK.
--
-- The executor must pass the independently confirmed deployed source SHA via
-- psql `-v expected_source_sha=...` or FLOW_EXPECTED_SOURCE_SHA in the child
-- environment (needed by `railway connect`, which owns the psql invocation).
-- The exact secret-safe command/target evidence is approval-gated by the lock.

\if :{?expected_source_sha}
\else
  \getenv expected_source_sha FLOW_EXPECTED_SOURCE_SHA
\endif

SELECT :'expected_source_sha' ~ '^[0-9a-f]{40}$' AS source_sha_valid \gset
\if :source_sha_valid
\else
  \echo '1A0-P refused: expected_source_sha must be 40 lowercase hex characters'
  -- ON_ERROR_STOP turns this deliberate, side-effect-free error into psql exit 3.
  -- Do not use `\quit <code>`: supported psql versions ignore that argument.
  SELECT 1 / 0 AS forced_nonzero_exit;
\endif

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

SELECT current_setting('transaction_read_only')::boolean AS transaction_is_read_only \gset
\if :transaction_is_read_only
\else
  \echo '1A0-P refused: database did not enter a read-only transaction'
  ROLLBACK;
  SELECT 1 / 0 AS forced_nonzero_exit;
\endif

-- Positive Flow-target marker without reading any application row.
SELECT bool_and(to_regclass(required_relation) IS NOT NULL) AS flow_core_present
  FROM unnest(ARRAY[
    'public.users',
    'public.organizations',
    'public.organization_members',
    'public.jobs',
    'public.applications',
    'public.pipeline_stages',
    'public.candidate_resumes'
  ]::text[]) AS required_relation
\gset
\if :flow_core_present
\else
  \echo '1A0-P refused: target does not expose the required Flow core catalog marker'
  ROLLBACK;
  SELECT 1 / 0 AS forced_nonzero_exit;
\endif

SELECT jsonb_build_object(
  'record_type', 'preflight_meta',
  'key', 'format/1',
  'payload', jsonb_build_object(
    'format_version', 1,
    'expected_source_sha', :'expected_source_sha',
    'server_version_num', current_setting('server_version_num'),
    'transaction_read_only', current_setting('transaction_read_only'),
    'scope', 'flow-user-catalog-without-schema_control'
  )
)::text;

-- Schemas. schema_control is excluded because adoption creates it separately.
SELECT jsonb_build_object(
  'record_type', 'schema',
  'key', n.nspname,
  'payload', jsonb_build_object(
    'name', n.nspname,
    'owner', pg_catalog.pg_get_userbyid(n.nspowner),
    'acl', COALESCE((
      SELECT jsonb_agg(a::text ORDER BY a::text)
        FROM unnest(n.nspacl) AS a
    ), '[]'::jsonb),
    'comment', pg_catalog.obj_description(n.oid, 'pg_namespace')
  )
)::text
  FROM pg_catalog.pg_namespace AS n
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname;

-- Installed extensions; extension-owned objects are separately marked below.
SELECT jsonb_build_object(
  'record_type', 'extension',
  'key', e.extname,
  'payload', jsonb_build_object(
    'name', e.extname,
    'version', e.extversion,
    'schema', n.nspname,
    'relocatable', e.extrelocatable
  )
)::text
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
 ORDER BY e.extname;

-- User-defined enum/domain/range/multirange/standalone-composite types.
SELECT jsonb_build_object(
  'record_type', 'type',
  'key', pg_catalog.format('%I.%I', n.nspname, t.typname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'name', t.typname,
    'kind', t.typtype,
    'category', t.typcategory,
    'not_null', t.typnotnull,
    'base_type', CASE WHEN t.typbasetype = 0 THEN NULL ELSE pg_catalog.format_type(t.typbasetype, t.typtypmod) END,
    'default', t.typdefault,
    'collation', CASE WHEN t.typcollation = 0 THEN NULL ELSE c.collname END,
    'owner', pg_catalog.pg_get_userbyid(t.typowner),
    'acl', COALESCE((
      SELECT jsonb_agg(a::text ORDER BY a::text)
        FROM unnest(t.typacl) AS a
    ), '[]'::jsonb),
    'enum_labels', COALESCE((
      SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_catalog.pg_enum AS e
       WHERE e.enumtypid = t.oid
    ), '[]'::jsonb),
    'extension_owner', (
      SELECT x.extname
        FROM pg_catalog.pg_depend AS d
        JOIN pg_catalog.pg_extension AS x ON x.oid = d.refobjid
       WHERE d.classid = 'pg_catalog.pg_type'::regclass
         AND d.objid = t.oid
         AND d.deptype = 'e'
       LIMIT 1
    ),
    'comment', pg_catalog.obj_description(t.oid, 'pg_type')
  )
)::text
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_collation AS c ON c.oid = t.typcollation
  LEFT JOIN pg_catalog.pg_class AS composite_relation ON composite_relation.oid = t.typrelid
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
   AND t.typisdefined
   AND (
     t.typtype IN ('e', 'd', 'r', 'm')
     OR (t.typtype = 'c' AND composite_relation.relkind = 'c')
   )
 ORDER BY n.nspname, t.typname;

-- Domain constraints have conrelid=0 and are therefore distinct from table
-- constraints below.
SELECT jsonb_build_object(
  'record_type', 'domain_constraint',
  'key', pg_catalog.format('%I.%I/%I', n.nspname, t.typname, c.conname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'domain', t.typname,
    'name', c.conname,
    'definition', pg_catalog.pg_get_constraintdef(c.oid, true),
    'deferrable', c.condeferrable,
    'initially_deferred', c.condeferred,
    'validated', c.convalidated
  )
)::text
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_type AS t ON t.oid = c.contypid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
 WHERE c.contypid <> 0
   AND n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname, t.typname, c.conname;

-- Relations and their security/ownership/option contract.
SELECT jsonb_build_object(
  'record_type', 'relation',
  'key', pg_catalog.format('%I.%I', n.nspname, r.relname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'name', r.relname,
    'kind', r.relkind,
    'persistence', r.relpersistence,
    'owner', pg_catalog.pg_get_userbyid(r.relowner),
    'tablespace', ts.spcname,
    'row_security', r.relrowsecurity,
    'force_row_security', r.relforcerowsecurity,
    'replica_identity', r.relreplident,
    'partition_bound', CASE WHEN r.relispartition THEN pg_catalog.pg_get_expr(r.relpartbound, r.oid, true) ELSE NULL END,
    'options', COALESCE((SELECT jsonb_agg(o ORDER BY o) FROM unnest(r.reloptions) AS o), '[]'::jsonb),
    'acl', COALESCE((SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(r.relacl) AS a), '[]'::jsonb),
    'extension_owner', (
      SELECT x.extname
        FROM pg_catalog.pg_depend AS d
        JOIN pg_catalog.pg_extension AS x ON x.oid = d.refobjid
       WHERE d.classid = 'pg_catalog.pg_class'::regclass
         AND d.objid = r.oid
         AND d.deptype = 'e'
       LIMIT 1
    ),
    'comment', pg_catalog.obj_description(r.oid, 'pg_class')
  )
)::text
  FROM pg_catalog.pg_class AS r
  JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
  LEFT JOIN pg_catalog.pg_tablespace AS ts ON ts.oid = r.reltablespace
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
   AND r.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
 ORDER BY n.nspname, r.relname;

-- Columns, defaults, generated/identity semantics and column grants.
SELECT jsonb_build_object(
  'record_type', 'column',
  'key', pg_catalog.format('%I.%I/%s/%I', n.nspname, r.relname, a.attnum, a.attname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'relation', r.relname,
    'ordinal', a.attnum,
    'name', a.attname,
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'not_null', a.attnotnull,
    'identity', a.attidentity,
    'generated', a.attgenerated,
    'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true),
    'collation', CASE WHEN a.attcollation = 0 THEN NULL ELSE coll.collname END,
    'storage', a.attstorage,
    'compression', a.attcompression,
    'statistics_target', a.attstattarget,
    'options', COALESCE((SELECT jsonb_agg(o ORDER BY o) FROM unnest(a.attoptions) AS o), '[]'::jsonb),
    'acl', COALESCE((SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(a.attacl) AS x), '[]'::jsonb),
    'comment', pg_catalog.col_description(r.oid, a.attnum)
  )
)::text
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS r ON r.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS ad ON ad.adrelid = r.oid AND ad.adnum = a.attnum
  LEFT JOIN pg_catalog.pg_collation AS coll ON coll.oid = a.attcollation
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
   AND r.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
   AND a.attnum > 0
   AND NOT a.attisdropped
 ORDER BY n.nspname, r.relname, a.attnum;

-- Constraints, including exact CHECK/FK/UNIQUE definitions and validation.
SELECT jsonb_build_object(
  'record_type', 'constraint',
  'key', pg_catalog.format('%I.%I/%I', n.nspname, r.relname, c.conname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'relation', r.relname,
    'name', c.conname,
    'type', c.contype,
    'definition', pg_catalog.pg_get_constraintdef(c.oid, true),
    'deferrable', c.condeferrable,
    'initially_deferred', c.condeferred,
    'validated', c.convalidated,
    'no_inherit', c.connoinherit
  )
)::text
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname, r.relname, c.conname;

-- Index definitions and readiness/validity flags.
SELECT jsonb_build_object(
  'record_type', 'index',
  'key', pg_catalog.format('%I.%I', ni.nspname, i.relname),
  'payload', jsonb_build_object(
    'schema', nt.nspname,
    'relation', t.relname,
    'index_schema', ni.nspname,
    'name', i.relname,
    'definition', pg_catalog.pg_get_indexdef(i.oid, 0, true),
    'predicate', pg_catalog.pg_get_expr(ix.indpred, ix.indrelid, true),
    'unique', ix.indisunique,
    'primary', ix.indisprimary,
    'exclusion', ix.indisexclusion,
    'immediate', ix.indimmediate,
    'clustered', ix.indisclustered,
    'replica_identity', ix.indisreplident,
    'valid', ix.indisvalid,
    'ready', ix.indisready,
    'live', ix.indislive
  )
)::text
  FROM pg_catalog.pg_index AS ix
  JOIN pg_catalog.pg_class AS i ON i.oid = ix.indexrelid
  JOIN pg_catalog.pg_namespace AS ni ON ni.oid = i.relnamespace
  JOIN pg_catalog.pg_class AS t ON t.oid = ix.indrelid
  JOIN pg_catalog.pg_namespace AS nt ON nt.oid = t.relnamespace
 WHERE nt.nspname <> 'information_schema'
   AND nt.nspname <> 'schema_control'
   AND nt.nspname !~ '^pg_'
 ORDER BY ni.nspname, i.relname;

-- Sequences and their ownership dependency.
SELECT jsonb_build_object(
  'record_type', 'sequence',
  'key', pg_catalog.format('%I.%I', n.nspname, r.relname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'name', r.relname,
    'data_type', pg_catalog.format_type(s.seqtypid, NULL),
    -- pg_sequence uses bigint. Emit text so the dependency-free Node
    -- normalizer cannot round values beyond Number.MAX_SAFE_INTEGER.
    'start', s.seqstart::text,
    'increment', s.seqincrement::text,
    'minimum', s.seqmin::text,
    'maximum', s.seqmax::text,
    'cache', s.seqcache::text,
    'cycle', s.seqcycle,
    'owned_by', owned.owned_by
  )
)::text
  FROM pg_catalog.pg_class AS r
  JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
  JOIN pg_catalog.pg_sequence AS s ON s.seqrelid = r.oid
  LEFT JOIN LATERAL (
    SELECT pg_catalog.format('%I.%I.%I', tn.nspname, tr.relname, a.attname) AS owned_by
      FROM pg_catalog.pg_depend AS d
      JOIN pg_catalog.pg_class AS tr ON tr.oid = d.refobjid
      JOIN pg_catalog.pg_namespace AS tn ON tn.oid = tr.relnamespace
      JOIN pg_catalog.pg_attribute AS a ON a.attrelid = tr.oid AND a.attnum = d.refobjsubid
     WHERE d.classid = 'pg_catalog.pg_class'::regclass
       AND d.objid = r.oid
       AND d.deptype IN ('a', 'i')
     ORDER BY d.deptype
     LIMIT 1
  ) AS owned ON true
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname, r.relname;

-- Views/materialized views, including the exact query definition.
SELECT jsonb_build_object(
  'record_type', 'view',
  'key', pg_catalog.format('%I.%I', n.nspname, r.relname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'name', r.relname,
    'kind', r.relkind,
    'definition', pg_catalog.pg_get_viewdef(r.oid, true),
    'populated', r.relispopulated,
    'options', COALESCE((SELECT jsonb_agg(o ORDER BY o) FROM unnest(r.reloptions) AS o), '[]'::jsonb)
  )
)::text
  FROM pg_catalog.pg_class AS r
  JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
   AND r.relkind IN ('v', 'm')
 ORDER BY n.nspname, r.relname;

-- Table inheritance and partition topology.
SELECT jsonb_build_object(
  'record_type', 'inheritance',
  'key', pg_catalog.format('%I.%I->%I.%I', cn.nspname, child.relname, pn.nspname, parent.relname),
  'payload', jsonb_build_object(
    'child_schema', cn.nspname,
    'child', child.relname,
    'parent_schema', pn.nspname,
    'parent', parent.relname,
    'sequence', inh.inhseqno,
    'partition_bound', CASE WHEN child.relispartition THEN pg_catalog.pg_get_expr(child.relpartbound, child.oid, true) ELSE NULL END
  )
)::text
  FROM pg_catalog.pg_inherits AS inh
  JOIN pg_catalog.pg_class AS child ON child.oid = inh.inhrelid
  JOIN pg_catalog.pg_namespace AS cn ON cn.oid = child.relnamespace
  JOIN pg_catalog.pg_class AS parent ON parent.oid = inh.inhparent
  JOIN pg_catalog.pg_namespace AS pn ON pn.oid = parent.relnamespace
 WHERE cn.nspname <> 'schema_control'
   AND cn.nspname !~ '^pg_'
 ORDER BY cn.nspname, child.relname, inh.inhseqno;

-- User-schema routines. Extension-owned routines remain marked, not mistaken
-- for application-authored baseline statements.
SELECT jsonb_build_object(
  'record_type', 'routine',
  'key', pg_catalog.format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'name', p.proname,
    'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
    'kind', p.prokind,
    'language', l.lanname,
    'result', pg_catalog.pg_get_function_result(p.oid),
    'definition', CASE WHEN p.prokind IN ('f', 'p', 'w') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END,
    'volatility', p.provolatile,
    'strict', p.proisstrict,
    'security_definer', p.prosecdef,
    'leakproof', p.proleakproof,
    'parallel', p.proparallel,
    'cost', p.procost,
    'rows', p.prorows,
    'configuration', COALESCE((SELECT jsonb_agg(c ORDER BY c) FROM unnest(p.proconfig) AS c), '[]'::jsonb),
    'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'acl', COALESCE((SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) AS a), '[]'::jsonb),
    'extension_owner', (
      SELECT x.extname
        FROM pg_catalog.pg_depend AS d
        JOIN pg_catalog.pg_extension AS x ON x.oid = d.refobjid
       WHERE d.classid = 'pg_catalog.pg_proc'::regclass
         AND d.objid = p.oid
         AND d.deptype = 'e'
       LIMIT 1
    ),
    'comment', pg_catalog.obj_description(p.oid, 'pg_proc')
  )
)::text
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- Triggers: definition + enabled mode. Internal FK/constraint triggers are
-- retained as marked evidence, not replayed directly by the baseline builder.
SELECT jsonb_build_object(
  'record_type', 'trigger',
  'key', pg_catalog.format('%I.%I/%I', n.nspname, r.relname, t.tgname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'relation', r.relname,
    'name', t.tgname,
    'definition', pg_catalog.pg_get_triggerdef(t.oid, true),
    'enabled', t.tgenabled,
    'internal', t.tgisinternal,
    'constraint_name', trigger_constraint.conname
  )
)::text
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS r ON r.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
  LEFT JOIN pg_catalog.pg_constraint AS trigger_constraint ON trigger_constraint.oid = t.tgconstraint
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname, r.relname, t.tgname;

-- Row-level security policies.
SELECT jsonb_build_object(
  'record_type', 'policy',
  'key', pg_catalog.format('%I.%I/%I', n.nspname, r.relname, p.polname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'relation', r.relname,
    'name', p.polname,
    'permissive', p.polpermissive,
    'command', p.polcmd,
    'roles', COALESCE((
      SELECT jsonb_agg(CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid) END ORDER BY role_oid)
        FROM unnest(p.polroles) AS role_oid
    ), '[]'::jsonb),
    'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid, true),
    'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true)
  )
)::text
  FROM pg_catalog.pg_policy AS p
  JOIN pg_catalog.pg_class AS r ON r.oid = p.polrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname, r.relname, p.polname;

-- Extended statistics definitions.
SELECT jsonb_build_object(
  'record_type', 'statistics',
  'key', pg_catalog.format('%I.%I', n.nspname, s.stxname),
  'payload', jsonb_build_object(
    'schema', n.nspname,
    'name', s.stxname,
    'definition', pg_catalog.pg_get_statisticsobjdef(s.oid),
    'owner', pg_catalog.pg_get_userbyid(s.stxowner)
  )
)::text
  FROM pg_catalog.pg_statistic_ext AS s
  JOIN pg_catalog.pg_namespace AS n ON n.oid = s.stxnamespace
 WHERE n.nspname <> 'information_schema'
   AND n.nspname <> 'schema_control'
   AND n.nspname !~ '^pg_'
 ORDER BY n.nspname, s.stxname;

-- Default ACLs affect newly-created objects and are part of the authority
-- boundary even when current object ACLs happen to look correct.
SELECT jsonb_build_object(
  'record_type', 'default_acl',
  'key', pg_catalog.format('%s/%s/%s', pg_catalog.pg_get_userbyid(d.defaclrole), COALESCE(n.nspname, '*'), d.defaclobjtype),
  'payload', jsonb_build_object(
    'role', pg_catalog.pg_get_userbyid(d.defaclrole),
    'schema', n.nspname,
    'object_type', d.defaclobjtype,
    'acl', COALESCE((SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(d.defaclacl) AS a), '[]'::jsonb)
  )
)::text
  FROM pg_catalog.pg_default_acl AS d
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
 WHERE n.nspname IS NULL
    OR (n.nspname <> 'schema_control' AND n.nspname !~ '^pg_')
 ORDER BY pg_catalog.pg_get_userbyid(d.defaclrole), n.nspname NULLS FIRST, d.defaclobjtype;

-- Current database privileges, without emitting the database name.
SELECT jsonb_build_object(
  'record_type', 'database_acl',
  'key', 'current_database',
  'payload', jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(d.datdba),
    'allow_connections', d.datallowconn,
    'connection_limit', d.datconnlimit,
    'acl', COALESCE((SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(d.datacl) AS a), '[]'::jsonb)
  )
)::text
  FROM pg_catalog.pg_database AS d
 WHERE d.datname = current_database();

SELECT jsonb_build_object(
  'record_type', 'preflight_end',
  'key', 'complete',
  'payload', jsonb_build_object(
    'complete', true,
    'transaction_read_only', current_setting('transaction_read_only')
  )
)::text;

ROLLBACK;
