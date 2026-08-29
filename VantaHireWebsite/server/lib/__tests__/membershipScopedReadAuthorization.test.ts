import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  db: { execute },
}));

import {
  parseHiringManagerRoleFilter,
  readAuthorizedHiringManagerDirectory,
} from "../membershipScopedReadAuthorization";

beforeEach(() => {
  execute.mockReset();
});

describe("membership-scoped hiring-manager directory", () => {
  it("accepts only the exact scalar hiring-manager filter", () => {
    expect(parseHiringManagerRoleFilter("hiring_manager")).toBe("hiring_manager");
    for (const value of [undefined, null, "", "recruiter", "Hiring_Manager", " hiring_manager ",
      ["hiring_manager"], { role: "hiring_manager" }]) {
      expect(parseHiringManagerRoleFilter(value)).toBeNull();
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1,
    "1" as unknown as number])("refuses invalid actor id %s without querying", async (actorId) => {
    await expect(readAuthorizedHiringManagerDirectory(actorId, { allowPlatformAdmin: true }))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses an invalid policy without querying", async () => {
    await expect(readAuthorizedHiringManagerDirectory(
      7,
      {} as { allowPlatformAdmin: boolean },
    )).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns the exact minimum projection from one statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      id: 11,
      username: "manager@example.invalid",
      firstName: "Test",
      lastName: "Manager",
      role: "hiring_manager",
      password: "forbidden",
      emailVerificationToken: "forbidden",
      aiContentFreeUsed: true,
    }] });

    const result = await readAuthorizedHiringManagerDirectory(7, { allowPlatformAdmin: true });
    expect(result).toEqual({ ok: true, rows: [{
      id: 11,
      username: "manager@example.invalid",
      firstName: "Test",
      lastName: "Manager",
      role: "hiring_manager",
    }] });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "id", "username", "firstName", "lastName", "role",
    ]);
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns an authorized empty directory", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(readAuthorizedHiringManagerDirectory(7, { allowPlatformAdmin: false }))
      .resolves.toEqual({ ok: true, rows: [] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preserves nullable names in the minimum projection", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      id: 12,
      username: "unnamed-manager@example.invalid",
      firstName: null,
      lastName: null,
      role: "hiring_manager",
    }] });

    await expect(readAuthorizedHiringManagerDirectory(7, { allowPlatformAdmin: false }))
      .resolves.toEqual({ ok: true, rows: [{
        id: 12,
        username: "unnamed-manager@example.invalid",
        firstName: null,
        lastName: null,
        role: "hiring_manager",
      }] });
  });

  it("maps database failure to unavailable without exposing the raw error", async () => {
    execute.mockRejectedValueOnce(new Error("postgres://raw-secret user=77"));
    const result = await readAuthorizedHiringManagerDirectory(7, { allowPlatformAdmin: true });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
  });

  it.each([
    { id: "11", username: "manager@example.invalid", firstName: "Test", lastName: "Manager", role: "hiring_manager" },
    { id: 11, username: null, firstName: "Test", lastName: "Manager", role: "hiring_manager" },
    { id: 11, username: "manager@example.invalid", firstName: "Test", lastName: "Manager", role: "recruiter" },
  ])("fails closed on malformed row %#", async (row) => {
    execute.mockResolvedValueOnce({ rows: [row] });
    await expect(readAuthorizedHiringManagerDirectory(7, { allowPlatformAdmin: true }))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
