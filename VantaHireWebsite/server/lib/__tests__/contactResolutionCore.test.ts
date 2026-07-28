import { describe, expect, it, vi } from 'vitest';
import {
  planManualContactResolution,
  planShortlistContactTransition,
  revalidateContactResolution,
  runContactResolutionCycle,
  type ContactResolutionJob,
  type ContactResolutionStore,
} from '../contactResolutionCore';

interface FakeCandidate {
  id: number;
  organizationId: number;
  signalCandidateId: string;
  status: 'pending' | 'resolved' | 'suppressed' | 'not_found' | 'failed';
  attempts: number;
  nextAttemptAt: Date;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  emails: string[];
  lastErrorCode: string | null;
}

class FakeContactResolutionStore implements ContactResolutionStore {
  constructor(
    readonly candidate: FakeCandidate,
    private readonly signalTenantId = 'org_1',
  ) {}

  async claimDue({
    now,
    leaseToken,
    leaseExpiresAt,
  }: {
    limit: number;
    now: Date;
    leaseToken: string;
    leaseExpiresAt: Date;
  }): Promise<ContactResolutionJob[]> {
    const candidate = this.candidate;
    const leaseIsActive = candidate.leaseExpiresAt != null && candidate.leaseExpiresAt > now;
    if (
      candidate.status !== 'pending'
      || candidate.nextAttemptAt > now
      || leaseIsActive
    ) {
      return [];
    }

    candidate.leaseToken = leaseToken;
    candidate.leaseExpiresAt = leaseExpiresAt;
    candidate.attempts += 1;
    return [{
      id: candidate.id,
      organizationId: candidate.organizationId,
      signalCandidateId: candidate.signalCandidateId,
      externalJobId: 'vanta:jobs:42',
      attempts: candidate.attempts,
      leaseToken,
    }];
  }

  async getSignalTenantId(): Promise<string | null> {
    return this.signalTenantId;
  }

  async markResolved({
    leaseToken,
    status,
    emails,
  }: Parameters<ContactResolutionStore['markResolved']>[0]): Promise<void> {
    if (this.candidate.leaseToken !== leaseToken) return;
    this.candidate.status = status;
    this.candidate.emails = emails;
    this.candidate.leaseToken = null;
    this.candidate.leaseExpiresAt = null;
    this.candidate.lastErrorCode = null;
  }

  async markRetry({
    leaseToken,
    nextAttemptAt,
    errorCode,
  }: Parameters<ContactResolutionStore['markRetry']>[0]): Promise<void> {
    if (this.candidate.leaseToken !== leaseToken) return;
    this.candidate.nextAttemptAt = nextAttemptAt;
    this.candidate.leaseToken = null;
    this.candidate.leaseExpiresAt = null;
    this.candidate.lastErrorCode = errorCode;
  }

  async markFailed({
    leaseToken,
    errorCode,
  }: Parameters<ContactResolutionStore['markFailed']>[0]): Promise<void> {
    if (this.candidate.leaseToken !== leaseToken) return;
    this.candidate.status = 'failed';
    this.candidate.leaseToken = null;
    this.candidate.leaseExpiresAt = null;
    this.candidate.lastErrorCode = errorCode;
  }
}

function candidate(overrides: Partial<FakeCandidate> = {}): FakeCandidate {
  return {
    id: 41,
    organizationId: 1,
    signalCandidateId: 'candidate-41',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date('2026-07-25T10:00:00.000Z'),
    leaseToken: null,
    leaseExpiresAt: null,
    emails: [],
    lastErrorCode: null,
    ...overrides,
  };
}

function options() {
  return {
    batchSize: 10,
    concurrency: 2,
    leaseMs: 60_000,
    retryDelayMs: () => 30_000,
  };
}

describe('contact resolution recovery', () => {
  it('rejects manual lookup before shortlist at the server policy boundary', () => {
    expect(planManualContactResolution({
      candidateState: 'new',
      emailResolveStatus: null,
      foundEmail: null,
      foundEmails: null,
      lastErrorCode: null,
    })).toEqual({ action: 'reject_not_shortlisted' });
  });

  it('does not restart terminal operations through the manual endpoint', () => {
    expect(planManualContactResolution({
      candidateState: 'shortlisted',
      emailResolveStatus: 'not_found',
      foundEmail: 'stale@example.com',
      foundEmails: ['stale@example.com'],
      lastErrorCode: null,
    })).toEqual({
      action: 'return',
      status: 200,
      state: 'not_found',
      emails: [],
    });
    expect(planManualContactResolution({
      candidateState: 'shortlisted',
      emailResolveStatus: 'failed',
      foundEmail: null,
      foundEmails: null,
      lastErrorCode: 'signal_terminal_ambiguous',
    })).toEqual({
      action: 'return',
      status: 409,
      state: 'failed',
      emails: [],
      code: 'signal_terminal_ambiguous',
    });
  });

  it('revalidates a cached resolved contact instead of treating it as permanent truth', () => {
    expect(planManualContactResolution({
      candidateState: 'shortlisted',
      emailResolveStatus: 'resolved',
      foundEmail: 'primary@example.com',
      foundEmails: ['primary@example.com', 'second@example.com'],
      lastErrorCode: null,
    })).toEqual({ action: 'revalidate' });
  });

  it.each(['pending', 'resolved', 'suppressed'])(
    'preserves a current %s state during a concurrent shortlist transition',
    (emailResolveStatus) => {
      expect(planShortlistContactTransition({
        targetState: 'shortlisted',
        emailResolveStatus,
        signalTenantId: 'org_1',
        signalCandidateId: 'candidate-1',
      })).toEqual({ action: 'preserve' });
    },
  );

  it('cancels pending enrichment when a candidate leaves the shortlist', () => {
    expect(planShortlistContactTransition({
      targetState: 'new',
      emailResolveStatus: 'pending',
      signalTenantId: 'org_1',
      signalCandidateId: 'candidate-1',
    })).toEqual({ action: 'cancel_pending' });
    expect(planShortlistContactTransition({
      targetState: 'hidden',
      emailResolveStatus: 'resolved',
      signalTenantId: 'org_1',
      signalCandidateId: 'candidate-1',
    })).toEqual({ action: 'preserve' });
  });

  it('never restarts terminal contact states through an ordinary shortlist transition', () => {
    expect(planShortlistContactTransition({
      targetState: 'shortlisted',
      emailResolveStatus: 'not_found',
      signalTenantId: 'org_1',
      signalCandidateId: 'candidate-1',
    })).toEqual({ action: 'preserve' });
    expect(planShortlistContactTransition({
      targetState: 'shortlisted',
      emailResolveStatus: 'failed',
      signalTenantId: 'org_1',
      signalCandidateId: ' ',
    })).toEqual({ action: 'preserve' });
  });

  it('claims no more rows than can start before the shared lease expires', async () => {
    const claimDue = vi.fn(async () => []);
    const store: ContactResolutionStore = {
      claimDue,
      getSignalTenantId: vi.fn(),
      markResolved: vi.fn(),
      markRetry: vi.fn(),
      markFailed: vi.fn(),
    };

    await runContactResolutionCycle({
      store,
      resolveContact: vi.fn(),
      createLeaseToken: () => 'bounded-lease',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, {
      ...options(),
      batchSize: 20,
      concurrency: 2,
    });

    expect(claimDue).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });

  it('leases once when two processors poll concurrently', async () => {
    const row = candidate();
    const store = new FakeContactResolutionStore(row);
    let releaseResolver!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });
    const resolveContact = vi.fn(async () => {
      signalStarted();
      await release;
      return {
        success: true,
        state: 'found' as const,
        emails: ['candidate@example.com'],
      };
    });
    let leaseSequence = 0;
    const dependencies = {
      store,
      resolveContact,
      createLeaseToken: () => `lease-${++leaseSequence}`,
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    };

    const firstCycle = runContactResolutionCycle(dependencies, options());
    await started;
    const secondCycle = await runContactResolutionCycle(dependencies, options());
    expect(secondCycle.claimed).toBe(0);

    releaseResolver();
    await expect(firstCycle).resolves.toMatchObject({ claimed: 1, resolved: 1 });
    expect(resolveContact).toHaveBeenCalledTimes(1);
    expect(resolveContact).toHaveBeenCalledWith(
      'org_1',
      'candidate-41',
      'vanta:jobs:42',
    );
    expect(row.attempts).toBe(1);
    expect(row.status).toBe('resolved');
  });

  it('reclaims an expired lease after a process restart', async () => {
    const row = candidate({
      attempts: 1,
      leaseToken: 'crashed-process',
      leaseExpiresAt: new Date('2026-07-25T10:01:00.000Z'),
    });
    const store = new FakeContactResolutionStore(row);
    const resolveContact = vi.fn(async () => ({
      success: true,
      state: 'not_found' as const,
      emails: [],
    }));

    const beforeExpiry = await runContactResolutionCycle({
      store,
      resolveContact,
      createLeaseToken: () => 'before-expiry',
      now: () => new Date('2026-07-25T10:00:30.000Z'),
    }, options());
    expect(beforeExpiry.claimed).toBe(0);

    // A new processor instance reads the same durable row after the old lease
    // expires. No in-memory state from the crashed process is required.
    const afterRestart = await runContactResolutionCycle({
      store,
      resolveContact,
      createLeaseToken: () => 'after-restart',
      now: () => new Date('2026-07-25T10:01:01.000Z'),
    }, options());

    expect(afterRestart).toMatchObject({ claimed: 1, resolved: 1 });
    expect(resolveContact).toHaveBeenCalledTimes(1);
    expect(row.attempts).toBe(2);
    expect(row.status).toBe('not_found');
    expect(row.leaseToken).toBeNull();
  });

  it('backs off an HTTP 202 pending operation without marking it not found', async () => {
    const row = candidate({ attempts: 99 });
    const store = new FakeContactResolutionStore(row);

    const result = await runContactResolutionCycle({
      store,
      resolveContact: async () => ({
        success: true,
        state: 'pending',
        emails: [],
      }),
      createLeaseToken: () => 'pending-lease',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, options());

    expect(result).toMatchObject({ claimed: 1, retried: 1, resolved: 0 });
    expect(row.status).toBe('pending');
    expect(row.nextAttemptAt.toISOString()).toBe('2026-07-25T10:00:30.000Z');
    expect(row.lastErrorCode).toBe('signal_pending');
    expect(row.leaseToken).toBeNull();
  });

  it('revalidates suppression and persists no stale email before contact use', async () => {
    const persist = vi.fn(async () => true);
    const result = await revalidateContactResolution({
      candidateId: 41,
      organizationId: 1,
      jobId: 42,
      signalTenantId: 'org_1',
      signalCandidateId: 'candidate-41',
      externalJobId: 'vanta:jobs:42',
      attempts: 8,
    }, {
      store: { persist },
      resolveContact: async () => ({
        success: true,
        state: 'suppressed',
        emails: ['stale@example.com'],
      }),
      now: () => new Date('2026-07-25T10:00:00.000Z'),
      retryDelayMs: () => 30_000,
    });

    expect(result).toEqual({
      persisted: true,
      state: 'suppressed',
      emails: [],
      errorCode: null,
    });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      status: 'suppressed',
      emails: [],
      resolvedAt: new Date('2026-07-25T10:00:00.000Z'),
    }));
  });

  it('preserves a platform suppression as a distinct terminal state', async () => {
    const row = candidate({ emails: ['legacy@example.com'] });
    const store = new FakeContactResolutionStore(row);

    const result = await runContactResolutionCycle({
      store,
      resolveContact: async () => ({
        success: true,
        state: 'suppressed',
        emails: [],
      }),
      createLeaseToken: () => 'suppressed-lease',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, options());

    expect(result).toMatchObject({ claimed: 1, resolved: 1, failed: 0 });
    expect(row.status).toBe('suppressed');
    expect(row.emails).toEqual([]);
    expect(row.lastErrorCode).toBeNull();
  });

  it('retries Signal outages but fails terminal client errors', async () => {
    const retryableRow = candidate({ attempts: 99 });
    const retryableStore = new FakeContactResolutionStore(retryableRow);
    const retryable = await runContactResolutionCycle({
      store: retryableStore,
      resolveContact: async () => {
        throw { status: 503 };
      },
      createLeaseToken: () => 'retryable-lease',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, options());

    expect(retryable.retried).toBe(1);
    expect(retryableRow.status).toBe('pending');
    expect(retryableRow.lastErrorCode).toBe('signal_http_503');

    const authRow = candidate({ attempts: 99 });
    const authStore = new FakeContactResolutionStore(authRow);
    const authFailure = await runContactResolutionCycle({
      store: authStore,
      resolveContact: async () => {
        throw { status: 401 };
      },
      createLeaseToken: () => 'auth-lease',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, options());

    expect(authFailure.retried).toBe(1);
    expect(authRow.status).toBe('pending');
    expect(authRow.lastErrorCode).toBe('signal_http_401');

    const terminalRow = candidate();
    const terminalStore = new FakeContactResolutionStore(terminalRow);
    const terminal = await runContactResolutionCycle({
      store: terminalStore,
      resolveContact: async () => {
        throw { status: 404 };
      },
      createLeaseToken: () => 'terminal-lease',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, options());

    expect(terminal.failed).toBe(1);
    expect(terminalRow.status).toBe('failed');
    expect(terminalRow.lastErrorCode).toBe('signal_http_404');
  });

  it.each([
    ['ambiguous', 'enrichlayer_ambiguous'],
    ['failed', 'missing_linkedin_url'],
  ] as const)('preserves Signal 409 %s terminality and exact code', async (state, expectedCode) => {
    const row = candidate();
    const store = new FakeContactResolutionStore(row);

    const result = await runContactResolutionCycle({
      store,
      resolveContact: async () => {
        throw { status: 409, body: { state, code: expectedCode } };
      },
      createLeaseToken: () => `${state}-lease`,
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, options());

    expect(result).toMatchObject({ claimed: 1, failed: 1, retried: 0 });
    expect(row.status).toBe('failed');
    expect(row.lastErrorCode).toBe(expectedCode);
  });

  it('terminalizes a blank Signal candidate ID without making a request', async () => {
    const row = candidate({ signalCandidateId: '   ' });
    const store = new FakeContactResolutionStore(row);
    const resolveContact = vi.fn();

    const result = await runContactResolutionCycle({
      store,
      resolveContact,
      createLeaseToken: () => 'blank-id-lease',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    }, options());

    expect(result).toMatchObject({ claimed: 1, failed: 1 });
    expect(resolveContact).not.toHaveBeenCalled();
    expect(row.status).toBe('failed');
    expect(row.lastErrorCode).toBe('missing_signal_candidate_id');
  });
});
