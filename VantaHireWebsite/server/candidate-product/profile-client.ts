import {signServiceJwt} from '../lib/services/jwt-signer';
import {createHash} from 'node:crypto';
import {foundationMemoryOrigin} from './memory-client';
import {parseProfileJson,profileReadSchema,canonicalProfileJson,PROFILE_RESPONSE_MAX_BYTES} from './profile-contracts';
import {profileUuid} from '../../shared/candidate-profile';
import {profileHash} from '../../shared/candidate-profile';
import {z} from 'zod';
import {storageReadSchema} from './spark-contracts';
import {sourceProposalSchema,interpretationReceiptSchema,interpretationResponseSchema,exclusionPreviewRequestSchema,exclusionPreviewSchema} from '../../shared/candidate-spark-v3';
import {parseInterpretationTransfer} from './interpretation';
import type {ProfileLease} from './profile-processor';
import {parseQueuedProfileCommand,parseQueuedProfileReceipt} from './profile-processor';
import {networkPublicationAuthority} from '../sourcing-authority/candidate-origin';

/** New sourcing delivery only. Stored job records never refresh through this
 * method, so withdrawal cannot silently update or delete historical cards. */
export async function validateNetworkDelivery(organizationId:number,authorities:unknown[],
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 if((deps.env??process.env).CANDIDATE_NETWORK_SOURCING_ENABLED!=='true')throw new ProfileTransportError('memory_unavailable');
 z.number().int().positive().safe().parse(organizationId);
 const requested=z.array(networkPublicationAuthority).max(100).parse(authorities);
 const byId=new Map(requested.map(a=>[a.publicationId,a]));
 if(byId.size!==requested.length)throw new ProfileTransportError('identity_conflict');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const operation=async()=>{
  const token=await(deps.sign??signServiceJwt)('activekg',{tenantId:`org_${organizationId}`,scopes:'kg:read',actorType:'service',lifetimeSeconds:60});
  controller.signal.throwIfAborted();
  const response=await(deps.fetch??fetch)(`${foundationMemoryOrigin(deps.env)}/global-candidates/network/validate`,{
   method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
   body:JSON.stringify({publicationIds:requested.map(a=>a.publicationId)})});
  if(response.status!==200){await response.body?.cancel();throw new ProfileTransportError('memory_unavailable');}
  reader=response.body?.getReader();if(!reader)throw new ProfileTransportError('memory_unavailable');
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
   if(bytes>131072)throw new ProfileTransportError('memory_unavailable');chunks.push(part.value);}
  controller.signal.throwIfAborted();
  const result=z.object({schemaVersion:z.literal(1),publications:z.array(networkPublicationAuthority).max(100)}).strict()
   .parse(parseProfileJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),131072));
  const allowed=new Set<string>();
  for(const item of result.publications){
   if(allowed.has(item.publicationId)||canonicalProfileJson(byId.get(item.publicationId))!==canonicalProfileJson(item))
    throw new ProfileTransportError('identity_conflict');
   allowed.add(item.publicationId);
  }
  return allowed;
 };
 try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(new ProfileTransportError('memory_unavailable'));},5000);
 })]);}catch(error){if(error instanceof ProfileTransportError)throw error;throw new ProfileTransportError('memory_unavailable');}
 finally{controller.abort();clearTimeout(timer);void reader?.cancel().catch(()=>{});}
}
export class ProfileTransportError extends Error {
 constructor(public readonly code:'identity_conflict'|'memory_unavailable'|'delivery_outcome_unknown'|'invalid_request'|'candidate_privacy_restricted'|'source_proposal_unavailable'){super(code);}
}

/** Owner reads fail explicitly; an outage never becomes an empty profile. */
export async function readProfile(subjectId:string,bindingId:string,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 return readOwnerProfile(subjectId,bindingId,'/candidate-profiles/profile',raw=>{
  const view=profileReadSchema.parse(parseProfileJson(raw,PROFILE_RESPONSE_MAX_BYTES));
  const hash=view.draft===null?null:createHash('sha256').update(canonicalProfileJson(view.draft)).digest('hex');
  if(view.draftHash!==hash)throw new ProfileTransportError('memory_unavailable');
  return view;
 },deps);
}

/** Private v3 storage read. Never falls back to the legacy preference format. */
export async function readSparkProfile(subjectId:string,bindingId:string,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 return readOwnerProfile(subjectId,bindingId,'/candidate-profiles/spark',raw=>{
  const view=storageReadSchema.parse(parseProfileJson(raw,PROFILE_RESPONSE_MAX_BYTES));
  if(view.preferenceDraft){
   const {sections,exclusions,preferenceDraftHash}=view.preferenceDraft;
   const hash=createHash('sha256').update(canonicalProfileJson({sections,exclusions})).digest('hex');
   if(hash!==preferenceDraftHash)throw new ProfileTransportError('memory_unavailable');
  }
  return view;
 },deps);
}

export async function readNetworkStatus(subjectId:string,bindingId:string,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 return readOwnerProfile(subjectId,bindingId,'/global-candidates/network/status',raw=>
  z.object({schemaVersion:z.literal(1),publicationActive:z.boolean(),blockedReason:z.enum([
   'feature_unavailable','restricted','consent_required','confirmation_required','publication_unavailable','publication_pending','publication_held',
  ]).nullable()}).strict().refine(v=>v.publicationActive===(v.blockedReason===null)).parse(parseProfileJson(raw,4096)),deps,4096);
}

async function readOwnerProfile<T>(subjectId:string,bindingId:string,path:string,parse:(raw:string)=>T,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv},maxBytes=PROFILE_RESPONSE_MAX_BYTES,sourceProposal=false){
 profileUuid.parse(subjectId);profileUuid.parse(bindingId);
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const operation=async()=>{
  const token=await(deps.sign??signServiceJwt)('activekg',{tenantId:`candidate_${subjectId}`,scopes:'candidate-profile:owner-read',actorType:'service',lifetimeSeconds:60});
  if(controller.signal.aborted)throw new ProfileTransportError('memory_unavailable');
  const response=await(deps.fetch??fetch)(`${foundationMemoryOrigin(deps.env)}${path}?binding=${bindingId}`,
   {redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${token}`}});
  if(response.status!==200){void response.body?.cancel().catch(()=>{});throw new ProfileTransportError(response.status===451?'candidate_privacy_restricted':response.status===404&&sourceProposal?'source_proposal_unavailable':'memory_unavailable');}
  const reader=response.body?.getReader();if(!reader)throw new ProfileTransportError('memory_unavailable');
  const chunks:Uint8Array[]=[];let bytes=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  try{for(;;){if(controller.signal.aborted)throw new ProfileTransportError('memory_unavailable');
   const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
   if(bytes>maxBytes){cancel();throw new ProfileTransportError('memory_unavailable');}chunks.push(value);
  }}finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  // Read responses contain both current draft and confirmed profile, so the
  // command parser's 384KiB bound is intentionally not reused for this response.
  return parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 };
 try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProfileTransportError('memory_unavailable'));},5000);})]);}
 catch(error){if(error instanceof ProfileTransportError)throw error;throw new ProfileTransportError('memory_unavailable');}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
export async function readSourceProposal(subjectId:string,bindingId:string,sourceId:string,proposalId:string,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 profileUuid.parse(sourceId);profileUuid.parse(proposalId);
 return readOwnerProfile(subjectId,bindingId,`/candidate-profiles/sources/${sourceId}/proposals/${proposalId}`,raw=>{
  const value=sourceProposalSchema.parse(parseProfileJson(raw,2*1024*1024));
  const {proposalHash,...body}=value;
  if(value.sourceId!==sourceId||value.proposalId!==proposalId
   ||createHash('sha256').update(canonicalProfileJson(body)).digest('hex')!==proposalHash)
   throw new ProfileTransportError('identity_conflict');
  return value;
 },deps,2*1024*1024,true);
}

export async function readInterpretationProposal(subjectId:string,bindingId:string,proposalId:string,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 profileUuid.parse(proposalId);
 return readOwnerProfile(subjectId,bindingId,`/candidate-profiles/interpretations/${proposalId}`,raw=>{
  const value=interpretationResponseSchema.options[0].parse(parseProfileJson(raw,131072));
  const {proposalHash,...body}=value;
  if(value.proposalId!==proposalId||createHash('sha256').update(canonicalProfileJson(body)).digest('hex')!==proposalHash)
   throw new ProfileTransportError('identity_conflict');
  return value;
 },deps,131072);
}

/** Replay the exact journal result; this transport never invokes a paid model. */
export async function deliverInterpretationProposal(raw:string,signal:AbortSignal,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 const parsed=parseInterpretationTransfer(raw),value=parsed.value;
 return sendProfileReceipt({...value,hash:parsed.hash,body:parsed.canonical},signal,3,
  '/candidate-profiles/interpretations',deps,undefined,response=>{
   const receipt=interpretationReceiptSchema.parse(parseProfileJson(response,8192));
   if(receipt.commandId!==value.commandId||receipt.subjectId!==value.subjectId||receipt.bindingId!==value.bindingId
    ||receipt.commandHash!==parsed.hash||receipt.proposalId!==value.proposal.proposalId||receipt.proposalHash!==value.proposal.proposalHash)
    throw new ProfileTransportError('identity_conflict');
   return receipt;
  });
}

export async function previewExclusions(subjectId:string,bindingId:string,input:unknown,signal:AbortSignal,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 profileUuid.parse(subjectId);profileUuid.parse(bindingId);
 const value=exclusionPreviewRequestSchema.parse(input),body=canonicalProfileJson(value);
 return sendProfileReceipt({subjectId,bindingId,commandId:value.idempotencyKey,hash:createHash('sha256').update(body).digest('hex'),body},
  signal,3,'/candidate-profiles/exclusions/preview',deps,undefined,raw=>{
   const result=exclusionPreviewSchema.parse(parseProfileJson(raw,32768));
   const {proposalHash,...payload}=result;
   if(createHash('sha256').update(canonicalProfileJson(payload)).digest('hex')!==proposalHash
    ||result.expectedPreferenceDraftRevision!==value.expectedPreferenceDraftRevision
    ||canonicalProfileJson(result.restrictions.map(({id,...rule})=>rule))!==canonicalProfileJson(value.restrictions))
    throw new ProfileTransportError('identity_conflict');
   return result;
  },32768);
}
/** One authenticated attempt. The durable outbox, never this client, retries. */
export async function deliverProfile(lease:ProfileLease,signal:AbortSignal,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 const parsed=parseQueuedProfileCommand(lease.body);
 if(parsed.canonical!==lease.body||parsed.hash!==lease.hash||parsed.value.idempotencyKey!==lease.idempotencyKey)
  throw new ProfileTransportError('invalid_request');
 return sendProfileReceipt(lease,signal,parsed.value.schemaVersion,
  parsed.value.schemaVersion===3?'/candidate-profiles/spark/commands':'/candidate-profiles/profile/commands',deps);
}

export const expiryIdentitySchema=z.object({schemaVersion:z.union([z.literal(2),z.literal(3)]),commandId:profileUuid,subjectId:profileUuid,
 bindingId:profileUuid,idempotencyKey:profileUuid,commandHash:profileHash}).strict();
export type ExpiryIdentity=z.infer<typeof expiryIdentitySchema>;
export async function recoverProfileExpiry(input:ExpiryIdentity,signal:AbortSignal,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 const value=expiryIdentitySchema.parse(input);
 const {subjectId,commandHash,...request}=value;
 const body=canonicalProfileJson({...request,commandHash});
 return sendProfileReceipt({subjectId,bindingId:value.bindingId,commandId:value.commandId,hash:commandHash,body},signal,value.schemaVersion,
  '/candidate-profiles/spark/expiry',deps,createHash('sha256').update(body).digest('hex'));
}

export const erasureIdentitySchema=z.object({schemaVersion:z.literal(1),subjectId:profileUuid,
 bindingId:profileUuid,requestId:profileUuid}).strict();
export async function eraseSparkProfile(input:z.infer<typeof erasureIdentitySchema>,signal:AbortSignal,
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 const value=erasureIdentitySchema.parse(input),body=canonicalProfileJson(value);
 return sendProfileReceipt<void>({...value,commandId:value.requestId,hash:createHash('sha256').update(body).digest('hex'),body},
  signal,3,'/candidate-profiles/erase',deps,undefined,raw=>{
   const result=erasureIdentitySchema.extend({status:z.literal('erased')}).parse(parseProfileJson(raw));
   if(result.subjectId!==value.subjectId||result.bindingId!==value.bindingId||result.requestId!==value.requestId)
    throw new ProfileTransportError('identity_conflict');
  });
}

async function sendProfileReceipt<T=ReturnType<typeof parseQueuedProfileReceipt>>(lease:{subjectId:string;bindingId:string;commandId:string;hash:string;body:string},signal:AbortSignal,
 version:2|3,path:string,deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv},expiryHash?:string,parseResponse?:(raw:string)=>T,maxBytes=8192):Promise<T>{
 const origin=foundationMemoryOrigin(deps.env);
 const controller=new AbortController();
 const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)controller.abort();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let dispatched=false;
 const operation=async()=>{
  const token=await (deps.sign??signServiceJwt)('activekg',{tenantId:`candidate_${lease.subjectId}`,
   scopes:path==='/candidate-profiles/erase'?'candidate-profile:erase':'candidate-profile:owner-write',actorType:'service',requestId:lease.commandId,lifetimeSeconds:60});
  if(controller.signal.aborted)throw new ProfileTransportError('memory_unavailable');
  dispatched=true;
  const response=await (deps.fetch??fetch)(`${origin}${path}`,{
   method:'POST',redirect:'error',signal:controller.signal,
   headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(expiryHash?{'X-Candidate-Expiry-SHA256':expiryHash}:{}),
    ...(['/candidate-profiles/interpretations','/candidate-profiles/exclusions/preview'].includes(path)?{'X-Command-SHA256':lease.hash}:{'X-Candidate-Command-SHA256':lease.hash}),
    'X-Candidate-Binding-ID':lease.bindingId,'X-Candidate-Command-ID':lease.commandId},body:lease.body,
  });
  if(response.status!==200&&response.status!==201){
   void response.body?.cancel().catch(()=>{});
   if(response.status===451)throw new ProfileTransportError('candidate_privacy_restricted');
   if([401,403,404,409].includes(response.status))throw new ProfileTransportError('identity_conflict');
   throw new ProfileTransportError('delivery_outcome_unknown');
  }
  const reader=response.body?.getReader();if(!reader)throw new ProfileTransportError('delivery_outcome_unknown');
  const chunks:Uint8Array[]=[];let bytes=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  try{for(;;){if(controller.signal.aborted)throw new ProfileTransportError('delivery_outcome_unknown');
   const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;
   if(bytes>maxBytes){cancel();throw new ProfileTransportError('delivery_outcome_unknown');}chunks.push(value);
  }}finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  if(parseResponse)return parseResponse(raw);
  const receipt=parseQueuedProfileReceipt(version,parseProfileJson(raw));
  if(receipt.subjectId!==lease.subjectId||receipt.bindingId!==lease.bindingId||receipt.commandId!==lease.commandId||receipt.commandHash!==lease.hash)
   throw new ProfileTransportError('identity_conflict');
  return receipt as T;
 };
 try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(new ProfileTransportError(dispatched?'delivery_outcome_unknown':'memory_unavailable'));},10_000);
  controller.signal.addEventListener('abort',()=>reject(new ProfileTransportError(dispatched?'delivery_outcome_unknown':'memory_unavailable')),{once:true});
  if(controller.signal.aborted)reject(new ProfileTransportError('memory_unavailable'));
 })]);}
 catch(error){if(error instanceof ProfileTransportError)throw error;throw new ProfileTransportError(dispatched?'delivery_outcome_unknown':'memory_unavailable');}
 finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
}
