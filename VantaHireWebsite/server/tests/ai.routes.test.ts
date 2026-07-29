// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const hasEnoughCreditsMock = vi.fn();
const useCreditsMock = vi.fn();
const getAiCreditExhaustionPayloadMock = vi.fn();
const getGroqClientMock = vi.fn();
const groqCreateMock = vi.fn();
const getDashboardAiInsightsMock = vi.fn();

vi.mock('../auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireSeat: () => (_req: any, _res: any, next: any) => next(),
  requireVerifiedCandidate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../csrf', () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../db', () => ({
  db: {},
}));

vi.mock('./../storage', () => ({
  storage: {},
}));

vi.mock('../gcs-storage', () => ({
  upload: {
    single: () => (_req: any, _res: any, next: any) => next(),
  },
  uploadToGCS: vi.fn(),
  downloadFromGCS: vi.fn(),
}));

vi.mock('../lib/resumeExtractor', () => ({
  extractResumeText: vi.fn(),
  validateResumeText: vi.fn(),
}));

vi.mock('../lib/jdDigest', () => ({
  generateJDDigest: vi.fn(),
  CURRENT_DIGEST_VERSION: 1,
}));

vi.mock('../lib/aiMatchingEngine', () => ({
  computeFitScore: vi.fn(),
  isFitStale: vi.fn(),
  getStalenessReason: vi.fn(),
}));

vi.mock('../lib/aiLimits', () => ({
  getUserLimits: vi.fn(),
  reserveFitCredit: vi.fn(),
  releaseFitCredit: vi.fn(),
  finalizeFitCredit: vi.fn(),
}));

vi.mock('../lib/redis', () => ({
  getRedisHealth: vi.fn(),
}));

vi.mock('../lib/aiQueue', () => ({
  isQueueAvailable: vi.fn(),
  enqueueInteractive: vi.fn(),
  enqueueBatch: vi.fn(),
  getQueueHealth: vi.fn(),
  removeJob: vi.fn(),
  QUEUES: {},
}));

vi.mock('../lib/profileCompletion', () => ({
  syncProfileCompletionStatus: vi.fn(),
}));

vi.mock('../lib/groqClient', () => ({
  getGroqClient: getGroqClientMock,
}));

vi.mock('../lib/aiDashboard', () => ({
  getDashboardAiInsights: getDashboardAiInsightsMock,
}));

vi.mock('../lib/organizationService', () => ({
  getUserOrganization: vi.fn(),
}));

vi.mock('../lib/creditService', () => ({
  hasEnoughCredits: hasEnoughCreditsMock,
  useCredits: useCreditsMock,
  getAiCreditExhaustionPayload: getAiCreditExhaustionPayloadMock,
  getMemberCreditBalance: vi.fn(),
}));

vi.mock('../lib/featureGating', () => ({
  FEATURES: {
    AI_CONTENT: 'aiContent',
  },
  requireFeatureAccess: () => (_req: any, _res: any, next: any) => next(),
}));

async function buildApp() {
  vi.resetModules();
  process.env.GROQ_API_KEY = 'test-key';
  process.env.AI_MATCH_ENABLED = 'true';
  process.env.AI_RESUME_ENABLED = 'true';

  const { registerAIRoutes } = await import('../ai.routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 42, role: 'recruiter' };
    next();
  });
  registerAIRoutes(app);
  return app;
}

async function invokeRoute(
  app: express.Express,
  method: 'post',
  path: string,
  input: { body?: unknown },
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
    body: input.body ?? {},
    user: { id: 42, role: 'recruiter' },
    headers: {},
    query: {},
    ip: '127.0.0.1',
    app: {
      get: () => false,
    },
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const responseHeaders = new Map<string, string>();
    const res: any = {
      statusCode: 200,
      body: undefined,
      setHeader(name: string, value: string) {
        responseHeaders.set(name.toLowerCase(), value);
      },
      getHeader(name: string) {
        return responseHeaders.get(name.toLowerCase());
      },
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

describe('AI routes credit timing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasEnoughCreditsMock.mockResolvedValue(true);
    useCreditsMock.mockResolvedValue({ success: true, remaining: 10 });
    getAiCreditExhaustionPayloadMock.mockResolvedValue({ error: 'Insufficient AI credits' });
    groqCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'Generated summary' } }],
    });
    getGroqClientMock.mockReturnValue({
      chat: {
        completions: {
          create: groqCreateMock,
        },
      },
    });
    getDashboardAiInsightsMock.mockResolvedValue({
      summary: 'ok',
    });
  });

  it('does not deduct credits for invalid /api/ai/generate requests', async () => {
    const app = await buildApp();

    const result = await invokeRoute(app, 'post', '/api/ai/generate', {
      body: {},
    });

    expect(result.status).toBe(400);
    expect(useCreditsMock).not.toHaveBeenCalled();
    expect(groqCreateMock).not.toHaveBeenCalled();
  });

  it('deducts credits only after successful /api/ai/generate completion', async () => {
    const app = await buildApp();

    const result = await invokeRoute(app, 'post', '/api/ai/generate', {
      body: { prompt: 'Summarize pipeline health' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: 'Generated summary' });
    expect(groqCreateMock).toHaveBeenCalledOnce();
    expect(useCreditsMock).toHaveBeenCalledWith(42, 1);
    expect(groqCreateMock.mock.invocationCallOrder[0]).toBeLessThan(useCreditsMock.mock.invocationCallOrder[0]);
  });

  it('does not deduct credits for invalid /api/ai/dashboard-insights payloads', async () => {
    const app = await buildApp();

    const result = await invokeRoute(app, 'post', '/api/ai/dashboard-insights', {
      body: { jobsNeedingAttention: [] },
    });

    expect(result.status).toBe(400);
    expect(useCreditsMock).not.toHaveBeenCalled();
    expect(getDashboardAiInsightsMock).not.toHaveBeenCalled();
  });

  it('deducts credits only after successful /api/ai/dashboard-insights completion', async () => {
    const app = await buildApp();

    const result = await invokeRoute(app, 'post', '/api/ai/dashboard-insights', {
      body: {
        pipelineHealthScore: 82,
        jobsNeedingAttention: [],
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ summary: 'ok' });
    expect(getDashboardAiInsightsMock).toHaveBeenCalledOnce();
    expect(useCreditsMock).toHaveBeenCalledWith(42, 1);
    expect(getDashboardAiInsightsMock.mock.invocationCallOrder[0]).toBeLessThan(useCreditsMock.mock.invocationCallOrder[0]);
  });
});
