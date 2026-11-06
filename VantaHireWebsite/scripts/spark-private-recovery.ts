/** Private one-shot transport for the unchanged B5 reconciler. Never mounted by an app. */
import {pathToFileURL} from 'node:url';
import {checkServerIdentity,type PeerCertificate} from 'node:tls';
import {Client} from 'pg';
import {reconcileSparkRestore,type Restored} from '../server/candidate-product/restore-reconcile';

function need(ok:unknown):asserts ok {if(!ok)throw Error('private_recovery_refused');}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function databaseConfig(env:NodeJS.ProcessEnv,kind:'FLOW'|'DISCOVER'|'MEMORY'){
 const raw=kind==='MEMORY'?env.ACTIVEKG_MIGRATE_DSN:env[`${kind}_RECOVERY_DATABASE_URL`];
 const u=new URL(raw??'');
 need(['postgres:','postgresql:'].includes(u.protocol)&&u.username&&u.password&&u.pathname.length>1&&!u.hash);
 // No connectionString: libpq URL options must never override explicit TLS or host settings.
 need([...u.searchParams.keys()].every(k=>k==='sslmode'));
 const base={host:u.hostname,port:Number(u.port||5432),user:decodeURIComponent(u.username),
  password:decodeURIComponent(u.password),database:decodeURIComponent(u.pathname.slice(1)),
  connectionTimeoutMillis:10000,statement_timeout:30000,application_name:'spark-private-recovery'};
 need(Number.isInteger(base.port)&&base.port>0&&base.port<65536);
 if(kind==='MEMORY'){
  need(/^[a-z0-9-]+\.railway\.internal$/.test(u.hostname)&&u.hostname===env.SPARK_MEMORY_PRIVATE_HOST);
  need(!u.searchParams.has('sslmode')||u.searchParams.get('sslmode')==='disable');
  return {...base,ssl:false as const};
 }
 need(u.hostname===env[`${kind}_RECOVERY_HOST`]&&!!env[`${kind}_RECOVERY_TLS_SERVERNAME`]);
 need(!u.searchParams.has('sslmode')||u.searchParams.get('sslmode')==='verify-full');
 const ca=env[`${kind}_RECOVERY_CA_PEM`];need(ca?.includes('-----BEGIN CERTIFICATE-----'));
 const servername=env[`${kind}_RECOVERY_TLS_SERVERNAME`]!;
 // pg overwrites TLS servername with the TCP hostname. Retain explicit certificate
 // hostname verification for a Railway proxy while still requiring the pinned CA.
 return {...base,ssl:{ca,rejectUnauthorized:true,servername,
  checkServerIdentity:(_host:string,cert:PeerCertificate)=>checkServerIdentity(servername,cert)}};
}

export function validateRuntime(env:NodeJS.ProcessEnv){
 need(env.SPARK_PRIVATE_JOB_APPLY==='recovery');
 need(env.RAILWAY_PROJECT_ID==='5042caf8-8879-40ab-bb52-aa9f8af8e508');
 need(env.RAILWAY_ENVIRONMENT_ID==='c3b75445-d0de-49fa-a533-b4b9a20b5f5d');
 need(!!env.RAILWAY_DEPLOYMENT_ID&&uuid.test(env.SPARK_PRIVATE_JOB_SERVICE_ID??'')&&env.RAILWAY_SERVICE_ID===env.SPARK_PRIVATE_JOB_SERVICE_ID);
 need(!env.ACTIVEKG_MIGRATION_APPLY&&!env.ACTIVEKG_SCHEMA_FRESH_INIT&&!env.NODE_OPTIONS);
 for(const key of ['PGHOSTADDR','PGOPTIONS','PGSERVICE','PGSERVICEFILE','PGSSLMODE'])need(!env[key]);
 need(env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!env.DATABASE_USE_NEON);
 need(/^[A-Za-z0-9_-]{16,128}$/.test(env.CANDIDATE_NETWORK_RECOVERY_EPOCH??''));
 need(uuid.test(env.SPARK_RECOVERY_RUN_ID??''));
 need(['none','memory','flow','both'].includes(env.SPARK_RECOVERY_RESTORED??''));
 const origin=new URL(env.ACTIVEKG_BASE_URL??'');
 need(origin.protocol==='https:'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash);
 for(const k of ['FLOW_SCHEMA_TARGET_ID','ACTIVEKG_SCHEMA_TARGET_ID','SIGNAL_SCHEMA_TARGET_ID'])
  need(uuid.test(env[k]??''));
}

export async function identity(db:Pick<Client,'query'>,kind:'FLOW'|'MEMORY'|'DISCOVER',target:string){
 const sources={FLOW:['schema_control.identity','system','flow'],MEMORY:['activekg_schema_control.target_identity','product','memory'],DISCOVER:['signal_schema_control.target_identity','system','discover']} as const;
 const [table,column,product]=sources[kind];
 const r=await db.query(`SELECT ${column} AS product,environment,target_id::text FROM ${table}`);
 need(r.rows.length===1&&r.rows[0].product===product&&r.rows[0].environment==='production'&&r.rows[0].target_id===target);
}

export async function run(){
 const env=process.env;validateRuntime(env);
 const flowConfig=databaseConfig(env,'FLOW'),memoryConfig=databaseConfig(env,'MEMORY'),discoverConfig=databaseConfig(env,'DISCOVER');
 // Flow's existing privacy checker uses its runtime pool. Force the same verified endpoint and CA.
 const runtime=new URL(env.DATABASE_URL??'');
 need(['postgres:','postgresql:'].includes(runtime.protocol)&&!!runtime.password);
 need(!runtime.search&&!runtime.hash&&runtime.hostname===flowConfig.host&&Number(runtime.port||5432)===flowConfig.port);
 need(decodeURIComponent(runtime.pathname.slice(1))===flowConfig.database);
 need(decodeURIComponent(runtime.username)==='flow_runtime');
 need(flowConfig.ssl);
 env.DATABASE_SSL='true';env.DATABASE_SSL_REJECT_UNAUTHORIZED='true';env.DATABASE_CA_CERT=flowConfig.ssl.ca;
 env.NODE_ENV='production';env.PGPOOL_MAX='1';
 const clients=[new Client(flowConfig),new Client(memoryConfig),new Client(discoverConfig)];
 let runtimePool:{end:()=>Promise<void>}|undefined;
 try{
  for(const db of clients)await db.connect();
  const [flow,memory,discover]=clients;
  await identity(flow!,'FLOW',env.FLOW_SCHEMA_TARGET_ID!);
  await identity(memory!,'MEMORY',env.ACTIVEKG_SCHEMA_TARGET_ID!);
  await identity(discover!,'DISCOVER',env.SIGNAL_SCHEMA_TARGET_ID!);
  const {parseConsentProjection}=await import('../server/candidate-product/spark-contracts');
  const {sendConsentV2}=await import('../server/candidate-product/spark-client');
  const {foundationMemoryOrigin}=await import('../server/candidate-product/memory-client');
  const {signServiceJwt}=await import('../server/lib/services/jwt-signer');
  const origin=foundationMemoryOrigin();
  const result=await reconcileSparkRestore({epoch:env.CANDIDATE_NETWORK_RECOVERY_EPOCH!,runId:env.SPARK_RECOVERY_RUN_ID!,
   restored:env.SPARK_RECOVERY_RESTORED as Restored,
   confirmNoOutsidePrivacyChangeSinceBackup:env.SPARK_CONFIRM_NO_OUTSIDE_PRIVACY_CHANGE==='true'}, {
   flow:(q,p)=>flow!.query(q,p as unknown[]),memory:(q,p)=>memory!.query(q,p as unknown[]),
   discover:(q,p)=>discover!.query(q,p as unknown[]),
   redeliverConsent:async eventId=>{
    const wire=(await flow!.query('SELECT public.flow_consent_v2_wire($1::uuid) AS w',[eventId])).rows[0]?.w;
    const command=parseConsentProjection(JSON.stringify(wire));
    if(command.value.action==='grant'){
     // The existing lazy pg pool has not connected yet. Pin its TLS options before
     // importing the privacy repository, including proxy certificate servername.
     if(!runtimePool){
      const pool=(await import('../server/db')).pool;
      need(pool.totalCount===0&&pool.options.connectionString===env.DATABASE_URL);
      pool.options.ssl=flowConfig.ssl;
      runtimePool=pool;
     }
     const {requireCandidatePrivacyAllowed}=await import('../server/candidate-privacy/decision');
     const user=(await flow!.query('SELECT user_id FROM public.candidate_consent_events WHERE event_id=$1',[eventId])).rows[0]?.user_id;
     await requireCandidatePrivacyAllowed({type:'candidate_user',id:Number(user)},{globalUse:true,newGlobalOperation:true});
    }
    await sendConsentV2(command.canonical,command.hash,{origin,sign:signServiceJwt});
   }});
  need(result.attested);
  return `SPARK_PRIVATE_RECOVERY PASS subjects=${result.subjects.union} replayed=${result.consentReplayed} held=${Object.values(result.holds).reduce((a,b)=>a+b,0)}`;
 }finally{
  for(const db of clients)await db.end().catch(()=>{});
  await runtimePool?.end().catch(()=>{});
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 // Imported infrastructure may log; owner job output is deliberately narrower than normal app logs.
 console.log=console.warn=console.error=()=>{};
 const deadline=setTimeout(()=>process.exit(1),840000);deadline.unref();
 try{process.stdout.write(`${await run()}\n`);}catch{process.stdout.write('SPARK_PRIVATE_RECOVERY FAIL\n');process.exitCode=1;}
 clearTimeout(deadline);
}
