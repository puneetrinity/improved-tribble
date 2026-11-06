import {z} from 'zod';
import {profileUuid,profileRevision,profileHash} from '../../shared/candidate-profile';
import {parseQueuedProfileCommand} from './profile-processor';
import type {FoundationDb} from './repository';
import {randomUUID} from 'node:crypto';
import {redactSourceCopies} from './retention';
import {expiryIdentitySchema} from './profile-client';
import {saveResolutionViewSchema} from '../../shared/candidate-spark-v3';
import {parseSaveResolution} from './spark-contracts';
import type {ProfileLease,ProfileFinish} from './profile-processor';
export class ProfileRepositoryError extends Error{
 constructor(public readonly code:string,public readonly status:number){super(code);}
}
const actorSchema=z.object({userId:z.number().int().positive(),authVersion:profileRevision}).strict();
const writerSchema=actorSchema.extend({passwordVersion:z.string().regex(/^[0-9a-f]{64}$/).nullable(),reauthenticatedAt:z.number().int().min(0).nullable()}).strict();
import {admissionSchema,actions,reasons,commandReadSchema,ownerSchema} from '../../shared/candidate-spark-v3';
const preparedSchema=z.object({subjectId:profileUuid,bindingId:profileUuid,userId:z.number().int().positive(),authVersion:profileRevision,commandHash:profileHash}).strict().nullable();
export const expiryLeaseSchema=expiryIdentitySchema.extend({userId:z.number().int().positive(),leaseToken:profileUuid,leaseGeneration:profileRevision});
export type ExpiryLease=z.infer<typeof expiryLeaseSchema>;
type Actor=z.infer<typeof actorSchema>;
const errors:Record<string,[string,number]>={not_found:['P0002',404],idempotency_conflict:['23505',409],
 resolution_conflict:['40001',409],resolution_limit:['42501',409],resolution_unavailable:['42501',409],
 authentication_changed:['42501',403],recent_auth_required:['42501',403],candidate_privacy_restricted:['42501',451],invalid_request:['22023',422],
 consent_changed:['42501',409],pending_changes:['40001',409],feature_unavailable:['0A000',409]};
export function profileRepository(db:FoundationDb,privacy:(userId:number)=>Promise<void>){
 async function checked(actor:Actor){const a=actorSchema.parse(actor);await privacy(a.userId);return a;}
 async function call<T>(sql:string,args:unknown[],schema:z.ZodType<T>):Promise<T>{
  try{const result=await db.query(sql,args);if(result.rows.length!==1)throw Error('invalid_result');return schema.parse(result.rows[0]!.result);}
  catch(error){const e=error as {code?:unknown;message?:unknown};const found=typeof e.message==='string'?errors[e.message]:undefined;
   if(found&&found[0]===e.code)throw new ProfileRepositoryError(e.message as string,found[1]);
   throw new ProfileRepositoryError('authority_unavailable',503);}
 }
 return {
  async resolution(actor:Actor,commandId:string,raw?:string){
   const a=await checked(actor);profileUuid.parse(commandId);const request=raw===undefined?null:parseSaveResolution(raw).value;
   return call('SELECT public.flow_candidate_profile_resolve($1,$2,$3,$4,$5,$6) AS result',
    [a.userId,a.authVersion,commandId,request?.idempotencyKey??null,request?.expectedResolutionRevision??null,request?.action??'read'],saveResolutionViewSchema);
  },
  async refuseExpiry(input:ExpiryLease){const lease=expiryLeaseSchema.parse(input);
   return call('SELECT public.flow_candidate_profile_recovery_refuse($1,$2,$3) AS result',
    [lease.commandId,lease.leaseToken,lease.leaseGeneration],z.object({applied:z.boolean()}).strict());
  },
  async recoveryReviewCount(){return call('SELECT public.flow_candidate_profile_recovery_review_count()::integer AS result',[],z.number().int().min(0));},
  async redactDue(){await redactSourceCopies(db);return call('SELECT public.flow_candidate_profile_redact_due() AS result',[],z.object({redacted:z.number().int().min(0).max(100),awaitingExpiry:z.number().int().min(0).max(100)}).strict());},
  async claimExpiry(){return call('SELECT public.flow_candidate_profile_expiry_claim() AS result',[],z.array(expiryLeaseSchema).max(5));},
  async prepareExpiry(input:ExpiryLease){const lease=expiryLeaseSchema.parse(input);await privacy(lease.userId);
   const ready=await call('SELECT public.flow_candidate_profile_expiry_prepare($1,$2,$3) AS result',
    [lease.commandId,lease.leaseToken,lease.leaseGeneration],z.boolean());
   if(!ready)throw new ProfileRepositoryError('authority_unavailable',503);
  },
  async settleExpiry(input:ExpiryLease,receipt:unknown|null){const lease=expiryLeaseSchema.parse(input);
   return call('SELECT public.flow_candidate_profile_expiry_settle($1,$2,$3,$4) AS result',
    [lease.commandId,lease.leaseToken,lease.leaseGeneration,receipt===null?null:JSON.stringify(receipt)],z.object({applied:z.boolean()}).strict());
  },
  async owner(actor:Actor){const a=await checked(actor);return call('SELECT public.flow_candidate_profile_owner_read($1,$2) AS result',[a.userId,a.authVersion],ownerSchema);},
  async authority(lease:ProfileLease){
   const a=await checked({userId:lease.userId,authVersion:lease.authVersion});
   if(parseQueuedProfileCommand(lease.body).value.schemaVersion===3){
    const ready=await call('SELECT public.flow_candidate_profile_prepare($1,$2,$3) AS result',
     [lease.commandId,lease.leaseToken,lease.leaseGeneration],preparedSchema);
    if(!ready)throw new ProfileRepositoryError('authority_unavailable',503);
    if(ready.subjectId!==lease.subjectId||ready.bindingId!==lease.bindingId||ready.userId!==a.userId||ready.authVersion!==a.authVersion||ready.commandHash!==lease.hash)
     throw new ProfileRepositoryError('identity_conflict',409);
    return;
   }
   const current=await call('SELECT public.flow_candidate_profile_owner_read($1,$2) AS result',[a.userId,a.authVersion],ownerSchema);
   if(current.subjectId!==lease.subjectId||current.bindingId!==lease.bindingId)throw new ProfileRepositoryError('identity_conflict',409);
  },
  async claim(limit:number){if(limit!==20)throw new ProfileRepositoryError('invalid_request',422);
   return call('SELECT public.flow_candidate_profile_claim($1) AS result',[randomUUID()],z.array(z.unknown()).max(20));},
  async finish(lease:ProfileLease,result:ProfileFinish){
   const {state,...details}=result;
   await call('SELECT public.flow_candidate_profile_finish($1,$2,$3,$4,$5) AS result',
    [lease.commandId,lease.leaseToken,lease.leaseGeneration,state,JSON.stringify(details)],z.object({applied:z.boolean()}).strict());
  },
  async admit(actor:z.infer<typeof writerSchema>,raw:string){
   const a=writerSchema.parse(actor);await checked({userId:a.userId,authVersion:a.authVersion});const command=parseQueuedProfileCommand(raw);
   if(command.value.schemaVersion===3&&!['save_preference_section','promote_preferences','accept_exclusions','remove_exclusion','confirm','accept_source','reject_source','accept_interpretation'].includes(command.value.action))
    throw new ProfileRepositoryError('feature_unavailable',409);
   if(command.value.action==='confirm'&&(a.passwordVersion===null||a.reauthenticatedAt===null))throw new ProfileRepositoryError('recent_auth_required',403);
   const time=a.reauthenticatedAt===null?null:new Date(a.reauthenticatedAt);
   if(time&&!Number.isFinite(time.getTime()))throw new ProfileRepositoryError('invalid_request',422);
   const result=await call('SELECT public.flow_candidate_profile_admit($1,$2,$3,$4,$5,$6) AS result',
    [a.userId,a.authVersion,a.passwordVersion,time?.toISOString()??null,command.value.idempotencyKey,command.canonical],admissionSchema);
   if(result.schemaVersion!==command.value.schemaVersion)throw new ProfileRepositoryError('authority_unavailable',503);
   return result;
  },
  async readCommand(actor:Actor,id:string){const a=await checked(actor);profileUuid.parse(id);
   return call('SELECT public.flow_candidate_profile_command_read($1,$2,$3) AS result',[a.userId,a.authVersion,id],commandReadSchema);},
 };
}
