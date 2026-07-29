// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const storageMock = {
  getJobsByUser: vi.fn(),
  getRecruiterApplications: vi.fn(),
  getPipelineStages: vi.fn(),
  getAllJobsWithDetails: vi.fn(),
};

const getUserOrganizationMock = vi.fn();
const updateMemberActivityMock = vi.fn();
const getHiringMetricsMock = vi.fn();

const selectQueue: any[][] = [];

function makeQuery(rows: any[]) {
  return {
    from() {
      return this;
    },
    innerJoin() {
      return this;
    },
    leftJoin() {
      return this;
    },
    where() {
      return this;
    },
    groupBy() {
      return this;
    },
    orderBy() {
      return this;
    },
    then(resolve: (value: any[]) => unknown, reject?: (reason?: unknown) => unknown) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
}

const dbMock = {
  select: vi.fn(() => makeQuery(selectQueue.shift() ?? [])),
};

vi.mock('../auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireSeat: () => (_req: any, _res: any, next: any) => next(),
  requireVerifiedCandidate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../storage', () => ({
  storage: storageMock,
}));

vi.mock('../db', () => ({
  db: dbMock,
}));

vi.mock('../lib/organizationService', () => ({
  getUserOrganization: getUserOrganizationMock,
}));

vi.mock('../lib/membershipService', () => ({
  updateMemberActivity: updateMemberActivityMock,
}));

vi.mock('../lib/analyticsHelper', () => ({
  getHiringMetrics: getHiringMetricsMock,
}));

vi.mock('../lib/featureGating', () => ({
  FEATURES: {
    AI_CONTENT: 'aiContent',
    ATS: 'ats',
  },
  requireFeatureAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../aiJobAnalyzer', () => ({
  analyzeJobDescription: vi.fn(),
  generateJobScore: vi.fn(),
  calculateOptimizationSuggestions: vi.fn(),
  enhancePipelineActions: vi.fn(),
  isAIEnabled: vi.fn(() => false),
  generateCandidateSummary: vi.fn(),
}));

vi.mock('../rateLimit', () => ({
  aiAnalysisRateLimit: (_req: any, _res: any, next: any) => next(),
  jobPostingRateLimit: (_req: any, _res: any, next: any) => next(),
  applicationRateLimit: (_req: any, _res: any, next: any) => next(),
  recruiterAddRateLimit: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../gcs-storage', () => ({
  uploadToGCS: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
  downloadFromGCS: vi.fn(),
}));

vi.mock('../notificationService', () => ({
  sendStatusUpdateNotification: vi.fn(),
  sendInterviewInvitationNotification: vi.fn(),
  sendApplicationReceivedNotification: vi.fn(),
  sendOfferNotification: vi.fn(),
  sendRejectionNotification: vi.fn(),
}));

vi.mock('../emailTemplateService', () => ({
  notifyRecruitersNewApplication: vi.fn(),
}));

vi.mock('../lib/icsGenerator', () => ({
  generateInterviewICS: vi.fn(),
  getICSFilename: vi.fn(),
}));

vi.mock('../lib/resumeExtractor', () => ({
  extractResumeText: vi.fn(),
  validateResumeText: vi.fn(),
}));

vi.mock('../lib/aiMatchingEngine', () => ({
  calculateAiCost: vi.fn(),
  checkCircuitBreaker: vi.fn(),
}));

vi.mock('../lib/profileCompletion', () => ({
  syncProfileCompletionStatus: vi.fn(),
}));

vi.mock('../lib/creditService', () => ({
  calculateAiCost: vi.fn(),
  getAiCreditExhaustionPayload: vi.fn(),
  hasEnoughCredits: vi.fn(),
  useCredits: vi.fn(),
  getCreditCostForOperation: vi.fn(),
  getUserDailyRateLimit: vi.fn(),
  getPlanRateLimitInfo: vi.fn(),
}));

vi.mock('../lib/aiQueue', () => ({
  isQueueAvailable: vi.fn(),
  enqueueSummaryBatch: vi.fn(),
  removeJob: vi.fn(),
  QUEUES: {},
}));

vi.mock('../lib/activekgTenant', () => ({
  resolveActiveKGTenantId: vi.fn(),
}));

vi.mock('../lib/applicationGraphSyncProcessor', () => ({
  MIN_RESUME_TEXT_LENGTH: 100,
}));

async function buildApp() {
  vi.resetModules();

  const { registerJobsRoutes } = await import('../jobs.routes');
  const { registerApplicationsRoutes } = await import('../applications.routes');
  const { registerRecruiterDashboardRoutes } = await import('../recruiterDashboard.routes');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 4, role: 'super_admin', emailVerified: true };
    next();
  });

  const csrf = (_req: any, _res: any, next: any) => next();
  const upload = {
    single: () => (_req: any, _res: any, next: any) => next(),
    array: () => (_req: any, _res: any, next: any) => next(),
    none: () => (_req: any, _res: any, next: any) => next(),
    fields: () => (_req: any, _res: any, next: any) => next(),
  } as any;

  registerJobsRoutes(app, csrf as any);
  registerApplicationsRoutes(app, csrf as any, upload);
  registerRecruiterDashboardRoutes(app);
  return app;
}

async function invokeRoute(
  app: express.Express,
  method: 'get',
  path: string,
  input?: { query?: Record<string, unknown>; user?: { id: number; role: string; emailVerified?: boolean } },
): Promise<{ status: number; body: any }> {
  const router = (app as any)._router;
  const layer = router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(),
    params: {},
    body: {},
    query: input?.query ?? {},
    user: input?.user ?? { id: 4, role: 'super_admin', emailVerified: true },
    headers: {},
    ip: '127.0.0.1',
    app: {
      get: () => false,
    },
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        if (!settled) {
          settled = true;
          resolve({ status: this.statusCode, body: payload });
        }
        return this;
      },
      send(payload: any) {
        this.body = payload;
        if (!settled) {
          settled = true;
          resolve({ status: this.statusCode, body: payload });
        }
        return this;
      },
      end(payload?: any) {
        this.body = payload;
        if (!settled) {
          settled = true;
          resolve({ status: this.statusCode, body: payload });
        }
        return this;
      },
    };

    let index = 0;
    const next = (error?: unknown) => {
      if (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
        return;
      }

      const handler = handlers[index++];
      if (!handler) {
        if (!settled) {
          settled = true;
          resolve({ status: res.statusCode, body: res.body });
        }
        return;
      }

      try {
        const result = handler(req, res, next);
        if (result && typeof result.then === 'function') {
          result.catch(next);
        }
      } catch (error) {
        next(error);
      }
    };

    next();
  });
}

describe('recruiter dashboard endpoint scoping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00.000Z'));
    vi.clearAllMocks();
    selectQueue.length = 0;

    getUserOrganizationMock.mockResolvedValue({
      organization: { id: 2 },
      membership: { role: 'owner' },
    });

    storageMock.getJobsByUser.mockResolvedValue([
      {
        id: 10,
        title: 'Backend Engineer',
        isActive: true,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        hiringManager: null,
        clientName: null,
      },
    ]);
    storageMock.getRecruiterApplications.mockResolvedValue([
      {
        id: 101,
        jobId: 10,
        name: 'Priya Sharma',
        status: 'submitted',
        currentStage: 1,
        appliedAt: new Date('2026-03-19T00:00:00.000Z'),
        updatedAt: new Date('2026-03-19T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-19T00:00:00.000Z'),
        interviewDate: null,
        lastViewedAt: null,
        aiFitScore: 90,
        aiFitLabel: 'Strong',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
    ]);
    storageMock.getPipelineStages.mockResolvedValue([
      { id: 1, name: 'Applied', order: 1, color: '#111111', organizationId: 2, isDefault: false },
    ]);
    storageMock.getAllJobsWithDetails.mockResolvedValue([
      { id: 999, title: 'Global Job' },
    ]);
    updateMemberActivityMock.mockResolvedValue(undefined);
    getHiringMetricsMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scopes /api/my-jobs to the current org for super_admin users in an org', async () => {
    const app = await buildApp();

    const result = await invokeRoute(app, 'get', '/api/my-jobs');

    expect(result.status).toBe(200);
    expect(storageMock.getJobsByUser).toHaveBeenCalledWith(4, 2);
    expect(storageMock.getAllJobsWithDetails).not.toHaveBeenCalled();
  });

  it('scopes /api/my-applications-received to the current org for super_admin users in an org', async () => {
    const app = await buildApp();

    const result = await invokeRoute(app, 'get', '/api/my-applications-received');

    expect(result.status).toBe(200);
    expect(storageMock.getRecruiterApplications).toHaveBeenCalledWith(4, 2);
  });

  it('scopes /api/pipeline/stages to the current org for super_admin users in an org', async () => {
    const app = await buildApp();

    const result = await invokeRoute(app, 'get', '/api/pipeline/stages');

    expect(result.status).toBe(200);
    expect(storageMock.getPipelineStages).toHaveBeenCalledWith(2, 4);
  });

  it('scopes /api/recruiter-dashboard/actions to recruiter assignments in the current org', async () => {
    const app = await buildApp();
    selectQueue.push([]);

    const result = await invokeRoute(app, 'get', '/api/recruiter-dashboard/actions');

    expect(result.status).toBe(200);
    expect(storageMock.getJobsByUser).toHaveBeenCalledWith(4, 2);
    expect(storageMock.getRecruiterApplications).toHaveBeenCalledWith(4, 2);
    expect(storageMock.getPipelineStages).toHaveBeenCalledWith(2, 4);
    expect(result.body.viewer.dashboardScope).toBe('recruiter');
  });

  it('returns recruiter-scoped dashboard kpis with a consistent card contract', async () => {
    storageMock.getJobsByUser.mockResolvedValue([
      {
        id: 10,
        title: 'Backend Engineer',
        isActive: true,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        deadline: new Date('2026-03-24T00:00:00.000Z'),
        hiringManager: null,
        clientName: null,
      },
    ]);
    storageMock.getPipelineStages.mockResolvedValue([
      { id: 1, name: 'Applied', order: 1, color: '#111111', organizationId: 2, isDefault: false },
      { id: 2, name: 'Screening', order: 2, color: '#222222', organizationId: 2, isDefault: false },
      { id: 3, name: 'Interview Scheduled', order: 3, color: '#333333', organizationId: 2, isDefault: false },
    ]);
    storageMock.getRecruiterApplications.mockResolvedValue([
      {
        id: 101,
        jobId: 10,
        name: 'Priya Sharma',
        status: 'submitted',
        currentStage: 2,
        appliedAt: new Date('2026-03-21T00:00:00.000Z'),
        updatedAt: new Date('2026-03-21T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-22T00:00:00.000Z'),
        lastViewedAt: new Date('2026-03-22T12:00:00.000Z'),
        downloadedAt: null,
        interviewDate: null,
        interviewTime: null,
        aiFitScore: 90,
        aiFitLabel: 'Strong',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 102,
        jobId: 10,
        name: 'Alex Kim',
        status: 'shortlisted',
        currentStage: 3,
        appliedAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-20T00:00:00.000Z'),
        lastViewedAt: new Date('2026-03-20T10:00:00.000Z'),
        downloadedAt: null,
        interviewDate: new Date('2026-03-21T13:30:00.000Z'),
        interviewTime: '13:30',
        aiFitScore: 88,
        aiFitLabel: 'Good',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 103,
        jobId: 10,
        name: 'Jordan Lee',
        status: 'submitted',
        currentStage: 1,
        appliedAt: new Date('2026-03-14T00:00:00.000Z'),
        updatedAt: new Date('2026-03-14T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-14T00:00:00.000Z'),
        lastViewedAt: null,
        downloadedAt: null,
        interviewDate: null,
        interviewTime: null,
        aiFitScore: 70,
        aiFitLabel: 'Good',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
    ]);

    const app = await buildApp();
    const result = await invokeRoute(app, 'get', '/api/recruiter-dashboard/kpis', {
      query: { range: '30d' },
    });

    expect(result.status).toBe(200);
    expect(result.body.range).toBe('30d');
    expect(result.body.scope).toBe('all');
    expect(result.body.comparisonLabel).toBe('vs previous 30 days');
    expect(result.body.cards.pipelineHealth).toEqual(
      expect.objectContaining({
        id: 'pipelineHealth',
        label: 'Pipeline Health',
        status: expect.stringMatching(/healthy|needs_attention|at_risk/),
        displayValue: expect.stringMatching(/%$/),
        trendDirection: expect.stringMatching(/up|down|flat/),
      }),
    );
    expect(result.body.cards.pipelineHealth.insights).toEqual(
      expect.objectContaining({
        stuckCandidates: expect.any(Array),
        stageHealth: expect.any(Array),
      }),
    );
    expect(result.body.cards.pipelineHealth.insights.mainBlocker).toEqual(
      expect.objectContaining({
        description: expect.any(String),
        stage: expect.any(String),
        stageId: expect.any(Number),
        count: expect.any(Number),
      }),
    );
    expect(result.body.cards.pipelineHealth.insights.quickWin).toEqual(
      expect.objectContaining({
        action: expect.any(String),
        estimatedImpactPoints: expect.any(Number),
        ctaLabel: expect.any(String),
        ctaHref: expect.stringMatching(/^\/applications\?stage=\d+$/),
      }),
    );
    expect(result.body.cards.activeRoles).toEqual(
      expect.objectContaining({
        id: 'activeRoles',
        label: 'Active Roles',
        value: 1,
        comparisonLabel: null,
        trendDirection: 'flat',
      }),
    );
    expect(result.body.cards.todaysApplications).toEqual(
      expect.objectContaining({
        id: 'todaysApplications',
        label: "Today's Applications",
        value: 1,
        comparisonLabel: 'vs last week',
      }),
    );
    expect(result.body.cards.firstReviewTime).toEqual(
      expect.objectContaining({
        id: 'firstReviewTime',
        label: 'First Review Time',
        unit: 'hours',
        comparisonLabel: 'vs previous 30 days',
      }),
    );
    expect(result.body.cards.screenToInterview).toEqual(
      expect.objectContaining({
        id: 'screenToInterview',
        label: 'Screen → Interview',
        comparisonLabel: 'vs previous 30 days',
      }),
    );
  });

  it('respects job filter in KPI scope and quick-win links', async () => {
    const app = await buildApp();
    const result = await invokeRoute(app, 'get', '/api/recruiter-dashboard/kpis', {
      query: { range: '30d', jobId: '10' },
    });

    expect(result.status).toBe(200);
    expect(result.body.jobId).toBe(10);
    expect(result.body.scope).toBe('job');
    expect(result.body.cards.activeRoles).toEqual(
      expect.objectContaining({
        value: 1,
        contextLine: 'Selected role',
      }),
    );
    expect(result.body.cards.pipelineHealth.insights.quickWin).toEqual(
      expect.objectContaining({
        ctaHref: expect.stringMatching(/^\/jobs\/10\/applications\?stage=\d+$/),
      }),
    );
  });

  it('applies recruiter dashboard action filters for job and range', async () => {
    const app = await buildApp();
    selectQueue.push([]);

    const result = await invokeRoute(app, 'get', '/api/recruiter-dashboard/actions', {
      query: { jobId: '999', range: '7d' },
    });

    expect(result.status).toBe(200);
    expect(result.body.range).toBe('7d');
    expect(result.body.jobId).toBe(999);
    expect(result.body.sections.every((section: any) => section.count === 0)).toBe(true);
  });

  it('returns recruiter-scoped interview stage details for the selected range', async () => {
    storageMock.getPipelineStages.mockResolvedValue([
      { id: 1, name: 'Applied', order: 1, color: '#111111', organizationId: 2, isDefault: false },
      { id: 2, name: 'Screening', order: 2, color: '#222222', organizationId: 2, isDefault: false },
      { id: 3, name: 'Interview Scheduled', order: 3, color: '#333333', organizationId: 2, isDefault: false },
      { id: 4, name: 'Offer Extended', order: 4, color: '#444444', organizationId: 2, isDefault: false },
    ]);
    storageMock.getRecruiterApplications.mockResolvedValue([
      {
        id: 101,
        jobId: 10,
        name: 'Priya Sharma',
        status: 'shortlisted',
        currentStage: 3,
        appliedAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-18T00:00:00.000Z'),
        interviewDate: new Date('2026-03-21T09:00:00.000Z'),
        lastViewedAt: null,
        aiFitScore: 90,
        aiFitLabel: 'Strong',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 102,
        jobId: 10,
        name: 'Alex Kim',
        status: 'shortlisted',
        currentStage: 4,
        appliedAt: new Date('2026-03-19T00:00:00.000Z'),
        updatedAt: new Date('2026-03-19T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-19T00:00:00.000Z'),
        interviewDate: null,
        lastViewedAt: null,
        aiFitScore: 88,
        aiFitLabel: 'Strong',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 103,
        jobId: 10,
        name: 'Jordan Lee',
        status: 'submitted',
        currentStage: 2,
        appliedAt: new Date('2026-03-17T00:00:00.000Z'),
        updatedAt: new Date('2026-03-17T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-17T00:00:00.000Z'),
        interviewDate: null,
        lastViewedAt: null,
        aiFitScore: 70,
        aiFitLabel: 'Good',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 104,
        jobId: 10,
        name: 'Morgan Diaz',
        status: 'submitted',
        currentStage: 2,
        appliedAt: new Date('2026-03-10T00:00:00.000Z'),
        updatedAt: new Date('2026-03-10T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-10T00:00:00.000Z'),
        interviewDate: null,
        lastViewedAt: null,
        aiFitScore: 65,
        aiFitLabel: 'Good',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 105,
        jobId: 10,
        name: 'Sam Patel',
        status: 'submitted',
        currentStage: 2,
        appliedAt: new Date('2026-03-09T00:00:00.000Z'),
        updatedAt: new Date('2026-03-09T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-09T00:00:00.000Z'),
        interviewDate: null,
        lastViewedAt: null,
        aiFitScore: 61,
        aiFitLabel: 'Good',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
    ]);

    const app = await buildApp();
    const result = await invokeRoute(app, 'get', '/api/recruiter-dashboard/interview-stage-details', {
      query: { range: '7d' },
    });

    expect(result.status).toBe(200);
    expect(storageMock.getJobsByUser).toHaveBeenCalledWith(4, 2);
    expect(storageMock.getRecruiterApplications).toHaveBeenCalledWith(4, 2);
    expect(storageMock.getPipelineStages).toHaveBeenCalledWith(2, 4);
    expect(result.body.viewer.dashboardScope).toBe('recruiter');
    expect(result.body.range).toBe('7d');
    expect(result.body.activeInterviewLoops).toBe(1);
    expect(result.body.avgTimeInStageDays).toBe(3);
    expect(result.body.interviewsScheduledToday).toBe(1);
    expect(result.body.screeningToInterview.currentRate).toBe(66.7);
    expect(result.body.screeningToInterview.previousRate).toBe(0);
    expect(result.body.screeningToInterview.delta).toBe(66.7);
    expect(result.body.screeningToInterview.direction).toBe('up');
    expect(result.body.screeningToInterview.screeningCount).toBe(3);
    expect(result.body.screeningToInterview.interviewCount).toBe(2);
  });

  it("returns today's recruiter-scoped interviews with week counts, statuses, and stable CTA links", async () => {
    storageMock.getPipelineStages.mockResolvedValue([
      { id: 1, name: 'Applied', order: 1, color: '#111111', organizationId: 2, isDefault: false },
      { id: 2, name: 'Interview Scheduled', order: 2, color: '#222222', organizationId: 2, isDefault: false },
      { id: 3, name: 'Final Interview', order: 3, color: '#333333', organizationId: 2, isDefault: false },
    ]);
    storageMock.getRecruiterApplications.mockResolvedValue([
      {
        id: 101,
        jobId: 10,
        name: 'Priya Sharma',
        status: 'shortlisted',
        currentStage: 2,
        appliedAt: new Date('2026-03-19T00:00:00.000Z'),
        updatedAt: new Date('2026-03-19T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-19T00:00:00.000Z'),
        interviewDate: new Date('2026-03-21T09:00:00.000Z'),
        interviewTime: '09:00',
        lastViewedAt: null,
        aiFitScore: 90,
        aiFitLabel: 'Strong',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 102,
        jobId: 10,
        name: 'Alex Kim',
        status: 'shortlisted',
        currentStage: 3,
        appliedAt: new Date('2026-03-18T00:00:00.000Z'),
        updatedAt: new Date('2026-03-18T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-18T00:00:00.000Z'),
        interviewDate: new Date('2026-03-21T13:30:00.000Z'),
        interviewTime: '13:30',
        lastViewedAt: null,
        aiFitScore: 88,
        aiFitLabel: 'Good',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 103,
        jobId: 10,
        name: 'Morgan Diaz',
        status: 'shortlisted',
        currentStage: 2,
        appliedAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-20T00:00:00.000Z'),
        interviewDate: new Date('2026-03-22T09:30:00.000Z'),
        interviewTime: '09:30',
        lastViewedAt: null,
        aiFitScore: 85,
        aiFitLabel: 'Strong',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
      {
        id: 104,
        jobId: 10,
        name: 'Rejected Candidate',
        status: 'rejected',
        currentStage: 2,
        appliedAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-20T00:00:00.000Z'),
        interviewDate: new Date('2026-03-21T15:00:00.000Z'),
        interviewTime: '15:00',
        lastViewedAt: null,
        aiFitScore: 20,
        aiFitLabel: 'Weak',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
    ]);

    const app = await buildApp();
    const result = await invokeRoute(app, 'get', '/api/recruiter-dashboard/todays-interviews');

    expect(result.status).toBe(200);
    expect(storageMock.getJobsByUser).toHaveBeenCalledWith(4, 2);
    expect(storageMock.getRecruiterApplications).toHaveBeenCalledWith(4, 2);
    expect(storageMock.getPipelineStages).toHaveBeenCalledWith(2, 4);
    expect(result.body.viewer.dashboardScope).toBe('recruiter');
    expect(result.body.interviewDate).toBe('2026-03-21');
    expect(result.body.count).toBe(2);
    expect(result.body.week).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-03-21', count: 2, isSelected: true }),
        expect.objectContaining({ date: '2026-03-22', count: 1, isSelected: false }),
      ]),
    );
    expect(result.body.items).toEqual([
      expect.objectContaining({
        id: 'interview-101',
        applicationId: 101,
        candidateName: 'Priya Sharma',
        jobTitle: 'Backend Engineer',
        interviewTime: '09:00',
        stageLabel: 'Interview Scheduled',
        aiFitLabel: 'Strong',
        status: 'completed',
        ctaHref: '/jobs/10/applications?stage=2&applicationId=101',
      }),
      expect.objectContaining({
        id: 'interview-102',
        applicationId: 102,
        candidateName: 'Alex Kim',
        jobTitle: 'Backend Engineer',
        interviewTime: '13:30',
        stageLabel: 'Final Interview',
        aiFitLabel: 'Good',
        status: 'upcoming',
        ctaHref: '/jobs/10/applications?stage=3&applicationId=102',
      }),
    ]);
  });

  it('supports fetching scheduled interviews for another day', async () => {
    storageMock.getPipelineStages.mockResolvedValue([
      { id: 1, name: 'Applied', order: 1, color: '#111111', organizationId: 2, isDefault: false },
      { id: 2, name: 'Interview Scheduled', order: 2, color: '#222222', organizationId: 2, isDefault: false },
    ]);
    storageMock.getRecruiterApplications.mockResolvedValue([
      {
        id: 201,
        jobId: 10,
        name: 'Future Candidate',
        status: 'shortlisted',
        currentStage: 2,
        appliedAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        stageChangedAt: new Date('2026-03-20T00:00:00.000Z'),
        interviewDate: new Date('2026-03-22T09:30:00.000Z'),
        interviewTime: '09:30',
        lastViewedAt: null,
        aiFitScore: 85,
        aiFitLabel: 'Strong',
        feedbackCount: 0,
        job: { id: 10, title: 'Backend Engineer', isActive: true },
      },
    ]);

    const app = await buildApp();
    const result = await invokeRoute(app, 'get', '/api/recruiter-dashboard/todays-interviews', {
      query: { interviewDate: '2026-03-22' },
    });

    expect(result.status).toBe(200);
    expect(result.body.interviewDate).toBe('2026-03-22');
    expect(result.body.count).toBe(1);
    expect(result.body.items[0]).toEqual(
      expect.objectContaining({
        candidateName: 'Future Candidate',
        interviewTime: '09:30',
        status: 'scheduled',
      }),
    );
  });

  it('scopes /api/analytics/dropoff stage loading to the current org for super_admin users in an org', async () => {
    const app = await buildApp();
    selectQueue.push([]);

    const result = await invokeRoute(app, 'get', '/api/analytics/dropoff');

    expect(result.status).toBe(200);
    expect(storageMock.getPipelineStages).toHaveBeenCalledWith(2);
  });

  it('scopes /api/analytics/hm-feedback stage loading to the current org for super_admin users in an org', async () => {
    const app = await buildApp();
    selectQueue.push([]);

    const result = await invokeRoute(app, 'get', '/api/analytics/hm-feedback');

    expect(result.status).toBe(200);
    expect(storageMock.getPipelineStages).toHaveBeenCalledWith(2);
  });
});
