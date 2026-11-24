import test from 'node:test';
import assert from 'node:assert/strict';
import type {Express,RequestHandler} from 'express';
import {registerJobsAccessRoutes} from './routes';
import type {JobsReadinessDependencies} from './readiness';

async function call(options:{enabled?:boolean;verified?:boolean;ready?:boolean;resource?:string;query?:object;outage?:boolean}={}){
 let handlers:RequestHandler[]=[];let reads=0;let status=200;let body:unknown;
 const headers:Record<string,string>={};
 const app={get:(path:string,...h:RequestHandler[])=>{assert.equal(path,'/api/candidate/jobs-access');handlers=h;}};
 const person={displayName:'Example',currentLocation:{city:'City'},skills:['Python'],linkedinUrl:'https://linkedin.com/in/example'};
 const deps={owner:async()=>{reads++;if(options.outage)throw Error('private detail');return {subjectId:'subject',bindingId:'binding',pendingCommands:[],hasMorePendingCommands:false};},
  read:async()=>({profileVersion:options.ready===false?0:1,preferenceVersion:1,preferences:{},confirmedProfile:person,draft:person})} as unknown as JobsReadinessDependencies;
 const verified:RequestHandler=(_req,res,next)=>{if(options.verified===false){res.status(403).json({code:'forbidden'});return;}next();};
 registerJobsAccessRoutes(app as unknown as Express,verified,deps,()=>options.enabled!==false,
  ()=>options.resource??'https://jobs-mcp.ealana.com/mcp');
 const req={query:options.query??{},headers:{},user:{id:1,authVersion:2}};
 const res={setHeader:(k:string,v:string)=>{headers[k]=v;},status:(s:number)=>{status=s;return res;},json:(v:unknown)=>{body=v;return res;}};
 for(const h of handlers){let next=false;await h(req as never,res as never,()=>{next=true;});if(!next)break;}
 return {status,body,headers,reads};
}
test('feature off does not query identity or publish a resource',async()=>{
 const r=await call({enabled:false});assert.equal(r.status,404);assert.equal(r.reads,0);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('verification middleware runs before readiness',async()=>{
 const r=await call({verified:false});assert.equal(r.status,403);assert.equal(r.reads,0);
});
test('completed onboarding returns only connection instructions',async()=>{
 const r=await call();assert.equal(r.status,200);assert.equal((r.body as {eligible:boolean}).eligible,true);
 assert.equal(JSON.stringify(r.body).includes('subject'),false);assert.equal(JSON.stringify(r.body).includes('Python'),false);
});
test('incomplete onboarding points to existing setup and no MCP resource',async()=>{
 const r=await call({ready:false});assert.deepEqual(r.body,{eligible:false,reason:'onboarding_required',setupPath:'/candidate-setup'});
});
test('invalid configuration, parameters and authority outages cannot grant access',async()=>{
 for(const resource of ['http://jobs.example/mcp','https://user:secret@jobs.example/mcp','https://jobs.example/mcp?token=secret','https://jobs.example/other']){
  const r=await call({resource});assert.equal(r.status,503);assert.equal(JSON.stringify(r.body).includes('secret'),false);
 }
 const query=await call({query:{userId:2}});assert.equal(query.status,400);assert.equal(query.reads,0);
 const outage=await call({outage:true});assert.equal(outage.status,503);assert.equal(JSON.stringify(outage.body).includes('private detail'),false);
});
