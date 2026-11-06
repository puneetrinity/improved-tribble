/** Explicit local-only full-app browser rehearsal. No production or paid calls.
 * Run after build with S2_BROWSER_DISPOSABLE=1, S2_FLOW_TEST_ADMIN_URL and
 * S2_MEMORY_TEMPLATE (a fresh 44-migration disposable Memory template).
 * Databases are retained. Only provider/email adapters are synthetic; product
 * routes, authentication, CSRF, workers, SQL and signed Memory calls are real.
 */
import {fork,spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {request as httpsRequest} from 'node:https';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {chromium} from 'playwright';

const copy='bb133dc6ab8120ad2e866bacec8253eb163415a7d215a80d6fc447c1ea23ac5e';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function serve(){
  if(process.env.S2_BROWSER_DISPOSABLE!=='1'||process.env.NODE_ENV!=='test')throw Error('disposable_only');
  const net=await import('node:net');
  const connect=net.Socket.prototype.connect;
  net.Socket.prototype.connect=function(...args:any[]){
    const options=Array.isArray(args[0])?args[0][0]:args[0];
    const host=typeof options==='object'?options.host??options.hostname:typeof args[1]==='string'?args[1]:'localhost';
    if(host&&!['127.0.0.1','localhost','::1'].includes(host))throw Error('rehearsal_external_network_refused');
    return (connect as any).apply(this,args);
  } as any;
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin==='https://api.reversecontact.com'&&url.pathname==='/v2/enrich/persons'){
      process.send?.({kind:'rc_call'});
      return new Response(JSON.stringify({success:true,error:null,quotas:{creditsConsumed:2},data:{isFullProfile:true,alternativePersons:[],
        person:{linkedinUrl:'https://linkedin.com/in/spark-rehearsal',firstName:'Synthetic',lastName:'Candidate',headline:'Backend Engineer',
          skills:['Python'],experience:[{companyName:'Synthetic Employer',title:'Engineer',startEndDate:{start:'2020',end:null}}],education:[],
          location:{country:'India',countryCode:'IN',city:'Bengaluru'}}}}));
    }
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('rehearsal_external_fetch_refused');
    return realFetch(input,init);
  };
  const nodemailer=(await import('nodemailer')).default;
  nodemailer.createTestAccount=async()=>({user:'synthetic',pass:'synthetic'}) as any;
  nodemailer.createTransport=(()=>({sendMail:async(message:any)=>{
    const match=String(message.text).match(/http:\/\/127\.0\.0\.1:\d+\/verify-email\/[a-f0-9]+/);
    if(match)process.send?.({kind:'verification',url:match[0]});
    return {messageId:'synthetic-only'};
  }})) as any;
  await import('../dist/index.js');
}

async function main(){
  if(process.env.S2_BROWSER_DISPOSABLE!=='1')throw Error('disposable_only');
  const adminUrl=new URL(process.env.S2_FLOW_TEST_ADMIN_URL??'');
  if(adminUrl.hostname!=='127.0.0.1'||adminUrl.pathname!=='/postgres')throw Error('disposable_database_required');
  const memoryTemplate=process.env.S2_MEMORY_TEMPLATE;
  if(!memoryTemplate||new URL(memoryTemplate).hostname!=='127.0.0.1')throw Error('disposable_memory_required');
  const suffix=randomUUID().replaceAll('-','').slice(0,10),database=`flow_schema_control_test_${suffix}`;
  const owner=`flow_schema_control_test_owner_${suffix}`,runtime=`flow_schema_control_test_runtime_${suffix}`,target=`browser-${suffix}`;
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
  await db.query('INSERT INTO candidate_consent_v2_copies VALUES(2,$1,true)',[copy]);
  await db.query("INSERT INTO candidate_source_lookup_budgets(period,starts_at,ends_at,credit_limit) VALUES('day',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',10),('month',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '30 days',20)");
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const port=5215,memoryPort=5216;
  const certDir=mkdtempSync('/tmp/spark-browser-tls-'),cert=`${certDir}/cert.pem`,certKey=`${certDir}/key.pem`;
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',certKey,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,NODE_ENV:'test',S2_BROWSER_DISPOSABLE:'1',S2_MEMORY_TEMPLATE:memoryTemplate,S2_MEMORY_PORT:String(memoryPort),
    S2_CONSENT_COPY_HASH:copy,JWT_ENABLED:'true',JWT_ALGORITHM:'RS256',JWT_ISSUER:'vantahire',SIGNAL_JWT_ISSUER:'signal',JWT_PUBLIC_KEY:pair.publicKey,
    JWT_LEEWAY_SECONDS:'5',VANTAHIRE_JWT_PRIVATE_KEY:pair.privateKey,ACTIVEKG_BASE_URL:`https://127.0.0.1:${memoryPort}`,
    NODE_EXTRA_CA_CERTS:cert,S2_MEMORY_TLS_CERT:cert,S2_MEMORY_TLS_KEY:certKey,
    CANDIDATE_PRIVACY_HMAC_ACTIVE_VERSION:'1',CANDIDATE_PRIVACY_HMAC_KEY_V1:Buffer.alloc(32,1).toString('base64'),
    CANDIDATE_PRIVACY_FLOW_ISSUER:'vantahire',CANDIDATE_PRIVACY_FLOW_ACTOR_ID:'vantahire-backend',CANDIDATE_PRIVACY_SIGNAL_ISSUER:'signal',CANDIDATE_PRIVACY_SIGNAL_ACTOR_ID:'signal-service',
    CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1',CANDIDATE_FOUNDATION_ENABLED:'true',CANDIDATE_FOUNDATION_DELIVERY_ENABLED:'true',CANDIDATE_PROFILE_ENABLED:'true',CANDIDATE_PROFILE_DELIVERY_ENABLED:'true',
    CANDIDATE_SPARK_ENABLED:'true',CANDIDATE_CONSENT_V2_ENABLED:'true',CANDIDATE_CONSENT_V2_DELIVERY_ENABLED:'true',CANDIDATE_CONSENT_V2_CAPTURE_ENABLED:'true',
    CANDIDATE_SOURCE_IMPORT_ENABLED:'true',CANDIDATE_LOOKUP_SOURCE_ENABLED:'true',CANDIDATE_SPARK_SIGNUP_ENABLED:'true',CANDIDATE_RC_API_KEY:'synthetic-local-only',
    SESSION_SECRET:'synthetic-browser-fixture-session-secret',DATABASE_URL:roleUrl(runtime),FLOW_SCHEMA_TARGET_ID:target,FLOW_SCHEMA_ENVIRONMENT:'development',
    HOST:'127.0.0.1',PORT:String(port),BASE_URL:`http://127.0.0.1:${port}`,ALLOWED_HOSTS:`127.0.0.1:${port}`,OUTREACH_HYGIENE_RECOVERY_ENABLED:'false',FLOW_CANDIDATE_PRIVACY_POLL_MS:'5000'};
  const children:ChildProcess[]=[];let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  let diagnosticPage:import('playwright').Page|undefined;
  let verification='',rcCalls=0;const browserErrors:string[]=[];
  const waitReady=async(url:string)=>{for(let i=0;i<60;i++){
    if(children.some(child=>child.exitCode!==null))throw Error('rehearsal_child_exited');
    try{const ok=url.startsWith('https:')?await new Promise<boolean>((resolve,reject)=>{
      const req=httpsRequest(url,{ca:readFileSync(cert),timeout:1000},res=>{res.resume();resolve(res.statusCode===200);});
      req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));req.end();
    }):(await fetch(url,{signal:AbortSignal.timeout(1000)})).ok;if(ok)return;}catch{}await delay(500);
  }throw Error('startup_timeout');};
  try{
    const memory=spawn('/home/ews/active-graph-kg/venv/bin/python',['scripts/rehearse_spark_browser.py'],{cwd:'/home/ews/candidate-s2-memory',env,stdio:['ignore','pipe','pipe']});children.push(memory);
    memory.stdout?.on('data',chunk=>process.stdout.write(chunk));memory.stderr?.on('data',chunk=>process.stderr.write(chunk));
    await waitReady(`https://127.0.0.1:${memoryPort}/_rehearsal/ready`);
    const app=fork(fileURLToPath(import.meta.url),['--serve'],{env,execArgv:['--import','tsx'],silent:true});children.push(app);
    app.on('message',(message:any)=>{if(message.kind==='verification')verification=message.url;if(message.kind==='rc_call')rcCalls++;});
    app.stdout?.on('data',chunk=>process.stdout.write(chunk));app.stderr?.on('data',chunk=>process.stderr.write(chunk));
    await waitReady(`http://127.0.0.1:${port}/healthz`);
    browser=await chromium.launch({headless:true});const context=await browser.newContext();
    await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    const page=await context.newPage();diagnosticPage=page;page.setDefaultTimeout(60_000);
    page.on('pageerror',error=>{browserErrors.push(error.message);console.error('BROWSER_ERROR',error.message);});
    await page.goto(`http://127.0.0.1:${port}/candidate-auth`);
    await page.getByRole('button',{name:'Decline',exact:true}).click();
    await page.locator('#su-email').fill(`browser-${suffix}@example.invalid`);
    await page.locator('#su-password').fill('SyntheticPassword42!');
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await page.getByRole('dialog').getByRole('checkbox').check();
    await page.getByRole('button',{name:'Agree and continue',exact:true}).click();
    for(let i=0;i<60&&!verification;i++)await delay(500);
    if(!verification)throw Error('verification_email_not_captured');
    await page.goto(verification);
    const verified=page.waitForResponse(response=>response.url().includes('/api/verify-email/'));
    await page.getByRole('button',{name:'Verify Email',exact:true}).click();
    if((await verified).status()!==200)throw Error('email_verification_failed');
    await page.goto(`http://127.0.0.1:${port}/candidate-auth#signin`);
    await page.locator('#si-email').fill(`browser-${suffix}@example.invalid`);
    await page.locator('#si-password').fill('SyntheticPassword42!');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:"Let's start",exact:true}).click();
    await page.getByRole('button',{name:'Yes, this is me',exact:true}).waitFor({timeout:90_000});
    await page.getByRole('button',{name:'Yes, this is me',exact:true}).click();
    await page.getByRole('button',{name:'Next: the roles you want',exact:true}).click();
    await page.getByPlaceholder('e.g. Backend engineer').fill('Backend Engineer');
    await page.getByPlaceholder('e.g. Backend engineer').press('Enter');
    await page.getByRole('button',{name:"Next: where you'll work",exact:true}).click();
    await page.getByRole('button',{name:'Remote',exact:true}).click();
    await page.getByRole('button',{name:'Permanent',exact:true}).click();
    await page.getByRole('radio',{name:'No',exact:true}).click();
    await page.getByRole('button',{name:'Next: pay',exact:true}).click();
    await page.getByRole('button',{name:'Open to discussing pay',exact:true}).click();
    await page.getByRole('button',{name:'Next: review',exact:true}).click();
    await page.getByRole('button',{name:'Confirm profile',exact:true}).click();
    await page.waitForURL('**/my-dashboard?welcome=1',{timeout:90_000});
    const saved=await page.evaluate(async()=>{const r=await fetch('/api/candidate/product/profile');if(!r.ok)throw Error('profile_read_failed');return r.json();});
    if(saved.profileVersion!==1||saved.confirmedProfile?.displayName!=='Synthetic Candidate'||rcCalls!==1)
      throw Error('confirmed_profile_mismatch');
    await page.reload();
    await page.getByRole('button',{name:'My profile',exact:true}).click();
    await page.getByText('Synthetic Candidate',{exact:true}).first().waitFor();
    await page.setViewportSize({width:390,height:844});await page.reload();
    await page.getByRole('button',{name:'My profile',exact:true}).click();
    await page.getByText('Synthetic Candidate',{exact:true}).first().waitFor();
    if(browserErrors.length||rcCalls!==1)throw Error('browser_reload_regression');
    console.log('REHEARSAL_PASS',JSON.stringify({database,rcCalls,profileVersion:saved.profileVersion,verificationReceived:!!verification,
      desktopReload:true,mobileReload:true,browserErrors:browserErrors.length,
      synthetic:['email','RC'],notExercised:['resume','AI','recruiter-browser']}));
  }catch(error){
    if(diagnosticPage)console.error('BROWSER_FAILURE_STATE',await diagnosticPage.locator('body').innerText().catch(()=>''));
    throw error;
  }finally{
    await browser?.close();for(const child of children)child.kill('SIGTERM');
    await Promise.all(children.map(child=>new Promise<void>(r=>{if(child.exitCode!==null)return r();child.once('exit',()=>r());setTimeout(()=>{child.kill('SIGKILL');r();},5000).unref();})));
    await db.end();
  }
}
await (process.argv.includes('--serve')?serve():main());
