import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, approveBriefSchema, sourceHash } from '../job-brief/contracts';
import type { BriefScope } from '../job-brief/repository';
import { getGroqModel } from '../lib/aiModelConfig';
import { requireCandidatePrivacyAllowed } from '../candidate-privacy/decision';
import { hashSchema, idSchema, revisionSchema, sourcingAdmissionSchema, sourcingDecisionSchema, sourcingPreviewRequestSchema, sourcingGrantRequestSchema,sourcingReceiptSchema,sourcingNoDispatchSchema } from './contracts';
import {validateProviderGrant,type SourcingQueryArtifact,type ExactAcquisitionEvidence} from './compiler';
import { SourcingError, SourcingRepository } from './repository';

const scopeKeys = (s: BriefScope) => [s.organizationId, s.jobId, s.actorId];
const quoteSchema = z.object({
  payerDisplayName:z.string().min(1).max(160),
  payerUserId: z.number().int().positive(), payerSlotId: idSchema, remaining: z.number().int().min(1).max(5),
  windowStart: z.string().datetime({offset:true}), windowEnd: z.string().datetime({offset:true}), revision: revisionSchema,
  briefVersionId: idSchema, materialHash: hashSchema, artifactId: idSchema,
  quotedAt: z.string().datetime({offset:true}), expiresAt: z.string().datetime({offset:true}),
}).strict();
type Quote = z.infer<typeof quoteSchema>;
const signedQuoteSchema = z.object({
  organizationId:z.number().int().positive(),jobId:z.number().int().positive(),actorId:z.number().int().positive(),quote:quoteSchema,
}).strict();
const quoteDomain = 'ealana:sourcing-quote:v1:';
function quoteKey(): KeyObject {
  const configured = process.env.VANTAHIRE_JWT_PRIVATE_KEY;
  if (!configured) throw new SourcingError('SOURCING_QUOTE_UNAVAILABLE',503);
  const key = createPrivateKey(configured.includes('-----BEGIN') ? configured : Buffer.from(configured,'base64').toString('utf8'));
  if (key.asymmetricKeyType !== 'rsa') throw new SourcingError('SOURCING_QUOTE_UNAVAILABLE',503);
  return key;
}
// Existing Flow signer, separate message domain; not a service JWT and cannot
// be replayed as one. Never trust a browser-supplied timestamp by itself.
export function sealQuote(scope:BriefScope,quote:Quote,key:KeyObject=quoteKey()):string {
  const body=Buffer.from(canonicalJson(signedQuoteSchema.parse({...scope,quote}))).toString('base64url');
  const signature=sign('sha256',Buffer.from(quoteDomain+body),key).toString('base64url');
  return `${body}.${signature}`;
}
export function openQuote(token:string,scope:BriefScope,key:KeyObject=quoteKey()):Quote {
  try {
    if(token.length>8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw Error('shape');
    const [body,signature]=token.split('.');
    if(!verify('sha256',Buffer.from(quoteDomain+body!),createPublicKey(key),Buffer.from(signature!,'base64url'))) throw Error('signature');
    const value=signedQuoteSchema.parse(JSON.parse(Buffer.from(body!,'base64url').toString('utf8')));
    if(value.organizationId!==scope.organizationId || value.jobId!==scope.jobId || value.actorId!==scope.actorId) throw Error('scope');
    const start=Date.parse(value.quote.quotedAt),end=Date.parse(value.quote.expiresAt);
    if(end<=start || end-start>60001 || start>Date.now()+1000) throw Error('time');
    // Expiry is enforced by SQL after its duplicate-request check. Expired
    // authentic quotes may replay a committed admission, never create one.
    return value.quote;
  } catch { throw new SourcingError('SOURCING_QUOTE_INVALID',409); }
}

export async function quoteSourcing(repository:SourcingRepository,scope:BriefScope) {
  const value=await repository.call('quote',scopeKeys(scope));
  if(!value) throw new SourcingError('SOURCING_NOT_FOUND',404);
  const parsed=quoteSchema.parse(value);
  // PostgreSQL timestamps carry microseconds. Preserve the signed wire value:
  // JavaScript Date would silently truncate the subscription/window identity.
  const quote=parsed;
  return {...quote,quoteToken:sealQuote(scope,quote)};
}
export async function admitSourcing(repository:SourcingRepository,scope:BriefScope,input:unknown) {
  const parsed=sourcingAdmissionSchema.parse(input);
  const {requestId,quoteToken,...command}=parsed;
  const quote=openQuote(quoteToken,scope);
  if(command.expectedRevision!==quote.revision || command.briefVersionId!==quote.briefVersionId ||
    command.materialHash!==quote.materialHash || command.artifactId!==quote.artifactId || command.expectedPayerSlotId!==quote.payerSlotId ||
    command.expectedWindowStart!==quote.windowStart) throw new SourcingError('SOURCING_QUOTE_INVALID',409);
  const result=await repository.call('admit',[...scopeKeys(scope),requestId,{...command,quoteExpiresAt:quote.expiresAt}]);
  if(!result) throw new SourcingError('SOURCING_NOT_FOUND',404);
  return result;
}
export async function approveSourcingBrief(repository:SourcingRepository,scope:BriefScope,input:unknown) {
  const command=approveBriefSchema.parse(input);
  return repository.approveAndPrepare(scope,command,sourceHash(canonicalJson(command)),getGroqModel());
}
export async function decideSourcing(repository:SourcingRepository,scope:BriefScope,candidateId:number,input:unknown) {
  const {requestId,...command}=sourcingDecisionSchema.parse(input);
  await requireCandidatePrivacyAllowed({type:'job_sourced_candidate',id:candidateId},{globalUse:true});
  const result=await repository.call('decide',[...scopeKeys(scope),candidateId,requestId,command]);
  if(!result) throw new SourcingError('SOURCING_NOT_FOUND',404);
  return result;
}

/** Reads never create model or preview work. Retry only schedules the one
 * explicit failed-attempt retry; the background worker owns the actual call. */
export async function readSourcingPreview(repository:SourcingRepository,scope:BriefScope) {
  const result=await repository.call('previewRequest',[...scopeKeys(scope),null,{action:'read'}]);
  if(!result)throw new SourcingError('SOURCING_NOT_FOUND',404);
  return result;
}
export async function requestSourcingPreview(repository:SourcingRepository,scope:BriefScope,input:unknown) {
  const command=sourcingPreviewRequestSchema.parse(input);
  const result=command.action==='refresh'
    ?await repository.call('previewRequest',[...scopeKeys(scope),command.requestId,{action:'refresh',artifactId:command.artifactId}])
    :await repository.call('digestClaim',[...scopeKeys(scope),command.requestId,{action:'retry',model:getGroqModel(),briefVersionId:command.briefVersionId}]);
  if(!result)throw new SourcingError('SOURCING_NOT_FOUND',404);
  return result;
}

export async function handleSourcingMachineCommand(repository:SourcingRepository,
  claims:{tenantId:string;requestId:string;executionAttemptId:string},raw:unknown) {
  const command=z.union([sourcingGrantRequestSchema,sourcingReceiptSchema,sourcingNoDispatchSchema]).parse(raw);
  if(command.discoverRequestId!==claims.requestId || command.executionAttemptId!==claims.executionAttemptId)throw new SourcingError('SOURCING_NOT_FOUND',404);
  const context=await repository.call<{organizationId:number;artifact:SourcingQueryArtifact;exact:ExactAcquisitionEvidence|null}>
    ('grantContext',[claims.tenantId,command.flowRunId]);
  if(!context || context.artifact.queryHash!==command.artifactHash)throw new SourcingError('SOURCING_NOT_FOUND',404);
  let result:unknown;
  if(command.action==='grant') {
    let validated:ReturnType<typeof validateProviderGrant>;
    try{validated=validateProviderGrant(context.artifact,command,context.exact);}
    catch{throw new SourcingError('SOURCING_INVALID_COMMAND',409);}
    result=await repository.call('grant',[context.organizationId,command.flowRunId,{...command,providerInputHash:validated.providerInputHash}]);
  }else result=await repository.call(command.action==='no_dispatch'?'cancel':'receipt',[context.organizationId,command.flowRunId,command]);
  if(!result)throw new SourcingError('SOURCING_NOT_FOUND',404);
  return result;
}
