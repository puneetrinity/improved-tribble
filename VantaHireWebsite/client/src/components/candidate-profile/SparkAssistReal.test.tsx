/** P6 real AI help and deal-breakers: request keys, proposal mapping, preview-then-accept. */
import { describe, expect, it, vi } from "vitest";
import { createSparkSession, type SparkProfileRead } from "@/lib/candidate-profile-api";
import { ASSIST_COPY, createInterpret } from "@/lib/spark-assist-adapter";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const H = (c: string) => c.repeat(64);
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const noWait = async () => {};
const versions = () => ({ draftVersion: 2, profileVersion: 0, preferenceVersion: 0, preferenceDraftRevision: 4 });
const proposal = (changes: unknown[]) => ({ schemaVersion: 1, status: "proposal", summary: "model summary", changes, proposalId: U(900), proposalHash: H("d"),
  expectedDraftVersion: 2, expectedProfileVersion: 0, expectedPreferenceVersion: 0, expectedPreferenceDraftRevision: 4, expiresAt: "2026-11-10T00:00:00.000Z" });

describe("real AI help", () => {
  it("a lost reply is re-sent with the same key; a changed request gets a new key", async () => {
    const bodies: any[] = [];
    const post = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      if (bodies.length === 1) throw new TypeError("network");
      return json(200, { schemaVersion: 1, status: "clarify", question: "Which job?" });
    }) as unknown as typeof fetch;
    const interpret = createInterpret({ versions, postFetcher: post, wait: noWait });
    await interpret("exclusions", "No travel", { baseVersion: "4" });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
    await interpret("exclusions", "No travel", { baseVersion: "4" });
    expect(bodies[2].idempotencyKey).toBe(bodies[0].idempotencyKey);
    await interpret("exclusions", "No travel, no on-call", { baseVersion: "4" });
    expect(bodies[3].idempotencyKey).not.toBe(bodies[0].idempotencyKey);
    expect(bodies[3]).toMatchObject({ schemaVersion: 1, use: "private_exclusions", sourceProposalId: null, sourceVersion: null, targetRowId: null, expectedPreferenceDraftRevision: 4 });
    expect(bodies[3]).not.toHaveProperty("subjectId");
  });

  it("after a definite failed answer, trying the same text again sends a fresh key (user decision 4 Nov)", async () => {
    const bodies: any[] = [];
    const post = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return bodies.length === 1 ? json(200, { schemaVersion: 1, status: "cannot_help", reason: "insufficient_evidence" })
        : json(200, { schemaVersion: 1, status: "clarify", question: "Which job?" });
    }) as unknown as typeof fetch;
    const interpret = createInterpret({ versions, postFetcher: post, wait: noWait });
    expect(await interpret("exclusions", "No travel", { baseVersion: "4" })).toEqual({ kind: "cannot_help", message: ASSIST_COPY.failed });
    await interpret("exclusions", "No travel", { baseVersion: "4" });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].idempotencyKey).not.toBe(bodies[0].idempotencyKey);
    // A clarify/proposal answer keeps its key: asking again replays it rather than buying a new one.
    await interpret("exclusions", "No travel", { baseVersion: "4" });
    expect(bodies[2].idempotencyKey).toBe(bodies[1].idempotencyKey);
  });

  it("shows enforceable rules and the candidate's own words; skips company rules (no registry yet)", async () => {
    const post = vi.fn(async () => json(200, proposal([
      { kind: "exclusions", restrictions: [{ kind: "no_travel" }, { kind: "exclude_company", companyId: U(5) }] },
      { kind: "preference_section", answer: { section: "private_notes", answered: true, value: ["No travel, no on-call"] } },
    ]))) as unknown as typeof fetch;
    const r = await createInterpret({ versions, postFetcher: post, wait: noWait })("exclusions", "No travel, no on-call", { baseVersion: "4" });
    expect(r.kind).toBe("proposal");
    if (r.kind !== "proposal") return;
    expect(r.ops).toEqual([{ op: "exclude", rule: { kind: "no_travel" } }, { op: "private_note", text: "No travel, no on-call" }]);
    expect(r.evidence).toBe("No travel, no on-call");
    expect(r.server).toMatchObject({ proposalId: U(900), proposalHash: H("d"), restrictions: [{ kind: "no_travel" }], notes: ["No travel, no on-call"] });
  });

  it("clarify has no made-up options; can't-help and errors use the approved copy", async () => {
    const replies = [json(200, { schemaVersion: 1, status: "clarify", question: "Which job?" }),
      json(200, { schemaVersion: 1, status: "cannot_help", reason: "unsafe" }),
      json(200, { schemaVersion: 1, status: "cannot_help", reason: "budget_unavailable" }),
      json(409, { code: "stale_edit" }), json(404, { code: "not_found" })];
    const post = vi.fn(async () => replies.shift()!) as unknown as typeof fetch;
    const i = createInterpret({ versions, postFetcher: post, wait: noWait });
    expect(await i("exclusions", "a", { baseVersion: "4" })).toEqual({ kind: "clarify", question: "Which job?", options: [] });
    expect(await i("exclusions", "b", { baseVersion: "4" })).toEqual({ kind: "cannot_help", message: ASSIST_COPY.outside });
    expect(await i("exclusions", "c", { baseVersion: "4" })).toEqual({ kind: "cannot_help", message: ASSIST_COPY.budget });
    expect(await i("exclusions", "d", { baseVersion: "4" })).toEqual({ kind: "cannot_help", message: ASSIST_COPY.stale });
    expect(await i("exclusions", "e", { baseVersion: "4" })).toEqual({ kind: "cannot_help", message: ASSIST_COPY.off });
  });

  it("asks for the password once when the server needs it, then resends the same request", async () => {
    const bodies: any[] = [];
    const post = vi.fn(async (_u: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init!.body)));
      return bodies.length === 1 ? json(403, { code: "recent_auth_required" }) : json(200, { schemaVersion: 1, status: "clarify", question: "Q" }); }) as unknown as typeof fetch;
    const askPassword = vi.fn(async () => true);
    const r = await createInterpret({ versions, postFetcher: post, wait: noWait, askPassword })("exclusions", "x", { baseVersion: "4" });
    expect(askPassword).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe("clarify");
    expect(JSON.stringify(bodies[1])).toBe(JSON.stringify(bodies[0]));
  });

  it("a correction needs the lookup suggestion on screen and sends its identity", async () => {
    const bodies: any[] = [];
    const post = vi.fn(async (_u: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init!.body)));
      return json(200, proposal([{ kind: "source_correction", fact: { factId: U(1), kind: "employment", targetRowId: null,
        value: { id: U(2), employer: "Freshworks", title: "Engineer", description: "", start: { value: "2019", precision: "year" }, end: { value: "2021", precision: "year" }, current: false }, evidence: [] } }])); }) as unknown as typeof fetch;
    expect(await createInterpret({ versions, postFetcher: post, wait: noWait, source: () => null })("correction", "ended 2021", { baseVersion: "2" }))
      .toEqual({ kind: "cannot_help", message: ASSIST_COPY.correction });
    expect(bodies).toHaveLength(0);
    const r = await createInterpret({ versions, postFetcher: post, wait: noWait, source: () => ({ proposalId: U(77), sourceVersion: 3 }) })("correction", "ended 2021", { baseVersion: "2" });
    expect(bodies[0]).toMatchObject({ use: "source_correction", sourceProposalId: U(77), sourceVersion: 3, targetRowId: null });
    expect(r.kind === "proposal" && r.ops).toEqual([{ op: "fact", field: "Engineer at Freshworks", value: "2019 – 2021" }]);
  });
});

function read(over: Partial<SparkProfileRead> = {}): SparkProfileRead {
  return { draftVersion: 2, profileVersion: 0, preferenceVersion: 0, draft: null, confirmedProfile: null, draftHash: H("a"),
    preferenceDraft: { preferenceDraftRevision: 4, preferenceDraftHash: H("b"), sections: {}, promotedPreferenceVersion: null, promotedDraftRevision: null,
      exclusions: [{ id: U(10), kind: "remote_only" }] },
    effectiveConsentRevision: 7, missingFields: [], capabilities: { canEdit: true, canConfirm: true, canEnrich: false, canRequestResume: false },
    pendingCommands: [], hasMorePendingCommands: false, ...over };
}

describe("deal-breakers through the server preview", () => {
  function server() {
    const posts: any[] = []; let n = 0; let rev = 4; const results = new Map<string, any>();
    let exclusions: any[] = [{ id: U(10), kind: "remote_only" }]; let notes: string[] = [];
    const post = vi.fn(async (u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)); posts.push({ url: u, body });
      if (u.endsWith("/exclusions/preview")) return json(200, { proposalId: U(500), proposalHash: H("e"), expectedPreferenceDraftRevision: body.expectedPreferenceDraftRevision,
        restrictions: body.restrictions.map((r: any, i: number) => ({ ...r, id: U(600 + i) })), effects: [], companies: [], unknownPolicy: "show_with_warning", expiresAt: "2026-11-10T00:00:00.000Z" });
      const id = `cmd-${++n}`;
      if (body.action === "remove_exclusion") exclusions = exclusions.filter(x => x.id !== body.payload.restrictionId);
      if (body.action === "accept_exclusions") exclusions = [...exclusions, { id: U(600), kind: "no_travel" }];
      if (body.action === "save_preference_section") notes = body.payload.value ?? [];
      results.set(id, { schemaVersion: 3, commandId: id, status: "applied", reason: null, preferenceDraftRevision: ++rev, preferenceDraftHash: H("c") });
      return json(202, { schemaVersion: 3, commandId: id, status: "pending" });
    });
    const get = vi.fn(async (u: string) => {
      if (u.endsWith("/profile")) return json(200, read({ preferenceDraft: { preferenceDraftRevision: rev, preferenceDraftHash: H("c"),
        sections: notes.length ? { private_notes: { answered: true, value: notes } } : {}, promotedPreferenceVersion: null, promotedDraftRevision: null, exclusions } }));
      return json(200, results.get(u.split("/").pop()!));
    });
    return { posts, post: post as unknown as typeof fetch, get: get as unknown as typeof fetch };
  }

  it("removes, previews and accepts the exact preview, saves notes, then returns the server's ids", async () => {
    const srv = server(); let k = 0;
    const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait, newKey: () => U(1000 + ++k) });
    const r = await s.saveDealbreakers("w-1", { exclusions: [{ id: "local-1", kind: "no_travel" }], notes: ["No on-call"] });
    expect(srv.posts.map(p => p.body.action ?? "preview")).toEqual(["remove_exclusion", "preview", "accept_exclusions", "save_preference_section"]);
    expect(srv.posts[0].body.payload).toEqual({ restrictionId: U(10) });
    expect(srv.posts[1].body).toMatchObject({ expectedPreferenceDraftRevision: 5, restrictions: [{ kind: "no_travel" }] });
    expect(srv.posts[1].body.restrictions[0]).not.toHaveProperty("id");
    expect(srv.posts[2].body.payload).toEqual({ proposalId: U(500), proposalHash: H("e") });
    expect(srv.posts[3].body.payload).toEqual({ section: "private_notes", answered: true, value: ["No on-call"] });
    expect(r.exclusions).toEqual([{ id: U(600), kind: "no_travel" }]);
    expect(r.preferencesVersion).toBe("7");
  });

  it("nothing changed sends nothing; an AI proposal is accepted with its exact identity", async () => {
    const srv = server();
    const s = createSparkSession(read(), { postFetcher: srv.post, fetcher: srv.get, wait: noWait });
    await s.saveDealbreakers("w-2", { exclusions: [{ id: U(10), kind: "remote_only" }], notes: [] });
    expect(srv.posts).toHaveLength(0);
    await s.acceptInterpretation("a-1", { proposalId: U(900), proposalHash: H("d") });
    expect(srv.posts[0].body).toMatchObject({ schemaVersion: 3, action: "accept_interpretation", payload: { proposalId: U(900), proposalHash: H("d") }, idempotencyKey: expect.any(String) });
    expect(Object.keys(srv.posts[0].body.payload)).toEqual(["proposalId", "proposalHash"]);
  });
});

import { needsReconfirm, RECONFIRM_NOTE } from "@/lib/candidate-profile-api";
import { describeRule } from "./SparkAssist";
import { exclusionEffects } from "@shared/candidate-spark-v3";
import { readCandidateOrigin, allowsPublicContact, candidateDisplayName, candidateLocationText } from "@/lib/sourcing-candidate-origin";

describe("approved wording and status (4 Nov)", () => {
  it("deal-breaker lines are the server's exact effect text", () => {
    expect(describeRule({ kind: "remote_only" })).toBe(exclusionEffects.remote_only);
    expect(describeRule({ kind: "no_travel" })).toBe(exclusionEffects.no_travel);
    expect(describeRule({ kind: "exclude_company", companyId: "c", companyName: "Acme", domain: null })).toBe(exclusionEffects.exclude_company);
  });
  it("re-confirm note only when the server says confirmation is required", () => {
    const caps = { canEdit: true, canConfirm: true, canEnrich: false, canRequestResume: false };
    expect(needsReconfirm({ state: "confirmed", publicationActive: false, capabilities: { ...caps, canDiscover: false, discoveryBlockedReason: "confirmation_required" } })).toBe(true);
    expect(needsReconfirm({ state: "confirmed", publicationActive: false, capabilities: { ...caps, canDiscover: false, discoveryBlockedReason: "feature_unavailable" } })).toBe(false);
    expect(needsReconfirm({ state: "confirmed", publicationActive: false, capabilities: caps })).toBe(false);
    expect(needsReconfirm({ state: "confirmed", publicationActive: true, capabilities: { ...caps, canDiscover: true, discoveryBlockedReason: "confirmation_required" } })).toBe(false);
    // Never confirmed: the server also reports confirmation_required, but "again" would be untrue.
    expect(needsReconfirm({ state: "draft", publicationActive: false, capabilities: { ...caps, canDiscover: false, discoveryBlockedReason: "confirmation_required" } })).toBe(false);
    expect(RECONFIRM_NOTE).toBe("Your preferences are saved. Recruiters won't see your profile until you confirm it again.");
  });
  it("spark network candidates get no public contact controls", () => {
    const o = readCandidateOrigin({ version: 1, kind: "candidate_network" });
    expect(o.kind).toBe("candidate_network");
    expect(allowsPublicContact(o)).toBe(false);
  });
  it("spark network cards show the published name and location, never a provider guess (browser finding 4 Nov)", () => {
    const spark = readCandidateOrigin({ version: 1, kind: "candidate_network" });
    expect(candidateDisplayName(spark, null, "Sparky Network")).toBe("Sparky Network");
    expect(candidateDisplayName(spark, "Provider Name", null)).toBe("Unknown Candidate");
    expect(candidateLocationText(spark, "Somewhere Else", "Bengaluru, India")).toBe("Bengaluru, India");
    const pub = readCandidateOrigin(undefined);
    expect(candidateDisplayName(pub, "Provider Name", "hint")).toBe("Provider Name");
    expect(candidateLocationText(pub, "Pune, India", "hint")).toBe("Pune, India");
  });
});
