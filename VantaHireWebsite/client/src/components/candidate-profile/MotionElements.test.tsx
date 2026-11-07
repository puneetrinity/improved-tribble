/** Spark motion: Tetris board, Tetris orb and Orb. Words always say what is happening; motion stops for reduced motion. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TetrisOrb } from "@/components/ui/tetris-orb";
import { TetrisLoader } from "@/components/ui/loader-tetris";
import { FindingJobs } from "./FindingJobs";
import { SaveStatus } from "./SaveStatus";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
function render(node: React.ReactNode) {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(node));
}
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const filled = () => Array.from(host!.querySelectorAll("[style]")).filter(d => (d as HTMLElement).style.background || (d as HTMLElement).getAttribute("data-c")).length;
const stubMotion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));

describe("TetrisOrb", () => {
  it("a pill announces its label once and shows it", () => {
    render(<TetrisOrb pill label="Reading your résumé" />);
    const statuses = host!.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.getAttribute("aria-label")).toBe("Reading your résumé");
    expect(text()).toContain("Reading your résumé");
  });
  it("decorative boards are hidden from screen readers (the text beside them speaks)", () => {
    render(<TetrisOrb decorative label="Updating your matches" />);
    expect(host!.querySelector('[role="status"]')).toBeNull();
    expect(host!.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Empty states", () => {
  it("a still Tetris orb never animates", () => {
    stubMotion(false);
    render(<TetrisOrb still decorative label="No saved jobs" />);
    expect(host!.querySelector('[aria-label="No saved jobs"]')!.getAttribute("aria-busy")).toBe("false");
  });
});

describe("TetrisLoader", () => {
  it("still and reduced-motion boards are not busy", () => {
    render(<TetrisLoader still label="No saved jobs" />);
    expect(host!.querySelector('[role="status"]')!.getAttribute("aria-busy")).toBe("false");
    act(() => root!.unmount()); root = null; host!.remove();
    stubMotion(true);
    render(<TetrisLoader label="Finding jobs for you" />);
    expect(host!.querySelector('[role="status"]')!.getAttribute("aria-busy")).toBe("false");
  });
  it("a playing board is busy when motion is allowed", () => {
    stubMotion(false);
    render(<TetrisLoader label="Finding jobs for you" />);
    expect(host!.querySelector('[role="status"]')!.getAttribute("aria-busy")).toBe("true");
  });
});

describe("FindingJobs", () => {
  const noop = () => {};
  it("pauses and says so when offline, and carries on when back", () => {
    vi.stubGlobal("navigator", { onLine: false });
    render(<FindingJobs state={{ kind: "searching", step: 2 }} onViewJobs={noop} onRetry={noop} onEditPreferences={noop} />);
    expect(text()).toContain("Paused until you're back online");
    expect(host!.querySelector('[aria-label="Finding jobs for you"]')!.getAttribute("aria-busy")).toBe("false");
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(text()).not.toContain("Paused until you're back online");
    expect(text()).toContain("We're checking open roles");
  });
});

describe("SaveStatus", () => {
  it("saving keeps its words; the orb is decoration", () => {
    render(<SaveStatus state={{ kind: "sending" }} />);
    expect(text()).toContain("Saving…");
    expect(host!.querySelector('[role="status"] [aria-hidden="true"] [data-halaska-orb]')).not.toBeNull();
  });
});
