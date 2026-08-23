import type { Express, Request, Response, NextFunction } from "express";
import { requireAuth, requireRole, requireSeat } from "./auth";
import { storage } from "./storage";
import { getUserOrganization } from "./lib/organizationService";
import { z } from "zod";
import { insertTalentPoolSchema } from "@shared/schema";

// CSRF middleware import (use same pattern as other routes)
import { doubleCsrfProtection } from "./csrf";

export function registerTalentPoolRoutes(app: Express) {
  const csrf = doubleCsrfProtection;

  // ============= TALENT POOL MANAGEMENT ROUTES =============

  /**
   * GET /api/talent-pool
   * List all talent pool candidates for the current recruiter
   */
  app.get(
    "/api/talent-pool",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat({ allowNoOrg: true }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const recruiterId = req.user!.id;
        const candidates = await storage.getTalentPoolByRecruiter(recruiterId);

        res.json({
          candidates,
          total: candidates.length,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/talent-pool/:id
   * Get a single talent pool candidate by ID
   */
  app.get(
    "/api/talent-pool/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat({ allowNoOrg: true }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing candidate ID' });
          return;
        }
        const id = parseInt(idParam, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: 'Invalid candidate ID' });
          return;
        }

        const candidate = await storage.getTalentPoolCandidate(id);
        if (!candidate) {
          res.status(404).json({ error: 'Candidate not found' });
          return;
        }

        // Verify ownership
        if (candidate.recruiterId !== req.user!.id && req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Not authorized to view this candidate' });
          return;
        }

        res.json(candidate);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/talent-pool
   * Manually add a candidate to talent pool
   */
  app.post(
    "/api/talent-pool",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const bodySchema = insertTalentPoolSchema.extend({
          source: z.enum(['external_form', 'manual', 'import']).optional().default('manual'),
        });

        const validation = bodySchema.safeParse(req.body);
        if (!validation.success) {
          res.status(400).json({ error: 'Validation error', details: validation.error.errors });
          return;
        }

        const { email, name, phone, source, notes, resumeUrl } = validation.data;

        // Get user's organization
        const orgResult = await getUserOrganization(req.user!.id);

        // Check for duplicate
        const existing = await storage.getTalentPoolByEmail(req.user!.id, email);
        if (existing) {
          res.status(409).json({
            error: 'A candidate with this email already exists in your talent pool',
            existingId: existing.id,
          });
          return;
        }

        const candidate = await storage.createTalentPoolCandidate({
          email,
          name,
          phone,
          source,
          notes,
          resumeUrl,
          recruiterId: req.user!.id,
          ...(orgResult?.organization.id != null && { organizationId: orgResult.organization.id }),
        });

        res.status(201).json(candidate);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * PUT /api/talent-pool/:id
   * Update a talent pool candidate
   */
  app.put(
    "/api/talent-pool/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing candidate ID' });
          return;
        }
        const id = parseInt(idParam, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: 'Invalid candidate ID' });
          return;
        }

        // Verify candidate exists and user has access
        const existing = await storage.getTalentPoolCandidate(id);
        if (!existing) {
          res.status(404).json({ error: 'Candidate not found' });
          return;
        }

        if (existing.recruiterId !== req.user!.id && req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Not authorized to update this candidate' });
          return;
        }

        const updateSchema = z.object({
          name: z.string().min(1).max(255).optional(),
          email: z.string().email().max(255).optional(),
          phone: z.string().max(50).optional().nullable(),
          notes: z.string().max(2000).optional().nullable(),
          resumeUrl: z.string().url().optional().nullable(),
        });

        const validation = updateSchema.safeParse(req.body);
        if (!validation.success) {
          res.status(400).json({ error: 'Validation error', details: validation.error.errors });
          return;
        }

        // If email is being changed, check for duplicates
        if (validation.data.email && validation.data.email !== existing.email) {
          const duplicate = await storage.getTalentPoolByEmail(req.user!.id, validation.data.email);
          if (duplicate && duplicate.id !== id) {
            res.status(409).json({
              error: 'A candidate with this email already exists in your talent pool',
              existingId: duplicate.id,
            });
            return;
          }
        }

        // Build update object - convert null to undefined for InsertTalentPool compatibility
        const updateData: Partial<{ name: string; email: string; phone: string; notes: string; resumeUrl: string }> = {};
        if (validation.data.name !== undefined) updateData.name = validation.data.name;
        if (validation.data.email !== undefined) updateData.email = validation.data.email;
        // Convert null to undefined for optional fields (InsertTalentPool uses undefined, not null)
        if (validation.data.phone !== undefined && validation.data.phone !== null) updateData.phone = validation.data.phone;
        if (validation.data.notes !== undefined && validation.data.notes !== null) updateData.notes = validation.data.notes;
        if (validation.data.resumeUrl !== undefined && validation.data.resumeUrl !== null) updateData.resumeUrl = validation.data.resumeUrl;

        const updated = await storage.updateTalentPoolCandidate(id, updateData);
        if (!updated) {
          res.status(500).json({ error: 'Failed to update candidate' });
          return;
        }

        res.json(updated);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * DELETE /api/talent-pool/:id
   * Remove a candidate from this organization's talent pool. This never
   * globally deletes or opts the person out.
   */
  app.delete(
    "/api/talent-pool/:id",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing candidate ID' });
          return;
        }
        const id = parseInt(idParam, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: 'Invalid candidate ID' });
          return;
        }

        // Verify candidate exists and user has access
        const existing = await storage.getTalentPoolCandidate(id);
        if (!existing) {
          res.status(404).json({ error: 'Candidate not found' });
          return;
        }

        if (existing.recruiterId !== req.user!.id && req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Not authorized to remove this organization’s pool membership' });
          return;
        }

        const removed = await storage.removeTalentPoolCandidate(id, req.user!.id);
        if (!removed) {
          res.status(409).json({ error: 'Candidate is already removed from this organization’s talent pool' });
          return;
        }

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  /** Restore a previously removed organization-local pool membership. */
  app.post(
    "/api/talent-pool/:id/restore",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'Invalid candidate ID' });
          return;
        }
        const existing = await storage.getRemovedTalentPoolCandidate(id);
        if (!existing) {
          res.status(404).json({ error: 'Candidate not found' });
          return;
        }
        if (existing.recruiterId !== req.user!.id && req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Not authorized to restore this organization’s pool membership' });
          return;
        }
        const restored = await storage.restoreTalentPoolCandidate(id, req.user!.id);
        if (!restored) {
          res.status(404).json({ error: 'Candidate not found' });
          return;
        }
        res.json({
          candidate: restored,
          message: 'Candidate restored to this organization’s talent pool',
        });
      } catch (error: any) {
        if (error?.code === '23505') {
          res.status(409).json({ error: 'An active pool membership already exists for this candidate' });
          return;
        }
        next(error);
      }
    },
  );

  /**
   * POST /api/talent-pool/:id/convert
   * Convert a talent pool candidate to a job application
   */
  app.post(
    "/api/talent-pool/:id/convert",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing candidate ID' });
          return;
        }
        const id = parseInt(idParam, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: 'Invalid candidate ID' });
          return;
        }

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        const bodySchema = z.object({
          jobId: z.number().int().positive(),
          deleteFromPool: z.boolean().optional().default(false),
        });

        const validation = bodySchema.safeParse(req.body);
        if (!validation.success) {
          res.status(400).json({ error: 'Validation error', details: validation.error.errors });
          return;
        }

        const { jobId, deleteFromPool } = validation.data;

        // Verify candidate exists and user has access
        const candidate = await storage.getTalentPoolCandidate(id);
        if (!candidate) {
          res.status(404).json({ error: 'Candidate not found' });
          return;
        }

        if (candidate.recruiterId !== req.user!.id && req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Not authorized to convert this candidate' });
          return;
        }

        // Verify job exists and user has access
        const job = await storage.getJob(jobId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
        if (!hasAccess) {
          res.status(403).json({ error: 'Not authorized to add applications to this job' });
          return;
        }

        // Check if candidate already applied to this job
        const existingApplication = await storage.getApplicationByEmailAndJob(candidate.email, jobId);
        if (existingApplication) {
          res.status(409).json({
            error: 'This candidate has already applied to this job',
            applicationId: existingApplication.id,
          });
          return;
        }

        // Convert to application
        const result = await storage.convertTalentPoolToApplication(
          id,
          jobId,
          req.user!.id,
          deleteFromPool,
        );
        if (!result) {
          res.status(500).json({ error: 'Failed to convert candidate to application' });
          return;
        }

        res.status(201).json({
          application: result.application,
          talentPoolCandidate: deleteFromPool ? null : result.talentPool,
          message: deleteFromPool
            ? 'Candidate converted to application and removed from this organization’s talent pool'
            : 'Candidate converted to application (still in this organization’s talent pool)',
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/jobs/:jobId/talent-pool/suggestions
   * Get talent pool candidates that might be good fits for a job
   */
  app.get(
    "/api/jobs/:jobId/talent-pool/suggestions",
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobIdParam = req.params.jobId;
        if (!jobIdParam) {
          res.status(400).json({ error: 'Missing job ID' });
          return;
        }
        const jobId = parseInt(jobIdParam, 10);
        if (isNaN(jobId) || jobId <= 0) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        // Get user's organization for access control
        const orgResult = await getUserOrganization(req.user!.id);
        const userOrgId = orgResult?.organization.id;

        // Verify job exists and user has access
        const job = await storage.getJob(jobId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        // Use isRecruiterOnJob to check access (includes co-recruiters)
        const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
        if (!hasAccess) {
          res.status(403).json({ error: 'Not authorized to view suggestions for this job' });
          return;
        }

        // Get all talent pool candidates for this recruiter
        const candidates = await storage.getTalentPoolByRecruiter(req.user!.id);

        // Filter out candidates who have already applied to this job
        const suggestions = [];
        for (const candidate of candidates) {
          const existingApp = await storage.getApplicationByEmailAndJob(candidate.email, jobId);
          if (!existingApp) {
            suggestions.push(candidate);
          }
        }

        res.json({
          suggestions,
          total: suggestions.length,
          jobTitle: job.title,
        });
      } catch (error) {
        next(error);
      }
    }
  );
}
