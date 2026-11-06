/** Budget-exhausted rehearsal (Claude, 6 Nov 2026): copy of rehearse-spark-journeys.ts with the shared AI
 * allowance at zero calls. Checks that résumé reading and AI help are refused before any model call, the
 * candidate sees the right message, and chips, manual notes and confirming the profile still work.
 * Derived from: Journeys rehearsal (Claude, 4 Nov 2026), derived from Codex's rehearse-spark-browser.ts with the same
 * safety checks. Adds local-only stand-ins for the AI model (local HTTP server via GROQ_BASE_URL) and file
 * storage (in-memory bucket), then drives: AI correction ("Fix it, this is me") -> résumé upload/read/review
 * -> deal-breaker chip + AI private note -> confirm -> desktop + mobile reload.
 * Original header follows.
 * Explicit local-only full-app browser rehearsal. No production or paid calls.
 * Run after build with S2_BROWSER_DISPOSABLE=1, S2_FLOW_TEST_ADMIN_URL and
 * S2_MEMORY_TEMPLATE (a fresh 44-migration disposable Memory template).
 * Databases are retained. Only provider/email adapters are synthetic; product
 * routes, authentication, CSRF, workers, SQL and signed Memory calls are real.
 */
import {fork,spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {request as httpsRequest} from 'node:https';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {chromium} from 'playwright';
const IMPACT='Rebuilt the payouts service and cut failed settlements by 40%';

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
          skills:['Python'],experience:[{companyName:'Synthetic Employer',title:'Engineer',startEndDate:{start:'2020-01-01T00:00:00.000Z',end:null}}],education:[],
          location:{country:'India',countryCode:'IN',city:'Bengaluru'}}}}));
    }
    if(url.origin==='https://vision.googleapis.com'&&url.pathname==='/v1/files:annotate'){
      const req=JSON.parse(String(init?.body));const pages:number[]=req.requests[0].pages;process.send?.({kind:'ocr_call',pages:pages.length});
      return new Response(JSON.stringify({responses:[{responses:pages.map(n=>({context:{pageNumber:n},
        fullTextAnnotation:{text:'Synthetic Candidate\nBackend Engineer at Synthetic Employer since 2020\nSkills: Kafka, Terraform'}}))}]}));
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
  const {GoogleAuth}=await import('google-auth-library');
  (GoogleAuth.prototype as any).getClient=async()=>({getAccessToken:async()=>({token:'synthetic-local-only'})});
  // Fail-once injection for the hard path (S2_FAIL_ONCE=resume,exclusions).
  const failOnce=new Set((process.env.S2_FAIL_ONCE??'').split(',').filter(Boolean));
  // In-memory bucket. Only methods the product uses; unknown methods throw.
  const {Storage}=await import('@google-cloud/storage');const objects=new Map<string,Buffer>();
  (Storage.prototype as any).bucket=function(){return {file:(name:string)=>({
    save:async(data:Buffer)=>{objects.set(name,Buffer.from(data));process.send?.({kind:'object_saved'});},
    getMetadata:async()=>{const b=objects.get(name);if(!b)throw Object.assign(Error('No such object'),{code:404});return [{generation:'1',size:String(b.length)}];},
    createReadStream:()=>{const b=objects.get(name);if(!b)throw Error('No such object');return Readable.from([b]);},
    exists:async()=>[objects.has(name)],delete:async()=>{objects.delete(name);},
    download:async()=>{const b=objects.get(name);if(!b)throw Error('No such object');return [b];},
  })};};
  // Local model stand-in. Answers only the three prompts the journeys use, with grounded, schema-valid JSON.
  const reply=(system:string,user:string):string=>{
    const kind=system.startsWith('You extract')?'resume':system.startsWith('Interpret')?(JSON.parse(user).use==='private_exclusions'?'exclusions':'other'):'other';
    if(failOnce.delete(kind)){process.send?.({kind:'injected_failure',what:kind});throw Error('injected_failure_'+kind);}
    if(system.startsWith('You extract professional facts')){
      const line=user.split('\n').find(l=>l.includes('Kafka'));if(!line)throw Error('stub_resume_text_missing');
      return JSON.stringify({facts:[{kind:'skill',value:'Kafka',evidence:[{quote:line.trim()}]}],notes:[]});
    }
    if(system.startsWith('Interpret candidate text')){
      const req=JSON.parse(user);
      if(req.use==='source_correction'){
        const old=(req.source?.facts??[]).find((f:any)=>f.kind==='headline'&&f.targetRowId===null);
        if(!old)return JSON.stringify({status:'cannot_help',reason:'insufficient_evidence'});
        return JSON.stringify({status:'proposal',summary:'Change your headline to Senior Backend Engineer',
          changes:[{kind:'source_correction',fact:{...old,value:'Senior Backend Engineer'}}]});
      }
      if(req.use==='private_exclusions')return JSON.stringify({status:'proposal',summary:'Keep this as a private note',
        changes:[{kind:'preference_section',answer:{section:'private_notes',answered:true,value:[req.text]}}]});
      return JSON.stringify({status:'cannot_help',reason:'unsupported'});
    }
    throw Error('stub_unknown_prompt');
  };
  await new Promise<void>(ok=>createServer((rq,rs)=>{let body='';rq.on('data',c=>body+=c);rq.on('end',()=>{
    try{
      if(rq.method!=='POST'||rq.url!=='/openai/v1/chat/completions')throw Error('stub_unknown_path');
      const b=JSON.parse(body),system=b.messages.find((m:any)=>m.role==='system').content,user=b.messages.find((m:any)=>m.role==='user').content;
      const content=reply(system,user);process.send?.({kind:'model_call',prompt:system.slice(0,24)});
      rs.writeHead(200,{'content-type':'application/json'});
      rs.end(JSON.stringify({id:'stub',object:'chat.completion',created:0,model:b.model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],
        usage:{prompt_tokens:100,completion_tokens:60,total_tokens:160}}));
    }catch(e){if(!String(e).includes('injected_failure'))process.send?.({kind:'model_error',message:String(e)});rs.writeHead(500);rs.end('{}');}
  });}).listen(Number(process.env.S2_MODEL_PORT),'127.0.0.1',ok));
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
  // B2 fixed: no test-only grants; the runtime role has exactly what the real provisioner gives it.
  await db.query('INSERT INTO candidate_consent_v2_copies VALUES(2,$1,true)',[copy]);
  // Local provider stand-in only: explicit synthetic pricing, never live setup.
  await db.query('UPDATE candidate_source_ai_policy SET enabled=true,candidate_day_calls=0');
  await db.query("INSERT INTO candidate_source_ocr_prices VALUES('test-ocr',1500,'2020-01-01','2099-01-01','synthetic fixture')");
  await db.query("INSERT INTO candidate_source_ai_prices VALUES('browser-synthetic-v1','openai/gpt-oss-120b',1,1,'2020-01-01','2099-01-01','Synthetic browser provider; not a live price')");
  await db.query(`INSERT INTO candidate_source_budget_windows(kind,period,starts_at,ends_at,global_units,per_candidate_units)
    SELECT k,p,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',100000,100000
    FROM unnest(ARRAY['ocr','semantic_model']) k CROSS JOIN unnest(ARRAY['day','month']) p`);
  await db.query("INSERT INTO candidate_source_interpretation_budgets SELECT p,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',1000000,1000000,100,100 FROM unnest(ARRAY['day','month']) p");
  await db.query("INSERT INTO candidate_source_lookup_budgets(period,starts_at,ends_at,credit_limit) VALUES('day',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',10),('month',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '30 days',20)");
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const port=5225,memoryPort=5226,modelPort=5227;
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
    CANDIDATE_RESUME_SOURCE_ENABLED:'true',CANDIDATE_INTERPRETATION_ENABLED:'true',CANDIDATE_INTERPRETATION_INPUT_TOKENS:'10000',
    CANDIDATE_INTERPRETATION_OUTPUT_TOKENS:'1000',CANDIDATE_INTERPRETATION_TTL_MS:'86400000',S2_MODEL_PORT:String(modelPort),
    GROQ_API_KEY:'synthetic-local-only',GOOGLE_VISION_OCR_ENABLED:'true',S2_FAIL_ONCE:process.env.S2_JOURNEY==='hard'?'resume,exclusions':'',GROQ_BASE_URL:`http://127.0.0.1:${modelPort}`,
    GCS_PROJECT_ID:'synthetic-local-only',GCS_BUCKET_NAME:'synthetic-local-bucket',
    GCS_SERVICE_ACCOUNT_KEY:JSON.stringify({type:'service_account',project_id:'synthetic-local-only',client_email:'synthetic@example.invalid',private_key:pair.privateKey}),
    SESSION_SECRET:'synthetic-browser-fixture-session-secret',DATABASE_URL:roleUrl(runtime),FLOW_SCHEMA_TARGET_ID:target,FLOW_SCHEMA_ENVIRONMENT:'development',
    HOST:'127.0.0.1',PORT:String(port),BASE_URL:`http://127.0.0.1:${port}`,ALLOWED_HOSTS:`127.0.0.1:${port}`,OUTREACH_HYGIENE_RECOVERY_ENABLED:'false',FLOW_CANDIDATE_PRIVACY_POLL_MS:'5000'};
  const children:ChildProcess[]=[];let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  let diagnosticPage:import('playwright').Page|undefined;
  let verification='',ocrCalls=0,injected=0,rcCalls=0,modelCalls=0,objectsSaved=0;const modelErrors:string[]=[];const browserErrors:string[]=[];
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
    app.on('message',(message:any)=>{if(message.kind==='verification')verification=message.url;if(message.kind==='rc_call')rcCalls++;if(message.kind==='ocr_call')ocrCalls++;if(message.kind==='injected_failure')injected++;if(message.kind==='model_call')modelCalls++;
      if(message.kind==='object_saved')objectsSaved++;if(message.kind==='model_error'){modelErrors.push(message.message);console.error('MODEL_STUB_ERROR',message.message);}});
    app.stdout?.on('data',chunk=>process.stdout.write(chunk));app.stderr?.on('data',chunk=>process.stderr.write(chunk));
    await waitReady(`http://127.0.0.1:${port}/healthz`);
    browser=await chromium.launch({headless:true});const context=await browser.newContext();
    await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    const page=await context.newPage();diagnosticPage=page;page.setDefaultTimeout(60_000);
    page.on('response',async r=>{if(/\/api\/candidate\/product\/(interpretations|exclusions|profile\/commands)/.test(r.url()))
      console.log('API',r.request().method(),new URL(r.url()).pathname,r.status(),(await r.text().catch(()=>'')).slice(0,300));});
    page.on('request',r=>{if(/\/interpretations$/.test(r.url()))console.log('API_REQ',(r.postData()??'').slice(0,400));});
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
    const step=async(name:string)=>{console.log('STEP',name);};
    const click=(name:string|RegExp)=>page.getByRole('button',{name,exact:typeof name==='string'}).click();
    await step('accept');
    await click('Yes, this is me');
    await step('resume_refused');
    await page.getByRole('heading',{name:'Add your résumé'}).waitFor();
    const pdfDir=mkdtempSync('/tmp/spark-browser-pdf-'),pdf=`${pdfDir}/resume.pdf`;
    writeFileSync(pdf,await new Promise<Buffer>(async ok=>{const PDF=(await import('pdfkit')).default;const d=new PDF();const parts:Buffer[]=[];
      d.on('data',c=>parts.push(c));d.on('end',()=>ok(Buffer.concat(parts)));
      d.text('Synthetic Candidate');d.text('Backend Engineer');d.text('Skills: Kafka, Go');d.end();}));
    await page.getByText('Saved privately').waitFor().catch(()=>undefined);
    await page.waitForFunction(()=>!(document.querySelector('input[type=file]') as HTMLInputElement)?.disabled);
    await page.locator('input[type=file]').setInputFiles(pdf);
    await page.getByText('resume.pdf').waitFor();await click('Continue');
    await page.getByRole('button',{name:'Fill in my profile myself'}).waitFor({timeout:120_000});
    const resumeText=await page.getByRole('alert').first().innerText().catch(()=>'');console.log('RESUME_REFUSED_UI',JSON.stringify(resumeText));
    await page.screenshot({path:`${pdfDir}/resume-refused.png`,fullPage:true});
    // 0030: an unpaid budget refusal uses no try; once budget is back, Try again reads the résumé.
    await step('budget_restored_retry');
    await db.query('UPDATE candidate_source_ai_policy SET candidate_day_calls=10');
    await click('Try again');
    await page.getByText('Kafka',{exact:true}).first().waitFor({timeout:120_000});
    await db.query('UPDATE candidate_source_ai_policy SET candidate_day_calls=1');
    await click(/^(Continue|Next: )/);
    await step('questions');
    await page.getByText(/^What did you do at /).first().or(page.getByRole('heading',{name:'Your skills'})).first().waitFor({timeout:60_000});
    for(let i=0;i<4&&await page.getByText(/^What did you do at /).first().isVisible().catch(()=>false);i++){await click('Continue');await page.waitForTimeout(800);}
    await page.getByRole('heading',{name:'Your skills'}).waitFor({timeout:30_000});
    await click('Next: the roles you want');
    await page.getByPlaceholder('e.g. Backend engineer').fill('Backend Engineer');
    await page.getByPlaceholder('e.g. Backend engineer').press('Enter');
    await click("Next: where you'll work");
    await click('Remote');await click('Permanent');
    await page.getByRole('radio',{name:'No',exact:true}).click();
    await click('Next: pay');await click('Open to discussing pay');await click('Next: deal-breakers');
    await step('chip_without_ai');
    await click('Require travel');await click('Exclude these');
    await page.getByRole('list',{name:'Hidden from your matches'}).waitFor();
    await step('ai_help_refused');
    await page.getByLabel('Or tell us in your own words').fill('No early-stage startups');
    await click('Show me the changes');
    await page.waitForTimeout(3000);
    const helpText=await page.locator('main').innerText();const helpLine=helpText.split('\n').find(l=>/didn|couldn|can't|isn't available|try again/i.test(l))??'';
    console.log('AI_HELP_REFUSED_UI',JSON.stringify(helpLine));
    await page.screenshot({path:`${pdfDir}/ai-help-refused.png`,fullPage:true});
    await step('confirm');
    await click('Review my profile');await click('Confirm profile');
    await page.waitForURL('**/my-dashboard?welcome=1',{timeout:90_000});
    await step('manual_note');
    await page.reload();await click('My profile');
    await page.getByRole('heading',{name:'Deal-breakers & private notes'}).waitFor();
    await page.getByRole('button',{name:'Edit deal-breakers & private notes'}).click();
    await page.getByLabel('Add a private note').fill('No on-call rotas');
    await page.getByRole('button',{name:'Add',exact:true}).click();
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),undefined,{timeout:60_000});
    await page.reload();await click('My profile');
    await page.getByText('No on-call rotas').first().waitFor({timeout:30_000});
    const saved=await page.evaluate(async()=>{const r=await fetch('/api/candidate/product/profile');return r.json();});
    const text=JSON.stringify(saved);
    const spend=(await db.query('SELECT count(*)::int n FROM candidate_source_ai_spend')).rows[0].n;
    const checks={oneModelCall:modelCalls===1,oneSpendRow:spend===1,resumeMessage:/can't read résumés right now/i.test(resumeText),
      noTryUsed:/Tries used: 0 of 3/.test(resumeText),
      aiBudgetCopy:/AI help isn't available right now/.test(helpLine),
      aiHelpMessage:helpLine.length>0,chipSaved:text.includes('no_travel'),manualNoteSaved:text.includes('No on-call rotas'),
      profileConfirmed:JSON.stringify(saved.confirmedProfile??'').length>4,rcCalls:rcCalls===1,modelErrors:modelErrors.length===0,browserErrors:browserErrors.length===0};
    console.log('CHECKS',JSON.stringify(checks));
    await page.setViewportSize({width:390,height:844});await page.reload();await click('My profile');
    await page.screenshot({path:`${pdfDir}/mobile-profile-budget.png`,fullPage:true});
    if(Object.values(checks).includes(false))throw Error('budget_journey_mismatch');
    console.log('REHEARSAL_PASS',JSON.stringify({journey:'budget',database,modelCalls,rcCalls,resumeText,helpLine,shots:pdfDir}));
  }catch(error){
    if(diagnosticPage)console.error('BROWSER_FAILURE_STATE',await diagnosticPage.locator('body').innerText().catch(()=>''));
    if(diagnosticPage)await diagnosticPage.screenshot({path:'/tmp/spark-budget-failure.png',fullPage:true}).catch(()=>undefined);
    throw error;
  }finally{
    await browser?.close();for(const child of children)child.kill('SIGTERM');
    await Promise.all(children.map(child=>new Promise<void>(r=>{if(child.exitCode!==null)return r();child.once('exit',()=>r());setTimeout(()=>{child.kill('SIGKILL');r();},5000).unref();})));
    await db.end();
  }
}
await (process.argv.includes('--serve')?serve():main());
