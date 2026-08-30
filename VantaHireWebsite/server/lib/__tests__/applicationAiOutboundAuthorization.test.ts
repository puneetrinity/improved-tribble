import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ db: { execute } }));

import {
  parsePositiveDecimalJobId,
  parseSimilarCandidateQuery,
  publishAuthorizedApplicationAiSummary,
  readAuthorizedApplicationAiSummaryContext,
  readAuthorizedEmailDraftContext,
  readAuthorizedManualEmailContext,
  readAuthorizedSimilarCandidates,
  recordAuthorizedEmailDraftUsage,
} from "../applicationAiOutboundAuthorization";

const policy = { allowPlatformAdmin: true } as const;
const at = new Date("2026-08-30T12:00:00.000Z");

beforeEach(() => execute.mockReset());

describe("application AI/outbound strict inputs", () => {
  it("parses only canonical positive job ids", () => {
    expect(parsePositiveDecimalJobId("42")).toBe(42);
    for (const value of [undefined, "", "0", "01", "+1", " 1", "1.0", "9007199254740992", ["1"]]) {
      expect(parsePositiveDecimalJobId(value)).toBeNull();
    }
  });

  it("parses bounded scalar similarity options", () => {
    expect(parseSimilarCandidateQuery({})).toEqual({ ok: true, minFitScore: 70, limit: 20 });
    expect(parseSimilarCandidateQuery({ minFitScore: "0", limit: "50" }))
      .toEqual({ ok: true, minFitScore: 0, limit: 50 });
    for (const query of [
      { minFitScore: "101" }, { minFitScore: "1x" }, { minFitScore: ["70"] },
      { limit: "0" }, { limit: "51" }, { limit: " 2" }, { limit: "2.0" },
    ]) expect(parseSimilarCandidateQuery(query)).toEqual({ ok: false });
  });

  it("refuses invalid operation inputs without touching the database", async () => {
    await expect(readAuthorizedApplicationAiSummaryContext(0, 1, policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(readAuthorizedSimilarCandidates(1, 2, 101, 20, policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(readAuthorizedManualEmailContext(1, 2, 0, policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(recordAuthorizedEmailDraftUsage(1, 2, {} as never, policy))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("application AI/outbound protected projections", () => {
  it("returns the minimum summary context from one statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      applicationId: 2001, jobId: 1001, organizationId: 1,
      candidateName: "Synthetic Candidate", candidateText: "Stored text",
      jobTitle: "Synthetic Role", jobDescription: "Description",
      requiredSkills: ["TypeScript"], goodToHaveSkills: null,
      candidateEmail: "forbidden@example.invalid", resumeUrl: "gs://forbidden",
    }] });
    await expect(readAuthorizedApplicationAiSummaryContext(101, 2001, policy)).resolves.toEqual({
      ok: true,
      value: {
        applicationId: 2001, jobId: 1001, organizationId: 1,
        candidateName: "Synthetic Candidate", candidateText: "Stored text",
        jobTitle: "Synthetic Role", jobDescription: "Description",
        requiredSkills: ["TypeScript"], goodToHaveSkills: [],
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("publishes summary and usage through one statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{ applicationId: 2001, computedAt: at }] });
    const result = await publishAuthorizedApplicationAiSummary(101, 2001, {
      summary: "Bounded summary", suggestedAction: "hold", suggestedActionReason: "Needs review",
      strengths: ["Evidence"], concerns: [], keyHighlights: ["Highlight"],
      requiredSkillsMatched: ["TypeScript"], requiredSkillsMissing: [], requiredSkillsMatchPercentage: 100,
      requiredSkillsDepthNotes: "Strong", goodToHaveSkillsMatched: [], goodToHaveSkillsMissing: [],
      modelVersion: "test-model", tokensIn: 10, tokensOut: 20, costUsd: "0.00010000", durationMs: 50,
    }, policy);
    expect(result).toEqual({ ok: true, value: { applicationId: 2001, computedAt: at.toISOString() } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("distinguishes authorized-empty similarity with a sentinel in one statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{ authorizedJobId: 1001, applicationId: null }] });
    await expect(readAuthorizedSimilarCandidates(101, 1001, 70, 20, policy))
      .resolves.toEqual({ ok: true, rows: [] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns only the ordered similarity projection and accepts score zero", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedJobId: 1001, applicationId: 2002, candidateName: "Synthetic",
      candidateEmail: "synthetic@example.invalid", sourceJobId: 1002,
      sourceJobTitle: "Source", aiFitScore: 0, aiFitLabel: null, currentStage: null,
    }] });
    await expect(readAuthorizedSimilarCandidates(101, 1001, 0, 1, policy)).resolves.toEqual({
      ok: true,
      rows: [{
        applicationId: 2002, candidateName: "Synthetic", candidateEmail: "synthetic@example.invalid",
        sourceJobId: 1002, sourceJobTitle: "Source", aiFitScore: 0, aiFitLabel: null, currentStage: null,
      }],
    });
  });

  it("returns the immutable manual-email context", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      applicationId: 2001, templateId: 3001, organizationId: 1,
      candidateName: "Synthetic", candidateEmail: "synthetic@example.invalid",
      jobTitle: "Role", recruiterName: "Fixture Recruiter", templateName: "Manual",
      templateType: "status_update", templateSubject: "Hello {{candidate_name}}", templateBody: "Body",
      password: "forbidden",
    }] });
    const result = await readAuthorizedManualEmailContext(101, 2001, 3001, policy);
    expect(result.ok && result.value).toEqual({
      applicationId: 2001, templateId: 3001, organizationId: 1,
      candidateName: "Synthetic", candidateEmail: "synthetic@example.invalid",
      jobTitle: "Role", recruiterName: "Fixture Recruiter", templateName: "Manual",
      templateType: "status_update", templateSubject: "Hello {{candidate_name}}", templateBody: "Body",
    });
    expect(JSON.stringify(result)).not.toContain("forbidden");
  });

  it("returns the minimum draft context and records usage in separate one-statement commands", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{
        applicationId: 2001, templateId: 3001, organizationId: 1,
        candidateName: "Synthetic", candidateEmail: "synthetic@example.invalid", jobTitle: "Role",
        templateSubject: "Subject", templateBody: "Body",
      }] })
      .mockResolvedValueOnce({ rows: [{ applicationId: 2001, usageId: 9 }] });
    await expect(readAuthorizedEmailDraftContext(101, 2001, 3001, policy)).resolves.toMatchObject({ ok: true });
    await expect(recordAuthorizedEmailDraftUsage(101, 2001, {
      templateId: 3001, tone: "friendly", tokensIn: 5, tokensOut: 6,
      costUsd: "0.00001000", durationMs: 20,
    }, policy)).resolves.toEqual({ ok: true, value: { applicationId: 2001, usageId: 9 } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("collapses zero rows and database/result failures without leaking errors", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(readAuthorizedEmailDraftContext(101, 2001, 3001, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    execute.mockRejectedValueOnce(new Error("postgres://secret candidate text"));
    const result = await readAuthorizedApplicationAiSummaryContext(101, 2001, policy);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
