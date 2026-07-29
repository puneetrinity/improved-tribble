// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIT_COLLISION_RETRYABLE_ERROR_CODE,
  reconcileTerminalBatchFitCollision,
  reconcileTerminalInteractiveFitCollision,
  type FreshFitSnapshot,
} from '../fitCollisionReconciliation';

const completedAt = new Date('2026-07-29T12:00:00.000Z');
const winner: FreshFitSnapshot = {
  score: 84,
  label: 'Strong',
  reasons: ['Relevant experience'],
};

function collisionError(
  name: 'FitComputationInProgressError' | 'FitGenerationChangedError' =
    'FitComputationInProgressError'
): Error {
  const error = new Error('collision');
  error.name = name;
  Object.assign(error, {
    code:
      name === 'FitComputationInProgressError'
        ? 'FIT_COMPUTATION_IN_PROGRESS'
        : 'FIT_GENERATION_CHANGED',
  });
  return error;
}

function finalJob<T>(data: T) {
  return {
    data,
    attemptsMade: 3,
    finishedOn: completedAt.getTime(),
    opts: { attempts: 3 },
  };
}

function createDependencies(options?: {
  durableStatus?: string;
  durableResult?: unknown;
  fit?: FreshFitSnapshot | null;
}) {
  return {
    getDurableJob: vi.fn(async () => ({
      status: options?.durableStatus ?? 'pending',
      result: options?.durableResult ?? null,
    })),
    getFreshFit: vi.fn(async () =>
      options && 'fit' in options ? options.fit ?? null : winner
    ),
    updateStatus: vi.fn(async () => undefined),
    updateProgress: vi.fn(async () => undefined),
    now: vi.fn(() => completedAt),
  };
}

describe('terminal fit collision reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not reconcile an intermediate BullMQ collision attempt', async () => {
    const deps = createDependencies();
    const job = {
      data: { applicationId: 10, userId: 4, dbJobId: 90 },
      attemptsMade: 2,
      opts: { attempts: 3 },
    };

    await expect(
      reconcileTerminalInteractiveFitCollision(
        job,
        collisionError(),
        deps
      )
    ).resolves.toBe('ignored');

    expect(deps.getDurableJob).not.toHaveBeenCalled();
    expect(deps.getFreshFit).not.toHaveBeenCalled();
    expect(deps.updateStatus).not.toHaveBeenCalled();
  });

  it('completes an interactive durable job from the fresh cached winner', async () => {
    const deps = createDependencies();
    const job = finalJob({
      applicationId: 10,
      userId: 4,
      dbJobId: 90,
    });

    await expect(
      reconcileTerminalInteractiveFitCollision(
        job,
        collisionError('FitGenerationChangedError'),
        deps
      )
    ).resolves.toBe('completed_cached');

    expect(deps.getFreshFit).toHaveBeenCalledWith(10, 4);
    expect(deps.updateStatus).toHaveBeenCalledWith(90, 'completed', {
      completedAt,
      result: {
        cached: true,
        fit: winner,
      },
      error: null,
      errorCode: null,
    });
  });

  it('terminally fails an interactive job when no fresh winner exists', async () => {
    const deps = createDependencies({ fit: null });

    await expect(
      reconcileTerminalInteractiveFitCollision(
        finalJob({ applicationId: 10, userId: 4, dbJobId: 90 }),
        collisionError(),
        deps
      )
    ).resolves.toBe('failed_retryable');

    expect(deps.updateStatus).toHaveBeenCalledWith(
      90,
      'failed',
      expect.objectContaining({
        completedAt,
        errorCode: FIT_COLLISION_RETRYABLE_ERROR_CODE,
      })
    );
  });

  it('completes a batch with the cached winner and marks its unprocessed tail retryable', async () => {
    const deps = createDependencies({
      durableResult: {
        results: [
          {
            applicationId: 10,
            status: 'success',
            score: 75,
          },
        ],
        summary: {
          total: 1,
          succeeded: 1,
          cached: 0,
          requiresPaid: 0,
          errors: 0,
        },
      },
    });
    const job = finalJob({
      applicationIds: [10, 11, 12],
      processedIds: [10],
      userId: 4,
      dbJobId: 91,
    });

    await expect(
      reconcileTerminalBatchFitCollision(job, collisionError(), deps)
    ).resolves.toBe('completed_cached');

    expect(deps.getFreshFit).toHaveBeenCalledWith(11, 4);
    const expectedResult = {
      results: [
        {
          applicationId: 10,
          status: 'success',
          score: 75,
        },
        {
          applicationId: 11,
          status: 'cached',
          score: 84,
          label: 'Strong',
          reasons: ['Relevant experience'],
        },
        {
          applicationId: 12,
          status: 'error',
          error:
            'The batch stopped after another match calculation won. Retry this application.',
          errorCode: FIT_COLLISION_RETRYABLE_ERROR_CODE,
        },
      ],
      summary: {
        total: 3,
        succeeded: 1,
        cached: 1,
        requiresPaid: 0,
        errors: 1,
      },
    };
    expect(deps.updateProgress).toHaveBeenCalledWith(91, {
      processedCount: 3,
      progress: 100,
      result: expectedResult,
    });
    expect(deps.updateStatus).toHaveBeenCalledWith(91, 'completed', {
      completedAt,
      result: expectedResult,
      error: null,
      errorCode: null,
    });
  });

  it('terminally fails a batch when the collision has no fresh winner', async () => {
    const deps = createDependencies({
      durableResult: { results: [] },
      fit: null,
    });

    await expect(
      reconcileTerminalBatchFitCollision(
        finalJob({
          applicationIds: [11, 12],
          processedIds: [],
          userId: 4,
          dbJobId: 91,
        }),
        collisionError('FitGenerationChangedError'),
        deps
      )
    ).resolves.toBe('failed_retryable');

    expect(deps.updateProgress).not.toHaveBeenCalled();
    expect(deps.updateStatus).toHaveBeenCalledWith(
      91,
      'failed',
      expect.objectContaining({
        completedAt,
        errorCode: FIT_COLLISION_RETRYABLE_ERROR_CODE,
      })
    );
  });

  it('never overwrites a durable job that already completed or was cancelled', async () => {
    for (const durableStatus of ['completed', 'cancelled']) {
      const deps = createDependencies({ durableStatus });
      await expect(
        reconcileTerminalInteractiveFitCollision(
          finalJob({ applicationId: 10, userId: 4, dbJobId: 90 }),
          collisionError(),
          deps
        )
      ).resolves.toBe('ignored');

      expect(deps.getFreshFit).not.toHaveBeenCalled();
      expect(deps.updateStatus).not.toHaveBeenCalled();
    }
  });
});
