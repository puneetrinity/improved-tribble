import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  db: { execute },
  pool: {},
}));

import {
  parsePositiveDecimalApplicationId,
  readAuthorizedApplicationEmailHistory,
  readAuthorizedApplicationInterviewInvite,
  readAuthorizedApplicationResumeFile,
  readAuthorizedApplicationResumeText,
  readAuthorizedApplicationStageHistory,
  readAuthorizedApplicationWhatsAppHistory,
} from "../applicationReadAuthorization";

const allowAdmin = { allowPlatformAdmin: true } as const;

beforeEach(() => {
  execute.mockReset();
});

describe("application read authorization kernel", () => {
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "1" as unknown as number,
  ])("refuses invalid application id %s without querying", async (applicationId) => {
    await expect(readAuthorizedApplicationStageHistory(1, applicationId, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses an invalid actor or policy without querying", async () => {
    await expect(readAuthorizedApplicationStageHistory(0, 1, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(readAuthorizedApplicationStageHistory(
      1,
      1,
      {} as { allowPlatformAdmin: boolean },
    )).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a minimum deterministic stage projection with one query", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      fromStage: 2,
      toStage: 3,
      changedAt: new Date("2026-08-26T10:00:00.000Z"),
      notes: "Reviewed",
      changedBy: 77,
      applicationId: 9,
    }] });
    const result = await readAuthorizedApplicationStageHistory(7, 9, allowAdmin);
    expect(result).toEqual({
      ok: true,
      rows: [{
        fromStage: 2,
        toStage: 3,
        changedAt: "2026-08-26T10:00:00.000Z",
        notes: "Reviewed",
      }],
    });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "fromStage", "toStage", "changedAt", "notes",
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns an authorized empty stage history from the sentinel row", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      fromStage: null,
      toStage: null,
      changedAt: null,
      notes: null,
    }] });
    await expect(readAuthorizedApplicationStageHistory(7, 9, allowAdmin)).resolves.toEqual({
      ok: true,
      rows: [],
    });
  });

  it("does not expose absent versus denied stage reads", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(readAuthorizedApplicationStageHistory(7, 999, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("maps a stage database failure to unavailable without the raw error", async () => {
    execute.mockRejectedValueOnce(new Error("password=raw-secret application=99"));
    const result = await readAuthorizedApplicationStageHistory(7, 9, allowAdmin);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
  });

  it("fails closed on a malformed stage result", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      fromStage: null,
      toStage: "3",
      changedAt: "invalid",
      notes: null,
    }] });
    await expect(readAuthorizedApplicationStageHistory(7, 9, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("returns the exact email projection and no raw audit fields", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      id: 12,
      templateName: "Status update",
      templateType: "status_update",
      recipientEmail: "fixture@example.invalid",
      sentAt: "2026-08-26T11:00:00.000Z",
      status: "success",
      sentBy: { firstName: "Test", lastName: "Recruiter" },
      subject: "forbidden",
      errorMessage: "forbidden",
      previewUrl: "forbidden",
      templateId: 5,
      senderId: 7,
      username: "forbidden",
    }] });
    const result = await readAuthorizedApplicationEmailHistory(7, 9, allowAdmin);
    expect(result).toEqual({
      ok: true,
      rows: [{
        id: 12,
        templateName: "Status update",
        templateType: "status_update",
        recipientEmail: "fixture@example.invalid",
        sentAt: "2026-08-26T11:00:00.000Z",
        status: "success",
        sentBy: { firstName: "Test", lastName: "Recruiter" },
      }],
    });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "id", "templateName", "templateType", "recipientEmail", "sentAt", "status", "sentBy",
    ]);
    expect(Object.keys(result.ok ? result.rows[0]!.sentBy! : {})).toEqual(["firstName", "lastName"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns an authorized empty email history from the sentinel row", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      id: null,
      templateName: "Manual email",
      templateType: "manual",
      recipientEmail: null,
      sentAt: null,
      status: null,
      sentBy: null,
    }] });
    await expect(readAuthorizedApplicationEmailHistory(7, 9, allowAdmin)).resolves.toEqual({
      ok: true,
      rows: [],
    });
  });

  it("does not expose absent versus denied email reads", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(readAuthorizedApplicationEmailHistory(7, 999, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("maps an email database failure to unavailable without the raw error", async () => {
    execute.mockRejectedValueOnce(new Error("postgres://raw-secret application=99"));
    const result = await readAuthorizedApplicationEmailHistory(7, 9, allowAdmin);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
  });

  it("fails closed when an email sender projection is malformed", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      id: 12,
      templateName: "Manual email",
      templateType: "manual",
      recipientEmail: "fixture@example.invalid",
      sentAt: "2026-08-26T11:00:00.000Z",
      status: "success",
      sentBy: { firstName: null, lastName: "Recruiter" },
    }] });
    await expect(readAuthorizedApplicationEmailHistory(7, 9, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("returns the exact interview projection from one authorized statement", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      candidateName: "Fixture Candidate",
      candidateEmail: "candidate@example.invalid",
      jobTitle: "Fixture Role",
      interviewDate: new Date("2099-01-15T00:00:00.000Z"),
      interviewTime: "10:30",
      interviewLocation: "Synthetic room",
      interviewNotes: "Synthetic authorization proof",
      applicationId: 9,
      organizationId: 3,
      phone: "forbidden",
    }] });
    const result = await readAuthorizedApplicationInterviewInvite(7, 9, allowAdmin);
    expect(result).toEqual({
      ok: true,
      interview: {
        candidateName: "Fixture Candidate",
        candidateEmail: "candidate@example.invalid",
        jobTitle: "Fixture Role",
        interviewDate: "2099-01-15T00:00:00.000Z",
        interviewTime: "10:30",
        interviewLocation: "Synthetic room",
        interviewNotes: "Synthetic authorization proof",
      },
    });
    expect(Object.keys(result.ok ? result.interview : {})).toEqual([
      "candidateName",
      "candidateEmail",
      "jobTitle",
      "interviewDate",
      "interviewTime",
      "interviewLocation",
      "interviewNotes",
    ]);
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns nullable interview scheduling fields only after authorization", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      candidateName: "Fixture Candidate",
      candidateEmail: "candidate@example.invalid",
      jobTitle: "Fixture Role",
      interviewDate: null,
      interviewTime: null,
      interviewLocation: null,
      interviewNotes: null,
    }] });
    await expect(readAuthorizedApplicationInterviewInvite(7, 9, allowAdmin)).resolves.toEqual({
      ok: true,
      interview: {
        candidateName: "Fixture Candidate",
        candidateEmail: "candidate@example.invalid",
        jobTitle: "Fixture Role",
        interviewDate: null,
        interviewTime: null,
        interviewLocation: null,
        interviewNotes: null,
      },
    });
  });

  it("does not expose absent versus denied interview reads", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(readAuthorizedApplicationInterviewInvite(7, 999, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("fails closed on malformed, duplicate, database, actor, or policy interview results", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      candidateName: "Fixture Candidate",
      candidateEmail: "candidate@example.invalid",
      jobTitle: "Fixture Role",
      interviewDate: "not-a-date",
      interviewTime: "10:30",
      interviewLocation: null,
      interviewNotes: null,
    }] });
    await expect(readAuthorizedApplicationInterviewInvite(7, 9, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    const valid = {
      candidateName: "Fixture Candidate",
      candidateEmail: "candidate@example.invalid",
      jobTitle: "Fixture Role",
      interviewDate: null,
      interviewTime: null,
      interviewLocation: null,
      interviewNotes: null,
    };
    execute.mockResolvedValueOnce({ rows: [valid, valid] });
    await expect(readAuthorizedApplicationInterviewInvite(7, 9, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    execute.mockRejectedValueOnce(new Error("postgres://raw-secret candidate@example.invalid"));
    const failed = await readAuthorizedApplicationInterviewInvite(7, 9, allowAdmin);
    expect(failed).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(failed)).not.toContain("raw-secret");

    await expect(readAuthorizedApplicationInterviewInvite(0, 9, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(readAuthorizedApplicationInterviewInvite(
      7,
      9,
      {} as { allowPlatformAdmin: boolean },
    )).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("returns only the statement-bound resume-file projection", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      applicationId: 9,
      organizationId: 3,
      resumeUrl: "gs://configured/resumes/fixture.pdf",
      resumeFilename: "fixture.pdf",
      candidateEmail: "forbidden@example.invalid",
    }] });
    const result = await readAuthorizedApplicationResumeFile(7, 9, allowAdmin);
    expect(result).toEqual({
      ok: true,
      resume: {
        applicationId: 9,
        organizationId: 3,
        resumeUrl: "gs://configured/resumes/fixture.pdf",
        resumeFilename: "fixture.pdf",
      },
    });
    expect(Object.keys(result.ok ? result.resume : {})).toEqual([
      "applicationId", "organizationId", "resumeUrl", "resumeFilename",
    ]);
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("allows a candidate-self file projection with a null organization", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      applicationId: 9,
      organizationId: null,
      resumeUrl: null,
      resumeFilename: null,
    }] });
    await expect(readAuthorizedApplicationResumeFile(7, 9, allowAdmin)).resolves.toEqual({
      ok: true,
      resume: { applicationId: 9, organizationId: null, resumeUrl: null, resumeFilename: null },
    });
  });

  it("returns stored resume text and preserves an authorized missing-text result", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ applicationId: 9, organizationId: 3, text: "Stored text" }] })
      .mockResolvedValueOnce({ rows: [{ applicationId: 9, organizationId: 3, text: null }] });
    const available = await readAuthorizedApplicationResumeText(7, 9, allowAdmin);
    expect(available).toEqual({
      ok: true,
      resume: { applicationId: 9, organizationId: 3, text: "Stored text" },
    });
    expect(Object.keys(available.ok ? available.resume : {})).toEqual([
      "applicationId", "organizationId", "text",
    ]);
    await expect(readAuthorizedApplicationResumeText(7, 9, allowAdmin)).resolves.toEqual({
      ok: true,
      resume: { applicationId: 9, organizationId: 3, text: null },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["file", readAuthorizedApplicationResumeFile],
    ["text", readAuthorizedApplicationResumeText],
  ] as const)("fails closed for absent, duplicate, malformed, database, and input %s reads", async (_kind, reader) => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(reader(7, 9, allowAdmin)).resolves.toEqual({ ok: false, reason: "not_found" });

    const valid = _kind === "file"
      ? { applicationId: 9, organizationId: 3, resumeUrl: null, resumeFilename: null }
      : { applicationId: 9, organizationId: 3, text: null };
    execute.mockResolvedValueOnce({ rows: [valid, valid] });
    await expect(reader(7, 9, allowAdmin)).resolves.toEqual({ ok: false, reason: "unavailable" });

    execute.mockResolvedValueOnce({ rows: [{ ...valid, applicationId: "9" }] });
    await expect(reader(7, 9, allowAdmin)).resolves.toEqual({ ok: false, reason: "unavailable" });

    execute.mockRejectedValueOnce(new Error("postgres://raw-secret resume-object"));
    const failed = await reader(7, 9, allowAdmin);
    expect(failed).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(failed)).not.toContain("raw-secret");

    await expect(reader(0, 9, allowAdmin)).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["1", 1],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
    [undefined, null],
    ["", null],
    ["0", null],
    ["-1", null],
    ["+1", null],
    ["01", null],
    [" 1", null],
    ["1 ", null],
    ["1.0", null],
    ["1e1", null],
    ["0x10", null],
    ["1x", null],
    [String(Number.MAX_SAFE_INTEGER + 1), null],
    [1 as unknown, null],
  ])("strictly parses application id %s", (value, expected) => {
    expect(parsePositiveDecimalApplicationId(value)).toBe(expected);
  });

  it("returns the exact WhatsApp status projection and excludes raw audit/template fields", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      templateName: "Interview update",
      templateType: "interview_invite",
      status: "read",
      sentAt: new Date("2026-08-26T12:00:00.000Z"),
      deliveredAt: "2026-08-26T12:01:00.000Z",
      readAt: "2026-08-26T12:02:00.000Z",
      sentBy: { firstName: "Test", lastName: "Recruiter" },
      id: 12,
      applicationId: 9,
      templateId: 4,
      recipientPhone: "+15550000001",
      messageId: "provider-secret",
      errorCode: "forbidden",
      errorMessage: "forbidden",
      templateVariables: { candidate: "forbidden" },
      bodyTemplate: "forbidden",
      metaTemplateId: "forbidden",
    }] });

    const result = await readAuthorizedApplicationWhatsAppHistory(7, 9, allowAdmin);
    expect(result).toEqual({
      ok: true,
      rows: [{
        templateName: "Interview update",
        templateType: "interview_invite",
        status: "read",
        sentAt: "2026-08-26T12:00:00.000Z",
        deliveredAt: "2026-08-26T12:01:00.000Z",
        readAt: "2026-08-26T12:02:00.000Z",
        sentBy: { firstName: "Test", lastName: "Recruiter" },
      }],
    });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "templateName",
      "templateType",
      "status",
      "sentAt",
      "deliveredAt",
      "readAt",
      "sentBy",
    ]);
    expect(JSON.stringify(result)).not.toContain("+15550000001");
    expect(JSON.stringify(result)).not.toContain("provider-secret");
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns authorized empty WhatsApp history from the sentinel row", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      templateName: "WhatsApp update",
      templateType: "unknown",
      status: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      sentBy: null,
    }] });
    await expect(readAuthorizedApplicationWhatsAppHistory(7, 9, allowAdmin)).resolves.toEqual({
      ok: true,
      rows: [],
    });
  });

  it("does not expose absent versus denied WhatsApp reads", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(readAuthorizedApplicationWhatsAppHistory(7, 999, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("fails closed on malformed, database, actor, or policy WhatsApp results", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorizedApplicationId: 9,
      templateName: "WhatsApp update",
      templateType: "status_update",
      status: "sent",
      sentAt: "2026-08-26T12:00:00.000Z",
      deliveredAt: "not-a-date",
      readAt: null,
      sentBy: null,
    }] });
    await expect(readAuthorizedApplicationWhatsAppHistory(7, 9, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    execute.mockRejectedValueOnce(new Error("postgres://raw-secret phone=+15550000001"));
    const failed = await readAuthorizedApplicationWhatsAppHistory(7, 9, allowAdmin);
    expect(failed).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(failed)).not.toContain("raw-secret");

    await expect(readAuthorizedApplicationWhatsAppHistory(0, 9, allowAdmin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(readAuthorizedApplicationWhatsAppHistory(
      7,
      9,
      {} as { allowPlatformAdmin: boolean },
    )).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
