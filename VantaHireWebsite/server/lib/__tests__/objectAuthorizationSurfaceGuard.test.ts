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
  for (const file of ["applications-page.tsx", "candidates-page.tsx"] as const) {
    cpSync(join(APP_ROOT, "client", "src", "pages", file), join(root, "client", "src", "pages", file));
  }
  cpSync(join(APP_ROOT, "client", "src", "lib", "internal-copy.ts"), join(root, "client", "src", "lib", "internal-copy.ts"));
  cpSync(
    join(APP_ROOT, "client", "src", "pages", "application-management-page.tsx"),
    join(root, "client", "src", "pages", "application-management-page.tsx"),
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
        "res.status(404).json({ error: 'Application not found', code: 'APPLICATION_NOT_FOUND' });",
        "res.status(403).json({ code: 'FOREIGN_APPLICATION' });",
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
});
