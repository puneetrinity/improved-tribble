// Design-lock seam validators, not product code or runtime registration.
// Existing canonical validators are imported, never reimplemented here.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
// Vendored from ealana-index/candidate-parallel-lock-20261030/contracts.mjs; root is this checkout.
const root=fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/,'');
const require=createRequire(root+'/package.json');
require('tsx/cjs');
const {z}=require('zod');
const p=require(root+'/shared/candidate-profile.ts');
const s=require(root+'/shared/candidate-spark-v3.ts');
const lookup=require(root+'/server/candidate-product/source-contracts.ts');
const strict=x=>z.object(x).strict();
const id=p.profileUuid,hash=p.profileHash,rev=p.profileRevision;
const text=(max,min=0)=>z.string().min(min).max(max).refine(v=>p.scalarString(v)&&!v.includes('\u0000'));
const country=z.string().refine(v=>p.COUNTRY_CODES.has(v));
const media=z.enum(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
export const resumeRequest=strict({schemaVersion:z.literal(1),idempotencyKey:id,sourceId:id,sourceVersion:rev});
export const resumeSelection=strict({schemaVersion:z.literal(1),idempotencyKey:id,resumeId:z.number().int().positive().safe()});
export const resumeSnapshot=strict({schemaVersion:z.literal(1),sourceId:id,sourceVersion:rev,contentHash:hash});
export const lookupRequest=z.discriminatedUnion('kind',[
 strict({schemaVersion:z.literal(1),idempotencyKey:id,expectedConsentRevision:rev,kind:z.literal('email')}),
 strict({schemaVersion:z.literal(1),idempotencyKey:id,expectedConsentRevision:rev,kind:z.literal('linkedin'),
  url:lookup.lookupLinkedinSchema}),
]);
export const lookupStatus=strict({schemaVersion:z.literal(1),attemptId:id,
 state:z.enum(['queued','running','transferring','review_ready','not_found','held','rejected']),
 reason:z.enum(['outcome_unknown','consent_changed','privacy_restricted','budget_unavailable','definite_failure']).nullable(),
 proposalId:id.nullable(),canRequestLinkedin:z.boolean(),waitLimitMs:z.literal(20000)}).superRefine((v,ctx)=>{
 if((v.state==='review_ready')!==(v.proposalId!==null)||(['queued','running','transferring','held'].includes(v.state)&&v.canRequestLinkedin))
 ctx.addIssue({code:'custom',message:'invalid_lookup_state'});
});
// Internal extraction invocation: server resolved immutable object before this;
// bytes are a separate Buffer argument, never a browser URL or bucket path.
export const extractionInput=strict({schemaVersion:z.literal(1),sourceId:id,sourceVersion:rev,
 contentHash:hash,byteLength:z.number().int().min(1).max(5*1024*1024),mediaType:media,policyVersion:text(80,1)});
const extractBase={schemaVersion:z.literal(1),sourceId:id,sourceVersion:rev,contentHash:hash,policyVersion:text(80,1)};
export const extractionOutput=z.discriminatedUnion('status',[
 strict({...extractBase,status:z.literal('extracted'),text:text(512*1024,1),textHash:hash,
  method:z.enum(['native_text','google_vision_ocr']),providerCalls:z.number().int().min(0).max(1)}),
 strict({...extractBase,status:z.literal('unavailable'),reason:z.enum(['unsupported','empty','too_large','privacy_changed','source_changed','budget_unavailable','provider_uncertain','provider_refused'])}),
]);
const reference=strict({sourceId:id,sourceVersion:rev,contentHash:hash,locator:text(200,1),quote:text(2048,1)});
const fields=p.manualProfileSchema.shape;
const row=(key)=>fields[key].innerType().element;
const values={displayName:fields.displayName,headline:fields.headline,linkedinUrl:fields.linkedinUrl,
 currentLocation:fields.currentLocation,skill:text(100,1),employment:row('employment'),education:row('education'),project:row('projects')};
export const sourceFact=z.discriminatedUnion('kind',Object.entries(values).map(([kind,value])=>strict({
 factId:id,kind:z.literal(kind),targetRowId:id.nullable(),value,evidence:z.array(reference).min(1).max(8),
}))).superRefine((v,ctx)=>{if(v.targetRowId!==null&&!['employment','education','project'].includes(v.kind))ctx.addIssue({code:'custom',message:'invalid_target_row'});});
export const sourceProposal=strict({schemaVersion:z.literal(1),proposalId:id,sourceId:id,sourceVersion:rev,proposalHash:hash,
 originalDraftVersion:rev,originalProfileVersion:rev,originalPreferenceVersion:rev,originalPreferenceDraftRevision:rev,
 sourceKind:z.enum(['professional_lookup','resume','legacy_flow_profile']),
 facts:z.array(sourceFact).max(400),reviewNotes:z.array(text(2000,1)).max(20),expiresAt:z.string().datetime(),
}).refine(v=>new Set(v.facts.map(f=>f.factId)).size===v.facts.length)
 .refine(v=>v.facts.reduce((n,f)=>n+f.evidence.reduce((m,e)=>m+Buffer.byteLength(e.quote,'utf8'),0),0)<=65536);
// Frozen Flow->Memory resume receiver seam. Only the trusted Flow service may
// send this DTO. The browser cannot choose subject, binding, content or consent.
export const resumeTransfer=strict({schemaVersion:z.literal(1),commandId:id,subjectId:id,bindingId:id,
 sourceId:id,sourceVersion:rev,contentHash:hash,textHash:hash,policyVersion:text(80,1),
 consentRevision:rev.refine(v=>v>0),text:text(512*1024,1),proposal:sourceProposal});
export const sourceReceipt=strict({schemaVersion:z.literal(1),commandId:id,subjectId:id,bindingId:id,commandHash:hash,
 sourceId:id,sourceVersion:rev,proposalId:id,proposalHash:hash,
 outcome:z.enum(['stored','rejected']),reason:z.enum(['consent_changed','source_conflict','stale_edit','proposal_expired']).nullable(),
 canonicalProfileChanged:z.literal(false),publicationActive:z.literal(false)})
 .refine(v=>(v.outcome==='stored')===(v.reason===null));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:
 `{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`;
export const seamHash=value=>createHash('sha256').update(canonical(value),'utf8').digest('hex');
export function validateResumeTransfer(value){
 const v=resumeTransfer.parse(value),p=v.proposal;
 if(Buffer.byteLength(canonical(v),'utf8')>2*1024*1024||Buffer.byteLength(v.text,'utf8')>512*1024)throw Error('payload_too_large');
 if(createHash('sha256').update(v.text,'utf8').digest('hex')!==v.textHash)throw Error('text_hash_mismatch');
 if(p.sourceKind!=='resume'||p.sourceId!==v.sourceId||p.sourceVersion!==v.sourceVersion)throw Error('source_mismatch');
 const {proposalHash,...body}=p;if(seamHash(body)!==proposalHash)throw Error('proposal_hash_mismatch');
 for(const fact of p.facts)for(const e of fact.evidence){
  if(e.sourceId!==v.sourceId||e.sourceVersion!==v.sourceVersion||e.contentHash!==v.contentHash)throw Error('evidence_mismatch');
  const match=/^text:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(e.locator);
  if(!match)throw Error('invalid_evidence_locator');
  const start=Number(match[1]),length=Number(match[2]);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||length<1||start+length>v.text.length||v.text.slice(start,start+length)!==e.quote)throw Error('quote_mismatch');
 }
 return {value:v,canonical:canonical(v),hash:seamHash(v)};
}
export function validateSourceReceipt(request,value){
 const input=validateResumeTransfer(request),r=sourceReceipt.parse(value);
 for(const key of ['commandId','subjectId','bindingId','sourceId','sourceVersion'])if(r[key]!==input.value[key])throw Error('receipt_mismatch');
 if(r.commandHash!==input.hash||r.proposalId!==input.value.proposal.proposalId||r.proposalHash!==input.value.proposal.proposalHash)throw Error('receipt_mismatch');
 return r;
}
export const companyQuery=strict({query:text(120,2)});
const companyName=text(200,1).refine(v=>v===v.trim()&&v===v.normalize('NFC'));
const domain=text(253,1).refine(v=>/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v));
export const companyResponse=z.array(strict({companyId:id,displayName:companyName,domain})).max(10)
 .refine(v=>new Set(v.map(c=>c.companyId)).size===v.length);
export const registryRow=strict({companyId:id,displayName:companyName,domain,active:z.boolean(),
 provenance:strict({kind:z.literal('operator_reviewed_public'),reference:text(1000,1),reviewedAt:z.string().datetime()})});
export const applicationLocation=strict({city:text(200,1),countryCode:country,relocationPreference:z.enum(['yes','no','discuss'])});
export const applicationLocationEvidence=strict({version:z.literal(2),provenance:z.literal('candidate_confirmed'),city:text(200,1),
 country:text(200,1),countryCode:country,confirmedAt:z.string().datetime()});
const revisions={expectedDraftVersion:rev,expectedProfileVersion:rev,expectedPreferenceVersion:rev,expectedPreferenceDraftRevision:rev};
export const interpretationRequest=strict({schemaVersion:z.literal(1),idempotencyKey:id,...revisions,
 use:z.enum(['source_correction','private_exclusions','change_preferences']),text:text(8000,1),
 sourceProposalId:id.nullable(),sourceVersion:rev.nullable(),targetRowId:id.nullable()});
export const interpretationChange=z.discriminatedUnion('kind',[
 strict({kind:z.literal('source_correction'),fact:sourceFact.refine(v=>!['displayName','linkedinUrl'].includes(v.kind))}),
 strict({kind:z.literal('preference_section'),answer:s.preferenceSectionSchema.refine(v=>v.section!=='authorisation')}),
 strict({kind:z.literal('exclusions'),restrictions:z.array(z.discriminatedUnion('kind',[
  strict({kind:z.literal('remote_only')}),strict({kind:z.literal('no_travel')}),strict({kind:z.literal('exclude_company'),companyId:id}),
 ])).min(1).max(20)}),
]);
export const interpretationResponse=z.discriminatedUnion('status',[
 strict({schemaVersion:z.literal(1),status:z.literal('proposal'),proposalId:id,proposalHash:hash,...revisions,
  expiresAt:z.string().datetime(),summary:text(2000,1),changes:z.array(interpretationChange).min(1).max(20)}),
 strict({schemaVersion:z.literal(1),status:z.literal('clarify'),question:text(1000,1)}),
 strict({schemaVersion:z.literal(1),status:z.literal('cannot_help'),reason:z.enum(['unsupported','insufficient_evidence','unsafe','budget_unavailable'])}),
]);
export const command=s.commandSchema; // accept/reject/confirm reuse existing exact contract
export const resolutionRequest=s.saveResolutionRequestSchema;
export const resolutionView=s.saveResolutionViewSchema;
export const consentCapture=s.consentCaptureSchema;
// Design-only native sourcing seam; never a browser/private-profile DTO.
export const networkHit=strict({schemaVersion:z.literal(1),source:z.literal('candidate_network'),subjectId:id,
 publicationId:id,generation:rev.refine(v=>v>0),profileVersion:rev.refine(v=>v>0),consentRevision:rev.refine(v=>v>0),
 facts:p.manualProfileSchema,authorityCheckedAt:z.string().datetime()});
export function validateExtractionResult(input,output){
 const request=extractionInput.parse(input),result=extractionOutput.parse(output);
 for(const key of ['sourceId','sourceVersion','contentHash','policyVersion'])if(request[key]!==result[key])throw Error('source_changed');
 if(result.status==='extracted'){
  if(Buffer.byteLength(result.text,'utf8')>512*1024||createHash('sha256').update(result.text,'utf8').digest('hex')!==result.textHash)throw Error('invalid_text');
  if(result.providerCalls!==(result.method==='native_text'?0:1))throw Error('invalid_provider_count');
 }
 return result;
}
