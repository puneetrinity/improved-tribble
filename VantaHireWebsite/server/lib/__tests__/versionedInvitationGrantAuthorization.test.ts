import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  txExecute: vi.fn(),
  backfill: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    execute: mocks.execute,
    transaction: (callback: (tx: { execute: typeof mocks.txExecute }) => unknown) =>
      callback({ execute: mocks.txExecute }),
  },
}));
vi.mock("../organizationService", () => ({ backfillUserRecordsToOrg: mocks.backfill }));

import {
  acceptHiringManagerRegistrationGrant,
  acceptOrganizationInvite,
  cancelOrganizationInvite,
  createOrResendOrganizationInvite,
  hashVersionedInvitationToken,
  listOrganizationInvites,
  normalizeVersionedInvitationEmail,
  parseVersionedInvitationId,
  parseVersionedInvitationToken,
  readHiringManagerRegistrationGrant,
  readOrganizationInvitePreview,
} from "../versionedInvitationGrantAuthorization";

const token = "a".repeat(64);
const future = new Date(Date.now() + 60_000);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("versioned invitation canonical inputs", () => {
  it("accepts only canonical positive ids", () => {
    expect(parseVersionedInvitationId("42")).toBe(42);
    expect(parseVersionedInvitationId(42)).toBe(42);
    for (const value of [undefined, null, "", "0", "01", "+1", " 1", "1.0", "1e2", ["1"], 0, -1, 1.5]) {
      expect(parseVersionedInvitationId(value)).toBeNull();
    }
  });

  it("accepts only 64 lowercase hexadecimal plaintext tokens", () => {
    expect(parseVersionedInvitationToken(token)).toBe(token);
    expect(hashVersionedInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    for (const value of ["A".repeat(64), "a".repeat(63), ` ${token}`, `${token} `, `x-${token}`, null, [token]]) {
      expect(parseVersionedInvitationToken(value)).toBeNull();
    }
  });

  it("normalizes only bounded unpadded email input", () => {
    expect(normalizeVersionedInvitationEmail("Person@Example.Invalid")).toBe("person@example.invalid");
    expect(normalizeVersionedInvitationEmail(" person@example.invalid")).toBeNull();
    expect(normalizeVersionedInvitationEmail("not-an-email")).toBeNull();
  });

  it("rejects malformed commands before database work", async () => {
    await expect(createOrResendOrganizationInvite(0, "person@example.invalid", token, future))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(cancelOrganizationInvite(1, 0)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(acceptOrganizationInvite("bad", 1)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(readOrganizationInvitePreview("bad")).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.txExecute).not.toHaveBeenCalled();
  });
});

describe("statement-bound organization invitations", () => {
  it("creates or resends with a safe issuer projection and separate delivery context", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{
      outcome: "ok", id: 51, email: "person@example.invalid", role: "member",
      expiresAt: future, createdAt: new Date(), organizationName: "Synthetic org", inviterName: "Owner A",
      token: "forbidden", organizationId: 10, version: 2,
    }] });
    const result = await createOrResendOrganizationInvite(1, "person@example.invalid", token, future);
    expect(result).toMatchObject({
      ok: true,
      value: { id: 51, email: "person@example.invalid", role: "member" },
      delivery: { email: "person@example.invalid", organizationName: "Synthetic org", inviterName: "Owner A" },
    });
    expect(Object.keys((result as any).value).sort()).toEqual(["createdAt", "email", "expiresAt", "id", "role"]);
    expect(JSON.stringify((result as any).value)).not.toContain("token");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["forbidden", { ok: false, reason: "forbidden" }],
    ["accepted_history", { ok: false, reason: "conflict", code: "accepted_history" }],
    ["already_member", { ok: false, reason: "conflict", code: "already_member" }],
    ["no_seats", { ok: false, reason: "conflict", code: "no_seats" }],
  ] as const)("maps create outcome %s without row disclosure", async (outcome, expected) => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ outcome, token: "forbidden", password: "forbidden" }] });
    await expect(createOrResendOrganizationInvite(1, "person@example.invalid", token, future)).resolves.toEqual(expected);
  });

  it("distinguishes an authorized empty list from a forbidden actor", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ outcome: "ok", invitations: [] }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "forbidden", invitations: [] }] });
    await expect(listOrganizationInvites(1)).resolves.toEqual({ ok: true, rows: [] });
    await expect(listOrganizationInvites(1)).resolves.toEqual({ ok: false, reason: "forbidden" });
  });

  it("returns the exact five-field public preview", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{
      organizationName: "Synthetic org", email: "person@example.invalid", role: "member",
      expiresAt: future, inviterName: "Owner A", id: 51, token: "forbidden", version: 2,
    }] });
    const result = await readOrganizationInvitePreview(token);
    expect(result).toEqual({ ok: true, value: {
      organizationName: "Synthetic org", email: "person@example.invalid", role: "member",
      expiresAt: future, inviterName: "Owner A",
    } });
    expect(Object.keys((result as any).value).sort())
      .toEqual(["email", "expiresAt", "inviterName", "organizationName", "role"]);
  });

  it("collapses absent, foreign, expired and terminal preview rows", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await expect(readOrganizationInvitePreview(token)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("cancels through one affected-row command", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ outcome: "ok" }] });
    await expect(cancelOrganizationInvite(1, 51)).resolves.toEqual({ ok: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("accepts membership and backfills inside the same transaction", async () => {
    mocks.txExecute.mockResolvedValueOnce({ rows: [{
      outcome: "ok", id: 71, organizationId: 10, userId: 7, role: "member", seatAssigned: true,
    }] });
    mocks.backfill.mockResolvedValueOnce(undefined);
    await expect(acceptOrganizationInvite(token, 7)).resolves.toEqual({ ok: true, value: {
      id: 71, organizationId: 10, userId: 7, role: "member", seatAssigned: true,
    } });
    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
    expect(mocks.backfill).toHaveBeenCalledWith(expect.anything(), 7, 10);
  });

  it.each([
    ["not_found", { ok: false, reason: "not_found" }],
    ["forbidden", { ok: false, reason: "forbidden" }],
    ["already_member", { ok: false, reason: "conflict", code: "already_member" }],
    ["no_seats", { ok: false, reason: "conflict", code: "no_seats" }],
  ] as const)("maps accept outcome %s with zero backfill", async (outcome, expected) => {
    mocks.txExecute.mockResolvedValueOnce({ rows: [{ outcome }] });
    await expect(acceptOrganizationInvite(token, 7)).resolves.toEqual(expected);
    expect(mocks.backfill).not.toHaveBeenCalled();
  });
});

describe("exact hiring-manager grant binding", () => {
  it("reads only the minimum pending registration grant", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 91, email: "hm@example.invalid", grantVersion: 3, token: "forbidden" }] });
    await expect(readHiringManagerRegistrationGrant(token)).resolves.toEqual({ ok: true, value: {
      id: 91, email: "hm@example.invalid", grantVersion: 3,
    } });
  });

  it("accepts only the exact invitation/version/token/user tuple", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 91 }] });
    await expect(acceptHiringManagerRegistrationGrant(7, 91, 3, token)).resolves.toEqual({ ok: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("contains no raw-token/global-id helper or inviter-membership eligibility", () => {
    const source = readFileSync(new URL("../versionedInvitationGrantAuthorization.ts", import.meta.url), "utf8");
    expect(source).not.toContain("getOrganizationInviteByToken");
    expect(source).not.toContain("cancelOrganizationInvite(inviteId");
    expect(source).not.toContain("inviter_membership");
    expect(source).toContain("accepted_by_user_id");
    expect(source).toContain("sha256");
  });
});
