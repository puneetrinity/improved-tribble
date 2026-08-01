import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { db } from '../db';
import {
  suppressContactEvidence,
  CONTACT_SUPPRESSION_TIMEOUT_MS,
  type ContactSuppressionReason,
  type ContactSuppressionResponse,
} from './services/activekg-client';

const POLL_INTERVAL_MS = readPositiveInteger(
  process.env.OUTREACH_HYGIENE_POLL_INTERVAL_MS,
  5_000,
);
const BATCH_SIZE = readPositiveInteger(
  process.env.OUTREACH_HYGIENE_BATCH_SIZE,
  20,
);
const CONCURRENCY = readPositiveInteger(
  process.env.OUTREACH_HYGIENE_CONCURRENCY,
  2,
);
const MAX_ATTEMPTS = readPositiveInteger(
  process.env.OUTREACH_HYGIENE_MAX_ATTEMPTS,
  12,
);
const RETENTION_DAYS = readPositiveInteger(
  process.env.OUTREACH_HYGIENE_RETENTION_DAYS,
  90,
);
// APPROVED POLICY (owner, 2026-08-01): 90 days, matching the intent window.
//
// Correlations are what let a LATE provider event be attributed to a person at
// all, which is why they outlive the job, candidate, organization, and delivery
// log. Bounces arrive in minutes to days, so 90 covers them many times over.
// The window governs ATTRIBUTION ONLY: once a complaint is attributed the
// suppression is permanent and is never purged.
//
// Accepted residual: a spam report on an email older than 90 days cannot be
// traced to a person, so it is ignored rather than guessed at — no wrong person
// is suppressed. Self-limiting, because a 3-round sequence runs over ~6 days, so
// anyone in an active campaign always has a fresh correlation.
const CORRELATION_RETENTION_DAYS = readPositiveInteger(
  process.env.OUTREACH_CORRELATION_RETENTION_DAYS,
  90,
);
const MAX_DEAD_LETTER_REPLAYS = readPositiveInteger(
  process.env.OUTREACH_HYGIENE_MAX_REPLAYS,
  3,
);
const LEASE_MS = Math.max(
  readPositiveInteger(process.env.OUTREACH_HYGIENE_LEASE_MS, 60_000),
  Math.ceil(BATCH_SIZE / CONCURRENCY) * CONTACT_SUPPRESSION_TIMEOUT_MS + 30_000,
);

export interface OutreachHygieneIntentJob {
  id: number;
  providerEventId: string;
  signalTenantId: string;
  signalCandidateId: string;
  emailHash: string;
  reason: ContactSuppressionReason;
  attemptCount: number;
  leaseToken: string;
}

export interface OutreachHygieneStore {
  claimDue(params: {
    limit: number;
    now: Date;
    leaseToken: string;
    leaseExpiresAt: Date;
  }): Promise<OutreachHygieneIntentJob[]>;
  markSynced(params: {
    id: number;
    leaseToken: string;
    syncedAt: Date;
    memoryGlobalCandidateId: string | null;
  }): Promise<boolean>;
  markRetry(params: {
    id: number;
    leaseToken: string;
    nextAttemptAt: Date;
    errorCode: string;
  }): Promise<boolean>;
  markDeadLetter(params: {
    id: number;
    leaseToken: string;
    deadLetteredAt: Date;
    errorCode: string;
  }): Promise<boolean>;
}

export interface OutreachHygieneDependencies {
  store: OutreachHygieneStore;
  suppress: (
    tenantId: string,
    input: {
      emailHash: string;
      reason: ContactSuppressionReason;
      providerEventId: string;
      signalCandidateId: string;
    },
    requestId: string,
  ) => Promise<ContactSuppressionResponse>;
  now: () => Date;
  createLeaseToken: () => string;
}

export interface OutreachHygieneCycleResult {
  claimed: number;
  synced: number;
  retried: number;
  deadLettered: number;
  leaseLost: number;
}

function readPositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(30_000 * (2 ** Math.min(Math.max(attemptCount - 1, 0), 7)), 3_600_000);
}

function syncErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const status = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return `memory_http_${status}`;
    }
  }
  if (error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)) {
    return error.message.toLowerCase();
  }
  return 'memory_sync_failed';
}

const PERMANENT_LOCAL_ERRORS = new Set([
  'UNEXPECTED_HARD_BOUNCE_SCOPE',
  'COMPLAINT_PERSON_SCOPE_NOT_CONFIRMED',
]);

/**
 * Why two classes and not "retryable yes/no".
 *
 * Treating every non-retryable answer as terminal dead-ends the WRONG failures.
 * A 401/403 is almost never about this record — it is a misconfigured scope,
 * issuer, or key, which affects every record and is fixed by a deploy. Giving up
 * on it converts a config mistake into thousands of permanently unsynced
 * complaints. It must keep retrying, and it must say so once, loudly.
 *
 * A malformed-payload rejection IS about this record and will never succeed. It
 * still needs no operator rescue: the person stays blocked locally, which is the
 * correct outcome for a complaint. It is a bug to fix in code, not an incident.
 */
export type SyncFailureClass = 'systemic' | 'record';

export function classifySyncFailure(error: unknown): SyncFailureClass {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const status = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(status)) {
      // Authentication and authorization failures are deployment state, not
      // data: retrying after the fix succeeds, so never dead-letter them.
      if (status === 401 || status === 403) return 'systemic';
      if (status >= 500 || status === 408 || status === 425 || status === 429) {
        return 'systemic';
      }
      // Remaining 4xx describe THIS payload and will not become valid.
      return 'record';
    }
  }
  if (error instanceof Error && PERMANENT_LOCAL_ERRORS.has(error.message)) {
    return 'record';
  }
  // Network failures, timeouts, and unknown runtime faults mean Memory is
  // unreachable, not that this record is bad.
  return 'systemic';
}

function assertSuppressionScope(
  job: OutreachHygieneIntentJob,
  response: ContactSuppressionResponse,
): string | null {
  if (job.reason === 'hard_bounce') {
    if (response.scope !== 'address') {
      throw new Error('UNEXPECTED_HARD_BOUNCE_SCOPE');
    }
    return null;
  }

  if (response.scope !== 'person' || !response.global_candidate_id?.trim()) {
    throw new Error('COMPLAINT_PERSON_SCOPE_NOT_CONFIRMED');
  }
  return response.global_candidate_id;
}

async function processIntent(
  job: OutreachHygieneIntentJob,
  dependencies: OutreachHygieneDependencies,
  maxAttempts: number,
): Promise<'synced' | 'retried' | 'dead_lettered' | 'lease_lost'> {
  try {
    const response = await dependencies.suppress(
      job.signalTenantId,
      {
        emailHash: job.emailHash,
        reason: job.reason,
        providerEventId: job.providerEventId,
        signalCandidateId: job.signalCandidateId,
      },
      `brevo:${job.providerEventId}`,
    );
    const memoryGlobalCandidateId = assertSuppressionScope(job, response);
    const marked = await dependencies.store.markSynced({
      id: job.id,
      leaseToken: job.leaseToken,
      syncedAt: dependencies.now(),
      memoryGlobalCandidateId,
    });
    return marked ? 'synced' : 'lease_lost';
  } catch (error) {
    const errorCode = syncErrorCode(error);
    const failureClass = classifySyncFailure(error);
    // Only a record-specific fault is terminal. A systemic fault retries for as
    // long as it takes: the fix is a deploy or a recovering dependency, and
    // dead-lettering would strand complaints that would otherwise succeed.
    if (failureClass === 'record') {
      const marked = await dependencies.store.markDeadLetter({
        id: job.id,
        leaseToken: job.leaseToken,
        deadLetteredAt: dependencies.now(),
        errorCode,
      });
      return marked ? 'dead_lettered' : 'lease_lost';
    }
    if (job.attemptCount + 1 === maxAttempts) {
      // Say it once, at the threshold, rather than on every cycle.
      console.error(
        '[OutreachHygiene] Memory suppression sync is failing systemically; '
        + 'retries continue and affected people stay blocked',
        {
          errorCode,
          attemptCount: job.attemptCount + 1,
          providerEventId: job.providerEventId,
        },
      );
    }
    const marked = await dependencies.store.markRetry({
      id: job.id,
      leaseToken: job.leaseToken,
      nextAttemptAt: new Date(
        dependencies.now().getTime() + retryDelayMs(job.attemptCount),
      ),
      errorCode,
    });
    return marked ? 'retried' : 'lease_lost';
  }
}

export async function runOutreachHygieneCycle(
  dependencies: OutreachHygieneDependencies,
  options: {
    batchSize: number;
    concurrency: number;
    leaseMs: number;
    maxAttempts?: number;
  },
): Promise<OutreachHygieneCycleResult> {
  const now = dependencies.now();
  const leaseToken = dependencies.createLeaseToken();
  const jobs = await dependencies.store.claimDue({
    limit: options.batchSize,
    now,
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
  });

  let cursor = 0;
  let synced = 0;
  let retried = 0;
  let deadLettered = 0;
  let leaseLost = 0;
  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!job) break;
      const result = await processIntent(
        job,
        dependencies,
        options.maxAttempts ?? MAX_ATTEMPTS,
      );
      if (result === 'synced') synced += 1;
      else if (result === 'retried') retried += 1;
      else if (result === 'dead_lettered') deadLettered += 1;
      else leaseLost += 1;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(options.concurrency, 1), jobs.length) },
      () => worker(),
    ),
  );
  return { claimed: jobs.length, synced, retried, deadLettered, leaseLost };
}

export const outreachHygieneStore: OutreachHygieneStore = {
  async claimDue({ limit, now, leaseToken, leaseExpiresAt }) {
    const result = await db.execute(sql`
      WITH due AS (
        SELECT id
        FROM outreach_hygiene_intents
        WHERE next_attempt_at <= ${now}
          AND (
            status = 'pending'
            OR (status = 'processing' AND lease_expires_at <= ${now})
          )
        ORDER BY next_attempt_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE outreach_hygiene_intents AS intent
        SET status = 'processing',
            attempt_count = intent.attempt_count + 1,
            lease_token = ${leaseToken},
            lease_expires_at = ${leaseExpiresAt},
            last_error = NULL,
            updated_at = ${now}
        FROM due
        WHERE intent.id = due.id
        RETURNING intent.*
      )
      SELECT
        claimed.id,
        claimed.provider_event_id,
        claimed.signal_tenant_id,
        claimed.signal_candidate_id,
        claimed.email_hash,
        claimed.reason,
        claimed.attempt_count,
        claimed.lease_token
      FROM claimed
    `);

    return ((result.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      providerEventId: String(row.provider_event_id),
      signalTenantId: String(row.signal_tenant_id),
      signalCandidateId: String(row.signal_candidate_id),
      emailHash: String(row.email_hash),
      reason: String(row.reason) as ContactSuppressionReason,
      attemptCount: Number(row.attempt_count),
      leaseToken: String(row.lease_token),
    }));
  },

  async markSynced({ id, leaseToken, syncedAt, memoryGlobalCandidateId }) {
    const result = await db.execute(sql`
      UPDATE outreach_hygiene_intents
      SET status = 'synced',
          memory_global_candidate_id = ${memoryGlobalCandidateId},
          source_outreach_log_id = NULL,
          synced_at = ${syncedAt},
          lease_token = NULL,
          lease_expires_at = NULL,
          next_attempt_at = ${syncedAt},
          last_error = NULL,
          updated_at = ${syncedAt}
      WHERE id = ${id}
        AND status = 'processing'
        AND lease_token = ${leaseToken}
      RETURNING id
    `);
    return (result.rows?.length ?? 0) === 1;
  },

  async markRetry({ id, leaseToken, nextAttemptAt, errorCode }) {
    const result = await db.execute(sql`
      UPDATE outreach_hygiene_intents
      SET status = 'pending',
          next_attempt_at = ${nextAttemptAt},
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = ${errorCode},
          updated_at = NOW()
      WHERE id = ${id}
        AND status = 'processing'
        AND lease_token = ${leaseToken}
      RETURNING id
    `);
    return (result.rows?.length ?? 0) === 1;
  },

  async markDeadLetter({ id, leaseToken, deadLetteredAt, errorCode }) {
    const result = await db.execute(sql`
      UPDATE outreach_hygiene_intents
      SET status = 'dead_letter',
          dead_lettered_at = ${deadLetteredAt},
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = ${errorCode},
          updated_at = ${deadLetteredAt}
      WHERE id = ${id}
        AND status = 'processing'
        AND lease_token = ${leaseToken}
      RETURNING id
    `);
    return (result.rows?.length ?? 0) === 1;
  },
};

/**
 * Bound how long hygiene intents are kept.
 *
 * Two reasons, and the safety rule that follows from them. The rows hold a
 * pseudonymous email hash and a person identifier — reversible for a known
 * address, so still personal data — and every send reads this table, so
 * unbounded growth is also a hot-path cost.
 *
 * ONLY rows already durably recorded in Memory may be removed. Deleting an
 * unsynced or dead-lettered row would erase a suppression that was never
 * honored anywhere, which is the exact failure this whole mechanism exists to
 * prevent. Memory remains authoritative for everything purged here.
 */
export async function purgeSyncedHygieneIntents(
  retentionDays = RETENTION_DAYS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    DELETE FROM outreach_hygiene_intents
    WHERE status = 'synced'
      AND synced_at IS NOT NULL
      AND synced_at < ${cutoff}
    RETURNING id
  `);
  const purged = result.rows?.length ?? 0;
  if (purged > 0) {
    console.log('[OutreachHygiene] Purged synced intents past retention', {
      purged,
      retentionDays,
    });
  }
  return purged;
}

/**
 * Bound retention of delivery correlations.
 *
 * These rows are pseudonymous but still personal data — an email hash plus a
 * person identifier — and they are deliberately kept after the job, candidate,
 * organization, and delivery log are deleted so a late bounce or complaint can
 * still be honored. "Deliberately kept" is not "kept forever", so the window is
 * bounded here.
 *
 * A correlation is never removed while an unresolved hygiene intent still exists
 * for the same address: that intent represents a suppression not yet recorded in
 * Memory, and discarding its correlation would lose the audit trail for it.
 */
export async function purgeExpiredDeliveryCorrelations(
  retentionDays = CORRELATION_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    DELETE FROM outreach_delivery_correlations c
    WHERE c.created_at < ${cutoff}
      AND NOT EXISTS (
        SELECT 1
        FROM outreach_hygiene_intents i
        WHERE i.email_hash = c.email_hash
          AND i.status <> 'synced'
      )
    RETURNING c.id
  `);
  const purged = result.rows?.length ?? 0;
  if (purged > 0) {
    console.log('[OutreachHygiene] Purged delivery correlations past retention', {
      purged,
      retentionDays,
    });
  }
  return purged;
}

/**
 * Recover dead letters automatically, without an operator.
 *
 * A record-specific failure means the payload we sent will never be accepted —
 * so the remedy is a code fix, and the deploy that carries it restarts this
 * process. Requeuing on start therefore replays exactly the records a fix was
 * meant to repair, with no admin endpoint and nobody editing the database.
 *
 * Bounded by replay_count so an unfixed bug cannot churn forever: after
 * MAX_DEAD_LETTER_REPLAYS restarts a row stays put and stays visible. Nothing is
 * unsafe about that state — the affected person remains fenced locally either
 * way; what is lost is only the mirror of that suppression in Memory.
 */
export async function requeueDeadLetteredIntents(
  maxReplays = MAX_DEAD_LETTER_REPLAYS,
  now: Date = new Date(),
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE outreach_hygiene_intents
    SET status = 'pending',
        dead_lettered_at = NULL,
        attempt_count = 0,
        replay_count = replay_count + 1,
        next_attempt_at = ${now},
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = 'requeued_after_restart',
        updated_at = ${now}
    WHERE status = 'dead_letter'
      AND replay_count < ${maxReplays}
    RETURNING id
  `);
  const requeued = result.rows?.length ?? 0;
  if (requeued > 0) {
    console.log('[OutreachHygiene] Requeued dead-lettered suppressions after restart', {
      requeued,
      maxReplays,
    });
  }
  return requeued;
}

let running = false;
let cycleInFlight = false;
let wakeRequested = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function pollCycle(): Promise<void> {
  if (!running) return;
  if (cycleInFlight) {
    wakeRequested = true;
    return;
  }

  cycleInFlight = true;
  try {
    const result = await runOutreachHygieneCycle(
      {
        store: outreachHygieneStore,
        suppress: suppressContactEvidence,
        now: () => new Date(),
        createLeaseToken: randomUUID,
      },
      {
        batchSize: BATCH_SIZE,
        concurrency: CONCURRENCY,
        leaseMs: LEASE_MS,
        maxAttempts: MAX_ATTEMPTS,
      },
    );
    if (result.deadLettered > 0) {
      // Not an outage: the affected person stays blocked locally, which is the
      // correct outcome. It is a data-quality bug to fix in code.
      console.error('[OUTREACH_HYGIENE] Record-specific suppression sync failed; '
        + 'the affected person remains fenced', {
        count: result.deadLettered,
      });
    }
    await purgeSyncedHygieneIntents();
    await purgeExpiredDeliveryCorrelations();
    if (result.leaseLost > 0) {
      console.warn('[OUTREACH_HYGIENE] Lease ownership changed before acknowledgement', {
        count: result.leaseLost,
      });
    }
  } catch (error) {
    console.error('[OUTREACH_HYGIENE] Recovery cycle failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
  } finally {
    cycleInFlight = false;
    const delay = wakeRequested ? 0 : POLL_INTERVAL_MS;
    wakeRequested = false;
    schedulePoll(delay);
  }
}

function schedulePoll(delayMs: number): void {
  if (!running) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollCycle();
  }, delayMs);
}

export function wakeOutreachHygieneProcessor(): void {
  if (!running) return;
  if (cycleInFlight) {
    wakeRequested = true;
    return;
  }
  schedulePoll(0);
}

export function startOutreachHygieneProcessor(): void {
  if (running || process.env.OUTREACH_HYGIENE_RECOVERY_ENABLED === 'false') return;
  running = true;
  console.log('[OUTREACH_HYGIENE] Starting durable processor', {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    leaseMs: LEASE_MS,
  });
  // A restart is the signal that a fix may have shipped. Replay dead letters
  // before the first cycle so recovery needs no operator action.
  void requeueDeadLetteredIntents()
    .catch((error: unknown) => {
      console.error('[OUTREACH_HYGIENE] Dead-letter requeue failed', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
    })
    .finally(() => schedulePoll(0));
}

export function stopOutreachHygieneProcessor(): void {
  running = false;
  wakeRequested = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
