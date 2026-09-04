/**
 * Wave 3.5B — internal workspace density & navigation contract.
 *
 * Semantic/responsive contract for the shared primitives every internal page
 * inherits: compact header geometry tokens, action-first layout, the single
 * job navigation, compact empty state, and the Discover progress modal bound
 * to the real pipeline state with truthful stage copy and no vendor names.
 *
 * Renders with react-dom only (no extra test dependencies — package.json is
 * frozen for this package) in the jsdom environment.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { Users } from "lucide-react";
import {
  INTERNAL_HEADER_PADDING,
  INTERNAL_PAGE_CONTAINER,
  INTERNAL_TITLE,
  INTERNAL_TOUCH_ACTIONS,
} from "@/lib/internal-page-theme";
import { DASHBOARD_PAGE_CONTAINER } from "@/lib/dashboard-theme";
import { InternalHero } from "@/components/internal/InternalHero";
import { InternalEmptyState } from "@/components/internal/InternalEmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobSubNav } from "@/components/JobSubNav";
import { SubNav } from "@/components/SubNav";
import {
  INITIAL_PROGRESS,
  SourcingProgressModal,
  neutralizeProviderText,
  type PipelineProgressState,
} from "@/components/sourcing/SourcingProgressModal";

const VENDOR_WORDS = /crustdata|reversecontact|reverse contact|pdl|fullenrich|enrichlayer/i;
const UNSHIPPED_COPY = /real skills|enriched, and free/i;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(element);
  });
  // Radix Dialog renders into a portal on document.body; return the body for lookups.
  return document.body;
}

afterEach(() => {
  vi.useRealTimers();
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

const q = <T extends Element = HTMLElement>(scope: ParentNode, sel: string) => scope.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(scope: ParentNode, sel: string) => Array.from(scope.querySelectorAll<T>(sel));
const buttonNamed = (scope: ParentNode, name: RegExp) =>
  qa<HTMLButtonElement>(scope, "button").find((b) => name.test((b.textContent ?? "").trim()));

describe("density tokens", () => {
  it("pins the compact header geometry (22px mobile / 26px desktop title, ≤20px vertical padding)", () => {
    expect(INTERNAL_TITLE).toContain("text-[22px]");
    expect(INTERNAL_TITLE).toContain("md:text-[26px]");
    expect(INTERNAL_TITLE).not.toMatch(/text-\[3\d px\]|text-3xl|text-4xl/);
    expect(INTERNAL_HEADER_PADDING).toContain("md:py-4");
    expect(INTERNAL_PAGE_CONTAINER).toContain("py-4");
    expect(INTERNAL_PAGE_CONTAINER).toContain("md:py-5");
    expect(DASHBOARD_PAGE_CONTAINER).toContain("md:py-5");
  });

  it("keeps mobile touch targets at 44px for header actions", () => {
    expect(INTERNAL_TOUCH_ACTIONS).toContain("[&>*]:min-h-11");
  });
});

describe("InternalHero", () => {
  it("renders an action-first header: compact h1 token, actions inside the header, stats as chips", () => {
    const body = mount(
      <InternalHero
        eyebrow="Job Workspace"
        title="Senior Backend Engineer"
        subtitle="Compact subtitle"
        badge="Active"
        actions={<button type="button">Find candidates</button>}
        stats={[{ label: "Applications", value: 42 }, { label: "Shortlisted", value: 7 }]}
      />,
    );
    const header = q(body, '[data-internal-header="hero"]')!;
    expect(header).toBeTruthy();
    const h1 = q(header, "h1")!;
    expect(h1.className).toContain("text-[22px]");
    expect(h1.className).toContain("md:text-[26px]");
    expect(buttonNamed(header, /^Find candidates$/)).toBeTruthy();
    expect(q(header, "dl")).toBeTruthy();
    expect(qa(header, "dl > div").length).toBe(2);
    expect(header.className).not.toContain("md:py-8");
  });
});

describe("PageHeader", () => {
  it("renders a breadcrumb with aria-current on the last item and a compact h1", () => {
    const body = mount(
      <PageHeader
        title="Applications"
        description="Manage job applications"
        breadcrumbs={[{ label: "My jobs", href: "/my-jobs" }, { label: "Applications" }]}
        actions={<button type="button">Export</button>}
      />,
    );
    const nav = q(body, 'nav[aria-label="Breadcrumb"]')!;
    expect(nav).toBeTruthy();
    const current = qa(nav, "span").find((s) => s.getAttribute("aria-current") === "page");
    expect(current?.textContent).toBe("Applications");
    const h1 = q(body, "h1")!;
    expect(h1.className).toContain("text-[22px]");
    expect(h1.className).toContain("md:text-[26px]");
    expect(h1.className).not.toMatch(/md:text-3xl/);
    expect(buttonNamed(body, /^Export$/)).toBeTruthy();
  });
});

describe("JobSubNav", () => {
  it("is the single job navigation with exactly five tabs and one aria-current tab", () => {
    const body = mount(<JobSubNav jobId={7} />);
    const nav = q(body, 'nav[aria-label="Job navigation"]')!;
    const tabs = qa<HTMLButtonElement>(nav, "button");
    expect(tabs.map((t) => (t.textContent ?? "").trim())).toEqual([
      "Details",
      "Applications",
      "Discover",
      "Pipeline",
      "Analytics",
    ]);
    expect(tabs.filter((t) => t.getAttribute("aria-current") === "page").length).toBe(1);
    for (const tab of tabs) {
      expect(tab.getAttribute("type")).toBe("button");
      expect(tab.className).toContain("min-h-11");
    }
    expect(nav.className).toContain("overflow-x-auto");
  });
});

describe("SubNav", () => {
  it("marks the active item and keeps 44px targets", () => {
    const body = mount(
      <SubNav
        items={[{ id: "all", label: "All", count: 3 }, { id: "active", label: "Active", count: 1 }]}
        activeId="active"
        onChange={() => {}}
      />,
    );
    const buttons = qa<HTMLButtonElement>(body, 'nav[aria-label="Sub navigation"] button');
    expect(buttons.find((b) => b.getAttribute("aria-current") === "page")?.textContent).toContain("Active");
    for (const b of buttons) expect(b.className).toContain("min-h-11");
  });
});

describe("InternalEmptyState", () => {
  it("is a compact status region with the same shell as loaded content", () => {
    const body = mount(
      <InternalEmptyState icon={Users} title="No candidates yet" description="Try again" actions={<button type="button">Find</button>} />,
    );
    const region = q(body, '[role="status"]')!;
    expect(region.className).toContain("py-8");
    expect(region.className).not.toContain("py-12");
    expect(buttonNamed(region, /^Find$/)).toBeTruthy();
  });
});

describe("SourcingProgressModal", () => {
  const running: PipelineProgressState = {
    ...INITIAL_PROGRESS,
    phase: "ranking",
    percent: 55,
    message: "Ranking on experience, seniority and fit for this role.",
    crustdataFound: 300,
    rankingTotal: 300,
  };

  it("binds the ring to the real percent, maps stages only to real phases, names no vendor or unshipped feature", () => {
    const body = mount(<SourcingProgressModal open progress={running} onClose={() => {}} />);
    const modal = q(body, "[data-sourcing-progress-modal]")!;
    expect(modal).toBeTruthy();
    const bar = q(modal, '[role="progressbar"]')!;
    // the display percent eases toward the real value; it must never exceed it
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(55);
    const stages = qa(modal, "li[data-stage]").map((li) => li.getAttribute("data-stage"));
    expect(stages).toEqual(["discovery", "ranking", "enriching", "finalizing"]);
    expect(q(modal, 'li[data-stage="ranking"]')?.getAttribute("data-state")).toBe("active");
    expect(q(modal, 'li[data-stage="discovery"]')?.getAttribute("data-state")).toBe("done");
    expect(modal.textContent ?? "").not.toMatch(VENDOR_WORDS);
    expect(modal.textContent ?? "").not.toMatch(UNSHIPPED_COPY);
    expect(modal.textContent).toContain("300 profiles found");
    expect(modal.textContent).toContain("ealana · discover");
    // running state offers no close/run-again buttons
    expect(buttonNamed(modal, /view your shortlist|run again/i)).toBeUndefined();
  });

  it("offers View your shortlist and Run again on completion, with 44px targets", () => {
    const body = mount(
      <SourcingProgressModal
        open
        progress={{ ...running, phase: "complete", percent: 100 }}
        onClose={() => {}}
        onRunAgain={() => {}}
      />,
    );
    const modal = q(body, "[data-sourcing-progress-modal]")!;
    const view = buttonNamed(modal, /^View your shortlist$/)!;
    const again = buttonNamed(modal, /^Run again$/)!;
    expect(view.className).toContain("min-h-11");
    expect(again.className).toContain("min-h-11");
    expect(modal.textContent).toContain("Your shortlist is ready");
  });

  // Strings copied verbatim from the unchanged `useSourcingProgress` hook.
  const HOOK_MESSAGE_PHASE_STARTED = "Pipeline started — fetching candidates from Crustdata...";
  const HOOK_MESSAGE_FETCHING = "Searching Crustdata (300 candidates, relaxed query)...";
  const HOOK_LOGS = [
    "🚀 [PIPELINE] Phase started — worker is live",
    "📡 [CRUSTDATA] Fetching up to 300 candidates...",
    "📊 [RANKING] Locally ranking 300 candidates...",
  ];

  it("never renders a provider name from the real hook-shaped message, error or dev-console lines", () => {
    const body = mount(
      <SourcingProgressModal
        open
        progress={{ ...INITIAL_PROGRESS, phase: "discovery", percent: 15, message: HOOK_MESSAGE_FETCHING, devLogs: HOOK_LOGS }}
        onClose={() => {}}
      />,
    );
    const modal = q(body, "[data-sourcing-progress-modal]")!;
    act(() => buttonNamed(modal, /dev console/i)!.click());
    expect(qa(modal, "[aria-expanded]").some((b) => b.getAttribute("aria-expanded") === "true")).toBe(true);
    const text = modal.textContent ?? "";
    expect(text).toContain("3 events");
    expect(text).toContain("Fetching up to 300 candidates");
    expect(text).toContain("Searching the market (300 candidates, relaxed query)");
    expect(text).not.toMatch(VENDOR_WORDS);
    expect(neutralizeProviderText(HOOK_MESSAGE_PHASE_STARTED)).not.toMatch(VENDOR_WORDS);
    // an error that names the provider is neutralised too
    const errBody = mount(
      <SourcingProgressModal open progress={{ ...running, phase: "error", error: "Crustdata search failed (429)" }} onClose={() => {}} />,
    );
    const errModal = qa(errBody, "[data-sourcing-progress-modal]").at(-1)!;
    expect(errModal.textContent).toContain("the market search failed (429)");
    expect(errModal.textContent ?? "").not.toMatch(VENDOR_WORDS);
  });

  it("runs the elapsed clock only while running and holds it once the run stops on error", () => {
    vi.useFakeTimers();
    const body = mount(<SourcingProgressModal open progress={running} onClose={() => {}} />);
    const clock = () => q(body, '[aria-label="Elapsed time"]')!.textContent;
    expect(clock()).toBe("0:00");
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(clock()).toBe("0:03");
    act(() => {
      root!.render(<SourcingProgressModal open progress={{ ...running, phase: "error", error: "boom" }} onClose={() => {}} />);
    });
    const stoppedAt = clock();
    expect(stoppedAt).toBe("0:03");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(clock()).toBe(stoppedAt);
    // a new run (modal closed, then reopened) starts a fresh clock
    act(() => {
      root!.render(<SourcingProgressModal open={false} progress={INITIAL_PROGRESS} onClose={() => {}} />);
    });
    act(() => {
      root!.render(<SourcingProgressModal open progress={running} onClose={() => {}} />);
    });
    expect(clock()).toBe("0:00");
  });

  it("shows a truthful error state", () => {
    const body = mount(
      <SourcingProgressModal open progress={{ ...running, phase: "error", error: "Provider unavailable" }} onClose={() => {}} />,
    );
    const modal = q(body, "[data-sourcing-progress-modal]")!;
    expect(modal.textContent).toContain("Sourcing stopped");
    expect(buttonNamed(modal, /^Close$/)).toBeTruthy();
  });
});
