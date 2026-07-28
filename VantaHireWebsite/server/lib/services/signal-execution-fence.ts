import { sql, type SQL } from 'drizzle-orm';
import { jobSourcingRuns } from '../../../shared/schema';
import { db } from '../../db';
import type { SignalExecutionIdentity } from './signal-callback-ack';

export interface SignalExecutionCommitResult<T> {
  committed: boolean;
  value?: T;
}

export function buildSignalExecutionPredicates(
  execution: SignalExecutionIdentity,
): SQL[] {
  return [
    execution.acquisitionGeneration == null
      ? sql`${jobSourcingRuns.meta}->'signalExecution'->>'acquisitionGeneration' IS NULL`
      : sql`${jobSourcingRuns.meta}->'signalExecution'->>'acquisitionGeneration' = ${String(execution.acquisitionGeneration)}`,
    execution.executionAttemptId == null
      ? sql`${jobSourcingRuns.meta}->'signalExecution'->>'executionAttemptId' IS NULL`
      : sql`${jobSourcingRuns.meta}->'signalExecution'->>'executionAttemptId' = ${execution.executionAttemptId}`,
  ];
}

export function buildSignalExecutionLockQuery(
  requestId: string,
  execution: SignalExecutionIdentity,
): SQL {
  const [generationPredicate, attemptPredicate] =
    buildSignalExecutionPredicates(execution);
  return sql`
    SELECT ${jobSourcingRuns.id}
    FROM ${jobSourcingRuns}
    WHERE ${jobSourcingRuns.requestId} = ${requestId}
      AND ${generationPredicate}
      AND ${attemptPredicate}
    FOR UPDATE
  `;
}

/**
 * Serialize a callback mutation with Flow's sourcing-run row and commit only
 * while the signed Signal execution is still current.
 */
export async function commitIfSignalExecutionCurrent<T>(
  requestId: string,
  execution: SignalExecutionIdentity,
  commit: (transaction: any) => Promise<T>,
): Promise<SignalExecutionCommitResult<T>> {
  return db.transaction(async (transaction: any) => {
    const locked = await transaction.execute(
      buildSignalExecutionLockQuery(requestId, execution),
    );
    if ((locked.rows?.length ?? 0) !== 1) {
      return { committed: false };
    }
    return { committed: true, value: await commit(transaction) };
  });
}
