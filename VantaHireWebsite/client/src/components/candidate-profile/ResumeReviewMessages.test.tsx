/** The wizard's résumé review says WHY it is empty (couldn't read / couldn't match / nothing to add),
 * including after a refresh restores a review that was read but not yet reviewed (Codex LR3 note). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SparkAssist } from "./SparkAssist";
import { confirmGapsOf, NO_DATES, OnboardingWizard, RESUME_UNMATCHED_COPY, RESUME_UNREADABLE_COPY, type ResumeItem } from "./OnboardingWizard";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

async function restore(x: { items: ResumeItem[]; unmatched?: boolean; unreadable?: boolean }) {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<OnboardingWizard firstName="Test" imported="none" consentVersion="v" discovery="not_ready" matching="not_ready"
    onSave={async () => ({ ok: true }) as never} onConfirm={async () => undefined}
    readResume={async () => { throw new Error("not used"); }}
    saved={{ profile: { displayName: "Test Person", headline: "Recruiter", linkedinUrl: null, currentLocation: null, skills: ["Sourcing"], employment: [], education: [], projects: [] } as any,
      preferences: null, answered: [], authorisation: [] }}
    pendingResume={async () => ({ resumeVersionId: "62000000-0000-4000-8000-0000000000aa", ...x })} />); });
  await flush();
}

describe("résumé review messages", () => {
  it("a restored review whose output couldn't be read says so", async () => {
    await restore({ items: [], unreadable: true });
    expect(text()).toContain(RESUME_UNREADABLE_COPY);
    expect(text()).not.toContain("anything new");
  });
  it("a restored review whose suggestions couldn't be matched says so", async () => {
    await restore({ items: [], unmatched: true });
    expect(text()).toContain(RESUME_UNMATCHED_COPY);
  });
  it("a genuinely empty proposal can be restored and closed without an empty acceptance", async () => {
    await restore({ items: [] });
    expect(text()).toContain("What we found in your résumé");
    expect(text()).toContain("We couldn't find anything new");
  });
  it("asks for the dates of a job whose dates could not be confirmed, and shows confirmed dates as read", async () => {
    const source = { resumeVersionId: "62000000-0000-4000-8000-0000000000aa", extractionVersion: "h" };
    await restore({ items: [
      { id: "a", source, evidence: "Engineer, Acme", kind: "employment", employer: "Acme", title: "Engineer", start: null, end: null, current: false },
      { id: "b", source, evidence: "Manager, Beta", kind: "employment", employer: "Beta", title: "Manager", start: "2022", end: "2024", current: false },
    ] as unknown as ResumeItem[] });
    expect(text()).toContain(`Engineer at Acme · ${NO_DATES}`);
    expect(text()).toContain("Manager at Beta · 2022 – 2024");
    expect(text()).not.toContain(`Manager at Beta · ${NO_DATES}`);
  });
});

describe("what Confirm needs", () => {
  const base = { displayName: "Test Person", headline: "", linkedinUrl: null, currentLocation: null, skills: ["Sourcing"], employment: [], education: [], projects: [] } as any;
  it("names the missing current location, and nothing when it is complete", () => {
    expect(confirmGapsOf(base)).toEqual(["your current city and country"]);
    expect(confirmGapsOf({ ...base, currentLocation: { city: "Pune", countryCode: "IN", displayCountry: "India" } })).toEqual([]);
    expect(confirmGapsOf({ ...base, currentLocation: { city: " ", countryCode: "IN", displayCountry: "India" } })).toEqual(["your current city and country"]);
    expect(confirmGapsOf({ ...base, displayName: "" })).toEqual(["your name", "your current city and country"]);
  });
});

describe("assist button says what it does", () => {
  async function mountAssist(submitLabel?: string) {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<SparkAssist useCase="exclusions" label="Or tell us in your own words" placeholder="e.g. No travel"
      context={{ baseVersion: "1" }} interpret={async () => ({ kind: "cannot_help", message: "x" }) as never} onApply={() => undefined}
      {...(submitLabel ? { submitLabel } : {})} />); });
  }
  it("deal-breakers: Turn into deal-breakers", async () => {
    await mountAssist("Turn into deal-breakers");
    expect(text()).toContain("Turn into deal-breakers");
    expect(text()).not.toContain("Show me the changes");
  });
  it("elsewhere keeps Show me the changes", async () => {
    await mountAssist();
    expect(text()).toContain("Show me the changes");
  });
});
