import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveJobDescription } from '../../shared/jobDescription';

export const BRIEF_TABLES = ['job_brief_state', 'job_brief_versions', 'job_brief_events', 'job_brief_draft_requests'] as const;
export const BRIEF_FUNCTIONS = [
  'flow_job_brief_read(integer,integer,integer)',
  'flow_job_brief_history(integer,integer,integer,timestamp with time zone,uuid,integer)',
  'flow_job_brief_save(integer,integer,integer,uuid,bigint,jsonb)',
  'flow_job_brief_approve(integer,integer,integer,uuid,bigint,uuid,text)',
  'flow_job_brief_draft_claim(integer,integer,integer,uuid,bigint,text,text,text)',
  'flow_job_brief_draft_finish(uuid,uuid,jsonb)',
] as const;
export const BRIEF_VERSION = 1;
export const MAX_JD_BYTES = 20_000;
export const MAX_REQUEST_BYTES = 65_536;

export function jobBriefEnabled(env: NodeJS.ProcessEnv = process.env, worker = false): boolean {
  const raw = env.FLOW_JOB_BRIEF_ENABLED;
  if (raw !== undefined && raw !== 'true' && raw !== 'false') throw new Error('JOB_BRIEF_INVALID_CONFIGURATION');
  if (worker && raw === 'true') throw new Error('JOB_BRIEF_WEB_ONLY');
  return raw === 'true';
}

export const criterionClasses = ['must_have', 'preferred', 'disqualifier', 'evidence_required'] as const;
export const criterionSubjects = ['title', 'seniority', 'experience_years', 'skill', 'domain', 'function', 'location', 'certification', 'language', 'education_requirement', 'relevant_work', 'responsibility', 'leadership', 'availability', 'work_eligibility'] as const;
export const reasonCodes = ['clarification_typo', 'hm_client_feedback', 'role_scope_changed', 'seniority_changed', 'skills_changed', 'location_changed', 'compensation_changed', 'sourcing_quality_volume', 'market_availability', 'application_interview_evidence', 'policy_compliance', 'other'] as const;
export const timingCodes = ['before_sourcing', 'after_results', 'after_review', 'after_interview', 'after_close_reopen', 'unknown'] as const;
export const requesterKinds = ['recruiter', 'hiring_manager'] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = (max: number) => z.string().trim().min(1).max(max);
export function hasBannedCriterionText(text:string,subject?:string):boolean {
  return /^\s*(?:age|male|female)\s*$/i.test(text)
    || /\b(?:overqualified|under\s*\d{2}|maximum\s+(?:age|experience)|age\s*(?:limit|range|under|below|between|above|over|[<>=]|\d+)|aged\s+\d+|young|youthful|gender|(?:male|female)\s+(?:only|candidates?|applicants?|workers?|engineers?|preferred|required)|(?:only|prefer|preferred|require|required)\s+(?:male|female)|ethnicity|race(?!\s+conditions?\b)|religion|caste|marital|(?:un)?married|pregnan\w*|disabil\w*|nationality|national\s+origin|native(?:[ -]|\s+(?:\w+\s+){0,2})speaker|mother\s+tongue|recent\s+grad\w*|graduation\s+year|career\s+gaps?|elite\s+(?:school|college)|college\s+name|do.not.poach)\b/i.test(text)
    || (subject!=='work_eligibility' && /\b(?:citizenship|citizens?)\b/i.test(text));
}
const criterion = z.object({
  id: z.string().uuid(),
  label: boundedText(120),
  class: z.enum(criterionClasses),
  subject: z.enum(criterionSubjects),
  requirement: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), value: boundedText(500) }).strict(),
    z.object({ kind: z.literal('minimum_years'), minimum: z.number().finite().min(0).max(80) }).strict(),
    z.object({ kind: z.literal('boolean'), value: z.enum(['yes', 'no', 'unknown']) }).strict(),
  ]),
  evidenceKinds: z.array(z.enum(['candidate_provided', 'verified_document', 'profile_evidence', 'recruiter_judgement'])).min(1).max(4),
  use: z.enum(['assessment', 'retrieval', 'both']),
  provenance: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('jd'), sourceHash: hash, start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('recruiter_edit') }).strict(),
  ]),
  note: z.string().max(300).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.subject === 'experience_years') !== (value.requirement.kind === 'minimum_years')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Experience accepts a minimum only' });
  }
  if(value.subject==='experience_years' && value.class==='disqualifier') {
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Experience cannot be a disqualifier'});
  }
  if (['responsibility', 'leadership', 'availability'].includes(value.subject) &&
      (value.use !== 'assessment' || value.evidenceKinds.some(k => k !== 'recruiter_judgement'))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Recruiter-judged criterion is assessment only' });
  }
  if (value.subject === 'work_eligibility' && value.evidenceKinds.some(k => !['candidate_provided', 'verified_document'].includes(k))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Work eligibility needs candidate-provided or verified evidence' });
  }
  const texts = [value.label, value.requirement.kind === 'text' ? value.requirement.value : '', value.note??''];
  if (texts.some(text=>hasBannedCriterionText(text,value.subject))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unsupported criterion' });
  }
});
export const briefPayloadSchema = z.object({
  schemaVersion: z.literal(1), compilerVersion: z.literal(1), taxonomyVersion: z.literal(1),
  criteria: z.array(criterion).min(1).max(12),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.criteria.map(c => c.id)).size !== value.criteria.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate criterion ID' });
});
export type BriefPayload = z.infer<typeof briefPayloadSchema>;
export const currentJdSchema = z.string().min(1)
  .refine(v => Buffer.byteLength(v, 'utf8') <= MAX_JD_BYTES, 'JD exceeds byte limit')
  .refine(v => resolveJobDescription({ originalJD: v }).resolution !== 'unavailable', 'JD must be prose');
export const saveBriefSchema = z.object({
  requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().safe(),
  currentJD: currentJdSchema, payload: briefPayloadSchema,
  requesterKind: z.enum(requesterKinds), reasonCode: z.enum(reasonCodes),
  note: z.string().max(300).optional(),
  sourceChoice: z.enum(['original_prose', 'description_prose', 'recruiter_edit', 'current_jd']),
}).strict();
export const approveBriefSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().safe(), versionId: z.string().uuid() }).strict();
export const draftBriefSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().safe() }).strict();

export function sourceHash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('BRIEF_NON_JSON_VALUE');
  return encoded;
}
export function validateSourceSpans(payload: BriefPayload, jd: string): void {
  const expected = sourceHash(jd);
  for (const item of payload.criteria) {
    if (item.provenance.kind === 'jd') {
      const p = item.provenance;
      if (p.sourceHash !== expected || p.end <= p.start || p.end > jd.length || !jd.slice(p.start, p.end).trim()) throw new Error('BRIEF_INVALID_SOURCE_SPAN');
    }
  }
}
