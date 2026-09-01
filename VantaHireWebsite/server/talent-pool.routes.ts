import type { Express, Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth, requireRole, requireSeat } from "./auth";
import { storage } from "./storage";
import { getUserOrganization } from "./lib/organizationService";
import { z } from "zod";
import { requireNewCandidateIdentityAllowed } from "./candidate-privacy/decision";
import {
  createAuthorizedTalentPoolCandidate,
  listAuthorizedTalentPoolCandidates,
  parseTalentPoolId,
  readAuthorizedTalentPoolCandidate,
  readAuthorizedTalentPoolCreateContext,
  removeAuthorizedTalentPoolCandidate,
  restoreAuthorizedTalentPoolCandidate,
  TALENT_POOL_SOURCES,
  updateAuthorizedTalentPoolCandidate,
  type TalentPoolEffectivePatch,
  type TalentPoolObjectPolicy,
} from "./lib/talentPoolAuthorization";

// CSRF middleware import (use same pattern as other routes)
import { doubleCsrfProtection } from "./csrf";

const EXACT_OBJECT_POLICY: TalentPoolObjectPolicy = Object.freeze({ allowPlatformAdmin: true });

const createTalentPoolCandidateSchema = z.object({
  email: z.string().trim().email().max(255),
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).nullable().optional(),
  source: z.enum(TALENT_POOL_SOURCES).optional().default("manual"),
  notes: z.string().max(2000).nullable().optional(),
  resumeUrl: z.string().url().nullable().optional(),
}).strict();

const updateTalentPoolCandidateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  resumeUrl: z.string().url().nullable().optional(),
}).strict();

function sendTalentPoolError(
  res: Response,
  status: 400 | 403 | 404 | 409 | 503,
  code:
    | "INVALID_TALENT_POOL_ID"
    | "TALENT_POOL_ACCESS_DENIED"
    | "TALENT_POOL_CANDIDATE_NOT_FOUND"
    | "TALENT_POOL_CANDIDATE_EXISTS"
    | "TALENT_POOL_UPDATE_REQUIRED"
    | "TALENT_POOL_AUTHORIZATION_UNAVAILABLE",
): void {
  res.status(status).json({ error: code, code });
}

function sendActorResult(
  res: Response,
  result: { ok: false; reason: "forbidden" | "unavailable" },
): void {
  if (result.reason === "forbidden") {
    sendTalentPoolError(res, 403, "TALENT_POOL_ACCESS_DENIED");
    return;
  }
  sendTalentPoolError(res, 503, "TALENT_POOL_AUTHORIZATION_UNAVAILABLE");
}

function sendObjectResult(
  res: Response,
  result: { ok: false; reason: "forbidden" | "not_found" | "unavailable" | "conflict" },
): void {
  switch (result.reason) {
    case "forbidden":
      sendTalentPoolError(res, 403, "TALENT_POOL_ACCESS_DENIED");
      return;
    case "not_found":
      sendTalentPoolError(res, 404, "TALENT_POOL_CANDIDATE_NOT_FOUND");
      return;
    case "conflict":
      sendTalentPoolError(res, 409, "TALENT_POOL_CANDIDATE_EXISTS");
      return;
    default:
      sendTalentPoolError(res, 503, "TALENT_POOL_AUTHORIZATION_UNAVAILABLE");
  }
}

function identityIdentifiers(input: {
  email?: string | undefined;
  phone?: string | null | undefined;
}) {
  const identifiers: Array<{ identifier_type: "email" | "phone"; value: string }> = [];
  if (input.email) identifiers.push({ identifier_type: "email", value: input.email.trim().toLowerCase() });
  if (input.phone?.trim()) identifiers.push({ identifier_type: "phone", value: input.phone.trim() });
  return identifiers;
}

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
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const result = await listAuthorizedTalentPoolCandidates(req.user!.id);
        if (!result.ok) {
          sendActorResult(res, result);
          return;
        }
        res.json({ candidates: result.rows, total: result.rows.length });
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
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const candidateId = parseTalentPoolId(req.params.id);
        if (!candidateId) {
          sendTalentPoolError(res, 400, "INVALID_TALENT_POOL_ID");
          return;
        }
        const result = await readAuthorizedTalentPoolCandidate(req.user!.id, candidateId, EXACT_OBJECT_POLICY);
        if (!result.ok) {
          sendObjectResult(res, result);
          return;
        }
        res.json(result.value);
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
    requireSeat(),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const validation = createTalentPoolCandidateSchema.safeParse(req.body);
        if (!validation.success) {
          res.status(400).json({ error: "VALIDATION_ERROR", code: "VALIDATION_ERROR" });
          return;
        }
        const context = await readAuthorizedTalentPoolCreateContext(req.user!.id);
        if (!context.ok) {
          sendActorResult(res, context);
          return;
        }
        await requireNewCandidateIdentityAllowed(identityIdentifiers(validation.data));
        const result = await createAuthorizedTalentPoolCandidate(req.user!.id, validation.data);
        if (!result.ok) {
          sendObjectResult(res, result);
          return;
        }
        res.status(201).json(result.value);
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
    requireSeat(),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const candidateId = parseTalentPoolId(req.params.id);
        if (!candidateId) {
          sendTalentPoolError(res, 400, "INVALID_TALENT_POOL_ID");
          return;
        }
        const validation = updateTalentPoolCandidateSchema.safeParse(req.body);
        if (!validation.success) {
          res.status(400).json({ error: "VALIDATION_ERROR", code: "VALIDATION_ERROR" });
          return;
        }
        const patch: TalentPoolEffectivePatch = Object.fromEntries(
          Object.entries(validation.data).filter((entry): entry is [string, string] => entry[1] !== null),
        );
        if (Object.keys(patch).length === 0) {
          sendTalentPoolError(res, 400, "TALENT_POOL_UPDATE_REQUIRED");
          return;
        }
        const context = await readAuthorizedTalentPoolCandidate(req.user!.id, candidateId, EXACT_OBJECT_POLICY);
        if (!context.ok) {
          sendObjectResult(res, context);
          return;
        }
        const identityChanged = (
          patch.email !== undefined && patch.email.toLowerCase() !== context.value.email.toLowerCase()
        ) || (
          patch.phone !== undefined && patch.phone !== (context.value.phone ?? "")
        );
        if (identityChanged) {
          await requireNewCandidateIdentityAllowed(identityIdentifiers({ email: patch.email, phone: patch.phone }));
        }
        const result = await updateAuthorizedTalentPoolCandidate(
          req.user!.id,
          candidateId,
          patch,
          EXACT_OBJECT_POLICY,
        );
        if (!result.ok) {
          sendObjectResult(res, result);
          return;
        }
        res.json(result.value);
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
    requireSeat(),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const candidateId = parseTalentPoolId(req.params.id);
        if (!candidateId) {
          sendTalentPoolError(res, 400, "INVALID_TALENT_POOL_ID");
          return;
        }
        const result = await removeAuthorizedTalentPoolCandidate(
          req.user!.id,
          candidateId,
          randomUUID(),
          EXACT_OBJECT_POLICY,
        );
        if (!result.ok) {
          sendObjectResult(res, result);
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
    requireSeat(),
    csrf,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const candidateId = parseTalentPoolId(req.params.id);
        if (!candidateId) {
          sendTalentPoolError(res, 400, "INVALID_TALENT_POOL_ID");
          return;
        }
        const result = await restoreAuthorizedTalentPoolCandidate(
          req.user!.id,
          candidateId,
          randomUUID(),
          EXACT_OBJECT_POLICY,
        );
        if (!result.ok) {
          sendObjectResult(res, result);
          return;
        }
        res.json({
          candidate: result.value,
          message: 'Candidate restored to this organization’s talent pool',
        });
      } catch (error) {
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
