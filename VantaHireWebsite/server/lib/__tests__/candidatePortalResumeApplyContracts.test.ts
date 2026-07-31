// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { insertApplicationSchema } from '@shared/schema';

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('candidate resume-backed application contracts', () => {
  it('requires exactly one resume source and restricts saved resumes to their verified owner', () => {
    const source = read('../../applications.routes.ts');

    expect(source).toContain('if (hasUploadedResume === hasStoredResume)');
    expect(source).toContain('Upload a resume or select one from your saved resumes, but not both.');
    expect(source).toContain(
      "req.user?.role === 'candidate' && req.user.emailVerified === true"
    );
    const lookupStart = source.indexOf(
      'const storedResume = await db.query.candidateResumes.findFirst'
    );
    const lookupEnd = source.indexOf('if (!storedResume)', lookupStart);
    const ownedResumeLookup = source.slice(lookupStart, lookupEnd);
    expect(ownedResumeLookup).toContain('eq(candidateResumes.id, requestedResumeId)');
    expect(ownedResumeLookup).toContain('eq(candidateResumes.userId, verifiedCandidate.id)');
    expect(source).toContain("code: unverifiedCandidate ? 'EMAIL_NOT_VERIFIED' : 'CANDIDATE_AUTH_REQUIRED'");
  });

  it('reuses the selected resume evidence and binds only verified candidate identity', () => {
    const source = read('../../applications.routes.ts');

    expect(source).toContain('resumeUrl = storedResume.gcsPath');
    expect(source).toContain('resumeRecordId = storedResume.id');
    expect(source).toContain('extractedResumeText = storedResume.extractedText');
    expect(source).toContain('resumeFilename = storedResume.label');
    expect(source).toContain(
      'submittedEmail = verifiedCandidate.username.trim().toLowerCase()'
    );
    expect(source).toContain('submittedName = accountName.slice(0, 50)');
    expect(source).toContain('...(verifiedCandidate && { userId: verifiedCandidate.id })');
    expect(source).toContain('if (verifiedCandidate && req.file?.buffer)');
    expect(source).not.toContain('...(req.user?.id !== undefined && { userId: req.user.id })');
  });

  it('preserves anonymous file upload while keeping application claiming verified-candidate only', () => {
    const source = read('../../applications.routes.ts');

    expect(source).toContain('if (req.file) {');
    expect(source).toContain('uploadToGCS(req.file.buffer, req.file.originalname)');
    expect(source).toMatch(
      /app\.get\(\s*"\/api\/my-applications",\s*requireVerifiedCandidate,/
    );

    const routeStart = source.indexOf('app.get(\n    "/api/my-applications"');
    const verificationGate = source.indexOf('requireVerifiedCandidate', routeStart);
    const claim = source.indexOf('.set({ userId: req.user!.id })', routeStart);
    expect(routeStart).toBeGreaterThan(-1);
    expect(verificationGate).toBeGreaterThan(routeStart);
    expect(claim).toBeGreaterThan(verificationGate);
  });

  it('drops recruiter-owned status and notes and sets submitted on the server', () => {
    const parsed = insertApplicationSchema.parse({
      name: 'Candidate',
      email: 'candidate@example.com',
      phone: '1234567890',
      coverLetter: 'Applicant-owned context',
      whatsappConsent: true,
      status: 'shortlisted',
      notes: 'Injected recruiter note',
      currentStage: 42,
      organizationId: 99,
      userId: 123,
    });

    expect(parsed).toEqual({
      name: 'Candidate',
      email: 'candidate@example.com',
      phone: '1234567890',
      coverLetter: 'Applicant-owned context',
      whatsappConsent: true,
    });

    const source = read('../../applications.routes.ts');
    const routeStart = source.indexOf('app.post("/api/jobs/:id/apply"');
    const parseStart = source.indexOf(
      'const applicationData = insertApplicationSchema.parse({',
      routeStart
    );
    const parseEnd = source.indexOf('});', parseStart);
    const applicantInput = source.slice(parseStart, parseEnd);
    expect(applicantInput).toContain('name: submittedName');
    expect(applicantInput).toContain('email: submittedEmail');
    expect(applicantInput).toContain('phone: req.body?.phone');
    expect(applicantInput).toContain('coverLetter: req.body?.coverLetter');
    expect(applicantInput).toContain('whatsappConsent: req.body?.whatsappConsent');
    expect(applicantInput).not.toContain('...req.body');
    expect(applicantInput).not.toMatch(/\b(status|notes|currentStage|organizationId|userId)\s*:/);

    const creationStart = source.indexOf('await storage.createApplication({', routeStart);
    const creationEnd = source.indexOf('});', creationStart);
    const publicApplicationInsert = source.slice(creationStart, creationEnd);
    const sanitizedSpread = publicApplicationInsert.indexOf('...applicationData');
    const submittedStatus = publicApplicationInsert.indexOf("status: 'submitted'");

    expect(sanitizedSpread).toBeGreaterThan(-1);
    expect(submittedStatus).toBeGreaterThan(sanitizedSpread);
    expect(publicApplicationInsert).not.toContain('notes:');
  });

  it('rejects applying after the public job expiry time', () => {
    const source = read('../../applications.routes.ts');
    const routeStart = source.indexOf('app.post("/api/jobs/:id/apply"');
    const parseStart = source.indexOf(
      'const applicationData = insertApplicationSchema.parse',
      routeStart
    );
    const preInsertChecks = source.slice(routeStart, parseStart);

    expect(preInsertChecks).toContain(
      'if (job.expiresAt && new Date(job.expiresAt) < new Date())'
    );
    expect(preInsertChecks).toContain("'This job is no longer accepting applications'");
  });
});

describe('candidate resume library contracts', () => {
  it('keeps upload, list, and delete available without the Groq feature flag', () => {
    const source = read('../../ai.routes.ts');
    const resumeRoutesStart = source.indexOf('// Resume Management Routes');
    const fitRoutesStart = source.indexOf('// AI Fit Computation Routes');
    const resumeRoutes = source.slice(resumeRoutesStart, fitRoutesStart);

    expect(resumeRoutes).toContain("'/api/ai/resume'");
    expect(resumeRoutes).toContain("'/api/ai/resume/:id'");
    expect(resumeRoutes).not.toContain("requireFeatureFlag('resume')");
    expect(resumeRoutes.match(/requireVerifiedCandidate/g)).toHaveLength(3);
  });

  it('detaches only the owner applications before deleting a resume library record', () => {
    const source = read('../../ai.routes.ts');
    const transaction = source.slice(
      source.indexOf('await db.transaction(async (tx: any) => {'),
      source.indexOf('const remaining = await db', source.indexOf('await db.transaction(async (tx: any) => {'))
    );

    const detach = transaction.indexOf('.set({ resumeId: null })');
    const deletion = transaction.indexOf('tx.delete(candidateResumes)');
    expect(detach).toBeGreaterThan(-1);
    expect(transaction).toContain('eq(applications.resumeId, resumeId)');
    expect(transaction).toContain('eq(applications.userId, userId)');
    expect(deletion).toBeGreaterThan(detach);
  });
});
