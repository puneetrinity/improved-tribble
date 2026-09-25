import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), remote: vi.fn() }));
vi.mock("../../auth", () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../lib/applicationReadAuthorization", () => ({
  parsePositiveDecimalApplicationId: (value: string) => /^[1-9][0-9]*$/.test(value) ? Number(value) : null,
  readAuthorizedCandidateHistoryContext: mocks.read,
}));
vi.mock("../memory-client", async original => ({
  ...await original<typeof import("../memory-client")>(), readMemoryHistory: mocks.remote,
}));
import { registerCandidateHistoryRoutes } from "../routes";
import { HistoryMemoryError } from "../memory-client";
const empty = { count: "0", event_id: null, sequence: null };
const context = () => ({ status: "bound", organization_id: 1, application_id: 2, job_id: 3,
  reference_id: "11111111-1111-4111-8111-111111111111", candidate_id: "22222222-2222-4222-8222-222222222222",
  captured: empty, delivery_sequence: null, delivery_status: "no_capture", capture_gap: false });
async function request() {
  let handler: any;
  registerCandidateHistoryRoutes({ get: (_path: string, _auth: unknown, fn: any) => { handler = fn; } } as any);
  const result = { status: 200, body: null as any, headers: {} as Record<string, string> };
  const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; },
    status: (code: number) => { result.status = code; return res; }, json: (body: unknown) => { result.body = body; } };
  await handler({ params: { id: "2" }, query: {}, user: { id: 7 } }, res);
  return result;
}
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ ok: true, context: context() });
  mocks.remote.mockResolvedValue({ freshness: { status: "no_captured_stage_events" }, summary: null }); });
describe("history authorization and freshness", () => {
  it("never calls Memory before local authority", async () => {
    mocks.read.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await request()).status).toBe(404); expect(mocks.remote).not.toHaveBeenCalled();
  });
  it("discards a response when access is revoked during the call", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true, context: context() }).mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const result = await request(); expect(result.status).toBe(404); expect(result.body).toEqual({ code: "not_found" });
  });
  it("checks local refusal before reflecting a remote privacy refusal", async () => {
    mocks.remote.mockRejectedValue(new HistoryMemoryError("privacy_restricted"));
    mocks.read.mockResolvedValueOnce({ ok: true, context: context() }).mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect((await request()).status).toBe(404);
  });
  it("maps restricted history to 503, never browser 451", async () => {
    mocks.remote.mockRejectedValue(new HistoryMemoryError("privacy_restricted"));
    const result = await request(); expect(result.status).toBe(503); expect(result.body.summary).toBeNull();
  });
  it("permits only one recapture retry", async () => {
    mocks.remote.mockResolvedValue({ freshness: { status: "history_changed_retry" }, summary: null });
    expect((await request()).status).toBe(409); expect(mocks.remote).toHaveBeenCalledTimes(2);
  });
  it("reports a capture gap without returning a summary", async () => {
    mocks.read.mockResolvedValue({ ok: true, context: { ...context(), capture_gap: true } });
    const result = await request(); expect(result.body.freshness.status).toBe("capture_gap");
    expect(result.body.summary).toBeNull(); expect(result.headers["Cache-Control"]).toBe("private, no-store");
  });
});
