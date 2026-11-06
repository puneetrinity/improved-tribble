/** Operator-only, single-request Spark erasure. Never imported by app startup.
 * Dry run is the default. Execute requires the exact freshly reviewed plan hash.
 * This does not erase employer applications or pre-existing Discover records.
 */
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
export interface OperatorDb {query(sql:string,args?:unknown[]):Promise<{rows:any[]}>}
export interface OperatorBlobStore {remove(path:string,generation:string):Promise<void>;inspect?(path:string):Promise<string|null>}
export const CLOUD_REQUEST_TIMEOUT_MS=10_000,FILE_PHASE_BUDGET_MS=60_000;
/** Never race a delete against a timer: keep reference locks until it settles.
 * Production HTTP is separately bounded by the SDK timeout, with retries off. */
export function boundedBlobs(blobs:OperatorBlobStore,now:()=>number=()=>performance.now()):OperatorBlobStore{
 const started=now();
 const check=()=>{if(now()-started>=FILE_PHASE_BUDGET_MS)throw Error('file_phase_deadline');};
 return {remove:async(path,generation)=>{check();await blobs.remove(path,generation);check();},
  ...(blobs.inspect?{inspect:async(path:string)=>{check();const result=await blobs.inspect!(path);check();return result;}}:{})};
}
const uuid=z.string().uuid();
export function objectIdentity(value:string):string|null{
 try{
  const rawPath=decodeURIComponent(value.split(/[?#]/,1)[0]!);
  if(rawPath.split('/').some(p=>p==='.'||p==='..'))return null;
  const u=new URL(value);if(u.username||u.password||u.port)return null;
  let bucket:string,path:string;
  if(u.protocol==='gs:'){bucket=u.hostname;path=u.pathname.slice(1);}
  else if(u.protocol==='https:'&&['storage.googleapis.com','storage.cloud.google.com'].includes(u.hostname)){
   const slash=u.pathname.indexOf('/',1);if(slash<0)return null;bucket=u.pathname.slice(1,slash);path=u.pathname.slice(slash+1);
  }else if(u.protocol==='https:'&&u.hostname.endsWith('.storage.googleapis.com')){
   bucket=u.hostname.slice(0,-'.storage.googleapis.com'.length);path=u.pathname.slice(1);
  }else return null;
  path=decodeURIComponent(path);
  if(!/^[a-z0-9][a-z0-9._-]+$/.test(bucket)||!path||/[\x00-\x1f\x7f]/.test(path)||path.split('/').some(p=>p==='..'||p==='.'))return null;
  return `gs://${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
 }catch{return null;}
}
async function owner(db:OperatorDb,table:string){
 const row=(await db.query('SELECT current_user = pg_get_userbyid(relowner) AS owned FROM pg_class WHERE oid=$1::regclass',[table])).rows[0];
 if(row?.owned!==true)throw Error('operator_owner_required');
}
async function authority(flow:OperatorDb,memory:OperatorDb,requestId:string,lock=false){
 uuid.parse(requestId);await owner(flow,'public.candidate_source_erasures');await owner(memory,'public.candidate_profile_heads');
 const row=(await flow.query(`SELECT r.actor_user_id user_id,r.directive_id,a.subject_id,a.binding_id
  FROM candidate_privacy_requests r JOIN candidate_product_accounts a ON a.user_id=r.actor_user_id
  WHERE r.request_id=$1 AND r.action='request_erasure' AND r.authority_type='verified_candidate' AND r.state='memory_active'
   AND EXISTS(SELECT 1 FROM candidate_privacy_subject_links l WHERE l.request_id=r.request_id
    AND l.subject_type='candidate_user' AND l.candidate_user_id=r.actor_user_id)${lock?' FOR UPDATE OF r,a':''}`,[requestId])).rows[0];
 if(!row)throw Error('verified_quarantine_required');
 const checked=(await memory.query(`SELECT 1 FROM candidate_privacy_directives d
  JOIN candidate_owned_subjects o ON o.subject_id=$2
  WHERE d.directive_id=$1 AND d.action='request_erasure' AND d.state='active_quarantine'
   AND o.flow_binding_id=$3
   AND EXISTS(SELECT 1 FROM candidate_privacy_directive_events e WHERE e.directive_id=d.directive_id AND e.request_id=$4)${lock?' FOR SHARE OF d':''}`,
 [row.directive_id,row.subject_id,row.binding_id,requestId])).rows[0];
 if(!checked)throw Error('memory_quarantine_required');
 return row as {user_id:number;directive_id:string;subject_id:string;binding_id:string};
}
async function filePlan(flow:OperatorDb,user:number,blobs?:OperatorBlobStore){
 const sources=(await flow.query(`SELECT DISTINCT gcs_path,gcs_generation FROM candidate_source_objects
  WHERE user_id=$1 AND gcs_path<>'erased' ORDER BY gcs_path,gcs_generation`,[user])).rows;
 const library=(await flow.query("SELECT gcs_path FROM candidate_resumes WHERE user_id=$1 AND gcs_path<>'erased' ORDER BY gcs_path",[user])).rows;
 // Locking these tables during execution prevents a new independent reference
 // from appearing between the last check and the generation-bound delete.
 const refs=(await flow.query(`SELECT resume_url value FROM applications WHERE resume_url IS NOT NULL UNION ALL SELECT resume_url FROM talent_pool WHERE resume_url IS NOT NULL
  UNION ALL SELECT file_url FROM form_response_answers WHERE file_url IS NOT NULL
  UNION ALL SELECT gcs_path FROM resume_import_items WHERE gcs_path IS NOT NULL
  UNION ALL SELECT gcs_path FROM candidate_resumes WHERE user_id<>$1
  UNION ALL SELECT gcs_path FROM candidate_source_objects WHERE user_id<>$1`,[user])).rows;
 if(refs.some(r=>typeof r.value!=='string'||((r.value.startsWith('gs:')||r.value.includes('storage.googleapis.com')||r.value.includes('storage.cloud.google.com'))&&!objectIdentity(r.value))))
  throw Error('reference_inventory_invalid');
 const identities=new Set(refs.map(r=>objectIdentity(r.value)).filter(Boolean));
 const files=sources.map(s=>{
  const path=objectIdentity(s.gcs_path);if(!path||!/^\d+$/.test(s.gcs_generation))throw Error('invalid_source_locator');
  return {path,generation:s.gcs_generation,retained:identities.has(path)};
 });
 // No generation means no safe deletion. Do not guess or delete the latest
 // cloud object. The operator must first inventory that library object.
 let missing=0;
 for(const row of library){
  const path=objectIdentity(row.gcs_path);if(!path)throw Error('invalid_source_locator');
  if(blobs?.inspect){
   const generation=await blobs.inspect(path);
   if(generation!==null){if(!/^\d+$/.test(generation))throw Error('invalid_generation');
    if(!files.some(f=>f.path===path&&f.generation===generation))files.push({path,generation,retained:identities.has(path)});
   }
  }else if(!files.some(f=>f.path===path))missing++;
 }
 files.sort((a,b)=>a.path.localeCompare(b.path)||a.generation.localeCompare(b.generation));
 return {files,missing};
}
export async function planErasure(flow:OperatorDb,memory:OperatorDb,requestId:string,blobs?:OperatorBlobStore){
 const a=await authority(flow,memory,requestId),files=await filePlan(flow,a.user_id,blobs);
 const counts=(await flow.query(`SELECT (SELECT count(*)::integer FROM candidate_source_jobs WHERE user_id=$1) resume_jobs,
  (SELECT count(*)::integer FROM candidate_source_lookups WHERE user_id=$1) lookups,
  (SELECT count(*)::integer FROM candidate_source_interpretations WHERE user_id=$1) interpretations,
  (SELECT count(*)::integer FROM applications WHERE user_id=$1) retained_applications`,[a.user_id])).rows[0];
 const memoryCounts=(await memory.query(`SELECT (SELECT count(*)::integer FROM candidate_profile_drafts WHERE subject_id=$1) drafts,
  (SELECT count(*)::integer FROM candidate_profile_proposals WHERE subject_id=$1) source_proposals,
  (SELECT count(*)::integer FROM candidate_profile_interpretations WHERE subject_id=$1) ai_proposals`,[a.subject_id])).rows[0];
 const planHash=createHash('sha256').update(JSON.stringify({requestId,a,files,counts,memoryCounts})).digest('hex');
 return {requestId,planHash,flow:counts,memory:memoryCounts,deleteFiles:files.files.filter(f=>!f.retained).length,
  retainSharedFiles:files.files.filter(f=>f.retained).length,unresolvedFiles:files.missing,
  scope:'Spark network only; applications and existing Discover records are not deleted'};
}
async function transaction<T>(db:OperatorDb,fn:()=>Promise<T>):Promise<T>{
 await db.query('BEGIN');try{await db.query("SET LOCAL lock_timeout='3s'");await db.query("SET LOCAL statement_timeout='10s'");
  const value=await fn();await db.query('COMMIT');return value;
 }catch(e){await db.query('ROLLBACK');throw e;}
}
export async function executeErasure(flow:OperatorDb,memory:OperatorDb,blobs:OperatorBlobStore,requestId:string,approvedPlanHash:string){
 const plan=await planErasure(flow,memory,requestId,blobs);
 if(!/^[a-f0-9]{64}$/.test(approvedPlanHash)||approvedPlanHash!==plan.planHash)throw Error('plan_changed');
 if(plan.unresolvedFiles)throw Error('file_inventory_incomplete');
 // Commit the durable Flow fence before touching Memory. Failures after this
 // point stay quarantined and are resumable; no cross-database rollback claim.
 const a=await transaction(flow,async()=>{
  const a=await authority(flow,memory,requestId,true);
  await flow.query('SELECT flow_candidate_source_erasure_prepare($1)',[requestId]);return a;
 });
 await transaction(flow,async()=>{
  await transaction(memory,async()=>{
   await authority(flow,memory,requestId,true);
   await memory.query("SELECT candidate_profile_erase($1,$2,$3,'privacy_operator')",[a.subject_id,a.binding_id,requestId]);
  });
  await flow.query('SELECT flow_candidate_source_erasure_finish($1,$2,$3)',[requestId,a.subject_id,a.binding_id]);
 });
 await transaction(flow,async()=>{
  const bounded=boundedBlobs(blobs);
  await flow.query('SELECT pg_advisory_xact_lock(41943,$1)',[a.user_id]);
  await flow.query('LOCK TABLE applications,form_response_answers,talent_pool,resume_import_items,candidate_resumes,candidate_source_objects IN SHARE ROW EXCLUSIVE MODE');
  await authority(flow,memory,requestId,true);
  if((await planErasure(flow,memory,requestId,bounded)).planHash!==approvedPlanHash)throw Error('plan_changed');
  const checked=await filePlan(flow,a.user_id,bounded);if(checked.missing)throw Error('file_inventory_incomplete');
  for(const file of checked.files)if(!file.retained)await bounded.remove(file.path,file.generation);
  await flow.query("UPDATE candidate_resumes SET extracted_text=NULL,label='Erased',gcs_path='erased',is_default=false WHERE user_id=$1",[a.user_id]);
  await flow.query("UPDATE candidate_source_objects SET content_hash=repeat('0',64),gcs_path='erased',gcs_generation='0',original_versions='{}',restricted=true WHERE user_id=$1",[a.user_id]);
  await flow.query("UPDATE candidate_source_erasures SET stage='complete' WHERE request_id=$1 AND stage='network_erased_files_pending'",[requestId]);
 });
 return {requestId,status:'complete',retainedSharedFiles:plan.retainSharedFiles};
}

async function main(){
 const args=process.argv.slice(2),request=args[0];uuid.parse(request);
 if(args.length!==1&&!(args.length===3&&args[1]==='--execute'))throw Error('usage: REQUEST_UUID [--execute PLAN_SHA256]');
 const {Client}=await import('pg');
 if(!process.env.SPARK_ERASURE_FLOW_OWNER_URL||!process.env.SPARK_ERASURE_MEMORY_OWNER_URL)throw Error('explicit_owner_connections_required');
 const flow=new Client({connectionString:process.env.SPARK_ERASURE_FLOW_OWNER_URL}),memory=new Client({connectionString:process.env.SPARK_ERASURE_MEMORY_OWNER_URL});
 try{await flow.connect();await memory.connect();
  const {Storage}=await import('@google-cloud/storage');const storage=new Storage({timeout:CLOUD_REQUEST_TIMEOUT_MS,retryOptions:{autoRetry:false}});
  const blobs:OperatorBlobStore={inspect:async path=>{
   const u=new URL(path);try{const [metadata]=await storage.bucket(u.hostname).file(decodeURIComponent(u.pathname.slice(1))).getMetadata();
    if(!metadata.generation)throw Error('missing_generation');return String(metadata.generation);
   }catch(error){if((error as {code?:number}).code===404)return null;throw Error('blob_inventory_failed');}
  },remove:async(path,generation)=>{
   const u=new URL(path);try{await storage.bucket(u.hostname).file(decodeURIComponent(u.pathname.slice(1)),{generation,preconditionOpts:{ifGenerationMatch:generation}})
    .delete({ignoreNotFound:true});}catch{throw Error('blob_delete_failed');}
  }};
  if(args.length===1){console.log(JSON.stringify(await planErasure(flow,memory,request!,blobs),null,2));return;}
  const result=await executeErasure(flow,memory,blobs,request!,args[2]!);console.log(JSON.stringify(result));
 }finally{await flow.end();await memory.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
 console.error('Spark erasure refused or incomplete. No credentials or candidate content logged; inspect the dry run and retry only after review.');process.exitCode=1;
});
