// @vitest-environment node
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSummary: vi.fn(),
  publishSummary: vi.fn(),
  readSimilar: vi.fn(),
  readManual: vi.fn(),
  readDraft: vi.fn(),
  recordDraft: vi.fn(),
  parseJob: vi.fn((value: unknown) => value === "1001" ? 1001 : null),
  parseQuery: vi.fn(() => ({ ok: true, minFitScore: 70, limit: 20 })),
  generateSummary: vi.fn(),
  generateDraft: vi.fn(),
  privacy: vi.fn(),
  sendAuthorized: vi.fn(),
  mautic: vi.fn(),
  getApplication: vi.fn(),
  getJob: vi.fn(),
  getSimilar: vi.fn(),
  getTemplates: vi.fn(),
  hasCredits: vi.fn(),
  useCredits: vi.fn(),
  download: vi.fn(),
  extract: vi.fn(),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../auth", () => ({
  requireAuth: pass,
  requireVerifiedCandidate: pass,
  requireRole: () => pass,
  requireSeat: () => pass,
}));
vi.mock("../featureGating", () => ({ FEATURES: { AI_CONTENT: "ai_content" }, requireFeatureAccess: () => pass }));
vi.mock("../applicationAiOutboundAuthorization", () => ({
  readAuthorizedApplicationAiSummaryContext: mocks.readSummary,
  publishAuthorizedApplicationAiSummary: mocks.publishSummary,
  readAuthorizedSimilarCandidates: mocks.readSimilar,
  readAuthorizedManualEmailContext: mocks.readManual,
  readAuthorizedEmailDraftContext: mocks.readDraft,
  recordAuthorizedEmailDraftUsage: mocks.recordDraft,
  parsePositiveDecimalJobId: mocks.parseJob,
  parseSimilarCandidateQuery: mocks.parseQuery,
}));
vi.mock("../applicationWorkflowAuthorization", () => ({
  moveAuthorizedApplicationStage: vi.fn(), scheduleAuthorizedApplicationInterview: vi.fn(),
  scheduleAuthorizedBulkApplicationInterviews: vi.fn(), addAuthorizedApplicationReviewerNote: vi.fn(),
  setAuthorizedApplicationReviewerRating: vi.fn(), readAuthorizedApplicationFeedback: vi.fn(),
  addAuthorizedApplicationFeedback: vi.fn(),
}));
vi.mock("../applicationReadAuthorization", () => ({
  readAuthorizedApplicationResumeFile: vi.fn(), readAuthorizedApplicationStageHistory: vi.fn(),
  readAuthorizedApplicationEmailHistory: vi.fn(), readAuthorizedApplicationInterviewInvite: vi.fn(),
}));
vi.mock("../../storage", () => ({
  storage: {
    getApplication: mocks.getApplication,
    getJob: mocks.getJob,
    getSimilarCandidatesForJob: mocks.getSimilar,
    getEmailTemplates: mocks.getTemplates,
  },
}));
vi.mock("../../db", () => ({
  db: { execute: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), query: {} },
}));
vi.mock("../organizationService", () => ({ getUserOrganization: vi.fn() }));
vi.mock("../creditService", () => ({
  getAiCreditExhaustionPayload: vi.fn(), hasEnoughCredits: mocks.hasCredits, useCredits: mocks.useCredits,
  getCreditCostForOperation: vi.fn(), getUserDailyRateLimit: vi.fn(), getPlanRateLimitInfo: vi.fn(),
}));
vi.mock("../../gcs-storage", () => ({
  uploadToGCS: vi.fn(), downloadFromGCS: mocks.download, downloadBoundApplicationResumeFromGCS: vi.fn(),
}));
vi.mock("../../notificationService", () => ({
  sendStatusUpdateNotification: vi.fn(), sendInterviewInvitationNotification: vi.fn(),
  sendApplicationReceivedNotification: vi.fn(), sendOfferNotification: vi.fn(), sendRejectionNotification: vi.fn(),
}));
vi.mock("../../emailTemplateService", () => ({
  notifyRecruitersNewApplication: vi.fn(), sendAuthorizedTemplatedEmail: mocks.sendAuthorized,
}));
vi.mock("../mauticService", () => ({ queueMauticOutreachSync: mocks.mautic }));
vi.mock("../../aiJobAnalyzer", () => ({
  isAIEnabled: vi.fn(() => true), generateCandidateSummary: mocks.generateSummary, generateEmailDraft: mocks.generateDraft,
}));
vi.mock("../aiMatchingEngine", () => ({ calculateAiCost: vi.fn(() => "0.00010000"), checkCircuitBreaker: vi.fn() }));
vi.mock("../../rateLimit", () => ({
  aiAnalysisRateLimit: pass, applicationRateLimit: pass, recruiterAddRateLimit: pass,
}));
vi.mock("../icsGenerator", () => ({ generateInterviewICS: vi.fn(), getICSFilename: vi.fn() }));
vi.mock("../resumeExtractor", () => ({ extractResumeText: mocks.extract, validateResumeText: vi.fn() }));
vi.mock("../resumeIngestExtraction", () => ({ extractResumeForOrdinaryIngest: vi.fn() }));
vi.mock("../profileCompletion", () => ({ syncProfileCompletionStatus: vi.fn() }));
vi.mock("../aiQueue", () => ({ isQueueAvailable: vi.fn(), enqueueSummaryBatch: vi.fn(), removeJob: vi.fn(), QUEUES: {} }));
vi.mock("../activekgTenant", () => ({ resolveActiveKGTenantId: vi.fn() }));
vi.mock("../applicationGraphSyncProcessor", () => ({ MIN_RESUME_TEXT_LENGTH: 100 }));
vi.mock("../pipelineStageUtils", () => ({ normalizeStageName: vi.fn() }));
vi.mock("../pipelineStageSelection", () => ({ pickInitialPipelineStage: vi.fn() }));
vi.mock("../../candidate-privacy/decision", () => ({
  CandidatePrivacyRestrictedError: class extends Error { code = "CANDIDATE_PRIVACY_RESTRICTED"; },
  requireCandidatePrivacyAllowed: mocks.privacy,
  requireNewCandidateIdentityAllowed: vi.fn(),
}));
vi.mock("../outreachComplianceCore", () => ({ verifyOutreachApplicationToken: vi.fn() }));
vi.mock("../outreachConcurrency", () => ({ lockCandidateOutreach: vi.fn() }));

type Method = "get" | "post";
type Result = { status: number; body: any };

async function buildApp(): Promise<express.Express> {
  const [{ registerApplicationsRoutes }, { registerCommunicationsRoutes }] = await Promise.all([
    import("../../applications.routes"), import("../../communications.routes"),
  ]);
  const app = express();
  app.use(express.json());
  const upload = { single: () => pass, array: () => pass, none: () => pass, fields: () => pass } as any;
  registerApplicationsRoutes(app, pass as any, upload);
  registerCommunicationsRoutes(app, pass as any);
  return app;
}

async function invoke(
  app: express.Express,
  method: Method,
  path: string,
  input: { id?: string; query?: Record<string, unknown>; body?: Record<string, unknown> } = {},
): Promise<Result> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(), params: { id: input.id }, query: input.query ?? {}, body: input.body ?? {},
    user: { id: 101, role: "recruiter", emailVerified: true }, headers: {}, ip: "127.0.0.1",
    app: { get: () => false },
  };
  return new Promise((resolve, reject) => {
    let index = 0;
    let settled = false;
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { if (!settled) { settled = true; resolve({ status: this.statusCode, body }); } return this; },
      send(body: unknown) { if (!settled) { settled = true; resolve({ status: this.statusCode, body }); } return this; },
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

const summaryContext = {
  applicationId: 2001, jobId: 1001, organizationId: 1, candidateName: "Synthetic",
  candidateText: "Synthetic stored resume", jobTitle: "Role", jobDescription: "Description",
  requiredSkills: ["TypeScript"], goodToHaveSkills: [],
};
const summaryResult = {
  summary: "Summary", suggestedAction: "hold", suggestedActionReason: "Review",
  strengths: ["Evidence"], concerns: [], keyHighlights: ["Highlight"],
  requiredSkillsMatched: ["TypeScript"], requiredSkillsMissing: [], requiredSkillsMatchPercentage: 100,
  requiredSkillsDepthNotes: "Strong", goodToHaveSkillsMatched: [], goodToHaveSkillsMissing: [],
  model_version: "test-model", tokensUsed: { input: 1, output: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseJob.mockImplementation((value: unknown) => value === "1001" ? 1001 : null);
  mocks.parseQuery.mockReturnValue({ ok: true, minFitScore: 70, limit: 20 });
  mocks.readSummary.mockResolvedValue({ ok: true, value: summaryContext });
  mocks.generateSummary.mockResolvedValue(summaryResult);
  mocks.publishSummary.mockResolvedValue({ ok: true, value: { applicationId: 2001, computedAt: "2026-08-30T12:00:00.000Z" } });
  mocks.readSimilar.mockResolvedValue({ ok: true, rows: [] });
  mocks.privacy.mockResolvedValue(undefined);
});

describe("2H application route adoption", () => {
  it("rejects non-canonical application ids before authorization or provider work", async () => {
    const result = await invoke(await buildApp(), "post", "/api/applications/:id/ai-summary", { id: "01" });
    expect(result).toEqual({ status: 400, body: { error: "Invalid application ID", code: "INVALID_APPLICATION_ID" } });
    expect(mocks.readSummary).not.toHaveBeenCalled();
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });

  it("maps summary denial/unavailability without legacy reads or provider work", async () => {
    const app = await buildApp();
    mocks.readSummary.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(app, "post", "/api/applications/:id/ai-summary", { id: "2001" }))
      .resolves.toEqual({ status: 404, body: { error: "Application not found", code: "APPLICATION_NOT_FOUND" } });
    mocks.readSummary.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    await expect(invoke(app, "post", "/api/applications/:id/ai-summary", { id: "2001" }))
      .resolves.toEqual({ status: 503, body: { error: "Authorization unavailable", code: "AUTHORIZATION_UNAVAILABLE" } });
    expect(mocks.generateSummary).not.toHaveBeenCalled();
    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("returns bounded no-content without Groq and publishes only after privacy", async () => {
    const app = await buildApp();
    mocks.readSummary.mockResolvedValueOnce({ ok: true, value: { ...summaryContext, candidateText: null } });
    await expect(invoke(app, "post", "/api/applications/:id/ai-summary", { id: "2001" }))
      .resolves.toMatchObject({ status: 400, body: { code: "NO_CANDIDATE_CONTENT" } });
    expect(mocks.generateSummary).not.toHaveBeenCalled();

    await expect(invoke(app, "post", "/api/applications/:id/ai-summary", { id: "2001" }))
      .resolves.toMatchObject({ status: 200, body: { summary: { text: "Summary" } } });
    expect(mocks.privacy.mock.invocationCallOrder[0]).toBeLessThan(mocks.generateSummary.mock.invocationCallOrder[0]!);
    expect(mocks.generateSummary.mock.invocationCallOrder[0]).toBeLessThan(mocks.publishSummary.mock.invocationCallOrder[0]!);
    expect(mocks.hasCredits).not.toHaveBeenCalled();
    expect(mocks.useCredits).not.toHaveBeenCalled();
  });

  it("does not return the provider result when publication authorization is lost", async () => {
    mocks.publishSummary.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(await buildApp(), "post", "/api/applications/:id/ai-summary", { id: "2001" }))
      .resolves.toEqual({ status: 404, body: { error: "Application not found", code: "APPLICATION_NOT_FOUND" } });
  });

  it("strictly validates and statement-authorizes similarity", async () => {
    const app = await buildApp();
    mocks.parseJob.mockReturnValueOnce(null);
    await expect(invoke(app, "get", "/api/jobs/:id/ai-similar-candidates", { id: "01" }))
      .resolves.toMatchObject({ status: 400, body: { code: "INVALID_JOB_ID" } });
    mocks.parseQuery.mockReturnValueOnce({ ok: false });
    await expect(invoke(app, "get", "/api/jobs/:id/ai-similar-candidates", { id: "1001", query: { limit: "51" } }))
      .resolves.toMatchObject({ status: 400, body: { code: "INVALID_SIMILAR_CANDIDATE_QUERY" } });
    mocks.readSimilar.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(app, "get", "/api/jobs/:id/ai-similar-candidates", { id: "1001" }))
      .resolves.toMatchObject({ status: 404, body: { code: "JOB_NOT_FOUND" } });
    const rows = [{ applicationId: 2002, candidateName: "Synthetic", candidateEmail: "s@example.invalid",
      sourceJobId: 1002, sourceJobTitle: "Source", aiFitScore: 80, aiFitLabel: "Strong", currentStage: null }];
    mocks.readSimilar.mockResolvedValueOnce({ ok: true, rows });
    await expect(invoke(app, "get", "/api/jobs/:id/ai-similar-candidates", { id: "1001" }))
      .resolves.toEqual({ status: 200, body: rows });
    expect(mocks.getSimilar).not.toHaveBeenCalled();
  });
});

describe("2H communications route adoption", () => {
  const manualContext = {
    applicationId: 2001, templateId: 3001, organizationId: 1,
    candidateName: "Synthetic", candidateEmail: "s@example.invalid", jobTitle: "Role",
    recruiterName: "Fixture Recruiter", templateName: "Manual", templateType: "status_update",
    templateSubject: "Subject", templateBody: "Body",
  };
  const draftContext = {
    applicationId: 2001, templateId: 3001, organizationId: 1,
    candidateName: "Synthetic", candidateEmail: "s@example.invalid", jobTitle: "Role",
    templateSubject: "Subject", templateBody: "Body",
  };

  beforeEach(() => {
    mocks.readManual.mockResolvedValue({ ok: true, value: manualContext });
    mocks.readDraft.mockResolvedValue({ ok: true, value: draftContext });
    mocks.generateDraft.mockResolvedValue({ subject: "Draft", body: "Draft body", model_version: "model", tokensUsed: { input: 1, output: 2 } });
    mocks.recordDraft.mockResolvedValue({ ok: true, value: { applicationId: 2001, usageId: 5 } });
  });

  it("authorizes manual email before the context-only sender and Mautic", async () => {
    await expect(invoke(await buildApp(), "post", "/api/applications/:id/send-email", {
      id: "2001", body: { templateId: 3001 },
    })).resolves.toEqual({ status: 200, body: { success: true } });
    expect(mocks.readManual.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendAuthorized.mock.invocationCallOrder[0]!);
    expect(mocks.sendAuthorized).toHaveBeenCalledWith(manualContext, { customVariables: {} });
    expect(mocks.mautic).toHaveBeenCalledWith(101, 1, "email");
    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(mocks.getTemplates).not.toHaveBeenCalled();
  });

  it("performs zero email/provider work on manual-email denial", async () => {
    mocks.readManual.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(await buildApp(), "post", "/api/applications/:id/send-email", {
      id: "2001", body: { templateId: 3001 },
    })).resolves.toMatchObject({ status: 404, body: { code: "APPLICATION_NOT_FOUND" } });
    expect(mocks.sendAuthorized).not.toHaveBeenCalled();
    expect(mocks.mautic).not.toHaveBeenCalled();
  });

  it("authorizes and privacy-checks draft before Groq, then reauthorizes usage", async () => {
    await expect(invoke(await buildApp(), "post", "/api/email/draft", {
      body: { templateId: 3001, applicationId: 2001, tone: "formal" },
    })).resolves.toEqual({ status: 200, body: { subject: "Draft", body: "Draft body" } });
    expect(mocks.readDraft.mock.invocationCallOrder[0]).toBeLessThan(mocks.privacy.mock.invocationCallOrder[0]!);
    expect(mocks.privacy.mock.invocationCallOrder[0]).toBeLessThan(mocks.generateDraft.mock.invocationCallOrder[0]!);
    expect(mocks.generateDraft.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordDraft.mock.invocationCallOrder[0]!);
    expect(mocks.hasCredits).not.toHaveBeenCalled();
    expect(mocks.useCredits).not.toHaveBeenCalled();
  });

  it("does not return a generated draft after usage reauthorization loss", async () => {
    mocks.recordDraft.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(await buildApp(), "post", "/api/email/draft", {
      body: { templateId: 3001, applicationId: 2001 },
    })).resolves.toMatchObject({ status: 404, body: { code: "APPLICATION_NOT_FOUND" } });
  });
});
