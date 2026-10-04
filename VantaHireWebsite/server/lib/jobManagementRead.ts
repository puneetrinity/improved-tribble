import { clients, jobs, users, userProfiles } from '@shared/schema';
import { toManagementJob, type ManagementJob, type PublicJobSource } from '@shared/publicJob';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { jobBriefEnabled } from '../job-brief/contracts';

export function parseManagementJobId(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** Authority and projection share one statement snapshot; no session-role fallback. */
export async function readManagementJob(actorId: number, jobId: number): Promise<
  { ok: true; job: ManagementJob } | { ok: false; reason: 'not_found' | 'unavailable' }
> {
  if (![actorId, jobId].every(id => Number.isSafeInteger(id) && id > 0)) {
    return { ok: false, reason: 'not_found' };
  }
  try {
    const rows = await db.select({
      id: jobs.id, title: jobs.title, location: jobs.location, type: jobs.type,
      description: jobs.description, originalJD: jobs.originalJD, currentJD:jobs.currentJD, skills: jobs.skills,
      goodToHaveSkills: jobs.goodToHaveSkills, educationRequirement: jobs.educationRequirement,
      experienceYears: jobs.experienceYears, salaryMin: jobs.salaryMin, salaryMax: jobs.salaryMax,
      salaryPeriod: jobs.salaryPeriod, deadline: jobs.deadline, createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt, slug: jobs.slug, isActive: jobs.isActive,
      status: jobs.status, expiresAt: jobs.expiresAt,
      postedByName: sql<string>`NULLIF(concat_ws(' ', ${users.firstName}, ${users.lastName}), '')`,
      postedById: userProfiles.publicId, isRecruiterProfilePublic: userProfiles.isPublic,
      clientName: clients.name, clientDomain: clients.domain,
      organizationId: jobs.organizationId, hiringManagerId: jobs.hiringManagerId, clientId: jobs.clientId,
    }).from(jobs)
      .leftJoin(users, eq(users.id, jobs.postedBy))
      // Legacy databases can contain duplicate profile rows. They must not
      // multiply an authorized job or turn a normal management read into 503.
      .leftJoin(userProfiles, and(eq(userProfiles.userId, jobs.postedBy), sql`
        ${userProfiles.id} = (SELECT min(profile.id) FROM user_profiles AS profile
          WHERE profile.user_id = ${jobs.postedBy})`))
      .leftJoin(clients, eq(clients.id, jobs.clientId))
      .where(and(eq(jobs.id, jobId), sql`EXISTS (
        SELECT 1 FROM users AS actor WHERE actor.id = ${actorId} AND (
          actor.role = 'super_admin' OR (
            actor.role = 'recruiter' AND ${jobs.organizationId} IS NOT NULL
            AND EXISTS (SELECT 1 FROM organization_members AS membership
              WHERE membership.user_id = actor.id
                AND membership.organization_id = ${jobs.organizationId}
                AND membership.seat_assigned = TRUE)
            AND (${jobs.postedBy} = actor.id OR EXISTS (
              SELECT 1 FROM job_recruiters AS assignment
              WHERE assignment.job_id = ${jobs.id} AND assignment.recruiter_id = actor.id))
          )
        )
      )`));
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    if (rows.length !== 1) return { ok: false, reason: 'unavailable' };
    return { ok: true, job: toManagementJob(rows[0] as PublicJobSource & Pick<ManagementJob,
      'organizationId' | 'hiringManagerId' | 'clientId'>,jobBriefEnabled()?'canonical':'legacy') };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
