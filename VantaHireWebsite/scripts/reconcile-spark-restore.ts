/** B5 operator command: reconcile Flow and Memory after a database restore, then reopen native Spark
 * discovery only if nothing remains unproven. Never run by the app. Prerequisite: a NEW
 * CANDIDATE_NETWORK_RECOVERY_EPOCH was deployed to Memory (API + embedding worker) BEFORE the restore,
 * which keeps native search, validation and publishing closed until this command attests it.
 *
 * Usage:
 *   FLOW_RECOVERY_DATABASE_URL=<Flow owner DSN> MEMORY_RECOVERY_DATABASE_URL=<Memory privileged DSN> \
 *   [DISCOVER_RECOVERY_DATABASE_URL=<Discover read DSN>] DATABASE_URL=<Flow runtime DSN> ACTIVEKG_BASE_URL=<Memory origin> VANTAHIRE_JWT_PRIVATE_KEY=... \
 *   node --import tsx scripts/reconcile-spark-restore.ts --epoch <epoch> --restored memory|flow|both|none \
 *     [--confirm-no-outside-privacy-change-since-backup] [--run-id <uuid>] [--detail-file <path>]
 * Prints counts only. Per-subject identifiers go to the optional --detail-file (mode 0600).
 */
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {reconcileSparkRestore,type Restored} from '../server/candidate-product/restore-reconcile';
import {parseConsentProjection} from '../server/candidate-product/spark-contracts';
import {sendConsentV2} from '../server/candidate-product/spark-client';
import {foundationMemoryOrigin} from '../server/candidate-product/memory-client';
import {signServiceJwt} from '../server/lib/services/jwt-signer';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
async function main(){
 const epoch=arg('--epoch')??'',restored=(arg('--restored')??'') as Restored,runId=arg('--run-id')??randomUUID();
 const flowUrl=process.env.FLOW_RECOVERY_DATABASE_URL,memoryUrl=process.env.MEMORY_RECOVERY_DATABASE_URL;
 if(!flowUrl||!memoryUrl)throw Error('recovery_database_urls_required');
 const flow=new Client({connectionString:flowUrl}),memory=new Client({connectionString:memoryUrl});
 const discoverUrl=process.env.DISCOVER_RECOVERY_DATABASE_URL,discover=discoverUrl?new Client({connectionString:discoverUrl}):null;
 await flow.connect();await memory.connect();await discover?.connect();
 try{
  const origin=foundationMemoryOrigin();
  const {requireCandidatePrivacyAllowed}=await import('../server/candidate-privacy/decision');
  const report=await reconcileSparkRestore({epoch,runId,restored,confirmNoOutsidePrivacyChangeSinceBackup:process.argv.includes('--confirm-no-outside-privacy-change-since-backup')},{
   flow:(q,p)=>flow.query(q,p as unknown[]),memory:(q,p)=>memory.query(q,p as unknown[]),
   ...(discover?{discover:(q:string,p?:readonly unknown[])=>discover.query(q,p as unknown[])}:{}),
   redeliverConsent:async eventId=>{
    // Same identity, hash and signed receiver as the normal worker; nothing is re-captured.
    const wire=(await flow.query('SELECT public.flow_consent_v2_wire($1::uuid) AS w',[eventId])).rows[0]?.w;
    const command=parseConsentProjection(JSON.stringify(wire));
    if(command.value.action==='grant'){
     // A grant is replayed only under the same current privacy check the worker applies.
     const user=(await flow.query('SELECT user_id FROM public.candidate_consent_events WHERE event_id=$1',[eventId])).rows[0]?.user_id;
     await requireCandidatePrivacyAllowed({type:'candidate_user',id:Number(user)},{globalUse:true,newGlobalOperation:true});
    }
    await sendConsentV2(command.canonical,command.hash,{origin,sign:signServiceJwt});
   }});
  const {detail,...counts}=report;
  const file=arg('--detail-file');
  if(file)writeFileSync(file,JSON.stringify(detail,null,1),{mode:0o600});
  console.log('SPARK_RESTORE_RECONCILE',JSON.stringify(counts));
  process.exitCode=report.attested?0:2;
 }finally{await flow.end().catch(()=>{});await memory.end().catch(()=>{});await discover?.end().catch(()=>{});}
}
await main();
