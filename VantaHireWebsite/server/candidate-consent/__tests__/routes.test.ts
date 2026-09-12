import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

vi.mock("../../db", () => ({ pool: {} }));
vi.mock("../../auth", () => ({
  privacyPasswordVersion: (password: string) => `digest:${password}`,
  requireVerifiedCandidate: (req: any, res: any, next: () => void) => {
    if (!req.user || req.user.role !== "candidate" || !req.user.emailVerified) {
      res.status(403).json({ code: "verified_candidate_required" });
    } else next();
  },
}));
vi.mock("../../candidate-privacy/decision", async original => ({
  ...await original<typeof import("../../candidate-privacy/decision")>(),
  requireCandidatePrivacyAllowed: vi.fn(),
}));
vi.mock("../repository", async original => ({
  ...await original<typeof import("../repository")>(),
  captureConsent: vi.fn(), getConsentStatus: vi.fn(), listConsentSources: vi.fn(),
}));
vi.mock("../processor", () => ({ consentDeliveryConfig: vi.fn(() => ({ enabled: false })), runConsentProcessorOnce: vi.fn() }));

import { CandidatePrivacyRestrictedError } from "../../candidate-privacy/decision";
import { CandidateConsentError, CONSENT_COPY_SHA256, CONSENT_PURPOSE } from "../contracts";
import { captureConsent, getConsentStatus, listConsentSources, recentConsentAuth } from "../repository";
import { runConsentProcessorOnce } from "../processor";
import { registerCandidateConsentRoutes } from "../routes";

const handlers = new Map<string, Array<(req: any, res: any, next: () => void) => unknown>>();
const csrf = vi.fn((req: any, res: any, next: () => void) => {
  if (req.csrf === true) next(); else res.status(403).json({ code: "csrf_required" });
});
registerCandidateConsentRoutes({
  get: (path: string, ...chain: any[]) => handlers.set(`GET ${path}`, chain),
  post: (path: string, ...chain: any[]) => handlers.set(`POST ${path}`, chain),
} as unknown as Express, csrf);

const baseRequest = () => ({ user: { id: 17, role: "candidate", emailVerified: true, authVersion: 4, password: "test-hash" },
  session: { privacyPasswordVersion: "digest:test-hash", privacyReauthenticatedAt: Date.now() }, csrf: true, query: {}, body: {} });
const grantBody = () => ({ request_id: "11111111-1111-4111-8111-111111111111", expected_version: 0,
  purpose: CONSENT_PURPOSE, copy_version: 1, copy_sha256: CONSENT_COPY_SHA256,
  profile: { display_name: "Synthetic Candidate", headline: "", location: "", skills: [], linkedin: null }, resume_version_id: null });
const pending = () => ({ version: 1, desired: { action: "grant" }, effective: null, delivery_status: "pending", publication_active: false });

async function request(method: string, path: string, changes = {}) {
  const req = { ...baseRequest(), ...changes };
  const response = { statusCode: 200, body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; } };
  for (const handler of handlers.get(`${method} ${path}`)!) {
    let advanced = false;
    await handler(req, response, () => { advanced = true; });
    if (!advanced) break;
  }
  return response;
}

describe("candidate consent route contract (registered chains; dependencies isolated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(captureConsent).mockReset().mockResolvedValue({ eventId: "22222222-2222-4222-8222-222222222222", replayed: false });
    vi.mocked(getConsentStatus).mockReset().mockResolvedValue(pending() as any);
    vi.mocked(listConsentSources).mockReset().mockResolvedValue({ sources: [], next_cursor: null });
    vi.mocked(runConsentProcessorOnce).mockReset().mockResolvedValue(0);
  });

  it("registers exactly two reads and two writes", () => {
    expect([...handlers.keys()]).toEqual(["GET /api/candidate/consent", "GET /api/candidate/consent/sources",
      "POST /api/candidate/consent/grant", "POST /api/candidate/consent/withdraw"]);
  });
  it.each([undefined, { id: 17, role: "super_admin", emailVerified: true }, { id: 17, role: "candidate", emailVerified: false }])(
    "runs verified-candidate middleware before every operation", async user => {
      for (const key of handlers.keys()) {
        const [method, path] = key.split(" ");
        expect((await request(method, path, { user })).statusCode).toBe(403);
      }
      expect(captureConsent).not.toHaveBeenCalled(); expect(getConsentStatus).not.toHaveBeenCalled();
    });
  it("requires CSRF before capture and sends server-derived identity", async () => {
    expect((await request("POST", "/api/candidate/consent/grant", { csrf: false, body: grantBody() })).statusCode).toBe(403);
    expect(captureConsent).not.toHaveBeenCalled();
    const result = await request("POST", "/api/candidate/consent/grant", { body: grantBody() });
    expect(result.statusCode).toBe(202); expect(result.body.code).toBe("grant_pending");
    expect(captureConsent).toHaveBeenCalledWith("grant", grantBody(), expect.objectContaining({ userId: 17, authVersion: 4 }));
  });
  it.each([NaN, Infinity, Date.now() + 60_000, Date.now() - 660_000, undefined])(
    "requires a finite, nonfuture, recent password reauthentication", async privacyReauthenticatedAt => {
      const result = await request("POST", "/api/candidate/consent/withdraw", {
        body: { request_id: grantBody().request_id, expected_version: 0 },
        session: { privacyReauthenticatedAt, privacyPasswordVersion: "digest:test-hash" },
      });
      expect(result.statusCode).toBe(403); expect(captureConsent).not.toHaveBeenCalled();
    });
  it("uses the actual password-version freshness predicate", () => {
    expect(recentConsentAuth(100, "digest:test-hash", "test-hash", 600100)).toBe(true);
    expect(recentConsentAuth(100, "digest:test-hash", "test-hash", 600101)).toBe(false);
    expect(recentConsentAuth(100, "digest:old", "test-hash", 100)).toBe(false);
  });
  it.each([{ user_id: 18 }, { subject_id: grantBody().request_id }, { source: {} }, { extra: true }])(
    "refuses browser authority substitution and extra fields", async extra => {
      expect((await request("POST", "/api/candidate/consent/grant", { body: { ...grantBody(), ...extra } })).statusCode).toBe(400);
      expect(captureConsent).not.toHaveBeenCalled();
    });
  it("exposes only own status and bounded source pagination", async () => {
    expect((await request("GET", "/api/candidate/consent", { query: { userId: "18" } })).statusCode).toBe(400);
    await request("GET", "/api/candidate/consent");
    expect(getConsentStatus).toHaveBeenCalledWith(17);
    await request("GET", "/api/candidate/consent/sources");
    expect(listConsentSources).toHaveBeenCalledWith(17, 25, null);
    expect((await request("GET", "/api/candidate/consent/sources", { query: { limit: "101" } })).statusCode).toBe(400);
  });
  it.each(["candidate_privacy_review_required", "candidate_privacy_unavailable"] as const)(
    "renders privacy uncertainty as temporary unavailability", async code => {
      vi.mocked(captureConsent).mockRejectedValue(new CandidatePrivacyRestrictedError(code));
      const result = await request("POST", "/api/candidate/consent/grant", { body: grantBody() });
      expect(result.statusCode).toBe(503); expect(result.body.code).toBe("candidate_consent_temporarily_unavailable");
      expect(runConsentProcessorOnce).not.toHaveBeenCalled();
    });
  it("keeps privacy restriction, missing source and internal detail distinct", async () => {
    for (const [error, status, code] of [
      [new CandidatePrivacyRestrictedError("candidate_privacy_restricted"), 451, "candidate_privacy_restricted"],
      [new CandidateConsentError("candidate_consent_source_not_found", 404), 404, "candidate_consent_source_not_found"],
      [new Error("raw-profile-sentinel"), 503, "candidate_consent_temporarily_unavailable"],
    ] as const) {
      vi.mocked(captureConsent).mockRejectedValue(error);
      const result = await request("POST", "/api/candidate/consent/grant", { body: grantBody() });
      expect([result.statusCode, result.body.code]).toEqual([status, code]);
    }
  });
  it("keeps a committed withdrawal pending through a failed fast path until matching acknowledgement", async () => {
    const body = { request_id: grantBody().request_id, expected_version: 1 };
    vi.mocked(runConsentProcessorOnce).mockRejectedValue(new Error("network"));
    vi.mocked(getConsentStatus).mockResolvedValue({ ...pending(), version: 2, effective: { version: 1, action: "grant" } } as any);
    const pendingResult = await request("POST", "/api/candidate/consent/withdraw", { body });
    expect([pendingResult.statusCode, pendingResult.body.code]).toEqual([202, "withdrawal_pending"]);
    vi.mocked(getConsentStatus).mockResolvedValue({ ...pending(), version: 2, effective: { version: 2, action: "withdraw" } } as any);
    const effectiveResult = await request("POST", "/api/candidate/consent/withdraw", { body });
    expect([effectiveResult.statusCode, effectiveResult.body.code]).toEqual([200, "withdrawn"]);
  });
});
