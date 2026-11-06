/** Spark profile-edit load test (Claude, 4 Nov 2026, user-approved). Disposable local only.
 * Real Flow (built app, real auth/CSRF/routes/SQL/workers) + the real Memory rehearsal API, the same
 * setup as rehearse-spark-journeys.ts (its --serve mode is reused for the app). Measures the build
 * lock's target: p95 admission-to-applied < 2 s with 20 subjects editing at once. Also: same-subject
 * conflicts, a Flow restart mid-load, and a slow Memory (delay proxy between Flow and Memory).
 * Admission = candidate_profile_commands.created_at; applied = candidate_profile_outbox.acknowledged_at.
 */
import {fork,spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer as createHttpsServer,request as httpsRequest} from 'node:https';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Client} from 'pg';

const copy='bb133dc6ab8120ad2e866bacec8253eb163415a7d215a80d6fc447c1ea23ac5e';
const COPY_VERSION=2;
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const SUBJECTS=Number(process.env.LOAD_SUBJECTS??20),ROUNDS=Number(process.env.LOAD_ROUNDS??5);
const pct=(xs:number[],p:number)=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.ceil(p/100*s.length)-1)]!:NaN;};

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
  const owner=`flow_schema_control_test_owner_${suffix}`,runtime=`flow_schema_control_test_runtime_${suffix}`,target=`load-${suffix}`;
  const roleUrl=(role:string)=>`postgresql://${role}:synthetic-local-only@127.0.0.1:${adminUrl.port}/${database}`;
  const admin=new Client({connectionString:adminUrl.href});await admin.connect();
  try{await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);}finally{await admin.end();}
  const {runReleaseMigration}=await import('../server/schema-control/runner');
  const {provisionRuntimeRole}=await import('../server/schema-control/runtimeRole');
  const connect=async(role:string)=>{const db=new Client({connectionString:roleUrl(role)});await db.connect();return {query:(q:string,p?:readonly unknown[])=>db.query(q,p as any),end:()=>db.end()};};
  await runReleaseMigration({migrationsDir:resolve('server/schema-migrations'),creds:{migrateUrl:roleUrl(owner),expectedTargetId:target,environment:'development',allowFreshInitialization:true},connect:()=>connect(owner)});
  await provisionRuntimeRole({migrateUrl:roleUrl(owner),runtimeUrl:roleUrl(runtime),runtimeRole:runtime,expectedTargetId:target,connectMigration:()=>connect(owner),connectRuntime:()=>connect(runtime)});
  const db=new Client({connectionString:roleUrl(owner)});await db.connect();
  await db.query('INSERT INTO candidate_consent_v2_copies VALUES($1,$2,true)',[COPY_VERSION,copy]);
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const port=5235,memoryPort=5236,proxyPort=5238,modelPort=5237;
  const certDir=mkdtempSync('/tmp/spark-load-tls-'),cert=`${certDir}/cert.pem`,certKey=`${certDir}/key.pem`;
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',certKey,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  // Delay proxy: Flow → proxy → Memory, so "slow Memory" is a switch, not a code change.
  let memoryDelayMs=0;
  const proxy=createHttpsServer({cert:readFileSync(cert),key:readFileSync(certKey)},(req,res)=>{
    const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',async()=>{
      if(memoryDelayMs)await delay(memoryDelayMs);
      const up=httpsRequest({host:'127.0.0.1',port:memoryPort,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${memoryPort}`},ca:readFileSync(cert)},u=>{
        res.writeHead(u.statusCode??502,u.headers);u.pipe(res);});
      up.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});up.end(Buffer.concat(chunks));
    });});
  await new Promise<void>(ok=>proxy.listen(proxyPort,'127.0.0.1',ok));
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,NODE_ENV:'test',S2_BROWSER_DISPOSABLE:'1',S2_MEMORY_TEMPLATE:memoryTemplate,S2_MEMORY_PORT:String(memoryPort),
    S2_CONSENT_COPY_HASH:copy,JWT_ENABLED:'true',JWT_ALGORITHM:'RS256',JWT_ISSUER:'vantahire',SIGNAL_JWT_ISSUER:'signal',JWT_PUBLIC_KEY:pair.publicKey,
    JWT_LEEWAY_SECONDS:'5',VANTAHIRE_JWT_PRIVATE_KEY:pair.privateKey,ACTIVEKG_BASE_URL:`https://127.0.0.1:${proxyPort}`,
    NODE_EXTRA_CA_CERTS:cert,S2_MEMORY_TLS_CERT:cert,S2_MEMORY_TLS_KEY:certKey,
    CANDIDATE_PRIVACY_HMAC_ACTIVE_VERSION:'1',CANDIDATE_PRIVACY_HMAC_KEY_V1:Buffer.alloc(32,1).toString('base64'),
    CANDIDATE_PRIVACY_FLOW_ISSUER:'vantahire',CANDIDATE_PRIVACY_FLOW_ACTOR_ID:'vantahire-backend',CANDIDATE_PRIVACY_SIGNAL_ISSUER:'signal',CANDIDATE_PRIVACY_SIGNAL_ACTOR_ID:'signal-service',
    CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1',CANDIDATE_FOUNDATION_ENABLED:'true',CANDIDATE_FOUNDATION_DELIVERY_ENABLED:'true',CANDIDATE_PROFILE_ENABLED:'true',CANDIDATE_PROFILE_DELIVERY_ENABLED:'true',
    CANDIDATE_SPARK_ENABLED:'true',CANDIDATE_CONSENT_V2_ENABLED:'true',CANDIDATE_CONSENT_V2_DELIVERY_ENABLED:'true',CANDIDATE_CONSENT_V2_CAPTURE_ENABLED:'true',
    CANDIDATE_SPARK_SIGNUP_ENABLED:'true',S2_MODEL_PORT:String(modelPort),GROQ_API_KEY:'synthetic-local-only',GROQ_BASE_URL:`http://127.0.0.1:${modelPort}`,
    GCS_PROJECT_ID:'synthetic-local-only',GCS_BUCKET_NAME:'synthetic-local-bucket',
    GCS_SERVICE_ACCOUNT_KEY:JSON.stringify({type:'service_account',project_id:'synthetic-local-only',client_email:'synthetic@example.invalid',private_key:pair.privateKey}),
    SESSION_SECRET:'synthetic-load-fixture-session-secret',DATABASE_URL:roleUrl(runtime),FLOW_SCHEMA_TARGET_ID:target,FLOW_SCHEMA_ENVIRONMENT:'development',
    HOST:'127.0.0.1',PORT:String(port),BASE_URL:`http://127.0.0.1:${port}`,ALLOWED_HOSTS:`127.0.0.1:${port}`,OUTREACH_HYGIENE_RECOVERY_ENABLED:'false',FLOW_CANDIDATE_PRIVACY_POLL_MS:'5000'};
  const base=`http://127.0.0.1:${port}`;
  const children:ChildProcess[]=[];const verifications:string[]=[];
  const waitReady=async(url:string)=>{for(let i=0;i<120;i++){
    try{const ok=url.startsWith('https:')?await new Promise<boolean>((resolve,reject)=>{
      const r=httpsRequest(url,{ca:readFileSync(cert),timeout:1000},res=>{res.resume();resolve(res.statusCode===200);});r.on('error',reject);r.end();
    }):(await fetch(url,{signal:AbortSignal.timeout(1000)})).ok;if(ok)return;}catch{}await delay(500);
  }throw Error('startup_timeout');};
  let app:ChildProcess|undefined;
  const startApp=async()=>{
    app=fork(resolve('scripts/rehearse-spark-journeys.ts'),['--serve'],{env,execArgv:['--import','tsx'],silent:true});children.push(app);
    app.on('message',(m:any)=>{if(m.kind==='verification')verifications.push(m.url);});
    app.stderr?.on('data',c=>{const t=String(c);if(/error/i.test(t)&&!/standardFontDataUrl/.test(t))process.stderr.write(t);});
    await waitReady(`${base}/healthz`);
  };
  const report:Record<string,unknown>={subjects:SUBJECTS,rounds:ROUNDS};
  try{
    const memory=spawn('/home/ews/active-graph-kg/venv/bin/python',['scripts/rehearse_spark_browser.py'],{cwd:'/home/ews/candidate-s2-memory',env,stdio:['ignore','ignore','pipe']});children.push(memory);
    await waitReady(`https://127.0.0.1:${memoryPort}/_rehearsal/ready`);
    await startApp();

    // ---- setup: N real candidates (sign-up with consent, verify, sign in, foundation, consent delivered)
    const users:User[]=[];
    for(let i=0;i<SUBJECTS;i++){
      const u=new User(base,`load-${suffix}-${i}@example.invalid`);
      const before=verifications.length;
      const reg=await u.req('POST','/api/register',{username:u.email,password:'SyntheticPassword42!',role:'candidate',
        networkIntent:{schemaVersion:2,idempotencyKey:randomUUID(),accepted:true,copyVersion:COPY_VERSION,copyHash:copy}});
      if(reg.status>=300)throw Error(`register_${reg.status}_${JSON.stringify(reg.data)}`);
      for(let k=0;k<60&&verifications.length===before;k++)await delay(250);
      const url=verifications[before];if(!url)throw Error('verification_not_captured');
      const token=new URL(url).pathname.split('/').pop()!;
      const v=await u.req('GET',`/api/verify-email/${token}`);if(v.status!==200)throw Error(`verify_${v.status}`);
      u.csrf='';u.jar.clear();
      const login=await u.req('POST','/api/login',{username:u.email,password:'SyntheticPassword42!',expectedRole:'candidate'});
      if(login.status!==200)throw Error(`login_${login.status}`);u.csrf='';
      const f=await u.req('POST','/api/candidate/product/foundation',{schemaVersion:1,idempotencyKey:randomUUID()});
      if(f.status>=300)throw Error(`foundation_${f.status}_${JSON.stringify(f.data)}`);
      // Same as the setup page: wait for the account link, then activate the sign-up consent intent.
      for(let k=0;k<120&&(await u.req('GET','/api/candidate/product')).data?.state!=='linked';k++)await delay(250);
      const act=await u.req('POST','/api/candidate/product/consent/signup-intent/activate',{schemaVersion:2});
      if(act.status>=300)throw Error(`consent_activate_${act.status}_${JSON.stringify(act.data)}`);
      users.push(u);
    }
    const ready=async(u:User)=>{for(let k=0;k<240;k++){
      const p=await u.req('GET','/api/candidate/product');const c=await u.req('GET','/api/candidate/product/consent');
      if(p.data?.state==='linked'&&c.data?.acknowledgedAction==='grant'&&c.data?.deliveryStatus==='delivered')return;
      if(k===239)console.log('NOT_READY',JSON.stringify({product:[p.status,p.data],consent:[c.status,c.data]}).slice(0,800));await delay(500);}
      throw Error('setup_not_ready');};
    await Promise.all(users.map(ready));
    console.log('SETUP_READY',users.length);

    const read=async(u:User)=>{const r=await u.req('GET','/api/candidate/product/profile');if(r.status!==200)throw Error(`profile_read_${r.status}`);return r.data;};
    const profile=(u:User,n:number)=>({displayName:'Load Candidate',headline:`Backend engineer ${n}`,linkedinUrl:null,
      currentLocation:{city:'Bengaluru',countryCode:'IN',displayCountry:'India'},skills:['Python','PostgreSQL'],employment:[],education:[],projects:[]});
    const send=async(u:User,p:any,n:number)=>u.req('POST','/api/candidate/product/profile/commands',{schemaVersion:2,idempotencyKey:randomUUID(),
      expectedDraftVersion:p.draftVersion,expectedProfileVersion:p.profileVersion,expectedPreferenceVersion:p.preferenceVersion,action:'save_draft',payload:{profile:profile(u,n)}});
    const settle=async(u:User,id:string,maxMs=60_000)=>{const t=Date.now();for(;;){
      const r=await u.req('GET',`/api/candidate/product/profile/commands/${id}`);
      if(r.data?.status&&r.data.status!=='pending')return r.data;if(Date.now()-t>maxMs)return {status:'timeout'};await delay(50);}};
    const serverLatency=async(ids:string[])=>(await db.query(`SELECT EXTRACT(EPOCH FROM (o.acknowledged_at-c.created_at))*1000 AS ms
      FROM candidate_profile_commands c JOIN candidate_profile_outbox o USING(command_id) WHERE c.command_id = ANY($1::uuid[]) AND o.acknowledged_at IS NOT NULL`,[ids])).rows.map(r=>Number(r.ms));
    const round=async(label:string,n:number)=>{
      const ps=await Promise.all(users.map(read));const ids:string[]=[];const client:number[]=[];const statuses:string[]=[];
      await Promise.all(users.map(async(u,i)=>{const t=Date.now();const a=await send(u,ps[i],n);
        if(a.status!==202){statuses.push(`admit_${a.status}`);return;}ids.push(a.data.commandId);
        const s=await settle(u,a.data.commandId);statuses.push(s.status);client.push(Date.now()-t);}));
      const server=await serverLatency(ids);
      return {label,applied:statuses.filter(s=>s==='applied').length,other:statuses.filter(s=>s!=='applied'),
        serverP50:pct(server,50),serverP95:pct(server,95),serverMax:Math.max(...server),clientP95:pct(client,95)};
    };

    // ---- 1. healthy load: ROUNDS x SUBJECTS concurrent edits
    const healthy:any[]=[];for(let r=0;r<ROUNDS;r++)healthy.push(await round(`healthy-${r+1}`,r+1));
    const allIds=(await db.query("SELECT command_id FROM candidate_profile_commands WHERE action='save_draft'")).rows.map(r=>r.command_id);
    const allServer=await serverLatency(allIds);
    report.healthy={rounds:healthy,total:allServer.length,p50:pct(allServer,50),p95:pct(allServer,95),max:Math.max(...allServer)};
    console.log('HEALTHY',JSON.stringify(report.healthy));

    // ---- 2. same-subject conflict: two edits from the same versions at once → exactly one applies
    const u0=users[0]!;const p0=await read(u0);
    const [a,b]=await Promise.all([send(u0,p0,101),send(u0,p0,102)]);
    const outcomes=await Promise.all([a,b].map(x=>x.status===202?settle(u0,x.data.commandId).then(s=>s.status+(s.reason?`:${s.reason}`:'')):Promise.resolve(`admit_${x.status}:${x.data?.code??''}`)));
    const p0b=await read(u0);
    report.conflict={outcomes,draftAdvancedBy:p0b.draftVersion-p0.draftVersion};
    console.log('CONFLICT',JSON.stringify(report.conflict));

    // ---- 3. Flow restart mid-load: admit SUBJECTS edits, kill Flow, restart, all apply exactly once
    const ps3=await Promise.all(users.map(read));const admitted:{u:User;id:string;before:number}[]=[];
    await Promise.all(users.map(async(u,i)=>{const r=await send(u,ps3[i],200+i);if(r.status===202)admitted.push({u,id:r.data.commandId,before:ps3[i].draftVersion});}));
    app!.kill('SIGKILL');await new Promise(r=>app!.once('exit',r));
    await startApp();for(const u of users)u.csrf='';
    const restart=await Promise.all(admitted.map(async x=>{const s=await settle(x.u,x.id,120_000);const p=await read(x.u);return {status:s.status,advanced:p.draftVersion-x.before};}));
    report.restart={admitted:admitted.length,applied:restart.filter(r=>r.status==='applied').length,exactlyOnce:restart.every(r=>r.advanced===1),other:restart.filter(r=>r.status!=='applied'||r.advanced!==1)};
    console.log('RESTART',JSON.stringify(report.restart));

    // ---- 4. slow Memory: 1.5 s added to every Memory call
    memoryDelayMs=Number(process.env.LOAD_SLOW_MS??1500);
    const slow=await round('slow-memory',300);memoryDelayMs=0;
    report.slow={...slow,delayMs:Number(process.env.LOAD_SLOW_MS??1500)};
    console.log('SLOW',JSON.stringify(report.slow));

    const pass=(report.healthy as any).p95<2000&&(report.healthy as any).total===SUBJECTS*ROUNDS&&healthy.every(h=>h.applied===SUBJECTS)
      &&(report.conflict as any).draftAdvancedBy===1&&(report.conflict as any).outcomes.filter((o:string)=>o==='applied').length===1
      &&(report.restart as any).applied===(report.restart as any).admitted&&(report.restart as any).exactlyOnce
      &&(report.slow as any).applied===SUBJECTS;
    report.pass=pass;report.database=database;
    writeFileSync(process.env.LOAD_REPORT??'/tmp/spark-load-report.json',JSON.stringify(report,null,1));
    console.log(pass?'LOAD_PASS':'LOAD_FAIL',JSON.stringify({p95:(report.healthy as any).p95,database}));
    if(!pass)process.exitCode=1;
  }finally{
    for(const c of children)c.kill('SIGTERM');proxy.close();await db.end().catch(()=>{});
  }
}
await main();
