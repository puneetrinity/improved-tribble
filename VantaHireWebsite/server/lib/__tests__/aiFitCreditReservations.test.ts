// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  application: {} as Record<string, any>,
  nextId: 1,
  failApplicationUpdate: false,
  transactionTail: Promise.resolve(),
}));

vi.mock('../../db', () => {
  function result(rows: Array<Record<string, any>>) {
    return {
      limit: async (count: number) => rows.slice(0, count),
      then: (
        resolve: (value: Array<Record<string, any>>) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve(rows).then(resolve, reject),
    };
  }

  function executor(inTransaction: boolean) {
    return {
      execute: async () => undefined,
      select: (shape: Record<string, unknown>) => ({
        from: () => ({
          where: () => {
            if ('used' in shape && 'pending' in shape) {
              const now = new Date();
              const startOfMonth = new Date(
                now.getFullYear(),
                now.getMonth(),
                1
              ).getTime();
              const activeCutoff = now.getTime() - 30 * 60 * 1000;
              return result([{
                used: state.rows.filter(
                  (row) =>
                    row.kind === 'fit' &&
                    row.computedAt.getTime() >= startOfMonth
                ).length,
                pending: state.rows.filter(
                  (row) =>
                    row.kind === 'fit_pending' &&
                    row.computedAt.getTime() >= startOfMonth &&
                    row.computedAt.getTime() >= activeCutoff
                ).length,
              }]);
            }
            if ('aiComputedAt' in shape) {
              return result([{ ...state.application }]);
            }
            if ('metadata' in shape) {
              const activeCutoff = Date.now() - 30 * 60 * 1000;
              return result(
                state.rows
                  .filter(
                    (row) =>
                      row.kind === 'fit_pending' &&
                      row.computedAt.getTime() >= activeCutoff
                  )
                  .map((row) => ({ metadata: row.metadata }))
              );
            }
            return result(
              state.rows
                .filter((row) => row.kind === 'fit_pending')
                .map((row) => ({ id: row.id }))
            );
          },
        }),
      }),
      delete: () => ({
        where: async () => {
          if (inTransaction) {
            const activeCutoff = Date.now() - 30 * 60 * 1000;
            state.rows = state.rows.filter(
              (row) =>
                row.kind !== 'fit_pending' ||
                row.computedAt.getTime() >= activeCutoff
            );
          } else {
            state.rows = state.rows.filter((row) => row.kind !== 'fit_pending');
          }
        },
      }),
      insert: () => ({
        values: (values: Record<string, any>) => ({
          returning: async () => {
            const row = { id: state.nextId++, ...values };
            state.rows.push(row);
            return [{ id: row.id }];
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, any>) => ({
          where: () => ({
            returning: async () => {
              if ('aiFitScore' in values) {
                if (state.failApplicationUpdate) {
                  throw new Error('application persistence failed');
                }
                Object.assign(state.application, values);
                return [{ id: 100 }];
              }

              const pending = state.rows.find((row) => row.kind === 'fit_pending');
              if (!pending) return [];
              Object.assign(pending, values);
              return [{ id: pending.id }];
            },
          }),
        }),
      }),
      query: {
        users: {
          findFirst: async () => ({ aiContentFreeUsed: false }),
        },
      },
    };
  }

  const db = executor(false) as any;
  db.transaction = async (callback: (tx: any) => Promise<unknown>) => {
    const previous = state.transactionTail;
    let unlock = () => {};
    state.transactionTail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;

    const rowsSnapshot = state.rows.map((row) => ({ ...row }));
    const applicationSnapshot = { ...state.application };
    try {
      return await callback(executor(true));
    } catch (error) {
      state.rows = rowsSnapshot;
      state.application = applicationSnapshot;
      throw error;
    } finally {
      unlock();
    }
  };

  return { db };
});

import {
  finalizeFitCredit,
  FitGenerationChangedError,
  getUserLimits,
  releaseFitCredit,
  reserveFitCredit,
  type FitCreditReservation,
  type ReserveFitCreditResult,
} from '../aiLimits';

const fitResult = {
  score: 82,
  label: 'Strong',
  reasons: ['Relevant experience'],
  modelVersion: 'test-model',
  costUsd: 0.001,
  tokensIn: 100,
  tokensOut: 20,
  durationMs: 25,
};

function expectReservation(
  result: ReserveFitCreditResult
): FitCreditReservation {
  expect(result.status).toBe('reserved');
  if (result.status !== 'reserved') {
    throw new Error(`Expected reservation, received ${result.status}`);
  }
  return result.reservation;
}

describe('candidate fit credit reservations', () => {
  beforeEach(() => {
    state.rows = [];
    state.application = {
      id: 100,
      userId: 42,
      aiComputedAt: null,
      aiFitScore: null,
      aiFitLabel: null,
      aiFitReasons: null,
    };
    state.nextId = 1;
    state.failApplicationUpdate = false;
    state.transactionTail = Promise.resolve();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits at most 10 concurrent reservations for one candidate', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        reserveFitCredit(42, 100 + index, null)
      )
    );

    expect(results.filter((result) => result.status === 'reserved')).toHaveLength(10);
    expect(results.filter((result) => result.status === 'quota_exceeded')).toHaveLength(2);
    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitUsedThisMonth: 0,
      fitPendingThisMonth: 10,
      fitRemainingThisMonth: 0,
    });
  });

  it('atomically persists a fit and converts its reservation into charged usage', async () => {
    const reservation = expectReservation(
      await reserveFitCredit(42, 100, null)
    );

    await finalizeFitCredit(reservation, fitResult, 3);

    expect(state.application).toMatchObject({
      aiFitScore: 82,
      aiFitLabel: 'Strong',
      aiDigestVersionUsed: 3,
    });
    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitUsedThisMonth: 1,
      fitPendingThisMonth: 0,
      fitRemainingThisMonth: 9,
    });
  });

  it('does not consume a credit when application persistence fails', async () => {
    const reservation = expectReservation(
      await reserveFitCredit(42, 100, null)
    );
    state.failApplicationUpdate = true;

    await expect(
      finalizeFitCredit(reservation, fitResult, 3)
    ).rejects.toThrow('application persistence failed');
    await releaseFitCredit(reservation);

    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitUsedThisMonth: 0,
      fitPendingThisMonth: 0,
      fitRemainingThisMonth: 10,
    });
  });

  it('reclaims a stale reservation after a crashed computation', async () => {
    expectReservation(await reserveFitCredit(42, 100, null));
    state.rows[0]!.computedAt = new Date(Date.now() - 31 * 60 * 1000);

    const replacement = expectReservation(
      await reserveFitCredit(42, 101, null)
    );

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      id: replacement.id,
      kind: 'fit_pending',
    });
  });

  it('admits only one concurrent reservation for the same application', async () => {
    const results = await Promise.all([
      reserveFitCredit(42, 100, null),
      reserveFitCredit(42, 100, null),
    ]);

    expect(results.filter((result) => result.status === 'reserved')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'in_progress')).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitUsedThisMonth: 0,
      fitPendingThisMonth: 1,
      fitRemainingThisMonth: 9,
    });
  });

  it('returns the cached winner when finalization beats a stale preflight to reservation', async () => {
    const winner = expectReservation(
      await reserveFitCredit(42, 100, null)
    );
    await finalizeFitCredit(winner, fitResult, 3);

    const loser = await reserveFitCredit(42, 100, null);

    expect(loser).toMatchObject({
      status: 'cached',
      fit: {
        score: fitResult.score,
        label: fitResult.label,
      },
    });
    expect(state.rows.filter((row) => row.kind === 'fit')).toHaveLength(1);
    expect(state.rows.filter((row) => row.kind === 'fit_pending')).toHaveLength(0);
    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitUsedThisMonth: 1,
      fitPendingThisMonth: 0,
      fitRemainingThisMonth: 9,
    });
  });

  it('refuses to charge a reservation after another fit generation wins', async () => {
    const loser = expectReservation(
      await reserveFitCredit(42, 100, null)
    );
    state.application.aiComputedAt = new Date();
    state.application.aiFitScore = 91;

    await expect(
      finalizeFitCredit(loser, fitResult, 3)
    ).rejects.toBeInstanceOf(FitGenerationChangedError);
    await releaseFitCredit(loser);

    expect(state.rows).toHaveLength(0);
    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitUsedThisMonth: 0,
      fitPendingThisMonth: 0,
      fitRemainingThisMonth: 10,
    });
  });

  it('keeps a rollover finalization charged to its reservation month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 23, 59, 0));
    const reservation = expectReservation(
      await reserveFitCredit(42, 100, null)
    );
    const reservedAt = state.rows[0]!.computedAt;

    vi.setSystemTime(new Date(2026, 1, 1, 0, 1, 0));
    await finalizeFitCredit(reservation, fitResult, 3);

    expect(state.rows[0]!.computedAt).toEqual(reservedAt);
    expect(state.application.aiComputedAt).toEqual(
      new Date(2026, 1, 1, 0, 1, 0)
    );
    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitUsedThisMonth: 0,
      fitPendingThisMonth: 0,
      fitRemainingThisMonth: 10,
    });
  });
});
