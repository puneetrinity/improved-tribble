// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  readHistory: vi.fn(),
  requireSeatFactory: vi.fn(),
  getApplication: vi.fn(),
  getTemplates: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("../../auth", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireSeat: () => {
    mocks.requireSeatFactory();
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

vi.mock("../applicationReadAuthorization", () => ({
  parsePositiveDecimalApplicationId: (value: unknown) => {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  },
  readAuthorizedApplicationWhatsAppHistory: mocks.readHistory,
}));

vi.mock("../../storage", () => ({
  storage: { getApplication: mocks.getApplication },
}));

vi.mock("../../db", () => ({
  db: {
    query: { whatsappTemplates: { findFirst: vi.fn() } },
    update: vi.fn(),
  },
}));

vi.mock("../../lib/mauticService", () => ({ queueMauticOutreachSync: vi.fn() }));
vi.mock("../../whatsappTemplateService", () => ({
  sendWhatsAppTemplatedMessage: mocks.sendMessage,
  getAllWhatsAppTemplates: mocks.getTemplates,
}));
vi.mock("../../whatsappService", () => ({ getWhatsAppService: vi.fn() }));

type RouteResult = { status: number; body: unknown };

async function buildApp(): Promise<express.Express> {
  const { registerWhatsAppRoutes } = await import("../../whatsapp.routes");
  const app = express();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  registerWhatsAppRoutes(app, pass as any);
  return app;
}

async function invoke(app: express.Express, id: string | undefined): Promise<RouteResult> {
  const layer = (app as any)._router.stack.find(
    (entry: any) => entry.route?.path === "/api/applications/:id/whatsapp-history"
      && entry.route.methods?.get,
  );
  if (!layer) throw new Error("WhatsApp history route not found");
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req: any = {
    method: "GET",
    params: { id },
    body: {},
    query: {},
    user: {
      id: 101,
      role: "recruiter",
      firstName: "Primary",
      lastName: "Recruiter",
      username: "primary@example.invalid",
      emailVerified: true,
    },
    headers: {},
    ip: "127.0.0.1",
    app: { get: () => false },
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (body: unknown, status: number) => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        finish(payload, this.statusCode);
        return this;
      },
    };
    let index = 0;
    const next = (error?: unknown) => {
      if (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
        return;
      }
      const handler = handlers[index++];
      if (!handler) {
        reject(new Error("WhatsApp history route completed without a response"));
        return;
      }
      Promise.resolve(handler(req, res, next)).catch(reject);
    };
    next();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTemplates.mockResolvedValue([]);
});

describe("WhatsApp history object authorization route", () => {
  it.each([
    undefined,
    "",
    "0",
    "-1",
    "+1",
    "01",
    " 1",
    "1 ",
    "1.0",
    "1e1",
    "0x10",
    "1x",
    String(Number.MAX_SAFE_INTEGER + 1),
  ])("rejects non-canonical application id %s before authorization", async (id) => {
    const result = await invoke(await buildApp(), id);
    expect(result).toEqual({
      status: 400,
      body: { error: "Invalid application id", code: "INVALID_APPLICATION_ID" },
    });
    expect(mocks.readHistory).not.toHaveBeenCalled();
    expect(mocks.getApplication).not.toHaveBeenCalled();
  });

  it("collapses foreign and absent applications to the same response", async () => {
    const app = await buildApp();
    mocks.readHistory.mockResolvedValue({ ok: false, reason: "not_found" });
    const foreign = await invoke(app, "2002");
    const absent = await invoke(app, "999999");
    const expected = {
      status: 404,
      body: { error: "Application not found", code: "APPLICATION_NOT_FOUND" },
    };
    expect(foreign).toEqual(expected);
    expect(absent).toEqual(expected);
    expect(JSON.stringify(foreign)).toBe(JSON.stringify(absent));
    expect(mocks.getApplication).not.toHaveBeenCalled();
  });

  it("maps authorization failure to a bounded unavailable response", async () => {
    mocks.readHistory.mockResolvedValue({ ok: false, reason: "unavailable" });
    await expect(invoke(await buildApp(), "2001")).resolves.toEqual({
      status: 503,
      body: { error: "Authorization unavailable", code: "AUTHORIZATION_UNAVAILABLE" },
    });
  });

  it("returns only the authorized reader projection", async () => {
    const rows = [{
      templateName: "Interview update",
      templateType: "interview_invite",
      status: "read",
      sentAt: "2026-08-26T12:00:00.000Z",
      deliveredAt: "2026-08-26T12:01:00.000Z",
      readAt: "2026-08-26T12:02:00.000Z",
      sentBy: { firstName: "Primary", lastName: "Recruiter" },
    }];
    mocks.readHistory.mockResolvedValue({ ok: true, rows });
    const result = await invoke(await buildApp(), "2001");
    expect(result).toEqual({ status: 200, body: rows });
    expect(mocks.readHistory).toHaveBeenCalledWith(101, 2001, { allowPlatformAdmin: true });
    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("recipientPhone");
    expect(JSON.stringify(result)).not.toContain("messageId");
  });

  it("preserves authorized empty history and registers the seat middleware", async () => {
    mocks.readHistory.mockResolvedValue({ ok: true, rows: [] });
    await expect(invoke(await buildApp(), "2001")).resolves.toEqual({ status: 200, body: [] });
    expect(mocks.requireSeatFactory).toHaveBeenCalled();
  });
});
