/** SF-R1b: until the profile read settles, the page never routes a library upload as "ordinary".
 * Pending, 503 and errors are "checking"/"unavailable" (uploads wait); only a settled read decides. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ props: null as any, load: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 9, role: "candidate", emailVerified: true }, logoutMutation: { mutate: vi.fn() } }) }));
vi.mock("@/components/candidate-portal/CandidatePortal", () => ({ CandidatePortal: (props: any) => { state.props = props; return null; } }));
vi.mock("@/components/candidate-profile/CareerProfilePanel", async importOriginal => ({ ...await importOriginal<typeof import('./CareerProfilePanel')>(), CareerProfilePanel: () => null }));
vi.mock("@/lib/candidate-profile-api", () => ({ loadProfile: () => state.load() }));
import CandidatePortalPage from "@/pages/candidate-portal-page";

let root: Root | null = null, client: QueryClient | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; client?.clear(); document.body.innerHTML = ""; vi.unstubAllGlobals(); state.load.mockReset(); });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const spark = { kind: "ready", profile: { capabilities: { canRequestResume: true }, confirmedProfile: { displayName: "Synthetic" } } };
async function mount() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jobs: [] }), { status: 200 })));
  window.location.hash = "#profile";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client!}><CandidatePortalPage /></QueryClientProvider>); });
  await flush();
}

describe("portal page résumé routing", () => {
  it("pending read is 'checking', never ordinary; then the settled read decides", async () => {
    let release: (x: unknown) => void = () => {};
    state.load.mockReturnValue(new Promise(r => { release = r; }));
    await mount();
    expect(state.props.resumeRouting).toBe("checking");
    release(spark); await flush();
    expect(state.props.resumeRouting).toBe("spark");
  });
  it("a 503 read is 'unavailable'; Try again re-reads and a later success routes to Spark", async () => {
    state.load.mockResolvedValueOnce({ kind: "unavailable" }).mockResolvedValueOnce(spark);
    await mount();
    expect(state.props.resumeRouting).toBe("unavailable");
    await act(async () => { state.props.onRetryResumeRouting(); }); await flush();
    expect(state.props.resumeRouting).toBe("spark");
    expect(state.load).toHaveBeenCalledTimes(2);
  });
  it("a failed read is 'unavailable'", async () => {
    state.load.mockRejectedValue(new Error("network"));
    await mount();
    expect(state.props.resumeRouting).toBe("unavailable");
  });
  it("only a settled read says ordinary: feature off (404) or no Spark résumé reading", async () => {
    state.load.mockResolvedValue({ kind: "disabled" });
    await mount();
    expect(state.props.resumeRouting).toBe("ordinary");
    act(() => root!.unmount()); root = null; client!.clear();
    state.load.mockResolvedValue({ kind: "ready", profile: { capabilities: { canRequestResume: false } } });
    await mount();
    expect(state.props.resumeRouting).toBe("ordinary");
  });
});
