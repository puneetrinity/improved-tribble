import { createHash } from 'node:crypto';
import { z } from 'zod';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== '00000000-0000-0000-0000-000000000000');
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const positive = z.number().int().min(1).max(2147483647);
const opaque = z.string().min(1).max(200).refine(value => !!value.trim() && !/[\x00-\x1f\x7f]/.test(value));
export const candidateEligibilityIdentity = z.object({ candidateId: uuid, referenceId: uuid,
  applicationId: positive, applicationJobId: positive, resumeVersionId: uuid,
  sourceId: uuid, generationId: uuid, sourceHash: hash }).strict();
export const candidateEligibilityBody = z.object({ version: z.literal(1), flowRunId: uuid,
  revisionId: uuid, requestId: opaque, externalJobId: positive,
  items: z.array(z.object({ key: opaque, identity: candidateEligibilityIdentity }).strict()).min(1).max(100),
}).strict().superRefine((body, context) => {
  if (new Set(body.items.map(item => item.key)).size !== body.items.length
    || new Set(body.items.map(item => JSON.stringify(item.identity))).size !== body.items.length)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate identity' });
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 65536)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Body too large' });
});
export type CandidateEligibilityBody = z.infer<typeof candidateEligibilityBody>;

// Schema parsing fixes key order; neither transport whitespace nor caller key order changes this hash.
export function candidateEligibilityHash(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(candidateEligibilityBody.parse(raw))).digest('hex');
}

export const candidateEligibilityResponse = z.object({ version: z.literal(1), bodyHash: hash,
  checkedAt: z.string().datetime({ offset: true }),
  results: z.array(z.object({ key: opaque,
    decision: z.enum(['allow', 'same_job', 'privacy_restricted', 'source_changed', 'not_found', 'unavailable']),
  }).strict()).min(1).max(100),
}).strict();
