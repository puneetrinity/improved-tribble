import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  privacy: vi.fn(),
  sendEmail: vi.fn(),
  getEmailService: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  applicationRead: vi.fn(),
  templateRead: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    insert: mocks.insert,
    query: {
      applications: { findFirst: mocks.applicationRead },
      emailTemplates: { findFirst: mocks.templateRead },
    },
    select: vi.fn(),
  },
}));
vi.mock("../../simpleEmailService", () => ({ getEmailService: mocks.getEmailService }));
vi.mock("../../candidate-privacy/decision", () => ({
  CandidatePrivacyRestrictedError: class CandidatePrivacyRestrictedError extends Error {
    code = "CANDIDATE_PRIVACY_RESTRICTED";
  },
  requireCandidatePrivacyAllowed: mocks.privacy,
}));

import { sendAuthorizedTemplatedEmail, sendTemplatedEmail } from "../../emailTemplateService";
import { CandidatePrivacyRestrictedError } from "../../candidate-privacy/decision";

const context = {
  applicationId: 2001,
  templateId: 3001,
  organizationId: 1,
  candidateName: "Synthetic Candidate",
  candidateEmail: "synthetic@example.invalid",
  jobTitle: "Synthetic Role",
  recruiterName: "Fixture Recruiter",
  templateName: "Manual status",
  templateType: "status_update",
  templateSubject: "Hello {{candidate_name}}",
  templateBody: "{{recruiter_name}} regarding {{job_title}}",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockResolvedValue(undefined);
  mocks.getEmailService.mockResolvedValue({ sendEmail: mocks.sendEmail });
  mocks.sendEmail.mockResolvedValue({ messageId: "fixture-message" });
  mocks.privacy.mockResolvedValue(undefined);
});

describe("authorized templated email sender", () => {
  it("keeps the legacy entrypoint exported", () => {
    expect(sendTemplatedEmail).toBeTypeOf("function");
  });

  it("renders and sends only the immutable authorized context", async () => {
    await sendAuthorizedTemplatedEmail(context, { customVariables: { company_name: "Ealana" } });
    expect(mocks.privacy).toHaveBeenCalledWith(
      { type: "application", id: 2001 },
      { globalUse: false },
    );
    expect(mocks.privacy.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendEmail.mock.invocationCallOrder[0]!);
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "synthetic@example.invalid",
      subject: "Hello Synthetic Candidate",
      text: "Fixture Recruiter regarding Synthetic Role",
    });
    expect(mocks.applicationRead).not.toHaveBeenCalled();
    expect(mocks.templateRead).not.toHaveBeenCalled();
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 2001,
      templateId: 3001,
      templateType: "status_update",
      recipientEmail: "synthetic@example.invalid",
      subject: "Hello Synthetic Candidate",
      status: "success",
      errorMessage: null,
    }));
  });

  it("honors bounded overrides without any id-only read", async () => {
    await sendAuthorizedTemplatedEmail(context, {
      customVariables: {}, subjectOverride: "Override", bodyOverride: "Override body",
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "synthetic@example.invalid", subject: "Override", text: "Override body",
    });
    expect(mocks.applicationRead).not.toHaveBeenCalled();
    expect(mocks.templateRead).not.toHaveBeenCalled();
  });

  it("rejects malformed context before privacy, provider or audit", async () => {
    await expect(sendAuthorizedTemplatedEmail({ ...context, organizationId: 0 } as any))
      .rejects.toThrow("AUTHORIZED_EMAIL_CONTEXT_INVALID");
    expect(mocks.privacy).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("stops a final privacy denial before provider and audit", async () => {
    mocks.privacy.mockRejectedValueOnce(new CandidatePrivacyRestrictedError("restricted"));
    await expect(sendAuthorizedTemplatedEmail(context)).rejects.toBeInstanceOf(CandidatePrivacyRestrictedError);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("records only a generic provider failure without leaking the raw error", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("secret provider body synthetic@example.invalid"));
    await sendAuthorizedTemplatedEmail(context);
    const audit = mocks.values.mock.calls[0]?.[0];
    expect(audit).toMatchObject({ status: "failed", errorMessage: "Email provider unavailable" });
    expect(JSON.stringify(audit)).not.toContain("secret provider body");
  });
});
