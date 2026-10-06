import type {PgLike} from '../schema-control/ledger';

export const SOURCING_TABLES=[
  'sourcing_org_state','sourcing_entitlements','sourcing_seat_slots','sourcing_seat_events','sourcing_allowance_windows',
  'sourcing_query_artifacts','sourcing_digest_requests','sourcing_admissions','sourcing_account_events','sourcing_dispatch_outbox',
  'sourcing_execution_grants','sourcing_deliveries','sourcing_delivery_items','sourcing_decision_events','sourcing_count_previews',
] as const;
export const SOURCING_FUNCTIONS=[
  'flow_sourcing_org_state(integer,boolean)','flow_sourcing_quote(integer,integer,integer)',
  'flow_sourcing_admit(integer,integer,integer,uuid,jsonb)','flow_sourcing_digest_claim(integer,integer,integer,uuid,jsonb)',
  'flow_sourcing_digest_next(uuid)','flow_sourcing_digest_finish(uuid,uuid,jsonb)',
  'flow_sourcing_artifact_put(integer,integer,integer,uuid,jsonb)','flow_sourcing_decide(integer,integer,integer,integer,uuid,jsonb)',
  'flow_sourcing_dispatch_claim(uuid)','flow_sourcing_dispatch_finish(uuid,uuid,jsonb)',
  'flow_sourcing_grant_context(text,uuid)','flow_sourcing_run_binding(integer,integer,text)',
  'flow_sourcing_grant(integer,uuid,jsonb)','flow_sourcing_receipt(integer,uuid,jsonb)','flow_sourcing_cancel(integer,uuid,jsonb)',
  'flow_sourcing_deliver(integer,uuid,jsonb)','flow_sourcing_preview_request(integer,integer,integer,uuid,jsonb)',
  'flow_sourcing_preview_claim(uuid)','flow_sourcing_preview_finish(uuid,uuid,jsonb)',
] as const;
export const SOURCING_PRIVATE_FUNCTIONS=[
  'flow_sourcing_immutable()','flow_sourcing_seat_sync()','flow_sourcing_reconcile(integer)','flow_sourcing_enable(integer,uuid)',
  'flow_sourcing_window(timestamp with time zone,timestamp with time zone)','flow_sourcing_canonical(jsonb)',
] as const;
export const SOURCING_PRIVATE_NAMES=SOURCING_PRIVATE_FUNCTIONS.map(s=>s.slice(0,s.indexOf('(')));
// Reproduced from the final disposable catalog before the build can pass readiness.
export const SOURCING_CATALOG_SHA256='d6d89d2585d31d51191b5e2c5c88f3f03e6325fb679d251ea0537b6c875ace4e';
export const SOURCING_CATALOG_SQL=`WITH relations AS (
 SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname LIKE 'sourcing_%' AND c.relkind IN ('r','p')
), functions AS (
 SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'flow_sourcing_%'
), facts AS (SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_array(relname,relrowsecurity,relforcerowsecurity,relowner=(SELECT relowner FROM pg_class WHERE oid='public.jobs'::regclass)) ORDER BY relname COLLATE "C") FROM relations),
 'columns',(SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname COLLATE "C",a.attnum)
 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND (c.oid IN(SELECT oid FROM relations) OR
 (c.oid='public.jobs'::regclass AND a.attname='jd_digest_source_hash') OR
 (c.oid='public.job_sourcing_runs'::regclass AND a.attname='sourcing_admission_id') OR
 (c.oid='public.job_sourced_candidates'::regclass AND a.attname='decision_revision'))),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(c.conname,pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable,c.condeferred) ORDER BY c.conname COLLATE "C")
 FROM pg_constraint c WHERE c.conrelid IN(SELECT oid FROM relations) OR c.conname LIKE 'src_%'),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY i.indexrelid::regclass::text COLLATE "C")
 FROM pg_index i WHERE i.indrelid IN(SELECT oid FROM relations) OR i.indexrelid::regclass::text LIKE 'src_%' OR i.indexrelid=to_regclass('public.job_sourced_candidates_id_org_job_idx')),
 'policies',(SELECT jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles=ARRAY[c.relowner],pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY c.relname COLLATE "C",p.polname COLLATE "C")
 FROM pg_policy p JOIN relations c ON c.oid=p.polrelid),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgrelid::regclass::text COLLATE "C",t.tgname COLLATE "C")
 FROM pg_trigger t WHERE NOT t.tgisinternal AND (t.tgrelid IN(SELECT oid FROM relations) OR t.tgfoid IN(SELECT oid FROM functions))),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner=(SELECT relowner FROM pg_class WHERE oid='public.jobs'::regclass)) ORDER BY p.oid::regprocedure::text COLLATE "C") FROM functions p)
 ) value) SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex') digest FROM facts`;

export async function sourcingPrivilegesReady(pg:PgLike,role:string,required:boolean):Promise<boolean> {
  const presence=(await pg.query(`SELECT
    (SELECT count(*)::integer FROM unnest($1::text[]) n WHERE to_regclass('public.'||n) IS NOT NULL) tables,
    (SELECT count(*)::integer FROM unnest($2::text[]) n WHERE to_regprocedure(n) IS NOT NULL) functions`,
    [[...SOURCING_TABLES],[...SOURCING_FUNCTIONS,...SOURCING_PRIVATE_FUNCTIONS]])).rows[0];
  if(!presence)return false;
  if(presence.tables===0&&presence.functions===0)return !required;
  if(presence.tables!==SOURCING_TABLES.length || presence.functions!==SOURCING_FUNCTIONS.length+SOURCING_PRIVATE_FUNCTIONS.length)return false;
  if((await pg.query(SOURCING_CATALOG_SQL)).rows[0]?.digest!==SOURCING_CATALOG_SHA256)return false;
  const result=await pg.query(`SELECT
    NOT EXISTS(SELECT 1 FROM unnest($2::text[]) n CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE has_table_privilege($1,'public.'||n,privilege))
    AND NOT EXISTS(SELECT 1 FROM unnest($2::text[]) n CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) privilege WHERE has_any_column_privilege($1,'public.'||n,privilege))
    AND NOT EXISTS(SELECT 1 FROM unnest($3::text[]) n WHERE NOT has_function_privilege($1,n,'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM unnest($4::text[]) n WHERE has_function_privilege($1,n,'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM unnest($3::text[]||$4::text[]) n JOIN pg_proc p ON p.oid=to_regprocedure(n)
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 OR (a.grantee<>p.proowner AND a.is_grantable)) AS ok`,
    [role,[...SOURCING_TABLES],[...SOURCING_FUNCTIONS],[...SOURCING_PRIVATE_FUNCTIONS]]);
  return result.rows[0]?.ok===true;
}
