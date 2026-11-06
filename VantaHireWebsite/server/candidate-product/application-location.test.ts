import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { readApplicationLocation } from './application-location';

const NOW = new Date('2026-11-03T10:15:30.123Z');
const ok = { locationCity: ' Bengaluru ', locationCountryCode: 'IN', willingToRelocate: 'true' };

describe('application location intake (P4)', () => {
  it('builds the candidate-confirmed envelope with the server time, trimmed, relocation kept separate', () => {
    expect(readApplicationLocation(ok, NOW, true)).toEqual({ kind: 'ok', facts: {
      candidateLocation: { version: 2, provenance: 'candidate_confirmed', city: 'Bengaluru', countryCode: 'IN', confirmedAt: '2026-11-03T10:15:30.123Z' },
      willingToRelocate: true } });
    expect(readApplicationLocation({ ...ok, willingToRelocate: 'false' }, NOW, true)).toMatchObject({ kind: 'ok', facts: { willingToRelocate: false } });
  });

  it('never takes the confirmation time or provenance from the request', () => {
    const r = readApplicationLocation({ ...ok, confirmedAt: '2001-01-01T00:00:00.000Z', provenance: 'resume', version: 1 }, NOW, true);
    expect(r).toMatchObject({ kind: 'ok', facts: { candidateLocation: { confirmedAt: NOW.toISOString(), provenance: 'candidate_confirmed', version: 2 } } });
  });

  it('while not required, nothing sent is fine; anything partial is refused', () => {
    expect(readApplicationLocation({}, NOW, false)).toEqual({ kind: 'ok', facts: null });
    expect(readApplicationLocation({ locationCity: 'Pune' }, NOW, false)).toEqual({ kind: 'invalid', fields: ['location_country_invalid', 'relocation_required'] });
  });

  it('when required, all three are needed', () => {
    expect(readApplicationLocation({}, NOW, true)).toEqual({ kind: 'invalid', fields: ['location_city_required', 'location_country_invalid', 'relocation_required'] });
  });

  it.each([
    [{ ...ok, locationCity: '   ' }, ['location_city_required']],
    [{ ...ok, locationCity: 'x'.repeat(201) }, ['location_city_required']],
    [{ ...ok, locationCity: ['Pune', 'Delhi'] }, ['location_city_required']],
    [{ ...ok, locationCountryCode: 'XX' }, ['location_country_invalid']],
    [{ ...ok, locationCountryCode: 'in' }, ['location_country_invalid']],
    [{ ...ok, willingToRelocate: 'yes' }, ['relocation_required']],
    [{ ...ok, willingToRelocate: ['true'] }, ['relocation_required']],
  ])('refuses malformed input %#', (body, fields) => {
    expect(readApplicationLocation(body, NOW, true)).toEqual({ kind: 'invalid', fields });
  });
});

// The real registered apply handler and real writer; only DB transport and external effects are
// replaced (harness adapted from organization-candidates/__tests__/public-apply.routes.test.ts).
describe("P4 public apply records the candidate's location", () => {
  type Decision = "allow" | "block_global" | "block_all" | "review" | "unavailable" | "stale";
  let decision: Decision;
  let transactionDecision: Decision | undefined;
  let postCommitDecision: Decision | undefined;
  let managed: boolean | Error;
  let committed: boolean;
  let applicationValues: Record<string, unknown>;
  let realStorage: typeof import("../storage")["storage"];
  let applicationGraphSyncJobs: typeof import("@shared/schema")["applicationGraphSyncJobs"];
  let requireNewIdentity: typeof import("../candidate-privacy/decision")["requireNewCandidateIdentityAllowed"];
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
    "../db", "../candidate-privacy/memory-client", "../auth", "../gcs-storage",
    "../notificationService", "../emailTemplateService", "../lib/organizationService",
    "../lib/featureGating", "../lib/resumeExtractor", "../lib/resumeIngestExtraction",
    "../aiJobAnalyzer", "../lib/aiMatchingEngine", "../lib/profileCompletion",
    "../lib/creditService", "../rateLimit", "../lib/aiQueue", "../lib/activekgTenant",
    "../lib/applicationGraphSyncProcessor",
  ];

  beforeAll(async () => {
    // This file is also imported by the frozen server-suite entrypoint, whose
    // processor tests mock intake. Clear that mock explicitly for this proof.
    vi.resetModules();
    vi.doUnmock("../organization-candidates/application-intake");
    vi.doUnmock("../candidate-privacy/decision");
    vi.doUnmock("../candidate-privacy/repository");
    vi.doUnmock("../storage");
    vi.doMock("../db", () => ({ db, pool: { query: privacyQuery } }));
    vi.doMock("../candidate-privacy/memory-client", () => ({ checkMemoryEligibility: eligibility }));
    vi.doMock("../auth", () => ({
      requireAuth: pass, requireVerifiedCandidate: pass, requireRole: () => pass, requireSeat: () => pass,
    }));
    vi.doMock("../gcs-storage", () => ({
      uploadToGCS: upload, downloadFromGCS: download, deleteFromGCS: removeObject,
      downloadBoundApplicationResumeFromGCS: vi.fn(),
    }));
    vi.doMock("../notificationService", () => ({
      sendStatusUpdateNotification: notification, sendInterviewInvitationNotification: notification,
      sendApplicationReceivedNotification: notification, sendOfferNotification: notification,
      sendRejectionNotification: notification,
    }));
    vi.doMock("../emailTemplateService", () => ({ notifyRecruitersNewApplication: notification }));
    vi.doMock("../lib/organizationService", () => ({ getUserOrganization: vi.fn() }));
    vi.doMock("../lib/featureGating", () => ({ FEATURES: {}, requireFeatureAccess: () => pass }));
    vi.doMock("../lib/resumeExtractor", () => ({ extractResumeText: vi.fn(), validateResumeText: vi.fn() }));
    vi.doMock("../lib/resumeIngestExtraction", () => ({ extractResumeForOrdinaryIngest: extract }));
    vi.doMock("../aiJobAnalyzer", () => ({ isAIEnabled: () => false, generateCandidateSummary: vi.fn() }));
    vi.doMock("../lib/aiMatchingEngine", () => ({ calculateAiCost: vi.fn(), checkCircuitBreaker: vi.fn() }));
    vi.doMock("../lib/profileCompletion", () => ({ syncProfileCompletionStatus: vi.fn() }));
    vi.doMock("../lib/creditService", () => ({
      getAiCreditExhaustionPayload: vi.fn(), hasEnoughCredits: vi.fn(), useCredits: vi.fn(),
      getCreditCostForOperation: vi.fn(), getUserDailyRateLimit: vi.fn(), getPlanRateLimitInfo: vi.fn(),
    }));
    vi.doMock("../rateLimit", () => ({
      applicationRateLimit: pass, recruiterAddRateLimit: pass, aiAnalysisRateLimit: pass,
    }));
    vi.doMock("../lib/aiQueue", () => ({
      isQueueAvailable: vi.fn(), enqueueSummaryBatch: vi.fn(), removeJob: vi.fn(), QUEUES: {},
    }));
    vi.doUnmock("../lib/activekgTenant");
    vi.doMock("../lib/applicationGraphSyncProcessor", () => ({ MIN_RESUME_TEXT_LENGTH: 50 }));
    applicationGraphSyncJobs = (await import("@shared/schema")).applicationGraphSyncJobs;
    realStorage = (await import("../storage")).storage;
    requireNewIdentity = (await import("../candidate-privacy/decision")).requireNewCandidateIdentityAllowed;
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
    const { registerApplicationsRoutes } = await import("../applications.routes");
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
    managed = true;
    saved.extractedText = null;
    applicationValues = {};
    vi.stubEnv("EMAIL_AUTOMATION_ENABLED", "false");
    vi.stubEnv("NOTIFICATION_AUTOMATION_ENABLED", "false");
    vi.stubEnv("ACTIVEKG_SYNC_ENABLED", "false");
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", undefined);
    vi.stubEnv("ACTIVEKG_TENANT_STRATEGY", "org_scoped");
    vi.stubEnv("ACTIVEKG_TENANT_PREFIX", "org");
    vi.stubEnv("FLOW_CANDIDATE_PRIVACY_STALE_MS", "120000");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_REFUSED"); }));
    insert.mockImplementation(() => ({ values: (values: Record<string, unknown>) => {
      applicationValues = values;
      return { returning: async () => [{ ...values, ...recorded }] };
    } }));
    execute.mockResolvedValue({ rows: [{ references: 1, versions: 1, intents: 1, index_intents: 1 }] });
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
      if (query.includes("flow_candidate_index_managed_application")) {
        expect(committed).toBe(true);
        if (managed instanceof Error) throw managed;
        return { rows: [{ managed }] };
      }
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

  const LOC = { locationCity: "Bengaluru", locationCountryCode: "IN", willingToRelocate: "false" };
  for (const kind of ["anonymous", "bound"] as const) {
    it(`${kind}: stores the confirmed envelope and relocation on the application, nowhere else`, async () => {
      const before = Date.now();
      const r = await invoke(kind, LOC);
      expect(r).toMatchObject({ status: 201, failure: undefined });
      expect(applicationValues.candidateLocation).toMatchObject({ version: 2, provenance: "candidate_confirmed", city: "Bengaluru", countryCode: "IN" });
      const at = Date.parse((applicationValues.candidateLocation as any).confirmedAt);
      expect(at).toBeGreaterThanOrEqual(before - 1); expect(at).toBeLessThanOrEqual(Date.now());
      expect(applicationValues.willingToRelocate).toBe(false);
      expect(applicationValues).not.toHaveProperty("locationCity");
      expect(applicationValues).not.toHaveProperty("locationCountryCode");
    });
  }

  it("bad location input is refused before any upload, privacy call, transaction or write", async () => {
    const r = await invoke("anonymous", { ...LOC, locationCountryCode: "XX" });
    expect(r).toMatchObject({ status: 400, body: { code: "invalid_application_location", fields: ["location_country_invalid"] } });
    expect(upload).not.toHaveBeenCalled(); expect(eligibility).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });

  it("required switch on: an application without location is refused; off: it is stored without one", async () => {
    vi.stubEnv("APPLICATION_LOCATION_REQUIRED", "true");
    expect(await invoke("anonymous")).toMatchObject({ status: 400, body: { fields: ["location_city_required", "location_country_invalid", "relocation_required"] } });
    expect(insert).not.toHaveBeenCalled();
    vi.stubEnv("APPLICATION_LOCATION_REQUIRED", "false");
    expect(await invoke("anonymous")).toMatchObject({ status: 201 });
    expect(applicationValues).not.toHaveProperty("candidateLocation");
    expect(applicationValues).not.toHaveProperty("willingToRelocate");
  });

  it("a duplicate application changes nothing: the first recorded facts stay", async () => {
    vi.mocked(realStorage.findApplicationByJobAndEmail).mockResolvedValueOnce({ id: 9, email: "applicant@example.invalid", appliedAt: new Date() } as any);
    const r = await invoke("anonymous", { ...LOC, locationCity: "Pune" });
    expect(r.status).toBe(400); expect(r.body).toMatchObject({ error: "Duplicate application" });
    expect(realStorage.createApplication).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
});

describe("P4 route shape", () => {
  const source = readFileSync(new URL("../applications.routes.ts", import.meta.url), "utf8");
  const route = source.slice(source.indexOf('app.post("/api/jobs/:id/apply"'), source.indexOf("// Recruiter adds candidate on behalf"));
  it("reads location before the privacy gate, any upload and the writer; never via insertApplicationSchema", () => {
    const at = route.indexOf("readApplicationLocation(req.body, new Date())");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(route.indexOf("requireApplicationIngestAllowed("));
    expect(at).toBeLessThan(route.indexOf("uploadToGCS("));
    expect(at).toBeLessThan(route.indexOf("storage.createApplication({"));
    const parse = route.slice(route.indexOf("insertApplicationSchema.parse({"), route.indexOf("});", route.indexOf("insertApplicationSchema.parse({")));
    expect(parse).not.toMatch(/location|relocat/i);
  });
});
