import {createHash} from 'node:crypto';
import {z} from 'zod';
import {profileCommandSchema,scalarString,MAX_PROFILE_BYTES,MAX_PREFERENCE_BYTES,profileUuid,profileHash,profileRevision,manualProfileSchema,preferencesSchema} from '../../shared/candidate-profile';
export const PROFILE_TABLES=['candidate_profile_commands','candidate_profile_outbox'] as const;
export const PROFILE_OWNER_FUNCTIONS=['flow_candidate_profile_record_ack()',
 'flow_candidate_profile_resolution_view(uuid)',
 'flow_candidate_profile_expiry_pending()',
 'flow_candidate_profile_expiry_finish(uuid,jsonb)',
 'flow_candidate_profile_consent_ready(integer,uuid,uuid,bigint)'] as const;
export const PROFILE_FUNCTIONS=['flow_candidate_profile_owner_read(integer,integer)',
 'flow_candidate_profile_resolve(integer,integer,uuid,uuid,bigint,text)',
 'flow_candidate_profile_recovery_refuse(uuid,uuid,bigint)',
 'flow_candidate_profile_recovery_review_count()',
 'flow_candidate_profile_admit(integer,integer,text,timestamp with time zone,uuid,text)',
 'flow_candidate_profile_command_read(integer,integer,uuid)','flow_candidate_profile_claim(uuid)',
 'flow_candidate_profile_finish(uuid,uuid,bigint,text,jsonb)',
 'flow_candidate_profile_prepare(uuid,uuid,bigint)',
 'flow_candidate_profile_redact_due()','flow_candidate_profile_expiry_claim()',
 'flow_candidate_profile_expiry_prepare(uuid,uuid,bigint)',
 'flow_candidate_profile_expiry_settle(uuid,uuid,bigint,jsonb)'] as const;
export const profileReadSchema=z.object({schemaVersion:z.literal(2),state:z.enum(['draft','confirmed']),
 draftVersion:profileRevision,profileVersion:profileRevision,preferenceVersion:profileRevision,draftHash:profileHash.nullable(),
 draft:manualProfileSchema.nullable(),confirmedProfile:manualProfileSchema.nullable(),preferences:preferencesSchema.nullable(),
 confirmedConsentVersion:z.literal(0),missingFields:z.array(z.enum(['profile','displayName','currentLocation.city','currentLocation.countryCode','skills','preferences'])).max(6),
 sources:z.array(z.never()).max(0),proposals:z.array(z.never()).max(0),
 capabilities:z.object({canEdit:z.literal(true),editBlockedReason:z.null(),canConfirm:z.boolean(),confirmBlockedReason:z.enum(['incomplete_profile']).nullable(),
 canEnrich:z.literal(false),enrichBlockedReason:z.literal('feature_unavailable'),canRequestResume:z.literal(false),resumeBlockedReason:z.literal('feature_unavailable')}).strict(),
 publicationActive:z.literal(false),matchingState:z.literal('not_available')}).strict();
export const profileReceiptSchema=z.object({schemaVersion:z.literal(2),commandId:profileUuid,subjectId:profileUuid,bindingId:profileUuid,
 commandHash:profileHash,status:z.enum(['applied','rejected']),draftVersion:profileRevision,profileVersion:profileRevision,
 preferenceVersion:profileRevision,reason:z.enum(['stale_edit','confirmation_conflict','incomplete_profile','candidate_privacy_restricted','invalid_request','command_expired']).nullable(),
 publicationActive:z.literal(false)}).strict().refine(r=>(r.status==='applied')===(r.reason===null));
export const PROFILE_REQUEST_MAX_BYTES=384*1024;
export const PROFILE_RESPONSE_MAX_BYTES=600*1024;
// Kept separate from S1's immutable 4KiB/4-level parser.
export function parseProfileJson(raw:string,maxBytes=PROFILE_REQUEST_MAX_BYTES):unknown {
 if(typeof raw!=='string')throw Error('invalid_request');
 if(Buffer.byteLength(raw,'utf8')>maxBytes)throw Error('payload_too_large');
 const value:unknown=JSON.parse(raw);let offset=0;
 const space=()=>{while(/[\x20\t\r\n]/.test(raw[offset]??'')&&offset<raw.length)offset++;};
 const string=()=>{const start=offset++;while(offset<raw.length){const c=raw[offset++];if(c==='\\')offset++;
  else if(c==='"'){const s=JSON.parse(raw.slice(start,offset)) as string;if(!scalarString(s))throw Error('invalid_request');return s;}}
  throw Error('invalid_request');};
 const visit=(depth:number):void=>{space();const c=raw[offset];
  if(c==='{'||c==='['){if(depth>12)throw Error('invalid_request');offset++;space();const end=c==='{'?'}':']';const keys=new Set();
   if(raw[offset]===end){offset++;return;}
   while(offset<raw.length){space();if(c==='{'){const key=string();if(keys.has(key))throw Error('invalid_request');keys.add(key);space();offset++;}
    visit(depth+1);space();if(raw[offset++]===end)return;}throw Error('invalid_request');}
  if(c==='"'){string();return;}const start=offset;while(offset<raw.length&&!/[\s,\]}]/.test(raw[offset]!))offset++;
  const token=raw.slice(start,offset);if(!['true','false','null'].includes(token)&&!Number.isFinite(Number(token)))throw Error('invalid_request');
 };visit(1);return value;
}
export function canonicalProfileJson(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(canonicalProfileJson).join(',')}]`;
 return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalProfileJson((value as Record<string,unknown>)[k])}`).join(',')}}`;
}
export function parseProfileCommand(raw:string){
 const value=profileCommandSchema.parse(parseProfileJson(raw));
 if(value.action==='save_draft'&&Buffer.byteLength(canonicalProfileJson(value.payload.profile),'utf8')>MAX_PROFILE_BYTES)throw Error('payload_too_large');
 if(value.action==='save_preferences'&&Buffer.byteLength(canonicalProfileJson(value.payload.preferences),'utf8')>MAX_PREFERENCE_BYTES)throw Error('payload_too_large');
 const canonical=canonicalProfileJson(value);
 return {value,canonical,hash:createHash('sha256').update(canonical,'utf8').digest('hex')};
}
