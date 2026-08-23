/**
 * Admin Routes Module
 *
 * All /api/admin/* endpoints for administrative functions:
 * - Job management (pending jobs, review, delete)
 * - User management
 * - Consultant management
 * - AI usage analytics
 * - Automation settings
 * - Form responses
 * - Feedback analytics
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sql, eq, and, desc, gte, inArray, or, isNull } from 'drizzle-orm';
import { db } from './db';
import { storage } from './storage';
import { requireRole } from './auth';
import { mergeDuplicatePipelineStagesForOrg, type MergeDuplicateStagesResult } from './lib/pipelineStageMerge';
import {
  userAiUsage,
  applicationFeedback,
  formResponses,
  formInvitations,
  forms,
  applications,
  users,
  emailAuditLog,
  automationEvents,
  automationSettings,
  applicationStageHistory,
  pipelineStages,
  emailTemplates,
  jobs,
  clients,
} from '@shared/schema';
import type { CsrfMiddleware } from './types/routes';
import { privacyAllowedSql } from './candidate-privacy/decision';

const applicationPrivacyAllowed = () => sql.raw(
  privacyAllowedSql('application', 'applications.id', { globalUse: false }),
);

/**
 * Register all admin routes
 */
export function registerAdminRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware
): void {
  const normalizeConsultant = (consultant: any) => ({
    ...consultant,
    domains: Array.isArray(consultant?.domains)
      ? consultant.domains.filter((domain: unknown): domain is string => typeof domain === 'string')
      : typeof consultant?.domains === 'string'
        ? consultant.domains.split(',').map((domain: string) => domain.trim()).filter(Boolean)
        : [],
  });

  // ============= ADMIN JOB MANAGEMENT =============

  // Get jobs by status for admin review
  app.get("/api/admin/jobs", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status = 'pending', page = 1, limit = 10 } = req.query;

      const result = await storage.getJobsByStatus(
        status as string,
        parseInt(page as string),
        parseInt(limit as string)
      );

      res.json({
        jobs: result.jobs,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: result.total,
          totalPages: Math.ceil(result.total / parseInt(limit as string))
        }
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  // Review a job (approve/decline)
  app.patch("/api/admin/jobs/:id/review", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const jobId = Number(idParam);
      const { status, reviewComments } = req.body;

      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: "Invalid ID parameter" });
        return;
      }

      if (!['approved', 'declined'].includes(status)) {
        res.status(400).json({ error: "Invalid status. Must be 'approved' or 'declined'" });
        return;
      }

      const job = await storage.reviewJob(jobId, status, reviewComments, req.user!.id);

      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      res.json(job);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Delete job (admin only)
  app.delete("/api/admin/jobs/:id", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const jobId = Number(idParam);

      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: "Invalid job ID" });
        return;
      }

      const success = await storage.deleteJob(jobId);

      if (!success) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      res.json({ message: "Job deleted successfully" });
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get all jobs with details for admin
  app.get("/api/admin/jobs/all", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobs = await storage.getAllJobsWithDetails();
      res.json(jobs);
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= ADMIN STATS & DASHBOARD =============

  // Get admin statistics
  app.get("/api/admin/stats", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await storage.getAdminStats();
      res.json(stats);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get all applications with details for admin
  app.get("/api/admin/applications/all", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const applications = await storage.getAllApplicationsWithDetails();
      res.json(applications);
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= ADMIN USER MANAGEMENT =============

  // Get all users for admin
  app.get("/api/admin/users", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await storage.getAllUsersWithDetails();
      res.json(users);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Update user role (admin only)
  app.patch("/api/admin/users/:id/role", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const userId = Number(idParam);
      const { role } = req.body;

      if (!Number.isFinite(userId) || userId <= 0 || !Number.isInteger(userId)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      if (!['candidate', 'recruiter', 'super_admin', 'hiring_manager'].includes(role)) {
        res.status(400).json({ error: "Invalid role. Must be candidate, recruiter, super_admin, or hiring_manager" });
        return;
      }

      const user = await storage.updateUserRole(userId, role);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json(user);
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= ADMIN AUTOMATION SETTINGS =============

  // Automation settings - Get all settings
  app.get("/api/admin/automation-settings", requireRole(['super_admin']), async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await storage.getAutomationSettings();
      res.json(settings);
      return;
    } catch (e) { next(e); }
  });

  // Automation settings - Update a specific setting
  app.patch("/api/admin/automation-settings/:key", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const keyParam = req.params.key;
      if (!keyParam) {
        res.status(400).json({ error: 'Missing key parameter' });
        return;
      }
      const key = keyParam;
      const { value } = req.body;

      // Whitelist valid automation setting keys to prevent arbitrary key injection
      const validKeys = [
        'auto_send_application_received',
        'auto_send_status_update',
        'auto_send_interview_invite',
        'auto_send_offer_letter',
        'auto_send_rejection',
        'notify_recruiter_new_application',
        'reminder_interview_upcoming',
      ];

      if (!validKeys.includes(key)) {
        res.status(400).json({ error: 'Invalid automation setting key' });
        return;
      }

      if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
      }

      const setting = await storage.updateAutomationSetting(key, value, req.user!.id);
      res.json(setting);
      return;
    } catch (e) { next(e); }
  });

  // ============= ADMIN AI USAGE =============

  // Get AI usage statistics
  app.get("/api/admin/ai/usage", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate, userId, kind } = req.query;

      // Build query conditions
      const conditions: any[] = [];

      if (startDate) {
        conditions.push(sql`${userAiUsage.computedAt} >= ${new Date(startDate as string)}`);
      }
      if (endDate) {
        conditions.push(sql`${userAiUsage.computedAt} <= ${new Date(endDate as string)}`);
      }
      if (userId) {
        const userIdNum = Number(userId);
        if (Number.isFinite(userIdNum) && userIdNum > 0) {
          conditions.push(eq(userAiUsage.userId, userIdNum));
        }
      }
      if (kind) {
        conditions.push(eq(userAiUsage.kind, kind as string));
      }

      // Get aggregated stats
      conditions.push(applicationPrivacyAllowed());
      const whereClause = and(...conditions);

      const usageRecords = await db
        .select({
          id: userAiUsage.id,
          userId: userAiUsage.userId,
          kind: userAiUsage.kind,
          tokensIn: userAiUsage.tokensIn,
          tokensOut: userAiUsage.tokensOut,
          costUsd: userAiUsage.costUsd,
          computedAt: userAiUsage.computedAt,
          metadata: userAiUsage.metadata,
          user: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(userAiUsage)
        .leftJoin(users, eq(userAiUsage.userId, users.id))
        .where(whereClause)
        .orderBy(desc(userAiUsage.computedAt))
        .limit(500);

      // Get summary stats
      const summaryResults = await db
        .select({
          kind: userAiUsage.kind,
          totalTokensIn: sql<number>`SUM(${userAiUsage.tokensIn})`.as('totalTokensIn'),
          totalTokensOut: sql<number>`SUM(${userAiUsage.tokensOut})`.as('totalTokensOut'),
          totalCost: sql<string>`SUM(${userAiUsage.costUsd})`.as('totalCost'),
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(userAiUsage)
        .where(whereClause)
        .groupBy(userAiUsage.kind);

      type SummaryRow = typeof summaryResults[number];
      type UsageRecord = typeof usageRecords[number];

      const summary = {
        byKind: summaryResults.reduce((acc: Record<string, { tokensIn: number; tokensOut: number; cost: number; count: number }>, row: SummaryRow) => {
          acc[row.kind] = {
            tokensIn: Number(row.totalTokensIn) || 0,
            tokensOut: Number(row.totalTokensOut) || 0,
            cost: parseFloat(row.totalCost || '0'),
            count: Number(row.count) || 0,
          };
          return acc;
        }, {}),
        total: {
          tokensIn: summaryResults.reduce((sum: number, r: SummaryRow) => sum + (Number(r.totalTokensIn) || 0), 0),
          tokensOut: summaryResults.reduce((sum: number, r: SummaryRow) => sum + (Number(r.totalTokensOut) || 0), 0),
          cost: summaryResults.reduce((sum: number, r: SummaryRow) => sum + parseFloat(r.totalCost || '0'), 0),
          count: summaryResults.reduce((sum: number, r: SummaryRow) => sum + (Number(r.count) || 0), 0),
        },
      };

      res.json({
        usage: usageRecords.map((record: UsageRecord) => ({
          ...record,
          user: record.user?.id ? record.user : null,
        })),
        summary,
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= ADMIN CONSULTANT MANAGEMENT =============

  // Admin: Get all consultants (including inactive)
  app.get("/api/admin/consultants", requireRole(['super_admin']), async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const consultants = await storage.getConsultants();
      res.json(consultants.map(normalizeConsultant));
      return;
    } catch (error) {
      next(error);
    }
  });

  // Admin: Create a new consultant
  app.post("/api/admin/consultants", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const consultantData = req.body;
      const consultant = await storage.createConsultant(consultantData);
      res.status(201).json(normalizeConsultant(consultant));
      return;
    } catch (error) {
      next(error);
    }
  });

  // Admin: Update a consultant
  app.patch("/api/admin/consultants/:id", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid ID parameter" });
        return;
      }

      const consultant = await storage.updateConsultant(id, req.body);
      if (!consultant) {
        res.status(404).json({ error: "Consultant not found" });
        return;
      }

      res.json(normalizeConsultant(consultant));
      return;
    } catch (error) {
      next(error);
    }
  });

  // Admin: Delete a consultant
  app.delete("/api/admin/consultants/:id", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid ID parameter" });
        return;
      }

      const deleted = await storage.deleteConsultant(id);
      if (!deleted) {
        res.status(404).json({ error: "Consultant not found" });
        return;
      }

      res.json({ success: true });
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= ADMIN FORM RESPONSES =============

  // Get all form responses (admin only)
  app.get("/api/admin/forms/responses", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page = '1', limit = '20', formId, status, search } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
      const offset = (pageNum - 1) * limitNum;

      const conditions: any[] = [];

      if (formId && formId !== 'all') {
        const formIdNum = parseInt(formId as string);
        if (Number.isFinite(formIdNum) && formIdNum > 0) {
          conditions.push(eq(formInvitations.formId, formIdNum));
        }
      }

      if (status && status !== 'all') {
        conditions.push(eq(formInvitations.status, status as string));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(formResponses)
        .innerJoin(formInvitations, eq(formResponses.invitationId, formInvitations.id))
        .innerJoin(applications, eq(formResponses.applicationId, applications.id))
        .where(whereClause);

      // Get responses with joins
      const query = db
        .select({
          id: formResponses.id,
          invitationId: formResponses.invitationId,
          applicationId: formResponses.applicationId,
          submittedAt: formResponses.submittedAt,
          formName: forms.name,
          formId: forms.id,
          candidateName: applications.name,
          candidateEmail: applications.email,
          status: formInvitations.status,
        })
        .from(formResponses)
        .innerJoin(formInvitations, eq(formResponses.invitationId, formInvitations.id))
        .innerJoin(applications, eq(formResponses.applicationId, applications.id))
        .innerJoin(forms, eq(formInvitations.formId, forms.id))
        .where(whereClause)
        .orderBy(desc(formResponses.submittedAt))
        .limit(limitNum)
        .offset(offset);

      let responses = await query;

      // Apply search filter in memory (for candidate name/email)
      if (search) {
        const searchLower = (search as string).toLowerCase();
        responses = responses.filter((r: { candidateName: string; candidateEmail: string }) =>
          r.candidateName.toLowerCase().includes(searchLower) ||
          r.candidateEmail.toLowerCase().includes(searchLower)
        );
      }

      // Get stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [statsResult] = await db
        .select({
          totalResponses: sql<number>`count(*)::int`,
          responsesToday: sql<number>`count(*) filter (where ${formResponses.submittedAt} >= ${today})::int`,
        })
        .from(formResponses)
        .innerJoin(applications, eq(formResponses.applicationId, applications.id))
        .where(applicationPrivacyAllowed());

      // Calculate completion rate (answered vs total invitations)
      const [invitationStats] = await db
        .select({
          totalInvitations: sql<number>`count(*)::int`,
          answeredInvitations: sql<number>`count(*) filter (where ${formInvitations.status} = 'answered')::int`,
        })
        .from(formInvitations);

      const completionRate = invitationStats.totalInvitations > 0
        ? (invitationStats.answeredInvitations / invitationStats.totalInvitations) * 100
        : 0;

      res.json({
        responses,
        total: countResult?.count || 0,
        page: pageNum,
        pageSize: limitNum,
        stats: {
          totalResponses: statsResult?.totalResponses || 0,
          responsesToday: statsResult?.responsesToday || 0,
          avgResponseTime: 0, // Would need invitation sentAt tracking
          completionRate: Math.round(completionRate),
        },
      });
      return;
    } catch (error) {
      console.error('[Admin Forms] Error fetching responses:', error);
      next(error);
    }
  });

  // Export form responses to CSV (admin only)
  app.get("/api/admin/forms/responses/export", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { formId, search } = req.query;
      const conditions: any[] = [];

      if (formId && formId !== 'all') {
        const formIdNum = parseInt(formId as string);
        if (Number.isFinite(formIdNum) && formIdNum > 0) {
          conditions.push(eq(formInvitations.formId, formIdNum));
        }
      }

      conditions.push(applicationPrivacyAllowed());
      const whereClause = and(...conditions);

      let responses = await db
        .select({
          id: formResponses.id,
          formName: forms.name,
          candidateName: applications.name,
          candidateEmail: applications.email,
          submittedAt: formResponses.submittedAt,
          status: formInvitations.status,
        })
        .from(formResponses)
        .innerJoin(formInvitations, eq(formResponses.invitationId, formInvitations.id))
        .innerJoin(applications, eq(formResponses.applicationId, applications.id))
        .innerJoin(forms, eq(formInvitations.formId, forms.id))
        .where(whereClause)
        .orderBy(desc(formResponses.submittedAt));

      // Apply search filter
      if (search) {
        const searchLower = (search as string).toLowerCase();
        responses = responses.filter((r: { candidateName: string; candidateEmail: string }) =>
          r.candidateName.toLowerCase().includes(searchLower) ||
          r.candidateEmail.toLowerCase().includes(searchLower)
        );
      }

      // Generate CSV
      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvRows = ['Response ID,Form Name,Candidate Name,Candidate Email,Status,Submitted At'];
      for (const r of responses) {
        csvRows.push([
          r.id,
          escapeCsv(r.formName),
          escapeCsv(r.candidateName),
          escapeCsv(r.candidateEmail),
          r.status,
          r.submittedAt ? new Date(r.submittedAt).toISOString() : '',
        ].join(','));
      }

      const csvContent = '\ufeff' + csvRows.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="form-responses-${Date.now()}.csv"`);
      res.send(csvContent);
      return;
    } catch (error) {
      console.error('[Admin Forms] Error exporting responses:', error);
      next(error);
    }
  });

  // ============= ADMIN FEEDBACK ANALYTICS =============

  // Get feedback analytics (admin only)
  app.get("/api/admin/feedback/analytics", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      const conditions: any[] = [];

      if (startDate) {
        conditions.push(sql`${applicationFeedback.createdAt} >= ${new Date(startDate as string)}`);
      }
      if (endDate) {
        conditions.push(sql`${applicationFeedback.createdAt} <= ${new Date(endDate as string)}`);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get all feedback
      const feedback = await db
        .select({
          id: applicationFeedback.id,
          applicationId: applicationFeedback.applicationId,
          score: applicationFeedback.overallScore,
          recommendation: applicationFeedback.recommendation,
          notes: applicationFeedback.notes,
          createdAt: applicationFeedback.createdAt,
          reviewerName: users.firstName,
        })
        .from(applicationFeedback)
        .leftJoin(users, eq(applicationFeedback.authorId, users.id))
        .where(whereClause)
        .orderBy(desc(applicationFeedback.createdAt))
        .limit(500);

      // Calculate stats
      type FeedbackRecord = { score: number | null; recommendation: string | null; createdAt: Date | null };
      const totalFeedback = feedback.length;
      const avgScore = totalFeedback > 0
        ? feedback.reduce((sum: number, f: FeedbackRecord) => sum + (f.score || 0), 0) / totalFeedback
        : 0;

      // Count by recommendation
      const byRecommendation = {
        advance: feedback.filter((f: FeedbackRecord) => f.recommendation === 'advance').length,
        hold: feedback.filter((f: FeedbackRecord) => f.recommendation === 'hold').length,
        reject: feedback.filter((f: FeedbackRecord) => f.recommendation === 'reject').length,
      };

      // Score distribution
      const scoreDistribution = {
        1: feedback.filter((f: FeedbackRecord) => f.score === 1).length,
        2: feedback.filter((f: FeedbackRecord) => f.score === 2).length,
        3: feedback.filter((f: FeedbackRecord) => f.score === 3).length,
        4: feedback.filter((f: FeedbackRecord) => f.score === 4).length,
        5: feedback.filter((f: FeedbackRecord) => f.score === 5).length,
      };

      // Feedback over time (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const feedbackByDay: Record<string, number> = {};
      feedback.forEach((f: FeedbackRecord) => {
        if (f.createdAt && new Date(f.createdAt) >= thirtyDaysAgo) {
          const day = new Date(f.createdAt).toISOString().split('T')[0];
          feedbackByDay[day!] = (feedbackByDay[day!] || 0) + 1;
        }
      });

      res.json({
        feedback: feedback.slice(0, 100), // Recent feedback
        stats: {
          totalFeedback,
          avgScore: Math.round(avgScore * 10) / 10,
          byRecommendation,
          scoreDistribution,
        },
        timeline: feedbackByDay,
      });
      return;
    } catch (error) {
      console.error('[Admin Feedback] Error fetching analytics:', error);
      next(error);
    }
  });

  // ============= OPERATIONS COMMAND CENTER =============

  /**
   * GET /api/admin/ops/summary
   * Merged endpoint for Operations Command Center dashboard
   * Returns: SLA metrics, automation activity, ops health
   */
  app.get("/api/admin/ops/summary", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { range = '7d', clientId } = req.query;

      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      switch (range) {
        case '24h': startDate.setHours(startDate.getHours() - 24); break;
        case '7d': startDate.setDate(startDate.getDate() - 7); break;
        case '30d': startDate.setDate(startDate.getDate() - 30); break;
        case '90d': startDate.setDate(startDate.getDate() - 90); break;
        default: startDate.setDate(startDate.getDate() - 7);
      }

      // Build client filter condition if provided
      const clientFilter = clientId ? eq(jobs.clientId, parseInt(clientId as string)) : undefined;

      // ============= SLA METRICS =============

      // Time to first touch: Average time from application to first stage change
      // Scoped to applications within the selected date range
      const applicationsInRange = await db
        .select({
          id: applications.id,
          appliedAt: applications.appliedAt,
          jobId: applications.jobId,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(gte(applications.appliedAt, startDate), clientFilter, applicationPrivacyAllowed()));

      const applicationIdsInRange = applicationsInRange.map((a: { id: number }) => a.id);

      // Get first touch times only for applications in range (avoids full table scan)
      const firstTouchQuery = applicationIdsInRange.length > 0
        ? await db
            .select({
              applicationId: applicationStageHistory.applicationId,
              firstTouchAt: sql<Date>`MIN(${applicationStageHistory.changedAt})`.as('firstTouchAt'),
            })
            .from(applicationStageHistory)
            .where(inArray(applicationStageHistory.applicationId, applicationIdsInRange))
            .groupBy(applicationStageHistory.applicationId)
        : [];

      // Use applicationsInRange for touch time calculation
      const applicationsWithTouch = applicationsInRange;

      // Calculate average time to first touch (in hours)
      let totalFirstTouchTime = 0;
      let firstTouchCount = 0;
      type FirstTouchRow = { applicationId: number; firstTouchAt: Date };
      const firstTouchMap = new Map(firstTouchQuery.map((f: FirstTouchRow) => [f.applicationId, f.firstTouchAt]));

      for (const app of applicationsWithTouch) {
        const firstTouch = firstTouchMap.get(app.id);
        if (firstTouch && app.appliedAt) {
          const firstTouchDate = firstTouch instanceof Date ? firstTouch : new Date(firstTouch as unknown as string);
          const appliedDate = app.appliedAt instanceof Date ? app.appliedAt : new Date(app.appliedAt as unknown as string);
          const touchTime = (firstTouchDate.getTime() - appliedDate.getTime()) / (1000 * 60 * 60);
          if (touchTime > 0 && touchTime < 720) { // Cap at 30 days
            totalFirstTouchTime += touchTime;
            firstTouchCount++;
          }
        }
      }
      const avgTimeToFirstTouchHours = firstTouchCount > 0 ? totalFirstTouchTime / firstTouchCount : 0;

      // Overdue applications (no touch > 48 hours)
      const overdueThreshold = new Date();
      overdueThreshold.setHours(overdueThreshold.getHours() - 48);

      const overdueAppsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .leftJoin(applicationStageHistory, eq(applications.id, applicationStageHistory.applicationId))
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          sql`${applications.appliedAt} < ${overdueThreshold}`,
          sql`${applicationStageHistory.id} IS NULL`,
          eq(applications.status, 'submitted'),
          clientFilter,
          applicationPrivacyAllowed(),
        ));
      const overdueApplications = overdueAppsResult[0]?.count || 0;

      // Overdue interviews (scheduled but no feedback > 5 days)
      const interviewFeedbackThreshold = new Date();
      interviewFeedbackThreshold.setDate(interviewFeedbackThreshold.getDate() - 5);

      const overdueInterviewsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .leftJoin(applicationFeedback, eq(applications.id, applicationFeedback.applicationId))
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          sql`${applications.interviewDate} IS NOT NULL`,
          sql`${applications.interviewDate} < ${interviewFeedbackThreshold}`,
          sql`${applicationFeedback.id} IS NULL`,
          clientFilter,
          applicationPrivacyAllowed(),
        ));
      const overdueInterviews = overdueInterviewsResult[0]?.count || 0;

      // Applications in pipeline (active status)
      const inPipelineResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          sql`${applications.status} NOT IN ('rejected', 'hired', 'withdrawn')`,
          clientFilter,
          applicationPrivacyAllowed(),
        ));
      const inPipeline = inPipelineResult[0]?.count || 0;

      // Offers out (applications with offer stage)
      const offerStage = await db
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(sql`LOWER(${pipelineStages.name}) LIKE '%offer%'`)
        .limit(1);

      let offersOut = 0;
      if (offerStage.length > 0) {
        const offersResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(applications)
          .innerJoin(jobs, eq(applications.jobId, jobs.id))
          .where(and(
            eq(applications.currentStage, offerStage[0].id),
            sql`${applications.stageChangedAt} >= ${startDate}`,
            clientFilter,
            applicationPrivacyAllowed(),
          ));
        offersOut = offersResult[0]?.count || 0;
      }

      // Hires in period
      const hiresResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          eq(applications.status, 'hired'),
          sql`${applications.updatedAt} >= ${startDate}`,
          clientFilter,
          applicationPrivacyAllowed(),
        ));
      const hires = hiresResult[0]?.count || 0;

      // ============= AUTOMATION ACTIVITY =============

      // Get recent automation events
      const recentAutomationEvents = await db
        .select({
          id: automationEvents.id,
          automationKey: automationEvents.automationKey,
          targetType: automationEvents.targetType,
          targetId: automationEvents.targetId,
          outcome: automationEvents.outcome,
          errorMessage: automationEvents.errorMessage,
          triggeredAt: automationEvents.triggeredAt,
          triggeredByName: users.firstName,
        })
        .from(automationEvents)
        .leftJoin(users, eq(automationEvents.triggeredBy, users.id))
        .where(sql`${automationEvents.triggeredAt} >= ${startDate}`)
        .orderBy(desc(automationEvents.triggeredAt))
        .limit(50);

      // Automation event summary
      const automationSummaryResult = await db
        .select({
          outcome: automationEvents.outcome,
          count: sql<number>`count(*)::int`,
        })
        .from(automationEvents)
        .where(sql`${automationEvents.triggeredAt} >= ${startDate}`)
        .groupBy(automationEvents.outcome);

      const automationSummary = {
        success: 0,
        failed: 0,
        skipped: 0,
      };
      type AutomationSummaryRow = { outcome: string; count: number };
      automationSummaryResult.forEach((r: AutomationSummaryRow) => {
        if (r.outcome === 'success') automationSummary.success = r.count;
        else if (r.outcome === 'failed') automationSummary.failed = r.count;
        else if (r.outcome === 'skipped') automationSummary.skipped = r.count;
      });

      // Get current automation settings
      const settings = await db
        .select({
          key: automationSettings.settingKey,
          value: automationSettings.settingValue,
          description: automationSettings.description,
        })
        .from(automationSettings);

      // ============= OPS HEALTH =============

      // Email stats
      const emailStatsResult = await db
        .select({
          status: emailAuditLog.status,
          count: sql<number>`count(*)::int`,
        })
        .from(emailAuditLog)
        .leftJoin(applications, eq(emailAuditLog.applicationId, applications.id))
        .where(and(
          sql`${emailAuditLog.sentAt} >= ${startDate}`,
          or(isNull(emailAuditLog.applicationId), applicationPrivacyAllowed()),
        ))
        .groupBy(emailAuditLog.status);

      const emailStats = {
        sent: 0,
        failed: 0,
      };
      type EmailStatsRow = { status: string; count: number };
      emailStatsResult.forEach((r: EmailStatsRow) => {
        if (r.status === 'success') emailStats.sent = r.count;
        else if (r.status === 'failed') emailStats.failed = r.count;
      });

      // Recent email failures
      const recentEmailFailures = await db
        .select({
          id: emailAuditLog.id,
          recipientEmail: emailAuditLog.recipientEmail,
          subject: emailAuditLog.subject,
          errorMessage: emailAuditLog.errorMessage,
          sentAt: emailAuditLog.sentAt,
        })
        .from(emailAuditLog)
        .leftJoin(applications, eq(emailAuditLog.applicationId, applications.id))
        .where(and(
          eq(emailAuditLog.status, 'failed'),
          sql`${emailAuditLog.sentAt} >= ${startDate}`,
          or(isNull(emailAuditLog.applicationId), applicationPrivacyAllowed()),
        ))
        .orderBy(desc(emailAuditLog.sentAt))
        .limit(10);

      // Rejection reason breakdown (for quality insights)
      const rejectionReasonResult = await db
        .select({
          reason: applications.rejectionReason,
          count: sql<number>`count(*)::int`,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          eq(applications.status, 'rejected'),
          sql`${applications.updatedAt} >= ${startDate}`,
          sql`${applications.rejectionReason} IS NOT NULL`,
          clientFilter,
          applicationPrivacyAllowed(),
        ))
        .groupBy(applications.rejectionReason);

      const rejectionReasons: Record<string, number> = {};
      type RejectionReasonRow = { reason: string | null; count: number };
      rejectionReasonResult.forEach((r: RejectionReasonRow) => {
        if (r.reason) rejectionReasons[r.reason] = r.count;
      });

      // ============= PIPELINE FUNNEL =============

      // Get all pipeline stages ordered
      const allStages = await db
        .select({
          id: pipelineStages.id,
          name: pipelineStages.name,
          order: pipelineStages.order,
          color: pipelineStages.color,
        })
        .from(pipelineStages)
        .orderBy(pipelineStages.order);

      // Get application counts per stage (within date range)
      const stageCountsQuery = await db
        .select({
          stageId: applications.currentStage,
          count: sql<number>`count(*)::int`,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          sql`${applications.appliedAt} >= ${startDate}`,
          clientFilter,
          applicationPrivacyAllowed(),
        ))
        .groupBy(applications.currentStage);

      type StageCountRow = { stageId: number | null; count: number };
      const stageCountMap = new Map(stageCountsQuery.map((s: StageCountRow) => [s.stageId, s.count]));

      // Get counts for terminal statuses (hired, rejected, withdrawn) - these don't have stages
      const terminalStatusesQuery = await db
        .select({
          status: applications.status,
          count: sql<number>`count(*)::int`,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          sql`${applications.appliedAt} >= ${startDate}`,
          sql`${applications.status} IN ('hired', 'rejected', 'withdrawn')`,
          clientFilter,
          applicationPrivacyAllowed(),
        ))
        .groupBy(applications.status);

      type TerminalStatusRow = { status: string; count: number };
      const terminalCounts: Record<string, number> = {};
      terminalStatusesQuery.forEach((r: TerminalStatusRow) => {
        terminalCounts[r.status] = r.count;
      });

      // Build funnel data with stages + terminal statuses
      type FunnelStage = { id: number; name: string; order: number; color: string; count: number; type: 'stage' | 'terminal' };
      type StageRow = { id: number; name: string; order: number; color: string | null };
      const funnelData: FunnelStage[] = allStages.map((stage: StageRow) => ({
        id: stage.id,
        name: stage.name,
        order: stage.order,
        color: stage.color || '#3b82f6',
        count: stageCountMap.get(stage.id) || 0,
        type: 'stage' as const,
      }));

      // Add terminal statuses at the end
      if (terminalCounts.hired) {
        funnelData.push({
          id: -1,
          name: 'Hired',
          order: 999,
          color: '#22c55e',
          count: terminalCounts.hired,
          type: 'terminal' as const,
        });
      }
      if (terminalCounts.rejected) {
        funnelData.push({
          id: -2,
          name: 'Rejected',
          order: 1000,
          color: '#ef4444',
          count: terminalCounts.rejected,
          type: 'terminal' as const,
        });
      }
      if (terminalCounts.withdrawn) {
        funnelData.push({
          id: -3,
          name: 'Withdrawn',
          order: 1001,
          color: '#94a3b8',
          count: terminalCounts.withdrawn,
          type: 'terminal' as const,
        });
      }

      // Calculate total applications for percentage calculation
      const totalApplications = funnelData.reduce((sum: number, stage: FunnelStage) => sum + stage.count, 0);

      // ============= CLIENT SUMMARIES =============

      // Get all clients with their metrics
      const allClients = await db
        .select({
          id: clients.id,
          name: clients.name,
          domain: clients.domain,
        })
        .from(clients)
        .orderBy(clients.name);

      // Get job counts per client
      const clientJobCounts = await db
        .select({
          clientId: jobs.clientId,
          activeJobs: sql<number>`count(*) FILTER (WHERE ${jobs.isActive} = true)::int`,
          totalJobs: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .where(sql`${jobs.clientId} IS NOT NULL`)
        .groupBy(jobs.clientId);

      type ClientJobCountRow = { clientId: number | null; activeJobs: number; totalJobs: number };
      const clientJobMap = new Map<number | null, { activeJobs: number; totalJobs: number }>(
        clientJobCounts.map((c: ClientJobCountRow) => [c.clientId, { activeJobs: c.activeJobs, totalJobs: c.totalJobs }])
      );

      // Get application metrics per client (via jobs)
      const clientAppMetrics = await db
        .select({
          clientId: jobs.clientId,
          inPipeline: sql<number>`count(*) FILTER (WHERE ${applications.status} NOT IN ('rejected', 'hired', 'withdrawn'))::int`,
          hired: sql<number>`count(*) FILTER (WHERE ${applications.status} = 'hired' AND ${applications.updatedAt} >= ${startDate})::int`,
          rejected: sql<number>`count(*) FILTER (WHERE ${applications.status} = 'rejected' AND ${applications.updatedAt} >= ${startDate})::int`,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(and(
          sql`${jobs.clientId} IS NOT NULL`,
          applicationPrivacyAllowed(),
        ))
        .groupBy(jobs.clientId);

      type ClientAppMetricRow = { clientId: number | null; inPipeline: number; hired: number; rejected: number };
      const clientAppMap = new Map<number | null, { inPipeline: number; hired: number; rejected: number }>(
        clientAppMetrics.map((c: ClientAppMetricRow) => [c.clientId, { inPipeline: c.inPipeline, hired: c.hired, rejected: c.rejected }])
      );

      // Build client summaries
      type ClientRow = { id: number; name: string; domain: string | null };
      const clientSummaries = allClients.map((client: ClientRow) => {
        const jobStats = clientJobMap.get(client.id) || { activeJobs: 0, totalJobs: 0 };
        const appStats = clientAppMap.get(client.id) || { inPipeline: 0, hired: 0, rejected: 0 };
        return {
          id: client.id,
          name: client.name,
          domain: client.domain,
          activeJobs: jobStats.activeJobs,
          totalJobs: jobStats.totalJobs,
          inPipeline: appStats.inPipeline,
          hired: appStats.hired,
          rejected: appStats.rejected,
        };
      });

      // ============= RESPONSE =============

      res.json({
        range,
        generatedAt: now.toISOString(),

        // KPI summary
        kpis: {
          hires,
          offersOut,
          inPipeline,
          slaWarnings: overdueApplications + overdueInterviews,
        },

        // SLA metrics
        sla: {
          avgTimeToFirstTouchHours: Math.round(avgTimeToFirstTouchHours * 10) / 10,
          overdueApplications,
          overdueInterviews,
        },

        // Automation
        automation: {
          settings,
          summary: automationSummary,
          recentEvents: recentAutomationEvents,
        },

        // Ops health
        health: {
          email: {
            ...emailStats,
            recentFailures: recentEmailFailures,
          },
          systemStatus: 'healthy', // Could add actual health checks
        },

        // Quality insights
        quality: {
          rejectionReasons,
        },

        // Pipeline funnel
        funnel: {
          stages: funnelData,
          totalApplications,
        },

        // Client summaries (for consulting mode)
        clients: clientSummaries,
      });
      return;
    } catch (error) {
      console.error('[Admin Ops] Error fetching summary:', error);
      next(error);
    }
  });

  /**
   * POST /api/admin/ops/automation-event
   * Log an automation event (for internal use by automation triggers)
   * Protected: requires super_admin role and CSRF token
   */
  app.post("/api/admin/ops/automation-event", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { automationKey, targetType, targetId, outcome, errorMessage, metadata, triggeredBy } = req.body;

      if (!automationKey || !targetType || !targetId) {
        res.status(400).json({ error: 'Missing required fields: automationKey, targetType, targetId' });
        return;
      }

      const [event] = await db.insert(automationEvents).values({
        automationKey,
        targetType,
        targetId,
        outcome: outcome || 'success',
        errorMessage,
        metadata,
        triggeredBy,
      }).returning();

      res.status(201).json(event);
      return;
    } catch (error) {
      console.error('[Admin Ops] Error logging automation event:', error);
      next(error);
    }
  });

  /**
   * POST /api/admin/applications/backfill-resume-text
   * Run backfill for applications.extracted_resume_text (admin only)
   */
  app.post("/api/admin/applications/backfill-resume-text", csrfProtection, requireRole(['super_admin']), async (_req: Request, res: Response): Promise<void> => {
    // The legacy helper performs provider-backed resume extraction across the
    // whole table and cannot enforce a directive that races the scan. Keep the
    // administrative registration fail-closed until a future exact lock gives
    // the backfill its own per-row load/pre-provider/pre-write contract.
    res.status(503).json({ code: 'candidate_privacy_reconciliation_required' });
  });

  // ============= ORGANIZATION ID BACKFILL & MONITORING =============

  /**
   * GET /api/admin/ops/org-health
   * Monitor NULL organization_id counts across tables
   * Use for alerting on data integrity issues
   */
  app.get("/api/admin/ops/org-health", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Count NULL organization_ids across key tables
      const [jobsNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(jobs).where(sql`organization_id IS NULL`);
      const [appsNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(applications).where(sql`organization_id IS NULL`);
      const [clientsNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(clients).where(sql`organization_id IS NULL`);

      // Additional tables: pipeline_stages, email_templates, forms, form_invitations, form_responses
      const [pipelineNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(pipelineStages).where(sql`organization_id IS NULL`);
      const [templatesNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(emailTemplates).where(sql`organization_id IS NULL`);
      const [formsNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(forms).where(sql`organization_id IS NULL`);
      const [formInvitationsNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(formInvitations).where(sql`organization_id IS NULL`);
      const [formResponsesNull] = await db.select({ count: sql<number>`count(*)::int` })
        .from(formResponses).where(sql`organization_id IS NULL`);

      // Count how many can be backfilled (user has org membership)
      const backfillableJobs = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM jobs j
        INNER JOIN organization_members om ON j.posted_by = om.user_id
        WHERE j.organization_id IS NULL
      `);
      // Apps backfillable = their job already has an org (matches actual backfill logic)
      const backfillableApps = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM applications a
        INNER JOIN jobs j ON a.job_id = j.id
        WHERE a.organization_id IS NULL
          AND j.organization_id IS NOT NULL
      `);
      const backfillableClients = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM clients c
        INNER JOIN organization_members om ON c.created_by = om.user_id
        WHERE c.organization_id IS NULL
      `);
      // Pipeline stages: exclude defaults (is_default = true or created_by IS NULL)
      const backfillablePipeline = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM pipeline_stages ps
        INNER JOIN organization_members om ON ps.created_by = om.user_id
        WHERE ps.organization_id IS NULL
          AND (ps.is_default IS NULL OR ps.is_default = false)
          AND ps.created_by IS NOT NULL
      `);
      // Email templates: exclude defaults (is_default = true or created_by IS NULL)
      const backfillableTemplates = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM email_templates et
        INNER JOIN organization_members om ON et.created_by = om.user_id
        WHERE et.organization_id IS NULL
          AND (et.is_default IS NULL OR et.is_default = false)
          AND et.created_by IS NOT NULL
      `);
      // Forms: backfill via created_by
      const backfillableForms = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM forms f
        INNER JOIN organization_members om ON f.created_by = om.user_id
        WHERE f.organization_id IS NULL
      `);
      // Form invitations: backfill via form FK (form must have org)
      const backfillableFormInvitations = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM form_invitations fi
        INNER JOIN forms f ON fi.form_id = f.id
        WHERE fi.organization_id IS NULL
          AND f.organization_id IS NOT NULL
      `);
      // Form responses: backfill via form invitation -> form FK
      const backfillableFormResponses = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM form_responses fr
        INNER JOIN form_invitations fi ON fr.invitation_id = fi.id
        INNER JOIN forms f ON fi.form_id = f.id
        WHERE fr.organization_id IS NULL
          AND f.organization_id IS NOT NULL
      `);

      // Get breakdown of orphaned records by user (users without org membership)
      const orphanedByUser = await db.execute(sql`
        SELECT
          u.id as user_id,
          u.username,
          u.first_name,
          u.last_name,
          COUNT(DISTINCT j.id)::int as orphaned_jobs,
          COUNT(DISTINCT c.id)::int as orphaned_clients
        FROM users u
        LEFT JOIN jobs j ON j.posted_by = u.id AND j.organization_id IS NULL
        LEFT JOIN clients c ON c.created_by = u.id AND c.organization_id IS NULL
        LEFT JOIN organization_members om ON u.id = om.user_id
        WHERE om.user_id IS NULL
          AND (j.id IS NOT NULL OR c.id IS NOT NULL)
        GROUP BY u.id, u.username, u.first_name, u.last_name
        ORDER BY orphaned_jobs DESC, orphaned_clients DESC
        LIMIT 10
      `);

      const result = {
        timestamp: new Date().toISOString(),
        nullCounts: {
          jobs: jobsNull.count,
          applications: appsNull.count,
          clients: clientsNull.count,
          pipelineStages: pipelineNull.count,
          emailTemplates: templatesNull.count,
          forms: formsNull.count,
          formInvitations: formInvitationsNull.count,
          formResponses: formResponsesNull.count,
        },
        backfillable: {
          jobs: (backfillableJobs.rows[0] as any)?.count || 0,
          applications: (backfillableApps.rows[0] as any)?.count || 0,
          clients: (backfillableClients.rows[0] as any)?.count || 0,
          pipelineStages: (backfillablePipeline.rows[0] as any)?.count || 0,
          emailTemplates: (backfillableTemplates.rows[0] as any)?.count || 0,
          forms: (backfillableForms.rows[0] as any)?.count || 0,
          formInvitations: (backfillableFormInvitations.rows[0] as any)?.count || 0,
          formResponses: (backfillableFormResponses.rows[0] as any)?.count || 0,
        },
        healthy: jobsNull.count === 0 && appsNull.count === 0 && clientsNull.count === 0 &&
                 pipelineNull.count === 0 && templatesNull.count === 0 && formsNull.count === 0 &&
                 formInvitationsNull.count === 0 && formResponsesNull.count === 0,
        orphanedByUser: {
          description: "Users without org membership who have orphaned records (top 10)",
          users: orphanedByUser.rows,
        },
      };

      res.json(result);
      return;
    } catch (error) {
      console.error('[Admin Ops] Error checking org health:', error);
      next(error);
    }
  });

  /**
   * POST /api/admin/ops/merge-duplicate-stages
   * Merge duplicate pipeline stages (same name) within an org, preferring org stages over defaults.
   * Dry run returns counts without mutating data.
   */
  app.post("/api/admin/ops/merge-duplicate-stages", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const bodySchema = z.object({
        orgId: z.number().int().positive(),
        dryRun: z.boolean().optional().default(true),
      });

      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', details: parsed.error.errors });
        return;
      }

      const { orgId, dryRun } = parsed.data;

      const result = await mergeDuplicatePipelineStagesForOrg(orgId, { dryRun });
      res.json({
        success: true,
        ...result,
      });
      return;

    } catch (error) {
      console.error('[Admin Ops] Error merging duplicate pipeline stages:', error);
      next(error);
    }
  });

  /**
   * POST /api/admin/ops/backfill-org-ids
   * Backfill NULL organization_ids for jobs, applications, and child tables
   * Idempotent - safe to run multiple times
   */
  app.post("/api/admin/ops/backfill-org-ids", csrfProtection, requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const bodySchema = z.object({
        dryRun: z.boolean().optional().default(false),
      });

      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', details: parsed.error.errors });
        return;
      }

      const { dryRun } = parsed.data;

      // 1. Check for duplicate memberships (precheck)
      const duplicates = await db.execute(sql`
        SELECT user_id, COUNT(*) as count
        FROM organization_members
        GROUP BY user_id
        HAVING COUNT(*) > 1
      `);

      if (duplicates.rows.length > 0) {
        res.status(400).json({
          error: 'Found users with multiple org memberships',
          duplicates: duplicates.rows,
        });
        return;
      }

      // 2. Count before
      const [jobsBefore] = await db.select({ count: sql<number>`count(*)::int` })
        .from(jobs).where(sql`organization_id IS NULL`);
      const [appsBefore] = await db.select({ count: sql<number>`count(*)::int` })
        .from(applications).where(sql`organization_id IS NULL`);
      const [clientsBefore] = await db.select({ count: sql<number>`count(*)::int` })
        .from(clients).where(sql`organization_id IS NULL`);

      // Count before for new tables
      const [pipelineBefore] = await db.select({ count: sql<number>`count(*)::int` })
        .from(pipelineStages).where(sql`organization_id IS NULL`);
      const [templatesBefore] = await db.select({ count: sql<number>`count(*)::int` })
        .from(emailTemplates).where(sql`organization_id IS NULL`);
      const [formsBefore] = await db.select({ count: sql<number>`count(*)::int` })
        .from(forms).where(sql`organization_id IS NULL`);

      const pipelineStageOrgRows = await db.execute(sql`
        SELECT DISTINCT om.organization_id as org_id
        FROM pipeline_stages ps
        INNER JOIN organization_members om ON ps.created_by = om.user_id
        WHERE ps.organization_id IS NULL
          AND (ps.is_default IS NULL OR ps.is_default = false)
          AND ps.created_by IS NOT NULL
      `);
      const pipelineStageOrgIds = pipelineStageOrgRows.rows
        .map((row: any) => Number(row.org_id))
        .filter((orgId: number) => Number.isInteger(orgId) && orgId > 0);

      const duplicateStageMergeResults: MergeDuplicateStagesResult[] = [];

      let jobsUpdated = 0;
      let appsUpdated = 0;
      let clientsUpdated = 0;
      let analyticsUpdated = 0;
      let auditUpdated = 0;
      let pipelineUpdated = 0;
      let templatesUpdated = 0;
      let formsUpdated = 0;
      let formInvitationsUpdated = 0;
      let formResponsesUpdated = 0;

      if (!dryRun) {
        // 3. Backfill jobs
        const jobsResult = await db.execute(sql`
          UPDATE jobs j
          SET organization_id = om.organization_id
          FROM organization_members om
          WHERE j.organization_id IS NULL
            AND j.posted_by = om.user_id
        `);
        jobsUpdated = jobsResult.rowCount ?? 0;

        // 4. Backfill applications
        const appsResult = await db.execute(sql`
          UPDATE applications a
          SET organization_id = j.organization_id
          FROM jobs j
          WHERE a.organization_id IS NULL
            AND a.job_id = j.id
            AND j.organization_id IS NOT NULL
        `);
        appsUpdated = appsResult.rowCount ?? 0;

        // 5. Backfill clients
        const clientsResult = await db.execute(sql`
          UPDATE clients c
          SET organization_id = om.organization_id
          FROM organization_members om
          WHERE c.organization_id IS NULL
            AND c.created_by = om.user_id
        `);
        clientsUpdated = clientsResult.rowCount ?? 0;

        // 6. Backfill child tables
        const analyticsResult = await db.execute(sql`
          UPDATE job_analytics ja
          SET organization_id = j.organization_id
          FROM jobs j
          WHERE ja.organization_id IS NULL
            AND ja.job_id = j.id
            AND j.organization_id IS NOT NULL
        `);
        analyticsUpdated = analyticsResult.rowCount ?? 0;

        const auditResult = await db.execute(sql`
          UPDATE job_audit_log jal
          SET organization_id = j.organization_id
          FROM jobs j
          WHERE jal.organization_id IS NULL
            AND jal.job_id = j.id
            AND j.organization_id IS NOT NULL
        `);
        auditUpdated = auditResult.rowCount ?? 0;

        // 7. Backfill pipeline_stages (exclude defaults)
        const pipelineResult = await db.execute(sql`
          UPDATE pipeline_stages ps
          SET organization_id = om.organization_id
          FROM organization_members om
          WHERE ps.organization_id IS NULL
            AND ps.created_by = om.user_id
            AND (ps.is_default IS NULL OR ps.is_default = false)
            AND ps.created_by IS NOT NULL
        `);
        pipelineUpdated = pipelineResult.rowCount ?? 0;

        if (pipelineStageOrgIds.length > 0) {
          for (const orgId of pipelineStageOrgIds) {
            const result = await mergeDuplicatePipelineStagesForOrg(orgId, { dryRun: false });
            if (result.duplicateGroups.length > 0) {
              duplicateStageMergeResults.push(result);
            }
          }
        }

        // 8. Backfill email_templates (exclude defaults)
        const templatesResult = await db.execute(sql`
          UPDATE email_templates et
          SET organization_id = om.organization_id
          FROM organization_members om
          WHERE et.organization_id IS NULL
            AND et.created_by = om.user_id
            AND (et.is_default IS NULL OR et.is_default = false)
            AND et.created_by IS NOT NULL
        `);
        templatesUpdated = templatesResult.rowCount ?? 0;

        // 9. Backfill forms
        const formsResult = await db.execute(sql`
          UPDATE forms f
          SET organization_id = om.organization_id
          FROM organization_members om
          WHERE f.organization_id IS NULL
            AND f.created_by = om.user_id
        `);
        formsUpdated = formsResult.rowCount ?? 0;

        // 10. Backfill form_invitations (via form join)
        const formInvitationsResult = await db.execute(sql`
          UPDATE form_invitations fi
          SET organization_id = f.organization_id
          FROM forms f
          WHERE fi.organization_id IS NULL
            AND fi.form_id = f.id
            AND f.organization_id IS NOT NULL
        `);
        formInvitationsUpdated = formInvitationsResult.rowCount ?? 0;

        // 11. Backfill form_responses (via form join)
        const formResponsesResult = await db.execute(sql`
          UPDATE form_responses fr
          SET organization_id = f.organization_id
          FROM form_invitations fi
          INNER JOIN forms f ON fi.form_id = f.id
          WHERE fr.organization_id IS NULL
            AND fr.invitation_id = fi.id
            AND f.organization_id IS NOT NULL
        `);
        formResponsesUpdated = formResponsesResult.rowCount ?? 0;
      } else if (pipelineStageOrgIds.length > 0) {
        for (const orgId of pipelineStageOrgIds) {
          const result = await mergeDuplicatePipelineStagesForOrg(orgId, { dryRun: true });
          if (result.duplicateGroups.length > 0) {
            duplicateStageMergeResults.push(result);
          }
        }
      }

      // 12. Count after
      const [jobsAfter] = await db.select({ count: sql<number>`count(*)::int` })
        .from(jobs).where(sql`organization_id IS NULL`);
      const [appsAfter] = await db.select({ count: sql<number>`count(*)::int` })
        .from(applications).where(sql`organization_id IS NULL`);
      const [clientsAfter] = await db.select({ count: sql<number>`count(*)::int` })
        .from(clients).where(sql`organization_id IS NULL`);
      const [pipelineAfter] = await db.select({ count: sql<number>`count(*)::int` })
        .from(pipelineStages).where(sql`organization_id IS NULL`);
      const [templatesAfter] = await db.select({ count: sql<number>`count(*)::int` })
        .from(emailTemplates).where(sql`organization_id IS NULL`);
      const [formsAfter] = await db.select({ count: sql<number>`count(*)::int` })
        .from(forms).where(sql`organization_id IS NULL`);

      res.json({
        success: true,
        dryRun,
        before: {
          jobsNull: jobsBefore.count,
          applicationsNull: appsBefore.count,
          clientsNull: clientsBefore.count,
          pipelineStagesNull: pipelineBefore.count,
          emailTemplatesNull: templatesBefore.count,
          formsNull: formsBefore.count,
        },
        updated: dryRun ? null : {
          jobs: jobsUpdated,
          applications: appsUpdated,
          clients: clientsUpdated,
          jobAnalytics: analyticsUpdated,
          jobAuditLog: auditUpdated,
          pipelineStages: pipelineUpdated,
          emailTemplates: templatesUpdated,
          forms: formsUpdated,
          formInvitations: formInvitationsUpdated,
          formResponses: formResponsesUpdated,
        },
        after: {
          jobsNull: dryRun ? jobsBefore.count : jobsAfter.count,
          applicationsNull: dryRun ? appsBefore.count : appsAfter.count,
          clientsNull: dryRun ? clientsBefore.count : clientsAfter.count,
          pipelineStagesNull: dryRun ? pipelineBefore.count : pipelineAfter.count,
          emailTemplatesNull: dryRun ? templatesBefore.count : templatesAfter.count,
          formsNull: dryRun ? formsBefore.count : formsAfter.count,
        },
        remaining: {
          description: 'Records that cannot be backfilled (user has no org membership or are system defaults)',
          jobsNull: dryRun ? jobsBefore.count : jobsAfter.count,
          applicationsNull: dryRun ? appsBefore.count : appsAfter.count,
          clientsNull: dryRun ? clientsBefore.count : clientsAfter.count,
          pipelineStagesNull: dryRun ? pipelineBefore.count : pipelineAfter.count,
          emailTemplatesNull: dryRun ? templatesBefore.count : templatesAfter.count,
          formsNull: dryRun ? formsBefore.count : formsAfter.count,
        },
        duplicateStageMerge: duplicateStageMergeResults,
      });
      return;
    } catch (error) {
      console.error('[Admin Ops] Error running org ID backfill:', error);
      next(error);
    }
  });

  console.log('✅ Admin routes registered');
}
