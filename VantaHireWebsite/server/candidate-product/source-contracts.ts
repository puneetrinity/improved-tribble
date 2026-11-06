import {z} from 'zod';
import {parseProfileJson} from './profile-contracts';
import {lookupLinkedinSchema} from '../../shared/candidate-spark-v3';
import {scalarString,candidatePhotoUrlSchema} from '../../shared/candidate-profile';
import {scrubResumeContacts} from './resume-source';
import {createHash} from 'node:crypto';
import {canonicalProfileJson} from './profile-contracts';
import {sourceFactSchema} from '../../shared/candidate-spark-v3';
import {validateLookupTransfer} from './spark-contracts';
export {lookupLinkedinSchema,normalizeLookupLinkedin} from '../../shared/candidate-spark-v3';

export const LOOKUP_DEADLINE_MS=20_000;
export const LOOKUP_RESPONSE_BYTES=2*1024*1024;
// Same canonical handle rule as Discover's normalizeSourcedCandidateLinkedInUrl.
// Pasted http/regional forms are cleaned locally; they are never fetched.
export const lookupOperationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('email'),email:z.string().email().max(320)}).strict(),
 z.object({kind:z.literal('linkedin'),url:lookupLinkedinSchema}).strict(),
]);
export type LookupOperation=z.infer<typeof lookupOperationSchema>;
const text=(max:number)=>z.string().max(max).refine(v=>scalarString(v)&&!v.includes('\0')).nullable().optional();
const dates=z.object({start:text(40),end:text(40)}).nullable().optional();
// Untrusted source evidence, NOT canonical profile facts. Preserve missing/partial
// dates and country-only locations; downstream review must never invent precision.
const person=z.object({linkedinUrl:lookupOperationSchema.options[1].shape.url,
 photoUrl:candidatePhotoUrlSchema.optional(),
 firstName:text(200),lastName:text(200),headline:text(1000),summary:text(20_000),
 location:z.object({city:text(200),country:text(200),countryCode:text(2),rawLocation:text(500)}).nullable().optional(),
 currentPositionTitle:text(300),currentCompanyName:text(300),
 experience:z.array(z.object({title:text(300),companyName:text(300),description:text(20_000),startEndDate:dates})).max(200).optional(),
 education:z.array(z.object({schoolName:text(300),degreeName:text(300),fieldOfStudy:text(300),description:text(10_000),startEndDate:dates})).max(50).optional(),
 skills:z.array(z.string().trim().min(1).max(200).refine(v=>scalarString(v)&&!v.includes('\0'))).max(300).optional(),
});
export type LookupPerson=z.infer<typeof person>;
export interface LookupProposalContext {
 commandId:string;subjectId:string;bindingId:string;sourceId:string;sourceVersion:number;consentRevision:number;
 originalDraftVersion:number;originalProfileVersion:number;originalPreferenceVersion:number;originalPreferenceDraftRevision:number;
 expiresAt:string;
}
/** Pure conversion of an already-paid, sanitized journal result. No AI, provider,
 * profile writes or clock reads. Caller persists this exact output before delivery.
 * Evidence is explicitly normalized RC fact JSON, never presented as résumé text. */
export function buildLookupTransfer(input:unknown,context:LookupProposalContext){
 const result=lookupResultSchema.parse(input);
 if(!result.person||result.outcome==='not_found')throw Error('lookup_has_no_profile');
 const hash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
 const id=(label:string)=>{const s=hash(`${context.sourceId}:${context.sourceVersion}:${label}`);return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-8${s.slice(17,20)}-${s.slice(20,32)}`;};
 // Re-scrub recognizable contact text even when invoked on a stored result.
 const {profile:p}=cleanPerson(result.person);
 const facts:z.infer<typeof sourceFactSchema>[]=[];const notes=new Set<string>();
 let quoteBytes=0;
 const add=(kind:string,value:unknown)=>{
  const index=facts.length,sourceId=context.sourceId;
  let parsed=sourceFactSchema.safeParse({factId:id(`fact:${index}`),kind,targetRowId:null,value,
   evidence:[{sourceId,sourceVersion:context.sourceVersion,contentHash:'0'.repeat(64),locator:'text:0:1',quote:'x'}]});
  if(!parsed.success&&['employment','education'].includes(kind)&&value&&typeof value==='object'&&'description' in value){
   parsed=sourceFactSchema.safeParse({factId:id(`fact:${index}`),kind,targetRowId:null,value:{...value,description:''},
    evidence:[{sourceId,sourceVersion:context.sourceVersion,contentHash:'0'.repeat(64),locator:'text:0:1',quote:'x'}]});
   if(parsed.success)notes.add('Some long descriptions were omitted; please review your job and education details.');
  }
  if(!parsed.success){notes.add('Some unsupported profile details need manual review.');return;}
  let quote=canonicalProfileJson({kind,value:parsed.data.value});
  if(quote.length>2048&&['employment','education'].includes(kind)){
   parsed=sourceFactSchema.safeParse({...parsed.data,value:{...(parsed.data.value as object),description:''}});
   if(!parsed.success)return;
   quote=canonicalProfileJson({kind,value:parsed.data.value});notes.add('Some long descriptions were omitted; please review your job and education details.');
  }
  if(quote.length>2048||quoteBytes+Buffer.byteLength(quote)>65536||facts.length>=400){notes.add('Some profile details exceeded review limits and were omitted.');return;}
  if(facts.some(f=>canonicalProfileJson({kind:f.kind,value:f.value})===quote))return;
  quoteBytes+=Buffer.byteLength(quote);facts.push({...parsed.data,evidence:[{...parsed.data.evidence[0]!,quote}]});
 };
 const name=[p.firstName,p.lastName].filter(Boolean).join(' ');if(name)add('displayName',name);
 if(p.headline)add('headline',p.headline);
 add('linkedinUrl',p.linkedinUrl);
 if(p.photoUrl)add('photo',{url:p.photoUrl});
 if(p.location?.city&&p.location.countryCode&&p.location.country)
  add('currentLocation',{city:p.location.city,countryCode:p.location.countryCode.toUpperCase(),displayCountry:p.location.country});
 const seenSkills=new Set<string>();
 for(const skill of p.skills??[]){const key=skill.toLowerCase().replace(/\s+/gu,' ');if(!seenSkills.has(key)){
  if(seenSkills.size>=200){notes.add('Additional skills exceeded the profile limit and were omitted.');break;}
  seenSkills.add(key);add('skill',skill);
 }}
 const date=(value:string|null|undefined)=>{
  if(!value||/^(present|current)$/i.test(value.trim()))return null;
  let v=value.trim();
  // RC sends LinkedIn month-granular dates as ISO date-times (e.g. 2021-06-01T00:00:00.000Z).
  // Keep only the year and month; the day is a placeholder, not real precision.
  const iso=/^(\d{4}-\d{2})-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(v);
  if(iso)v=iso[1]!;
  const precision=/^\d{4}$/.test(v)?'year':/^\d{4}-\d{2}$/.test(v)?'month':/^\d{4}-\d{2}-\d{2}$/.test(v)?'day':null;
  if(!precision){notes.add('Some dates were not precise enough to import; please enter them yourself.');return null;}
  return {value:v,precision};
 };
 // A job is current when its end says present/current, or RC returns end:null for a job with a known start.
 const isCurrent=(d:{start?:string|null|undefined;end?:string|null|undefined}|null|undefined)=>
  /^(present|current)$/i.test(d?.end?.trim()??'')||(!!d&&d.end===null&&!!d.start?.trim());
 for(const [i,r] of (p.experience??[]).entries())add('employment',{id:id(`employment:${i}`),employer:r.companyName,title:r.title,
  description:r.description??'',start:date(r.startEndDate?.start),end:date(r.startEndDate?.end),current:isCurrent(r.startEndDate)});
 for(const [i,r] of (p.education??[]).entries())add('education',{id:id(`education:${i}`),institution:r.schoolName,
  qualification:[r.degreeName,r.fieldOfStudy].filter(Boolean).join(' — '),description:r.description??'',
  start:date(r.startEndDate?.start),end:date(r.startEndDate?.end),current:/^(present|current)$/i.test(r.startEndDate?.end?.trim()??'')});
 if(result.partial)notes.add('The returned profile was incomplete. Please check every suggestion.');
 if(result.alternativeCount)notes.add('The lookup was ambiguous. Confirm this is your profile before accepting any suggestions.');
 const text=canonicalProfileJson(facts.map(f=>({kind:f.kind,value:f.value}))),contentHash=hash(text);
 for(const f of facts){const e=f.evidence[0]!;e.contentHash=contentHash;e.locator=`text:${text.indexOf(e.quote)}:${e.quote.length}`;}
 const {commandId,subjectId,bindingId,consentRevision,...proposalContext}=context;
 const body={schemaVersion:1,...proposalContext,proposalId:id('proposal'),sourceKind:'professional_lookup',facts,reviewNotes:[...notes]};
 return validateLookupTransfer({schemaVersion:1,commandId,subjectId,bindingId,sourceId:context.sourceId,sourceVersion:context.sourceVersion,
  consentRevision,contentHash,textHash:contentHash,policyVersion:'rc-profile-v1',text,
  proposal:{...body,proposalHash:hash(canonicalProfileJson(body))}});
}
export type LookupResult={outcome:'matched'|'ambiguous'|'partial'|'not_found';creditsConsumed:number;
 person:LookupPerson|null;alternativeCount:number;partial:boolean};
export const lookupResultSchema=z.object({outcome:z.enum(['matched','ambiguous','partial','not_found']),
 creditsConsumed:z.number().int().nonnegative().safe(),person:person.nullable(),
 alternativeCount:z.number().int().min(0).max(9),partial:z.boolean()}).strict().superRefine((v,ctx)=>{
 const valid=v.outcome==='not_found'?v.person===null&&v.creditsConsumed===0&&v.alternativeCount===0&&!v.partial:
  v.person!==null&&(v.outcome==='ambiguous')===(v.alternativeCount>0)&&
  (v.outcome!=='matched'||!v.partial)&&(v.outcome!=='partial'||v.partial);
 if(!valid)ctx.addIssue({code:'custom',message:'invalid_lookup_result'});
});
function unwrap(schema:z.ZodTypeAny):z.ZodTypeAny{
 while(schema instanceof z.ZodOptional||schema instanceof z.ZodNullable)schema=schema.unwrap();return schema;
}
// Identity is strict. Non-authoritative facts are salvageable independently.
function cleanPerson(value:unknown):{profile:LookupPerson;dropped:boolean}{
 const raw=z.record(z.unknown()).parse(value);
 const identity=lookupLinkedinSchema.parse(raw.linkedinUrl);let dropped=false;
 const clean=(schema:z.ZodTypeAny,input:unknown):unknown=>{
  if(typeof input==='string'){const scrubbed=scrubResumeContacts(input);if(scrubbed!==input){dropped=true;input=scrubbed;}}
  const base=unwrap(schema);
  if(base instanceof z.ZodArray&&Array.isArray(input)){
   const maximum=base._def.maxLength?.value??300;
   if(input.length>maximum)dropped=true;
   const items:unknown[]=[];
   for(const item of input.slice(0,maximum)){
    const fixed=clean(base.element,item);
    if(fixed!==undefined)items.push(fixed);else dropped=true;
   }
   return items;
  }
  if(base instanceof z.ZodObject&&input!==null&&typeof input==='object'&&!Array.isArray(input)){
   const out:Record<string,unknown>={};
   for(const [key,child]of Object.entries(base.shape)){
    const item=(input as Record<string,unknown>)[key];
    if(item!==undefined){const fixed=clean(child as z.ZodTypeAny,item);if(fixed!==undefined)out[key]=fixed;}
   }
   if(Object.keys(out).length===0){dropped=true;return undefined;}return out;
  }
  const parsed=schema.safeParse(input);if(parsed.success)return parsed.data;
  dropped=true;return undefined;
 };
 const kept:Record<string,unknown>={linkedinUrl:identity};
 for(const [key,schema]of Object.entries(person.shape))if(key!=='linkedinUrl'&&raw[key]!==undefined){
  if(key==='photoUrl'){
   const parsed=candidatePhotoUrlSchema.safeParse(raw[key]);
   if(parsed.success)kept[key]=parsed.data;else dropped=true;
   continue;
  }
  const fixed=clean(schema,raw[key]);if(fixed!==undefined)kept[key]=fixed;
 }
 return {profile:person.parse(kept),dropped};
}
export class LookupError extends Error {
 constructor(public readonly code:'invalid_request'|'invalid_configuration'|'deadline'|'outcome_unknown'|'invalid_response'|'credits_breach'|'identity_mismatch',
  public readonly dispatched:boolean,public readonly observedCredits:number|null=null){super(code);}
}
export function parseLookupResponse(raw:string,status:number,operation:LookupOperation):LookupResult{
 let credits:number|null=null;
 try{
  operation=lookupOperationSchema.parse(operation);
  const envelope=z.object({success:z.boolean(),error:z.unknown(),data:z.unknown(),quotas:z.object({creditsConsumed:z.number().int().nonnegative().safe()})}).parse(parseProfileJson(raw,LOOKUP_RESPONSE_BYTES));
  credits=envelope.quotas.creditsConsumed;
  if(credits>(operation.kind==='email'?2:1))throw new LookupError('credits_breach',true,credits);
  if(status===404&&envelope.success===false&&envelope.error==='REQUEST_ERROR'&&envelope.data===null&&credits===0)
   return {outcome:'not_found',creditsConsumed:0,person:null,alternativeCount:0,partial:false};
  if(status!==200||!envelope.success||envelope.error!==null)throw new LookupError('invalid_response',true,credits);
  const data=operation.kind==='email'?z.object({person:z.record(z.unknown()),isFullProfile:z.boolean(),alternativePersons:z.array(z.unknown()).max(9)}).parse(envelope.data):null;
  const {profile,dropped}=cleanPerson(data?.person??envelope.data);
  if(operation.kind==='linkedin'&&profile.linkedinUrl!==operation.url)throw new LookupError('identity_mismatch',true,credits);
  const alternatives=data?.alternativePersons.length??0;
  // Do not retain other people's profiles or interpret absence as confidence.
  const partial=dropped||data?.isFullProfile===false||profile.experience===undefined||profile.education===undefined||profile.skills===undefined;
  return {outcome:alternatives?'ambiguous':partial?'partial':'matched',creditsConsumed:credits,person:profile,alternativeCount:alternatives,partial};
 }catch(e){if(e instanceof LookupError)throw e;throw new LookupError('invalid_response',true,credits);}
}
