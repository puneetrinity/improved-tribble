/**
 * Wave 4C — CandidateConsentPanel component contract (UI-V1..V4 corrected).
 *
 * ReactDOM-only harness (no testing-library peer; package.json is frozen). Transport is a URL-routed fetch stub so the
 * panel's real request bodies, status handling and truth rules are asserted, and the rendered consent copy is compared
 * byte-for-byte with the server contract. `crypto.randomUUID` is the real generator: request ids must be captured, so a
 * silent re-key cannot hide behind a constant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CONSENT_COPY, CONSENT_COPY_SHA256, CONSENT_PURPOSE, CONSENT_SAVED_COPY, CONSENT_UNAVAILABLE_COPY } from "../../../../server/candidate-consent/contracts";
import {
  CandidateConsentPanel, approvedResumeLabel, deliveryCopy, normalizeLinkedIn, validateForm, type ConsentStatus,
} from "./CandidateConsentPanel";

type Handler = (init: RequestInit | undefined, url: URL) => { status: number; body?: unknown } | "network";
const RESUME_A = "0f1b7d3c-6d4e-4f3a-9a2b-1c2d3e4f5a6b";
const RESUME_GONE = "9e9e9e9e-1111-4222-8333-444444444444";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function baseStatus(overrides: Partial<ConsentStatus> = {}): ConsentStatus {
  return {
    purpose: CONSENT_PURPOSE, copy_version: 1, copy: CONSENT_COPY, copy_sha256: CONSENT_COPY_SHA256,
    publication_active: false, saved_message: CONSENT_SAVED_COPY, version: 0, desired: null, effective: null,
    delivery_status: "none", error_code: null, recent_auth_required: true, ...overrides,
  };
}
const desired = (action: "grant" | "withdraw") => ({ action, profile: null, resume_version_id: null, profile_sha256: null });
const effectiveGrant = (version: number, extra: Partial<NonNullable<ConsentStatus["effective"]>> = {}) => ({
  action: "grant" as const, version, resume_version_id: null, profile_sha256: "0a".repeat(32),
  profile: { display_name: "Ada Lovelace", headline: "Approved headline", location: "London", skills: ["engines"], linkedin: "https://www.linkedin.com/in/ada-l" },
  ...extra,
});
const sourceA = { resume_version_id: RESUME_A, content_sha256: "cd".repeat(32), captured_at: "2026-09-02T10:00:00.000Z", label: "Submitted resume" };
const profileResponse = {
  user: { id: 7, firstName: "Ada", lastName: "Lovelace" },
  profile: { displayName: "Ada Lovelace", skills: ["analysis", "engines", "analysis"], linkedin: "https://linkedin.com/in/ada-l/", location: "London" },
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let routes: Record<string, Handler>;
let calls: Array<{ url: string; method: string; body: any }>;
const route = (method: string, path: string, handler: Handler) => { routes[`${method} ${path}`] = handler; };
const postsTo = (path: string) => calls.filter((c) => c.method === "POST" && c.url === path);

function installFetch() {
  calls = []; routes = {};
  route("GET", "/api/csrf-token", () => ({ status: 200, body: { token: "test-csrf" } }));
  route("GET", "/api/profile", () => ({ status: 200, body: profileResponse }));
  route("GET", "/api/candidate/consent/sources", () => ({ status: 200, body: { sources: [], next_cursor: null } }));
  route("POST", "/api/candidate/privacy/reauth", () => ({ status: 200, body: { ok: true } }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ code: "unrouted" }), { status: 599 });
    calls.push({ url: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const result = handler(init, url);
    if (result === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(result.body ?? {}), { status: result.status, headers: { "content-type": "application/json" } });
  }));
}
async function flush(times = 4) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
let client: QueryClient;
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client}><CandidateConsentPanel /></QueryClientProvider>); });
  await flush();
}
const $ = (sel: string): HTMLElement => { const e = document.body.querySelector<HTMLElement>(sel); if (!e) throw new Error(`missing ${sel}`); return e; };
const maybe = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const byTestId = (id: string) => $(`[data-testid="${id}"]`);
const click = (el: HTMLElement) => act(() => { el.click(); });
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function ensureAgree() { if ($("#consent-agree").getAttribute("aria-checked") !== "true") { click($("#consent-agree")); await flush(1); } }
async function confirm(password = "correct horse") { type($("#consent-password") as HTMLInputElement, password); click(byTestId("consent-confirm")); await flush(6); }
async function grantThrough(password?: string) { await ensureAgree(); click(byTestId("consent-grant")); await flush(1); await confirm(password); }
async function refresh() { click(byTestId("consent-refresh")); await flush(4); }

beforeEach(() => { installFetch(); });
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });

describe("CandidateConsentPanel", () => {
  it("renders the exact server consent copy, unchecked approval and a disabled save button by default", async () => {
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: baseStatus() }));
    await mount();
    const copy = byTestId("consent-copy").textContent ?? "";
    expect(copy).toBe(CONSENT_COPY);
    expect(createHash("sha256").update(copy, "utf8").digest("hex")).toBe(CONSENT_COPY_SHA256);
    expect($("#consent-agree").getAttribute("aria-checked")).toBe("false");
    expect((byTestId("consent-grant") as HTMLButtonElement).disabled).toBe(true);
    expect(byTestId("consent-none").textContent).toMatch(/No Ealana-wide matching permission is active/);
    expect(document.body.textContent).not.toMatch(/matching is active/i);
  });

  it("seeds an editable preview from the profile, deduplicates skills, normalizes LinkedIn and preselects no resume", async () => {
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: baseStatus() }));
    route("GET", "/api/candidate/consent/sources", () => ({ status: 200, body: { sources: [sourceA], next_cursor: null } }));
    await mount();
    expect(($("#consent-display-name") as HTMLInputElement).value).toBe("Ada Lovelace");
    expect(($("#consent-linkedin") as HTMLInputElement).value).toBe("https://www.linkedin.com/in/ada-l");
    expect(byTestId("consent-skills").querySelectorAll("button[aria-label^='Remove skill']").length).toBe(2);
    expect($("#consent-resume-none").getAttribute("aria-checked")).toBe("true");
    expect($(`#consent-resume-${RESUME_A}`).getAttribute("aria-checked")).toBe("false");
  });

  it("submits the exact grant body, treats 202 as pending, keeps polling while pending, and settles only from the server", async () => {
    let served: ConsentStatus = baseStatus();
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: served }));
    route("GET", "/api/candidate/consent/sources", () => ({ status: 200, body: { sources: [sourceA], next_cursor: null } }));
    route("POST", "/api/candidate/consent/grant", () => {
      served = baseStatus({ version: 1, desired: { ...desired("grant"), resume_version_id: RESUME_A }, delivery_status: "pending" });
      return { status: 202, body: { ...served, code: "grant_pending", replayed: false } };
    });
    await mount();
    click($(`#consent-resume-${RESUME_A}`));
    await grantThrough();
    const grant = postsTo("/api/candidate/consent/grant")[0]!;
    expect(grant.body.request_id).toMatch(UUID);
    expect(grant.body).toMatchObject({
      expected_version: 0, purpose: CONSENT_PURPOSE, copy_version: 1, copy_sha256: CONSENT_COPY_SHA256, resume_version_id: RESUME_A,
      profile: { display_name: "Ada Lovelace", headline: "", location: "London", skills: ["analysis", "engines"], linkedin: "https://www.linkedin.com/in/ada-l" },
    });
    expect(byTestId("consent-notice").textContent).toMatch(/version 1.*saved locally.*pending/);
    expect(byTestId("consent-delivery").textContent).toMatch(/being delivered.*not effective yet/);
    expect(maybe('[data-testid="consent-effective"]')).toBeNull();
    // Persisted lifecycle drives polling: pending + retryable error keeps polling; delivered stops it.
    served = { ...served, error_code: "network" };
    await refresh();
    expect(deliveryCopy(served).polling).toBe(true);
    expect(byTestId("consent-delivery").textContent).toMatch(/temporary delivery problem.*keeps retrying/);
    served = baseStatus({ version: 1, desired: served.desired, effective: effectiveGrant(1, { resume_version_id: RESUME_A }), delivery_status: "delivered" });
    await refresh();
    expect(deliveryCopy(served).polling).toBe(false);
    expect(byTestId("consent-effective").textContent).toMatch(/Permission active · version 1/);
    expect(byTestId("consent-effective").textContent).toContain(CONSENT_SAVED_COPY);
    expect(maybe('[data-testid="consent-delivery"]')).toBeNull();
    // The optimistic "pending" notice is reconciled away once the server settled that version.
    expect(maybe('[data-testid="consent-notice"]')).toBeNull();
  });

  it("UI-V1: a lost response keeps the exact command, and Retry replays the same request id and expected version", async () => {
    let served: ConsentStatus = baseStatus();
    let attempts = 0;
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: served }));
    route("POST", "/api/candidate/consent/grant", (init) => {
      attempts += 1;
      const body = JSON.parse(String(init?.body));
      if (attempts === 1) { // server commits, but the response is lost
        served = baseStatus({ version: 1, desired: desired("grant"), delivery_status: "pending" });
        return "network";
      }
      // replay: same request id + same body → prior result
      expect(body.request_id).toBe(postsTo("/api/candidate/consent/grant")[0]!.body.request_id);
      expect(body.expected_version).toBe(0);
      return { status: 202, body: { ...served, code: "grant_pending", replayed: true } };
    });
    await mount();
    type($("#consent-headline") as HTMLInputElement, "Frozen headline");
    await grantThrough();
    expect(byTestId("consent-notice").textContent).toMatch(/response was lost/);
    expect(maybe('[data-testid="consent-retry"]')).not.toBeNull();
    // Status now shows version 1 pending (the server did commit). The Save button offers the same request, not a new one.
    expect(byTestId("consent-delivery").textContent).toMatch(/version 1/);
    expect(byTestId("consent-grant").textContent).toMatch(/Retry saved request/);
    click(byTestId("consent-retry")); await flush(1);
    await confirm();
    const posts = postsTo("/api/candidate/consent/grant");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual(posts[0]!.body);
    expect(byTestId("consent-notice").textContent).toMatch(/earlier request was found and reused/);
    expect(maybe('[data-testid="consent-retry"]')).toBeNull();
  });

  it("UI-V1: the frozen command survives a reauth failure and a status change during reauth surfaces as a definitive 409", async () => {
    let served: ConsentStatus = baseStatus();
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: served }));
    // The CSRF client retries a 403 once with a fresh token, so key the stub on the password, not on a call counter.
    route("POST", "/api/candidate/privacy/reauth", (init) => (JSON.parse(String(init?.body)).password === "wrong" ? { status: 403, body: { code: "candidate_privacy_reauth_failed" } } : { status: 200, body: { ok: true } }));
    route("POST", "/api/candidate/consent/grant", (init) => {
      const body = JSON.parse(String(init?.body));
      return body.expected_version === served.version ? { status: 202, body: { ...served, code: "grant_pending", replayed: false } } : { status: 409, body: { code: "candidate_consent_version_conflict" } };
    });
    await mount();
    await grantThrough("wrong");
    expect(byTestId("consent-notice").textContent).toMatch(/Confirm your password again/);
    expect(maybe("#consent-password")).not.toBeNull();
    expect(postsTo("/api/candidate/consent/grant")).toHaveLength(0);
    // Meanwhile the subject moved elsewhere (version 1). The retry must send the frozen body unchanged → 409, not a re-keyed new version.
    served = baseStatus({ version: 1, desired: desired("withdraw"), delivery_status: "delivered", effective: { action: "withdraw", version: 1, profile: null, resume_version_id: null, profile_sha256: null } });
    await confirm("correct horse");
    const posts = postsTo("/api/candidate/consent/grant");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.expected_version).toBe(0);
    expect(byTestId("consent-notice").textContent).toMatch(/changed elsewhere/);
    expect(byTestId("consent-grant").textContent).toMatch(/Save permission/); // command discarded; a fresh one is offered
  });

  it("R1: Cancel or Escape before the first send drops the unsent command, so the next approval freezes the edited draft", async () => {
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: baseStatus() }));
    route("POST", "/api/candidate/consent/grant", () => ({ status: 202, body: { ...baseStatus({ version: 1, desired: desired("grant"), delivery_status: "pending" }), code: "grant_pending", replayed: false } }));
    await mount();
    type($("#consent-headline") as HTMLInputElement, "Cancelled draft");
    await ensureAgree(); click(byTestId("consent-grant")); await flush(1);
    expect(maybe("#consent-password")).not.toBeNull();
    click(document.body.querySelector<HTMLElement>('[role="dialog"] button:not([data-testid])')!); await flush(2); // Cancel
    expect(maybe("#consent-password")).toBeNull();
    expect(postsTo("/api/candidate/consent/grant")).toHaveLength(0);
    expect(maybe('[data-testid="consent-retained"]')).toBeNull();
    expect(byTestId("consent-grant").textContent).toMatch(/Save permission/);
    type($("#consent-headline") as HTMLInputElement, "New explicit approval");
    click(byTestId("consent-grant")); await flush(1);
    // Escape also dismisses without sending; the next Save freezes the draft as shown at that moment.
    act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); await flush(2);
    expect(postsTo("/api/candidate/consent/grant")).toHaveLength(0);
    type($("#consent-headline") as HTMLInputElement, "Final approval");
    await grantThrough();
    const posts = postsTo("/api/candidate/consent/grant");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.profile.headline).toBe("Final approval");
  });

  it("R1: a failed reauth then Cancel leaves nothing sent and nothing retained; an ambiguous sent request keeps its Retry/Discard controls after Cancel and blocks a change of intent until discarded", async () => {
    let served: ConsentStatus = baseStatus({ version: 1, effective: effectiveGrant(1), desired: desired("grant"), delivery_status: "delivered" });
    let grantMode: "network" | "ok" = "network";
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: served }));
    route("POST", "/api/candidate/privacy/reauth", (init) => (JSON.parse(String(init?.body)).password === "wrong" ? { status: 403, body: { code: "candidate_privacy_reauth_failed" } } : { status: 200, body: { ok: true } }));
    route("POST", "/api/candidate/consent/grant", () => (grantMode === "network" ? "network" : { status: 202, body: { ...served, code: "grant_pending", replayed: true } }));
    await mount();
    // failed reauth → Cancel: the command was never dispatched, so it is dropped.
    await grantThrough("wrong");
    expect(maybe("#consent-password")).not.toBeNull();
    click(document.body.querySelector<HTMLElement>('[role="dialog"] button:not([data-testid])')!); await flush(2);
    expect(postsTo("/api/candidate/consent/grant")).toHaveLength(0);
    expect(maybe('[data-testid="consent-retained"]')).toBeNull();
    // ambiguous sent request: retained card with Retry/Discard, independent of the notice; Cancel keeps it.
    type($("#consent-headline") as HTMLInputElement, "Sent headline");
    await grantThrough();
    expect(postsTo("/api/candidate/consent/grant")).toHaveLength(1);
    expect(byTestId("consent-retained-summary").textContent).toContain("Sent headline");
    type($("#consent-headline") as HTMLInputElement, "Edited after sending");
    expect(byTestId("consent-retained-summary").textContent).toContain("Sent headline");
    expect((byTestId("consent-withdraw") as HTMLButtonElement).disabled).toBe(true); // change of intent blocked while retained
    click(byTestId("consent-retry")); await flush(1);
    click(document.body.querySelector<HTMLElement>('[role="dialog"] button:not([data-testid])')!); await flush(2); // Cancel the retry
    expect(maybe('[data-testid="consent-retry"]')).not.toBeNull();
    expect(maybe('[data-testid="consent-discard"]')).not.toBeNull();
    grantMode = "ok";
    click(byTestId("consent-retry")); await flush(1); await confirm();
    const posts = postsTo("/api/candidate/consent/grant");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual(posts[0]!.body);
    expect(posts[1]!.body.profile.headline).toBe("Sent headline");
    expect(maybe('[data-testid="consent-retained"]')).toBeNull();
    expect((byTestId("consent-withdraw") as HTMLButtonElement).disabled).toBe(false);
  });

  it("UI-V2: pending + privacy_review shows the agreed unavailable wording; failed replacement sits beside the prior effective approval; withdrawal settles as delivered", async () => {
    let served = baseStatus({ version: 2, effective: effectiveGrant(1), desired: desired("grant"), delivery_status: "pending", error_code: "privacy_review" });
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: served }));
    await mount();
    expect(byTestId("consent-delivery").textContent).toMatch(/Temporarily unavailable, try again/);
    expect(byTestId("consent-delivery").textContent).not.toMatch(/denied|restrict/);
    expect(deliveryCopy(served).polling).toBe(true);
    served = { ...served, delivery_status: "failed", error_code: "identity_review_required" };
    await refresh();
    expect(byTestId("consent-effective").textContent).toMatch(/version 1/);
    expect(byTestId("consent-effective").textContent).toContain("Approved headline");
    expect(byTestId("consent-delivery").textContent).toMatch(/version 2.*needs attention.*identity needs review/);
    expect(deliveryCopy(served).polling).toBe(false);
    type($("#consent-headline") as HTMLInputElement, "Edited later, not approved");
    expect(byTestId("consent-effective").textContent).not.toContain("Edited later");
    // Withdrawal: 202 → pending, never effective; delivered → withdrawn and the notice reconciles.
    route("POST", "/api/candidate/consent/withdraw", () => {
      served = baseStatus({ version: 3, effective: effectiveGrant(1), desired: desired("withdraw"), delivery_status: "pending" });
      return { status: 202, body: { ...served, code: "withdrawal_pending", replayed: false } };
    });
    click(byTestId("consent-withdraw")); await flush(1); await confirm();
    expect(postsTo("/api/candidate/consent/withdraw")[0]!.body).toMatchObject({ expected_version: 2 });
    expect(byTestId("consent-notice").textContent).toMatch(/Withdrawal \(version 3\) pending/);
    expect(byTestId("consent-effective").textContent).toMatch(/Permission active · version 1/);
    expect(document.body.textContent).not.toMatch(/Permission withdrawn\./);
    served = baseStatus({ version: 3, desired: desired("withdraw"), effective: { action: "withdraw", version: 3, profile: null, resume_version_id: null, profile_sha256: null }, delivery_status: "delivered" });
    await refresh();
    expect(maybe('[data-testid="consent-effective"]')).toBeNull();
    expect(byTestId("consent-none").textContent).toMatch(/No Ealana-wide matching permission is active/);
    expect(maybe('[data-testid="consent-notice"]')).toBeNull();
  });

  it("UI-V3: the effective summary shows every approved field and identifies the exact resume version, even when it is no longer a current choice", async () => {
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: baseStatus({ version: 1, desired: desired("grant"), effective: effectiveGrant(1, { resume_version_id: RESUME_GONE }), delivery_status: "delivered" }) }));
    route("GET", "/api/candidate/consent/sources", () => ({ status: 200, body: { sources: [sourceA], next_cursor: null } }));
    await mount();
    const snapshot = byTestId("consent-approved-snapshot").textContent ?? "";
    expect(snapshot).toContain("https://www.linkedin.com/in/ada-l");
    expect(snapshot).toContain("Approved headline");
    expect(byTestId("consent-approved-resume").textContent).toContain(RESUME_GONE);
    expect(byTestId("consent-approved-resume").textContent).toMatch(/no longer among your current choices/);
    expect(approvedResumeLabel(RESUME_A, [sourceA])).toMatch(/Submitted resume · submitted .* · cdcdcdcdcdcd · version 0f1b7d3c/);
    expect(approvedResumeLabel(null, [])).toBe("None (profile only)");
    // Today's draft is separate from the approved copy.
    expect(($("#consent-headline") as HTMLInputElement).value).toBe("");
  });

  it("renders 503 as temporarily unavailable with a safe retry, 451 as restricted, and 400 as a field problem", async () => {
    let grantStatus = 503;
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: baseStatus() }));
    route("POST", "/api/candidate/consent/grant", () => ({ status: grantStatus, body: { code: "x" } }));
    await mount();
    type($("#consent-headline") as HTMLInputElement, "Kept edit");
    await grantThrough();
    expect(byTestId("consent-notice").textContent).toContain(CONSENT_UNAVAILABLE_COPY);
    expect(document.body.textContent).not.toMatch(/denied/i);
    expect(maybe('[data-testid="consent-retry"]')).not.toBeNull();
    const first = postsTo("/api/candidate/consent/grant")[0]!.body.request_id;
    click(byTestId("consent-retry")); await flush(1); await confirm();
    expect(postsTo("/api/candidate/consent/grant")[1]!.body.request_id).toBe(first);
    click(byTestId("consent-discard")); await flush(1);
    grantStatus = 451;
    await grantThrough();
    expect(byTestId("consent-notice").textContent).toMatch(/privacy settings currently restrict/);
    expect(postsTo("/api/candidate/consent/grant")[2]!.body.request_id).not.toBe(first); // a discarded command is never re-keyed silently; a new one is explicit
    grantStatus = 400;
    await grantThrough();
    expect(byTestId("consent-notice").textContent).toMatch(/fields could not be accepted/);
    expect(($("#consent-headline") as HTMLInputElement).value).toBe("Kept edit");
  });

  it("UI-V4: skill removal targets are 44px controls and long skills stay inside the form", async () => {
    route("GET", "/api/candidate/consent", () => ({ status: 200, body: baseStatus() }));
    await mount();
    type($("#consent-skill") as HTMLInputElement, "x".repeat(100));
    click(byTestId("consent-skills").parentElement!.querySelector("button:not([aria-label])") as HTMLElement); await flush(1);
    const remove = byTestId("consent-skills").querySelector<HTMLElement>("button[aria-label^='Remove skill']")!;
    expect(remove.className).toMatch(/\bh-11\b/); expect(remove.className).toMatch(/\bw-11\b/);
    expect(byTestId("consent-skills").querySelector("span")!.className).toMatch(/break-all/);
    expect(byTestId("consent-skills").querySelectorAll("button[aria-label^='Remove skill']").length).toBe(3);
  });

  it("validates like the server: scalars, sizes and LinkedIn", () => {
    expect(normalizeLinkedIn("https://linkedin.com/in/ada-l/")).toBe("https://www.linkedin.com/in/ada-l");
    expect(normalizeLinkedIn("http://linkedin.com/in/ada")).toBeNull();
    expect(validateForm({ display_name: "Ada", headline: "", location: "", skills: [], linkedin: "" }).errors[0]).toMatch(/control characters/);
    expect(validateForm({ display_name: "Ada", headline: "", location: "", skills: ["a".repeat(100)], linkedin: "" }).errors).toEqual([]);
    const big = { display_name: "Ada", headline: "", location: "", skills: Array.from({ length: 100 }, (_, i) => `${i}`.padStart(2, "0") + "x".repeat(98)), linkedin: "" };
    expect(validateForm(big).errors).toEqual([]);
    expect(validateForm({ display_name: "  Ada  ", headline: "", location: "", skills: ["a", "a"], linkedin: "" }).errors).toEqual(["Skills must be distinct."]);
    expect(validateForm({ display_name: "", headline: "", location: "", skills: [], linkedin: "" }).errors[0]).toMatch(/Display name/);
    expect(deliveryCopy(baseStatus()).tone).toBe("none");
    expect(deliveryCopy(baseStatus({ version: 1, desired: desired("grant"), delivery_status: "privacy_restricted" })).text).toMatch(/restrict/);
    expect(deliveryCopy(baseStatus({ version: 1, desired: desired("grant"), delivery_status: "failed", error_code: "source_missing" })).text).toMatch(/no longer available/);
  });
});
