// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const storageMock = {
  getApplication: vi.fn(),
  getJob: vi.fn(),
  getUser: vi.fn(),
  isRecruiterOnJob: vi.fn(),
  markApplicationDownloaded: vi.fn(),
};

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
  update: vi.fn(() => ({
    set() {
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    },
  })),
  insert: vi.fn(() => ({
    values() {
      return {
        returning: vi.fn().mockResolvedValue([]),
      };
    },
  })),
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
  getUserOrganization: vi.fn(),
}));

vi.mock('../lib/featureGating', () => ({
  FEATURES: {},
  requireFeatureAccess: () => (_req: any, _res: any, next: any) => next(),
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

vi.mock('../aiJobAnalyzer', () => ({
  isAIEnabled: vi.fn(() => false),
  generateCandidateSummary: vi.fn(),
}));

vi.mock('../lib/aiMatchingEngine', () => ({
  calculateAiCost: vi.fn(),
  checkCircuitBreaker: vi.fn(),
}));

vi.mock('../lib/profileCompletion', () => ({
  syncProfileCompletionStatus: vi.fn(),
}));

vi.mock('../lib/creditService', () => ({
  getAiCreditExhaustionPayload: vi.fn(),
  hasEnoughCredits: vi.fn(),
  useCredits: vi.fn(),
  getCreditCostForOperation: vi.fn(),
  getUserDailyRateLimit: vi.fn(),
  getPlanRateLimitInfo: vi.fn(),
}));

vi.mock('../rateLimit', () => ({
  aiAnalysisRateLimit: (_req: any, _res: any, next: any) => next(),
  applicationRateLimit: (_req: any, _res: any, next: any) => next(),
  recruiterAddRateLimit: (_req: any, _res: any, next: any) => next(),
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

async function buildApp(user = { id: 4544, role: 'hiring_manager', emailVerified: true }) {
  const { registerApplicationsRoutes } = await import('../applications.routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    next();
  });

  const csrf = (_req: any, _res: any, next: any) => next();
  const upload = {
    single: () => (_req: any, _res: any, next: any) => next(),
    array: () => (_req: any, _res: any, next: any) => next(),
    none: () => (_req: any, _res: any, next: any) => next(),
    fields: () => (_req: any, _res: any, next: any) => next(),
  } as any;

  registerApplicationsRoutes(app, csrf as any, upload);
  return app;
}

async function invokeRoute(
  app: express.Express,
  method: 'get' | 'post',
  path: string,
  input: { params: Record<string, string>; body?: Record<string, unknown>; user?: { id: number; role: string; emailVerified?: boolean } },
): Promise<{ status: number; body: any }> {
  const router = (app as any)._router;
  const layer = router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(),
    params: input.params,
    body: input.body ?? {},
    query: {},
    user: input.user ?? { id: 4544, role: 'hiring_manager', emailVerified: true },
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

describe('hiring manager feedback access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('returns 403 when a hiring manager requests feedback for another manager’s job application', async () => {
    storageMock.getApplication.mockResolvedValue({
      id: 459,
      jobId: 88,
    });
    storageMock.getJob.mockResolvedValue({
      id: 88,
      hiringManagerId: 9999,
    });

    const app = await buildApp();

    const result = await invokeRoute(app, 'get', '/api/applications/:id/feedback', {
      params: { id: '459' },
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Access denied' });
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('returns 404 when a hiring manager requests feedback for a missing application', async () => {
    storageMock.getApplication.mockResolvedValue(undefined);

    const app = await buildApp();

    const result = await invokeRoute(app, 'get', '/api/applications/:id/feedback', {
      params: { id: '999999' },
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Application not found' });
    expect(storageMock.getJob).not.toHaveBeenCalled();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('returns 403 when a hiring manager submits feedback for another manager’s job application', async () => {
    storageMock.getApplication.mockResolvedValue({
      id: 459,
      jobId: 88,
    });
    storageMock.getJob.mockResolvedValue({
      id: 88,
      hiringManagerId: 9999,
    });

    const app = await buildApp();

    const result = await invokeRoute(app, 'post', '/api/applications/:id/feedback', {
      params: { id: '459' },
      body: {
        overallScore: 4,
        recommendation: 'hold',
        notes: 'Needs another round.',
      },
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Access denied' });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('returns 403 when a hiring manager requests a resume for another manager’s job application', async () => {
    storageMock.getApplication.mockResolvedValue({
      id: 459,
      jobId: 88,
    });
    storageMock.getJob.mockResolvedValue({
      id: 88,
      hiringManagerId: 9999,
    });

    const app = await buildApp();

    const result = await invokeRoute(app, 'get', '/api/applications/:id/resume', {
      params: { id: '459' },
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Access denied' });
    expect(storageMock.markApplicationDownloaded).not.toHaveBeenCalled();
  });

  it('allows recruiters to request hiring manager review for accessible applications on a single job', async () => {
    storageMock.getApplication.mockImplementation(async (id: number) => {
      if (id === 501 || id === 502) {
        return { id, jobId: 77 };
      }
      return undefined;
    });
    storageMock.getJob.mockResolvedValue({ id: 77, hiringManagerId: 4544 });
    storageMock.isRecruiterOnJob.mockResolvedValue(true);

    const app = await buildApp({ id: 77, role: 'recruiter', emailVerified: true });

    const result = await invokeRoute(app, 'post', '/api/applications/bulk/request-hm-review', {
      params: {},
      user: { id: 77, role: 'recruiter', emailVerified: true },
      body: {
        applicationIds: [501, 502],
        note: 'Please validate backend depth and communication clarity.',
      },
    });

    expect(result.status).toBe(200);
    expect(result.body.requestedCount).toBe(2);
    expect(storageMock.isRecruiterOnJob).toHaveBeenCalledWith(77, 77, undefined);
    expect(dbMock.update).toHaveBeenCalled();
  });
});
