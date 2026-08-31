import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error Plain ESM guard intentionally runs before TypeScript compilation.
import { checkObjectAuthorization } from "../../../scripts/check-object-authorization.mjs";

const APP_ROOT = join(dirname(new URL(import.meta.url).pathname), "../../..");
const MANIFEST = "server/object-authorization/surfaces.json";
const scratch: string[] = [];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function updateHashes(root: string): void {
  const path = join(root, MANIFEST);
  const manifest = JSON.parse(readFileSync(path, "utf8")) as {
    governed_files: Array<{ file: string; sha256: string }>;
  };
  for (const row of manifest.governed_files) {
    row.sha256 = sha256(readFileSync(join(root, row.file)));
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function fixture(): string {
  const parent = mkdtempSync(join(tmpdir(), "flow-object-authorization-test-"));
  scratch.push(parent);
  const root = join(parent, "VantaHireWebsite");
  mkdirSync(root, { recursive: true });
  cpSync(join(APP_ROOT, "server"), join(root, "server"), { recursive: true });
  cpSync(join(APP_ROOT, "shared"), join(root, "shared"), { recursive: true });
  cpSync(join(APP_ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "client", "src", "components", "kanban"), { recursive: true });
  mkdirSync(join(root, "client", "src", "pages"), { recursive: true });
  mkdirSync(join(root, "client", "src", "lib"), { recursive: true });
  cpSync(
    join(APP_ROOT, "client", "src", "components", "kanban", "ApplicationDetailPanel.tsx"),
    join(root, "client", "src", "components", "kanban", "ApplicationDetailPanel.tsx"),
  );
  cpSync(
    join(APP_ROOT, "client", "src", "components", "ResumePreviewModal.tsx"),
    join(root, "client", "src", "components", "ResumePreviewModal.tsx"),
  );
  for (const file of ["applications-page.tsx", "candidates-page.tsx", "admin-forms-page.tsx", "client-shortlist-page.tsx"] as const) {
    cpSync(join(APP_ROOT, "client", "src", "pages", file), join(root, "client", "src", "pages", file));
  }
  cpSync(join(APP_ROOT, "client", "src", "lib", "internal-copy.ts"), join(root, "client", "src", "lib", "internal-copy.ts"));
  cpSync(
    join(APP_ROOT, "client", "src", "pages", "application-management-page.tsx"),
    join(root, "client", "src", "pages", "application-management-page.tsx"),
  );
  cpSync(
    join(APP_ROOT, "client", "src", "pages", "job-edit-page.tsx"),
    join(root, "client", "src", "pages", "job-edit-page.tsx"),
  );
  cpSync(
    join(APP_ROOT, "client", "src", "pages", "org-billing-page.tsx"),
    join(root, "client", "src", "pages", "org-billing-page.tsx"),
  );
  mkdirSync(join(root, "client", "src", "components"), { recursive: true });
  cpSync(
    join(APP_ROOT, "client", "src", "components", "JobPostingStepper.tsx"),
    join(root, "client", "src", "components", "JobPostingStepper.tsx"),
  );
  for (const file of ["package.json", "package-lock.json", "vitest.server.config.ts"] as const) {
    cpSync(join(APP_ROOT, file), join(root, file));
  }
  mkdirSync(join(parent, ".github", "workflows"), { recursive: true });
  cpSync(join(APP_ROOT, "..", ".github", "workflows", "ci.yml"), join(parent, ".github", "workflows", "ci.yml"));
  updateHashes(root);
  return root;
}

function mutate(root: string, file: string, update: (source: string) => string): string[] {
  const path = join(root, file);
  const original = readFileSync(path, "utf8");
  writeFileSync(path, update(original), { mode: 0o600 });
  updateHashes(root);
  const problems = checkObjectAuthorization(root);
  writeFileSync(path, original, { mode: 0o600 });
  updateHashes(root);
  expect(checkObjectAuthorization(root)).toEqual([]);
  return problems;
}

afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

describe("object authorization surface guard", () => {
  it("accepts the checked-in complete contract", () => {
    expect(checkObjectAuthorization(fixture())).toEqual([]);
  });

  it("rejects loss of the current recruiter role", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("actor.role = 'recruiter'", "actor.role = 'candidate'"),
    );
    expect(problems).toContain("authorization read lost the current recruiter-role predicate.");
  });

  it("rejects nullable application organization", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${applications.organizationId} IS NOT NULL", "TRUE"),
    );
    expect(problems).toContain("application organization can be null.");
  });

  it("rejects nullable job organization", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${jobs.organizationId} IS NOT NULL", "TRUE"),
    );
    expect(problems).toContain("job organization can be null.");
  });

  it("rejects loss of seat enforcement", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${organizationMembers.seatAssigned} = TRUE", "TRUE"),
    );
    expect(problems).toContain("authorization read lost current seat enforcement.");
  });

  it("rejects implicit platform administration", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${allowPlatformAdmin} AND actor.role", "TRUE AND actor.role"),
    );
    expect(problems).toContain("platform-admin access is no longer controlled by the explicit policy.");
  });

  it("rejects loss of exact job assignment", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${jobs.postedBy} = ${actorId}", "TRUE"),
    );
    expect(problems).toContain("authorization read lost primary-recruiter authority.");
  });

  it("rejects loss of the candidate-privacy predicate", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("applicationPrivacyAllowed(false)", "sql`TRUE`"),
    );
    expect(problems).toContain("authorization read lost the candidate-privacy predicate.");
  });

  it("rejects a history read moved outside the authorized CTE", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("FROM authorized_application", "FROM applications"),
    );
    expect(problems).toContain("all six protected application readers must read through the authorized CTE.");
  });

  it("rejects a raw email subject projection", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace(
        "${emailAuditLog.id} AS id,",
        "${emailAuditLog.id} AS id,\n             ${emailAuditLog.subject} AS subject,",
      ),
    );
    expect(problems).toContain("email history selects a forbidden raw audit field.");
  });

  it("rejects an id-only storage read restored in the route", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedApplicationEmailHistory(",
        "await storage.getApplication(applicationId);\n      const result = await readAuthorizedApplicationEmailHistory(",
      ),
    );
    expect(problems).toContain("/api/applications/:id/email-history reaches an id-only application/history read.");
  });

  it("rejects restoration of fail-open organization context", () => {
    const problems = mutate(fixture(), "server/auth.ts", (source) =>
      `${source}\nexport function withOrgContext() { return (_req: unknown, _res: unknown, next: () => void) => next(); }\n`,
    );
    expect(problems).toContain("dead fail-open withOrgContext remains defined.");
  });

  it("rejects a duplicate protected route registration", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      `${source}\n// mutation canary\napp.get("/api/applications/:id/history", handler);\n`,
    );
    expect(problems).toContain(
      "route registration must exist exactly once: GET /api/applications/:id/history",
    );
  });

  it("rejects denial-code drift and returns green after byte restoration", () => {
    const root = fixture();
    const file = "server/applications.routes.ts";
    const path = join(root, file);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace("APPLICATION_NOT_FOUND", "FOREIGN_APPLICATION"), { mode: 0o600 });
    updateHashes(root);
    expect(checkObjectAuthorization(root).some((problem) => problem.includes("APPLICATION_NOT_FOUND"))).toBe(true);
    writeFileSync(path, original, { mode: 0o600 });
    updateHashes(root);
    expect(checkObjectAuthorization(root)).toEqual([]);
  });

  it("rejects a route parser that accepts non-decimal application ids", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace("!/^[1-9][0-9]*$/.test(value)", "false"),
    );
    expect(problems).toContain(
      "strict application-id parser lost required anchor: !/^[1-9][0-9]*$/.test(value)",
    );
  });

  it("rejects an interview field moved outside the authorized CTE", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace(
        'authorized_application.candidate_name AS "candidateName"',
        '${applications.name} AS "candidateName"',
      ),
    );
    expect(problems).toContain(
      'interview projection anchor is missing: authorized_application.candidate_name AS "candidateName"',
    );
  });

  it("rejects a post-authorization application re-read", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace(
        'authorized_application.interview_notes AS "interviewNotes"\n        FROM authorized_application',
        'authorized_application.interview_notes AS "interviewNotes"\n'
          + '        FROM authorized_application\n'
          + '        INNER JOIN ${applications} ON ${applications.id} = authorized_application.application_id',
      ),
    );
    expect(problems).toContain("interview target fields are re-read outside the authorized CTE.");
  });

  it("rejects an expanded interview target projection", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace(
        'authorized_application.interview_notes AS "interviewNotes"',
        'authorized_application.interview_notes AS "interviewNotes",\n'
          + '             authorized_application.application_id AS "applicationId"',
      ),
    );
    expect(problems).toContain("interview reader no longer returns the exact seven-field projection.");
    expect(problems).toContain("interview reader selects a forbidden target field.");
  });

  it("rejects an id-only application read restored in the ICS route", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedApplicationInterviewInvite(",
        "await storage.getApplication(appId);\n      const result = await readAuthorizedApplicationInterviewInvite(",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/interview/ics reaches an id-only or raw target read.",
    );
  });

  it("rejects ICS generation moved before authorization", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedApplicationInterviewInvite(",
        "generateInterviewICS(interviewDetails);\n      const result = await readAuthorizedApplicationInterviewInvite(",
      ),
    );
    expect(problems).toContain("the ICS route must invoke its generator exactly once.");
    expect(problems).toContain("ICS generation occurs before statement-bound authorization.");
  });

  it("rejects loss of focused ICS route-test collection", () => {
    const problems = mutate(fixture(), "vitest.server.config.ts", (source) =>
      source.replace("      'server/tests/interviewIcsAuthorization.routes.test.ts',\n", ""),
    );
    expect(problems).toContain("the focused ICS authorization route test is not collected by Vitest.");
  });

  it("rejects drift in the frozen ICS generator", () => {
    const problems = mutate(fixture(), "server/lib/icsGenerator.ts", (source) =>
      `${source}\n// forbidden generator drift\n`,
    );
    expect(problems).toContain("governed/frozen file drifted: server/lib/icsGenerator.ts");
  });

  it("rejects loss of the WhatsApp route seat gate", () => {
    const problems = mutate(fixture(), "server/whatsapp.routes.ts", (source) =>
      source.replace(
        "    requireSeat(),\n    async (req: Request, res: Response, next: NextFunction): Promise<void> => {\n      try {\n        const appId = parsePositiveDecimalApplicationId(req.params.id);",
        "    async (req: Request, res: Response, next: NextFunction): Promise<void> => {\n      try {\n        const appId = parsePositiveDecimalApplicationId(req.params.id);",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/whatsapp-history lost required handler anchor: requireSeat()",
    );
  });

  it("rejects an id-only application read restored in the WhatsApp route", () => {
    const problems = mutate(fixture(), "server/whatsapp.routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedApplicationWhatsAppHistory(",
        "await storage.getApplication(appId);\n        const result = await readAuthorizedApplicationWhatsAppHistory(",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/whatsapp-history reaches an id-only or raw history read.",
    );
  });

  it("rejects a raw WhatsApp audit query restored in the handler", () => {
    const problems = mutate(fixture(), "server/whatsapp.routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedApplicationWhatsAppHistory(",
        "await db.query.whatsappAuditLog.findMany();\n        const result = await readAuthorizedApplicationWhatsAppHistory(",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/whatsapp-history reaches an id-only or raw history read.",
    );
  });

  it("rejects a permissive shared application-id parser", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("!/^[1-9][0-9]*$/.test(value)", "false"),
    );
    expect(problems).toContain(
      "shared strict application-id parser lost required anchor: !/^[1-9][0-9]*$/.test(value)",
    );
  });

  it("rejects a WhatsApp response moved before authorization", () => {
    const problems = mutate(fixture(), "server/whatsapp.routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedApplicationWhatsAppHistory(",
        "res.json(result.rows);\n        const result = await readAuthorizedApplicationWhatsAppHistory(",
      ),
    );
    expect(problems).toContain("WhatsApp history responds before statement-bound authorization.");
  });

  it("rejects loss of application-job organization equality", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${applications.organizationId} = ${jobs.organizationId}", "TRUE"),
    );
    expect(problems).toContain("application and job organization can diverge.");
  });

  it("rejects loss of current organization membership", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("FROM ${organizationMembers}", "FROM ${users}"),
    );
    expect(problems).toContain("authorization read lost current organization membership.");
  });

  it("rejects loss of exact co-recruiter job binding", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${jobRecruiters.jobId} = ${jobs.id}", "TRUE"),
    );
    expect(problems).toContain("co-recruiter authority is not bound to the exact job.");
  });

  it("rejects loss of the WhatsApp authorized-empty audit join", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("LEFT JOIN ${whatsappAuditLog}", "INNER JOIN ${whatsappAuditLog}"),
    );
    expect(problems).toContain("authorized-empty sentinel joins are incomplete.");
    expect(problems).toContain("WhatsApp projection anchor is missing: LEFT JOIN ${whatsappAuditLog}");
  });

  it("rejects a forbidden raw WhatsApp recipient projection", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace(
        "${whatsappAuditLog.status} AS status,",
        '${whatsappAuditLog.status} AS status,\n             ${whatsappAuditLog.recipientPhone} AS "recipientPhone",',
      ),
    );
    expect(problems).toContain("WhatsApp history selects a forbidden raw audit or template field.");
  });

  it("rejects loss of deterministic WhatsApp ordering", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${whatsappAuditLog.id} DESC NULLS LAST", "${whatsappAuditLog.id} ASC NULLS LAST"),
    );
    expect(problems).toContain(
      "WhatsApp projection anchor is missing: ${whatsappAuditLog.id} DESC NULLS LAST",
    );
  });

  it("rejects WhatsApp denial-code drift", () => {
    const problems = mutate(fixture(), "server/whatsapp.routes.ts", (source) =>
      source.replace("APPLICATION_NOT_FOUND", "FOREIGN_APPLICATION"),
    );
    expect(problems).toContain(
      "/api/applications/:id/whatsapp-history lost required handler anchor: APPLICATION_NOT_FOUND",
    );
  });

  it("rejects drift in any frozen non-history WhatsApp route block", () => {
    const problems = mutate(fixture(), "server/whatsapp.routes.ts", (source) =>
      source.replace("getAllWhatsAppTemplates();", "getAllWhatsAppTemplates(/* forbidden drift */);"),
    );
    expect(problems).toContain("frozen WhatsApp route block drifted: GET /api/whatsapp/templates");
  });

  it("rejects loss of the resume-file seat gate", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        'app.get("/api/applications/:id/resume", requireAuth, requireSeat(),',
        'app.get("/api/applications/:id/resume", requireAuth,',
      ),
    );
    expect(problems).toContain("/api/applications/:id/resume lost required handler anchor: requireSeat()");
  });

  it("rejects a check-then-read application lookup restored in resume GET", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const authorized = await readAuthorizedApplicationResumeFile(",
        "await storage.getApplication(applicationId);\n    const authorized = await readAuthorizedApplicationResumeFile(",
      ),
    );
    expect(problems).toContain("/api/applications/:id/resume restores a check-then-read authorization path.");
  });

  it("rejects broadening candidate-self beyond exact application ownership", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${applications.userId} = ${actorId}", "TRUE"),
    );
    expect(problems).toContain("resume-file authorization anchor is missing: ${applications.userId} = ${actorId}");
  });

  it("rejects loss of exact hiring-manager job authority", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace("${jobs.hiringManagerId} = ${actorId}", "TRUE"),
    );
    expect(problems).toContain("resume-file authorization anchor is missing: ${jobs.hiringManagerId} = ${actorId}");
  });

  it("rejects a resume URL re-read outside the authorized CTE", () => {
    const problems = mutate(fixture(), "server/lib/applicationReadAuthorization.ts", (source) =>
      source.replace(
        'authorized_application.resume_url AS "resumeUrl"',
        '${applications.resumeUrl} AS "resumeUrl"',
      ),
    );
    expect(problems).toContain('resume-file authorization anchor is missing: authorized_application.resume_url AS "resumeUrl"');
  });

  it("rejects resume-text GCS extraction", () => {
    const problems = mutate(fixture(), "server/resume.routes.ts", (source) =>
      source.replace(
        "const authorized = await readAuthorizedApplicationResumeText(",
        "await downloadFromGCS(req.query.locator);\n      const authorized = await readAuthorizedApplicationResumeText(",
      ),
    );
    expect(problems).toContain("resume-text route restores a global or provider-backed read.");
  });

  it("rejects loss of resume-text seat admission", () => {
    const problems = mutate(fixture(), "server/resume.routes.ts", (source) =>
      source.replace("    requireSeat(),\n", ""),
    );
    expect(problems).toContain("/api/applications/:id/resume-text lost required handler anchor: requireSeat()");
  });

  it("rejects caller locator parsing restored in the external proxy", () => {
    const problems = mutate(fixture(), "server/candidates.semantic.routes.ts", (source) =>
      source.replace(
        "(_req: Request, res: Response): void => {",
        "(req: Request, res: Response): void => {\n      void req.query.locator;",
      ),
    );
    expect(problems).toContain("external resume proxy still consumes a caller locator or provider.");
  });

  it("rejects a raw locator restored to semantic results", () => {
    const problems = mutate(fixture(), "server/candidates.semantic.routes.ts", (source) =>
      source.replace("previewUrl: null,", "locator: application.resumeUrl,\n            previewUrl: null,"),
    );
    expect(problems).toContain("semantic resume results still emit locators or signed URLs.");
  });

  it("rejects broadening the GCS prefix", () => {
    const problems = mutate(fixture(), "server/gcs-storage.ts", (source) =>
      source.replace("(resumes\\/(.+))", "(.+)")
    );
    expect(problems.some((problem) => problem.includes("bound GCS parser lost anchor"))).toBe(true);
  });

  it("rejects provider access before the durable attempt", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const auditReady = await createResumeAttempt({",
        "await downloadBoundApplicationResumeFromGCS(url);\n    const auditReady = await createResumeAttempt({",
      ),
    );
    expect(problems).toContain("resume-file authorization/audit/provider order is unsafe.");
  });

  it("rejects terminalization without attempted-status CAS", () => {
    const problems = mutate(fixture(), "server/storage.ts", (source) =>
      source.replace("eq(resumeAccessAttempts.status, 'attempted')", "sql`TRUE`"),
    );
    expect(problems).toContain("resume audit repository lost anchor: eq(resumeAccessAttempts.status, 'attempted')");
  });

  it("rejects legacy timestamp updates outside completed GCS streams", () => {
    const problems = mutate(fixture(), "server/storage.ts", (source) =>
      source.replace("input.status !== 'completed'", "false"),
    );
    expect(problems).toContain("resume audit repository lost anchor: input.status !== 'completed'");
  });

  it("rejects loss of audit terminal-coherence constraints", () => {
    const problems = mutate(fixture(), "server/schema-migrations/0002_resume_access_attempts.sql", (source) =>
      source.replace("resume_access_attempts_terminal_check", "resume_access_attempts_terminal_removed"),
    );
    expect(problems).toContain("resume audit migration lost anchor: resume_access_attempts_terminal_check");
  });

  it("rejects migration/checksum drift", () => {
    const problems = mutate(fixture(), "server/schema-migrations/0002_resume_access_attempts.sql", (source) =>
      `${source}\n-- forbidden drift\n`,
    );
    expect(problems).toContain("resume audit migration checksum does not match migration 0002.");
  });

  it("rejects restoring the client download-tracking PATCH", () => {
    const problems = mutate(fixture(), "client/src/pages/applications-page.tsx", (source) =>
      `${source}\nconst forbidden = \`/api/applications/\${1}/download\`;\n`,
    );
    expect(problems).toContain("applications-page restores the retired download-tracking PATCH.");
  });

  it("rejects restoring the external client proxy", () => {
    const problems = mutate(fixture(), "client/src/pages/candidates-page.tsx", (source) =>
      `${source}\nconst forbidden = '/api/candidates/external-resume?locator=x';\n`,
    );
    expect(problems).toContain("candidate client still constructs an external locator/proxy request.");
  });

  it("rejects denial-code drift on resume GET", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "if (!actorRole) {\n      res.status(404).json({ error: 'Application not found', code: 'APPLICATION_NOT_FOUND' });",
        "if (!actorRole) {\n      res.status(403).json({ code: 'FOREIGN_APPLICATION' });",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/resume must use APPLICATION_NOT_FOUND for both denied actor and denied object.",
    );
  });

  it("rejects raw route logging", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const url = authorized.resume.resumeUrl?.trim() ?? '';",
        "console.error(authorized.resume.resumeUrl);\n    const url = authorized.resume.resumeUrl?.trim() ?? '';",
      ),
    );
    expect(problems).toContain("resume-file route logs target or provider data.");
  });

  it("rejects reactivating the retired PATCH", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "res.status(410).json({ code: 'RESUME_DOWNLOAD_TRACKING_RETIRED' });",
        "void storage.getApplication(req.params.id); res.status(200).json({});",
      ),
    );
    expect(problems).toContain("retired resume download-tracking PATCH performs an object read or write.");
  });

  it("rejects drift in the frozen resume preview component", () => {
    const problems = mutate(fixture(), "client/src/components/ResumePreviewModal.tsx", (source) =>
      `${source}\n// forbidden drift\n`,
    );
    expect(problems).toContain("governed/frozen file drifted: client/src/components/ResumePreviewModal.tsx");
  });

  it("rejects restoring the no-organization exception on job applications", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace("requireSeat(), async (req: Request", "requireSeat({ allowNoOrg: true }), async (req: Request"),
    );
    expect(problems).toContain("/api/jobs/:id/applications restores the no-organization seat exception.");
  });

  it("rejects removing the job-application seat gate", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        'app.get("/api/jobs/:id/applications", requireRole([\'recruiter\', \'super_admin\']), requireSeat(),',
        'app.get("/api/jobs/:id/applications", requireRole([\'recruiter\', \'super_admin\']),',
      ),
    );
    expect(problems).toContain("/api/jobs/:id/applications lost required handler anchor: requireSeat()");
  });

  it("rejects restoring requireAuth-only seat usage", () => {
    const problems = mutate(fixture(), "server/subscription.routes.ts", (source) =>
      source.replace("requireRole(['recruiter']), requireSeat(),", "requireAuth,"),
    );
    expect(problems).toContain("/api/subscription/seats/usage restores requireAuth-only admission.");
  });

  it("rejects broadening seat usage to a non-recruiter role", () => {
    const problems = mutate(fixture(), "server/subscription.routes.ts", (source) =>
      source.replace("requireRole(['recruiter']), requireSeat(),", "requireRole(['recruiter', 'candidate']), requireSeat(),"),
    );
    expect(problems).toContain("/api/subscription/seats/usage lost required handler anchor: requireRole(['recruiter'])");
  });

  it("rejects loss of the exact hiring-manager role filter", () => {
    const problems = mutate(fixture(), "server/lib/membershipScopedReadAuthorization.ts", (source) =>
      source.replace('value === "hiring_manager"', 'typeof value === "string"'),
    );
    expect(problems).toContain('membership-scoped directory anchor is missing: value === "hiring_manager"');
  });

  it("rejects restoring a global user read", () => {
    const problems = mutate(fixture(), "server/routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedHiringManagerDirectory(",
        "await storage.getUsers();\n    const result = await readAuthorizedHiringManagerDirectory(",
      ),
    );
    expect(problems).toContain("/api/users restores a global or post-read identity filter.");
  });

  it("rejects post-read JavaScript identity filtering", () => {
    const problems = mutate(fixture(), "server/routes.ts", (source) =>
      source.replace("res.json(result.rows);", "res.json(result.rows.filter((row) => row.role === role));"),
    );
    expect(problems).toContain("/api/users restores a global or post-read identity filter.");
  });

  it("rejects loss of current seated membership in the directory", () => {
    const problems = mutate(fixture(), "server/lib/membershipScopedReadAuthorization.ts", (source) =>
      source.replace("seated_membership.seat_assigned = TRUE", "TRUE"),
    );
    expect(problems).toContain("membership-scoped directory anchor is missing: seated_membership.seat_assigned = TRUE");
  });

  it("rejects loss of directory job-organization equality", () => {
    const problems = mutate(fixture(), "server/lib/membershipScopedReadAuthorization.ts", (source) =>
      source.replace("${jobs.organizationId} = actor_context.organization_id", "TRUE"),
    );
    expect(problems).toContain(
      "membership-scoped directory anchor is missing: ${jobs.organizationId} = actor_context.organization_id",
    );
  });

  it("rejects widening the hiring-manager projection", () => {
    const problems = mutate(fixture(), "server/lib/membershipScopedReadAuthorization.ts", (source) =>
      source.replace("role AS role\n", "role AS role, password AS password\n"),
    );
    expect(problems).toContain("hiring-manager directory selects a forbidden identity field.");
  });

  it("rejects changing the fixed hiring-manager role", () => {
    const problems = mutate(fixture(), "server/lib/membershipScopedReadAuthorization.ts", (source) =>
      source.replace("hiring_manager.role = 'hiring_manager'", "hiring_manager.role = 'recruiter'"),
    );
    expect(problems).toContain("membership-scoped directory anchor is missing: hiring_manager.role = 'hiring_manager'");
  });

  it("rejects loss of distinct deterministic directory ordering", () => {
    const root = fixture();
    const first = mutate(root, "server/lib/membershipScopedReadAuthorization.ts", (source) =>
      source.replace("SELECT DISTINCT hiring_manager.id AS id", "SELECT hiring_manager.id AS id"),
    );
    expect(first).toContain(
      "membership-scoped directory anchor is missing: SELECT DISTINCT hiring_manager.id AS id",
    );
    const second = mutate(root, "server/lib/membershipScopedReadAuthorization.ts", (source) =>
      source.replace("ORDER BY normalized_username, id", "ORDER BY id"),
    );
    expect(second).toContain("membership-scoped directory anchor is missing: ORDER BY normalized_username, id");
  });

  it("rejects a directory response before authorization", () => {
    const problems = mutate(fixture(), "server/routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedHiringManagerDirectory(",
        "res.json([]);\n    const result = await readAuthorizedHiringManagerDirectory(",
      ),
    );
    expect(problems).toContain("/api/users parser/authorization/response order is unsafe.");
  });

  it("rejects raw user-directory logging", () => {
    const problems = mutate(fixture(), "server/routes.ts", (source) =>
      source.replace("res.json(result.rows);", "console.error(result.rows);\n    res.json(result.rows);"),
    );
    expect(problems).toContain("/api/users logs raw directory or database data.");
  });

  it("rejects loss of workflow seated membership", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace("${organizationMembers.seatAssigned} = TRUE", "TRUE"),
    );
    expect(problems).toContain(
      "workflow authorization anchor is missing: ${organizationMembers.seatAssigned} = TRUE",
    );
  });

  it("rejects loss of workflow application-job organization equality", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace("${applications.organizationId} = ${jobs.organizationId}", "TRUE"),
    );
    expect(problems).toContain(
      "workflow authorization anchor must occur in both authorization CTEs: ${applications.organizationId} = ${jobs.organizationId}",
    );
  });

  it("rejects loss of the workflow privacy predicate", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace("applicationPrivacyAllowed(false)", "sql`TRUE`"),
    );
    expect(problems).toContain(
      "workflow authorization anchor must occur in both authorization CTEs: applicationPrivacyAllowed(false)",
    );
  });

  it("rejects a foreign stage admitted to the stage command", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace("${pipelineStages.organizationId} = locked_application.organization_id", "TRUE"),
    );
    expect(problems).toContain(
      "stage workflow anchor is missing: ${pipelineStages.organizationId} = locked_application.organization_id",
    );
  });

  it("rejects a foreign stage admitted to the bulk interview command", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace("target_stage.organization_id = ${applications.organizationId}", "TRUE"),
    );
    expect(problems).toContain(
      "bulk workflow anchor is missing: target_stage.organization_id = ${applications.organizationId}",
    );
  });

  it("rejects partial bulk writes", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace("authorization_count.requested_count = authorization_count.authorized_count", "TRUE"),
    );
    expect(problems).toContain(
      "bulk workflow must fence both mutation and result assembly on complete authorization.",
    );
  });

  it("rejects loss of the atomic legacy-note compatibility projection", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace("compatibility_projection AS", "compatibility_removed AS"),
    );
    expect(problems).toContain("assessment workflow anchor is missing: compatibility_projection AS");
  });

  it("rejects writing the legacy shared application rating", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace(
        "const result = await db.execute(sql`",
        "const forbidden = sql`${applications.rating}`;\n    const result = await db.execute(sql`",
      ),
    );
    expect(problems).toContain("workflow rating writes the legacy shared applications.rating field.");
  });

  it("rejects broadening hiring-manager feedback authority", () => {
    const problems = mutate(fixture(), "server/lib/applicationWorkflowAuthorization.ts", (source) =>
      source.replace(
        "actor.role = 'hiring_manager' AND ${jobs.hiringManagerId} = ${actorId}",
        "actor.role = 'hiring_manager'",
      ),
    );
    expect(problems).toContain(
      "team-feedback workflow anchor is missing: actor.role = 'hiring_manager' AND ${jobs.hiringManagerId} = ${actorId}",
    );
  });

  it("rejects an id-only workflow route fallback", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const result = await addAuthorizedApplicationReviewerNote(",
        "await storage.getApplication(appId);\n      const result = await addAuthorizedApplicationReviewerNote(",
      ),
    );
    expect(problems).toContain("/api/applications/:id/notes restores an id-only or route-owned workflow read/write.");
  });

  it("rejects candidate contact before the stage command", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const result = await moveAuthorizedApplicationStage(",
        "runPrivacyCheckedApplicationSideEffect(appId, 'forbidden', () => sendStatusUpdateNotification(appId, 'x'));\n      const result = await moveAuthorizedApplicationStage(",
      ),
    );
    expect(problems).toContain("/api/applications/:id/stage can contact a candidate before its workflow command succeeds.");
  });

  it("rejects raw workflow route logging", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace("const result = await setAuthorizedApplicationReviewerRating(", "console.error(req.body);\n      const result = await setAuthorizedApplicationReviewerRating("),
    );
    expect(problems).toContain("/api/applications/:id/rating logs raw workflow or database data.");
  });

  it("rejects workflow migration checksum drift", () => {
    const problems = mutate(fixture(), "server/schema-migrations/0003_application_workflow_assessments.sql", (source) =>
      `${source}\n-- forbidden workflow drift\n`,
    );
    expect(problems).toContain("workflow migration checksum does not match migration 0003.");
  });

  it("rejects removal of a workflow migration constraint", () => {
    const problems = mutate(fixture(), "server/schema-migrations/0003_application_workflow_assessments.sql", (source) =>
      source.replace("application_reviewer_ratings_rating_check", "application_reviewer_ratings_rating_removed"),
    );
    expect(problems).toContain("workflow migration anchor is missing: application_reviewer_ratings_rating_check");
  });

  it("rejects drift in frozen seat mutation code", () => {
    const problems = mutate(fixture(), "server/lib/seatService.ts", (source) => `${source}\n// forbidden drift\n`);
    expect(problems).toContain("governed/frozen file drifted: server/lib/seatService.ts");
  });

  it("rejects loss of the AI/outbound seated actor grant", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace("${organizationMembers.seatAssigned} = TRUE", "TRUE"),
    );
    expect(problems).toContain(
      "AI/outbound authorization anchor count drifted: ${organizationMembers.seatAssigned} = TRUE",
    );
  });

  it("rejects loss of AI/outbound application-job organization equality", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace("${applications.organizationId} = ${jobs.organizationId}", "TRUE"),
    );
    expect(problems).toContain(
      "AI/outbound authorization anchor count drifted: ${applications.organizationId} = ${jobs.organizationId}",
    );
  });

  it("rejects loss of the AI/outbound candidate-privacy predicate", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace("applicationPrivacyAllowed(false)", "sql`TRUE`"),
    );
    expect(problems).toContain(
      "AI/outbound authorization anchor count drifted: applicationPrivacyAllowed(false)",
    );
  });

  it("rejects splitting an AI/outbound operation across two statements", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace(
        "export async function publishAuthorizedApplicationAiSummary",
        "export async function publishAuthorizedApplicationAiSummary",
      ).replace(
        "  const result = await db.execute(sql`",
        "  await db.execute(sql`SELECT 1`);\n  const result = await db.execute(sql`",
      ),
    );
    expect(problems).toContain(
      "readAuthorizedApplicationAiSummaryContext must execute exactly one database statement.",
    );
  });

  it("rejects cross-organization similar candidates", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace("${jobs.organizationId} = authorized_target.organization_id", "TRUE"),
    );
    expect(problems).toContain(
      "similar-candidate authority anchor is missing: ${jobs.organizationId} = authorized_target.organization_id",
    );
  });

  it("rejects an unbounded similar-candidate query", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace("LIMIT ${limit}", "LIMIT 500"),
    );
    expect(problems).toContain("similar-candidate authority anchor is missing: LIMIT ${limit}");
  });

  it("rejects nondeterministic similar-candidate ordering", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace(
        "ORDER BY ${applications.aiFitScore} DESC, ${applications.id} ASC",
        "ORDER BY ${applications.aiFitScore} DESC",
      ),
    );
    expect(problems).toContain(
      "similar-candidate authority anchor is missing: ORDER BY ${applications.aiFitScore} DESC, ${applications.id} ASC",
    );
  });

  it("rejects an id-only application read restored in the AI-summary route", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const context = await readAuthorizedApplicationAiSummaryContext(",
        "await storage.getApplication(appId);\n      const context = await readAuthorizedApplicationAiSummaryContext(",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/ai-summary restores a global/id-only candidate read or route-owned write.",
    );
  });

  it("rejects an on-demand GCS fallback restored in the AI-summary route", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const context = await readAuthorizedApplicationAiSummaryContext(",
        "await downloadFromGCS('gs://forbidden/resume');\n      const context = await readAuthorizedApplicationAiSummaryContext(",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/ai-summary restores a global/id-only candidate read or route-owned write.",
    );
  });

  it("rejects restoring customer credit debits in the email-draft route", () => {
    const problems = mutate(fixture(), "server/communications.routes.ts", (source) =>
      source.replace(
        "const context = await readAuthorizedEmailDraftContext(",
        "await useCredits(req.user!.id, 1);\n      const context = await readAuthorizedEmailDraftContext(",
      ),
    );
    expect(problems).toContain("/api/email/draft restores a customer AI-credit check/debit.");
  });

  it("rejects AI provider work before the final privacy fence", () => {
    const problems = mutate(fixture(), "server/applications.routes.ts", (source) =>
      source.replace(
        "const context = await readAuthorizedApplicationAiSummaryContext(",
        "await generateCandidateSummary('x', 'x', 'x', 'x', [], []);\n      const context = await readAuthorizedApplicationAiSummaryContext(",
      ),
    );
    expect(problems).toContain("AI-summary authorization/privacy/provider/publication order is unsafe.");
  });

  it("rejects weakening visible-template organization binding", () => {
    const problems = mutate(fixture(), "server/lib/applicationAiOutboundAuthorization.ts", (source) =>
      source.replace("${emailTemplates.organizationId} = ${applications.organizationId}", "TRUE"),
    );
    expect(problems).toContain(
      "email-context authority anchor is missing: ${emailTemplates.organizationId} = ${applications.organizationId}",
    );
  });

  it("rejects an id-only application re-read in the authorized email sender", () => {
    const problems = mutate(fixture(), "server/emailTemplateService.ts", (source) =>
      source.replace(
        "  const variables: TemplateVariables = {",
        "  await db.query.applications.findFirst();\n  const variables: TemplateVariables = {",
      ),
    );
    expect(problems).toContain(
      "authorized email sender restores an id-only application/job/template read.",
    );
  });

  it("rejects loss of the authorized email sender's final privacy fence", () => {
    const problems = mutate(fixture(), "server/emailTemplateService.ts", (source) =>
      source.replace(
        "      await requireCandidatePrivacyAllowed(\n        { type: 'application', id: context.applicationId },",
        "      await Promise.resolve(\n        { type: 'application', id: context.applicationId },",
      ),
    );
    expect(problems).toContain("authorized email sender reaches the provider before its final privacy fence.");
  });

  it("rejects raw logging in an AI/outbound route", () => {
    const problems = mutate(fixture(), "server/communications.routes.ts", (source) =>
      source.replace(
        "const context = await readAuthorizedManualEmailContext(",
        "console.error(req.body);\n      const context = await readAuthorizedManualEmailContext(",
      ),
    );
    expect(problems).toContain(
      "/api/applications/:id/send-email logs raw candidate, template, provider or database data.",
    );
  });

  it("rejects reviewer/share operations split across multiple statements", () => {
    const problems = mutate(fixture(), "server/lib/reviewerShareAuthorization.ts", (source) =>
      source.replace(
        "export async function readPublicClientShortlist(",
        "async function forbiddenSecondStatement() { await db.execute(sql`SELECT 1`); }\n\nexport async function readPublicClientShortlist(",
      ).replace(
        "  try {\n    const result = await db.execute(sql`\n      WITH authorized_shortlist",
        "  try {\n    await db.execute(sql`SELECT 1`);\n    const result = await db.execute(sql`\n      WITH authorized_shortlist",
      ),
    );
    expect(problems).toContain("readPublicClientShortlist must execute exactly one database statement.");
  });

  it("rejects loss of current seat enforcement from form authority", () => {
    const problems = mutate(fixture(), "server/lib/reviewerShareAuthorization.ts", (source) =>
      source.replace("${organizationMembers.seatAssigned} = TRUE", "TRUE"),
    );
    expect(problems).toContain("reviewer/share authority anchor is missing: ${organizationMembers.seatAssigned} = TRUE");
  });

  it("rejects public shortlist email projection", () => {
    const problems = mutate(fixture(), "server/lib/reviewerShareAuthorization.ts", (source) =>
      source.replace(
        "${applications.name} AS candidate_name,",
        "${applications.name} AS candidate_name,\n               ${applications.email} AS candidate_email,",
      ),
    );
    expect(problems).toContain("public shortlist restores forbidden projection: ${applications.email}");
  });

  it("rejects loss of opaque candidate reference binding", () => {
    const problems = mutate(fixture(), "server/lib/reviewerShareAuthorization.ts", (source) =>
      source.replace("${clientShortlistItems.publicRef} = ${candidateRef}::uuid", "${applications.id} = 1"),
    );
    expect(problems).toContain("public/client-feedback authority anchor is missing: ${clientShortlistItems.publicRef} = ${candidateRef}::uuid");
  });

  it("rejects default-true resume sharing", () => {
    const problems = mutate(fixture(), "server/schema-migrations/0004_reviewer_share_authority.sql", (source) =>
      source.replace("ADD COLUMN share_resume boolean NOT NULL DEFAULT FALSE", "ADD COLUMN share_resume boolean NOT NULL DEFAULT TRUE"),
    );
    expect(problems).toContain("reviewer/share migration anchor is missing: ADD COLUMN share_resume boolean NOT NULL DEFAULT FALSE");
    expect(problems).toContain("reviewer/share migration checksum does not match migration 0004.");
  });

  it("rejects current-membership inference in the conservative migration", () => {
    const problems = mutate(fixture(), "server/schema-migrations/0004_reviewer_share_authority.sql", (source) =>
      `${source}\n-- forbidden classifier\nSELECT 1 FROM organization_members;\n`,
    );
    expect(problems).toContain("reviewer/share migration infers legacy authority from current identity or membership.");
  });

  it("rejects restoring a global form read", () => {
    const problems = mutate(fixture(), "server/forms.routes.ts", (source) =>
      source.replace(
        "const result = await readAuthorizedFormTemplate(",
        "await storage.getFormTemplate(formId);\n        const result = await readAuthorizedFormTemplate(",
      ),
    );
    expect(problems).toContain("/api/forms/templates restores a target global read or id-only write.");
  });

  it("rejects form manage middleware drift", () => {
    const problems = mutate(fixture(), "server/forms.routes.ts", (source) =>
      source.replace(
        'app.patch(\n    "/api/forms/templates/:id",\n    requireAuth,\n    requireRole([\'recruiter\', \'super_admin\']),\n    requireSeat(),',
        'app.patch(\n    "/api/forms/templates/:id",\n    requireAuth,',
      ),
    );
    expect(problems.some((problem) => problem.includes("/api/forms/templates/:id lost form route anchor"))).toBe(true);
  });

  it("rejects client-side creator-id authority inference", () => {
    const problems = mutate(fixture(), "client/src/pages/admin-forms-page.tsx", (source) =>
      source.replace("return template.canManage", "return user?.role === 'super_admin' || template.createdBy === user?.id"),
    );
    expect(problems).toContain("forms UI does not consume server-derived canManage.");
    expect(problems).toContain("forms UI restores creator-id authority inference.");
  });

  it("rejects raw contact data restored to the public shortlist page", () => {
    const problems = mutate(fixture(), "client/src/pages/client-shortlist-page.tsx", (source) =>
      source.replace("{candidate.name}", "{candidate.name} {candidate.email}"),
    );
    expect(problems).toContain("public shortlist client restores forbidden field: candidate.email");
  });

  it("rejects share controls that default on", () => {
    const problems = mutate(fixture(), "client/src/pages/application-management-page.tsx", (source) =>
      source.replace(
        "const [shareShortlistResumes, setShareShortlistResumes] = useState(false)",
        "const [shareShortlistResumes, setShareShortlistResumes] = useState(true)",
      ),
    );
    expect(problems).toContain("shortlist sharing control is missing: const [shareShortlistResumes, setShareShortlistResumes] = useState(false)");
  });

  it("rejects HM provider work before issuer authorization", () => {
    const problems = mutate(fixture(), "server/hiringManagerInvitations.routes.ts", (source) =>
      source.replace(
        "const issuer = await resolveInvitationIssuerScope(",
        "await getEmailService();\n        const issuer = await resolveInvitationIssuerScope(",
      ),
    );
    expect(problems).toContain("HM issuer/user/replacement/provider order is unsafe.");
  });

  it("rejects global HM invitation deletion", () => {
    const problems = mutate(fixture(), "server/hiringManagerInvitations.routes.ts", (source) =>
      source.replace(
        "const deleted = await cancelAuthorizedHiringManagerInvitation(issuer.value, id);",
        "await storage.deleteHiringManagerInvitation(id);\n        const deleted = await cancelAuthorizedHiringManagerInvitation(issuer.value, id);",
      ),
    );
    expect(problems).toContain("/api/hiring-manager-invitations/:id restores a target global read or id-only write.");
  });

  it("rejects reviewer/share migration checksum drift", () => {
    const problems = mutate(fixture(), "server/schema-migrations/0004_reviewer_share_authority.sql", (source) =>
      `${source}\n-- forbidden drift\n`,
    );
    expect(problems).toContain("reviewer/share migration checksum does not match migration 0004.");
  });
});
