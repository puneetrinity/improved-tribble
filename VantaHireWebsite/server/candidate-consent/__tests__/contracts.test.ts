import { describe, expect, it } from "vitest";
import { canonicalConsentBytes, consentIdentity, consentCommandSchema, consentProfileSchema,
  CONSENT_COPY_SHA256, grantRequestSchema, requestDigest, timestampSchema } from "../contracts";

export function vector(withResume = false) {
  return consentCommandSchema.parse({ schema_version: 1,
    subject_id: "11111111-1111-4111-8111-111111111111", event_id: "22222222-2222-4222-8222-222222222222",
    version: 42, action: "grant", purpose: "platform_professional_matching", purpose_version: 1,
    copy_version: 1, copy_sha256: CONSENT_COPY_SHA256, captured_at: "2026-09-10T01:02:03.004Z",
    source: { source_id: "33333333-3333-4333-8333-333333333333", source_version: 42,
      profile: { display_name: "Zoë 🦋", headline: "Ingénieure", location: "Paris", skills: ["TypeScript", "Café"], linkedin: null },
      resume: withResume ? { reference_id: "44444444-4444-4444-8444-444444444444",
        resume_version_id: "55555555-5555-4555-8555-555555555555", organization_id: 7, application_id: 8, job_id: 9,
        content_sha256: "a".repeat(64), byte_count: 123, media_type: "application/pdf", source_observed_at: "2026-09-01T02:03:04.005Z" } : null } });
}
describe("candidate consent byte contract", () => {
  it("pins the exact copy", () => {
    expect(CONSENT_COPY_SHA256).toBe("487f78065f2b6fd493814d9a1c5a760ce0550b0a1846f2a72d7d6b58d333f094");
  });
  it.each([
    [false, "5238f0df4cd9be9a2ef98de2cbd02b445babc15c2773bbb1e5b5ca14c7f155ea", "c25cf69df708ffd180faea6ec1bb4b4fe4e96f33187627b0a7602bf42fe2b5ab"],
    [true, "d312454ae6c6fa71914d0259f348de838cdeb23995083146f04704eeaeedbe72", "630be69bd974c44e21a67bc9da2d254b4a8c2194c58a20d9338add1e6015e4c8"],
  ] as const)("matches Memory's identical Unicode/null/resume vector %s", (resume, commandDigest, idempotencyKey) => {
    const command = vector(resume);
    expect(consentIdentity(command)).toEqual({ commandDigest, idempotencyKey });
    const expected = [1, command.subject_id, command.event_id, 42, "grant", "platform_professional_matching", 1,
      CONSENT_COPY_SHA256, ["33333333-3333-4333-8333-333333333333", 42, "Zoë 🦋", "Ingénieure", "Paris",
        ["TypeScript", "Café"], null, resume ? ["44444444-4444-4444-8444-444444444444",
          "55555555-5555-4555-8555-555555555555", 7, 8, 9, "a".repeat(64), 123, "application/pdf",
          "2026-09-01T02:03:04.005Z"] : null], "2026-09-10T01:02:03.004Z"];
    expect(canonicalConsentBytes(command)).toBe(JSON.stringify(expected));
  });
  it("normalizes approved Unicode before versioning, retaining order and neutral empty skills", () => {
    const source = vector().source!;
    const profile = consentProfileSchema.parse({ ...source.profile, display_name: " Zoe\u0308 🦋 ", skills: [] });
    expect(profile.display_name).toBe("Zoë 🦋");
    expect(profile.skills).toEqual([]);
  });
  it.each(["\ud800", "\udfff", "name\nline", "name\u0000", "name\u0085"])("rejects non-scalar/control text", display_name => {
    expect(consentProfileSchema.safeParse({ ...vector().source!.profile, display_name }).success).toBe(false);
  });
  it.each([{ skills: ["Java", " Java "] }, { skills: Array.from({ length: 101 }, (_, i) => `s${i}`) },
    { email: "never-persist@fixture.invalid" }, { linkedin: "https://example.invalid/in/person" },
    { headline: "x".repeat(301) }, { skills: [{ value: "Java" }] }])("refuses extra or malformed approved fields", delta => {
    expect(consentProfileSchema.safeParse({ ...vector().source!.profile, ...delta }).success).toBe(false);
  });
  it.each(["2026-09-10T01:02:03Z", "2026-02-30T01:02:03.004Z", "2026-09-10T01:02:03.004+00:00"])(
    "requires exact real millisecond UTC timestamps", value => expect(timestampSchema.safeParse(value).success).toBe(false));
  it("keeps browser idempotency distinct from transport identity and refuses actor/tuple substitution", () => {
    const request = { request_id: vector().event_id, expected_version: 0, purpose: "platform_professional_matching",
      copy_version: 1, copy_sha256: CONSENT_COPY_SHA256, profile: vector().source!.profile, resume_version_id: null };
    const parsed = grantRequestSchema.parse(request);
    expect(requestDigest("grant", parsed)).toBe(requestDigest("grant", { ...parsed }));
    expect(requestDigest("grant", { ...parsed, expected_version: 1 })).not.toBe(requestDigest("grant", parsed));
    expect(grantRequestSchema.safeParse({ ...request, user_id: 7 }).success).toBe(false);
    expect(grantRequestSchema.safeParse({ ...request, source: vector().source }).success).toBe(false);
    expect(grantRequestSchema.safeParse({ ...request, copy_sha256: "b".repeat(64) }).success).toBe(false);
  });
  it("withdrawal carries no source and changes both command digest and delivery key", () => {
    const grant = vector();
    const withdrawal = consentCommandSchema.parse({ ...grant, action: "withdraw", source: null });
    expect(consentIdentity(withdrawal)).not.toEqual(consentIdentity(grant));
    expect(consentCommandSchema.safeParse({ ...grant, action: "withdraw" }).success).toBe(false);
  });
});
