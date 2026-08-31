import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ db: { execute } }));

import {
  cancelAuthorizedHiringManagerInvitation,
  createScopedFormTemplate,
  listAuthorizedHiringManagerInvitations,
  parseCandidateRef,
  parseReviewerShareId,
  parseShortlistToken,
  readAuthorizedClientFeedback,
  readAuthorizedResponsesForForm,
  readPublicClientShortlist,
  replaceAuthorizedHiringManagerInvitation,
  resolveInvitationIssuerScope,
  resolvePublicFeedbackTarget,
  updateAuthorizedFormTemplate,
} from "../reviewerShareAuthorization";

const policy = { allowPlatformAdmin: true } as const;
const at = new Date("2026-08-31T12:00:00.000Z");
const candidateRef = "123e4567-e89b-42d3-a456-426614174000";
const token = "a".repeat(64);
const issuer = {
  actorId: 101,
  actorRole: "recruiter",
  organizationId: 1,
  authorityScope: "organization",
  inviterName: "Fixture Recruiter",
} as const;

beforeEach(() => execute.mockReset());

describe("reviewer/share strict inputs", () => {
  it("accepts only canonical positive ids, UUIDs and tokens", () => {
    expect(parseReviewerShareId("42")).toBe(42);
    expect(parseCandidateRef(candidateRef.toUpperCase())).toBe(candidateRef);
    expect(parseShortlistToken(token)).toBe(token);
    for (const value of [undefined, "", "0", "01", "+1", " 1", "1.0", "9007199254740992", ["1"]]) {
      expect(parseReviewerShareId(value)).toBeNull();
    }
    for (const value of ["1", "00000000-0000-0000-0000-000000000000", candidateRef.slice(1), [candidateRef]]) {
      expect(parseCandidateRef(value)).toBeNull();
    }
    for (const value of ["", "A".repeat(64), "a".repeat(63), [token]]) expect(parseShortlistToken(value)).toBeNull();
  });

  it("refuses malformed commands before touching the database", async () => {
    await expect(createScopedFormTemplate(0, {} as never, policy)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(updateAuthorizedFormTemplate(1, 1, { fields: [] }, policy)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(resolvePublicFeedbackTarget(token, "1")).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(cancelAuthorizedHiringManagerInvitation({ ...issuer, organizationId: 2, authorityScope: "platform" }, 1))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("minimum projections and authorized-empty semantics", () => {
  it("returns only the scoped form projection from one statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      id: 10, name: "Interview", description: null, isPublished: true, createdBy: 101,
      createdAt: at, updatedAt: at, ownershipScope: "organization", canManage: true,
      fields: [{ id: 20, formId: 10, type: "short_text", label: "Evidence", required: true, options: null, order: 0 }],
      organizationId: 1, candidateEmail: "forbidden@example.invalid",
    }] });
    await expect(createScopedFormTemplate(101, {
      name: "Interview", description: null, isPublished: true,
      fields: [{ type: "short_text", label: "Evidence", required: true, order: 0 }],
    }, policy)).resolves.toEqual({ ok: true, value: {
      id: 10, name: "Interview", description: null, isPublished: true, createdBy: 101,
      createdAt: at.toISOString(), updatedAt: at.toISOString(), ownershipScope: "organization", canManage: true,
      fields: [{ id: 20, formId: 10, type: "short_text", label: "Evidence", required: true, options: null, order: 0 }],
    } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an authorized form with no visible responses", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      formId: 10, formName: "Interview", responseId: null, responseFormName: null,
      submittedAt: null, answeredAt: null, candidateName: null,
    }] });
    await expect(readAuthorizedResponsesForForm(101, 10, policy)).resolves.toEqual({
      ok: true,
      value: { form: { id: 10, name: "Interview" }, responses: [], total: 0 },
    });
  });

  it("returns the reduced public shortlist and never serializes internal columns", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      title: "Review", message: null, clientName: "Client", jobTitle: "Engineer",
      jobLocation: "Remote", jobType: "full_time", createdAt: at, expiresAt: null,
      candidateRef, candidateName: "Synthetic Candidate", position: 1, resumeAvailable: false,
      aiSummary: null, aiFitLabel: null, email: "forbidden@example.invalid", applicationId: 99,
    }] });
    const result = await readPublicClientShortlist(token, true, true);
    expect(result).toEqual({ ok: true, value: {
      title: "Review", message: null, client: { name: "Client" },
      job: { title: "Engineer", location: "Remote", type: "full_time" },
      candidates: [{ candidateRef, name: "Synthetic Candidate", position: 1, resumeAvailable: false, aiSummary: null, aiFitLabel: null }],
      createdAt: at.toISOString(), expiresAt: null,
    } });
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(JSON.stringify(result)).not.toContain("applicationId");
  });

  it("distinguishes authorized empty feedback from a missing application", async () => {
    execute.mockResolvedValueOnce({ rows: [{ authorizedApplicationId: 2001, id: null }] });
    await expect(readAuthorizedClientFeedback(101, 2001, policy)).resolves.toEqual({ ok: true, rows: [] });
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(readAuthorizedClientFeedback(101, 2001, policy)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns only linked feedback fields", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 2001, id: 9, recommendation: "advance", notes: "Evidence", rating: 5,
      createdAt: at, clientName: "Client", applicationId: 2001, organizationId: 1,
    }] });
    const result = await readAuthorizedClientFeedback(101, 2001, policy);
    expect(result).toEqual({ ok: true, rows: [{
      id: 9, recommendation: "advance", notes: "Evidence", rating: 5,
      createdAt: at.toISOString(), clientName: "Client",
    }] });
    expect(JSON.stringify(result)).not.toContain("organizationId");
  });
});

describe("hiring-manager issuer authority", () => {
  it("resolves the explicit recruiter scope before provider work", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      actorId: 101, actorRole: "recruiter", organizationId: 1,
      authorityScope: "organization", inviterName: "Fixture Recruiter",
    }] });
    await expect(resolveInvitationIssuerScope(101, policy)).resolves.toEqual({ ok: true, value: issuer });
  });

  it("runs replacement as one command and returns no token or organization id", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      id: 7, email: "hm@example.invalid", name: null, status: "pending",
      expiresAt: at, createdAt: at, inviterName: "Fixture Recruiter", token: "forbidden", organizationId: 1,
    }] });
    const result = await replaceAuthorizedHiringManagerInvitation(
      issuer, "hm@example.invalid", null, "b".repeat(64), at,
    );
    expect(result).toEqual({ ok: true, value: {
      id: 7, email: "hm@example.invalid", name: null, status: "pending",
      expiresAt: at.toISOString(), createdAt: at.toISOString(), inviterName: "Fixture Recruiter",
    } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("forbidden");
  });

  it("collapses database failures to a constant result", async () => {
    execute.mockRejectedValueOnce(new Error("postgres://secret token candidate"));
    const result = await listAuthorizedHiringManagerInvitations(issuer);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
