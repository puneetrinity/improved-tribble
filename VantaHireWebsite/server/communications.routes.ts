/**
 * Communications Routes Module
 *
 * All email and communication endpoints:
 * - Email templates CRUD (/api/email-templates)
 * - Send email to candidate (/api/applications/:id/send-email)
 * - AI-drafted emails (/api/email/draft)
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { storage } from './storage';
import { requireRole, requireSeat } from './auth';
import { getUserOrganization } from './lib/organizationService';
import { requireFeatureAccess, FEATURES } from './lib/featureGating';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from './candidate-privacy/decision';
import { queueMauticOutreachSync } from './lib/mauticService';
import {
  insertEmailTemplateSchema,
  type InsertEmailTemplate,
  emailTemplates,
} from '@shared/schema';
import { sendAuthorizedTemplatedEmail } from './emailTemplateService';
import { isAIEnabled, generateEmailDraft } from './aiJobAnalyzer';
import { calculateAiCost } from './lib/aiMatchingEngine';
import { aiAnalysisRateLimit } from './rateLimit';
import type { CsrfMiddleware } from './types/routes';
import {
  readAuthorizedEmailDraftContext,
  readAuthorizedManualEmailContext,
  recordAuthorizedEmailDraftUsage,
} from './lib/applicationAiOutboundAuthorization';

// Validation schemas
const updateEmailTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).optional(),
  templateType: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const sendEmailSchema = z.object({
  templateId: z.number().int().positive(),
  customizations: z.record(z.string()).optional(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).optional(),
});

const emailDraftSchema = z.object({
  templateId: z.number().int().positive(),
  applicationId: z.number().int().positive(),
  tone: z.enum(['friendly', 'formal']).optional().default('friendly'),
});

function parsePositiveDecimalApplicationId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Register all communication-related routes
 */
export function registerCommunicationsRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware
): void {
  // ============= EMAIL TEMPLATE ROUTES =============

  // Get all email templates - filtered by organization
  app.get("/api/email-templates", requireRole(['recruiter', 'super_admin']), requireSeat({ allowNoOrg: true }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : (orgResult?.organization.id ?? null);
      const list = await storage.getEmailTemplates(organizationId, req.user!.id);
      res.json(list);
      return;
    } catch (e) { next(e); }
  });

  // Create email template - with organizationId
  app.post("/api/email-templates", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = orgResult?.organization.id;

      const body = insertEmailTemplateSchema.parse(req.body as InsertEmailTemplate);
      const tpl = await storage.createEmailTemplate({
        ...body,
        createdBy: req.user!.id,
        ...(organizationId != null && { organizationId }),
      });
      res.status(201).json(tpl);
      return;
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: e.errors });
        return;
      }
      next(e);
    }
  });

  // Update email template (admin-only approval for default flag) - requires seat
  app.patch("/api/email-templates/:id", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgResult = await getUserOrganization(req.user!.id);
      const organizationId = req.user!.role === 'super_admin' && !orgResult ? undefined : orgResult?.organization.id;

      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: "Missing ID parameter" });
        return;
      }
      const templateId = Number(idParam);
      if (!Number.isFinite(templateId) || templateId <= 0 || !Number.isInteger(templateId)) {
        res.status(400).json({ error: "Invalid template ID" });
        return;
      }

      const parsed = updateEmailTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation error", details: parsed.error.errors });
        return;
      }

      const updates: Partial<InsertEmailTemplate> & { isDefault?: boolean } = {};

      // Copy editable fields
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject;
      if (parsed.data.body !== undefined) updates.body = parsed.data.body;
      if (parsed.data.templateType !== undefined) updates.templateType = parsed.data.templateType;

      // Only super_admins can approve/mark templates as default
      if (parsed.data.isDefault !== undefined) {
        if (req.user!.role !== "super_admin") {
          res.status(403).json({ error: "Only admins can approve email templates" });
          return;
        }
        updates.isDefault = parsed.data.isDefault;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "No updatable fields provided" });
        return;
      }

      const updateWhere = organizationId == null
        ? eq(emailTemplates.id, templateId)
        : and(eq(emailTemplates.id, templateId), eq(emailTemplates.organizationId, organizationId));

      const [updated] = await db
        .update(emailTemplates)
        .set(updates)
        .where(updateWhere)
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Email template not found" });
        return;
      }

      res.json(updated);
      return;
    } catch (e) {
      next(e);
    }
  });

  // ============= EMAIL SENDING ROUTES =============

  // Send email using template - requires seat
  app.post("/api/applications/:id/send-email", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response): Promise<void> => {
    try {
      const appId = parsePositiveDecimalApplicationId(req.params.id);
      if (appId === null) {
        res.status(400).json({ error: 'Invalid application ID', code: 'INVALID_APPLICATION_ID' });
        return;
      }
      const parsed = sendEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', details: parsed.error.errors });
        return;
      }
      const { templateId, customizations, subject, body } = parsed.data;
      const context = await readAuthorizedManualEmailContext(
        req.user!.id,
        appId,
        templateId,
        { allowPlatformAdmin: true },
      );
      if (!context.ok) {
        if (context.reason === 'not_found') {
          res.status(404).json({ error: 'Application not found', code: 'APPLICATION_NOT_FOUND' });
        } else {
          res.status(503).json({ error: 'Authorization unavailable', code: 'AUTHORIZATION_UNAVAILABLE' });
        }
        return;
      }
      const sendOptions = {
        customVariables: customizations || {},
        ...(subject ? { subjectOverride: subject } : {}),
        ...(body ? { bodyOverride: body } : {}),
      };
      await sendAuthorizedTemplatedEmail(context.value, sendOptions);
      queueMauticOutreachSync(req.user!.id, context.value.organizationId, 'email');
      res.json({ success: true });
      return;
    } catch (error) {
      if (error instanceof CandidatePrivacyRestrictedError) {
        res.status(503).json({ error: 'Candidate privacy restricted', code: error.code });
        return;
      }
      res.status(500).json({ error: 'Email send failed', code: 'EMAIL_SEND_FAILED' });
      return;
    }
  });

  // ============= AI EMAIL DRAFT ROUTES =============

  // Generate AI-drafted email from template - requires seat, AI feature access, and credits
  app.post("/api/email/draft", aiAnalysisRateLimit, csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), requireFeatureAccess(FEATURES.AI_CONTENT), async (req: Request, res: Response): Promise<void> => {
    try {
      // Check if AI features are enabled
      if (!isAIEnabled()) {
        res.status(503).json({ error: 'AI features are not enabled. Please configure GROQ_API_KEY.' });
        return;
      }

      // Validate request body
      const parsed = emailDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', details: parsed.error.errors });
        return;
      }

      const { templateId, applicationId, tone } = parsed.data;
      const startTime = Date.now();

      const context = await readAuthorizedEmailDraftContext(
        req.user!.id,
        applicationId,
        templateId,
        { allowPlatformAdmin: true },
      );
      if (!context.ok) {
        if (context.reason === 'not_found') {
          res.status(404).json({ error: 'Application not found', code: 'APPLICATION_NOT_FOUND' });
        } else {
          res.status(503).json({ error: 'Authorization unavailable', code: 'AUTHORIZATION_UNAVAILABLE' });
        }
        return;
      }

      await requireCandidatePrivacyAllowed(
        { type: 'application', id: context.value.applicationId },
        { globalUse: false },
      );
      const draftResult = await generateEmailDraft(
        context.value.templateSubject,
        context.value.templateBody,
        context.value.candidateName,
        context.value.candidateEmail,
        context.value.jobTitle,
        'VantaHire',
        tone,
      );
      const durationMs = Date.now() - startTime;
      const costUsd = calculateAiCost(draftResult.tokensUsed.input, draftResult.tokensUsed.output);
      const usage = await recordAuthorizedEmailDraftUsage(
        req.user!.id,
        applicationId,
        {
          templateId,
          tone,
          tokensIn: draftResult.tokensUsed.input,
          tokensOut: draftResult.tokensUsed.output,
          costUsd,
          durationMs,
        },
        { allowPlatformAdmin: true },
      );
      if (!usage.ok) {
        if (usage.reason === 'not_found') {
          res.status(404).json({ error: 'Application not found', code: 'APPLICATION_NOT_FOUND' });
        } else {
          res.status(503).json({ error: 'Authorization unavailable', code: 'AUTHORIZATION_UNAVAILABLE' });
        }
        return;
      }

      res.json({
        subject: draftResult.subject,
        body: draftResult.body,
      });
      return;
    } catch (error) {
      if (error instanceof CandidatePrivacyRestrictedError) {
        res.status(503).json({ error: 'Candidate privacy restricted', code: error.code });
        return;
      }
      res.status(500).json({ error: 'AI email draft failed', code: 'AI_EMAIL_DRAFT_FAILED' });
      return;
    }
  });

  console.log('✅ Communications routes registered');
}
