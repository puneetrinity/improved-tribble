import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { jobSourcedCandidates, organizations } from '@shared/schema';
import { db } from '../db';
import { findContact } from './services/signal-client';
import {
  revalidateContactResolution,
  runContactResolutionCycle,
  type ContactResolutionJob,
  type ContactRevalidationInput,
  type ContactRevalidationResult,
  type ContactRevalidationStore,
  type ContactResolutionStore,
} from './contactResolutionCore';
import {
  CandidatePrivacyRestrictedError,
  privacyAllowedSql,
  requireNewCandidateIdentityAllowed,
} from '../candidate-privacy/decision';

const POLL_INTERVAL_MS = readPositiveInteger(
  process.env.CONTACT_RESOLUTION_POLL_INTERVAL_MS,
  5_000,
);
const BATCH_SIZE = readPositiveInteger(process.env.CONTACT_RESOLUTION_BATCH_SIZE, 20);
const CONCURRENCY = readPositiveInteger(process.env.CONTACT_RESOLUTION_CONCURRENCY, 2);
const SIGNAL_TIMEOUT_MS = readPositiveInteger(
  process.env.CONTACT_RESOLUTION_SIGNAL_TIMEOUT_MS,
  90_000,
);
const LEASE_MS = Math.max(
  readPositiveInteger(process.env.CONTACT_RESOLUTION_LEASE_MS, 120_000),
  SIGNAL_TIMEOUT_MS + 30_000,
);
const SIGNAL_PENDING_RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 900_000, 3_600_000, 21_600_000];

async function findContactWithPrivacyFence(
  signalTenantId: string,
  signalCandidateId: string,
  externalJobId: string,
) {
  try {
    await requireNewCandidateIdentityAllowed([
      { identifier_type: 'signal_candidate_id', value: signalCandidateId },
    ]);
  } catch (error) {
    if (error instanceof CandidatePrivacyRestrictedError) {
      return { success: true, state: 'not_found' as const, emails: [] };
    }
    throw error;
  }
  const result = await findContact(signalTenantId, signalCandidateId, externalJobId);
  try {
    await requireNewCandidateIdentityAllowed([
      { identifier_type: 'signal_candidate_id', value: signalCandidateId },
    ]);
  } catch (error) {
    if (error instanceof CandidatePrivacyRestrictedError) {
      return { success: true, state: 'not_found' as const, emails: [] };
    }
    throw error;
  }
  return result;
}

let running = false;
let cycleInFlight = false;
let wakeRequested = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function readPositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function retryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt - 1, 0), SIGNAL_PENDING_RETRY_DELAYS_MS.length - 1);
  return SIGNAL_PENDING_RETRY_DELAYS_MS[index]!;
}

const contactResolutionStore: ContactResolutionStore = {
  async claimDue({ limit, now, leaseToken, leaseExpiresAt }) {
    const result = await db.execute(sql`
      WITH due AS (
        SELECT id
        FROM job_sourced_candidates
        WHERE email_resolve_status = 'pending'
          AND state = 'shortlisted'
          AND ${sql.raw(privacyAllowedSql(
            'job_sourced_candidate',
            'job_sourced_candidates.id',
            { globalUse: true },
          ))}
          AND btrim(COALESCE(signal_candidate_id, '')) <> ''
          AND COALESCE(email_resolve_next_attempt_at, updated_at, NOW()) <= ${now}
          AND (
            email_resolve_lease_expires_at IS NULL
            OR email_resolve_lease_expires_at <= ${now}
          )
        ORDER BY COALESCE(email_resolve_next_attempt_at, updated_at, NOW()) ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE job_sourced_candidates AS candidate
      SET email_resolve_lease_token = ${leaseToken},
          email_resolve_lease_expires_at = ${leaseExpiresAt},
          email_resolve_attempts = candidate.email_resolve_attempts + 1,
          updated_at = ${now}
      FROM due
      WHERE candidate.id = due.id
      RETURNING
        candidate.id,
        candidate.organization_id,
        candidate.job_id,
        candidate.signal_candidate_id,
        candidate.email_resolve_attempts,
        candidate.email_resolve_lease_token
    `);

    return ((result.rows ?? []) as Array<Record<string, unknown>>).map((row): ContactResolutionJob => ({
      id: Number(row.id),
      organizationId: Number(row.organization_id),
      signalCandidateId: String(row.signal_candidate_id),
      externalJobId: `vanta:jobs:${String(row.job_id)}`,
      attempts: Number(row.email_resolve_attempts),
      leaseToken: String(row.email_resolve_lease_token),
    }));
  },

  async getSignalTenantId(organizationId) {
    const organization = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      columns: { signalTenantId: true },
    });
    return organization?.signalTenantId ?? null;
  },

  async markResolved({ candidateId, leaseToken, status, emails, resolvedAt }) {
    await db
      .update(jobSourcedCandidates)
      .set({
        foundEmail: emails[0] ?? null,
        foundEmails: emails,
        emailResolvedAt: resolvedAt,
        emailResolveStatus: status,
        emailResolveNextAttemptAt: null,
        emailResolveLeaseToken: null,
        emailResolveLeaseExpiresAt: null,
        emailResolveLastErrorCode: null,
        updatedAt: resolvedAt,
      })
      .where(and(
        eq(jobSourcedCandidates.id, candidateId),
        eq(jobSourcedCandidates.state, 'shortlisted'),
        eq(jobSourcedCandidates.emailResolveStatus, 'pending'),
        eq(jobSourcedCandidates.emailResolveLeaseToken, leaseToken),
        sql.raw(privacyAllowedSql(
          'job_sourced_candidate',
          'job_sourced_candidates.id',
          { globalUse: true },
        )),
      ));
  },

  async markRetry({ candidateId, leaseToken, nextAttemptAt, errorCode }) {
    await db
      .update(jobSourcedCandidates)
      .set({
        foundEmail: null,
        foundEmails: [],
        emailResolvedAt: null,
        emailResolveStatus: 'pending',
        emailResolveNextAttemptAt: nextAttemptAt,
        emailResolveLeaseToken: null,
        emailResolveLeaseExpiresAt: null,
        emailResolveLastErrorCode: errorCode,
        updatedAt: new Date(),
      })
      .where(and(
        eq(jobSourcedCandidates.id, candidateId),
        eq(jobSourcedCandidates.state, 'shortlisted'),
        eq(jobSourcedCandidates.emailResolveStatus, 'pending'),
        eq(jobSourcedCandidates.emailResolveLeaseToken, leaseToken),
        sql.raw(privacyAllowedSql(
          'job_sourced_candidate',
          'job_sourced_candidates.id',
          { globalUse: true },
        )),
      ));
  },

  async markFailed({ candidateId, leaseToken, failedAt, errorCode }) {
    await db
      .update(jobSourcedCandidates)
      .set({
        foundEmail: null,
        foundEmails: [],
        emailResolveStatus: 'failed',
        emailResolvedAt: failedAt,
        emailResolveNextAttemptAt: null,
        emailResolveLeaseToken: null,
        emailResolveLeaseExpiresAt: null,
        emailResolveLastErrorCode: errorCode,
        updatedAt: failedAt,
      })
      .where(and(
        eq(jobSourcedCandidates.id, candidateId),
        eq(jobSourcedCandidates.state, 'shortlisted'),
        eq(jobSourcedCandidates.emailResolveStatus, 'pending'),
        eq(jobSourcedCandidates.emailResolveLeaseToken, leaseToken),
        sql.raw(privacyAllowedSql(
          'job_sourced_candidate',
          'job_sourced_candidates.id',
          { globalUse: true },
        )),
      ));
  },
};

const contactRevalidationStore: ContactRevalidationStore = {
  async persist({
    candidateId,
    organizationId,
    jobId,
    signalCandidateId,
    status,
    emails,
    resolvedAt,
    nextAttemptAt,
    errorCode,
  }) {
    const result = await db.execute(sql`
      UPDATE job_sourced_candidates
      SET found_email = ${emails[0] ?? null},
          found_emails = CAST(${JSON.stringify(emails)} AS JSONB),
          email_resolved_at = ${resolvedAt},
          email_resolve_status = ${status},
          email_resolve_next_attempt_at = ${nextAttemptAt},
          email_resolve_lease_token = NULL,
          email_resolve_lease_expires_at = NULL,
          email_resolve_last_error_code = ${errorCode},
          updated_at = NOW()
      WHERE id = ${candidateId}
        AND organization_id = ${organizationId}
        AND job_id = ${jobId}
        AND signal_candidate_id = ${signalCandidateId}
        AND state = 'shortlisted'
        AND ${sql.raw(privacyAllowedSql(
          'job_sourced_candidate',
          'job_sourced_candidates.id',
          { globalUse: true },
        ))}
        AND (
          ${status} = 'suppressed'
          OR email_resolve_status IS DISTINCT FROM 'suppressed'
        )
      RETURNING id
    `);
    return (result.rows?.length ?? 0) > 0;
  },
};

export async function revalidateCandidateContact(
  input: ContactRevalidationInput,
): Promise<ContactRevalidationResult> {
  const result = await revalidateContactResolution(input, {
    store: contactRevalidationStore,
    resolveContact: findContactWithPrivacyFence,
    now: () => new Date(),
    retryDelayMs,
  });
  if (result.state === 'pending' && result.persisted) {
    wakeContactResolutionProcessor();
  }
  return result;
}

async function pollCycle(): Promise<void> {
  if (!running) {
    return;
  }

  if (cycleInFlight) {
    wakeRequested = true;
    return;
  }

  cycleInFlight = true;
  try {
    await runContactResolutionCycle(
      {
        store: contactResolutionStore,
        resolveContact: findContactWithPrivacyFence,
        createLeaseToken: randomUUID,
        now: () => new Date(),
      },
      {
        batchSize: BATCH_SIZE,
        concurrency: CONCURRENCY,
        leaseMs: LEASE_MS,
        retryDelayMs,
      },
    );
  } catch (error) {
    console.error('[CONTACT_RESOLUTION] Poll cycle failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
  } finally {
    cycleInFlight = false;
    const nextDelay = wakeRequested ? 0 : POLL_INTERVAL_MS;
    wakeRequested = false;
    schedulePoll(nextDelay);
  }
}

function schedulePoll(delayMs: number): void {
  if (!running) {
    return;
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollCycle();
  }, delayMs);
}

export async function enqueueCandidateContactResolution(candidateId: number): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE job_sourced_candidates
    SET email_resolve_status = 'pending',
        found_email = NULL,
        found_emails = '[]'::jsonb,
        email_resolve_attempts = CASE
          WHEN email_resolve_status = 'pending'
            AND email_resolve_lease_expires_at > NOW()
          THEN email_resolve_attempts
          ELSE 0
        END,
        email_resolve_next_attempt_at = CASE
          WHEN email_resolve_status = 'pending'
            AND email_resolve_lease_expires_at > NOW()
          THEN email_resolve_next_attempt_at
          ELSE NOW()
        END,
        email_resolve_lease_token = CASE
          WHEN email_resolve_status = 'pending'
            AND email_resolve_lease_expires_at > NOW()
          THEN email_resolve_lease_token
          ELSE NULL
        END,
        email_resolve_lease_expires_at = CASE
          WHEN email_resolve_status = 'pending'
            AND email_resolve_lease_expires_at > NOW()
          THEN email_resolve_lease_expires_at
          ELSE NULL
        END,
        email_resolve_last_error_code = NULL,
        email_resolved_at = NULL,
        updated_at = NOW()
    WHERE id = ${candidateId}
      AND state = 'shortlisted'
      AND ${sql.raw(privacyAllowedSql(
        'job_sourced_candidate',
        'job_sourced_candidates.id',
        { globalUse: true },
      ))}
      AND btrim(COALESCE(signal_candidate_id, '')) <> ''
      AND email_resolve_status IS DISTINCT FROM 'suppressed'
    RETURNING id
  `);
  return (result.rows?.length ?? 0) > 0;
}

export function wakeContactResolutionProcessor(): void {
  if (!running) {
    return;
  }
  if (cycleInFlight) {
    wakeRequested = true;
    return;
  }
  schedulePoll(0);
}

export function startContactResolutionProcessor(): void {
  if (running || process.env.CONTACT_RESOLUTION_RECOVERY_ENABLED !== 'true') {
    return;
  }

  running = true;
  console.log('[CONTACT_RESOLUTION] Starting durable processor', {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    leaseMs: LEASE_MS,
  });
  schedulePoll(0);
}

export function stopContactResolutionProcessor(): void {
  running = false;
  wakeRequested = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
