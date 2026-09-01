import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ db: { execute } }));

import {
  changeOrganizationMemberRoleAndRevoke,
  createAuthorizationSessionPayload,
  parseAuthorizationSessionPayload,
  parsePrivilegeGrantId,
  reassignOrganizationJobs,
  removeOrganizationMemberAndRevoke,
  resetPasswordAndAdvanceAuthorization,
} from "../privilegeGrantRevocation";

beforeEach(() => execute.mockReset());

describe("strict privilege and session inputs", () => {
  it("accepts only canonical positive safe-integer ids", () => {
    expect(parsePrivilegeGrantId("42")).toBe(42);
    expect(parsePrivilegeGrantId(42)).toBe(42);
    for (const value of [undefined, null, "", "0", "01", "+1", " 1", "1.0", "1e1", ["1"], 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parsePrivilegeGrantId(value)).toBeNull();
    }
  });

  it("serializes only bounded current-version payloads", () => {
    expect(createAuthorizationSessionPayload({ id: 41, authVersion: 3 }))
      .toEqual({ id: 41, authVersion: 3 });
    expect(createAuthorizationSessionPayload({ id: 0, authVersion: 3 })).toBeNull();
    expect(createAuthorizationSessionPayload({ id: 41, authVersion: 0 })).toBeNull();
    expect(Object.keys(createAuthorizationSessionPayload({ id: 41, authVersion: 3 })!))
      .toEqual(["id", "authVersion"]);
  });

  it("accepts legacy numeric payloads only as version one and rejects every malformed object", () => {
    expect(parseAuthorizationSessionPayload(41)).toEqual({ id: 41, authVersion: 1 });
    expect(parseAuthorizationSessionPayload({ id: 41, authVersion: 2 }))
      .toEqual({ id: 41, authVersion: 2 });
    for (const value of [
      "41", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, [],
      {}, { id: 41 }, { authVersion: 1 }, { id: 41, authVersion: 0 },
      { id: 41, authVersion: 1, role: "recruiter" },
      { id: "41", authVersion: 1 }, { id: 41, authVersion: "1" },
    ]) expect(parseAuthorizationSessionPayload(value)).toBeNull();
  });

  it("refuses malformed commands before database work", async () => {
    await expect(removeOrganizationMemberAndRevoke(0, 1)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(changeOrganizationMemberRoleAndRevoke(1, 0, "admin")).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(changeOrganizationMemberRoleAndRevoke(1, 2, "owner" as never)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(reassignOrganizationJobs(1, 2, Number.MAX_SAFE_INTEGER + 1)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(resetPasswordAndAdvanceAuthorization(1, "")).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("statement-bound privilege outcomes", () => {
  it("removes and advances authorization in one command", async () => {
    execute.mockResolvedValueOnce({ rows: [{ outcome: "ok" }] });
    await expect(removeOrganizationMemberAndRevoke(10, 20)).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["forbidden", { ok: false, reason: "forbidden" }],
    ["not_found", { ok: false, reason: "not_found" }],
    ["owner_protected", { ok: false, reason: "conflict", code: "owner_protected" }],
    ["jobs_owned", { ok: false, reason: "conflict", code: "jobs_owned" }],
  ] as const)("maps remove outcome %s without leaking row data", async (outcome, expected) => {
    execute.mockResolvedValueOnce({ rows: [{ outcome, password: "forbidden" }] });
    await expect(removeOrganizationMemberAndRevoke(10, 20)).resolves.toEqual(expected);
  });

  it("changes a non-owner role and returns only the four-field projection", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      outcome: "ok", id: 20, userId: 30, role: "admin", seatAssigned: true, password: "forbidden",
    }] });
    const result = await changeOrganizationMemberRoleAndRevoke(10, 20, "admin");
    expect(result).toEqual({ ok: true, value: { id: 20, userId: 30, role: "admin", seatAssigned: true } });
    expect(JSON.stringify(result)).not.toContain("password");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reassigns only scoped jobs and returns an exact non-negative count", async () => {
    execute.mockResolvedValueOnce({ rows: [{ outcome: "ok", reassignedCount: 3 }] });
    await expect(reassignOrganizationJobs(10, 20, 30)).resolves
      .toEqual({ ok: true, reassignedCount: 3 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["owner_source", { ok: false, reason: "conflict", code: "owner_source" }],
    ["invalid_target", { ok: false, reason: "conflict", code: "invalid_target" }],
    ["not_found", { ok: false, reason: "not_found" }],
    ["forbidden", { ok: false, reason: "forbidden" }],
  ] as const)("maps reassign outcome %s", async (outcome, expected) => {
    execute.mockResolvedValueOnce({ rows: [{ outcome, reassignedCount: 0 }] });
    await expect(reassignOrganizationJobs(10, 20, 30)).resolves.toEqual(expected);
  });

  it("updates password plus version through one minimum-returning statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: 41 }] });
    await expect(resetPasswordAndAdvanceAuthorization(41, "synthetic.hash"))
      .resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("collapses database and malformed-result detail to unavailable", async () => {
    execute
      .mockRejectedValueOnce(new Error("postgres://secret@example.invalid"))
      .mockResolvedValueOnce({ rows: [{ outcome: "ok", reassignedCount: -1 }] });
    await expect(removeOrganizationMemberAndRevoke(10, 20)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(reassignOrganizationJobs(10, 20, 30)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("contains no broad session deletion or split member mutation helper", () => {
    const source = readFileSync(new URL("../privilegeGrantRevocation.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?session/i);
    expect(source).not.toContain("updateMemberRole(");
    expect(source).not.toContain("removeMember(");
    expect(source).not.toContain("reassignJobs(");
  });
});
