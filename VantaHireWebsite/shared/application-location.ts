import {z} from 'zod';
import {COUNTRY_CODES, scalarString} from './candidate-profile';

/** Per-application facts, never inferred from a résumé or profile preference. */
export const candidateLocationSchema = z.object({
  version: z.literal(2),
  provenance: z.literal('candidate_confirmed'),
  city: z.string().refine(v => scalarString(v) && !v.includes('\0') &&
    v.trim().length > 0 && Array.from(v).length <= 200, 'invalid_city'),
  countryCode: z.string().refine(v => COUNTRY_CODES.has(v), 'unsupported_country'),
  confirmedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    .refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v, 'invalid_timestamp'),
}).strict().refine(v => new TextEncoder().encode(JSON.stringify(v)).length + 9 <= 1024, 'location_too_large');
export type CandidateLocation = z.infer<typeof candidateLocationSchema>;
