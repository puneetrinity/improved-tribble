// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const mocks = vi.hoisted(() => ({
  readInterview: vi.fn(),
  readStage: vi.fn(),
  readEmail: vi.fn(),
  generate: vi.fn(),
  filename: vi.fn(),
  getApplication: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('../auth', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireSeat: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireVerifiedCandidate: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../storage', () => ({
  storage: {
    getApplication: mocks.getApplication,
    getJob: mocks.getJob,
  },
}));

vi.mock('../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../lib/applicationReadAuthorization', () => ({
  readAuthorizedApplicationInterviewInvite: mocks.readInterview,
  readAuthorizedApplicationStageHistory: mocks.readStage,
  readAuthorizedApplicationEmailHistory: mocks.readEmail,
}));

vi.mock('../lib/icsGenerator', () => ({
  generateInterviewICS: mocks.generate,
  getICSFilename: mocks.filename,
}));

vi.mock('../lib/organizationService', () => ({ getUserOrganization: vi.fn() }));
vi.mock('../lib/featureGating', () => ({
  FEATURES: {},
  requireFeatureAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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
vi.mock('../emailTemplateService', () => ({ notifyRecruitersNewApplication: vi.fn() }));
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
vi.mock('../lib/profileCompletion', () => ({ syncProfileCompletionStatus: vi.fn() }));
vi.mock('../lib/creditService', () => ({
  getAiCreditExhaustionPayload: vi.fn(),
  hasEnoughCredits: vi.fn(),
  useCredits: vi.fn(),
  getCreditCostForOperation: vi.fn(),
  getUserDailyRateLimit: vi.fn(),
  getPlanRateLimitInfo: vi.fn(),
}));
vi.mock('../rateLimit', () => ({
  aiAnalysisRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  applicationRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  recruiterAddRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../lib/aiQueue', () => ({
  isQueueAvailable: vi.fn(),
  enqueueSummaryBatch: vi.fn(),
  removeJob: vi.fn(),
  QUEUES: {},
}));
vi.mock('../lib/activekgTenant', () => ({ resolveActiveKGTenantId: vi.fn() }));
vi.mock('../lib/applicationGraphSyncProcessor', () => ({ MIN_RESUME_TEXT_LENGTH: 100 }));

type RouteResult = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
};

async function buildApp(): Promise<express.Express> {
  const { registerApplicationsRoutes } = await import('../applications.routes');
  const app = express();
  app.use((req, _res, next) => {
    (req as any).user = {
      id: 101,
      role: 'recruiter',
      firstName: 'Primary',
      lastName: 'Recruiter',
      username: 'primary@example.invalid',
      emailVerified: true,
    };
    next();
  });
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  const upload = {
    single: () => pass,
    array: () => pass,
    none: () => pass,
    fields: () => pass,
  } as any;
  registerApplicationsRoutes(app, pass as any, upload);
  return app;
}

async function invoke(
  app: express.Express,
  id: string | undefined,
): Promise<RouteResult> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === '/api/applications/:id/interview/ics'
      && entry.route.methods?.get,
  );
  if (!layer) throw new Error('ICS route not found');
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: 'GET',
    params: { id },
    body: {},
    query: {},
    user: {
      id: 101,
      role: 'recruiter',
      firstName: 'Primary',
      lastName: 'Recruiter',
      username: 'primary@example.invalid',
      emailVerified: true,
    },
    headers: {},
    ip: '127.0.0.1',
    app: { get: () => false },
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const headers: Record<string, string> = {};
    const finish = (body: unknown, status: number) => {
      if (settled) return;
      settled = true;
      resolve({ status, body, headers });
    };
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      json(payload: unknown) {
        finish(payload, this.statusCode);
        return this;
      },
      send(payload: unknown) {
        finish(payload, this.statusCode);
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
        reject(new Error('ICS route completed without a response'));
        return;
      }
      Promise.resolve(handler(req, res, next)).catch(reject);
    };
    next();
  });
}

const scheduled = {
  candidateName: 'Fixture Candidate',
  candidateEmail: 'candidate@example.invalid',
  jobTitle: 'Fixture Role',
  interviewDate: '2099-01-15T00:00:00.000Z',
  interviewTime: '10:30',
  interviewLocation: 'Synthetic room',
  interviewNotes: 'Synthetic authorization proof',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockReturnValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  mocks.filename.mockReturnValue('interview-fixture-role-fixture-candidate.ics');
});

describe('interview ICS object authorization route', () => {
  it.each([
    undefined,
    '',
    '0',
    '-1',
    '+1',
    '01',
    ' 1',
    '1 ',
    '1.0',
    '1e1',
    '0x10',
    '1x',
    String(Number.MAX_SAFE_INTEGER + 1),
  ])('rejects non-canonical application id %s before authorization', async (id) => {
    const result = await invoke(await buildApp(), id);
    expect(result).toEqual({
      status: 400,
      body: { error: 'Invalid application id', code: 'INVALID_APPLICATION_ID' },
      headers: {},
    });
    expect(mocks.readInterview).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('collapses absent and every unauthorized object to the same bounded response', async () => {
    const app = await buildApp();
    mocks.readInterview.mockResolvedValue({ ok: false, reason: 'not_found' });
    const foreign = await invoke(app, '2002');
    const absent = await invoke(app, '999999');
    expect(foreign).toEqual({
      status: 404,
      body: { error: 'Application not found', code: 'APPLICATION_NOT_FOUND' },
      headers: {},
    });
    expect(absent).toEqual(foreign);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('fails closed when authorization is unavailable', async () => {
    mocks.readInterview.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await expect(invoke(await buildApp(), '2001')).resolves.toEqual({
      status: 503,
      body: { error: 'Authorization unavailable', code: 'AUTHORIZATION_UNAVAILABLE' },
      headers: {},
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each([
    { interviewDate: null, interviewTime: '10:30' },
    { interviewDate: '2099-01-15T00:00:00.000Z', interviewTime: null },
  ])('reveals scheduling absence only after successful authorization', async (missing) => {
    mocks.readInterview.mockResolvedValue({
      ok: true,
      interview: { ...scheduled, ...missing },
    });
    await expect(invoke(await buildApp(), '2001')).resolves.toEqual({
      status: 400,
      body: { error: 'Interview not scheduled', code: 'INTERVIEW_NOT_SCHEDULED' },
      headers: {},
    });
    expect(mocks.readInterview).toHaveBeenCalledWith(101, 2001, { allowPlatformAdmin: true });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('generates once after authorization with only the frozen mapping', async () => {
    mocks.readInterview.mockResolvedValue({ ok: true, interview: scheduled });
    const result = await invoke(await buildApp(), '2001');
    expect(result).toEqual({
      status: 200,
      body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="interview-fixture-role-fixture-candidate.ics"',
      },
    });
    expect(mocks.readInterview).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledWith({
      candidateName: 'Fixture Candidate',
      candidateEmail: 'candidate@example.invalid',
      jobTitle: 'Fixture Role',
      interviewDate: '2099-01-15',
      interviewTime: '10:30',
      interviewLocation: 'Synthetic room',
      recruiterName: 'Primary Recruiter',
      recruiterEmail: 'primary@example.invalid',
      notes: 'Synthetic authorization proof',
    });
    expect(mocks.filename).toHaveBeenCalledWith('Fixture Role', 'Fixture Candidate');
    expect(mocks.readInterview.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generate.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it('uses the existing optional organizer/location/note semantics without another target read', async () => {
    mocks.readInterview.mockResolvedValue({
      ok: true,
      interview: {
        ...scheduled,
        interviewLocation: null,
        interviewNotes: null,
      },
    });
    const app = await buildApp();
    const layer = (app as any)._router.stack.find(
      (entry: any) => entry.route?.path === '/api/applications/:id/interview/ics',
    );
    expect(layer).toBeTruthy();
    await invoke(app, '2001');
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      interviewLocation: 'TBD',
    }));
    expect(mocks.generate.mock.calls[0]![0]).not.toHaveProperty('notes');
    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it('maps generator failure to one constant error without target content', async () => {
    mocks.readInterview.mockResolvedValue({ ok: true, interview: scheduled });
    mocks.generate.mockImplementation(() => {
      throw new Error('candidate@example.invalid Synthetic authorization proof');
    });
    let caught: unknown;
    try {
      await invoke(await buildApp(), '2001');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain('INTERVIEW_ICS_GENERATION_FAILED');
    expect(String(caught)).not.toContain('candidate@example.invalid');
    expect(String(caught)).not.toContain('Synthetic authorization proof');
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
