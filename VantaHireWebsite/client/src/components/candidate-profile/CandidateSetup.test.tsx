/** /candidate-setup: record sign-up consent once, wait for it, then the wizard on the real profile. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/hooks/use-auth";
import { CandidateSetupPage, savedFrom, toSparkEvent, type SetupDeps } from "@/pages/candidate-setup-page";
import { payFromCompensation } from "./OnboardingWizard";
import { CONSENT_COPY_CURRENT_HASH } from "./consent-copy";
import { ensureSparkFoundation } from "@/lib/candidate-profile-api";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); window.history.replaceState(null, "", "/candidate-setup"); });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const consent = (over: Record<string, unknown> = {}) => ({ schemaVersion: 2, consentRevision: 0, desiredAction: null, acknowledgedRevision: 0, acknowledgedAction: null,
  desiredSchemaVersion: null, acknowledgedSchemaVersion: null, deliveryStatus: "none", ...over });
const ACTIVE = consent({ consentRevision: 1, desiredAction: "grant", acknowledgedRevision: 1, acknowledgedAction: "grant", deliveryStatus: "delivered" });
const profile = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 3, draftVersion: 2, profileVersion: 0, preferenceVersion: 0, draft: null, confirmedProfile: null, preferences: null,
  preferenceDraft: { preferenceDraftRevision: 5, preferenceDraftHash: "b".repeat(64), sections: {}, exclusions: [], promotedPreferenceVersion: null, promotedDraftRevision: null },
  publicationActive: false, draftHash: null, effectiveConsentRevision: 1, missingFields: [], pendingCommands: [], hasMorePendingCommands: false,
  capabilities: { canEdit: true, canConfirm: false, confirmBlockedReason: "incomplete_profile", canEnrich: false, canRequestResume: false }, ...over,
});

type Route = (init?: RequestInit) => Response;
async function mount(routes: Record<string, Route | Route[]>, opts: { spark?: boolean } = {}) {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const calls: { key: string; body: any }[] = [];
  const handle = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost"), key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({ key, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
    const r = routes[key];
    if (Array.isArray(r)) return (r.length > 1 ? r.shift()! : r[0]!)(init);
    if (r) return r(init);
    if (key === "GET /api/candidate/product") return json(200, { schemaVersion: 1, state: "linked", profileVersion: 0, preferenceVersion: 0, publicationActive: false });
    if (url.pathname === "/api/client-config") return json(200, { candidateSparkSignupEnabled: opts.spark ?? true });
    return json(404, {});
  };
  vi.stubGlobal("fetch", vi.fn(handle));
  const deps: SetupDeps = { fetcher: handle as typeof fetch, postFetcher: handle as typeof fetch, wait: async () => undefined };
  const auth = { user: { id: 1, role: "candidate", emailVerified: true, firstName: "Synthetic", username: "s@example.com" }, logoutMutation: { mutate: vi.fn() } } as any;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}><CandidateSetupPage deps={deps} /></AuthContext.Provider></QueryClientProvider>); });
  await flush();
  return calls;
}
const PROFILE = "GET /api/candidate/product/profile", CONSENT = "GET /api/candidate/product/consent";
const ACTIVATE = "POST /api/candidate/product/consent/signup-intent/activate", GRANT = "POST /api/candidate/product/consent";
const LOOKUP = "POST /api/candidate/product/lookups", COMMANDS = "POST /api/candidate/product/profile/commands";
const ATTEMPT = "20000000-0000-4000-8000-000000000001", PROPOSAL = "30000000-0000-4000-8000-000000000001";
const lookupStatus = (state: string, over: Record<string, unknown> = {}) => ({ schemaVersion: 1, attemptId: ATTEMPT, state, reason: null, proposalId: null, canRequestLinkedin: false, waitLimitMs: 20000, ...over });
const NOT_FOUND: Record<string, Route> = { [LOOKUP]: () => json(202, lookupStatus("not_found", { canRequestLinkedin: true })) };
const fact = (n: number, kind: string, value: unknown) => ({ factId: `40000000-0000-4000-8000-00000000000${n}`, kind, targetRowId: null, value, evidence: [{ quote: "q" }] });
const proposal = { schemaVersion: 1, proposalId: PROPOSAL, sourceId: ATTEMPT, sourceVersion: 1, proposalHash: "c".repeat(64), reviewNotes: [], expiresAt: "2026-11-09T00:00:00.000Z",
  facts: [fact(1, "displayName", "Synthetic Person"), fact(2, "headline", "Backend engineer"), fact(3, "skill", "Python")] };
/** Every command is applied at once; its read returns the next draft version. */
function commandServer() {
  let n = 0; const ids: string[] = [];
  return {
    [COMMANDS]: (init?: RequestInit) => { const id = `50000000-0000-4000-8000-00000000000${++n}`; ids.push(id); void init; return json(202, { schemaVersion: 3, commandId: id, status: "pending" }); },
    ...Object.fromEntries([1, 2, 3, 4].map(i => [`GET /api/candidate/product/profile/commands/50000000-0000-4000-8000-00000000000${i}`,
      () => json(200, { schemaVersion: 3, commandId: `50000000-0000-4000-8000-00000000000${i}`, status: "applied", reason: null, draftVersion: 3, preferenceDraftRevision: 5 })])),
  } as Record<string, Route>;
}

describe("candidate setup", () => {
  it("reuses the foundation key after a lost reply and never grants consent itself", async () => {
    const bodies: unknown[] = [];
    const get = vi.fn(async () => json(200, {schemaVersion:1,state:"not_started"}));
    const post = vi.fn(async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if(bodies.length===1)throw Error("lost reply");
      get.mockImplementation(async () => json(200, {schemaVersion:1,state:"linked"}));
      return json(202, {schemaVersion:1,status:"pending"});
    });
    const deps = {fetcher:get as typeof fetch,postFetcher:post as typeof fetch,wait:async()=>undefined};
    await expect(ensureSparkFoundation(ATTEMPT,deps)).rejects.toThrow();
    expect(await ensureSparkFoundation(ATTEMPT,deps)).toBe("linked");
    expect(bodies).toEqual([{schemaVersion:1,idempotencyKey:ATTEMPT},{schemaVersion:1,idempotencyKey:ATTEMPT}]);
    expect(post.mock.calls.every(c=>c[0]==="/api/candidate/product/foundation")).toBe(true);
  });
  it("bounds pending foundation polling without treating it as linked", async () => {
    const get=vi.fn(async()=>json(200,{schemaVersion:1,state:"pending"})),post=vi.fn();
    expect(await ensureSparkFoundation(ATTEMPT,{fetcher:get as typeof fetch,postFetcher:post as typeof fetch,wait:async()=>undefined})).toBe("pending");
    expect(get).toHaveBeenCalledTimes(21);expect(post).not.toHaveBeenCalled();
  });
  it("creates the owner binding before reading or activating consent", async () => {
    const calls = await mount({
      "GET /api/candidate/product": [() => json(200, {schemaVersion:1,state:"not_started"}), () => json(200, {schemaVersion:1,state:"pending"}), () => json(200, {schemaVersion:1,state:"linked"})],
      "POST /api/candidate/product/foundation": () => json(202, {schemaVersion:1,status:"pending"}),
      [CONSENT]: () => json(200, ACTIVE), [PROFILE]: () => json(200, profile()), ...NOT_FOUND,
    });
    const ensure = calls.findIndex(c => c.key === "POST /api/candidate/product/foundation");
    expect(ensure).toBeGreaterThan(-1);
    expect(UUID.test(calls[ensure]!.body.idempotencyKey)).toBe(true);
    expect(calls.findIndex(c => c.key === CONSENT)).toBeGreaterThan(ensure);
    expect(text()).toContain("Let's start");
  });
  it("never activates consent or lookup while the owner binding is held", async () => {
    const calls = await mount({"GET /api/candidate/product": () => json(200, {schemaVersion:1,state:"held"})});
    expect(calls.some(c => [CONSENT, ACTIVATE, LOOKUP].includes(c.key))).toBe(false);
    expect(text()).toContain("Profile setup needs a check by our team.");
  });
  it("goes to the dashboard when spark sign-up is off", async () => {
    await mount({}, { spark: false });
    expect(window.location.pathname).toBe("/my-dashboard");
  });

  it("records the sign-up consent once, waits for it, then opens the wizard on the real versions", async () => {
    const calls = await mount({ [CONSENT]: [() => json(200, consent()), () => json(200, consent({ consentRevision: 1, desiredAction: "grant", deliveryStatus: "pending" })), () => json(200, ACTIVE)],
      [ACTIVATE]: () => json(200, { schemaVersion: 2, status: "activated", receipt: { schemaVersion: 2, eventId: "10000000-0000-4000-8000-000000000001", consentRevision: 1, status: "recorded", replayed: false } }),
      [PROFILE]: () => json(200, profile()), ...NOT_FOUND }, { });
    expect(calls.filter(c => c.key === ACTIVATE)).toHaveLength(1);
    expect(calls.find(c => c.key === ACTIVATE)!.body).toEqual({ schemaVersion: 2 });
    expect(calls.some(c => c.key === GRANT)).toBe(false);
    expect(text()).toContain("Let's start");
  });

  it("skips activation when consent is already recorded; a confirmed profile goes to the dashboard", async () => {
    const calls = await mount({ [CONSENT]: () => json(200, ACTIVE), [PROFILE]: () => json(200, profile({ profileVersion: 1 })) }, { });
    expect(calls.some(c => c.key === ACTIVATE)).toBe(false);
    expect(window.location.pathname).toBe("/my-dashboard");
  });

  it("without a usable sign-up acceptance, shows the approved consent text and sends its exact version and fingerprint", async () => {
    const calls = await mount({ [CONSENT]: [() => json(200, consent({ consentRevision: 3, desiredAction: "withdraw", acknowledgedAction: "withdraw", acknowledgedRevision: 3, deliveryStatus: "delivered" })),
      () => json(200, consent({ consentRevision: 3 })), () => json(200, ACTIVE)],
      [ACTIVATE]: () => json(200, { schemaVersion: 2, status: "superseded", receipt: null }), [GRANT]: () => json(202, {}), [PROFILE]: () => json(200, profile()), ...NOT_FOUND },
      { });
    expect(text()).toContain("Set up your ealana matching profile");
    const agree = Array.from(document.querySelectorAll('button[role="checkbox"]'))[0] as HTMLButtonElement;
    await act(async () => { agree.click(); }); await flush(1);
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Agree and continue")!.click(); }); await flush();
    const grant = calls.find(c => c.key === GRANT)!.body;
    expect(grant).toMatchObject({ schemaVersion: 2, action: "grant", expectedConsentRevision: 3, copyVersion: 2, copyHash: CONSENT_COPY_CURRENT_HASH });
    expect(UUID.test(grant.idempotencyKey)).toBe(true);
    expect(text()).toContain("Let's start");
  });

  it("an account held for review stops before the wizard, with no retry button", async () => {
    await mount({ [CONSENT]: () => json(200, consent({ consentRevision: 1, desiredAction: "grant", deliveryStatus: "identity_review_required" })) }, { });
    expect(text()).toContain("Profile setup needs a check by our team.");
    expect(Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Try again")).toBe(false);
    expect(text()).not.toContain("Let's start");
  });

  it("a lost grant reply is retried with the same grant, never by asking for consent again", async () => {
    let grants = 0;
    const calls = await mount({ [CONSENT]: [() => json(200, consent({ consentRevision: 2 })), () => json(200, consent({ consentRevision: 2 })), () => json(200, consent({ consentRevision: 2 })), () => json(200, ACTIVE)],
      [ACTIVATE]: () => json(200, { schemaVersion: 2, status: "none", receipt: null }),
      [GRANT]: () => (++grants === 1 ? (() => { throw new TypeError("network"); })() : json(202, {})), [PROFILE]: () => json(200, profile()), ...NOT_FOUND },
      { });
    const agree = document.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => { agree.click(); }); await flush(1);
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Agree and continue")!.click(); }); await flush();
    expect(text()).toContain("We couldn't check your setup status.");
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Try again")!.click(); }); await flush();
    const sent = calls.filter(c => c.key === GRANT).map(c => c.body);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(text()).not.toContain("Set up your ealana matching profile");
    expect(text()).toContain("Let's start");
  });

  it("without the profile lookup, goes to the dashboard instead of a lookup that never ran", async () => {
    await mount({ [CONSENT]: () => json(200, ACTIVE), [PROFILE]: () => json(200, profile()), [LOOKUP]: () => json(404, { code: "not_found" }) });
    expect(window.location.pathname).toBe("/my-dashboard");
    expect(text()).not.toContain("Looking up your professional profile");
  });

  it("shows the lookup as 'Is this you?'; yes accepts every suggestion on the server", async () => {
    const calls = await mount({ [CONSENT]: () => json(200, ACTIVE), [PROFILE]: () => json(200, profile({ draft: { ...proposalDraft() } })),
      [LOOKUP]: () => json(202, lookupStatus("running")), [`GET /api/candidate/product/lookups/${ATTEMPT}`]: () => json(200, lookupStatus("review_ready", { proposalId: PROPOSAL })),
      [`GET /api/candidate/product/sources/${ATTEMPT}/proposals/${PROPOSAL}`]: () => json(200, proposal), ...commandServer() });
    expect(calls.find(c => c.key === LOOKUP)!.body).toMatchObject({ schemaVersion: 1, kind: "email", expectedConsentRevision: 1 });
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Let's start")!.click(); }); await flush();
    expect(text()).toContain("Is this you?");
    expect(text()).toContain("Synthetic Person");
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Yes, this is me"))!.click(); }); await flush();
    const cmd = calls.find(c => c.key === COMMANDS)!.body;
    expect(cmd).toMatchObject({ schemaVersion: 3, action: "accept_source", payload: { proposalId: PROPOSAL, sourceVersion: 1, proposalHash: "c".repeat(64),
      selectedFactIds: proposal.facts.map(f => f.factId), corrections: [] } });
  });

  it("'This isn't me' records not_me on the server, then offers the LinkedIn lookup", async () => {
    let linkedin = false;
    const calls = await mount({ [CONSENT]: () => json(200, ACTIVE), [PROFILE]: () => json(200, profile({ draft: proposalDraft() })),
      [LOOKUP]: (init) => { if (JSON.parse(String(init!.body)).kind === "linkedin") { linkedin = true; return json(202, lookupStatus("not_found")); } return json(202, lookupStatus("review_ready", { proposalId: PROPOSAL })); },
      [`GET /api/candidate/product/sources/${ATTEMPT}/proposals/${PROPOSAL}`]: () => json(200, proposal),
      [`GET /api/candidate/product/lookups/${ATTEMPT}`]: () => json(200, lookupStatus("rejected", { reason: "not_me", canRequestLinkedin: true })), ...commandServer() });
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Let's start")!.click(); }); await flush();
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("This isn't me"))!.click(); }); await flush();
    expect(calls.find(c => c.key === COMMANDS)!.body).toMatchObject({ action: "reject_source", payload: { proposalId: PROPOSAL, sourceVersion: 1, proposalHash: "c".repeat(64), reason: "not_me" } });
    expect(text()).toContain("LinkedIn profile link");
    const input = document.getElementById("linkedin-url") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "linkedin.com/in/synthetic-person"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Look me up"))!.click(); }); await flush();
    expect(linkedin).toBe(true);
    expect(calls.filter(c => c.key === LOOKUP).at(-1)!.body).toMatchObject({ kind: "linkedin", url: "https://www.linkedin.com/in/synthetic-person" });
  });

  it("a session that ended shows the signed-out screen, not an error", async () => {
    await mount({ [CONSENT]: () => json(401, { error: "Not authenticated" }) });
    expect(text()).toContain("You've been signed out");
    expect(text()).not.toContain("We couldn't check your setup status.");
  });

  it("a returning candidate resumes from the saved draft: no new lookup, and untouched answers survive the first save", async () => {
    const draft = { ...proposalDraft(), displayName: "Synthetic Person", headline: "Backend engineer", skills: ["Python"],
      employment: [{ id: "60000000-0000-4000-8000-000000000001", employer: "Kitebyte", title: "Backend Engineer", description: "Built the payments API", start: { value: "2021-04", precision: "month" }, end: null, current: true }] };
    const sections = { roles: { answered: true, value: { desiredRoles: ["Backend engineer"], preferredSeniority: [] } } };
    const calls = await mount({ [CONSENT]: () => json(200, ACTIVE),
      [PROFILE]: () => json(200, profile({ draft, preferenceDraft: { ...profile().preferenceDraft, sections } })), ...commandServer() });
    expect(calls.some(c => c.key === LOOKUP)).toBe(false);
    expect(text()).toContain("Your skills");
    expect(text()).not.toContain("Is this you?");
    // Add a skill and continue: the saved name, headline and work history go back unchanged.
    const input = document.querySelector('input[placeholder="Add a skill and press Enter"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Go"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }); await flush(2);
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent?.startsWith("Next"))!.click(); }); await flush();
    const save = calls.find(c => c.key === COMMANDS)!.body;
    expect(save).toMatchObject({ action: "save_draft", expectedDraftVersion: 2 });
    expect(save.payload.profile).toMatchObject({ displayName: "Synthetic Person", headline: "Backend engineer", skills: ["Python", "Go"] });
    expect(save.payload.profile.employment[0]).toMatchObject({ employer: "Kitebyte", description: "Built the payments API" });
  });

  it("saves still pending: goes to the dashboard rather than editing over them", async () => {
    await mount({ [CONSENT]: () => json(200, ACTIVE), [PROFILE]: () => json(200, profile({ pendingCommands: [{ commandId: "70000000-0000-4000-8000-000000000001", action: "save_draft", status: "pending", reason: null }] })), ...NOT_FOUND });
    expect(window.location.pathname).toBe("/my-dashboard");
  });

  it("a wizard question counts as answered only when all its sections are; saved pay comes back into the pay fields", () => {
    const a = (value: unknown) => ({ answered: true, value });
    const p = profile({ draft: proposalDraft(), preferenceDraft: { ...profile().preferenceDraft, sections: {
      roles: a({ desiredRoles: ["X"], preferredSeniority: [] }), location: a({ mode: "anywhere" }),
      compensation: a({ mode: "target", currency: "INR", period: "annual", component: "ctc", targetMin: "2500000.00", targetMax: "3000000.00", hardMinimum: "2500000.00" }) } } });
    expect(savedFrom(p as never)!.answered).toEqual(["roles", "pay"]); // "where" needs relocation too
    expect(payFromCompensation({ mode: "target", currency: "INR", period: "annual", component: "ctc", targetMin: "2500000.00", targetMax: "3000000.00", hardMinimum: "2500000.00" } as never))
      .toEqual({ open: false, pay: { min: "25", max: "30", firm: true } });
    expect(payFromCompensation({ mode: "open_to_discussion" } as never)!.open).toBe(true);
  });

  const start = async () => { await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Let's start")!.click(); }); await flush(); };
  const base = () => ({ [CONSENT]: () => json(200, ACTIVE), [PROFILE]: () => json(200, profile()) });

  it("an unsettled (held) lookup is never shown as 'not found' and offers no paid retry", async () => {
    const calls = await mount({ ...base(), [LOOKUP]: () => json(202, lookupStatus("held", { reason: "outcome_unknown" })) });
    await start();
    expect(text()).toContain("We couldn't confirm the lookup outcome.");
    expect(text()).toContain("You can add your details yourself on your profile page.");
    expect(text()).not.toContain("couldn't find");
    expect(document.getElementById("linkedin-url")).toBeNull();
    expect(Array.from(document.querySelectorAll("a")).find(a => a.textContent === "Go to my profile")!.getAttribute("href")).toBe("/my-dashboard#profile");
    expect(calls.filter(c => c.key === LOOKUP)).toHaveLength(1);
  });

  it("a signed-out lookup shows the signed-out screen", async () => {
    await mount({ ...base(), [LOOKUP]: () => json(401, { error: "Not authenticated" }) });
    expect(text()).toContain("You've been signed out");
  });

  it("an unreachable lookup can be tried again, asking about the same request (same key)", async () => {
    const calls = await mount({ ...base(), [LOOKUP]: [() => json(503, {}), () => json(202, lookupStatus("review_ready", { proposalId: PROPOSAL }))],
      [`GET /api/candidate/product/sources/${ATTEMPT}/proposals/${PROPOSAL}`]: () => json(200, proposal) });
    await start();
    expect(text()).toContain("We couldn't check your professional profile");
    expect(text()).not.toContain("couldn't find");
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Try again")!.click(); }); await flush();
    const keys = calls.filter(c => c.key === LOOKUP).map(c => c.body.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(text()).toContain("Is this you?");
  });

  it("a genuine miss offers LinkedIn only when the server allows it", async () => {
    await mount({ ...base(), [LOOKUP]: () => json(202, lookupStatus("not_found", { canRequestLinkedin: true })) });
    await start();
    expect(document.getElementById("linkedin-url")).not.toBeNull();
    act(() => root!.unmount()); root = null; host!.remove();
    await mount({ ...base(), [LOOKUP]: () => json(202, lookupStatus("not_found", { canRequestLinkedin: false })) });
    await start();
    expect(document.getElementById("linkedin-url")).toBeNull();
    expect(text()).toContain("We couldn't find your profile");
    expect(text()).toContain("You can add your details yourself on your profile page.");
  });

  // Résumé step: shown only when the server says reading is available; upload → read → review → accept_source.
  // A first visit: the lookup finds the candidate, they say yes, then the résumé step (when available).
  const lookupYes = (resumeOn: boolean) => ({ [CONSENT]: () => json(200, ACTIVE),
    [PROFILE]: () => json(200, profile({ draft: proposalDraft(), capabilities: { ...profile().capabilities, canRequestResume: resumeOn } })),
    [LOOKUP]: () => json(202, lookupStatus("review_ready", { proposalId: PROPOSAL })),
    [`GET /api/candidate/product/sources/${ATTEMPT}/proposals/${PROPOSAL}`]: () => json(200, proposal) });
  const yes = async () => { await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Yes, this is me"))!.click(); }); await flush(); };
  const RCMD = "60000000-0000-4000-8000-0000000000aa", RSRC = "61000000-0000-4000-8000-0000000000aa", RPROP = "62000000-0000-4000-8000-0000000000aa";
  const rStatus = (state: string, over: Record<string, unknown> = {}) => ({ commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state, reason: null, proposalId: null, ...over });
  const resumeProposal = { schemaVersion: 1, proposalId: RPROP, sourceId: RSRC, sourceVersion: 1, proposalHash: "d".repeat(64), reviewNotes: [], expiresAt: "2026-11-09T00:00:00.000Z",
    facts: [fact(7, "skill", "Kubernetes"), fact(8, "skill", "Terraform")] };
  const resumeRoutes = (queue: Route) => ({
    "POST /api/ai/resume": () => json(201, { resume: { id: 7 } }),
    "POST /api/candidate/product/sources/resume-snapshots": () => json(200, { schemaVersion: 1, sourceId: RSRC, sourceVersion: 1, contentHash: "e".repeat(64) }),
    "POST /api/candidate/product/sources/resume": queue,
    [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, resumeProposal),
  });
  const pickFile = async () => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
  };
  const next = async () => { await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent?.startsWith("Next") || b.textContent === "Continue")!.click(); }); await flush(); };

  it("hides the résumé step while the server says reading is unavailable", async () => {
    await mount({ ...lookupYes(false), ...commandServer() });
    await start(); await yes();
    expect(text()).not.toContain("Add your résumé");
    expect(text()).toContain("Your skills");
  });

  it("reads an uploaded résumé, shows the suggestions, and accepts the kept ones on the server", async () => {
    const calls = await mount({ ...lookupYes(true),
      ...resumeRoutes(() => json(202, rStatus("review_ready", { proposalId: RPROP }))), ...commandServer() });
    await start(); await yes();
    expect(text()).toContain("Add your résumé");
    await pickFile();
    expect(calls.find(c => c.key === "POST /api/candidate/product/sources/resume-snapshots")!.body).toMatchObject({ schemaVersion: 1, resumeId: 7 });
    expect(calls.find(c => c.key === "POST /api/candidate/product/sources/resume")!.body).toMatchObject({ schemaVersion: 1, sourceId: RSRC, sourceVersion: 1 });
    await next();
    expect(text()).toContain("What we found in your résumé");
    expect(text()).toContain("Kubernetes");
    // Remove one suggestion, keep the other.
    const row = Array.from(document.querySelectorAll("li")).find(li => li.textContent?.includes("Terraform"))!;
    await act(async () => { Array.from(row.querySelectorAll("button")).find(b => b.textContent === "Remove")!.click(); }); await flush(1);
    await next();
    const cmd = calls.filter(c => c.key === COMMANDS).map(c => c.body).find(b => b.payload?.proposalId === RPROP)!;
    expect(cmd).toMatchObject({ schemaVersion: 3, action: "accept_source", payload: { proposalId: RPROP, sourceVersion: 1, proposalHash: "d".repeat(64),
      selectedFactIds: [resumeProposal.facts[0]!.factId], corrections: [] } });
  });

  it("a résumé that can't be read says why and offers the server's retry, re-sending nothing paid on its own", async () => {
    const calls = await mount({ ...lookupYes(true),
      ...resumeRoutes(() => json(202, rStatus("unavailable", { reason: "extraction_failed", retry: { attemptsUsed: 1, maxAttempts: 3, canRetry: true, canContinueWithoutResume: true, reason: null, message: null } }))),
      [`POST /api/candidate/product/sources/resume/${RCMD}/retry`]: () => json(202, rStatus("review_ready", { proposalId: RPROP })), ...commandServer() });
    await start(); await yes();
    await pickFile();
    await next();
    expect(calls.filter(c => c.key === "POST /api/candidate/product/sources/resume")).toHaveLength(1);
    const again = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Try again");
    expect(again).toBeDefined();
    await act(async () => { again!.click(); }); await flush();
    expect(calls.find(c => c.key === `POST /api/candidate/product/sources/resume/${RCMD}/retry`)!.body).toMatchObject({ schemaVersion: 1, retryOfCommandId: RCMD });
    expect(text()).toContain("Kubernetes");
  });

  it("deal-breakers never go out as a plain save (they need the server's preview); résumé review isn't a save either", () => {
    expect(() => toSparkEvent({ kind: "dealbreakers", baseVersion: "5", exclusions: [], notes: [{ id: "n", text: "No night shifts" }], idempotencyKey: "k" })).toThrow("use_saveDealbreakers");
    expect(() => toSparkEvent({ kind: "dealbreakers", baseVersion: "5", exclusions: [{ kind: "remote_only" } as never], notes: [], idempotencyKey: "k" })).toThrow("use_saveDealbreakers");
    expect(() => toSparkEvent({ kind: "resume_review", resumeVersionId: "r", status: "reviewed", decisions: {}, edits: {}, idempotencyKey: "k" })).toThrow("not_supported");
  });
});

function proposalDraft() {
  return { displayName: "", headline: "", linkedinUrl: null, currentLocation: null, skills: [], employment: [], education: [], projects: [] };
}
