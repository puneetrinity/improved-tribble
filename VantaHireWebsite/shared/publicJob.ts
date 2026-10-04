import type { Job } from './schema';
import { publicJobDescription, type JobDescriptionMode } from './jobDescription';

/** Canonical source belongs to the brief-authorized read, not raw-row lists. */
export function omitCanonicalJobSource<T extends object>(job:T):Omit<T,'currentJD'|'currentJDHash'> {
  const {currentJD:_jd,currentJDHash:_hash,...rest}=job as T & {currentJD?:unknown;currentJDHash?:unknown};
  return rest;
}

type PostingFields = Pick<Job,
  'id' | 'title' | 'location' | 'type' | 'description' | 'skills' |
  'goodToHaveSkills' | 'educationRequirement' | 'experienceYears' |
  'salaryMin' | 'salaryMax' | 'salaryPeriod' | 'deadline' | 'createdAt' |
  'updatedAt' | 'slug' | 'isActive' | 'status' | 'expiresAt'>;

export interface PublicJob extends PostingFields {
  postedByName: string | null;
  postedById: string | null;
  isRecruiterProfilePublic: boolean;
  clientName: string | null;
  clientDomain: string | null;
}

export interface ManagementJob extends PublicJob {
  organizationId: number | null;
  hiringManagerId: number | null;
  clientId: number | null;
}

export type PublicJobSource = PostingFields & {
  originalJD?: string | null;
  currentJD?: string | null;
  postedByName?: string | null;
  postedById?: string | number | null;
  isRecruiterProfilePublic?: boolean;
  clientName?: string | null;
  clientDomain?: string | null;
  recruiter?: { firstName: string | null; lastName: string | null;
    isProfilePublic: boolean | null; publicId: string | null } | null;
  client?: { name: string; domain: string | null } | null;
};

/** Positive allowlist: new storage columns never become public by accident. */
export function toPublicJob(job: PublicJobSource,mode:JobDescriptionMode='legacy'): PublicJob {
  const profilePublic = job.recruiter?.isProfilePublic ?? job.isRecruiterProfilePublic ?? false;
  const profileId = job.recruiter?.publicId ?? job.postedById;
  return {
    id: job.id, title: job.title, location: job.location, type: job.type,
    description: publicJobDescription(job,mode), skills: job.skills,
    goodToHaveSkills: job.goodToHaveSkills, educationRequirement: job.educationRequirement,
    experienceYears: job.experienceYears, salaryMin: job.salaryMin, salaryMax: job.salaryMax,
    salaryPeriod: job.salaryPeriod, deadline: job.deadline, createdAt: job.createdAt,
    updatedAt: job.updatedAt, slug: job.slug, isActive: job.isActive,
    status: job.status, expiresAt: job.expiresAt,
    postedByName: job.recruiter
      ? [job.recruiter.firstName, job.recruiter.lastName].filter(Boolean).join(' ') || null
      : job.postedByName ?? null,
    postedById: profilePublic && typeof profileId === 'string' && profileId.length > 0 ? profileId : null,
    isRecruiterProfilePublic: profilePublic,
    clientName: job.client?.name ?? job.clientName ?? null,
    clientDomain: job.client?.domain ?? job.clientDomain ?? null,
  };
}

export function toManagementJob(job: PublicJobSource & Pick<Job,
  'organizationId' | 'hiringManagerId' | 'clientId'>,mode:JobDescriptionMode='legacy'): ManagementJob {
  return { ...toPublicJob(job,mode), organizationId: job.organizationId,
    hiringManagerId: job.hiringManagerId, clientId: job.clientId };
}
