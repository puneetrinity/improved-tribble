import { z } from 'zod';
import { extractedLocationSchema } from './brief-location';

/** Browser-safe D4 wire primitives; saved criteria remain the existing v3 contract. */
export const REVIEW_CONTRACT_VERSION = 1 as const;
export const MAX_EXTRACTED_ITEMS = 64;
const text = (max: number) => z.string().min(1).max(max).refine(v => v.trim().length > 0);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ids = (max: number) => z.array(uuid).max(max).refine(v => new Set(v).size === v.length);
export const extractionItemSchema = z.object({
  text: text(500), priority: z.enum(['required', 'preferred', 'unclear']),
  topic: z.enum(['skill', 'title', 'overall_experience', 'location', 'language', 'education', 'certification', 'relevant_work', 'other']),
  quote: text(2000), terms: z.array(text(120)).max(20),
  location: extractedLocationSchema.nullish(),
  /** How a skill item's terms relate. Omitted = single. Code re-checks it against the quoted JD wording. */
  relation: z.enum(['single', 'any_of', 'examples_of']).nullish().transform(v => v ?? 'single'),
  /** examples_of only: the broader capability the named tools illustrate. */
  capability: text(120).nullish().transform(v => v ?? null),
  // Models often omit empty fields: a missing number means none, never a whole-draft failure.
  minimum: z.number().finite().min(0).max(80).nullish().transform(v => v ?? null),
  maximum: z.number().finite().min(0).max(80).nullish().transform(v => v ?? null),
}).strict();
export const requirementExtractionSchema = z.object({
  items: z.array(extractionItemSchema).min(1).max(MAX_EXTRACTED_ITEMS), overflow: z.boolean(),
}).strict();
export const reviewDispositionSchema = z.discriminatedUnion('state', [
  z.object({itemId: uuid, state: z.literal('included'), criterionIds: ids(12).refine(v => v.length > 0)}).strict(),
  z.object({itemId: uuid, state: z.literal('excluded'),
    reason: z.enum(['lower_priority', 'not_relevant', 'duplicate', 'cannot_verify', 'other']), note: text(300).optional()}).strict(),
  z.object({itemId: uuid, state: z.literal('unresolved')}).strict(),
]);
export const reviewSelectionSchema = z.object({
  extractionId: uuid,
  dispositions: z.array(reviewDispositionSchema).max(MAX_EXTRACTED_ITEMS)
    .refine(v => new Set(v.map(x => x.itemId)).size === v.length),
  manualReview: z.object({reason: z.literal('ai_inventory_incomplete'), explanation: text(300)}).strict().optional(),
}).strict();
export const reviewConfirmationSchema = z.object({
  reviewHash: hash, excludedItemIds: ids(MAX_EXTRACTED_ITEMS), acknowledged: z.literal(true),
  wholeJdReviewed: z.literal(true).optional(),
}).strict();
export type ExtractedRequirement = z.infer<typeof extractionItemSchema>;
export type ReviewDisposition = z.infer<typeof reviewDispositionSchema>;
export type ReviewSelection = z.infer<typeof reviewSelectionSchema>;
export type ReviewConfirmation = z.infer<typeof reviewConfirmationSchema>;

export type ReviewReason = 'capacity'|'needs_clarification'|'quote_not_found'|'unsupported_mapping'|'conflicting_foundation';
/** Criterion is supplied by the caller's existing v3 type; no server import in this module. */
export type ReviewItem<Criterion> = {
  id:string; text:string; priority:ExtractedRequirement['priority']; topic:ExtractedRequirement['topic'];
  quote:string; sourceHash:string; span:{start:number;end:number}|null;
  proposedCriterion:Criterion|null; reason:ReviewReason|null;
};
export type ReviewWorkspace<Criterion> = {
  contractVersion:1; extractionId:string; sourceHash:string; extractionLimit:boolean;
  items:ReviewItem<Criterion>[]; dispositions:ReviewDisposition[];
  reviewHash:string|null; versionId:string|null; exclusionsConfirmed:boolean;
  manualReview?:{reason:'ai_inventory_incomplete';explanation:string;actorId:number;confirmedAt:string}|null;
};
