// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  readCreate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  privacy: vi.fn(),
  randomUUID: vi.fn(() => "123e4567-e89b-42d3-a456-426614174000"),
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("node:crypto", async (load) => ({
  ...(await load<typeof import("node:crypto")>()),
  randomUUID: mocks.randomUUID,
}));
vi.mock("../../auth", () => ({
  requireAuth: pass,
  requireRole: () => pass,
  requireSeat: () => pass,
}));
vi.mock("../../csrf", () => ({ doubleCsrfProtection: pass }));
vi.mock("../talentPoolAuthorization", () => ({
  TALENT_POOL_SOURCES: ["external_form", "manual", "import"],
  parseTalentPoolId: (value: unknown) => value === "41" ? 41 : null,
  listAuthorizedTalentPoolCandidates: mocks.list,
  readAuthorizedTalentPoolCandidate: mocks.read,
  readAuthorizedTalentPoolCreateContext: mocks.readCreate,
  createAuthorizedTalentPoolCandidate: mocks.create,
  updateAuthorizedTalentPoolCandidate: mocks.update,
  removeAuthorizedTalentPoolCandidate: mocks.remove,
  restoreAuthorizedTalentPoolCandidate: mocks.restore,
}));
vi.mock("../../candidate-privacy/decision", () => ({
  requireNewCandidateIdentityAllowed: mocks.privacy,
}));
vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../organizationService", () => ({ getUserOrganization: vi.fn() }));

type Method = "get" | "post" | "put" | "delete";
type Result = { status: number; body: unknown };

const candidate = {
  id: 41,
  name: "Synthetic Candidate",
  email: "candidate@example.invalid",
  phone: null,
  source: "manual",
  notes: "Evidence",
  resumeUrl: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

async function buildApp(): Promise<express.Express> {
  const { registerTalentPoolRoutes } = await import("../../talent-pool.routes");
  const app = express();
  app.use(express.json());
  registerTalentPoolRoutes(app);
  return app;
}

async function invoke(
  app: express.Express,
  method: Method,
  path: string,
  input: { id?: string; body?: unknown; role?: string } = {},
): Promise<Result> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: method.toUpperCase(),
    params: { id: input.id },
    body: input.body ?? {},
    user: { id: 101, role: input.role ?? "recruiter", emailVerified: true },
    headers: {},
    ip: "127.0.0.1",
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

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
});

describe("talent-pool route adoption", () => {
  it("uses strict seat middleware for all six management routes", () => {
    const source = readFileSync(new URL("../../talent-pool.routes.ts", import.meta.url), "utf8");
    const management = source.slice(0, source.indexOf("POST /api/talent-pool/:id/convert"));
    expect((management.match(/requireSeat\(\)/g) ?? []).length).toBe(6);
    expect(management).not.toContain("allowNoOrg");
    for (const legacy of [
      "storage.getTalentPoolByRecruiter", "storage.getTalentPoolCandidate",
      "storage.createTalentPoolCandidate", "storage.updateTalentPoolCandidate",
      "storage.removeTalentPoolCandidate", "storage.restoreTalentPoolCandidate",
    ]) expect(management).not.toContain(legacy);
  });

  it("returns the fixed malformed-id response before authorization or privacy", async () => {
    const app = await buildApp();
    const result = await invoke(app, "get", "/api/talent-pool/:id", { id: "41junk" });
    expect(result).toEqual({
      status: 400,
      body: { error: "INVALID_TALENT_POOL_ID", code: "INVALID_TALENT_POOL_ID" },
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.privacy).not.toHaveBeenCalled();
  });

  it("returns the minimum list envelope and maps actor denial", async () => {
    const app = await buildApp();
    mocks.list
      .mockResolvedValueOnce({ ok: true, rows: [candidate] })
      .mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    await expect(invoke(app, "get", "/api/talent-pool"))
      .resolves.toEqual({ status: 200, body: { candidates: [candidate], total: 1 } });
    await expect(invoke(app, "get", "/api/talent-pool"))
      .resolves.toEqual({
        status: 403,
        body: { error: "TALENT_POOL_ACCESS_DENIED", code: "TALENT_POOL_ACCESS_DENIED" },
      });
  });

  it("collapses foreign, absent and wrong-state objects to one fixed 404", async () => {
    const app = await buildApp();
    for (const reason of ["not_found", "not_found", "not_found"] as const) {
      mocks.read.mockResolvedValueOnce({ ok: false, reason });
      await expect(invoke(app, "get", "/api/talent-pool/:id", { id: "41" }))
        .resolves.toEqual({
          status: 404,
          body: { error: "TALENT_POOL_CANDIDATE_NOT_FOUND", code: "TALENT_POOL_CANDIDATE_NOT_FOUND" },
        });
    }
  });

  it("authorizes create before identity work and reauthorizes in the insert statement", async () => {
    const app = await buildApp();
    mocks.readCreate.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    await expect(invoke(app, "post", "/api/talent-pool", {
      body: { name: candidate.name, email: candidate.email },
    })).resolves.toMatchObject({ status: 403 });
    expect(mocks.privacy).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.readCreate.mockResolvedValueOnce({ ok: true });
    mocks.create.mockResolvedValueOnce({ ok: true, value: candidate });
    await expect(invoke(app, "post", "/api/talent-pool", {
      body: { name: candidate.name, email: candidate.email, phone: "+10000000000" },
    })).resolves.toEqual({ status: 201, body: candidate });
    expect(mocks.privacy).toHaveBeenCalledWith([
      { identifier_type: "email", value: candidate.email },
      { identifier_type: "phone", value: "+10000000000" },
    ]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown create fields and exposes no conflicting candidate id", async () => {
    const app = await buildApp();
    await expect(invoke(app, "post", "/api/talent-pool", {
      body: { name: candidate.name, email: candidate.email, organizationId: 99 },
    })).resolves.toEqual({
      status: 400,
      body: { error: "VALIDATION_ERROR", code: "VALIDATION_ERROR" },
    });
    expect(mocks.readCreate).not.toHaveBeenCalled();

    mocks.readCreate.mockResolvedValueOnce({ ok: true });
    mocks.create.mockResolvedValueOnce({ ok: false, reason: "conflict", code: "candidate_exists" });
    const duplicate = await invoke(app, "post", "/api/talent-pool", {
      body: { name: candidate.name, email: candidate.email },
    });
    expect(duplicate).toEqual({
      status: 409,
      body: { error: "TALENT_POOL_CANDIDATE_EXISTS", code: "TALENT_POOL_CANDIDATE_EXISTS" },
    });
    expect(JSON.stringify(duplicate)).not.toContain("existingId");
  });

  it("rejects empty and null-only updates before any read, provider or write", async () => {
    const app = await buildApp();
    for (const body of [{}, { phone: null, notes: null, resumeUrl: null }]) {
      await expect(invoke(app, "put", "/api/talent-pool/:id", { id: "41", body }))
        .resolves.toEqual({
          status: 400,
          body: { error: "TALENT_POOL_UPDATE_REQUIRED", code: "TALENT_POOL_UPDATE_REQUIRED" },
        });
    }
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.privacy).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("checks changed identity after object authority then runs the final write", async () => {
    const app = await buildApp();
    mocks.read.mockResolvedValueOnce({ ok: true, value: candidate });
    mocks.update.mockResolvedValueOnce({ ok: true, value: { ...candidate, email: "new@example.invalid" } });
    await expect(invoke(app, "put", "/api/talent-pool/:id", {
      id: "41", body: { email: "NEW@example.invalid", notes: "Updated" },
    })).resolves.toMatchObject({ status: 200, body: { email: "new@example.invalid" } });
    expect(mocks.privacy).toHaveBeenCalledWith([
      { identifier_type: "email", value: "new@example.invalid" },
    ]);
    expect(mocks.update).toHaveBeenCalledWith(
      101, 41, { email: "NEW@example.invalid", notes: "Updated" }, { allowPlatformAdmin: true },
    );
  });

  it("does no identity-provider work for an inaccessible update", async () => {
    const app = await buildApp();
    mocks.read.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(invoke(app, "put", "/api/talent-pool/:id", {
      id: "41", body: { email: "new@example.invalid" },
    })).resolves.toMatchObject({ status: 404 });
    expect(mocks.privacy).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("removes and restores with fresh event ids and fixed result shapes", async () => {
    const app = await buildApp();
    mocks.remove.mockResolvedValueOnce({ ok: true });
    mocks.restore.mockResolvedValueOnce({ ok: true, value: candidate });
    await expect(invoke(app, "delete", "/api/talent-pool/:id", { id: "41" }))
      .resolves.toEqual({ status: 204, body: undefined });
    await expect(invoke(app, "post", "/api/talent-pool/:id/restore", { id: "41" }))
      .resolves.toEqual({
        status: 200,
        body: { candidate, message: "Candidate restored to this organization’s talent pool" },
      });
    expect(mocks.randomUUID).toHaveBeenCalledTimes(2);
  });

  it("keeps conversion and suggestions route blocks byte-identical", () => {
    const source = readFileSync(new URL("../../talent-pool.routes.ts", import.meta.url), "utf8");
    const routeCall = (method: string, path: string) => {
      const pattern = new RegExp(`app\\.${method}\\(\\s*[\"']${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`, "g");
      const matches = [...source.matchAll(pattern)];
      expect(matches).toHaveLength(1);
      const start = matches[0]!.index!;
      const endings = ["\n  });", "\n  );"]
        .map((closing) => ({ closing, index: source.indexOf(closing, start) }))
        .filter(({ index }) => index >= 0)
        .sort((left, right) => left.index - right.index);
      return source.slice(start, endings[0]!.index + endings[0]!.closing.length);
    };
    expect(createHash("sha256").update(routeCall("post", "/api/talent-pool/:id/convert")).digest("hex"))
      .toBe("50709054de9122d6ade65822d15a059cd35df2d41491c524c7f6cd1f5484a090");
    expect(createHash("sha256").update(routeCall("get", "/api/jobs/:jobId/talent-pool/suggestions")).digest("hex"))
      .toBe("56d2ddc38fb60c5074318aa501457e97933a0e83face6472b80cfed45f629363");
  });
});
