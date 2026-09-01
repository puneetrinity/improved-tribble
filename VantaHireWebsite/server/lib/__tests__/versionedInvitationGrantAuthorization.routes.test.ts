// @vitest-environment node
import { readFileSync } from "node:fs";
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  cancel: vi.fn(),
  accept: vi.fn(),
  emailService: vi.fn(),
  sendEmail: vi.fn(),
  initializeCredits: vi.fn(),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../auth", () => ({ requireAuth: pass, requireRole: () => pass }));
vi.mock("../organizationService", () => {
  class OrganizationSelfServiceGrantDeniedError extends Error {}
  return {
    OrganizationSelfServiceGrantDeniedError,
    createOrganization: vi.fn(), getOrganization: vi.fn(), updateOrganization: vi.fn(), deleteOrganization: vi.fn(),
    getUserOrganization: vi.fn(), isUserInOrganization: vi.fn(), createJoinRequest: vi.fn(),
    getPendingJoinRequests: vi.fn(), respondToJoinRequest: vi.fn(), createDomainClaimRequest: vi.fn(),
    findOrganizationByUserEmailDomain: vi.fn(), isPublicEmailDomain: vi.fn(), getEmailDomain: vi.fn(),
  };
});
vi.mock("../membershipService", () => ({
  getOrganizationMembers: vi.fn(), getMemberById: vi.fn(), leaveOrganization: vi.fn(),
  canManageMembers: vi.fn(), canManageBilling: vi.fn(), getUserJobsInOrg: vi.fn(),
}));
vi.mock("../privilegeGrantRevocation", () => ({
  parsePrivilegeGrantId: vi.fn(), removeOrganizationMemberAndRevoke: vi.fn(),
  changeOrganizationMemberRoleAndRevoke: vi.fn(), reassignOrganizationJobs: vi.fn(),
}));
vi.mock("../versionedInvitationGrantAuthorization", () => ({
  parseVersionedInvitationId: (value: unknown) => value === "51" ? 51 : null,
  parseVersionedInvitationToken: (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null,
  hashVersionedInvitationToken: (value: string) => /^[0-9a-f]{64}$/.test(value) ? "b".repeat(64) : null,
  createOrResendOrganizationInvite: mocks.create,
  listOrganizationInvites: mocks.list,
  readOrganizationInvitePreview: mocks.preview,
  cancelOrganizationInvite: mocks.cancel,
  acceptOrganizationInvite: mocks.accept,
}));
vi.mock("../subscriptionService", () => ({ createFreeSubscription: vi.fn() }));
vi.mock("../seatService", () => ({ hasAvailableSeats: vi.fn() }));
vi.mock("../creditService", () => ({ initializeMemberCredits: mocks.initializeCredits }));
vi.mock("../../simpleEmailService", () => ({ getEmailService: mocks.emailService }));

type Method = "get" | "post" | "delete";
const token = "a".repeat(64);

async function buildApp(): Promise<express.Express> {
  const { registerOrganizationRoutes } = await import("../../organization.routes");
  const app = express();
  app.use(express.json());
  registerOrganizationRoutes(app, pass);
  return app;
}

async function invoke(
  app: express.Express,
  method: Method,
  path: string,
  input: { id?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(),
    params: { id: input.id, token: input.token },
    body: input.body ?? {},
    user: { id: 10, role: "recruiter", emailVerified: true, authVersion: 1 },
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
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.emailService.mockResolvedValue({ sendEmail: mocks.sendEmail });
  mocks.sendEmail.mockResolvedValue(true);
  mocks.initializeCredits.mockResolvedValue(undefined);
});

describe("2L-B organization invitation routes", () => {
  it("rejects malformed ids and tokens before authorization or provider work", async () => {
    const app = await buildApp();
    await expect(invoke(app, "delete", "/api/organizations/invites/:id", { id: "51junk" }))
      .resolves.toMatchObject({ status: 400, body: { code: "INVALID_INVITATION_ID" } });
    await expect(invoke(app, "get", "/api/invites/:token", { token: "BAD" }))
      .resolves.toMatchObject({ status: 400, body: { code: "INVALID_INVITATION_TOKEN" } });
    await expect(invoke(app, "post", "/api/invites/:token/accept", { token: ` ${token}` }))
      .resolves.toMatchObject({ status: 400, body: { code: "INVALID_INVITATION_TOKEN" } });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.emailService).not.toHaveBeenCalled();
  });

  it("does zero email work when create authorization is denied", async () => {
    const app = await buildApp();
    mocks.create.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    await expect(invoke(app, "post", "/api/organizations/members/invite", {
      body: { email: "person@example.invalid" },
    })).resolves.toMatchObject({ status: 403, body: { code: "INVITATION_ACCESS_DENIED" } });
    expect(mocks.emailService).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("persists before email and serializes only the five-field issuer projection", async () => {
    const app = await buildApp();
    const value = { id: 51, email: "person@example.invalid", role: "member", expiresAt: new Date(), createdAt: new Date() };
    mocks.create.mockResolvedValueOnce({
      ok: true,
      value,
      delivery: { email: value.email, organizationName: "Synthetic org", inviterName: "Owner A" },
    });
    await expect(invoke(app, "post", "/api/organizations/members/invite", {
      body: { email: value.email },
    })).resolves.toEqual({ status: 201, body: value });
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.emailService.mock.invocationCallOrder[0]!);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(value)).not.toContain("token");
  });

  it("maps list, cancellation and preview outcomes to fixed shapes", async () => {
    const app = await buildApp();
    mocks.list.mockResolvedValueOnce({ ok: true, rows: [] });
    mocks.cancel.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    mocks.preview.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(app, "get", "/api/organizations/invites"))
      .resolves.toEqual({ status: 200, body: [] });
    await expect(invoke(app, "delete", "/api/organizations/invites/:id", { id: "51" }))
      .resolves.toMatchObject({ status: 404, body: { code: "INVITATION_NOT_FOUND" } });
    await expect(invoke(app, "get", "/api/invites/:token", { token }))
      .resolves.toMatchObject({ status: 404, body: { code: "INVITATION_NOT_FOUND" } });
  });

  it("accepts through the atomic command before best-effort credit initialization", async () => {
    const app = await buildApp();
    mocks.accept.mockResolvedValueOnce({ ok: true, value: {
      id: 71, organizationId: 10, userId: 10, role: "member", seatAssigned: true,
    } });
    await expect(invoke(app, "post", "/api/invites/:token/accept", { token }))
      .resolves.toMatchObject({ status: 200, body: { success: true, membership: { id: 71 } } });
    expect(mocks.accept.mock.invocationCallOrder[0]).toBeLessThan(mocks.initializeCredits.mock.invocationCallOrder[0]!);
  });

  it("keeps organization registration on ordinary verification with no invite-token login", () => {
    const source = readFileSync(new URL("../../auth.ts", import.meta.url), "utf8");
    const registerStart = source.indexOf('app.post("/api/register"');
    const registerEnd = source.indexOf('app.post("/api/login"', registerStart);
    const register = source.slice(registerStart, registerEnd);
    expect(register).not.toContain("getOrganizationInviteByToken");
    expect(register).not.toContain("validOrgInvite");
    expect(register).not.toContain("verifyUserEmail(user.id)");
    expect(register).not.toContain("req.login(user");
    expect(register).toContain("sendVerificationEmail(username, token, firstName, inviteToken)");
  });
});
