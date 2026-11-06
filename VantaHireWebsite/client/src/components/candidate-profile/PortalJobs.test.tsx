/** Portal "Find jobs": server search over every open job (not a filter of page 1), and paging. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CandidatePortal } from "@/components/candidate-portal/CandidatePortal";
import { toPublicJob } from "@/pages/candidate-portal-page";
import { AuthProvider } from "@/hooks/use-auth";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
const jobs = [{ id: 1, title: "Backend Engineer", company: "", location: "Bengaluru", type: "Full-time", postedAt: "2 days ago" },
  { id: 2, title: "Data Engineer", company: "Kitebyte", location: "Remote", type: "Full-time", postedAt: "3 days ago" }];

async function mount(props: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client}><AuthProvider>
    <CandidatePortal firstName="Synthetic" section="find" onNavigate={() => undefined} discovery="not_ready" matching="not_ready"
      publicJobs={jobs} profile={null} onSignOut={() => undefined} {...props} />
  </AuthProvider></QueryClientProvider>); });
}

describe("portal job search", () => {
  it("sends the search to the server (debounced), shows the server's total and offers more pages", async () => {
    const onSearchJobs = vi.fn(); const onLoadMoreJobs = vi.fn();
    await mount({ onSearchJobs, publicJobsTotal: 30, onLoadMoreJobs });
    expect(host!.textContent).toContain("30 jobs");
    const input = host!.querySelector('input[aria-label="Search jobs"]') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "kafka"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Not filtered locally: both loaded jobs stay until the server answers.
    expect(host!.textContent).toContain("Data Engineer");
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    expect(onSearchJobs).toHaveBeenLastCalledWith("kafka");
    const more = Array.from(host!.querySelectorAll("button")).find(b => b.textContent === "Show more jobs")!;
    await act(async () => { more.click(); });
    expect(onLoadMoreJobs).toHaveBeenCalledTimes(1);
  });

  it("shows loading and failure states instead of '0 jobs', and an empty company line is left out", async () => {
    await mount({ publicJobs: [], publicJobsState: "loading" });
    expect(host!.querySelector('[aria-label="Loading jobs"]')).not.toBeNull();
    expect(host!.textContent).not.toContain("0 jobs");
    act(() => root!.unmount()); root = null; host!.remove();
    const retry = vi.fn();
    await mount({ publicJobs: [], publicJobsState: "error", onRetryJobs: retry });
    expect(host!.textContent).toContain("We couldn't load jobs right now");
    act(() => root!.unmount()); root = null; host!.remove();
    await mount({});
    expect(host!.querySelectorAll("li p.text-foreground\\/80")).toHaveLength(1);
  });

  it("maps the jobs API row for the portal", () => {
    expect(toPublicJob({ id: 9, title: "QA", company: null, location: "Pune", type: "part-time", createdAt: "not a date" }))
      .toEqual({ id: 9, title: "QA", company: "", location: "Pune", type: "Part time", postedAt: "" });
  });
});
