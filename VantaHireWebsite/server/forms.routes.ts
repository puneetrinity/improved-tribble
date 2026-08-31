import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { forms, formFields, formInvitations, formResponses, formResponseAnswers, applications, jobs, emailAuditLog, userAiUsage, users } from "@shared/schema";
import { insertFormSchema, insertFormFieldSchema, insertFormInvitationSchema, insertFormResponseAnswerSchema } from "@shared/schema";
import { requireAuth, requireRole, requireSeat } from "./auth";
import { eq, and, desc, sql, or, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import type { RateLimitInfo } from "express-rate-limit";
import { getEmailService } from "./simpleEmailService";
import { upload, uploadToGCS } from "./gcs-storage";
import type { FormSnapshot, FormFieldSnapshot, FormAnswer, FileUploadResult } from "@shared/forms.types";
import { parseFormSnapshot, isValidFieldType, parseSelectOptions, normalizeYesNoValue } from "@shared/forms.types";
import { generateFormQuestions, isAIEnabled } from "./aiJobAnalyzer";
import { calculateAiCost } from './lib/aiMatchingEngine';
import { aiAnalysisRateLimit } from "./rateLimit";
import { getUserOrganization } from './lib/organizationService';
import { updateMemberActivity } from './lib/membershipService';
import { requireFeatureAccess, FEATURES } from './lib/featureGating';
import { getAiCreditExhaustionPayload, hasEnoughCredits, useCredits } from './lib/creditService';
import {
  CandidatePrivacyRestrictedError,
  privacyAllowedSql,
  requireCandidatePrivacyAllowed,
  requireNewCandidateIdentityAllowed,
} from './candidate-privacy/decision';
import {
  createScopedFormTemplate,
  deleteAuthorizedFormTemplate,
  listAuthorizedFormTemplates,
  parseReviewerShareId,
  readAuthorizedFormTemplate,
  readAuthorizedResponsesForForm,
  updateAuthorizedFormTemplate,
} from './lib/reviewerShareAuthorization';

async function requireFormSubjectAllowed(invitation: {
  applicationId?: number | null;
  email?: string | null;
}): Promise<void> {
  if (invitation.applicationId) {
    await requireCandidatePrivacyAllowed(
      { type: 'application', id: invitation.applicationId },
      { globalUse: false },
    );
    return;
  }
  if (invitation.email?.trim()) {
    await requireNewCandidateIdentityAllowed([
      { identifier_type: 'email', value: invitation.email.trim().toLowerCase() },
    ]);
  }
}

// Environment configuration
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
const FORM_INVITE_EXPIRY_DAYS = parseInt(process.env.FORM_INVITE_EXPIRY_DAYS || '14', 10);
const FORM_PUBLIC_RATE_LIMIT = parseInt(
  process.env.FORM_PUBLIC_RATE_LIMIT || (isTestEnv ? '1000' : '10'),
  10
);
const FORM_INVITE_DAILY_LIMIT = parseInt(process.env.FORM_INVITE_DAILY_LIMIT || '50', 10);
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

// Error constants (exported for reuse in public endpoints)
export const FORM_ERRORS = {
  EXPIRED: {
    status: 410,
    code: 'FORM_EXPIRED',
    message: 'This form invitation has expired. Please contact the recruiter for a new link.'
  },
  ALREADY_SUBMITTED: {
    status: 409,
    code: 'ALREADY_SUBMITTED',
    message: "You've already submitted this form. Thank you for your response!"
  },
  INVALID_TOKEN: {
    status: 403,
    code: 'INVALID_TOKEN',
    message: 'Invalid invitation link. Please check the URL or contact the recruiter.'
  },
  RATE_LIMITED: {
    status: 429,
    code: 'RATE_LIMITED',
    message: 'Too many attempts. Please try again in a few minutes.'
  }
} as const;

// Rate limiters
const publicFormRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: FORM_PUBLIC_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv, // Skip rate limiting in test environment
  handler: (req: Request, res: Response) => {
    const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
    const retryAfter = info?.resetTime ? Math.ceil((info.resetTime.getTime() - Date.now()) / 1000) : undefined;
    res.status(429).json({
      ...FORM_ERRORS.RATE_LIMITED,
      limit: info?.limit,
      remaining: info?.remaining ?? 0,
      used: info?.used,
      retryAfterSeconds: retryAfter,
    });
  }
});

const invitationRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: FORM_INVITE_DAILY_LIMIT,
  skip: () => isTestEnv, // Skip rate limiting in test environment
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip || 'anonymous',
  handler: (req: Request, res: Response) => {
    const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
    const retryAfter = info?.resetTime ? Math.ceil((info.resetTime.getTime() - Date.now()) / 1000) : undefined;
    res.status(429).json({
      error: 'Daily invitation limit reached. Please try again tomorrow.',
      limit: info?.limit,
      remaining: info?.remaining ?? 0,
      used: info?.used,
      retryAfterSeconds: retryAfter,
    });
  },
});

// Validation schemas
const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  isPublished: z.boolean().optional(),
  fields: z.array(insertFormFieldSchema).min(1).max(50),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  isPublished: z.boolean().optional(),
  fields: z.array(insertFormFieldSchema).min(1).max(50).optional(),
});

const aiSuggestSchema = z.object({
  jobId: z.number().int().positive().optional(),
  jobDescription: z.string().max(5000).optional(),
  goals: z.array(z.string()).default([]),
});

function scopedFields(fields: z.infer<typeof insertFormFieldSchema>[]) {
  return fields.map((field) => ({
    type: field.type,
    label: field.label,
    required: field.required,
    ...(field.options !== undefined ? { options: field.options } : {}),
    order: field.order,
  }));
}

export function registerFormsRoutes(app: Express, csrfProtection?: (req: Request, res: Response, next: NextFunction) => void): void {
  console.log('📋 Registering forms routes...');

  // Use provided CSRF middleware or no-op
  const csrf = csrfProtection || ((req: Request, res: Response, next: NextFunction) => next());

  // ==================== Template CRUD ====================

  // Create template with fields
  app.post(
    "/api/forms/templates",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    async (req: Request, res: Response) => {
      try {
        const body = createTemplateSchema.parse(req.body);

        const result = await createScopedFormTemplate(req.user!.id, {
          name: body.name,
          description: body.description ?? null,
          isPublished: body.isPublished ?? true,
          fields: scopedFields(body.fields),
        }, { allowPlatformAdmin: true });
        if (!result.ok) {
          const status = result.reason === 'unavailable' ? 503 : 404;
          return res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'FORM_NOT_FOUND' });
        }
        return res.status(201).json(result.value);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: 'Invalid request data', details: error.errors });
        }
        return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
      }
    }
  );

  // AI-suggest form questions
  app.post(
    "/api/forms/ai-suggest",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    requireFeatureAccess(FEATURES.AI_CONTENT),
    csrf,
    aiAnalysisRateLimit,
    async (req: Request, res: Response) => {
      try {
        // Check if AI features are enabled
        if (!isAIEnabled()) {
          return res.status(503).json({ error: 'AI features are not enabled. Please configure GROQ_API_KEY.' });
        }

        // Check AI credits for recruiters
        if (req.user!.role === 'recruiter') {
          const creditCheck = await hasEnoughCredits(req.user!.id, 1);
          if (!creditCheck) {
            return res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, 1));
          }
        }

        const body = aiSuggestSchema.parse(req.body);
        const startTime = Date.now();

        let jobDescription = body.jobDescription || "";
        let skills: string[] = [];
        let organizationId: number | undefined;

        // If jobId provided, fetch job details
        if (body.jobId) {
          const [job] = await db.select().from(jobs).where(eq(jobs.id, body.jobId));
          if (!job) {
            return res.status(404).json({ error: 'Job not found' });
          }
          jobDescription = job.description;
          skills = job.skills || [];
          organizationId = job.organizationId ?? undefined;
        }

        if (organizationId == null) {
          const orgResult = await getUserOrganization(req.user!.id);
          organizationId = orgResult?.organization.id;
        }

        // Validate that we have job description
        if (!jobDescription || jobDescription.trim().length === 0) {
          return res.status(400).json({ error: 'Job description is required (either via jobId or jobDescription)' });
        }

        // Generate AI suggestions
        const result = await generateFormQuestions(
          jobDescription,
          skills,
          body.goals
        );

        const durationMs = Date.now() - startTime;

        // Calculate cost using shared Groq pricing
        const costUsd = calculateAiCost(result.tokensUsed.input, result.tokensUsed.output);

        // Track AI usage for billing/analytics
        await db.insert(userAiUsage).values({
          userId: req.user!.id,
          kind: 'form_ai',
          tokensIn: result.tokensUsed.input,
          tokensOut: result.tokensUsed.output,
          costUsd,
          metadata: {
            jobId: body.jobId || null,
            goals: body.goals,
            fieldsGenerated: result.fields.length,
            durationMs,
          },
          ...(organizationId != null && { organizationId }),
        });

        // Deduct credits after successful generation (recruiters only)
        if (req.user!.role === 'recruiter') {
          await useCredits(req.user!.id, 1);
        }

        return res.json({
          fields: result.fields,
          modelVersion: result.model_version,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: 'Invalid request data', details: error.errors });
        }
        console.error('Error generating AI form suggestions:', error);
        const errorMessage = error?.message || 'Failed to generate form suggestions';
        return res.status(500).json({ error: errorMessage });
      }
    }
  );

  // List templates - scoped by organization
  app.get(
    "/api/forms/templates",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        const result = await listAuthorizedFormTemplates(
          req.user!.id,
          { allowPlatformAdmin: true },
        );
        if (!result.ok) return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
        return res.json({ templates: result.rows });
      } catch {
        return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
      }
    }
  );

  // Get template by ID
  app.get(
    "/api/forms/templates/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        const formId = parseReviewerShareId(req.params.id);
        if (!formId) return res.status(400).json({ error: 'INVALID_FORM_ID' });
        const result = await readAuthorizedFormTemplate(req.user!.id, formId, { allowPlatformAdmin: true });
        if (!result.ok) {
          const status = result.reason === 'unavailable' ? 503 : 404;
          return res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'FORM_NOT_FOUND' });
        }
        return res.json(result.value);
      } catch {
        return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
      }
    }
  );

  // Update template
  app.patch(
    "/api/forms/templates/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    async (req: Request, res: Response) => {
      try {
        const formId = parseReviewerShareId(req.params.id);
        if (!formId) return res.status(400).json({ error: 'INVALID_FORM_ID' });
        const body = updateTemplateSchema.parse(req.body);
        const patch = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isPublished !== undefined ? { isPublished: body.isPublished } : {}),
          ...(body.fields !== undefined ? { fields: scopedFields(body.fields) } : {}),
        };
        const result = await updateAuthorizedFormTemplate(
          req.user!.id,
          formId,
          patch,
          { allowPlatformAdmin: true },
        );
        if (!result.ok) {
          const status = result.reason === 'unavailable' ? 503 : 404;
          return res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'FORM_NOT_FOUND' });
        }
        return res.json(result.value);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: 'Invalid request data', details: error.errors });
        }
        return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
      }
    }
  );

  // Delete template
  app.delete(
    "/api/forms/templates/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    async (req: Request, res: Response) => {
      try {
        const formId = parseReviewerShareId(req.params.id);
        if (!formId) return res.status(400).json({ error: 'INVALID_FORM_ID' });
        const result = await deleteAuthorizedFormTemplate(req.user!.id, formId, { allowPlatformAdmin: true });
        if (!result.ok) {
          if (result.reason === 'unavailable') return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
          if (result.reason === 'conflict') return res.status(409).json({ error: 'FORM_IN_USE' });
          return res.status(404).json({ error: 'FORM_NOT_FOUND' });
        }
        return res.json({ success: true, message: 'Template deleted successfully' });
      } catch {
        return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
      }
    }
  );

  // ==================== Helper: Send Form Invitation Email ====================

  interface EmailResult {
    success: boolean;
    error?: string;
    previewUrl?: string;
  }

  async function sendFormInvitationEmail(
    invitationId: number,
    candidateEmail: string,
    candidateName: string,
    formName: string,
    token: string,
    customMessage?: string,
    sentBy?: number
  ): Promise<EmailResult> {
    const formLink = `${BASE_URL}/form/${token}`;
    const isDevelopment = process.env.NODE_ENV === 'development';

    try {
      const emailService = await getEmailService();

      if (!emailService) {
        console.warn('[Forms] No email service configured, using preview mode');
        // In development without email config, generate a preview URL
        if (isDevelopment) {
          return { success: false, error: 'Email service not configured', previewUrl: `http://ethereal.email/message/${Date.now()}` };
        } else {
          return { success: false, error: 'Email service not configured' };
        }
      }

      const subject = `Form Request: ${formName}`;
      const text = `Hi ${candidateName},

We'd like to request some additional information from you.

${customMessage ? customMessage + '\n\n' : ''}Please complete the form at:
${formLink}

This link will expire in ${FORM_INVITE_EXPIRY_DAYS} days.

Best regards,
VantaHire Team`;

      const emailSent = await emailService.sendEmail({
        to: candidateEmail,
        subject,
        text,
      });

      if (emailSent) {
        if (isDevelopment) {
          return {
            success: true,
            previewUrl: `http://ethereal.email/messages`,
          };
        } else {
          return {
            success: true,
          };
        }
      } else {
        if (isDevelopment) {
          return {
            success: false,
            error: 'Failed to send email',
            previewUrl: `http://ethereal.email/messages`,
          };
        } else {
          return {
            success: false,
            error: 'Failed to send email',
          };
        }
      }
    } catch (error: any) {
      console.error('[Forms] Error sending invitation email:', error);
      return {
        success: false,
        error: error.message || 'Unknown error sending email',
      };
    }
  }

  // ==================== Invitation Endpoints ====================

  // Get invitation quota status (remaining daily invites)
  app.get(
    "/api/forms/invitations/quota",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        // Count invitations sent today by this user
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [result] = await db.select({
          count: sql<number>`count(*)::int`
        })
        .from(formInvitations)
        .where(
          and(
            eq(formInvitations.sentBy, req.user!.id),
            sql`${formInvitations.createdAt} >= ${today}`
          )
        );

        const used = result?.count ?? 0;
        const limit = FORM_INVITE_DAILY_LIMIT;
        const remaining = Math.max(0, limit - used);

        // Calculate reset time (next midnight)
        const resetTime = new Date(today);
        resetTime.setDate(resetTime.getDate() + 1);
        const retryAfterSeconds = Math.ceil((resetTime.getTime() - Date.now()) / 1000);

        return res.json({
          limit,
          used,
          remaining,
          retryAfterSeconds,
          resetTime: resetTime.toISOString(),
        });
      } catch (error: any) {
        console.error('[Forms] Error fetching invitation quota:', error);
        return res.status(500).json({ error: 'Failed to fetch invitation quota' });
      }
    }
  );

  // Create form invitation
  app.post(
    "/api/forms/invitations",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    invitationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const body = insertFormInvitationSchema.parse(req.body);
        const { applicationId, formId, customMessage } = body;

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // 1. Verify ownership: application → job.postedBy === req.user.id
        const application = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: {
            job: true,
          },
        });

        if (!application) {
          return res.status(404).json({ error: 'Application not found' });
        }
        await requireFormSubjectAllowed(application);

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = application.job && await storage.isRecruiterOnJob(application.job.id, req.user!.id, userOrgId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized: You can only send forms for your own job postings' });
        }

        // 2. Check for duplicate pending/sent invitations
        const existingInvitation = await db.query.formInvitations.findFirst({
          where: and(
            eq(formInvitations.applicationId, applicationId),
            eq(formInvitations.formId, formId),
            or(
              eq(formInvitations.status, 'pending'),
              eq(formInvitations.status, 'sent')
            )
          ),
        });

        if (existingInvitation) {
          return res.status(400).json({
            error: 'An invitation for this form has already been sent to this candidate',
            hint: 'Wait for the candidate to respond or resend from the Forms modal',
            existingInvitationId: existingInvitation.id,
          });
        }

        // 3. Fetch form with fields to create snapshot
        const form = await db.query.forms.findFirst({
          where: eq(forms.id, formId),
          with: {
            fields: {
              orderBy: (fields: any, { asc }: any) => [asc(fields.order)],
            },
          },
        });

        if (!form) {
          return res.status(404).json({ error: 'Form template not found' });
        }

        // Template access check: recruiters can only send their own templates or published templates
        const isAdmin = req.user!.role === 'super_admin';
        if (!isAdmin) {
          const canAccess = form.isPublished || form.createdBy === req.user!.id;
          if (!canAccess) {
            return res.status(403).json({
              error: 'Unauthorized: You can only send your own templates or published templates'
            });
          }
        }

        // 4. Create field snapshot
        const fieldSnapshot = JSON.stringify({
          formName: form.name,
          formDescription: form.description,
          fields: form.fields.map((f: any) => ({
            id: f.id,
            type: f.type,
            label: f.label,
            required: f.required,
            options: f.options,
            order: f.order,
          })),
        });

        // 5. Generate token and expiry
        const token = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + FORM_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        // 6. Create invitation (status = 'pending')
        const [invitation] = await db.insert(formInvitations).values({
          applicationId,
          formId,
          token,
          expiresAt,
          status: 'pending',
          sentBy: req.user!.id,
          fieldSnapshot,
          customMessage,
          ...(application.job?.organizationId != null && { organizationId: application.job.organizationId }),
        }).returning();

        // 7. Send email and update status
        await requireFormSubjectAllowed(application);
        const emailResult = await sendFormInvitationEmail(
          invitation.id,
          application.email,
          application.name,
          form.name,
          token,
          customMessage,
          req.user!.id
        );

        // Update invitation status based on email result
        const updatedStatus = emailResult.success ? 'sent' : 'failed';
        const [updatedInvitation] = await db.update(formInvitations)
          .set({
            status: updatedStatus,
            sentAt: emailResult.success ? new Date() : null,
            errorMessage: emailResult.error,
          })
          .where(eq(formInvitations.id, invitation.id))
          .returning();

        // 8. Log to email_audit_log
        await db.insert(emailAuditLog).values({
          applicationId,
          templateType: 'form_invitation',
          recipientEmail: application.email,
          subject: `Form Request: ${form.name}`,
          sentAt: new Date(),
          sentBy: req.user!.id,
          status: emailResult.success ? 'success' : 'failed',
          errorMessage: emailResult.error,
          previewUrl: emailResult.previewUrl,
        });

        return res.status(201).json({
          invitation: updatedInvitation,
          emailStatus: emailResult.success ? 'sent' : 'failed',
          previewUrl: emailResult.previewUrl,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: 'Invalid request data', details: error.errors });
        }
        console.error('Error creating form invitation:', error);
        return res.status(500).json({ error: 'Failed to create form invitation' });
      }
    }
  );

  // Bulk create form invitations (Phase B: robust server-side endpoint)
  app.post(
    "/api/forms/invitations/bulk",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    rateLimit({
      windowMs: 60_000, // 1 minute
      max: 10, // 10 requests per minute (more generous than 3)
      keyGenerator: (req) => req.user?.id?.toString() || req.ip || 'anonymous',
      handler: (req, res) => {
        res.status(429).json({ error: 'Too many bulk invitation requests. Please try again in a minute.' });
      },
    }),
    async (req: Request, res: Response) => {
      try {
        // Validate request body
        const bodySchema = z.object({
          applicationIds: z.array(z.number()).min(1).max(100), // Soft limit: 100 per call
          formId: z.number(),
          customMessage: z.string().optional(),
          skipExisting: z.boolean().optional().default(true),
          resendAnswered: z.boolean().optional().default(false),
        });

        const { applicationIds, formId, customMessage, skipExisting, resendAnswered } = bodySchema.parse(req.body);

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // 1. Fetch form template once (consistency across all invitations)
        const form = await db.query.forms.findFirst({
          where: eq(forms.id, formId),
          with: {
            fields: {
              orderBy: (fields: any, { asc }: any) => [asc(fields.order)],
            },
          },
        });

        if (!form) {
          return res.status(404).json({ error: 'Form template not found' });
        }

        // Template access check
        const isAdmin = req.user!.role === 'super_admin';
        if (!isAdmin) {
          const canAccess = form.isPublished || form.createdBy === req.user!.id;
          if (!canAccess) {
            return res.status(403).json({
              error: 'Unauthorized: You can only send your own templates or published templates'
            });
          }
        }

        // 2. Fetch all applications with job data
        const fetchedApplications = await db.query.applications.findMany({
          where: inArray(applications.id, applicationIds),
          with: { job: true },
        });

        if (fetchedApplications.length === 0) {
          return res.status(404).json({ error: 'No applications found' });
        }

        // 3. Ownership & status validation
        const results: Array<{ applicationId: number; status: string; error?: string }> = [];
        const validApplications: typeof fetchedApplications = [];

        for (const app of fetchedApplications) {
          try {
            await requireFormSubjectAllowed(app);
          } catch (error) {
            if (error instanceof CandidatePrivacyRestrictedError) {
              results.push({
                applicationId: app.id,
                status: 'skipped',
                error: 'Candidate is not available for this action',
              });
              continue;
            }
            throw error;
          }
          // Check ownership (use isRecruiterOnJob to include co-recruiters)
          const hasAccess = app.job && await storage.isRecruiterOnJob(app.job.id, req.user!.id, userOrgId);
          if (!hasAccess) {
            results.push({
              applicationId: app.id,
              status: 'unauthorized',
              error: 'You can only send forms for your own job postings',
            });
            continue;
          }

          // Filter inactive applications
          if (['rejected', 'withdrawn'].includes(app.status)) {
            results.push({
              applicationId: app.id,
              status: 'skipped',
              error: `Application status is ${app.status}`,
            });
            continue;
          }

          validApplications.push(app);
        }

        // 4. Check for duplicates (if skipExisting is true)
        if (skipExisting) {
          const existingInvitations = await db.query.formInvitations.findMany({
            where: and(
              inArray(formInvitations.applicationId, validApplications.map((a: typeof fetchedApplications[0]) => a.id)),
              eq(formInvitations.formId, formId),
              or(
                eq(formInvitations.status, 'pending'),
                eq(formInvitations.status, 'sent'),
                eq(formInvitations.status, 'viewed'),
                ...(resendAnswered ? [] : [eq(formInvitations.status, 'answered')])
              )
            ),
          });

          const existingAppIds = new Set(existingInvitations.map((inv: typeof existingInvitations[0]) => inv.applicationId));

          // Mark duplicates
          for (const appId of existingAppIds) {
            results.push({
              applicationId: appId as number,
              status: 'duplicate',
              error: 'An active invitation already exists for this form',
            });
          }

          // Filter out duplicates from validApplications
          validApplications.splice(0, validApplications.length, ...validApplications.filter((app: typeof fetchedApplications[0]) => !existingAppIds.has(app.id)));
        }

        // 5. Create field snapshot (same for all invitations)
        const fieldSnapshot = JSON.stringify({
          formName: form.name,
          formDescription: form.description,
          fields: form.fields.map((f: any) => ({
            id: f.id,
            type: f.type,
            label: f.label,
            required: f.required,
            options: f.options,
            order: f.order,
          })),
        });

        // 6. Phase 1: Create all invitations in transaction
        const createdInvitations = await db.transaction(async (tx: any) => {
          const invitations = [];
          for (const app of validApplications) {
            const token = crypto.randomBytes(32).toString('base64url');
            const expiresAt = new Date(Date.now() + FORM_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

            const [invitation] = await tx.insert(formInvitations).values({
              applicationId: app.id,
              formId,
              token,
              expiresAt,
              status: 'pending',
              sentBy: req.user!.id,
              fieldSnapshot,
              customMessage,
              ...(app.job?.organizationId != null && { organizationId: app.job.organizationId }),
            }).returning();

            invitations.push({ invitation, application: app });
          }
          return invitations;
        });

        // 7. Phase 2: Send emails (best-effort, mark failures)
        for (const { invitation, application } of createdInvitations) {
          try {
            await requireFormSubjectAllowed(application);
            const emailResult = await sendFormInvitationEmail(
              invitation.id,
              application.email,
              application.name,
              form.name,
              invitation.token,
              customMessage,
              req.user!.id
            );

            // Update invitation status
            const updatedStatus = emailResult.success ? 'sent' : 'failed';
            await db.update(formInvitations)
              .set({
                status: updatedStatus,
                sentAt: emailResult.success ? new Date() : null,
                errorMessage: emailResult.error,
              })
              .where(eq(formInvitations.id, invitation.id));

            // Log email
            await db.insert(emailAuditLog).values({
              applicationId: application.id,
              templateType: 'form_invitation',
              recipientEmail: application.email,
              subject: `Form Request: ${form.name}`,
              sentAt: new Date(),
              sentBy: req.user!.id,
              status: emailResult.success ? 'success' : 'failed',
              errorMessage: emailResult.error,
              previewUrl: emailResult.previewUrl,
            });

            if (emailResult.success) {
              results.push({ applicationId: application.id, status: 'created' });
            } else {
              results.push({
                applicationId: application.id,
                status: 'email_failed',
                error: emailResult.error || 'Failed to send email',
              });
            }
          } catch (err: any) {
            results.push({
              applicationId: application.id,
              status: 'email_failed',
              error: err.message || 'Failed to send email',
            });
          }
        }

        // 8. Compute summary
        const summary = {
          total: applicationIds.length,
          created: results.filter(r => r.status === 'created').length,
          duplicates: results.filter(r => r.status === 'duplicate').length,
          unauthorized: results.filter(r => r.status === 'unauthorized').length,
          skipped: results.filter(r => r.status === 'skipped').length,
          emailFailed: results.filter(r => r.status === 'email_failed').length,
        };

        return res.status(201).json({ summary, results });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: 'Invalid request data', details: error.errors });
        }
        console.error('Error creating bulk form invitations:', error);
        return res.status(500).json({ error: 'Failed to create bulk form invitations' });
      }
    }
  );

  // Create external form invitation (for email-only invites without existing application)
  app.post(
    "/api/forms/invitations/external",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    rateLimit({
      windowMs: 60_000,
      max: 50, // Allow more external invites per minute
      keyGenerator: (req) => req.user?.id?.toString() || req.ip || 'anonymous',
      handler: (req, res) => {
        res.status(429).json({ error: 'Too many invitation requests. Please try again later.' });
      },
    }),
    async (req: Request, res: Response) => {
      try {
        const bodySchema = z.object({
          formId: z.number(),
          email: z.string().email(),
          candidateName: z.string().min(1).max(255),
          jobId: z.number().optional(), // Optional job association
          customMessage: z.string().max(1000).optional(),
          expiresInDays: z.number().min(1).max(90).optional().default(14),
        });

        const { formId, email, candidateName, jobId, customMessage, expiresInDays } = bodySchema.parse(req.body);

        // This is a raw-identity ingest/provider boundary. Check Memory before
        // duplicate lookup, token persistence, or outbound email.
        await requireNewCandidateIdentityAllowed([
          { identifier_type: 'email', value: email.trim().toLowerCase() },
        ]);

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // 1. Fetch form template
        const form = await db.query.forms.findFirst({
          where: eq(forms.id, formId),
          with: {
            fields: {
              orderBy: (fields: any, { asc }: any) => [asc(fields.order)],
            },
          },
        });

        if (!form) {
          return res.status(404).json({ error: 'Form template not found' });
        }

        // 2. Template access check
        const isAdmin = req.user!.role === 'super_admin';
        if (!isAdmin) {
          const canAccess = form.isPublished || form.createdBy === req.user!.id;
          if (!canAccess) {
            return res.status(403).json({
              error: 'Unauthorized: You can only use your own templates or published templates'
            });
          }
        }

        // 3. Check if job exists and user has access (if jobId provided)
        let jobOrgId: number | undefined;
        if (jobId) {
          const job = await storage.getJob(jobId);
          if (!job) {
            return res.status(404).json({ error: 'Job not found' });
          }
          // Use isRecruiterOnJob to check access (includes co-recruiters)
          const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
          if (!hasAccess) {
            return res.status(403).json({ error: 'Unauthorized: Job does not belong to you' });
          }
          jobOrgId = job.organizationId ?? undefined;
        }

        // 4. Check for existing active invite (no duplicates)
        const existingInvite = await storage.getActiveExternalInvite(email, formId);
        if (existingInvite) {
          return res.status(409).json({
            error: 'An active invitation already exists for this email and form',
            existingInviteId: existingInvite.id,
          });
        }

        // 5. Generate token and calculate expiration
        const token = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);

        // 6. Prepare field snapshot
        const fieldSnapshot = JSON.stringify(form.fields.map((f: any) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          options: f.options,
          required: f.required,
          order: f.order,
        })));

        // 7. Create invitation (build object without undefined for exactOptionalPropertyTypes)
        const invitationData: {
          formId: number;
          email: string;
          candidateName: string;
          jobId?: number;
          token: string;
          expiresAt: Date;
          sentBy: number;
          fieldSnapshot: string;
          customMessage?: string;
          organizationId?: number;
        } = {
          formId,
          email,
          candidateName,
          token,
          expiresAt,
          sentBy: req.user!.id,
          fieldSnapshot,
        };
        if (jobId !== undefined) invitationData.jobId = jobId;
        if (customMessage !== undefined) invitationData.customMessage = customMessage;
        // Use job's org if available, otherwise user's org
        const inviteOrgId = jobOrgId ?? userOrgId;
        if (inviteOrgId !== undefined) invitationData.organizationId = inviteOrgId;

        const invitation = await storage.createExternalFormInvitation(invitationData);

        // 8. Send email invitation (invitationId is first parameter)
        await requireNewCandidateIdentityAllowed([
          { identifier_type: 'email', value: email.trim().toLowerCase() },
        ]);
        const emailResult = await sendFormInvitationEmail(
          invitation.id,
          email,
          candidateName,
          form.name,
          token,
          customMessage,
          req.user!.id
        );

        // 9. Update invitation status
        const updatedStatus = emailResult.success ? 'sent' : 'failed';
        await db.update(formInvitations)
          .set({
            status: updatedStatus,
            sentAt: emailResult.success ? new Date() : null,
            errorMessage: emailResult.error,
          })
          .where(eq(formInvitations.id, invitation.id));

        // 10. Log email (without applicationId for external invites)
        await db.insert(emailAuditLog).values({
          applicationId: null,
          templateType: 'external_form_invitation',
          recipientEmail: email,
          subject: `Form Request: ${form.name}`,
          sentAt: new Date(),
          sentBy: req.user!.id,
          status: emailResult.success ? 'success' : 'failed',
          errorMessage: emailResult.error,
          previewUrl: emailResult.previewUrl,
        });

        return res.status(201).json({
          invitation: {
            id: invitation.id,
            token: invitation.token,
            email: invitation.email,
            candidateName: invitation.candidateName,
            jobId: invitation.jobId,
            expiresAt: invitation.expiresAt,
            status: updatedStatus,
          },
          emailStatus: emailResult.success ? 'sent' : 'failed',
          previewUrl: emailResult.previewUrl,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: 'Invalid request data', details: error.errors });
        }
        console.error('Error creating external form invitation:', error);
        return res.status(500).json({ error: 'Failed to create external form invitation' });
      }
    }
  );

  // List invitations for an application
  app.get(
    "/api/forms/invitations",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        const applicationId = parseInt(req.query.applicationId as string, 10);

        if (!applicationId) {
          return res.status(400).json({ error: 'applicationId query parameter is required' });
        }

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // Verify ownership
        const application = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: { job: true },
        });

        if (!application) {
          return res.status(404).json({ error: 'Application not found' });
        }
        await requireFormSubjectAllowed(application);

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = application.job && await storage.isRecruiterOnJob(application.job.id, req.user!.id, userOrgId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        // Fetch invitations
        const invitations = await db.query.formInvitations.findMany({
          where: eq(formInvitations.applicationId, applicationId),
          with: {
            form: true,
          },
          orderBy: (invitations: any, { desc }: any) => [desc(invitations.createdAt)],
        });

        return res.json({ invitations });
      } catch (error: any) {
        console.error('Error fetching form invitations:', error);
        return res.status(500).json({ error: 'Failed to fetch form invitations' });
      }
    }
  );

  // Send reminder for a form invitation
  app.post(
    "/api/forms/invitations/:id/remind",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    invitationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const invitationId = parseInt(req.params.id ?? '', 10);

        if (!invitationId || !Number.isFinite(invitationId) || invitationId <= 0) {
          return res.status(400).json({ error: 'Invalid invitation ID' });
        }

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // Fetch the invitation with application and form
        const invitation = await db.query.formInvitations.findFirst({
          where: eq(formInvitations.id, invitationId),
          with: {
            application: {
              with: { job: true },
            },
            form: true,
          },
        });

        if (!invitation) {
          return res.status(404).json({ error: 'Invitation not found' });
        }
        if (invitation.application) {
          await requireCandidatePrivacyAllowed(
            { type: 'application', id: invitation.application.id },
            { globalUse: false },
          );
        } else {
          await requireFormSubjectAllowed(invitation);
        }

        // Verify ownership (use isRecruiterOnJob to include co-recruiters)
        const hasAccess = invitation.application?.job && await storage.isRecruiterOnJob(invitation.application.job.id, req.user!.id, userOrgId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized: You can only send reminders for your own job postings' });
        }

        // Check if invitation is still pending/sent (not answered, expired, or failed)
        if (!['pending', 'sent', 'viewed'].includes(invitation.status)) {
          return res.status(400).json({
            error: 'Cannot send reminder',
            reason: invitation.status === 'answered' ? 'Form already answered' : `Invitation status is "${invitation.status}"`,
          });
        }

        // Check if invitation is expired
        if (new Date(invitation.expiresAt) < new Date()) {
          return res.status(400).json({
            error: 'Cannot send reminder',
            reason: 'Invitation has expired',
          });
        }

        // Send reminder email
        await requireCandidatePrivacyAllowed(
          { type: 'application', id: invitation.application.id },
          { globalUse: false },
        );
        const emailResult = await sendFormInvitationEmail(
          invitation.id,
          invitation.application.email,
          invitation.application.name,
          invitation.form.name,
          invitation.token,
          invitation.customMessage || undefined,
          req.user!.id
        );

        // Update reminder sent timestamp
        if (emailResult.success) {
          await db.update(formInvitations)
            .set({ reminderSentAt: new Date() })
            .where(eq(formInvitations.id, invitationId));
        }

        // Log to email_audit_log
        await db.insert(emailAuditLog).values({
          applicationId: invitation.applicationId,
          templateType: 'form_reminder',
          recipientEmail: invitation.application.email,
          subject: `Reminder: Form Request - ${invitation.form.name}`,
          sentAt: new Date(),
          sentBy: req.user!.id,
          status: emailResult.success ? 'success' : 'failed',
          errorMessage: emailResult.error,
          previewUrl: emailResult.previewUrl,
        });

        return res.json({
          success: emailResult.success,
          message: emailResult.success ? 'Reminder sent successfully' : 'Failed to send reminder',
          previewUrl: emailResult.previewUrl,
          error: emailResult.error,
        });
      } catch (error: any) {
        console.error('[Forms] Error sending reminder:', error);
        return res.status(500).json({ error: 'Failed to send reminder' });
      }
    }
  );

  // ==================== Public Form Endpoints (CSRF-exempt, token-based auth) ====================

  // Get public form by token
  app.get(
    "/api/forms/public/:token",
    publicFormRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { token } = req.params;

        // Lookup invitation by token
        const invitation = await db.query.formInvitations.findFirst({
          where: eq(formInvitations.token, token ?? ''),
        });

        if (!invitation) {
          return res.status(403).json(FORM_ERRORS.INVALID_TOKEN);
        }
        await requireFormSubjectAllowed(invitation);

        // Check if expired
        if (invitation.expiresAt < new Date()) {
          // Mark as expired if not already
          if (invitation.status === 'pending' || invitation.status === 'sent') {
            await db.update(formInvitations)
              .set({ status: 'expired' })
              .where(eq(formInvitations.id, invitation.id));
          }
          return res.status(410).json(FORM_ERRORS.EXPIRED);
        }

        // Check if already answered
        if (invitation.status === 'answered') {
          return res.status(409).json(FORM_ERRORS.ALREADY_SUBMITTED);
        }

        // Mark viewedAt on first view
        if (!invitation.viewedAt && (invitation.status === 'pending' || invitation.status === 'sent')) {
          await db.update(formInvitations)
            .set({ viewedAt: new Date(), status: 'viewed' })
            .where(eq(formInvitations.id, invitation.id));
        }

        // Parse and return field snapshot (no PII beyond what's in snapshot)
        const snapshot: FormSnapshot = parseFormSnapshot(invitation.fieldSnapshot);

        return res.json({
          formName: snapshot.formName,
          formDescription: snapshot.formDescription,
          fields: snapshot.fields,
          expiresAt: invitation.expiresAt,
        });
      } catch (error: any) {
        console.error('[Forms] Error fetching public form:', error);
        return res.status(500).json({ error: 'Failed to load form' });
      }
    }
  );

  // Upload file for public form (before submitting)
  app.post(
    "/api/forms/public/:token/upload",
    publicFormRateLimit,
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const { token } = req.params;

        if (!req.file) {
          return res.status(400).json({ error: 'No file provided' });
        }

        // Validate token and check status (similar to form GET)
        const invitation = await db.query.formInvitations.findFirst({
          where: eq(formInvitations.token, token ?? ''),
        });

        if (!invitation) {
          return res.status(403).json(FORM_ERRORS.INVALID_TOKEN);
        }
        await requireFormSubjectAllowed(invitation);

        // Check if expired
        if (invitation.expiresAt < new Date()) {
          return res.status(410).json(FORM_ERRORS.EXPIRED);
        }

        // Check if already answered
        if (invitation.status === 'answered') {
          return res.status(409).json(FORM_ERRORS.ALREADY_SUBMITTED);
        }

        // Upload to GCS (uses magic byte validation)
        const fileUrl = await uploadToGCS(req.file.buffer, req.file.originalname);

        if (!fileUrl) {
          return res.status(500).json({
            error: 'Failed to upload file',
            code: 'UPLOAD_FAILED'
          });
        }

        // Return metadata for richer client UI
        const result: FileUploadResult = {
          fileUrl,
          filename: req.file.originalname,
          size: req.file.size,
        };
        return res.json(result);
      } catch (error: any) {
        console.error('[Forms] Error uploading file:', error);
        return res.status(500).json({ error: 'Failed to upload file' });
      }
    }
  );

  // Submit public form
  app.post(
    "/api/forms/public/:token/submit",
    publicFormRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { token } = req.params;
        const { answers } = req.body;

        if (!Array.isArray(answers)) {
          return res.status(400).json({ error: 'Answers must be an array' });
        }

        const preflightInvitation = await db.query.formInvitations.findFirst({
          where: eq(formInvitations.token, token ?? ''),
        });
        if (!preflightInvitation) {
          return res.status(403).json(FORM_ERRORS.INVALID_TOKEN);
        }
        await requireFormSubjectAllowed(preflightInvitation);

        // Use transaction with row lock to prevent concurrent submissions
        await db.transaction(async (tx: any) => {
          // Lock invitation row
          const [invitation] = await tx.select()
            .from(formInvitations)
            .where(eq(formInvitations.token, token ?? ''))
            .for('update');

          if (!invitation) {
            throw { ...FORM_ERRORS.INVALID_TOKEN };
          }

          if (invitation.applicationId) {
            const decision = await tx.execute(sql`
              SELECT NOT (${sql.raw(privacyAllowedSql('application', 'a.id', { globalUse: false }))}) AS blocked
                FROM applications a
               WHERE a.id=${invitation.applicationId}
            `);
            if (decision.rows?.[0]?.blocked === true) {
              throw { ...FORM_ERRORS.INVALID_TOKEN };
            }
          }

          // Re-check expiry
          if (invitation.expiresAt < new Date()) {
            if (invitation.status === 'pending' || invitation.status === 'sent' || invitation.status === 'viewed') {
              await tx.update(formInvitations)
                .set({ status: 'expired' })
                .where(eq(formInvitations.id, invitation.id));
            }
            throw { ...FORM_ERRORS.EXPIRED };
          }

          // Check if already answered
          if (invitation.status === 'answered') {
            throw { ...FORM_ERRORS.ALREADY_SUBMITTED };
          }

          // Parse field snapshot for validation
          const snapshot: FormSnapshot = parseFormSnapshot(invitation.fieldSnapshot);
          const fields: readonly FormFieldSnapshot[] = snapshot.fields;

          // Validate answers against snapshot
          const typedAnswers: FormAnswer[] = answers;
          for (const field of fields) {
            const answer = typedAnswers.find((a) => a.fieldId === field.id);

            // Required field check
            if (field.required && (!answer || (!answer.value && !answer.fileUrl))) {
              throw {
                status: 400,
                error: `Field "${field.label}" is required`,
                code: 'VALIDATION_ERROR'
              };
            }

            // Type-specific validation
            if (answer?.value) {
              switch (field.type) {
                case 'email':
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (!emailRegex.test(answer.value)) {
                    throw {
                      status: 400,
                      error: `Invalid email format for "${field.label}"`,
                      code: 'VALIDATION_ERROR'
                    };
                  }
                  break;
                case 'select':
                  const options = parseSelectOptions(field.options);
                  if (options.length > 0 && !options.includes(answer.value)) {
                    throw {
                      status: 400,
                      error: `Invalid option selected for "${field.label}"`,
                      code: 'VALIDATION_ERROR'
                    };
                  }
                  break;
                case 'date':
                  if (isNaN(Date.parse(answer.value))) {
                    throw {
                      status: 400,
                      error: `Invalid date format for "${field.label}"`,
                      code: 'VALIDATION_ERROR'
                    };
                  }
                  break;
                case 'yes_no':
                  // Normalize and validate yes/no input
                  const normalizedValue = normalizeYesNoValue(answer.value);
                  if (!normalizedValue) {
                    throw {
                      status: 400,
                      error: `Invalid yes/no value for "${field.label}"`,
                      code: 'VALIDATION_ERROR'
                    };
                  }
                  break;
              }
            }
          }

          // Create response
          const [response] = await tx.insert(formResponses).values({
            invitationId: invitation.id,
            applicationId: invitation.applicationId,
            ...(invitation.organizationId != null && { organizationId: invitation.organizationId }),
          }).returning();

          // Save answers
          const answersData = answers.map((a: any) => ({
            responseId: response.id,
            fieldId: a.fieldId,
            value: a.value || null,
            fileUrl: a.fileUrl || null,
          }));

          await tx.insert(formResponseAnswers).values(answersData);

          // Mark invitation as answered
          await tx.update(formInvitations)
            .set({
              status: 'answered',
              answeredAt: new Date(),
            })
            .where(eq(formInvitations.id, invitation.id));
        });

        return res.json({
          success: true,
          message: 'Thank you! Your response has been submitted successfully.',
        });
      } catch (error: any) {
        // Handle custom errors from transaction
        if (error.status) {
          return res.status(error.status).json({
            error: error.error || error.message,
            code: error.code,
          });
        }

        console.error('[Forms] Error submitting public form:', error);
        return res.status(500).json({ error: 'Failed to submit form' });
      }
    }
  );

  // ==================== Response Endpoints ====================

  // List responses for an application
  app.get(
    "/api/forms/responses",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        const applicationId = parseInt(req.query.applicationId as string, 10);

        if (!applicationId) {
          return res.status(400).json({ error: 'applicationId query parameter is required' });
        }

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // Verify ownership: application → job.postedBy === req.user.id
        const application = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: { job: true },
        });

        if (!application) {
          return res.status(404).json({ error: 'Application not found' });
        }
        await requireFormSubjectAllowed(application);

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = application.job && await storage.isRecruiterOnJob(application.job.id, req.user!.id, userOrgId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized: You can only view responses for your own job postings' });
        }

        // Fetch all responses for this application
        const responses = await db.query.formResponses.findMany({
          where: eq(formResponses.applicationId, applicationId),
          with: {
            invitation: {
              with: {
                form: true,
              },
            },
          },
          orderBy: (responses: any, { desc }: any) => [desc(responses.submittedAt)],
        });

        // Map to include form name and submission summary
        const responseSummaries = responses.map((response: any) => {
          const snapshot: FormSnapshot = parseFormSnapshot(response.invitation.fieldSnapshot);
          return {
            id: response.id,
            formName: snapshot.formName,
            submittedAt: response.submittedAt,
            invitationId: response.invitationId,
            answeredAt: response.invitation.answeredAt,
          };
        });

        return res.json({ responses: responseSummaries });
      } catch (error: any) {
        console.error('[Forms] Error fetching responses:', error);
        return res.status(500).json({ error: 'Failed to fetch responses' });
      }
    }
  );

  // List all responses for a specific form template
  app.get(
    "/api/forms/:id/responses",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        const formId = parseReviewerShareId(req.params.id);
        if (!formId) return res.status(400).json({ error: 'INVALID_FORM_ID' });
        const result = await readAuthorizedResponsesForForm(
          req.user!.id,
          formId,
          { allowPlatformAdmin: true },
        );
        if (!result.ok) {
          const status = result.reason === 'unavailable' ? 503 : 404;
          return res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'FORM_NOT_FOUND' });
        }
        return res.json(result.value);
      } catch {
        return res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
      }
    }
  );

  // Get detailed response with Q/A
  app.get(
    "/api/forms/responses/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        const responseId = parseInt(req.params.id ?? '', 10);

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // Fetch response with invitation and answers
        const response = await db.query.formResponses.findFirst({
          where: eq(formResponses.id, responseId),
          with: {
            invitation: true,
            application: {
              with: { job: true },
            },
            answers: true,
          },
        });

        if (!response) {
          return res.status(404).json({ error: 'Response not found' });
        }

        // Verify ownership (use isRecruiterOnJob to include co-recruiters)
        const hasAccess = response.application?.job && await storage.isRecruiterOnJob(response.application.job.id, req.user!.id, userOrgId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized: You can only view responses for your own job postings' });
        }

        // Parse field snapshot to get field labels
        const snapshot: FormSnapshot = parseFormSnapshot(response.invitation.fieldSnapshot);
        const fieldsMap = new Map<number, FormFieldSnapshot>(
          snapshot.fields.map((f) => [f.id, f])
        );

        // Build Q/A array
        const questionsAndAnswers = response.answers.map((answer: any) => {
          const field = fieldsMap.get(answer.fieldId);
          return {
            fieldId: answer.fieldId,
            question: field?.label || 'Unknown field',
            fieldType: field?.type || 'unknown',
            answer: answer.value,
            fileUrl: answer.fileUrl,
          };
        });

        return res.json({
          id: response.id,
          formName: snapshot.formName,
          formDescription: snapshot.formDescription,
          submittedAt: response.submittedAt,
          candidateName: response.application.name,
          candidateEmail: response.application.email,
          questionsAndAnswers,
        });
      } catch (error: any) {
        console.error('[Forms] Error fetching response detail:', error);
        return res.status(500).json({ error: 'Failed to fetch response detail' });
      }
    }
  );

  // Export responses to CSV
  app.get(
    "/api/forms/export",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response) => {
      try {
        const applicationId = parseInt(req.query.applicationId as string, 10);
        const format = (req.query.format as string) || 'csv';

        if (!applicationId) {
          return res.status(400).json({ error: 'applicationId query parameter is required' });
        }

        if (format !== 'csv') {
          return res.status(400).json({ error: 'Only CSV format is supported at this time' });
        }

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // Verify ownership
        const application = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: { job: true },
        });

        if (!application) {
          return res.status(404).json({ error: 'Application not found' });
        }

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = application.job && await storage.isRecruiterOnJob(application.job.id, req.user!.id, userOrgId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized: You can only export responses for your own job postings' });
        }

        // Fetch all responses with answers
        const responses = await db.query.formResponses.findMany({
          where: eq(formResponses.applicationId, applicationId),
          with: {
            invitation: true,
            answers: true,
          },
          orderBy: (responses: any, { desc }: any) => [desc(responses.submittedAt)],
        });

        if (responses.length === 0) {
          return res.status(404).json({ error: 'No responses found for this application' });
        }

        // Build CSV
        const csvRows: string[] = [];

        // CSV header
        csvRows.push('Application ID,Candidate Name,Candidate Email,Form Name,Submitted At,Question,Answer,File URL');

        // CSV rows
        for (const response of responses) {
          const snapshot: FormSnapshot = parseFormSnapshot(response.invitation.fieldSnapshot);
          const fieldsMap = new Map<number, FormFieldSnapshot>(
            snapshot.fields.map((f) => [f.id, f])
          );

          for (const answer of response.answers) {
            const field = fieldsMap.get(answer.fieldId);
            const question = field?.label || 'Unknown field';

            // Escape CSV values (wrap in quotes and escape existing quotes)
            const escapeCsv = (val: any) => {
              if (val === null || val === undefined) return '';
              const str = String(val);
              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            };

            csvRows.push([
              applicationId,
              escapeCsv(application.name),
              escapeCsv(application.email),
              escapeCsv(snapshot.formName),
              response.submittedAt.toISOString(),
              escapeCsv(question),
              escapeCsv(answer.value),
              escapeCsv(answer.fileUrl),
            ].join(','));
          }
        }

        // Prepend BOM for Excel UTF-8 compatibility
        const csvContent = '\ufeff' + csvRows.join('\n');
        const filename = `form-responses-application-${applicationId}-${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvContent);
      } catch (error: any) {
        console.error('[Forms] Error exporting responses:', error);
        return res.status(500).json({ error: 'Failed to export responses' });
      }
    }
  );

  console.log('✅ Forms routes registered');
}
