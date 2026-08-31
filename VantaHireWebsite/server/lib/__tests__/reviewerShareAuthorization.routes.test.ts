// @vitest-environment node
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertClientShortlistSchema } from "@shared/schema";

const mocks = vi.hoisted(() => ({
  publicShortlist: vi.fn(),
  publicResume: vi.fn(),
  feedbackTarget: vi.fn(),
  clientFeedback: vi.fn(),
  issuer: vi.fn(),
  replaceInvitation: vi.fn(),
  listInvitations: vi.fn(),
  cancelInvitation: vi.fn(),
  getUserByUsername: vi.fn(),
  addClientFeedback: vi.fn(),
  emailService: vi.fn(),
  sendEmail: vi.fn(),
  download: vi.fn(),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../auth", () => ({
  requireAuth: pass,
  requireRole: () => pass,
  requireSeat: () => pass,
}));
vi.mock("../reviewerShareAuthorization", async () => {
  const actual = await vi.importActual<typeof import("../reviewerShareAuthorization")>("../reviewerShareAuthorization");
  return {
    ...actual,
    readPublicClientShortlist: mocks.publicShortlist,
    readPublicResumeLocator: mocks.publicResume,
    resolvePublicFeedbackTarget: mocks.feedbackTarget,
    readAuthorizedClientFeedback: mocks.clientFeedback,
    resolveInvitationIssuerScope: mocks.issuer,
    replaceAuthorizedHiringManagerInvitation: mocks.replaceInvitation,
    listAuthorizedHiringManagerInvitations: mocks.listInvitations,
    cancelAuthorizedHiringManagerInvitation: mocks.cancelInvitation,
  };
});
vi.mock("../../storage", () => ({ storage: {
  getUserByUsername: mocks.getUserByUsername,
  addClientFeedback: mocks.addClientFeedback,
  getClient: vi.fn(), getJob: vi.fn(), createClientShortlist: vi.fn(),
  getClients: vi.fn(), createClient: vi.fn(), updateClient: vi.fn(),
  isRecruiterOnJob: vi.fn(), getClientShortlistsByJob: vi.fn(),
  getClientFeedbackAnalytics: vi.fn(), getHiringManagerInvitationByToken: vi.fn(),
  invalidateHiringManagerInvitation: vi.fn(),
} }));
vi.mock("../../db", () => ({ db: {
  execute: vi.fn(), select: vi.fn(() => ({ from: vi.fn() })),
} }));
vi.mock("../organizationService", () => ({ getUserOrganization: vi.fn() }));
vi.mock("../membershipService", () => ({ updateMemberActivity: vi.fn() }));
vi.mock("../../simpleEmailService", () => ({ getEmailService: mocks.emailService }));
vi.mock("../../gcs-storage", () => ({ downloadFromGCS: mocks.download }));

type Result = { status: number; body?: any; redirect?: string };

async function buildApp(): Promise<express.Express> {
  const [{ registerClientsRoutes }, { registerHiringManagerInvitationRoutes }] = await Promise.all([
    import("../../clients.routes"),
    import("../../hiringManagerInvitations.routes"),
  ]);
  const app = express();
  app.use(express.json());
  registerClientsRoutes(app, pass as any);
  registerHiringManagerInvitationRoutes(app, pass as any);
  return app;
}

async function invokeLast(
  app: express.Express,
  method: "get" | "post" | "delete",
  path: string,
  input: { params?: Record<string, string>; body?: unknown; user?: Record<string, unknown> } = {},
): Promise<Result> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const handler = layer.route.stack.at(-1)?.handle;
  const req: any = {
    params: input.params ?? {}, body: input.body ?? {}, query: {},
    user: input.user ?? { id: 101, role: "recruiter" },
    protocol: "https", get: () => "example.invalid", ip: "127.0.0.1",
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { if (!settled) { settled = true; resolve({ status: this.statusCode, body }); } return this; },
      send(body: unknown) { if (!settled) { settled = true; resolve({ status: this.statusCode, body }); } return this; },
      setHeader: vi.fn(),
      redirect(code: number, target: string) { if (!settled) { settled = true; resolve({ status: code, redirect: target }); } },
    };
    Promise.resolve(handler(req, res, (error?: unknown) => error ? reject(error) : reject(new Error("unexpected next"))))
      .catch(reject);
  });
}

const token = "a".repeat(64);
const candidateRef = "123e4567-e89b-42d3-a456-426614174000";
const issuer = {
  actorId: 101, actorRole: "recruiter", organizationId: 1,
  authorityScope: "organization", inviterName: "Fixture Recruiter",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emailService.mockResolvedValue({ sendEmail: mocks.sendEmail });
  mocks.sendEmail.mockResolvedValue(true);
  mocks.getUserByUsername.mockResolvedValue(null);
});

describe("2I public shortlist and feedback route contracts", () => {
  it("requires both explicit share decisions at creation", () => {
    expect(insertClientShortlistSchema.safeParse({ clientId: 1, jobId: 1, applicationIds: [1] }).success).toBe(false);
    expect(insertClientShortlistSchema.safeParse({
      clientId: 1, jobId: 1, applicationIds: [1], shareResume: false, shareAiSummary: false,
    }).success).toBe(true);
  });

  it("returns only the bounded public projection supplied by the statement-bound reader", async () => {
    const projection = {
      title: "Review", message: null, client: { name: "Client" },
      job: { title: "Role", location: "Remote", type: "full_time" },
      candidates: [{ candidateRef, name: "Synthetic", position: 1, resumeAvailable: false, aiSummary: null, aiFitLabel: null }],
      createdAt: "2026-08-31T12:00:00.000Z", expiresAt: null,
    };
    mocks.publicShortlist.mockResolvedValue({ ok: true, value: projection });
    await expect(invokeLast(await buildApp(), "get", "/api/client-shortlist/:token", { params: { token } }))
      .resolves.toEqual({ status: 200, body: projection });
    expect(mocks.publicShortlist).toHaveBeenCalledWith(token, true, true);
  });

  it("rejects raw application ids and malformed UUIDs before database/provider work", async () => {
    const result = await invokeLast(await buildApp(), "post", "/api/client-shortlist/:token/feedback", {
      params: { token }, body: { applicationId: 2001, recommendation: "advance" },
    });
    expect(result.status).toBe(400);
    expect(mocks.feedbackTarget).not.toHaveBeenCalled();
    expect(mocks.addClientFeedback).not.toHaveBeenCalled();
  });

  it("resolves opaque feedback targets and never accepts caller authority fields", async () => {
    mocks.feedbackTarget.mockResolvedValue({ ok: true, value: {
      applicationId: 2001, clientId: 7, shortlistId: 8, organizationId: 1,
    } });
    mocks.addClientFeedback.mockResolvedValue({ id: 9 });
    const result = await invokeLast(await buildApp(), "post", "/api/client-shortlist/:token/feedback", {
      params: { token }, body: { candidateRef, recommendation: "advance" },
    });
    expect(result).toMatchObject({ status: 201, body: { success: true, count: 1 } });
    expect(mocks.addClientFeedback).toHaveBeenCalledWith({
      applicationId: 2001, recommendation: "advance", clientId: 7, shortlistId: 8, organizationId: 1,
    });
  });

  it("does no GCS work when the authorized resume command denies", async () => {
    mocks.publicResume.mockResolvedValue({ ok: false, reason: "not_found" });
    await expect(invokeLast(await buildApp(), "get", "/api/client-shortlist/:token/resume/:candidateRef", {
      params: { token, candidateRef },
    })).resolves.toEqual({ status: 404, body: { error: "RESUME_NOT_FOUND" } });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("maps authorized client-feedback empty and denial without global storage reads", async () => {
    mocks.clientFeedback.mockResolvedValueOnce({ ok: true, rows: [] });
    await expect(invokeLast(await buildApp(), "get", "/api/applications/:id/client-feedback", {
      params: { id: "2001" },
    })).resolves.toEqual({ status: 200, body: [] });
    mocks.clientFeedback.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invokeLast(await buildApp(), "get", "/api/applications/:id/client-feedback", {
      params: { id: "2001" },
    })).resolves.toEqual({ status: 404, body: { error: "APPLICATION_NOT_FOUND" } });
  });
});

describe("2I hiring-manager management route order", () => {
  it("authorizes issuer scope before user lookup or provider work", async () => {
    mocks.issuer.mockResolvedValue({ ok: false, reason: "not_found" });
    await expect(invokeLast(await buildApp(), "post", "/api/hiring-manager-invitations", {
      body: { email: "hm@example.invalid", name: "HM" },
    })).resolves.toEqual({ status: 404, body: { error: "INVITATION_NOT_FOUND" } });
    expect(mocks.getUserByUsername).not.toHaveBeenCalled();
    expect(mocks.emailService).not.toHaveBeenCalled();
  });

  it("sends only after the atomic replacement command succeeds", async () => {
    mocks.issuer.mockResolvedValue({ ok: true, value: issuer });
    mocks.replaceInvitation.mockResolvedValue({ ok: true, value: {
      id: 7, email: "hm@example.invalid", name: "HM", status: "pending",
      expiresAt: "2026-09-07T12:00:00.000Z", createdAt: "2026-08-31T12:00:00.000Z",
    } });
    await expect(invokeLast(await buildApp(), "post", "/api/hiring-manager-invitations", {
      body: { email: "hm@example.invalid", name: "HM" },
    })).resolves.toMatchObject({ status: 201, body: { success: true } });
    expect(mocks.replaceInvitation.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendEmail.mock.invocationCallOrder[0]!);
  });

  it("keeps provider work at zero when replacement authorization is lost", async () => {
    mocks.issuer.mockResolvedValue({ ok: true, value: issuer });
    mocks.replaceInvitation.mockResolvedValue({ ok: false, reason: "not_found" });
    await expect(invokeLast(await buildApp(), "post", "/api/hiring-manager-invitations", {
      body: { email: "hm@example.invalid" },
    })).resolves.toEqual({ status: 404, body: { error: "INVITATION_NOT_FOUND" } });
    expect(mocks.emailService).not.toHaveBeenCalled();
  });

  it("uses scoped list and cancel commands with strict ids", async () => {
    mocks.issuer.mockResolvedValue({ ok: true, value: issuer });
    mocks.listInvitations.mockResolvedValue({ ok: true, rows: [] });
    await expect(invokeLast(await buildApp(), "get", "/api/hiring-manager-invitations"))
      .resolves.toEqual({ status: 200, body: [] });
    const malformed = await invokeLast(await buildApp(), "delete", "/api/hiring-manager-invitations/:id", {
      params: { id: "01" },
    });
    expect(malformed).toEqual({ status: 400, body: { error: "INVALID_INVITATION_ID" } });
    expect(mocks.cancelInvitation).not.toHaveBeenCalled();
  });
});

describe("2I source adoption and client contract", () => {
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const formsSource = readFileSync(join(appRoot, "server/forms.routes.ts"), "utf8");
  const clientsSource = readFileSync(join(appRoot, "server/clients.routes.ts"), "utf8");
  const publicPage = readFileSync(join(appRoot, "client/src/pages/client-shortlist-page.tsx"), "utf8");
  const formsPage = readFileSync(join(appRoot, "client/src/pages/admin-forms-page.tsx"), "utf8");

  it("removes route-owned target global reads and id-only writes", () => {
    expect(formsSource).not.toMatch(/storage\.(getFormTemplate|getFormResponses|updateFormTemplate|deleteFormTemplate)\s*\(/);
    expect(clientsSource).not.toMatch(/storage\.getClientFeedbackForApplication\s*\(/);
    expect(clientsSource).toContain("readAuthorizedClientFeedback");
  });

  it("uses opaque string keys and omits contact/internal panels", () => {
    expect(publicPage).toContain("candidateRef: string");
    expect(publicPage).toContain("Record<string, CandidateFeedbackState>");
    expect(publicPage).toContain("candidate.resumeAvailable");
    expect(publicPage).toContain("candidateRef,");
    for (const forbidden of ["candidate.email", "candidate.phone", "candidate.notes", "candidate.coverLetter", "candidate.appliedAt", "candidate.resumeUrl"]) {
      expect(publicPage).not.toContain(forbidden);
    }
  });

  it("uses server-derived form manage authority and default-off share controls", () => {
    expect(formsPage).toContain("return template.canManage");
    expect(formsPage).not.toContain("user?.role === 'super_admin' || template.createdBy === user?.id");
    const managementPage = readFileSync(join(appRoot, "client/src/pages/application-management-page.tsx"), "utf8");
    expect(managementPage).toContain("useState(false)");
    expect(managementPage).toContain("shareResume: shareShortlistResumes");
    expect(managementPage).toContain("shareAiSummary: shareShortlistAiSummaries");
  });
});
