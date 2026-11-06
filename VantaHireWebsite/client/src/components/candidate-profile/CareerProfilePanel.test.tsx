/**
 * S2 career profile panel contract. ReactDOM-only harness with a URL-routed fetch stub, so
 * real request bodies, idempotency keys and receipt handling are asserted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { existsSync, readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CareerProfilePanel, CONFIRM_NOTE, DISCARD_CONFIRM, DISCARDED, SAVE_FIRST } from "./CareerProfilePanel";
import { lookupProfile } from "./SourceReview";
import { NOT_FOUND_COPY, UNCERTAIN_COPY } from "@/hooks/use-profile-command";
import { CAPABILITY_COPY, GENERIC_ERROR, REASONS, describeReason } from "@/lib/candidate-profile-api";

const BASE = "/api/candidate/product/profile";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CMD = "20000000-0000-4000-8000-000000000001";
type Result = { status: number; body?: unknown } | "network";
type Handler = (init: RequestInit | undefined) => Result | Promise<Result>;

const draft = {
  displayName: "Synthetic Candidate", headline: "Backend engineer", linkedinUrl: null,
  currentLocation: { city: "Bengaluru", countryCode: "IN", displayCountry: "India" },
  skills: ["Python", "PostgreSQL"], employment: [], education: [], projects: [],
};
function profile(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2, state: "draft", draftVersion: 3, profileVersion: 0, preferenceVersion: 1,
    draftHash: "a".repeat(64), draft, confirmedProfile: null, preferences: null, confirmedConsentVersion: 0,
    missingFields: ["preferences"], sources: [], proposals: [],
    capabilities: { canEdit: true, canConfirm: false, confirmBlockedReason: "incomplete_profile", canEnrich: false, canRequestResume: false },
    publicationActive: false, matchingState: "not_available", pendingCommands: [], hasMorePendingCommands: false, ...over,
  };
}
const receipt = (status: string, reason: string | null = null) =>
  ({ status: 200, body: { schemaVersion: 2, commandId: CMD, status, draftVersion: 4, profileVersion: 0, preferenceVersion: 1, reason } });

let root: Root | null = null, host: HTMLDivElement | null = null;
let routes: Record<string, Handler[]>;
let calls: Array<{ path: string; method: string; body: any }>;
/** Handlers are consumed in order; the last one repeats. */
const route = (method: string, path: string, ...h: Handler[]) => { routes[`${method} ${path}`] = h; };
const posts = () => calls.filter(c => c.method === "POST" && c.path === `${BASE}/commands`);
const gets = (path: string) => calls.filter(c => c.method === "GET" && c.path === path);

function installFetch() {
  calls = []; routes = {};
  route("GET", "/api/csrf-token", () => ({ status: 200, body: { token: "test-csrf" } }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const list = routes[`${method} ${url.pathname}`];
    if (!list) return new Response(JSON.stringify({ code: "unrouted" }), { status: 599 });
    calls.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const handler = list.length > 1 ? list.shift()! : list[0]!;
    const r = await handler(init);
    if (r === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  }));
}
async function flush(n = 6) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const fastSleep = () => new Promise<void>(r => setTimeout(r, 1));
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client}><CareerProfilePanel deps={{ command: { sleep: fastSleep } }} /></QueryClientProvider>); });
  await flush();
}
/** Editing happens in a side sheet, which renders outside the host (a portal on document.body). */
const text = () => document.body.textContent ?? "";
/** Every status message ever rendered, so a transient false "Saved" can't hide. */
function recordStatuses() {
  const seen: string[] = [];
  const grab = () => document.body.querySelectorAll('[role="status"],[role="alert"]').forEach(n => seen.push(n.textContent ?? ""));
  const obs = new MutationObserver(grab); obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  return { seen, stop: () => obs.disconnect() };
}
const button = (label: RegExp) => {
  const b = Array.from(document.querySelectorAll("button")).find(x => label.test(x.textContent ?? "") || label.test(x.getAttribute("aria-label") ?? ""));
  if (!b) throw new Error(`missing button ${label}`); return b as HTMLButtonElement;
};
const SAVE = /^(Save|Saving…)$/;
/** Open the "Name, headline and location" sheet. */
async function editBasics() { await act(async () => { button(/^Edit name, headline and location$/).click(); }); await flush(2); }
/** Open the sheet and save the details unchanged. */
async function saveBasics() { await editBasics(); await act(async () => { button(SAVE).click(); }); }
async function until(check: () => boolean, tries = 60) { for (let i = 0; i < tries && !check(); i++) await flush(2); expect(check()).toBe(true); }

beforeEach(installFetch);
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });

describe("reason catalogue", () => {
  it("matches the S2 UI contract message-for-message", () => {
    const path = "/home/ews/ealana-index/CANDIDATE_PRODUCT_S2_UI_CONTRACT.json";
    expect(Object.keys(REASONS)).toHaveLength(21);
    if (existsSync(path)) expect(REASONS).toEqual(JSON.parse(readFileSync(path, "utf8")).reasons);
  });
  it("never claims saved or an automatic retry for an unknown reason", () => {
    expect(describeReason("brand_new_reason")).toEqual({ status: "rejected", retryable: false, action: "unknown", message: GENERIC_ERROR });
    expect(describeReason(null)).toMatchObject({ retryable: false, message: GENERIC_ERROR });
    expect(describeReason("__proto__").message).toBe(GENERIC_ERROR);
  });
});

describe("CareerProfilePanel", () => {
  it("renders nothing while the feature is off", async () => {
    route("GET", BASE, () => ({ status: 404, body: { code: "not_found" } }));
    await mount();
    expect(host!.innerHTML).toBe("");
  });

  it("shows an outage as unavailable, never as an empty profile", async () => {
    route("GET", BASE, () => ({ status: 503, body: { code: "profile_temporarily_unavailable", retryable: true } }));
    await mount();
    expect(text()).toContain("Can't load your profile right now");
    expect(host!.querySelector("form")).toBeNull();
  });

  it("saves a draft: admitted is 'Saving…', only the applied receipt says 'Saved', then refetches", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, () => ({ status: 202, body: { schemaVersion: 2, commandId: CMD, status: "pending" } }));
    route("GET", `${BASE}/commands/${CMD}`, () => receipt("pending"), () => receipt("applied"));
    await mount();
    await saveBasics();
    await flush(2);
    const [post] = posts();
    expect(post!.body).toMatchObject({ schemaVersion: 2, expectedDraftVersion: 3, expectedProfileVersion: 0, expectedPreferenceVersion: 1, action: "save_draft" });
    expect(post!.body.idempotencyKey).toMatch(UUID);
    expect(post!.body.payload.profile).toEqual(draft);
    await until(() => text().includes("Saved"));
    expect(gets(BASE).length).toBeGreaterThanOrEqual(2);
  });

  it("re-sends an uncertain save with the identical body and key, never a new one", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, () => "network", () => ({ status: 202, body: { schemaVersion: 2, commandId: CMD, status: "pending" } }));
    route("GET", `${BASE}/commands/${CMD}`, () => receipt("applied"));
    await mount();
    await saveBasics();
    await until(() => posts().length === 2);
    expect(posts()[1]!.body).toEqual(posts()[0]!.body);
    await until(() => text().includes("Saved"));
  });

  it("a held save shows the automatic-retry message and offers no retry button", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, () => ({ status: 202, body: { schemaVersion: 2, commandId: CMD, status: "pending" } }));
    // The first receipt read is slow, as on a real network, so any interim state renders.
    route("GET", `${BASE}/commands/${CMD}`, () => new Promise<Result>(r => setTimeout(() => r(receipt("held", "authority_unavailable")), 40)),
      () => receipt("held", "authority_unavailable"));
    await mount();
    const rec = recordStatuses();
    await saveBasics();
    await until(() => text().includes("We couldn't save yet. We'll retry automatically."));
    rec.stop();
    expect(rec.seen.some(t => /\bSaved\b/.test(t))).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some(b => /retry/i.test(b.textContent ?? ""))).toBe(false);
    expect(posts()).toHaveLength(1);
    expect(text()).not.toMatch(/\bSaved\b/);
  });

  it("an exhausted save asks for support and stops polling", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, () => ({ status: 202, body: { schemaVersion: 2, commandId: CMD, status: "pending" } }));
    route("GET", `${BASE}/commands/${CMD}`, () => receipt("held", "retry_exhausted"));
    await mount();
    await saveBasics();
    await until(() => text().includes(REASONS.retry_exhausted!.message));
    const n = gets(`${BASE}/commands/${CMD}`).length;
    await flush(10);
    expect(gets(`${BASE}/commands/${CMD}`).length).toBe(n);
  });

  it("a stale edit is reported, not saved", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, () => ({ status: 409, body: { code: "version_conflict" } }));
    await mount();
    await saveBasics();
    await until(() => text().includes(REASONS.stale_edit!.message));
  });

  it("watches a save admitted before a reload without re-sending it", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile({ pendingCommands: [{ commandId: CMD, action: "save_preferences", status: "held", reason: "memory_unavailable" }] }) }));
    route("GET", `${BASE}/commands/${CMD}`, () => receipt("held", "memory_unavailable"), () => receipt("applied"));
    await mount();
    expect(text()).toContain("Job preferences:");
    await until(() => gets(`${BASE}/commands/${CMD}`).length >= 2);
    expect(posts()).toHaveLength(0);
  });

  it("blocks confirmation with the server's reason and states that employers can't see it yet", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    await mount();
    expect(button(/Confirm profile/).disabled).toBe(true);
    expect(text()).toContain(CAPABILITY_COPY.incomplete_profile);
    expect(text()).toContain(CONFIRM_NOTE);
    expect(text()).toContain("Job preferences");
  });

  it("confirms the exact displayed draft hash and consent version", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile({ missingFields: [], capabilities: { canEdit: true, canConfirm: true, canEnrich: false, canRequestResume: false } }) }));
    route("POST", `${BASE}/commands`, () => ({ status: 202, body: { schemaVersion: 2, commandId: CMD, status: "pending" } }));
    route("GET", `${BASE}/commands/${CMD}`, () => receipt("applied"));
    await mount();
    await act(async () => { button(/Confirm profile/).click(); });
    await flush(2);
    expect(posts()[0]!.body).toMatchObject({ action: "confirm", payload: { draftHash: "a".repeat(64), consentVersion: 0 } });
  });

  const confirmable = (over: Record<string, unknown> = {}) => profile({ missingFields: [], capabilities: { canEdit: true, canConfirm: true, canEnrich: false, canRequestResume: false }, ...over });
  const admitted = () => ({ status: 202, body: { schemaVersion: 2, commandId: CMD, status: "pending" } });
  function type(label: string, value: string) {
    const input = Array.from(document.querySelectorAll("label")).find(l => l.textContent?.startsWith(label))?.control as HTMLInputElement | undefined;
    if (!input) throw new Error(`missing field ${label}`);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
    setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
    return input;
  }

  it("won't confirm while professional details have unsaved edits; confirms the re-read saved hash after saving", async () => {
    let release!: () => void;
    const reread = new Promise<void>(r => { release = r; });
    route("GET", BASE, () => ({ status: 200, body: confirmable() }),
      async () => { await reread; return { status: 200, body: confirmable({ draftVersion: 4, draftHash: "b".repeat(64), draft: { ...draft, displayName: "Edited Name" } }) }; });
    route("POST", `${BASE}/commands`, admitted);
    route("GET", `${BASE}/commands/${CMD}`, () => receipt("applied"));
    await mount();
    expect(button(/Confirm profile/).disabled).toBe(false);
    await editBasics();
    await act(async () => { type("Name", "Edited Name"); });
    expect(button(/Confirm profile/).disabled).toBe(true);
    expect(text()).toContain(SAVE_FIRST);
    await act(async () => { button(/Confirm profile/).click(); });
    expect(posts()).toHaveLength(0);
    await act(async () => { button(SAVE).click(); });
    await until(() => text().includes("Saved"));
    // Applied, but the saved snapshot hasn't been re-read yet: still not confirmable.
    expect(button(/Confirm profile/).disabled).toBe(true);
    await act(async () => { release(); });
    await until(() => !button(/Confirm profile/).disabled);
    expect(text()).not.toContain(SAVE_FIRST);
    await act(async () => { button(/Confirm profile/).click(); });
    await until(() => posts().length === 2);
    expect(posts()[1]!.body).toMatchObject({ action: "confirm", payload: { draftHash: "b".repeat(64) } });
  });

  it("won't confirm while job preferences have unsaved edits", async () => {
    route("GET", BASE, () => ({ status: 200, body: confirmable() }));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    await mount();
    await act(async () => { button(/^Add job preferences$/).click(); });
    await flush(2);
    const roles = Array.from(document.querySelectorAll("label")).find(l => l.textContent?.startsWith("Roles you want"))?.control as HTMLInputElement;
    await act(async () => { type("Roles you want", "Platform engineer"); roles.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(button(/Confirm profile/).disabled).toBe(true);
    expect(text()).toContain(SAVE_FIRST);
  });

  it("keeps save and confirm locked after an uncertain send; 'Send again' reuses the same body and key", async () => {
    route("GET", BASE, () => ({ status: 200, body: confirmable() }));
    route("POST", `${BASE}/commands`, () => "network", () => "network", () => "network", admitted);
    route("GET", `${BASE}/commands/${CMD}`, () => receipt("applied"));
    await mount();
    await saveBasics();
    await until(() => text().includes(UNCERTAIN_COPY));
    expect(posts()).toHaveLength(3);
    expect(button(SAVE).disabled).toBe(true);
    expect(button(/Confirm profile/).disabled).toBe(true);
    await act(async () => { button(SAVE).click(); button(/Confirm profile/).click(); });
    await flush(4);
    expect(posts()).toHaveLength(3);
    await act(async () => { button(/Send again/).click(); });
    await until(() => text().includes("Saved"));
    expect(posts()).toHaveLength(4);
    expect(posts()[3]!.body).toEqual(posts()[0]!.body);
    expect(Array.from(document.querySelectorAll("button")).some(b => /Send again/.test(b.textContent ?? ""))).toBe(false);
  });

  it("stops polling and asks to sign in when the receipt read is no longer authenticated", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, admitted);
    route("GET", `${BASE}/commands/${CMD}`, () => ({ status: 401, body: { code: "authentication_required" } }));
    await mount();
    await saveBasics();
    await until(() => text().includes(REASONS.authentication_changed!.message));
    const n = gets(`${BASE}/commands/${CMD}`).length;
    await flush(10);
    expect(gets(`${BASE}/commands/${CMD}`).length).toBe(n);
    expect(button(SAVE).disabled).toBe(true);
  });

  it("a privacy refusal while watching reloads into the restricted view", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }),
      () => ({ status: 200, body: { schemaVersion: 2, state: "restricted", draft: null, confirmedProfile: null, preferences: null, sources: [], proposals: [], capabilities: { canEdit: false, canConfirm: false, canEnrich: false, canRequestResume: false }, publicationActive: false, matchingState: "not_available", code: "candidate_privacy_restricted" } }));
    route("POST", `${BASE}/commands`, admitted);
    route("GET", `${BASE}/commands/${CMD}`, () => ({ status: 451, body: { code: "candidate_privacy_restricted" } }));
    await mount();
    await saveBasics();
    await until(() => document.querySelector("form") === null);
    expect(text()).toContain(REASONS.candidate_privacy_restricted!.message);
  });

  it("a command that no longer exists stops polling with a refresh message", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, admitted);
    route("GET", `${BASE}/commands/${CMD}`, () => ({ status: 404, body: { code: "not_found" } }));
    await mount();
    await saveBasics();
    await until(() => text().includes(NOT_FOUND_COPY));
    const n = gets(`${BASE}/commands/${CMD}`).length;
    await flush(10);
    expect(gets(`${BASE}/commands/${CMD}`).length).toBe(n);
  });

  it("a resumed pending save stops on a sign-in failure too", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile({ pendingCommands: [{ commandId: CMD, action: "save_draft", status: "pending", reason: null }] }) }));
    route("GET", `${BASE}/commands/${CMD}`, () => ({ status: 401, body: {} }));
    await mount();
    await until(() => text().includes(REASONS.authentication_changed!.message));
    const n = gets(`${BASE}/commands/${CMD}`).length;
    await flush(10);
    expect(gets(`${BASE}/commands/${CMD}`).length).toBe(n);
  });

  it("keeps polling through a temporary 503 and then reports the save", async () => {
    route("GET", BASE, () => ({ status: 200, body: profile() }));
    route("POST", `${BASE}/commands`, admitted);
    route("GET", `${BASE}/commands/${CMD}`, () => ({ status: 503, body: {} }), () => "network", () => receipt("applied"));
    await mount();
    await saveBasics();
    await until(() => text().includes("Saved"));
  });

  it("shows a privacy restriction without any editable form", async () => {
    route("GET", BASE, () => ({ status: 200, body: { schemaVersion: 2, state: "restricted", draft: null, confirmedProfile: null, preferences: null, sources: [], proposals: [], capabilities: { canEdit: false, canConfirm: false, canEnrich: false, canRequestResume: false }, publicationActive: false, matchingState: "not_available", code: "candidate_privacy_restricted" } }));
    await mount();
    expect(text()).toContain(REASONS.candidate_privacy_restricted!.message);
    expect(host!.querySelector("form")).toBeNull();
  });
});

import { ProfileProgress, profileSteps } from "./ProfileProgress";
import { SegmentedControl } from "./SegmentedControl";
import { COUNTRIES } from "./countries";

describe("stuck saves: the server's Try again / Discard", () => {
  beforeEach(() => installFetch());
  afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
  const RES = `${BASE}/commands/${CMD}/resolution`;
  const view = (over: Record<string, unknown> = {}) => ({ status: 200, body: { schemaVersion: 1, commandId: CMD, commandSchemaVersion: 3, resolutionRevision: 2,
    state: "none", reason: "retry_available", canRetry: true, canDiscard: true, blocksConfirmation: true, ...over } });
  const accepted = (over: Record<string, unknown>) => ({ ...view(over), status: 202 });
  const held = () => route("GET", BASE, () => ({ status: 200, body: profile({ pendingCommands: [{ commandId: CMD, action: "save_preferences", status: "held", reason: "memory_unavailable" }] }) }));
  async function mountR() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<QueryClientProvider client={client}><CareerProfilePanel deps={{ command: { sleep: fastSleep }, resolution: { pollMs: 1 } }} /></QueryClientProvider>); });
    await flush();
  }
  const resPosts = () => calls.filter(c => c.method === "POST" && c.path === RES).map(c => c.body);

  it("Try again names the save and its revision only, then refreshes once the server applies it", async () => {
    held(); route("GET", `${BASE}/commands/${CMD}`, () => receipt("held", "memory_unavailable"));
    route("GET", RES, () => view(), () => view({ state: "resolving", reason: null, canRetry: false, canDiscard: false }), () => view({ state: "applied", reason: "already_applied", canRetry: false, canDiscard: false, blocksConfirmation: false }));
    route("POST", RES, () => accepted({ state: "retry_queued", reason: null, canRetry: false, canDiscard: false }));
    await mountR();
    await until(() => text().includes("Try again"));
    const before = gets(BASE).length;
    await act(async () => { button(/^Try again$/).click(); }); await flush();
    const body = resPosts()[0];
    expect(Object.keys(body).sort()).toEqual(["action", "expectedResolutionRevision", "idempotencyKey", "schemaVersion"]);
    expect(body).toMatchObject({ schemaVersion: 1, action: "retry", expectedResolutionRevision: 2 });
    expect(UUID.test(body.idempotencyKey)).toBe(true);
    await until(() => gets(BASE).length > before);
    expect(posts()).toHaveLength(0); // the edit itself is never re-sent by the browser
  });

  it("Discard asks first, then sends discard and says so", async () => {
    held(); route("GET", `${BASE}/commands/${CMD}`, () => receipt("held", "memory_unavailable"));
    route("GET", RES, () => view());
    route("POST", RES, () => accepted({ state: "discarded", reason: "discard_acknowledged", canRetry: false, canDiscard: false, blocksConfirmation: false }));
    await mountR();
    await until(() => text().includes("Discard change"));
    await act(async () => { button(/^Discard change$/).click(); }); await flush(1);
    expect(text()).toContain(DISCARD_CONFIRM);
    expect(resPosts()).toHaveLength(0);
    const confirm = Array.from(document.querySelectorAll('[role="group"] button')).find(b => b.textContent === "Discard change") as HTMLButtonElement;
    await act(async () => { confirm.click(); }); await flush();
    expect(resPosts()[0]).toMatchObject({ action: "discard", expectedResolutionRevision: 2 });
    expect(text()).toContain(DISCARDED);
  });

  it("a lost reply is re-sent with the same key", async () => {
    held(); route("GET", `${BASE}/commands/${CMD}`, () => receipt("held", "memory_unavailable"));
    route("GET", RES, () => view());
    route("POST", RES, () => "network", () => accepted({ state: "retry_queued", reason: null, canRetry: false, canDiscard: false }));
    await mountR();
    await until(() => text().includes("Try again"));
    await act(async () => { button(/^Try again$/).click(); }); await flush();
    expect(text()).toContain(UNCERTAIN_COPY);
    await act(async () => { button(/^Try again$/).click(); }); await flush();
    expect(resPosts()).toHaveLength(2);
    expect(resPosts()[1]).toEqual(resPosts()[0]);
  });

  it("offers no action when the server allows none, and a team check says so", async () => {
    held(); route("GET", `${BASE}/commands/${CMD}`, () => receipt("held", "memory_unavailable"));
    route("GET", RES, () => view({ state: "operator_review", reason: "recovery_exhausted", canRetry: false, canDiscard: false }));
    await mountR();
    await until(() => text().includes("Your account needs a check by our team."));
    expect(() => button(/^Try again$/)).toThrow();
    expect(() => button(/^Discard change$/)).toThrow();
  });
});

describe("LinkedIn photo (candidate-only)", () => {
  beforeEach(() => installFetch());
  afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
  const PHOTO = "https://media.licdn.com/dms/image/synthetic.jpg";
  const withPhoto = () => route("GET", BASE, () => ({ status: 200, body: profile({ draft: { ...draft, photoUrl: PHOTO } }) }));
  const applied = () => { route("POST", `${BASE}/commands`, () => ({ status: 202, body: { schemaVersion: 2, commandId: CMD, status: "pending" } })); route("GET", `${BASE}/commands/${CMD}`, () => receipt("applied")); };
  const imgs = () => Array.from(document.querySelectorAll("img")).filter(i => i.getAttribute("src") === PHOTO);

  it("shows the photo once, in the header, never in the employer preview", async () => {
    withPhoto(); await mount();
    expect(imgs()).toHaveLength(1);
    const label = Array.from(document.querySelectorAll("p")).find(p => p.textContent === "What employers will see")!;
    const previewCard = label.parentElement!.parentElement!; // CardHeader → Card
    expect(previewCard.textContent).toContain("Synthetic Candidate");
    expect(previewCard.querySelectorAll("img")).toHaveLength(0);
    expect(imgs()[0]!.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("a broken photo link falls back to initials", async () => {
    withPhoto(); await mount();
    await act(async () => { imgs()[0]!.dispatchEvent(new Event("error")); }); await flush(1);
    expect(imgs()).toHaveLength(0);
    expect(text()).toContain("SC");
  });

  it("editing other details keeps the photo (a full-profile save never drops it)", async () => {
    withPhoto(); applied(); await mount();
    await saveBasics(); await flush();
    expect(posts()[0]!.body.payload.profile.photoUrl).toBe(PHOTO);
  });

  it("the lookup's photo fact reaches the 'Is this you?' profile", () => {
    const f = (kind: string, value: unknown) => ({ factId: crypto.randomUUID(), kind, targetRowId: null, value, evidence: [{ quote: "q" }] });
    const p = lookupProfile({ schemaVersion: 1, proposalId: "p", sourceId: "s", sourceVersion: 1, proposalHash: "h", reviewNotes: [], expiresAt: "",
      facts: [f("displayName", "Synthetic Candidate"), f("photo", { url: PHOTO })] } as any);
    expect((p as any).photoUrl).toBe(PHOTO);
    const none = lookupProfile({ schemaVersion: 1, proposalId: "p", sourceId: "s", sourceVersion: 1, proposalHash: "h", reviewNotes: [], expiresAt: "", facts: [f("displayName", "X")] } as any);
    expect(none).not.toHaveProperty("photoUrl");
  });
});

describe("21st.dev-derived pieces", () => {
  it("country list is exactly the server's accepted codes", async () => {
    const { COUNTRY_CODES } = await import("@shared/candidate-profile");
    expect(COUNTRIES.map(c => c.code).sort()).toEqual(Array.from(COUNTRY_CODES).sort());
    expect(COUNTRIES.find(c => c.code === "IN")!.name).toBe("India");
  });

  it("progress follows the server's missing fields", () => {
    const steps = profileSteps(profile() as any);
    expect(steps.map(s => [s.key, s.done])).toEqual([["details", true], ["skills", true], ["preferences", false], ["confirm", false]]);
    const all = profileSteps(profile({ state: "confirmed", profileVersion: 1, missingFields: [], preferences: {} }) as any);
    expect(all.every(s => s.done)).toBe(true);
  });

  it("segmented control is a keyboard radio group", async () => {
    const changes: string[] = [];
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<SegmentedControl label="Relocation" value="yes" onValueChange={v => changes.push(v)}
      options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />); });
    const radios = Array.from(host.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];
    expect(radios.map(r => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios.map(r => r.tabIndex)).toEqual([0, -1]);
    await act(async () => { radios[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(changes).toEqual(["no"]);
    await act(async () => { radios[1]!.click(); });
    expect(changes).toEqual(["no", "no"]);
  });

  it("renders the progress card with done/to-do text for screen readers", async () => {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<ProfileProgress steps={profileSteps(profile() as any)} />); });
    expect(host.textContent).toContain("2 of 4 done");
    expect(host.textContent).toContain("Job preferences (to do)");
  });
});

import { matchCountries } from "./CountryCombobox";
describe("country search", () => {
  it("is plain matching, best match first, never fuzzy", () => {
    expect(matchCountries("ind").map(c => c.name)).toEqual(["India", "Indonesia", "British Indian Ocean Territory"]);
    expect(matchCountries("IN")[0]!.name).toBe("India");
    expect(matchCountries("kingdom")[0]!.name).toBe("United Kingdom");
    expect(matchCountries("zzz")).toEqual([]);
  });
});

import { TagInput } from "./TagInput";
describe("TagInput (adapted from 21st.dev)", () => {
  async function mountTags(initial: string[], max = 5) {
    let values = initial; const seen: string[][] = [];
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    const render = () => root!.render(<TagInput label="Skills" values={values} max={max} onChange={v => { values = v; seen.push(v); render(); }} />);
    await act(async () => { render(); });
    return { seen, input: () => host!.querySelector("input") as HTMLInputElement, get: () => values };
  }
  const key = (el: HTMLElement, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
  const paste = (el: HTMLElement, text: string) => act(async () => {
    const e = new Event("paste", { bubbles: true, cancelable: true }) as any; e.clipboardData = { getData: () => text }; el.dispatchEvent(e);
  });
  it("pasting a list adds each item, skipping case-insensitive duplicates and stopping at the limit", async () => {
    const t = await mountTags(["Python"], 4);
    await paste(t.input(), "Go, python\nSQL, Rust, Kotlin");
    expect(t.get()).toEqual(["Python", "Go", "SQL", "Rust"]);
    expect(host!.textContent).toContain("You can add up to 4.");
    expect(host!.textContent).toContain("4 / 4");
  });
  it("Backspace on an empty field highlights the last tag first, then removes it", async () => {
    const t = await mountTags(["Python", "Go"]);
    await key(t.input(), "Backspace");
    expect(t.get()).toEqual(["Python", "Go"]);
    expect(host!.querySelector('[role="status"]')!.textContent).toContain("Go selected");
    await key(t.input(), "Backspace");
    expect(t.get()).toEqual(["Python"]);
  });
  it("remove buttons are labelled and large enough to tap", async () => {
    await mountTags(["Python"]);
    const b = host!.querySelector('button[aria-label="Remove Python"]') as HTMLButtonElement;
    expect(b.className).toMatch(/\bh-7\b/); expect(b.className).toMatch(/\bw-7\b/);
  });
});

/* ---------------- spark (v3) profile read ---------------- */
const H2 = "b".repeat(64), H3 = "c".repeat(64);
function sparkRead(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3, draftVersion: 3, profileVersion: 0, preferenceVersion: 0, draft, confirmedProfile: null, preferences: null,
    preferenceDraft: { preferenceDraftRevision: 4, preferenceDraftHash: H2, exclusions: [], promotedPreferenceVersion: null, promotedDraftRevision: null,
      sections: { roles: { answered: true, value: { desiredRoles: ["Backend engineer"], preferredSeniority: [] } } } },
    publicationActive: false, draftHash: "a".repeat(64), effectiveConsentRevision: 7,
    missingFields: ["preferences.location", "preferences.compensation"], sources: [], proposals: [],
    matchingState: "not_available", discoveryState: "not_available", pendingCommands: [], hasMorePendingCommands: false,
    capabilities: { canEdit: true, canConfirm: false, confirmBlockedReason: "incomplete_profile", canEnrich: false, canRequestResume: false }, ...over,
  };
}
async function mountSpark() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client}><CareerProfilePanel deps={{ command: { sleep: fastSleep }, spark: { wait: fastSleep } }} /></QueryClientProvider>); });
  await flush();
}
/** Each spark command gets its own id; the poll returns it applied with the next revision. */
function sparkServer() {
  let n = 0, rev = 4, prefVersion = 0; const results = new Map<string, unknown>();
  route("POST", `${BASE}/commands`, init => {
    const b = JSON.parse(String(init!.body)); const id = `30000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const r = b.action === "promote_preferences" ? { preferenceVersion: ++prefVersion, preferenceDraftRevision: rev, preferenceDraftHash: H3 }
      : b.action === "confirm" ? { profileVersion: 1 } : { preferenceDraftRevision: ++rev, preferenceDraftHash: H3 };
    results.set(id, { schemaVersion: b.schemaVersion, commandId: id, status: "applied", reason: null, ...r });
    return { status: 202, body: { schemaVersion: b.schemaVersion, commandId: id, status: "pending" } };
  });
  for (let i = 1; i <= 12; i++) { const id = `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`; route("GET", `${BASE}/commands/${id}`, () => ({ status: 200, body: results.get(id) })); }
}

describe("CareerProfilePanel on a spark profile", () => {
  it("reads the v3 profile: answered sections show, unanswered ones say Not answered, gaps read plainly", async () => {
    route("GET", BASE, () => ({ status: 200, body: sparkRead() }));
    await mountSpark();
    expect(text()).toContain("Backend engineer");
    expect(text()).toContain("Not answered");
    expect(text()).toContain("Where you want to work");
    expect(text()).toContain("Pay");
    expect(text()).not.toContain("preferences ›");
    expect(text()).toContain("Draft");
  });

  it("an unanswered question shows as Not answered and the editor starts with nothing chosen for it", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const sections = { roles: { answered: true, value: { desiredRoles: ["Backend engineer"], preferredSeniority: [] } }, location: { answered: true, value: { mode: "anywhere" } } };
    route("GET", BASE, () => ({ status: 200, body: sparkRead({ preferenceDraft: { ...sparkRead().preferenceDraft, sections } }) }));
    sparkServer();
    await mountSpark();
    const row = (label: string) => Array.from(document.querySelectorAll("dt")).find(d => d.textContent?.trim() === label)?.nextElementSibling?.textContent;
    expect(row("Where")).toBe("Anywhere");
    expect(row("Would move")).toBe("Not answered");
    expect(row("Pay")).toBe("Not answered");
    expect(row("Start")).toBe("Not answered");
    await act(async () => { button(/^Edit preferences$/).click(); }); await flush(2);
    const group = (label: string) => Array.from(document.querySelectorAll("p")).find(x => x.textContent === label)!.nextElementSibling!;
    expect(group("Open to relocating?").querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(0);
    expect(group("Salary expectations").querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(0);
    expect(group("Where do you want to work?").querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
    // Saving untouched sends nothing: no assumed answers.
    await act(async () => { button(/^Save preferences$/).click(); }); await flush(12);
    expect(posts()).toHaveLength(0);
  });

  it("saves edited preferences as v3 sections, chaining the draft revision, then rereads", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const a = (value: unknown) => ({ answered: true, value });
    const sections = { roles: a({ desiredRoles: ["Backend engineer"], preferredSeniority: [] }), location: a({ mode: "anywhere" }),
      relocation: a({ mode: "no", destinations: [] }), arrangement: a({ workArrangements: ["onsite"], remoteRegions: null }),
      employment_types: a(["permanent"]), availability: a({ mode: "immediate" }), compensation: a({ mode: "open_to_discussion" }) };
    route("GET", BASE, () => ({ status: 200, body: sparkRead({ preferenceDraft: { ...sparkRead().preferenceDraft, sections } }) }));
    sparkServer();
    await mountSpark();
    await act(async () => { button(/^Edit preferences$/).click(); }); await flush(2);
    const gig = Array.from(document.querySelectorAll("label")).find(l => l.textContent === "Gig / freelance")!;
    await act(async () => { (document.getElementById(gig.htmlFor) as HTMLButtonElement).click(); }); await flush(2);
    const roles = Array.from(document.querySelectorAll("label")).find(l => l.textContent?.startsWith("Roles you want"))!;
    await act(async () => { const i = document.getElementById(roles.htmlFor) as HTMLInputElement; i.focus(); }); await flush(1);
    await act(async () => { button(/^Save preferences$/).click(); }); await flush(10);
    // Only the question the candidate changed is saved; "Gig / freelance" is a valid spark answer.
    await until(() => posts().length === 1);
    expect(posts()[0]!.body).toMatchObject({ schemaVersion: 3, action: "save_preference_section", expectedPreferenceDraftRevision: 4,
      payload: { section: "employment_types", answered: true, value: ["permanent", "gig_freelance"] } });
    expect(UUID.test(posts()[0]!.body.idempotencyKey)).toBe(true);
    await until(() => gets(BASE).length >= 2);
  });

  it("checks a touched question against the server's section rules and sends nothing when it fails", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const a = (value: unknown) => ({ answered: true, value });
    const sections = { roles: a({ desiredRoles: ["Backend engineer"], preferredSeniority: [] }), employment_types: a(["permanent"]) };
    route("GET", BASE, () => ({ status: 200, body: sparkRead({ preferenceDraft: { ...sparkRead().preferenceDraft, sections } }) }));
    sparkServer();
    await mountSpark();
    await act(async () => { button(/^Edit preferences$/).click(); }); await flush(2);
    // Unticking the only employment type leaves an empty answer, which the server's schema rejects.
    const permanent = Array.from(document.querySelectorAll("label")).find(l => l.textContent === "Permanent")!;
    await act(async () => { (document.getElementById(permanent.htmlFor) as HTMLButtonElement).click(); }); await flush(2);
    await act(async () => { button(/^Save preferences$/).click(); }); await flush(10);
    expect(text()).toContain("Add at least one.");
    expect(text()).toContain("Fix the highlighted details before saving.");
    expect(posts()).toHaveLength(0);
  });

  it("confirm is enabled when the only blocker is promotion; it promotes, then confirms the exact hashes and consent", async () => {
    const promoted = { preferenceDraftRevision: 4, preferenceDraftHash: H3, exclusions: [], promotedPreferenceVersion: 1, promotedDraftRevision: 4, sections: {} };
    const notPromoted = { canEdit: true, canConfirm: false, confirmBlockedReason: "preferences_not_promoted", canEnrich: false, canRequestResume: false };
    route("GET", BASE, () => ({ status: 200, body: sparkRead({ missingFields: [], capabilities: notPromoted }) }),
      () => ({ status: 200, body: sparkRead({ missingFields: [], capabilities: notPromoted }) }),
      () => ({ status: 200, body: sparkRead({ preferenceVersion: 1, preferenceDraft: promoted, missingFields: [], capabilities: { canEdit: true, canConfirm: true, canEnrich: false, canRequestResume: false } }) }));
    sparkServer();
    await mountSpark();
    expect(button(/^Confirm profile$/).disabled).toBe(false);
    await act(async () => { button(/^Confirm profile$/).click(); }); await flush(10);
    await until(() => posts().length === 2);
    expect(posts().map(p => p.body.action)).toEqual(["promote_preferences", "confirm"]);
    expect(posts()[0]!.body.payload).toEqual({ preferenceDraftHash: H2 });
    expect(posts()[1]!.body.payload).toEqual({ draftHash: "a".repeat(64), preferenceDraftHash: H3, consentRevision: 7 });
  });

  it("an expired sign-in asks for the password before confirming; only a wrong password says so", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const blocked = { canEdit: true, canConfirm: false, confirmBlockedReason: "recent_auth_required", canEnrich: false, canRequestResume: false };
    route("GET", BASE, () => ({ status: 200, body: sparkRead({ missingFields: [], capabilities: blocked }) }));
    let answer = { status: 401, body: { code: "candidate_privacy_reauth_failed" } as unknown };
    route("POST", "/api/candidate/privacy/reauth", () => answer);
    await mountSpark();
    expect(button(/^Confirm profile$/).disabled).toBe(false);
    await act(async () => { button(/^Confirm profile$/).click(); }); await flush(2);
    expect(text()).toContain("Confirm it's you");
    const pw = document.getElementById("reauth-password") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(pw, "wrong"); pw.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === "Confirm") as HTMLButtonElement).click(); }); await flush(4);
    expect(text()).toContain("That password isn't right.");
    answer = { status: 503, body: {} };
    await act(async () => { (Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === "Confirm") as HTMLButtonElement).click(); }); await flush(4);
    expect(text()).not.toContain("That password isn't right.");
    expect(text()).toContain("We couldn't check your password. Please try again.");
    await act(async () => { (Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === "Cancel") as HTMLButtonElement).click(); }); await flush(2);
    expect(posts()).toHaveLength(0);
  });

  it("U3: shows saved deal-breakers and private notes with the approved help text, and edits them through the server path", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const sections = { roles: { answered: true, value: { desiredRoles: ["Backend engineer"], preferredSeniority: [] } },
      private_notes: { answered: true, value: ["No on-call"] } };
    const company = { id: "60000000-0000-4000-8000-000000000001", kind: "exclude_company", companyId: "70000000-0000-4000-8000-000000000001" };
    const noTravel = { id: "60000000-0000-4000-8000-000000000002", kind: "no_travel" };
    route("GET", BASE, () => ({ status: 200, body: sparkRead({ preferenceDraft: { ...sparkRead().preferenceDraft, sections, exclusions: [noTravel, company] } }) }));
    route("POST", "/api/candidate/product/exclusions/preview", init => {
      const b = JSON.parse(String(init!.body));
      return { status: 200, body: { proposalId: "80000000-0000-4000-8000-000000000001", proposalHash: "d".repeat(64), expectedPreferenceDraftRevision: b.expectedPreferenceDraftRevision,
        restrictions: b.restrictions.map((r: object, i: number) => ({ id: `90000000-0000-4000-8000-00000000000${i}`, ...r })), expiresAt: "2030-01-01T00:00:00Z" } };
    });
    sparkServer();
    await mountSpark();
    expect(text()).toContain("Deal-breakers & private notes");
    expect(text()).toContain("Only you see these. Supported deal-breakers will filter your job matches when matching is available. Private notes don't filter jobs.");
    expect(text()).toContain("Exclude jobs explicitly requiring travel.");
    expect(text()).toContain("No on-call");
    await act(async () => { button(/^Edit deal-breakers & private notes$/).click(); }); await flush(2);
    // Turn off travel, turn on on-site/hybrid, add a note; the hidden company rule is kept.
    await act(async () => { button(/^Require travel$/).click(); }); await flush(1);
    await act(async () => { button(/^Need on-site or hybrid work$/).click(); }); await flush(1);
    const input = document.getElementById("add-private-note") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "No early-stage startups"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { button(/^Add$/).click(); }); await flush(1);
    await act(async () => { button(/^Save$/).click(); }); await flush(12);
    await until(() => posts().length === 3);
    expect(posts().map(p => p.body.action)).toEqual(["remove_exclusion", "accept_exclusions", "save_preference_section"]);
    expect(posts()[0]!.body.payload).toEqual({ restrictionId: noTravel.id });
    expect(posts()[2]!.body.payload).toEqual({ section: "private_notes", answered: true, value: ["No on-call", "No early-stage startups"] });
    const preview = calls.find(c => c.path === "/api/candidate/product/exclusions/preview")!;
    expect(preview.body.restrictions).toEqual([{ kind: "remote_only" }]);
    expect(posts().some(p => JSON.stringify(p.body).includes(company.id))).toBe(false); // company rule untouched
  });

  it("U3: Save stays off until something changes, and Cancel sends nothing", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    route("GET", BASE, () => ({ status: 200, body: sparkRead() }));
    sparkServer();
    await mountSpark();
    await act(async () => { button(/^Edit deal-breakers & private notes$/).click(); }); await flush(2);
    expect(button(/^Save$/).disabled).toBe(true);
    await act(async () => { button(/^Cancel$/).click(); }); await flush(2);
    expect(posts()).toHaveLength(0);
  });

  it("U3-R1: a deal-breaker save still pending keeps its exact request; Send again re-sends it and later edits are locked", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    let state = "pending";
    route("GET", BASE, () => ({ status: 200, body: sparkRead() }));
    route("POST", `${BASE}/commands`, () => ({ status: 202, body: { schemaVersion: 3, commandId: CMD, status: "pending" } }));
    route("GET", `${BASE}/commands/${CMD}`, () => ({ status: 200, body: { schemaVersion: 3, commandId: CMD, status: state, reason: null, preferenceDraftRevision: 5, preferenceDraftHash: H3 } }));
    await mountSpark();
    await act(async () => { button(/^Edit deal-breakers & private notes$/).click(); }); await flush(2);
    const input = document.getElementById("add-private-note") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "No on-call"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { button(/^Add$/).click(); }); await flush(1);
    await act(async () => { button(/^Save$/).click(); }); await flush(100);
    expect(posts()).toHaveLength(1);
    expect(text()).toContain("Wait for your latest edit to finish saving.");
    // Frozen: no new edits, no Save; the only way on is re-sending the original.
    expect((document.getElementById("add-private-note") as HTMLInputElement).disabled).toBe(true);
    expect(button(/^Save$/).disabled).toBe(true);
    await act(async () => { button(/^Send again$/).click(); }); await flush(100);
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.body).toEqual(posts()[0]!.body); // same key, same body
    state = "applied";
    await act(async () => { button(/^Send again$/).click(); }); await flush(40);
    expect(posts()[2]!.body).toEqual(posts()[0]!.body);
    await until(() => !document.getElementById("add-private-note"));
    expect(posts().every(p => p.body.idempotencyKey === posts()[0]!.body.idempotencyKey)).toBe(true);
  });

  it("U3-R1: a still-pending preferences save keeps its request too", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const a = (value: unknown) => ({ answered: true, value });
    const sections = { roles: a({ desiredRoles: ["Backend engineer"], preferredSeniority: [] }), employment_types: a(["permanent"]) };
    route("GET", BASE, () => ({ status: 200, body: sparkRead({ preferenceDraft: { ...sparkRead().preferenceDraft, sections } }) }));
    route("POST", `${BASE}/commands`, () => ({ status: 202, body: { schemaVersion: 3, commandId: CMD, status: "pending" } }));
    route("GET", `${BASE}/commands/${CMD}`, () => ({ status: 200, body: { schemaVersion: 3, commandId: CMD, status: "pending", reason: null } }));
    await mountSpark();
    await act(async () => { button(/^Edit preferences$/).click(); }); await flush(2);
    const gig = Array.from(document.querySelectorAll("label")).find(l => l.textContent === "Gig / freelance")!;
    await act(async () => { (document.getElementById(gig.htmlFor) as HTMLButtonElement).click(); }); await flush(2);
    await act(async () => { button(/^Save preferences$/).click(); }); await flush(100);
    expect(posts()).toHaveLength(1);
    await act(async () => { button(/^Send again$/).click(); }); await flush(100);
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.body).toEqual(posts()[0]!.body);
  });
});

