import {test} from 'vitest';
import {consentV2DeliveryEnabled} from './config';
test('consent delivery requires both explicit switches',()=>{
 const a=process.env.CANDIDATE_FOUNDATION_ENABLED,b=process.env.CANDIDATE_CONSENT_V2_DELIVERY_ENABLED;
 try{
  for(const foundation of [undefined,'false','true'])for(const delivery of [undefined,'false','true']){
   if(foundation===undefined)delete process.env.CANDIDATE_FOUNDATION_ENABLED;else process.env.CANDIDATE_FOUNDATION_ENABLED=foundation;
   if(delivery===undefined)delete process.env.CANDIDATE_CONSENT_V2_DELIVERY_ENABLED;else process.env.CANDIDATE_CONSENT_V2_DELIVERY_ENABLED=delivery;
   assert.equal(consentV2DeliveryEnabled(),foundation==='true'&&delivery==='true');
  }
 }finally{
  if(a===undefined)delete process.env.CANDIDATE_FOUNDATION_ENABLED;else process.env.CANDIDATE_FOUNDATION_ENABLED=a;
  if(b===undefined)delete process.env.CANDIDATE_CONSENT_V2_DELIVERY_ENABLED;else process.env.CANDIDATE_CONSENT_V2_DELIVERY_ENABLED=b;
 }
});

import assert from 'node:assert/strict';
import {runConsentV2Once,startConsentV2Worker,consentV2Repository,ConsentCaptureError,captureSignupConsentIntent} from './consent-v2';
import {parseConsentProjection,bundledPurposes} from './spark-contracts';
test('signup captures only an explicit v2 intent in a savepoint and reports failures honestly',async()=>{
 const names=['CANDIDATE_FOUNDATION_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_CAPTURE_ENABLED'];
 const before=names.map(n=>process.env[n]);let calls=0,fail=false;
 const tx={transaction:async(fn:(x:any)=>Promise<void>)=>fn({execute:async()=>{calls++;if(fail)throw Error('private SQL');}})};
 const p={schemaVersion:2,idempotencyKey:'00000000-0000-4000-8000-000000000001',accepted:true,copyVersion:2,copyHash:'a'.repeat(64)};
 try{
  for(const n of names)process.env[n]='true';
  assert.equal(await captureSignupConsentIntent(tx,7,p),'recorded');assert.equal(calls,1);
  for(const input of [{...p,accepted:false},{...p,purposes:['anything']},{...p,userId:8},{...p,copyHash:'bad'}])
   assert.equal(await captureSignupConsentIntent(tx,7,input),'not_recorded');
  assert.equal(await captureSignupConsentIntent(tx,7,undefined),undefined);assert.equal(calls,1);
  fail=true;assert.equal(await captureSignupConsentIntent(tx,7,p),'not_recorded');assert.equal(calls,2);
  process.env.CANDIDATE_CONSENT_V2_CAPTURE_ENABLED='false';assert.equal(await captureSignupConsentIntent(tx,7,p),'not_recorded');assert.equal(calls,2);
 }finally{names.forEach((n,i)=>{if(before[i]===undefined)delete process.env[n];else process.env[n]=before[i];});}
});

test('capture repository binds the actor, bypasses privacy only for withdrawal and sanitises errors',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const receipt={schemaVersion:2,eventId:id,consentRevision:2,status:'recorded',replayed:false};
 let checks=0,args:unknown[]=[],sql='';let failure:unknown=null;
 const db={async query(q:string,a:unknown[]){sql=q;args=a;if(failure)throw failure;return {rows:[{result:receipt}]};}};
 const repo=consentV2Repository(db,async()=>{checks++;throw Error('privacy unavailable');});
 const actor={userId:7,authVersion:3},base={schemaVersion:2,idempotencyKey:id,expectedConsentRevision:1};
 await assert.rejects(()=>repo.capture(actor,JSON.stringify({...base,action:'grant',copyVersion:2,copyHash:'a'.repeat(64)})));
 assert.equal(sql,'');assert.equal(checks,1);
 const raw=JSON.stringify({...base,action:'withdraw'});
 assert.deepEqual(await repo.capture(actor,raw),receipt);assert.equal(checks,1);
 assert.ok(sql.includes('flow_consent_v2_capture_owned'));
 assert.deepEqual(args,[7,3,id,1,'withdraw',null,null]);
 failure={code:'40001',message:'consent_version_conflict'};
 await assert.rejects(()=>repo.capture(actor,raw),(e:unknown)=>e instanceof ConsentCaptureError&&e.status===409);
 failure={code:'40001',message:'secret query text'};
 await assert.rejects(()=>repo.capture(actor,raw),(e:unknown)=>e instanceof ConsentCaptureError&&e.status===503&&e.code==='consent_temporarily_unavailable');
});

async function workerChecks(){
 const id='00000000-0000-4000-8000-000000000001';
 const c={schemaVersion:2,subjectId:id,bindingId:id,eventId:id,version:1,action:'grant',copyVersion:1,copyHash:'a'.repeat(64),purposes:bundledPurposes};
 const hash=parseConsentProjection(JSON.stringify(c)).hash;
 let checks=0;
 function harness(){
  const state={prepares:0,sends:0,acks:0,failures:[] as unknown[][],stale:false,privacy:'allowed' as 'allowed'|'restricted'|'unavailable',loseAck:false,loseSend:false};
  const d={workerId:'test',db:{async query(sql:string,args:unknown[]){
   if(sql.includes('flow_claim_')){assert.ok(sql.includes('_v2_'));return {rows:[{outbox_id:id,event_id:id,generation:3,attempts:1,command_sha256:hash}]};}
   if(sql.includes('_prepare'))return {rows:[{prepared:++state.prepares>1&&state.stale?null:{command:c,commandHash:hash,userId:1}}]};
   if(sql.includes('_ack')){state.acks++;if(state.loseAck)throw Error('lost');return {rows:[]};}
   if(sql.includes('_v2_outbox')){state.failures.push(args);return {rows:[]};}
   throw Error('unexpected SQL');
  }},privacy:async()=>state.privacy,deliver:async()=>{state.sends++;if(state.loseSend)throw new ConsentTransportError('outcome_unknown',true);
   return {eventId:id,version:1,effectiveVersion:1,outcome:'onboarding_granted' as const};}};
  return {d,state};
 }
 {const {d,state}=harness();await runConsentV2Once(d);assert.equal(state.sends,1);assert.equal(state.acks,1);assert.equal(state.prepares,2);checks++;}
 {const {d,state}=harness();state.stale=true;await runConsentV2Once(d);assert.equal(state.sends,0);checks++;}
 for(const privacy of ['restricted','unavailable'] as const){const {d,state}=harness();state.privacy=privacy;await runConsentV2Once(d);assert.equal(state.sends,0);assert.equal(state.failures[0]![3],privacy==='unavailable');checks++;}
 {const {d,state}=harness();state.loseSend=true;await runConsentV2Once(d);assert.equal(state.sends,1);assert.equal(state.failures[0]![3],true);checks++;}
 {const {d,state}=harness();state.loseAck=true;await runConsentV2Once(d);assert.equal(state.sends,1);assert.equal(state.failures.length,1);checks++;}
 {const {d,state}=harness();await startConsentV2Worker(d)();assert.equal(state.prepares,0);checks++;}
 {const {d,state}=harness();let release!:()=>void;
  d.privacy=()=>new Promise(resolve=>{release=()=>resolve('allowed');});
  const stop=startConsentV2Worker(d,{enabled:true});
  await new Promise(resolve=>setTimeout(resolve,10));let stopped=false;
  const stopping=stop().then(()=>{stopped=true;});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(stopped,false);
  release();await stopping;assert.equal(state.sends,1);checks++;
 }
 console.log(`${checks} consent worker checks passed`);
}
test('workerChecks', workerChecks);


import {generateKeyPairSync,verify} from 'node:crypto';
import {createServer} from 'node:http';
import {sendConsentV2,ConsentTransportError} from './spark-client';

import {signServiceJwt} from '../lib/services/jwt-signer';

async function transportChecks(){
 const id='00000000-0000-4000-8000-000000000001';
 const raw=JSON.stringify({schemaVersion:2,subjectId:id,bindingId:id,eventId:id,version:2,
  action:'withdraw',copyVersion:null,copyHash:null,purposes:[]});
 const parsed=parseConsentProjection(raw);
 const receipt={eventId:id,version:2,effectiveVersion:2,outcome:'withdrawn'};
 let checks=0,calls=0;
 const deps={origin:'https://memory.invalid',sign:async()=> 'test-token',fetch:async()=>{
  calls++;return Response.json(receipt);
 }};
 const fail=async(fn:()=>Promise<unknown>,code:string,dispatched:boolean)=>{
  await assert.rejects(fn,(e:unknown)=>e instanceof ConsentTransportError&&e.code===code&&e.dispatched===dispatched);checks++;
 };
 assert.deepEqual(await sendConsentV2(raw,parsed.hash,deps),receipt);checks++;
 await fail(()=>sendConsentV2(raw,'f'.repeat(64),deps),'command_mismatch',false);
 for(const origin of ['https://memory.invalid/path','http://memory.invalid','https://user@memory.invalid'])
  await fail(()=>sendConsentV2(raw,parsed.hash,{...deps,origin}),'invalid_origin',false);
 const before=calls;
 await fail(()=>sendConsentV2(raw,parsed.hash,{...deps,timeoutMs:5,sign:()=>new Promise(r=>setTimeout(()=>r('late'),30))}),'unavailable',false);
 await new Promise(r=>setTimeout(r,40));assert.equal(calls,before);checks++;
 await fail(()=>sendConsentV2(raw,parsed.hash,{...deps,timeoutMs:5,fetch:()=>new Promise(()=>{})}),'outcome_unknown',true);
 await fail(()=>sendConsentV2(raw,parsed.hash,{...deps,timeoutMs:5,fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}))}),'outcome_unknown',true);
 for(const bad of [{...receipt,eventId:'different'},{...receipt,version:1},{...receipt,effectiveVersion:3},
  {...receipt,outcome:'onboarding_granted'},{...receipt,outcome:'superseded',effectiveVersion:1},
  {...receipt,extra:true}])
  await fail(()=>sendConsentV2(raw,parsed.hash,{...deps,fetch:async()=>Response.json(bad)}),'invalid_receipt',true);
 for(const body of ['x'.repeat(8193),'{}','{"eventId":"a","eventId":"b"}',new Uint8Array([255])])
  await fail(()=>sendConsentV2(raw,parsed.hash,{...deps,fetch:async()=>new Response(body)}),'invalid_receipt',true);
 assert.equal((await sendConsentV2(raw,parsed.hash,{...deps,fetch:async()=>Response.json({...receipt,outcome:'superseded',effectiveVersion:3})})).effectiveVersion,3);checks++;
 for(const [status,code] of [[451,'privacy_restricted'],[401,'remote_rejected'],[503,'outcome_unknown']] as const)
  await fail(()=>sendConsentV2(raw,parsed.hash,{...deps,fetch:async()=>new Response('',{status})}),code,true);

 // Real HTTP and the existing production RS256 signer, using throwaway keys only.
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const oldKey=process.env.VANTAHIRE_JWT_PRIVATE_KEY;
 process.env.VANTAHIRE_JWT_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'}).toString();
 let received=0,serverError:unknown;
 const server=createServer(async(req,res)=>{
  try{
   const [header,payload,signature]=(req.headers.authorization??'').replace(/^Bearer /,'').split('.');
   assert.equal(JSON.parse(Buffer.from(header!,'base64url').toString()).alg,'RS256');
   assert.ok(verify('RSA-SHA256',Buffer.from(`${header}.${payload}`),publicKey,Buffer.from(signature!,'base64url')));
   const claims=JSON.parse(Buffer.from(payload!,'base64url').toString());
   assert.equal(claims.iss,'vantahire');assert.equal(claims.aud,'activekg');
   assert.equal(claims.tenant_id,`candidate_${id}`);assert.equal(claims.request_id,id);
   assert.equal(claims.scopes,'candidate-consent:write');assert.equal(claims.actor_type,'service');
   assert.equal(claims.exp-claims.iat,60);
   assert.equal(req.url,'/candidate-consent/v2/events');assert.equal(req.headers['x-command-sha256'],parsed.hash);
   let body='';for await(const chunk of req)body+=chunk;
   assert.equal(body,parsed.canonical);received++;
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(receipt));
  }catch(error){serverError=error;res.writeHead(400);res.end();}
 });
 try{
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  assert.deepEqual(await sendConsentV2(raw,parsed.hash,{origin:`http://127.0.0.1:${address.port}`,localTest:true,sign:signServiceJwt}),receipt);
  assert.equal(serverError,undefined);assert.equal(received,1);checks++;
 }finally{
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(oldKey===undefined)delete process.env.VANTAHIRE_JWT_PRIVATE_KEY;else process.env.VANTAHIRE_JWT_PRIVATE_KEY=oldKey;
 }
 console.log(`${checks} consent transport checks passed (synthetic only)`);
}
test('transportChecks', transportChecks);
