/** /my-dashboard page: the real job query — server paging, search and a failed later page. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CandidatePortalPage from "@/pages/candidate-portal-page";
import { AuthContext } from "@/hooks/use-auth";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });

const job = (id: number, title: string) => ({ id, title, company: "Synthetic Co", location: "Remote", type: "full-time", createdAt: null });
const page = (n: number, rows: unknown[]) => ({ jobs: rows, pagination: { page: n, total: 3, totalPages: 2 } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const text = () => host!.textContent ?? "";
const more = () => Array.from(host!.querySelectorAll("button")).find(b => b.textContent === "Show more jobs");

/** jobs(page, search) decides each /api/jobs answer; every other call (profile read) is unavailable. */
async function mount(jobs: (page: number, search: string | null) => Response) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost"); calls.push(url);
    if (url.pathname === "/api/jobs") return jobs(Number(url.searchParams.get("page")), url.searchParams.get("search"));
    return json(503, {});
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { user: { id: 1, role: "candidate", emailVerified: true, firstName: "Synthetic" }, logoutMutation: { mutate: vi.fn() } } as any;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}><CandidatePortalPage /></AuthContext.Provider></QueryClientProvider>); });
  await flush();
  return () => calls.filter(u => u.pathname === "/api/jobs");
}

describe("portal page job query", () => {
  it("loads the next server page on 'Show more jobs', skips a repeated job and uses the server's total", async () => {
    const calls = await mount(n => json(200, n === 1 ? page(1, [job(1, "Backend Engineer"), job(2, "Data Engineer")]) : page(2, [job(2, "Data Engineer"), job(3, "Kafka Platform Engineer")])));
    expect(text()).toContain("3 jobs");
    expect(text()).not.toContain("Kafka Platform Engineer");
    await act(async () => { more()!.click(); }); await flush();
    expect(calls().map(u => u.searchParams.get("page"))).toEqual(["1", "2"]);
    // The only match for "Kafka" was on page 2; the job repeated across pages shows once.
    expect(text()).toContain("Kafka Platform Engineer");
    expect(text().match(/Data Engineer/g)).toHaveLength(1);
    expect(more()).toBeUndefined();
  });

  it("sends the search to the server from page 1", async () => {
    const calls = await mount((n, search) => json(200, search ? { jobs: [job(3, "Kafka Platform Engineer")], pagination: { page: 1, total: 1, totalPages: 1 } } : page(1, [job(1, "Backend Engineer")])));
    const input = host!.querySelector('input[aria-label="Search jobs"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "kafka");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 350)); }); await flush();
    expect(calls().at(-1)!.searchParams.get("search")).toBe("kafka");
    expect(calls().at(-1)!.searchParams.get("page")).toBe("1");
    expect(text()).toContain("Kafka Platform Engineer");
    expect(text()).toContain("1 job");
  });

  it("a failed later page keeps the jobs already shown, says so, and 'Try again' loads it", async () => {
    let failPage2 = true;
    const calls = await mount(n => n === 1 ? json(200, page(1, [job(1, "Backend Engineer"), job(2, "Data Engineer")]))
      : failPage2 ? json(500, {}) : json(200, page(2, [job(3, "Kafka Platform Engineer")])));
    await act(async () => { more()!.click(); }); await flush();
    expect(text()).toContain("Backend Engineer");
    expect(text()).not.toContain("We couldn't load jobs right now");
    expect(text()).toContain("We couldn't load more jobs.");
    const again = Array.from(host!.querySelectorAll("button")).find(b => b.textContent === "Try again")!;
    failPage2 = false;
    await act(async () => { again.click(); }); await flush();
    expect(calls().filter(u => u.searchParams.get("page") === "2")).toHaveLength(2);
    expect(text()).toContain("Kafka Platform Engineer");
  });
});
