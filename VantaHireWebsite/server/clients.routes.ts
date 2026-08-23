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
      const { token } = req.params;

      if (!token) {
        res.status(400).json({ error: 'Missing token' });
        return;
      }

      const shortlistData = await storage.getClientShortlistByToken(token);

      if (!shortlistData.shortlist || !shortlistData.client || !shortlistData.job) {
        res.status(410).json({ error: 'Shortlist not found or expired' });
        return;
      }

      // Environment controls for what clients can see
      const showResume = process.env.CLIENT_SHORTLIST_SHOW_RESUME !== 'false'; // default: true
      const showAiSummary = process.env.CLIENT_SHORTLIST_SHOW_AI_SUMMARY !== 'false'; // default: true

      // Return sanitized data (no internal IDs, emails, etc.)
      const candidates = shortlistData.items.map((item, index) => ({
        id: item.application.id,
        name: item.application.name,
        email: item.application.email,
        phone: item.application.phone || null,
        position: item.position,
        notes: item.notes,
        // Conditionally include resume URL for download
        resumeUrl: showResume ? (item.application.resumeUrl || null) : null,
        coverLetter: item.application.coverLetter || null,
        appliedAt: item.application.appliedAt,
        // Conditionally include AI summary
        aiSummary: showAiSummary ? (item.application.aiSummary || null) : null,
        aiFitLabel: showAiSummary ? (item.application.aiFitLabel || null) : null,
      }));

      res.json({
        title: shortlistData.shortlist.title || shortlistData.job.title,
        message: shortlistData.shortlist.message,
        client: {
          name: shortlistData.client.name,
        },
        job: {
          title: shortlistData.job.title,
          location: shortlistData.job.location,
          type: shortlistData.job.type,
        },
        candidates,
        createdAt: shortlistData.shortlist.createdAt,
        expiresAt: shortlistData.shortlist.expiresAt,
      });
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
      const { token } = req.params;

      if (!token) {
        res.status(400).json({ error: 'Missing token' });
        return;
      }

      // Verify shortlist exists and is active
      const shortlistData = await storage.getClientShortlistByToken(token);

      if (!shortlistData.shortlist || !shortlistData.client) {
        res.status(410).json({ error: 'Shortlist not found or expired' });
        return;
      }

      // Parse feedback (can be single or multiple)
      const feedbackArray = Array.isArray(req.body) ? req.body : [req.body];

      const savedFeedback = [];
      for (const feedbackData of feedbackArray) {
        const parsed = insertClientFeedbackSchema.parse(feedbackData);

        // Verify application is in this shortlist
        const inShortlist = shortlistData.items.some(
          item => item.application.id === parsed.applicationId
        );

        if (!inShortlist) {
          res.status(400).json({
            error: `Application ${parsed.applicationId} is not in this shortlist`
          });
          return;
        }

        const feedback = await storage.addClientFeedback({
          ...parsed,
          clientId: shortlistData.client.id,
          shortlistId: shortlistData.shortlist.id,
          ...(shortlistData.shortlist.organizationId != null && { organizationId: shortlistData.shortlist.organizationId }),
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
   * GET /api/client-shortlist/:token/resume/:applicationId
   * Download resume for a candidate in a shortlist (public, no auth required)
   * Only allows download if the application is in the shortlist
   */
  app.get("/api/client-shortlist/:token/resume/:applicationId", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, applicationId } = req.params;

      if (!token || !applicationId) {
        res.status(400).json({ error: 'Missing parameters' });
        return;
      }

      // Check if resume download is enabled
      if (process.env.CLIENT_SHORTLIST_SHOW_RESUME === 'false') {
        res.status(403).json({ error: 'Resume download is disabled' });
        return;
      }

      const appId = Number(applicationId);
      if (!Number.isFinite(appId) || appId <= 0) {
        res.status(400).json({ error: 'Invalid application ID' });
        return;
      }

      // Verify shortlist exists and application is in it
      const shortlistData = await storage.getClientShortlistByToken(token);
      if (!shortlistData.shortlist || !shortlistData.items) {
        res.status(404).json({ error: 'Shortlist not found' });
        return;
      }

      const item = shortlistData.items.find(i => i.application.id === appId);
      if (!item) {
        res.status(403).json({ error: 'Application not in this shortlist' });
        return;
      }

      const application = item.application;
      if (!application.resumeUrl) {
        res.status(404).json({ error: 'No resume available' });
        return;
      }

      const url = application.resumeUrl;

      // Stream PDF through server
      if (url.startsWith('gs://')) {
        try {
          const { downloadFromGCS } = await import('./gcs-storage');
          const buffer = await downloadFromGCS(url);
          const filename = application.resumeFilename ||
            `${application.name.replace(/[^a-zA-Z0-9]/g, '_')}_resume.pdf`;
          const ext = filename.split('.').pop()?.toLowerCase() || 'pdf';
          const contentType = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';

          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', buffer.length);
          res.send(buffer);
          return;
        } catch (gcsError) {
          console.error('[Client Shortlist Resume] GCS download failed:', gcsError);
          res.status(500).json({ error: 'Failed to retrieve resume' });
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
  app.get("/api/applications/:id/client-feedback", requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const applicationId = Number(req.params.id);

      if (!Number.isFinite(applicationId) || applicationId <= 0) {
        res.status(400).json({ error: 'Invalid application ID' });
        return;
      }

      const feedback = await storage.getClientFeedbackForApplication(applicationId);
      res.json(feedback);
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
