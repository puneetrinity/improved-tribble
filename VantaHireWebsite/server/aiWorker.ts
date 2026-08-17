/**
 * AI Worker Process
 *
 * Handles async job processing for AI fit scoring using BullMQ.
 * This is a standalone process, separate from the main web server.
 *
 * Features:
 * - Processes interactive (single) and batch jobs
 * - Server-side chunking for batch jobs
 * - Retry resilience with processedIds tracking
 * - Individual item failures don't fail the batch
 * - Progress updates after each item
 */

import './lib/aiModelStartupGuard';
import { Worker, Job, UnrecoverableError } from 'bullmq';
import { pool } from './db';
import { storage } from './storage';
import { QUEUES, getIoRedisConnection, FitJobData, BatchFitJobData, SummaryBatchJobData } from './lib/aiQueue';
import { computeFitScore, isFitStale, checkCircuitBreaker, trackBudgetSpending, calculateAiCost } from './lib/aiMatchingEngine';
import {
  finalizeFitCredit,
  FitComputationInProgressError,
  FitGenerationChangedError,
  FitQuotaExceededError,
  releaseFitCredit,
  reserveFitCredit,
  type FitCreditReservation,
} from './lib/aiLimits';
import { hasEnoughCredits, useCredits, getCreditCostForOperation } from './lib/creditService';
import { generateJDDigest, JDDigest, CURRENT_DIGEST_VERSION } from './lib/jdDigest';
import { extractResumeText, validateResumeText } from './lib/resumeExtractor';
import { downloadFromGCS } from './gcs-storage';
import { generateCandidateSummary } from './aiJobAnalyzer';
import { db } from './db';
import { candidateResumes, applications, jobs, userAiUsage, users } from '../shared/schema';
import { eq, and } from 'drizzle-orm';
import type { BatchFitResult, BatchFitResultItem } from '../shared/schema';
import { createSourcingRefreshWorker } from './lib/sourcingRefreshWorker';
import { isSourcingRefreshQueueAvailable } from './lib/sourcingRefreshQueue';
import {
  reconcileTerminalBatchFitCollision,
  reconcileTerminalInteractiveFitCollision,
  type FreshFitSnapshot,
} from './lib/fitCollisionReconciliation';

// Summary batch result types
interface SummaryBatchResultItem {
  applicationId: number;
  status: 'success' | 'cached' | 'error' | 'skipped';
  error?: string;
}

interface SummaryBatchResult {
  results: SummaryBatchResultItem[];
  summary: {
    total: number;
    succeeded: number;
    skipped: number;
    errors: number;
  };
}

type WorkerBatchFitResultItem = BatchFitResultItem & {
  errorCode?: 'QUOTA_EXCEEDED';
};

// Environment configuration
const INTERACTIVE_CONCURRENCY = parseInt(process.env.AI_WORKER_INTERACTIVE_CONCURRENCY || '2', 10);
const BATCH_CONCURRENCY = parseInt(process.env.AI_WORKER_BATCH_CONCURRENCY || '1', 10);

/**
 * Get resume data for an application
 */
async function getResumeForApplication(applicationId: number, userId: number): Promise<{
  text: string;
  resumeUpdatedAt: Date | null;
} | null> {
  const app = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
  });

  if (!app) return null;

  // Get resume from library or application
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

  let resumeText = resumeData?.extractedText || '';
  const resumeUpdatedAt = resumeData?.updatedAt || null;

  // Fallback to application resume URL
  if (!resumeText && app.resumeUrl) {
    try {
      const buffer = await downloadFromGCS(app.resumeUrl);
      const extraction = await extractResumeText(buffer);
      if (extraction.success && validateResumeText(extraction.text)) {
        resumeText = extraction.text;
      }
    } catch (error) {
      console.error(`[AI Worker] Failed to extract resume for app ${applicationId}:`, error);
      return null;
    }
  }

  if (!resumeText) {
    return null;
  }

  return { text: resumeText, resumeUpdatedAt };
}

/**
 * Process a single application for fit scoring
 */
async function processOneApplication(
  applicationId: number,
  userId: number
): Promise<{
  cached: boolean;
  score?: number;
  label?: string;
  reasons?: string[];
}> {
  // Get application with job
  const app = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    with: { job: true },
  });

  if (!app || app.userId !== userId) {
    throw new Error(`Application ${applicationId} not found or unauthorized`);
  }

  // Get resume data
  const resume = await getResumeForApplication(applicationId, userId);
  if (!resume) {
    throw new Error(`No resume found for application ${applicationId}`);
  }

  // Check staleness
  const stale = isFitStale(
    app.aiComputedAt,
    resume.resumeUpdatedAt,
    app.job.updatedAt,
    app.job.jdDigestVersion || 1,
    app.aiDigestVersionUsed || null
  );

  // Return cached if fresh
  if (!stale && app.aiFitScore !== null) {
    return {
      cached: true,
      score: app.aiFitScore,
      label: app.aiFitLabel || undefined,
      reasons: (app.aiFitReasons as string[]) || [],
    };
  }

  // Get or generate JD digest
  let jdDigest: JDDigest = app.job.jdDigest as JDDigest;
  if (!jdDigest || !app.job.jdDigestVersion || app.job.jdDigestVersion < CURRENT_DIGEST_VERSION) {
    jdDigest = await generateJDDigest(app.job.title, app.job.originalJD || app.job.description, { location: app.job.location });
    await db.update(jobs).set({
      jdDigest,
      jdDigestVersion: jdDigest.version,
    }).where(eq(jobs.id, app.job.id));
  }

  const reservationResult = await reserveFitCredit(
    userId,
    applicationId,
    app.aiComputedAt,
    app.job.organizationId ?? undefined
  );
  if (reservationResult.status === 'quota_exceeded') {
    throw new FitQuotaExceededError();
  }
  if (reservationResult.status === 'in_progress') {
    throw new FitComputationInProgressError();
  }
  if (reservationResult.status === 'generation_changed') {
    throw new FitGenerationChangedError();
  }
  if (reservationResult.status === 'cached') {
    return {
      cached: true,
      score: reservationResult.fit.score,
      ...(reservationResult.fit.label !== null && {
        label: reservationResult.fit.label,
      }),
      reasons: reservationResult.fit.reasons,
    };
  }
  let reservation: FitCreditReservation | null = reservationResult.reservation;

  try {
    const result = await computeFitScore(resume.text, jdDigest);
    await finalizeFitCredit(
      reservation,
      result,
      jdDigest.version,
      app.job.organizationId ?? undefined
    );
    reservation = null;

    return {
      cached: false,
      score: result.score,
      label: result.label,
      reasons: result.reasons,
    };
  } catch (error) {
    if (reservation) {
      try {
        await releaseFitCredit(reservation);
      } catch (releaseError) {
        // Expired reservations stop counting automatically even if the
        // database is unavailable during this best-effort cleanup.
        console.error(
          `[AI Worker] Failed to release fit credit reservation for app ${applicationId}:`,
          releaseError
        );
      }
    }
    throw error;
  }
}

async function getFreshFitSnapshot(
  applicationId: number,
  userId: number
): Promise<FreshFitSnapshot | null> {
  const app = await db.query.applications.findFirst({
    where: and(
      eq(applications.id, applicationId),
      eq(applications.userId, userId)
    ),
    with: { job: true },
  });
  if (
    !app ||
    !app.aiComputedAt ||
    app.aiFitScore === null ||
    !app.job
  ) {
    return null;
  }

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
      orderBy: (resume: any, { desc }: any) => [desc(resume.updatedAt)],
    });
  }

  const stale = isFitStale(
    app.aiComputedAt,
    resumeData?.updatedAt ?? null,
    app.job.updatedAt,
    app.job.jdDigestVersion || 1,
    app.aiDigestVersionUsed || null
  );
  if (stale) {
    return null;
  }

  return {
    score: app.aiFitScore,
    ...(app.aiFitLabel !== null && { label: app.aiFitLabel }),
    reasons: Array.isArray(app.aiFitReasons)
      ? app.aiFitReasons.filter(
          (reason: unknown): reason is string => typeof reason === 'string'
        )
      : [],
  };
}

/**
 * Build batch result summary
 */
function buildBatchResult(results: WorkerBatchFitResultItem[]): BatchFitResult {
  return {
    results,
    summary: {
      total: results.length,
      succeeded: results.filter(r => r.status === 'success').length,
      cached: results.filter(r => r.status === 'cached').length,
      requiresPaid: results.filter(r => r.status === 'requiresPaid').length,
      errors: results.filter(r => r.status === 'error').length,
    },
  };
}

/**
 * Process interactive (single) fit job
 */
async function processFitJob(job: Job<FitJobData>): Promise<{ success: boolean; result?: any }> {
  const { applicationId, userId, dbJobId } = job.data;

  console.log(`[AI Worker] Processing interactive job ${job.id} for app ${applicationId}`);

  // Update DB status to active
  await storage.updateAiFitJobStatus(dbJobId, 'active', { startedAt: new Date() });

  try {
    // Check circuit breaker
    const breaker = await checkCircuitBreaker();
    if (!breaker.allowed) {
      // Let BullMQ retry later
      throw new Error(breaker.reason || 'Circuit breaker open');
    }

    const result = await processOneApplication(applicationId, userId);

    // Mark completed
    await storage.updateAiFitJobStatus(dbJobId, 'completed', {
      completedAt: new Date(),
      result: {
        cached: result.cached,
        fit: {
          score: result.score,
          label: result.label,
          reasons: result.reasons,
        },
      },
    });

    return { success: true, result };
  } catch (error: any) {
    console.error(`[AI Worker] Interactive job ${job.id} failed:`, error);

    if (
      error instanceof FitComputationInProgressError ||
      error instanceof FitGenerationChangedError
    ) {
      // Keep the durable job visible to polling clients while BullMQ retries.
      // The winning computation will make this retry return cached.
      await storage.updateAiFitJobStatus(dbJobId, 'pending');
      throw error;
    }

    if (error instanceof FitQuotaExceededError) {
      // Non-retryable
      await storage.updateAiFitJobStatus(dbJobId, 'failed', {
        completedAt: new Date(),
        error: error.message,
        errorCode: 'QUOTA_EXCEEDED',
      });
      throw new UnrecoverableError(error.message);
    }

    // Update with error, let BullMQ retry
    await storage.updateAiFitJobStatus(dbJobId, 'failed', {
      completedAt: new Date(),
      error: error.message,
      errorCode: 'TRANSIENT',
    });
    throw error;
  }
}

/**
 * Process batch fit job with chunking
 * Individual item failures are captured in results, not thrown
 */
async function processBatchFitJob(job: Job<BatchFitJobData>): Promise<BatchFitResult> {
  const { applicationIds, userId, dbJobId } = job.data;
  // Create mutable copy for retry resilience tracking
  const processedIds: number[] = job.data.processedIds ? [...job.data.processedIds] : [];

  console.log(`[AI Worker] Processing batch job ${job.id} for ${applicationIds.length} apps`);

  // Check circuit breaker BEFORE starting - if open, throw to let BullMQ retry later
  const initialBreaker = await checkCircuitBreaker();
  if (!initialBreaker.allowed) {
    console.log(`[AI Worker] Circuit breaker open, will retry later: ${initialBreaker.reason}`);
    throw new Error(initialBreaker.reason || 'Circuit breaker open');
  }

  // Update DB status to active
  await storage.updateAiFitJobStatus(dbJobId, 'active', { startedAt: new Date() });

  // Load previous results from DB for retry resilience (includes cached items)
  const existingJob = await storage.getAiFitJob(dbJobId);
  const existingResult = existingJob?.result as BatchFitResult | undefined;
  const results: WorkerBatchFitResultItem[] = existingResult?.results
    ? [...existingResult.results]
    : [];

  // Rebuild processedIds from existing results to handle crash-after-write scenarios
  // This ensures we don't duplicate entries even if job.data.processedIds is stale
  const processedIdsFromResults = new Set(results.map(r => r.applicationId));
  for (const id of processedIds) {
    processedIdsFromResults.add(id);
  }
  const finalProcessedIds: number[] = [...processedIdsFromResults];

  // Create a set of stale IDs for progress calculation (excludes cached items)
  const staleIdSet = new Set(applicationIds);

  // Skip already processed IDs (for retry resilience)
  const remaining = applicationIds.filter((id: number) => !finalProcessedIds.includes(id));

  for (let i = 0; i < remaining.length; i++) {
    const appId = remaining[i]!; // Safe: we're iterating within bounds

    try {
      // Check circuit breaker before each item - if open, throw to retry the batch
      const breaker = await checkCircuitBreaker();
      if (!breaker.allowed) {
        // Save progress and throw - BullMQ will retry with backoff
        await job.updateData({ ...job.data, processedIds: finalProcessedIds });
        throw new Error(breaker.reason || 'Circuit breaker open');
      }

      const result = await processOneApplication(appId, userId);
      const resultItem: WorkerBatchFitResultItem = {
        applicationId: appId,
        status: result.cached ? 'cached' : 'success',
      };
      if (result.score !== undefined) resultItem.score = result.score;
      if (result.label !== undefined) resultItem.label = result.label;
      if (result.reasons !== undefined) resultItem.reasons = result.reasons;
      results.push(resultItem);
      finalProcessedIds.push(appId);
    } catch (error: any) {
      if (
        error instanceof FitComputationInProgressError ||
        error instanceof FitGenerationChangedError
      ) {
        await job.updateData({ ...job.data, processedIds: finalProcessedIds });
        throw error;
      }

      // Circuit breaker errors should be thrown to let BullMQ retry
      if (error.message?.includes('Circuit breaker')) {
        throw error;
      }

      // Capture individual failures - don't throw!
      if (error instanceof FitQuotaExceededError) {
        // Mark this and remaining as requiresPaid
        results.push({
          applicationId: appId,
          status: 'requiresPaid',
          error: error.message,
          errorCode: 'QUOTA_EXCEEDED',
        });
        finalProcessedIds.push(appId);

        // Mark remaining apps
        for (const remainingId of remaining.slice(i + 1)) {
          results.push({
            applicationId: remainingId,
            status: 'requiresPaid',
            error: 'No match credits remaining this month',
            errorCode: 'QUOTA_EXCEEDED',
          });
          finalProcessedIds.push(remainingId);
        }
        break;
      } else {
        results.push({ applicationId: appId, status: 'error', error: error.message });
        finalProcessedIds.push(appId);
      }
    }

    // Update progress after each item (merge with existing results)
    // Only count stale items for progress (exclude cached items from initialResult)
    const staleProcessedCount = finalProcessedIds.filter(id => staleIdSet.has(id)).length;
    const batchResult = buildBatchResult(results);
    await storage.updateAiFitJobProgress(dbJobId, {
      processedCount: staleProcessedCount,
      progress: Math.round((staleProcessedCount / applicationIds.length) * 100),
      result: batchResult,
    });

    // Update job data for retry resilience
    await job.updateData({ ...job.data, processedIds: finalProcessedIds });

    // Small delay between items to avoid rate limiting
    if (i < remaining.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Final result
  const finalResult = buildBatchResult(results);

  // Mark completed
  await storage.updateAiFitJobStatus(dbJobId, 'completed', {
    completedAt: new Date(),
    result: finalResult,
  });

  return finalResult;
}

// ============= SUMMARY BATCH PROCESSING =============

/**
 * Get resume text for an application (recruiter context - no userId restriction)
 */
async function getResumeTextForApplication(applicationId: number): Promise<string | null> {
  const app = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
  });

  if (!app) return null;

  // First try to get from candidate resume library
  if (app.resumeId) {
    const resume = await db.query.candidateResumes.findFirst({
      where: eq(candidateResumes.id, app.resumeId),
    });
    if (resume?.extractedText) {
      return resume.extractedText;
    }
  }

  // If application has userId, check their default resume
  if (app.userId) {
    const defaultResume = await db.query.candidateResumes.findFirst({
      where: and(
        eq(candidateResumes.userId, app.userId),
        eq(candidateResumes.isDefault, true as any)
      ),
    });
    if (defaultResume?.extractedText) {
      return defaultResume.extractedText;
    }
  }

  // Fallback to extracting from resume URL
  if (app.resumeUrl) {
    try {
      const buffer = await downloadFromGCS(app.resumeUrl);
      const extraction = await extractResumeText(buffer);
      if (extraction.success && validateResumeText(extraction.text)) {
        return extraction.text;
      }
    } catch (error) {
      console.error(`[AI Worker] Failed to extract resume for app ${applicationId}:`, error);
    }
  }

  return null;
}

/**
 * Process one application for summary generation
 */
async function processOneSummary(
  applicationId: number,
  recruiterId: number,
  regenerate: boolean
): Promise<{
  status: 'success' | 'cached' | 'error' | 'skipped';
  error?: string;
}> {
  // Get application with job
  const app = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    with: { job: true },
  });

  if (!app) {
    return { status: 'error', error: 'Application not found' };
  }

  // Check if already has summary and not regenerating
  if (app.aiSummary && !regenerate) {
    return { status: 'cached' };
  }

  // Get resume text
  const resumeText = await getResumeTextForApplication(applicationId);
  if (!resumeText) {
    return { status: 'skipped', error: 'No resume available' };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, recruiterId),
    columns: { role: true },
  });

  if (!user) {
    return { status: 'error', error: 'Recruiter not found' };
  }

  const creditCost = getCreditCostForOperation('summary');
  const isSuperAdmin = user.role === 'super_admin';

  if (!isSuperAdmin) {
    const hasCredits = await hasEnoughCredits(recruiterId, creditCost);
    if (!hasCredits) {
      return { status: 'error', error: 'Insufficient AI credits' };
    }
  }

  // Generate summary
  const startTime = Date.now();
  const result = await generateCandidateSummary(
    resumeText,
    app.job.title,
    app.job.description,
    app.name,
    app.job.skills || [],
    app.job.goodToHaveSkills || []
  );
  const durationMs = Date.now() - startTime;

  // Calculate cost using shared pricing helper
  const costUsd = parseFloat(calculateAiCost(result.tokensUsed.input, result.tokensUsed.output));

  // Track budget spending (updates circuit breaker)
  await trackBudgetSpending(costUsd);

  // Update application with summary
  await db.update(applications).set({
    aiSummary: result.summary,
    aiStrengths: result.strengths,
    aiConcerns: result.concerns,
    aiKeyHighlights: result.keyHighlights,
    aiSuggestedAction: result.suggestedAction,
    aiSuggestedActionReason: result.suggestedActionReason,
    aiSummaryComputedAt: new Date(),
    aiSummaryModelVersion: result.model_version,
    // Skill analysis fields
    aiRequiredSkillsMatched: result.requiredSkillsMatched,
    aiRequiredSkillsMissing: result.requiredSkillsMissing,
    aiRequiredSkillsMatchPercentage: result.requiredSkillsMatchPercentage,
    aiRequiredSkillsDepthNotes: result.requiredSkillsDepthNotes,
    aiGoodToHaveSkillsMatched: result.goodToHaveSkillsMatched,
    aiGoodToHaveSkillsMissing: result.goodToHaveSkillsMissing,
  }).where(eq(applications.id, applicationId));

  // Log AI usage
  await db.insert(userAiUsage).values({
    organizationId: app.job.organizationId ?? undefined,
    userId: recruiterId,
    kind: 'summary',
    tokensIn: result.tokensUsed.input,
    tokensOut: result.tokensUsed.output,
    costUsd: costUsd.toFixed(8),
    computedAt: new Date(),
    metadata: {
      applicationId,
      durationMs,
    },
  });

  if (!isSuperAdmin) {
    const creditResult = await useCredits(recruiterId, creditCost);
    if (!creditResult.success) {
      console.warn(
        `[AI Worker] Failed to deduct credits for user ${recruiterId}: ${creditResult.message || 'unknown error'}`
      );
    }
  }

  return { status: 'success' };
}

/**
 * Build summary batch result
 */
function buildSummaryBatchResult(results: SummaryBatchResultItem[]): SummaryBatchResult {
  return {
    results,
    summary: {
      total: results.length,
      succeeded: results.filter(r => r.status === 'success').length,
      skipped: results.filter(r => r.status === 'skipped' || r.status === 'cached').length,
      errors: results.filter(r => r.status === 'error').length,
    },
  };
}

/**
 * Process summary batch job
 */
async function processSummaryBatchJob(job: Job<SummaryBatchJobData>): Promise<SummaryBatchResult> {
  const { applicationIds, recruiterId, dbJobId, regenerate } = job.data;
  const processedIds: number[] = job.data.processedIds ? [...job.data.processedIds] : [];

  console.log(`[AI Worker] Processing summary batch job ${job.id} for ${applicationIds.length} apps`);

  // Check circuit breaker before starting
  const initialBreaker = await checkCircuitBreaker();
  if (!initialBreaker.allowed) {
    console.log(`[AI Worker] Circuit breaker open, will retry later: ${initialBreaker.reason}`);
    throw new Error(initialBreaker.reason || 'Circuit breaker open');
  }

  // Update DB status to active
  await storage.updateAiFitJobStatus(dbJobId, 'active', { startedAt: new Date() });

  // Load previous results from DB for retry resilience
  const existingJob = await storage.getAiFitJob(dbJobId);
  const existingResult = existingJob?.result as SummaryBatchResult | undefined;
  const results: SummaryBatchResultItem[] = existingResult?.results ? [...existingResult.results] : [];

  // Rebuild processedIds from existing results
  const processedIdsFromResults = new Set(results.map(r => r.applicationId));
  for (const id of processedIds) {
    processedIdsFromResults.add(id);
  }
  const finalProcessedIds: number[] = [...processedIdsFromResults];

  // Skip already processed IDs
  const remaining = applicationIds.filter((id: number) => !finalProcessedIds.includes(id));

  for (let i = 0; i < remaining.length; i++) {
    const appId = remaining[i]!;

    try {
      // Check circuit breaker before each item
      const breaker = await checkCircuitBreaker();
      if (!breaker.allowed) {
        await job.updateData({ ...job.data, processedIds: finalProcessedIds });
        throw new Error(breaker.reason || 'Circuit breaker open');
      }

      const result = await processOneSummary(appId, recruiterId, regenerate);
      results.push({ applicationId: appId, ...result });
      finalProcessedIds.push(appId);
    } catch (error: any) {
      // Circuit breaker errors should be thrown to let BullMQ retry
      if (error.message?.includes('Circuit breaker')) {
        throw error;
      }

      // Capture individual failures
      results.push({ applicationId: appId, status: 'error', error: error.message });
      finalProcessedIds.push(appId);
    }

    // Update progress after each item
    const batchResult = buildSummaryBatchResult(results);
    await storage.updateAiFitJobProgress(dbJobId, {
      processedCount: finalProcessedIds.length,
      progress: Math.round((finalProcessedIds.length / applicationIds.length) * 100),
      result: batchResult,
    });

    // Update job data for retry resilience
    await job.updateData({ ...job.data, processedIds: finalProcessedIds });

    // Small delay between items to avoid rate limiting
    if (i < remaining.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Final result
  const finalResult = buildSummaryBatchResult(results);

  // Mark completed
  await storage.updateAiFitJobStatus(dbJobId, 'completed', {
    completedAt: new Date(),
    result: finalResult,
  });

  return finalResult;
}

// Shutdown handling
async function shutdown(signal: string): Promise<void> {
  console.log(`[AI Worker] Received ${signal}, shutting down...`);

  // Workers will be closed via aiQueue.closeQueues() SIGTERM handler
  await pool?.end?.();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Redis namespace must match the queue prefix used in aiQueue.ts
const REDIS_NAMESPACE = process.env.NODE_ENV || 'development';

// Main entry
async function main(): Promise<void> {
  console.log('[AI Worker] Starting AI worker...');
  console.log(`[AI Worker] Interactive concurrency: ${INTERACTIVE_CONCURRENCY}`);
  console.log(`[AI Worker] Batch concurrency: ${BATCH_CONCURRENCY}`);
  console.log(`[AI Worker] Redis prefix: {${REDIS_NAMESPACE}}`);

  // Cast connection to any - BullMQ bundles its own ioredis with slightly different types
  const connection = getIoRedisConnection() as any;

  // Interactive worker - must use same prefix as queue
  const interactiveWorker = new Worker(QUEUES.INTERACTIVE, processFitJob, {
    connection,
    concurrency: INTERACTIVE_CONCURRENCY,
    prefix: `{${REDIS_NAMESPACE}}`,
  });

  interactiveWorker.on('completed', (job: Job) => {
    console.log(`[AI Worker] Interactive job ${job.id} completed`);
  });

  interactiveWorker.on('failed', (job: Job<FitJobData> | undefined, error: Error) => {
    console.error(`[AI Worker] Interactive job ${job?.id} failed:`, error.message);
    if (!job) {
      return;
    }
    void reconcileTerminalInteractiveFitCollision(job, error, {
      getDurableJob: (dbJobId) => storage.getAiFitJob(dbJobId),
      getFreshFit: getFreshFitSnapshot,
      updateStatus: (dbJobId, status, updates) =>
        storage.updateAiFitJobStatus(dbJobId, status, updates),
      updateProgress: (dbJobId, updates) =>
        storage.updateAiFitJobProgress(dbJobId, updates),
      now: () => new Date(),
    })
      .then((outcome) => {
        if (outcome !== 'ignored') {
          console.log(
            `[AI Worker] Reconciled terminal interactive collision for DB job ${job.data.dbJobId}: ${outcome}`
          );
        }
      })
      .catch((reconciliationError) => {
        console.error(
          `[AI Worker] Failed to reconcile terminal interactive collision for DB job ${job.data.dbJobId}:`,
          reconciliationError
        );
      });
  });

  // Batch worker - handles both fit and summary batch jobs
  const batchWorker = new Worker(
    QUEUES.BATCH,
    async (job: Job<BatchFitJobData | SummaryBatchJobData>) => {
      // Check job name to determine type
      if (job.name === 'batch-summary' || (job.data as SummaryBatchJobData).jobType === 'summary') {
        return processSummaryBatchJob(job as Job<SummaryBatchJobData>);
      } else {
        return processBatchFitJob(job as Job<BatchFitJobData>);
      }
    },
    {
      connection,
      concurrency: BATCH_CONCURRENCY,
      prefix: `{${REDIS_NAMESPACE}}`,
    }
  );

  batchWorker.on('completed', (job: Job) => {
    const jobType = job.name === 'batch-summary' ? 'summary' : 'fit';
    console.log(`[AI Worker] Batch ${jobType} job ${job.id} completed`);
  });

  batchWorker.on('failed', (job: Job | undefined, error: Error) => {
    const jobType = job?.name === 'batch-summary' ? 'summary' : 'fit';
    console.error(`[AI Worker] Batch ${jobType} job ${job?.id} failed:`, error.message);
    if (!job || jobType !== 'fit') {
      return;
    }
    const fitJob = job as Job<BatchFitJobData>;
    void reconcileTerminalBatchFitCollision(fitJob, error, {
      getDurableJob: (dbJobId) => storage.getAiFitJob(dbJobId),
      getFreshFit: getFreshFitSnapshot,
      updateStatus: (dbJobId, status, updates) =>
        storage.updateAiFitJobStatus(dbJobId, status, updates),
      updateProgress: (dbJobId, updates) =>
        storage.updateAiFitJobProgress(dbJobId, updates),
      now: () => new Date(),
    })
      .then((outcome) => {
        if (outcome !== 'ignored') {
          console.log(
            `[AI Worker] Reconciled terminal batch collision for DB job ${fitJob.data.dbJobId}: ${outcome}`
          );
        }
      })
      .catch((reconciliationError) => {
        console.error(
          `[AI Worker] Failed to reconcile terminal batch collision for DB job ${fitJob.data.dbJobId}:`,
          reconciliationError
        );
      });
  });

  if (isSourcingRefreshQueueAvailable()) {
    const sourcingRefreshWorker = createSourcingRefreshWorker(connection);
    sourcingRefreshWorker.on('completed', (job: Job) => {
      console.log(`[AI Worker] Sourcing refresh job ${job.id} completed`);
    });
    sourcingRefreshWorker.on('failed', (job: Job | undefined, error: Error) => {
      console.error(`[AI Worker] Sourcing refresh job ${job?.id} failed:`, error.message);
    });
    console.log('[AI Worker] Sourcing refresh worker enabled');
  } else {
    console.log('[AI Worker] Sourcing refresh worker disabled');
  }

  console.log('[AI Worker] Workers started, waiting for jobs...');
}

main().catch(async (err) => {
  console.error('[AI Worker] Fatal error:', err);
  await pool?.end?.();
  process.exit(1);
});
