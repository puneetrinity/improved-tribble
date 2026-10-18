// Authoring-only stdout generator. No database access and no old SQL writes.
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const definitions=new Map();
for(const name of readdirSync('server/schema-migrations').filter(n=>n<'0021').sort()) {
 const source=readFileSync(`server/schema-migrations/${name}`,'utf8');
 for(const m of source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(\w+)\(([\s\S]*?)\) RETURNS[\s\S]*?\bAS (\$[a-zA-Z_0-9]*\$)[\s\S]*?\3;/g)) {
  const types=m[2].split(',').map(p=>p.trim().split(/\s+/).slice(1).join(' '));
  definitions.set(`${m[1]}:${types.length}`,{signature:`${m[1]}(${types.join(',')})`,sql:m[0]});
 }
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const output=[];
function edit(key,changes) {
 const {signature,sql}=definitions.get(key);let current=sql;
 const marker=/\bAS (\$[a-zA-Z_0-9]*\$)/.exec(sql);
 const source=sql.slice(marker.index+marker[0].length,sql.lastIndexOf(marker[1]));
 const hash=createHash('sha256').update(source).digest('hex');
 const statements=[];
 for(const [from,to,count=1] of changes) {
  if(current.split(from).length-1!==count)throw Error(`${key}: witness ${from}`);
  current=current.replaceAll(from,to);
  statements.push(` IF (length(definition)-length(replace(definition,${quote(from)},'')))/length(${quote(from)})<>${count} THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;\n definition:=replace(definition,${quote(from)},${quote(to)});`);
 }
 output.push(`DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.${signature}'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>${quote(hash)} THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
${statements.join('\n')}
 EXECUTE definition;
END $forward$;`);
}
const versions=variable=>['schemaVersion','compilerVersion','taxonomyVersion'].map(field=>[
 `${variable}->'${field}' IS DISTINCT FROM '3'::jsonb`,
 `(${variable}->'${field}' IS DISTINCT FROM '3'::jsonb AND ${variable}->'${field}' IS DISTINCT FROM '4'::jsonb)`]);
edit('flow_job_brief_validate_v3:1',[
 ...versions('p_payload'),
 ["OR jsonb_typeof(p_payload->'criteria') IS DISTINCT FROM 'array'", "OR p_payload->'schemaVersion' IS DISTINCT FROM p_payload->'compilerVersion' OR p_payload->'schemaVersion' IS DISTINCT FROM p_payload->'taxonomyVersion' OR jsonb_typeof(p_payload->'criteria') IS DISTINCT FROM 'array'"],
]);
const experience=[`(c->>'subject'='experience_years' AND NOT c->'evidenceKinds' @> '["profile_evidence"]'::jsonb)`,
 `(c->>'subject'='experience_years' AND NOT c->'evidenceKinds' @> '["profile_evidence"]'::jsonb AND NOT (payload->'schemaVersion'='4'::jsonb AND c->'evidenceKinds' @> '["candidate_provided"]'::jsonb))`];
edit('flow_job_brief_save:6',[
 ...versions('payload'),experience,
 ['payload,material,3,3,3,p_actor,workspace','payload,material,(payload->>\'schemaVersion\')::integer,(payload->>\'compilerVersion\')::integer,(payload->>\'taxonomyVersion\')::integer,p_actor,workspace'],
]);
for(const key of ['flow_job_brief_approve:7','flow_sourcing_digest_claim:5']) {
 edit(key,[['v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3',
  'v.schema_version NOT IN (3,4) OR v.compiler_version<>v.schema_version OR v.taxonomy_version<>v.schema_version']]);
}
edit('flow_job_brief_draft_claim:8',[["clock_timestamp()+interval '60 seconds',3)","clock_timestamp()+interval '60 seconds',4)"]]);
edit('flow_job_brief_draft_finish:3',[
 ['d.prompt_version<>3','d.prompt_version NOT IN (3,4)',2],...versions('payload'),experience,
]);
edit('flow_sourcing_quote:3',[
 ['schema_version=3 AND compiler_version=3 AND taxonomy_version=3','schema_version IN (3,4) AND compiler_version=schema_version AND taxonomy_version=schema_version'],
]);
edit('flow_sourcing_admit:5',[
 ['AND schema_version=3;','AND schema_version IN (3,4);'],
 ["'policyVersion','rubric-approved-skills-v1'","'policyVersion',CASE WHEN v.schema_version=4 THEN 'rubric-resume-evidence-v1' ELSE 'rubric-approved-skills-v1' END"],
 ["'adapterVersion','rubric-evidence-v1'","'adapterVersion',CASE WHEN v.schema_version=4 THEN 'rubric-evidence-v2' ELSE 'rubric-evidence-v1' END"],
]);
edit('flow_sourcing_decide:6',[
 ["IN ('block_global','block_all','review')) THEN RETURN NULL; END IF;", "IN ('block_global','block_all','review') AND (coalesce(remote.decision,CASE WHEN r.state='needs_review' THEN 'review' WHEN r.action='request_erasure' THEN 'block_all' ELSE 'block_global' END)<>'block_global' OR c.candidate_summary->'candidateOrigin'->>'kind' IS DISTINCT FROM 'organization_candidate' OR c.candidate_summary->'candidateOrigin'->'version' IS DISTINCT FROM '1'::jsonb)) THEN RETURN NULL; END IF;"],
 ["ELSIF target_state='shortlisted' AND coalesce(c.email_resolve_status,'')", "ELSIF target_state='shortlisted' AND public.flow_sourcing_contact_allowed(p_org,p_job,p_candidate) AND coalesce(c.email_resolve_status,'')"],
]);
console.log(output.join('\n\n'));
