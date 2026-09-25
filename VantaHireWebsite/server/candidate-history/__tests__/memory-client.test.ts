import { afterEach, describe, expect, it, vi } from "vitest";
const signing = vi.hoisted(() => vi.fn(async () => "synthetic-token"));
vi.mock("../../lib/services/jwt-signer", () => ({ signServiceJwt: signing }));
import { readMemoryHistory } from "../memory-client";

const reference = "11111111-1111-4111-8111-111111111111";
const empty = { count: "0", event_id: null, sequence: null };
const request = { schema_version: 1 as const, organization_id: 1, application_id: 2,
  job_id: 3, reference_id: reference, expected: empty };
const response = () => ({ schema_version: 1,
  binding: { namespace: "organization_private", organization_id: 1, application_id: 2, job_id: 3, reference_id: reference },
  coverage: { event_types: ["application_stage_moved"], identity_basis: "organization_application_reference", historical_complete: false },
  freshness: { expected: empty, projected: empty, unresolved_count: "0", status: "no_captured_stage_events" },
  authority_status: "eligible", summary: null });
const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); signing.mockClear(); });

describe("history network boundary", () => {
  it("signs only read scope and sends the bound tuple without redirects", async () => {
    vi.stubEnv("ACTIVEKG_BASE_URL", "https://memory.example.invalid");
    const fetcher = vi.fn(async () => ok(response()));
    expect((await readMemoryHistory(request, fetcher)).summary).toBeNull();
    expect(signing).toHaveBeenCalledWith("activekg", { tenantId: "org_1", scopes: "decision-history:read" });
    const [url, opts] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://memory.example.invalid/organization-candidate-history/read");
    expect(opts.redirect).toBe("error"); expect(JSON.parse(opts.body as string)).toEqual(request);
  });
  it.each([[451,"privacy_restricted"],[409,"binding_conflict"],[404,"not_found"],[403,"temporarily_unavailable"],
    [503,"temporarily_unavailable"]])("maps %s without reflecting a vendor body", async (status, code) => {
    vi.stubEnv("ACTIVEKG_BASE_URL", "https://memory.example.invalid");
    await expect(readMemoryHistory(request, async () => new Response("SENTINEL_PRIVATE_VENDOR_TEXT", { status: status as number })))
      .rejects.toMatchObject({ code, message: code });
  });
  it.each(["http://memory.example.invalid", "https://user:secret@memory.example.invalid", "https://memory.example.invalid/path",
    "https://memory.example.invalid?target=other"]) ("refuses unsafe origin %s before dispatch", async value => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ACTIVEKG_BASE_URL", value);
    const fetcher = vi.fn(); await expect(readMemoryHistory(request, fetcher)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses tuple drift, vendor fields and oversized streamed bodies", async () => {
    vi.stubEnv("ACTIVEKG_BASE_URL", "https://memory.example.invalid");
    const wrong = response(); wrong.binding.organization_id = 2;
    for (const body of [wrong, { ...response(), vendor: "hidden" }, "x".repeat(65537)]) {
      await expect(readMemoryHistory(request, async () => ok(body))).rejects.toMatchObject({ code: "temporarily_unavailable" });
    }
  });
  it("bounds even a fetch implementation that never resolves", async () => {
    vi.useFakeTimers(); vi.stubEnv("ACTIVEKG_BASE_URL", "https://memory.example.invalid");
    const result = readMemoryHistory(request, () => new Promise(() => {}));
    const checked = expect(result).rejects.toMatchObject({ code: "temporarily_unavailable" });
    await vi.advanceTimersByTimeAsync(3000); await checked;
  });
});
