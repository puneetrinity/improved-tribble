/**
 * Candidate Match Credit and AI Usage Tracking
 *
 * Candidate limits:
 * - exactly 10 fit computations per month
 * - 1 content suggestion per lifetime
 *
 * This module tracks usage and enforces limits
 */

import { db } from '../db';
import { applications, userAiUsage, users } from '../../shared/schema';
import { eq, and, sql, lt, gte, isNull } from 'drizzle-orm';
import type { FitComputationResult } from './aiMatchingEngine';

const CANDIDATE_FIT_LIMIT_PER_MONTH = 10;
const FREE_CONTENT_LIMIT_LIFETIME = 1;
const FIT_RESERVATION_TTL_MS = 30 * 60 * 1000;
const FIT_QUOTA_LOCK_NAMESPACE = 1_161_907_265; // "EALA" as a signed int-safe key.

export interface FitCreditReservation {
  id: number;
  userId: number;
  applicationId: number;
  expectedAiComputedAt: Date | null;
}

export interface CachedFitSnapshot {
  score: number;
  label: string | null;
  reasons: string[];
  computedAt: Date;
}

export type ReserveFitCreditResult =
  | { status: 'reserved'; reservation: FitCreditReservation }
  | { status: 'in_progress' }
  | { status: 'cached'; fit: CachedFitSnapshot }
  | { status: 'generation_changed' }
  | { status: 'quota_exceeded' };

export class FitQuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED';

  constructor() {
    super('No match credits remaining this month');
    this.name = 'FitQuotaExceededError';
  }
}

export class FitComputationInProgressError extends Error {
  readonly code = 'FIT_COMPUTATION_IN_PROGRESS';

  constructor() {
    super('A match computation is already in progress for this application');
    this.name = 'FitComputationInProgressError';
  }
}

export class FitGenerationChangedError extends Error {
  readonly code = 'FIT_GENERATION_CHANGED';

  constructor() {
    super('The application match result changed while this computation was running');
    this.name = 'FitGenerationChangedError';
  }
}

export interface UserLimits {
  fitLimitPerMonth: number;
  fitUsedThisMonth: number;
  fitPendingThisMonth: number;
  fitRemainingThisMonth: number;
  contentUsedLifetime: boolean;
  contentRemainingLifetime: number;
  canUseFit: boolean;
  canUseContent: boolean;
}

export function getCandidateFitLimitPerMonth(): number {
  return CANDIDATE_FIT_LIMIT_PER_MONTH;
}

function getFitUsageWindow(now: Date): {
  startOfMonth: Date;
  activeReservationCutoff: Date;
} {
  return {
    startOfMonth: new Date(now.getFullYear(), now.getMonth(), 1),
    activeReservationCutoff: new Date(now.getTime() - FIT_RESERVATION_TTL_MS),
  };
}

async function lockCandidateFitQuota(tx: any, userId: number): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${FIT_QUOTA_LOCK_NAMESPACE}::integer, ${userId}::integer)`
  );
}

async function countFitUsage(
  executor: any,
  userId: number,
  now: Date
): Promise<{ used: number; pending: number }> {
  const { startOfMonth, activeReservationCutoff } = getFitUsageWindow(now);
  const usage = await executor
    .select({
      used: sql<number>`COUNT(*) FILTER (
        WHERE ${userAiUsage.kind} = 'fit'
          AND ${userAiUsage.computedAt} >= ${startOfMonth}
      )::int`,
      pending: sql<number>`COUNT(*) FILTER (
        WHERE ${userAiUsage.kind} = 'fit_pending'
          AND ${userAiUsage.computedAt} >= ${startOfMonth}
          AND ${userAiUsage.computedAt} >= ${activeReservationCutoff}
      )::int`,
    })
    .from(userAiUsage)
    .where(eq(userAiUsage.userId, userId));

  return {
    used: usage[0]?.used || 0,
    pending: usage[0]?.pending || 0,
  };
}

/**
 * Get user's AI usage limits
 */
export async function getUserLimits(userId: number): Promise<UserLimits> {
  const now = new Date();
  const fitUsage = await countFitUsage(db, userId, now);
  const fitUsedThisMonth = fitUsage.used;
  const fitPendingThisMonth = fitUsage.pending;
  const fitLimitPerMonth = getCandidateFitLimitPerMonth();
  const fitRemainingThisMonth = Math.max(
    0,
    fitLimitPerMonth - fitUsedThisMonth - fitPendingThisMonth
  );

  // Check if content suggestion used
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { aiContentFreeUsed: true },
  });

  const contentUsedLifetime = user?.aiContentFreeUsed || false;
  const contentRemainingLifetime = contentUsedLifetime ? 0 : 1;

  return {
    fitLimitPerMonth,
    fitUsedThisMonth,
    fitPendingThisMonth,
    fitRemainingThisMonth,
    canUseFit: fitRemainingThisMonth > 0,
    contentUsedLifetime,
    contentRemainingLifetime,
    canUseContent: !contentUsedLifetime,
  };
}

/**
 * Reserve one candidate match credit under a per-user Postgres advisory lock.
 *
 * Reservations are short leases represented by `fit_pending` usage rows. The
 * worker/API must either finalize or release the row. A process crash cannot
 * strand a monthly credit because reservations older than the lease TTL no
 * longer count and are deleted by the next reservation attempt.
 */
export async function reserveFitCredit(
  userId: number,
  applicationId: number,
  expectedAiComputedAt: Date | null,
  organizationId?: number
): Promise<ReserveFitCreditResult> {
  return db.transaction(async (tx: any) => {
    await lockCandidateFitQuota(tx, userId);

    const now = new Date();
    const { activeReservationCutoff } = getFitUsageWindow(now);
    await tx
      .delete(userAiUsage)
      .where(
        and(
          eq(userAiUsage.userId, userId),
          eq(userAiUsage.kind, 'fit_pending'),
          lt(userAiUsage.computedAt, activeReservationCutoff)
        )
      );

    const applicationRows = await tx
      .select({
        aiComputedAt: applications.aiComputedAt,
        aiFitScore: applications.aiFitScore,
        aiFitLabel: applications.aiFitLabel,
        aiFitReasons: applications.aiFitReasons,
      })
      .from(applications)
      .where(
        and(
          eq(applications.id, applicationId),
          eq(applications.userId, userId)
        )
      )
      .limit(1);
    const application = applicationRows[0];

    if (!application) {
      throw new Error('Application disappeared before fit reservation');
    }

    const currentGeneration = application.aiComputedAt?.getTime() ?? null;
    const expectedGeneration = expectedAiComputedAt?.getTime() ?? null;
    if (currentGeneration !== expectedGeneration) {
      if (application.aiComputedAt && application.aiFitScore !== null) {
        return {
          status: 'cached',
          fit: {
            score: application.aiFitScore,
            label: application.aiFitLabel,
            reasons: Array.isArray(application.aiFitReasons)
              ? application.aiFitReasons.filter(
                  (reason: unknown): reason is string => typeof reason === 'string'
                )
              : [],
            computedAt: application.aiComputedAt,
          },
        };
      }
      return { status: 'generation_changed' };
    }

    const activePendingRows = await tx
      .select({ metadata: userAiUsage.metadata })
      .from(userAiUsage)
      .where(
        and(
          eq(userAiUsage.userId, userId),
          eq(userAiUsage.kind, 'fit_pending'),
          gte(userAiUsage.computedAt, activeReservationCutoff)
        )
      );
    const sameApplicationPending = activePendingRows.some((row: any) => {
      const metadata = row.metadata as { applicationId?: unknown } | null;
      return Number(metadata?.applicationId) === applicationId;
    });

    if (sameApplicationPending) {
      return { status: 'in_progress' };
    }

    const usage = await countFitUsage(tx, userId, now);
    if (usage.used + usage.pending >= CANDIDATE_FIT_LIMIT_PER_MONTH) {
      return { status: 'quota_exceeded' };
    }

    const rows = await tx
      .insert(userAiUsage)
      .values({
        ...(organizationId != null && { organizationId }),
        userId,
        kind: 'fit_pending',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: '0',
        computedAt: now,
        metadata: {
          applicationId,
          reservationExpiresAt: new Date(
            now.getTime() + FIT_RESERVATION_TTL_MS
          ).toISOString(),
        },
      })
      .returning({ id: userAiUsage.id });

    const id = rows[0]?.id;
    if (!id) {
      throw new Error('Failed to reserve candidate match credit');
    }

    return {
      status: 'reserved',
      reservation: {
        id,
        userId,
        applicationId,
        expectedAiComputedAt,
      },
    };
  });
}

export async function releaseFitCredit(
  reservation: FitCreditReservation
): Promise<void> {
  await db
    .delete(userAiUsage)
    .where(
      and(
        eq(userAiUsage.id, reservation.id),
        eq(userAiUsage.userId, reservation.userId),
        eq(userAiUsage.kind, 'fit_pending')
      )
    );
}

/**
 * Persist the fit and convert its reservation into charged usage together.
 * If either write fails, the transaction rolls back; callers then release the
 * still-pending lease so a persistence failure never consumes a credit.
 */
export async function finalizeFitCredit(
  reservation: FitCreditReservation,
  result: FitComputationResult,
  digestVersion: number,
  organizationId?: number
): Promise<Date> {
  return db.transaction(async (tx: any) => {
    await lockCandidateFitQuota(tx, reservation.userId);

    const pendingRows = await tx
      .select({ id: userAiUsage.id })
      .from(userAiUsage)
      .where(
        and(
          eq(userAiUsage.id, reservation.id),
          eq(userAiUsage.userId, reservation.userId),
          eq(userAiUsage.kind, 'fit_pending')
        )
      )
      .limit(1);

    if (!pendingRows[0]) {
      throw new Error('Candidate match credit reservation expired');
    }

    const applicationRows = await tx
      .select({ aiComputedAt: applications.aiComputedAt })
      .from(applications)
      .where(
        and(
          eq(applications.id, reservation.applicationId),
          eq(applications.userId, reservation.userId)
        )
      )
      .limit(1);
    const currentGeneration = applicationRows[0]?.aiComputedAt?.getTime() ?? null;
    const expectedGeneration =
      reservation.expectedAiComputedAt?.getTime() ?? null;
    if (!applicationRows[0] || currentGeneration !== expectedGeneration) {
      throw new FitGenerationChangedError();
    }

    const computedAt = new Date();
    const expectedGenerationCondition =
      reservation.expectedAiComputedAt === null
        ? isNull(applications.aiComputedAt)
        : eq(applications.aiComputedAt, reservation.expectedAiComputedAt);
    const updatedApplications = await tx
      .update(applications)
      .set({
        aiFitScore: result.score,
        aiFitLabel: result.label,
        aiFitReasons: result.reasons,
        aiModelVersion: result.modelVersion,
        aiComputedAt: computedAt,
        aiStaleReason: null,
        aiDigestVersionUsed: digestVersion,
      })
      .where(
        and(
          eq(applications.id, reservation.applicationId),
          eq(applications.userId, reservation.userId),
          expectedGenerationCondition
        )
      )
      .returning({ id: applications.id });

    if (!updatedApplications[0]) {
      throw new FitGenerationChangedError();
    }

    const finalizedUsage = await tx
      .update(userAiUsage)
      .set({
        ...(organizationId != null && { organizationId }),
        kind: 'fit',
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd.toFixed(8),
        metadata: {
          applicationId: reservation.applicationId,
          durationMs: result.durationMs,
          score: result.score,
          label: result.label,
        },
      })
      .where(
        and(
          eq(userAiUsage.id, reservation.id),
          eq(userAiUsage.userId, reservation.userId),
          eq(userAiUsage.kind, 'fit_pending')
        )
      )
      .returning({ id: userAiUsage.id });

    if (!finalizedUsage[0]) {
      throw new Error('Candidate match credit finalization failed');
    }

    return computedAt;
  });
}

/**
 * Check if user can use content suggestion
 */
export async function canUseContentSuggestion(userId: number): Promise<boolean> {
  const limits = await getUserLimits(userId);
  return limits.canUseContent;
}

/**
 * Mark content suggestion as used (one-time flag)
 */
export async function markContentSuggestionUsed(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ aiContentFreeUsed: true })
    .where(eq(users.id, userId));
}

/**
 * Get monthly reset date
 */
export function getMonthlyResetDate(): Date {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth;
}
