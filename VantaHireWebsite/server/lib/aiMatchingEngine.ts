/**
 * AI Matching Engine with Circuit Breaker and Cost Control
 *
 * Features:
 * - Daily budget enforcement ($100/day hard stop, $50 alert)
 * - Concurrent request limiting (max 5 concurrent)
 * - Cost tracking per user
 * - Redis-based distributed state
 * - Staleness detection (7-day TTL)
 * - Server-side label derivation
 */

import { redisGet, redisSet, redisIncr, redisDecr } from './redis';
import { formatDigestForPrompt, JDDigest } from './jdDigest';
import { getGroqClient } from './groqClient';
import { getGroqModel } from './aiModelConfig';
import { FitScoreResponseSchema, safeParseAiResponse } from './aiResponseSchemas';

const DAILY_AI_BUDGET_USD = parseFloat(process.env.DAILY_AI_BUDGET_USD || '100');
const DAILY_AI_ALERT_USD = parseFloat(process.env.DAILY_AI_ALERT_USD || '50');
const MAX_CONCURRENT_AI_CALLS = 5;
const STALENESS_TTL_DAYS = 7;

// Groq pricing (as of Jan 2025) - Llama 3.3 70B Versatile
// Source: https://groq.com/pricing
// Configurable via env vars for flexibility
export const PRICE_PER_1M_INPUT_TOKENS = parseFloat(process.env.AI_PRICE_INPUT_PER_1M || '0.59');
export const PRICE_PER_1M_OUTPUT_TOKENS = parseFloat(process.env.AI_PRICE_OUTPUT_PER_1M || '0.79');

// Helper to calculate AI cost consistently across all endpoints
export function calculateAiCost(tokensIn: number, tokensOut: number): string {
  return (
    (tokensIn / 1_000_000) * PRICE_PER_1M_INPUT_TOKENS +
    (tokensOut / 1_000_000) * PRICE_PER_1M_OUTPUT_TOKENS
  ).toFixed(8);
}

export interface FitComputationResult {
  score: number; // 0-100
  label: string; // 'Exceptional', 'Strong', 'Good', 'Partial', 'Low'
  reasons: string[]; // Array of reason strings
  modelVersion: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  cached?: boolean;
}

export interface CircuitBreakerStatus {
  allowed: boolean;
  reason?: string;
  dailySpent: number;
  dailyBudget: number;
  currentConcurrency: number;
}

let alertSent = false;

/**
 * Derive fit label from score (server-side, don't trust model)
 */
export function deriveFitLabel(score: number): string {
  if (score >= 90) return 'Exceptional';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Partial';
  return 'Low';
}

/**
 * Check circuit breaker status
 */
export async function checkCircuitBreaker(): Promise<CircuitBreakerStatus> {
  // Get daily spent amount from Redis
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const spentKey = `daily_budget:${today}`;
  const spentStr = await redisGet(spentKey);
  const dailySpent = parseFloat(spentStr || '0');

  // Get current concurrency from Redis (for reporting only)
  const concurrencyKey = 'concurrent_calls';
  const concurrencyStr = await redisGet(concurrencyKey);
  const currentConcurrency = parseInt(concurrencyStr || '0', 10);

  // Check budget
  if (dailySpent >= DAILY_AI_BUDGET_USD) {
    return {
      allowed: false,
      reason: `Daily budget of $${DAILY_AI_BUDGET_USD} reached ($${dailySpent.toFixed(2)} spent)`,
      dailySpent,
      dailyBudget: DAILY_AI_BUDGET_USD,
      currentConcurrency,
    };
  }

  // Check alert threshold
  if (dailySpent >= DAILY_AI_ALERT_USD && !alertSent) {
    console.warn(`⚠️  AI budget alert: $${dailySpent.toFixed(2)} / $${DAILY_AI_BUDGET_USD} spent today`);
    alertSent = true;
  }

  // Note: Concurrency is checked atomically in incrementConcurrency()
  // to avoid race conditions between check and increment

  return {
    allowed: true,
    dailySpent,
    dailyBudget: DAILY_AI_BUDGET_USD,
    currentConcurrency,
  };
}

/**
 * Track daily budget spending (exported for use by other AI processing modules)
 */
export async function trackBudgetSpending(costUsd: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const spentKey = `daily_budget:${today}`;

  // Get current spent
  const currentStr = await redisGet(spentKey);
  const current = parseFloat(currentStr || '0');
  const newTotal = current + costUsd;

  // Set with 25-hour expiry (covers timezone edge cases)
  await redisSet(spentKey, newTotal.toFixed(8), 25 * 60 * 60);
}

/**
 * Increment concurrent call counter atomically
 * Throws if limit exceeded (caller must handle rollback)
 */
async function incrementConcurrency(): Promise<void> {
  const current = await redisIncr('concurrent_calls');
  if (current > MAX_CONCURRENT_AI_CALLS) {
    // Rollback the increment
    await redisDecr('concurrent_calls');
    console.warn('[RATE_LIMIT] Concurrency limit exceeded', {
      limitType: 'concurrency',
      current,
      max: MAX_CONCURRENT_AI_CALLS,
    });
    throw new Error(`Maximum concurrent AI calls reached (${MAX_CONCURRENT_AI_CALLS})`);
  }
}

/**
 * Decrement concurrent call counter
 */
async function decrementConcurrency(): Promise<void> {
  await redisDecr('concurrent_calls');
}

/**
 * Compute fit score between resume and job
 *
 * @param resumeText - Extracted resume text
 * @param jdDigest - Job description digest
 * @returns Fit computation result
 */
export async function computeFitScore(
  resumeText: string,
  jdDigest: JDDigest
): Promise<FitComputationResult> {
  const startTime = Date.now();

  // Check circuit breaker
  const breaker = await checkCircuitBreaker();
  if (!breaker.allowed) {
    throw new Error(breaker.reason || 'Circuit breaker open');
  }

  // Increment concurrency
  await incrementConcurrency();

  try {
    const model = getGroqModel();
    const jobRequirements = formatDigestForPrompt(jdDigest);

    const prompt = `You are an expert recruiter evaluating candidate fit for a job.

${jobRequirements}

Candidate Resume:
${resumeText}

Evaluate the fit between this candidate and the job requirements. Provide your analysis in JSON format:
{
  "score": <number 0-100>,
  "reasons": ["reason1", "reason2", "reason3"]
}

Scoring guidelines:
- 90-100: Exceptional fit (exceeds requirements, perfect match)
- 75-89: Strong fit (meets all key requirements, minor gaps)
- 60-74: Good fit (meets most requirements, some gaps)
- 40-59: Partial fit (meets some requirements, significant gaps)
- 0-39: Low fit (major misalignment)

Focus on:
1. Skills match (technical and soft skills)
2. Experience level alignment
3. Domain expertise
4. Constraints (location, visa, etc.)

Be objective and concise. Provide 3-5 specific reasons.`;

    const completion = await getGroqClient().chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const parsed = safeParseAiResponse(FitScoreResponseSchema, responseText, 'fit-score');

    // Extract tokens from response
    const tokensIn = completion.usage?.prompt_tokens || 0;
    const tokensOut = completion.usage?.completion_tokens || 0;

    // Calculate cost
    const costUsd =
      (tokensIn / 1_000_000) * PRICE_PER_1M_INPUT_TOKENS +
      (tokensOut / 1_000_000) * PRICE_PER_1M_OUTPUT_TOKENS;

    // Derive label server-side (don't trust model)
    const score = Math.max(0, Math.min(100, parsed.score ?? 0));
    const label = deriveFitLabel(score);
    const reasons = (parsed.reasons ?? []).slice(0, 5);

    const durationMs = Date.now() - startTime;

    // Track budget
    await trackBudgetSpending(costUsd);

    return {
      score,
      label,
      reasons,
      modelVersion: model,
      costUsd,
      tokensIn,
      tokensOut,
      durationMs,
    };
  } finally {
    // Decrement concurrency (ensure this runs even if error occurs)
    await decrementConcurrency();
  }
}

/**
 * Check if fit score is stale
 *
 * Stale if:
 * - Computed more than 7 days ago
 * - Job digest version changed
 * - Resume was updated after computation
 */
export function isFitStale(
  aiComputedAt: Date | null,
  resumeUpdatedAt: Date | null,
  jobUpdatedAt: Date | null,
  currentDigestVersion: number,
  storedDigestVersion: number | null
): boolean {
  if (!aiComputedAt) return true;

  // Check TTL (7 days)
  const now = new Date();
  const daysSinceComputed = (now.getTime() - aiComputedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceComputed > STALENESS_TTL_DAYS) {
    return true;
  }

  // Check digest version
  if (storedDigestVersion !== currentDigestVersion) {
    return true;
  }

  // Check if resume updated after computation
  if (resumeUpdatedAt && resumeUpdatedAt > aiComputedAt) {
    return true;
  }

  // Check if job updated after computation
  if (jobUpdatedAt && jobUpdatedAt > aiComputedAt) {
    return true;
  }

  return false;
}

/**
 * Get staleness reason
 */
export function getStalenessReason(
  aiComputedAt: Date | null,
  resumeUpdatedAt: Date | null,
  jobUpdatedAt: Date | null,
  currentDigestVersion: number,
  storedDigestVersion: number | null
): string | null {
  if (!aiComputedAt) return null;

  const now = new Date();
  const daysSinceComputed = (now.getTime() - aiComputedAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceComputed > STALENESS_TTL_DAYS) {
    return 'expired_ttl';
  }

  if (storedDigestVersion !== currentDigestVersion) {
    return 'digest_version_changed';
  }

  if (resumeUpdatedAt && resumeUpdatedAt > aiComputedAt) {
    return 'resume_updated';
  }

  if (jobUpdatedAt && jobUpdatedAt > aiComputedAt) {
    return 'job_updated';
  }

  return null;
}
