/** Spark backup/restore privacy rehearsal (Claude, 4 Nov 2026, user-approved). Disposable local only.
 * Real Flow (built app via rehearse-spark-journeys.ts --serve) + real Memory routes (scripts/rehearse_spark_restore.py).
 * Rule under test (S2 approvals §3): a restore must re-apply privacy changes before the data is used.
 *  T0 backup both databases → candidate X withdraws, candidate Y edits → T1 backup.
 *  R1: restore Memory alone to T0 (Flow current). R2: restore Flow alone to T0 (Memory at T1).
 *  After each restore the services run for a while; then we check whether X's withdrawal holds and
 *  whether anything noticed the mismatch. Read-only checks; nothing is "fixed" by this script.
 */
import {fork,spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {request as httpsRequest} from 'node:https';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Client} from 'pg';

const copy='bb133dc6ab8120ad2e866bacec8253eb163415a7d215a80d6fc447c1ea23ac5e';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const PG='/usr/lib/postgresql/16/bin';
const SETTLE_MS=Number(process.env.RESTORE_SETTLE_MS??30_000);

class User{
  jar=new Map<string,string>();csrf='';
  constructor(readonly base:string,readonly email:string){}
  private cookie(){return [...this.jar].map(([k,v])=>`${k}=${v}`).join('; ');}
  private keep(res:Response){for(const c of res.headers.getSetCookie?.()??[]){const [kv]=c.split(';');const i=kv!.indexOf('=');this.jar.set(kv!.slice(0,i),kv!.slice(i+1));}}
  async req(method:string,path:string,body?:unknown){
    if(method!=='GET'&&!this.csrf){const r=await fetch(this.base+'/api/csrf-token',{headers:{cookie:this.cookie()}});this.keep(r);this.csrf=(await r.json()).token;}
    const res=await fetch(this.base+path,{method,headers:{cookie:this.cookie(),'content-type':'application/json',accept:'application/json',...(method!=='GET'?{'x-csrf-token':this.csrf}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    this.keep(res);const text=await res.text();let data:any=null;try{data=JSON.parse(text);}catch{}
    return {status:res.status,data};
  }
}

async function main(){
  if(process.env.S2_BROWSER_DISPOSABLE!=='1')throw Error('disposable_only');
  const adminUrl=new URL(process.env.S2_FLOW_TEST_ADMIN_URL??'');
  if(adminUrl.hostname!=='127.0.0.1'||adminUrl.pathname!=='/postgres')throw Error('disposable_database_required');
  const memoryTemplate=process.env.S2_MEMORY_TEMPLATE;
  if(!memoryTemplate||new URL(memoryTemplate).hostname!=='127.0.0.1')throw Error('disposable_memory_required');
  const suffix=randomUUID().replaceAll('-','').slice(0,10),database=`flow_schema_control_test_${suffix}`;
  const owner=`flow_schema_control_test_owner_${suffix}`,runtime=`flow_schema_control_test_runtime_${suffix}`,target=`restore-${suffix}`;
  const roleUrl=(role:string)=>`postgresql://${role}:synthetic-local-only@127.0.0.1:${adminUrl.port}/${database}`;
  const adminDb=(name:string)=>{const u=new URL(adminUrl.href);u.pathname='/'+name;return u.href;};
  const admin=new Client({connectionString:adminUrl.href});await admin.connect();
  await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);
  await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);
  const {runReleaseMigration}=await import('../server/schema-control/runner');
  const {provisionRuntimeRole}=await import('../server/schema-control/runtimeRole');
  const connect=async(role:string)=>{const db=new Client({connectionString:roleUrl(role)});await db.connect();return {query:(q:string,p?:readonly unknown[])=>db.query(q,p as any),end:()=>db.end()};};
  await runReleaseMigration({migrationsDir:resolve('server/schema-migrations'),creds:{migrateUrl:roleUrl(owner),expectedTargetId:target,environment:'development',allowFreshInitialization:true},connect:()=>connect(owner)});
  await provisionRuntimeRole({migrateUrl:roleUrl(owner),runtimeUrl:roleUrl(runtime),runtimeRole:runtime,expectedTargetId:target,connectMigration:()=>connect(owner),connectRuntime:()=>connect(runtime)});
  {const db=new Client({connectionString:roleUrl(owner)});await db.connect();await db.query('INSERT INTO candidate_consent_v2_copies VALUES(2,$1,true)',[copy]);await db.end();}
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const port=5245,memoryPort=5246,modelPort=5247;
  const work=mkdtempSync('/tmp/spark-restore-'),cert=`${work}/cert.pem`,certKey=`${work}/key.pem`;
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',certKey,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,NODE_ENV:'test',S2_BROWSER_DISPOSABLE:'1',S2_MEMORY_TEMPLATE:memoryTemplate,S2_MEMORY_PORT:String(memoryPort),
    S2_CONSENT_COPY_HASH:copy,JWT_ENABLED:'true',JWT_ALGORITHM:'RS256',JWT_ISSUER:'vantahire',SIGNAL_JWT_ISSUER:'signal',JWT_PUBLIC_KEY:pair.publicKey,
    JWT_LEEWAY_SECONDS:'5',VANTAHIRE_JWT_PRIVATE_KEY:pair.privateKey,ACTIVEKG_BASE_URL:`https://127.0.0.1:${memoryPort}`,
    NODE_EXTRA_CA_CERTS:cert,S2_MEMORY_TLS_CERT:cert,S2_MEMORY_TLS_KEY:certKey,
    CANDIDATE_PRIVACY_HMAC_ACTIVE_VERSION:'1',CANDIDATE_PRIVACY_HMAC_KEY_V1:Buffer.alloc(32,1).toString('base64'),
    CANDIDATE_PRIVACY_FLOW_ISSUER:'vantahire',CANDIDATE_PRIVACY_FLOW_ACTOR_ID:'vantahire-backend',CANDIDATE_PRIVACY_SIGNAL_ISSUER:'signal',CANDIDATE_PRIVACY_SIGNAL_ACTOR_ID:'signal-service',
    CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1',CANDIDATE_FOUNDATION_ENABLED:'true',CANDIDATE_FOUNDATION_DELIVERY_ENABLED:'true',CANDIDATE_PROFILE_ENABLED:'true',CANDIDATE_PROFILE_DELIVERY_ENABLED:'true',
    CANDIDATE_SPARK_ENABLED:'true',CANDIDATE_CONSENT_V2_ENABLED:'true',CANDIDATE_CONSENT_V2_DELIVERY_ENABLED:'true',CANDIDATE_CONSENT_V2_CAPTURE_ENABLED:'true',
    CANDIDATE_SPARK_SIGNUP_ENABLED:'true',S2_MODEL_PORT:String(modelPort),GROQ_API_KEY:'synthetic-local-only',GROQ_BASE_URL:`http://127.0.0.1:${modelPort}`,
    GCS_PROJECT_ID:'synthetic-local-only',GCS_BUCKET_NAME:'synthetic-local-bucket',
    GCS_SERVICE_ACCOUNT_KEY:JSON.stringify({type:'service_account',project_id:'synthetic-local-only',client_email:'synthetic@example.invalid',private_key:pair.privateKey}),
    SESSION_SECRET:'synthetic-restore-fixture-session-secret',DATABASE_URL:roleUrl(runtime),FLOW_SCHEMA_TARGET_ID:target,FLOW_SCHEMA_ENVIRONMENT:'development',
    HOST:'127.0.0.1',PORT:String(port),BASE_URL:`http://127.0.0.1:${port}`,ALLOWED_HOSTS:`127.0.0.1:${port}`,OUTREACH_HYGIENE_RECOVERY_ENABLED:'false',FLOW_CANDIDATE_PRIVACY_POLL_MS:'5000'};
  const base=`http://127.0.0.1:${port}`;
  const verifications:string[]=[];let app:ChildProcess|undefined,memory:ChildProcess|undefined;
  let memoryDb='',memoryRuntime='';
  const waitReady=async(url:string)=>{for(let i=0;i<120;i++){
    try{const ok=url.startsWith('https:')?await new Promise<boolean>((resolve,reject)=>{
      const r=httpsRequest(url,{ca:readFileSync(cert),timeout:1000},res=>{res.resume();resolve(res.statusCode===200);});r.on('error',reject);r.end();
    }):(await fetch(url,{signal:AbortSignal.timeout(1000)})).ok;if(ok)return;}catch{}await delay(500);
  }throw Error('startup_timeout');};
  const startMemory=async(existing:boolean)=>{
    memory=spawn('/home/ews/active-graph-kg/venv/bin/python',['scripts/rehearse_spark_restore.py'],{cwd:'/home/ews/candidate-s2-memory',
      env:{...env,...(existing?{S2_MEMORY_EXISTING_DB:memoryDb,S2_MEMORY_EXISTING_RUNTIME:memoryRuntime}:{})},stdio:['ignore','pipe','pipe']});
    memory.stdout?.on('data',c=>{const m=/REHEARSAL_MEMORY (\S+) (\S+)/.exec(String(c));if(m){memoryDb=m[1]!;memoryRuntime=m[2]!;}});
    memory.stderr?.on('data',c=>{const t=String(c);if(/Error|Traceback/.test(t))process.stderr.write(t);});
    await waitReady(`https://127.0.0.1:${memoryPort}/_rehearsal/ready`);
  };
  const stop=async(c?:ChildProcess)=>{if(c&&c.exitCode===null){c.kill('SIGTERM');await new Promise(r=>{c.once('exit',r);setTimeout(r,8000);});}};
  const startApp=async()=>{
    app=fork(resolve('scripts/rehearse-spark-journeys.ts'),['--serve'],{env,execArgv:['--import','tsx'],silent:true});
    app.on('message',(m:any)=>{if(m.kind==='verification')verifications.push(m.url);});
    await waitReady(`${base}/healthz`);
  };
  const dump=(name:string,file:string)=>execFileSync(`${PG}/pg_dump`,['-Fc','-f',file,adminDb(name)]);
  const restoreDb=async(name:string,file:string)=>{
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);
    await admin.query(`DROP DATABASE ${name}`);
    execFileSync(`${PG}/pg_restore`,['-C','-d',adminUrl.href,file]);
  };
  const report:Record<string,unknown>={};
  try{
    await startMemory(false);await startApp();
    const mem=()=>{const c=new Client({connectionString:adminDb(memoryDb)});return c.connect().then(()=>c);};
    const flowAdmin=()=>{const c=new Client({connectionString:adminDb(database)});return c.connect().then(()=>c);};
    const signup=async(tag:string)=>{
      const u=new User(base,`restore-${suffix}-${tag}@example.invalid`);const before=verifications.length;
      const reg=await u.req('POST','/api/register',{username:u.email,password:'SyntheticPassword42!',role:'candidate',
        networkIntent:{schemaVersion:2,idempotencyKey:randomUUID(),accepted:true,copyVersion:2,copyHash:copy}});
      if(reg.status>=300)throw Error(`register_${reg.status}`);
      for(let k=0;k<60&&verifications.length===before;k++)await delay(250);
      const token=new URL(verifications[before]!).pathname.split('/').pop()!;
      if((await u.req('GET',`/api/verify-email/${token}`)).status!==200)throw Error('verify');
      u.csrf='';u.jar.clear();
      if((await u.req('POST','/api/login',{username:u.email,password:'SyntheticPassword42!',expectedRole:'candidate'})).status!==200)throw Error('login');u.csrf='';
      await u.req('POST','/api/candidate/product/foundation',{schemaVersion:1,idempotencyKey:randomUUID()});
      for(let k=0;k<120&&(await u.req('GET','/api/candidate/product')).data?.state!=='linked';k++)await delay(250);
      await u.req('POST','/api/candidate/product/consent/signup-intent/activate',{schemaVersion:2});
      for(let k=0;k<240;k++){const c=await u.req('GET','/api/candidate/product/consent');if(c.data?.acknowledgedAction==='grant'&&c.data?.deliveryStatus==='delivered')return u;await delay(500);}
      throw Error('consent_not_delivered');
    };
    const consent=async(u:User)=>(await u.req('GET','/api/candidate/product/consent')).data;
    const saveDraft=async(u:User,headline:string)=>{
      const p=(await u.req('GET','/api/candidate/product/profile')).data;
      const a=await u.req('POST','/api/candidate/product/profile/commands',{schemaVersion:2,idempotencyKey:randomUUID(),expectedDraftVersion:p.draftVersion,
        expectedProfileVersion:p.profileVersion,expectedPreferenceVersion:p.preferenceVersion,action:'save_draft',payload:{profile:{displayName:'Restore Candidate',headline,
        linkedinUrl:null,currentLocation:{city:'Bengaluru',countryCode:'IN',displayCountry:'India'},skills:['Python'],employment:[],education:[],projects:[]}}});
      if(a.status!==202)return `admit_${a.status}:${a.data?.code??a.data?.reason??''}`;
      for(let k=0;k<200;k++){const s=(await u.req('GET',`/api/candidate/product/profile/commands/${a.data.commandId}`)).data;if(s?.status&&s.status!=='pending')return s.status+(s.reason?`:${s.reason}`:'');await delay(100);}
      return 'timeout';
    };
    const headline=async(u:User)=>(await u.req('GET','/api/candidate/product/profile')).data?.draft?.headline??null;
    const subjectOf=async(u:User)=>{const f=await flowAdmin();try{return (await f.query("SELECT a.subject_id FROM candidate_product_accounts a JOIN users u ON u.id=a.user_id WHERE u.username=$1",[u.email])).rows[0]?.subject_id;}finally{await f.end();}};
    const memConsent=async(subject:string)=>{const m=await mem();try{return (await m.query('SELECT highest_version,effective_version,effective_action FROM candidate_consent_state WHERE subject_id=$1',[subject])).rows[0]??null;}finally{await m.end();}};
    const flowConsent=async(subject:string)=>{const f=await flowAdmin();try{
      const t=(await f.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'candidate_consent_v2%' ORDER BY 1")).rows.map(r=>r.table_name);
      return t;}finally{await f.end();}};

    const X=await signup('x'),Y=await signup('y');
    const sx=await subjectOf(X),sy=await subjectOf(Y);
    console.log('SAVE_Y_V1',await saveDraft(Y,'Headline before backup'));
    // ---- T0 backup (both databases)
    const t0f=`${work}/flow-t0.dump`,t0m=`${work}/memory-t0.dump`;dump(database,t0f);dump(memoryDb,t0m);
    report.t0={memoryX:await memConsent(sx),flowX:await consent(X)};
    // ---- after T0: X withdraws, Y edits
    const cx=await consent(X);
    const w=await X.req('POST','/api/candidate/product/consent',{schemaVersion:2,action:'withdraw',idempotencyKey:randomUUID(),expectedConsentRevision:cx.consentRevision});
    if(w.status>=300)throw Error(`withdraw_${w.status}_${JSON.stringify(w.data)}`);
    for(let k=0;k<240;k++){const c=await consent(X);if(c.acknowledgedAction==='withdraw'&&c.deliveryStatus==='delivered')break;await delay(500);}
    console.log('SAVE_Y_V2',await saveDraft(Y,'Headline after backup'));
    const t1f=`${work}/flow-t1.dump`,t1m=`${work}/memory-t1.dump`;dump(database,t1f);dump(memoryDb,t1m);
    report.t1={memoryX:await memConsent(sx),flowX:await consent(X),yHeadline:await headline(Y)};
    console.log('T1',JSON.stringify(report.t1));

    // ---- R1: Memory alone restored to T0; Flow stays current
    await stop(memory);await restoreDb(memoryDb,t0m);await startMemory(true);
    await delay(SETTLE_MS);
    report.r1={memoryX:await memConsent(sx),flowX:await consent(X),yHeadline:await headline(Y),
      yNextSave:await saveDraft(Y,'Edit after Memory restore'),yHeadlineAfterSave:await headline(Y),
      withdrawalHolds:(await memConsent(sx))?.effective_action==='withdraw'};
    console.log('R1',JSON.stringify(report.r1));

    // ---- R2: Memory back at T1, Flow alone restored to T0
    await stop(app);await stop(memory);
    await restoreDb(memoryDb,t1m);await restoreDb(database,t0f);
    await startMemory(true);await startApp();for(const u of [X,Y])u.csrf='';
    await delay(SETTLE_MS);
    report.r2={memoryX:await memConsent(sx),flowX:await consent(X),yHeadline:await headline(Y),
      xWithdrawAgain:await X.req('POST','/api/candidate/product/consent',{schemaVersion:2,action:'withdraw',idempotencyKey:randomUUID(),expectedConsentRevision:(await consent(X)).consentRevision}).then(r=>`${r.status}:${r.data?.code??''}`),
      yNextSave:await saveDraft(Y,'Edit after Flow restore'),withdrawalHolds:(await memConsent(sx))?.effective_action==='withdraw'};
    console.log('R2',JSON.stringify(report.r2));
    report.flowConsentTables=await flowConsent(sx);report.database=database;report.memoryDatabase=memoryDb;
    writeFileSync(process.env.RESTORE_REPORT??'/tmp/spark-restore-report.json',JSON.stringify(report,null,1));
    console.log('RESTORE_DONE',JSON.stringify({r1Holds:(report.r1 as any).withdrawalHolds,r2Holds:(report.r2 as any).withdrawalHolds}));
  }finally{await stop(app);await stop(memory);await admin.end().catch(()=>{});}
}
await main();
