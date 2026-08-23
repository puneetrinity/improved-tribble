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
import { getAiCreditExhaustionPayload, hasEnoughCredits, useCredits } from './lib/creditService';
import { requireCandidatePrivacyAllowed } from './candidate-privacy/decision';
import { queueMauticOutreachSync } from './lib/mauticService';
import {
  insertEmailTemplateSchema,
  type InsertEmailTemplate,
  emailTemplates,
  userAiUsage,
} from '@shared/schema';
import { sendTemplatedEmail } from './emailTemplateService';
import { isAIEnabled, generateEmailDraft } from './aiJobAnalyzer';
import { calculateAiCost } from './lib/aiMatchingEngine';
import { aiAnalysisRateLimit } from './rateLimit';
import type { CsrfMiddleware } from './types/routes';

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
  app.post("/api/applications/:id/send-email", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
      const parsed = sendEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', details: parsed.error.errors });
        return;
      }
      const { templateId, customizations, subject, body } = parsed.data;
      const appData = await storage.getApplication(appId);
      if (!appData) {
        res.status(404).json({ error: 'application not found' });
        return;
      }
      const [tpl] = (await storage.getEmailTemplates(appData.organizationId ?? null, req.user!.id)).filter(t => t.id === templateId);
      if (!tpl) {
        res.status(404).json({ error: 'template not found' });
        return;
      }
      const sendOptions = {
        customVariables: customizations || {},
        ...(subject ? { subjectOverride: subject } : {}),
        ...(body ? { bodyOverride: body } : {}),
      };
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: appData.id },
        { globalUse: false },
      );
      await sendTemplatedEmail(appId, templateId, sendOptions);
      queueMauticOutreachSync(req.user!.id, appData.organizationId ?? null, 'email');
      res.json({ success: true });
      return;
    } catch (e) { next(e); }
  });

  // ============= AI EMAIL DRAFT ROUTES =============

  // Generate AI-drafted email from template - requires seat, AI feature access, and credits
  app.post("/api/email/draft", aiAnalysisRateLimit, csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), requireFeatureAccess(FEATURES.AI_CONTENT), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if AI features are enabled
      if (!isAIEnabled()) {
        res.status(503).json({ error: 'AI features are not enabled. Please configure GROQ_API_KEY.' });
        return;
      }

      // Check AI credits for recruiters
      if (req.user!.role === 'recruiter') {
        const creditCheck = await hasEnoughCredits(req.user!.id, 1);
        if (!creditCheck) {
          res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, 1));
          return;
        }
      }

      // Validate request body
      const parsed = emailDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', details: parsed.error.errors });
        return;
      }

      const { templateId, applicationId, tone } = parsed.data;
      const startTime = Date.now();

      // 1. Fetch application
      const application = await storage.getApplication(applicationId);
      if (!application) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }

      // 2. Fetch job details
      const job = await storage.getJob(application.jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      // 3. Fetch email template
      const templates = await storage.getEmailTemplates(job.organizationId ?? null, req.user!.id);
      const template = templates.find((t: any) => t.id === templateId);
      if (!template) {
        res.status(404).json({ error: 'Email template not found' });
        return;
      }

      // 4. Generate AI draft
      const draftResult = await generateEmailDraft(
        template.subject,
        template.body,
        application.name,
        application.email,
        job.title,
        'VantaHire',
        tone
      );

      await requireCandidatePrivacyAllowed(
        { type: 'application', id: application.id },
        { globalUse: false },
      );

      const durationMs = Date.now() - startTime;

      // 5. Calculate cost using shared Groq pricing
      const costUsd = calculateAiCost(draftResult.tokensUsed.input, draftResult.tokensUsed.output);

      // 6. Track AI usage for billing/analytics
      await db.insert(userAiUsage).values({
        userId: req.user!.id,
        kind: 'email_draft',
        tokensIn: draftResult.tokensUsed.input,
        tokensOut: draftResult.tokensUsed.output,
        costUsd,
        metadata: {
          applicationId,
          templateId,
          jobTitle: job.title,
          candidateName: application.name,
          tone,
          durationMs,
        },
        ...(job.organizationId != null && { organizationId: job.organizationId }),
      });

      // 7. Deduct credit for recruiters
      if (req.user!.role === 'recruiter') {
        await useCredits(req.user!.id, 1);
      }

      // 8. Return the drafted email
      res.json({
        subject: draftResult.subject,
        body: draftResult.body,
      });
      return;
    } catch (e) {
      console.error('[Email Draft] Error generating AI draft:', e);
      next(e);
    }
  });

  console.log('✅ Communications routes registered');
}
