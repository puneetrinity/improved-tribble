import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({ db: { execute } }));

import {
  addAuthorizedApplicationFeedback,
  addAuthorizedApplicationReviewerNote,
  moveAuthorizedApplicationStage,
  readAuthorizedApplicationFeedback,
  scheduleAuthorizedApplicationInterview,
  scheduleAuthorizedBulkApplicationInterviews,
  setAuthorizedApplicationReviewerRating,
} from "../applicationWorkflowAuthorization";

const policy = { allowPlatformAdmin: true } as const;
const at = new Date("2026-08-30T12:00:00.000Z");

beforeEach(() => execute.mockReset());

describe("application workflow authorization input and failure contracts", () => {
  it("rejects invalid base inputs before a database statement", async () => {
    await expect(moveAuthorizedApplicationStage(0, 1, 2, null, policy)).resolves.toEqual({
      ok: false, reason: "unavailable",
    });
    await expect(scheduleAuthorizedApplicationInterview(1, 0, {
      date: null, time: null, location: null, notes: null,
    }, policy)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(addAuthorizedApplicationReviewerNote(1, 2, " ", policy)).resolves.toEqual({
      ok: false, reason: "unavailable",
    });
    await expect(setAuthorizedApplicationReviewerRating(1, 2, 6, policy)).resolves.toEqual({
      ok: false, reason: "unavailable",
    });
    await expect(readAuthorizedApplicationFeedback(1, 2, {} as any)).resolves.toEqual({
      ok: false, reason: "unavailable",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects duplicate or invalid bulk requests before a database statement", async () => {
    const item = {
      applicationId: 2,
      interviewDate: at,
      interviewTime: "10:00",
      interviewLocation: "Synthetic room",
      interviewNotes: null,
    };
    await expect(scheduleAuthorizedBulkApplicationInterviews(1, [item, item], null, null, policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(scheduleAuthorizedBulkApplicationInterviews(1, [], null, null, policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("collapses zero protected rows to not_found", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(moveAuthorizedApplicationStage(1, 2, 3, null, policy)).resolves.toEqual({
      ok: false, reason: "not_found",
    });
  });

  it("maps database and malformed-result failures without leaking raw errors", async () => {
    execute.mockRejectedValueOnce(new Error("postgres://secret candidate body"));
    const failed = await addAuthorizedApplicationReviewerNote(1, 2, "bounded", policy);
    expect(failed).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(failed)).not.toContain("secret");

    execute.mockResolvedValueOnce({ rows: [{ applicationId: 2, stageId: 3, stageName: "Review", changedAt: "bad" }] });
    await expect(moveAuthorizedApplicationStage(1, 2, 3, null, policy)).resolves.toEqual({
      ok: false, reason: "unavailable",
    });
  });
});

describe("application workflow authorization minimum projections", () => {
  it("returns the exact stage projection from one statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      applicationId: 2, stageId: 3, stageName: "Review", changedAt: at,
    }] });
    await expect(moveAuthorizedApplicationStage(1, 2, 3, "Reviewed", policy)).resolves.toEqual({
      ok: true,
      value: { applicationId: 2, stageId: 3, stageName: "Review", changedAt: at.toISOString() },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns the exact single-interview projection", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      applicationId: 2,
      interviewDate: at,
      interviewTime: "10:00",
      interviewLocation: "Synthetic room",
      interviewNotes: null,
      updatedAt: at,
    }] });
    await expect(scheduleAuthorizedApplicationInterview(1, 2, {
      date: at, time: "10:00", location: "Synthetic room", notes: null,
    }, policy)).resolves.toEqual({
      ok: true,
      value: {
        applicationId: 2,
        interviewDate: at.toISOString(),
        interviewTime: "10:00",
        interviewLocation: "Synthetic room",
        interviewNotes: null,
        updatedAt: at.toISOString(),
      },
    });
  });

  it("returns an ordered all-authorized bulk projection", async () => {
    execute.mockResolvedValueOnce({ rows: [1, 2].map((applicationId) => ({
      requestedCount: 2,
      authorizedCount: 2,
      applicationId,
      interviewDate: at,
      interviewTime: null,
      interviewLocation: "Synthetic room",
      interviewNotes: null,
      updatedAt: at,
    })) });
    const result = await scheduleAuthorizedBulkApplicationInterviews(1, [1, 2].map((applicationId) => ({
      applicationId,
      interviewDate: at,
      interviewTime: null,
      interviewLocation: "Synthetic room",
      interviewNotes: null,
    })), null, null, policy);
    expect(result.ok && result.value.map((row) => row.applicationId)).toEqual([1, 2]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns not_found for a mixed-authority bulk set", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      requestedCount: 2,
      authorizedCount: 1,
      applicationId: null,
    }] });
    await expect(scheduleAuthorizedBulkApplicationInterviews(1, [1, 2].map((applicationId) => ({
      applicationId,
      interviewDate: at,
      interviewTime: null,
      interviewLocation: "Synthetic room",
      interviewNotes: null,
    })), null, null, policy)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns note attribution but never echoes note text", async () => {
    execute.mockResolvedValueOnce({ rows: [{ noteId: 7, applicationId: 2, authorId: 1, createdAt: at }] });
    const result = await addAuthorizedApplicationReviewerNote(1, 2, "Private assessment", policy);
    expect(result).toEqual({
      ok: true,
      value: { applicationId: 2, note: { id: 7, authorId: 1, createdAt: at.toISOString() } },
    });
    expect(JSON.stringify(result)).not.toContain("Private assessment");
  });

  it("returns only the caller-owned rating projection", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      applicationId: 2,
      reviewerId: 1,
      rating: 4,
      rubricVersion: "application-rating-v1",
      updatedAt: at,
    }] });
    await expect(setAuthorizedApplicationReviewerRating(1, 2, 4, policy)).resolves.toEqual({
      ok: true,
      value: {
        applicationId: 2,
        reviewerId: 1,
        rating: 4,
        rubricVersion: "application-rating-v1",
        updatedAt: at.toISOString(),
      },
    });
  });

  it("preserves authorized-empty feedback through the sentinel row", async () => {
    execute.mockResolvedValueOnce({ rows: [{ authorizedApplicationId: 2, id: null }] });
    await expect(readAuthorizedApplicationFeedback(1, 2, policy)).resolves.toEqual({ ok: true, rows: [] });
  });

  it("returns the frozen feedback projection without identity secrets", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 2,
      id: 8,
      applicationId: 2,
      authorId: 3,
      overallScore: 5,
      recommendation: "advance",
      notes: "Strong evidence",
      rubricVersion: "team-feedback-v1",
      createdAt: at,
      updatedAt: at,
      author: { id: 3, firstName: "Fixture", lastName: "Manager", role: "hiring_manager" },
      username: "forbidden@example.invalid",
      password: "forbidden",
    }] });
    const result = await readAuthorizedApplicationFeedback(1, 2, policy);
    expect(result.ok && result.rows[0]).toEqual({
      id: 8,
      applicationId: 2,
      authorId: 3,
      overallScore: 5,
      recommendation: "advance",
      notes: "Strong evidence",
      rubricVersion: "team-feedback-v1",
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      author: { id: 3, firstName: "Fixture", lastName: "Manager", role: "hiring_manager" },
    });
    expect(JSON.stringify(result)).not.toContain("forbidden");
  });

  it("writes server-owned feedback and returns the same minimum projection", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      id: 8,
      applicationId: 2,
      authorId: 3,
      overallScore: 4,
      recommendation: "hold",
      notes: null,
      rubricVersion: "team-feedback-v1",
      createdAt: at,
      updatedAt: at,
      author: { id: 3, firstName: null, lastName: "Manager", role: "hiring_manager" },
    }] });
    const result = await addAuthorizedApplicationFeedback(3, 2, {
      overallScore: 4, recommendation: "hold", notes: null,
    }, policy);
    expect(result.ok && result.value.rubricVersion).toBe("team-feedback-v1");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
