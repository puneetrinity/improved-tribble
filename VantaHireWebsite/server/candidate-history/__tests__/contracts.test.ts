import { describe, expect, it } from "vitest";
import { historyContext, historyDecimal, historyRequest, historyWatermark,
  sameHistoryContext, validateHistoryResponse } from "../contracts";

const reference = "11111111-1111-4111-8111-111111111111";
const event = "22222222-2222-4222-8222-222222222222";
const empty = { count: "0", event_id: null, sequence: null };
const request = { schema_version: 1 as const, organization_id: 1, application_id: 2,
  job_id: 3, reference_id: reference, expected: empty };
const response = () => ({ schema_version: 1,
  binding: { namespace: "organization_private", organization_id: 1, application_id: 2,
    job_id: 3, reference_id: reference },
  coverage: { event_types: ["application_stage_moved"],
    identity_basis: "organization_application_reference", historical_complete: false },
  freshness: { expected: empty, projected: empty, unresolved_count: "0", status: "no_captured_stage_events" },
  authority_status: "eligible", summary: null });

describe("candidate history closed contracts", () => {
  it.each(["0", "9007199254740993", "9223372036854775807"])("preserves decimal %s", value => {
    expect(historyDecimal.parse(value)).toBe(value);
  });
  it.each([0, "-1", "01", "1.0", "1e2", "9223372036854775808", " 1"])("refuses noncanonical scalar %s", value => {
    expect(historyDecimal.safeParse(value).success).toBe(false);
  });
  it("has precisely one empty watermark shape", () => {
    expect(historyWatermark.parse(empty)).toEqual(empty);
    for (const value of [{ ...empty, count: "1" }, { ...empty, event_id: event },
      { ...empty, sequence: "1" }, { count: "1", event_id: event, sequence: "0" }]) {
      expect(historyWatermark.safeParse(value).success).toBe(false);
    }
  });
  it("refuses extra fields and unbounded ids", () => {
    expect(historyRequest.safeParse({ ...request, candidate_id: reference }).success).toBe(false);
    expect(historyRequest.safeParse({ ...request, application_id: 2147483648 }).success).toBe(false);
  });
  it("binds every response tuple and expected watermark", () => {
    expect(validateHistoryResponse(response(), request).summary).toBeNull();
    for (const field of ["organization_id", "application_id", "job_id", "reference_id"] as const) {
      const value = response(); Object.assign(value.binding, { [field]: field === "reference_id" ? event : 77 });
      expect(() => validateHistoryResponse(value, request)).toThrow();
    }
    const value = response(); value.freshness.expected = { count: "1", event_id: event, sequence: "1" } as typeof empty;
    expect(() => validateHistoryResponse(value, request)).toThrow();
  });
  it("does not turn an empty or unauthorized snapshot into caught-up history", () => {
    const value = response(); value.freshness.status = "caught_up_to_observed_capture";
    expect(() => validateHistoryResponse(value, request)).toThrow();
    value.freshness.status = "no_captured_stage_events"; value.authority_status = "privacy_restricted";
    expect(() => validateHistoryResponse(value, request)).toThrow();
  });
  it("distinguishes unsupported application scope and binding delay", () => {
    const a = historyContext.parse({ status: "outside_private_history_scope" });
    expect(sameHistoryContext(a, { status: "awaiting_binding" })).toBe(false);
    expect(historyContext.safeParse({ status: "outside_private_history_scope", count: "0" }).success).toBe(false);
  });
});
