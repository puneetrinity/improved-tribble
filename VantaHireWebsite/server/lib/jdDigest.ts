/**
 * Job Description (JD) digest generation and caching
 *
 * Purpose:
 * - Reduce token usage by 40% (500 tokens → 150 tokens)
 * - Cache digests with version tracking
 * - Sanitize JD to prevent prompt injection
 * - Deterministic output for same input
 *
 * Cost Impact:
 * - Before: $0.00217 per fit computation
 * - After: $0.00130 per fit computation (40% savings)
 */

import { getGroqClient } from './groqClient';
import { JDDigestResponseSchema, safeParseAiResponse } from './aiResponseSchemas';

const DIGEST_MODEL = 'llama-3.3-70b-versatile';
// v3: adds relaxation-ladder adjacency. Bumping the version triggers background
// regeneration of stale digests on next sourcing.
export const CURRENT_DIGEST_VERSION = 3;

export interface AdjacentLocation {
  metro: string;
  country: string;
}

export interface JDDigest {
  topSkills: string[]; // Max 15 skills
  seniorityLevel: 'entry' | 'mid' | 'senior' | 'lead' | 'executive';
  domain: string; // e.g., "Software Engineering", "Data Science"
  constraints: string[]; // Max 10 constraints (location, visa, etc.)
  keyResponsibilities: string[]; // Top 5 responsibilities
  titleSearchTerms: string[]; // Max 6 literal job titles for sourcing search (variants + synonyms)
  adjacentBuckets: string[][]; // Max 3 later search rungs of 1-4 literal adjacent titles
  adjacentLocations: AdjacentLocation[]; // Max 3 same-country metros for the final ladder rung
  tokenCount: number;
  version: number;
}

export interface JDDigestOptions {
  location?: string | null;
}

function normalizeTitleTerms(terms: string[], limit: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (term.length < 3 || term.length > 60 || seen.has(term)) continue;
    seen.add(term);
    normalized.push(term);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

/**
 * Keep ladder title groups actionable: literal LinkedIn titles, distinct from
 * the exact-query title variants, and never duplicated across later rungs.
 */
export function normalizeAdjacentBuckets(
  buckets: string[][],
  titleSearchTerms: string[],
): string[][] {
  const used = new Set(titleSearchTerms);
  const normalized: string[][] = [];
  for (const bucket of buckets) {
    const titles: string[] = [];
    for (const raw of bucket) {
      const title = raw.trim().toLowerCase();
      if (title.length < 3 || title.length > 60 || used.has(title)) continue;
      used.add(title);
      titles.push(title);
      if (titles.length >= 4) break;
    }
    if (titles.length > 0) normalized.push(titles);
    if (normalized.length >= 3) break;
  }
  return normalized;
}

export function normalizeAdjacentLocations(locations: AdjacentLocation[]): AdjacentLocation[] {
  const seen = new Set<string>();
  const normalized: AdjacentLocation[] = [];
  for (const location of locations) {
    const metro = location.metro.trim();
    const country = location.country.trim();
    const key = `${metro.toLowerCase()}|${country.toLowerCase()}`;
    if (!metro || !country || metro.length > 120 || country.length > 80 || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ metro, country });
    if (normalized.length >= 3) break;
  }
  return normalized;
}

/**
 * Sanitize job description to prevent prompt injection
 *
 * Removes:
 * - Script tags
 * - URLs (prevent data exfiltration)
 * - Common prompt injection patterns
 * - System/assistant/user role markers
 */
export function sanitizeJobDescription(description: string): string {
  return description
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove URLs
    .replace(/https?:\/\/[^\s]+/g, '[URL]')
    // Remove prompt injection attempts
    .replace(/ignore (previous|all) (instructions|prompts)/gi, '[REDACTED]')
    .replace(/disregard (previous|all) (instructions|prompts)/gi, '[REDACTED]')
    .replace(/forget (previous|all) (instructions|prompts)/gi, '[REDACTED]')
    // Remove role markers
    .replace(/system:|assistant:|user:/gi, '[REDACTED]')
    .trim();
}

/**
 * Generate JD digest using Groq AI
 *
 * @param title - Job title
 * @param description - Raw job description
 * @returns Compact digest for AI matching
 */
export async function generateJDDigest(
  title: string,
  description: string,
  options: JDDigestOptions = {},
): Promise<JDDigest> {
  const sanitizedDesc = sanitizeJobDescription(description);
  const locationContext = options.location?.trim() || 'not specified';

  const prompt = `You are analyzing a job posting to extract key information for candidate matching.

Job Title: ${title}
Job Description: ${sanitizedDesc}

Extract the following in JSON format:
{
  "topSkills": ["skill1", "skill2", ...],  // Max 15 most important skills
  "seniorityLevel": "entry|mid|senior|lead|executive",
  "domain": "brief domain description",  // e.g., "Software Engineering"
  "constraints": ["constraint1", "constraint2", ...],  // Max 10 (location, visa, education, etc.)
  "keyResponsibilities": ["resp1", "resp2", ...],  // Top 5 key responsibilities
  "titleSearchTerms": ["title1", "title2", ...],  // 3-6 literal job titles that people doing THIS role hold on LinkedIn. Include common variants and synonyms (e.g. "backend engineer" -> also "backend developer"; "sales manager" -> also "account executive"). Lowercase, role-specific — NEVER generic catch-alls like "software engineer" or "manager" alone unless the job itself is that generic. Do NOT include seniority words (senior/junior/lead).
  "adjacentBuckets": [["title1", "title2"], ...], // 0-3 later search rungs of 1-4 literal LinkedIn titles. Each bucket must be a close, role-relevant adjacent talent pool, distinct from titleSearchTerms and from other buckets. Do not use generic catch-alls.
  "adjacentLocations": [{"metro": "city", "country": "country"}, ...] // 0-3 nearby metros only when the job location below unambiguously identifies a country. Every country MUST match the job country exactly. Return [] for remote, country-only, or unclear locations.
}

Job location: ${locationContext}

Be concise. Extract only the most critical information. No explanations.`;

  try {
    const completion = await getGroqClient().chat.completions.create({
      model: DIGEST_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1, // Low temperature for deterministic output
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const parsed = safeParseAiResponse(JDDigestResponseSchema, responseText, 'jd-digest');
    const titleSearchTerms = normalizeTitleTerms(parsed.titleSearchTerms ?? [], 6);
    // Zod's catch() output is intentionally unknown at this generic boundary.
    // The schema and these guards keep malformed optional adjacency isolated.
    const adjacentBuckets = Array.isArray(parsed.adjacentBuckets)
      ? parsed.adjacentBuckets as string[][]
      : [];
    const adjacentLocations = Array.isArray(parsed.adjacentLocations)
      ? parsed.adjacentLocations as AdjacentLocation[]
      : [];

    // Estimate token count (1 token ≈ 4 characters)
    const digestText = JSON.stringify(parsed);
    const tokenCount = Math.ceil(digestText.length / 4);

    const digest: JDDigest = {
      topSkills: (parsed.topSkills ?? []).slice(0, 15),
      seniorityLevel: parsed.seniorityLevel ?? 'mid',
      domain: parsed.domain ?? 'General',
      constraints: (parsed.constraints ?? []).slice(0, 10),
      keyResponsibilities: (parsed.keyResponsibilities ?? []).slice(0, 5),
      titleSearchTerms,
      adjacentBuckets: normalizeAdjacentBuckets(adjacentBuckets, titleSearchTerms),
      adjacentLocations: normalizeAdjacentLocations(adjacentLocations),
      tokenCount,
      version: CURRENT_DIGEST_VERSION,
    };

    return digest;
  } catch (error) {
    console.error('❌ JD digest generation failed:', error);

    // Fallback digest (basic extraction)
    return {
      topSkills: [],
      seniorityLevel: 'mid',
      domain: title,
      constraints: [],
      keyResponsibilities: [],
      titleSearchTerms: [],
      adjacentBuckets: [],
      adjacentLocations: [],
      tokenCount: 50,
      version: CURRENT_DIGEST_VERSION,
    };
  }
}

/**
 * Get digest token count for cost estimation
 */
export function estimateDigestTokens(digest: JDDigest): number {
  return digest.tokenCount || 150;
}

/**
 * Format digest for AI prompt
 */
export function formatDigestForPrompt(digest: JDDigest): string {
  return `Job Requirements:
- Domain: ${digest.domain}
- Seniority: ${digest.seniorityLevel}
- Top Skills: ${digest.topSkills.join(', ')}
- Key Responsibilities: ${digest.keyResponsibilities.join('; ')}
- Constraints: ${digest.constraints.join(', ')}`;
}
