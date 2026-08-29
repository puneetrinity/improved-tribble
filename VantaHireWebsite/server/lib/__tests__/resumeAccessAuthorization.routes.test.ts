// @vitest-environment node
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readText: vi.fn(),
  readStage: vi.fn(),
  readEmail: vi.fn(),
  readInterview: vi.fn(),
  createAttempt: vi.fn(),
  terminalizeAttempt: vi.fn(),
  downloadBound: vi.fn(),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../auth", () => ({
  requireAuth: pass,
  requireRole: () => pass,
  requireSeat: () => pass,
  requireVerifiedCandidate: pass,
}));

vi.mock("../applicationReadAuthorization", () => ({
  parsePositiveDecimalApplicationId: (value: unknown) => {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  },
  readAuthorizedApplicationResumeFile: mocks.readFile,
  readAuthorizedApplicationResumeText: mocks.readText,
  readAuthorizedApplicationStageHistory: mocks.readStage,
  readAuthorizedApplicationEmailHistory: mocks.readEmail,
  readAuthorizedApplicationInterviewInvite: mocks.readInterview,
}));

vi.mock("../../storage", () => ({
  storage: {
    createResumeAccessAttempt: mocks.createAttempt,
    terminalizeResumeAccessAttempt: mocks.terminalizeAttempt,
  },
}));

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    execute: vi.fn(), transaction: vi.fn(),
  },
}));

vi.mock("../../gcs-storage", () => ({
  uploadToGCS: vi.fn(),
  downloadFromGCS: vi.fn(),
  downloadBoundApplicationResumeFromGCS: mocks.downloadBound,
}));

vi.mock("../../lib/organizationService", () => ({ getUserOrganization: vi.fn() }));
vi.mock("../../lib/featureGating", () => ({
  FEATURES: {},
  requireFeatureAccess: () => pass,
}));
vi.mock("../../notificationService", () => ({
  sendStatusUpdateNotification: vi.fn(),
  sendInterviewInvitationNotification: vi.fn(),
  sendApplicationReceivedNotification: vi.fn(),
  sendOfferNotification: vi.fn(),
  sendRejectionNotification: vi.fn(),
}));
vi.mock("../../emailTemplateService", () => ({ notifyRecruitersNewApplication: vi.fn() }));
vi.mock("../resumeExtractor", () => ({ extractResumeText: vi.fn(), validateResumeText: vi.fn() }));
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
vi.mock("../icsGenerator", () => ({ generateInterviewICS: vi.fn(), getICSFilename: vi.fn() }));

type RouteResult = { status: number; body: unknown; headers: Record<string, string> };

function actor(role: "recruiter" | "hiring_manager" | "candidate" | "super_admin" = "recruiter") {
  return { id: 101, role, username: "actor@example.invalid", emailVerified: true };
}

async function applicationApp(): Promise<express.Express> {
  const { registerApplicationsRoutes } = await import("../../applications.routes");
  const app = express();
  const upload = { single: () => pass, array: () => pass, none: () => pass, fields: () => pass } as any;
  registerApplicationsRoutes(app, pass as any, upload);
  return app;
}

async function textApp(): Promise<express.Express> {
  const { registerResumeRoutes } = await import("../../resume.routes");
  const app = express();
  registerResumeRoutes(app);
  return app;
}

async function invoke(
  app: express.Express,
  method: "get" | "patch",
  path: string,
  id: string | undefined,
  role: "recruiter" | "hiring_manager" | "candidate" | "super_admin" = "recruiter",
  query: Record<string, string> = {},
): Promise<RouteResult> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method} ${path}`);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(), params: { id }, body: {}, query, user: actor(role), headers: {},
    ip: "127.0.0.1", app: { get: () => false },
  };

  return new Promise((resolve, reject) => {
    const events = new EventEmitter();
    let settled = false;
    const headers: Record<string, string> = {};
    const finish = (body: unknown, status: number) => {
      if (settled) return;
      res.writableFinished = true;
      events.emit("finish");
      settled = true;
      resolve({ status, body, headers });
    };
    const res: any = {
      statusCode: 200,
      writableFinished: false,
      once: events.once.bind(events),
      status(code: number) { this.statusCode = code; return this; },
      setHeader(name: string, value: string | number) { headers[name.toLowerCase()] = String(value); },
      json(payload: unknown) { finish(payload, this.statusCode); return this; },
      send(payload: unknown) { finish(payload, this.statusCode); return this; },
      redirect(code: number, location: string) {
        this.statusCode = code;
        headers.location = location;
        finish(undefined, code);
        return this;
      },
    };
    let index = 0;
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
  mocks.createAttempt.mockResolvedValue(true);
  mocks.terminalizeAttempt.mockResolvedValue(true);
  mocks.downloadBound.mockResolvedValue(Buffer.from("synthetic-pdf"));
});

describe("resume access authorization routes", () => {
  it.each([undefined, "", "0", "-1", "+1", "01", " 1", "1 ", "1.0", "1e1", "0x10", "1x", String(Number.MAX_SAFE_INTEGER + 1)])(
    "rejects non-canonical file id %s before authorization, audit, or GCS",
    async (id) => {
      const result = await invoke(await applicationApp(), "get", "/api/applications/:id/resume", id);
      expect(result).toMatchObject({ status: 400, body: { code: "INVALID_APPLICATION_ID" } });
      expect(mocks.readFile).not.toHaveBeenCalled();
      expect(mocks.createAttempt).not.toHaveBeenCalled();
      expect(mocks.downloadBound).not.toHaveBeenCalled();
    },
  );

  it("collapses denied and absent file objects before audit or GCS", async () => {
    mocks.readFile.mockResolvedValue({ ok: false, reason: "not_found" });
    const app = await applicationApp();
    const foreign = await invoke(app, "get", "/api/applications/:id/resume", "2002");
    const absent = await invoke(app, "get", "/api/applications/:id/resume", "999999");
    expect(foreign).toEqual({
      status: 404,
      body: { error: "Application not found", code: "APPLICATION_NOT_FOUND" },
      headers: {},
    });
    expect(absent).toEqual(foreign);
    expect(mocks.createAttempt).not.toHaveBeenCalled();
    expect(mocks.downloadBound).not.toHaveBeenCalled();
  });

  it("fails closed when file authorization or the initial audit write is unavailable", async () => {
    mocks.readFile.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    await expect(invoke(await applicationApp(), "get", "/api/applications/:id/resume", "2001"))
      .resolves.toMatchObject({ status: 503, body: { code: "AUTHORIZATION_UNAVAILABLE" } });

    mocks.readFile.mockResolvedValueOnce({ ok: true, resume: {
      applicationId: 2001, organizationId: 1, resumeUrl: "gs://configured/resumes/a.pdf", resumeFilename: "a.pdf",
    } });
    mocks.createAttempt.mockResolvedValueOnce(false);
    await expect(invoke(await applicationApp(), "get", "/api/applications/:id/resume", "2001"))
      .resolves.toMatchObject({ status: 503, body: { code: "AUDIT_UNAVAILABLE" } });
    expect(mocks.downloadBound).not.toHaveBeenCalled();
  });

  it.each([
    [null, "missing", "RESUME_MISSING"],
    ["fixture://unsupported", "unsupported", "RESUME_SCHEME_UNSUPPORTED"],
  ] as const)("audits and fails an owner-only %s source without provider access", async (resumeUrl, mode, failureCode) => {
    mocks.readFile.mockResolvedValue({ ok: true, resume: {
      applicationId: 2001, organizationId: 1, resumeUrl, resumeFilename: "fixture.pdf",
    } });
    const result = await invoke(await applicationApp(), "get", "/api/applications/:id/resume", "2001");
    expect(result).toMatchObject({ status: 404, body: { code: "RESUME_NOT_AVAILABLE" } });
    expect(mocks.createAttempt).toHaveBeenCalledWith(expect.objectContaining({ deliveryMode: mode }));
    expect(mocks.terminalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", responseStatus: 404, failureCode, updateLegacyDownloadedAt: false,
    }));
    expect(mocks.downloadBound).not.toHaveBeenCalled();
  });

  it("records a redirect only on response finish and never updates the legacy timestamp", async () => {
    mocks.readFile.mockResolvedValue({ ok: true, resume: {
      applicationId: 2001, organizationId: 1,
      resumeUrl: "https://example.invalid/fixture.pdf", resumeFilename: "fixture.pdf",
    } });
    const result = await invoke(await applicationApp(), "get", "/api/applications/:id/resume", "2001");
    expect(result).toMatchObject({ status: 302, headers: { location: "https://example.invalid/fixture.pdf" } });
    await vi.waitFor(() => expect(mocks.terminalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "redirected", responseStatus: 302, updateLegacyDownloadedAt: false,
    })));
    expect(mocks.downloadBound).not.toHaveBeenCalled();
  });

  it.each([
    ["recruiter", true],
    ["hiring_manager", true],
    ["candidate", false],
    ["super_admin", false],
  ] as const)("streams a bound GCS file for %s and terminalizes truthfully", async (role, legacy) => {
    mocks.readFile.mockResolvedValue({ ok: true, resume: {
      applicationId: 2001, organizationId: 1,
      resumeUrl: "gs://configured/resumes/a.pdf", resumeFilename: "bad\r\n\"name.pdf",
    } });
    const result = await invoke(await applicationApp(), "get", "/api/applications/:id/resume", "2001", role);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(Buffer.from("synthetic-pdf"));
    expect(result.headers["content-disposition"]).not.toMatch(/[\r\n]/);
    expect(mocks.downloadBound).toHaveBeenCalledWith("gs://configured/resumes/a.pdf");
    await vi.waitFor(() => expect(mocks.terminalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed", responseStatus: 200, updateLegacyDownloadedAt: legacy,
    })));
  });

  it("maps bound GCS scope/provider failures to fixed audited responses", async () => {
    const app = await applicationApp();
    mocks.readFile.mockResolvedValue({ ok: true, resume: {
      applicationId: 2001, organizationId: 1,
      resumeUrl: "gs://configured/resumes/a.pdf", resumeFilename: "a.pdf",
    } });
    mocks.downloadBound.mockRejectedValueOnce(new Error("GCS_RESUME_LOCATOR_REFUSED"));
    await expect(invoke(app, "get", "/api/applications/:id/resume", "2001"))
      .resolves.toMatchObject({ status: 404, body: { code: "RESUME_NOT_AVAILABLE" } });
    expect(mocks.terminalizeAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed", failureCode: "RESUME_SCOPE_REFUSED",
    }));

    mocks.downloadBound.mockRejectedValueOnce(new Error("provider raw secret"));
    await expect(invoke(app, "get", "/api/applications/:id/resume", "2001"))
      .resolves.toMatchObject({ status: 503, body: { code: "RESUME_UNAVAILABLE" } });
    expect(mocks.terminalizeAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed", failureCode: "RESUME_PROVIDER_UNAVAILABLE",
    }));
  });

  it("retires the old PATCH without object, audit, or provider access", async () => {
    const result = await invoke(await applicationApp(), "patch", "/api/applications/:id/download", "foreign");
    expect(result).toEqual({ status: 410, body: { code: "RESUME_DOWNLOAD_TRACKING_RETIRED" }, headers: {} });
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.createAttempt).not.toHaveBeenCalled();
    expect(mocks.downloadBound).not.toHaveBeenCalled();
  });

  it("serves only authorized stored text and never invokes GCS", async () => {
    mocks.readText.mockResolvedValue({ ok: true, resume: {
      applicationId: 2001, organizationId: 1, text: "synthetic stored text",
    } });
    const result = await invoke(await textApp(), "get", "/api/applications/:id/resume-text", "2001");
    expect(result).toEqual({ status: 200, body: { text: "synthetic stored text" }, headers: {} });
    expect(mocks.createAttempt).toHaveBeenCalledWith(expect.objectContaining({ deliveryMode: "stored_text" }));
    await vi.waitFor(() => expect(mocks.terminalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed", responseStatus: 200, updateLegacyDownloadedAt: false,
    })));
    expect(mocks.downloadBound).not.toHaveBeenCalled();
  });

  it("audits authorized missing text while denied text is indistinguishable from absent", async () => {
    mocks.readText.mockResolvedValueOnce({ ok: true, resume: { applicationId: 2001, organizationId: 1, text: null } });
    await expect(invoke(await textApp(), "get", "/api/applications/:id/resume-text", "2001"))
      .resolves.toMatchObject({ status: 404, body: { code: "RESUME_TEXT_NOT_AVAILABLE" } });
    expect(mocks.terminalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", failureCode: "RESUME_TEXT_MISSING",
    }));

    mocks.readText.mockResolvedValue({ ok: false, reason: "not_found" });
    const app = await textApp();
    const foreign = await invoke(app, "get", "/api/applications/:id/resume-text", "2002");
    const absent = await invoke(app, "get", "/api/applications/:id/resume-text", "999999");
    expect(foreign).toEqual(absent);
    expect(foreign).toMatchObject({ status: 404, body: { code: "APPLICATION_NOT_FOUND" } });
  });
});

describe("bound GCS, semantic, and client contracts", () => {
  it("accepts only the configured bucket and resumes prefix", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "configured");
    const actual = await vi.importActual<typeof import("../../gcs-storage")>("../../gcs-storage");
    expect(actual.parseBoundApplicationResumeGcsPath("gs://configured/resumes/a.pdf"))
      .toEqual({ bucket: "configured", object: "resumes/a.pdf" });
    for (const locator of [
      "gs://other/resumes/a.pdf", "gs://configured/private/a.pdf", "gs://configured/resumes/",
      "https://configured/resumes/a.pdf", "gs://configured/resumes/a.pdf\nsecret",
    ]) expect(() => actual.parseBoundApplicationResumeGcsPath(locator)).toThrow("GCS_RESUME_LOCATOR_REFUSED");
    vi.unstubAllEnvs();
  });

  it("keeps the external proxy retired and strips locators/signing from semantic results", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const semantic = readFileSync(join(root, "server/candidates.semantic.routes.ts"), "utf8");
    const proxy = semantic.match(/app\.get\([\s\S]*?'\/api\/candidates\/external-resume'[\s\S]*?\n\s*\);/)?.[0] ?? "";
    expect(proxy).toContain("EXTERNAL_RESUME_PROXY_RETIRED");
    expect(proxy).not.toContain("req.query");
    expect(proxy).not.toContain("downloadFromGCS");
    expect(semantic).not.toContain("getSignedDownloadUrl");
    expect(semantic).not.toContain("locator:");
    expect(semantic).toContain("previewUrl: null");
    expect(semantic).toContain("signedUrl: null");
  });

  it("keeps clients on the authorized application route with no locator proxy or tracking PATCH", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const candidates = readFileSync(join(root, "client/src/pages/candidates-page.tsx"), "utf8");
    const management = readFileSync(join(root, "client/src/pages/application-management-page.tsx"), "utf8");
    const applications = readFileSync(join(root, "client/src/pages/applications-page.tsx"), "utf8");
    expect(candidates).not.toContain("/api/candidates/external-resume");
    expect(candidates).not.toContain("locator");
    expect(candidates).toMatch(/\/api\/applications\/\$\{[^}]+\.applicationId\}\/resume/);
    expect(`${management}\n${applications}`).not.toContain("/download',");
    expect(`${management}\n${applications}`).not.toContain("method: 'PATCH'");
  });
});
