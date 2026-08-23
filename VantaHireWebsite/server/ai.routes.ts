/**
 * AI Matching API Routes
 *
 * Features:
 * - Resume management (save up to 3 resumes)
 * - On-demand fit computation
 * - Batch endpoint with deduplication and free-tier handling
 * - Cache awareness (don't recompute fresh fits)
 * - Feature flags for gradual rollout
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, requireSeat, requireVerifiedCandidate } from './auth';
import { doubleCsrfProtection } from './csrf';
import rateLimit from 'express-rate-limit';
import { db } from './db';
import { candidateResumes, applications, jobs, users, BatchFitResult } from '../shared/schema';
import { eq, and, inArray, sql, desc, count } from 'drizzle-orm';
import { upload, uploadToGCS, downloadFromGCS } from './gcs-storage';
import { extractResumeText, validateResumeText } from './lib/resumeExtractor';
import { generateJDDigest, JDDigest, CURRENT_DIGEST_VERSION } from './lib/jdDigest';
import { computeFitScore, isFitStale, getStalenessReason } from './lib/aiMatchingEngine';
import {
  finalizeFitCredit,
  FitGenerationChangedError,
  getUserLimits,
  releaseFitCredit,
  reserveFitCredit,
  type FitCreditReservation,
} from './lib/aiLimits';
import { getRedisHealth } from './lib/redis';
import { isQueueAvailable, enqueueInteractive, enqueueBatch, getQueueHealth, removeJob, QUEUES } from './lib/aiQueue';
import { syncProfileCompletionStatus } from './lib/profileCompletion';
import { storage } from './storage';
import { z } from 'zod';
import { getGroqClient } from './lib/groqClient';
import { getGroqModel } from './lib/aiModelConfig';
import { getDashboardAiInsights, DashboardAiPayload } from "./lib/aiDashboard";
import { randomUUID } from 'crypto';
import { getUserOrganization } from './lib/organizationService';
import { getAiCreditExhaustionPayload, getMemberCreditBalance, useCredits, hasEnoughCredits } from './lib/creditService';
import { requireFeatureAccess, FEATURES } from './lib/featureGating';
import {
  CandidatePrivacyRestrictedError,
  privacyAllowedSql,
  requireCandidatePrivacyAllowed,
} from './candidate-privacy/decision';

const applicationPrivacyAllowed = () => sql.raw(
  privacyAllowedSql('application', 'applications.id', { globalUse: false }),
);

const AI_MATCH_ENABLED = process.env.AI_MATCH_ENABLED === 'true';
const AI_RESUME_ENABLED = process.env.AI_RESUME_ENABLED === 'true';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AI_QUEUE_ENABLED = process.env.AI_QUEUE_ENABLED === 'true';

// Async queue configuration
const AI_BATCH_MAX = parseInt(process.env.AI_BATCH_MAX || '50', 10);
const AI_MAX_PENDING_PER_USER_INTERACTIVE = parseInt(process.env.AI_MAX_PENDING_INTERACTIVE || '3', 10);
const AI_MAX_PENDING_PER_USER_BATCH = parseInt(process.env.AI_MAX_PENDING_BATCH || '1', 10);

// Validation schemas
const saveResumeSchema = z.object({
  label: z.string().min(1).max(100),
  // Multer/FormData sends booleans as strings; coerce to boolean
  isDefault: z.coerce.boolean().optional(),
});

const computeFitSchema = z.object({
  applicationId: z.number().int().positive(),
});

const batchComputeFitSchema = z.object({
  applicationIds: z.array(z.number().int().positive()).min(1).max(20),
});

// Async queue validation schemas
const asyncQueueSingleSchema = z.object({
  applicationId: z.number().int().positive(),
});

const asyncQueueBatchSchema = z.object({
  applicationIds: z.array(z.number().int().positive()).min(1).max(AI_BATCH_MAX),
});

// Configurable rate limits via environment variables
const RATE_LIMIT_RESUME_UPLOAD = parseInt(process.env.AI_RATE_LIMIT_RESUME || '5', 10);
const RATE_LIMIT_FIT_COMPUTE = parseInt(process.env.AI_RATE_LIMIT_FIT || '10', 10);
const RATE_LIMIT_BATCH = parseInt(process.env.AI_RATE_LIMIT_BATCH || '3', 10);
const RATE_LIMIT_GENERIC = parseInt(process.env.AI_RATE_LIMIT_GENERIC || '30', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || '60000', 10);

function candidateQuotaExceededPayload(limits: Awaited<ReturnType<typeof getUserLimits>>) {
  return {
    error: 'No match credits remaining',
    errorCode: 'QUOTA_EXCEEDED',
    message: `You have used all ${limits.fitLimitPerMonth} match credits for this month. Existing match results remain available.`,
    remaining: limits.fitRemainingThisMonth,
    limits,
  };
}

async function getPersistedCandidateFit(userId: number, applicationId: number) {
  const application = await db.query.applications.findFirst({
    where: and(
      eq(applications.id, applicationId),
      eq(applications.userId, userId)
    ),
    columns: {
      aiFitScore: true,
      aiFitLabel: true,
      aiFitReasons: true,
      aiComputedAt: true,
    },
  });

  if (!application || application.aiFitScore === null || !application.aiComputedAt) {
    return null;
  }

  return {
    score: application.aiFitScore,
    label: application.aiFitLabel,
    reasons: Array.isArray(application.aiFitReasons)
      ? application.aiFitReasons.filter(
          (reason: unknown): reason is string => typeof reason === 'string'
        )
      : [],
    computedAt: application.aiComputedAt,
    cached: true,
  };
}

// Rate limiters with structured logging
const resumeUploadLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_RESUME_UPLOAD,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: any, res: any) => {
    console.warn('[RATE_LIMIT] Resume upload limit exceeded', {
      userId: req.user?.id,
      endpoint: req.path,
      limitType: 'per-minute',
      ip: req.ip,
    });
    res.status(429).json({ error: 'Too many resume uploads. Please try again later.' });
  },
});

const fitComputeLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_FIT_COMPUTE,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: any, res: any) => {
    console.warn('[RATE_LIMIT] Fit computation limit exceeded', {
      userId: req.user?.id,
      endpoint: req.path,
      limitType: 'per-minute',
      ip: req.ip,
    });
    res.status(429).json({ error: 'Too many fit computation requests. Please try again later.' });
  },
});

const batchComputeLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_BATCH,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: any, res: any) => {
    console.warn('[RATE_LIMIT] Batch computation limit exceeded', {
      userId: req.user?.id,
      endpoint: req.path,
      limitType: 'per-minute',
      ip: req.ip,
    });
    res.status(429).json({ error: 'Too many batch computation requests. Please try again later.' });
  },
});

const genericGenerationLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_GENERIC, // Higher limit to accommodate dashboard which fires multiple AI calls per page load
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: any, res: any) => {
    console.warn('[RATE_LIMIT] AI generate limit exceeded', {
      userId: req.user?.id,
      endpoint: req.path,
      limitType: 'per-minute',
      ip: req.ip,
    });
    res.status(429).json({ error: 'Too many AI generation requests. Please try again later.' });
  },
});

// Use shared Groq client from lib/groqClient.ts

/**
 * Feature flag check middleware
 * Also validates GROQ_API_KEY is configured for AI features
 */
function requireFeatureFlag(flag: 'match' | 'resume') {
  return (req: any, res: any, next: any): void => {
    const enabled = flag === 'match' ? AI_MATCH_ENABLED : AI_RESUME_ENABLED;

    if (!enabled) {
      res.status(503).json({
        error: 'Feature not available',
        message: `AI ${flag} feature is currently disabled`,
      });
     return;
    }

    // Check if GROQ_API_KEY is configured (required for AI features)
    if (!GROQ_API_KEY) {
      res.status(503).json({
        error: 'Service unavailable',
        message: 'AI service is temporarily unavailable. Please try again later.',
      });
     return;
    }

    next();
  };
}

export function registerAIRoutes(app: Express): void {
  /**
   * POST /api/ai/generate
   * Generic AI proxy for frontend (dashboard summaries, next-actions, etc.)
   * Only for authenticated recruiters/admins.
   */
  // Note: CSRF protection skipped for this endpoint because it's authenticated,
  // role-protected, rate-limited, and read-only (no server state mutation).
  app.post(
    "/api/ai/generate",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    requireFeatureAccess(FEATURES.AI_CONTENT),
    genericGenerationLimiter,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!GROQ_API_KEY) {
          res.status(503).json({ error: "AI service unavailable" });
          return;
        }

        const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
        if (!prompt) {
          res.status(400).json({ error: 'Prompt is required' });
          return;
        }

        // Check AI credits for recruiters (super_admin bypasses credit check)
        if (req.user!.role === 'recruiter') {
          const creditCheck = await hasEnoughCredits(req.user!.id, 1);
          if (!creditCheck) {
            res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, 1));
            return;
          }
        }

        const client = getGroqClient();
        const model = getGroqModel();
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "You are a concise assistant for recruiter dashboards. Respond with short, clear text." },
            { role: "user", content: prompt }
          ],
          max_tokens: 350,
          temperature: 0.4,
        });
        const text = response.choices[0]?.message?.content?.trim() || "";

        if (req.user!.role === 'recruiter') {
          const creditUsage = await useCredits(req.user!.id, 1);
          if (!creditUsage.success) {
            res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, 1));
            return;
          }
        }

        res.json({ text });
        return;
      } catch (error) {
        console.error("[AI generate] error:", error);
        res.status(502).json({ error: "AI generation failed" });
      }
    }
  );

  /**
   * POST /api/ai/dashboard-insights
   * Batched AI insights for recruiter dashboard, cached per user.
   */
  app.post(
    "/api/ai/dashboard-insights",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    requireFeatureAccess(FEATURES.AI_CONTENT),
    genericGenerationLimiter,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const payload = req.body as DashboardAiPayload;
        if (!payload || !payload.pipelineHealthScore || !Array.isArray(payload.jobsNeedingAttention)) {
          res.status(400).json({ error: "Invalid payload" });
          return;
        }

        // Check AI credits for recruiters (super_admin bypasses credit check)
        if (req.user!.role === 'recruiter') {
          const creditCheck = await hasEnoughCredits(req.user!.id, 1);
          if (!creditCheck) {
            res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, 1));
            return;
          }
        }

        const insights = await getDashboardAiInsights(req.user!.id, payload);

        if (req.user!.role === 'recruiter') {
          const creditUsage = await useCredits(req.user!.id, 1);
          if (!creditUsage.success) {
            res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, 1));
            return;
          }
        }

        res.json(insights);
        return;
      } catch (error) {
        console.error("[AI dashboard insights] error:", error);
        res.status(502).json({ error: "AI dashboard insights unavailable" });
      }
    }
  );

  // ========================================
  // Resume Management Routes
  // ========================================

  /**
   * POST /api/ai/resume
   * Save a resume to the candidate's library (max 3)
   */
  app.post(
    '/api/ai/resume',
    requireVerifiedCandidate,
    doubleCsrfProtection,
    resumeUploadLimiter,
    upload.single('resume'),
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;
        const file = req.file;

        await requireCandidatePrivacyAllowed(
          { type: 'candidate_user', id: userId },
          { globalUse: true, newGlobalOperation: true },
        );

        if (!file) {
          res.status(400).json({ error: 'Resume file is required' });
         return;
        }

        // Validate body
        const body = saveResumeSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error });
         return;
        }

        const { label, isDefault } = body.data;

        // Check resume limit (max 3)
        const existingResumes = await db.query.candidateResumes.findMany({
          where: eq(candidateResumes.userId, userId),
        });

        if (existingResumes.length >= 3) {
          res.status(400).json({
            error: 'Maximum 3 resumes allowed',
            message: 'Please delete an existing resume before adding a new one.',
          });
       return;
        }

        // Extract text from resume
        const extractionResult = await extractResumeText(file.buffer);

        if (!extractionResult.success) {
          // Use 415 Unsupported Media Type for file type errors, 400 for other issues
          const isUnsupportedType = extractionResult.error?.includes('Unsupported file type');
          res.status(isUnsupportedType ? 415 : 400).json({
            error: 'Resume extraction failed',
            message: extractionResult.error,
          });
       return;
        }

        // Validate extracted text
        if (!validateResumeText(extractionResult.text)) {
          res.status(400).json({
            error: 'Invalid resume',
            message: 'Resume must contain at least 50 characters of text.',
          });
       return;
        }

        // Upload to GCS
        await requireCandidatePrivacyAllowed(
          { type: 'candidate_user', id: userId },
          { globalUse: true, newGlobalOperation: true },
        );
        const gcsPath = await uploadToGCS(file.buffer, file.originalname);

        // If this is set as default, unset other defaults
        if (isDefault) {
          await db
            .update(candidateResumes)
            .set({ isDefault: false })
            .where(eq(candidateResumes.userId, userId));
        }

        // Save resume
        await requireCandidatePrivacyAllowed(
          { type: 'candidate_user', id: userId },
          { globalUse: true, newGlobalOperation: true },
        );
        const [resume] = await db
          .insert(candidateResumes)
          .values({
            userId,
            label,
            gcsPath,
            extractedText: extractionResult.text,
            isDefault: isDefault || false,
          })
          .returning();

        await syncProfileCompletionStatus(req.user!, { resumeCount: existingResumes.length + 1 });

        // Note: On new resume upload, we don't mark anything stale
        // Applications will only become stale if:
        // 1. The user updates an existing resume (would be a PUT endpoint)
        // 2. The job description changes (tracked via jdDigestVersion)
        // 3. The 7-day TTL expires

        res.json({
          message: 'Resume saved successfully',
          resume: {
            id: resume.id,
            label: resume.label,
            isDefault: resume.isDefault,
            createdAt: resume.createdAt,
          },
        });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        console.error('Resume upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
     return;
      }
    }
  );

  /**
   * GET /api/ai/resume
   * List all saved resumes for the authenticated candidate
   */
  app.get(
    '/api/ai/resume',
    requireVerifiedCandidate,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;

        await requireCandidatePrivacyAllowed(
          { type: 'candidate_user', id: userId },
          { globalUse: false },
        );

        const resumes = await db.query.candidateResumes.findMany({
          where: eq(candidateResumes.userId, userId),
          columns: {
            id: true,
            label: true,
            isDefault: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        res.json({ resumes });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(200).json({ resumes: [], privacyRestricted: true });
          return;
        }
        console.error('Resume list error:', error);
        res.status(500).json({ error: 'Internal server error' });
     return;
      }
    }
  );

  /**
   * DELETE /api/ai/resume/:id
   * Delete a saved resume
   */
  app.delete(
    '/api/ai/resume/:id',
    requireVerifiedCandidate,
    doubleCsrfProtection,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;
        const resumeIdParam = req.params.id;

        if (!resumeIdParam) {
          res.status(400).json({ error: 'Resume ID is required' });
          return;
        }

        const resumeId = parseInt(resumeIdParam, 10);

        if (isNaN(resumeId)) {
          res.status(400).json({ error: 'Invalid resume ID' });
          return;
        }

        // Check ownership
        const resume = await db.query.candidateResumes.findFirst({
          where: and(
            eq(candidateResumes.id, resumeId),
            eq(candidateResumes.userId, userId)
          ),
        });

        if (!resume) {
          res.status(404).json({ error: 'Resume not found' });
       return;
        }

        await db.transaction(async (tx: any) => {
          // Applications keep their copied resume URL/text after the library item
          // is removed, but must release the FK first.
          await tx
            .update(applications)
            .set({ resumeId: null })
            .where(
              and(
                eq(applications.resumeId, resumeId),
                eq(applications.userId, userId)
              )
            );
          await tx.delete(candidateResumes).where(eq(candidateResumes.id, resumeId));
        });

        const remaining = await db
          .select({ count: count() })
          .from(candidateResumes)
          .where(eq(candidateResumes.userId, userId));
        const remainingCount = Number(remaining[0]?.count ?? 0);
        await syncProfileCompletionStatus(req.user!, { resumeCount: remainingCount });

        res.json({ message: 'Resume deleted successfully' });
      } catch (error) {
        console.error('Resume delete error:', error);
        res.status(500).json({ error: 'Internal server error' });
     return;
      }
    }
  );

  // ========================================
  // AI Fit Computation Routes
  // ========================================

  /**
   * POST /api/ai/match
   * Compute fit score for a single application
   */
  app.post(
    '/api/ai/match',
    requireVerifiedCandidate,
    requireFeatureFlag('match'),
    doubleCsrfProtection,
    fitComputeLimiter,
    async (req, res): Promise<void> => {
      let reservation: FitCreditReservation | null = null;
      let applicationIdForRecovery: number | null = null;
      try {
        const userId = req.user!.id;

        // Validate body
        const body = computeFitSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error });
       return;
        }

        const { applicationId } = body.data;
        applicationIdForRecovery = applicationId;

        // Get application with job data
        const application = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: {
            job: true,
          },
        });

        if (!application) {
          res.status(404).json({ error: 'Application not found' });
       return;
        }

        // Check ownership
        if (application.userId !== userId) {
          res.status(403).json({ error: 'Unauthorized' });
         return;
        }
        await requireCandidatePrivacyAllowed(
          { type: 'application', id: applicationId },
          { globalUse: false },
        );

        // Check if fit is fresh (cache-aware) - do this BEFORE free-tier check
        // Prefer application-linked resume; otherwise fall back to user's default resume,
        // or the most recently updated resume if no default is set.
        let resumeData = application.resumeId
          ? await db.query.candidateResumes.findFirst({
              where: eq(candidateResumes.id, application.resumeId),
            })
          : await db.query.candidateResumes.findFirst({
              where: and(
                eq(candidateResumes.userId, userId),
                eq(candidateResumes.isDefault, true as any)
              ),
            });

        if (!resumeData) {
          resumeData = await db.query.candidateResumes.findFirst({
            where: eq(candidateResumes.userId, userId),
            orderBy: (cr: any, { desc }: any) => [desc(cr.updatedAt)],
          });
        }

        const stale = isFitStale(
          application.aiComputedAt,
          resumeData?.updatedAt || null,
          application.job.updatedAt,
          application.job.jdDigestVersion || 1,
          application.aiDigestVersionUsed || null
        );

        if (!stale && application.aiFitScore !== null) {
          // Return cached result (doesn't consume free tier)
          res.json({
            message: 'Fit score retrieved from cache',
            fit: {
              score: application.aiFitScore,
              label: application.aiFitLabel,
              reasons: application.aiFitReasons,
              computedAt: application.aiComputedAt,
              cached: true,
            },
          });
       return;
        }

        // Get resume text
        let resumeText = resumeData?.extractedText || '';

        if (!resumeText && application.resumeUrl) {
          // Fall back to application resume URL if no library resume
          try {
            await requireCandidatePrivacyAllowed(
              { type: 'application', id: applicationId },
              { globalUse: false },
            );
            const buffer = await downloadFromGCS(application.resumeUrl);
            const extraction = await extractResumeText(buffer);

            if (!extraction.success || !validateResumeText(extraction.text)) {
              res.status(400).json({
                error: 'Resume text extraction failed',
                message: extraction.error || 'Unable to extract text from resume.',
              });
              return;
            }

            resumeText = extraction.text;
          } catch (error) {
            console.error('Failed to download/extract resume from GCS:', error);
            res.status(400).json({
              error: 'Resume download failed',
              message: 'Unable to access resume file from storage.',
            });
            return;
          }
        }

        // Get or generate JD digest
        let jdDigest: JDDigest = application.job.jdDigest as JDDigest;

        if (!jdDigest || !application.job.jdDigestVersion || application.job.jdDigestVersion < CURRENT_DIGEST_VERSION) {
          jdDigest = await generateJDDigest(application.job.title, application.job.originalJD || application.job.description, { location: application.job.location });

          // Cache digest
          await db
            .update(jobs)
            .set({
              jdDigest,
              jdDigestVersion: jdDigest.version,
            })
            .where(eq(jobs.id, application.job.id));
        }

        // Reserve only after cache/resume/digest work. The reservation is the
        // concurrency-safe quota authority shared with the background workers.
        const reservationResult = await reserveFitCredit(
          userId,
          applicationId,
          application.aiComputedAt,
          application.job.organizationId ?? undefined
        );
        if (reservationResult.status === 'quota_exceeded') {
          const limits = await getUserLimits(userId);
          res.status(403).json(candidateQuotaExceededPayload(limits));
          return;
        }
        if (reservationResult.status === 'in_progress') {
          res.status(409).json({
            error: 'Match computation already in progress',
            errorCode: 'FIT_COMPUTATION_IN_PROGRESS',
            message: 'A match computation is already running for this application.',
          });
          return;
        }
        if (reservationResult.status === 'generation_changed') {
          res.status(409).json({
            error: 'Match result changed',
            errorCode: 'FIT_GENERATION_CHANGED',
            message: 'The match result changed. Refresh the application and try again if needed.',
          });
          return;
        }
        if (reservationResult.status === 'cached') {
          res.json({
            message: 'Fit score retrieved from cache',
            fit: {
              ...reservationResult.fit,
              cached: true,
            },
          });
          return;
        }
        reservation = reservationResult.reservation;

        await requireCandidatePrivacyAllowed(
          { type: 'application', id: applicationId },
          { globalUse: false },
        );
        const result = await computeFitScore(resumeText, jdDigest);
        await requireCandidatePrivacyAllowed(
          { type: 'application', id: applicationId },
          { globalUse: false },
        );
        const computedAt = await finalizeFitCredit(
          reservation,
          result,
          jdDigest.version,
          application.job.organizationId ?? undefined
        );
        reservation = null;

        res.json({
          message: 'Fit score computed successfully',
          fit: {
            score: result.score,
            label: result.label,
            reasons: result.reasons,
            computedAt,
            cached: false,
            cost: result.costUsd,
            durationMs: result.durationMs,
          },
        });
      } catch (error: any) {
        if (reservation) {
          try {
            await releaseFitCredit(reservation);
          } catch (releaseError) {
            // The short lease self-heals if the database is unavailable here.
            console.error('Failed to release fit credit reservation:', releaseError);
          }
        }
        if (
          error instanceof FitGenerationChangedError &&
          applicationIdForRecovery !== null
        ) {
          const fit = await getPersistedCandidateFit(
            req.user!.id,
            applicationIdForRecovery
          );
          if (fit) {
            res.json({
              message: 'Fit score retrieved from cache',
              fit,
            });
            return;
          }
        }
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        console.error('Fit computation error:', error);

        if (error.message?.includes('Circuit breaker') || error.message?.includes('budget')) {
          res.status(503).json({
            error: 'Service temporarily unavailable',
            message: error.message,
          });
       return;
        }

        res.status(500).json({ error: 'Internal server error' });
     return;
      }
    }
  );

  /**
   * POST /api/ai/match/batch
   * Compute fit scores for multiple applications (batch processing)
   */
  app.post(
    '/api/ai/match/batch',
    requireVerifiedCandidate,
    requireFeatureFlag('match'),
    doubleCsrfProtection,
    batchComputeLimiter,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;

        // Validate body
        const body = batchComputeFitSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error });
       return;
        }

        let { applicationIds } = body.data;

        // Deduplicate input
        applicationIds = [...new Set(applicationIds)];

        // Fetch all applications (validate ownership)
        const apps = await db.query.applications.findMany({
          where: and(inArray(applications.id, applicationIds), applicationPrivacyAllowed()),
          with: {
            job: true,
          },
        });

        const results: Array<{
          applicationId: number;
          success: boolean;
          status: 'success' | 'cached' | 'requiresPaid' | 'unauthorized' | 'error';
          error?: string;
          errorCode?:
            | 'QUOTA_EXCEEDED'
            | 'FIT_COMPUTATION_IN_PROGRESS'
            | 'FIT_GENERATION_CHANGED';
          fit?: any;
        }> = [];

        let computedCount = 0;

        for (const appId of applicationIds) {
          const app = apps.find((application: typeof apps[number]) => application.id === appId);

          // Ownership check
          if (!app || app.userId !== userId) {
            results.push({
              applicationId: appId,
              success: false,
              status: 'unauthorized',
              error: 'Unauthorized or invalid application ID',
            });
            continue;
          }

          try {
            await requireCandidatePrivacyAllowed(
              { type: 'application', id: appId },
              { globalUse: false },
            );
          } catch (error) {
            if (error instanceof CandidatePrivacyRestrictedError) {
              results.push({
                applicationId: appId,
                success: false,
                status: 'unauthorized',
                error: 'Candidate is not available for this action',
              });
              continue;
            }
            throw error;
          }

          // Check if fit is fresh
          // Prefer application-linked resume; fallback to user's default or most recent resume
          let resumeData = app.resumeId
            ? await db.query.candidateResumes.findFirst({
                where: eq(candidateResumes.id, app.resumeId),
              })
            : await db.query.candidateResumes.findFirst({
                where: and(
                  eq(candidateResumes.userId, userId),
                  eq(candidateResumes.isDefault, true as any)
                ),
              });
          if (!resumeData) {
            resumeData = await db.query.candidateResumes.findFirst({
              where: eq(candidateResumes.userId, userId),
              orderBy: (cr: any, { desc }: any) => [desc(cr.updatedAt)],
            });
          }

          const stale = isFitStale(
            app.aiComputedAt,
            resumeData?.updatedAt || null,
            app.job.updatedAt,
            app.job.jdDigestVersion || 1,
            app.aiDigestVersionUsed || null
          );

          // If fresh, return cached (doesn't consume free tier)
          if (!stale && app.aiFitScore !== null) {
            results.push({
              applicationId: appId,
              success: true,
              status: 'cached',
              fit: {
                score: app.aiFitScore,
                label: app.aiFitLabel,
                reasons: app.aiFitReasons,
                computedAt: app.aiComputedAt,
                cached: true,
              },
            });
            continue;
          }

          // Compute fit score
          let reservation: FitCreditReservation | null = null;
          try {
            let resumeText = resumeData?.extractedText || '';

            if (!resumeText && app.resumeUrl) {
              // Fall back to application resume URL if no library resume
              try {
                await requireCandidatePrivacyAllowed(
                  { type: 'application', id: appId },
                  { globalUse: false },
                );
                const buffer = await downloadFromGCS(app.resumeUrl);
                const extraction = await extractResumeText(buffer);

                if (!extraction.success || !validateResumeText(extraction.text)) {
                  results.push({
                    applicationId: appId,
                    success: false,
                    status: 'error',
                    error: extraction.error || 'Unable to extract text from resume.',
                  });
                  continue;
                }

                resumeText = extraction.text;
              } catch (error) {
                console.error(`Failed to download/extract resume from GCS for app ${appId}:`, error);
                results.push({
                  applicationId: appId,
                  success: false,
                  status: 'error',
                  error: 'Unable to access resume file from storage.',
                });
                continue;
              }
            }

            // Get or generate JD digest
            let jdDigest: JDDigest = app.job.jdDigest as JDDigest;

            if (!jdDigest || !app.job.jdDigestVersion || app.job.jdDigestVersion < CURRENT_DIGEST_VERSION) {
              jdDigest = await generateJDDigest(app.job.title, app.job.originalJD || app.job.description, { location: app.job.location });

              await db
                .update(jobs)
                .set({
                  jdDigest,
                  jdDigestVersion: jdDigest.version,
                })
                .where(eq(jobs.id, app.job.id));
            }

            const reservationResult = await reserveFitCredit(
              userId,
              appId,
              app.aiComputedAt,
              app.job.organizationId ?? undefined
            );
            if (reservationResult.status === 'quota_exceeded') {
              results.push({
                applicationId: appId,
                success: false,
                status: 'requiresPaid',
                error: 'No match credits remaining this month.',
                errorCode: 'QUOTA_EXCEEDED',
              });
              continue;
            }
            if (reservationResult.status === 'in_progress') {
              results.push({
                applicationId: appId,
                success: false,
                status: 'error',
                error: 'Match computation already in progress.',
                errorCode: 'FIT_COMPUTATION_IN_PROGRESS',
              });
              continue;
            }
            if (reservationResult.status === 'generation_changed') {
              results.push({
                applicationId: appId,
                success: false,
                status: 'error',
                error: 'Match result changed. Refresh and try again if needed.',
                errorCode: 'FIT_GENERATION_CHANGED',
              });
              continue;
            }
            if (reservationResult.status === 'cached') {
              results.push({
                applicationId: appId,
                success: true,
                status: 'cached',
                fit: {
                  ...reservationResult.fit,
                  cached: true,
                },
              });
              continue;
            }
            reservation = reservationResult.reservation;

            await requireCandidatePrivacyAllowed(
              { type: 'application', id: appId },
              { globalUse: false },
            );
            const result = await computeFitScore(resumeText, jdDigest);
            await requireCandidatePrivacyAllowed(
              { type: 'application', id: appId },
              { globalUse: false },
            );
            const computedAt = await finalizeFitCredit(
              reservation,
              result,
              jdDigest.version,
              app.job.organizationId ?? undefined
            );
            reservation = null;

            results.push({
              applicationId: appId,
              success: true,
              status: 'success',
              fit: {
                score: result.score,
                label: result.label,
                reasons: result.reasons,
                computedAt,
                cached: false,
              },
            });

            computedCount++;

            // Server-side pacing (200ms between calls)
            if (computedCount < applicationIds.length) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          } catch (error: any) {
            if (reservation) {
              try {
                await releaseFitCredit(reservation);
              } catch (releaseError) {
                console.error(
                  `Failed to release fit credit reservation for app ${appId}:`,
                  releaseError
                );
              }
            }
            if (error instanceof FitGenerationChangedError) {
              const fit = await getPersistedCandidateFit(userId, appId);
              if (fit) {
                results.push({
                  applicationId: appId,
                  success: true,
                  status: 'cached',
                  fit,
                });
                continue;
              }
            }
            results.push({
              applicationId: appId,
              success: false,
              status: 'error',
              error: error.message || 'Computation failed',
            });
          }
        }

        res.json({
          message: 'Batch computation completed',
          results,
          summary: {
            total: applicationIds.length,
            successful: results.filter((r) => r.success).length,
            cached: results.filter((r) => r.status === 'cached').length,
            requiresPaid: results.filter((r) => r.status === 'requiresPaid').length,
            errors: results.filter((r) => r.status === 'error' || r.status === 'unauthorized').length,
          },
        });
      } catch (error) {
        console.error('Batch computation error:', error);
        res.status(500).json({ error: 'Internal server error' });
     return;
      }
    }
  );

  /**
   * GET /api/ai/limits
   * Get user's AI usage limits and remaining quota
   */
  app.get(
    '/api/ai/limits',
    requireVerifiedCandidate,
    requireFeatureFlag('match'),
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;
        const limits = await getUserLimits(userId);

        res.json({ limits });
      } catch (error) {
        console.error('Limits error:', error);
        res.status(500).json({ error: 'Internal server error' });
     return;
      }
    }
  );

  /**
   * GET /api/ai/features
   * Get AI feature flag status (no auth required - used for UI decisions)
   */
  app.get('/api/ai/features', (_req, res): void => {
    res.json({
      resumeAdvisor: AI_RESUME_ENABLED && !!GROQ_API_KEY,
      fitScoring: AI_MATCH_ENABLED && !!GROQ_API_KEY,
      queueEnabled: AI_QUEUE_ENABLED && isQueueAvailable(),
    });
  });

  /**
   * GET /api/admin/ai/redis
   * Get Redis connection health status (admin only)
   */
  app.get(
    '/api/admin/ai/redis',
    requireAuth,
    requireRole(['super_admin']),
    (_req, res): void => {
      const health = getRedisHealth();
      res.json({
        redis: health,
        status: health.connected ? 'healthy' : health.usingFallback ? 'fallback' : 'disconnected',
      });
    }
  );

  // ========================================
  // Async Queue Endpoints
  // ========================================

  /**
   * Middleware to gate async endpoints
   * Returns 503 when AI_QUEUE_ENABLED=false or queue unavailable
   */
  function requireAsyncQueue(req: any, res: any, next: any): void {
    if (!AI_QUEUE_ENABLED) {
      res.status(503).json({ error: 'Async analysis not available' });
      return;
    }
    if (!isQueueAvailable()) {
      res.status(503).json({ error: 'Queue service unavailable' });
      return;
    }
    next();
  }

  // Async queue rate limiter
  const asyncQueueLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: 10, // 10 queue requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: any, res: any) => {
      console.warn('[RATE_LIMIT] Async queue limit exceeded', {
        userId: req.user?.id,
        endpoint: req.path,
        ip: req.ip,
      });
      res.status(429).json({
        error: 'Please wait a moment before starting more analyses.',
        errorCode: 'RATE_LIMIT',
      });
    },
  });

  /**
   * POST /api/ai/match/queue
   * Enqueue a single fit computation (async)
   */
  app.post(
    '/api/ai/match/queue',
    requireVerifiedCandidate,
    requireFeatureFlag('match'),
    requireAsyncQueue,
    doubleCsrfProtection,
    asyncQueueLimiter,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;

        const body = asyncQueueSingleSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error });
          return;
        }

        const { applicationId } = body.data;

        // Check for existing pending/active job (deduplication)
        const existingJob = await storage.findPendingAiFitJob(userId, applicationId);
        if (existingJob) {
          res.status(200).json({
            jobId: existingJob.id,
            statusUrl: `/api/ai/match/jobs/${existingJob.id}`,
            totalCount: existingJob.totalCount,
            existing: true,
          });
          return;
        }

        // Check pending job limit
        const pendingCount = await storage.getUserPendingJobCount(userId, QUEUES.INTERACTIVE);
        if (pendingCount >= AI_MAX_PENDING_PER_USER_INTERACTIVE) {
          res.status(429).json({
            error: 'Too many pending analyses. Please wait for current jobs to complete.',
            errorCode: 'PENDING_LIMIT',
            pending: pendingCount,
            max: AI_MAX_PENDING_PER_USER_INTERACTIVE,
          });
          return;
        }

        // Get application with job to check staleness
        const application = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: { job: true },
        });

        if (!application || application.userId !== userId) {
          res.status(404).json({ error: 'Application not found' });
          return;
        }
        await requireCandidatePrivacyAllowed(
          { type: 'application', id: applicationId },
          { globalUse: false },
        );

        // Get resume for staleness check
        let resumeData = application.resumeId
          ? await db.query.candidateResumes.findFirst({
              where: eq(candidateResumes.id, application.resumeId),
            })
          : await db.query.candidateResumes.findFirst({
              where: and(
                eq(candidateResumes.userId, userId),
                eq(candidateResumes.isDefault, true as any)
              ),
            });

        if (!resumeData) {
          resumeData = await db.query.candidateResumes.findFirst({
            where: eq(candidateResumes.userId, userId),
            orderBy: (cr: any, { desc }: any) => [desc(cr.updatedAt)],
          });
        }

        const stale = isFitStale(
          application.aiComputedAt,
          resumeData?.updatedAt || null,
          application.job.updatedAt,
          application.job.jdDigestVersion || 1,
          application.aiDigestVersionUsed || null
        );

        // If fresh, return cached immediately
        if (!stale && application.aiFitScore !== null) {
          res.json({
            cached: true,
            fit: {
              score: application.aiFitScore,
              label: application.aiFitLabel,
              reasons: application.aiFitReasons,
              computedAt: application.aiComputedAt,
            },
          });
          return;
        }

        // Check quota
        const limits = await getUserLimits(userId);
        if (limits.fitRemainingThisMonth < 1) {
          res.status(403).json(candidateQuotaExceededPayload(limits));
          return;
        }

        // Create DB job first with unique placeholder bullJobId
        await requireCandidatePrivacyAllowed(
          { type: 'application', id: applicationId },
          { globalUse: false },
        );
        const dbJob = await storage.createAiFitJob({
          bullJobId: `pending-${randomUUID()}`,
          queueName: QUEUES.INTERACTIVE,
          userId,
          applicationId,
          totalCount: 1,
        });

        // Enqueue with real dbJobId, then update bullJobId
        try {
          await requireCandidatePrivacyAllowed(
            { type: 'application', id: applicationId },
            { globalUse: false },
          );
          const bullJobId = await enqueueInteractive({ applicationId, userId, dbJobId: dbJob.id });
          await storage.updateAiFitJobBullId(dbJob.id, bullJobId);
        } catch (enqueueError) {
          // Mark job as failed if enqueue fails
          await storage.updateAiFitJobStatus(dbJob.id, 'failed', {
            completedAt: new Date(),
            error: enqueueError instanceof Error ? enqueueError.message : 'Enqueue failed',
            errorCode: 'ENQUEUE_FAILED',
          });
          throw enqueueError;
        }

        res.status(202).json({
          jobId: dbJob.id,
          statusUrl: `/api/ai/match/jobs/${dbJob.id}`,
          totalCount: 1,
        });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        console.error('Async queue error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /api/ai/match/batch/queue
   * Enqueue batch fit computation (async, max 50)
   */
  app.post(
    '/api/ai/match/batch/queue',
    requireVerifiedCandidate,
    requireFeatureFlag('match'),
    requireAsyncQueue,
    doubleCsrfProtection,
    asyncQueueLimiter,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;

        const body = asyncQueueBatchSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error });
          return;
        }

        let { applicationIds } = body.data;
        applicationIds = [...new Set(applicationIds)]; // Deduplicate

        // Validate batch size
        if (applicationIds.length > AI_BATCH_MAX) {
          res.status(400).json({
            error: `You can analyze up to ${AI_BATCH_MAX} at a time.`,
            errorCode: 'MAX_EXCEEDED',
            max: AI_BATCH_MAX,
          });
          return;
        }

        // Fetch applications and check ownership first (needed for stale check)
        const apps = await db.query.applications.findMany({
          where: and(inArray(applications.id, applicationIds), applicationPrivacyAllowed()),
          with: { job: true },
        });

        const ownedAppIds = apps.filter((app: typeof apps[0]) => app.userId === userId).map((app: typeof apps[0]) => app.id);
        if (ownedAppIds.length === 0) {
          res.status(404).json({ error: 'No valid applications found' });
          return;
        }

        // Pre-scan for stale applications using same logic as isFitStale
        const staleIds: number[] = [];
        const cachedResults: Array<{ applicationId: number; fit: any }> = [];

        for (const app of apps.filter((a: typeof apps[0]) => ownedAppIds.includes(a.id))) {
          let resumeData = app.resumeId
            ? await db.query.candidateResumes.findFirst({
                where: eq(candidateResumes.id, app.resumeId),
              })
            : await db.query.candidateResumes.findFirst({
                where: and(
                  eq(candidateResumes.userId, userId),
                  eq(candidateResumes.isDefault, true as any)
                ),
              });

          if (!resumeData) {
            resumeData = await db.query.candidateResumes.findFirst({
              where: eq(candidateResumes.userId, userId),
              orderBy: (cr: any, { desc }: any) => [desc(cr.updatedAt)],
            });
          }

          const stale = isFitStale(
            app.aiComputedAt,
            resumeData?.updatedAt || null,
            app.job.updatedAt,
            app.job.jdDigestVersion || 1,
            app.aiDigestVersionUsed || null
          );

          if (stale || app.aiFitScore === null) {
            staleIds.push(app.id);
          } else {
            cachedResults.push({
              applicationId: app.id,
              fit: {
                score: app.aiFitScore,
                label: app.aiFitLabel,
                reasons: app.aiFitReasons,
                cached: true,
              },
            });
          }
        }

        // If all cached, return immediately
        if (staleIds.length === 0) {
          res.json({
            cached: true,
            results: cachedResults,
            summary: {
              total: cachedResults.length,
              cached: cachedResults.length,
              stale: 0,
            },
          });
          return;
        }

        // Check for existing pending/active job with same staleIds (deduplication)
        const existingJob = await storage.findPendingAiFitJob(userId, undefined, staleIds);
        if (existingJob) {
          res.status(200).json({
            jobId: existingJob.id,
            statusUrl: `/api/ai/match/jobs/${existingJob.id}`,
            totalCount: existingJob.totalCount,
            cachedCount: cachedResults.length,
            existing: true,
          });
          return;
        }

        // Check pending job limit
        const pendingCount = await storage.getUserPendingJobCount(userId, QUEUES.BATCH);
        if (pendingCount >= AI_MAX_PENDING_PER_USER_BATCH) {
          res.status(429).json({
            error: 'Too many pending analyses. Please wait for current jobs to complete.',
            errorCode: 'PENDING_LIMIT',
            pending: pendingCount,
            max: AI_MAX_PENDING_PER_USER_BATCH,
          });
          return;
        }

        // Check quota against stale count only
        const limits = await getUserLimits(userId);
        if (staleIds.length > limits.fitRemainingThisMonth) {
          res.status(403).json({
            ...candidateQuotaExceededPayload(limits),
            error: 'Not enough match credits for this batch',
            message: `You have ${limits.fitRemainingThisMonth} of ${limits.fitLimitPerMonth} monthly match credits remaining. Select fewer applications.`,
            staleCount: staleIds.length,
          });
          return;
        }

        // Build initial result with cached items for resume-on-return
        const initialResult: BatchFitResult = {
          results: cachedResults.map(cr => ({
            applicationId: cr.applicationId,
            status: 'cached' as const,
            score: cr.fit.score,
            label: cr.fit.label,
            reasons: cr.fit.reasons,
          })),
          summary: {
            total: staleIds.length + cachedResults.length,
            succeeded: 0,
            cached: cachedResults.length,
            requiresPaid: 0,
            errors: 0,
          },
        };

        // Create DB job first with unique placeholder bullJobId and initial cached results
        for (const applicationId of staleIds) {
          await requireCandidatePrivacyAllowed(
            { type: 'application', id: applicationId },
            { globalUse: false },
          );
        }
        const dbJob = await storage.createAiFitJob({
          bullJobId: `pending-${randomUUID()}`,
          queueName: QUEUES.BATCH,
          userId,
          applicationIds: staleIds,
          totalCount: staleIds.length,
          result: initialResult,
        });

        // Enqueue with real dbJobId, then update bullJobId
        try {
          for (const applicationId of staleIds) {
            await requireCandidatePrivacyAllowed(
              { type: 'application', id: applicationId },
              { globalUse: false },
            );
          }
          const bullJobId = await enqueueBatch({ applicationIds: staleIds, userId, dbJobId: dbJob.id });
          await storage.updateAiFitJobBullId(dbJob.id, bullJobId);
        } catch (enqueueError) {
          // Mark job as failed if enqueue fails
          await storage.updateAiFitJobStatus(dbJob.id, 'failed', {
            completedAt: new Date(),
            error: enqueueError instanceof Error ? enqueueError.message : 'Enqueue failed',
            errorCode: 'ENQUEUE_FAILED',
          });
          throw enqueueError;
        }

        res.status(202).json({
          jobId: dbJob.id,
          statusUrl: `/api/ai/match/jobs/${dbJob.id}`,
          totalCount: staleIds.length,
          cachedCount: cachedResults.length,
        });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        console.error('Async batch queue error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /api/ai/match/jobs/:id
   * Get job status (enforce userId ownership)
   */
  app.get(
    '/api/ai/match/jobs/:id',
    requireVerifiedCandidate,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }
        const jobId = parseInt(idParam, 10);

        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        const job = await storage.getAiFitJobForUser(jobId, userId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        const jobApplicationIds = [
          ...(job.applicationId ? [job.applicationId] : []),
          ...(Array.isArray(job.applicationIds) ? job.applicationIds : []),
        ];
        for (const applicationId of jobApplicationIds) {
          await requireCandidatePrivacyAllowed(
            { type: 'application', id: applicationId },
            { globalUse: false },
          );
        }

        res.json({
          id: job.id,
          status: job.status,
          progress: job.progress,
          processedCount: job.processedCount,
          totalCount: job.totalCount,
          result: job.result,
          error: job.error,
          errorCode: job.errorCode,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(404).json({ code: 'candidate_privacy_restricted' });
          return;
        }
        console.error('Get job status error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /api/ai/match/jobs
   * List user's pending/active jobs (for resume-on-return)
   */
  app.get(
    '/api/ai/match/jobs',
    requireVerifiedCandidate,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;

        const jobs = await storage.getUserAiFitJobs(userId, ['pending', 'active']);

        res.json({
          jobs: jobs.map(j => ({
            id: j.id,
            status: j.status,
            progress: j.progress,
            processedCount: j.processedCount,
            totalCount: j.totalCount,
            createdAt: j.createdAt,
            queueName: j.queueName,
          })),
        });
      } catch (error) {
        console.error('List jobs error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  /**
   * DELETE /api/ai/match/jobs/:id
   * Cancel pending job (enforce userId ownership + remove from BullMQ)
   */
  app.delete(
    '/api/ai/match/jobs/:id',
    requireVerifiedCandidate,
    doubleCsrfProtection,
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }
        const jobId = parseInt(idParam, 10);

        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        // Get job first to get bullJobId
        const job = await storage.getAiFitJobForUser(jobId, userId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        if (job.status !== 'pending' && job.status !== 'active') {
          res.status(400).json({ error: 'Job cannot be cancelled', status: job.status });
          return;
        }

        // Remove from BullMQ
        const queueName = job.queueName as typeof QUEUES[keyof typeof QUEUES];
        await removeJob(queueName, job.bullJobId);

        // Update DB status
        const cancelled = await storage.cancelAiFitJob(jobId, userId);
        if (!cancelled) {
          res.status(400).json({ error: 'Failed to cancel job' });
          return;
        }

        res.json({ cancelled: true });
      } catch (error) {
        console.error('Cancel job error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /api/admin/ai/queue-health
   * Get queue health metrics (admin only)
   */
  app.get(
    '/api/admin/ai/queue-health',
    requireAuth,
    requireRole(['super_admin']),
    async (_req, res): Promise<void> => {
      try {
        if (!AI_QUEUE_ENABLED) {
          res.status(503).json({ error: 'Queue not enabled' });
          return;
        }

        const health = await getQueueHealth();
        res.json(health);
      } catch (error) {
        console.error('Queue health error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /api/admin/ai/jobs/:id/cancel
   * Admin endpoint to cancel any AI job (no CSRF required for admin cleanup)
   */
  app.post(
    '/api/admin/ai/jobs/:id/cancel',
    requireAuth,
    requireRole(['super_admin', 'recruiter']),
    async (req, res): Promise<void> => {
      try {
        const userId = req.user!.id;
        const userRole = req.user!.role;
        const idParam = req.params.id;

        if (!idParam) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        const jobId = parseInt(idParam, 10);
        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        // Get job - super_admin can cancel any job, recruiter can only cancel their own
        const job = userRole === 'super_admin'
          ? await storage.getAiFitJob(jobId)
          : await storage.getAiFitJobForUser(jobId, userId);

        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        // Allow cancelling pending, active, or stuck jobs
        if (job.status === 'completed' || job.status === 'cancelled') {
          res.status(400).json({ error: 'Job already finished', status: job.status });
          return;
        }

        // Try to remove from BullMQ (might fail if queue uses old naming)
        try {
          const queueName = job.queueName as typeof QUEUES[keyof typeof QUEUES];
          await removeJob(queueName, job.bullJobId);
        } catch (queueError) {
          console.warn(`[Admin Cancel] Failed to remove from queue (possibly old queue name):`, queueError);
          // Continue to mark as cancelled in DB even if queue removal fails
        }

        // Force update DB status to cancelled
        await storage.updateAiFitJobStatus(jobId, 'cancelled', {
          completedAt: new Date(),
          error: `Cancelled by admin (user ${userId})`,
          errorCode: 'ADMIN_CANCELLED',
        });

        console.log(`[Admin Cancel] Job ${jobId} cancelled by user ${userId}`);

        res.json({
          cancelled: true,
          jobId,
          message: 'Job cancelled successfully'
        });
      } catch (error) {
        console.error('Admin cancel job error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /api/admin/ai/jobs
   * Admin endpoint to list all AI jobs (for debugging)
   */
  app.get(
    '/api/admin/ai/jobs',
    requireAuth,
    requireRole(['super_admin']),
    async (req, res): Promise<void> => {
      try {
        const status = req.query.status as string | undefined;
        const statuses = status ? [status] : ['pending', 'active', 'failed'];

        const jobs = await storage.getAllAiFitJobs(statuses as any);

        res.json({
          jobs: jobs.map(j => ({
            id: j.id,
            userId: j.userId,
            status: j.status,
            queueName: j.queueName,
            bullJobId: j.bullJobId,
            progress: j.progress,
            processedCount: j.processedCount,
            totalCount: j.totalCount,
            error: j.error,
            errorCode: j.errorCode,
            createdAt: j.createdAt,
            startedAt: j.startedAt,
            completedAt: j.completedAt,
          })),
        });
      } catch (error) {
        console.error('Admin list jobs error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );
}
