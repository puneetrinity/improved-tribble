import {hash,fail} from './contracts.mjs';

// Exact contract of the three tables we write and the owner function we call.
// Queue tables are read-only: pin the columns used, not unrelated profile data.
export const CATALOG_SHA256='1d530d7275b3bb75a28735e183c36a29fa006da91f47fac503e8ee0701aace22';
export const FIXTURE_SHA256='0daae792466a58c3dbb33f06a23a47add7a931d9908585694639b6159000c85a';
export const CATALOG_SQL=`
WITH targets AS (
 SELECT c.oid,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('governed_sourcing_tenants','rc_rate_policies','rc_org_policies')
), entries AS (
 SELECT 'table' kind,t.relname name,jsonb_build_array(t.relkind,t.relrowsecurity,t.relforcerowsecurity) value FROM targets t
 UNION ALL
 SELECT 'column',t.relname||'.'||a.attname,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))
 FROM targets t JOIN pg_attribute a ON a.attrelid=t.oid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint',t.relname||'.'||c.conname,to_jsonb(pg_get_constraintdef(c.oid)) FROM targets t JOIN pg_constraint c ON c.conrelid=t.oid
 UNION ALL
 SELECT 'index',t.relname||'.'||c.relname,to_jsonb(pg_get_indexdef(i.indexrelid)) FROM targets t JOIN pg_index i ON i.indrelid=t.oid JOIN pg_class c ON c.oid=i.indexrelid
 UNION ALL
 SELECT 'trigger',t.relname||'.'||g.tgname,jsonb_build_array(pg_get_triggerdef(g.oid),g.tgenabled,pg_get_functiondef(g.tgfoid)) FROM targets t JOIN pg_trigger g ON g.tgrelid=t.oid WHERE NOT g.tgisinternal
 UNION ALL
 SELECT 'rule',t.relname||'.'||r.rulename,to_jsonb(pg_get_ruledef(r.oid)) FROM targets t JOIN pg_rewrite r ON r.ev_class=t.oid
 UNION ALL
 SELECT 'policy',t.relname||'.'||p.polname,jsonb_build_array(p.polcmd,p.polpermissive,
   (SELECT array_agg(CASE WHEN roleid=(SELECT relowner FROM pg_class WHERE oid=t.oid) THEN '<owner>' ELSE roleid::regrole::text END ORDER BY roleid) FROM unnest(p.polroles) roleid),
   pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) FROM targets t JOIN pg_policy p ON p.polrelid=t.oid
 UNION ALL
 SELECT 'queue_column',c.relname||'.'||a.attname,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='public' AND NOT a.attisdropped AND ((c.relname='job_sourcing_requests' AND a.attname IN ('tenantId','status')) OR (c.relname='rc_sourcing_runs' AND a.attname IN ('tenant_id','state','resume_token','resume_enqueued_at','closed_at')))
 UNION ALL
 SELECT 'function','signal_rc_set_policy(jsonb)',jsonb_build_array(pg_get_functiondef(p.oid),p.prosrc,p.prosecdef,p.provolatile,p.proparallel,p.proconfig)
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.signal_rc_set_policy(jsonb)')
)
SELECT kind,name,value FROM entries ORDER BY kind COLLATE "C",name COLLATE "C"`;
export async function assertDiscoverCatalog(db){
  const rows=(await db.query(CATALOG_SQL)).rows;
  if(hash(rows)!==CATALOG_SHA256)fail('SETUP_DISCOVER_CATALOG_CHANGED');
}
