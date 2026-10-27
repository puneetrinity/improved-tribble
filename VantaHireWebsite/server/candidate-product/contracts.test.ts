import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseStrictJson,parseWire,foundationRequest,draftIntentHash} from './contracts';
import {captureOptionalIntent} from './guest-intent';
import {generateKeyPair,exportPKCS8,jwtVerify} from 'jose';
import {deliverFoundation,foundationMemoryOrigin} from './memory-client';
import {foundationRepository} from './repository';
import {runFoundationOnce,startFoundationProcessor} from './processor';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
// @ts-expect-error The build guard is intentionally plain ESM.
import {checkCandidateProduct} from '../../scripts/check-candidate-product.mjs';
import {FoundationDeliveryError} from './memory-client';
const raw='{"schemaVersion":1,"commandId":"11111111-1111-4111-8111-111111111111","subjectId":"22222222-2222-4222-8222-222222222222","bindingId":"33333333-3333-4333-8333-333333333333","sequence":1,"action":"ensure_subject"}';
const fixture={valid:{raw,sha256:'a8c757f9ce898180424e867102eaee22dcc3339a99770ca89588b4cae5b2fa65'},invalid:[
 {name:'extra field',raw:raw.replace('"sequence":1','"email":"synthetic@example.invalid","sequence":1')},
 {name:'duplicate field',raw:raw.replace('"sequence":1','"sequence":1,"sequence":2')},
 {name:'whitespace',raw:' '+raw},{name:'numeric string',raw:raw.replace('"sequence":1','"sequence":"1"')},
 {name:'wrong action',raw:raw.replace('ensure_subject','publish')},
]};
afterEach(()=>vi.unstubAllEnvs());
describe('foundation deployed web wiring guard',()=>{
 it('requires startup, privacy binding and awaited shutdown in the actual web entrypoint',()=>{
  const root=mkdtempSync('/tmp/candidate-s1-web-guard-');
  const files=['server/candidate-product/routes.ts','server/candidate-product/processor.ts',
   'server/candidate-product/memory-client.ts','server/candidate-product/guest-intent.ts',
   'server/candidate-product/config.ts','server/index.ts','server/worker.ts',
   'server/schema-migrations/0024_candidate_product_foundation.sql','server/schema-migrations/checksums.lock'];
  try{
    for(const file of files){const target=resolve(root,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(file));}
    expect(checkCandidateProduct(root)).toEqual([]);
    const entry=readFileSync(resolve(root,'server/index.ts'),'utf8');
    for(const anchor of ['stopFoundationProcessor = startFoundationProcessor(',
      'newGlobalOperation:true','const foundationStopped = stopFoundationProcessor?.();',
      'Promise.allSettled([Promise.resolve(indexStopped), foundationStopped])']){
      writeFileSync(resolve(root,'server/index.ts'),entry.replace(anchor,'REMOVED_FOR_REGRESSION'));
      expect(checkCandidateProduct(root).length).toBeGreaterThan(0);
    }
    writeFileSync(resolve(root,'server/index.ts'),entry);
    expect(checkCandidateProduct(root)).toEqual([]);
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
describe('foundation leased delivery',()=>{
 const parsed=parseWire(raw);
 const lease={commandId:parsed.value.commandId,subjectId:parsed.value.subjectId,bindingId:parsed.value.bindingId,
  userId:7,sequence:1,wireBody:raw,wireSha256:parsed.hash,leaseToken:'44444444-4444-4444-8444-444444444444',leaseGeneration:2};
 const ack={schemaVersion:1,commandId:lease.commandId,subjectId:lease.subjectId,bindingId:lease.bindingId,sequence:1,
  wireSha256:parsed.hash,outcome:'subject_ready',profileVersion:0,preferenceVersion:0,publicationActive:false} as const;
 const setup=()=>({db:{query:vi.fn().mockResolvedValueOnce({rows:[{result:lease}]}).mockResolvedValue({rows:[{result:{applied:true}}]})},
  privacy:vi.fn(async()=>{}),enabled:()=>true,deliver:vi.fn(async()=>ack)});
 it('does not claim when disabled',async()=>{
  const deps=setup();deps.enabled=()=>false;expect(await runFoundationOnce(deps)).toBe(false);expect(deps.db.query).not.toHaveBeenCalled();
 });
 it('shutdown waits for the active delivery and prevents further claims',async()=>{
  vi.useFakeTimers();
  let release!:()=>void;
  const deps=setup();deps.privacy.mockImplementation(()=>new Promise<void>(done=>{release=done;}));
  const stop=startFoundationProcessor(deps);
  try{
    await vi.advanceTimersByTimeAsync(0);
    let stopped=false;const stopping=stop().then(()=>{stopped=true;});
    await Promise.resolve();expect(stopped).toBe(false);
    release();await stopping;expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(deps.db.query).toHaveBeenCalledTimes(2);expect(deps.deliver).toHaveBeenCalledTimes(1);
  }finally{await stop();vi.useRealTimers();}
 });
 it('sends immutable bytes and finishes the exact lease only',async()=>{
  const deps=setup();expect(await runFoundationOnce(deps)).toBe(true);
  expect(deps.privacy).toHaveBeenCalledWith(7);expect(deps.deliver).toHaveBeenCalledWith(raw,parsed.hash,10000);
  expect(deps.db.query.mock.calls[1]?.[1]).toEqual([lease.commandId,lease.leaseToken,2,'acknowledged',JSON.stringify(ack)]);
 });
 it('holds privacy restrictions without sending',async()=>{
  const deps=setup();deps.privacy.mockRejectedValue({code:'candidate_privacy_restricted'});
  await runFoundationOnce(deps);expect(deps.deliver).not.toHaveBeenCalled();expect(deps.db.query.mock.calls[1]?.[1][3]).toBe('remote_denied');
 });
 it('retries unavailable privacy without sending',async()=>{
  const deps=setup();deps.privacy.mockRejectedValue(Error('unavailable'));
  await runFoundationOnce(deps);expect(deps.deliver).not.toHaveBeenCalled();expect(deps.db.query.mock.calls[1]?.[1][3]).toBe('network');
 });
 it('rechecks the switch after privacy',async()=>{
  const deps=setup();deps.enabled=vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  await runFoundationOnce(deps);expect(deps.deliver).not.toHaveBeenCalled();
 });
 it('does not send on corrupted claim',async()=>{
  const deps=setup();deps.db.query.mockReset().mockResolvedValueOnce({rows:[{result:{...lease,wireSha256:'a'.repeat(64)}}]})
    .mockResolvedValue({rows:[{result:{applied:true}}]});
  await runFoundationOnce(deps);expect(deps.deliver).not.toHaveBeenCalled();expect(deps.db.query.mock.calls[1]?.[1][3]).toBe('invalid_response');
 });
 it('preserves provider retry delay without creating a new command',async()=>{
  const deps=setup();deps.deliver.mockRejectedValue(new FoundationDeliveryError('remote_retry',120));
  await runFoundationOnce(deps);expect(deps.db.query.mock.calls[1]?.[1]).toEqual([lease.commandId,lease.leaseToken,2,'remote_retry','{"retryAfterSeconds":120}']);
 });
 it('does not retry a finish with an unknown commit result',async()=>{
  const deps=setup();deps.db.query.mockReset().mockResolvedValueOnce({rows:[{result:lease}]}).mockRejectedValue(Error('connection lost'));
  await expect(runFoundationOnce(deps)).rejects.toThrow('connection lost');expect(deps.db.query).toHaveBeenCalledTimes(2);
 });
 it('a late privacy reply cannot dispatch after the total deadline',async()=>{
  vi.useFakeTimers();
  try {
   const deps=setup();let resolve!:()=>void;deps.privacy.mockImplementation(()=>new Promise<void>(done=>{resolve=done;}));
   const pending=runFoundationOnce(deps);await vi.advanceTimersByTimeAsync(15000);await pending;
   resolve();await Promise.resolve();expect(deps.deliver).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
 });
});
describe('candidate foundation contracts',()=>{
 it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":{"b":1,"b":2}}',
  '{"a":[{"b":[{}]}]}', 'x'.repeat(4097)])('rejects ambiguous or oversized JSON %s', raw=>{
  expect(()=>parseStrictJson(raw)).toThrow();
 });
 it('accepts whitespace, escaped strings, independent object keys and depth four',()=>{
  const raw=' {"a":[{"b":{"c":"escaped \\\" quote"}},{"b":null}],"number":1e2} ';
  expect(parseStrictJson(raw)).toEqual(JSON.parse(raw));
 });
 it('requires original JSON rather than an already parsed object',()=>{
  expect(()=>parseStrictJson({schemaVersion:1} as any)).toThrow();
 });
 it('matches the cross-language canonical hash',()=>expect(parseWire(fixture.valid.raw).hash).toBe(fixture.valid.sha256));
 for(const test of fixture.invalid) it(`rejects ${test.name}`,()=>expect(()=>parseWire(test.raw)).toThrow());
 it('refuses browser-selected identity',()=>expect(()=>foundationRequest.parse({schemaVersion:1,idempotencyKey:'11111111-1111-4111-8111-111111111111',subjectId:'other'})).toThrow());
 it('keeps optional capture dark even with production feature enabled',async()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('CANDIDATE_FOUNDATION_ENABLED','true');vi.stubEnv('CANDIDATE_FOUNDATION_DISPOSABLE_TEST','1');
  const tx={transaction:vi.fn()};expect(await captureOptionalIntent(tx,'guest',1,{})).toBe('not_recorded');expect(tx.transaction).not.toHaveBeenCalled();
 });
 it('does not start a savepoint when no intent was supplied',async()=>{
  const tx={transaction:vi.fn()};expect(await captureOptionalIntent(tx,'guest',1,undefined)).toBeUndefined();expect(tx.transaction).not.toHaveBeenCalled();
 });
 it('isolates an optional capture error',async()=>{
  vi.stubEnv('NODE_ENV','test');vi.stubEnv('CANDIDATE_FOUNDATION_ENABLED','true');vi.stubEnv('CANDIDATE_FOUNDATION_DISPOSABLE_TEST','1');
  const tx={transaction:vi.fn(async(fn:any)=>fn({execute:async()=>{throw Error('constraint');}}))};
  expect(await captureOptionalIntent(tx,'guest',1,{copyVersion:1,copySha256:draftIntentHash,accepted:true})).toBe('not_recorded');
  expect(tx.transaction).toHaveBeenCalledOnce();
 });
 it('accepts the multipart JSON field but refuses duplicate intent keys',async()=>{
  vi.stubEnv('NODE_ENV','test');vi.stubEnv('CANDIDATE_FOUNDATION_ENABLED','true');vi.stubEnv('CANDIDATE_FOUNDATION_DISPOSABLE_TEST','1');
  const tx={transaction:vi.fn(async(fn:any)=>fn({execute:vi.fn(async()=>{})}))};
  const intent=JSON.stringify({copyVersion:1,copySha256:draftIntentHash,accepted:true});
  expect(await captureOptionalIntent(tx,'guest',1,intent)).toBe('recorded');
  tx.transaction.mockClear();
  expect(await captureOptionalIntent(tx,'guest',1,intent.replace('"accepted":true','"accepted":false,"accepted":true'))).toBe('not_recorded');
  expect(tx.transaction).not.toHaveBeenCalled();
 });
});
describe('foundation service token lifetime',()=>{
 it('preserves legacy claims and default, with bounded shorter lifetimes',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});
  vi.stubEnv('VANTAHIRE_JWT_PRIVATE_KEY',await exportPKCS8(privateKey));
  vi.stubEnv('VANTAHIRE_JWT_ACTIVE_KID','synthetic-test');
  vi.resetModules();
  const {signServiceJwt}=await import('../lib/services/jwt-signer');
  for(const lifetimeSeconds of [undefined,1,60,300]){
   const token=await signServiceJwt('activekg',{tenantId:'synthetic',scopes:'foundation:write',requestId:'test',lifetimeSeconds});
   const {payload,protectedHeader}=await jwtVerify(token,publicKey,{issuer:'vantahire',audience:'activekg'});
   expect(payload.exp! - payload.iat!).toBe(lifetimeSeconds ?? 300);
   expect(payload).toMatchObject({sub:'vantahire-backend',tenant_id:'synthetic',scopes:'foundation:write',actor_type:'service',request_id:'test'});
   expect(protectedHeader).toMatchObject({alg:'RS256',kid:'synthetic-test'});
  }
 });
 it('rejects invalid lifetimes before accessing signing credentials',async()=>{
  vi.stubEnv('VANTAHIRE_JWT_PRIVATE_KEY','');vi.resetModules();
  const {signServiceJwt}=await import('../lib/services/jwt-signer');
  for(const lifetimeSeconds of [0,-1,301,1.5,NaN,Infinity]){
   await expect(signServiceJwt('activekg',{tenantId:'synthetic',scopes:'foundation:write',lifetimeSeconds})).rejects.toThrow('lifetime must be an integer');
  }
 });
});

describe('foundation Memory delivery',()=>{
 const parsed=parseWire(raw);
 const receipt={...parsed.value,wireSha256:parsed.hash,outcome:'subject_ready',profileVersion:0,preferenceVersion:0,publicationActive:false};
 const responseBody=()=>{const {action,...body}=receipt;return body;};
 const env={NODE_ENV:'production',ACTIVEKG_BASE_URL:'https://memory.example.invalid'};
 const sign=vi.fn(async()=> 'synthetic-token');
 it.each([200,201])('checks exact receipt identity for HTTP %s and sends stored bytes unchanged',async status=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(responseBody()),{status}));
  expect(await deliverFoundation(raw,parsed.hash,1000,{fetch:fetcher as typeof fetch,sign,env})).toEqual(responseBody());
  expect(sign).toHaveBeenLastCalledWith('activekg',expect.objectContaining({lifetimeSeconds:60,tenantId:`candidate_${parsed.value.subjectId}`,scopes:'candidate-profile:foundation-write'}));
  expect(fetcher).toHaveBeenCalledWith('https://memory.example.invalid/candidate-profiles/foundation/commands',expect.objectContaining({body:raw,redirect:'error',headers:expect.objectContaining({'X-Candidate-Command-SHA256':parsed.hash})}));
 });
 it.each(['commandId','subjectId','bindingId','sequence','wireSha256','publicationActive'])('rejects a mismatched %s',async field=>{
  const body:any=responseBody();body[field]=field==='sequence'?2:field==='publicationActive'?true:'00000000-0000-4000-8000-000000000000';
  await expect(deliverFoundation(raw,parsed.hash,1000,{fetch:async()=>new Response(JSON.stringify(body)),sign,env})).rejects.toMatchObject({code:'invalid_response'});
 });
 it('refuses changed stored bytes before signing or fetching',async()=>{
  const signer=vi.fn(),fetcher=vi.fn();
  await expect(deliverFoundation(raw,'0'.repeat(64),1000,{sign:signer,fetch:fetcher,env})).rejects.toMatchObject({code:'invalid_response'});
  expect(signer).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([[409,'remote_conflict'],[403,'remote_denied'],[451,'remote_denied'],[429,'remote_retry'],[503,'remote_retry'],[202,'remote_denied']] as const)('classifies HTTP %s without an internal retry',async(status,code)=>{
  const fetcher=vi.fn(async()=>new Response('untrusted',{status,headers:{'retry-after':'120'}}));
  await expect(deliverFoundation(raw,parsed.hash,1000,{fetch:fetcher as typeof fetch,sign,env})).rejects.toMatchObject({code,...(code==='remote_retry'?{retryAfterSeconds:120}:{})});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('bounds a stalled body read and cancels it',async()=>{
  const cancel=vi.fn();const body=new ReadableStream<Uint8Array>({cancel});
  await expect(deliverFoundation(raw,parsed.hash,20,{fetch:async()=>new Response(body),sign,env})).rejects.toMatchObject({code:'timeout'});
  expect(cancel).toHaveBeenCalledOnce();
 });
 it('never dispatches when signing finishes after the deadline',async()=>{
  let finish!:(token:string)=>void;const fetcher=vi.fn();
  const pending=deliverFoundation(raw,parsed.hash,20,{sign:()=>new Promise(resolve=>{finish=resolve;}),fetch:fetcher,env});
  await expect(pending).rejects.toMatchObject({code:'timeout'});
  finish('late');await Promise.resolve();expect(fetcher).not.toHaveBeenCalled();
 });
 it('bounds response size',async()=>{
  await expect(deliverFoundation(raw,parsed.hash,1000,{fetch:async()=>new Response('x'.repeat(4097)),sign,env})).rejects.toMatchObject({code:'invalid_response'});
 });
 it.each(['http://memory.example.invalid','https://user:password@memory.example.invalid','https://memory.example.invalid/path','https://memory.example.invalid/?token=value'])('refuses unsafe origin %s',url=>{
  expect(()=>foundationMemoryOrigin({...env,ACTIVEKG_BASE_URL:url})).toThrow('remote_denied');
 });
});

describe('foundation routine repository',()=>{
 const actor={userId:42,authVersion:3,passwordVersion:'a'.repeat(64),reauthenticatedAt:Date.now()};
 const key='11111111-1111-4111-8111-111111111111';
 it('uses parameterised ensure and performs privacy authority first',async()=>{
  const order:string[]=[];
  const result={schemaVersion:1,commandId:key,status:'pending',publicationActive:false};
  const db={query:vi.fn(async()=>{order.push('db');return {rows:[{result}]};})};
  const repo=foundationRepository(db,async id=>{expect(id).toBe(42);order.push('privacy');});
  expect(await repo.ensure(actor,key)).toEqual(result);expect(order).toEqual(['privacy','db']);
  expect(db.query).toHaveBeenCalledWith('SELECT public.flow_candidate_foundation_ensure($1,$2,$3,$4,$5) AS result',
   [42,3,actor.passwordVersion,new Date(actor.reauthenticatedAt).toISOString(),key]);
 });
 it('does not access DB when privacy refuses',async()=>{
  const db={query:vi.fn()};const denied=Error('privacy_restricted');
  await expect(foundationRepository(db,async()=>{throw denied;}).read(actor)).rejects.toBe(denied);
  expect(db.query).not.toHaveBeenCalled();
 });
 it('maps only exact known SQL errors and never exposes raw errors',async()=>{
  const query=vi.fn().mockRejectedValueOnce({code:'P0002',message:'not_found'})
   .mockRejectedValueOnce({code:'XX000',message:'not_found'})
   .mockRejectedValueOnce({code:'23505',message:'sensitive database detail'});
  const repo=foundationRepository({query},async()=>{});
  await expect(repo.readCommand(actor,key)).rejects.toMatchObject({code:'not_found',status:404});
  await expect(repo.readCommand(actor,key)).rejects.toMatchObject({code:'authority_unavailable',status:503});
  await expect(repo.readCommand(actor,key)).rejects.toMatchObject({message:'authority_unavailable'});
 });
 it('rejects unexpected fields or publication in empty status',async()=>{
  const query=vi.fn(async()=>({rows:[{result:{schemaVersion:1,state:'linked',profileVersion:0,preferenceVersion:0,publicationActive:true,email:'private@example.invalid'}}]}));
  await expect(foundationRepository({query},async()=>{}).read(actor)).rejects.toMatchObject({code:'authority_unavailable'});
 });
});
