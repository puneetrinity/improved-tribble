import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../candidate-privacy/decision", async original => ({
  ...await original<typeof import("../../candidate-privacy/decision")>(), requireCandidatePrivacyAllowed: vi.fn(),
}));
vi.mock("../repository", () => ({ loadConsentCommand: vi.fn(), ownedResume: vi.fn() }));
vi.mock("../../lib/services/jwt-signer", () => ({ signServiceJwt: vi.fn(async () => "synthetic-token") }));

import { CandidatePrivacyRestrictedError, requireCandidatePrivacyAllowed } from "../../candidate-privacy/decision";
import { signServiceJwt } from "../../lib/services/jwt-signer";
import { CandidateConsentError, CONSENT_COPY_SHA256, consentCommandSchema, consentIdentity, sha256 } from "../contracts";
import { ConsentDeliveryError, consentMemoryOrigin, deliverConsent } from "../memory-client";
import { loadConsentCommand, ownedResume } from "../repository";
import { consentDeliveryConfig, runConsentProcessorOnce } from "../processor";

const config = { enabled: true, tickMs: 2000, batchSize: 10, timeoutMs: 5000, leaseMs: 30000 };
function command(action: "grant" | "withdraw" = "grant") {
  return consentCommandSchema.parse({ schema_version: 1, subject_id: "11111111-1111-4111-8111-111111111111",
    event_id: "22222222-2222-4222-8222-222222222222", version: 1, action,
    purpose: "platform_professional_matching", purpose_version: 1, copy_version: 1, copy_sha256: CONSENT_COPY_SHA256,
    captured_at: "2026-09-10T01:02:03.004Z", source: action === "grant" ? {
      source_id: "33333333-3333-4333-8333-333333333333", source_version: 1,
      profile: { display_name: "Synthetic Candidate", headline: "", location: "", skills: [], linkedin: null }, resume: null,
    } : null });
}
const proof = { verified_email: "consent@fixture.invalid", privacy_subject: [{ identifier_type: "email" as const, value: "consent@fixture.invalid" }] };
const receipt = (payload = command()) => ({ subject_id: payload.subject_id, event_id: payload.event_id, version: payload.version,
  command_digest: consentIdentity(payload).commandDigest, idempotency_key: consentIdentity(payload).idempotencyKey,
  outcome: payload.action === "grant" ? "granted" as const : "withdrawn" as const,
  effective_version: payload.version, effective_action: payload.action });
const account = { role: "candidate", username: proof.verified_email, email_verified: true, auth_version: 4 };
function database(payload = command(), user: unknown = account) {
  const identity = consentIdentity(payload);
  const row = { outbox_id: "44444444-4444-4444-8444-444444444444", event_id: payload.event_id,
    generation: 3, attempts: 2, command_sha256: identity.commandDigest, idempotency_key: identity.idempotencyKey };
  vi.mocked(loadConsentCommand).mockResolvedValue({ command: payload, userId: 17, authVersion: 4, emailDigest: sha256(proof.verified_email) });
  return { row, query: vi.fn(async (sql: string, _values?: unknown[]) => ({ rows:
    sql.includes("flow_claim_") ? [row] : sql.includes("FROM public.users") ? (user ? [user] : []) : [{ result: true }] })) };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(requireCandidatePrivacyAllowed).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadConsentCommand).mockReset(); vi.mocked(ownedResume).mockReset();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("ACTIVEKG_BASE_URL", "https://memory.fixture.invalid");
});
afterEach(() => vi.unstubAllEnvs());

describe("candidate consent leased delivery", () => {
  it("makes no database or network call while disabled", async () => {
    const db = database(), deliver = vi.fn();
    expect(await runConsentProcessorOnce({ ...config, enabled: false }, null, db, deliver)).toBe(0);
    expect(db.query).not.toHaveBeenCalled(); expect(deliver).not.toHaveBeenCalled();
  });
  it("rechecks account and privacy before delivering and acknowledges only its claimed generation", async () => {
    const db = database(), deliver = vi.fn(async () => receipt());
    expect(await runConsentProcessorOnce(config, null, db, deliver)).toBe(1);
    expect(requireCandidatePrivacyAllowed).toHaveBeenCalledWith({ type: "candidate_user", id: 17 }, { globalUse: true, newGlobalOperation: true });
    expect(deliver).toHaveBeenCalledWith(command(), proof, 5000);
    expect(vi.mocked(requireCandidatePrivacyAllowed).mock.invocationCallOrder[0]).toBeLessThan(deliver.mock.invocationCallOrder[0]);
    expect(db.query.mock.calls.at(-1)).toEqual([expect.stringContaining("flow_ack_"), [db.row.outbox_id, 3, JSON.stringify(receipt())]]);
  });
  it.each([null, { ...account, auth_version: 5 }, { ...account, email_verified: false }, { ...account, role: "recruiter" },
    { ...account, username: "changed@fixture.invalid" }])("never sends after account authority changes", async user => {
    const db = database(command(), user), deliver = vi.fn();
    await runConsentProcessorOnce(config, null, db, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(db.query.mock.calls.at(-1)?.[1]?.slice(1, 4)).toEqual([3, "account_changed", false]);
  });
  it.each([
    ["candidate_privacy_restricted", "privacy_restricted", false],
    ["candidate_privacy_review_required", "privacy_review", true],
    ["candidate_privacy_unavailable", "privacy_review", true],
  ] as const)("records %s without a send or false ack", async (code, expected, retryable) => {
    const db = database(), deliver = vi.fn();
    vi.mocked(requireCandidatePrivacyAllowed).mockRejectedValue(new CandidatePrivacyRestrictedError(code));
    await runConsentProcessorOnce(config, null, db, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(db.query.mock.calls.at(-1)?.[0]).toContain("flow_fail_");
    expect(db.query.mock.calls.at(-1)?.[1]?.slice(1, 4)).toEqual([3, expected, retryable]);
  });
  it("can withdraw with no account, source lookup or global privacy admission", async () => {
    const payload = command("withdraw"), db = database(payload, null), deliver = vi.fn(async () => receipt(payload));
    await runConsentProcessorOnce(config, payload.event_id, db, deliver);
    expect(db.query.mock.calls[0][1]).toEqual([expect.stringContaining("flow-consent-web-"), 1, 30000, payload.event_id]);
    expect(deliver).toHaveBeenCalledWith(payload, null, 5000);
    expect(requireCandidatePrivacyAllowed).not.toHaveBeenCalled(); expect(ownedResume).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => sql.includes("FROM public.users"))).toBe(false);
  });
  it("makes command tampering terminal without send", async () => {
    const db = database(), deliver = vi.fn(); db.row.command_sha256 = "f".repeat(64);
    await runConsentProcessorOnce(config, null, db, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(db.query.mock.calls.at(-1)?.[1]?.slice(2, 4)).toEqual(["identity_mismatch", false]);
  });
  it("keeps network failure retryable without acknowledging", async () => {
    const db = database(), deliver = vi.fn(async () => { throw new ConsentDeliveryError("network", true); });
    await runConsentProcessorOnce(config, null, db, deliver);
    expect(db.query.mock.calls.at(-1)?.[1]?.slice(2, 4)).toEqual(["network", true]);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("flow_ack_"))).toBe(false);
  });
  it("does not send when the immutable source loader fails", async () => {
    const db = database(), deliver = vi.fn();
    vi.mocked(loadConsentCommand).mockRejectedValue(new CandidateConsentError("source_missing"));
    await runConsentProcessorOnce(config, null, db, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(db.query.mock.calls.at(-1)?.[1]?.slice(2, 4)).toEqual(["source_missing", false]);
  });
});

describe("candidate consent bounded transport", () => {
  it("uses the actual signer contract and strict response identity", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(receipt()), { status: 200 }));
    await expect(deliverConsent(command(), proof, 5000, fetcher)).resolves.toEqual(receipt());
    expect(signServiceJwt).toHaveBeenCalledWith("activekg", { tenantId: `candidate_${command().subject_id}`,
      scopes: "candidate-consent:write", requestId: command().event_id, actorType: "service" });
    expect(fetcher).toHaveBeenCalledWith("https://memory.fixture.invalid/candidate-consent/events",
      expect.objectContaining({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it.each([[451, "privacy_restricted", false], [429, "remote_retry", true], [503, "remote_retry", true],
    [409, "remote_conflict", false], [422, "remote_denied", false]] as const)("classifies HTTP %s", async (status, code, retryable) => {
    await expect(deliverConsent(command(), proof, 5000, vi.fn(async () => new Response("{}", { status }))))
      .rejects.toMatchObject({ code, retryable });
  });
  it.each([{ event_id: "55555555-5555-4555-8555-555555555555" }, { idempotency_key: "f".repeat(64) },
    { effective_version: 2 }, { effective_action: "withdraw" }])("refuses a different receipt identity", async delta => {
    await expect(deliverConsent(command(), proof, 5000, vi.fn(async () => new Response(JSON.stringify({ ...receipt(), ...delta })))))
      .rejects.toMatchObject({ code: "identity_mismatch", retryable: false });
  });
  it.each(["not-json", JSON.stringify({ ...receipt(), email: "never@fixture.invalid" }), " ".repeat(8193)])(
    "refuses malformed, extra-field or oversized receipts", async body => {
      await expect(deliverConsent(command(), proof, 5000, vi.fn(async () => new Response(body))))
        .rejects.toMatchObject({ code: "invalid_response", retryable: false });
    });
  it("keeps timeout separate from other network failure", async () => {
    await expect(deliverConsent(command(), proof, 5000, vi.fn(async () => { throw new DOMException("no detail", "TimeoutError"); })))
      .rejects.toMatchObject({ code: "timeout", retryable: true });
  });
  it("requires verified HTTPS in production and binds credential/lease configuration", () => {
    const env = { NODE_ENV: "production", ACTIVEKG_BASE_URL: "https://memory.fixture.invalid", CANDIDATE_CONSENT_DELIVERY_ENABLED: "true",
      VANTAHIRE_JWT_PRIVATE_KEY: "synthetic-key", VANTAHIRE_JWT_ACTIVE_KID: "test-kid" };
    expect(consentDeliveryConfig(env)).toEqual(config);
    expect(() => consentDeliveryConfig({ ...env, CANDIDATE_CONSENT_LEASE_MS: "5000" })).toThrow(/lease_must_exceed_timeout/);
    expect(() => consentDeliveryConfig({ ...env, VANTAHIRE_JWT_PRIVATE_KEY: "" })).toThrow(/credentials/);
    for (const origin of ["http://127.0.0.1", "https://name:secret@memory.fixture.invalid", "https://memory.fixture.invalid/path", "https://memory.fixture.invalid?q=x"]) {
      expect(() => consentMemoryOrigin({ ...env, ACTIVEKG_BASE_URL: origin })).toThrow();
    }
    expect(consentMemoryOrigin({ NODE_ENV: "test", ACTIVEKG_BASE_URL: "http://127.0.0.1:56789" })).toBe("http://127.0.0.1:56789");
  });
});
