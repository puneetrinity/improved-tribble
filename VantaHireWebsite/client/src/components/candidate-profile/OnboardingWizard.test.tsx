/**
 * spark onboarding → real commands: v2 save_draft for profile facts, v3 preference
 * sections, promotion and confirm, with server-acknowledged versions and fixed keys.
 */
import { describe, expect, it, vi } from "vitest";
import { createSparkSession, type SparkProfileRead } from "@/lib/candidate-profile-api";

const BASE = "/api/candidate/product/profile";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const H1 = "a".repeat(64), H2 = "b".repeat(64), H3 = "c".repeat(64);

function read(over: Partial<SparkProfileRead> = {}): SparkProfileRead {
  return { draftVersion: 2, profileVersion: 0, preferenceVersion: 0, draft: null, confirmedProfile: null, draftHash: H1,
    preferenceDraft: { preferenceDraftRevision: 4, preferenceDraftHash: H2, sections: {}, promotedPreferenceVersion: null, promotedDraftRevision: null },
    effectiveConsentRevision: 7, missingFields: [], capabilities: { canEdit: true, canConfirm: true, canEnrich: false, canRequestResume: false },
    pendingCommands: [], hasMorePendingCommands: false, ...over };
}

/** Commands get ids cmd-1, cmd-2…; each applied receipt bumps the revision it touches. */
function server(opts: { fail?: number; uncertain?: number; reject?: Record<number, string> } = {}) {
  const posts: any[] = []; let n = 0; const s = { draft: 2, pref: 4, prefVersion: 0 };
  const results = new Map<string, any>();
  const post = vi.fn(async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)); posts.push(body);
    if (opts.uncertain && posts.length === opts.uncertain) throw new TypeError("network");
    const prior = [...results.entries()].find(([, r]) => r.key === body.idempotencyKey);
    if (prior) return json(202, { schemaVersion: body.schemaVersion, commandId: prior[0], status: "pending" });
    const id = `cmd-${++n}`;
    let r: any;
    if (opts.reject?.[n]) r = { status: "rejected", reason: opts.reject[n] };
    else if (body.action === "save_draft") r = { status: "applied", reason: null, draftVersion: ++s.draft, profileVersion: 0, preferenceVersion: s.prefVersion };
    else if (body.action === "promote_preferences") r = { status: "applied", reason: null, preferenceVersion: ++s.prefVersion, preferenceDraftRevision: s.pref, preferenceDraftHash: H3 };
    else if (body.action === "confirm") r = { status: "applied", reason: null, profileVersion: 1 };
    else r = { status: "applied", reason: null, preferenceDraftRevision: ++s.pref, preferenceDraftHash: H3 };
    results.set(id, { ...r, key: body.idempotencyKey, schemaVersion: body.schemaVersion, commandId: id });
    return json(202, { schemaVersion: body.schemaVersion, commandId: id, status: "pending" });
  });
  const get = vi.fn(async (u: string) => {
    const id = u.split("/").pop()!; const r = results.get(id);
    return r ? json(200, { ...r, key: undefined }) : json(404, { code: "not_found" });
  });
  return { posts, post: post as unknown as typeof fetch, get: get as unknown as typeof fetch, state: s };
}
const noWait = async () => {};
let k = 0; const newKey = () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`;
const prefs: any = { desiredRoles: ["Backend engineer"], preferredSeniority: ["Senior"], workArrangements: ["remote"], remoteRegions: { mode: "worldwide" },
  locations: { mode: "specific", places: [{ city: "Bengaluru", countryCode: "IN" }] }, relocation: { mode: "discuss", destinations: [] },
  employmentTypes: ["permanent"], availability: { mode: "notice_days", days: 60 }, compensation: { mode: "open_to_discussion" } };

describe("spark onboarding commands", () => {
  it("saves profile facts as a v2 save_draft with the acknowledged versions", async () => {
    const srv = server(); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    const r = await s.save("w-1", { kind: "profile_draft", profile: { displayName: "Synthetic" } as any });
    expect(srv.posts[0]).toMatchObject({ schemaVersion: 2, action: "save_draft", expectedDraftVersion: 2, expectedProfileVersion: 0, expectedPreferenceVersion: 0 });
    expect(srv.posts[0]).not.toHaveProperty("expectedPreferenceDraftRevision");
    expect(r.profileVersion).toBe("3");
  });

  it("saves each answered preference section as its own v3 command, chaining the draft revision", async () => {
    const srv = server(); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    const r = await s.save("w-2", { kind: "preferences_draft", preferences: prefs, answered: ["where", "how"] });
    expect(srv.posts.map(p => p.payload.section)).toEqual(["location", "relocation", "arrangement", "employment_types", "availability"]);
    expect(srv.posts.map(p => p.expectedPreferenceDraftRevision)).toEqual([4, 5, 6, 7, 8]);
    expect(srv.posts.every(p => p.schemaVersion === 3 && p.action === "save_preference_section" && p.payload.answered === true)).toBe(true);
    expect(srv.posts[2].payload.value).toEqual({ workArrangements: ["remote"], remoteRegions: { mode: "worldwide" } });
    expect(r.preferencesVersion).toBe("9");
  });

  it("a retry of the same wizard save re-sends only what didn't finish, with the same key", async () => {
    const srv = server({ reject: { 2: "authority_unavailable_terminal" } });
    const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    await expect(s.save("w-3", { kind: "preferences_draft", preferences: prefs, answered: ["roles", "pay"] })).rejects.toBeTruthy();
    expect(srv.posts.map(p => p.payload.section)).toEqual(["roles", "compensation"]);
    const failedKey = srv.posts[1].idempotencyKey;
    await expect(s.save("w-3", { kind: "preferences_draft", preferences: prefs, answered: ["roles", "pay"] })).rejects.toBeTruthy();
    expect(srv.posts).toHaveLength(3);
    expect(srv.posts[2].payload.section).toBe("compensation");
    expect(srv.posts[2].idempotencyKey).toBe(failedKey);
  });

  it("a lost response is re-sent with the identical body, so the server keeps one command", async () => {
    const srv = server({ uncertain: 1 }); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    await s.save("w-4", { kind: "work_authorisation", entries: [{ countryCode: "GB", status: "needs_visa" }] });
    expect(srv.posts).toHaveLength(2);
    expect(JSON.stringify(srv.posts[0])).toBe(JSON.stringify(srv.posts[1]));
    expect(srv.posts[0].payload).toEqual({ section: "authorisation", answered: true, value: [{ countryCode: "GB", status: "needs_visa" }] });
  });

  it("confirm promotes the reviewed preferences, then confirms the exact hashes and consent revision", async () => {
    const srv = server(); let loads = 0;
    const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    const fetchProfile = async () => ({ kind: "ready" as const, profile: loads++ === 0 ? read()
      : read({ preferenceVersion: 1, preferenceDraft: { preferenceDraftRevision: 4, preferenceDraftHash: H3, sections: {}, promotedPreferenceVersion: 1, promotedDraftRevision: 4 } }) });
    await s.confirm({ profileVersion: "2", preferencesVersion: "4" }, fetchProfile);
    expect(srv.posts.map(p => p.action)).toEqual(["promote_preferences", "confirm"]);
    expect(srv.posts[0].payload).toEqual({ preferenceDraftHash: H2 });
    expect(srv.posts[1]).toMatchObject({ schemaVersion: 3, expectedPreferenceVersion: 1, expectedPreferenceDraftRevision: 4,
      payload: { draftHash: H1, preferenceDraftHash: H3, consentRevision: 7 } });
  });

  it("accepts résumé suggestions as one v3 accept_source and returns the server draft", async () => {
    const srv = server(); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    const payload = { proposalId: "55555555-5555-4555-8555-555555555555", sourceVersion: 1, proposalHash: "e".repeat(64), selectedFactIds: ["x"], replaceFactIds: [], corrections: [] };
    const draft = await s.acceptSource("rv-1", payload, async () => ({ kind: "ready", profile: read({ draftVersion: 3, draft: { skills: ["Kafka"] } as any }) }));
    expect(srv.posts[0]).toMatchObject({ schemaVersion: 3, action: "accept_source", expectedDraftVersion: 2, expectedPreferenceDraftRevision: 4, payload });
    expect(draft).toEqual({ skills: ["Kafka"] });
    expect(s.versions().draftVersion).toBe(3);
    await s.acceptSource("rv-1", payload, async () => ({ kind: "ready", profile: read({ draftVersion: 3, draft: { skills: ["Kafka"] } as any }) }));
    expect(srv.posts[1].idempotencyKey).toBe(srv.posts[0].idempotencyKey);
  });

  it("refuses to confirm an edit that landed while the preferences were being promoted", async () => {
    const srv = server(); let loads = 0;
    const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    const fetchProfile = async () => ({ kind: "ready" as const, profile: loads++ === 0 ? read()
      : read({ draftVersion: 3, draftHash: H3, preferenceVersion: 1, preferenceDraft: { preferenceDraftRevision: 4, preferenceDraftHash: H3, sections: {}, promotedPreferenceVersion: 1, promotedDraftRevision: 4 } }) });
    await expect(s.confirm({ profileVersion: "2", preferencesVersion: "4" }, fetchProfile)).rejects.toMatchObject({ code: "confirmation_conflict" });
    expect(srv.posts.map(p => p.action)).toEqual(["promote_preferences"]);
  });

  it("saves exactly the sections asked for, nothing assumed", async () => {
    const srv = server(); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    await s.save("w-9", { kind: "preference_sections", preferences: { ...prefs, employmentTypes: ["gig_freelance"] }, sections: ["employment_types"] });
    expect(srv.posts).toHaveLength(1);
    expect(srv.posts[0].payload).toEqual({ section: "employment_types", answered: true, value: ["gig_freelance"] });
  });

  it("refuses to confirm when the profile moved on since the review", async () => {
    const srv = server(); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    await expect(s.confirm({ profileVersion: "2", preferencesVersion: "4" }, async () => ({ kind: "ready", profile: read({ draftVersion: 3 }) })))
      .rejects.toMatchObject({ code: "confirmation_conflict" });
    expect(srv.posts).toHaveLength(0);
  });

  it("asks for the password again instead of confirming when sign-in is too old", async () => {
    const srv = server(); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    const stale = read({ preferenceVersion: 1, capabilities: { canEdit: true, canConfirm: false, confirmBlockedReason: "recent_auth_required", canEnrich: false, canRequestResume: false } as any,
      preferenceDraft: { preferenceDraftRevision: 4, preferenceDraftHash: H2, sections: {}, promotedPreferenceVersion: 1, promotedDraftRevision: 4 } });
    await expect(s.confirm({ profileVersion: "2", preferencesVersion: "4" }, async () => ({ kind: "ready", profile: stale })))
      .rejects.toMatchObject({ status: 403, code: "recent_auth_required" });
    expect(srv.posts).toHaveLength(0);
  });

  it("without consent recorded, confirm is refused rather than sent", async () => {
    const srv = server(); const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey });
    const p = read({ effectiveConsentRevision: null, preferenceVersion: 1,
      preferenceDraft: { preferenceDraftRevision: 4, preferenceDraftHash: H2, sections: {}, promotedPreferenceVersion: 1, promotedDraftRevision: 4 } });
    await expect(s.confirm({ profileVersion: "2", preferencesVersion: "4" }, async () => ({ kind: "ready", profile: p }))).rejects.toMatchObject({ code: "consent_required" });
    expect(srv.posts).toHaveLength(0);
  });
});
