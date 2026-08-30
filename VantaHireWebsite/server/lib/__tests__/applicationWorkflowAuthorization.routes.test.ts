// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  moveStage: vi.fn(),
  scheduleInterview: vi.fn(),
  scheduleBulk: vi.fn(),
  addNote: vi.fn(),
  setRating: vi.fn(),
  readFeedback: vi.fn(),
  addFeedback: vi.fn(),
  getApplication: vi.fn(),
  updateStage: vi.fn(),
  legacyInterview: vi.fn(),
  legacyBulkInterview: vi.fn(),
  legacyNote: vi.fn(),
  legacyRating: vi.fn(),
  notifyStatus: vi.fn(),
  notifyInterview: vi.fn(),
  notifyOffer: vi.fn(),
  notifyRejection: vi.fn(),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../auth", () => ({
  requireAuth: pass,
  requireVerifiedCandidate: pass,
  requireRole: () => pass,
  requireSeat: () => pass,
}));
vi.mock("../applicationWorkflowAuthorization", () => ({
  moveAuthorizedApplicationStage: mocks.moveStage,
  scheduleAuthorizedApplicationInterview: mocks.scheduleInterview,
  scheduleAuthorizedBulkApplicationInterviews: mocks.scheduleBulk,
  addAuthorizedApplicationReviewerNote: mocks.addNote,
  setAuthorizedApplicationReviewerRating: mocks.setRating,
  readAuthorizedApplicationFeedback: mocks.readFeedback,
  addAuthorizedApplicationFeedback: mocks.addFeedback,
}));
vi.mock("../applicationReadAuthorization", () => ({
  readAuthorizedApplicationResumeFile: vi.fn(),
  readAuthorizedApplicationStageHistory: vi.fn(),
  readAuthorizedApplicationEmailHistory: vi.fn(),
  readAuthorizedApplicationInterviewInvite: vi.fn(),
}));
vi.mock("../../storage", () => ({
  storage: {
    getApplication: mocks.getApplication,
    updateApplicationStage: mocks.updateStage,
    scheduleInterview: mocks.legacyInterview,
    scheduleInterviewWithStage: mocks.legacyBulkInterview,
    addRecruiterNote: mocks.legacyNote,
    setApplicationRating: mocks.legacyRating,
  },
}));
vi.mock("../../db", () => ({
  db: { execute: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), query: {} },
}));
vi.mock("../organizationService", () => ({ getUserOrganization: vi.fn() }));
vi.mock("../featureGating", () => ({ FEATURES: {}, requireFeatureAccess: () => pass }));
vi.mock("../../gcs-storage", () => ({
  uploadToGCS: vi.fn(), downloadFromGCS: vi.fn(), downloadBoundApplicationResumeFromGCS: vi.fn(),
}));
vi.mock("../../notificationService", () => ({
  sendStatusUpdateNotification: mocks.notifyStatus,
  sendInterviewInvitationNotification: mocks.notifyInterview,
  sendApplicationReceivedNotification: vi.fn(),
  sendOfferNotification: mocks.notifyOffer,
  sendRejectionNotification: mocks.notifyRejection,
}));
vi.mock("../../emailTemplateService", () => ({ notifyRecruitersNewApplication: vi.fn() }));
vi.mock("../icsGenerator", () => ({ generateInterviewICS: vi.fn(), getICSFilename: vi.fn() }));
vi.mock("../resumeExtractor", () => ({ extractResumeText: vi.fn(), validateResumeText: vi.fn() }));
vi.mock("../resumeIngestExtraction", () => ({ extractResumeForOrdinaryIngest: vi.fn() }));
vi.mock("../../aiJobAnalyzer", () => ({ isAIEnabled: vi.fn(() => false), generateCandidateSummary: vi.fn() }));
vi.mock("../aiMatchingEngine", () => ({ calculateAiCost: vi.fn(), checkCircuitBreaker: vi.fn() }));
vi.mock("../profileCompletion", () => ({ syncProfileCompletionStatus: vi.fn() }));
vi.mock("../creditService", () => ({
  getAiCreditExhaustionPayload: vi.fn(), hasEnoughCredits: vi.fn(), useCredits: vi.fn(),
  getCreditCostForOperation: vi.fn(), getUserDailyRateLimit: vi.fn(), getPlanRateLimitInfo: vi.fn(),
}));
vi.mock("../../rateLimit", () => ({
  aiAnalysisRateLimit: pass, applicationRateLimit: pass, recruiterAddRateLimit: pass,
}));
vi.mock("../aiQueue", () => ({
  isQueueAvailable: vi.fn(), enqueueSummaryBatch: vi.fn(), removeJob: vi.fn(), QUEUES: {},
}));
vi.mock("../activekgTenant", () => ({ resolveActiveKGTenantId: vi.fn() }));
vi.mock("../applicationGraphSyncProcessor", () => ({ MIN_RESUME_TEXT_LENGTH: 100 }));
vi.mock("../pipelineStageUtils", () => ({ normalizeStageName: vi.fn() }));
vi.mock("../pipelineStageSelection", () => ({ pickInitialPipelineStage: vi.fn() }));
vi.mock("../../candidate-privacy/decision", () => ({
  CandidatePrivacyRestrictedError: class extends Error { code = "CANDIDATE_PRIVACY_RESTRICTED"; },
  requireCandidatePrivacyAllowed: vi.fn(),
  requireNewCandidateIdentityAllowed: vi.fn(),
}));
vi.mock("../outreachComplianceCore", () => ({ verifyOutreachApplicationToken: vi.fn() }));
vi.mock("../outreachConcurrency", () => ({ lockCandidateOutreach: vi.fn() }));

type Method = "get" | "post" | "patch";
type Result = { status: number; body: any };

async function buildApp(): Promise<express.Express> {
  const { registerApplicationsRoutes } = await import("../../applications.routes");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 101, role: "recruiter", emailVerified: true };
    next();
  });
  const upload = {
    single: () => pass, array: () => pass, none: () => pass, fields: () => pass,
  } as any;
  registerApplicationsRoutes(app, pass as any, upload);
  return app;
}

async function invoke(
  app: express.Express,
  method: Method,
  path: string,
  input: { id?: string; body?: Record<string, unknown> } = {},
): Promise<Result> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(), params: { id: input.id }, body: input.body ?? {}, query: {},
    user: { id: 101, role: "recruiter", emailVerified: true }, headers: {}, ip: "127.0.0.1",
    app: { get: () => false },
  };
  return new Promise((resolve, reject) => {
    let index = 0;
    let settled = false;
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) {
        if (!settled) { settled = true; resolve({ status: this.statusCode, body }); }
        return this;
      },
      send(body: unknown) {
        if (!settled) { settled = true; resolve({ status: this.statusCode, body }); }
        return this;
      },
    };
    const next = (error?: unknown) => {
      if (error) { reject(error); return; }
      const handler = handlers[index++];
      if (!handler) { reject(new Error("route completed without response")); return; }
      Promise.resolve(handler(req, res, next)).catch(reject);
    };
    next();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.EMAIL_AUTOMATION_ENABLED;
  delete process.env.NOTIFICATION_AUTOMATION_ENABLED;
});

describe("application workflow route mappings", () => {
  it.each([
    ["patch", "/api/applications/:id/stage", { stageId: 2 }, "moveStage"],
    ["patch", "/api/applications/:id/interview", {}, "scheduleInterview"],
    ["post", "/api/applications/:id/notes", { note: "bounded" }, "addNote"],
    ["patch", "/api/applications/:id/rating", { rating: 4 }, "setRating"],
    ["get", "/api/applications/:id/feedback", {}, "readFeedback"],
    ["post", "/api/applications/:id/feedback", { overallScore: 4, recommendation: "hold" }, "addFeedback"],
  ] as const)("rejects a non-canonical id before %s %s authorization", async (method, path, body, mockName) => {
    const result = await invoke(await buildApp(), method, path, { id: "01", body });
    expect(result).toEqual({
      status: 400,
      body: { error: "Invalid application ID", code: "INVALID_APPLICATION_ID" },
    });
    expect(mocks[mockName]).not.toHaveBeenCalled();
  });

  it("maps all protected object denials to the same 404 and never falls back to legacy storage", async () => {
    const app = await buildApp();
    mocks.moveStage.mockResolvedValue({ ok: false, reason: "not_found" });
    mocks.scheduleInterview.mockResolvedValue({ ok: false, reason: "not_found" });
    mocks.addNote.mockResolvedValue({ ok: false, reason: "not_found" });
    mocks.setRating.mockResolvedValue({ ok: false, reason: "not_found" });
    mocks.readFeedback.mockResolvedValue({ ok: false, reason: "not_found" });
    mocks.addFeedback.mockResolvedValue({ ok: false, reason: "not_found" });
    const cases: Array<[Method, string, Record<string, unknown>]> = [
      ["patch", "/api/applications/:id/stage", { stageId: 2 }],
      ["patch", "/api/applications/:id/interview", {}],
      ["post", "/api/applications/:id/notes", { note: "bounded" }],
      ["patch", "/api/applications/:id/rating", { rating: 4 }],
      ["get", "/api/applications/:id/feedback", {}],
      ["post", "/api/applications/:id/feedback", { overallScore: 4, recommendation: "hold" }],
    ];
    for (const [method, path, body] of cases) {
      await expect(invoke(app, method, path, { id: "2002", body })).resolves.toEqual({
        status: 404,
        body: { error: "Application not found", code: "APPLICATION_NOT_FOUND" },
      });
    }
    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(mocks.updateStage).not.toHaveBeenCalled();
    expect(mocks.legacyInterview).not.toHaveBeenCalled();
    expect(mocks.legacyNote).not.toHaveBeenCalled();
    expect(mocks.legacyRating).not.toHaveBeenCalled();
    expect(mocks.notifyStatus).not.toHaveBeenCalled();
    expect(mocks.notifyInterview).not.toHaveBeenCalled();
  });

  it("maps unavailable to a fixed 503 without provider calls", async () => {
    mocks.moveStage.mockResolvedValue({ ok: false, reason: "unavailable" });
    await expect(invoke(await buildApp(), "patch", "/api/applications/:id/stage", {
      id: "2001", body: { stageId: 2 },
    })).resolves.toEqual({
      status: 503,
      body: { error: "Authorization unavailable", code: "AUTHORIZATION_UNAVAILABLE" },
    });
    expect(mocks.notifyStatus).not.toHaveBeenCalled();
    expect(mocks.notifyOffer).not.toHaveBeenCalled();
    expect(mocks.notifyRejection).not.toHaveBeenCalled();
  });

  it("returns only the command projections for note, rating and feedback", async () => {
    const app = await buildApp();
    const note = { applicationId: 2001, note: { id: 7, authorId: 101, createdAt: "2026-08-30T12:00:00.000Z" } };
    const rating = { applicationId: 2001, reviewerId: 101, rating: 4, rubricVersion: "application-rating-v1", updatedAt: "2026-08-30T12:00:00.000Z" };
    const feedback = [{ id: 8, applicationId: 2001, authorId: 101, overallScore: 4,
      recommendation: "hold", notes: null, rubricVersion: "team-feedback-v1",
      createdAt: "2026-08-30T12:00:00.000Z", updatedAt: "2026-08-30T12:00:00.000Z",
      author: { id: 101, firstName: "Fixture", lastName: "Recruiter", role: "recruiter" } }];
    mocks.addNote.mockResolvedValue({ ok: true, value: note });
    mocks.setRating.mockResolvedValue({ ok: true, value: rating });
    mocks.readFeedback.mockResolvedValue({ ok: true, rows: feedback });
    await expect(invoke(app, "post", "/api/applications/:id/notes", { id: "2001", body: { note: "secret note" } }))
      .resolves.toEqual({ status: 201, body: note });
    await expect(invoke(app, "patch", "/api/applications/:id/rating", { id: "2001", body: { rating: 4 } }))
      .resolves.toEqual({ status: 200, body: rating });
    await expect(invoke(app, "get", "/api/applications/:id/feedback", { id: "2001" }))
      .resolves.toEqual({ status: 200, body: feedback });
  });

  it("normalizes and deduplicates bulk scheduling before one command", async () => {
    mocks.scheduleBulk.mockResolvedValue({ ok: true, value: [{
      applicationId: 2001,
      interviewDate: "2099-01-01T10:00:00.000Z",
      interviewTime: null,
      interviewLocation: "Synthetic room",
      interviewNotes: null,
      updatedAt: "2026-08-30T12:00:00.000Z",
    }] });
    const result = await invoke(await buildApp(), "patch", "/api/applications/bulk/interview", {
      body: {
        applicationIds: [2001, 2001],
        start: "2099-01-01T10:00:00.000Z",
        intervalHours: 0,
        location: "Synthetic room",
      },
    });
    expect(result).toEqual({
      status: 200,
      body: { total: 1, scheduledCount: 1, failedCount: 0, failed: [] },
    });
    expect(mocks.scheduleBulk).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleBulk.mock.calls[0]?.[1]).toHaveLength(1);
    expect(mocks.legacyBulkInterview).not.toHaveBeenCalled();
    expect(mocks.notifyInterview).not.toHaveBeenCalled();
  });

  it("keeps authorized-empty feedback as 200 []", async () => {
    mocks.readFeedback.mockResolvedValue({ ok: true, rows: [] });
    await expect(invoke(await buildApp(), "get", "/api/applications/:id/feedback", { id: "2001" }))
      .resolves.toEqual({ status: 200, body: [] });
  });
});
