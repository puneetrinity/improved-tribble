/**
 * Zod schemas for validating AI response JSON structures
 *
 * These schemas ensure type safety and provide clear error messages
 * when Groq returns malformed or unexpected JSON structures.
 */

import { z } from 'zod';

// ============= Fit Score Response =============
export const FitScoreResponseSchema = z.object({
  score: z.number().min(0).max(100).default(0),
  reasons: z.array(z.string()).default([]),
});
export type FitScoreResponse = z.infer<typeof FitScoreResponseSchema>;

// ============= Dashboard Insights Response =============
export const DashboardInsightsResponseSchema = z.object({
  summary: z.string().default(''),
  dropoffExplanation: z.string().default(''),
  jobs: z.array(z.object({
    jobId: z.number(),
    nextAction: z.string(),
  })).default([]),
});
export type DashboardInsightsResponse = z.infer<typeof DashboardInsightsResponseSchema>;

// ============= JD Digest Response =============
export const JDDigestResponseSchema = z.object({
  topSkills: z.array(z.string()).max(15).default([]),
  seniorityLevel: z.enum(['entry', 'mid', 'senior', 'lead', 'executive']).default('mid'),
  domain: z.string().default('General'),
  constraints: z.array(z.string()).max(10).default([]),
  keyResponsibilities: z.array(z.string()).max(5).default([]),
  titleSearchTerms: z.array(z.string()).max(6).default([]),
  // v3: each bucket is one later sourcing rung of closely related literal titles.
  adjacentBuckets: z.array(z.array(z.string()).max(4)).max(3).default([]).catch([]),
  // Country accompanies the metro so Signal can reject cross-country relaxation
  // before it spends a Crustdata search on it.
  adjacentLocations: z.array(z.object({
    metro: z.string(),
    country: z.string(),
  })).max(3).default([]).catch([]),
});
export type JDDigestResponse = z.infer<typeof JDDigestResponseSchema>;

// ============= Job Analysis Response =============
export const JobAnalysisResponseSchema = z.object({
  clarity_score: z.number().min(0).max(100).default(50),
  inclusion_score: z.number().min(0).max(100).default(50),
  seo_score: z.number().min(0).max(100).default(50),
  overall_score: z.number().min(0).max(100).default(50),
  bias_flags: z.array(z.string()).default([]),
  seo_keywords: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  rewrite: z.string().default(''),
});
export type JobAnalysisResponse = z.infer<typeof JobAnalysisResponseSchema>;

// ============= Email Draft Response =============
export const EmailDraftResponseSchema = z.object({
  subject: z.string().default(''),
  body: z.string().default(''),
});
export type EmailDraftResponse = z.infer<typeof EmailDraftResponseSchema>;

// ============= Candidate Summary Response =============
export const CandidateSummaryResponseSchema = z.object({
  summary: z.string().default(''),
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  suggestedAction: z.enum(['advance', 'hold', 'reject']).default('hold'),
  suggestedActionReason: z.string().default(''),
  keyHighlights: z.array(z.string()).default([]),
  // Skill analysis fields
  requiredSkillsAnalysis: z.object({
    matched: z.array(z.string()).default([]),
    missing: z.array(z.string()).default([]),
    matchPercentage: z.number().min(0).max(100).transform(val => Math.round(val)).default(0),
    depthNotes: z.string().default(''),
  }).optional().default({ matched: [], missing: [], matchPercentage: 0, depthNotes: '' }),
  goodToHaveSkillsAnalysis: z.object({
    matched: z.array(z.string()).default([]),
    missing: z.array(z.string()).default([]),
  }).optional().default({ matched: [], missing: [] }),
});
export type CandidateSummaryResponse = z.infer<typeof CandidateSummaryResponseSchema>;

// ============= Pipeline Actions Response =============
export const PipelineActionsResponseSchema = z.object({
  enhancements: z.array(z.object({
    itemId: z.string(),
    description: z.string().default(''),
    impact: z.string().default(''),
  })).default([]),
  additionalInsights: z.array(z.string()).default([]),
});
export type PipelineActionsResponse = z.infer<typeof PipelineActionsResponseSchema>;

// ============= Form Questions Response =============
export const FormFieldSchema = z.object({
  label: z.string().default('Untitled Question'),
  description: z.string().optional(),
  fieldType: z.enum(['short_text', 'long_text', 'yes_no', 'select', 'mcq', 'scale']).default('long_text'),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

export const FormQuestionsResponseSchema = z.object({
  fields: z.array(FormFieldSchema).default([]),
});
export type FormQuestionsResponse = z.infer<typeof FormQuestionsResponseSchema>;

/**
 * Safely parse AI response with Zod schema
 * Returns parsed data or default values on failure
 */
export function safeParseAiResponse<T>(
  schema: z.ZodType<T>,
  jsonText: string,
  context: string
): T {
  try {
    // Clean up common JSON issues from LLM responses
    const cleanedText = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/```$/g, '')
      .trim();

    const parsed = JSON.parse(cleanedText);
    const result = schema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    console.warn(`[AI Response] Zod validation failed for ${context}:`, result.error.issues);
    // Return with defaults applied
    return schema.parse({});
  } catch (error) {
    console.error(`[AI Response] JSON parse failed for ${context}:`, error);
    // Return empty object which will use all defaults
    return schema.parse({});
  }
}
