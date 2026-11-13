import type { Express, NextFunction, Request, Response } from 'express';
import { requireVerifiedCandidate } from '../auth';
import { pool } from '../db';
import { recentConsentAuth } from '../candidate-consent/repository';
import { CandidatePrivacyRestrictedError, requireCandidatePrivacyAllowed } from '../candidate-privacy/decision';
import { foundationEnabled,profileEnabled,consentV2DeliveryEnabled,consentV2CaptureEnabled,sparkEnabled,resumeSourceEnabled,lookupSourceEnabled,interpretationEnabled,networkSourcingEnabled } from './config';
import {registerResumeSourceRoutes} from './resume-source-routes';
import {resumeSourceRepository} from './resume-source-repository';
import {sourceObjectDependencies,lookupRepository} from './source-repository';
import {lookupRequestSchema} from '../../shared/candidate-spark-v3';
import {interpretationRequestSchema,exclusionPreviewRequestSchema} from '../../shared/candidate-spark-v3';
import {interpretCandidateText,interpretationJournal,configuredInterpretationBudget,productionInterpretationModel} from './interpretation';
import {parseProfileJson} from './profile-contracts';
import {consentV2Repository,ConsentCaptureError} from './consent-v2';
import {parseConsentCapture,parseSaveResolution,signupConsentActivationSchema} from './spark-contracts';
import {profileRepository,ProfileRepositoryError} from './profile-repository';
import {parseQueuedProfileCommand} from './profile-processor';
import {readProfile,readSparkProfile,readNetworkStatus,readSourceProposal,readInterpretationProposal,deliverInterpretationProposal,previewExclusions,ProfileTransportError} from './profile-client';
import {createHash} from 'node:crypto';
import {canonicalProfileJson} from './profile-contracts';
import { foundationClaimRequest, foundationRequest, parseStrictJson, uuid } from './contracts';
import { foundationRepository, FoundationRepositoryError } from './repository';

type Middleware = (req: Request, res: Response, next: NextFunction) => void;
const repository = foundationRepository({query:(text,values)=>pool.query(text,values)}, userId => requireCandidatePrivacyAllowed(
  { type: 'candidate_user', id: userId }, { globalUse: true, newGlobalOperation: true }));
const profiles=profileRepository({query:(text,values)=>pool.query(text,values)},userId=>requireCandidatePrivacyAllowed(
 {type:'candidate_user',id:userId},{globalUse:false}));
const consents=consentV2Repository({query:(text,values)=>pool.query(text,values)},userId=>requireCandidatePrivacyAllowed(
 {type:'candidate_user',id:userId},{globalUse:true,newGlobalOperation:true}));
const consentAvailable:Middleware=(_req,res,next)=>{
 if(!consentV2DeliveryEnabled()){res.status(404).json({code:'not_found'});return;}
 res.setHeader('Cache-Control','no-store');next();
};
const consentActor:Middleware=(req,res,next)=>{
 if(!req.user){res.status(401).json({code:'authentication_required'});return;}
 if(req.user.role!=='candidate'){res.status(403).json({code:'candidate_required'});return;}
 next();
};
function consentFailure(error:unknown,res:Response){
 if(error instanceof ConsentCaptureError){res.status(error.status).json({code:error.code});return;}
 if(error instanceof CandidatePrivacyRestrictedError&&error.code==='candidate_privacy_restricted'){
  res.status(451).json({code:'candidate_privacy_restricted'});return;
 }
 res.status(503).json({code:'consent_temporarily_unavailable'});
}
const profileAvailable:Middleware=(_req,res,next)=>{if(!profileEnabled()){res.status(404).json({code:'not_found'});return;}res.setHeader('Cache-Control','no-store');next();};
function profileFailure(error:unknown,res:Response){
 if(error instanceof ProfileTransportError&&error.code==='candidate_privacy_restricted'){res.status(451).json({code:error.code});return;}
 if(error instanceof ProfileRepositoryError){res.status(error.status).json({code:error.code});return;}
 if(error instanceof CandidatePrivacyRestrictedError&&error.code==='candidate_privacy_restricted'){res.status(451).json({code:error.code});return;}
 res.status(503).json({code:'profile_temporarily_unavailable',retryable:true});
}

function failure(error: unknown, res: Response): void {
  if (error instanceof FoundationRepositoryError) { res.status(error.status).json({code:error.code}); return; }
  if (error instanceof CandidatePrivacyRestrictedError && error.code === 'candidate_privacy_restricted') {
    res.status(451).json({code:'privacy_restricted'}); return;
  }
  res.status(503).json({code:'authority_unavailable'});
}
const available: Middleware = (_req, res, next) => {
  if (!foundationEnabled()) { res.status(404).json({code:'not_found'}); return; }
  next();
};
const recent: Middleware = (req, res, next) => {
  if (!recentConsentAuth(req.session.privacyReauthenticatedAt, req.session.privacyPasswordVersion, req.user!.password)) {
    res.status(403).json({code:'recent_auth_required'}); return;
  }
  next();
};
function actor(req: Request) { return {userId:req.user!.id, authVersion:req.user!.authVersion}; }
function writer(req: Request) {
  return {...actor(req), passwordVersion:req.session.privacyPasswordVersion!,
    reauthenticatedAt:req.session.privacyReauthenticatedAt!};
}
function emptyQuery(req: Request): boolean { return Object.keys(req.query).length === 0; }
function body(req: Request): unknown {
  if (!emptyQuery(req) || !req.is('application/json')) throw Error('invalid_request');
  return parseStrictJson((req as Request & {rawBody?:string}).rawBody as string);
}
function emptyRead(req: Request): boolean {
  return emptyQuery(req) && !req.headers['transfer-encoding']
    && (!req.headers['content-length'] || req.headers['content-length'] === '0');
}
export function registerCandidateResumeRoutes(app: Express, csrfProtection: Middleware): void {
  const lookupAvailable:Middleware=(_req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!lookupSourceEnabled()){res.status(404).json({code:'not_found'});return;}next();
  };
  const lookups=(req:Request)=>lookupRepository(pool,userId=>requireCandidatePrivacyAllowed(
    {type:'candidate_user',id:userId},{globalUse:true,newGlobalOperation:true}),actor(req));
  const lookupFailure=(error:unknown,res:Response)=>{
    if(error instanceof CandidatePrivacyRestrictedError){res.status(451).json({code:'privacy_restricted'});return;}
    const e=error as {code?:string;message?:string};
    const known:Record<string,[string,number]>={not_found:['P0002',404],invalid_request:['22023',422],
      idempotency_conflict:['23505',409],authentication_changed:['42501',409],consent_changed:['42501',409],
      fallback_unavailable:['42501',409],budget_unavailable:['42501',409]};
    const match=known[e.message??''];
    if(match&&match[0]===e.code){res.status(match[1]).json({code:e.message});return;}
    res.status(503).json({code:'lookup_temporarily_unavailable'});
  };
  app.post('/api/candidate/product/lookups',lookupAvailable,requireVerifiedCandidate,csrfProtection,recent,async(req,res)=>{
    let raw:string;
    try{if(!emptyQuery(req)||!req.is('application/json'))throw Error('invalid_request');
      raw=(req as Request&{rawBody?:string}).rawBody as string;lookupRequestSchema.parse(parseProfileJson(raw,4096));
    }catch{res.status(422).json({code:'invalid_request'});return;}
    try{res.status(202).json(await lookups(req).admit(raw));}catch(error){lookupFailure(error,res);}
  });
  app.get('/api/candidate/product/lookups/:attemptId',lookupAvailable,requireVerifiedCandidate,async(req,res)=>{
    if(!emptyRead(req)||!uuid.safeParse(req.params.attemptId).success){res.status(400).json({code:'invalid_request'});return;}
    try{res.json(await lookups(req).status(req.params.attemptId!));}catch(error){lookupFailure(error,res);}
  });
  app.get('/api/candidate/product/sources/:sourceId/proposals/:proposalId',profileAvailable,requireVerifiedCandidate,async(req,res)=>{
    if(!resumeSourceEnabled()&&!lookupSourceEnabled()){res.status(404).json({code:'not_found'});return;}
    if(!emptyRead(req)||!uuid.safeParse(req.params.sourceId).success||!uuid.safeParse(req.params.proposalId).success){res.status(400).json({code:'invalid_request'});return;}
    try{
      const identity=await profiles.owner(actor(req));
      const proposal=await readSourceProposal(identity.subjectId,identity.bindingId,req.params.sourceId!,req.params.proposalId!);
      const current=await profiles.owner(actor(req));
      if(current.subjectId!==identity.subjectId||current.bindingId!==identity.bindingId||(!resumeSourceEnabled()&&!lookupSourceEnabled()))throw new ProfileRepositoryError('identity_conflict',409);
      res.json(proposal);
    }catch(error){profileFailure(error,res);}
  });
  const privacy = (userId:number) => requireCandidatePrivacyAllowed(
    {type:'candidate_user',id:userId},{globalUse:false});
  const db = {query:(text:string,values?:unknown[])=>pool.query(text,values)};
  const sources = resumeSourceRepository(db,privacy);
  const objects = sourceObjectDependencies(db,privacy);
  registerResumeSourceRoutes(app,{
    enabled:resumeSourceEnabled,repo:sources,snapshot:objects.snapshot,
    identity:async req=>{
      const owner=await profiles.owner(actor(req));
      return {userId:req.user!.id,subjectId:owner.subjectId,bindingId:owner.bindingId};
    },
    requireCandidate:requireVerifiedCandidate,csrf:csrfProtection,
  });
}
export function registerCandidateProfileRoutes(app: Express, csrfProtection: Middleware): void {
  const interpretationAvailable:Middleware=(_req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!interpretationEnabled()){res.status(404).json({code:'not_found'});return;}next();
  };
  app.post('/api/candidate/product/exclusions/preview',interpretationAvailable,requireVerifiedCandidate,csrfProtection,async(req,res)=>{
    let value;
    try{
      if(!emptyQuery(req)||!req.is('application/json'))throw Error('invalid_request');
      value=exclusionPreviewRequestSchema.parse(parseProfileJson((req as Request&{rawBody?:string}).rawBody as string,32768));
    }catch{res.status(422).json({code:'invalid_request'});return;}
    try{
      const identity=await profiles.owner(actor(req));
      const result=await previewExclusions(identity.subjectId,identity.bindingId,value,new AbortController().signal);
      const current=await profiles.owner(actor(req));
      if(!interpretationEnabled()||identity.subjectId!==current.subjectId||identity.bindingId!==current.bindingId)
        throw new ProfileRepositoryError('identity_conflict',409);
      res.json(result);
    }catch(error){profileFailure(error,res);}
  });
  app.post('/api/candidate/product/interpretations',interpretationAvailable,requireVerifiedCandidate,csrfProtection,recent,async(req,res)=>{
    let raw:string;let request;
    try{
      if(!emptyQuery(req)||!req.is('application/json'))throw Error('invalid_request');
      raw=(req as Request&{rawBody?:string}).rawBody as string;
      request=interpretationRequestSchema.parse(parseProfileJson(raw,32768));
    }catch{res.status(422).json({code:'invalid_request'});return;}
    try{
      const identity=await profiles.owner(actor(req));
      if(identity.pendingCommands.length||identity.hasMorePendingCommands)throw new ProfileRepositoryError('pending_changes',409);
      const view=await readSparkProfile(identity.subjectId,identity.bindingId);
      const consent=await consents.read(actor(req));
      if(consent.desiredAction!=='grant'||consent.acknowledgedAction!=='grant'||consent.desiredSchemaVersion!==2
       ||consent.acknowledgedSchemaVersion!==2||consent.consentRevision!==consent.acknowledgedRevision||consent.deliveryStatus!=='delivered')
       throw new ProfileRepositoryError('consent_required',409);
      let source=null;let sourceHash:string|null=null;
      if(request.use==='source_correction'){
        const rows=await pool.query('SELECT flow_candidate_source_proposal_context($1,$2,$3) result',[req.user!.id,req.user!.authVersion,request.sourceProposalId]);
        const locator=rows.rows[0]?.result;
        if(!locator||!uuid.safeParse(locator.sourceId).success||locator.sourceVersion!==request.sourceVersion)
          throw new ProfileRepositoryError('source_conflict',409);
        const proposal=await readSourceProposal(identity.subjectId,identity.bindingId,locator.sourceId,request.sourceProposalId!);
        source={proposalId:proposal.proposalId,sourceVersion:proposal.sourceVersion,facts:proposal.facts};sourceHash=proposal.proposalHash;
      }
      const current=await profiles.owner(actor(req));
      if(!interpretationEnabled()||current.subjectId!==identity.subjectId||current.bindingId!==identity.bindingId
       ||current.pendingCommands.length||current.hasMorePendingCommands)throw new ProfileRepositoryError('identity_conflict',409);
      const versions={expectedDraftVersion:view.draftVersion,expectedProfileVersion:view.profileVersion,
       expectedPreferenceVersion:view.preferenceVersion,expectedPreferenceDraftRevision:view.preferenceDraft?.preferenceDraftRevision??0};
      const context={versions,source,companyIds:[] as string[],authorityHash:createHash('sha256').update(canonicalProfileJson({
        ...actor(req),subjectId:identity.subjectId,bindingId:identity.bindingId,consentRevision:consent.consentRevision,versions,sourceHash})).digest('hex')};
      const result=await interpretCandidateText(raw,{authorize:async()=>context,budget:configuredInterpretationBudget,
       model:productionInterpretationModel,...interpretationJournal(pool,{...actor(req),consentRevision:consent.consentRevision})});
      if(result.status==='proposal'){
        const transfer=canonicalProfileJson({schemaVersion:1,commandId:result.proposalId,subjectId:identity.subjectId,bindingId:identity.bindingId,
         consentRevision:consent.consentRevision,use:request.use,sourceProposalId:request.sourceProposalId,
         sourceVersion:request.sourceVersion,targetRowId:request.targetRowId,proposal:result});
        const receipt=await deliverInterpretationProposal(transfer,new AbortController().signal);
        if(receipt.outcome!=='stored')throw new ProfileRepositoryError(receipt.reason??'source_conflict',409);
        await pool.query('SELECT flow_candidate_source_interpretation_ack($1,$2)',[req.user!.id,result.proposalId]);
      }
      const final=await profiles.owner(actor(req));
      if(!interpretationEnabled()||final.subjectId!==identity.subjectId||final.bindingId!==identity.bindingId)
       throw new ProfileRepositoryError('identity_conflict',409);
      res.json(result);
    }catch(error){
      if(error instanceof Error&&['stale_edit','source_conflict','idempotency_conflict'].includes(error.message)){
        res.status(409).json({code:error.message});return;
      }
      profileFailure(error,res);
    }
  });
  app.get('/api/candidate/product/interpretations/:proposalId',interpretationAvailable,requireVerifiedCandidate,async(req,res)=>{
    if(!emptyRead(req)||!uuid.safeParse(req.params.proposalId).success){res.status(400).json({code:'invalid_request'});return;}
    try{
      const identity=await profiles.owner(actor(req));
      const result=await readInterpretationProposal(identity.subjectId,identity.bindingId,req.params.proposalId!);
      const current=await profiles.owner(actor(req));
      if(!interpretationEnabled()||current.subjectId!==identity.subjectId||current.bindingId!==identity.bindingId)
       throw new ProfileRepositoryError('identity_conflict',409);
      res.json(result);
    }catch(error){profileFailure(error,res);}
  });
  const resolutionAvailable:Middleware=(_req,res,next)=>{if(!sparkEnabled()){res.status(404).json({code:'not_found'});return;}next();};
  app.get('/api/candidate/product/profile/commands/:id/resolution',profileAvailable,resolutionAvailable,requireVerifiedCandidate,async(req,res)=>{
    if(!emptyRead(req)||!uuid.safeParse(req.params.id).success){res.status(400).json({code:'invalid_request'});return;}
    try{res.json(await profiles.resolution(actor(req),req.params.id!));}catch(error){profileFailure(error,res);}
  });
  app.post('/api/candidate/product/profile/commands/:id/resolution',profileAvailable,resolutionAvailable,requireVerifiedCandidate,csrfProtection,recent,async(req,res)=>{
    let raw:string;
    try{if(!emptyQuery(req)||!req.is('application/json')||!uuid.safeParse(req.params.id).success)throw Error('invalid_request');
      raw=(req as Request&{rawBody?:string}).rawBody as string;parseSaveResolution(raw);
    }catch{res.status(422).json({code:'invalid_request'});return;}
    try{res.status(202).json(await profiles.resolution(actor(req),req.params.id!,raw));}catch(error){profileFailure(error,res);}
  });
  app.get('/api/candidate/product/profile',profileAvailable,requireVerifiedCandidate,async(req,res)=>{
    if(!emptyRead(req)){res.status(400).json({code:'invalid_request'});return;}
    try{
      const identity=await profiles.owner(actor(req));
      if(sparkEnabled()){
        const view=await readSparkProfile(identity.subjectId,identity.bindingId);
        const consent=await consents.read(actor(req));
        const publication=networkSourcingEnabled()?await readNetworkStatus(identity.subjectId,identity.bindingId):null;
        // Last local authority check follows all remote and consent reads.
        const current=await profiles.owner(actor(req));
        if(current.subjectId!==identity.subjectId||current.bindingId!==identity.bindingId)throw new ProfileRepositoryError('identity_conflict',409);
        if(!sparkEnabled())throw new ProfileRepositoryError('feature_unavailable',409);
        const missingFields:string[]=[];
        if(!view.draft)missingFields.push('profile');
        else{
          if(!view.draft.displayName)missingFields.push('displayName');
          if(!view.draft.currentLocation)missingFields.push('currentLocation.city','currentLocation.countryCode');
          if(!view.draft.skills.length)missingFields.push('skills');
        }
        const required=['roles','location','arrangement','relocation','employment_types','availability','compensation'];
        for(const section of required)if(view.preferenceDraft?.sections[section]?.answered!==true)missingFields.push(`preferences.${section}`);
        const granted=consent.consentRevision>0&&consent.desiredAction==='grant'&&consent.acknowledgedAction==='grant'
          &&consent.desiredSchemaVersion===2&&consent.acknowledgedSchemaVersion===2
          &&consent.consentRevision===consent.acknowledgedRevision&&consent.deliveryStatus==='delivered';
        const promoted=view.preferenceDraft!==null&&view.preferenceDraft.promotedDraftRevision===view.preferenceDraft.preferenceDraftRevision
          &&view.preferenceDraft.promotedPreferenceVersion===view.preferenceVersion&&view.preferenceVersion>0;
        const fresh=recentConsentAuth(req.session.privacyReauthenticatedAt,req.session.privacyPasswordVersion,req.user!.password);
        // Display eligibility only: admission and Memory atomically recheck consent,
        // approved copy, all versions and completeness. This read grants no authority.
        const reason=current.pendingCommands.length>0||current.hasMorePendingCommands?'pending_changes'
          :!fresh?'recent_auth_required':!granted?'consent_required':missingFields.length?'incomplete_profile'
          :!promoted?'preferences_not_promoted':null;
        res.json({...view,draftHash:view.draft===null?null:createHash('sha256').update(canonicalProfileJson(view.draft)).digest('hex'),
          consent,effectiveConsentRevision:granted?consent.acknowledgedRevision:null,
          pendingCommands:current.pendingCommands,hasMorePendingCommands:current.hasMorePendingCommands,missingFields,
          sources:view.sources,proposals:view.proposals,hasMoreSources:view.hasMoreSources,hasMoreProposals:view.hasMoreProposals,
          matchingState:'not_available',discoveryState:publication?.publicationActive&&granted?'active':'not_available',
          capabilities:{canEdit:true,editBlockedReason:null,canConfirm:reason===null,confirmBlockedReason:reason,
            canEnrich:lookupSourceEnabled()&&granted,enrichBlockedReason:!lookupSourceEnabled()?'feature_unavailable':!granted?'consent_required':null,
            canRequestResume:resumeSourceEnabled()&&granted,resumeBlockedReason:!resumeSourceEnabled()?'feature_unavailable':!granted?'consent_required':null,
            canInterpret:interpretationEnabled()&&granted,interpretBlockedReason:!interpretationEnabled()?'feature_unavailable':!granted?'consent_required':null,
            canDiscover:!!publication?.publicationActive&&granted,discoveryBlockedReason:!publication?'feature_unavailable':!granted?'consent_required':publication.blockedReason,canMatch:false,matchingBlockedReason:'feature_unavailable'}});
        return;
      }
      const view=await readProfile(identity.subjectId,identity.bindingId);
      // Recheck after Memory responds, so stale auth/privacy cannot disclose data.
      const current=await profiles.owner(actor(req));
      if(current.subjectId!==identity.subjectId||current.bindingId!==identity.bindingId)throw new ProfileRepositoryError('identity_conflict',409);
      const busy=current.pendingCommands.some(c=>c.status==='pending'||['authority_unavailable','memory_unavailable','delivery_outcome_unknown'].includes(c.reason??''));
      const fresh=recentConsentAuth(req.session.privacyReauthenticatedAt,req.session.privacyPasswordVersion,req.user!.password);
      const reason=busy?'pending_changes':!fresh?'recent_auth_required':view.capabilities.confirmBlockedReason;
      res.json({...view,pendingCommands:current.pendingCommands,hasMorePendingCommands:current.hasMorePendingCommands,
       capabilities:{...view.capabilities,canConfirm:reason===null,confirmBlockedReason:reason}});
    }catch(error){profileFailure(error,res);}
  });
  app.get('/api/candidate/product/profile/commands/:id',profileAvailable,requireVerifiedCandidate,async(req,res)=>{
    if(!emptyRead(req)||!uuid.safeParse(req.params.id).success){res.status(400).json({code:'invalid_request'});return;}
    try{res.json(await profiles.readCommand(actor(req),req.params.id!));}catch(error){profileFailure(error,res);}
  });
  app.post('/api/candidate/product/profile/commands',profileAvailable,requireVerifiedCandidate,csrfProtection,async(req,res)=>{
    let raw:string;let command;
    try{
      if(!emptyQuery(req)||!req.is('application/json'))throw Error('invalid_request');
      raw=(req as Request&{rawBody?:string}).rawBody as string;command=parseQueuedProfileCommand(raw).value;
    }catch(error){res.status(error instanceof Error&&error.message==='payload_too_large'?413:422).json({code:error instanceof Error&&error.message==='payload_too_large'?'payload_too_large':'invalid_request'});return;}
    if(command.schemaVersion===3&&!sparkEnabled()){res.status(404).json({code:'not_found'});return;}
    if(command.action==='accept_interpretation'&&!interpretationEnabled()){res.status(404).json({code:'not_found'});return;}
    if(command.action==='accept_interpretation'){
      try{
        const identity=await profiles.owner(actor(req));
        const proposal=await readInterpretationProposal(identity.subjectId,identity.bindingId,command.payload.proposalId);
        if(proposal.proposalHash!==command.payload.proposalHash)throw new ProfileRepositoryError('source_conflict',409);
        if(proposal.changes.some(c=>c.kind==='exclusions')){res.status(409).json({code:'exclusion_preview_required'});return;}
      }catch(error){profileFailure(error,res);return;}
    }
    if(['accept_source','reject_source'].includes(command.action)&&!resumeSourceEnabled()&&!lookupSourceEnabled()){res.status(404).json({code:'not_found'});return;}
    if(command.action==='confirm'&&!recentConsentAuth(req.session.privacyReauthenticatedAt,req.session.privacyPasswordVersion,req.user!.password)){
      res.status(403).json({code:'recent_auth_required'});return;
    }
    try{res.status(202).json(await profiles.admit({...actor(req),passwordVersion:req.session.privacyPasswordVersion??null,
     reauthenticatedAt:req.session.privacyReauthenticatedAt??null},raw));}catch(error){profileFailure(error,res);}
  });
}

export function registerCandidateConsentV2Routes(app: Express, csrfProtection: Middleware): void {
  app.get('/api/candidate/product/consent',consentAvailable,consentActor,async(req,res)=>{
    if(!emptyRead(req)){res.status(400).json({code:'invalid_request'});return;}
    try{res.json(await consents.read(actor(req)));}catch(error){consentFailure(error,res);}
  });
  app.post('/api/candidate/product/consent/signup-intent/activate',consentAvailable,requireVerifiedCandidate,csrfProtection,async(req,res)=>{
    if(!consentV2CaptureEnabled()){res.status(404).json({code:'not_found'});return;}
    try{
      if(!emptyQuery(req)||!req.is('application/json'))throw Error('invalid_request');
      const raw=(req as Request&{rawBody?:string}).rawBody;
      if(typeof raw!=='string'||Buffer.byteLength(raw)>4096)throw Error('invalid_request');
      signupConsentActivationSchema.parse(parseStrictJson(raw));
    }catch{res.status(422).json({code:'invalid_request'});return;}
    try{res.status(202).json(await consents.activateSignup(actor(req)));}catch(error){consentFailure(error,res);}
  });
  app.post('/api/candidate/product/consent',consentAvailable,consentActor,csrfProtection,async(req,res)=>{
    let raw:string;let command;
    try{
      if(!emptyQuery(req)||!req.is('application/json'))throw Error('invalid_request');
      raw=(req as Request&{rawBody?:string}).rawBody as string;command=parseConsentCapture(raw).value;
    }catch(error){const large=error instanceof Error&&error.message==='payload_too_large';
      res.status(large?413:422).json({code:large?'payload_too_large':'invalid_request'});return;
    }
    if(command.action==='grant'){
      if(!consentV2CaptureEnabled()){res.status(404).json({code:'not_found'});return;}
      if(!req.user!.emailVerified){res.status(403).json({code:'EMAIL_NOT_VERIFIED'});return;}
    }
    try{res.status(202).json(await consents.capture(actor(req),raw));}catch(error){consentFailure(error,res);}
  });
}

export function registerCandidateProductRoutes(app: Express, csrfProtection: Middleware): void {
  app.get('/api/candidate/product', available, requireVerifiedCandidate, async (req, res) => {
    if (!emptyRead(req)) { res.status(400).json({code:'invalid_request'}); return; }
    try { res.json(await repository.read(actor(req))); } catch(error) { failure(error,res); }
  });
  app.get('/api/candidate/product/commands/:id', available, requireVerifiedCandidate, async (req, res) => {
    if (!emptyRead(req) || !uuid.safeParse(req.params.id).success) { res.status(400).json({code:'invalid_request'}); return; }
    try { res.json(await repository.readCommand(actor(req),req.params.id!)); } catch(error) { failure(error,res); }
  });
  app.post('/api/candidate/product/foundation', available, requireVerifiedCandidate, csrfProtection, recent, async (req, res) => {
    let input;
    try { input=foundationRequest.parse(body(req)); }
    catch { res.status(400).json({code:'invalid_request'}); return; }
    try {
      const result=await repository.ensure(writer(req),input.idempotencyKey);
      res.status(result.status === 'acknowledged' ? 200 : 202).json(result);
    } catch(error) { failure(error,res); }
  });
  app.post('/api/candidate/product/intents/:id/claim', available, requireVerifiedCandidate, csrfProtection, recent, async (req,res) => {
    try { foundationClaimRequest.parse(body(req)); uuid.parse(req.params.id); }
    catch { res.status(400).json({code:'invalid_request'}); return; }
    try { res.json(await repository.claimIntent(writer(req),req.params.id!)); } catch(error) { failure(error,res); }
  });
}
