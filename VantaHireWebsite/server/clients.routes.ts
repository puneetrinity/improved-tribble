/**
 * Clients Routes Module
 *
 * All client and shortlist-related endpoints:
 * - Client CRUD (/api/clients)
 * - Client shortlists (/api/client-shortlists, /api/client-shortlist/:token)
 * - Client feedback on candidates
 * - Job-specific shortlist listing
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { sql, inArray, eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { storage } from './storage';
import { requireAuth, requireRole, requireSeat } from './auth';
import {
  insertClientSchema,
  insertClientShortlistSchema,
  insertClientFeedbackSchema,
  clientShortlistItems,
  clientFeedback,
  applications,
  type InsertClient,
} from '@shared/schema';
import type { CsrfMiddleware } from './types/routes';
import { getUserOrganization } from './lib/organizationService';
import { updateMemberActivity } from './lib/membershipService';
import { privacyAllowedSql } from './candidate-privacy/decision';
import {
  parseCandidateRef,
  parseReviewerShareId,
  parseShortlistToken,
  readAuthorizedClientFeedback,
  readPublicClientShortlist,
  readPublicResumeLocator,
  resolvePublicFeedbackTarget,
} from './lib/reviewerShareAuthorization';

const applicationPrivacyAllowed = () => sql.raw(
  privacyAllowedSql('application', 'applications.id', { globalUse: false }),
);

// Validation schema for client updates
const updateClientSchema = insertClientSchema.partial();

/**
 * Register all client-related routes
 */
export function registerClientsRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware
): void {
  // ============= CLIENT MANAGEMENT ROUTES =============

  // Get all clients (recruiter/admin) - filtered by organization
  app.get("/api/clients", requireRole(['recruiter', 'super_admin']), requireSeat({ allowNoOrg: true }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Get user's organization for data isolation
      const orgResult = await getUserOrganization(req.user!.id);
      // Super admin without org can see all
      const organizationId = req.user!.role === 'super_admin' && !orgResult
        ? undefined  // super_admin sees all
        : orgResult?.organization.id ?? null;

      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const clients = await storage.getClients(organizationId, req.user!.id);

      const filtered = search
        ? clients.filter((client) => {
            const haystack = `${client.name} ${client.domain ?? ''} ${client.primaryContactName ?? ''} ${client.primaryContactEmail ?? ''}`.toLowerCase();
            return haystack.includes(search.toLowerCase());
          })
        : clients;

      res.json(filtered);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Create a new client
  app.post("/api/clients", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Get user's organization
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult && req.user!.role === 'recruiter') {
        res.status(400).json({ error: 'You must be part of an organization to create clients' });
        return;
      }
      const organizationId = orgResult?.organization.id ?? 0; // Super admins may not have org

      if (req.user!.role === 'recruiter') {
        await updateMemberActivity(req.user!.id);
      }

      const body = insertClientSchema.parse(req.body as InsertClient);
      const client = await storage.createClient({
        ...body,
        createdBy: req.user!.id,
        organizationId,
      });
      res.status(201).json(client);
      return;
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  });

  // Update an existing client - with organization verification
  app.patch("/api/clients/:id", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const clientId = Number(idParam);
      if (!Number.isFinite(clientId) || clientId <= 0 || !Number.isInteger(clientId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      // Verify client exists and belongs to user's organization
      const client = await storage.getClient(clientId);
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }

      // Organization verification (super_admin can update any)
      if (req.user!.role !== 'super_admin') {
        const orgResult = await getUserOrganization(req.user!.id);
        const ownsLegacy = client.organizationId == null && client.createdBy === req.user!.id;
        if (!orgResult) {
          if (!ownsLegacy) {
            res.status(403).json({ error: 'Access denied: client belongs to another organization' });
            return;
          }
        } else if (client.organizationId !== orgResult.organization.id && !ownsLegacy) {
          res.status(403).json({ error: 'Access denied: client belongs to another organization' });
          return;
        }
      }

      const parsed = updateClientSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }

      const updates = parsed.data as Partial<InsertClient>;
      const updated = await storage.updateClient(clientId, updates);
      if (!updated) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }

      res.json(updated);
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= CLIENT SHORTLIST ROUTES =============

  /**
   * POST /api/client-shortlists
   * Create a new client shortlist for sharing candidates
   * Requires: recruiter or admin role
   */
  app.post("/api/client-shortlists", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = insertClientShortlistSchema.parse(req.body);

      // Verify client exists and job has that clientId
      const client = await storage.getClient(body.clientId);
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }

      const job = await storage.getJob(body.jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      if (job.clientId !== body.clientId) {
        res.status(400).json({ error: 'Job is not associated with this client' });
        return;
      }

      // Create shortlist
      const shortlist = await storage.createClientShortlist({
        clientId: body.clientId,
        jobId: body.jobId,
        applicationIds: body.applicationIds,
        shareResume: body.shareResume,
        shareAiSummary: body.shareAiSummary,
        ...(body.title ? { title: body.title } : {}),
        ...(body.message ? { message: body.message } : {}),
        ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
        createdBy: req.user!.id,
        ...(job.organizationId != null && { organizationId: job.organizationId }),
      });

      // Return shortlist with public URL
      const publicUrl = `/client-shortlist/${shortlist.token}`;
      res.status(201).json({
        ...shortlist,
        publicUrl,
        fullUrl: `${req.protocol}://${req.get('host')}${publicUrl}`,
      });
      return;
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  });

  /**
   * GET /api/client-shortlist/:token
   * View a client shortlist (public, no auth required)
   */
  app.get("/api/client-shortlist/:token", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = parseShortlistToken(req.params.token);
      if (!token) {
        res.status(400).json({ error: 'INVALID_SHORTLIST_TOKEN' });
        return;
      }
      const result = await readPublicClientShortlist(
        token,
        process.env.CLIENT_SHORTLIST_SHOW_RESUME !== 'false',
        process.env.CLIENT_SHORTLIST_SHOW_AI_SUMMARY !== 'false',
      );
      if (!result.ok) {
        const status = result.reason === 'unavailable' ? 503 : 410;
        res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'SHORTLIST_UNAVAILABLE' });
        return;
      }
      res.json(result.value);
      return;
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/client-shortlist/:token/feedback
   * Submit client feedback on candidates (public, no auth required)
   */
  app.post("/api/client-shortlist/:token/feedback", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = parseShortlistToken(req.params.token);
      if (!token) {
        res.status(400).json({ error: 'INVALID_SHORTLIST_TOKEN' });
        return;
      }

      // Parse feedback (can be single or multiple)
      const feedbackArray = Array.isArray(req.body) ? req.body : [req.body];

      const savedFeedback = [];
      for (const feedbackData of feedbackArray) {
        const parsed = insertClientFeedbackSchema.parse(feedbackData);
        const candidateRef = parseCandidateRef(parsed.candidateRef);
        if (!candidateRef) {
          res.status(400).json({ error: 'INVALID_CANDIDATE_REFERENCE' });
          return;
        }
        const target = await resolvePublicFeedbackTarget(token, candidateRef);
        if (!target.ok) {
          const status = target.reason === 'unavailable' ? 503 : 404;
          res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'CANDIDATE_NOT_FOUND' });
          return;
        }
        const feedback = await storage.addClientFeedback({
          applicationId: target.value.applicationId,
          recommendation: parsed.recommendation,
          ...(parsed.notes !== undefined && { notes: parsed.notes }),
          ...(parsed.rating !== undefined && { rating: parsed.rating }),
          clientId: target.value.clientId,
          shortlistId: target.value.shortlistId,
          organizationId: target.value.organizationId,
        });

        savedFeedback.push(feedback);
      }

      res.status(201).json({
        success: true,
        count: savedFeedback.length,
        message: 'Feedback submitted successfully',
      });
      return;
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  });

  /**
   * GET /api/client-shortlist/:token/resume/:candidateRef
   * Download resume for a candidate in a shortlist (public, no auth required)
   * Only allows download if the application is in the shortlist
   */
  app.get("/api/client-shortlist/:token/resume/:candidateRef", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = parseShortlistToken(req.params.token);
      const candidateRef = parseCandidateRef(req.params.candidateRef);
      if (!token || !candidateRef) {
        res.status(400).json({ error: 'INVALID_RESUME_REFERENCE' });
        return;
      }
      const result = await readPublicResumeLocator(
        token,
        candidateRef,
        process.env.CLIENT_SHORTLIST_SHOW_RESUME !== 'false',
      );
      if (!result.ok) {
        const status = result.reason === 'unavailable' ? 503 : 404;
        res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'RESUME_NOT_FOUND' });
        return;
      }
      const { locator: url, filename: authorizedFilename, candidateName } = result.value;

      // Stream PDF through server
      if (url.startsWith('gs://')) {
        try {
          const { downloadFromGCS } = await import('./gcs-storage');
          const buffer = await downloadFromGCS(url);
          const filename = authorizedFilename ||
            `${candidateName.replace(/[^a-zA-Z0-9]/g, '_')}_resume.pdf`;
          const ext = filename.split('.').pop()?.toLowerCase() || 'pdf';
          const contentType = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';

          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', buffer.length);
          res.send(buffer);
          return;
        } catch {
          res.status(503).json({ error: 'RESUME_UNAVAILABLE' });
          return;
        }
      } else if (/^https?:\/\//i.test(url)) {
        // External URL - redirect
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

  /**
   * GET /api/applications/:id/client-feedback
   * Get client feedback for an application (requires auth)
  */
  app.get("/api/applications/:id/client-feedback", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const applicationId = parseReviewerShareId(req.params.id);
      if (!applicationId) {
        res.status(400).json({ error: 'INVALID_APPLICATION_ID' });
        return;
      }
      const result = await readAuthorizedClientFeedback(
        req.user!.id,
        applicationId,
        { allowPlatformAdmin: true },
      );
      if (!result.ok) {
        const status = result.reason === 'unavailable' ? 503 : 404;
        res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'APPLICATION_NOT_FOUND' });
        return;
      }
      res.json(result.rows);
      return;
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/jobs/:id/client-shortlists
   * Returns all client shortlists for a given job (recruiter/admin)
   */
  app.get("/api/jobs/:id/client-shortlists", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      // Get user's organization for access control
      const orgResult = await getUserOrganization(req.user!.id);
      const userOrgId = orgResult?.organization.id;

      // Verify job access (use isRecruiterOnJob to include co-recruiters)
      const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const shortlists = await storage.getClientShortlistsByJob(jobId);
      const shortlistIds = shortlists.map((s) => s.id);

      let countsByShortlistId: Record<number, number> = {};
      if (shortlistIds.length > 0) {
        const counts: { shortlistId: number; count: number }[] = await db
          .select({
            shortlistId: clientShortlistItems.shortlistId,
            count: sql<number>`COUNT(${clientShortlistItems.id})::int`,
          })
          .from(clientShortlistItems)
          .innerJoin(applications, eq(clientShortlistItems.applicationId, applications.id))
          .where(and(
            inArray(clientShortlistItems.shortlistId, shortlistIds),
            applicationPrivacyAllowed(),
          ))
          .groupBy(clientShortlistItems.shortlistId);

        countsByShortlistId = counts.reduce((acc: Record<number, number>, row) => {
          acc[row.shortlistId] = row.count;
          return acc;
        }, {} as Record<number, number>);
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;

      const responsePayload = shortlists.map((s) => ({
        id: s.id,
        title: s.title,
        message: s.message,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        status: s.status,
        client: s.client ? { id: s.client.id, name: s.client.name } : null,
        candidateCount: countsByShortlistId[s.id] ?? 0,
        publicUrl: `/client-shortlist/${s.token}`,
        fullUrl: `${baseUrl}/client-shortlist/${s.token}`,
      }));

      res.json(responsePayload);
      return;
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/jobs/:id/client-feedback-analytics
   * Get client feedback analytics for a job (recruiters only)
   */
  app.get("/api/jobs/:id/client-feedback-analytics", requireAuth, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing job ID' });
        return;
      }
      const jobId = Number(idParam);
      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: 'Invalid job ID' });
        return;
      }

      // Get user's organization for access control
      const orgResult = await getUserOrganization(req.user!.id);
      const userOrgId = orgResult?.organization.id;

      // Verify job access
      const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Get all shortlists for this job
      const shortlists = await storage.getClientShortlistsByJob(jobId);
      const shortlistIds = shortlists.map((s) => s.id);

      // Count candidates sent to clients
      let totalCandidatesSent = 0;
      if (shortlistIds.length > 0) {
        const countResult = await db
          .select({ count: sql<number>`COUNT(DISTINCT ${clientShortlistItems.applicationId})::int` })
          .from(clientShortlistItems)
          .innerJoin(applications, eq(clientShortlistItems.applicationId, applications.id))
          .where(and(
            inArray(clientShortlistItems.shortlistId, shortlistIds),
            applicationPrivacyAllowed(),
          ));
        totalCandidatesSent = countResult[0]?.count ?? 0;
      }

      // Get client feedback breakdown by recommendation
      const feedbackBreakdown = await db
        .select({
          recommendation: clientFeedback.recommendation,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(clientFeedback)
        .innerJoin(applications, eq(clientFeedback.applicationId, applications.id))
        .where(and(eq(applications.jobId, jobId), applicationPrivacyAllowed()))
        .groupBy(clientFeedback.recommendation);

      const feedbackCounts = {
        advance: 0,
        hold: 0,
        reject: 0,
      };
      for (const row of feedbackBreakdown) {
        if (row.recommendation === 'advance') feedbackCounts.advance = row.count;
        else if (row.recommendation === 'hold') feedbackCounts.hold = row.count;
        else if (row.recommendation === 'reject') feedbackCounts.reject = row.count;
      }

      const totalFeedback = feedbackCounts.advance + feedbackCounts.hold + feedbackCounts.reject;

      // Get shortlist details with feedback counts
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const shortlistDetails = await Promise.all(shortlists.map(async (s) => {
        // Count items in this shortlist
        const itemCount = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(clientShortlistItems)
          .innerJoin(applications, eq(clientShortlistItems.applicationId, applications.id))
          .where(and(
            eq(clientShortlistItems.shortlistId, s.id),
            applicationPrivacyAllowed(),
          ));

        // Count feedback for this shortlist
        const feedbackCount = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(clientFeedback)
          .innerJoin(applications, eq(clientFeedback.applicationId, applications.id))
          .where(and(
            eq(clientFeedback.shortlistId, s.id),
            applicationPrivacyAllowed(),
          ));

        return {
          id: s.id,
          title: s.title,
          status: s.status,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          candidateCount: itemCount[0]?.count ?? 0,
          feedbackCount: feedbackCount[0]?.count ?? 0,
          fullUrl: `${baseUrl}/client-shortlist/${s.token}`,
        };
      }));

      res.json({
        totalShortlists: shortlists.length,
        totalCandidatesSent,
        totalFeedback,
        feedbackBreakdown: feedbackCounts,
        shortlists: shortlistDetails,
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  console.log('✅ Clients routes registered');
}
