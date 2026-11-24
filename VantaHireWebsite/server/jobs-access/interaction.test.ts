import test from 'node:test';import assert from 'node:assert/strict';
import type {Express,RequestHandler} from 'express';
import {registerJobsInteraction} from './interaction';import {signature,authenticate} from './bridge';
import type {JobsReadinessDependencies} from './readiness';

function fixture(){
 const routes=new Map<string,RequestHandler[]>();let called=0;let privacyReads=0;
 const person={displayName:'Example',currentLocation:{city:'City'},skills:['Python'],linkedinUrl:'https://linkedin.com/in/example'};
 const view={profileVersion:1,preferenceVersion:1,preferences:{},confirmedProfile:person,draft:person};
 const deps={owner:async()=>{privacyReads++;return {subjectId:'subject',bindingId:'binding',pendingCommands:[],hasMorePendingCommands:false};},read:async()=>view} as unknown as JobsReadinessDependencies;
 const app={get:(p:string,...h:RequestHandler[])=>routes.set('GET '+p,h),post:(p:string,...h:RequestHandler[])=>routes.set('POST '+p,h)};
 const verify:RequestHandler=(q,s,n)=>{if(!q.user){s.status(401).json({code:'no_user'});return;}n();};
 const csrf:RequestHandler=(q,s,n)=>{if(q.headers['x-csrf-token']!=='test-csrf'){s.status(403).json({code:'csrf'});return;}n();};
 let enabled=true;
 const calls:{path:string;body:unknown}[]=[];const nonces=new Set();
 registerJobsInteraction(app as unknown as Express,verify,csrf,deps,()=>enabled,async id=>({id,authVersion:2,role:'candidate',emailVerified:true}),async(path,body)=>{
  called++;calls.push({path,body});if(path==='/internal/readiness-replay'){const n=(body as {nonce:string}).nonce;if(nonces.has(n))throw Error('replay');nonces.add(n);return {accepted:true};}return path==='/internal/describe'?{client_name:'<script>alert(1)</script>'}:path==='/internal/approve'?{resume:'https://issuer.example/jobs/finish/test-id'}:{connections:[],client_name:'Assistant'};
 });
 async function call(method:string,path:string,body:unknown={},extra:Record<string,unknown>={}){
  let status=200;let result:unknown;const headers:Record<string,string>={};
  const req={path,query:{},body,rawBody:JSON.stringify(body),ip:'127.0.0.1',user:{id:1,authVersion:2,username:'user@example.test'},headers:{'x-csrf-token':'test-csrf'},...extra};
  const res={status:(n:number)=>{status=n;return res;},json:(b:unknown)=>{result=b;return res;},send:(b:unknown)=>{result=b;return res;},type:()=>res,setHeader:(k:string,v:string)=>{headers[k]=v;}};
  for(const h of routes.get(method+' '+path)??[]){let next=false;await h(req as never,res as never,()=>{next=true;});if(!next)break;}
  return {status,result,headers};
 }
 return {call,deps,view,calls,called:()=>called,reads:()=>privacyReads,disable:()=>{enabled=false;}};
}
const path='/api/candidate/jobs-connect/';
test('disabled routes and unauthenticated or csrf-less approval never call issuer',async()=>{
 const f=fixture();assert.equal((await f.call('POST',path+'approve',{interaction:'test-id'},{user:undefined})).status,401);
 assert.equal((await f.call('POST',path+'approve',{interaction:'test-id'},{headers:{}})).status,403);
 f.disable();assert.equal((await f.call('GET',path+'start',{}, {query:{interaction:'test-id'}})).status,404);assert.equal(f.called(),0);
});
test('approval is ready-only, owner-derived and redirect-constrained',async()=>{
 const f=fixture();f.view.profileVersion=0;assert.equal((await f.call('POST',path+'approve',{interaction:'test-id'})).status,409);assert.equal(f.called(),0);
 f.view.profileVersion=1;process.env.JOBS_MCP_ISSUER_URL='https://issuer.example';
 try{const r=await f.call('POST',path+'approve',{interaction:'test-id'});assert.equal(r.status,200);assert.deepEqual(f.calls[0]?.body,{interaction:'test-id',actor:{userId:1,authVersion:2}});
  assert.equal((await f.call('POST',path+'approve',{interaction:'test-id',actor:{userId:2}})).status,503);
 }finally{delete process.env.JOBS_MCP_ISSUER_URL;}
});
test('disconnect remains available during profile outage and never reads Memory',async()=>{
 const f=fixture();f.deps.read=async()=>{throw Error('Memory unavailable');};
 assert.equal((await f.call('POST',path+'disconnect',{grant_id:'grant'})).status,200);assert.equal(f.reads(),0);
 assert.deepEqual(f.calls[0]?.body,{grant_id:'grant',actor:{userId:1,authVersion:2}});
});
test('connection page escapes client text, no referrer, and explicit read-only approval',async()=>{
 const f=fixture();const r=await f.call('GET',path+'start',{}, {query:{interaction:'test-id'}});
 assert.equal(r.status,200);assert.equal(r.headers['Referrer-Policy'],'no-referrer');
 assert.ok(String(r.result).includes('&lt;script&gt;'));assert.ok(!String(r.result).includes('<script>alert(1)</script>'));assert.ok(String(r.result).includes('Allow read-only jobs access'));
});
test('readiness bridge checks signature, generation and returns no profile',async()=>{
 const f=fixture(),key='k'.repeat(64),endpoint='/api/internal/jobs-readiness',body={userId:1,authVersion:2},stamp=String(Date.now());
 process.env.JOBS_MCP_BRIDGE_KEY=key;process.env.JOBS_MCP_WEBSITE_URL='https://website.example';const origin='https://website.example',nonce='a'.repeat(48);
 try{
  assert.equal((await f.call('POST',endpoint,body)).status,503);assert.equal(f.reads(),0);
  const headers={'x-jobs-time':stamp,'x-jobs-nonce':nonce,'x-jobs-signature':signature(key,endpoint,stamp,JSON.stringify(body),origin,nonce)};
  const r=await f.call('POST',endpoint,body,{headers});assert.equal(r.status,200);assert.deepEqual(r.result,{subject:'subject',auth_generation:'2',eligible:true,reason:'ready'});
  assert.equal((await f.call('POST',endpoint,body,{headers})).status,503);
  const wrong={...body,authVersion:3},freshNonce='b'.repeat(48);assert.equal((await f.call('POST',endpoint,wrong,{headers:{...headers,'x-jobs-nonce':freshNonce,'x-jobs-signature':signature(key,endpoint,stamp,JSON.stringify(wrong),origin,freshNonce)}})).status,503);
  assert.throws(()=>authenticate(key,endpoint,stamp,JSON.stringify(body),headers['x-jobs-signature'],origin,nonce,Number(stamp)+30001));
 }finally{delete process.env.JOBS_MCP_BRIDGE_KEY;delete process.env.JOBS_MCP_WEBSITE_URL;}
});
test('start page rate limit runs before the issuer call',async()=>{
 const f=fixture();for(let i=0;i<30;i++)assert.equal((await f.call('GET',path+'start',{}, {query:{interaction:'test-id'}})).status,200);
 assert.equal((await f.call('GET',path+'start',{}, {query:{interaction:'test-id'}})).status,429);assert.equal(f.called(),30);
});
test('readiness authenticates received bytes rather than reserialized JSON',async()=>{
 const f=fixture(),key='k'.repeat(64),endpoint='/api/internal/jobs-readiness',body={userId:1,authVersion:2};
 const raw='{ "userId": 1, "authVersion": 2 }',nonce='c'.repeat(48),stamp=String(Date.now()),origin='https://website.example';
 process.env.JOBS_MCP_BRIDGE_KEY=key;process.env.JOBS_MCP_WEBSITE_URL=origin;
 try{
  const headers={'x-jobs-time':stamp,'x-jobs-nonce':nonce,'x-jobs-signature':signature(key,endpoint,stamp,raw,origin,nonce)};
  assert.equal((await f.call('POST',endpoint,body,{headers,rawBody:raw})).status,200);
  assert.equal((await f.call('POST',endpoint,body,{headers,rawBody:undefined})).status,503);
 }finally{delete process.env.JOBS_MCP_BRIDGE_KEY;delete process.env.JOBS_MCP_WEBSITE_URL;}
});
