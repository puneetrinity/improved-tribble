// @vitest-environment node
import '../setup.integration';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../../server/routes';
import { db } from '../../server/db';
import {
  organizations,
  users,
  jobs,
  jobSourcingRuns,
  jobSourcedCandidates,
  webhookEvents,
} from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import {
  createOrganizationWithOwner,
  createRecruiterUser,
} from '../utils/db-helpers';
import { CURRENT_DIGEST_VERSION } from '../../server/lib/jdDigest';

// ── Mocks ──────────────────────────────────────────────────────────────
const jwtMock = vi.hoisted(() => ({
  verifySignalCallbackJwt: vi.fn(),
}));

const signalClientMock = vi.hoisted(() => ({
  getResults: vi.fn(),
  sourceJob: vi.fn(),
}));

const sourcingRefreshQueueMock = vi.hoisted(() => ({
  enqueueSourcingRefresh: vi.fn(),
}));

vi.mock('../../server/lib/services/jwt-signer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/lib/services/jwt-signer')>();
  return { ...original, verifySignalCallbackJwt: jwtMock.verifySignalCallbackJwt };
});

vi.mock('../../server/lib/services/signal-client', () => ({
  getResults: signalClientMock.getResults,
  sourceJob: signalClientMock.sourceJob,
}));

vi.mock('../../server/lib/sourcingRefreshQueue', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/lib/sourcingRefreshQueue')>();
  return {
    ...original,
    enqueueSourcingRefresh: sourcingRefreshQueueMock.enqueueSourcingRefresh,
  };
});

const emailMocks = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendContactNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/simpleEmailService', () => ({
  getEmailService: vi.fn(async () => emailMocks),
}));

// ── Test gate ──────────────────────────────────────────────────────────
const HAS_DB = !!process.env.DATABASE_URL;
const maybeDescribe = HAS_DB ? describe : describe.skip;

if (!HAS_DB) {
  console.warn('[TEST] Skipping signal-webhook integration tests: DATABASE_URL not set');
}

maybeDescribe('Signal webhook callback integration', () => {
  let app: express.Express;
  let server: any;
  let recruiterLogin: { username: string; password: string };

  // Tracking for cleanup
  const created = {
    userIds: [] as number[],
    orgIds: [] as number[],
    jobIds: [] as number[],
    requestIds: [] as string[],
    webhookEventIds: [] as string[],
  };

  let org: { id: number; signalTenantId: string };
  let jobId: number;
  const TENANT_ID = `test-tenant-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    process.env.BASE_URL = 'http://localhost:5000';
    sourcingRefreshQueueMock.enqueueSourcingRefresh.mockResolvedValue('sourcing-refresh:test');

    app = express();
    server = await registerRoutes(app);

    // Create user + org with signalTenantId
    const user = await createRecruiterUser({
      username: `signal-test-${randomUUID().slice(0, 8)}@test.com`,
      password: 'TestPass1!',
    });
    recruiterLogin = { username: user.username, password: 'TestPass1!' };
    created.userIds.push(user.id);

    const orgResult = await createOrganizationWithOwner({
      name: `SignalTest-${randomUUID().slice(0, 8)}`,
      ownerId: user.id,
    });
    created.orgIds.push(orgResult.id);

    // Set signalTenantId
    await db.update(organizations)
      .set({ signalTenantId: TENANT_ID })
      .where(eq(organizations.id, orgResult.id));

    org = { id: orgResult.id, signalTenantId: TENANT_ID };

    // Create a test job
    const [job] = await db.insert(jobs).values({
      organizationId: org.id,
      title: 'Test Signal Engineer',
      location: 'Delhi, India',
      type: 'full-time',
      description: 'Test job for webhook integration',
      skills: ['typescript', 'node'],
      postedBy: user.id,
      isActive: true,
      status: 'approved',
    }).returning();
    jobId = job.id;
    created.jobIds.push(job.id);
  });

  afterAll(async () => {
    server?.close();

    if (!HAS_DB) return;

    // Cleanup in reverse dependency order
    if (created.requestIds.length > 0) {
      for (const reqId of created.requestIds) {
        await db.delete(jobSourcedCandidates).where(eq(jobSourcedCandidates.requestId, reqId));
      }
    }
    if (created.requestIds.length > 0) {
      for (const reqId of created.requestIds) {
        await db.delete(jobSourcingRuns).where(eq(jobSourcingRuns.requestId, reqId));
      }
    }
    if (created.webhookEventIds.length > 0) {
      for (const eid of created.webhookEventIds) {
        await db.delete(webhookEvents).where(
          and(eq(webhookEvents.provider, 'signal'), eq(webhookEvents.eventId, eid)),
        );
      }
    }
    if (created.jobIds.length > 0) {
      await db.delete(jobs).where(inArray(jobs.id, created.jobIds));
    }
    if (created.orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, created.orgIds));
    }
    if (created.userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, created.userIds));
    }
  });

  afterEach(() => {
    jwtMock.verifySignalCallbackJwt.mockReset();
    signalClientMock.getResults.mockReset();
    sourcingRefreshQueueMock.enqueueSourcingRefresh.mockReset();
    sourcingRefreshQueueMock.enqueueSourcingRefresh.mockResolvedValue('sourcing-refresh:test');
  });

  /** Helper: create a run record and return its requestId */
  async function createRun(overrides: Partial<{
    requestId: string;
    status: string;
    meta: Record<string, unknown>;
  }> = {}) {
    const requestId = overrides.requestId ?? randomUUID();
    created.requestIds.push(requestId);

    await db.insert(jobSourcingRuns).values({
      organizationId: org.id,
      jobId,
      requestId,
      externalJobId: `vanta:jobs:${jobId}`,
      status: overrides.status ?? 'submitted',
      contextHash: randomUUID(),
      callbackUrl: 'http://localhost:5000/api/webhooks/signal/callback',
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      meta: overrides.meta ?? {},
    });

    return requestId;
  }

  /** Helper: build mock JWT claims */
  function mockJwtClaims(requestId: string, jti?: string) {
    const claims = {
      jti: jti ?? randomUUID(),
      tenantId: TENANT_ID,
      requestId,
      scopes: 'callbacks:write',
    };
    created.webhookEventIds.push(claims.jti);
    jwtMock.verifySignalCallbackJwt.mockResolvedValue(claims);
    return claims;
  }

  /** Helper: build mock candidates from getResults */
  function makeMockCandidates(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      candidateId: `cand-${randomUUID().slice(0, 8)}`,
      fitScore: 80 - i * 5,
      fitBreakdown: { skill: 0.8, experience: 0.7 },
      sourceType: 'pool_enriched',
      enrichmentStatus: 'enriched',
      rank: i + 1,
      matchTier: i < 2 ? 'best_matches' : 'broader_pool',
      locationMatchType: i < 2 ? 'city_exact' : 'none',
      candidate: {
        id: `cand-${i}`,
        linkedinUrl: null,
        linkedinId: null,
        nameHint: `Candidate ${i}`,
        headlineHint: 'Engineer',
        locationHint: 'Delhi',
        companyHint: 'TestCo',
        enrichmentStatus: 'enriched',
        confidenceScore: 0.9,
        lastEnrichedAt: new Date().toISOString(),
        intelligenceSnapshots: [],
      },
      identitySummary: null,
      snapshot: null,
      freshness: { lastEnrichedAt: new Date().toISOString() },
    }));
  }

  async function loginRecruiterAgent() {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/login').send({
      username: recruiterLogin.username,
      password: recruiterLogin.password,
      expectedRole: ['recruiter'],
    });
    expect(loginRes.status).toBe(200);
    return agent;
  }

  async function loginSuperAdminAgent(username: string, password: string) {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/login').send({
      username,
      password,
      expectedRole: ['super_admin'],
    });
    expect(loginRes.status).toBe(200);
    const csrfRes = await agent.get('/api/csrf-token');
    expect(csrfRes.status).toBe(200);
    return { agent, csrfToken: csrfRes.body?.token as string };
  }

  // ── Test 1: Successful callback with candidates ──────────────────────
  it('marks run completed and upserts candidates on success', async () => {
    const requestId = await createRun();
    const claims = mockJwtClaims(requestId);
    const mockCandidates = makeMockCandidates(3);

    signalClientMock.getResults.mockResolvedValue({
      success: true,
      requestId,
      externalJobId: `vanta:jobs:${jobId}`,
      status: 'complete',
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      resultCount: 3,
      groupCounts: {
        bestMatches: 2,
        broaderPool: 1,
        strictMatchedCount: 2,
        expandedCount: 1,
        expansionReason: 'insufficient_strict_location_matches',
        requestedLocation: 'Delhi, India',
        selectedSnapshotTrack: 'non-tech',
      },
      trackDecision: { track: 'non_tech', confidence: 0.91, method: 'deterministic' },
      candidates: mockCandidates,
    });

    const res = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', `Bearer fake-token`)
      .send({
        version: 1,
        requestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'complete',
        candidateCount: 3,
        enrichedCount: 3,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify run status
    const run = await db.query.jobSourcingRuns.findFirst({
      where: eq(jobSourcingRuns.requestId, requestId),
    });
    expect(run?.status).toBe('completed');
    expect(run?.candidateCount).toBe(3);
    const meta = run?.meta as Record<string, unknown>;
    expect(meta?.requestedLocation).toBe('Delhi, India');
    expect((meta?.groupCounts as Record<string, unknown>)?.expansionReason).toBe('insufficient_strict_location_matches');
    expect((meta?.trackDecision as Record<string, unknown>)?.track).toBe('non_tech');

    // Verify candidates were upserted
    const candidates = await db.query.jobSourcedCandidates.findMany({
      where: eq(jobSourcedCandidates.requestId, requestId),
    });
    expect(candidates.length).toBe(3);

    // Verify webhook event finalized as 'processed'
    const event = await db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, 'signal'),
        eq(webhookEvents.eventId, claims.jti),
      ),
    });
    expect(event?.status).toBe('processed');
  });

  it('allows super_admin to trigger sourcing using the job organization tenant', async () => {
    const superAdmin = await createRecruiterUser({
      username: `signal-admin-${randomUUID().slice(0, 8)}@test.com`,
      password: 'TestPass1!',
      role: 'super_admin',
    });
    created.userIds.push(superAdmin.id);

    const adminOrg = await createOrganizationWithOwner({
      name: `SignalAdminOrg-${randomUUID().slice(0, 8)}`,
      ownerId: superAdmin.id,
    });
    created.orgIds.push(adminOrg.id);

    await db.update(jobs)
      .set({
        jdDigest: {
          summary: 'Senior TypeScript engineer',
          topSkills: ['typescript', 'node'],
          version: CURRENT_DIGEST_VERSION,
        },
        jdDigestVersion: CURRENT_DIGEST_VERSION,
      })
      .where(eq(jobs.id, jobId));

    const requestId = randomUUID();
    created.requestIds.push(requestId);
    signalClientMock.sourceJob.mockResolvedValue({
      success: true,
      requestId,
      status: 'queued',
      idempotent: false,
    });

    const { agent, csrfToken } = await loginSuperAdminAgent(superAdmin.username, 'TestPass1!');
    const res = await agent
      .post(`/api/jobs/${jobId}/find-candidates`)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(202);
    expect(signalClientMock.sourceJob).toHaveBeenCalledWith(
      TENANT_ID,
      `vanta:jobs:${jobId}`,
      expect.objectContaining({
        callbackUrl: 'http://localhost:5000/api/webhooks/signal/callback',
      }),
    );
  });

  // ── Test 2: getResults failure → run marked 'failed' ────────────────
  it('marks run failed with errorCode when getResults throws', async () => {
    const requestId = await createRun();
    const claims = mockJwtClaims(requestId);

    signalClientMock.getResults.mockRejectedValue(new Error('Signal API 502'));

    const res = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', `Bearer fake-token`)
      .send({
        version: 1,
        requestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'complete',
        candidateCount: 5,
        enrichedCount: 5,
      });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      retryable: true,
      error: 'Callback processing failed',
    });

    // Run should be 'failed', not 'completed'
    const run = await db.query.jobSourcingRuns.findFirst({
      where: eq(jobSourcingRuns.requestId, requestId),
    });
    expect(run?.status).toBe('failed');
    expect(run?.candidateCount).toBe(0);
    expect(run?.errorMessage).toContain('Results fetch failed');

    const meta = run?.meta as Record<string, unknown>;
    expect(meta?.errorCode).toBe('RESULTS_FETCH_FAILED');

    // No candidates should have been upserted
    const candidates = await db.query.jobSourcedCandidates.findMany({
      where: eq(jobSourcedCandidates.requestId, requestId),
    });
    expect(candidates.length).toBe(0);

    // Webhook event should be 'failed'
    const event = await db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, 'signal'),
        eq(webhookEvents.eventId, claims.jti),
      ),
    });
    expect(event?.status).toBe('failed');
  });

  it('acknowledges a Signal-declared failure without requesting redelivery', async () => {
    const requestId = await createRun();
    const claims = mockJwtClaims(requestId);

    const res = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', 'Bearer fake-token')
      .send({
        version: 1,
        requestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'failed',
        candidateCount: 0,
        enrichedCount: 0,
        error: 'Sourcing failed upstream',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(signalClientMock.getResults).not.toHaveBeenCalled();

    const run = await db.query.jobSourcingRuns.findFirst({
      where: eq(jobSourcingRuns.requestId, requestId),
    });
    expect(run?.status).toBe('failed');
    expect(run?.candidateCount).toBe(0);
    expect(run?.errorMessage).toBe('Sourcing failed upstream');

    const event = await db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, 'signal'),
        eq(webhookEvents.eventId, claims.jti),
      ),
    });
    expect(event?.status).toBe('failed');
  });

  // ── Test 2b: upsert refresh updates non-new rows without clobbering state ──
  it('refreshes shortlisted rows and updates request_id to the latest run', async () => {
    const initialRequestId = await createRun({ status: 'completed' });
    const latestRequestId = await createRun({ status: 'submitted' });
    const claims = mockJwtClaims(latestRequestId);
    const signalCandidateId = `cand-shared-${randomUUID().slice(0, 8)}`;

    await db.insert(jobSourcedCandidates).values({
      organizationId: org.id,
      jobId,
      requestId: initialRequestId,
      signalCandidateId,
      fitScore: 41,
      fitBreakdown: { skill: 0.2 },
      sourceType: 'pool',
      state: 'shortlisted',
      candidateSummary: {
        nameHint: 'Old Name',
        enrichmentStatus: 'pending',
      },
    });

    signalClientMock.getResults.mockResolvedValue({
      success: true,
      requestId: latestRequestId,
      externalJobId: `vanta:jobs:${jobId}`,
      status: 'complete',
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      resultCount: 1,
      candidates: [
        {
          candidateId: signalCandidateId,
          fitScore: 0.92,
          fitBreakdown: { skill: 0.95, experience: 0.85 },
          sourceType: 'pool_enriched',
          enrichmentStatus: 'completed',
          rank: 1,
          candidate: {
            id: signalCandidateId,
            linkedinUrl: null,
            linkedinId: null,
            nameHint: 'New Name',
            headlineHint: 'Senior Engineer',
            locationHint: 'Mumbai',
            companyHint: 'NewCo',
            enrichmentStatus: 'completed',
            confidenceScore: 0.93,
            lastEnrichedAt: new Date().toISOString(),
            intelligenceSnapshots: [],
          },
          identitySummary: null,
          snapshot: null,
          freshness: { lastEnrichedAt: new Date().toISOString() },
        },
      ],
    });

    const res = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', 'Bearer fake-token')
      .send({
        version: 1,
        requestId: latestRequestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'complete',
        candidateCount: 1,
        enrichedCount: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await db.query.jobSourcedCandidates.findFirst({
      where: and(
        eq(jobSourcedCandidates.jobId, jobId),
        eq(jobSourcedCandidates.signalCandidateId, signalCandidateId),
      ),
    });

    expect(row).toBeTruthy();
    expect(row?.state).toBe('shortlisted');
    expect(row?.requestId).toBe(latestRequestId);
    expect(row?.fitScore).toBe(92);
    const summary = row?.candidateSummary as Record<string, unknown>;
    expect(summary?.nameHint).toBe('New Name');

    const event = await db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, 'signal'),
        eq(webhookEvents.eventId, claims.jti),
      ),
    });
    expect(event?.status).toBe('processed');
  });

  // ── Test 2c: queue unavailable should not leave perpetual in-progress ──
  it('marks enrichment refresh stopped_no_queue and status API returns inProgress=false', async () => {
    const requestId = await createRun();
    mockJwtClaims(requestId);
    sourcingRefreshQueueMock.enqueueSourcingRefresh.mockResolvedValue(null);

    signalClientMock.getResults.mockResolvedValue({
      success: true,
      requestId,
      externalJobId: `vanta:jobs:${jobId}`,
      status: 'complete',
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      resultCount: 1,
      candidates: [
        {
          candidateId: `cand-pending-${randomUUID().slice(0, 8)}`,
          fitScore: 0.8,
          fitBreakdown: { skill: 0.8 },
          sourceType: 'discovered',
          enrichmentStatus: 'pending',
          rank: 1,
          candidate: {
            id: `cand-pending-${randomUUID().slice(0, 8)}`,
            linkedinUrl: null,
            linkedinId: null,
            nameHint: 'Pending Candidate',
            headlineHint: 'Engineer',
            locationHint: 'Delhi',
            companyHint: 'TestCo',
            enrichmentStatus: 'pending',
            confidenceScore: 0.8,
            lastEnrichedAt: null,
            intelligenceSnapshots: [],
          },
          identitySummary: null,
          snapshot: null,
          freshness: { lastEnrichedAt: null },
        },
      ],
    });

    const callbackRes = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', 'Bearer fake-token')
      .send({
        version: 1,
        requestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'complete',
        candidateCount: 1,
        enrichedCount: 0,
      });

    expect(callbackRes.status).toBe(200);

    const run = await db.query.jobSourcingRuns.findFirst({
      where: eq(jobSourcingRuns.requestId, requestId),
    });
    const runMeta = (run?.meta ?? {}) as Record<string, unknown>;
    const enrichmentRefresh = (runMeta.enrichmentRefresh ?? {}) as Record<string, unknown>;
    const enrichmentProgress = (runMeta.enrichmentProgress ?? {}) as Record<string, unknown>;
    expect(enrichmentRefresh.status).toBe('stopped_no_queue');
    expect(enrichmentProgress.inProgress).toBe(false);

    const agent = await loginRecruiterAgent();
    const statusRes = await agent.get(`/api/jobs/${jobId}/sourcing-status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.enrichment.refreshStatus).toBe('stopped_no_queue');
    expect(statusRes.body.enrichment.inProgress).toBe(false);
  });

  // ── Test 2d: enqueue throw should not leave perpetual in-progress ──
  it('marks enrichment refresh stopped_enqueue_error and status API returns inProgress=false', async () => {
    const requestId = await createRun();
    mockJwtClaims(requestId);
    sourcingRefreshQueueMock.enqueueSourcingRefresh.mockRejectedValue(new Error('redis down'));

    signalClientMock.getResults.mockResolvedValue({
      success: true,
      requestId,
      externalJobId: `vanta:jobs:${jobId}`,
      status: 'complete',
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      resultCount: 1,
      candidates: [
        {
          candidateId: `cand-pending-${randomUUID().slice(0, 8)}`,
          fitScore: 0.8,
          fitBreakdown: { skill: 0.8 },
          sourceType: 'discovered',
          enrichmentStatus: 'pending',
          rank: 1,
          candidate: {
            id: `cand-pending-${randomUUID().slice(0, 8)}`,
            linkedinUrl: null,
            linkedinId: null,
            nameHint: 'Pending Candidate',
            headlineHint: 'Engineer',
            locationHint: 'Delhi',
            companyHint: 'TestCo',
            enrichmentStatus: 'pending',
            confidenceScore: 0.8,
            lastEnrichedAt: null,
            intelligenceSnapshots: [],
          },
          identitySummary: null,
          snapshot: null,
          freshness: { lastEnrichedAt: null },
        },
      ],
    });

    const callbackRes = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', 'Bearer fake-token')
      .send({
        version: 1,
        requestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'complete',
        candidateCount: 1,
        enrichedCount: 0,
      });

    expect(callbackRes.status).toBe(200);

    const run = await db.query.jobSourcingRuns.findFirst({
      where: eq(jobSourcingRuns.requestId, requestId),
    });
    const runMeta = (run?.meta ?? {}) as Record<string, unknown>;
    const enrichmentRefresh = (runMeta.enrichmentRefresh ?? {}) as Record<string, unknown>;
    const enrichmentProgress = (runMeta.enrichmentProgress ?? {}) as Record<string, unknown>;
    expect(enrichmentRefresh.status).toBe('stopped_enqueue_error');
    expect(enrichmentRefresh.lastEnqueueError).toContain('redis down');
    expect(enrichmentProgress.inProgress).toBe(false);

    const agent = await loginRecruiterAgent();
    const statusRes = await agent.get(`/api/jobs/${jobId}/sourcing-status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.enrichment.refreshStatus).toBe('stopped_enqueue_error');
    expect(statusRes.body.enrichment.inProgress).toBe(false);
  });

  // ── Test 2e: stopped_max_age should force status API inProgress=false ──
  it('forces enrichment.inProgress=false when refresh status is stopped_max_age', async () => {
    await createRun({
      status: 'completed',
      meta: {
        enrichmentProgress: {
          totalCandidates: 100,
          enrichedCount: 40,
          pendingCount: 60,
          failedCount: 0,
          percent: 40,
          inProgress: true,
          lastSyncedAt: new Date().toISOString(),
        },
        enrichmentRefresh: {
          status: 'stopped_max_age',
          lastAttemptAt: new Date().toISOString(),
        },
      },
    });

    const agent = await loginRecruiterAgent();
    const statusRes = await agent.get(`/api/jobs/${jobId}/sourcing-status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.enrichment.refreshStatus).toBe('stopped_max_age');
    expect(statusRes.body.enrichment.inProgress).toBe(false);
  });

  // ── Test 3: Replay protection — second callback is no-op ────────────
  it('rejects duplicate callbacks without double-processing', async () => {
    const requestId = await createRun();
    const jti = randomUUID();
    created.webhookEventIds.push(jti);

    const claimsFn = () => {
      jwtMock.verifySignalCallbackJwt.mockResolvedValue({
        jti,
        tenantId: TENANT_ID,
        requestId,
        scopes: 'callbacks:write',
      });
    };

    const mockCandidates = makeMockCandidates(2);
    signalClientMock.getResults.mockResolvedValue({
      success: true,
      requestId,
      candidates: mockCandidates,
    });

    // First callback — should succeed
    claimsFn();
    const res1 = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', `Bearer fake-token`)
      .send({
        version: 1,
        requestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'complete',
        candidateCount: 2,
        enrichedCount: 2,
      });

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);

    // Second callback with same jti — should return "Already processed"
    claimsFn();
    const res2 = await request(app)
      .post('/api/webhooks/signal/callback')
      .set('Authorization', `Bearer fake-token`)
      .send({
        version: 1,
        requestId,
        externalJobId: `vanta:jobs:${jobId}`,
        status: 'complete',
        candidateCount: 2,
        enrichedCount: 2,
      });

    expect(res2.status).toBe(200);
    expect(res2.body.message).toBe('Already processed');

    // getResults should only have been called once
    expect(signalClientMock.getResults).toHaveBeenCalledTimes(1);
  });

  // ── Test 4: /sourced-candidates passes through Signal diagnostics ─
  it('returns requestedLocation, expansionReason, and groupCounts from persisted Signal diagnostics', async () => {
    const requestId = await createRun({
      status: 'completed',
      meta: {
        requestedLocation: 'Delhi, India',
        expansionReason: 'strict_low_quality',
        groupCounts: {
          bestMatches: 0,
          broaderPool: 2,
          strictMatchedCount: 0,
          expandedCount: 2,
          expansionReason: 'strict_low_quality',
          requestedLocation: 'Delhi, India',
          strictDemotedCount: 2,
          locationMatchCounts: { city_exact: 0, city_alias: 0, country_only: 1, none: 1 },
          demotedStrictWithCityMatch: 0,
          strictBeforeDemotion: 2,
          selectedSnapshotTrack: 'non-tech',
        },
      },
    });

    // Insert candidates with broader_pool tier
    const candidateIds = [`cand-diag-${randomUUID().slice(0, 8)}`, `cand-diag-${randomUUID().slice(0, 8)}`];
    for (const cid of candidateIds) {
      await db.execute(
        // Use raw SQL to match the upsert pattern
        db.insert(jobSourcedCandidates).values({
          organizationId: org.id,
          jobId,
          requestId,
          signalCandidateId: cid,
          fitScore: 70,
          fitBreakdown: {},
          sourceType: 'discovered',
          state: 'new',
          candidateSummary: {
            nameHint: 'Test',
            matchTier: 'broader_pool',
            locationMatchType: 'none',
          },
        }),
      );
    }

    const agent = await loginRecruiterAgent();
    const res = await agent.get(`/api/jobs/${jobId}/sourced-candidates`);
    expect(res.status).toBe(200);
    expect(res.body.requestedLocation).toBe('Delhi, India');
    expect(res.body.expansionReason).toBe('strict_low_quality');
    expect(res.body.groupCounts.bestMatches).toBe(0);
    expect(res.body.groupCounts.broaderPool).toBe(2);
    expect(res.body.groupCounts.strictDemotedCount).toBe(2);
    expect(res.body.groupCounts.strictBeforeDemotion).toBe(2);
    expect(res.body.groupCounts.selectedSnapshotTrack).toBe('non-tech');
  });
});
