// @vitest-environment node
import { readFileSync } from "node:fs";
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  createFreeSubscription: vi.fn(),
  getUserOrganization: vi.fn(),
  initializeMemberCredits: vi.fn(),
  remove: vi.fn(),
  changeRole: vi.fn(),
  reassign: vi.fn(),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../auth", () => ({
  requireAuth: pass,
  requireRole: () => pass,
}));
vi.mock("../organizationService", () => {
  class OrganizationSelfServiceGrantDeniedError extends Error {}
  return {
    OrganizationSelfServiceGrantDeniedError,
    createOrganization: mocks.createOrganization,
    getOrganization: vi.fn(),
    updateOrganization: vi.fn(),
    deleteOrganization: vi.fn(),
    getUserOrganization: mocks.getUserOrganization,
    isUserInOrganization: vi.fn(),
    createOrganizationInvite: vi.fn(),
    getOrganizationInviteByToken: vi.fn(),
    getPendingInvitesForOrganization: vi.fn(),
    acceptOrganizationInvite: vi.fn(),
    cancelOrganizationInvite: vi.fn(),
    createJoinRequest: vi.fn(),
    getPendingJoinRequests: vi.fn(),
    respondToJoinRequest: vi.fn(),
    createDomainClaimRequest: vi.fn(),
    findOrganizationByUserEmailDomain: vi.fn(),
    isPublicEmailDomain: vi.fn(),
    getEmailDomain: vi.fn(),
  };
});
vi.mock("../membershipService", () => ({
  getOrganizationMembers: vi.fn(),
  getMemberById: vi.fn(),
  leaveOrganization: vi.fn(),
  canManageMembers: vi.fn(),
  canManageBilling: vi.fn(),
  getUserJobsInOrg: vi.fn(),
}));
vi.mock("../privilegeGrantRevocation", () => ({
  parsePrivilegeGrantId: (value: unknown) => value === "20" ? 20 : null,
  removeOrganizationMemberAndRevoke: mocks.remove,
  changeOrganizationMemberRoleAndRevoke: mocks.changeRole,
  reassignOrganizationJobs: mocks.reassign,
}));
vi.mock("../subscriptionService", () => ({ createFreeSubscription: mocks.createFreeSubscription }));
vi.mock("../seatService", () => ({ hasAvailableSeats: vi.fn() }));
vi.mock("../creditService", () => ({ initializeMemberCredits: mocks.initializeMemberCredits }));
vi.mock("../../simpleEmailService", () => ({ getEmailService: vi.fn() }));

type Method = "post" | "patch" | "delete";

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
  input: { id?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(),
    params: { id: input.id },
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
});

describe("2L-A organization route adoption", () => {
  it("orders recruiter admission before CSRF and runs no membership pre-read", () => {
    const source = readFileSync(new URL("../../organization.routes.ts", import.meta.url), "utf8");
    const registration = source.match(/app\.post\("\/api\/organizations"[^\n]+/g)?.[0] ?? "";
    expect(registration).toContain("requireAuth, requireRole(['recruiter']), csrfProtection");
    const createBlock = source.slice(
      source.indexOf('// Create organization'),
      source.indexOf('// Get current organization'),
    );
    expect(createBlock).not.toContain("isUserInOrganization(");
    expect(createBlock).not.toContain("validatedData.authorityOrigin");
    expect(createBlock).not.toContain("validatedData.selfCreatedByUserId");
    expect(createBlock).toContain("authorityOrigin: _authorityOrigin");
    expect(createBlock).toContain("selfCreatedByUserId: _selfCreatedByUserId");
    expect(createBlock).toContain("res.status(201).json(organizationResponse)");
  });

  it("creates only through the stored-authority service before post-transaction subscription work", async () => {
    const app = await buildApp();
    mocks.createOrganization.mockResolvedValueOnce({ id: 91, name: "Synthetic Org", slug: "synthetic-org" });
    mocks.getUserOrganization.mockResolvedValueOnce({ membership: { id: 81 } });
    await expect(invoke(app, "post", "/api/organizations", { body: { name: "Synthetic Org" } }))
      .resolves.toMatchObject({ status: 201, body: { id: 91 } });
    expect(mocks.createOrganization).toHaveBeenCalledWith({ name: "Synthetic Org" }, 10);
    expect(mocks.createFreeSubscription).toHaveBeenCalledWith(91);
    expect(mocks.createOrganization.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createFreeSubscription.mock.invocationCallOrder[0]!);
  });

  it("rejects malformed member ids before statement-bound work", async () => {
    const app = await buildApp();
    for (const [method, path, body] of [
      ["delete", "/api/organizations/members/:id", {}],
      ["patch", "/api/organizations/members/:id/role", { role: "admin" }],
      ["post", "/api/organizations/members/:id/reassign", { toUserId: 30 }],
    ] as const) {
      await expect(invoke(app, method, path, { id: "20junk", body })).resolves.toEqual({
        status: 400,
        body: { error: "INVALID_ORGANIZATION_MEMBER_ID", code: "INVALID_ORGANIZATION_MEMBER_ID" },
      });
    }
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.changeRole).not.toHaveBeenCalled();
    expect(mocks.reassign).not.toHaveBeenCalled();
  });

  it("maps actor and object denials without global pre-reads", async () => {
    const app = await buildApp();
    mocks.remove
      .mockResolvedValueOnce({ ok: false, reason: "forbidden" })
      .mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(app, "delete", "/api/organizations/members/:id", { id: "20" }))
      .resolves.toMatchObject({ status: 403, body: { code: "MEMBER_ADMIN_ACCESS_DENIED" } });
    await expect(invoke(app, "delete", "/api/organizations/members/:id", { id: "20" }))
      .resolves.toMatchObject({ status: 404, body: { code: "ORGANIZATION_MEMBER_NOT_FOUND" } });
  });

  it("maps owner/job/target policy conflicts with zero fallback work", async () => {
    const app = await buildApp();
    mocks.remove.mockResolvedValueOnce({ ok: false, reason: "conflict", code: "jobs_owned" });
    mocks.changeRole.mockResolvedValueOnce({ ok: false, reason: "conflict", code: "owner_protected" });
    mocks.reassign.mockResolvedValueOnce({ ok: false, reason: "conflict", code: "invalid_target" });
    await expect(invoke(app, "delete", "/api/organizations/members/:id", { id: "20" }))
      .resolves.toMatchObject({ status: 409, body: { code: "MEMBER_JOBS_REASSIGN_REQUIRED" } });
    await expect(invoke(app, "patch", "/api/organizations/members/:id/role", { id: "20", body: { role: "admin" } }))
      .resolves.toMatchObject({ status: 409, body: { code: "ORGANIZATION_MEMBER_PROTECTED" } });
    await expect(invoke(app, "post", "/api/organizations/members/:id/reassign", { id: "20", body: { toUserId: 30 } }))
      .resolves.toMatchObject({ status: 409, body: { code: "ORGANIZATION_REASSIGN_TARGET_INVALID" } });
  });

  it("returns minimum success projections from the three commands", async () => {
    const app = await buildApp();
    mocks.remove.mockResolvedValueOnce({ ok: true });
    mocks.changeRole.mockResolvedValueOnce({ ok: true, value: {
      id: 20, userId: 30, role: "admin", seatAssigned: true,
    } });
    mocks.reassign.mockResolvedValueOnce({ ok: true, reassignedCount: 2 });
    await expect(invoke(app, "delete", "/api/organizations/members/:id", { id: "20" }))
      .resolves.toEqual({ status: 200, body: { success: true } });
    await expect(invoke(app, "patch", "/api/organizations/members/:id/role", { id: "20", body: { role: "admin" } }))
      .resolves.toEqual({ status: 200, body: { id: 20, userId: 30, role: "admin", seatAssigned: true } });
    await expect(invoke(app, "post", "/api/organizations/members/:id/reassign", { id: "20", body: { toUserId: 30 } }))
      .resolves.toEqual({ status: 200, body: { success: true, reassignedCount: 2 } });
  });

  it("keeps password+version before the separately tracked token clear", () => {
    const source = readFileSync(new URL("../../auth.ts", import.meta.url), "utf8");
    const resetStart = source.indexOf('app.post("/api/reset-password"');
    const reset = source.slice(resetStart);
    const passwordWrite = reset.indexOf("resetPasswordAndAdvanceAuthorization(");
    const tokenClear = reset.indexOf("storage.clearPasswordResetToken(user.id)", passwordWrite);
    expect(passwordWrite).toBeGreaterThan(-1);
    expect(tokenClear).toBeGreaterThan(passwordWrite);
    expect(reset).not.toContain("storage.updateUserPassword(");
    expect(reset).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?session/i);
  });
});
