/** My profile: only the default résumé offers to update the profile; nothing is read or changed until asked. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DefaultResumeUpdate, offerDismissed } from "./DefaultResumeUpdate";
import { RESUME_UNMATCHED_NOTE, RESUME_UNREADABLE_NOTE } from "@shared/resume-review-notes";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); window.localStorage.clear(); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const button = (name: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === name);
const sparkProfile = (canRequestResume: boolean) => ({
  schemaVersion: 3, draftVersion: 2, profileVersion: 1, preferenceVersion: 1, draft: null,
  confirmedProfile: { displayName: "Synthetic Person", headline: "Recruiter", linkedinUrl: null, currentLocation: null, skills: ["Sourcing"], employment: [], education: [], projects: [] },
  preferences: null, preferenceDraft: { preferenceDraftRevision: 5, preferenceDraftHash: "b".repeat(64), sections: {}, exclusions: [], promotedPreferenceVersion: null, promotedDraftRevision: null },
  publicationActive: true, draftHash: null, effectiveConsentRevision: 1, missingFields: [], pendingCommands: [], hasMorePendingCommands: false,
  capabilities: { canEdit: true, canConfirm: true, confirmBlockedReason: null, canEnrich: false, canRequestResume },
});
const RCMD = "60000000-0000-4000-8000-0000000000aa", RSRC = "61000000-0000-4000-8000-0000000000aa", RPROP = "62000000-0000-4000-8000-0000000000aa";
const fact = (n: number, kind: string, value: unknown) => ({ factId: `40000000-0000-4000-8000-00000000000${n}`, kind, targetRowId: null, value, evidence: [{ quote: "q" }] });
const resumeProposal = { schemaVersion: 1, proposalId: RPROP, sourceId: RSRC, sourceVersion: 1, proposalHash: "d".repeat(64), reviewNotes: [], expiresAt: "2026-11-09T00:00:00.000Z",
  facts: [fact(7, "skill", "Kubernetes"), fact(8, "skill", "Terraform")] };

async function mount(canRequestResume: boolean, routes: Record<string, () => Response | Promise<Response>> = {}, explicit = false) {
  const calls: { key: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost"), key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({ key, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.pathname === "/api/csrf-token") return json(200, { token: "t" });
    const r = routes[key]; return r ? r() : json(404, {});
  }));
  const onClose = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<DefaultResumeUpdate userId={9} resumeId={7} label="cv" onClose={onClose} explicit={explicit}
    loadProfile={async () => ({ kind: "ready", profile: sparkProfile(canRequestResume) }) as never} />); });
  await flush();
  return { calls, onClose };
}

describe("default résumé profile update", () => {
  it("an explicit library request can reopen a dismissed offer without starting a read on mount", async () => {
    window.localStorage.setItem('ealana:resume-offer-dismissed:9:7','1');
    const { calls } = await mount(true, {}, true);
    expect(button('Review suggestions')).toBeDefined();
    expect(calls).toEqual([]);
  });
  it("closing a running read is temporary and a late result cannot reopen it", async () => {
    let finish!: (r: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const { onClose } = await mount(true, {
      "POST /api/candidate/product/sources/resume-snapshots": () => pending,
      "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "review_ready", reason: null, proposalId: RPROP }),
      [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, resumeProposal),
    });
    await act(async () => { button("Review suggestions")!.click(); });
    expect(button("Continue without résumé")).toBeUndefined();
    await act(async () => { button("Close")!.click(); });
    expect(onClose).toHaveBeenCalledOnce();
    expect(offerDismissed(9, 7)).toBe(false);
    finish(json(200, { schemaVersion: 1, sourceId: RSRC, sourceVersion: 1, contentHash: "e".repeat(64) }));
    await flush();
    expect(text()).toBe("");
    act(() => root!.unmount()); root = null; host!.remove();
    await mount(true);
    expect(button("Review suggestions")).toBeDefined();
  });

  it("shows nothing when résumé reading is off", async () => {
    const { calls } = await mount(false);
    expect(text()).toBe("");
    expect(calls).toHaveLength(0);
  });

  it("offers an update without reading anything; Not now is remembered for that résumé", async () => {
    const { calls, onClose } = await mount(true);
    expect(text()).toContain("Update your profile from “cv”?");
    expect(calls.some(c => c.key.includes("/sources/"))).toBe(false);
    await act(async () => { button("Not now")!.click(); });
    expect(onClose).toHaveBeenCalled();
    expect(offerDismissed(9, 7)).toBe(true);
    expect(offerDismissed(9, 8)).toBe(false);
    act(() => root!.unmount()); root = null; host!.remove();
    await mount(true);
    expect(text()).toBe("");
  });

  it("reads the default résumé on request, shows the review, and accepts only what's kept", async () => {
    const { calls } = await mount(true, {
      "POST /api/candidate/product/sources/resume-snapshots": () => json(200, { schemaVersion: 1, sourceId: RSRC, sourceVersion: 1, contentHash: "e".repeat(64) }),
      "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "review_ready", reason: null, proposalId: RPROP }),
      [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, resumeProposal),
      "POST /api/candidate/product/profile/commands": () => json(202, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000001", status: "pending" }),
      "GET /api/candidate/product/profile": () => json(200, { ...sparkProfile(true), draftVersion: 3, draft: { ...sparkProfile(true).confirmedProfile, skills: ["Sourcing", "Kubernetes"] } }),
      "GET /api/candidate/product/profile/commands/50000000-0000-4000-8000-000000000001": () => json(200, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000001", status: "applied", reason: null, draftVersion: 3, preferenceDraftRevision: 5 }),
    });
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    expect(calls.find(c => c.key === "POST /api/candidate/product/sources/resume-snapshots")!.body).toMatchObject({ schemaVersion: 1, resumeId: 7 });
    expect(text()).toContain("Kubernetes");
    const row = Array.from(document.querySelectorAll("li")).find(li => li.textContent?.includes("Terraform"))!;
    await act(async () => { Array.from(row.querySelectorAll("button")).find(b => b.textContent === "Remove")!.click(); });
    await act(async () => { button("Add to my profile")!.click(); }); await flush();
    const cmd = calls.find(c => c.key === "POST /api/candidate/product/profile/commands")!.body;
    expect(cmd).toMatchObject({ action: "accept_source", payload: { proposalId: RPROP, selectedFactIds: [resumeProposal.facts[0]!.factId] } });
    expect(text()).toContain("Added to your profile");
  });

  const readRoutes = {
    "POST /api/candidate/product/sources/resume-snapshots": () => json(200, { schemaVersion: 1, sourceId: RSRC, sourceVersion: 1, contentHash: "e".repeat(64) }),
    "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "review_ready", reason: null, proposalId: RPROP }),
    [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, resumeProposal),
    "POST /api/candidate/product/profile/commands": () => json(202, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000001", status: "pending" }),
  };
  const applied = () => json(200, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000001", status: "applied", reason: null, draftVersion: 3, preferenceDraftRevision: 5 });
  const readback = () => json(200, { ...sparkProfile(true), draftVersion: 3, draft: { ...sparkProfile(true).confirmedProfile, skills: ["Sourcing", "Kubernetes"] } });

  it("SF-R2: a save whose readback failed is retried as the same save, never a new résumé read, and keeps the choices", async () => {
    let profileReads = 0;
    const { calls } = await mount(true, { ...readRoutes, "GET /api/candidate/product/profile/commands/50000000-0000-4000-8000-000000000001": applied,
      "GET /api/candidate/product/profile": () => (++profileReads === 1 ? json(503, { code: "authority_unavailable" }) : readback()) });
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    const row = Array.from(document.querySelectorAll("li")).find(li => li.textContent?.includes("Terraform"))!;
    await act(async () => { Array.from(row.querySelectorAll("button")).find(b => b.textContent === "Remove")!.click(); });
    await act(async () => { button("Add to my profile")!.click(); }); await flush();
    expect(text()).toContain("We couldn't confirm your changes were saved");
    // Choices are kept and locked while the save is unresolved.
    expect(button("Keep it")!.matches(":disabled")).toBe(true);
    await act(async () => { button("Try again")!.click(); }); await flush();
    expect(calls.filter(c => c.key === "POST /api/candidate/product/sources/resume-snapshots")).toHaveLength(1);
    const sent = calls.filter(c => c.key === "POST /api/candidate/product/profile/commands").map(c => c.body);
    expect(new Set(sent.map(b => b.idempotencyKey)).size).toBe(1);
    expect(sent.every(b => JSON.stringify(b) === JSON.stringify(sent[0]))).toBe(true);
    expect(sent[0]).toMatchObject({ payload: { selectedFactIds: [resumeProposal.facts[0]!.factId] } });
    expect(text()).toContain("Added to your profile");
  });

  it("SF-R3: choices are locked while the save is in flight", async () => {
    let release: () => void = () => undefined; const held = new Promise<void>(r => { release = r; });
    await mount(true, { ...readRoutes, "GET /api/candidate/product/profile": readback,
      "GET /api/candidate/product/profile/commands/50000000-0000-4000-8000-000000000001": async () => { await held; return applied(); } });
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    await act(async () => { button("Add to my profile")!.click(); }); await flush();
    const removes = Array.from(document.querySelectorAll("button")).filter(b => b.textContent?.trim() === "Remove") as HTMLButtonElement[];
    expect(removes.length).toBeGreaterThan(0);
    // The fieldset disables every review control; a click changes nothing.
    expect(removes.every(b => b.matches(":disabled"))).toBe(true);
    await act(async () => { removes[0]!.click(); });
    expect(button("Keep it")).toBeUndefined();
    release(); await flush();
    expect(text()).toContain("Added to your profile");
  });

  it("removing every suggestion closes the review as 'not needed', never an empty accept (live test 8 Nov)", async () => {
    const base = (proposal: unknown) => ({
      "POST /api/candidate/product/sources/resume-snapshots": () => json(200, { schemaVersion: 1, sourceId: RSRC, sourceVersion: 1, contentHash: "e".repeat(64) }),
      "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "review_ready", reason: null, proposalId: RPROP }),
      [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, proposal),
      "POST /api/candidate/product/profile/commands": () => json(202, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000002", status: "pending" }),
      "GET /api/candidate/product/profile/commands/50000000-0000-4000-8000-000000000002": () => json(200, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000002", status: "applied", reason: null, draftVersion: 2, preferenceDraftRevision: 5 }),
    });
    const { calls } = await mount(true, base(resumeProposal));
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    for (const name of ["Kubernetes", "Terraform"]) {
      const row = Array.from(document.querySelectorAll("li")).find(li => li.textContent?.includes(name))!;
      await act(async () => { Array.from(row.querySelectorAll("button")).find(b => b.textContent === "Remove")!.click(); });
    }
    const save = Array.from(document.querySelectorAll("button")).find(b => /Add to my profile|Done|Continue|Save/.test(b.textContent ?? "") && !b.matches(":disabled"))!;
    await act(async () => { save.click(); }); await flush();
    const commands = calls.filter(c => c.key === "POST /api/candidate/product/profile/commands").map(c => c.body);
    expect(commands.map(b => b.action)).toEqual(["reject_source"]);
    expect(commands[0].payload).toMatchObject({ proposalId: RPROP, reason: "not_needed" });
  });

  it("says it couldn't match the résumé when suggestions came back but none were usable", async () => {
    const base = (proposal: unknown) => ({
      "POST /api/candidate/product/sources/resume-snapshots": () => json(200, { schemaVersion: 1, sourceId: RSRC, sourceVersion: 1, contentHash: "e".repeat(64) }),
      "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "review_ready", reason: null, proposalId: RPROP }),
      [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, proposal),
      "POST /api/candidate/product/profile/commands": () => json(202, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000002", status: "pending" }),
      "GET /api/candidate/product/profile/commands/50000000-0000-4000-8000-000000000002": () => json(200, { schemaVersion: 3, commandId: "50000000-0000-4000-8000-000000000002", status: "applied", reason: null, draftVersion: 2, preferenceDraftRevision: 5 }),
    });
    await mount(true, base({ ...resumeProposal, facts: [], reviewNotes: [RESUME_UNMATCHED_NOTE] }));
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    expect(text()).toContain("couldn’t match them reliably");
    expect(text()).not.toContain("didn't find anything new");
  });

  it("says it couldn't read the résumé when the reader's output was unusable, and never claims the profile is up to date", async () => {
    const base = {
      "POST /api/candidate/product/sources/resume-snapshots": () => json(200, { schemaVersion: 1, sourceId: RSRC, sourceVersion: 1, contentHash: "e".repeat(64) }),
      "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "review_ready", reason: null, proposalId: RPROP }),
    };
    await mount(true, { ...base, [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, { ...resumeProposal, facts: [], reviewNotes: [RESUME_UNREADABLE_NOTE] }) });
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    expect(text()).toContain("couldn’t read suggestions");
    act(() => root!.unmount()); root = null; host!.remove();
    await mount(true, { ...base, [`GET /api/candidate/product/sources/${RSRC}/proposals/${RPROP}`]: () => json(200, { ...resumeProposal, facts: [] }) });
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    expect(text()).toContain("didn't find anything to add");
    expect(text()).not.toContain("up to date");
  });

  it("a failed read offers only the server's own retry, never a fresh read", async () => {
    const retry = { attemptsUsed: 1, maxAttempts: 3, canRetry: true, canContinueWithoutResume: true, reason: null, message: null };
    const { calls } = await mount(true, { ...readRoutes,
      "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "unavailable", reason: "extraction_failed", proposalId: null, retry }),
      [`POST /api/candidate/product/sources/resume/${RCMD}/retry`]: () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "review_ready", reason: null, proposalId: RPROP }) });
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    await act(async () => { button("Try again")!.click(); }); await flush();
    expect(calls.filter(c => c.key === "POST /api/candidate/product/sources/resume-snapshots")).toHaveLength(1);
    expect(calls.some(c => c.key === `POST /api/candidate/product/sources/resume/${RCMD}/retry`)).toBe(true);
    expect(text()).toContain("Kubernetes");
  });

  it("a failed read the server won't retry shows no Try again", async () => {
    const retry = { attemptsUsed: 3, maxAttempts: 3, canRetry: false, canContinueWithoutResume: true, reason: null, message: null };
    await mount(true, { ...readRoutes,
      "POST /api/candidate/product/sources/resume": () => json(202, { commandId: RCMD, sourceId: RSRC, sourceVersion: 1, state: "unavailable", reason: "extraction_failed", proposalId: null, retry }) });
    await act(async () => { button("Review suggestions")!.click(); }); await flush();
    expect(button("Try again")).toBeUndefined();
  });
});
