/**
 * Résumé reading: request flow (same-key resend, polling, explicit Try again) and the
 * rendered status card. Fetch is stubbed per URL so real bodies and keys are asserted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ResumeReadStatus, useResumeRead, type ResumeRead } from "./SourceReview";
import {
  RESUME_GENERIC_COPY, RESUME_SOURCE, startResumeRead, tryResumeAgain, watchResume, type ResumeSourceStatus,
} from "@/lib/candidate-profile-api";

const SRC = "22222222-2222-4222-8222-222222222222";
const CMD = "33333333-3333-4333-8333-333333333333";
const NEXT = "44444444-4444-4444-8444-444444444444";
const st = (over: Partial<ResumeSourceStatus> = {}): ResumeSourceStatus =>
  ({ commandId: CMD, sourceId: SRC, sourceVersion: 1, state: "queued", reason: null, proposalId: null, retry: null, ...over });
const retryView = (over: Record<string, unknown> = {}) => ({ attemptsUsed: 1, maxAttempts: 3, canRetry: true,
  canContinueWithoutResume: true, reason: null, message: "Something went wrong reading your résumé.", ...over });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Step = Response | "network";
function stub(routes: Record<string, Step[]>) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const list = routes[`${method} ${url}`];
    if (!list?.length) throw new Error(`unexpected ${method} ${url}`);
    const step = list.length > 1 ? list.shift()! : list[0]!;
    if (step === "network") throw new TypeError("network");
    return step.clone();
  });
  return { f: f as unknown as typeof fetch, calls };
}
const noWait = async () => {};
let keys = 0;
const newKey = () => `00000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`;

describe("résumé reading requests", () => {
  it("snapshots the owned résumé, queues it and polls until a result, without retrying on a read", async () => {
    const { f, calls } = stub({
      [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
      [`POST ${RESUME_SOURCE.queue}`]: [json(202, st())],
      [`GET ${RESUME_SOURCE.status(CMD)}`]: [json(200, st({ state: "extracting" })), json(503, { code: "x" }), json(200, st({ state: "review_ready", proposalId: NEXT }))],
    });
    const seen: string[] = [];
    const final = await startResumeRead(12, s => seen.push(s.state), undefined, { fetcher: f, postFetcher: f, wait: noWait, newKey });
    expect(final.state).toBe("review_ready");
    expect(seen).toEqual(["queued", "extracting", "review_ready"]);
    expect(calls.find(c => c.url === RESUME_SOURCE.snapshot)!.body).toEqual({ schemaVersion: 1, idempotencyKey: expect.any(String), resumeId: 12 });
    expect(calls.find(c => c.url === RESUME_SOURCE.queue)!.body).toMatchObject({ sourceId: SRC, sourceVersion: 1 });
    expect(calls.filter(c => c.url.endsWith("/retry"))).toHaveLength(0);
  });

  it("re-sends a lost POST with the same key and body, so no second reading is started", async () => {
    const { f, calls } = stub({
      [`POST ${RESUME_SOURCE.snapshot}`]: ["network", json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
      [`POST ${RESUME_SOURCE.queue}`]: ["network", "network", json(202, st({ state: "review_ready" }))],
    });
    await startResumeRead(12, () => {}, undefined, { fetcher: f, postFetcher: f, wait: noWait, newKey });
    const snaps = calls.filter(c => c.url === RESUME_SOURCE.snapshot);
    const queues = calls.filter(c => c.url === RESUME_SOURCE.queue);
    expect(snaps).toHaveLength(2); expect(queues).toHaveLength(3);
    expect(new Set(snaps.map(c => JSON.stringify(c.body))).size).toBe(1);
    expect(new Set(queues.map(c => JSON.stringify(c.body))).size).toBe(1);
  });

  it("gives up after three lost responses instead of re-sending forever", async () => {
    const { f, calls } = stub({ [`POST ${RESUME_SOURCE.snapshot}`]: ["network"] });
    await expect(startResumeRead(12, () => {}, undefined, { fetcher: f, postFetcher: f, wait: noWait, newKey })).rejects.toMatchObject({ code: "uncertain" });
    expect(calls).toHaveLength(3);
  });

  it("a refused request is not re-sent", async () => {
    const { f, calls } = stub({ [`POST ${RESUME_SOURCE.snapshot}`]: [json(409, { code: "source_changed" })] });
    await expect(startResumeRead(12, () => {}, undefined, { fetcher: f, postFetcher: f, wait: noWait, newKey })).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(1);
  });

  it("Try again posts once for the failed command and watches the successor", async () => {
    const { f, calls } = stub({
      [`POST ${RESUME_SOURCE.retry(CMD)}`]: [json(202, st({ commandId: NEXT }))],
      [`GET ${RESUME_SOURCE.status(NEXT)}`]: [json(200, st({ commandId: NEXT, state: "review_ready" }))],
    });
    const final = await tryResumeAgain(CMD, () => {}, undefined, { fetcher: f, postFetcher: f, wait: noWait, newKey });
    expect(final.commandId).toBe(NEXT);
    expect(calls.filter(c => c.method === "POST")).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ schemaVersion: 1, idempotencyKey: expect.any(String), retryOfCommandId: CMD });
  });

  it("stops watching on a refused status read", async () => {
    const { f } = stub({ [`GET ${RESUME_SOURCE.status(CMD)}`]: [json(404, { code: "not_found" })] });
    await expect(watchResume(CMD, () => {}, undefined, { fetcher: f, wait: noWait })).rejects.toMatchObject({ status: 404 });
  });
});

let root: Root | null = null; let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
function render(read: ResumeRead, onRetry = vi.fn(), onContinue = vi.fn()) {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<ResumeReadStatus read={read} onRetry={onRetry} onContinue={onContinue} />));
  return { onRetry, onContinue, text: () => host!.textContent ?? "", button: (label: string) => [...host!.querySelectorAll("button")].find(b => b.textContent?.includes(label)) };
}

describe("résumé reading status card", () => {
  it("shows reading progress as a polite live status", () => {
    const v = render({ kind: "reading", status: null });
    expect(v.text()).toContain("Reading your résumé");
    expect(host!.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
  });

  it("shows the server's failure message with Try again and the tries used", () => {
    const v = render({ kind: "failed", status: st({ state: "unavailable", reason: "outcome_unknown", retry: retryView() }) });
    expect(v.text()).toContain("Something went wrong reading your résumé.");
    expect(v.text()).toContain("Tries used: 1 of 3");
    act(() => v.button("Try again")!.click());
    expect(v.onRetry).toHaveBeenCalledWith(CMD);
  });

  it("after the last try there is no Try again, only filling the profile in yourself", () => {
    const v = render({ kind: "failed", status: st({ state: "unavailable", reason: "outcome_unknown", retry: retryView({
      attemptsUsed: 3, canRetry: false, reason: "attempt_limit",
      message: "We still couldn't read your résumé. Please upload a different file or fill in your profile yourself." }) }) });
    expect(v.button("Try again")).toBeUndefined();
    expect(v.text()).toContain("We still couldn't read your résumé.");
    act(() => v.button("Fill in my profile myself")!.click());
    expect(v.onContinue).toHaveBeenCalled();
  });
  it("an unpaid budget refusal shows zero tries used and allows an explicit retry", () => {
    const v = render({ kind: "failed", status: st({ state: "unavailable", reason: "budget_unavailable",
      retry: retryView({ attemptsUsed: 0, canRetry: true, message: null }) }) });
    expect(v.text()).toContain("Tries used: 0 of 3");
    act(() => v.button("Try again")!.click());
    expect(v.onRetry).toHaveBeenCalledWith(CMD);
  });

  it("a failure the server can't retry shows no Try again and never invents a message", () => {
    const v = render({ kind: "failed", status: st({ state: "unavailable", reason: "mystery", retry: retryView({ canRetry: false, reason: "not_retryable", message: null }) }) });
    expect(v.button("Try again")).toBeUndefined();
    expect(v.text()).toContain(RESUME_GENERIC_COPY);
  });

  it("buttons meet the 44px touch target", () => {
    const v = render({ kind: "failed", status: st({ state: "held", reason: "outcome_unknown", retry: retryView() }) });
    for (const b of host!.querySelectorAll("button")) expect(b.className).toContain("min-h-11");
    expect(v.button("Try again")).toBeDefined();
  });
});

function Harness({ onState }: { onState: (r: ResumeRead, api: ReturnType<typeof useResumeRead>) => void }) {
  const api = useResumeRead(deps);
  onState(api.read, api);
  return null;
}
let deps: Parameters<typeof useResumeRead>[0] = {};

describe("useResumeRead", () => {
  it("a double click starts only one reading", async () => {
    const { f, calls } = stub({
      [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
      [`POST ${RESUME_SOURCE.queue}`]: [json(202, st({ state: "review_ready" }))],
    });
    deps = { fetcher: f, postFetcher: f, wait: noWait, newKey };
    let last: ResumeRead = { kind: "idle" }; let api!: ReturnType<typeof useResumeRead>;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    act(() => root!.render(<Harness onState={(r, a) => { last = r; api = a; }} />));
    await act(async () => { void api.start(12); void api.start(12); await new Promise(r => setTimeout(r, 0)); });
    expect(calls.filter(c => c.url === RESUME_SOURCE.snapshot)).toHaveLength(1);
    expect(last.kind).toBe("ready");
  });
});

import { acceptPayload, proposalItems, resumeAdapters, ResumeReadError, type SourceProposal } from "./SourceReview";
const PROP = "55555555-5555-4555-8555-555555555555";
const f = (n: number, kind: string, value: unknown) => ({ factId: `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`, kind, targetRowId: null, value, evidence: [{ quote: `quote ${n}` }] });
const proposal = (): SourceProposal => ({ schemaVersion: 1, proposalId: PROP, sourceId: SRC, sourceVersion: 1, proposalHash: "e".repeat(64), reviewNotes: [], expiresAt: "2026-11-30T00:00:00.000Z",
  facts: [f(1, "skill", "Kafka"), f(2, "project", { id: "77777777-7777-4777-8777-777777777777", name: "Ledgerline", description: "", start: null, end: null, current: false }),
    f(3, "employment", { id: "88888888-8888-4888-8888-888888888888", employer: "Acme", title: "Engineer", description: "", start: { value: "2019-03", precision: "month" }, end: null, current: true }),
    f(4, "currentLocation", { city: "Bengaluru", countryCode: "IN", displayCountry: "India" }), f(5, "displayName", "Priya Rao")] });
const id = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;

describe("résumé suggestions", () => {
  it("shows each server fact with the journey's review rows and the quoted evidence", () => {
    const items = proposalItems(proposal());
    expect(items.map(i => [i.kind, i.id])).toEqual([["skill", id(1)], ["project", id(2)], ["employment", id(3)], ["location", id(4)]]);
    expect(items[2]).toMatchObject({ employer: "Acme", title: "Engineer", start: "2019-03", current: true, evidence: "quote 3" });
  });

  it("sends kept facts, corrections for edited names and replaces a different current location", () => {
    const p = proposal();
    const payload = acceptPayload(p, { [id(3)]: "remove" }, { [id(1)]: "Apache Kafka", [id(2)]: "Ledgerline v2" },
      { currentLocation: { city: "Pune", countryCode: "IN", displayCountry: "India" } } as any);
    expect(payload.selectedFactIds).toEqual([id(1), id(2), id(4)]);
    expect(payload.corrections).toEqual([{ factId: id(1), kind: "skill", value: "Apache Kafka" },
      { factId: id(2), kind: "project", value: { ...p.facts[1]!.value, name: "Ledgerline v2" } }]);
    expect(payload.replaceFactIds).toEqual([id(4)]);
    expect(payload).toMatchObject({ proposalId: PROP, sourceVersion: 1, proposalHash: "e".repeat(64) });
  });

  it("does not replace a location that is already the same, or when there is none", () => {
    expect(acceptPayload(proposal(), {}, {}, { currentLocation: { city: "Bengaluru", countryCode: "IN", displayCountry: "India" } } as any).replaceFactIds).toEqual([]);
    expect(acceptPayload(proposal(), {}, {}, null).replaceFactIds).toEqual([]);
  });

  it("reads a library résumé end to end and accepts with one fixed key", async () => {
    const { f: fetcher } = stub({
      [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
      [`POST ${RESUME_SOURCE.queue}`]: [json(202, st({ state: "review_ready", proposalId: PROP }))],
    });
    const accept = vi.fn(async (_key: string, _payload: Record<string, unknown>) => ({ skills: ["Kafka"] }) as any);
    const a = resumeAdapters({ session: { acceptSource: accept }, currentProfile: () => null,
      deps: { fetcher, postFetcher: fetcher, wait: noWait, newKey, upload: async () => 12, fetchProposal: async () => proposal() } });
    const x = await a.readResume(new File(["x"], "cv.pdf"));
    expect(x.resumeVersionId).toBe(PROP);
    expect(x.items).toHaveLength(4);
    await a.acceptResume(PROP, {}, {}); await a.acceptResume(PROP, {}, {});
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept.mock.calls[0]![0]).toBe(accept.mock.calls[1]![0]);
  });

  it("nothing kept closes the review as 'not needed' (never an empty accept, which the server refuses)", async () => {
    for (const [label, prop, decisions] of [
      ["no suggestions", { ...proposal(), facts: [] }, {}],
      ["every suggestion removed", proposal(), Object.fromEntries(proposal().facts.map((f: any) => [f.factId, "remove"]))],
    ] as const) {
      const { f: fetcher } = stub({
        [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
        [`POST ${RESUME_SOURCE.queue}`]: [json(202, st({ state: "review_ready", proposalId: PROP }))],
      });
      const accept = vi.fn(); const reject = vi.fn(async () => undefined);
      const current = { skills: ["Kafka"] } as any;
      const a = resumeAdapters({ session: { acceptSource: accept, rejectSource: reject }, currentProfile: () => current,
        deps: { fetcher, postFetcher: fetcher, wait: noWait, newKey, upload: async () => 12, fetchProposal: async () => prop } });
      await a.readResume(new File(["x"], "cv.pdf"));
      expect(await a.acceptResume(PROP, decisions as any, {}), label).toBe(current);
      await a.acceptResume(PROP, decisions as any, {});
      expect(accept, label).not.toHaveBeenCalled();
      expect(reject, label).toHaveBeenCalledTimes(2);
      expect((reject.mock.calls as any)[0][1], label).toEqual({ proposalId: PROP, sourceVersion: prop.sourceVersion, proposalHash: prop.proposalHash, reason: "not_needed" });
      expect((reject.mock.calls as any)[0][0], label).toBe((reject.mock.calls as any)[1][0]);
    }
  });

  it("a failed 'not needed' close is retried with the same key, and nothing is accepted (Codex round 1)", async () => {
    const { f: fetcher } = stub({
      [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
      [`POST ${RESUME_SOURCE.queue}`]: [json(202, st({ state: "review_ready", proposalId: PROP }))],
    });
    const accept = vi.fn(); let n = 0;
    const reject = vi.fn(async () => { if (++n === 1) throw new Error("network"); });
    const a = resumeAdapters({ session: { acceptSource: accept, rejectSource: reject }, currentProfile: () => ({ skills: [] }) as any,
      deps: { fetcher, postFetcher: fetcher, wait: noWait, newKey, upload: async () => 12, fetchProposal: async () => ({ ...proposal(), facts: [] }) } });
    await a.readResume(new File(["x"], "cv.pdf"));
    await expect(a.acceptResume(PROP, {}, {})).rejects.toThrow("network");
    await a.acceptResume(PROP, {}, {});
    expect(reject).toHaveBeenCalledTimes(2);
    expect((reject.mock.calls as any)[0][0]).toBe((reject.mock.calls as any)[1][0]);
    expect(accept).not.toHaveBeenCalled();
  });

  it("flags a proposal whose suggestions could not be matched to the résumé text", async () => {
    const { RESUME_UNMATCHED_NOTE, RESUME_UNREADABLE_NOTE } = await import("@shared/resume-review-notes");
    for (const [notes, expected, unreadable] of [[[RESUME_UNMATCHED_NOTE], true, false], [[], false, false], [[RESUME_UNREADABLE_NOTE], false, true]] as const) {
      const { f: fetcher } = stub({
        [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
        [`POST ${RESUME_SOURCE.queue}`]: [json(202, st({ state: "review_ready", proposalId: PROP }))],
      });
      const a = resumeAdapters({ session: { acceptSource: vi.fn() }, currentProfile: () => null,
        deps: { fetcher, postFetcher: fetcher, wait: noWait, newKey, upload: async () => 12, fetchProposal: async () => ({ ...proposal(), facts: [], reviewNotes: [...notes] }) } });
      const x = await a.readResume(new File(["x"], "cv.pdf"));
      expect(x.unmatched).toBe(expected);
      expect(x.unreadable).toBe(unreadable);
    }
  });

  it("a reading that ends without suggestions becomes the failure card, never 'nothing new'", async () => {
    const { f: fetcher } = stub({
      [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
      [`POST ${RESUME_SOURCE.queue}`]: [json(202, st({ state: "unavailable", reason: "outcome_unknown", retry: retryView() as any }))],
    });
    const a = resumeAdapters({ session: { acceptSource: vi.fn() }, currentProfile: () => null,
      deps: { fetcher, postFetcher: fetcher, wait: noWait, newKey, upload: async () => 12 } });
    const e = await a.readResume(new File(["x"], "cv.pdf")).catch(err => err);
    expect(e).toBeInstanceOf(ResumeReadError);
    expect(e.read).toMatchObject({ kind: "failed", status: { reason: "outcome_unknown" } });
  });

  it("a mismatched proposal is refused, and accepting an unknown proposal is refused", async () => {
    const { f: fetcher } = stub({
      [`POST ${RESUME_SOURCE.snapshot}`]: [json(200, { schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: "a".repeat(64) })],
      [`POST ${RESUME_SOURCE.queue}`]: [json(202, st({ state: "review_ready", proposalId: PROP }))],
    });
    const a = resumeAdapters({ session: { acceptSource: vi.fn() }, currentProfile: () => null,
      deps: { fetcher, postFetcher: fetcher, wait: noWait, newKey, upload: async () => 12, fetchProposal: async () => ({ ...proposal(), sourceId: CMD }) } });
    await expect(a.readResume(new File(["x"], "cv.pdf"))).rejects.toBeInstanceOf(ResumeReadError);
    await expect(a.acceptResume(PROP, {}, {})).rejects.toMatchObject({ code: "source_not_found" });
  });
});

describe("résumé upload copy (approved 4 Nov)", () => {
  it("explains a definite unreadable/unsupported file, and keeps the retry copy for temporary failures", async () => {
    const { resumeRequestCopy } = await import("./SourceReview");
    const { ProfileApiError } = await import("@/lib/candidate-profile-api");
    const unreadable = "We couldn't read this résumé. Try another PDF or Word file with selectable text, or fill in your profile yourself.";
    expect(resumeRequestCopy(new ProfileApiError(400, "Invalid resume"))).toBe(unreadable);
    expect(resumeRequestCopy(new ProfileApiError(415, "Resume extraction failed"))).toBe(unreadable);
    expect(resumeRequestCopy(new ProfileApiError(400, "Maximum 3 resumes allowed"))).toContain("already has 3 files");
    for (const e of [new ProfileApiError(503, "Resume extraction unavailable"), new ProfileApiError(0, "uncertain"), new Error("x")])
      expect(resumeRequestCopy(e)).toBe("We couldn't start reading your résumé. Please try again in a moment.");
  });
});
