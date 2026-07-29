import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";

import { jobs, savedJobs, type Job } from "@shared/schema";
import { requireVerifiedCandidate } from "./auth";
import { db } from "./db";
import type { CsrfMiddleware } from "./types/routes";

type JobAvailability = Pick<Job, "deadline" | "expiresAt" | "isActive" | "status">;
type PublicJob = Pick<
  Job,
  | "id"
  | "title"
  | "location"
  | "type"
  | "description"
  | "skills"
  | "deadline"
  | "createdAt"
  | "isActive"
  | "status"
  | "expiresAt"
  | "slug"
  | "updatedAt"
  | "salaryMin"
  | "salaryMax"
  | "salaryPeriod"
  | "goodToHaveSkills"
  | "educationRequirement"
  | "experienceYears"
  | "experienceYearsMax"
>;
type SavedJobRow = {
  id: number;
  createdAt: Date;
  job: PublicJob;
};

export function canCandidateApplyToJob(
  job: JobAvailability,
  now = new Date(),
): boolean {
  if (!job.isActive || job.status !== "approved") {
    return false;
  }

  if (job.deadline && new Date(job.deadline) < now) {
    return false;
  }

  if (job.expiresAt && new Date(job.expiresAt) < now) {
    return false;
  }

  return true;
}

function parseJobId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const jobId = Number(value);
  return Number.isSafeInteger(jobId) && jobId > 0 ? jobId : null;
}

const publicJobColumns = {
  id: jobs.id,
  title: jobs.title,
  location: jobs.location,
  type: jobs.type,
  description: jobs.description,
  skills: jobs.skills,
  deadline: jobs.deadline,
  createdAt: jobs.createdAt,
  isActive: jobs.isActive,
  status: jobs.status,
  expiresAt: jobs.expiresAt,
  slug: jobs.slug,
  updatedAt: jobs.updatedAt,
  salaryMin: jobs.salaryMin,
  salaryMax: jobs.salaryMax,
  salaryPeriod: jobs.salaryPeriod,
  goodToHaveSkills: jobs.goodToHaveSkills,
  educationRequirement: jobs.educationRequirement,
  experienceYears: jobs.experienceYears,
  experienceYearsMax: jobs.experienceYearsMax,
};

export function registerCandidatePortalRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware,
): void {
  app.get(
    "/api/candidate/saved-jobs",
    requireVerifiedCandidate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rows = await db
          .select({
            id: savedJobs.id,
            createdAt: savedJobs.createdAt,
            job: publicJobColumns,
          })
          .from(savedJobs)
          .innerJoin(jobs, eq(savedJobs.jobId, jobs.id))
          .where(eq(savedJobs.candidateId, req.user!.id))
          .orderBy(desc(savedJobs.createdAt), desc(savedJobs.id)) as SavedJobRow[];

        const now = new Date();
        res.json({
          savedJobs: rows.map((row) => ({
            ...row,
            canApply: canCandidateApplyToJob(row.job, now),
          })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/candidate/saved-jobs/:jobId",
    csrfProtection,
    requireVerifiedCandidate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobId = parseJobId(req.params.jobId);
        if (jobId === null) {
          res.status(400).json({ error: "Invalid job ID" });
          return;
        }

        const [job] = await db
          .select({
            id: jobs.id,
            deadline: jobs.deadline,
            expiresAt: jobs.expiresAt,
            isActive: jobs.isActive,
            status: jobs.status,
          })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (!job) {
          res.status(404).json({ error: "Job not found" });
          return;
        }

        if (!canCandidateApplyToJob(job)) {
          res.status(400).json({
            error: "This job is not currently available to save",
            code: "JOB_NOT_AVAILABLE",
          });
          return;
        }

        await db
          .insert(savedJobs)
          .values({
            candidateId: req.user!.id,
            jobId,
          })
          .onConflictDoNothing({
            target: [savedJobs.candidateId, savedJobs.jobId],
          });

        res.json({ saved: true, jobId });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/candidate/saved-jobs/:jobId",
    csrfProtection,
    requireVerifiedCandidate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobId = parseJobId(req.params.jobId);
        if (jobId === null) {
          res.status(400).json({ error: "Invalid job ID" });
          return;
        }

        await db
          .delete(savedJobs)
          .where(and(
            eq(savedJobs.candidateId, req.user!.id),
            eq(savedJobs.jobId, jobId),
          ));

        res.json({ saved: false, jobId });
      } catch (error) {
        next(error);
      }
    },
  );
}
