import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ db: { execute } }));

import {
  createAuthorizedTalentPoolCandidate,
  listAuthorizedTalentPoolCandidates,
  parseTalentPoolId,
  readAuthorizedTalentPoolCandidate,
  readAuthorizedTalentPoolCreateContext,
  removeAuthorizedTalentPoolCandidate,
  restoreAuthorizedTalentPoolCandidate,
  updateAuthorizedTalentPoolCandidate,
} from "../talentPoolAuthorization";

const policy = { allowPlatformAdmin: true } as const;
const eventId = "123e4567-e89b-42d3-a456-426614174000";
const at = new Date("2026-09-01T12:00:00.000Z");
const candidate = {
  id: 41,
  name: "Synthetic Candidate",
  email: "candidate@example.invalid",
  phone: "+10000000000",
  source: "manual",
  notes: "Synthetic evidence",
  resumeUrl: "https://resume.example.invalid/candidate.pdf",
  createdAt: at,
  updatedAt: at,
};

beforeEach(() => execute.mockReset());

describe("talent-pool strict inputs", () => {
  it("accepts only canonical positive safe integer ids", () => {
    expect(parseTalentPoolId("42")).toBe(42);
    expect(parseTalentPoolId(42)).toBe(42);
    for (const value of [undefined, null, "", "0", "01", "+1", " 1", "1.0", "1e1", ["1"], 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseTalentPoolId(value)).toBeNull();
    }
  });

  it("refuses malformed commands before database work", async () => {
    await expect(listAuthorizedTalentPoolCandidates(0)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(readAuthorizedTalentPoolCandidate(1, 0, policy)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(readAuthorizedTalentPoolCreateContext(-1)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(createAuthorizedTalentPoolCandidate(1, { name: "", email: "x", source: "manual" }))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(updateAuthorizedTalentPoolCandidate(1, 41, {}, policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(removeAuthorizedTalentPoolCandidate(1, 41, "not-a-uuid", policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(restoreAuthorizedTalentPoolCandidate(1, 41, eventId, { allowPlatformAdmin: "yes" as never }))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("minimum projections and typed outcomes", () => {
  it("returns only the nine-field deterministic list projection", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      outcome: "ok",
      candidates: [{ ...candidate, recruiterId: 9, organizationId: 7, formResponseId: 11, removedAt: null }],
    }] });
    const result = await listAuthorizedTalentPoolCandidates(101);
    expect(result).toEqual({ ok: true, rows: [{
      ...candidate,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    }] });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "id", "name", "email", "phone", "source", "notes", "resumeUrl", "createdAt", "updatedAt",
    ]);
    expect(JSON.stringify(result)).not.toContain("recruiterId");
    expect(JSON.stringify(result)).not.toContain("organizationId");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(["forbidden", "not_found"] as const)("maps exact-object %s without parsing a candidate", async (outcome) => {
    execute.mockResolvedValueOnce({ rows: [{ outcome, name: { should: "not parse" } }] });
    await expect(readAuthorizedTalentPoolCandidate(101, 41, policy))
      .resolves.toEqual({ ok: false, reason: outcome });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns the exact candidate projection from a successful exact-object read", async () => {
    execute.mockResolvedValueOnce({ rows: [{ outcome: "ok", ...candidate, password: "forbidden" }] });
    const result = await readAuthorizedTalentPoolCandidate(101, 41, policy);
    expect(result).toEqual({ ok: true, value: {
      ...candidate,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    } });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("distinguishes create actor authority before identity-provider work", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ outcome: "ok" }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "forbidden" }] });
    await expect(readAuthorizedTalentPoolCreateContext(101)).resolves.toEqual({ ok: true });
    await expect(readAuthorizedTalentPoolCreateContext(102)).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("creates and updates from one statement apiece", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ outcome: "ok", ...candidate }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "ok", ...candidate, notes: "Updated" }] });
    await expect(createAuthorizedTalentPoolCandidate(101, {
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      source: "manual",
      notes: candidate.notes,
      resumeUrl: candidate.resumeUrl,
    })).resolves.toMatchObject({ ok: true, value: { id: 41 } });
    await expect(updateAuthorizedTalentPoolCandidate(101, 41, { notes: "Updated" }, policy))
      .resolves.toMatchObject({ ok: true, value: { notes: "Updated" } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("maps normalized-email uniqueness without exposing an existing id", async () => {
    execute
      .mockRejectedValueOnce(Object.assign(new Error("private duplicate detail"), { code: "23505" }))
      .mockRejectedValueOnce(Object.assign(new Error("private duplicate detail"), { code: "23505" }));
    await expect(createAuthorizedTalentPoolCandidate(101, {
      name: candidate.name, email: candidate.email, source: "manual",
    })).resolves.toEqual({ ok: false, reason: "conflict", code: "candidate_exists" });
    await expect(updateAuthorizedTalentPoolCandidate(101, 41, { email: candidate.email }, policy))
      .resolves.toEqual({ ok: false, reason: "conflict", code: "candidate_exists" });
  });

  it("removes and restores through one atomic command each", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ outcome: "ok" }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "ok", ...candidate }] });
    await expect(removeAuthorizedTalentPoolCandidate(101, 41, eventId, policy)).resolves.toEqual({ ok: true });
    await expect(restoreAuthorizedTalentPoolCandidate(101, 41, eventId, policy))
      .resolves.toMatchObject({ ok: true, value: { id: 41 } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("collapses dependency and result-shape failures without leaking details", async () => {
    execute
      .mockRejectedValueOnce(new Error("postgres://secret@example.invalid"))
      .mockResolvedValueOnce({ rows: [{ outcome: "ok", id: 41, email: "secret@example.invalid" }] });
    const failedList = await listAuthorizedTalentPoolCandidates(101);
    const malformedRead = await readAuthorizedTalentPoolCandidate(101, 41, policy);
    expect(failedList).toEqual({ ok: false, reason: "unavailable" });
    expect(malformedRead).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify([failedList, malformedRead])).not.toContain("secret");
  });
});
