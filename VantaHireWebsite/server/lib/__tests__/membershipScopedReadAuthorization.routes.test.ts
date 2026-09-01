// @vitest-environment node
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  seatOutcome: "allow" as "allow" | "no_org" | "no_seat",
  getUserOrganization: vi.fn(),
  isRecruiterOnJob: vi.fn(),
  getApplicationsByJob: vi.fn(),
  getJob: vi.fn(),
  getPipelineStages: vi.fn(),
  getSeatUsage: vi.fn(),
  getMembersForSeatSelection: vi.fn(),
  readDirectory: vi.fn(),
  getUsers: vi.fn(),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../auth", () => ({
  setupAuth: vi.fn(),
  requireAuth: pass,
  requireVerifiedCandidate: pass,
  requireRole: (roles: string[]) => (req: any, res: any, next: () => void) => {
    if (!roles.includes(req.user?.role)) {
      res.status(403).json({ error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" });
      return;
    }
    next();
  },
  requireSeat: (options?: { allowNoOrg?: boolean }) => {
    const middleware = (req: any, res: any, next: () => void) => {
      if (req.user?.role !== "recruiter") { next(); return; }
      if (mocks.seatOutcome === "no_org") {
        res.status(403).json({ error: "Organization required", code: "NO_ORGANIZATION" });
        return;
      }
      if (mocks.seatOutcome === "no_seat") {
        res.status(403).json({ error: "Seat required", code: "NO_SEAT" });
        return;
      }
      req.organization = { id: 1 };
      req.membership = { seatAssigned: true };
      next();
    };
    Object.assign(middleware, { seatOptions: options });
    return middleware;
  },
}));

vi.mock("../membershipScopedReadAuthorization", () => ({
  parseHiringManagerRoleFilter: (value: unknown) => value === "hiring_manager" ? value : null,
  readAuthorizedHiringManagerDirectory: mocks.readDirectory,
}));

vi.mock("../../storage", () => ({
  storage: {
    isRecruiterOnJob: mocks.isRecruiterOnJob,
    getApplicationsByJob: mocks.getApplicationsByJob,
    getJob: mocks.getJob,
    getPipelineStages: mocks.getPipelineStages,
    getUsers: mocks.getUsers,
  },
}));

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    transaction: vi.fn(), query: {},
  },
}));

vi.mock("../organizationService", () => ({ getUserOrganization: mocks.getUserOrganization }));
vi.mock("../seatService", () => ({
  getSeatUsage: mocks.getSeatUsage,
  getMembersForSeatSelection: mocks.getMembersForSeatSelection,
  reduceSeats: vi.fn(), assignSeat: vi.fn(), unassignSeat: vi.fn(),
}));

vi.mock("../../gcs-storage", () => ({
  upload: { single: () => pass, array: () => pass, none: () => pass, fields: () => pass },
  uploadToGCS: vi.fn(), downloadFromGCS: vi.fn(), downloadBoundApplicationResumeFromGCS: vi.fn(),
}));
vi.mock("../../notificationService", () => ({
  sendStatusUpdateNotification: vi.fn(), sendInterviewInvitationNotification: vi.fn(),
  sendApplicationReceivedNotification: vi.fn(), sendOfferNotification: vi.fn(), sendRejectionNotification: vi.fn(),
}));
vi.mock("../../emailTemplateService", () => ({ notifyRecruitersNewApplication: vi.fn() }));
vi.mock("../resumeExtractor", () => ({ extractResumeText: vi.fn(), validateResumeText: vi.fn() }));
vi.mock("../resumeIngestExtraction", () => ({ extractResumeForOrdinaryIngest: vi.fn() }));
vi.mock("../../aiJobAnalyzer", () => ({ isAIEnabled: vi.fn(() => false), generateCandidateSummary: vi.fn() }));
vi.mock("../aiMatchingEngine", () => ({ calculateAiCost: vi.fn(), checkCircuitBreaker: vi.fn() }));
vi.mock("../profileCompletion", () => ({ syncProfileCompletionStatus: vi.fn() }));
vi.mock("../featureGating", () => ({ FEATURES: {}, requireFeatureAccess: () => pass }));
vi.mock("../creditService", () => ({
  getAiCreditExhaustionPayload: vi.fn(), hasEnoughCredits: vi.fn(), useCredits: vi.fn(),
  getCreditCostForOperation: vi.fn(), getUserDailyRateLimit: vi.fn(), getPlanRateLimitInfo: vi.fn(),
  getMemberCreditBalance: vi.fn(), getOrgCreditDetails: vi.fn(), getOrgCreditLedger: vi.fn(),
  getOrgCreditSummary: vi.fn(), getCreditUsageHistory: vi.fn(), getCurrentOrgCreditCycle: vi.fn(),
  addProratedSeatCredits: vi.fn(),
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
vi.mock("../../candidate-privacy/decision", () => ({
  CandidatePrivacyRestrictedError: class extends Error {},
  requireCandidatePrivacyAllowed: vi.fn(), requireNewCandidateIdentityAllowed: vi.fn(),
}));
vi.mock("../outreachConcurrency", () => ({ lockCandidateOutreach: vi.fn() }));
vi.mock("../outreachComplianceCore", () => ({ verifyOutreachApplicationToken: vi.fn() }));
vi.mock("../pipelineStageUtils", () => ({ normalizeStageName: vi.fn() }));
vi.mock("../pipelineStageSelection", () => ({ pickInitialPipelineStage: vi.fn() }));

vi.mock("../subscriptionService", () => ({
  getActivePlans: vi.fn(), getPlanById: vi.fn(), getOrganizationSubscription: vi.fn(),
  createPaidSubscription: vi.fn(), updateSubscriptionSeats: vi.fn(), cancelSubscriptionAtPeriodEnd: vi.fn(),
  reactivateSubscription: vi.fn(), getSubscriptionInvoices: vi.fn(), calculateProratedAmount: vi.fn(),
  calculateProratedCredits: vi.fn(),
}));
vi.mock("../membershipService", () => ({ canManageBilling: vi.fn() }));
vi.mock("../cashfreeClient", () => ({
  createCheckoutOrder: vi.fn(), createCreditPackCheckout: vi.fn(), createSeatAddCheckout: vi.fn(),
  getBillingTaxConfig: vi.fn(), getOrderStatus: vi.fn(), isCashfreeConfigured: vi.fn(),
}));
vi.mock("../invoiceService", () => ({
  createPaymentTransaction: vi.fn(), updatePaymentTransaction: vi.fn(), getOrganizationInvoices: vi.fn(),
  getTransactionByCashfreeOrder: vi.fn(), generateInvoiceData: vi.fn(),
}));
vi.mock("../invoicePdfService", () => ({
  generateAndStoreInvoicePdf: vi.fn(), getLocalInvoicePath: vi.fn(),
}));
vi.mock("../planConfig", () => ({
  getCommercialCatalog: vi.fn(), getCreditPackConfig: vi.fn(), PLAN_FREE: "free",
}));
vi.mock("../../simpleEmailService", () => ({ getEmailService: vi.fn() }));

vi.mock("../../csrf", () => ({ doubleCsrfProtection: pass, generateToken: vi.fn() }));
vi.mock("../../seoUtils", () => ({ generateJobsSitemapXML: vi.fn() }));
vi.mock("../../monitoring", () => ({ isExpectedDisconnectError: vi.fn(() => false) }));

vi.mock("../../forms.routes", () => ({ registerFormsRoutes: vi.fn() }));
vi.mock("../../testRunner.routes", () => ({ registerTestRunnerRoutes: vi.fn() }));
vi.mock("../../ai.routes", () => ({ registerAIRoutes: vi.fn() }));
vi.mock("../../admin.routes", () => ({ registerAdminRoutes: vi.fn() }));
vi.mock("../../clients.routes", () => ({ registerClientsRoutes: vi.fn() }));
vi.mock("../../jobs.routes", () => ({ registerJobsRoutes: vi.fn() }));
vi.mock("../../bulkResumeImport.routes", () => ({ registerBulkResumeImportRoutes: vi.fn() }));
vi.mock("../../communications.routes", () => ({ registerCommunicationsRoutes: vi.fn() }));
vi.mock("../../whatsapp.routes", () => ({ registerWhatsAppRoutes: vi.fn() }));
vi.mock("../../resume.routes", () => ({ registerResumeRoutes: vi.fn() }));
vi.mock("../../profile.routes", () => ({ registerProfileRoutes: vi.fn() }));
vi.mock("../../talent-pool.routes", () => ({ registerTalentPoolRoutes: vi.fn() }));
vi.mock("../../hiringManagerInvitations.routes", () => ({ registerHiringManagerInvitationRoutes: vi.fn() }));
vi.mock("../../coRecruiterInvitations.routes", () => ({ registerCoRecruiterInvitationRoutes: vi.fn() }));
vi.mock("../../organization.routes", () => ({ registerOrganizationRoutes: vi.fn() }));
vi.mock("../../billing.routes", () => ({ registerBillingRoutes: vi.fn() }));
vi.mock("../../admin-subscription.routes", () => ({ registerAdminSubscriptionRoutes: vi.fn() }));
vi.mock("../../webhooks/cashfree.webhook", () => ({ registerCashfreeWebhook: vi.fn() }));
vi.mock("../../webhooks/signal.webhook", () => ({ registerSignalWebhook: vi.fn() }));
vi.mock("../../webhooks/brevo.webhook", () => ({ registerBrevoWebhook: vi.fn() }));
vi.mock("../../signal.routes", () => ({ registerSignalRoutes: vi.fn() }));
vi.mock("../../coldOutreach.routes", () => ({ registerColdOutreachRoutes: vi.fn() }));
vi.mock("../../candidates.semantic.routes", () => ({ registerCandidateSemanticRoutes: vi.fn() }));
vi.mock("../../recruiterDashboard.routes", () => ({ registerRecruiterDashboardRoutes: vi.fn() }));
vi.mock("../../candidatePortal.routes", () => ({ registerCandidatePortalRoutes: vi.fn() }));
vi.mock("../../outreachCompliance.routes", () => ({ registerOutreachComplianceRoutes: vi.fn() }));
vi.mock("../../candidate-privacy/routes", () => ({ registerCandidatePrivacyRoutes: vi.fn() }));

type Result = { status: number; body: any };

function actor(role: "recruiter" | "candidate" | "hiring_manager" | "super_admin" = "recruiter") {
  return { id: 101, role, username: "actor@example.invalid", emailVerified: true };
}

async function buildApp(): Promise<express.Express> {
  const { registerRoutes } = await import("../../routes");
  const app = express();
  await registerRoutes(app);
  return app;
}

async function invoke(
  app: express.Express,
  path: string,
  options: { id?: string; role?: ReturnType<typeof actor>["role"]; query?: Record<string, unknown> } = {},
): Promise<Result> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.get,
  );
  if (!layer) throw new Error(`route not found: GET ${path}`);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: "GET", params: { id: options.id }, query: options.query ?? {},
    body: {}, user: actor(options.role), headers: {}, ip: "127.0.0.1", app: { get: () => false },
  };
  return new Promise((resolve, reject) => {
    const events = new EventEmitter();
    let settled = false;
    const finish = (body: unknown, status: number) => {
      if (settled) return;
      settled = true;
      events.emit("finish");
      resolve({ status, body });
    };
    const res: any = {
      statusCode: 200,
      once: events.once.bind(events),
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { finish(payload, this.statusCode); return this; },
      send(payload: unknown) { finish(payload, this.statusCode); return this; },
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
  mocks.seatOutcome = "allow";
  mocks.getUserOrganization.mockResolvedValue({ organization: { id: 1 }, membership: { seatAssigned: true } });
  mocks.isRecruiterOnJob.mockResolvedValue(true);
  mocks.getApplicationsByJob.mockResolvedValue([]);
  mocks.getJob.mockResolvedValue({ id: 1001, organizationId: 1 });
  mocks.getPipelineStages.mockResolvedValue([]);
  mocks.getSeatUsage.mockResolvedValue({ totalSeats: 1, assignedSeats: 1, availableSeats: 0 });
  mocks.getMembersForSeatSelection.mockResolvedValue([]);
  mocks.readDirectory.mockResolvedValue({ ok: true, rows: [] });
});

describe("membership-scoped read route admission", () => {
  it.each([
    ["no_org", "NO_ORGANIZATION"],
    ["no_seat", "NO_SEAT"],
  ] as const)("denies job-application %s before organization, assignment or application reads", async (outcome, code) => {
    mocks.seatOutcome = outcome;
    const result = await invoke(await buildApp(), "/api/jobs/:id/applications", { id: "1001" });
    expect(result).toMatchObject({ status: 403, body: { code } });
    expect(mocks.getUserOrganization).not.toHaveBeenCalled();
    expect(mocks.isRecruiterOnJob).not.toHaveBeenCalled();
    expect(mocks.getApplicationsByJob).not.toHaveBeenCalled();
  });

  it.each([
    ["no_org", "NO_ORGANIZATION"],
    ["no_seat", "NO_SEAT"],
  ] as const)("denies seat roster %s before organization and roster reads", async (outcome, code) => {
    mocks.seatOutcome = outcome;
    const result = await invoke(await buildApp(), "/api/subscription/seats/usage");
    expect(result).toMatchObject({ status: 403, body: { code } });
    expect(mocks.getUserOrganization).not.toHaveBeenCalled();
    expect(mocks.getSeatUsage).not.toHaveBeenCalled();
    expect(mocks.getMembersForSeatSelection).not.toHaveBeenCalled();
  });

  it("keeps seat roster recruiter-only before any roster read", async () => {
    const result = await invoke(await buildApp(), "/api/subscription/seats/usage", { role: "candidate" });
    expect(result).toMatchObject({ status: 403, body: { code: "INSUFFICIENT_PERMISSIONS" } });
    expect(mocks.getUserOrganization).not.toHaveBeenCalled();
    expect(mocks.getSeatUsage).not.toHaveBeenCalled();
  });

  it("preserves the seated recruiter seat-roster response", async () => {
    const result = await invoke(await buildApp(), "/api/subscription/seats/usage");
    expect(result).toEqual({ status: 200, body: {
      totalSeats: 1, assignedSeats: 1, availableSeats: 0, members: [],
    } });
    expect(mocks.getSeatUsage).toHaveBeenCalledWith(1);
    expect(mocks.getMembersForSeatSelection).toHaveBeenCalledWith(1);
  });

  it.each([undefined, "", "recruiter", ["hiring_manager"]])(
    "rejects user-directory filter %s before any identity read",
    async (role) => {
      const result = await invoke(await buildApp(), "/api/users", { query: role === undefined ? {} : { role } });
      expect(result).toMatchObject({ status: 400, body: { code: "ROLE_FILTER_REQUIRED" } });
      expect(mocks.readDirectory).not.toHaveBeenCalled();
      expect(mocks.getUsers).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["no_org", "NO_ORGANIZATION"],
    ["no_seat", "NO_SEAT"],
  ] as const)("denies user directory %s before the statement-bound reader", async (outcome, code) => {
    mocks.seatOutcome = outcome;
    const result = await invoke(await buildApp(), "/api/users", { query: { role: "hiring_manager" } });
    expect(result).toMatchObject({ status: 403, body: { code } });
    expect(mocks.readDirectory).not.toHaveBeenCalled();
    expect(mocks.getUsers).not.toHaveBeenCalled();
  });

  it("returns only the statement-bound minimum projection", async () => {
    const rows = [{ id: 302, username: "hm@example.invalid", firstName: "Test", lastName: "Manager", role: "hiring_manager" }];
    mocks.readDirectory.mockResolvedValueOnce({ ok: true, rows });
    const result = await invoke(await buildApp(), "/api/users", { query: { role: "hiring_manager" } });
    expect(result).toEqual({ status: 200, body: rows });
    expect(mocks.readDirectory).toHaveBeenCalledWith(101, { allowPlatformAdmin: true });
    expect(mocks.getUsers).not.toHaveBeenCalled();
  });

  it("preserves an accepted-user provenance denial as an authorized empty directory", async () => {
    mocks.readDirectory.mockResolvedValueOnce({ ok: true, rows: [] });
    const result = await invoke(await buildApp(), "/api/users", { query: { role: "hiring_manager" } });
    expect(result).toEqual({ status: 200, body: [] });
    expect(mocks.readDirectory).toHaveBeenCalledTimes(1);
    expect(mocks.getUsers).not.toHaveBeenCalled();
  });

  it("maps a reader failure to a fixed 503 without a fallback directory read", async () => {
    mocks.readDirectory.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    const result = await invoke(await buildApp(), "/api/users", { query: { role: "hiring_manager" } });
    expect(result).toMatchObject({ status: 503, body: { code: "USER_DIRECTORY_UNAVAILABLE" } });
    expect(mocks.getUsers).not.toHaveBeenCalled();
  });

  it("preserves deliberate super-admin access through the seat bypass and minimum reader", async () => {
    const result = await invoke(await buildApp(), "/api/users", {
      role: "super_admin", query: { role: "hiring_manager" },
    });
    expect(result.status).toBe(200);
    expect(mocks.readDirectory).toHaveBeenCalledWith(101, { allowPlatformAdmin: true });
    expect(mocks.getUsers).not.toHaveBeenCalled();
  });
});
