// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  fitUsed: 0,
  fitPending: 0,
  contentUsed: false,
}));

vi.mock('../../db', () => ({
  pool: {},
  db: {
    select: () => ({
      from: () => ({
        where: async () => [{
          used: mockState.fitUsed,
          pending: mockState.fitPending,
        }],
      }),
    }),
    query: {
      users: {
        findFirst: async () => ({ aiContentFreeUsed: mockState.contentUsed }),
      },
    },
  },
}));

vi.mock('../../storage', () => ({ storage: {} }));
vi.mock('../../simpleEmailService', () => ({ getEmailService: vi.fn() }));
vi.mock('../profileCompletion', () => ({ computeProfileCompletion: vi.fn() }));
vi.mock('../organizationService', () => ({ getOrganizationInviteByToken: vi.fn() }));
vi.mock('../mauticService', () => ({
  queueMauticFirstLoginSync: vi.fn(),
  queueMauticSignupSync: vi.fn(),
}));

import { requireVerifiedCandidate } from '../../auth';
import { getCandidateFitLimitPerMonth, getUserLimits } from '../aiLimits';

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe('candidate portal authentication contracts', () => {
  it('allows only verified candidate sessions through the shared middleware', () => {
    const next = vi.fn();

    const anonymousResponse = responseRecorder();
    requireVerifiedCandidate({} as any, anonymousResponse as any, next);
    expect(anonymousResponse.statusCode).toBe(401);

    const recruiterResponse = responseRecorder();
    requireVerifiedCandidate(
      { user: { id: 1, role: 'recruiter', emailVerified: true } } as any,
      recruiterResponse as any,
      next
    );
    expect(recruiterResponse.statusCode).toBe(403);
    expect(recruiterResponse.body).toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });

    const unverifiedResponse = responseRecorder();
    requireVerifiedCandidate(
      {
        user: {
          id: 2,
          role: 'candidate',
          emailVerified: false,
          username: 'candidate@example.com',
        },
      } as any,
      unverifiedResponse as any,
      next
    );
    expect(unverifiedResponse.statusCode).toBe(403);
    expect(unverifiedResponse.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

    requireVerifiedCandidate(
      {
        user: {
          id: 3,
          role: 'candidate',
          emailVerified: true,
          username: 'verified@example.com',
        },
      } as any,
      responseRecorder() as any,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks candidate login before session creation and application claiming', () => {
    const authSource = read('../../auth.ts');
    const verificationGate = authSource.indexOf(
      "(user.role === 'recruiter' || user.role === 'candidate') && !user.emailVerified"
    );
    const sessionCreation = authSource.indexOf('req.login(user,', verificationGate);
    const applicationClaim = authSource.indexOf(
      'storage.claimApplicationsForUser(user.id, user.username)',
      verificationGate
    );

    expect(verificationGate).toBeGreaterThan(-1);
    expect(sessionCreation).toBeGreaterThan(verificationGate);
    expect(applicationClaim).toBeGreaterThan(sessionCreation);
  });

  it('uses Ealana in applicant-visible auth email copy without renaming the session secret', () => {
    const authSource = read('../../auth.ts');
    const applicantEmailCopy = [
      'Verify your Ealana account',
      'Welcome to Ealana!',
      'Reset Your Ealana Password',
      'Reset your Ealana password',
    ];

    for (const expected of applicantEmailCopy) {
      expect(authSource).toContain(expected);
    }
    expect(authSource).not.toMatch(/Verify your VantaHire|Welcome to VantaHire|Reset Your VantaHire/);
    expect(authSource).toContain('process.env.SESSION_SECRET');
    expect(authSource).toContain("'vantahire-dev-secret'");
  });
});

describe('candidate monthly match quota contracts', () => {
  beforeEach(() => {
    mockState.fitUsed = 0;
    mockState.fitPending = 0;
    mockState.contentUsed = false;
  });

  it('has a hard candidate-scoped limit of 10', () => {
    expect(getCandidateFitLimitPerMonth()).toBe(10);

    process.env.CANDIDATE_AI_MATCH_MONTHLY_LIMIT = '17';
    expect(getCandidateFitLimitPerMonth()).toBe(10);
    delete process.env.CANDIDATE_AI_MATCH_MONTHLY_LIMIT;
  });

  it('reports charged and in-flight usage against the same candidate limit', async () => {
    mockState.fitUsed = 9;

    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitLimitPerMonth: 10,
      fitUsedThisMonth: 9,
      fitPendingThisMonth: 0,
      fitRemainingThisMonth: 1,
      canUseFit: true,
    });

    mockState.fitPending = 1;
    await expect(getUserLimits(42)).resolves.toMatchObject({
      fitLimitPerMonth: 10,
      fitUsedThisMonth: 9,
      fitPendingThisMonth: 1,
      fitRemainingThisMonth: 0,
      canUseFit: false,
    });

    const limitsSource = read('../aiLimits.ts');
    expect(limitsSource).toContain('eq(userAiUsage.userId, userId)');
    expect(limitsSource).toContain("${userAiUsage.kind} = 'fit'");
    expect(limitsSource).toContain("${userAiUsage.kind} = 'fit_pending'");
    expect(limitsSource).toContain('pg_advisory_xact_lock');
  });

  it('returns a candidate-only quota error contract without billing links', () => {
    const routesSource = read('../../ai.routes.ts');
    const quotaPayloadStart = routesSource.indexOf('function candidateQuotaExceededPayload');
    const quotaPayloadEnd = routesSource.indexOf('// Rate limiters', quotaPayloadStart);
    const quotaPayload = routesSource.slice(quotaPayloadStart, quotaPayloadEnd);

    expect(quotaPayload).toContain("errorCode: 'QUOTA_EXCEEDED'");
    expect(quotaPayload).toContain('fitLimitPerMonth');
    expect(quotaPayload).not.toMatch(/billingUrl|pricingUrl|upgrade|subscription/i);
  });

  it('gates every candidate match, limit, queue, and status route as verified', () => {
    const routesSource = read('../../ai.routes.ts');
    const candidateRoutes: Array<[string, number]> = [
      ["'/api/ai/match',", 1],
      ["'/api/ai/match/batch',", 1],
      ["'/api/ai/limits',", 1],
      ["'/api/ai/match/queue',", 1],
      ["'/api/ai/match/batch/queue',", 1],
      ["'/api/ai/match/jobs/:id',", 2],
      ["'/api/ai/match/jobs',", 1],
    ];

    for (const [route, expectedRegistrations] of candidateRoutes) {
      let searchFrom = 0;
      for (let occurrence = 0; occurrence < expectedRegistrations; occurrence++) {
        const routeStart = routesSource.indexOf(route, searchFrom);
        expect(
          routeStart,
          `${route} registration ${occurrence + 1} should exist`
        ).toBeGreaterThan(-1);
        expect(routesSource.slice(routeStart, routeStart + 180)).toContain(
          'requireVerifiedCandidate'
        );
        searchFrom = routeStart + route.length;
      }
    }

    expect(routesSource).not.toMatch(
      /'\/api\/ai\/(?:match(?:\/(?:batch|queue|batch\/queue|jobs(?::\/id)?))?|limits)',\s*requireAuth,\s*requireRole\(\['candidate'\]\)/
    );
  });

  it('wires optimistic fit admission through sync and retry-safe worker paths', () => {
    const routesSource = read('../../ai.routes.ts');
    const workerSource = read('../../aiWorker.ts');

    const syncSingleStart = routesSource.indexOf(
      "app.post(\n    '/api/ai/match',"
    );
    const syncBatchStart = routesSource.indexOf(
      "app.post(\n    '/api/ai/match/batch',"
    );
    expect(
      routesSource.slice(syncSingleStart, syncBatchStart)
    ).toMatch(
      /reserveFitCredit\(\s*userId,\s*applicationId,\s*application\.aiComputedAt/
    );
    expect(
      routesSource.slice(syncBatchStart, routesSource.indexOf("'/api/ai/limits'", syncBatchStart))
    ).toMatch(
      /reserveFitCredit\(\s*userId,\s*appId,\s*app\.aiComputedAt/
    );

    const processOneStart = workerSource.indexOf(
      'async function processOneApplication('
    );
    const interactiveStart = workerSource.indexOf(
      'async function processFitJob('
    );
    const batchStart = workerSource.indexOf(
      'async function processBatchFitJob('
    );
    const summaryStart = workerSource.indexOf(
      '// ============= SUMMARY BATCH PROCESSING'
    );
    const processOneSource = workerSource.slice(processOneStart, interactiveStart);
    const interactiveSource = workerSource.slice(interactiveStart, batchStart);
    const batchSource = workerSource.slice(batchStart, summaryStart);

    expect(processOneSource).toMatch(
      /reserveFitCredit\(\s*userId,\s*applicationId,\s*app\.aiComputedAt/
    );
    expect(processOneSource).toContain(
      "reservationResult.status === 'cached'"
    );
    expect(interactiveSource).toContain(
      "updateAiFitJobStatus(dbJobId, 'pending')"
    );

    const retryBranch = batchSource.indexOf(
      'error instanceof FitComputationInProgressError'
    );
    const terminalResult = batchSource.indexOf(
      "results.push({ applicationId: appId, status: 'error'"
    );
    expect(retryBranch).toBeGreaterThan(-1);
    expect(batchSource.slice(retryBranch, terminalResult)).toContain(
      'throw error'
    );
    expect(retryBranch).toBeLessThan(terminalResult);

    const workerMain = workerSource.slice(workerSource.indexOf('async function main('));
    expect(workerMain).toContain(
      'reconcileTerminalInteractiveFitCollision(job, error'
    );
    expect(workerMain).toContain(
      'reconcileTerminalBatchFitCollision(fitJob, error'
    );
  });
});
