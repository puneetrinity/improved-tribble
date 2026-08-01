import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ db: { execute: vi.fn() } }));

import {
  runOutreachHygieneCycle,
  type OutreachHygieneIntentJob,
  type OutreachHygieneStore,
} from '../outreachHygieneProcessor';

function emailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex');
}

function job(
  overrides: Partial<OutreachHygieneIntentJob> = {},
): OutreachHygieneIntentJob {
  return {
    id: 1,
    providerEventId: 'a'.repeat(64),
    signalTenantId: 'org_7',
    signalCandidateId: 'signal-candidate-7',
    emailHash: emailHash('candidate@example.com'),
    reason: 'complaint',
    attemptCount: 1,
    leaseToken: 'lease-1',
    ...overrides,
  };
}

describe('outreach hygiene recovery', () => {
  const claimDue = vi.fn();
  const markSynced = vi.fn();
  const markRetry = vi.fn();
  const markDeadLetter = vi.fn();
  const suppress = vi.fn();
  const store: OutreachHygieneStore = {
    claimDue,
    markSynced,
    markRetry,
    markDeadLetter,
  };
  const cycleOptions = {
    batchSize: 20,
    concurrency: 2,
    leaseMs: 60_000,
    maxAttempts: 12,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    markSynced.mockResolvedValue(true);
    markRetry.mockResolvedValue(true);
    markDeadLetter.mockResolvedValue(true);
  });

  it('marks a complaint synced only after Memory confirms person scope', async () => {
    claimDue.mockResolvedValue([job()]);
    suppress.mockResolvedValue({
      suppressed: true,
      reason: 'complaint',
      evidence: 'absent',
      scope: 'person',
      global_candidate_id: 'global-person-7',
      idempotent: false,
    });

    const result = await runOutreachHygieneCycle(
      {
        store,
        suppress,
        now: () => new Date('2026-07-31T10:00:00Z'),
        createLeaseToken: () => 'lease-1',
      },
      cycleOptions,
    );

    expect(result).toEqual({
      claimed: 1,
      synced: 1,
      retried: 0,
      deadLettered: 0,
      leaseLost: 0,
    });
    expect(suppress).toHaveBeenCalledWith(
      'org_7',
      {
        emailHash: emailHash('candidate@example.com'),
        reason: 'complaint',
        providerEventId: 'a'.repeat(64),
        signalCandidateId: 'signal-candidate-7',
      },
      `brevo:${'a'.repeat(64)}`,
    );
    expect(markSynced).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      memoryGlobalCandidateId: 'global-person-7',
    }));
    expect(markRetry).not.toHaveBeenCalled();
  });

  it('dead-letters a complaint when Memory does not confirm person scope', async () => {
    claimDue.mockResolvedValue([job()]);
    suppress.mockResolvedValue({
      suppressed: true,
      reason: 'complaint',
      evidence: 'absent',
      scope: 'address',
      global_candidate_id: null,
      idempotent: false,
    });

    const result = await runOutreachHygieneCycle(
      {
        store,
        suppress,
        now: () => new Date('2026-07-31T10:00:00Z'),
        createLeaseToken: () => 'lease-1',
      },
      { ...cycleOptions, concurrency: 1 },
    );

    expect(result).toEqual({
      claimed: 1,
      synced: 0,
      retried: 0,
      deadLettered: 1,
      leaseLost: 0,
    });
    expect(markSynced).not.toHaveBeenCalled();
    expect(markRetry).not.toHaveBeenCalled();
    expect(markDeadLetter).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'complaint_person_scope_not_confirmed',
    }));
  });

  it('accepts address scope for a hard bounce', async () => {
    claimDue.mockResolvedValue([job({ reason: 'hard_bounce' })]);
    suppress.mockResolvedValue({
      suppressed: true,
      reason: 'hard_bounce',
      evidence: 'absent',
      scope: 'address',
      global_candidate_id: null,
      idempotent: false,
    });

    const result = await runOutreachHygieneCycle(
      {
        store,
        suppress,
        now: () => new Date('2026-07-31T10:00:00Z'),
        createLeaseToken: () => 'lease-1',
      },
      { ...cycleOptions, concurrency: 1 },
    );

    expect(result.synced).toBe(1);
    expect(markSynced).toHaveBeenCalledWith(expect.objectContaining({
      memoryGlobalCandidateId: null,
    }));
  });

  it('does not report success after losing the database lease', async () => {
    claimDue.mockResolvedValue([job()]);
    markSynced.mockResolvedValue(false);
    suppress.mockResolvedValue({
      suppressed: true,
      reason: 'complaint',
      evidence: 'present',
      scope: 'person',
      global_candidate_id: 'global-person-7',
      idempotent: false,
    });

    const result = await runOutreachHygieneCycle(
      {
        store,
        suppress,
        now: () => new Date('2026-07-31T10:00:00Z'),
        createLeaseToken: () => 'lease-1',
      },
      { ...cycleOptions, concurrency: 1 },
    );

    expect(result).toEqual({
      claimed: 1,
      synced: 0,
      retried: 0,
      deadLettered: 0,
      leaseLost: 1,
    });
  });

  it.each([400, 404, 409, 422])(
    'dead-letters record-specific Memory HTTP %s without retrying',
    async (statusCode) => {
      claimDue.mockResolvedValue([job()]);
      suppress.mockRejectedValue(Object.assign(new Error('permanent'), { statusCode }));

      const result = await runOutreachHygieneCycle(
        {
          store,
          suppress,
          now: () => new Date('2026-07-31T10:00:00Z'),
          createLeaseToken: () => 'lease-1',
        },
        { ...cycleOptions, concurrency: 1 },
      );

      expect(result.deadLettered).toBe(1);
      expect(markDeadLetter).toHaveBeenCalledWith(expect.objectContaining({
        errorCode: `memory_http_${statusCode}`,
      }));
      expect(markRetry).not.toHaveBeenCalled();
    },
  );

  it.each([408, 425, 429, 503])(
    'retries transient Memory HTTP %s before the attempt limit',
    async (statusCode) => {
      claimDue.mockResolvedValue([job({ attemptCount: 11 })]);
      suppress.mockRejectedValue(Object.assign(new Error('transient'), { statusCode }));

      const result = await runOutreachHygieneCycle(
        {
          store,
          suppress,
          now: () => new Date('2026-07-31T10:00:00Z'),
          createLeaseToken: () => 'lease-1',
        },
        { ...cycleOptions, concurrency: 1 },
      );

      expect(result.retried).toBe(1);
      expect(markRetry).toHaveBeenCalledWith(expect.objectContaining({
        errorCode: `memory_http_${statusCode}`,
      }));
      expect(markDeadLetter).not.toHaveBeenCalled();
    },
  );

  it.each([401, 403])(
    'keeps retrying an authorization failure (HTTP %s) instead of dead-lettering',
    async (statusCode) => {
      // A 401/403 is misconfigured scope, issuer, or key. It affects EVERY
      // record and a deploy fixes it, so giving up here would strand every
      // complaint behind a config mistake.
      claimDue.mockResolvedValue([job()]);
      suppress.mockRejectedValue(Object.assign(new Error('denied'), { statusCode }));

      const result = await runOutreachHygieneCycle(
        {
          store,
          suppress,
          now: () => new Date('2026-07-31T10:00:00Z'),
          createLeaseToken: () => 'lease-1',
        },
        { ...cycleOptions, concurrency: 1 },
      );

      expect(result.deadLettered).toBe(0);
      expect(result.retried).toBe(1);
      expect(markDeadLetter).not.toHaveBeenCalled();
    },
  );

  it('never dead-letters a systemic failure, even past the alert threshold', async () => {
    // Memory being unavailable is not this record's fault. Retrying is bounded
    // by a one-hour backoff cap, not by an attempt count, so a recovering
    // dependency always drains the backlog.
    claimDue.mockResolvedValue([job({ attemptCount: 12 })]);
    suppress.mockRejectedValue(Object.assign(new Error('transient'), { statusCode: 503 }));

    const result = await runOutreachHygieneCycle(
      {
        store,
        suppress,
        now: () => new Date('2026-07-31T10:00:00Z'),
        createLeaseToken: () => 'lease-1',
      },
      { ...cycleOptions, concurrency: 1 },
    );

    expect(result.deadLettered).toBe(0);
    expect(result.retried).toBe(1);
    expect(markRetry).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'memory_http_503',
    }));
  });

  it('reports lease loss instead of dead-letter success', async () => {
    claimDue.mockResolvedValue([job()]);
    suppress.mockRejectedValue(Object.assign(new Error('permanent'), { statusCode: 422 }));
    markDeadLetter.mockResolvedValue(false);

    const result = await runOutreachHygieneCycle(
      {
        store,
        suppress,
        now: () => new Date('2026-07-31T10:00:00Z'),
        createLeaseToken: () => 'lease-1',
      },
      { ...cycleOptions, concurrency: 1 },
    );

    expect(result).toEqual({
      claimed: 1,
      synced: 0,
      retried: 0,
      deadLettered: 0,
      leaseLost: 1,
    });
  });
});
