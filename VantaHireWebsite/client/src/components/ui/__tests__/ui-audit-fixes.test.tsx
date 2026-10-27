import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FileDropzone, checkFile } from "../file-dropzone";
import { homeForRole } from "@/lib/protected-route";
import { AIActionsPanel } from "@/components/recruiter/AIActionsPanel";
import { TodaysInterviewsPanel } from "@/components/recruiter/TodaysInterviewsPanel";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
async function mount(node: React.ReactNode) {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const file = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name);
function stubJson(map: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = Object.keys(map).find(k => url.includes(k));
    return new Response(JSON.stringify(key ? map[key] : {}), { status: key ? 200 : 404, headers: { "content-type": "application/json" } });
  }));
}

describe("file checks", () => {
  it("accepts allowed types within the limit and explains refusals", () => {
    expect(checkFile(file("cv.PDF", 1000), ".pdf,.doc,.docx", 5)).toBeNull();
    expect(checkFile(file("cv.png", 1000), ".pdf,.doc,.docx", 5)).toBe("Use a PDF, DOC, DOCX file.");
    expect(checkFile(file("cv.pdf", 6 * 1024 * 1024), ".pdf", 5)).toBe("That file is 6.0 MB. The limit is 5 MB.");
    expect(checkFile(file("cv.pdf", 0), ".pdf", 5)).toBe("That file is empty.");
  });
  it("rejects a dropped wrong-type file without accepting it", async () => {
    const onChange = vi.fn();
    await mount(<FileDropzone label="Resume" accept=".pdf" maxSizeMB={5} value={null} onChange={onChange} />);
    const zone = host!.querySelector('[role="button"]')!;
    await act(async () => {
      const e = new Event("drop", { bubbles: true, cancelable: true }) as any;
      e.dataTransfer = { files: [file("photo.png", 10)] }; zone.dispatchEvent(e);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("Use a PDF file.");
  });
  it("shows the chosen file with a labelled remove button", async () => {
    const onChange = vi.fn();
    await mount(<FileDropzone label="Resume" accept=".pdf" maxSizeMB={5} value={file("cv.pdf", 2048)} onChange={onChange} />);
    expect(host!.textContent).toContain("cv.pdf");
    expect(host!.textContent).toContain("2 KB");
    await act(async () => { (host!.querySelector('button[aria-label="Remove cv.pdf"]') as HTMLButtonElement).click(); });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("access denied", () => {
  it("sends each role to its own dashboard", () => {
    expect(homeForRole("candidate")).toBe("/my-dashboard");
    expect(homeForRole("recruiter")).toBe("/recruiter-dashboard");
    expect(homeForRole("hiring_manager")).toBe("/hiring-manager");
    expect(homeForRole("super_admin")).toBe("/admin");
    expect(homeForRole(undefined)).toBe("/");
  });
});

describe("recruiter dashboard panels", () => {
  const item = (n: number, urgency = "high") => ({ id: `a${n}`, title: `Review Person ${n}`, subtitle: "senior engineer · Waiting 20d", urgency, ctaLabel: "Open Candidate", ctaHref: `/x/${n}` });
  it("shows a shared urgency once, and every row is one keyboard-reachable button", async () => {
    stubJson({ "/api/recruiter-dashboard/actions": { sections: [{ key: "candidates_to_review", count: 3, emptyMessage: "none", items: [item(1), item(2), item(3)] }] } });
    await mount(<AIActionsPanel range="30d" jobId="all" />);
    expect(host!.textContent!.match(/High/g)?.length).toBe(1);
    expect(host!.textContent).toContain("Applies to every item below");
    expect(host!.querySelectorAll('li > button[aria-label^="Open Candidate: Review Person"]').length).toBe(3);
  });
  it("tags each row when urgencies differ", async () => {
    stubJson({ "/api/recruiter-dashboard/actions": { sections: [{ key: "candidates_to_review", count: 2, emptyMessage: "none", items: [item(1, "high"), item(2, "low")] }] } });
    await mount(<AIActionsPanel range="30d" jobId="all" />);
    expect(host!.textContent).not.toContain("Applies to every item below");
  });
  it("offers the next day this week with interviews when today is empty", async () => {
    const d = (offset: number) => { const x = new Date(); x.setDate(x.getDate() + offset); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    stubJson({ "/api/recruiter-dashboard/todays-interviews": { count: 0, items: [], week: [0, 1, 2].map(o => ({ date: d(o), dayLabel: "X", count: o === 2 ? 3 : 0, isSelected: o === 0 })) } });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    await mount(<TodaysInterviewsPanel jobId="all" />);
    const next = Array.from(host!.querySelectorAll("button")).find(b => b.textContent?.startsWith("Next:"));
    expect(next?.textContent).toContain("3 interviews");
  });
});
