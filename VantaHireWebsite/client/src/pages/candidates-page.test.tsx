/**
 * Wave 4D — candidates-page private-index adoption (Claude reserved UI path).
 *
 * ReactDOM-only harness (no testing-library peer; package.json is frozen). The page is rendered with a URL-routed
 * fetch stub that answers the real endpoints it calls (`/api/user`, `/api/csrf-token`, `/api/candidates/semantic-search`)
 * with the server's exact response shape, so the honest state copy, per-result index badges, processing counts,
 * bounded-saturation notice, reranker status and closed error copy are asserted against what the backend returns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import CandidatesPage, {
  formatObservedDate, indexCopy, indexStateBadge, processingSummary, searchErrorCopy,
} from "./candidates-page";

type Handler = (init: RequestInit | undefined, url: URL) => { status: number; body?: unknown };
const recruiter = { id: 11, username: "lead@fixture.invalid", role: "recruiter", firstName: "Lead", lastName: "Recruiter", emailVerified: true };

function result(applicationId: number, overrides: Record<string, unknown> = {}) {
  return {
    applicationId, name: `Applicant ${applicationId}`, email: `a${applicationId}@fixture.invalid`, phone: null,
    currentJobId: 3, currentJobTitle: "Backend Engineer", currentStageId: 1, currentStageName: "Applied",
    matchScoreRaw: 0.8123, matchScore: 81, matchedChunks: 2, highlights: ["Built payment services in Go"],
    resume: { resumeFilename: "resume.pdf", signedUrl: null, expiresAt: null }, canMoveToJob: true, canOpenResume: true,
    ...overrides,
  };
}
const counts = (o: Partial<Record<string, number>> = {}) => ({ ready: 0, updating: 0, refresh_failed: 0, pending: 0, needs_review: 0, failed: 0, ...o });
const indexed = (applicationId: number, state: string, generation: number | null = 3, observed: string | null = "2026-09-12T10:00:00.000Z") =>
  result(applicationId, { indexState: state, indexGeneration: generation, sourceObservedAt: observed });

let root: Root; let container: HTMLDivElement; let calls: { url: string; init: RequestInit | undefined }[]; let handlers: Record<string, Handler>;

function install(map: Record<string, Handler>) {
  handlers = map;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    calls.push({ url: url.pathname, init });
    const h = handlers[url.pathname];
    if (!h) return new Response(JSON.stringify({ error: "unrouted " + url.pathname }), { status: 404, headers: { "content-type": "application/json" } });
    const r = h(init, url);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  }));
}
const base = (): Record<string, Handler> => ({
  "/api/user": () => ({ status: 200, body: recruiter }),
  "/api/csrf-token": () => ({ status: 200, body: { token: "test-csrf" } }),
});
// Mirrors ProtectedRoute: the page is only ever rendered once the auth user is known.
function Gate() { const { user, isLoading } = useAuth(); return user && !isLoading ? <CandidatesPage /> : null; }
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<QueryClientProvider client={client}><AuthProvider><Gate /></AuthProvider></QueryClientProvider>); });
  for (let i = 0; i < 20 && !container.querySelector("input"); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); });
}
async function search(query: string) {
  const input = container.querySelector("input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, query); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const button = Array.from(container.querySelectorAll("button")).find(b => /search/i.test(b.textContent ?? "") && !b.disabled)!;
  await act(async () => { button.click(); });
  for (let i = 0; i < 40 && !container.querySelector('[data-testid="search-results"], [data-testid="search-error"], [data-testid="search-empty"]'); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  }
}
const text = () => container.textContent ?? "";

beforeEach(() => { calls = []; });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

describe("candidates-page index adoption", () => {
  it("helpers: badge copy per state, date formatting, summary rows and closed error copy", () => {
    expect(indexStateBadge({ indexState: "ready", indexGeneration: 4, sourceObservedAt: "2026-09-12T10:00:00.000Z" })).toMatchObject({ state: "ready", label: indexCopy.states.ready.label });
    expect(indexStateBadge({ indexState: "updating", indexGeneration: 2, sourceObservedAt: null })!.detail).toBe("showing v2");
    expect(indexStateBadge({ indexState: "refresh_failed", indexGeneration: 5, sourceObservedAt: "2026-01-02T00:00:00Z" })!.detail).toMatch(/^showing v5 · /);
    expect(indexStateBadge({ indexState: "legacy" })).toMatchObject({ state: "legacy", detail: null });
    expect(indexStateBadge({})).toBeNull();
    expect(formatObservedDate("not-a-date")).toBeNull(); expect(formatObservedDate(null)).toBeNull();
    expect(processingSummary(undefined)).toBeNull();
    const s = processingSummary({ counts: counts({ ready: 12, pending: 3 }), bounded: false, limit: 1000 })!;
    expect(s.rows.map(r => r.key)).toEqual(["ready", "pending"]); expect(s.notAllSearchable).toBe(true);
    expect(processingSummary({ counts: counts({ ready: 1 }), bounded: false, limit: 1000 })!.notAllSearchable).toBe(false);
    expect(searchErrorCopy('503: {"code":"candidate_index_search_unavailable"}')).toBe(indexCopy.unavailable);
    expect(searchErrorCopy('422: {"code":"candidate_index_filter_unsupported"}')).toBe(indexCopy.unsupportedFilter);
    expect(searchErrorCopy('422: {"code":"candidate_index_filter_conflict"}')).toBe(indexCopy.filterConflict);
    expect(searchErrorCopy('422: {"code":"candidate_index_query_too_long"}')).toBe(indexCopy.queryTooLong);
    expect(searchErrorCopy('503: {"code":"candidate_privacy_reconciliation_required"}')).toBe(indexCopy.privacyReconciling);
    // closed fallback: raw JSON, vendor/transport text and legacy-mode error bodies are never echoed
    for (const raw of ['500: {"error":"ActiveKG /search returned 503"}', "ActiveKG /search returned 503", "500: boom", undefined, ""]) {
      expect(searchErrorCopy(raw)).toBe(indexCopy.failed);
    }
  });

  it("renders honest per-result index states, processing counts, saturation and reranker status without claiming full coverage", async () => {
    install({ ...base(), "/api/candidates/semantic-search": (init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ query: "payments engineer", top_k: 10, use_reranker: true });
      return { status: 200, body: {
        query: "payments engineer", count: 4, scoreType: "cross_encoder", displayScoreType: "cosine",
        indexProcessing: { counts: counts({ ready: 40, updating: 2, refresh_failed: 1, pending: 5, needs_review: 1 }), bounded: true, limit: 1000 },
        indexReranker: "applied", indexSaturated: true,
        results: [indexed(1, "ready", 4), indexed(2, "updating", 3), indexed(3, "refresh_failed", 2), result(4, { indexState: "legacy" })],
        candidates: [],
      } };
    } });
    await mount(); await search("payments engineer");
    const badges = Array.from(container.querySelectorAll('[data-testid="index-state"]')).map(b => [b.getAttribute("data-state"), b.textContent]);
    expect(badges.map(b => b[0])).toEqual(["ready", "updating", "refresh_failed", "legacy"]);
    expect(badges[0]![1]).toContain(indexCopy.states.ready.label); expect(badges[0]![1]).toContain("v4");
    expect(badges[1]![1]).toContain("showing v3"); expect(badges[2]![1]).toContain(indexCopy.states.refresh_failed.label);
    expect(badges[3]![1]).toContain(indexCopy.states.legacy.label);
    const summary = container.querySelector('[data-testid="index-processing"]')!;
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.textContent).toContain("40 " + indexCopy.counts.ready); expect(summary.textContent).toContain("5 " + indexCopy.counts.pending);
    expect(summary.textContent).toContain(indexCopy.notAllSearchable); expect(summary.textContent).toContain(indexCopy.bounded);
    expect(text()).toContain(indexCopy.saturated); expect(text()).toContain(indexCopy.rerankApplied);
    expect(text()).not.toMatch(/all applicants|fully indexed|every applicant/i);
    // retained actions
    expect(Array.from(container.querySelectorAll("button")).filter(b => /resume/i.test(b.textContent ?? "")).length).toBe(4);
    expect(Array.from(container.querySelectorAll("button")).filter(b => /add to job|move/i.test(b.textContent ?? "")).length).toBe(4);
  });

  it("shows the reranker fallback honestly and no index badge when the response carries no index fields", async () => {
    install({ ...base(), "/api/candidates/semantic-search": () => ({ status: 200, body: {
      query: "q", count: 1, scoreType: "rrf_fused", displayScoreType: "cosine", indexReranker: "fallback",
      indexProcessing: { counts: counts({ ready: 3 }), bounded: false, limit: 1000 }, indexSaturated: false,
      results: [result(9)], candidates: [],
    } }) });
    await mount(); await search("q");
    expect(container.querySelectorAll('[data-testid="index-state"]').length).toBe(0);
    expect(text()).toContain(indexCopy.rerankFallback); expect(text()).not.toContain(indexCopy.notAllSearchable); expect(text()).not.toContain(indexCopy.saturated);
  });

  it("keeps the empty result honest with processing counts and maps unavailability and unsupported filters to closed copy", async () => {
    install({ ...base(), "/api/candidates/semantic-search": () => ({ status: 200, body: {
      query: "nothing", count: 0, scoreType: "rrf_fused", displayScoreType: "cosine",
      indexProcessing: { counts: counts({ pending: 7 }), bounded: false, limit: 1000 }, results: [], candidates: [],
    } }) });
    await mount(); await search("nothing");
    expect(container.querySelector('[data-testid="search-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="index-processing"]')!.textContent).toContain("7 " + indexCopy.counts.pending);
    expect(text()).toContain(indexCopy.notAllSearchable);
    await act(async () => { root.unmount(); }); container.remove();
    install({ ...base(), "/api/candidates/semantic-search": () => ({ status: 503, body: { code: "candidate_index_search_unavailable" } }) });
    await mount(); await search("later");
    expect(container.querySelector('[data-testid="search-error"]')!.textContent).toContain(indexCopy.unavailable);
    expect(text()).not.toContain("candidate_index_search_unavailable");
  });
});
