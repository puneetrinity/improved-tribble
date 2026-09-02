// @vitest-environment node
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  storageRead: vi.fn(),
  merge: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    execute: mocks.execute,
    select: mocks.storageRead,
    insert: mocks.storageRead,
    update: mocks.storageRead,
    delete: mocks.storageRead,
    transaction: mocks.storageRead,
    query: {},
  },
}));
vi.mock("../../storage", () => ({ storage: new Proxy({}, { get: () => mocks.storageRead }) }));
vi.mock("../../auth", () => ({
  requireRole: (roles: string[]) => (req: any, res: any, next: () => void) => {
    if (!roles.includes(req.user?.role)) {
      res.status(403).json({ error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" });
      return;
    }
    next();
  },
}));
vi.mock("../pipelineStageMerge", () => ({ mergeDuplicatePipelineStagesForOrg: mocks.merge }));
vi.mock("../../candidate-privacy/decision", () => ({ privacyAllowedSql: () => "TRUE" }));
vi.mock("../scopedFinancialAdminPublicAuthorization", () => ({
  parseAuthorizedUserRole: vi.fn(),
  parseScopedFinancialId: vi.fn(),
  updateAuthorizedUserRole: vi.fn(),
}));
vi.mock("@shared/schema", () => ({
  userAiUsage: {}, applicationFeedback: {}, formResponses: {}, formInvitations: {}, forms: {},
  applications: {}, users: {}, emailAuditLog: {}, automationEvents: {}, automationSettings: {},
  applicationStageHistory: {}, pipelineStages: {}, emailTemplates: {}, jobs: {}, clients: {},
}));

import { registerAdminRoutes } from "../../admin.routes";

type Result = { status: number; body: unknown };

function csrfProtection(req: any, res: any, next: () => void): void {
  if (req.headers["x-csrf-token"] !== "synthetic-csrf") {
    res.status(403).json({ error: "Invalid CSRF token", code: "CSRF_INVALID" });
    return;
  }
  next();
}

async function invoke(options: {
  role: "super_admin" | "recruiter";
  csrf?: string;
  body?: unknown;
  params?: Record<string, string>;
}): Promise<Result> {
  const app = express();
  registerAdminRoutes(app, csrfProtection as any);
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === "/api/admin/ops/backfill-org-ids" && entry.route.methods?.post,
  );
  if (!layer) throw new Error("retired attribution route not registered");
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: "POST",
    body: options.body ?? {},
    params: options.params ?? {},
    query: {},
    headers: { "x-csrf-token": options.csrf },
    user: { id: 901, role: options.role, username: "fixture@example.invalid" },
  };
  return new Promise((resolve, reject) => {
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { resolve({ status: this.statusCode, body }); return this; },
    };
    let index = 0;
    const next = (error?: unknown) => {
      if (error) { reject(error); return; }
      const handler = handlers[index++];
      if (!handler) { reject(new Error("route completed without a response")); return; }
      Promise.resolve(handler(req, res, next)).catch(reject);
    };
    next();
  });
}

beforeEach(() => vi.clearAllMocks());

describe("unsafe organization-attribution route retirement", () => {
  it("returns the fixed 410 tombstone to an authorized admin with zero work", async () => {
    await expect(invoke({ role: "super_admin", csrf: "synthetic-csrf" })).resolves.toEqual({
      status: 410,
      body: {
        error: "Organization attribution repair retired",
        code: "ORG_ATTRIBUTION_REPAIR_RETIRED",
      },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.storageRead).not.toHaveBeenCalled();
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("keeps CSRF and super-admin middleware ahead of the tombstone", async () => {
    await expect(invoke({ role: "super_admin" })).resolves.toMatchObject({ status: 403 });
    await expect(invoke({ role: "recruiter", csrf: "synthetic-csrf" })).resolves.toMatchObject({ status: 403 });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.storageRead).not.toHaveBeenCalled();
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("ignores all former mutation inputs and always returns the same tombstone", async () => {
    const malformed = await invoke({
      role: "super_admin",
      csrf: "synthetic-csrf",
      body: { dryRun: false, organizationId: 10, userId: 20, merge: true },
      params: { id: "999" },
    });
    expect(malformed).toEqual({
      status: 410,
      body: {
        error: "Organization attribution repair retired",
        code: "ORG_ATTRIBUTION_REPAIR_RETIRED",
      },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.storageRead).not.toHaveBeenCalled();
    expect(mocks.merge).not.toHaveBeenCalled();
  });
});
