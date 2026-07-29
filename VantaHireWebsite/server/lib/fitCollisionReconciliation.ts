import type { BatchFitResult, BatchFitResultItem } from '../../shared/schema';

export const FIT_COLLISION_RETRYABLE_ERROR_CODE =
  'FIT_COLLISION_RETRYABLE' as const;

const FIT_COLLISION_ERROR_CODES = new Set([
  'FIT_COMPUTATION_IN_PROGRESS',
  'FIT_GENERATION_CHANGED',
]);

const FIT_COLLISION_ERROR_NAMES = new Set([
  'FitComputationInProgressError',
  'FitGenerationChangedError',
]);

export interface FreshFitSnapshot {
  score: number;
  label?: string;
  reasons: string[];
}

interface DurableFitJobSnapshot {
  status: string;
  result: unknown;
}

interface BullFailureSnapshot {
  attemptsMade: number;
  finishedOn?: number;
  opts: {
    attempts?: number;
  };
}

interface InteractiveFitJobData {
  applicationId: number;
  userId: number;
  dbJobId: number;
}

interface BatchFitJobData {
  applicationIds: number[];
  processedIds?: number[];
  userId: number;
  dbJobId: number;
}

interface ReconciliationDependencies {
  getDurableJob(dbJobId: number): Promise<DurableFitJobSnapshot | undefined>;
  getFreshFit(
    applicationId: number,
    userId: number
  ): Promise<FreshFitSnapshot | null>;
  updateStatus(
    dbJobId: number,
    status: 'completed' | 'failed',
    updates: {
      completedAt: Date;
      result?: unknown;
      error?: string | null;
      errorCode?: string | null;
    }
  ): Promise<unknown>;
  updateProgress(
    dbJobId: number,
    updates: {
      processedCount: number;
      progress: number;
      result: BatchFitResult;
    }
  ): Promise<unknown>;
  now(): Date;
}

export type CollisionReconciliationOutcome =
  | 'ignored'
  | 'completed_cached'
  | 'failed_retryable';

type BatchCollisionResultItem = BatchFitResultItem & {
  errorCode?: typeof FIT_COLLISION_RETRYABLE_ERROR_CODE;
};

function isTerminalBullFailure(job: BullFailureSnapshot): boolean {
  const attempts = Math.max(1, job.opts.attempts ?? 1);
  return job.finishedOn != null || job.attemptsMade >= attempts;
}

function isFitCollisionError(error: Error): boolean {
  const code = (error as Error & { code?: unknown }).code;
  return (
    (typeof code === 'string' && FIT_COLLISION_ERROR_CODES.has(code)) ||
    FIT_COLLISION_ERROR_NAMES.has(error.name)
  );
}

function parseBatchResults(result: unknown): BatchCollisionResultItem[] {
  if (!result || typeof result !== 'object') {
    return [];
  }

  const results = (result as { results?: unknown }).results;
  return Array.isArray(results)
    ? results.filter(
        (item): item is BatchCollisionResultItem =>
          Boolean(
            item &&
              typeof item === 'object' &&
              Number.isInteger(
                (item as { applicationId?: unknown }).applicationId
              )
          )
      )
    : [];
}

function buildBatchResult(
  results: BatchCollisionResultItem[]
): BatchFitResult {
  return {
    results,
    summary: {
      total: results.length,
      succeeded: results.filter((result) => result.status === 'success').length,
      cached: results.filter((result) => result.status === 'cached').length,
      requiresPaid: results.filter(
        (result) => result.status === 'requiresPaid'
      ).length,
      errors: results.filter((result) => result.status === 'error').length,
    },
  };
}

async function markRetryableFailure(
  dbJobId: number,
  deps: ReconciliationDependencies
): Promise<'failed_retryable'> {
  await deps.updateStatus(dbJobId, 'failed', {
    completedAt: deps.now(),
    error:
      'Another match calculation was still changing this application. Retry the analysis.',
    errorCode: FIT_COLLISION_RETRYABLE_ERROR_CODE,
  });
  return 'failed_retryable';
}

async function shouldReconcile(
  job: BullFailureSnapshot,
  error: Error,
  dbJobId: number,
  deps: ReconciliationDependencies
): Promise<DurableFitJobSnapshot | null> {
  if (!isFitCollisionError(error) || !isTerminalBullFailure(job)) {
    return null;
  }

  const durableJob = await deps.getDurableJob(dbJobId);
  if (
    !durableJob ||
    durableJob.status === 'completed' ||
    durableJob.status === 'cancelled'
  ) {
    return null;
  }
  return durableJob;
}

export async function reconcileTerminalInteractiveFitCollision(
  job: BullFailureSnapshot & { data: InteractiveFitJobData },
  error: Error,
  deps: ReconciliationDependencies
): Promise<CollisionReconciliationOutcome> {
  const durableJob = await shouldReconcile(
    job,
    error,
    job.data.dbJobId,
    deps
  );
  if (!durableJob) {
    return 'ignored';
  }

  const fit = await deps.getFreshFit(job.data.applicationId, job.data.userId);
  if (!fit) {
    return markRetryableFailure(job.data.dbJobId, deps);
  }

  await deps.updateStatus(job.data.dbJobId, 'completed', {
    completedAt: deps.now(),
    result: {
      cached: true,
      fit,
    },
    error: null,
    errorCode: null,
  });
  return 'completed_cached';
}

export async function reconcileTerminalBatchFitCollision(
  job: BullFailureSnapshot & { data: BatchFitJobData },
  error: Error,
  deps: ReconciliationDependencies
): Promise<CollisionReconciliationOutcome> {
  const durableJob = await shouldReconcile(
    job,
    error,
    job.data.dbJobId,
    deps
  );
  if (!durableJob) {
    return 'ignored';
  }

  const results = parseBatchResults(durableJob.result);
  const resolvedIds = new Set([
    ...results.map((result) => result.applicationId),
    ...(job.data.processedIds ?? []),
  ]);
  const collisionApplicationId = job.data.applicationIds.find(
    (applicationId) => !resolvedIds.has(applicationId)
  );

  if (collisionApplicationId == null) {
    const finalResult = buildBatchResult(results);
    await deps.updateProgress(job.data.dbJobId, {
      processedCount: job.data.applicationIds.length,
      progress: 100,
      result: finalResult,
    });
    await deps.updateStatus(job.data.dbJobId, 'completed', {
      completedAt: deps.now(),
      result: finalResult,
      error: null,
      errorCode: null,
    });
    return 'completed_cached';
  }

  const fit = await deps.getFreshFit(
    collisionApplicationId,
    job.data.userId
  );
  if (!fit) {
    return markRetryableFailure(job.data.dbJobId, deps);
  }

  results.push({
    applicationId: collisionApplicationId,
    status: 'cached',
    score: fit.score,
    ...(fit.label !== undefined && { label: fit.label }),
    reasons: fit.reasons,
  });
  resolvedIds.add(collisionApplicationId);

  for (const applicationId of job.data.applicationIds) {
    if (resolvedIds.has(applicationId)) {
      continue;
    }
    results.push({
      applicationId,
      status: 'error',
      error:
        'The batch stopped after another match calculation won. Retry this application.',
      errorCode: FIT_COLLISION_RETRYABLE_ERROR_CODE,
    });
    resolvedIds.add(applicationId);
  }

  const finalResult = buildBatchResult(results);
  await deps.updateProgress(job.data.dbJobId, {
    processedCount: job.data.applicationIds.length,
    progress: 100,
    result: finalResult,
  });
  await deps.updateStatus(job.data.dbJobId, 'completed', {
    completedAt: deps.now(),
    result: finalResult,
    error: null,
    errorCode: null,
  });
  return 'completed_cached';
}
