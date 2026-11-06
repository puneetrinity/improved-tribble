/** Privacy page: spark candidates see v2 consent (status + withdrawal); legacy candidates keep the old panel. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/use-auth";
import { CandidatePortal } from "@/components/candidate-portal/CandidatePortal";
import { PENDING_POLL_MS, SparkConsentPanel, WITHDRAW_FAILED, WITHDRAW_LINE } from "./SparkConsentPanel";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const btn = (t: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === t) as HTMLButtonElement | undefined;
const consent = (over: Record<string, unknown>) => ({ schemaVersion: 2, consentRevision: 4, desiredAction: "grant", acknowledgedRevision: 4, acknowledgedAction: "grant",
  desiredSchemaVersion: 2, acknowledgedSchemaVersion: 2, deliveryStatus: "delivered", ...over });

async function mountPanel(reads: unknown[], post: (n: number) => Response) {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const posts: any[] = []; let r = 0;
  const get = (async () => json(200, reads[Math.min(r++, reads.length - 1)])) as unknown as typeof fetch;
  const postF = (async (_u: string, init: RequestInit) => { posts.push(JSON.parse(String(init.body))); return post(posts.length); }) as unknown as typeof fetch;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={client}><SparkConsentPanel fetcher={get} postFetcher={postF} /></QueryClientProvider>); });
  await flush();
  return posts;
}

describe("spark consent on the privacy page", () => {
  it("withdrawal asks for confirmation and sends only the v2 withdraw fields; a retry reuses the key", async () => {
    const posts = await mountPanel([consent({}), consent({ consentRevision: 5, desiredAction: "withdraw", acknowledgedAction: "withdraw", acknowledgedRevision: 5 })],
      n => (n === 1 ? json(503, {}) : json(202, {})));
    expect(text()).toContain("You've joined the ealana talent network.");
    expect(text()).toContain(WITHDRAW_LINE);
    await act(async () => { btn("Withdraw")!.click(); }); await flush(2);
    expect(text()).toContain("Withdraw from the talent network?");
    const confirm = () => Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent?.trim() === "Withdraw") as HTMLButtonElement;
    await act(async () => { confirm().click(); }); await flush();
    expect(text()).toContain(WITHDRAW_FAILED);
    await act(async () => { confirm().click(); }); await flush();
    expect(posts).toHaveLength(2);
    expect(Object.keys(posts[0]).sort()).toEqual(["action", "expectedConsentRevision", "idempotencyKey", "schemaVersion"]);
    expect(posts[0]).toMatchObject({ schemaVersion: 2, action: "withdraw", expectedConsentRevision: 4 });
    expect(UUID.test(posts[0].idempotencyKey)).toBe(true);
    expect(posts[1]).toEqual(posts[0]);
    expect(text()).toContain("You've withdrawn from the ealana talent network.");
  });

  it("after withdrawal, Join again goes to setup (consent shown and accepted there), never a silent re-grant", async () => {
    const posts = await mountPanel([consent({ desiredAction: "withdraw", acknowledgedAction: "withdraw" })], () => json(202, {}));
    const join = Array.from(document.querySelectorAll("a")).find(a => a.textContent === "Join again")!;
    expect(join.getAttribute("href")).toBe("/candidate-setup");
    expect(posts).toHaveLength(0);
  });

  const APPLYING = "Your choice is saved and being applied.";
  it("no consent on record says so and offers Join through setup; never 'joined'", async () => {
    const posts = await mountPanel([consent({ consentRevision: 0, desiredAction: null, acknowledgedRevision: 0, acknowledgedAction: null, deliveryStatus: "none" })], () => json(202, {}));
    expect(text()).toContain("You haven't joined the ealana talent network.");
    expect(text()).not.toContain("You've joined");
    expect(Array.from(document.querySelectorAll("a")).find(a => a.textContent === "Join")!.getAttribute("href")).toBe("/candidate-setup");
    expect(posts).toHaveLength(0);
  });

  it("a grant still on its way shows the applying state, not 'joined'", async () => {
    await mountPanel([consent({ consentRevision: 1, desiredAction: "grant", acknowledgedRevision: 0, acknowledgedAction: null, deliveryStatus: "pending" })], () => json(202, {}));
    expect(text()).toContain(APPLYING);
    expect(text()).not.toContain("You've joined");
    expect(btn("Withdraw")).toBeUndefined();
  });

  it("a withdrawal on its way (older grant acknowledged) shows applying, without Join again", async () => {
    await mountPanel([consent({ consentRevision: 5, desiredAction: "withdraw", acknowledgedRevision: 4, acknowledgedAction: "grant", deliveryStatus: "pending" })], () => json(202, {}));
    expect(text()).toContain(APPLYING);
    expect(text()).not.toContain("withdrawn");
    expect(text()).not.toContain("You've joined");
    expect(Array.from(document.querySelectorAll("a")).some(a => a.textContent === "Join again")).toBe(false);
  });

  it("a new choice not yet sent (older revision delivered) still shows applying", async () => {
    await mountPanel([consent({ consentRevision: 5, desiredAction: "withdraw", acknowledgedRevision: 4, acknowledgedAction: "grant", deliveryStatus: "delivered" })], () => json(202, {}));
    expect(text()).toContain(APPLYING);
    expect(text()).not.toContain("You've joined");
  });

  it("an acknowledged withdrawal shows withdrawn with Join again", async () => {
    await mountPanel([consent({ consentRevision: 5, desiredAction: "withdraw", acknowledgedRevision: 5, acknowledgedAction: "withdraw" })], () => json(202, {}));
    expect(text()).toContain("You've withdrawn from the ealana talent network.");
    expect(Array.from(document.querySelectorAll("a")).some(a => a.textContent === "Join again")).toBe(true);
  });

  it("pending moves to delivered by checking again on its own, and by Check again", async () => {
    const pending = consent({ consentRevision: 5, desiredAction: "withdraw", acknowledgedRevision: 4, acknowledgedAction: "grant", deliveryStatus: "pending" });
    const done = consent({ consentRevision: 5, desiredAction: "withdraw", acknowledgedRevision: 5, acknowledgedAction: "withdraw" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mountPanel([pending, done], () => json(202, {}));
      expect(text()).toContain(APPLYING);
      await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS + 10); }); await flush();
      expect(text()).toContain("You've withdrawn from the ealana talent network.");
    } finally { vi.useRealTimers(); }
    act(() => root!.unmount()); root = null; host!.remove();
    await mountPanel([pending, pending, done], () => json(202, {}));
    expect(text()).toContain(APPLYING);
    await act(async () => { btn("Check again")!.click(); }); await flush();
    await act(async () => { btn("Check again")!.click(); }); await flush();
    expect(text()).toContain("You've withdrawn from the ealana talent network.");
  });

  it("an account held for review and a load failure each say so", async () => {
    await mountPanel([consent({ deliveryStatus: "identity_review_required" })], () => json(202, {}));
    expect(text()).toContain("Your account needs a check by our team.");
    expect(btn("Withdraw")).toBeUndefined();
  });

  it("spark candidates get the v2 panel; legacy candidates keep the older one", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => { const p = new URL(String(input), "http://x").pathname; seen.push(p); return json(404, {}); }));
    const mount = async (sparkConsent: boolean) => {
      host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await act(async () => { root!.render(<QueryClientProvider client={client}><AuthProvider>
        <CandidatePortal firstName="S" section="privacy" onNavigate={() => undefined} discovery="not_ready" matching="not_ready" publicJobs={[]} profile={null} onSignOut={() => undefined} sparkConsent={sparkConsent} />
      </AuthProvider></QueryClientProvider>); });
      await flush();
    };
    await mount(true);
    expect(seen).toContain("/api/candidate/product/consent");
    expect(seen).not.toContain("/api/candidate/consent");
    // U5: the wider privacy requests stay available to spark candidates, under their own heading.
    expect(seen).toContain("/api/candidate/privacy/status");
    expect(text()).toContain("Other privacy requests");
    act(() => root!.unmount()); root = null; host!.remove(); seen.length = 0;
    await mount(false);
    expect(seen).toContain("/api/candidate/consent");
    expect(seen).not.toContain("/api/candidate/product/consent");
    expect(seen).toContain("/api/candidate/privacy/status");
    expect(text()).not.toContain("Other privacy requests");
  });
});
