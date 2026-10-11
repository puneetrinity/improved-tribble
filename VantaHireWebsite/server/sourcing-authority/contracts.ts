import { z } from 'zod';
import { canonicalJson, sourceHash } from '../job-brief/contracts';

export const SOURCING_PROTOCOL_VERSION = 1;
export const SOURCING_COMPILER_VERSION = '1';
export const SOURCING_WINDOW_ALLOWANCE = 5;
export const MAX_SOURCING_BODY_BYTES = 131_072;
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const revisionSchema = z.number().int().nonnegative().safe();
export const idSchema = z.string().uuid();
export const utcTimeSchema = z.string().datetime({ offset: false });

export function sourcingEnabled(env: NodeJS.ProcessEnv = process.env, worker = false): boolean {
  const value = env.FLOW_SOURCING_V1_ENABLED;
  if (value !== undefined && value !== 'false' && value !== 'true') throw new Error('SOURCING_INVALID_CONFIGURATION');
  if (value === 'true' && worker) throw new Error('SOURCING_WEB_ONLY');
  if (value === 'true' && env.FLOW_JOB_BRIEF_ENABLED !== 'true') throw new Error('SOURCING_BRIEF_REQUIRED');
  return value === 'true';
}

export const sourcingReasonCodes = [
  'skills_gap', 'experience_requirement', 'role_seniority', 'domain',
  'location_work_arrangement', 'compensation', 'availability', 'insufficient_information', 'other',
] as const;

export const sourcingDecisionSchema = z.object({
  requestId: idSchema,
  expectedRevision: revisionSchema,
  action: z.enum(['shortlist', 'pass', 'clear']),
  reasonCode: z.enum(sourcingReasonCodes).optional(),
  criterionId: idSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.criterionId && !value.reasonCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Criterion requires an explicit reason' });
  }
  if (value.action === 'clear' && (value.reasonCode || value.criterionId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Clear records correction, not a candidate assessment' });
  }
});
export type SourcingDecision = z.infer<typeof sourcingDecisionSchema>;

const legacyDeliverySchema=z.object({
  protocolVersion:z.literal(1),flowRunId:idSchema,artifactHash:hashSchema,executionAttemptId:idSchema,
  revision:z.number().int().min(1).max(2147483647),orderedSignalIds:z.array(z.string().min(1).max(256)).max(100),
}).strict();
export const sourcingDeliverySchema=z.discriminatedUnion('protocolVersion',[
  legacyDeliverySchema,
  legacyDeliverySchema.extend({protocolVersion:z.literal(2),rankingRevision:idSchema,rankingHash:hashSchema,contractHash:hashSchema}).strict(),
]).refine(v=>new Set(v.orderedSignalIds).size===v.orderedSignalIds.length,'duplicate delivery identity');
export type SourcingDelivery=z.infer<typeof sourcingDeliverySchema>;
export const sourcingCallbackBindingSchema=z.object({protocolVersion:z.union([z.literal(1),z.literal(2)]),flowRunId:idSchema,artifactHash:hashSchema}).strict();
export function callbackBindingMatches(raw:unknown,binding:{flowRunId:string;artifactHash:string;protocolVersion?:1|2}|null):boolean {
  if(!binding)return raw===undefined;
  const parsed=sourcingCallbackBindingSchema.safeParse(raw);
  return parsed.success&&parsed.data.flowRunId===binding.flowRunId&&parsed.data.artifactHash===binding.artifactHash&&parsed.data.protocolVersion===(binding.protocolVersion??1);
}

export const sourcingAdmissionSchema = z.object({
  requestId: idSchema,
  expectedRevision: revisionSchema,
  briefVersionId: idSchema,
  materialHash: hashSchema,
  artifactId: idSchema,
  expectedPayerSlotId: idSchema,
  // Exact signed PostgreSQL representation, including microseconds and +00:00.
  // The command layer compares it byte-for-byte to the authenticated quote.
  expectedWindowStart: z.string().datetime({ offset: true }),
  quoteToken: z.string().min(1).max(8192),
}).strict();

// Preparation retry uses the existing bounded POST, not another approval route.
export const sourcingPreviewRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refresh'), requestId: idSchema, artifactId: idSchema }).strict(),
  z.object({ action: z.literal('retry_preparation'), requestId: idSchema, briefVersionId: idSchema }).strict(),
]);

export const sourcingGrantRequestSchema = z.object({
  action: z.literal('grant'),
  protocolVersion: z.literal(1),
  flowRunId: idSchema,
  artifactHash: hashSchema,
  discoverRequestId: z.string().min(1).max(200),
  executionAttemptId: idSchema,
  slot: z.enum(['exact', 'spill']),
  rungId: z.string().min(1).max(80),
  providerInput: z.object({
    version: z.literal(1),
    limit: z.number().int().min(1).max(300),
    requirements: z.object({
      title:z.string().max(160).nullable(),topSkills:z.array(z.string().min(1).max(160)).max(12),
      seniorityLevel:z.enum(['entry','mid','senior','lead','executive']),domain:z.string().max(160).nullable(),
      roleFamily:z.string().max(160).nullable(),location:z.string().max(322),
      experienceYears:z.number().min(0).max(80).nullable(),experienceYearsMax:z.null(),education:z.null(),
      titleSearchTerms:z.array(z.string().min(3).max(60)).min(1).max(6),
      adjacentBuckets:z.array(z.array(z.string().min(3).max(60)).max(6)).max(4),
      adjacentLocations:z.array(z.object({metro:z.string().min(1).max(160),country:z.string().min(1).max(160)}).strict()).max(3),
      querySeniorityLevels:z.array(z.enum(['entry','mid','senior','lead','executive'])).min(1).max(3).optional(),
    }).strict(),
    excludePersonIds: z.array(z.number().int().nonnegative().safe()).max(10_000),
  }).strict(),
}).strict();

export const sourcingReceiptSchema=z.object({
  action:z.literal('receipt'),protocolVersion:z.literal(1),flowRunId:idSchema,artifactHash:hashSchema,
  discoverRequestId:z.string().min(1).max(200),executionAttemptId:idSchema,
  grantId:idSchema,slot:z.enum(['exact','spill']),providerInputHash:hashSchema,
  receiptId:z.string().min(1).max(200),state:z.enum(['started','complete','uncertain']),
  rawReturnedCount:z.number().int().min(0).max(300).optional(),
  providerTotal:z.number().int().nonnegative().safe().nullable().optional(),
}).strict().superRefine((v,ctx)=>{
  if(v.state==='complete'?(v.rawReturnedCount===undefined||v.providerTotal===undefined):(v.rawReturnedCount!==undefined||v.providerTotal!==undefined)){
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Receipt evidence does not match state'});
  }
});

export const sourcingNoDispatchSchema=z.object({action:z.literal('no_dispatch'),protocolVersion:z.literal(1),flowRunId:idSchema,artifactHash:hashSchema,
  discoverRequestId:z.string().min(1).max(200),executionAttemptId:idSchema,cancellationId:idSchema,cancelledAt:z.string().datetime({offset:true})}).strict();

/** Strict transport envelope only; the grant handler must compare every input
 * against the sealed artifact and exact receipt, never authorize a hash alone. */
export function parseSourcingBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const encoded = canonicalJson(body);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SOURCING_BODY_BYTES) throw new Error('SOURCING_BODY_TOO_LARGE');
  return schema.parse(body);
}

export function sourcingHash(value: unknown): string { return sourceHash(canonicalJson(value)); }

/** Calendar-anniversary window, not 30-day arithmetic. Always calculate from
 * the original anchor so clamping February does not move March's anniversary. */
export function sourcingMonthlyWindow(anchor: Date, now: Date): { start: Date; end: Date } {
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(now.getTime()) || now < anchor) {
    throw new Error('SOURCING_INVALID_WINDOW');
  }
  const boundary = (offset: number): Date => {
    const value = new Date(anchor.getTime());
    value.setUTCDate(1);
    value.setUTCMonth(anchor.getUTCMonth() + offset);
    const last = new Date(value.getTime());
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    value.setUTCDate(Math.min(anchor.getUTCDate(), last.getUTCDate()));
    return value;
  };
  let months = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  if (boundary(months) > now) months -= 1;
  return { start: boundary(months), end: boundary(months + 1) };
}
