import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {parseConsentCapture,parseConsentProjection,parseCommand,parseSaveResolution} from './spark-contracts';
import {deliverProfile} from './profile-client';
import {runProfileBatch,parseQueuedProfileCommand,type ProfileLease} from './profile-processor';
import * as shared from '../../shared/candidate-spark-v3';
import {resumeSourceEnabled} from './config';
import * as server from './spark-contracts';
import {build} from 'esbuild';
import {canonicalProfileJson} from './profile-contracts';
import {sourceScrubContextSchema,verifiedSourceScrubContext,sourcePaidRequestIdentity,assertSourcePaidReplay,assertSourceSettledReservation,sourceObjectDependencies,withCachedResumeExtraction,type ReserveRequest,type ReserveResult} from './source-repository';

describe('native extraction reuse for the single processing retry',()=>{
 it('returns the exact cached text without invoking the extractor again',async()=>{
  const input={schemaVersion:1 as const,sourceId:randomUUID(),sourceVersion:1,contentHash:createHash('sha256').update('test').digest('hex'),policyVersion:'test',byteLength:4,mediaType:'application/pdf' as const};
  const output={schemaVersion:1 as const,sourceId:input.sourceId,sourceVersion:1,contentHash:input.contentHash,policyVersion:'test',status:'extracted' as const,text:'Synthetic Go',textHash:createHash('sha256').update('Synthetic Go').digest('hex'),method:'native_text' as const,providerCalls:0 as const};
  let cached:unknown=null;
  const db={query:vi.fn(async(_sql:string,args:unknown[])=>{if(args[1]!==null)cached=JSON.parse(args[1] as string);return {rows:[{result:cached}]};})};
  const extractor=vi.fn(async()=>({output,ocr:{state:'not_requested' as const}}));
  const run=withCachedResumeExtraction(db,{commandId:randomUUID(),claimToken:randomUUID(),generation:1},extractor);
  const deps={beforeOcr:vi.fn(),knownContacts:['synthetic@example.invalid']};
  expect((await run(input,Buffer.from('test'),deps)).output).toEqual(output);
  expect((await run(input,Buffer.from('test'),deps)).output).toEqual(output);
  expect(extractor).toHaveBeenCalledTimes(1);expect(deps.beforeOcr).not.toHaveBeenCalled();
  (cached as {sha256:string}).sha256='0'.repeat(64);
  await expect(run(input,Buffer.from('test'),deps)).rejects.toThrow('source_cache_changed');
  expect(extractor).toHaveBeenCalledTimes(1);
 });
});

describe('resume source activation gates',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 const flags=['CANDIDATE_FOUNDATION_ENABLED','CANDIDATE_PROFILE_ENABLED','CANDIDATE_PROFILE_DELIVERY_ENABLED',
  'CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED','CANDIDATE_RESUME_SOURCE_ENABLED'];
 it.each(flags)('does not admit source work without %s',flag=>{
  for(const f of flags)vi.stubEnv(f,'true');
  vi.stubEnv(flag,'false');expect(resumeSourceEnabled()).toBe(false);
 });
 it('requires the exact explicit source switch after all saving/consent gates',()=>{
  for(const f of flags)vi.stubEnv(f,'true');
  expect(resumeSourceEnabled()).toBe(true);
  for(const value of ['','TRUE','1']){vi.stubEnv('CANDIDATE_RESUME_SOURCE_ENABLED',value);expect(resumeSourceEnabled()).toBe(false);}
 });
});
describe('private immutable resume blob reads',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 const bytes=Buffer.from('%PDF-1.7\nsynthetic resume bytes'),hash=createHash('sha256').update(bytes).digest('hex');
 const reader=async(access:any)=>{
  vi.stubEnv('GCS_BUCKET_NAME','synthetic-private');
  return (await import('../gcs-storage')).candidateResumeBlobReader(access);
 };
 it('pins the downloaded generation and verifies length, magic and hash',async()=>{
  const metadata=vi.fn(async()=>({generation:'7',size:bytes.length})),stream=vi.fn(()=>Readable.from([bytes]));
  const read=await reader({metadata,stream});
  expect(await read('gs://synthetic-private/resumes/test.pdf')).toMatchObject({generation:'7',byteLength:bytes.length,contentHash:hash,mediaType:'application/pdf'});
  expect(stream).toHaveBeenCalledWith('gs://synthetic-private/resumes/test.pdf','7');
  metadata.mockClear();await read('gs://synthetic-private/resumes/test.pdf',{generation:'6',byteLength:bytes.length,contentHash:hash});
  expect(metadata).not.toHaveBeenCalled();expect(stream).toHaveBeenLastCalledWith('gs://synthetic-private/resumes/test.pdf','6');
 });
 it('rejects a foreign bucket before metadata or download',async()=>{
  const metadata=vi.fn(),stream=vi.fn(),read=await reader({metadata,stream});
  await expect(read('gs://other/resumes/test.pdf')).rejects.toThrow('source_unavailable');
  expect(metadata).not.toHaveBeenCalled();expect(stream).not.toHaveBeenCalled();
 });
 it('bounds declared size, streamed bytes and content identity',async()=>{
  const stream=vi.fn(()=>Readable.from([bytes]));
  const read=await reader({metadata:async()=>({generation:'7',size:6*1024*1024}),stream});
  await expect(read('gs://synthetic-private/resumes/test.pdf')).rejects.toThrow('source_unavailable');expect(stream).not.toHaveBeenCalled();
  await expect(read('gs://synthetic-private/resumes/test.pdf',{generation:'7',byteLength:bytes.length-1,contentHash:hash})).rejects.toThrow('source_changed');
  await expect(read('gs://synthetic-private/resumes/test.pdf',{generation:'7',byteLength:bytes.length,contentHash:'f'.repeat(64)})).rejects.toThrow('source_changed');
 });
 it('destroys a stalled stream without falling back or retrying',async()=>{
  const stream=new Readable({read(){}}),open=vi.fn(()=>stream);
  const read=await reader({metadata:async()=>({generation:'7',size:bytes.length}),stream:open});
  await expect(read('gs://synthetic-private/resumes/test.pdf',undefined,10)).rejects.toThrow('source_unavailable');
  expect(stream.destroyed).toBe(true);expect(open).toHaveBeenCalledTimes(1);
 });
 it('rechecks database ownership and privacy after the blob read',async()=>{
  const actor={userId:1,subjectId:randomUUID(),bindingId:randomUUID()};
  const source={source:{sourceId:randomUUID(),sourceVersion:1,contentHash:hash},byteLength:bytes.length,mediaType:'application/pdf' as const,policyVersion:'test',objectHandle:randomUUID()};
  const located={subjectId:actor.subjectId,bindingId:actor.bindingId,gcsPath:'gs://synthetic-private/resumes/test.pdf',generation:'7',contentHash:hash,byteLength:bytes.length,source};
  const query=vi.fn().mockResolvedValueOnce({rows:[{result:located}]}).mockResolvedValueOnce({rows:[{result:{...located,generation:'8'}}]});
  const privacy=vi.fn(async()=>{}),readBlob=vi.fn(async()=>({generation:'7',byteLength:bytes.length,contentHash:hash,mediaType:'application/pdf' as const,bytes}));
  const deps=sourceObjectDependencies({query},privacy,{readBlob});
  await expect(deps.read(actor,source)).rejects.toThrow('source_changed');expect(privacy).toHaveBeenCalledTimes(2);
  expect(readBlob).toHaveBeenCalledWith(located.gcsPath,{generation:'7',byteLength:bytes.length,contentHash:hash});
 });
 it('refuses another binding before any object read',async()=>{
  const actor={userId:1,subjectId:randomUUID(),bindingId:randomUUID()},readBlob=vi.fn();
  const query=vi.fn(async()=>({rows:[{result:{resumeId:1,gcsPath:'private',subjectId:randomUUID(),bindingId:randomUUID()}}]}));
  await expect(sourceObjectDependencies({query},async()=>{},{readBlob}).snapshot(actor,{schemaVersion:1,idempotencyKey:randomUUID(),resumeId:1})).rejects.toThrow('source_changed');
  expect(readBlob).not.toHaveBeenCalled();
 });
});

describe('settled OCR retry binding',()=>{
 const fixture=()=>{
  const request:ReserveRequest={schemaVersion:1,lease:{commandId:randomUUID(),claimToken:randomUUID(),generation:1},
   source:{sourceId:randomUUID(),sourceVersion:1,contentHash:'a'.repeat(64)},consentRevision:1,operationKey:randomUUID(),
   limit:{kind:'ocr',pageCount:1,totalPageCount:1,pageNumbers:[1],contentHash:'a'.repeat(64)}};
  const response:Extract<ReserveResult,{state:'settled'}>={state:'settled',receipt:{reservationId:randomUUID(),dispatchId:randomUUID(),
   operationKey:randomUUID(),state:'settled',reason:'completed',observedUsage:{kind:'ocr',pagesSubmitted:1,transportAttempts:2}},
   result:{canonical:'{}',sha256:'b'.repeat(64)},reuseFor:sourcePaidRequestIdentity(request)};
  return {request,response};
 };
 it('accepts a separately bound OCR receipt without rewriting the paid operation',()=>{
  const {request,response}=fixture(),before=structuredClone(response);
  expect(()=>assertSourceSettledReservation(request,response)).not.toThrow();expect(response).toEqual(before);
 });
 it('keeps normal same-operation replay unchanged',()=>{
  const {request,response}=fixture();delete response.reuseFor;response.receipt.operationKey=request.operationKey;
  expect(()=>assertSourceSettledReservation(request,response)).not.toThrow();
 });
 it.each(['missing','hash','command','operation','source','consent','pages','held','semantic','same-key-proof'])('refuses %s reuse',mode=>{
  const {request,response}=fixture();
  if(mode==='missing')delete response.reuseFor;
  if(mode==='hash')response.reuseFor!.sha256='c'.repeat(64);
  if(mode==='command')request.lease.commandId=randomUUID();
  if(mode==='operation')request.operationKey=randomUUID();
  if(mode==='source')request.source.sourceVersion++;
  if(mode==='consent')request.consentRevision++;
  if(mode==='pages'&&request.limit.kind==='ocr')request.limit.totalPageCount=2;
  if(mode==='held')response.receipt.state='held';
  if(mode==='semantic'){
   request.limit={kind:'semantic_model',model:'synthetic',inputTokens:1,maxOutputTokens:1,textHash:'a'.repeat(64)};
   response.reuseFor=sourcePaidRequestIdentity(request);
  }
  if(mode==='same-key-proof')response.receipt.operationKey=request.operationKey;
  expect(()=>assertSourceSettledReservation(request,response)).toThrow('outcome_unknown');
 });
});
describe('source paid-operation replay identity',()=>{
 const request=()=>({schemaVersion:1,lease:{commandId:randomUUID(),claimToken:randomUUID(),generation:1},
  source:{sourceId:randomUUID(),sourceVersion:1,contentHash:'a'.repeat(64)},consentRevision:1,operationKey:randomUUID(),
  limit:{kind:'semantic_model',model:'synthetic-model',inputTokens:100,maxOutputTokens:200,textHash:'b'.repeat(64)}});
 it('permits an identical operation under a new lease without changing its fingerprint',()=>{
  const old=request(),fresh={...old,lease:{...old.lease,claimToken:randomUUID(),generation:2}};
  expect(sourcePaidRequestIdentity(fresh)).toEqual(sourcePaidRequestIdentity(old));
  expect(()=>assertSourcePaidReplay(old,fresh)).not.toThrow();
 });
 it.each(['textHash','model','inputTokens','maxOutputTokens'])('refuses changed %s before reusing a paid result',field=>{
  const old=request(),fresh=structuredClone(old);
  if(field==='textHash')fresh.limit.textHash='c'.repeat(64);
  if(field==='model')fresh.limit.model='different-model';
  if(field==='inputTokens')fresh.limit.inputTokens++;
  if(field==='maxOutputTokens')fresh.limit.maxOutputTokens++;
  expect(()=>assertSourcePaidReplay(old,fresh)).toThrow(/^idempotency_conflict$/);
 });
 it.each(['commandId','operationKey','sourceId','sourceVersion','contentHash','consentRevision'])('binds %s to the operation',field=>{
  const old=request(),fresh=structuredClone(old);
  if(field==='commandId')fresh.lease.commandId=randomUUID();
  if(field==='operationKey')fresh.operationKey=randomUUID();
  if(field==='sourceId')fresh.source.sourceId=randomUUID();
  if(field==='sourceVersion')fresh.source.sourceVersion++;
  if(field==='contentHash')fresh.source.contentHash='d'.repeat(64);
  if(field==='consentRevision')fresh.consentRevision++;
  expect(()=>assertSourcePaidReplay(old,fresh)).toThrow(/^idempotency_conflict$/);
 });
 it('never accepts or leaks an account email in a paid request',()=>{
  expect(()=>sourcePaidRequestIdentity({...request(),verifiedAccountEmail:'private@example.invalid'})).toThrow(/^invalid_request$/);
 });
 it('validates the changing lease even though it is excluded from the purchase identity',()=>{
  const old=request();
  expect(()=>sourcePaidRequestIdentity({...old,lease:{...old.lease,generation:0}})).toThrow(/^invalid_request$/);
 });
 it('binds OCR to the exact source and page budget',()=>{
  const base=request(),old={...base,limit:{kind:'ocr',pageCount:2,totalPageCount:3,pageNumbers:[1,3],contentHash:base.source.contentHash}};
  expect(()=>assertSourcePaidReplay(old,{...old,limit:{...old.limit,pageCount:3,pageNumbers:[1,2,3]}})).toThrow('idempotency_conflict');
  expect(()=>assertSourcePaidReplay(old,{...old,limit:{...old.limit,pageNumbers:[1,2]}})).toThrow('idempotency_conflict');
  expect(()=>sourcePaidRequestIdentity({...old,limit:{...old.limit,pageNumbers:[1,1]}})).toThrow('invalid_request');
  expect(()=>sourcePaidRequestIdentity({...old,limit:{...old.limit,contentHash:'f'.repeat(64)}})).toThrow('source_changed');
 });
});

describe('internal-only source scrub context',()=>{
 it('uses the verified account value without extracting another contact',()=>{
  expect(verifiedSourceScrubContext('Owner@example.invalid',true)).toEqual({verifiedAccountEmail:'Owner@example.invalid'});
 });
 it.each([false,null,undefined,'true',1])('refuses verification state %s',verified=>{
  expect(()=>verifiedSourceScrubContext('owner@example.invalid',verified)).toThrow('privacy_changed');
 });
 it.each(['not-an-email','owner@example.invalid\nsecret','x'.repeat(321),null])('refuses malformed contact without including it in errors',email=>{
  expect(()=>verifiedSourceScrubContext(email,true)).toThrow(/^privacy_changed$/);
 });
 it('does not admit an extra resume contact or application contact',()=>{
  expect(sourceScrubContextSchema.safeParse({verifiedAccountEmail:'owner@example.invalid',resumeEmail:'other@example.invalid'}).success).toBe(false);
 });
});

describe('P2 product source transfer (no receiver activation)',()=>{
 const digest=(v:unknown)=>createHash('sha256').update(canonicalProfileJson(v)).digest('hex');
 const fixture=()=>{
  const sourceId=randomUUID(),contentHash='a'.repeat(64),prefix='👩🏽‍💻 नमस्ते\n',quote='Built Go services';
  const body={schemaVersion:1,proposalId:randomUUID(),sourceId,sourceVersion:1,
   originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0,
   sourceKind:'resume',facts:[{factId:randomUUID(),kind:'skill',targetRowId:null,value:'Go',
    evidence:[{sourceId,sourceVersion:1,contentHash,locator:`text:${prefix.length}:${quote.length}`,quote}]}],
   reviewNotes:[],expiresAt:'2026-11-01T00:00:00.000Z'};
  const text=prefix+quote;
  return {schemaVersion:1,commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),sourceId,sourceVersion:1,
   contentHash,textHash:createHash('sha256').update(text).digest('hex'),policyVersion:'source-v1',consentRevision:1,text,
   proposal:{...body,proposalHash:digest(body)}};
 };
 it('keeps Unicode quote offsets and exact hashes, with canonical replay',()=>{
  const value=fixture(),parsed=server.validateResumeTransfer(value);
  expect(parsed.value).toEqual(value);expect(server.parseResumeTransfer(parsed.canonical)).toEqual(parsed);
 });
 it('never admits the internal scrub context or account email into a Memory transfer',()=>{
  const value=fixture();
  expect(()=>server.validateResumeTransfer({...value,scrubContext:{verifiedAccountEmail:'owner@example.invalid'}})).toThrow();
  expect(()=>server.validateResumeTransfer({...value,verifiedAccountEmail:'owner@example.invalid'})).toThrow();
 });
 it.each(['text','proposal','source','quote'])('rejects a tampered %s',kind=>{
  const value=fixture();
  if(kind==='text')value.text+='edited';
  if(kind==='proposal')value.proposal.proposalHash='b'.repeat(64);
  if(kind==='source')value.sourceId=randomUUID();
  if(kind==='quote'){
   value.proposal.facts[0]!.evidence[0]!.locator='text:1:1';
   const {proposalHash,...body}=value.proposal;value.proposal.proposalHash=digest(body);
  }
  expect(()=>server.validateResumeTransfer(value)).toThrow();
 });
 it('rejects duplicate fields and oversize raw input',()=>{
  const raw=JSON.stringify(fixture());
  expect(()=>server.parseResumeTransfer(raw.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'))).toThrow();
  expect(()=>server.parseResumeTransfer(' '.repeat(2*1024*1024+1))).toThrow();
 });
 it('binds the receipt to the exact transfer and forbids publication claims',()=>{
  const request=fixture(),parsed=server.validateResumeTransfer(request);
  const receipt={schemaVersion:1,commandId:request.commandId,subjectId:request.subjectId,bindingId:request.bindingId,
   commandHash:parsed.hash,sourceId:request.sourceId,sourceVersion:request.sourceVersion,
   proposalId:request.proposal.proposalId,proposalHash:request.proposal.proposalHash,
   outcome:'stored',reason:null,canonicalProfileChanged:false,publicationActive:false};
  expect(server.validateSourceReceipt(request,receipt)).toEqual(receipt);
  expect(()=>server.validateSourceReceipt(request,{...receipt,subjectId:randomUUID()})).toThrow();
  expect(()=>server.validateSourceReceipt(request,{...receipt,publicationActive:true})).toThrow();
 });
});

describe('shared browser-safe Spark schemas',()=>{
 it('uses identical schema objects in browser exports and server parsing',()=>{
  for(const name of ['commandSchema','preferenceSectionSchema','consentCaptureSchema','receiptSchema','storageReadSchema',
   'admissionSchema','commandReadSchema','pendingCommandSchema','ownerConsent','captureReceipt'] as const)
   expect(server[name]).toBe(shared[name]);
 });
 it('bundles for a browser without Node builtins or server modules',async()=>{
  const result=await build({entryPoints:['shared/candidate-spark-v3.ts'],bundle:true,platform:'browser',format:'esm',write:false,metafile:true});
  expect(result.outputFiles).toHaveLength(1);
  expect(Object.keys(result.metafile!.inputs).some(path=>path.includes('server/'))).toBe(false);
  expect(result.metafile!.outputs[Object.keys(result.metafile!.outputs)[0]!]!.imports).toEqual([]);
 });
 it('keeps public polling metadata strict and excludes command contents',()=>{
  const pending={schemaVersion:3,commandId:'00000000-0000-4000-8000-000000000001',action:'confirm',status:'held',reason:'expiry_reconciling'};
  expect(shared.pendingCommandSchema.parse(pending)).toEqual(pending);
  expect(shared.pendingCommandSchema.safeParse({...pending,body:'private'}).success).toBe(false);
 });
});

const id='00000000-0000-4000-8000-000000000001';
const grant={schemaVersion:2,idempotencyKey:id,expectedConsentRevision:0,
 action:'grant',copyVersion:2,copyHash:'a'.repeat(64)};
const withdraw={schemaVersion:2,idempotencyKey:id,expectedConsentRevision:1,action:'withdraw'};
const parse=(value:unknown)=>parseConsentCapture(JSON.stringify(value));

describe('owner save-resolution wire contract (not activated)',()=>{
 const request={schemaVersion:1,idempotencyKey:id,expectedResolutionRevision:0,action:'retry'};
 it.each(['retry','discard'])('accepts only an existing-save resolution intent: %s',action=>{
  const value={...request,action};expect(parseSaveResolution(JSON.stringify(value)).value).toEqual(value);
  expect(parseSaveResolution(JSON.stringify(value)).hash).toBe(parseSaveResolution(JSON.stringify({action,expectedResolutionRevision:0,idempotencyKey:id,schemaVersion:1})).hash);
 });
 it.each(['body','subjectId','bindingId','commandId','status','providerAttemptId','resetAllowance'])('rejects authority or replacement field %s',key=>{
  expect(()=>parseSaveResolution(JSON.stringify({...request,[key]:'injected'}))).toThrow();
 });
 it('rejects duplicates, oversize requests and exhausted revision counters',()=>{
  expect(()=>parseSaveResolution(JSON.stringify(request).replace('"action":"retry"','"action":"discard","action":"retry"'))).toThrow();
  expect(()=>parseSaveResolution(' '.repeat(4097))).toThrow('payload_too_large');
  expect(()=>parseSaveResolution(JSON.stringify({...request,expectedResolutionRevision:Number.MAX_SAFE_INTEGER}))).toThrow();
 });
 it.each([2,3])('resolving protocol %s never claims the save is discarded or unblocks confirmation',commandSchemaVersion=>{
  const value={schemaVersion:1,commandId:id,commandSchemaVersion,resolutionRevision:1,state:'resolving',reason:'outcome_unknown',
   canRetry:false,canDiscard:false,blocksConfirmation:true};
  expect(shared.saveResolutionViewSchema.parse(value)).toEqual(value);
  expect(shared.saveResolutionViewSchema.safeParse({...value,blocksConfirmation:false}).success).toBe(false);
  expect(shared.saveResolutionViewSchema.safeParse({...value,state:'discarded'}).success).toBe(false);
  expect(shared.saveResolutionViewSchema.safeParse({...value,state:'discarded',reason:'discard_acknowledged',blocksConfirmation:false}).success).toBe(true);
 });
 it('operator review stops automated actions but cannot pretend the unknown save is harmless',()=>{
  const value={schemaVersion:1,commandId:id,commandSchemaVersion:3,resolutionRevision:2,state:'operator_review',reason:'recovery_exhausted',
   canRetry:false,canDiscard:false,blocksConfirmation:true};
  expect(shared.saveResolutionViewSchema.parse(value)).toEqual(value);
  expect(shared.saveResolutionViewSchema.safeParse({...value,canRetry:true}).success).toBe(false);
 });
});

describe('browser consent capture boundary (not a service projection)',()=>{
 it('accepts a versioned copy selection without treating it as approved',()=>{
  expect(parse(grant).value).toEqual(grant);
  // Approval, verified email, actor ownership and current version remain SQL
  // and route checks. Parsing alone grants no authority and sends nothing.
 });
 it('lets withdrawal omit copy and purposes entirely',()=>expect(parse(withdraw).value).toEqual(withdraw));
 it.each(['subjectId','bindingId','userId','eventId','purposes','approved','marketing'])('rejects browser authority or unrelated field %s',field=>{
  expect(()=>parse({...grant,[field]:field==='purposes'?[]:id})).toThrow();
  expect(()=>parse({...withdraw,[field]:id})).toThrow();
 });
 it.each([-1,0.5,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1])('rejects unusable expected revision %s',revision=>{
  expect(()=>parse({...grant,expectedConsentRevision:revision})).toThrow();
 });
 it('accepts the largest revision with room for the next event',()=>{
  expect(parse({...grant,expectedConsentRevision:Number.MAX_SAFE_INTEGER-1}).value.expectedConsentRevision).toBe(Number.MAX_SAFE_INTEGER-1);
 });
 it.each([0,-1,1.5,2147483648,'2',null])('rejects non-PostgreSQL copy version %s',copyVersion=>{
  expect(()=>parse({...grant,copyVersion})).toThrow();
 });
 it('rejects missing copy, malformed hash, schema and idempotency key',()=>{
  const {copyHash,...missing}=grant;
  for(const value of [missing,{...grant,copyHash:'draft'},{...grant,schemaVersion:3},{...grant,idempotencyKey:'new-key'}])expect(()=>parse(value)).toThrow();
 });
 it('withdrawal cannot smuggle a new copy acceptance',()=>{
  expect(()=>parse({...withdraw,copyVersion:2,copyHash:grant.copyHash})).toThrow();
 });
 it('rejects duplicate keys before JSON loses the evidence',()=>{
  expect(()=>parseConsentCapture(JSON.stringify(grant).replace('"action":"grant"','"action":"withdraw","action":"grant"'))).toThrow();
 });
 it('bounds raw bytes, including padding and multibyte text',()=>{
  expect(()=>parseConsentCapture(' '.repeat(4096)+JSON.stringify(grant))).toThrow('payload_too_large');
  expect(()=>parseConsentCapture(JSON.stringify({...grant,extra:'é'.repeat(2048)}))).toThrow('payload_too_large');
 });
 it('hashes identical retries identically despite key order',()=>{
  expect(parse(Object.fromEntries(Object.entries(grant).reverse()))).toEqual(parse(grant));
  expect(parse({...grant,expectedConsentRevision:1}).hash).not.toBe(parse(grant).hash);
 });
 it('does not accept the browser request on the service projection boundary',()=>{
  expect(()=>parseConsentProjection(JSON.stringify(grant))).toThrow();
  expect(()=>parseConsentProjection(JSON.stringify(withdraw))).toThrow();
 });
});

describe('version 3 wizard delivery without weakening version 2',()=>{
 afterEach(()=>vi.useRealTimers());
 const command=()=>({schemaVersion:3,idempotencyKey:randomUUID(),expectedDraftVersion:0,
  expectedProfileVersion:0,expectedPreferenceVersion:0,expectedPreferenceDraftRevision:0,
  action:'save_preference_section',payload:{section:'employment_types',answered:true,value:['permanent','gig_freelance']}});
 const lease=(value=command()):ProfileLease=>{const parsed=parseCommand(JSON.stringify(value));
  return {commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),userId:7,authVersion:2,
   idempotencyKey:value.idempotencyKey,leaseToken:randomUUID(),leaseGeneration:1,attemptCount:1,
   body:parsed.canonical,hash:parsed.hash};};
 const receipt=(l:ProfileLease)=>({schemaVersion:3,commandId:l.commandId,subjectId:l.subjectId,bindingId:l.bindingId,
  commandHash:l.hash,status:'applied',reason:null,changed:true,draftVersion:0,profileVersion:0,
  preferenceVersion:0,preferenceDraftRevision:1,preferenceDraftHash:'b'.repeat(64),publicationActive:false});
 const env={ACTIVEKG_BASE_URL:'https://memory.invalid'};
 it('keeps the exact v3 body and signs server-owned identity for the v3 endpoint',async()=>{
  const l=lease(),sign=vi.fn().mockResolvedValue('synthetic'),fetch=vi.fn().mockResolvedValue(Response.json(receipt(l)));
  expect(await deliverProfile(l,new AbortController().signal,{env,sign,fetch})).toEqual(receipt(l));
  expect(sign).toHaveBeenCalledWith('activekg',{tenantId:`candidate_${l.subjectId}`,scopes:'candidate-profile:owner-write',
   actorType:'service',requestId:l.commandId,lifetimeSeconds:60});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('https://memory.invalid/candidate-profiles/spark/commands');
  expect(fetch.mock.calls[0]![1]).toMatchObject({method:'POST',redirect:'error',body:l.body,
   headers:{'X-Candidate-Command-SHA256':l.hash,'X-Candidate-Binding-ID':l.bindingId,'X-Candidate-Command-ID':l.commandId}});
 });
 it.each([1,4,'3',null])('rejects unsupported version %s without falling back',schemaVersion=>{
  expect(()=>parseQueuedProfileCommand(JSON.stringify({...command(),schemaVersion}))).toThrow();
 });
 it('refuses a malformed v3 envelope instead of trying the v2 parser',()=>{
  const value=command();delete (value as Partial<typeof value>).expectedPreferenceDraftRevision;
  expect(()=>parseQueuedProfileCommand(JSON.stringify(value))).toThrow();
 });
 it.each(['hash','idempotencyKey','body'])('refuses changed queued %s before signing or dispatch',async field=>{
  const l=lease(),sign=vi.fn(),fetch=vi.fn();
  if(field==='hash')l.hash='f'.repeat(64);else if(field==='idempotencyKey')l.idempotencyKey=randomUUID();else l.body+=' ';
  await expect(deliverProfile(l,new AbortController().signal,{env,sign,fetch})).rejects.toThrow();
  expect(sign).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['commandId','subjectId','bindingId','commandHash'])('refuses a receipt with a different %s',async field=>{
  const l=lease(),reply={...receipt(l),[field]:field==='commandHash'?'f'.repeat(64):randomUUID()};
  await expect(deliverProfile(l,new AbortController().signal,{env,sign:async()=> 'synthetic',fetch:async()=>Response.json(reply)}))
   .rejects.toMatchObject({code:'identity_conflict'});
 });
 it.each(['old_version','missing_revision','publication','invalid_change','extra'])('refuses invalid receipt %s',async defect=>{
  const l=lease(),reply:any=receipt(l);
  if(defect==='old_version')reply.schemaVersion=2;
  if(defect==='missing_revision')delete reply.preferenceDraftRevision;
  if(defect==='publication')reply.publicationActive=true;
  if(defect==='invalid_change'){reply.status='rejected';reply.reason='stale_edit';}
  if(defect==='extra')reply.profile={private:'unrequested'};
  await expect(deliverProfile(l,new AbortController().signal,{env,sign:async()=> 'synthetic',fetch:async()=>Response.json(reply)}))
   .rejects.toMatchObject({code:'delivery_outcome_unknown'});
 });
 it.each([404,409])('never retries or falls back after a v3 endpoint refusal %s',async status=>{
  const fetch=vi.fn().mockResolvedValue(new Response('',{status}));
  await expect(deliverProfile(lease(),new AbortController().signal,{env,sign:async()=> 'synthetic',fetch}))
   .rejects.toMatchObject({code:'identity_conflict'});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('limits reply bytes and refuses duplicate keys',async()=>{
  for(const body of ['x'.repeat(8193),'{"schemaVersion":3,"schemaVersion":2}']){
   await expect(deliverProfile(lease(),new AbortController().signal,{env,sign:async()=> 'synthetic',fetch:async()=>new Response(body)}))
    .rejects.toMatchObject({code:'delivery_outcome_unknown'});
  }
 });
 it('does not dispatch after a late signature passes the total deadline',async()=>{
  vi.useFakeTimers();const fetch=vi.fn();let complete!:(s:string)=>void;
  const pending=deliverProfile(lease(),new AbortController().signal,{env,fetch,sign:()=>new Promise(resolve=>{complete=resolve;})});
  const rejection=expect(pending).rejects.toMatchObject({code:'memory_unavailable'});
  await vi.advanceTimersByTimeAsync(10001);await rejection;complete('late');await vi.advanceTimersByTimeAsync(1);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('settles the exact v3 receipt through the existing durable worker',async()=>{
  const l=lease(),result=receipt(l),finish=vi.fn();
  expect(await runProfileBatch({enabled:()=>true,claim:async()=>[l],authority:async()=>{},deliver:async()=>result,finish})).toBe(1);
  expect(finish).toHaveBeenCalledWith(l,{state:'applied',receipt:result});
 });
 it('records a rejected v3 receipt without inventing a successful save',async()=>{
  const l=lease(),result={...receipt(l),status:'rejected',reason:'stale_edit',changed:false},finish=vi.fn();
  await runProfileBatch({enabled:()=>true,claim:async()=>[l],authority:async()=>{},deliver:async()=>result,finish});
  expect(finish).toHaveBeenCalledWith(l,{state:'rejected',receipt:result});
 });
 it('does not settle a version-2 receipt as a version-3 success',async()=>{
  const l=lease(),finish=vi.fn();
  await runProfileBatch({enabled:()=>true,claim:async()=>[l],authority:async()=>{},deliver:async()=>({...receipt(l),schemaVersion:2}),finish});
  expect(finish).toHaveBeenCalledWith(l,{state:'retry',reason:'delivery_outcome_unknown',delayMs:250});
 });
 it('a late authority reply cannot dispatch a v3 save after the worker deadline',async()=>{
  vi.useFakeTimers();const l=lease(),finish=vi.fn(),deliver=vi.fn();let release!:()=>void;
  const run=runProfileBatch({enabled:()=>true,claim:async()=>[l],authority:()=>new Promise(resolve=>{release=resolve;}),deliver,finish});
  await vi.advanceTimersByTimeAsync(15001);await run;
  expect(finish).toHaveBeenCalledWith(l,{state:'retry',reason:'authority_unavailable',delayMs:250});
  release();await vi.advanceTimersByTimeAsync(1);expect(deliver).not.toHaveBeenCalled();
 });
});
