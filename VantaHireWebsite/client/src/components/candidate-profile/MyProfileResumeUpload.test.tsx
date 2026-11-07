/** My profile résumé uploads: Spark candidates use the no-OCR upload (Spark reads it later, budgeted,
 * only on request); everyone else keeps the ordinary upload. Only the default résumé offers a profile update. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/hooks/use-auth";
import { CandidatePortal } from "@/components/candidate-portal/CandidatePortal";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const button = (name: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === name);

type Routing = "spark" | "ordinary" | "checking" | "unavailable";
async function uploadOnce(routing: Routing, isDefault: boolean, onRetry?: () => void) {
  const uploads: FormData[] = []; const paths: string[] = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost"); paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/csrf-token") return json(200, { token: "t" });
    if (url.pathname === "/api/ai/resume" && init?.method === "POST") { uploads.push(init.body as FormData); return json(200, { resume: { id: 7, label: "cv", isDefault } }); }
    if (url.pathname === "/api/ai/resume") return json(200, { resumes: [] });
    return json(503, {});
  }));
  const auth = { user: { id: 1, role: "candidate", emailVerified: true, firstName: "S" }, logoutMutation: { mutate: vi.fn() } } as any;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}>
    <CandidatePortal firstName="S" userId={1} section="profile" onNavigate={() => undefined} discovery="not_ready" matching="not_ready" publicJobs={[]}
      resumeRouting={routing} onRetryResumeRouting={onRetry} profile={null} onSignOut={() => undefined} />
  </AuthContext.Provider></QueryClientProvider>); });
  await flush();
  await act(async () => { button("Add a résumé")!.click(); }); await flush(1);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" })], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(1);
  await act(async () => { button("Upload")!.click(); }); await flush();
  return { form: uploads[0]!, uploads, paths };
}

describe("My profile résumé upload", () => {
  it("a Spark candidate's upload asks for the no-OCR path and reads nothing until asked", async () => {
    const { form, paths } = await uploadOnce("spark", true);
    expect(form.get("readBy")).toBe("spark");
    expect(paths.some(p => p.includes("/sources/"))).toBe(false);
  });
  it("other candidates keep the ordinary upload", async () => {
    const { form } = await uploadOnce("ordinary", true);
    expect(form.get("readBy")).toBeNull();
  });
  it("a default upload starts the profile-update offer (checks the profile, reads nothing yet)", async () => {
    const { paths } = await uploadOnce("spark", true);
    expect(paths).toContain("GET /api/candidate/product/profile");
    expect(paths.some(p => p.includes("/sources/"))).toBe(false);
  });
  it("an ordinary upload is never offered for Spark reading (it was already OCR'd)", async () => {
    const { paths } = await uploadOnce("ordinary", true);
    expect(paths).not.toContain("GET /api/candidate/product/profile");
  });
  it("while the account is still being checked, nothing uploads", async () => {
    const { uploads } = await uploadOnce("checking", true);
    expect(uploads).toHaveLength(0);
    expect(button("Upload")!.matches(":disabled")).toBe(true);
    expect(document.body.textContent).toContain("Checking your account before uploading");
  });
  it("if the check failed, uploading is paused with Try again; still nothing uploads", async () => {
    const retry = vi.fn();
    const { uploads } = await uploadOnce("unavailable", true, retry);
    expect(uploads).toHaveLength(0);
    expect(document.body.textContent).toContain("uploading is paused");
    await act(async () => { button("Try again")!.click(); });
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("a non-default upload is stored only: no profile-update offer, no reading", async () => {
    const { paths } = await uploadOnce("spark", false);
    expect(document.body.textContent).not.toContain("Update your profile from");
    expect(paths.some(p => p.includes("/sources/") || p === "GET /api/candidate/product/profile")).toBe(false);
  });
});
