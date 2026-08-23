/**
 * Applications Routes Module
 *
 * All application, candidate, and pipeline management endpoints:
 * - Application submission (/api/jobs/:id/apply)
 * - Recruiter add candidate (/api/jobs/:id/applications/recruiter-add)
 * - Application management (stage, interview, notes, rating, feedback)
 * - Pipeline stages (/api/pipeline/stages)
 * - Candidate views (/api/candidates, /api/my-applications)
 * - User profile (/api/profile)
 * - Resume download
 */

import type { Express, Request, Response, NextFunction } from 'express';
import type { Multer } from 'multer';
import { sql, eq, and, inArray, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { storage } from './storage';
import { requireAuth, requireRole, requireSeat, requireVerifiedCandidate } from './auth';
import { getUserOrganization } from './lib/organizationService';
import { calculateAiCost } from './lib/aiMatchingEngine';
import { syncProfileCompletionStatus } from './lib/profileCompletion';
import { requireFeatureAccess, FEATURES } from './lib/featureGating';
import { getAiCreditExhaustionPayload, hasEnoughCredits, useCredits, getCreditCostForOperation, getUserDailyRateLimit, getPlanRateLimitInfo } from './lib/creditService';
import {
  insertApplicationSchema,
  recruiterAddApplicationSchema,
  insertPipelineStageSchema,
  insertApplicationFeedbackSchema,
  applications,
  candidateOutreachSchedules,
  jobSourcedCandidates,
  sourcedCandidateOutreachLog,
  pipelineStages,
  applicationStageHistory,
  candidateResumes,
  userAiUsage,
  applicationFeedback,
  type Application,
  type Job,
  type JobSourcedCandidate,
} from '@shared/schema';
import { uploadToGCS, getSignedDownloadUrl, downloadFromGCS } from './gcs-storage';
import {
  sendStatusUpdateNotification,
  sendInterviewInvitationNotification,
  sendApplicationReceivedNotification,
  sendOfferNotification,
  sendRejectionNotification,
} from './notificationService';
import { notifyRecruitersNewApplication } from './emailTemplateService';
import { generateInterviewICS, getICSFilename } from './lib/icsGenerator';
import { verifyOutreachApplicationToken } from './lib/outreachComplianceCore';
import { lockCandidateOutreach } from './lib/outreachConcurrency';
import { extractResumeText, validateResumeText } from './lib/resumeExtractor';
import { isAIEnabled, generateCandidateSummary } from './aiJobAnalyzer';
import { checkCircuitBreaker } from './lib/aiMatchingEngine';
import { applicationRateLimit, recruiterAddRateLimit, aiAnalysisRateLimit, type RateLimitInfo } from './rateLimit';
import { isQueueAvailable, enqueueSummaryBatch, removeJob, QUEUES } from './lib/aiQueue';
import { randomUUID } from 'crypto';
import type { CsrfMiddleware } from './types/routes';
import { normalizeStageName } from './lib/pipelineStageUtils';
import { resolveActiveKGTenantId } from './lib/activekgTenant';
import { MIN_RESUME_TEXT_LENGTH } from './lib/applicationGraphSyncProcessor';
import { pickInitialPipelineStage } from './lib/pipelineStageSelection';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
  requireNewCandidateIdentityAllowed,
} from './candidate-privacy/decision';

// Base URL for email links
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

async function requireApplicationIngestAllowed(input: {
  userId?: number;
  email: string;
  phone?: string | null;
}): Promise<void> {
  if (input.userId) {
    await requireCandidatePrivacyAllowed(
      { type: 'candidate_user', id: input.userId },
      { globalUse: true, newGlobalOperation: true },
    );
    return;
  }
  const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [
    { identifier_type: 'email', value: input.email.trim().toLowerCase() },
  ];
  if (input.phone?.trim()) identifiers.push({ identifier_type: 'phone', value: input.phone.trim() });
  await requireNewCandidateIdentityAllowed(identifiers);
}

function sendPrivacyRestriction(error: unknown, res: Response): boolean {
  if (!(error instanceof CandidatePrivacyRestrictedError)) return false;
  res.status(503).json({ code: error.code });
  return true;
}

function runPrivacyCheckedApplicationSideEffect(
  applicationId: number,
  label: string,
  sideEffect: () => Promise<unknown>,
): void {
  void (async () => {
    try {
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: applicationId },
        { globalUse: false },
      );
      await sideEffect();
    } catch (error) {
      const code = error instanceof CandidatePrivacyRestrictedError
        ? error.code
        : 'side_effect_failed';
      console.error(`[APPLICATION_SIDE_EFFECT] ${label}:`, { code });
    }
  })();
}

function toCandidateApplicationView(application: Application & { job: Job }) {
  return {
    id: application.id,
    jobId: application.jobId,
    status: application.status,
    coverLetter: application.coverLetter,
    appliedAt: application.appliedAt,
    updatedAt: application.updatedAt,
    aiFitScore: application.aiFitScore,
    aiFitLabel: application.aiFitLabel,
    aiFitReasons: application.aiFitReasons,
    aiComputedAt: application.aiComputedAt,
    aiStaleReason: application.aiStaleReason,
    job: {
      id: application.job.id,
      title: application.job.title,
      location: application.job.location,
      type: application.job.type,
      description: application.job.description,
      skills: application.job.skills,
      deadline: application.job.deadline,
      createdAt: application.job.createdAt,
      isActive: application.job.isActive,
      expiresAt: application.job.expiresAt,
    },
  };
}

// Validation schemas
const updateStageSchema = z.object({
  stageId: z.number().int().positive(),
  notes: z.string().optional(),
});

const scheduleInterviewSchema = z.object({
  date: z.string().optional(),
  time: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

const requestHiringManagerReviewSchema = z.object({
  applicationIds: z.array(z.number().int().positive()).min(1),
  note: z.string().max(1000).optional(),
});

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

async function matchApplicationToSourcedCandidate(params: {
  applicationId: number;
  applicationEmail: string;
  jobId: number;
  organizationId: number | null | undefined;
  appliedAt: Date;
  outreachAttributionToken?: string | null;
  executor?: any;
}): Promise<void> {
  const {
    applicationId,
    applicationEmail,
    jobId,
    organizationId,
    appliedAt,
    outreachAttributionToken,
    executor,
  } = params;
  if (!organizationId) return;

  const applyMatch = async (tx: any) => {
    let sourcedCandidate: JobSourcedCandidate | null = null;
    let attributedCampaignId: string | null = null;
    let attributedRound: number | null = null;
    if (outreachAttributionToken) {
      try {
        const claims = verifyOutreachApplicationToken(outreachAttributionToken);
        if (claims.organizationId === organizationId && claims.jobId === jobId) {
          const sentLog = await tx.query.sourcedCandidateOutreachLog.findFirst({
            where: and(
              eq(sourcedCandidateOutreachLog.organizationId, organizationId),
              eq(sourcedCandidateOutreachLog.jobId, jobId),
              eq(sourcedCandidateOutreachLog.sourcedCandidateId, claims.sourcedCandidateId),
              eq(sourcedCandidateOutreachLog.campaignId, claims.campaignId),
              eq(sourcedCandidateOutreachLog.campaignRound, claims.campaignRound),
              eq(sourcedCandidateOutreachLog.status, 'sent'),
            ),
            columns: { id: true },
          });
          if (sentLog) {
            sourcedCandidate = await tx.query.jobSourcedCandidates.findFirst({
              where: and(
                eq(jobSourcedCandidates.id, claims.sourcedCandidateId),
                eq(jobSourcedCandidates.organizationId, organizationId),
                eq(jobSourcedCandidates.jobId, jobId),
              ),
            }) ?? null;
            if (sourcedCandidate) {
              attributedCampaignId = claims.campaignId;
              attributedRound = claims.campaignRound;
            }
          }
        }
      } catch {
        // An invalid optional attribution token never blocks a valid application.
      }
    }

    if (!sourcedCandidate) {
      const normalizedEmail = normalizeEmailAddress(applicationEmail);
      if (!normalizedEmail) return;
      sourcedCandidate = await tx.query.jobSourcedCandidates.findFirst({
        where: and(
          eq(jobSourcedCandidates.organizationId, organizationId),
          eq(jobSourcedCandidates.jobId, jobId),
          sql`LOWER(TRIM(${jobSourcedCandidates.foundEmail})) = ${normalizedEmail}`,
          sql`(
            ${jobSourcedCandidates.state} = 'shortlisted'
            OR ${jobSourcedCandidates.outreachCount} > 0
          )`,
        ),
        orderBy: [
          desc(jobSourcedCandidates.lastOutreachAt),
          desc(jobSourcedCandidates.updatedAt),
          desc(jobSourcedCandidates.id),
        ],
      }) ?? null;
      if (sourcedCandidate) {
        attributedCampaignId = sourcedCandidate.lastOutreachCampaignId ?? null;
        attributedRound = sourcedCandidate.lastOutreachRound
          ?? (sourcedCandidate.state === 'shortlisted' ? 0 : null);
      }
    }

    if (!sourcedCandidate) return;

    await lockCandidateOutreach(tx, sourcedCandidate.id);
    await tx.execute(sql`
      SELECT id
      FROM job_sourced_candidates
      WHERE id = ${sourcedCandidate.id}
      FOR UPDATE
    `);
    await tx
      .update(jobSourcedCandidates)
      .set({
        state: 'converted',
        convertedApplicationId: applicationId,
        appliedAt,
        appliedFromCampaignId:
          attributedCampaignId ?? sourcedCandidate.lastOutreachCampaignId ?? null,
        appliedAfterRound:
          attributedRound ?? sourcedCandidate.lastOutreachRound ?? null,
        updatedAt: new Date(),
      })
      .where(eq(jobSourcedCandidates.id, sourcedCandidate.id));
    await tx
      .update(candidateOutreachSchedules)
      .set({
        status: 'cancelled',
        lastError: 'candidate_applied',
        updatedAt: new Date(),
      })
      .where(eq(candidateOutreachSchedules.sourcedCandidateId, sourcedCandidate.id));
  };

  if (executor) {
    await applyMatch(executor);
  } else {
    await db.transaction(applyMatch);
  }
}

/**
 * Register all application-related routes
 */
export function registerApplicationsRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware,
  upload: Multer
): void {
  const ensureHiringManagerOwnsApplication = async (userId: number, applicationId: number) => {
    const application = await storage.getApplication(applicationId);
    if (!application) {
      return { ok: false as const, status: 404, error: 'Application not found' };
    }

    const job = await storage.getJob(application.jobId);
    if (!job || job.hiringManagerId !== userId) {
      return { ok: false as const, status: 403, error: 'Access denied' };
    }

    return { ok: true as const };
  };

  // ============= APPLICATION SUBMISSION ROUTES =============

  // Submit job application with resume upload
  app.post("/api/jobs/:id/apply", applicationRateLimit, csrfProtection, upload.single('resume'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const jobId = Number(idParam);
      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      // Check if job exists
      const job = await storage.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      // Check if job is accepting applications
      if (!job.isActive) {
        res.status(400).json({ error: 'This job is no longer accepting applications' });
        return;
      }

      if (job.status && job.status !== 'approved') {
        res.status(400).json({ error: 'This job is not currently accepting applications' });
        return;
      }

      if (job.deadline && new Date(job.deadline) < new Date()) {
        res.status(400).json({ error: 'The application deadline for this job has passed' });
        return;
      }

      if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
        res.status(400).json({ error: 'This job is no longer accepting applications' });
        return;
      }

      const rawResumeId = req.body?.resumeId;
      const rawOutreachAttributionToken = req.body?.outreachAttributionToken;
      const outreachAttributionToken =
        typeof rawOutreachAttributionToken === 'string'
        && rawOutreachAttributionToken.length <= 4096
          ? rawOutreachAttributionToken
          : null;
      const hasStoredResume =
        rawResumeId !== undefined &&
        rawResumeId !== null &&
        String(rawResumeId).trim() !== '';
      const hasUploadedResume = Boolean(req.file);

      if (hasUploadedResume === hasStoredResume) {
        res.status(400).json({
          error: 'Choose exactly one resume',
          message: 'Upload a resume or select one from your saved resumes, but not both.',
        });
        return;
      }

      let requestedResumeId: number | null = null;
      if (hasStoredResume) {
        const normalizedResumeId = String(rawResumeId).trim();
        if (!/^\d+$/.test(normalizedResumeId)) {
          res.status(400).json({ error: 'Invalid resume ID' });
          return;
        }
        requestedResumeId = Number(normalizedResumeId);
        if (!Number.isSafeInteger(requestedResumeId) || requestedResumeId <= 0) {
          res.status(400).json({ error: 'Invalid resume ID' });
          return;
        }
      }

      const verifiedCandidate =
        req.user?.role === 'candidate' && req.user.emailVerified === true
          ? req.user
          : null;

      if (requestedResumeId !== null && !verifiedCandidate) {
        const unverifiedCandidate = req.user?.role === 'candidate' && !req.user.emailVerified;
        res.status(403).json({
          error: unverifiedCandidate
            ? 'Please verify your email before using a saved resume'
            : 'Sign in as a verified candidate to use a saved resume',
          code: unverifiedCandidate ? 'EMAIL_NOT_VERIFIED' : 'CANDIDATE_AUTH_REQUIRED',
        });
        return;
      }

      let submittedName = req.body?.name;
      let submittedEmail = req.body?.email;
      if (verifiedCandidate) {
        submittedEmail = verifiedCandidate.username.trim().toLowerCase();
        const accountName = [verifiedCandidate.firstName, verifiedCandidate.lastName]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .map(part => part.trim())
          .join(' ') || verifiedCandidate.username.split('@')[0] || 'Candidate';
        submittedName = accountName.slice(0, 50);
      }

      // This is an applicant-owned allowlist. Recruiter-only workflow fields never
      // cross the public route boundary.
      const applicationData = insertApplicationSchema.parse({
        name: submittedName,
        email: submittedEmail,
        phone: req.body?.phone,
        coverLetter: req.body?.coverLetter,
        whatsappConsent: req.body?.whatsappConsent,
      });

      // Before duplicate disclosure, GCS, extraction, candidate-resume insert,
      // application insert, notifications or queueing.
      await requireApplicationIngestAllowed({
        ...(verifiedCandidate ? { userId: verifiedCandidate.id } : {}),
        email: applicationData.email,
        phone: applicationData.phone,
      });

      let resumeUrl = '';
      let resumeRecordId: number | null = null;
      let resumeCountForCompletion: number | null = null;
      let extractedResumeText: string | null = null;
      let resumeFilename: string | null = null;

      if (requestedResumeId !== null && verifiedCandidate) {
        const storedResume = await db.query.candidateResumes.findFirst({
          where: and(
            eq(candidateResumes.id, requestedResumeId),
            eq(candidateResumes.userId, verifiedCandidate.id)
          ),
        });

        if (!storedResume) {
          res.status(404).json({ error: 'Saved resume not found' });
          return;
        }

        resumeUrl = storedResume.gcsPath;
        resumeRecordId = storedResume.id;
        extractedResumeText = storedResume.extractedText;
        resumeFilename = storedResume.label;
      }

      // Duplicate detection (case-insensitive email check)
      const existingApp = await storage.findApplicationByJobAndEmail(jobId, applicationData.email);

      if (existingApp) {
        await matchApplicationToSourcedCandidate({
          applicationId: existingApp.id,
          applicationEmail: existingApp.email,
          jobId,
          organizationId: job.organizationId,
          appliedAt: existingApp.appliedAt ?? new Date(),
          outreachAttributionToken,
        });
        res.status(400).json({
          error: 'Duplicate application',
          message: `You have already applied for this position with ${applicationData.email}`,
          existingApplicationId: existingApp.id
        });
        return;
      }

      // Increment apply click count for analytics (after duplicate check)
      await storage.incrementApplyClicks(jobId);

      // Upload a new resume only when the application did not select a saved one.
      if (req.file) {
        resumeFilename = req.file.originalname ?? null;
        try {
          await requireApplicationIngestAllowed({
            ...(verifiedCandidate ? { userId: verifiedCandidate.id } : {}),
            email: applicationData.email,
            phone: applicationData.phone,
          });
          resumeUrl = await uploadToGCS(req.file.buffer, req.file.originalname);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[APPLICATION_SUBMIT] Resume upload failed (skipping):', {
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            error: message,
          });
          if (message.toLowerCase().includes('invalid file format')) {
            res.status(400).json({ error: message });
            return;
          }
          // GCS not configured or unavailable — continue without resume URL
        }
        try {
          const extraction = await extractResumeText(req.file.buffer);
          if (extraction.success && validateResumeText(extraction.text)) {
            extractedResumeText = extraction.text;
          }
        } catch (resumeExtractError) {
          console.error('Resume extraction failed during application (non-blocking):', resumeExtractError);
        }
      }

      // If candidate is authenticated, persist resume + extracted text for AI
      if (verifiedCandidate && req.file?.buffer) {
        try {
          await requireCandidatePrivacyAllowed(
            { type: 'candidate_user', id: verifiedCandidate.id },
            { globalUse: true, newGlobalOperation: true },
          );
          // Enforce soft limit of 3 resumes like resume upload endpoint
          const existingResumes = await db.query.candidateResumes.findMany({
            where: eq(candidateResumes.userId, verifiedCandidate.id),
            columns: { id: true, isDefault: true },
          });
          resumeCountForCompletion = existingResumes.length;

          // Reuse already-extracted text instead of extracting again
          if (existingResumes.length < 3 && extractedResumeText) {
            const shouldBeDefault = !existingResumes.some((r: { isDefault: boolean }) => r.isDefault);
            const [resume] = await db
              .insert(candidateResumes)
              .values({
                userId: verifiedCandidate.id,
                label: req.file.originalname || 'Uploaded Resume',
                gcsPath: resumeUrl,
                extractedText: extractedResumeText,
                isDefault: shouldBeDefault,
              })
              .returning();
            resumeRecordId = resume.id;
            resumeCountForCompletion = existingResumes.length + 1;
          }
        } catch (resumeErr) {
          console.error('Resume save/extraction failed (non-blocking):', resumeErr);
        }
      }

      // Determine default pipeline stage for new applications (if stages are configured)
      let initialStageId: number | null = null;
      try {
        const stages = await storage.getPipelineStages(job.organizationId ?? null);
        const chosen = pickInitialPipelineStage(stages, job.organizationId ?? null);
        if (chosen) {
          initialStageId = chosen.id;
        }
      } catch (stageError) {
        console.error("Failed to load pipeline stages for default assignment:", stageError);
      }

      const now = new Date();

      // Application persistence and drip cancellation are one commit. A real
      // applicant can never be stored while their remaining outreach stays live.
      const application = await db.transaction(async (tx: any) => {
        const created = await storage.createApplication({
          ...applicationData,
          status: 'submitted',
          jobId,
          resumeUrl,
          resumeFilename,
          ...(resumeRecordId !== null && { resumeId: resumeRecordId }),
          ...(extractedResumeText && { extractedResumeText }),
          ...(verifiedCandidate && { userId: verifiedCandidate.id }),
          ...(initialStageId !== null && {
            currentStage: initialStageId,
            stageChangedAt: now,
            stageChangedBy: job.postedBy,
          }),
          ...(job.organizationId != null && { organizationId: job.organizationId }),
        }, tx);
        await matchApplicationToSourcedCandidate({
          applicationId: created.id,
          applicationEmail: created.email,
          jobId,
          organizationId: job.organizationId,
          appliedAt: created.appliedAt ?? now,
          outreachAttributionToken,
          executor: tx,
        });
        return created;
      });

      if (verifiedCandidate && resumeCountForCompletion !== null) {
        await syncProfileCompletionStatus(verifiedCandidate, { resumeCount: resumeCountForCompletion });
      }

      // Log initial stage assignment to history table (if a default stage was applied)
      if (initialStageId !== null) {
        await db.insert(applicationStageHistory).values({
          applicationId: application.id,
          fromStage: null,
          toStage: initialStageId,
          changedBy: job.postedBy,
          notes: "Initial stage assigned automatically at application submission",
        });
      }

      // Fire-and-forget: candidate confirmation via email and WhatsApp (if enabled)
      const autoNotifications = process.env.EMAIL_AUTOMATION_ENABLED === 'true' || process.env.EMAIL_AUTOMATION_ENABLED === '1' || process.env.NOTIFICATION_AUTOMATION_ENABLED === 'true';
      if (autoNotifications) {
        runPrivacyCheckedApplicationSideEffect(
          application.id,
          'candidate_notification',
          () => sendApplicationReceivedNotification(application.id),
        );
      }

      // Send notification email to all recruiters on this job (if enabled)
      try {
        const shouldNotifyRecruiter = await storage.isAutomationEnabled(
          'notify_recruiter_new_application',
          job.organizationId ?? undefined
        );
        if (shouldNotifyRecruiter) {
          runPrivacyCheckedApplicationSideEffect(
            application.id,
            'recruiter_notification',
            () => notifyRecruitersNewApplication(
              application.id,
              job.id,
              {
                name: application.name,
                email: application.email,
                phone: application.phone,
                coverLetter: application.coverLetter,
              },
              {
                title: job.title,
                location: job.location,
              },
            ),
          );
        }
      } catch (emailError) {
        console.error('Failed to send recruiter notification:', emailError);
      }

      // Enqueue ActiveKG graph sync job (non-blocking) — only if resume text is valid
      if (process.env.ACTIVEKG_SYNC_ENABLED === 'true' && application.organizationId) {
        const hasValidResumeText = extractedResumeText && extractedResumeText.trim().length >= MIN_RESUME_TEXT_LENGTH;
        if (hasValidResumeText) {
          try {
            const effectiveRecruiterId = job.postedBy;
            const tenantId = resolveActiveKGTenantId(application.organizationId);
            await storage.enqueueApplicationGraphSyncJob({
              applicationId: application.id,
              organizationId: application.organizationId,
              jobId: application.jobId,
              effectiveRecruiterId,
              activekgTenantId: tenantId,
            });
          } catch (syncErr) {
            console.error('[ACTIVEKG_SYNC] Failed to enqueue graph sync job (non-blocking):', {
              applicationId: application.id,
              jobId: application.jobId,
              organizationId: application.organizationId,
              error: syncErr instanceof Error ? syncErr.message : String(syncErr),
            });
          }
        } else {
          // Record why sync was skipped so it can be requeued after backfill
          storage.updateApplicationSyncSkippedReason(
            application.id,
            !extractedResumeText ? 'resume_text_missing' : 'resume_text_below_threshold'
          ).catch(err => console.error('[ACTIVEKG_SYNC] Failed to record skip reason:', err));
        }
      }

      res.status(201).json({
        success: true,
        message: 'Application submitted successfully',
        applicationId: application.id
      });
      return;
    } catch (error) {
      if (sendPrivacyRestriction(error, res)) return;
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
        return;
      } else {
        next(error);
      }
    }
  });

  // Recruiter adds candidate on behalf (MVP: Add Candidate feature)
  app.post(
    "/api/jobs/:id/applications/recruiter-add",
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    recruiterAddRateLimit,
    csrfProtection,
    upload.single('resume'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing ID parameter' });
          return;
        }
        const jobId = Number(idParam);
        if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
          res.status(400).json({ error: 'Invalid ID parameter' });
          return;
        }

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // Permission guard: Verify job access (primary recruiter, co-recruiter, or admin)
        const job = await storage.getJob(jobId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
        if (!hasAccess) {
          res.status(403).json({ error: 'Access denied: You can only add candidates to your own jobs' });
          return;
        }

        if (!req.file) {
          res.status(400).json({ error: 'Resume file is required' });
          return;
        }

        // Validate with dedicated schema
        const applicationData = recruiterAddApplicationSchema.parse(req.body);

        // Before duplicate disclosure, GCS, extraction or persistence.
        await requireApplicationIngestAllowed({
          email: applicationData.email,
          phone: applicationData.phone,
        });

        // Duplicate detection (case-insensitive email check)
        const existingApp = await storage.findApplicationByJobAndEmail(jobId, applicationData.email);

        if (existingApp) {
          res.status(400).json({
            error: 'Duplicate application',
            message: `An application from ${applicationData.email} already exists for this job`,
            existingApplicationId: existingApp.id
          });
          return;
        }

        // Upload resume
        let resumeUrl = '';
        try {
          await requireApplicationIngestAllowed({
            email: applicationData.email,
            phone: applicationData.phone,
          });
          resumeUrl = await uploadToGCS(req.file.buffer, req.file.originalname);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[RECRUITER_ADD] Resume upload failed:', {
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            error: message,
          });
          const isValidationError = message.toLowerCase().includes('invalid file format');
          res.status(isValidationError ? 400 : 503).json({
            error: isValidationError ? message : 'Resume upload failed. Please try again.',
          });
          return;
        }

        // Extract resume text for AI summary (recruiter-add has no candidateResumes record)
        let extractedResumeText: string | null = null;
        try {
          const extraction = await extractResumeText(req.file.buffer);
          if (extraction.success && validateResumeText(extraction.text)) {
            extractedResumeText = extraction.text;
          }
        } catch (resumeExtractError) {
          console.error('Resume extraction failed during recruiter-add (non-blocking):', resumeExtractError);
        }

        // Determine default pipeline stage for recruiter-added candidates (if stages are configured)
        let defaultStageId: number | null = null;
        try {
          const stages = await storage.getPipelineStages(job.organizationId ?? null);
          const chosen = pickInitialPipelineStage(stages, job.organizationId ?? null);
          if (chosen) {
            defaultStageId = chosen.id;
          }
        } catch (stageError) {
          console.error("Failed to load pipeline stages for recruiter-add default assignment:", stageError);
        }

        // Validate initial stage if provided, otherwise fall back to default (if available)
        let initialStage: number | null = null;
        if (applicationData.currentStage) {
          const stageWhere = job.organizationId != null
            ? and(eq(pipelineStages.id, applicationData.currentStage), eq(pipelineStages.organizationId, job.organizationId))
            : eq(pipelineStages.id, applicationData.currentStage);
          const stageExists = await db.query.pipelineStages.findFirst({
            where: stageWhere
          });

          if (!stageExists) {
            res.status(400).json({ error: 'Invalid stage ID' });
            return;
          }

          initialStage = applicationData.currentStage;
        } else if (defaultStageId !== null) {
          initialStage = defaultStageId;
        }

        // Create application with recruiter metadata
        const application = await storage.createApplication({
          name: applicationData.name,
          email: applicationData.email,
          phone: applicationData.phone,
          whatsappConsent: applicationData.whatsappConsent,
          ...(applicationData.coverLetter && { coverLetter: applicationData.coverLetter }),
          jobId,
          resumeUrl,
          resumeFilename: req.file.originalname,
          ...(extractedResumeText && { extractedResumeText }),
          submittedByRecruiter: true,
          createdByUserId: req.user!.id,
          source: applicationData.source,
          ...(applicationData.sourceMetadata && { sourceMetadata: applicationData.sourceMetadata }),
          ...(initialStage !== null && {
            currentStage: initialStage,
            stageChangedAt: new Date(),
            stageChangedBy: req.user!.id,
          }),
          ...(job.organizationId != null && { organizationId: job.organizationId }),
        });
        await matchApplicationToSourcedCandidate({
          applicationId: application.id,
          applicationEmail: application.email,
          jobId,
          organizationId: job.organizationId,
          appliedAt: application.appliedAt ?? new Date(),
        });

        // Log initial stage assignment to history table
        if (initialStage) {
          await db.insert(applicationStageHistory).values({
            applicationId: application.id,
            fromStage: null,
            toStage: initialStage,
            changedBy: req.user!.id,
            notes: 'Initial stage assigned by recruiter during candidate addition',
          });
        }

        // Audit log (simple console log for MVP)
        console.log('[RECRUITER_ADD]', {
          applicationId: application.id,
          recruiterId: req.user!.id,
          jobId,
          source: applicationData.source,
          timestamp: new Date().toISOString()
        });

        // Enqueue ActiveKG graph sync job (non-blocking) — only if resume text is valid
        if (process.env.ACTIVEKG_SYNC_ENABLED === 'true' && application.organizationId) {
          const hasValidResumeText = extractedResumeText && extractedResumeText.trim().length >= MIN_RESUME_TEXT_LENGTH;
          if (hasValidResumeText) {
            try {
              const effectiveRecruiterId = req.user!.id;
              const tenantId = resolveActiveKGTenantId(application.organizationId);
              await storage.enqueueApplicationGraphSyncJob({
                applicationId: application.id,
                organizationId: application.organizationId,
                jobId: application.jobId,
                effectiveRecruiterId,
                activekgTenantId: tenantId,
              });
            } catch (syncErr) {
              console.error('[ACTIVEKG_SYNC] Failed to enqueue graph sync job (non-blocking):', {
                applicationId: application.id,
                jobId: application.jobId,
                organizationId: application.organizationId,
                error: syncErr instanceof Error ? syncErr.message : String(syncErr),
              });
            }
          } else {
            // Record why sync was skipped so it can be requeued after backfill
            storage.updateApplicationSyncSkippedReason(
              application.id,
              !extractedResumeText ? 'resume_text_missing' : 'resume_text_below_threshold'
            ).catch(err => console.error('[ACTIVEKG_SYNC] Failed to record skip reason:', err));
          }
        }

        res.status(201).json({
          success: true,
          message: 'Candidate added successfully',
          applicationId: application.id,
        });
        return;
      } catch (error) {
        if (sendPrivacyRestriction(error, res)) return;
        if (error instanceof z.ZodError) {
          res.status(400).json({
            error: 'Validation error',
            details: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message
            }))
          });
          return;
        }
        next(error);
      }
    }
  );

  // ====== ATS: Bulk interview scheduling ======
  app.patch(
    "/api/applications/bulk/interview",
    csrfProtection,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const bodySchema = z.object({
          applicationIds: z.array(z.number().int().positive()).min(1),
          start: z.string(),
          intervalHours: z.number().min(0).max(24).default(0),
          location: z.string().min(1),
          timeRangeLabel: z.string().optional(),
          notes: z.string().optional(),
          stageId: z.number().int().positive().optional(),
        });

        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Validation error",
            details: parsed.error.errors,
          });
          return;
        }

        const data = parsed.data as z.infer<typeof bodySchema>;
        const {
          applicationIds,
          start,
          intervalHours,
          location,
          timeRangeLabel,
          notes,
          stageId,
        } = data;

        // Normalize base start date
        let baseDate: Date | undefined;
        if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
          baseDate = new Date(`${start}T00:00:00Z`);
        } else {
          const parsedStart = new Date(start);
          if (!isNaN(parsedStart.getTime())) {
            baseDate = parsedStart;
          }
        }

        if (!baseDate) {
          res.status(400).json({ error: "Invalid start datetime" });
          return;
        }

        const results: { id: number; success: boolean; error?: string }[] = [];

        const orgResult = await getUserOrganization(req.user!.id);
        const organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : orgResult?.organization.id;

        // Preload pipeline stages and map stageId -> order
        let stageOrderMap = new Map<number, number>();
        let targetStageOrder: number | null = null;
        const targetStageId = stageId ?? null;
        if (targetStageId !== null) {
          const stages = await storage.getPipelineStages(organizationId, req.user!.id);
          stageOrderMap = new Map(stages.map((s) => [s.id, s.order ?? 0]));
          targetStageOrder = stageOrderMap.get(targetStageId) ?? null;
        }

        for (let index = 0; index < applicationIds.length; index++) {
          const appId = Number(applicationIds[index]);
          try {
            const offsetMs = intervalHours * 60 * 60 * 1000 * index;
            const slotDate = new Date(baseDate.getTime() + offsetMs);

            // Persist interview details
            const interviewFields: { date?: Date; time?: string; location?: string; notes?: string } = {
              date: slotDate,
              location,
            };
            if (typeof timeRangeLabel === "string" && timeRangeLabel.length > 0) {
              interviewFields.time = timeRangeLabel;
            }
            if (typeof notes === "string" && notes.length > 0) {
              interviewFields.notes = notes;
            }

            // Get current stage order for comparison (if stage update is needed)
            let stageUpdateParams: { targetStageId: number; changedBy: number; notes?: string; currentStageOrder: number | null; targetStageOrder: number } | undefined;
            if (targetStageId !== null && targetStageOrder !== null) {
              const appRecord = await storage.getApplication(appId);
              const currentStageId = appRecord?.currentStage ?? null;
              const currentOrder = currentStageId !== null ? stageOrderMap.get(currentStageId) ?? null : null;

              stageUpdateParams = {
                targetStageId,
                changedBy: req.user!.id,
                currentStageOrder: currentOrder,
                targetStageOrder,
              };
              // Only add notes if defined (exactOptionalPropertyTypes compatibility)
              if (notes !== undefined) {
                stageUpdateParams.notes = notes;
              }
            }

            // Use atomic method for interview + stage update (prevents partial state)
            await storage.scheduleInterviewWithStage(appId, interviewFields, stageUpdateParams);

            // Fire-and-forget interview invite via email and WhatsApp (if automation enabled)
            const autoNotifications = process.env.EMAIL_AUTOMATION_ENABLED === "true" || process.env.EMAIL_AUTOMATION_ENABLED === "1" || process.env.NOTIFICATION_AUTOMATION_ENABLED === "true";
            if (autoNotifications) {
              const dateStr = slotDate.toISOString();
              const timeLabel = timeRangeLabel ?? "";
              runPrivacyCheckedApplicationSideEffect(
                appId,
                'bulk_interview_notification',
                () => sendInterviewInvitationNotification(appId, {
                  date: dateStr,
                  time: timeLabel,
                  location,
                }),
              );
            }

            results.push({ id: appId, success: true });
          } catch (err: any) {
            console.error("Bulk interview scheduling error:", err);
            results.push({
              id: appId,
              success: false,
              error: err?.message ?? "Unknown error",
            });
          }
        }

        const scheduledCount = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success);

        res.json({
          total: applicationIds.length,
          scheduledCount,
          failedCount: failed.length,
          failed,
        });
        return;
      } catch (error) {
        next(error);
      }
    }
  );

  // Get applications for a specific job (recruiters only) - with org verification
  app.get("/api/jobs/:id/applications", requireRole(['recruiter', 'super_admin']), requireSeat({ allowNoOrg: true }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const jobId = Number(idParam);
      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      // Verify user has access to this job (org isolation)
      const orgResult = await getUserOrganization(req.user!.id);
      const userOrgId = orgResult?.organization.id;
      const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);

      if (!hasAccess && req.user!.role !== 'super_admin') {
        res.status(403).json({ error: 'Access denied: you do not have access to this job' });
        return;
      }

      const applicationsList = await storage.getApplicationsByJob(jobId);

      const job = await storage.getJob(jobId);
      if (job?.organizationId != null) {
        const stageIds = Array.from(new Set(
          applicationsList
            .map((app) => app.currentStage)
            .filter((stageId): stageId is number => typeof stageId === 'number')
        ));

        if (stageIds.length > 0) {
          const orgStages = await storage.getPipelineStages(job.organizationId);
          const orgStageIds = new Set(orgStages.map((stage) => stage.id));
          const missingStageIds = stageIds.filter((stageId) => !orgStageIds.has(stageId));

          if (missingStageIds.length > 0) {
            console.warn('[Pipeline Guardrail] Applications reference stages missing from org pipeline stages', {
              jobId,
              organizationId: job.organizationId,
              userId: req.user!.id,
              missingStageIds,
              totalStages: orgStages.length,
            });
          }
        }
      }

      // Get client feedback counts for all applications
      const appIds = applicationsList.map(app => app.id);
      const feedbackCounts = await storage.getClientFeedbackCountsByApplicationIds(appIds);

      // Merge feedback counts into applications
      const applicationsWithFeedback = applicationsList.map(app => ({
        ...app,
        clientFeedbackCount: feedbackCounts[app.id] || 0,
      }));

      res.json(applicationsWithFeedback);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Hiring manager: get applications for a job they own
  app.get("/api/hiring-manager/jobs/:id/applications", requireRole(['hiring_manager']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const jobId = Number(idParam);
      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      const job = await storage.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      if (job.hiringManagerId !== req.user!.id) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const applicationsList = await storage.getApplicationsByJob(jobId);
      if (applicationsList.length === 0) {
        res.json([]);
        return;
      }

      const applicationIds = applicationsList.map((application) => application.id);
      const feedbackRows = await db
        .select({
          applicationId: applicationFeedback.applicationId,
          count: sql<number>`count(*)::int`,
        })
        .from(applicationFeedback)
        .where(
          and(
            inArray(applicationFeedback.applicationId, applicationIds),
            eq(applicationFeedback.authorId, req.user!.id),
          )
        )
        .groupBy(applicationFeedback.applicationId);

      const feedbackCounts = feedbackRows.reduce((acc: Record<number, number>, row: typeof feedbackRows[number]) => {
        acc[row.applicationId] = row.count;
        return acc;
      }, {});

      const applicationsWithFeedback = applicationsList.map((application) => ({
        ...application,
        hmFeedbackCount: feedbackCounts[application.id] ?? 0,
      })).sort((left, right) => {
        const leftRequestedAt = left.hmReviewRequestedAt ? new Date(left.hmReviewRequestedAt).getTime() : 0;
        const rightRequestedAt = right.hmReviewRequestedAt ? new Date(right.hmReviewRequestedAt).getTime() : 0;

        if (leftRequestedAt !== rightRequestedAt) {
          return rightRequestedAt - leftRequestedAt;
        }

        return new Date(right.appliedAt).getTime() - new Date(left.appliedAt).getTime();
      });

      res.json(applicationsWithFeedback);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get AI-suggested similar candidates from other jobs
  app.get("/api/jobs/:id/ai-similar-candidates", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }

      const jobId = Number(idParam);
      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: 'Invalid job ID' });
        return;
      }

      const minFitScore = req.query.minFitScore
        ? parseInt(String(req.query.minFitScore), 10)
        : undefined;
      const limit = req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : undefined;

      const recruiterId = req.user!.id;

      const options: { minFitScore?: number; limit?: number } = {};
      if (typeof minFitScore === "number" && !Number.isNaN(minFitScore)) {
        options.minFitScore = minFitScore;
      }
      if (typeof limit === "number" && !Number.isNaN(limit)) {
        options.limit = limit;
      }

      const candidates = await storage.getSimilarCandidatesForJob(jobId, recruiterId, options);

      res.json(candidates);
      return;
    } catch (error) {
      console.error('[Similar Candidates] Error fetching similar candidates:', error);
      next(error);
    }
  });

  // Secure resume download via permission-gated redirect
  app.get("/api/applications/:id/resume", requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const applicationId = Number(idParam);
      if (!Number.isFinite(applicationId) || applicationId <= 0 || !Number.isInteger(applicationId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      const appRecord = await storage.getApplication(applicationId);
      if (!appRecord) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }

      // Permission checks
      const role = req.user!.role;
      if (role === 'super_admin') {
        // allowed
      } else if (role === 'recruiter') {
        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;
        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = await storage.isRecruiterOnJob(appRecord.jobId, req.user!.id, userOrgId);
        if (!hasAccess) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }
        await storage.markApplicationDownloaded(applicationId);
      } else if (role === 'hiring_manager') {
        const access = await ensureHiringManagerOwnsApplication(req.user!.id, applicationId);
        if (!access.ok) {
          res.status(access.status).json({ error: access.error });
          return;
        }
        await storage.markApplicationDownloaded(applicationId);
      } else if (role === 'candidate') {
        if (!appRecord.userId || appRecord.userId !== req.user!.id) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }
      } else {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const url = appRecord.resumeUrl;
      if (!url) {
        res.status(404).json({ error: 'Resume not available' });
        return;
      }

      // Stream PDF through server to allow iframe embedding (avoids GCS X-Frame-Options)
      if (url.startsWith('gs://')) {
        try {
          const buffer = await downloadFromGCS(url);
          const filename = appRecord.resumeFilename || 'resume.pdf';
          const ext = filename.split('.').pop()?.toLowerCase() || 'pdf';
          const contentType =
            ext === 'pdf'
              ? 'application/pdf'
              : ext === 'docx'
                ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : ext === 'doc'
                  ? 'application/msword'
                  : 'application/octet-stream';
          const downloadParam = req.query.download;
          const forceDownload = downloadParam === '1' || downloadParam === 'true';
          const disposition = forceDownload || ext !== 'pdf' ? 'attachment' : 'inline';

          // Allow embedding in iframes from same origin only (security fix)
          res.setHeader('X-Frame-Options', 'SAMEORIGIN');
          res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
          res.setHeader('Content-Length', buffer.length);
          res.send(buffer);
          return;
        } catch (gcsError) {
          console.error('[Resume] GCS download failed:', gcsError);
          res.status(500).json({ error: 'Failed to retrieve resume' });
          return;
        }
      } else if (/^https?:\/\//i.test(url)) {
        // External URL - redirect (can't proxy arbitrary URLs)
        res.redirect(302, url);
        return;
      } else {
        res.status(404).json({ error: 'Resume not available' });
        return;
      }
    } catch (error) {
      next(error);
    }
  });

  // ============= PIPELINE MANAGEMENT ROUTES =============

  // Get pipeline stages - filtered by organization
  app.get("/api/pipeline/stages", requireAuth, requireRole(['recruiter', 'super_admin']), requireSeat({ allowNoOrg: true }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgResult = await getUserOrganization(req.user!.id);
      let organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : (orgResult?.organization.id ?? null);
      const orgIdParam = req.query.orgId;
      if (orgIdParam !== undefined) {
        if (req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Super admin access required' });
          return;
        }
        // Accept 'none' or 'null' to explicitly request default stages
        if (orgIdParam === 'none' || orgIdParam === 'null') {
          organizationId = null;
        } else {
          const parsedOrgId = Number(orgIdParam);
          if (!Number.isFinite(parsedOrgId) || parsedOrgId <= 0 || !Number.isInteger(parsedOrgId)) {
            res.status(400).json({ error: 'Invalid orgId' });
            return;
          }
          organizationId = parsedOrgId;
        }
      }
      const stages = await storage.getPipelineStages(organizationId, req.user!.id);
      res.json(stages);
      return;
    } catch (e) { next(e); }
  });

  // Create pipeline stage (recruiters/admin) - requires seat
  app.post("/api/pipeline/stages", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = orgResult?.organization.id;

      const body = insertPipelineStageSchema.parse(req.body);
      const existingStages = await storage.getPipelineStages(organizationId ?? null, req.user!.id);
      const normalizedName = normalizeStageName(body.name);
      const duplicateStage = existingStages.find((stage) => normalizeStageName(stage.name) === normalizedName);
      if (duplicateStage) {
        res.status(409).json({ error: 'Stage name already exists', stageId: duplicateStage.id });
        return;
      }
      const stage = await storage.createPipelineStage({
        ...body,
        createdBy: req.user!.id,
        ...(organizationId != null && { organizationId }),
      });
      res.status(201).json(stage);
      return;
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: e.errors });
        return;
      }
      next(e);
    }
  });

  // Update pipeline stage (recruiters or admin) - requires seat
  app.patch("/api/pipeline/stages/:id", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing stage ID parameter' });
        return;
      }
      const stageId = parseInt(idParam, 10);
      if (isNaN(stageId) || stageId <= 0) {
        res.status(400).json({ error: 'Invalid stage ID' });
        return;
      }

      const updateSchema = z.object({
        name: z.string().min(1).max(50).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        order: z.number().int().min(0).optional(),
      });

      const validation = updateSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation error', details: validation.error.errors });
        return;
      }

      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : orgResult?.organization.id;

      // Verify stage exists within org
      const stage = await storage.getPipelineStage(stageId, organizationId);
      if (!stage) {
        res.status(404).json({ error: 'Stage not found' });
        return;
      }

      if (validation.data.name !== undefined) {
        const existingStages = await storage.getPipelineStages(organizationId ?? null, req.user!.id);
        const normalizedName = normalizeStageName(validation.data.name);
        const duplicateStage = existingStages.find(
          (candidate) => candidate.id !== stageId && normalizeStageName(candidate.name) === normalizedName
        );
        if (duplicateStage) {
          res.status(409).json({ error: 'Stage name already exists', stageId: duplicateStage.id });
          return;
        }
      }

      // Build update object without undefined values.
      const updateData: { name?: string; color?: string | null; order?: number } = {};
      if (validation.data.name !== undefined) updateData.name = validation.data.name;
      if (validation.data.color !== undefined) updateData.color = validation.data.color;
      if (validation.data.order !== undefined) updateData.order = validation.data.order;

      const updated = await storage.updatePipelineStage(stageId, updateData, organizationId);
      res.json(updated);
      return;
    } catch (e) {
      next(e);
    }
  });

  // Delete pipeline stage (recruiters or admin) - requires seat
  app.delete("/api/pipeline/stages/:id", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing stage ID parameter' });
        return;
      }
      const stageId = parseInt(idParam, 10);
      if (isNaN(stageId) || stageId <= 0) {
        res.status(400).json({ error: 'Invalid stage ID' });
        return;
      }

      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : orgResult?.organization.id;

      // Verify stage exists within org
      const stage = await storage.getPipelineStage(stageId, organizationId);
      if (!stage) {
        res.status(404).json({ error: 'Stage not found' });
        return;
      }

      // Stages are global - all recruiters can delete (but check for applications first)

      // Check if stage has applications
      const appsInStage = await storage.getApplicationsInStage(stageId);
      if (appsInStage.length > 0) {
        res.status(400).json({
          error: 'Cannot delete stage with applications. Move applications first.',
          applicationCount: appsInStage.length
        });
        return;
      }

      await storage.deletePipelineStage(stageId, organizationId);
      res.status(204).send();
      return;
    } catch (e) {
      next(e);
    }
  });

  // Move application to a new stage
  app.patch("/api/applications/:id/stage", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      const validation = updateStageSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation error',
          details: validation.error.errors
        });
        return;
      }

      const { stageId, notes } = validation.data;

      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : orgResult?.organization.id;
      const stages = await storage.getPipelineStages(organizationId, req.user!.id);
      const targetStage = stages.find(s => s.id === stageId);
      if (!targetStage) {
        res.status(400).json({ error: `Invalid stage ID: ${stageId}` });
        return;
      }

      await storage.updateApplicationStage(appId, stageId, req.user!.id, notes);

      // Fire-and-forget: automated status notification via email and WhatsApp (if enabled)
      const autoNotifications = process.env.EMAIL_AUTOMATION_ENABLED === 'true' || process.env.EMAIL_AUTOMATION_ENABLED === '1' || process.env.NOTIFICATION_AUTOMATION_ENABLED === 'true';
      if (autoNotifications && targetStage.name) {
        const stageName = targetStage.name.toLowerCase();
        if (stageName.includes('offer') || stageName.includes('hired')) {
          runPrivacyCheckedApplicationSideEffect(appId, 'offer_notification', () => sendOfferNotification(appId));
        } else if (stageName.includes('reject')) {
          runPrivacyCheckedApplicationSideEffect(appId, 'rejection_notification', () => sendRejectionNotification(appId));
        } else {
          runPrivacyCheckedApplicationSideEffect(
            appId,
            'status_notification',
            () => sendStatusUpdateNotification(appId, targetStage.name),
          );
        }
      }

      res.json({ success: true });
      return;
    } catch (e) { next(e); }
  });

  // Get application stage history
  app.get("/api/applications/:id/history", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }
      const hist = await storage.getApplicationStageHistory(appId);
      res.json(hist);
      return;
    } catch (e) { next(e); }
  });

  // ============= INTERVIEW MANAGEMENT ROUTES =============

  // Download interview calendar invite (ICS file)
  app.get("/api/applications/:id/interview/ics", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      const application = await storage.getApplication(appId);
      if (!application) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }

      const job = await storage.getJob(application.jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      if (!application.interviewDate || !application.interviewTime) {
        res.status(400).json({
          error: 'Interview not scheduled',
          message: 'Interview date and time must be set before generating calendar invite'
        });
        return;
      }

      const recruiter = req.user;
      const interviewDateString = new Date(application.interviewDate).toISOString().slice(0, 10);

      const interviewDetails: any = {
        candidateName: application.name,
        candidateEmail: application.email,
        jobTitle: job.title,
        interviewDate: interviewDateString,
        interviewTime: application.interviewTime,
        interviewLocation: application.interviewLocation || 'TBD',
      };

      if (recruiter?.firstName) {
        interviewDetails.recruiterName = `${recruiter.firstName} ${recruiter.lastName || ''}`.trim();
      }
      if (recruiter?.username) {
        interviewDetails.recruiterEmail = recruiter.username;
      }
      if (application.interviewNotes) {
        interviewDetails.notes = application.interviewNotes;
      }

      const icsContent = generateInterviewICS(interviewDetails);
      const filename = getICSFilename(job.title, application.name);

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(icsContent);
      return;
    } catch (error) {
      console.error('[ICS Download] Error:', error);
      next(error);
    }
  });

  // Schedule interview
  app.patch("/api/applications/:id/interview", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      const payload = {
        date: typeof req.body?.date === 'string' && req.body.date.trim() !== '' ? req.body.date.trim() : undefined,
        time: typeof req.body?.time === 'string' && req.body.time.trim() !== '' ? req.body.time.trim() : undefined,
        location: typeof req.body?.location === 'string' && req.body.location.trim() !== '' ? req.body.location.trim() : undefined,
        notes: typeof req.body?.notes === 'string' && req.body.notes.trim() !== '' ? req.body.notes.trim() : undefined,
      };

      const validation = scheduleInterviewSchema.safeParse(payload);
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation error',
          details: validation.error.errors
        });
        return;
      }

      let { date, time, location, notes } = validation.data;
      let ts: Date | undefined = undefined;
      if (date) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          ts = new Date(`${date}T00:00:00Z`);
        } else {
          const parsed = new Date(date);
          if (!isNaN(parsed.getTime())) ts = parsed;
        }
      }
      const updated = await storage.scheduleInterview(appId, {
        ...(ts !== undefined && { date: ts }),
        ...(time !== undefined && { time }),
        ...(location !== undefined && { location }),
        ...(notes !== undefined && { notes })
      });

      const autoNotifications = process.env.EMAIL_AUTOMATION_ENABLED === 'true' || process.env.EMAIL_AUTOMATION_ENABLED === '1' || process.env.NOTIFICATION_AUTOMATION_ENABLED === 'true';
      if (autoNotifications && date && time && location) {
        runPrivacyCheckedApplicationSideEffect(
          appId,
          'interview_notification',
          () => sendInterviewInvitationNotification(appId, { date, time, location }),
        );
      }

      res.json(updated);
      return;
    } catch (e) { next(e); }
  });

  // ============= APPLICATION NOTES, RATING, EMAIL HISTORY =============

  // Get email history for an application
  app.get("/api/applications/:id/email-history", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const applicationId = Number(idParam);
      if (!Number.isFinite(applicationId) || applicationId <= 0 || !Number.isInteger(applicationId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      const application = await storage.getApplication(applicationId);
      if (!application) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }

      const emailHistory = await storage.getApplicationEmailHistory(applicationId);
      res.json(emailHistory);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Add recruiter note
  app.post("/api/applications/:id/notes", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }
      const { note } = req.body;
      if (!note) {
        res.status(400).json({ error: 'note required' });
        return;
      }
      const updated = await storage.addRecruiterNote(appId, note);
      res.json(updated);
      return;
    } catch (e) { next(e); }
  });

  // Set rating
  app.patch("/api/applications/:id/rating", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }
      const { rating } = req.body;
      if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        res.status(400).json({ error: 'rating 1-5' });
        return;
      }
      const updated = await storage.setApplicationRating(appId, rating);
      res.json(updated);
      return;
    } catch (e) { next(e); }
  });

  // ============= AI SUMMARY =============

  // Generate AI candidate summary - requires seat and AI feature access
  app.post("/api/applications/:id/ai-summary", aiAnalysisRateLimit, requireRole(['recruiter', 'super_admin']), requireSeat(), requireFeatureAccess(FEATURES.AI_CONTENT), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check AI credits for recruiters
      if (req.user!.role === 'recruiter') {
        const creditCheck = await hasEnoughCredits(req.user!.id, 1);
        if (!creditCheck) {
          res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, 1));
          return;
        }
      }

      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      if (!isAIEnabled()) {
        res.status(503).json({
          error: 'AI features not available',
          message: 'AI summary generation is currently unavailable'
        });
        return;
      }

      const application = await storage.getApplication(appId);
      if (!application) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }

      const job = await storage.getJob(application.jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      let resumeText = '';

      if (application.extractedResumeText) {
        resumeText = application.extractedResumeText;
      } else if (application.resumeId) {
        const resumeData = await db.query.candidateResumes.findFirst({
          where: eq(candidateResumes.id, application.resumeId)
        });
        resumeText = resumeData?.extractedText || '';
      }

      if (!resumeText && application.resumeUrl && application.resumeUrl.startsWith('gs://')) {
        try {
          await requireCandidatePrivacyAllowed(
            { type: 'application', id: appId },
            { globalUse: false },
          );
          const buffer = await downloadFromGCS(application.resumeUrl);
          const extraction = await extractResumeText(buffer);
          if (extraction.success && validateResumeText(extraction.text)) {
            resumeText = extraction.text;
          }
        } catch (err) {
          console.error('[AI Summary] Resume download/extract failed:', err);
        }
      }

      // Prefer resume text, fall back to cover letter only (not job description - that's not candidate content)
      const effectiveText = resumeText || application.coverLetter || '';

      if (!effectiveText) {
        res.status(400).json({
          error: 'No candidate content available',
          message: 'We could not find any candidate text to summarize. Please ensure a resume or cover letter is available for this application.',
        });
        return;
      }

      const startTime = Date.now();
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: appId },
        { globalUse: false },
      );
      const summaryResult = await generateCandidateSummary(
        effectiveText,
        job.title,
        job.description,
        application.name,
        job.skills || [],
        job.goodToHaveSkills || []
      );
      const durationMs = Date.now() - startTime;

      const costUsd = calculateAiCost(summaryResult.tokensUsed.input, summaryResult.tokensUsed.output);

      await requireCandidatePrivacyAllowed(
        { type: 'application', id: appId },
        { globalUse: false },
      );
      await db
        .update(applications)
        .set({
          aiSummary: summaryResult.summary,
          aiSummaryVersion: 1,
          aiSuggestedAction: summaryResult.suggestedAction,
          aiSuggestedActionReason: summaryResult.suggestedActionReason,
          aiSummaryComputedAt: new Date(),
          aiSummaryModelVersion: summaryResult.model_version,
          aiStrengths: summaryResult.strengths,
          aiConcerns: summaryResult.concerns,
          aiKeyHighlights: summaryResult.keyHighlights,
          // Skill analysis fields
          aiRequiredSkillsMatched: summaryResult.requiredSkillsMatched,
          aiRequiredSkillsMissing: summaryResult.requiredSkillsMissing,
          aiRequiredSkillsMatchPercentage: summaryResult.requiredSkillsMatchPercentage,
          aiRequiredSkillsDepthNotes: summaryResult.requiredSkillsDepthNotes,
          aiGoodToHaveSkillsMatched: summaryResult.goodToHaveSkillsMatched,
          aiGoodToHaveSkillsMissing: summaryResult.goodToHaveSkillsMissing,
        })
        .where(eq(applications.id, appId));

      await db.insert(userAiUsage).values({
        organizationId: job.organizationId ?? undefined,
        userId: req.user!.id,
        kind: 'summary',
        tokensIn: summaryResult.tokensUsed.input,
        tokensOut: summaryResult.tokensUsed.output,
        costUsd,
        metadata: {
          applicationId: appId,
          durationMs,
          jobTitle: job.title,
          candidateName: application.name,
        },
      });

      // Deduct credit for recruiters after successful generation
      if (req.user!.role === 'recruiter') {
        await useCredits(req.user!.id, 1);
      }

      res.json({
        message: 'AI summary generated successfully',
        summary: {
          text: summaryResult.summary,
          suggestedAction: summaryResult.suggestedAction,
          suggestedActionReason: summaryResult.suggestedActionReason,
          strengths: summaryResult.strengths,
          concerns: summaryResult.concerns,
          keyHighlights: summaryResult.keyHighlights,
          // Skill analysis
          requiredSkillsMatched: summaryResult.requiredSkillsMatched,
          requiredSkillsMissing: summaryResult.requiredSkillsMissing,
          requiredSkillsMatchPercentage: summaryResult.requiredSkillsMatchPercentage,
          requiredSkillsDepthNotes: summaryResult.requiredSkillsDepthNotes,
          goodToHaveSkillsMatched: summaryResult.goodToHaveSkillsMatched,
          goodToHaveSkillsMissing: summaryResult.goodToHaveSkillsMissing,
          modelVersion: summaryResult.model_version,
          computedAt: new Date(),
          cost: parseFloat(costUsd),
          durationMs,
        }
      });
      return;
    } catch (error) {
      if (error instanceof CandidatePrivacyRestrictedError) {
        res.status(503).json({ code: error.code });
        return;
      }
      console.error('[AI Summary] Error:', error);
      if (error instanceof Error) {
        res.status(500).json({
          error: 'AI summary generation failed',
          message: error.message
        });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
      return;
    }
  });

  // ============= BULK AI SUMMARY GENERATION =============

  // Environment configuration for AI summary limits
  // Note: Daily limit is now plan-specific - see getUserDailyRateLimit()
  const AI_SUMMARY_BATCH_MAX = parseInt(process.env.AI_SUMMARY_BATCH_MAX || '50', 10);
  const AI_QUEUE_ENABLED = process.env.AI_QUEUE_ENABLED === 'true';

  /**
   * GET /api/ai/summary/limit-status
   * Returns the recruiter's daily AI summary usage limits (plan-specific)
   */
  app.get(
    "/api/ai/summary/limit-status",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user!.id;

        // Get plan-specific daily limit
        const dailyLimit = await getUserDailyRateLimit(userId);

        // Get start of current day (local time)
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        // Count AI summary usage today
        const dailyUsage = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(userAiUsage)
          .where(
            and(
              eq(userAiUsage.userId, userId),
              eq(userAiUsage.kind, 'summary'),
              sql`${userAiUsage.computedAt} >= ${startOfDay}`,
              sql`${userAiUsage.computedAt} < ${endOfDay}`
            )
          );

        const dailyUsed = dailyUsage[0]?.count || 0;
        const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);

        // Check circuit breaker status (includes AI enabled + budget check)
        const circuitBreaker = await checkCircuitBreaker();
        const budgetAllowed = isAIEnabled() && circuitBreaker.allowed;

        // Effective remaining is the minimum of daily remaining and budget
        const effectiveRemaining = budgetAllowed ? dailyRemaining : 0;

        res.json({
          dailyLimit,
          dailyUsed,
          dailyRemaining,
          dailyResetAt: endOfDay.toISOString(),
          budgetAllowed,
          budgetSpent: circuitBreaker.dailySpent,
          budgetLimit: circuitBreaker.dailyBudget,
          effectiveRemaining,
          maxBatchSize: AI_SUMMARY_BATCH_MAX,
        });
      } catch (error) {
        console.error('[AI Summary Limit Status] Error:', error);
        next(error);
      }
    }
  );

  /**
   * POST /api/applications/bulk/ai-summary/queue
   * Queue bulk AI summary generation for selected applications
   */
  app.post(
    "/api/applications/bulk/ai-summary/queue",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    requireFeatureAccess(FEATURES.AI_CONTENT),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user!.id;
        // Get user's organization for access control
        const orgResult = await getUserOrganization(userId);
        const userOrgId = orgResult?.organization.id;

        // Validate request body
        const bodySchema = z.object({
          applicationIds: z.array(z.number().int().positive()).min(1),
          regenerate: z.boolean().optional().default(false),
        });

        const validation = bodySchema.safeParse(req.body);
        if (!validation.success) {
          res.status(400).json({
            error: 'Validation error',
            details: validation.error.errors,
          });
          return;
        }

        let { applicationIds, regenerate } = validation.data;
        applicationIds = [...new Set(applicationIds)]; // Deduplicate

        // Check max batch size
        if (applicationIds.length > AI_SUMMARY_BATCH_MAX) {
          res.status(400).json({
            error: `Please select ${AI_SUMMARY_BATCH_MAX} or fewer candidates.`,
            errorCode: 'MAX_EXCEEDED',
            max: AI_SUMMARY_BATCH_MAX,
            selected: applicationIds.length,
          });
          return;
        }

        // Check if queue is available
        if (!AI_QUEUE_ENABLED || !isQueueAvailable()) {
          res.status(503).json({
            error: 'Queue service unavailable. Please try again later.',
            errorCode: 'QUEUE_UNAVAILABLE',
          });
          return;
        }

        // Check AI service availability and circuit breaker
        if (!isAIEnabled()) {
          res.status(503).json({
            error: 'AI service is temporarily unavailable.',
            errorCode: 'AI_UNAVAILABLE',
          });
          return;
        }

        // Check circuit breaker (budget check)
        const circuitBreaker = await checkCircuitBreaker();
        if (!circuitBreaker.allowed) {
          res.status(503).json({
            error: 'AI service budget exhausted. Please try again tomorrow.',
            errorCode: 'BUDGET_EXHAUSTED',
            budgetSpent: circuitBreaker.dailySpent,
            budgetLimit: circuitBreaker.dailyBudget,
          });
          return;
        }

        // Get plan-specific daily limit
        const dailyLimit = await getUserDailyRateLimit(userId);

        // Get daily usage to check rate limit (local day)
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const dailyUsage = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(userAiUsage)
          .where(
            and(
              eq(userAiUsage.userId, userId),
              eq(userAiUsage.kind, 'summary'),
              sql`${userAiUsage.computedAt} >= ${startOfDay}`,
              sql`${userAiUsage.computedAt} < ${endOfDay}`
            )
          );

        const dailyUsed = dailyUsage[0]?.count || 0;
        const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);

        // Fetch applications and check ownership (recruiter must own the job)
        const apps = await db.query.applications.findMany({
          where: inArray(applications.id, applicationIds),
          with: { job: true },
        });

        // Filter to applications the recruiter has access to
        type AppWithJob = typeof apps[number];
        const accessibleApps: AppWithJob[] = [];
        for (const app of apps) {
          const hasAccess = await storage.isRecruiterOnJob(app.jobId, userId, userOrgId);
          if (hasAccess) {
            try {
              await requireCandidatePrivacyAllowed(
                { type: 'application', id: app.id },
                { globalUse: false },
              );
            } catch (error) {
              if (error instanceof CandidatePrivacyRestrictedError) continue;
              throw error;
            }
            accessibleApps.push(app);
          }
        }

        if (accessibleApps.length === 0) {
          res.status(404).json({ error: 'No accessible applications found' });
          return;
        }

        // Filter to applications that need summaries (unless regenerate is true)
        const appsNeedingSummary = regenerate
          ? accessibleApps
          : accessibleApps.filter((app: AppWithJob) => !app.aiSummary);

        // If all already have summaries and regenerate is false
        if (appsNeedingSummary.length === 0) {
          res.status(200).json({
            cached: true,
            message: 'All selected candidates already have AI summaries.',
            totalCount: 0,
          });
          return;
        }

        // Check AI credits for recruiters before queueing
        if (req.user!.role === 'recruiter') {
          const creditsPerSummary = getCreditCostForOperation('summary');
          const requiredCredits = appsNeedingSummary.length * creditsPerSummary;
          const creditCheck = await hasEnoughCredits(userId, requiredCredits);
          if (!creditCheck) {
            res.status(403).json(await getAiCreditExhaustionPayload(userId, requiredCredits));
            return;
          }
        }

        // Check rate limit against applications needing summaries
        if (appsNeedingSummary.length > dailyRemaining) {
          res.status(403).json({
            error: `You have only ${dailyRemaining} analyses left today. Select fewer candidates.`,
            errorCode: 'RATE_LIMIT_EXCEEDED',
            remaining: dailyRemaining,
            requested: appsNeedingSummary.length,
          });
          return;
        }

        // Check for existing pending job
        const pendingJobs = await storage.getUserAiFitJobs(userId, ['pending', 'active']);
        const pendingSummaryJob = pendingJobs.find(j => j.queueName === QUEUES.BATCH && j.bullJobId.startsWith('summary-'));
        if (pendingSummaryJob) {
          res.status(429).json({
            error: 'You have a summary job in progress. Please wait for it to complete.',
            errorCode: 'PENDING_LIMIT',
            existingJobId: pendingSummaryJob.id,
          });
          return;
        }

        // Create DB job
        const appIdsToProcess = appsNeedingSummary.map(app => app.id);
        for (const applicationId of appIdsToProcess) {
          await requireCandidatePrivacyAllowed(
            { type: 'application', id: applicationId },
            { globalUse: false },
          );
        }
        const dbJob = await storage.createAiFitJob({
          bullJobId: `pending-${randomUUID()}`,
          queueName: QUEUES.BATCH,
          userId,
          applicationIds: appIdsToProcess,
          totalCount: appIdsToProcess.length,
          result: {
            results: [],
            summary: {
              total: appIdsToProcess.length,
              succeeded: 0,
              skipped: accessibleApps.length - appsNeedingSummary.length,
              errors: 0,
            },
          },
        });

        // Enqueue the job
        try {
          for (const applicationId of appIdsToProcess) {
            await requireCandidatePrivacyAllowed(
              { type: 'application', id: applicationId },
              { globalUse: false },
            );
          }
          const bullJobId = await enqueueSummaryBatch({
            applicationIds: appIdsToProcess,
            recruiterId: userId,
            dbJobId: dbJob.id,
            regenerate,
            jobType: 'summary',
          });
          await storage.updateAiFitJobBullId(dbJob.id, bullJobId);
        } catch (enqueueError) {
          // Mark job as failed if enqueue fails
          await storage.updateAiFitJobStatus(dbJob.id, 'failed', {
            completedAt: new Date(),
            error: enqueueError instanceof Error ? enqueueError.message : 'Enqueue failed',
            errorCode: 'ENQUEUE_FAILED',
          });
          throw enqueueError;
        }

        res.status(202).json({
          jobId: dbJob.id,
          statusUrl: `/api/ai/summary/jobs/${dbJob.id}`,
          totalCount: appIdsToProcess.length,
          skippedCount: accessibleApps.length - appsNeedingSummary.length,
        });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        console.error('[AI Summary Queue] Error:', error);
        next(error);
      }
    }
  );

  /**
   * GET /api/ai/summary/jobs/:id
   * Get status of a summary batch job
   */
  app.get(
    "/api/ai/summary/jobs/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user!.id;
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing job ID' });
          return;
        }
        const jobId = parseInt(idParam, 10);

        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        const job = await storage.getAiFitJobForUser(jobId, userId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        const applicationIds = [
          ...(job.applicationId ? [job.applicationId] : []),
          ...(Array.isArray(job.applicationIds) ? job.applicationIds : []),
        ];
        for (const applicationId of applicationIds) {
          await requireCandidatePrivacyAllowed(
            { type: 'application', id: applicationId },
            { globalUse: false },
          );
        }

        res.json({
          id: job.id,
          status: job.status,
          progress: job.progress,
          processedCount: job.processedCount,
          totalCount: job.totalCount,
          result: job.result,
          error: job.error,
          errorCode: job.errorCode,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(404).json({ code: 'candidate_privacy_restricted' });
          return;
        }
        console.error('[AI Summary Job Status] Error:', error);
        next(error);
      }
    }
  );

  /**
   * DELETE /api/ai/summary/jobs/:id
   * Cancel a pending/active summary batch job
   */
  app.delete(
    "/api/ai/summary/jobs/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user!.id;
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing job ID' });
          return;
        }
        const jobId = parseInt(idParam, 10);

        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        const job = await storage.getAiFitJobForUser(jobId, userId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        if (job.status !== 'pending' && job.status !== 'active') {
          res.status(400).json({ error: 'Job cannot be cancelled', status: job.status });
          return;
        }

        // Remove from BullMQ
        const queueName = job.queueName as typeof QUEUES[keyof typeof QUEUES];
        await removeJob(queueName, job.bullJobId);

        // Update DB status
        const cancelled = await storage.cancelAiFitJob(jobId, userId);
        if (!cancelled) {
          res.status(400).json({ error: 'Failed to cancel job' });
          return;
        }

        res.json({ cancelled: true });
      } catch (error) {
        console.error('[AI Summary Job Cancel] Error:', error);
        next(error);
      }
    }
  );

  // ============= APPLICATION FEEDBACK =============

  // Get feedback for an application
  app.get("/api/applications/:id/feedback", requireRole(['recruiter', 'super_admin', 'hiring_manager']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      if (req.user!.role === 'hiring_manager') {
        const access = await ensureHiringManagerOwnsApplication(req.user!.id, appId);
        if (!access.ok) {
          res.status(access.status).json({ error: access.error });
          return;
        }
      }

      const feedback = await db
        .select({
          id: applicationFeedback.id,
          applicationId: applicationFeedback.applicationId,
          authorId: applicationFeedback.authorId,
          overallScore: applicationFeedback.overallScore,
          recommendation: applicationFeedback.recommendation,
          notes: applicationFeedback.notes,
          createdAt: applicationFeedback.createdAt,
          updatedAt: applicationFeedback.updatedAt,
        })
        .from(applicationFeedback)
        .where(eq(applicationFeedback.applicationId, appId))
        .orderBy(sql`${applicationFeedback.createdAt} DESC`);

      const feedbackWithAuthors = await Promise.all(
        feedback.map(async (fb: typeof feedback[0]) => {
          const author = await storage.getUser(fb.authorId);
          return {
            ...fb,
            author: author ? {
              id: author.id,
              firstName: author.firstName,
              lastName: author.lastName,
              role: author.role,
            } : null,
          };
        })
      );

      res.json(feedbackWithAuthors);
      return;
    } catch (error) {
      console.error('[Feedback Get] Error:', error);
      next(error);
    }
  });

  // Add feedback to an application
  app.post("/api/applications/:id/feedback", csrfProtection, requireRole(['recruiter', 'super_admin', 'hiring_manager']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const appId = Number(idParam);
      if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      if (req.user!.role === 'hiring_manager') {
        const access = await ensureHiringManagerOwnsApplication(req.user!.id, appId);
        if (!access.ok) {
          res.status(access.status).json({ error: access.error });
          return;
        }
      }

      const validation = insertApplicationFeedbackSchema.safeParse({
        ...req.body,
        applicationId: appId,
      });

      if (!validation.success) {
        res.status(400).json({
          error: 'Validation error',
          details: validation.error.errors,
        });
        return;
      }

      const [newFeedback] = await db
        .insert(applicationFeedback)
        .values({
          applicationId: appId,
          authorId: req.user!.id,
          overallScore: validation.data.overallScore,
          recommendation: validation.data.recommendation,
          notes: validation.data.notes || null,
        })
        .returning();

      const author = await storage.getUser(req.user!.id);

      res.status(201).json({
        message: 'Feedback added successfully',
        feedback: {
          ...newFeedback,
          author: author ? {
            id: author.id,
            firstName: author.firstName,
            lastName: author.lastName,
            role: author.role,
          } : null,
        },
      });
      return;
    } catch (error) {
      console.error('[Feedback Add] Error:', error);
      next(error);
    }
  });

  // ============= APPLICATION STATUS MANAGEMENT =============

  app.post("/api/applications/bulk/request-hm-review", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { applicationIds, note } = requestHiringManagerReviewSchema.parse(req.body);
      const normalizedIds = Array.from(new Set(applicationIds.map((id) => Number(id))));

      if (req.user!.role !== 'super_admin') {
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        const recruiterApplications = await Promise.all(
          normalizedIds.map((id) => storage.getApplication(id))
        );

        const jobIds = Array.from(new Set(
          recruiterApplications
            .filter((application): application is NonNullable<typeof application> => !!application)
            .map((application) => application.jobId)
        ));

        const accessChecks = await Promise.all(
          jobIds.map((jobId) => storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId))
        );

        if (accessChecks.includes(false)) {
          res.status(403).json({ error: "Access denied to one or more applications" });
          return;
        }
      }

      const existingApplications = await Promise.all(
        normalizedIds.map((id) => storage.getApplication(id))
      );
      const foundApplications = existingApplications.filter((application): application is NonNullable<typeof application> => !!application);
      const foundIds = foundApplications.map((application) => application.id);
      const missingIds = normalizedIds.filter((id) => !foundIds.includes(id));

      if (foundApplications.length === 0) {
        res.json({
          success: true,
          total: normalizedIds.length,
          requestedCount: 0,
          failed: missingIds.map((applicationId) => ({
            applicationId,
            error: "Application not found",
          })),
        });
        return;
      }

      const jobIds = Array.from(new Set(foundApplications.map((application) => application.jobId)));
      if (jobIds.length !== 1) {
        res.status(400).json({ error: "Select candidates from a single job before requesting hiring manager review" });
        return;
      }

      const targetJobId = jobIds[0];
      if (!targetJobId) {
        res.status(400).json({ error: "Select candidates from a single job before requesting hiring manager review" });
        return;
      }

      const job = await storage.getJob(targetJobId);
      if (!job?.hiringManagerId) {
        res.status(400).json({ error: "Assign a hiring manager to this job before requesting review" });
        return;
      }

      const trimmedNote = note?.trim() || null;
      await db
        .update(applications)
        .set({
          hmReviewRequestedAt: new Date(),
          hmReviewRequestedBy: req.user!.id,
          hmReviewNote: trimmedNote,
          updatedAt: new Date(),
        })
        .where(inArray(applications.id, foundIds));

      res.json({
        success: true,
        total: normalizedIds.length,
        requestedCount: foundIds.length,
        failed: missingIds.map((applicationId) => ({
          applicationId,
          error: "Application not found",
        })),
        message: `${foundIds.length} candidates sent to the hiring manager for review`,
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  // Update single application status (recruiters/admins only)
  app.patch("/api/applications/:id/status", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const applicationId = Number(idParam);
      const { status, notes } = req.body;

      if (!Number.isFinite(applicationId) || applicationId <= 0 || !Number.isInteger(applicationId)) {
        res.status(400).json({ error: "Invalid ID parameter" });
        return;
      }

      if (!['submitted', 'reviewed', 'shortlisted', 'rejected', 'downloaded'].includes(status)) {
        res.status(400).json({
          error: "Invalid status. Must be one of: submitted, reviewed, shortlisted, rejected, downloaded"
        });
        return;
      }

      if (req.user!.role !== 'super_admin') {
        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        const application = await storage.getApplication(applicationId);
        if (!application) {
          res.status(404).json({ error: "Application not found" });
          return;
        }

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = await storage.isRecruiterOnJob(application.jobId, req.user!.id, userOrgId);
        if (!hasAccess) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }

      const application = await storage.updateApplicationStatus(applicationId, status, notes);

      if (!application) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      res.json(application);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Bulk update application statuses (recruiters/admins only)
  app.patch("/api/applications/bulk", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { applicationIds, status, notes } = req.body;

      if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
        res.status(400).json({ error: "applicationIds must be a non-empty array" });
        return;
      }

      if (!['submitted', 'reviewed', 'shortlisted', 'rejected', 'downloaded'].includes(status)) {
        res.status(400).json({
          error: "Invalid status. Must be one of: submitted, reviewed, shortlisted, rejected, downloaded"
        });
        return;
      }

      if (req.user!.role !== 'super_admin') {
        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        const applicationsList = await Promise.all(
          applicationIds.map(id => storage.getApplication(parseInt(id)))
        );

        const jobIds = Array.from(new Set(
          applicationsList
            .filter(app => app)
            .map(app => app!.jobId)
        ));

        // Check access to each unique job (includes co-recruiters)
        const accessChecks = await Promise.all(
          jobIds.map(jobId => storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId))
        );

        if (accessChecks.includes(false)) {
          res.status(403).json({ error: "Access denied to one or more applications" });
          return;
        }
      }

      const normalizedIds = applicationIds.map(id => parseInt(id));
      const existingApplications = await Promise.all(
        normalizedIds.map((id) => storage.getApplication(id))
      );
      const foundIds = existingApplications
        .filter((app): app is NonNullable<typeof app> => !!app)
        .map((app) => app.id);
      const missingIds = normalizedIds.filter((id) => !foundIds.includes(id));

      const updatedCount = foundIds.length > 0
        ? await storage.updateApplicationsStatus(foundIds, status, notes)
        : 0;

      res.json({
        success: true,
        total: normalizedIds.length,
        updatedCount,
        failed: missingIds.map((applicationId) => ({
          applicationId,
          error: "Application not found",
        })),
        message: `${updatedCount} applications updated successfully`
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  // Mark application as viewed (automatically updates status to 'reviewed')
  app.patch("/api/applications/:id/view", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const applicationId = Number(idParam);

      if (!Number.isFinite(applicationId) || applicationId <= 0 || !Number.isInteger(applicationId)) {
        res.status(400).json({ error: "Invalid application ID" });
        return;
      }

      if (req.user!.role !== 'super_admin') {
        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        const application = await storage.getApplication(applicationId);
        if (!application) {
          res.status(404).json({ error: "Application not found" });
          return;
        }

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = await storage.isRecruiterOnJob(application.jobId, req.user!.id, userOrgId);
        if (!hasAccess) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }

      const application = await storage.markApplicationViewed(applicationId);

      if (!application) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      res.json(application);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Mark application as downloaded (when resume is downloaded)
  app.patch("/api/applications/:id/download", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const applicationId = Number(idParam);

      if (!Number.isFinite(applicationId) || applicationId <= 0 || !Number.isInteger(applicationId)) {
        res.status(400).json({ error: "Invalid application ID" });
        return;
      }

      if (req.user!.role !== 'super_admin') {
        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        const application = await storage.getApplication(applicationId);
        if (!application) {
          res.status(404).json({ error: "Application not found" });
          return;
        }

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = await storage.isRecruiterOnJob(application.jobId, req.user!.id, userOrgId);
        if (!hasAccess) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }

      const application = await storage.markApplicationDownloaded(applicationId);

      if (!application) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      res.json(application);
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= CANDIDATE DASHBOARD ROUTES =============
  // Note: Profile routes (GET/POST/PATCH /api/profile) are in profile.routes.ts

  // Get user's applications (bound to userId, with email fallback for unclaimed applications)
  app.get(
    "/api/my-applications",
    requireVerifiedCandidate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // Pass user's email to also find unclaimed applications that match by email
        const applicationsList = await storage.getApplicationsByUserId(req.user!.id, req.user!.username);

        // Claim-on-read: if any applications were found by email but not yet claimed, claim them now
        // This ensures subsequent actions (withdraw, etc.) work properly
        const unclaimedIds = applicationsList
          .filter(app => app.userId === null || app.userId === undefined)
          .map(app => app.id);

        if (unclaimedIds.length > 0) {
          await db
            .update(applications)
            .set({ userId: req.user!.id })
            .where(
              and(
                inArray(applications.id, unclaimedIds),
                sql`${applications.userId} IS NULL`
              )
            );
        }

        res.json(applicationsList.map(toCandidateApplicationView));
        return;
      } catch (error) {
        next(error);
      }
    }
  );

  // Get applications received for recruiter's jobs
  app.get("/api/my-applications-received", requireRole(['recruiter', 'super_admin']), requireSeat({ allowNoOrg: true }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : (orgResult?.organization.id ?? null);
      const applicationsList = await storage.getRecruiterApplications(req.user!.id, organizationId);
      res.json(applicationsList);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get global candidates view (aggregated by email)
  app.get("/api/candidates", requireRole(['recruiter', 'super_admin']), requireSeat({ allowNoOrg: true }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q: search, minRating, tags } = req.query;

      const filters: {
        search?: string;
        minRating?: number;
        hasTags?: string[];
      } = {};

      if (search && typeof search === 'string') {
        filters.search = search;
      }

      if (minRating && typeof minRating === 'string') {
        const rating = parseInt(minRating, 10);
        if (!isNaN(rating) && rating >= 1 && rating <= 5) {
          filters.minRating = rating;
        }
      }

      if (tags && typeof tags === 'string') {
        filters.hasTags = tags.split(',').map(tag => tag.trim()).filter(Boolean);
      }

      const candidates = await storage.getCandidatesForRecruiter(req.user!.id, filters);
      res.json(candidates);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Withdraw application
  app.delete("/api/applications/:id/withdraw", csrfProtection, requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const applicationId = Number(idParam);

      if (!Number.isFinite(applicationId) || applicationId <= 0 || !Number.isInteger(applicationId)) {
        res.status(400).json({ error: "Invalid application ID" });
        return;
      }

      const success = await storage.withdrawApplication(applicationId, req.user!.id);

      if (!success) {
        res.status(404).json({ error: "Application not found or access denied" });
        return;
      }

      res.json({ success: true, message: "Application withdrawn successfully" });
      return;
    } catch (error) {
      next(error);
    }
  });

  console.log('✅ Applications routes registered');
}
