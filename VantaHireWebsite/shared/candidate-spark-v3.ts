// Browser-safe Spark wire schemas. The server retains raw JSON, byte-limit and hash checks.
import {z} from 'zod';
import {manualProfileSchema,preferencesSchema,profileUuid as uuid,profileHash as hash,profileRevision as revision,scalarString,COUNTRY_CODES} from './candidate-profile';
// Browser capture is deliberately distinct from the signed service projection.
// Identity and the five disclosed purposes are resolved by Flow, never supplied
// by the browser. Withdrawal does not require accepting or possessing a copy.
const consentCaptureEnvelope={schemaVersion:z.literal(2),idempotencyKey:uuid,
 expectedConsentRevision:revision.refine(v=>v<Number.MAX_SAFE_INTEGER)};
export const consentCaptureSchema=z.discriminatedUnion('action',[
 z.object({...consentCaptureEnvelope,action:z.literal('grant'),
  copyVersion:z.number().int().min(1).max(2147483647),copyHash:hash}).strict(),
 z.object({...consentCaptureEnvelope,action:z.literal('withdraw')}).strict(),
]);
// Registration records the exact copy accepted, not an effective network grant.
// The server activates it only after email verification and foundation linking.
export const signupConsentIntentSchema=z.object({schemaVersion:z.literal(2),idempotencyKey:uuid,
 accepted:z.literal(true),copyVersion:z.number().int().min(1).max(2147483647),copyHash:hash}).strict();
export const signupConsentActivationSchema=z.object({schemaVersion:z.literal(2)}).strict();

const strict=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict();
// Professional self-lookup only: the browser never supplies an email address.
export function normalizeLookupLinkedin(value:string):string{
 const input=value.trim();if(input.length>2048)throw Error('invalid_linkedin');
 const url=new URL(input.includes('://')?input:`https://${input}`);
 const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
  (url.port&&!['80','443'].includes(url.port))||
  !(host==='linkedin.com'||host==='www.linkedin.com'||/^[a-z]{2,3}\.linkedin\.com$/.test(host))||
  !['in','pub'].includes(parts[0]??''))throw Error('invalid_linkedin');
 const handle=parts[1]?.toLowerCase();
 if(!handle||!/^[a-z0-9][a-z0-9._-]{0,199}$/.test(handle))throw Error('invalid_linkedin');
 return `https://linkedin.com/in/${handle}`;
}
export const lookupLinkedinSchema=z.string().transform((value,ctx)=>{
 try{return normalizeLookupLinkedin(value);}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'invalid_linkedin'});return z.NEVER;}
});
export const lookupRequestSchema=z.discriminatedUnion('kind',[
 strict({schemaVersion:z.literal(1),idempotencyKey:uuid,expectedConsentRevision:revision,kind:z.literal('email')}),
 strict({schemaVersion:z.literal(1),idempotencyKey:uuid,expectedConsentRevision:revision,kind:z.literal('linkedin'),url:lookupLinkedinSchema}),
]);
export const lookupStatusSchema=strict({schemaVersion:z.literal(1),attemptId:uuid,
 state:z.enum(['queued','running','transferring','review_ready','not_found','held','rejected']),
 reason:z.enum(['outcome_unknown','consent_changed','privacy_restricted','budget_unavailable','definite_failure','authentication_changed','account_changed','invalid_dispatch_grant','budget_window_closed','disabled_before_call','source_conflict','stale_edit','proposal_expired','not_me','delivery_refused','retry_exhausted']).nullable(),
 proposalId:uuid.nullable(),canRequestLinkedin:z.boolean(),waitLimitMs:z.literal(20000)})
 .refine(v=>(v.state==='review_ready')===(v.proposalId!==null)&&
  !(['queued','running','transferring','held'].includes(v.state)&&v.canRequestLinkedin));
// One explicit processing retry for OCR or AI; distinct from delivery replay.
export const resumeSourceRetryRequestSchema=strict({schemaVersion:z.literal(1),idempotencyKey:uuid,retryOfCommandId:uuid});
export const resumeSourceRetryStatusSchema=strict({schemaVersion:z.literal(1),commandId:uuid,
 attemptsUsed:z.number().int().min(0).max(3),maxAttempts:z.literal(3),canRetry:z.boolean(),canContinueWithoutResume:z.literal(true),
 reason:z.enum(['attempt_limit','not_retryable']).nullable(),message:z.string().nullable()})
 .refine(v=>v.canRetry===(v.reason===null)&&(!v.canRetry||v.attemptsUsed<3));
const variants=(values:z.ZodTypeAny[]):[z.ZodTypeAny,z.ZodTypeAny,...z.ZodTypeAny[]]=>{
 if(values.length<2)throw Error('invalid_schema');
 return [values[0]!,values[1]!,...values.slice(2)];
};
const text=(max:number,min=0)=>z.string().refine(scalarString).transform(v=>v.normalize('NFC').trim()).refine(v=>Array.from(v).length>=min&&Array.from(v).length<=max);
const country=z.string().refine(v=>COUNTRY_CODES.has(v));
const distinct=<T extends z.ZodTypeAny>(s:T,max:number,min=0)=>z.array(s).min(min).max(max).refine(v=>new Set(v.map(x=>JSON.stringify(x))).size===v.length);
// Reuse strict v2 field validators, but do not supply or persist their defaults.
const old=preferencesSchema.innerType().shape;
const sections={
 roles:strict({desiredRoles:old.desiredRoles,preferredSeniority:old.preferredSeniority}),
 location:old.locations,
 arrangement:strict({workArrangements:old.workArrangements,remoteRegions:old.remoteRegions}).refine(v=>!v.workArrangements.includes('remote')||v.remoteRegions!==null),
 relocation:old.relocation,
 employment_types:distinct(z.enum(['permanent','contract','gig_freelance','part_time','internship']),5,1),
 availability:old.availability,
 compensation:old.compensation,
 authorisation:z.array(strict({countryCode:country,status:z.enum(['allowed','needs_visa','not_sure'])})).max(249).refine(v=>new Set(v.map(x=>x.countryCode)).size===v.length),
 private_notes:distinct(text(2000,1),20),
};
export const preferenceSectionSchema=z.union(variants(Object.entries(sections).flatMap(([section,value])=>[
 strict({section:z.literal(section),answered:z.literal(true),value}),
 strict({section:z.literal(section),answered:z.literal(false),value:z.null()}),
])));
const envelope={schemaVersion:z.literal(3),idempotencyKey:uuid,expectedDraftVersion:revision,expectedProfileVersion:revision,expectedPreferenceVersion:revision,expectedPreferenceDraftRevision:revision};
const selection=distinct(uuid,400);
const proposal=strict({proposalId:uuid,proposalHash:hash});
const facts=manualProfileSchema.shape;
const correctionValues={displayName:facts.displayName,headline:facts.headline,linkedinUrl:facts.linkedinUrl,currentLocation:facts.currentLocation,
 skill:text(100,1),employment:facts.employment.innerType().element,education:facts.education.innerType().element,project:facts.projects.innerType().element};
const correction=z.union(variants(Object.entries(correctionValues).map(([kind,value])=>strict({factId:uuid,kind:z.literal(kind),value}))));
const source=strict({proposalId:uuid,sourceVersion:revision,proposalHash:hash,selectedFactIds:selection,replaceFactIds:selection,corrections:z.array(correction).max(400)})
 .refine(v=>v.selectedFactIds.length>0&&v.replaceFactIds.every(id=>v.selectedFactIds.includes(id))
 &&new Set(v.corrections.map(c=>c.factId)).size===v.corrections.length&&v.corrections.every(c=>v.selectedFactIds.includes(c.factId)));
// Repository also checks kind and target row against the stored owned fact.
// Corrections and provenance are applied atomically, never as a second UI save.
export const commandSchema=z.discriminatedUnion('action',[
 strict({...envelope,action:z.literal('save_draft'),payload:strict({profile:manualProfileSchema})}),
 strict({...envelope,action:z.literal('save_preference_section'),payload:preferenceSectionSchema}),
 strict({...envelope,action:z.literal('accept_source'),payload:source}),
 strict({...envelope,action:z.literal('reject_source'),payload:strict({proposalId:uuid,sourceVersion:revision,proposalHash:hash,reason:z.enum(['not_me','incorrect','not_needed'])})}),
 strict({...envelope,action:z.literal('accept_interpretation'),payload:proposal}),
 strict({...envelope,action:z.literal('accept_exclusions'),payload:proposal}),
 strict({...envelope,action:z.literal('remove_exclusion'),payload:strict({restrictionId:uuid})}),
 strict({...envelope,action:z.literal('promote_preferences'),payload:strict({preferenceDraftHash:hash})}),
 strict({...envelope,action:z.literal('confirm'),payload:strict({draftHash:hash,preferenceDraftHash:hash,consentRevision:revision})}),
 strict({...envelope,action:z.literal('request_source'),payload:z.discriminatedUnion('kind',[
  strict({kind:z.literal('resume'),sourceId:uuid,sourceVersion:revision}),
  strict({kind:z.literal('professional_lookup'),attemptId:uuid}),
 ])}),
]);


export const receiptSchema=strict({schemaVersion:z.literal(3),commandId:uuid,subjectId:uuid,bindingId:uuid,commandHash:hash,
 status:z.enum(['applied','rejected']),reason:z.enum(['stale_edit','confirmation_conflict','incomplete_preferences','incomplete_profile','legacy_preferences_review_required','candidate_privacy_restricted','command_expired','consent_required','consent_changed','source_conflict','proposal_expired','exclusion_limit']).nullable(),
 changed:z.boolean(),draftVersion:revision,profileVersion:revision,preferenceVersion:revision,preferenceDraftRevision:revision,
 preferenceDraftHash:hash.nullable(),publicationActive:z.literal(false),
}).refine(v=>(v.status==='applied')===(v.reason===null)&&(v.status!=='rejected'||!v.changed));

export const preferenceSectionsSchema=z.record(z.unknown()).superRefine((value,ctx)=>{
 for(const [section,answer] of Object.entries(value)) {
  if(!answer||typeof answer!=='object'||Array.isArray(answer)||!preferenceSectionSchema.safeParse({...answer,section}).success
   ||Object.keys(answer).sort().join('|')!=='answered|value')ctx.addIssue({code:z.ZodIssueCode.custom,message:'invalid_section',path:[section]});
 }
}).transform(value=>Object.fromEntries(Object.entries(value).map(([section,answer])=>{
 const parsed=preferenceSectionSchema.parse({...answer as object,section});
 return [section,{answered:parsed.answered,value:parsed.value}];
})));
export const exclusionSchema=z.discriminatedUnion('kind',[
 strict({id:uuid,kind:z.literal('remote_only')}),
 strict({id:uuid,kind:z.literal('no_travel')}),
 strict({id:uuid,kind:z.literal('exclude_company'),companyId:uuid}),
]);
export const exclusionsSchema=z.array(exclusionSchema).max(20).refine(v=>
 new Set(v.map(r=>r.id)).size===v.length&&
 new Set(v.map(r=>r.kind+('companyId' in r?':'+r.companyId:''))).size===v.length);
const preferenceDraft=strict({preferenceDraftRevision:revision,preferenceDraftHash:hash,sections:preferenceSectionsSchema,exclusions:exclusionsSchema,
 promotedPreferenceVersion:revision.nullable(),promotedDraftRevision:revision.nullable()})
 .refine(v=>(v.promotedPreferenceVersion===null)===(v.promotedDraftRevision===null)
 &&(v.promotedDraftRevision===null||v.promotedDraftRevision<=v.preferenceDraftRevision));
const effectivePreferences=z.union([preferencesSchema,strict({schemaVersion:z.literal(3),sections:preferenceSectionsSchema,exclusions:exclusionsSchema})]);
// Memory storage DTO, not yet the enriched Flow/UI read model. In particular no
// invented consent revision or pending-command list is returned by this reader.
export const storageReadSchema=strict({schemaVersion:z.literal(3),draftVersion:revision,profileVersion:revision,preferenceVersion:revision,
 draft:manualProfileSchema.nullable(),confirmedProfile:manualProfileSchema.nullable(),preferences:effectivePreferences.nullable(),
 preferenceDraft:preferenceDraft.nullable(),publicationActive:z.literal(false),
 sources:z.array(strict({sourceId:uuid,sourceVersion:revision})).max(50).default([]),
 proposals:z.array(strict({proposalId:uuid,proposalHash:hash,kind:z.enum(['source','interpretation']),
  sourceId:uuid.nullable(),sourceVersion:revision.nullable(),expiresAt:z.string().datetime()})).max(50).default([]),
 hasMoreSources:z.boolean().default(false),hasMoreProposals:z.boolean().default(false)});


export const bundledPurposes=['job_matching','profile_enrichment','ai_processing','talent_network_discovery','recruiter_contact'] as const;
const consentBase={schemaVersion:z.literal(2),subjectId:uuid,bindingId:uuid,eventId:uuid,version:revision.refine(v=>v>0)};
// Service-to-service projection only. NOT the public consent/signup request.
// Public handlers bind actor and verified email through the existing Flow ledger;
// no browser can supply these subject/binding/event/version authority fields.
export const consentProjectionSchema=z.discriminatedUnion('action',[
 strict({...consentBase,action:z.literal('grant'),copyVersion:revision.refine(v=>v>0&&v<=2147483647),copyHash:hash,
  purposes:z.tuple(bundledPurposes.map(p=>z.literal(p)) as [z.ZodLiteral<typeof bundledPurposes[number]>,...z.ZodLiteral<typeof bundledPurposes[number]>[]])
   .refine(v=>JSON.stringify(v)===JSON.stringify(bundledPurposes))}),
 strict({...consentBase,action:z.literal('withdraw'),copyVersion:z.null(),copyHash:z.null(),purposes:z.array(z.never()).length(0)}),
]);

export const admissionSchema=z.object({schemaVersion:z.union([z.literal(2),z.literal(3)]),commandId:uuid,status:z.enum(['pending','applied','rejected','held'])}).strict();
export const actions=z.enum(['save_draft','save_preferences','confirm','save_preference_section','promote_preferences','accept_exclusions','remove_exclusion','accept_source','reject_source','accept_interpretation']);
export const reasons=z.enum(['authority_unavailable','memory_unavailable','delivery_outcome_unknown','stale_edit','confirmation_conflict','incomplete_profile',
 'source_conflict','source_not_found','source_version_conflict','source_removed','consent_required','consent_changed','candidate_privacy_restricted',
 'identity_conflict','idempotency_conflict','invalid_request','payload_too_large','authentication_changed','retry_exhausted','command_expired','expiry_reconciling',
 'incomplete_preferences','legacy_preferences_review_required','proposal_expired','exclusion_limit','recovery_review_required']);
export const commandReadSchema=admissionSchema.extend({action:actions,reason:reasons.nullable(),
 draftVersion:revision.optional(),profileVersion:revision.optional(),preferenceVersion:revision.optional(),
 preferenceDraftRevision:revision.optional(),preferenceDraftHash:hash.nullable().optional()}).strict();
export const ownerSchema=z.object({subjectId:uuid,bindingId:uuid,pendingCommands:z.array(z.object({commandId:uuid,
 action:actions,schemaVersion:z.literal(3).optional(),status:z.enum(['pending','held']),reason:reasons.nullable()}).strict()).max(5),hasMorePendingCommands:z.boolean()}).strict();

export const captureReceipt=z.object({schemaVersion:z.literal(2),eventId:uuid,consentRevision:revision,
 status:z.literal('recorded'),replayed:z.boolean()}).strict();
export const signupConsentActivationReceipt=z.object({schemaVersion:z.literal(2),
 status:z.enum(['activated','none','expired','superseded']),receipt:captureReceipt.nullable()}).strict()
 .refine(v=>(v.status==='activated')===(v.receipt!==null));
export const ownerConsent=z.object({schemaVersion:z.literal(2),consentRevision:revision,
 desiredAction:z.enum(['grant','withdraw']).nullable(),acknowledgedRevision:revision,
 acknowledgedAction:z.enum(['grant','withdraw']).nullable(),
 desiredSchemaVersion:z.union([z.literal(1),z.literal(2)]).nullable(),
 acknowledgedSchemaVersion:z.union([z.literal(1),z.literal(2)]).nullable(),
 deliveryStatus:z.enum(['none','pending','delivered','failed','privacy_restricted','identity_review_required'])}).strict();

export const pendingCommandSchema=ownerSchema.shape.pendingCommands.element;
export type SparkCommand=z.infer<typeof commandSchema>;
export type SparkCommandAdmission=z.infer<typeof admissionSchema>;
export type SparkCommandStatus=z.infer<typeof commandReadSchema>;
export type SparkPendingCommand=z.infer<typeof pendingCommandSchema>;
export type SparkStorageRead=z.infer<typeof storageReadSchema>;
export type SparkConsentRequest=z.infer<typeof consentCaptureSchema>;
export type SparkConsentReceipt=z.infer<typeof captureReceipt>;
export type SparkConsentStatus=z.infer<typeof ownerConsent>;
// Resolution identifies an existing save; it never carries a replacement body,
// paid-provider attempt, candidate identity or client-assigned terminal status.
// expectedResolutionRevision fences a stale tab; duplicate request keys must
// return their original resolution receipt, not restart a retry allowance.
export const saveResolutionRequestSchema=z.object({schemaVersion:z.literal(1),idempotencyKey:uuid,
 expectedResolutionRevision:revision.refine(v=>v<Number.MAX_SAFE_INTEGER),action:z.enum(['retry','discard'])}).strict();
export const saveResolutionViewSchema=z.object({schemaVersion:z.literal(1),commandId:uuid,
 commandSchemaVersion:z.union([z.literal(2),z.literal(3)]),resolutionRevision:revision,
 state:z.enum(['none','retry_queued','resolving','applied','rejected','discarded','operator_review']),
 reason:z.enum(['retry_available','outcome_unknown','authentication_required','privacy_restricted','identity_conflict',
  'invalid_command','recovery_exhausted','already_applied','remote_rejected','discard_acknowledged']).nullable(),
 canRetry:z.boolean(),canDiscard:z.boolean(),blocksConfirmation:z.boolean(),
}).superRefine((v,ctx)=>{
 const terminal=['applied','rejected','discarded'].includes(v.state);
 if((terminal&&(v.canRetry||v.canDiscard||v.blocksConfirmation))
  ||(['retry_queued','resolving','operator_review'].includes(v.state)&&(!v.blocksConfirmation||v.canRetry||v.canDiscard))
  ||(v.state==='discarded'&&v.reason!=='discard_acknowledged')
  ||(v.state==='applied'&&v.reason!=='already_applied')
  ||(v.state==='none'&&!v.blocksConfirmation))ctx.addIssue({code:z.ZodIssueCode.custom,message:'invalid_resolution_state'});
});
export type SaveResolutionRequest=z.infer<typeof saveResolutionRequestSchema>;
export type SaveResolutionView=z.infer<typeof saveResolutionViewSchema>;
// Resolution endpoints stay feature-gated. The UI follows server canRetry /
// canDiscard and polls until reconciliation acknowledges a terminal outcome.
// receiptSchema is a service-to-service receipt, not the browser command-status DTO.
// Schema validity does not enable an action: routes/repositories still gate the
// five currently implemented v3 actions, ownership and current consent.

// Frozen P2 source-transfer shapes promoted into the shared product contract.
// These are service inputs, not permission to admit browser source writes.
const sourceText=(max:number,min=0)=>z.string().min(min).max(max).refine(v=>scalarString(v)&&!v.includes('\u0000'));
const sourceRef=z.object({sourceId:uuid,sourceVersion:revision,contentHash:hash,
 locator:sourceText(200,1),quote:sourceText(2048,1)}).strict();
const sourceValues={displayName:facts.displayName,headline:facts.headline,linkedinUrl:facts.linkedinUrl,
 photo:z.object({url:facts.photoUrl.unwrap().unwrap()}).strict(),
 currentLocation:facts.currentLocation,skill:sourceText(100,1),employment:facts.employment.innerType().element,
 education:facts.education.innerType().element,project:facts.projects.innerType().element};
export const sourceFactSchema=z.union(variants(Object.entries(sourceValues).map(([kind,value])=>
 z.object({factId:uuid,kind:z.literal(kind),targetRowId:uuid.nullable(),value,
 evidence:z.array(sourceRef).min(1).max(8)}).strict()))).superRefine((v,ctx)=>{
 if(v.targetRowId!==null&&!['employment','education','project'].includes(v.kind))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'invalid_target_row'});
});
export const sourceProposalSchema=z.object({schemaVersion:z.literal(1),proposalId:uuid,
 sourceId:uuid,sourceVersion:revision,proposalHash:hash,originalDraftVersion:revision,
 originalProfileVersion:revision,originalPreferenceVersion:revision,originalPreferenceDraftRevision:revision,
 sourceKind:z.enum(['professional_lookup','resume','legacy_flow_profile']),
 facts:z.array(sourceFactSchema).max(400),reviewNotes:z.array(sourceText(2000,1)).max(20),
 expiresAt:z.string().datetime(),
}).strict().refine(v=>new Set(v.facts.map(f=>f.factId)).size===v.facts.length)
 .refine(v=>v.facts.reduce((n,f)=>n+f.evidence.reduce((m:number,e:{quote:string})=>m+new TextEncoder().encode(e.quote).length,0),0)<=65536,'evidence_too_large');
export const resumeTransferSchema=z.object({schemaVersion:z.literal(1),commandId:uuid,subjectId:uuid,bindingId:uuid,
 sourceId:uuid,sourceVersion:revision,contentHash:hash,textHash:hash,policyVersion:sourceText(80,1),
 consentRevision:revision.refine(v=>v>0),text:sourceText(512*1024,1),proposal:sourceProposalSchema}).strict();
// Lookup text is canonical JSON of normalized professional facts, not a résumé
// or raw vendor response. This discriminator is also enforced at the receiver.
export const lookupTransferSchema=resumeTransferSchema.extend({policyVersion:z.literal('rc-profile-v1')})
 .refine(v=>v.proposal.sourceKind==='professional_lookup','source_mismatch');
export const sourceReceiptSchema=z.object({schemaVersion:z.literal(1),commandId:uuid,subjectId:uuid,bindingId:uuid,
 commandHash:hash,sourceId:uuid,sourceVersion:revision,proposalId:uuid,proposalHash:hash,
 outcome:z.enum(['stored','rejected']),reason:z.enum(['consent_changed','source_conflict','stale_edit','proposal_expired']).nullable(),
 canonicalProfileChanged:z.literal(false),publicationActive:z.literal(false),
}).strict().refine(v=>(v.outcome==='stored')===(v.reason===null));

// P6 browser-safe request and review shapes. Validation is not authorization:
// source ownership, current versions and permitted changes are checked server-side.
export const interpretationVersions={expectedDraftVersion:revision,expectedProfileVersion:revision,
 expectedPreferenceVersion:revision,expectedPreferenceDraftRevision:revision};
export const interpretationRequestSchema=z.object({schemaVersion:z.literal(1),idempotencyKey:uuid,...interpretationVersions,
 use:z.enum(['source_correction','private_exclusions','change_preferences']),text:sourceText(8000,1),
 sourceProposalId:uuid.nullable(),sourceVersion:revision.nullable(),targetRowId:uuid.nullable(),
}).strict().refine(v=>v.use==='source_correction'
 ?v.sourceProposalId!==null&&v.sourceVersion!==null
 :v.sourceProposalId===null&&v.sourceVersion===null&&v.targetRowId===null,'invalid_target');
const interpretationRestriction=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('remote_only')}).strict(),z.object({kind:z.literal('no_travel')}).strict(),
 z.object({kind:z.literal('exclude_company'),companyId:uuid}).strict(),
]);
export const exclusionPreviewRequestSchema=z.object({idempotencyKey:uuid,expectedPreferenceDraftRevision:revision,
 restrictions:z.array(interpretationRestriction).min(1).max(20),
}).strict().refine(v=>new Set(v.restrictions.map(r=>r.kind+('companyId' in r?':'+r.companyId:''))).size===v.restrictions.length);
export const exclusionEffects={remote_only:'Exclude jobs explicitly requiring on-site or hybrid work.',
 no_travel:'Exclude jobs explicitly requiring travel.',
 exclude_company:'Exclude jobs from the resolved company. This does not hide your profile from its recruiters.'} as const;
export const exclusionPreviewSchema=z.object({proposalId:uuid,proposalHash:hash,expectedPreferenceDraftRevision:revision,
 restrictions:exclusionsSchema.refine(v=>v.length>0),effects:z.array(z.object({restrictionId:uuid,text:z.string()}).strict()).max(20),
 companies:z.array(z.object({companyId:uuid,displayName:z.string().min(1).max(200),domain:z.string().min(1).max(253),identityRevision:revision}).strict()).max(20),
 unknownPolicy:z.literal('show_with_warning'),expiresAt:z.string().datetime(),
}).strict().refine(v=>v.effects.length===v.restrictions.length&&v.effects.every((e,i)=>e.restrictionId===v.restrictions[i]!.id&&e.text===exclusionEffects[v.restrictions[i]!.kind])
 &&new Set(v.companies.map(c=>c.companyId)).size===v.companies.length
 &&v.companies.length===v.restrictions.filter(r=>r.kind==='exclude_company').length
 &&v.restrictions.every(r=>r.kind!=='exclude_company'||v.companies.some(c=>c.companyId===r.companyId)));
export const interpretationChangeSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('source_correction'),fact:sourceFactSchema.refine(f=>!['displayName','linkedinUrl','photo'].includes(f.kind))}).strict(),
 z.object({kind:z.literal('preference_section'),answer:preferenceSectionSchema.refine(v=>v.section!=='authorisation')}).strict(),
 z.object({kind:z.literal('exclusions'),restrictions:z.array(interpretationRestriction).min(1).max(20)}).strict(),
]);
export const interpretationModelReplySchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('proposal'),summary:sourceText(2000,1),changes:z.array(interpretationChangeSchema).min(1).max(20)}).strict(),
 z.object({status:z.literal('clarify'),question:sourceText(1000,1)}).strict(),
 z.object({status:z.literal('cannot_help'),reason:z.enum(['unsupported','insufficient_evidence','unsafe','budget_unavailable'])}).strict(),
]);
export const interpretationResponseSchema=z.discriminatedUnion('status',[
 interpretationModelReplySchema.options[0].extend({schemaVersion:z.literal(1),proposalId:uuid,proposalHash:hash,
  ...interpretationVersions,expiresAt:z.string().datetime()}),
 interpretationModelReplySchema.options[1].extend({schemaVersion:z.literal(1)}),
 interpretationModelReplySchema.options[2].extend({schemaVersion:z.literal(1)}),
]);

// P6 service transfer contains only the validated review proposal, never the
// candidate's raw prompt or the provider's raw answer. Identity is server-owned.
export const interpretationTransferSchema=z.object({schemaVersion:z.literal(1),commandId:uuid,
 subjectId:uuid,bindingId:uuid,consentRevision:revision.refine(v=>v>0),
 use:z.enum(['source_correction','private_exclusions','change_preferences']),
 sourceProposalId:uuid.nullable(),sourceVersion:revision.nullable(),targetRowId:uuid.nullable(),
 proposal:interpretationResponseSchema.options[0],
}).strict().refine(v=>v.use==='source_correction'
 ?v.sourceProposalId!==null&&v.sourceVersion!==null
 :v.sourceProposalId===null&&v.sourceVersion===null&&v.targetRowId===null,'invalid_target');
export const interpretationReceiptSchema=z.object({schemaVersion:z.literal(1),commandId:uuid,
 subjectId:uuid,bindingId:uuid,commandHash:hash,proposalId:uuid,proposalHash:hash,
 outcome:z.enum(['stored','rejected']),reason:z.enum(['consent_changed','stale_edit','proposal_expired','source_conflict']).nullable(),
}).strict().refine(v=>(v.outcome==='stored')===(v.reason===null));
