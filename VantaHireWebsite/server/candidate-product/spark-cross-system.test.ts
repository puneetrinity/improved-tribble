import {describe,it,expect,vi} from 'vitest';
import {Pool} from 'pg';
import {planErasure,executeErasure} from '../../scripts/erase-spark-candidate';
import {randomUUID,createHash} from 'node:crypto';
import express from 'express';
const routeDb=vi.hoisted(()=>({pool:null as Pool|null}));
vi.mock('../db',()=>({pool:{query:(sql:string,args:unknown[])=>routeDb.pool!.query(sql,args)}}));
// Synthetic logged-in session and privacy availability only. Route composition,
// repositories, both databases, signing and Memory authorization remain real.
vi.mock('../auth',()=>({requireVerifiedCandidate:(_req:unknown,_res:unknown,next:()=>void)=>next(),
 privacyPasswordVersion:(password:string)=>createHash('sha256').update(password).digest('hex')}));
vi.mock('../candidate-privacy/decision',()=>({requireCandidatePrivacyAllowed:async()=>{},CandidatePrivacyRestrictedError:class extends Error{}}));
import {runConsentV2Once} from './consent-v2';
import {sendConsentV2,ConsentTransportError} from './spark-client';
import {parseConsentProjection} from './spark-contracts';
import {signServiceJwt} from '../lib/services/jwt-signer';
import {deliverProfile,recoverProfileExpiry,readSparkProfile,readSourceProposal,deliverInterpretationProposal,readInterpretationProposal,previewExclusions} from './profile-client';
import {interpretCandidateText,interpretationJournal} from './interpretation';
import {profileRepository} from './profile-repository';
import {runProfileBatch,runProfileExpiryBatch} from './profile-processor';
import {resumeSourceRepository} from './resume-source-repository';
import {sourceObjectDependencies,withCachedResumeExtraction,lookupRepository,lookupQueueRepository} from './source-repository';
import {runLookupAttempt,runLookupDelivery,runLookupQueueOnce} from './source-processor';
import {deliverLookupTransfer} from './source-adapters';
import {processResumeSource,type ResumeProcessorDependencies} from './resume-source-processor';
import {extractResumeSource} from './resume-source';
import {deliverResumeTransfer} from './resume-source-client';
import {canonicalProfileJson} from './profile-contracts';
import {eraseSparkNetworkForRequest} from '../candidate-privacy/repository';

// Production workers poll when SKIP LOCKED yields no work. Exercise that same
// bounded behavior across subprocesses; never repeat after a successful claim.
async function claimExpected(run:()=>Promise<number>,expected:number){
 const deadline=Date.now()+5000;
 for(;;){const count=await run();if(count!==0||expected===0||Date.now()>=deadline)return count;
  await new Promise(resolve=>setTimeout(resolve,100));}
}

// Invoked by Memory's full-schema test with ephemeral signing keys and local URLs.
// No prototype modules, owner database credentials, or external provider are used.
describe.skipIf(process.env.SPARK_CROSS_SYSTEM!=='1')('signed product consent across Flow and Memory',()=>{
 it('executes the requested synthetic scenario with routine-only Flow authority',async()=>{
  const dsn=new URL(process.env.SPARK_FLOW_RUNTIME_URL!),origin=new URL(process.env.SPARK_MEMORY_ORIGIN!);
  const match=/^\/flow_schema_control_test_([a-f0-9]{10})$/.exec(dsn.pathname);
  if(process.env.S2_PROTOTYPE_DISPOSABLE!=='1'||dsn.hostname!=='127.0.0.1'||!match||
   dsn.username!==`flow_schema_control_test_runtime_${match[1]}`||origin.hostname!=='127.0.0.1'||origin.protocol!=='http:')throw Error('local_test_only');
  const pool=new Pool({connectionString:dsn.href,max:1,connectionTimeoutMillis:2000,statement_timeout:5000});
  try{
   expect((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
   await expect(pool.query('SELECT * FROM candidate_profile_commands')).rejects.toThrow(/permission denied/);
   const mode=process.env.SPARK_SCENARIO!;
   if(mode==='interpretation_lost_reply'){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    process.env.ACTIVEKG_BASE_URL=origin.origin;process.env.CANDIDATE_FOUNDATION_DISPOSABLE_TEST='1';
    const deps={sign:signServiceJwt};
    const before=await readSparkProfile(input.subjectId,input.bindingId,deps);
    const versions={expectedDraftVersion:before.draftVersion,expectedProfileVersion:before.profileVersion,
     expectedPreferenceVersion:before.preferenceVersion,expectedPreferenceDraftRevision:before.preferenceDraft?.preferenceDraftRevision??0};
    const request={schemaVersion:1,idempotencyKey:randomUUID(),...versions,use:'change_preferences',
     text:'I want permanent employment',sourceProposalId:null,sourceVersion:null,targetRowId:null};
    let purchases=0;
    const model=async()=>{purchases++;return {content:JSON.stringify({status:'proposal',summary:'Permanent employment',
     changes:[{kind:'preference_section',answer:{section:'employment_types',answered:true,value:['permanent']}}]}),usage:{inputTokens:100,outputTokens:50}};};
    const run=()=>interpretCandidateText(JSON.stringify(request),{
     authorize:async()=>({authorityHash:'a'.repeat(64),versions,source:null,companyIds:[]}),
     budget:()=>({model:'synthetic-no-provider',maxInputTokens:10000,maxOutputTokens:1000,deadlineMs:20000,proposalTtlMs:86400000}),model,
     ...interpretationJournal(pool,{userId:input.userId,authVersion:1,consentRevision:input.consentRevision}),
    });
    const proposal=await run();if(proposal.status!=='proposal')throw Error(JSON.stringify(proposal));
    const wire=canonicalProfileJson({schemaVersion:1,commandId:proposal.proposalId,subjectId:input.subjectId,bindingId:input.bindingId,
     consentRevision:input.consentRevision,use:request.use,sourceProposalId:null,sourceVersion:null,targetRowId:null,proposal});
    const lost:typeof fetch=async(...args)=>{const response=await fetch(...args);expect(response.status).toBe(200);await response.arrayBuffer();throw Error('lost committed reply');};
    await expect(deliverInterpretationProposal(wire,new AbortController().signal,{...deps,fetch:lost})).rejects.toMatchObject({code:'delivery_outcome_unknown'});
    expect(await run()).toEqual(proposal);expect(purchases).toBe(1);
    const receipt=await deliverInterpretationProposal(wire,new AbortController().signal,deps);expect(receipt.outcome).toBe('stored');
    expect(await readInterpretationProposal(input.subjectId,input.bindingId,proposal.proposalId,deps)).toEqual(proposal);
    const repo=profileRepository(pool,async()=>{}),actor={userId:input.userId,authVersion:1,passwordVersion:null,reauthenticatedAt:null};
    const body=canonicalProfileJson({schemaVersion:3,idempotencyKey:randomUUID(),...versions,action:'accept_interpretation',payload:{proposalId:proposal.proposalId,proposalHash:proposal.proposalHash}});
    const admitted=await repo.admit(actor,body);
    const worker={enabled:()=>true,claim:repo.claim,authority:repo.authority,finish:repo.finish,deliver:(lease:any,signal:AbortSignal)=>deliverProfile(lease,signal,deps)};
    expect(await claimExpected(()=>runProfileBatch(worker),1)).toBe(1);
    expect((await repo.readCommand({userId:input.userId,authVersion:1},admitted.commandId)).status).toBe('applied');
    const after=await readSparkProfile(input.subjectId,input.bindingId,deps);
    expect(after.preferenceDraft?.sections.employment_types).toEqual({answered:true,value:['permanent']});
    expect(after.publicationActive).toBe(false);expect(after.profileVersion).toBe(before.profileVersion);
    expect(await repo.admit(actor,body)).toEqual({...admitted,status:'applied'});
    expect(purchases).toBe(1);
    const preview=await previewExclusions(input.subjectId,input.bindingId,{idempotencyKey:randomUUID(),
     expectedPreferenceDraftRevision:after.preferenceDraft!.preferenceDraftRevision,restrictions:[{kind:'remote_only'}]},new AbortController().signal,deps);
    expect(preview.unknownPolicy).toBe('show_with_warning');
    expect((await readSparkProfile(input.subjectId,input.bindingId,deps)).preferenceDraft?.exclusions).toEqual(after.preferenceDraft?.exclusions);
    const exclusionBody=canonicalProfileJson({schemaVersion:3,idempotencyKey:randomUUID(),...versions,
     expectedPreferenceDraftRevision:after.preferenceDraft!.preferenceDraftRevision,action:'accept_exclusions',payload:{proposalId:preview.proposalId,proposalHash:preview.proposalHash}});
    await repo.admit(actor,exclusionBody);expect(await claimExpected(()=>runProfileBatch(worker),1)).toBe(1);
    expect((await readSparkProfile(input.subjectId,input.bindingId,deps)).preferenceDraft?.exclusions.some(r=>r.kind==='remote_only')).toBe(true);
   }else if(mode==='operator_erase'||mode==='operator_erase_restored'){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    const flowOwner=new Pool({connectionString:process.env.SPARK_TEST_FLOW_OWNER_URL,max:1});
    const memoryOwner=new Pool({connectionString:process.env.SPARK_TEST_MEMORY_OWNER_URL,max:1});
    const f=await flowOwner.connect(),m=await memoryOwner.connect();let removed=0;
    const blobs={inspect:async()=> '1',remove:async()=>{removed++;}};
    try{
     const plan=await planErasure(f,m,input.requestId,blobs);expect(plan.unresolvedFiles).toBe(0);
     if(mode==='operator_erase')expect(plan.deleteFiles).toBeGreaterThan(0);
     else expect(plan.deleteFiles).toBe(0); // Flow already erased; restored Memory must still be scrubbed.
     expect(removed).toBe(0);
     const retained=async()=>(await f.query("SELECT (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM applications a) applications")).rows[0];
     const retainedBefore=await retained();
     await expect(executeErasure(f,m,blobs,input.requestId,'0'.repeat(64))).rejects.toThrow('plan_changed');
     expect((await executeErasure(f,m,blobs,input.requestId,plan.planHash)).status).toBe('complete');
     expect(removed).toBe(plan.deleteFiles);const before=removed;
     const replay=await planErasure(f,m,input.requestId,blobs);
     await executeErasure(f,m,blobs,input.requestId,replay.planHash);expect(removed).toBe(before);
     expect(await retained()).toEqual(retainedBefore);
     expect((await m.query('SELECT restricted FROM candidate_profile_heads WHERE subject_id=$1',[input.subjectId])).rows[0].restricted).toBe(true);
    }finally{f.release();m.release();await flowOwner.end();await memoryOwner.end();}
   }else if(mode==='erase_runtime_denied'){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!);routeDb.pool=pool;
    process.env.ACTIVEKG_BASE_URL=origin.origin;process.env.CANDIDATE_FOUNDATION_DISPOSABLE_TEST='1';
    const claim={requestId:input.requestId,outboxId:randomUUID(),leaseToken:randomUUID(),
     action:'request_erasure' as const,authorityType:'verified_candidate' as const,evidenceRef:randomUUID(),reasonCode:'candidate_erasure_request' as const};
    const original=globalThis.fetch;let sends=0;
    const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(...args)=>{
     sends++;const response=await original(...args);
     return response;
    });
    try{
     await expect(eraseSparkNetworkForRequest(claim)).rejects.toMatchObject({code:'42501'});
     expect(sends).toBe(0);
    }finally{spy.mockRestore();}
   }else if(mode==='lookup_lost_reply'||mode==='lookup_recover'){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    const deps={env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'}};
    const repo=lookupRepository(pool,async()=>{},{userId:input.userId,authVersion:1});let calls=0;
    const attempt=await repo.admit(JSON.stringify({schemaVersion:1,idempotencyKey:input.requestKey,kind:'email',expectedConsentRevision:input.consentRevision})).catch(error=>{
     console.log('Synthetic lookup admission diagnostic', {code:error.code,where:error.where});throw error;});
    const purchase=()=>runLookupAttempt(attempt.attemptId,{...repo,enabled:()=>true,lookup:async()=>{calls++;return {outcome:'matched',creditsConsumed:2,
     person:{linkedinUrl:'https://linkedin.com/in/synthetic',photoUrl:'https://media.licdn.com/dms/image/synthetic',firstName:'सिंथेटिक',lastName:'Person',skills:['Lookup skill'],experience:[],education:[]},alternativeCount:0,partial:false};}});
    const delivery={repository:repo,readVersions:async(subjectId:string,bindingId:string)=>{
     if(mode==='lookup_recover')throw Error('must_reuse_stored_transfer');
     const view=await readSparkProfile(subjectId,bindingId,deps);return {originalDraftVersion:view.draftVersion,originalProfileVersion:view.profileVersion,
      originalPreferenceVersion:view.preferenceVersion,originalPreferenceDraftRevision:view.preferenceDraft?.preferenceDraftRevision??0};},
     deliver:async(stored:Parameters<typeof deliverLookupTransfer>[0])=>{
      const receipt=await deliverLookupTransfer(stored,deps);if(mode==='lookup_lost_reply')throw Error('synthetic_lost_reply');return receipt;}};
    const queue={...lookupQueueRepository(pool),enabled:()=>true,purchase,deliver:()=>runLookupDelivery(attempt.attemptId,delivery)};
    if(mode==='lookup_lost_reply'){
     expect(await runLookupQueueOnce(queue)).toBe(1);expect(calls).toBe(1);
     expect(await runLookupQueueOnce(queue)).toBe(1);expect((await repo.status(attempt.attemptId)).state).toBe('transferring');
    }
    else{
     // Memory has the proposal while Flow still awaits the lost receipt.
     // Apply not-me in that gap, before delivery recovery reaches review_ready.
     expect((await repo.status(attempt.attemptId)).state).toBe('transferring');
     const stored=(await repo.prepareDelivery(attempt.attemptId))!.transfer!;
     const proposalId=JSON.parse(stored.canonical).proposal.proposalId;
     const proposal=await readSourceProposal(input.subjectId,input.bindingId,attempt.attemptId,proposalId,deps);
     expect(proposal.sourceKind).toBe('professional_lookup');expect(proposal.facts.some(f=>f.kind==='skill'&&f.value==='Lookup skill')).toBe(true);
     expect(proposal.facts.find(f=>f.kind==='photo')?.value).toEqual({url:'https://media.licdn.com/dms/image/synthetic'});
     const profiles=profileRepository(pool,async()=>{}),before=await readSparkProfile(input.subjectId,input.bindingId,deps);
     const reject={schemaVersion:3,idempotencyKey:randomUUID(),action:'reject_source',
      expectedDraftVersion:before.draftVersion,expectedProfileVersion:before.profileVersion,expectedPreferenceVersion:before.preferenceVersion,
      expectedPreferenceDraftRevision:before.preferenceDraft?.preferenceDraftRevision??0,
      payload:{proposalId:proposal.proposalId,proposalHash:proposal.proposalHash,sourceVersion:1,reason:'not_me'}};
     await profiles.admit({userId:input.userId,authVersion:1,passwordVersion:null,reauthenticatedAt:null},JSON.stringify(reject));
     expect((await repo.status(attempt.attemptId)).canRequestLinkedin).toBe(false);
     expect(await claimExpected(()=>runProfileBatch({enabled:()=>true,claim:profiles.claim,authority:profiles.authority,finish:profiles.finish,
      deliver:(lease,signal)=>deliverProfile(lease,signal,deps)}),1)).toBe(1);
     expect(await repo.status(attempt.attemptId)).toMatchObject({state:'transferring',canRequestLinkedin:false});
     expect(await runLookupQueueOnce(queue)).toBe(1);expect(calls).toBe(0);
     expect(await runLookupQueueOnce(queue)).toBe(0);
     expect(await repo.status(attempt.attemptId)).toMatchObject({reason:'not_me',canRequestLinkedin:true});
     expect((await readSparkProfile(input.subjectId,input.bindingId,deps)).draft).toEqual(before.draft);
    }
   }else if(mode==='source_accept'){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    const deps={env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'}};
    const proposal=await readSourceProposal(input.subjectId,input.bindingId,input.sourceId,input.proposalId,deps);
    const before=await readSparkProfile(input.subjectId,input.bindingId,deps),repo=profileRepository(pool,async()=>{});
    const actor={userId:input.userId,authVersion:1,passwordVersion:null,reauthenticatedAt:null};
    const command={schemaVersion:3,idempotencyKey:randomUUID(),action:'accept_source',
     expectedDraftVersion:before.draftVersion,expectedProfileVersion:before.profileVersion,
     expectedPreferenceVersion:before.preferenceVersion,expectedPreferenceDraftRevision:before.preferenceDraft?.preferenceDraftRevision??0,
     payload:{proposalId:proposal.proposalId,sourceVersion:proposal.sourceVersion,proposalHash:proposal.proposalHash,
      selectedFactIds:proposal.facts.map(f=>f.factId),replaceFactIds:[],corrections:[]}};
    const admitted=await repo.admit(actor,JSON.stringify(command));
    expect(await runProfileBatch({enabled:()=>true,claim:repo.claim,authority:repo.authority,finish:repo.finish,
     deliver:(lease,signal)=>deliverProfile(lease,signal,deps)})).toBe(1);
    expect(await repo.readCommand({userId:actor.userId,authVersion:actor.authVersion},admitted.commandId)).toMatchObject({status:'applied',draftVersion:before.draftVersion+1});
    expect((await repo.admit(actor,JSON.stringify(command))).commandId).toBe(admitted.commandId);
    expect(await repo.claim(20)).toEqual([]);
    const after=await readSparkProfile(input.subjectId,input.bindingId,deps);
    expect(after.draft!.skills).toEqual([...before.draft!.skills,'Kafka']);
    expect(after.confirmedProfile).toEqual(before.confirmedProfile);
    expect(after.profileVersion).toBe(before.profileVersion);expect(after.publicationActive).toBe(false);
   }else if(mode==='lookup_after_withdrawal'){
    const stored=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    const deps={env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'}};
    expect((await deliverLookupTransfer(stored,deps)).outcome).toBe('stored');
    const value=JSON.parse(stored.canonical);value.commandId=randomUUID();
    const canonical=canonicalProfileJson(value);
    expect(await deliverLookupTransfer({canonical,sha256:createHash('sha256').update(canonical).digest('hex')},deps))
     .toMatchObject({outcome:'rejected',reason:'consent_changed'});
   }else if(mode==='resume_after_withdrawal'){
    const stored=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    const deps={env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'}};
    // A replay acknowledges only the old committed write; it cannot reactivate it.
    expect((await deliverResumeTransfer(stored,new AbortController().signal,deps)).receipt.outcome).toBe('stored');
    const value=JSON.parse(stored.canonical);value.commandId=randomUUID();
    const canonical=canonicalProfileJson(value);
    expect((await deliverResumeTransfer({canonical,sha256:createHash('sha256').update(canonical).digest('hex')},
     new AbortController().signal,deps)).receipt).toMatchObject({outcome:'rejected',reason:'consent_changed'});
   }else if(mode==='resume_lost_reply'||mode==='resume_recover'||mode==='resume_ocr_retry'){
    const retryOcr=mode==='resume_ocr_retry';
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    const actor={userId:input.userId,subjectId:input.subjectId,bindingId:input.bindingId};
    const repo=resumeSourceRepository(pool,async()=>{});
    const bytes=retryOcr?Buffer.from('%PDF-1.7\nsynthetic scanned pdf'):Buffer.concat([Buffer.from('504b0304','hex'),Buffer.from('synthetic word/document.xml')]);
    const objects=sourceObjectDependencies(pool,async()=>{}, {
     readBlob:(async()=>({generation:'1',bytes,byteLength:bytes.length,
      contentHash:createHash('sha256').update(bytes).digest('hex'),
      mediaType:retryOcr?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})) as never,
     readProfile:((subjectId:string,bindingId:string)=>readSparkProfile(subjectId,bindingId,{
      env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'}})) as never,
    });
    const snapshot=await objects.snapshot(actor,{schemaVersion:1,idempotencyKey:input.snapshotKey,resumeId:input.resumeId});
    const queued=await repo.enqueue(actor,{schemaVersion:1,idempotencyKey:input.enqueueKey,sourceId:snapshot.sourceId,sourceVersion:snapshot.sourceVersion});
    const claim=await repo.claim(randomUUID());expect(claim?.lease.commandId).toBe(queued.commandId);
    let modelCalls=0,sends=0,ocrCalls=0;
    const dependencies:ResumeProcessorDependencies={
     repo,reader:{read:(a,s)=>objects.read(a,s)},modelName:'synthetic-model',
     extract:withCachedResumeExtraction(pool,claim!.lease,(input,bytes,deps)=>extractResumeSource(input,bytes,{...deps,extract:async(_bytes,options)=>{
      if(retryOcr){await options!.beforeOcr!({schemaVersion:1,contentHash:createHash('sha256').update(bytes).digest('hex'),totalPages:3,pageNumbers:[2]});ocrCalls++;}
      return {success:true,text:`Synthetic Élodie\n${claim!.scrubContext.verifiedAccountEmail}\nSkills: Kafka, Go`,
       method:retryOcr?'google_vision_ocr':'native_text',providerCalls:retryOcr?1:0};}})),
     model:async()=>{modelCalls++;if(retryOcr&&modelCalls===1)throw Error('synthetic_model_unknown');return {content:JSON.stringify({facts:[{kind:'skill',value:'Kafka',
      evidence:[{quote:'Skills: Kafka, Go'}]}],notes:[]}),usage:{inputTokens:50,outputTokens:20}};},
     deliver:(stored:Parameters<typeof deliverResumeTransfer>[0],signal:AbortSignal)=>deliverResumeTransfer(stored,signal,{
      env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'},
      fetch:async(url,options)=>{sends++;const response=await fetch(url,options);expect(response.status).toBe(200);
       if(mode==='resume_lost_reply'){await response.arrayBuffer();throw Error('synthetic_lost_resume_reply');}return response;},
     }),
    };
    let result=await processResumeSource(claim!.lease,dependencies);
    if(retryOcr){
     expect(result.result).toBe('held');expect(ocrCalls).toBe(1);expect(modelCalls).toBe(1);expect(sends).toBe(0);
     expect(await repo.retryStatus(actor,queued.commandId)).toMatchObject({canRetry:true,attemptsUsed:1,message:'Something went wrong processing your résumé.'});
     const successor=await repo.retry(actor,{schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:queued.commandId});
     const next=await repo.claim(randomUUID());expect(next!.lease.commandId).toBe(successor.commandId);
     // Successful OCR is reused by the real adapter/processor; it is not a
     // native-cache path. Only a new semantic slot is purchased explicitly.
     dependencies.extract=(input,bytes,deps)=>extractResumeSource(input,bytes,{...deps,extract:async(_bytes,options)=>{
      await options!.beforeOcr!({schemaVersion:1,contentHash:createHash('sha256').update(bytes).digest('hex'),totalPages:3,pageNumbers:[2]});
      ocrCalls++;throw Error('unexpected_second_ocr');
     }});
     result=await processResumeSource(next!.lease,dependencies);
     expect(result.result).toBe('review_ready');expect(ocrCalls).toBe(1);expect(modelCalls).toBe(2);expect(sends).toBe(1);
     expect(await repo.status(actor,successor.commandId)).toMatchObject({state:'review_ready'});
     expect(await repo.claim(randomUUID())).toBeNull();
    }
    expect(result.result).toBe(mode==='resume_lost_reply'?'retry':'review_ready');
    expect(modelCalls).toBe(retryOcr?2:mode==='resume_lost_reply'?1:0);expect(sends).toBe(1);
    if(mode==='resume_recover')expect(await repo.status(actor,queued.commandId)).toMatchObject({state:'review_ready'});
   }else if(mode==='confirm_from_get'){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!),repo=profileRepository(pool,async()=>{});
    routeDb.pool=pool;
    for(const flag of ['CANDIDATE_FOUNDATION_ENABLED','CANDIDATE_PROFILE_ENABLED','CANDIDATE_PROFILE_DELIVERY_ENABLED',
     'CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED'])process.env[flag]='true';
    process.env.ACTIVEKG_BASE_URL=origin.origin;process.env.CANDIDATE_FOUNDATION_DISPOSABLE_TEST='1';
    const {registerCandidateProfileRoutes}=await import('./routes');
    const app=express(),passwordVersion=createHash('sha256').update('synthetic').digest('hex');
    app.use(express.json({verify:(req,_res,buf)=>{(req as any).rawBody=buf.toString('utf8');}}));
    app.use((req,_res,next)=>{(req as any).user={id:input.userId,authVersion:1,role:'candidate',emailVerified:true,password:'synthetic'};
     (req as any).session={privacyReauthenticatedAt:Date.now(),privacyPasswordVersion:passwordVersion};next();});
    registerCandidateProfileRoutes(app,(_req,_res,next)=>next());
    const listener=app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>listener.once('listening',resolve));
    const address=listener.address() as {port:number};const url=`http://127.0.0.1:${address.port}/api/candidate/product/profile`;
    const read=async()=>{const response=await fetch(url);expect(response.status).toBe(200);return response.json();};
    const send=async(command:unknown)=>{
     const response=await fetch(`${url}/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)});
     expect(response.status).toBe(202);const admitted=await response.json();
     expect(await runProfileBatch({enabled:()=>true,claim:repo.claim,authority:repo.authority,finish:repo.finish,
      deliver:(lease,signal)=>deliverProfile(lease,signal)})).toBe(1);
     const result=await repo.readCommand({userId:input.userId,authVersion:1},admitted.commandId);
     expect(result).toMatchObject({status:'applied',reason:null});return {admitted,result};
    };
    const envelope=(view:any)=>({schemaVersion:3,idempotencyKey:randomUUID(),expectedDraftVersion:view.draftVersion,
     expectedProfileVersion:view.profileVersion,expectedPreferenceVersion:view.preferenceVersion,
     expectedPreferenceDraftRevision:view.preferenceDraft?.preferenceDraftRevision??0});
    try{
     const initial=await read();
     await send({schemaVersion:2,idempotencyKey:randomUUID(),expectedDraftVersion:initial.draftVersion,
      expectedProfileVersion:initial.profileVersion,expectedPreferenceVersion:initial.preferenceVersion,action:'save_draft',
      payload:{profile:{displayName:'Synthetic Élodie',headline:'Résumé — Engineer',linkedinUrl:null,
       currentLocation:{city:'Pune',countryCode:'IN',displayCountry:'India'},skills:['TypeScript','C++'],employment:[],education:[],projects:[]}}});
     const sections={roles:{desiredRoles:['Engineer'],preferredSeniority:[]},location:{mode:'anywhere'},
      arrangement:{workArrangements:['onsite'],remoteRegions:null},relocation:{mode:'no',destinations:[]},
      employment_types:['permanent'],availability:{mode:'immediate'},compensation:{mode:'open_to_discussion'}};
     for(const [section,value] of Object.entries(sections)){
      const view=await read();await send({...envelope(view),action:'save_preference_section',payload:{section,answered:true,value}});
     }
     const draft=await read();expect(draft.capabilities.confirmBlockedReason).toBe('preferences_not_promoted');
     await send({...envelope(draft),action:'promote_preferences',payload:{preferenceDraftHash:draft.preferenceDraft.preferenceDraftHash}});
     const reviewed=await read();expect(reviewed.capabilities.canConfirm).toBe(true);
     const command={...envelope(reviewed),action:'confirm',payload:{draftHash:reviewed.draftHash,
      preferenceDraftHash:reviewed.preferenceDraft.preferenceDraftHash,consentRevision:reviewed.effectiveConsentRevision}};
     const {admitted,result}=await send(command);expect(result.profileVersion).toBe(1);
     const replay=await fetch(`${url}/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)});
     expect(replay.status).toBe(202);expect((await replay.json()).commandId).toBe(admitted.commandId);
     expect(await repo.claim(20)).toEqual([]);
     const confirmed=await read();expect(confirmed.confirmedProfile).toEqual(reviewed.draft);
     expect(confirmed.publicationActive).toBe(false);expect(confirmed.profileVersion).toBe(1);
     // Both production save protocols: discard before/after Memory commits.
     for(const version of [2,3])for(const alreadySaved of [false,true]){
      const before=await read();
      const edit=version===3?{...envelope(before),action:'save_preference_section',payload:{section:'private_notes',answered:true,value:[`synthetic-${randomUUID()}`]}}
       :{schemaVersion:2,idempotencyKey:randomUUID(),expectedDraftVersion:before.draftVersion,expectedProfileVersion:before.profileVersion,
        expectedPreferenceVersion:before.preferenceVersion,action:'save_draft',payload:{profile:{...before.draft,headline:`Synthetic ${randomUUID()}`}}};
      const post=await fetch(`${url}/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(edit)});
      expect(post.status).toBe(202);const {commandId}=await post.json();const lease=(await repo.claim(20))[0] as import('./profile-processor').ProfileLease;
      expect(lease.commandId).toBe(commandId);const applied=alreadySaved?await deliverProfile(lease,new AbortController().signal):null;
      const request={schemaVersion:1,idempotencyKey:randomUUID(),expectedResolutionRevision:0,action:'discard'};
      const resolutionUrl=`${url}/commands/${commandId}/resolution`;
      const resolve=async()=>{const r=await fetch(resolutionUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});expect(r.status).toBe(202);return r.json();};
      const first=await resolve();expect(first.state).toBe('resolving');expect(await resolve()).toEqual(first);
      expect(await runProfileExpiryBatch({enabled:()=>true,redactDue:repo.redactDue,claimExpiry:repo.claimExpiry,prepareExpiry:repo.prepareExpiry,
       settleExpiry:repo.settleExpiry,refuseExpiry:repo.refuseExpiry,recoveryReviewCount:repo.recoveryReviewCount,
       recover:(identity,signal)=>recoverProfileExpiry(identity,signal)})).toBe(1);
      const resolved=await (await fetch(resolutionUrl)).json();
      expect(resolved).toMatchObject({state:alreadySaved?'applied':'discarded',blocksConfirmation:false});
      const late=await deliverProfile(lease,new AbortController().signal);
      if(applied)expect(late).toEqual(applied);else expect(late).toMatchObject({status:'rejected',reason:'command_expired'});
      await repo.finish(lease,{state:late.status,receipt:late}); // Old lease cannot overwrite resolved receipt.
      const after=await read();
      expect(after.draftVersion).toBe(before.draftVersion+(version===2&&alreadySaved?1:0));
      expect(after.preferenceDraft.preferenceDraftRevision).toBe(before.preferenceDraft.preferenceDraftRevision+(version===3&&alreadySaved?1:0));
     }
    }finally{await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));routeDb.pool=null;}
   }else if(['queue_only','recovery_worker_lost','recovery_worker_applied','recovery_worker_expired'].includes(mode)){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!),repo=profileRepository(pool,async()=>{});
    const actor={userId:input.userId,authVersion:input.authVersion};
    if(mode==='queue_only'){
     expect(await repo.admit({...actor,passwordVersion:null,reauthenticatedAt:null},input.body)).toMatchObject({schemaVersion:3,status:'pending'});
    }else{
     let sends=0;
     const count=await claimExpected(()=>runProfileExpiryBatch({enabled:()=>true,redactDue:repo.redactDue,claimExpiry:repo.claimExpiry,
      prepareExpiry:repo.prepareExpiry,settleExpiry:repo.settleExpiry,recover:(identity,signal)=>recoverProfileExpiry(identity,signal,{
       env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'},sign:signServiceJwt,
       fetch:async(url,options)=>{sends++;const response=await fetch(url,options);expect(response.status).toBe(200);
        if(mode==='recovery_worker_lost'){await response.arrayBuffer();throw Error('lost_worker_expiry_reply');}return response;}
      })}),1);
     expect(count).toBe(1);expect(sends).toBe(1);
     expect(await repo.readCommand(actor,input.commandId)).toMatchObject({schemaVersion:3,
      status:mode==='recovery_worker_lost'?'held':mode==='recovery_worker_applied'?'applied':'rejected',
      reason:mode==='recovery_worker_lost'?'expiry_reconciling':mode==='recovery_worker_applied'?null:'command_expired'});
    }
   }else if(['expiry_lost_reply','expiry_recover','expiry_unsent','late_expired'].includes(mode)){
    const l=JSON.parse(process.env.SPARK_PROFILE_LEASE!);let sends=0;
    const deps={env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'},sign:signServiceJwt,
     fetch:async(url:Parameters<typeof fetch>[0],options?:Parameters<typeof fetch>[1])=>{
      sends++;const response=await fetch(url,options);expect(response.status).toBe(200);
      if(mode==='expiry_lost_reply'){await response.arrayBuffer();throw Error('synthetic_lost_expiry_reply');}return response;
     }};
    const signal=new AbortController().signal;
    const result=mode==='late_expired'?deliverProfile(l,signal,deps):recoverProfileExpiry({schemaVersion:3,
     subjectId:l.subjectId,bindingId:l.bindingId,commandId:l.commandId,idempotencyKey:l.idempotencyKey,commandHash:l.hash},signal,deps);
    if(mode==='expiry_lost_reply')await expect(result).rejects.toMatchObject({code:'delivery_outcome_unknown'});
    else expect(await result).toMatchObject({schemaVersion:3,commandId:l.commandId,commandHash:l.hash,
     status:mode==='expiry_recover'?'applied':'rejected',reason:mode==='expiry_recover'?null:'command_expired',preferenceDraftRevision:2});
    expect(sends).toBe(1);
   }else if(['queue_lost_reply','queue_recover','queue_replay'].includes(mode)){
    const input=JSON.parse(process.env.SPARK_PROFILE_LEASE!);
    // Privacy policy availability is synthetic; queue authority, leases,
    // signing, HTTP, both databases and settlement are real product code.
    const repo=profileRepository(pool,async()=>{}),actor={userId:input.userId,authVersion:input.authVersion};
    const admitted=await repo.admit({...actor,passwordVersion:null,reauthenticatedAt:null},input.body);
    let sends=0;
    const claimed=await claimExpected(()=>runProfileBatch({enabled:()=>true,claim:repo.claim,authority:repo.authority,finish:repo.finish,
     deliver:(lease,signal)=>deliverProfile(lease,signal,{
      env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'},sign:signServiceJwt,
      fetch:async(url,options)=>{sends++;const response=await fetch(url,options);expect(response.status).toBe(200);
       if(mode==='queue_lost_reply'){await response.arrayBuffer();throw Error('synthetic_lost_queued_reply');}return response;}
     })}),mode==='queue_replay'?0:1);
    expect(claimed).toBe(mode==='queue_replay'?0:1);expect(sends).toBe(mode==='queue_replay'?0:1);
    const result=await repo.readCommand(actor,admitted.commandId);
    if(mode==='queue_lost_reply')expect(result).toMatchObject({schemaVersion:3,status:'held',reason:'delivery_outcome_unknown'});
    else expect(result).toMatchObject({schemaVersion:3,status:'applied',reason:null,preferenceDraftRevision:2,profileVersion:0,preferenceVersion:0});
    expect((await repo.admit({...actor,passwordVersion:null,reauthenticatedAt:null},input.body)).commandId).toBe(admitted.commandId);
    if(mode==='queue_recover'){
     const resumed=await readSparkProfile(input.subjectId,input.bindingId,{
      env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'},sign:signServiceJwt});
     expect(resumed).toMatchObject({schemaVersion:3,profileVersion:0,preferenceVersion:0,publicationActive:false,
      preferenceDraft:{preferenceDraftRevision:2}});
     const command=JSON.parse(input.body);
     expect(resumed.preferenceDraft!.sections[command.payload.section]).toEqual({answered:command.payload.answered,value:command.payload.value});
    }
   }else if(mode==='spark_save'||mode==='spark_lost_reply'){
    const lease=JSON.parse(process.env.SPARK_PROFILE_LEASE!);let sends=0;
    const operation=deliverProfile(lease,new AbortController().signal,{
     env:{ACTIVEKG_BASE_URL:origin.origin,NODE_ENV:'test',CANDIDATE_FOUNDATION_DISPOSABLE_TEST:'1'},sign:signServiceJwt,
     fetch:async(url,options)=>{sends++;const response=await fetch(url,options);
      expect(response.status).toBe(200);
      if(mode==='spark_lost_reply'){await response.arrayBuffer();throw Error('synthetic_lost_profile_reply');}
      return response;
     }});
    if(mode==='spark_lost_reply')await expect(operation).rejects.toMatchObject({code:'delivery_outcome_unknown'});
    else expect(await operation).toMatchObject({schemaVersion:3,commandId:lease.commandId,commandHash:lease.hash,
     status:'applied',changed:true,preferenceDraftRevision:1,preferenceVersion:0,publicationActive:false});
    expect(sends).toBe(1);
   }else if(['worker','lost_reply','privacy_unavailable'].includes(mode)){
    let sends=0;const statuses:number[]=[];
    const claimed=await claimExpected(()=>runConsentV2Once({db:pool,workerId:'synthetic-cross-system',
     privacy:async()=>mode==='privacy_unavailable'?'unavailable':'allowed',
     deliver:(raw,hash)=>sendConsentV2(raw,hash,{origin:origin.origin,localTest:true,sign:signServiceJwt,
      fetch:async(url,options)=>{
       sends++;const response=await fetch(url,options);statuses.push(response.status);
       if(mode==='lost_reply'){expect(response.status).toBe(200);await response.arrayBuffer();throw Error('synthetic_lost_reply_after_commit');}
       return response;
      }})},process.env.SPARK_EVENT_ID!),Number(process.env.SPARK_EXPECT_CLAIMED));
    expect(claimed).toBe(Number(process.env.SPARK_EXPECT_CLAIMED));
    expect(sends).toBe(Number(process.env.SPARK_EXPECT_SENDS));
    expect(statuses).toEqual(Array(sends).fill(200));
   }else{
    const parsed=parseConsentProjection(process.env.SPARK_COMMAND!);
    const sign:typeof signServiceJwt=(aud,opts)=>signServiceJwt(aud,{...opts,
     ...(mode==='wrong_tenant'?{tenantId:`candidate_${randomUUID()}`} : {}),
     ...(mode==='wrong_scope'?{scopes:'search:read'} : {})});
    const operation=sendConsentV2(parsed.canonical,parsed.hash,{origin:origin.origin,localTest:true,sign});
    if(mode==='replay')expect(await operation).toEqual(JSON.parse(process.env.SPARK_EXPECT_RECEIPT!));
    else await expect(operation).rejects.toMatchObject({code:'remote_rejected',dispatched:true} satisfies Partial<ConsentTransportError>);
   }
  }finally{await pool.end();}
 },20000);
});
