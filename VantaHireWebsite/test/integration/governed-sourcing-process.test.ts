/** Cross-system proofs require explicit local peer trees. Never discover an
 * operator DSN or read .env. External services stay behind the retained
 * harness's loopback fence. Local component tests are not substitutes. */
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,chmodSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const enabled=process.env.FLOW_SOURCING_PROCESS_DISPOSABLE==='1';
const execFileAsync=promisify(execFile);
describe.skipIf(!enabled)('retained real-process privacy/history on the 5C Flow schema',()=>{
  let root:string,port:number,memory:string,python:string,started=false;
  const pg='/usr/lib/postgresql/16/bin';
  const cleanEnv:NodeJS.ProcessEnv={PATH:process.env.PATH,LANG:'C.UTF-8',HOME:process.env.HOME,
    UV_THREADPOOL_SIZE:'1',NODE_OPTIONS:'--max-old-space-size=2048',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',
    PYTHONDONTWRITEBYTECODE:'1',PYTEST_DISABLE_PLUGIN_AUTOLOAD:'1'};
  beforeAll(async()=>{
    memory=resolve(process.env.FLOW_SOURCING_MEMORY_ROOT??'');
    python=process.env.FLOW_SOURCING_MEMORY_PYTHON??'';
    if(!process.env.FLOW_SOURCING_MEMORY_ROOT||!python.startsWith('/')||!memory.startsWith('/home/ews/'))throw Error('EXPLICIT_LOCAL_PEER_REQUIRED');
    expect(execFileSync('git',['rev-parse','HEAD'],{cwd:memory,encoding:'utf8'}).trim()).toBe('9ed3a2a7dc128413bf66bc4368636623fe01f980');
    expect(execFileSync('git',['status','--porcelain'],{cwd:memory,encoding:'utf8'}).trim()).toBe('');
    root=mkdtempSync(join(tmpdir(),'ealana-4d-5b-retained-'));chmodSync(root,0o700);
    port=await new Promise<number>((yes,no)=>{const socket=net.createServer();socket.once('error',no);socket.listen(0,'127.0.0.1',()=>{const address=socket.address();if(!address||typeof address==='string')return no(Error('LOCAL_PORT_REQUIRED'));socket.close(()=>yes(address.port));});});
    execFileSync(join(pg,'initdb'),['-D',join(root,'pg'),'-U','fixture_admin_test','--auth-local=trust','--auth-host=trust','--no-locale','--encoding=UTF8'],{env:cleanEnv,stdio:'pipe'});
    execFileSync(join(pg,'pg_ctl'),['-D',join(root,'pg'),'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${root} -c max_connections=60 -c shared_buffers=32MB -c max_parallel_workers=0`,'-w','start'],{env:cleanEnv,stdio:'pipe'});
    started=true;
  },60000);
  afterAll(()=>{
    if(started)execFileSync(join(pg,'pg_ctl'),['-D',join(root,'pg'),'-m','fast','-w','stop'],{env:cleanEnv,stdio:'pipe'});
    if(root)console.info('Retained synthetic process evidence:',root);
  },60000);
  it.skipIf(Boolean(process.env.FLOW_SOURCING_PROCESS_ONLY)&&process.env.FLOW_SOURCING_PROCESS_ONLY!=='history')('retains all six real Flow-to-Memory history assertions under both owner kinds',async()=>{
    const flow=resolve('..');
    const env={...cleanEnv,ACTIVEKG_HISTORY_XS_DISPOSABLE:'1',ACTIVEKG_INDEX_XS_DISPOSABLE:'1',
      ACTIVEKG_INDEX_XS_FLOW_ROOT:flow,ACTIVEKG_INDEX_XS_ADMIN_DSN:`postgresql://fixture_admin_test@127.0.0.1:${port}/postgres`,
      // Constructor validation only; the real harness replaces these with its
      // own freshly created owner/runtime identities before opening either.
      FLOW_INDEX_TEST_OWNER_URL:`postgresql://flow_4d_test_placeholder_owner_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,
      FLOW_INDEX_TEST_RUNTIME_URL:`postgresql://flow_4d_test_placeholder_runtime_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,
      RETAINED_PROOF_ROOT:root};
    const script=String.raw`
import os,sys
import pytest
from tests import test_candidate_index_cross_system as index
original=index._node
def current_tail(path,root,dsn,body,**kwargs):
    old="if(result.applied.length!==14)throw Error('fixture_ledger');"
    if old in body:
        assert body.count(old)==1
        body=body.replace(old,"if(result.applied.length!==17)throw Error('fixture_ledger');")
    return original(path,root,dsn,body,**kwargs)
index._node=current_tail
# Only the exact new ledger tail changes. All six old process assertions,
# actors, privacy checks, worker restarts and network fences remain untouched.
raise SystemExit(pytest.main(['-q','-p','pytest_timeout','-p','no:cacheprovider',
    '--basetemp',os.path.join(os.environ['RETAINED_PROOF_ROOT'],'pytest'),
    'tests/test_organization_candidate_history_cross_system.py']))
`;
    const log=join(root,'history.log');
    try{
      // Keep Vitest's worker RPC responsive while the real processes run.
      const {stdout:output}=await execFileAsync(python,['-c',script],{cwd:memory,env,encoding:'utf8',timeout:900000,maxBuffer:8*1024*1024});
      writeFileSync(log,output,{mode:0o600});expect(output).toMatch(/6 passed/);
    }catch(error){
      const result=error as {stdout?:string;stderr?:string};writeFileSync(log,String(result.stdout??'')+String(result.stderr??''),{mode:0o600});
      throw Error(`Retained process proof failed; synthetic log: ${log}\n${readFileSync(log,'utf8').slice(-6000)}`);
    }
  },960000);
  it.skipIf(process.env.FLOW_SOURCING_PROCESS_ONLY!=='consent')('retains all nineteen 4C checks with the real Memory API',async()=>{
    const env={...cleanEnv,ACTIVEKG_INDEX_XS_FLOW_ROOT:resolve('..'),
      ACTIVEKG_INDEX_XS_ADMIN_DSN:`postgresql://fixture_admin_test@127.0.0.1:${port}/postgres`,
      FLOW_INDEX_TEST_OWNER_URL:`postgresql://flow_4d_test_placeholder_owner_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,
      FLOW_INDEX_TEST_RUNTIME_URL:`postgresql://flow_4d_test_placeholder_runtime_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,RETAINED_PROOF_ROOT:root};
    const script=String.raw`
import os,sys
from pathlib import Path
from tests import test_candidate_index_cross_system as index
original=index._node
def current_tail(path,root,dsn,body,**kwargs):
    old="if(result.applied.length!==14)throw Error('fixture_ledger');"
    if old in body: body=body.replace(old,"if(result.applied.length!==17)throw Error('fixture_ledger');")
    return original(path,root,dsn,body,**kwargs)
index._node=current_tail
class Stack(index.ProcessStack):
    def run(self,command,env,cwd=None,**kwargs):
        # The retained consent test names this local target explicitly. Bind
        # it at fresh initialization, never rewrite an installed identity.
        if 'scripts/init_railway_db.py' in command:
            env={**env,'ACTIVEKG_SCHEMA_TARGET_ID':'11111111-1111-4111-8111-111111111111'}
        return super().run(command,env,cwd,**kwargs)
p=Path(os.environ['RETAINED_PROOF_ROOT'])/'consent';p.mkdir(mode=0o700)
s=Stack(p,None)
try:
    s.bootstrap()
    from psycopg.conninfo import conninfo_to_dict
    from urllib.parse import quote
    c=conninfo_to_dict(s.owner.info.dsn)
    mo=f"postgresql://{c['user']}:{quote(c.get('password','owner-fixture'))}@127.0.0.1:{c['port']}/{c['dbname']}"
    s.run(['npm','run','test:candidate-consent:pg'],{
        'NODE_ENV':'test','FLOW_AUTHZ_TEST_DISPOSABLE':'1','FLOW_CONSENT_XS':'1',
        'FLOW_SCHEMA_TEST_DATABASE_URL':s.fo,'FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL':s.fr,
        'FLOW_CONSENT_XS_MEMORY_OWNER_URL':mo,'FLOW_CONSENT_XS_MEMORY_RUNTIME_URL':s.mr,
        'FLOW_CONSENT_XS_MEMORY_ROOT':str(s.memory),'FLOW_CONSENT_XS_PYTHON':sys.executable,
        'UV_THREADPOOL_SIZE':'1','NODE_OPTIONS':'--max-old-space-size=2048'},s.flow,timeout=240)
    print('RETAINED_CONSENT_19_PASS',flush=True)
finally:s.close()
`;
    const log=join(root,'consent.log');
    try{
      const {stdout,stderr}=await execFileAsync(python,['-c',script],{cwd:memory,env,encoding:'utf8',timeout:360000,maxBuffer:8*1024*1024});
      writeFileSync(log,stdout+stderr,{mode:0o600});expect(stdout).toContain('RETAINED_CONSENT_19_PASS');
    }catch(error){const e=error as {stdout?:string;stderr?:string};writeFileSync(log,String(e.stdout??'')+String(e.stderr??''),{mode:0o600});throw Error(`Retained consent failed: ${log}\n${readFileSync(log,'utf8').slice(-6000)}`);}
  },420000);
  it.skipIf(!process.env.FLOW_SOURCING_DISCOVER_ROOT||(Boolean(process.env.FLOW_SOURCING_PROCESS_ONLY)&&process.env.FLOW_SOURCING_PROCESS_ONLY!=='governed'))('runs an admitted search through real Flow, Discover, Redis and Memory processes',async()=>{
    const discover=resolve(process.env.FLOW_SOURCING_DISCOVER_ROOT!);
    expect(execFileSync('git',['rev-parse','HEAD'],{cwd:discover,encoding:'utf8'}).trim()).toBe('b7744ff330e88e7ba3b1a8eca1b09959803fe752');
    const env={...cleanEnv,ACTIVEKG_INDEX_XS_FLOW_ROOT:resolve('..'),
      ACTIVEKG_INDEX_XS_ADMIN_DSN:`postgresql://fixture_admin_test@127.0.0.1:${port}/postgres`,
      FLOW_INDEX_TEST_OWNER_URL:`postgresql://flow_4d_test_placeholder_owner_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,
      FLOW_INDEX_TEST_RUNTIME_URL:`postgresql://flow_4d_test_placeholder_runtime_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,
      RETAINED_PROOF_ROOT:root,GOVERNED_DISCOVER_ROOT:discover};
    const script=String.raw`
import os,sys,json,time,hashlib
from pathlib import Path
from uuid import uuid4
import httpx,psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from psycopg.conninfo import conninfo_to_dict,make_conninfo
from cryptography.hazmat.primitives import serialization
from tests import test_candidate_index_cross_system as index
original=index._node
def current_tail(path,root,dsn,body,**kwargs):
    old="if(result.applied.length!==14)throw Error('fixture_ledger');"
    if old in body: body=body.replace(old,"if(result.applied.length!==17)throw Error('fixture_ledger');")
    return original(path,root,dsn,body,**kwargs)
index._node=current_tail
class Stack(index.ProcessStack):
    def __init__(self,path):
        super().__init__(path,None)
        self.discover=Path(os.environ['GOVERNED_DISCOVER_ROOT'])
        self.dp,self.wp,self.tp=self.port(),self.port(),self.port()
        self.ports.extend([self.dp,self.wp,self.tp])
        self.base.update(UV_THREADPOOL_SIZE='1',NODE_OPTIONS='--max-old-space-size=2048')
    def start(self,command,env,cwd=None):
        # One generated fixture key serves both legitimate issuers. No auth
        # bypass, copied production key or fabricated JWT response.
        if env.get('JWT_PUBLIC_KEY'):
            env={**env,'SIGNAL_JWT_PUBLIC_KEY':env['JWT_PUBLIC_KEY'],
                'GLOBAL_MEMORY_ENABLED':'true','GLOBAL_PUBLIC_PROFILE_SEARCH_ENABLED':'true',
                'GLOBAL_LEGACY_CANDIDATE_SEARCH_ENABLED':'false'}
        return super().start(command,env,cwd)
    def governed(self):
        self.setup()
        self.stop(self.web);self.retired=[self.web]
        private=self.fe['VANTAHIRE_JWT_PRIVATE_KEY']
        public=serialization.load_pem_private_key(private.encode(),password=None).public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        dname='signal_5b_test_'+uuid4().hex[:8]
        self.admin.execute(sql.SQL('CREATE ROLE signal_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD {}').format(sql.Literal('fixture-only')))
        self.admin.execute(sql.SQL('CREATE DATABASE {} OWNER fixture_admin_test').format(sql.Identifier(dname)))
        self.owned_databases.append(dname);self.owned_roles.append('signal_runtime')
        cfg=conninfo_to_dict(os.environ['ACTIVEKG_INDEX_XS_ADMIN_DSN'])
        self.do='postgresql://fixture_admin_test@127.0.0.1:'+cfg['port']+'/'+dname
        self.dr='postgresql://signal_runtime:fixture-only@127.0.0.1:'+cfg['port']+'/'+dname
        se={'DIRECT_URL':self.do,'DATABASE_URL':self.do,'SIGNAL_SCHEMA_ENVIRONMENT':'development',
            'SIGNAL_SCHEMA_TARGET_ID':str(uuid4()),'SIGNAL_SCHEMA_DISPOSABLE_SINGLE_CREDENTIAL':'1',
            'SIGNAL_BOOTSTRAP_EMPTY_DATABASE':'1','SIGNAL_SCHEMA_ADOPT_EXISTING':'1',
            'SIGNAL_RUNTIME_DATABASE_URL':self.dr,'SIGNAL_RUNTIME_ROLE_PASSWORD':'fixture-only'}
        for cmd in ['scripts/bootstrap-empty-db.mjs','scripts/schema-control/adopt-existing.mjs','scripts/schema-control/provision-runtime-role.mjs']:
            self.run(['node',cmd],se,self.discover,timeout=240)
        self.provider_log=self.file('provider-calls.jsonl','')
        # tsx probes its parent's local IPC socket even when the parent is
        # Python. Permit only that exact nonexistent Unix path (ECONNREFUSED),
        # never an existing socket or an extra TCP destination.
        self.flow_fence.write_text(self.flow_fence.read_text().replace("if(host!=='127.0.0.1'", "if(a?.path===('/tmp/tsx-'+process.getuid()+'/'+process.ppid+'.pipe')&&!fs.existsSync(a.path))return original.apply(this,args); if(host!=='127.0.0.1'"))
        # next build folds NODE_ENV to production, so its callback correctly
        # requires HTTPS. Use a real verified loopback TLS endpoint, not a
        # product exception or NODE_TLS_REJECT_UNAUTHORIZED override.
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        from datetime import datetime,timedelta,timezone
        import ipaddress
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Disposable governed fixture')])
        now=datetime.now(timezone.utc)
        cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).sign(key,hashes.SHA256())
        certpath=self.file('loopback-ca.pem',cert.public_bytes(serialization.Encoding.PEM).decode())
        keypath=self.file('loopback-key.pem',key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode())
        self.public_url=f'https://127.0.0.1:{self.tp}'
        self.start(['node','--input-type=module','-e',"import https from 'node:https';import http from 'node:http';import fs from 'node:fs';https.createServer({key:fs.readFileSync(process.env.FIXTURE_TLS_KEY),cert:fs.readFileSync(process.env.FIXTURE_TLS_CERT)},(req,res)=>{const upstream=http.request(process.env.FIXTURE_UPSTREAM+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);}).listen(Number(process.env.FIXTURE_TLS_PORT),'127.0.0.1');"],
            {'FIXTURE_TLS_KEY':str(keypath),'FIXTURE_TLS_CERT':str(certpath),'FIXTURE_UPSTREAM':self.web_url,'FIXTURE_TLS_PORT':str(self.tp),'NODE_OPTIONS':'--max-old-space-size=128 --import='+str(self.flow_fence)})
        # Substitute only external HTTP, before SDK imports. All local network
        # calls go through the real servers. The retained socket fence rejects
        # every non-loopback socket, even if a provider escapes this wrapper.
        preload=self.file('paid-transport.mjs',r'''
import fs from 'node:fs';
const fetchReal=globalThis.fetch;
const digest={version:3,topSkills:['Python'],seniorityLevel:'senior',domain:'Software',constraints:[],keyResponsibilities:[],titleSearchTerms:['Backend Engineer'],adjacentBuckets:[],adjacentLocations:[],tokenCount:40};
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url??input);
 if(url.hostname==='127.0.0.1'){
   if(url.pathname.endsWith('/find-contact')&&process.env.FIXTURE_CONTACT_GATE){
     const gate=process.env.FIXTURE_CONTACT_GATE;
     fs.writeFileSync(gate+'.started','started');
     const deadline=Date.now()+30000;
     while(!fs.existsSync(gate+'.release')){if(Date.now()>deadline)throw Error('FIXTURE_CONTACT_GATE_TIMEOUT');await new Promise(r=>setTimeout(r,25));}
     fs.writeFileSync(gate+'.returned','returned');
     return Response.json({success:true,state:'found',emails:['synthetic@fixture.invalid']});
   }
   try {
     const response=await fetchReal(input,init);
     if(url.pathname.includes('/source'))fs.appendFileSync(process.env.FIXTURE_PROVIDER_LOG,JSON.stringify({kind:'local-source',path:url.pathname,status:response.status,body:await response.clone().text()})+'\n');
     return response;
   }catch(error){fs.appendFileSync(process.env.FIXTURE_PROVIDER_LOG,JSON.stringify({kind:'local-error',path:url.pathname,code:String(error),cause:String(error.cause)})+'\n');throw error;}
 }
 if(url.hostname==='api.groq.com'){
   fs.appendFileSync(process.env.FIXTURE_PROVIDER_LOG,JSON.stringify({kind:'digest'})+'\n');
   return Response.json({id:'fixture',object:'chat.completion',created:1,model:'fixture',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(digest)}}],usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140}});
 }
 if(url.href==='https://api.crustdata.com/person/search'){
   const body=JSON.parse(init.body),headers=new Headers(init.headers);
   if(headers.get('x-api-version')!=='2025-11-01')throw Error('FIXTURE_API_VERSION');
   fs.appendFileSync(process.env.FIXTURE_PROVIDER_LOG,JSON.stringify({kind:'crustdata',body})+'\n');
   if(body.limit===300&&process.env.FIXTURE_ACQUISITION_FAIL==='1')throw Error('fixture-provider-timeout-after-dispatch');
   const profiles=process.env.FIXTURE_ACQUISITION_FAIL==='2'?['2020-01-01','2015-01-01','2005-01-01',null].map((start,index)=>({
     crustdata_person_id:951001+index,basic_profile:{name:index?'Synthetic Range Fixture '+index:'Synthetic Backend Fixture',headline:'Senior Backend Engineer',current_title:'Senior Backend Engineer',summary:'Python backend services and PostgreSQL',location:{city:'Bengaluru',country:'India',full_location:'Bengaluru, India'}},
     skills:{professional_network_skills:['Python','PostgreSQL']},years_of_experience_raw:6,
     experience:{employment_details:{current:start?[{company_name:'Fixture Systems',title:'Senior Backend Engineer',start_date:start,description:'Build Python backend services'}]:[]}},
     social_handles:{professional_network_identifier:{profile_url:'https://www.linkedin.com/in/synthetic-governed-fixture-'+index}}
   })):[];
   const returned=profiles.slice(0,body.limit);
   return Response.json({profiles:returned,total_count:profiles.length},{headers:{'X-Credits-Used':String(returned.length*0.03)}});
 }
 fs.appendFileSync(process.env.FIXTURE_FORBIDDEN,'unexpected-fetch\n');
 throw Error('FIXTURE_EXTERNAL_FETCH_REFUSED');
};
''')
        # The shipped Groq SDK defaults to node-fetch. Its documented web shim
        # selects our fenced fetch transport, without replacing SDK behavior.
        options='--max-old-space-size=2048 --import='+str(self.flow_fence)+' --import='+str(preload)+' --import='+str(self.flow/'node_modules/groq-sdk/shims/web.mjs')
        de={'NODE_ENV':'production','DATABASE_URL':self.dr,'SIGNAL_SCHEMA_ENVIRONMENT':'development','SIGNAL_SCHEMA_TARGET_ID':se['SIGNAL_SCHEMA_TARGET_ID'],
            'REDIS_URL':f'redis://127.0.0.1:{self.redisport}/0','FLOW_SOURCING_V1_ENABLED':'true',
            'VANTAHIRE_JWT_PUBLIC_KEY':public,'SIGNAL_JWT_PRIVATE_KEY':private,'SIGNAL_JWT_ACTIVE_KID':'v1',
            'ACTIVEGRAPH_URL':self.api_url,'CRUSTDATA_API_KEY':'fixture-only','GROQ_API_KEY':'fixture-only',
            'SOURCE_PUBLIC_MEMORY_HYDRATION_ENABLED':'true','SOURCE_PLATFORM_EXCLUSION_ENABLED':'true',
            'SOURCE_TWO_LAYER_POOL_ENABLED':'true','SOURCE_RERANK_AFTER_ENRICHMENT':'false','TRACK_GROQ_ENABLED':'false',
            'SOURCE_PUBLIC_MEMORY_INGEST_WORKER_ENABLED':'false','SOURCING_WORKER_CONCURRENCY':'1',
            'SOURCING_CALLBACK_REDELIVERY_ENABLED':'false','SIGNAL_CANDIDATE_PRIVACY_POLL_MS':'5000',
            'NODE_OPTIONS':options,'FIXTURE_PROVIDER_LOG':str(self.provider_log),'FIXTURE_FORBIDDEN':str(self.forbidden),
            'NEXT_TELEMETRY_DISABLED':'1','NODE_EXTRA_CA_CERTS':str(certpath),
            'FIXTURE_ACQUISITION_FAIL':os.environ.get('FIXTURE_ACQUISITION_FAIL','0')}
        self.run(['node','scripts/schema-control/schema-ready.mjs'],de,self.discover)
        self.api=self.start(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',str(self.dp)],de,self.discover)
        self.worker=self.start(['node','--import','tsx','src/lib/sourcing/worker.ts'],{**de,'PORT':str(self.wp)},self.discover)
        self.fe.update({'FLOW_JOB_BRIEF_ENABLED':'true','FLOW_SOURCING_V1_ENABLED':'true','BASE_URL':self.public_url,
            'CONTACT_RESOLUTION_RECOVERY_ENABLED':'true',
            'SIGNAL_BASE_URL':f'http://127.0.0.1:{self.dp}','SIGNAL_JWT_PUBLIC_KEY':public,'GROQ_API_KEY':'fixture-only',
            'NODE_OPTIONS':options,'FIXTURE_PROVIDER_LOG':str(self.provider_log),'FIXTURE_FORBIDDEN':str(self.forbidden),
            'FIXTURE_CONTACT_GATE':str(self.path/'contact-gate')})
        self.restart_web()
        with psycopg.connect(self.fo,autocommit=True) as flow,psycopg.connect(self.do,autocommit=True) as discover:
            org,actor,email,job=self.seed_job(flow)
            flow.execute('UPDATE users SET onboarding_completed_at=clock_timestamp() WHERE id=%s',(actor,))
            tenant='org_'+str(org)
            flow.execute('UPDATE organizations SET signal_tenant_id=%s WHERE id=%s',(tenant,org))
            # Explicit disposable operator entitlement, not simulated billing.
            plan=flow.execute("INSERT INTO subscription_plans(name,display_name,price_per_seat_monthly,price_per_seat_annual,ai_credits_per_seat_monthly,features) VALUES(%s,'Fixture',899900,899900,0,'{}') RETURNING id",('fixture-'+str(org),)).fetchone()[0]
            sub=flow.execute("INSERT INTO organization_subscriptions(organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end) VALUES(%s,%s,1,1,'monthly','active','2026-01-01','2026-01-01','2030-01-01') RETURNING id",(org,plan)).fetchone()[0]
            ent=str(uuid4())
            flow.execute("INSERT INTO sourcing_entitlements(id,organization_id,subscription_id,anchor,valid_from,valid_until,capacity,origin,evidence_sha256) VALUES(%s,%s,%s,'2026-01-01Z','2026-01-01Z','2030-01-01Z',1,'verified_paid',%s)",(ent,org,sub,'a'*64))
            flow.execute('SELECT flow_sourcing_enable(%s,%s)',(org,ent))
            discover.execute('INSERT INTO governed_sourcing_tenants(tenant_id,enabled_at,policy_hash,allow_new,organization_ref,callback_url) VALUES(%s,clock_timestamp(),%s,true,%s,%s)',(tenant,'a'*64,str(org),self.public_url+'/api/webhooks/signal/callback'))
            self.privacy_fresh(flow)
            self.wait(lambda: discover.execute("SELECT count(*) FROM candidate_privacy_sync_state WHERE status='healthy' AND last_success_at>clock_timestamp()-interval '1 minute'").fetchone()[0]==1)
            with httpx.Client(base_url=self.web_url,trust_env=False,timeout=20) as client:
                self.login(client,email)
                jd='Build reliable Python backend services and maintain production software.'
                flow.execute('UPDATE jobs SET original_jd=%s,description=%s WHERE id=%s',(jd,jd,job))
                body={'action':'save_brief','currentJD':jd,'sourceChoice':'original_prose','requesterKind':'recruiter','reasonCode':'other',
                    'payload':{'schemaVersion':2,'compilerVersion':2,'taxonomyVersion':2,'criteria':[
                        {'id':str(uuid4()),'label':'Python','class':'must_have','subject':'skill','requirement':{'kind':'text','value':'Python'},'use':'assessment','evidenceKinds':['profile_evidence'],'provenance':{'kind':'recruiter_edit'}},
                        {'id':str(uuid4()),'label':'Backend role','class':'preferred','subject':'title','requirement':{'kind':'accepted_titles','values':['Backend Engineer','Backend Developer']},'use':'assessment','evidenceKinds':['profile_evidence'],'provenance':{'kind':'recruiter_edit'}},
                        {'id':str(uuid4()),'label':'Recorded experience','class':'must_have','subject':'experience_years','requirement':{'kind':'experience_range','minimum':6,'maximum':10},'use':'assessment','evidenceKinds':['profile_evidence'],'provenance':{'kind':'recruiter_edit'}}]}}
                saved=flow.execute('SELECT flow_job_brief_save(%s,%s,%s,%s,0,%s)',(org,job,actor,str(uuid4()),Jsonb(body))).fetchone()[0]
                approval=self.post(client,f'/api/jobs/{job}/brief/approve',json={'requestId':str(uuid4()),'expectedRevision':1,'versionId':saved['versionId']})
                assert approval.status_code==200,(approval.status_code,approval.text)
                def quote():
                    r=client.get(f'/api/jobs/{job}/sourcing/admission')
                    preparations=flow.execute('SELECT state,result FROM sourcing_digest_requests WHERE job_id=%s',(job,)).fetchall()
                    assert not any(p[0] in ('failed','unknown') for p in preparations),preparations
                    assert r.status_code==200 or r.json().get('code') in ('SOURCING_PREPARING','SOURCING_DIGEST_REQUIRED','SOURCING_ARTIFACT_REQUIRED'),(r.status_code,r.text)
                    return r.json() if r.status_code==200 else None
                self.wait(lambda: quote() and quote().get('quoteToken'),seconds=90)
                q=quote();print('REAL_QUOTE',sorted(q.keys()),flush=True)
                def browser(phase):
                    fixture=self.file('browser-'+phase+'.json',json.dumps({'job':job,'email':email,'phase':phase,
                        'nonempty':os.environ.get('FIXTURE_ACQUISITION_FAIL')=='2'}))
                    config=self.file('playwright-'+phase+'.mjs',
                        "import {defineConfig,devices} from '@playwright/test';export default defineConfig("+
                        "{testDir:"+json.dumps(str(self.flow/'test/e2e'))+",testMatch:'governed-sourcing.spec.ts',workers:1,retries:0,timeout:45000,reporter:'line',"+
                        "outputDir:"+json.dumps(str(self.path/('browser-'+phase)))+",use:{baseURL:"+json.dumps(self.web_url)+"},projects:[{name:'Desktop',use:{...devices['Desktop Chrome']}},{name:'Mobile',use:{...devices['Pixel 5']}}]});")
                    self.run(['node',self.flow/'node_modules/@playwright/test/cli.js','test','--config',config]+(['--project=Desktop'] if phase=='confirm' else []),
                        {'FLOW_SOURCING_BROWSER_DISPOSABLE':'1','FLOW_SOURCING_BROWSER_FIXTURE':str(fixture),
                         'PLAYWRIGHT_BROWSERS_PATH':str(Path.home()/'.cache/ms-playwright'),'UV_THREADPOOL_SIZE':'1','NODE_OPTIONS':'--max-old-space-size=2048'},timeout=180)
                browser('before')
                # Both viewports reviewed/cancelled without spending. The real
                # browser Confirm, not a harness POST, creates the admission.
                browser('confirm')
                body=json.loads((self.path/'browser-confirm.json.command.json').read_text())
                again=self.post(client,f'/api/jobs/{job}/find-candidates',json=body)
                assert again.status_code in (200,202),(again.status_code,again.text)
                failed=os.environ.get('FIXTURE_ACQUISITION_FAIL')=='1'
                expected_status='failed' if failed else 'complete'
                self.wait(lambda: discover.execute('SELECT count(*) FROM job_sourcing_requests WHERE "tenantId"=%s AND status=%s',(tenant,expected_status)).fetchone()[0]==1,seconds=120)
                self.wait(lambda: flow.execute('SELECT captured FROM sourcing_allowance_windows WHERE organization_id=%s',(org,)).fetchone()[0]==1)
                assert flow.execute('SELECT count(*) FROM sourcing_admissions WHERE organization_id=%s',(org,)).fetchone()[0]==1
                if not failed:
                    # Discover commits completion before its HTTP callback;
                    # observe the independent delivery boundary explicitly.
                    self.wait(lambda: flow.execute('SELECT count(*) FROM sourcing_deliveries WHERE organization_id=%s',(org,)).fetchone()[0]==1)
                    if os.environ.get('FIXTURE_ACQUISITION_FAIL')=='2':
                        assert flow.execute('SELECT count(*) FROM sourcing_delivery_items WHERE organization_id=%s',(org,)).fetchone()[0]==2
                        assert discover.execute('SELECT count(*) FROM governed_ranking_items WHERE tenant_id=%s',(tenant,)).fetchone()[0]==4
                        assert discover.execute('SELECT eligibility_code FROM governed_ranking_items WHERE tenant_id=%s AND selected_ordinal IS NOT NULL ORDER BY selected_ordinal',(tenant,)).fetchall()==[('in_range',),('wider',)]
                calls=[json.loads(x) for x in self.provider_log.read_text().splitlines()]
                assert len([x for x in calls if x['kind']=='digest'])==1,calls
                assert len([x for x in calls if x['kind']=='crustdata' and x['body']['limit']==300])==1,calls
                assert self.forbidden.read_text()==''
                browser('after')
                if os.environ.get('FIXTURE_ACQUISITION_FAIL')=='2':
                    cid,revision=flow.execute('SELECT id,decision_revision FROM job_sourced_candidates WHERE organization_id=%s ORDER BY id LIMIT 1',(org,)).fetchone()
                    before_order=flow.execute('SELECT ordinal,signal_candidate_id FROM sourcing_delivery_items WHERE organization_id=%s ORDER BY ordinal',(org,)).fetchall()
                    def decide(action,rev):
                        response=client.patch(f'/api/jobs/{job}/sourced-candidates/{cid}',headers=self.csrf(client),json={
                            'requestId':str(uuid4()),'action':action,'expectedRevision':rev})
                        assert response.status_code==200,(response.status_code,response.text)
                        return response.json()
                    decide('shortlist',int(revision))
                    self.wait(lambda:(self.path/'contact-gate.started').exists(),seconds=20)
                    assert flow.execute('SELECT email_resolve_lease_token IS NOT NULL FROM job_sourced_candidates WHERE id=%s',(cid,)).fetchone()[0]
                    decide('pass',int(revision)+1)
                    self.file('contact-gate.release','release')
                    self.wait(lambda:(self.path/'contact-gate.returned').exists())
                    time.sleep(1)
                    assert flow.execute('SELECT state,found_email,decision_revision FROM job_sourced_candidates WHERE id=%s',(cid,)).fetchone()==('passed',None,int(revision)+2)
                    assert flow.execute('SELECT ordinal,signal_candidate_id FROM sourcing_delivery_items WHERE organization_id=%s ORDER BY ordinal',(org,)).fetchall()==before_order
                    assert flow.execute("SELECT count(*) FROM sourcing_decision_events WHERE organization_id=%s AND delivery_id IS NOT NULL AND brief_version_id IS NOT NULL",(org,)).fetchone()[0]==int(revision)+2
                # A real worker restart and repeated browser intent cannot
                # grant another acquisition or release an uncertain charge.
                self.stop(self.worker);self.retired.append(self.worker)
                self.worker=self.start(['node','--import','tsx','src/lib/sourcing/worker.ts'],{**de,'PORT':str(self.wp)},self.discover)
                replay=self.post(client,f'/api/jobs/{job}/find-candidates',json=body)
                assert replay.status_code in (200,202),(replay.status_code,replay.text)
                time.sleep(4)
                repeated=[json.loads(x) for x in self.provider_log.read_text().splitlines()]
                assert len([x for x in repeated if x['kind']=='crustdata' and x['body']['limit']==300])==1
                assert flow.execute('SELECT captured FROM sourcing_allowance_windows WHERE organization_id=%s',(org,)).fetchone()[0]==1
                assert self.forbidden.read_text()==''
                print('GOVERNED_THREE_SYSTEM_PASS',flush=True)
p=Path(os.environ['RETAINED_PROOF_ROOT'])/'governed';p.mkdir(mode=0o700)
stack=Stack(p)
try: stack.governed()
finally: stack.close()
`;
    for(const [variant,fail] of [['zero-results','0'],['uncertain-dispatch','1'],['nonempty-delivery','2']] as const){
      if(process.env.FLOW_SOURCING_PROCESS_VARIANT&&process.env.FLOW_SOURCING_PROCESS_VARIANT!==variant)continue;
      const variantRoot=join(root,variant);execFileSync('mkdir',['-m','700',variantRoot]);
      const log=join(root,variant+'.log');
      try{
        const {stdout,stderr}=await execFileAsync(python,['-c',script],{cwd:memory,env:{...env,RETAINED_PROOF_ROOT:variantRoot,FIXTURE_ACQUISITION_FAIL:fail},encoding:'utf8',timeout:420000,maxBuffer:8*1024*1024});
        writeFileSync(log,stdout+stderr,{mode:0o600});expect(stdout).toContain('GOVERNED_THREE_SYSTEM_PASS');
      }catch(error){const e=error as {stdout?:string;stderr?:string};writeFileSync(log,String(e.stdout??'')+String(e.stderr??''),{mode:0o600});throw Error(`Governed process proof failed: ${log}\n${readFileSync(log,'utf8').slice(-6000)}`);}
    }
  },960000);
  it.skipIf(process.env.FLOW_SOURCING_PROCESS_ONLY!=='index')('retains the complete 4D cross-system index and consent proof',async()=>{
    const env={...cleanEnv,ACTIVEKG_INDEX_XS_DISPOSABLE:'1',ACTIVEKG_INDEX_TEST_DISPOSABLE:'1',ACTIVEKG_INDEX_XS_PROCESSES:'1',
      ACTIVEKG_INDEX_XS_FLOW_ROOT:resolve('..'),ACTIVEKG_INDEX_XS_ADMIN_DSN:`postgresql://fixture_admin_test@127.0.0.1:${port}/postgres`,
      FLOW_INDEX_TEST_OWNER_URL:`postgresql://flow_4d_test_placeholder_owner_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,
      FLOW_INDEX_TEST_RUNTIME_URL:`postgresql://flow_4d_test_placeholder_runtime_test@127.0.0.1:${port}/flow_4d_test_placeholder_test`,RETAINED_PROOF_ROOT:root};
    const script=String.raw`
import os
from pathlib import Path
import pytest
from tests import test_candidate_index_cross_system as index
from tests import test_candidate_index_postgres as pg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict,make_conninfo
from uuid import uuid4
original=index._node
def current_tail(path,root,dsn,body,**kwargs):
    old="if(result.applied.length!==14)throw Error('fixture_ledger');"
    if old in body: body=body.replace(old,"if(result.applied.length!==17)throw Error('fixture_ledger');")
    return original(path,root,dsn,body,**kwargs)
index._node=current_tail
root=Path(os.environ['RETAINED_PROOF_ROOT']);base=root/'index-base';base.mkdir(mode=0o700)
stack=index.ProcessStack(base,None)
try:
    stack.bootstrap()
    ro='flow_4d_test_'+uuid4().hex[:12]+'_readonly_test'
    stack.admin.execute(sql.SQL('CREATE ROLE {} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD {}').format(sql.Identifier(ro),sql.Literal('fixture-only')))
    stack.owned_roles.append(ro)
    stack.admin.execute(sql.SQL('ALTER ROLE {} SET default_transaction_read_only=on').format(sql.Identifier(ro)))
    fields=conninfo_to_dict(stack.fo)
    stack.admin.execute(sql.SQL('REVOKE TEMPORARY ON DATABASE {} FROM PUBLIC').format(sql.Identifier(fields['dbname'])))
    os.environ['FLOW_INDEX_TEST_READONLY_URL']=f"postgresql://{ro}:fixture-only@127.0.0.1:{fields['port']}/{fields['dbname']}"
    pg.OWNER=stack.owner.info.dsn;pg.RUNTIME=stack.mr;index.RUNTIME=stack.mr
    os.environ['ACTIVEKG_INDEX_TEST_OWNER_DSN']=pg.OWNER
    os.environ['ACTIVEKG_INDEX_TEST_RUNTIME_DSN']=pg.RUNTIME
    os.environ['FLOW_INDEX_TEST_OWNER_URL']=stack.fo
    os.environ['FLOW_INDEX_TEST_RUNTIME_URL']=stack.fr
    raise SystemExit(pytest.main(['-q','-p','pytest_timeout','-p','no:cacheprovider','--basetemp',str(root/'pytest-index'),
        'tests/test_candidate_index_cross_system.py']))
finally: stack.close()
`;
    const log=join(root,'index.log');
    try{
      const {stdout,stderr}=await execFileAsync(python,['-c',script],{cwd:memory,env,encoding:'utf8',timeout:1500000,maxBuffer:8*1024*1024});
      writeFileSync(log,stdout+stderr,{mode:0o600});expect(stdout).toMatch(/11 passed/);
    }catch(error){const e=error as {stdout?:string;stderr?:string};writeFileSync(log,String(e.stdout??'')+String(e.stderr??''),{mode:0o600});throw Error(`Retained index proof failed: ${log}\n${readFileSync(log,'utf8').slice(-6000)}`);}
  },1560000);
});
