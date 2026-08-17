/**
 * Jobs Routes Module
 *
 * All job management and analytics endpoints:
 * - Job CRUD (/api/jobs)
 * - Job status management
 * - Job analytics and metrics
 * - AI job analysis and scoring
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { storage } from './storage';
import { requireAuth, requireRole, requireSeat } from './auth';
import { insertJobSchema, applications, applicationStageHistory, jobs, pipelineStages, users, jobRecruiters } from '@shared/schema';
import { getUserOrganization } from './lib/organizationService';
import { updateMemberActivity } from './lib/membershipService';
import { queueMauticFirstJobCreatedSync } from './lib/mauticService';
import { getHiringMetrics } from './lib/analyticsHelper';
import { requireFeatureAccess, FEATURES } from './lib/featureGating';
import {
  analyzeJobDescription,
  generateJobScore,
  calculateOptimizationSuggestions,
  enhancePipelineActions,
  isAIEnabled,
} from './aiJobAnalyzer';
import { aiAnalysisRateLimit, jobPostingRateLimit } from './rateLimit';
import type { CsrfMiddleware } from './types/routes';
import { db } from './db';
import { and, eq, gte, lte, inArray, or, desc, sql } from 'drizzle-orm';
import { extractStructuredJobPosting } from './lib/structuredJobExtraction';

const MIN_DESCRIPTION_WORDS = 200;
const countWords = (value: string): number =>
  value
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

/** Check if a string is a numeric ID */
function isNumericId(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * Parse job identifier from URL parameter.
 * Supports: numeric ID, pure slug, or legacy id-slug format (e.g., "123-senior-developer")
 */
function parseJobIdentifier(param: string): { type: 'id' | 'slug'; value: string | number } {
  // Check for pure numeric ID
  if (/^\d+$/.test(param)) {
    return { type: 'id', value: Number(param) };
  }

  // Check for legacy id-slug format (e.g., "123-senior-developer")
  const idSlugMatch = param.match(/^(\d+)-(.+)$/);
  if (idSlugMatch) {
    // For backwards compatibility, use the numeric ID for lookup
    return { type: 'id', value: Number(idSlugMatch[1]) };
  }

  // Treat as pure slug
  return { type: 'slug', value: param };
}

/**
 * Register all job-related routes
 */
export function registerJobsRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware
): void {
  // ============= JOB CRUD ROUTES =============

  // Create a new job posting (recruiters/admins only)
  app.post("/api/jobs", jobPostingRateLimit, csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Block unverified recruiters from posting jobs
      if (req.user!.role === 'recruiter' && !req.user!.emailVerified) {
        res.status(403).json({
          error: 'Email verification required to post jobs',
          code: 'EMAIL_NOT_VERIFIED',
        });
        return;
      }

      // Get user's organization - required for all job creation
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        res.status(400).json({ error: 'You must be part of an organization to create jobs' });
        return;
      }
      const organizationId = orgResult.organization.id;

      // Update member activity
      await updateMemberActivity(req.user!.id);

      const rawDescription = typeof req.body?.original_JD === 'string'
        ? req.body.original_JD
        : typeof req.body?.description === 'string'
          ? req.body.description
          : '';
      const providedExtractedDescription = typeof req.body?.original_JD === 'string'
        && typeof req.body?.description === 'string'
        && req.body.description.trim() !== rawDescription.trim()
        ? req.body.description
        : undefined;

      if (countWords(rawDescription) < 200) {
        res.status(400).json({
          error: 'Validation error',
          details: [{ field: 'original_JD', message: 'Description must be at least 200 words' }],
        });
        return;
      }

      console.log('Original JD:', rawDescription);

      if (providedExtractedDescription) {
        console.log('Extracted JD:', providedExtractedDescription);

        const jobData = insertJobSchema.parse({
          ...req.body,
          description: providedExtractedDescription,
          originalJD: rawDescription,
        });
        const job = await storage.createJob({
          ...jobData,
          postedBy: req.user!.id,
          organizationId,
        });

        queueMauticFirstJobCreatedSync(req.user!.id, organizationId);

        res.status(201).json(job);
        return;
      }

      const extractedResult = await extractStructuredJobPosting(rawDescription, {
        title: typeof req.body?.title === 'string' ? req.body.title : undefined,
        location: typeof req.body?.location === 'string' ? req.body.location : undefined,
        skills: Array.isArray(req.body?.skills) ? req.body.skills : undefined,
        goodToHaveSkills: Array.isArray(req.body?.goodToHaveSkills) ? req.body.goodToHaveSkills : undefined,
        experienceYears: typeof req.body?.experienceYears === 'number' ? req.body.experienceYears : null,
        educationRequirement: typeof req.body?.educationRequirement === 'string' ? req.body.educationRequirement : undefined,
      });

      console.log('Extracted JD:', extractedResult.descriptionJson);

      const jobData = insertJobSchema.parse({
        ...req.body,
        title: extractedResult.extracted.roleTitle || req.body.title,
        location: extractedResult.extracted.location || req.body.location,
        description: extractedResult.descriptionJson,
        originalJD: rawDescription,
        skills: extractedResult.extracted.mustHaveSkills,
        goodToHaveSkills: extractedResult.extracted.niceToHaveSkills,
        experienceYears: extractedResult.extracted.experienceYears ?? req.body.experienceYears,
        experienceYearsMax: typeof req.body?.experienceYearsMax === 'number' ? req.body.experienceYearsMax : undefined,
      });
      const job = await storage.createJob({
        ...jobData,
        postedBy: req.user!.id,
        organizationId,
      });

      queueMauticFirstJobCreatedSync(req.user!.id, organizationId);

      res.status(201).json(job);
      return;
    } catch (error) {
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

  // Get all jobs with filtering and pagination
  app.get("/api/jobs", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const location = req.query.location as string;
      const type = req.query.type as string;
      const search = req.query.search as string;
      const minSalary = parseInt(req.query.minSalary as string);
      const maxSalary = parseInt(req.query.maxSalary as string);
      const salaryPeriod = req.query.salaryPeriod as string;

      const filters = {
        ...(page !== undefined && { page: Number(page) }),
        ...(limit !== undefined && { limit: Number(limit) }),
        ...(location && { location }),
        ...(type && { type }),
        ...(search && { search }),
        ...(minSalary && !isNaN(minSalary) && { minSalary }),
        ...(maxSalary && !isNaN(maxSalary) && { maxSalary }),
        ...(salaryPeriod && { salaryPeriod })
      };

      const result = await storage.getJobs(filters);

      res.json({
        jobs: result.jobs.map((job) => ({
          ...job,
          description: job.originalJD || job.description,
        })),
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
        }
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get a specific job by ID
  app.get("/api/jobs/:id", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }

      // Support numeric ID, pure slug, and legacy id-slug format
      const parsed = parseJobIdentifier(idParam);
      let job: Awaited<ReturnType<typeof storage.getJobWithRecruiter>>;

      if (parsed.type === 'id') {
        const jobId = parsed.value as number;
        if (!Number.isFinite(jobId) || jobId <= 0) {
          res.status(400).json({ error: 'Invalid ID parameter' });
          return;
        }
        job = await storage.getJobWithRecruiter(jobId);
      } else {
        // Lookup by pure slug
        job = await storage.getJobBySlug(parsed.value as string);
      }

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      // Check if job is expired or inactive
      const isExpired = job.expiresAt && new Date(job.expiresAt) < new Date();
      const isInactive = !job.isActive || job.status !== 'approved';

      // Allow owners/admins/org members to view inactive jobs
      let isOwnerOrAdmin = false;
      if (req.user) {
        if (req.user.role === 'super_admin') {
          isOwnerOrAdmin = true;
        } else if (req.user.role === 'recruiter') {
          if (job.postedBy === req.user.id) {
            isOwnerOrAdmin = true;
          } else if (job.organizationId != null) {
            const orgResult = await getUserOrganization(req.user.id);
            if (orgResult?.organization.id === job.organizationId) {
              isOwnerOrAdmin = true;
            }
          }
        }
      }

      // For expired/inactive jobs, return 410 Gone only for public visitors
      if ((isExpired || isInactive) && !isOwnerOrAdmin) {
        res.status(410).json({
          error: 'Job is no longer available',
          code: isExpired ? 'EXPIRED' : 'INACTIVE',
          job: {
            id: job.id,
            title: job.title,
            slug: job.slug,
            expiresAt: job.expiresAt,
            isActive: job.isActive,
            status: job.status,
          },
        });
        return;
      }

      // Increment view count for analytics
      await storage.incrementJobViews(job.id);

      // Build recruiter display name (handle missing names gracefully)
      let postedByName: string | undefined;
      let isRecruiterProfilePublic = false;
      let recruiterPublicId: string | null = null;
      if (job.recruiter) {
        const { firstName, lastName, isProfilePublic, publicId } = job.recruiter;
        if (firstName || lastName) {
          postedByName = [firstName, lastName].filter(Boolean).join(' ');
        }
        isRecruiterProfilePublic = isProfilePublic ?? false;
        recruiterPublicId = publicId;
      }

      // Return job with recruiter info for profile linking and client data for JSON-LD
      res.json({
        ...job,
        description: job.originalJD || job.description,
        postedByName,
        postedById: recruiterPublicId || job.postedBy, // Prefer publicId for links
        isRecruiterProfilePublic, // Only show link if profile is public
        clientName: job.client?.name || null, // For JSON-LD hiringOrganization
        clientDomain: job.client?.domain || null, // For JSON-LD sameAs
        recruiter: undefined, // Don't expose raw recruiter object
        client: undefined, // Don't expose raw client object
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  // Update a job (recruiters can only edit their own jobs)
  app.patch("/api/jobs/:id", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      // Get existing job to check ownership
      const existingJob = await storage.getJob(jobId);
      if (!existingJob) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      // Get user's organization for access control
      const orgResult = await getUserOrganization(req.user!.id);
      const userOrgId = orgResult?.organization.id;

      // Verify user has access (primary recruiter, co-recruiter, or super_admin)
      // Also checks that the job belongs to the user's current organization
      const hasAccess = await storage.isRecruiterOnJob(existingJob.id, req.user!.id, userOrgId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Validate and extract allowed fields
      const {
        title, description, location, type, skills, hiringManagerId, clientId,
        salaryMin, salaryMax, salaryPeriod, goodToHaveSkills, educationRequirement, experienceYears, experienceYearsMax
      } = req.body;
      const updates: Partial<{
        title: string;
        description: string;
        location: string;
        type: string;
        skills: string[];
        hiringManagerId: number | null;
        clientId: number | null;
        salaryMin: number | null;
        salaryMax: number | null;
        salaryPeriod: string | null;
        goodToHaveSkills: string[] | null;
        educationRequirement: string | null;
        experienceYears: number | null;
        experienceYearsMax: number | null;
        jdDigest: any;
        jdDigestVersion: any;
      }> = {};

      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          res.status(400).json({ error: 'Title must be a non-empty string' });
          return;
        }
        updates.title = title.trim();
      }

      if (description !== undefined) {
        if (typeof description !== 'string') {
          res.status(400).json({ error: 'Description must be a string' });
          return;
        }
        if (countWords(description) < 200) {
          res.status(400).json({ error: 'Description must be at least 200 words' });
          return;
        }
        updates.description = description;
      }

      if (location !== undefined) {
        if (typeof location !== 'string' || location.trim().length === 0) {
          res.status(400).json({ error: 'Location must be a non-empty string' });
          return;
        }
        updates.location = location.trim();
      }

      if (type !== undefined) {
        const validTypes = ['full-time', 'part-time', 'contract', 'internship', 'remote'];
        if (!validTypes.includes(type)) {
          res.status(400).json({ error: 'Invalid job type' });
          return;
        }
        updates.type = type;
      }

      if (skills !== undefined) {
        if (!Array.isArray(skills)) {
          res.status(400).json({ error: 'Skills must be an array' });
          return;
        }
        updates.skills = skills.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(Boolean);
      }

      if (hiringManagerId !== undefined) {
        if (hiringManagerId === null) {
          updates.hiringManagerId = null;
        } else if (Number.isInteger(hiringManagerId) && hiringManagerId > 0) {
          updates.hiringManagerId = hiringManagerId;
        } else {
          res.status(400).json({ error: 'hiringManagerId must be a positive integer or null' });
          return;
        }
      }

      if (clientId !== undefined) {
        if (clientId === null) {
          updates.clientId = null;
        } else if (Number.isInteger(clientId) && clientId > 0) {
          updates.clientId = clientId;
        } else {
          res.status(400).json({ error: 'clientId must be a positive integer or null' });
          return;
        }
      }

      // New structured job fields
      if (salaryMin !== undefined) {
        if (salaryMin === null) {
          updates.salaryMin = null;
        } else if (Number.isInteger(salaryMin) && salaryMin > 0) {
          updates.salaryMin = salaryMin;
        } else {
          res.status(400).json({ error: 'salaryMin must be a positive integer or null' });
          return;
        }
      }

      if (salaryMax !== undefined) {
        if (salaryMax === null) {
          updates.salaryMax = null;
        } else if (Number.isInteger(salaryMax) && salaryMax > 0) {
          updates.salaryMax = salaryMax;
        } else {
          res.status(400).json({ error: 'salaryMax must be a positive integer or null' });
          return;
        }
      }

      if (salaryPeriod !== undefined) {
        if (salaryPeriod === null) {
          updates.salaryPeriod = null;
        } else if (['per_month', 'per_year'].includes(salaryPeriod)) {
          updates.salaryPeriod = salaryPeriod;
        } else {
          res.status(400).json({ error: 'salaryPeriod must be "per_month" or "per_year" or null' });
          return;
        }
      }

      if (goodToHaveSkills !== undefined) {
        if (goodToHaveSkills === null) {
          updates.goodToHaveSkills = null;
        } else if (Array.isArray(goodToHaveSkills)) {
          updates.goodToHaveSkills = goodToHaveSkills.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(Boolean);
        } else {
          res.status(400).json({ error: 'goodToHaveSkills must be an array or null' });
          return;
        }
      }

      if (educationRequirement !== undefined) {
        if (educationRequirement === null || educationRequirement === '') {
          updates.educationRequirement = null;
        } else if (typeof educationRequirement === 'string') {
          updates.educationRequirement = educationRequirement.trim();
        } else {
          res.status(400).json({ error: 'educationRequirement must be a string or null' });
          return;
        }
      }

      if (experienceYears !== undefined) {
        if (experienceYears === null) {
          updates.experienceYears = null;
        } else if (Number.isInteger(experienceYears) && experienceYears >= 0 && experienceYears <= 50) {
          updates.experienceYears = experienceYears;
        } else {
          res.status(400).json({ error: 'experienceYears must be an integer between 0-50 or null' });
          return;
        }
      }

      if (experienceYearsMax !== undefined) {
        if (experienceYearsMax === null) {
          updates.experienceYearsMax = null;
        } else if (Number.isInteger(experienceYearsMax) && experienceYearsMax >= 0 && experienceYearsMax <= 50) {
          updates.experienceYearsMax = experienceYearsMax;
        } else {
          res.status(400).json({ error: 'experienceYearsMax must be an integer between 0-50 or null' });
          return;
        }
      }

      // Fix JD Caching bug: if core fields change, clear jdDigest to force AI re-evaluation
      if (title !== undefined || description !== undefined || location !== undefined || skills !== undefined) {
        updates.jdDigest = null;
        updates.jdDigestVersion = null;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No valid fields to update' });
        return;
      }

      const job = await storage.updateJob(jobId, updates);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json(job);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get audit log for a job
  app.get("/api/jobs/:id/audit-log", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      // Verify job exists and user has access
      const job = await storage.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      // Get user's organization for access control
      const orgResult = await getUserOrganization(req.user!.id);
      const userOrgId = orgResult?.organization.id;

      const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const auditLog = await storage.getJobAuditLog(jobId);
      res.json(auditLog);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get jobs accessible to current user (own + co-recruiter assigned)
  // Per plan: All org members see own jobs + co-recruiter assigned, super_admin sees all
  app.get("/api/my-jobs", requireRole(['recruiter', 'super_admin']), requireSeat({ allowNoOrg: true }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);
      const organizationId =
        user.role === 'super_admin' && !orgResult
          ? undefined
          : (orgResult?.organization.id ?? null);

      // Update member activity
      if (orgResult) {
        await updateMemberActivity(user.id);
      }

      // Recruiter-scoped jobs: primary recruiter + co-recruiter assignments.
      // Super admins with an org stay scoped to that org and their own assignments.
      const userJobs = await storage.getJobsByUser(user.id, organizationId);

      res.json(userJobs.map((job) => ({
        ...job,
        description: job.originalJD || job.description,
      })));
      return;
    } catch (error) {
      next(error);
    }
  });

  // Hiring manager: get jobs assigned to the current hiring manager
  app.get("/api/hiring-manager/jobs", requireRole(['hiring_manager']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rows = await db
        .select({
          job: jobs,
          applicationCount: sql<number>`COUNT(DISTINCT ${applications.id})`,
        })
        .from(jobs)
        .leftJoin(applications, eq(applications.jobId, jobs.id))
        .where(eq(jobs.hiringManagerId, req.user!.id))
        .groupBy(jobs.id)
        .orderBy(desc(jobs.createdAt));

      res.json(rows.map((row: typeof rows[number]) => ({
        ...row.job,
        applicationCount: row.applicationCount ?? 0,
      })));
      return;
    } catch (error) {
      next(error);
    }
  });

  // Update job status (activate/deactivate)
  app.patch("/api/jobs/:id/status", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const jobId = Number(idParam);
      const { isActive } = req.body;

      if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
        res.status(400).json({ error: 'Invalid ID parameter' });
        return;
      }

      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'isActive must be a boolean' });
        return;
      }

      // Get user's organization for access control
      const orgResult = await getUserOrganization(req.user!.id);
      const userOrgId = orgResult?.organization.id;

      // Verify user has access to this job
      const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const { reason } = req.body;
      const job = await storage.updateJobStatus(jobId, isActive, reason, req.user!.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json(job);
      return;
    } catch (error) {
      next(error);
    }
  });

  // ============= JOB ANALYTICS ROUTES =============

  /**
   * GET /api/analytics/hiring-metrics
   * Get comprehensive hiring metrics: time-to-fill, time-in-stage, conversion rates
   * Restricted to organization owners and admins only (super_admin sees all)
   */
  app.get("/api/analytics/hiring-metrics", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate, jobId } = req.query;

      // Parse optional date parameters
      let parsedStartDate: Date | undefined;
      let parsedEndDate: Date | undefined;
      let parsedJobId: number | undefined;

      if (startDate && typeof startDate === 'string') {
        parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          res.status(400).json({ error: 'Invalid startDate format' });
          return;
        }
      }

      if (endDate && typeof endDate === 'string') {
        parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          res.status(400).json({ error: 'Invalid endDate format' });
          return;
        }
      }

      if (jobId) {
        parsedJobId = Number(jobId);
        if (!Number.isFinite(parsedJobId) || parsedJobId <= 0 || !Number.isInteger(parsedJobId)) {
          res.status(400).json({ error: 'Invalid jobId parameter' });
          return;
        }
      }

      // Super admin can see platform-wide analytics (pass 0 to skip org filter)
      if (req.user!.role === 'super_admin') {
        // For super_admin, use a special call that doesn't filter by org
        const metrics = await getHiringMetrics(0, parsedStartDate, parsedEndDate, parsedJobId);
        res.json(metrics);
        return;
      }

      // Get user's organization and verify owner/admin role
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        res.status(403).json({ error: 'You must belong to an organization to view analytics' });
        return;
      }

      const { organization, membership } = orgResult;

      // Restrict analytics to owner/admin only
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
        return;
      }

      // Get metrics from analytics helper, scoped to organization
      const metrics = await getHiringMetrics(organization.id, parsedStartDate, parsedEndDate, parsedJobId);

      res.json(metrics);
      return;
    } catch (error) {
      console.error('[Analytics] Error fetching hiring metrics:', error);
      next(error);
    }
  });

  /**
   * GET /api/analytics/job-health
   * Returns health summaries for all jobs for the organization.
   * Restricted to organization owners and admins only.
   */
  app.get("/api/analytics/job-health", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Super admin can see all
      if (req.user!.role === 'super_admin') {
        const jobHealth = await storage.getJobHealthSummary();
        res.json(jobHealth);
        return;
      }

      // Get user's organization and verify owner/admin role
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        res.status(403).json({ error: 'You must belong to an organization to view analytics' });
        return;
      }

      const { organization, membership } = orgResult;

      // Restrict analytics to owner/admin only
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
        return;
      }

      const jobHealth = await storage.getJobHealthSummary(undefined, organization.id);
      res.json(jobHealth);
      return;
    } catch (error) {
      console.error('[Analytics] Error fetching job health:', error);
      next(error);
    }
  });

  /**
   * GET /api/analytics/nudges
   * Returns jobs needing attention and stale candidate counts for the organization.
   * Restricted to organization owners and admins only.
   */
  app.get("/api/analytics/nudges", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Super admin can see all
      if (req.user!.role === 'super_admin') {
        const nudges = await storage.getAnalyticsNudges();
        res.json(nudges);
        return;
      }

      // Get user's organization and verify owner/admin role
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        res.status(403).json({ error: 'You must belong to an organization to view analytics' });
        return;
      }

      const { organization, membership } = orgResult;

      // Restrict analytics to owner/admin only
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
        return;
      }

      const nudges = await storage.getAnalyticsNudges(undefined, organization.id);
      res.json(nudges);
      return;
    } catch (error) {
      console.error('[Analytics] Error fetching nudges:', error);
      next(error);
    }
  });

  /**
   * GET /api/analytics/clients
   * Returns aggregated metrics per client (roles, applications, placements)
   * Restricted to organization owners and admins only.
   */
  app.get("/api/analytics/clients", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Super admin can see all
      if (req.user!.role === 'super_admin') {
        const metrics = await storage.getClientAnalytics();
        res.json(metrics);
        return;
      }

      // Get user's organization and verify owner/admin role
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        res.status(403).json({ error: 'You must belong to an organization to view analytics' });
        return;
      }

      const { organization, membership } = orgResult;

      // Restrict analytics to owner/admin only
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
        return;
      }

      const metrics = await storage.getClientAnalytics(undefined, organization.id);
      res.json(metrics);
      return;
    } catch (error) {
      console.error('[Analytics] Error fetching client analytics:', error);
      next(error);
    }
  });

  // Get job analytics for admin/recruiter
  // Restricted to organization owners and admins only.
  app.get("/api/analytics/jobs", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Super admin can see all
      if (req.user!.role === 'super_admin') {
        const jobsWithAnalytics = await storage.getJobsWithAnalytics();
        res.json(jobsWithAnalytics);
        return;
      }

      // Get user's organization and verify owner/admin role
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        res.status(403).json({ error: 'You must belong to an organization to view analytics' });
        return;
      }

      const { organization, membership } = orgResult;

      // Restrict analytics to owner/admin only
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
        return;
      }

      const jobsWithAnalytics = await storage.getJobsWithAnalytics(undefined, organization.id);
      res.json(jobsWithAnalytics);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Get analytics for a specific job
  app.get("/api/analytics/jobs/:id", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      if (req.user!.role !== 'super_admin') {
        const orgResult = await getUserOrganization(req.user!.id);
        if (!orgResult) {
          res.status(403).json({ error: 'You must belong to an organization to view analytics' });
          return;
        }

        const { organization, membership } = orgResult;
        if (membership.role !== 'owner' && membership.role !== 'admin') {
          res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
          return;
        }

        const job = await storage.getJob(jobId);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        if (job.organizationId !== organization.id) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }
      }

      const analytics = await storage.getJobAnalytics(jobId);
      if (!analytics) {
        res.status(404).json({ error: 'Analytics not found' });
        return;
      }

      res.json(analytics);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Export analytics data as CSV
  // Restricted to organization owners and admins only.
  app.get("/api/analytics/export", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { format = 'json', dateRange = '30' } = req.query;

      let jobs;

      // Super admin can export all
      if (req.user!.role === 'super_admin') {
        jobs = await storage.getJobsWithAnalytics();
      } else {
        // Get user's organization and verify owner/admin role
        const orgResult = await getUserOrganization(req.user!.id);
        if (!orgResult) {
          res.status(403).json({ error: 'You must belong to an organization to export analytics' });
          return;
        }

        const { organization, membership } = orgResult;

        // Restrict analytics export to owner/admin only
        if (membership.role !== 'owner' && membership.role !== 'admin') {
          res.status(403).json({ error: 'Analytics export is only available to organization owners and admins' });
          return;
        }

        jobs = await storage.getJobsWithAnalytics(undefined, organization.id);
      }

      // Filter by date range
      const days = parseInt(dateRange as string) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const filteredJobs = jobs.filter(job =>
        new Date(job.createdAt) >= cutoffDate
      );

      if (format === 'csv') {
        // Generate CSV data with anonymized information
        const csvHeader = 'Job Title,Location,Type,Status,Views,Apply Clicks,Conversion Rate,AI Score,Created Date\n';
        const csvData = filteredJobs.map(job => [
          `"${job.title}"`,
          `"${job.location}"`,
          job.type,
          job.status,
          job.analytics.views || 0,
          job.analytics.applyClicks || 0,
          job.analytics.conversionRate || "0.00",
          job.analytics.aiScoreCache || "N/A",
          new Date(job.createdAt).toLocaleDateString()
        ].join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="job_analytics.csv"');
        res.send(csvHeader + csvData);
        return;
      } else {
        // Return JSON with anonymized data
        const exportData = filteredJobs.map(job => ({
          id: job.id,
          title: job.title,
          location: job.location,
          type: job.type,
          status: job.status,
          isActive: job.isActive,
          createdAt: job.createdAt,
          analytics: {
            views: job.analytics.views || 0,
            applyClicks: job.analytics.applyClicks || 0,
            conversionRate: job.analytics.conversionRate || "0.00",
            aiScore: job.analytics.aiScoreCache || null
          }
        }));

        res.json({
          data: exportData,
          summary: {
            totalJobs: exportData.length,
            totalViews: exportData.reduce((sum, job) => sum + job.analytics.views, 0),
            totalApplyClicks: exportData.reduce((sum, job) => sum + job.analytics.applyClicks, 0),
            averageConversion: exportData.length > 0
              ? (exportData.reduce((sum, job) => sum + parseFloat(job.analytics.conversionRate), 0) / exportData.length).toFixed(2)
              : "0.00",
            dateRange: `${days} days`,
            exportedAt: new Date().toISOString()
          }
        });
        return;
      }
    } catch (error) {
      console.error('Export error:', error);
      next(error);
    }
  });

  /**
   * GET /api/analytics/dropoff
   * Returns stage counts and conversion rates for the selected window.
   * Restricted to organization owners and admins only.
   */
  app.get("/api/analytics/dropoff", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate, jobId } = req.query;

      let parsedStart: Date | undefined;
      let parsedEnd: Date | undefined;
      let parsedJobId: number | undefined;

      if (typeof startDate === 'string') {
        const d = new Date(startDate);
        if (!isNaN(d.getTime())) parsedStart = d;
      }
      if (typeof endDate === 'string') {
        const d = new Date(endDate);
        if (!isNaN(d.getTime())) parsedEnd = d;
      }
      if (jobId) {
        const idNum = Number(jobId);
        if (!Number.isNaN(idNum) && idNum > 0) parsedJobId = idNum;
      }

      // Fetch relevant applications (scoped by organization)
      const whereClauses: any[] = [];
      if (parsedStart) whereClauses.push(gte(applications.appliedAt, parsedStart));
      if (parsedEnd) whereClauses.push(lte(applications.appliedAt, parsedEnd));
      if (parsedJobId) whereClauses.push(eq(applications.jobId, parsedJobId));

      // Super admin without an org sees all; otherwise scope analytics to the user's org.
      let organizationId: number | undefined;
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        if (req.user!.role === 'super_admin') {
          organizationId = undefined;
        } else {
          res.status(403).json({ error: 'You must belong to an organization to view analytics' });
          return;
        }
      } else {
        const { organization, membership } = orgResult;
        if (req.user!.role !== 'super_admin' && membership.role !== 'owner' && membership.role !== 'admin') {
          res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
          return;
        }
        organizationId = organization.id;
        whereClauses.push(eq(jobs.organizationId, organization.id));
      }

      let appsQuery = db
        .select({
          jobId: applications.jobId,
          currentStage: applications.currentStage,
          appliedAt: applications.appliedAt,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id));
      if (whereClauses.length > 0) {
        appsQuery = appsQuery.where(and(...whereClauses));
      }
      const appRows = await appsQuery as Array<{
        jobId: number;
        currentStage: number | null;
        appliedAt: Date;
      }>;

      // Load stages in order (scoped to org when applicable)
      const stages = await storage.getPipelineStages(organizationId);

      const counts = stages.map((stage: typeof stages[number]) => ({
        stageId: stage.id,
        name: stage.name,
        order: stage.order,
        count: appRows.filter((a: { currentStage: number | null }) => a.currentStage === stage.id).length,
      }));
      const unassignedCount = appRows.filter((a: { currentStage: number | null }) => a.currentStage == null).length;

      const conversions = counts.map((row: typeof counts[number], idx: number) => {
        if (idx === 0) return { name: row.name, count: row.count, rate: 100 };
        const prev = counts[idx - 1]?.count ?? 0;
        const rate = prev > 0 ? Math.round((row.count / prev) * 100) : 0;
        return { name: row.name, count: row.count, rate };
      });

      res.json({
        stages: counts,
        unassigned: unassignedCount,
        conversions,
      });
      return;
    } catch (error) {
      console.error('[Analytics] dropoff error:', error);
      next(error);
    }
  });

  /**
   * GET /api/analytics/source-performance
   * Applications, shortlist/interview, hires grouped by source.
   * Restricted to organization owners and admins only.
   */
  app.get("/api/analytics/source-performance", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate, jobId } = req.query;
      let parsedStart: Date | undefined;
      let parsedEnd: Date | undefined;
      let parsedJobId: number | undefined;
      if (typeof startDate === 'string') {
        const d = new Date(startDate);
        if (!isNaN(d.getTime())) parsedStart = d;
      }
      if (typeof endDate === 'string') {
        const d = new Date(endDate);
        if (!isNaN(d.getTime())) parsedEnd = d;
      }
      if (jobId) {
        const idNum = Number(jobId);
        if (!Number.isNaN(idNum) && idNum > 0) parsedJobId = idNum;
      }

      const whereClauses: any[] = [];
      if (parsedStart) whereClauses.push(gte(applications.appliedAt, parsedStart));
      if (parsedEnd) whereClauses.push(lte(applications.appliedAt, parsedEnd));
      if (parsedJobId) whereClauses.push(eq(applications.jobId, parsedJobId));

      // Super admin sees all; others must be org owner/admin
      if (req.user!.role !== 'super_admin') {
        const orgResult = await getUserOrganization(req.user!.id);
        if (!orgResult) {
          res.status(403).json({ error: 'You must belong to an organization to view analytics' });
          return;
        }
        const { organization, membership } = orgResult;
        if (membership.role !== 'owner' && membership.role !== 'admin') {
          res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
          return;
        }
        // Filter by organization
        whereClauses.push(eq(jobs.organizationId, organization.id));
      }

      let sourceQuery = db
        .select({
          jobId: applications.jobId,
          source: applications.source,
          status: applications.status,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id));
      if (whereClauses.length > 0) {
        sourceQuery = sourceQuery.where(and(...whereClauses));
      }
      const rows = await sourceQuery;

      const grouped: Record<string, { apps: number; shortlist: number; hires: number }> = {};
      rows.forEach((row: { source: string | null; status: string }) => {
        const key = row.source || 'unknown';
        if (!grouped[key]) grouped[key] = { apps: 0, shortlist: 0, hires: 0 };
        grouped[key].apps += 1;
        if (row.status === 'shortlisted' || row.status === 'interview') grouped[key].shortlist += 1;
        if (row.status === 'hired') grouped[key].hires += 1;
      });

      const result = Object.entries(grouped).map(([source, metrics]: [string, { apps: number; shortlist: number; hires: number }]) => ({
        source,
        ...metrics,
        conversion: metrics.apps > 0 ? Math.round((metrics.hires / metrics.apps) * 1000) / 10 : 0,
      }));

      res.json(result);
      return;
    } catch (error) {
      console.error('[Analytics] source performance error:', error);
      next(error);
    }
  });

  /**
   * GET /api/analytics/hm-feedback
   * Approximate Hiring Manager feedback latency from review stage entry to next movement.
   */
  app.get("/api/analytics/hm-feedback", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate, jobId, reviewStageIds, nextStageIds, waitBuckets } = req.query;
      let parsedStart: Date | undefined;
      let parsedEnd: Date | undefined;
      let parsedJobId: number | undefined;
      if (typeof startDate === 'string') {
        const d = new Date(startDate);
        if (!isNaN(d.getTime())) parsedStart = d;
      }
      if (typeof endDate === 'string') {
        const d = new Date(endDate);
        if (!isNaN(d.getTime())) parsedEnd = d;
      }
      if (jobId) {
        const idNum = Number(jobId);
        if (!Number.isNaN(idNum) && idNum > 0) parsedJobId = idNum;
      }

      const parseIds = (input: unknown): number[] => {
        if (!input) return [];
        if (Array.isArray(input)) return input.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
        if (typeof input === 'string') {
          return input
            .split(',')
            .map((v) => Number(v.trim()))
            .filter((v) => Number.isFinite(v) && v > 0);
        }
        return [];
      };

      const explicitReviewIds = parseIds(reviewStageIds);
      const explicitNextIds = parseIds(nextStageIds);
      const bucketDefs = parseIds(waitBuckets).sort((a, b) => a - b); // e.g., [2,3,5]

      let organizationId: number | undefined;

      const whereClauses: any[] = [];
      if (parsedStart) whereClauses.push(gte(applicationStageHistory.changedAt, parsedStart));
      if (parsedEnd) whereClauses.push(lte(applicationStageHistory.changedAt, parsedEnd));
      if (parsedJobId) whereClauses.push(eq(applications.jobId, parsedJobId));

      // Super admin without an org sees all; otherwise scope analytics to the user's org.
      const orgResult = await getUserOrganization(req.user!.id);
      if (!orgResult) {
        if (req.user!.role === 'super_admin') {
          organizationId = undefined;
        } else {
          res.status(403).json({ error: 'You must belong to an organization to view analytics' });
          return;
        }
      } else {
        const { organization, membership } = orgResult;
        if (req.user!.role !== 'super_admin' && membership.role !== 'owner' && membership.role !== 'admin') {
          res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
          return;
        }
        organizationId = organization.id;
        whereClauses.push(eq(jobs.organizationId, organization.id));
      }

      // Identify review stages by name match (scoped to org when applicable)
      const stages = await storage.getPipelineStages(organizationId);

      const reviewStageIdsResolved = explicitReviewIds.length
        ? explicitReviewIds
        : stages
            .filter((s: typeof stages[number]) => s.name.toLowerCase().includes('review'))
            .map((s: typeof stages[number]) => s.id);

      if (reviewStageIdsResolved.length === 0) {
        res.json({ averageDays: null, waitingCount: 0, sampleSize: 0, buckets: [] });
        return;
      }

      let historyQuery = db
        .select({
          applicationId: applicationStageHistory.applicationId,
          fromStage: applicationStageHistory.fromStage,
          toStage: applicationStageHistory.toStage,
          changedAt: applicationStageHistory.changedAt,
          jobId: applications.jobId,
        })
        .from(applicationStageHistory)
        .innerJoin(applications, eq(applicationStageHistory.applicationId, applications.id))
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .orderBy(applicationStageHistory.applicationId, applicationStageHistory.changedAt);
      if (whereClauses.length > 0) {
        historyQuery = historyQuery.where(and(...whereClauses));
      }
      const historyRows = await historyQuery as Array<{
        applicationId: number;
        fromStage: number | null;
        toStage: number;
        changedAt: Date;
        jobId: number;
      }>;

      // Group by application to compute latency
      const perApp = new Map<number, Array<typeof historyRows[number]>>();
      historyRows.forEach((row: typeof historyRows[number]) => {
        if (!perApp.has(row.applicationId)) perApp.set(row.applicationId, []);
        perApp.get(row.applicationId)!.push(row);
      });

      const durations: number[] = [];
      let waitingCount = 0;

      perApp.forEach((entries) => {
        // find first entry into review stage
        const entryIdx = entries.findIndex((e) => reviewStageIdsResolved.includes(e.toStage));
        if (entryIdx === -1 || !entries[entryIdx]) return;
        const entryTime = new Date(entries[entryIdx].changedAt).getTime();
        // find next transition after review
        const next = entries.slice(entryIdx + 1).find((e) =>
          explicitNextIds.length ? explicitNextIds.includes(e.toStage) : true
        );
        if (!next) {
          waitingCount += 1;
          return;
        }
        const nextTime = new Date(next.changedAt).getTime();
        const days = (nextTime - entryTime) / (1000 * 60 * 60 * 24);
        if (days >= 0) durations.push(days);
      });

      const averageDays = durations.length > 0 ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;

      // Optional buckets for wait times (e.g., thresholds [2,3,5] => <=2, 2-3, 3-5, >5)
      let buckets: Array<{ label: string; count: number }> = [];
      if (bucketDefs.length > 0) {
        const sorted = bucketDefs;
        const bucketCounts = new Array(sorted.length + 1).fill(0);
        durations.forEach((d) => {
          const idx = sorted.findIndex((threshold) => d <= threshold);
          if (idx === -1) bucketCounts[bucketCounts.length - 1] += 1;
          else bucketCounts[idx] += 1;
        });
        buckets = bucketCounts.map((count, idx) => {
          if (idx === 0) return { label: `<= ${sorted[0]}d`, count };
          if (idx === bucketCounts.length - 1) return { label: `> ${sorted[sorted.length - 1]}d`, count };
          return { label: `${sorted[idx - 1]}-${sorted[idx]}d`, count };
        });
      }

      res.json({
        averageDays,
        waitingCount,
        sampleSize: durations.length,
        buckets,
      });
      return;
    } catch (error) {
      console.error('[Analytics] HM feedback error:', error);
      next(error);
    }
  });

  /**
   * GET /api/analytics/performance
   * Recruiter & hiring manager performance metrics.
   * Restricted to organization owners and admins only.
   */
  app.get("/api/analytics/performance", requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate, jobId } = req.query;
      let parsedStart: Date | undefined;
      let parsedEnd: Date | undefined;
      let parsedJobId: number | undefined;
      if (typeof startDate === 'string') {
        const d = new Date(startDate);
        if (!isNaN(d.getTime())) parsedStart = d;
      }
      if (typeof endDate === 'string') {
        const d = new Date(endDate);
        if (!isNaN(d.getTime())) parsedEnd = d;
      }
      if (jobId) {
        const idNum = Number(jobId);
        if (!Number.isNaN(idNum) && idNum > 0) parsedJobId = idNum;
      }

      // Scoped jobs by organization
      const jobFilters: any[] = [];
      if (parsedJobId) jobFilters.push(eq(jobs.id, parsedJobId));

      // Super admin sees all; others must be org owner/admin
      if (req.user!.role !== 'super_admin') {
        const orgResult = await getUserOrganization(req.user!.id);
        if (!orgResult) {
          res.status(403).json({ error: 'You must belong to an organization to view analytics' });
          return;
        }
        const { organization, membership } = orgResult;
        if (membership.role !== 'owner' && membership.role !== 'admin') {
          res.status(403).json({ error: 'Analytics are only available to organization owners and admins' });
          return;
        }
        // Filter by organization
        jobFilters.push(eq(jobs.organizationId, organization.id));
      }

      let jobsQuery = db
        .select({
          id: jobs.id,
          postedBy: jobs.postedBy,
          hiringManagerId: jobs.hiringManagerId,
        })
        .from(jobs);
      if (jobFilters.length > 0) jobsQuery = jobsQuery.where(and(...jobFilters));
      const jobRows = await jobsQuery as Array<{ id: number; postedBy: number; hiringManagerId: number | null }>;

      const jobIds = jobRows.map((j) => j.id);
      const recruiterIds: number[] = Array.from(new Set(jobRows.map((j) => j.postedBy))) as number[];
      const hmIds: number[] = Array.from(
        new Set(
          jobRows
            .map((j) => j.hiringManagerId)
            .filter((v): v is number => typeof v === 'number')
        )
      ) as number[];

      // Early exit if no data
      if (jobIds.length === 0) {
        res.json({ recruiters: [], hiringManagers: [] });
        return;
      }

      // Load applications within range for these jobs
      const appFilters: any[] = [];
      if (jobIds.length) appFilters.push(inArray(applications.jobId, jobIds));
      if (parsedStart) appFilters.push(gte(applications.appliedAt, parsedStart));
      if (parsedEnd) appFilters.push(lte(applications.appliedAt, parsedEnd));

      let appsQuery = db
        .select({
          id: applications.id,
          jobId: applications.jobId,
          appliedAt: applications.appliedAt,
          stageChangedAt: applications.stageChangedAt,
          stageChangedBy: applications.stageChangedBy,
        })
        .from(applications);
      if (appFilters.length > 0) appsQuery = appsQuery.where(and(...appFilters));
      const appRows = await appsQuery as Array<{
        id: number;
        jobId: number;
        appliedAt: Date;
        stageChangedAt: Date | null;
        stageChangedBy: number | null;
      }>;

      const appIds = appRows.map((a) => a.id);

      // Stage history for latency calculations
      let histQuery = db
        .select({
          applicationId: applicationStageHistory.applicationId,
          fromStage: applicationStageHistory.fromStage,
          toStage: applicationStageHistory.toStage,
          changedAt: applicationStageHistory.changedAt,
          changedBy: applicationStageHistory.changedBy,
        })
        .from(applicationStageHistory);
      if (appIds.length > 0) {
        histQuery = histQuery.where(inArray(applicationStageHistory.applicationId, appIds));
      }
      const histRows = (appIds.length ? await histQuery : []) as Array<{
        applicationId: number;
        fromStage: number | null;
        toStage: number;
        changedAt: Date;
        changedBy: number;
      }>;

      // Recruiter performance
      const recruiterPerf = (recruiterIds as number[]).map((rid: number) => {
        const jobsFor = jobRows.filter((j) => j.postedBy === rid).map((j) => j.id);
        const appsFor = appRows.filter((a) => jobsFor.includes(a.jobId));
        const jobsHandled = jobsFor.length;
        const candidatesScreened = appsFor.length;

        // Time to first action (applied -> first stage change)
        const firstActionDurations: number[] = [];
        appsFor.forEach((app) => {
          const appHist = histRows
            .filter((h) => h.applicationId === app.id)
            .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
          const first = appHist[0];
          const applied = new Date(app.appliedAt).getTime();
          if (first) {
            const delta = (new Date(first.changedAt).getTime() - applied) / (1000 * 60 * 60 * 24);
            if (delta >= 0) firstActionDurations.push(delta);
          } else if (app.stageChangedAt) {
            const delta = (new Date(app.stageChangedAt).getTime() - applied) / (1000 * 60 * 60 * 24);
            if (delta >= 0) firstActionDurations.push(delta);
          }
        });
        const avgFirstAction =
          firstActionDurations.length > 0
            ? Math.round((firstActionDurations.reduce((a, b) => a + b, 0) / firstActionDurations.length) * 10) / 10
            : null;

        // Stage move latency (average gap between consecutive stage changes)
        const moveDurations: number[] = [];
        const byApp = new Map<number, Array<typeof histRows[number]>>();
        histRows.forEach((h: typeof histRows[number]) => {
          if (!byApp.has(h.applicationId)) byApp.set(h.applicationId, []);
          byApp.get(h.applicationId)!.push(h);
        });
        byApp.forEach((entries: Array<typeof histRows[number]>) => {
          const sorted = entries.sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
          if (sorted.length > 1) {
            for (let i = 1; i < sorted.length; i++) {
              const current = sorted[i];
              const prev = sorted[i - 1];
              if (!current || !prev) continue;
              const delta = (new Date(current.changedAt).getTime() - new Date(prev.changedAt).getTime()) / (1000 * 60 * 60 * 24);
              if (delta >= 0) moveDurations.push(delta);
            }
          }
        });
        const avgStageMove =
          moveDurations.length > 0 ? Math.round((moveDurations.reduce((a, b) => a + b, 0) / moveDurations.length) * 10) / 10 : null;

        return {
          id: rid,
          jobsHandled,
          candidatesScreened,
          avgFirstActionDays: avgFirstAction,
          avgStageMoveDays: avgStageMove,
        };
      });

      // HM performance
      const stagesList = await db.select().from(pipelineStages);
      const reviewStageIdsResolved = stagesList
        .filter((s: typeof stagesList[number]) => s.name.toLowerCase().includes('review'))
        .map((s: typeof stagesList[number]) => s.id);

      const appJobMap = new Map<number, number>();
      appRows.forEach((a) => appJobMap.set(a.id, a.jobId));

      const hmPerf = (hmIds as number[]).map((hid: number) => {
        const hmJobIds = jobRows.filter((j) => j.hiringManagerId === hid).map((j) => j.id);
        const appsForHm = appRows.filter((a) => hmJobIds.includes(a.jobId));
        const jobsOwned = hmJobIds.length;

        // Feedback timing: first review entry to next change
        const durations: number[] = [];
        let waitingCount = 0;
        const appHist = new Map<number, Array<typeof histRows[number]>>();
        histRows
          .filter((h: typeof histRows[number]) => {
            const jobForApp = appJobMap.get(h.applicationId);
            return jobForApp ? hmJobIds.includes(jobForApp) : false;
          })
          .forEach((h: typeof histRows[number]) => {
            if (!appHist.has(h.applicationId)) appHist.set(h.applicationId, []);
            appHist.get(h.applicationId)!.push(h);
          });

        appHist.forEach((entries) => {
          const sorted = entries.sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
          const reviewEntryIdx = sorted.findIndex((e) => reviewStageIdsResolved.includes(e.toStage));
          if (reviewEntryIdx === -1 || !sorted[reviewEntryIdx]) return;
          const entryTime = new Date(sorted[reviewEntryIdx].changedAt).getTime();
          const next = sorted[reviewEntryIdx + 1];
          if (!next) {
            waitingCount += 1;
            return;
          }
          const delta = (new Date(next.changedAt).getTime() - entryTime) / (1000 * 60 * 60 * 24);
          if (delta >= 0) durations.push(delta);
        });

        const avgFeedback =
          durations.length > 0 ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;

        return {
          id: hid,
          jobsOwned,
          avgFeedbackDays: avgFeedback,
          waitingCount,
        };
      });

      // Load user display names
      const userIds = Array.from(new Set([...recruiterIds, ...hmIds])).filter((v) => Number.isFinite(v)) as number[];
      const usersMap = new Map<number, { name: string; role: string }>();
      if (userIds.length) {
        const userRows = await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            role: users.role,
          })
          .from(users)
          .where(inArray(users.id, userIds));
        userRows.forEach((u: typeof userRows[number]) => {
          const name = u.firstName || u.lastName ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : u.username;
          usersMap.set(u.id, { name, role: u.role });
        });
      }

      const recruitersWithNames = recruiterPerf.map((r) => ({
        ...r,
        name: usersMap.get(r.id)?.name ?? `Recruiter #${r.id}`,
      }));
      const hmsWithNames = hmPerf.map((h) => ({
        ...h,
        name: usersMap.get(h.id)?.name ?? `HM #${h.id}`,
      }));

      res.json({
        recruiters: recruitersWithNames,
        hiringManagers: hmsWithNames,
      });
      return;
    } catch (error) {
      console.error('[Analytics] performance error:', error);
      next(error);
    }
  });

  // ============= AI JOB ANALYSIS ROUTES =============

  // AI-powered job description analysis
  // Note: CSRF removed - endpoint is auth-protected, role-protected, rate-limited, and read-only
  app.post("/api/ai/analyze-job-description", aiAnalysisRateLimit, requireRole(['recruiter', 'super_admin']), requireSeat(), requireFeatureAccess(FEATURES.AI_CONTENT), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if AI features are enabled
      if (!isAIEnabled()) {
        res.status(503).json({
          error: 'AI features are not configured',
          message: 'Groq API key is not set. AI-powered analysis is currently unavailable.'
        });
        return;
      }

      const { title, description } = req.body;

      if (!title || !description) {
        res.status(400).json({ error: 'Title and description are required' });
        return;
      }

      if (title.length > 200 || description.length > 5000) {
        res.status(400).json({ error: 'Title or description too long' });
        return;
      }

      console.log(`AI analysis requested by user ${req.user!.id} for job: ${title}`);

      const analysis = await analyzeJobDescription(title, description);
      const suggestions = calculateOptimizationSuggestions(analysis);

      res.json({
        ...analysis,
        suggestions,
        analysis_timestamp: new Date().toISOString()
      });
      return;
    } catch (error) {
      console.error('AI analysis error:', error);
      if (error instanceof Error && error.message.includes('AI analysis unavailable')) {
        res.status(502).json({ error: 'AI service temporarily unavailable' });
        return;
      }
      next(error);
    }
  });

  app.post("/api/jobs/extract-keywords", csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), requireFeatureAccess(FEATURES.AI_CONTENT), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const description = typeof req.body?.description === 'string' ? req.body.description : '';

      if (!description || countWords(description) < MIN_DESCRIPTION_WORDS) {
        res.status(400).json({ error: `Description must be at least ${MIN_DESCRIPTION_WORDS} words` });
        return;
      }

      const extractedResult = await extractStructuredJobPosting(description);

      res.json({
        extracted: {
          title: extractedResult.extracted.roleTitle,
          location: extractedResult.extracted.location,
          type: 'full-time',
          experienceYears: extractedResult.extracted.experienceYears != null ? String(extractedResult.extracted.experienceYears) : '',
          salaryMin: '',
          salaryMax: '',
          salaryPeriod: 'per_year',
          educationRequirement: '',
          skills: extractedResult.extracted.mustHaveSkills,
          goodToHaveSkills: extractedResult.extracted.niceToHaveSkills,
          keywords: [...new Set([
            ...extractedResult.extracted.mustHaveSkills,
            ...extractedResult.extracted.niceToHaveSkills,
          ])],
        },
        structuredJob: extractedResult.extracted,
        descriptionJson: extractedResult.descriptionJson,
      });
      return;
    } catch (error) {
      next(error);
    }
  });

  // AI-powered job scoring
  app.post("/api/ai/score-job", aiAnalysisRateLimit, csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), requireFeatureAccess(FEATURES.AI_CONTENT), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if AI features are enabled
      if (!isAIEnabled()) {
        res.status(503).json({
          error: 'AI features are not configured',
          message: 'Groq API key is not set. AI-powered scoring is currently unavailable.'
        });
        return;
      }

      const { title, description, jobId } = req.body;

      if (!title || !description) {
        res.status(400).json({ error: 'Title and description are required' });
        return;
      }

      // Get historical data if jobId provided
      let historicalData;
      if (jobId) {
        const analytics = await storage.getJobAnalytics(jobId);
        if (analytics) {
          historicalData = {
            averageViews: analytics.views,
            averageConversion: parseFloat(analytics.conversionRate || "0")
          };
        }
      }

      const { score, modelVersion } = await generateJobScore(title, description, historicalData);

      // Cache the score if jobId provided
      if (jobId) {
        await storage.updateJobAnalytics(jobId, {
          aiScoreCache: score,
          aiModelVersion: modelVersion
        });
      }

      res.json({
        score,
        model_version: modelVersion,
        timestamp: new Date().toISOString(),
        factors: {
          content_analysis: true,
          historical_data: !!historicalData
        }
      });
      return;
    } catch (error) {
      console.error('AI scoring error:', error);
      next(error);
    }
  });

  // AI-enhanced pipeline action suggestions
  app.post("/api/ai/enhance-pipeline-actions", aiAnalysisRateLimit, requireRole(['recruiter', 'super_admin']), requireSeat(), requireFeatureAccess(FEATURES.AI_CONTENT), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if AI features are enabled
      if (!isAIEnabled()) {
        res.status(503).json({
          error: 'AI features are not configured',
          message: 'AI API key is not set. AI-powered enhancement is currently unavailable.'
        });
        return;
      }

      const { items, pipelineStats } = req.body;

      // Validate input
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Items array is required' });
        return;
      }

      if (!pipelineStats || typeof pipelineStats.healthScore !== 'number') {
        res.status(400).json({ error: 'Pipeline stats with healthScore is required' });
        return;
      }

      // Limit items to prevent abuse
      if (items.length > 20) {
        res.status(400).json({ error: 'Maximum 20 items allowed per request' });
        return;
      }

      // Validate item structure
      const validItems = items.map((item: any) => ({
        id: String(item.id || ''),
        title: String(item.title || '').slice(0, 200),
        priority: String(item.priority || 'important'),
        category: String(item.category || 'pipeline'),
      }));

      console.log(`AI pipeline enhancement requested by user ${req.user!.id} for ${validItems.length} items`);

      const result = await enhancePipelineActions(validItems, {
        healthScore: Math.max(0, Math.min(100, pipelineStats.healthScore)),
        totalCandidates: pipelineStats.totalCandidates || 0,
        openJobs: pipelineStats.openJobs || 0,
      });

      res.json({
        ...result,
        timestamp: new Date().toISOString()
      });
      return;
    } catch (error) {
      console.error('AI pipeline enhancement error:', error);
      if (error instanceof Error && error.message.includes('AI pipeline enhancement unavailable')) {
        res.status(502).json({ error: 'AI service temporarily unavailable' });
        return;
      }
      next(error);
    }
  });

  console.log('✅ Jobs routes registered');
}
