import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const source = readFileSync(new URL("../../applications.routes.ts", import.meta.url), "utf8");
const routeStart = source.indexOf('app.post("/api/jobs/:id/apply"');
const routeEnd = source.indexOf("// Recruiter adds candidate on behalf", routeStart);
const route = source.slice(routeStart, routeEnd);

describe("public application organization-private evidence adopter", () => {
  it("keeps one resume source and fails before application persistence when exact bytes are unavailable", () => {
    expect(route).toContain("if (hasUploadedResume === hasStoredResume)");
    expect(route).toContain("resumeBytes = await downloadFromGCS(resumeUrl)");
    expect(route).toContain("code: 'SAVED_RESUME_UNAVAILABLE'");
    expect(route).toContain("code: 'RESUME_UPLOAD_UNAVAILABLE'");
    expect(route.indexOf("pinPrivateResumeEvidence({"))
      .toBeLessThan(route.indexOf("storage.createApplication({"));
  });

  it("adds application, attribution, immutable evidence and outbox in one existing transaction", () => {
    const transaction = route.slice(
      route.indexOf("application = await db.transaction"),
      route.indexOf("return created;", route.indexOf("application = await db.transaction")),
    );
    expect(transaction).toContain("storage.createApplication({");
    expect(transaction).toContain("matchApplicationToSourcedCandidate({");
    expect(transaction).toContain("appendOrganizationCandidateApplicationEvidence({");
    expect(transaction.match(/executor: tx/g)).toHaveLength(2);
  });

  it("preserves the 201 contract and one post-commit legacy enqueue with other ingresses unchanged", () => {
    expect(route).toContain("res.status(201).json({");
    expect(route).toContain("applicationId: application.id");
    expect(route.match(/enqueueApplicationGraphSyncJob/g)).toHaveLength(1);
    expect(route.indexOf("await storage.enqueueApplicationGraphSyncJob({")).toBeGreaterThan(route.indexOf("return created;"));
    expect(source.slice(routeEnd)).toContain("enqueueApplicationGraphSyncJob");
  });

  it("attempts bounded object cleanup only for a new direct upload after DB failure", () => {
    expect(route).toContain("if (requestedResumeId === null && resumeUrl)");
    expect(route).toContain("await deleteFromGCS(resumeUrl)");
    expect(route).toContain("Uploaded resume cleanup failed");
  });
});

// Execute the registered handler and real writer/decision/repository/evidence
// modules. These are not source-string assertions or a mocked createApplication.
// Only DB transport, ancillary reads and external effects are replaced.
describe("A7 public-apply private admission through the real writer", () => {
  type Decision = "allow" | "block_global" | "block_all" | "review" | "unavailable" | "stale";
  let decision: Decision;
  let transactionDecision: Decision | undefined;
  let postCommitDecision: Decision | undefined;
  let committed: boolean;
  let applicationValues: Record<string, unknown>;
  let realStorage: typeof import("../../storage")["storage"];
  let applicationGraphSyncJobs: typeof import("@shared/schema")["applicationGraphSyncJobs"];
  let requireNewIdentity: typeof import("../../candidate-privacy/decision")["requireNewCandidateIdentityAllowed"];
  let handler: any;
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  const pdf = Buffer.from("%PDF-1.4\n% synthetic A7 resume\n%%EOF");
  const recorded = { id: 101, jobId: 51, organizationId: 41, appliedAt: new Date() };
  const saved = {
    id: 71, userId: 7, gcsPath: "gs://fixture.invalid/a7.pdf", extractedText: null as string | null,
    label: "a7.pdf", updatedAt: new Date("2026-09-10T00:00:00Z"),
  };
  const insert = vi.fn();
  const execute = vi.fn();
  const transaction = vi.fn();
  const eligibility = vi.fn();
  const privacyQuery = vi.fn();
  const upload = vi.fn();
  const download = vi.fn();
  const removeObject = vi.fn();
  const notification = vi.fn();
  const queueValues = vi.fn();
  const extract = vi.fn();
  const tx = {
    insert,
    execute,
    query: { jobSourcedCandidates: { findFirst: vi.fn(async () => undefined) } },
  };
  const db = {
    transaction,
    query: { candidateResumes: {
      findFirst: vi.fn(async () => saved), findMany: vi.fn(async () => []),
    } },
    insert: vi.fn(() => { throw new Error("OUTSIDE_TRANSACTION_INSERT_REFUSED"); }),
  };
  const moduleMocks = [
    "../../db", "../../candidate-privacy/memory-client", "../../auth", "../../gcs-storage",
    "../../notificationService", "../../emailTemplateService", "../../lib/organizationService",
    "../../lib/featureGating", "../../lib/resumeExtractor", "../../lib/resumeIngestExtraction",
    "../../aiJobAnalyzer", "../../lib/aiMatchingEngine", "../../lib/profileCompletion",
    "../../lib/creditService", "../../rateLimit", "../../lib/aiQueue", "../../lib/activekgTenant",
    "../../lib/applicationGraphSyncProcessor",
  ];

  beforeAll(async () => {
    // This file is also imported by the frozen server-suite entrypoint, whose
    // processor tests mock intake. Clear that mock explicitly for this proof.
    vi.resetModules();
    vi.doUnmock("../application-intake");
    vi.doUnmock("../../candidate-privacy/decision");
    vi.doUnmock("../../candidate-privacy/repository");
    vi.doUnmock("../../storage");
    vi.doMock("../../db", () => ({ db, pool: { query: privacyQuery } }));
    vi.doMock("../../candidate-privacy/memory-client", () => ({ checkMemoryEligibility: eligibility }));
    vi.doMock("../../auth", () => ({
      requireAuth: pass, requireVerifiedCandidate: pass, requireRole: () => pass, requireSeat: () => pass,
    }));
    vi.doMock("../../gcs-storage", () => ({
      uploadToGCS: upload, downloadFromGCS: download, deleteFromGCS: removeObject,
      downloadBoundApplicationResumeFromGCS: vi.fn(),
    }));
    vi.doMock("../../notificationService", () => ({
      sendStatusUpdateNotification: notification, sendInterviewInvitationNotification: notification,
      sendApplicationReceivedNotification: notification, sendOfferNotification: notification,
      sendRejectionNotification: notification,
    }));
    vi.doMock("../../emailTemplateService", () => ({ notifyRecruitersNewApplication: notification }));
    vi.doMock("../../lib/organizationService", () => ({ getUserOrganization: vi.fn() }));
    vi.doMock("../../lib/featureGating", () => ({ FEATURES: {}, requireFeatureAccess: () => pass }));
    vi.doMock("../../lib/resumeExtractor", () => ({ extractResumeText: vi.fn(), validateResumeText: vi.fn() }));
    vi.doMock("../../lib/resumeIngestExtraction", () => ({ extractResumeForOrdinaryIngest: extract }));
    vi.doMock("../../aiJobAnalyzer", () => ({ isAIEnabled: () => false, generateCandidateSummary: vi.fn() }));
    vi.doMock("../../lib/aiMatchingEngine", () => ({ calculateAiCost: vi.fn(), checkCircuitBreaker: vi.fn() }));
    vi.doMock("../../lib/profileCompletion", () => ({ syncProfileCompletionStatus: vi.fn() }));
    vi.doMock("../../lib/creditService", () => ({
      getAiCreditExhaustionPayload: vi.fn(), hasEnoughCredits: vi.fn(), useCredits: vi.fn(),
      getCreditCostForOperation: vi.fn(), getUserDailyRateLimit: vi.fn(), getPlanRateLimitInfo: vi.fn(),
    }));
    vi.doMock("../../rateLimit", () => ({
      applicationRateLimit: pass, recruiterAddRateLimit: pass, aiAnalysisRateLimit: pass,
    }));
    vi.doMock("../../lib/aiQueue", () => ({
      isQueueAvailable: vi.fn(), enqueueSummaryBatch: vi.fn(), removeJob: vi.fn(), QUEUES: {},
    }));
    vi.doUnmock("../../lib/activekgTenant");
    vi.doMock("../../lib/applicationGraphSyncProcessor", () => ({ MIN_RESUME_TEXT_LENGTH: 50 }));
    applicationGraphSyncJobs = (await import("@shared/schema")).applicationGraphSyncJobs;
    realStorage = (await import("../../storage")).storage;
    requireNewIdentity = (await import("../../candidate-privacy/decision")).requireNewCandidateIdentityAllowed;
    vi.spyOn(realStorage, "getJob").mockResolvedValue({
      id: 51, organizationId: 41, postedBy: 11, isActive: true, status: "approved",
      title: "Synthetic job", location: "Remote",
    } as any);
    vi.spyOn(realStorage, "findApplicationByJobAndEmail").mockResolvedValue(undefined);
    vi.spyOn(realStorage, "incrementApplyClicks").mockResolvedValue(undefined);
    vi.spyOn(realStorage, "getPipelineStages").mockResolvedValue([]);
    vi.spyOn(realStorage, "isAutomationEnabled").mockResolvedValue(false);
    vi.spyOn(realStorage, "createApplication"); // call-through, never replaces the writer
    vi.spyOn(realStorage, "enqueueApplicationGraphSyncJob"); // real global-use admission and queue upsert
    vi.spyOn(realStorage, "updateApplicationSyncSkippedReason").mockResolvedValue(undefined);
    const app = express();
    const { registerApplicationsRoutes } = await import("../../applications.routes");
    registerApplicationsRoutes(app, pass as any, { single: () => pass } as any);
    handler = (app as any)._router.stack.find((layer: any) =>
      layer.route?.path === "/api/jobs/:id/apply" && layer.route.methods.post,
    ).route.stack.at(-1).handle;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    decision = "allow";
    transactionDecision = undefined;
    postCommitDecision = undefined;
    committed = false;
    saved.extractedText = null;
    applicationValues = {};
    vi.stubEnv("EMAIL_AUTOMATION_ENABLED", "false");
    vi.stubEnv("NOTIFICATION_AUTOMATION_ENABLED", "false");
    vi.stubEnv("ACTIVEKG_SYNC_ENABLED", "false");
    vi.stubEnv("ACTIVEKG_TENANT_STRATEGY", "org_scoped");
    vi.stubEnv("ACTIVEKG_TENANT_PREFIX", "org");
    vi.stubEnv("FLOW_CANDIDATE_PRIVACY_STALE_MS", "120000");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_REFUSED"); }));
    insert.mockImplementation(() => ({ values: (values: Record<string, unknown>) => {
      applicationValues = values;
      return { returning: async () => [{ ...values, ...recorded }] };
    } }));
    execute.mockResolvedValue({ rows: [{ references: 1, versions: 1, intents: 1 }] });
    transaction.mockImplementation(async (run: (executor: typeof tx) => Promise<unknown>) => {
      if (transactionDecision) decision = transactionDecision;
      const result = await run(tx);
      committed = true;
      if (postCommitDecision) decision = postCommitDecision;
      return result;
    });
    db.insert.mockImplementation(() => {
      expect(committed).toBe(true);
      return { values: queueValues } as never;
    });
    queueValues.mockImplementation((values) => ({
      onConflictDoUpdate: () => ({ returning: async () => [{ id: 201, ...values }] }),
    }));
    eligibility.mockImplementation(async () => {
      if (decision === "unavailable" || decision === "stale") throw new Error("UNAVAILABLE");
      return decision;
    });
    privacyQuery.mockImplementation(async (query: string) => {
      if (decision === "unavailable") throw new Error("UNAVAILABLE");
      if (query.includes("candidate_privacy_sync_state")) return { rows: [{
        status: "healthy", last_success_at: new Date(Date.now() - (decision === "stale" ? 180_000 : 0)),
      }] };
      if (query.includes("candidate_privacy_subject_links")) return { rows: decision === "allow" ? [] : [{
        action: decision === "block_all" ? "request_erasure" : "withdraw_global_matching",
        state: decision === "review" ? "needs_review" : "memory_active", remote_decision: decision,
      }] };
      throw new Error("UNEXPECTED_QUERY");
    });
    upload.mockResolvedValue(saved.gcsPath);
    download.mockResolvedValue(pdf);
    removeObject.mockResolvedValue(undefined);
    extract.mockResolvedValue({ success: false, text: null });
    db.query.candidateResumes.findMany.mockResolvedValue([]);
    vi.mocked(realStorage.updateApplicationSyncSkippedReason).mockResolvedValue(undefined);
  });

  afterAll(() => {
    for (const name of moduleMocks) vi.doUnmock(name);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function invoke(kind: "anonymous" | "bound" | "saved", extra: Record<string, unknown> = {}) {
    let status = 200;
    let body: any;
    let failure: unknown;
    const req = {
      params: { id: "51" },
      body: {
        name: "Synthetic applicant", email: "applicant@example.invalid", phone: "2025550123",
        whatsappConsent: false, ...(kind === "saved" ? { resumeId: "71" } : {}), ...extra,
      },
      ...(kind === "anonymous" ? {} : { user: {
        id: 7, role: "candidate", emailVerified: true, username: "applicant@example.invalid",
        firstName: "Synthetic", lastName: "Applicant",
      } }),
      ...(kind === "saved" ? {} : { file: { buffer: pdf, originalname: "a7.pdf" } }),
    };
    await handler(req, {
      status(value: number) { status = value; return this; },
      json(value: unknown) { body = value; return this; },
    }, (error: unknown) => { failure = error; });
    return { status, body, failure };
  }

  for (const kind of ["anonymous", "bound", "saved"] as const) {
    it.each(["allow", "block_global"] as const)(`${kind} %s reaches the real private writer and evidence CTE`, async (value) => {
      decision = value;
      // The optional global library-save branch may reject block_global and log;
      // it is deliberately not broadened by private application admission.
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await invoke(kind, { admission: "global", globalUse: true });
        expect(result).toMatchObject({ status: 201, body: { success: true, applicationId: 101 }, failure: undefined });
        expect(realStorage.createApplication).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: 41 }), tx, { admission: "organization_private" },
        );
        expect(applicationValues).not.toHaveProperty("admission");
        expect(applicationValues).not.toHaveProperty("globalUse");
        expect(insert).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(db.insert).not.toHaveBeenCalled();
        expect(notification).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } finally { log.mockRestore(); }
    });

    it.each(["block_all", "review", "unavailable", "stale"] as const)(`${kind} %s refuses before bytes or persistence`, async (value) => {
      decision = value;
      const result = await invoke(kind, { admission: "organization_private", globalUse: false });
      expect(result.status === 503 || result.failure !== undefined).toBe(true);
      expect(upload).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(notification).not.toHaveBeenCalled();
    });

    it(`${kind} rechecks restriction at the writer after the preceding private gate`, async () => {
      transactionDecision = "block_all";
      const result = await invoke(kind);
      expect(result).toMatchObject({ status: 503, body: { code: "candidate_privacy_restricted" } });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(insert).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(removeObject).toHaveBeenCalledTimes(kind === "saved" ? 0 : 1);
    });
  }

  for (const bound of [false, true]) {
    it.each(["allow", "block_global", "block_all", "review", "unavailable", "stale"] as const)(
      `non-adopter default global fence (bound=${bound}) keeps %s semantics`, async (value) => {
        decision = value;
        const result = realStorage.createApplication({
          name: "Synthetic", email: "applicant@example.invalid", phone: "", jobId: 51,
          organizationId: 41, resumeUrl: saved.gcsPath, ...(bound ? { userId: 7 } : {}),
        }, tx);
        if (value === "allow") {
          await expect(result).resolves.toMatchObject({ id: 101 });
          expect(insert).toHaveBeenCalledTimes(1);
        } else {
          await expect(result).rejects.toBeInstanceOf(Error);
          expect(insert).not.toHaveBeenCalled();
        }
      },
    );
  }

  function indexingResume(text: string | null = "Synthetic professional experience ".repeat(5)) {
    vi.stubEnv("ACTIVEKG_SYNC_ENABLED", "true");
    saved.extractedText = text;
    extract.mockResolvedValue({ success: text !== null, text });
    // Avoid the separately frozen optional library-save branch; exercise the
    // actual queue upsert rather than a mock of enqueueApplicationGraphSyncJob.
    db.query.candidateResumes.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as never);
  }

  for (const kind of ["anonymous", "bound", "saved"] as const) {
    it.each(["allow", "block_global"] as const)(`A8 ${kind} %s keeps committed success with the real legacy fence`, async (value) => {
      indexingResume(); decision = value;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await invoke(kind);
        expect(result).toMatchObject({ status: 201, body: { success: true, applicationId: 101 }, failure: undefined });
        expect(committed).toBe(true);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(realStorage.enqueueApplicationGraphSyncJob).toHaveBeenCalledExactlyOnceWith({
          applicationId: 101, organizationId: 41, jobId: 51, effectiveRecruiterId: 11, activekgTenantId: "org_41",
        });
        if (value === "allow") {
          expect(db.insert).toHaveBeenCalledExactlyOnceWith(applicationGraphSyncJobs);
          expect(queueValues).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            applicationId: 101, organizationId: 41, jobId: 51, activekgTenantId: "org_41", status: "pending",
          }));
        } else {
          expect(db.insert).not.toHaveBeenCalled();
          expect(queueValues).not.toHaveBeenCalled();
        }
        expect(notification).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
        expect(removeObject).not.toHaveBeenCalled();
      } finally { warn.mockRestore(); error.mockRestore(); }
    });
  }

  it.each(["block_global", "block_all", "review", "unavailable", "stale"] as const)(
    "A8 a post-commit %s refusal prevents the queue write without failing the application", async (value) => {
      indexingResume(); postCommitDecision = value;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        expect(await invoke("anonymous")).toMatchObject({ status: 201, failure: undefined });
        expect(committed).toBe(true); expect(execute).toHaveBeenCalledTimes(1);
        expect(realStorage.enqueueApplicationGraphSyncJob).toHaveBeenCalledTimes(1);
        expect(db.insert).not.toHaveBeenCalled(); expect(removeObject).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } finally { warn.mockRestore(); }
    },
  );

  it("A8 queue failure leaves private evidence committed, returns 201 and never logs the exception message", async () => {
    indexingResume();
    const sentinel = "private-error-sentinel@example.invalid";
    queueValues.mockImplementation(() => { throw new Error(sentinel); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await invoke("anonymous")).toMatchObject({ status: 201, failure: undefined });
      expect(committed).toBe(true); expect(execute).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledExactlyOnceWith(applicationGraphSyncJobs);
      expect(warn).toHaveBeenCalledExactlyOnceWith("[ACTIVEKG_SYNC] Legacy enqueue unavailable (non-blocking)");
      expect(JSON.stringify(warn.mock.calls)).not.toContain(sentinel);
      expect(removeObject).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it.each(["false", "1", ""])("A8 flag %s creates no legacy job", async (flag) => {
    indexingResume(); vi.stubEnv("ACTIVEKG_SYNC_ENABLED", flag);
    expect(await invoke("anonymous")).toMatchObject({ status: 201, failure: undefined });
    expect(realStorage.enqueueApplicationGraphSyncJob).not.toHaveBeenCalled();
    expect(realStorage.updateApplicationSyncSkippedReason).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it.each([null, " ".repeat(60), "x".repeat(49)])("A8 missing/short text records a skip without enqueue", async (text) => {
    indexingResume(text);
    expect(await invoke("anonymous")).toMatchObject({ status: 201, failure: undefined });
    expect(realStorage.enqueueApplicationGraphSyncJob).not.toHaveBeenCalled();
    expect(realStorage.updateApplicationSyncSkippedReason).toHaveBeenCalledExactlyOnceWith(
      101, !text ? "resume_text_missing" : "resume_text_below_threshold",
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("A8 admits the actual frozen worker's 50-character threshold", async () => {
    expect(readFileSync(new URL("../../lib/applicationGraphSyncProcessor.ts", import.meta.url), "utf8"))
      .toContain("export const MIN_RESUME_TEXT_LENGTH = 50;");
    indexingResume("x".repeat(50));
    expect(await invoke("saved")).toMatchObject({ status: 201, failure: undefined });
    expect(queueValues).toHaveBeenCalledTimes(1);
  });

  it("A8 skip-reason failure is non-blocking and logs no exception payload", async () => {
    indexingResume(null);
    vi.mocked(realStorage.updateApplicationSyncSkippedReason).mockRejectedValueOnce(new Error("private skip sentinel"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await invoke("anonymous")).toMatchObject({ status: 201, failure: undefined });
      expect(warn).toHaveBeenCalledExactlyOnceWith("[ACTIVEKG_SYNC] Skip-reason update unavailable (non-blocking)");
      expect(db.insert).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it("A8 a failed private transaction never enqueues legacy work", async () => {
    indexingResume(); execute.mockRejectedValueOnce(new Error("rollback fixture"));
    expect((await invoke("anonymous")).failure).toBeInstanceOf(Error);
    expect(committed).toBe(false);
    expect(realStorage.enqueueApplicationGraphSyncJob).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled(); expect(removeObject).toHaveBeenCalledTimes(1);
  });

  it("unknown remote decisions never become private admission", async () => {
    eligibility.mockResolvedValue("unknown-decision");
    await expect(requireNewIdentity([{ identifier_type: "email", value: "applicant@example.invalid" }],
      { globalUse: false })).rejects.toMatchObject({ code: "candidate_privacy_restricted" });
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, 1.5])("private writer refuses invalid organization %s", async (organizationId) => {
    await expect(realStorage.createApplication({
      name: "Synthetic", email: "applicant@example.invalid", phone: "", jobId: 51,
      resumeUrl: saved.gcsPath, organizationId,
    } as any, tx, { admission: "organization_private" })).rejects.toMatchObject({
      code: "candidate_privacy_restricted",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(eligibility).not.toHaveBeenCalled();
  });
});
