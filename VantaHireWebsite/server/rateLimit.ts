import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { FREE_AI_DAILY_RATE_LIMIT, PRO_AI_DAILY_RATE_LIMIT, getUserDailyRateLimit } from "./lib/creditService";

// Skip rate limiting in test/development environments
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';

// Type for rate limit info attached to request by express-rate-limit
export interface RateLimitInfo {
  limit: number;
  used: number;
  remaining: number;
  resetTime: Date;
}

// Extended request type with plan info
interface RateLimitRequest extends Request {
  rateLimit?: RateLimitInfo;
  planRateLimit?: number;
}

/**
 * Helper to create rate limit handler with remaining count
 */
export const createRateLimitHandler = (errorMsg: string) => (req: Request, res: Response) => {
  const info = (req as RateLimitRequest).rateLimit;
  const retryAfter = info?.resetTime ? Math.ceil((info.resetTime.getTime() - Date.now()) / 1000) : undefined;
  res.status(429).json({
    error: errorMsg,
    limit: info?.limit,
    remaining: info?.remaining ?? 0,
    used: info?.used,
    retryAfterSeconds: retryAfter,
  });
};

/**
 * Plan-aware rate limit handler - shows the user's actual limit
 */
const planAwareRateLimitHandler = (req: Request, res: Response) => {
  const extReq = req as RateLimitRequest;
  const info = extReq.rateLimit;
  const planLimit = extReq.planRateLimit || FREE_AI_DAILY_RATE_LIMIT;
  const retryAfter = info?.resetTime ? Math.ceil((info.resetTime.getTime() - Date.now()) / 1000) : undefined;
  res.status(429).json({
    error: `AI analysis limit reached (${planLimit}/day). Try again tomorrow.`,
    limit: planLimit,
    remaining: 0,
    used: info?.used || planLimit,
    retryAfterSeconds: retryAfter,
    errorCode: 'RATE_LIMIT_EXCEEDED',
  });
};

// In-memory store for plan-aware rate limiting (keyed by `plan:userId`)
// Uses separate buckets for free and pro users
const planRateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Cleanup old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of planRateLimitStore.entries()) {
    if (value.resetTime < now) {
      planRateLimitStore.delete(key);
    }
  }
}, 60 * 60 * 1000);

/**
 * Plan-aware AI rate limiter middleware
 * - Free plan: FREE_AI_DAILY_RATE_LIMIT/day (default 20)
 * - Pro plan: PRO_AI_DAILY_RATE_LIMIT/day (default 100)
 * - Falls back to free limit for unauthenticated users
 */
export const aiAnalysisRateLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (isTestEnv) {
    next();
    return;
  }

  const userId = req.user?.id;
  const userKey = userId?.toString() || req.ip || 'anonymous';

  // Get user's plan-specific rate limit
  let dailyLimit = FREE_AI_DAILY_RATE_LIMIT;
  if (userId) {
    try {
      dailyLimit = await getUserDailyRateLimit(userId);
    } catch {
      // Fall back to free limit on error
      dailyLimit = FREE_AI_DAILY_RATE_LIMIT;
    }
  }

  // Store the limit on request for error handler
  (req as RateLimitRequest).planRateLimit = dailyLimit;

  // Create a key that includes the plan type to prevent limit mixing
  const planType = dailyLimit >= PRO_AI_DAILY_RATE_LIMIT ? 'pro' : 'free';
  const storeKey = `${planType}:${userKey}`;

  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000; // 24 hours

  // Get or create rate limit entry
  let entry = planRateLimitStore.get(storeKey);
  if (!entry || entry.resetTime < now) {
    entry = { count: 0, resetTime: now + windowMs };
    planRateLimitStore.set(storeKey, entry);
  }

  // Check limit
  if (entry.count >= dailyLimit) {
    const info: RateLimitInfo = {
      limit: dailyLimit,
      used: entry.count,
      remaining: 0,
      resetTime: new Date(entry.resetTime),
    };
    (req as RateLimitRequest).rateLimit = info;
    planAwareRateLimitHandler(req, res);
    return;
  }

  // Increment counter
  entry.count++;

  // Set rate limit info on request
  const info: RateLimitInfo = {
    limit: dailyLimit,
    used: entry.count,
    remaining: Math.max(0, dailyLimit - entry.count),
    resetTime: new Date(entry.resetTime),
  };
  (req as RateLimitRequest).rateLimit = info;

  // Set standard headers
  res.setHeader('RateLimit-Limit', dailyLimit);
  res.setHeader('RateLimit-Remaining', info.remaining);
  res.setHeader('RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

  next();
};

// Legacy static rate limiter (kept for backward compatibility, use aiAnalysisRateLimit instead)
const AI_ANALYSIS_RATE_LIMIT_LEGACY = parseInt(process.env.AI_ANALYSIS_RATE_LIMIT || '20', 10);
export const aiAnalysisRateLimitStatic: RateLimitRequestHandler = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: AI_ANALYSIS_RATE_LIMIT_LEGACY,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip || 'anonymous',
  handler: createRateLimitHandler(`AI analysis limit reached (${AI_ANALYSIS_RATE_LIMIT_LEGACY}/day). Try again tomorrow.`),
});

/**
 * Rate limiter for job applications
 * - 10 applications per day per IP
 */
export const applicationRateLimit: RateLimitRequestHandler = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10, // 10 applications per day per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv,
  handler: createRateLimitHandler('Application limit reached (10/day). Try again tomorrow.'),
});

/**
 * Rate limiter for job postings
 * - 10 job posts per day per user
 */
export const jobPostingRateLimit: RateLimitRequestHandler = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 50, // 50 job posts per day per user
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv,
  handler: createRateLimitHandler('Job posting limit reached (10/day). Try again tomorrow.'),
});

/**
 * Rate limiter for recruiter-add candidates
 * - 50 candidates per day per recruiter
 */
export const recruiterAddRateLimit: RateLimitRequestHandler = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 50, // 50 candidates per day per recruiter
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip || 'anonymous',
  handler: createRateLimitHandler('Candidate addition limit reached (50/day). Try again tomorrow.'),
});

/** Recent-password verification: five attempts per account/session/IP in 15 minutes. */
export const candidatePrivacyReauthRateLimit: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv,
  keyGenerator: (req) => `${req.user?.id ?? "anonymous"}:${req.sessionID ?? "none"}:${req.ip ?? "unknown"}`,
  handler: (_req, res) => {
    res.status(429).json({ code: "candidate_privacy_reauth_limited" });
  },
});
