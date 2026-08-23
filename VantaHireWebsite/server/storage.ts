import slugify from 'slugify';
import { randomUUID } from 'node:crypto';
import {
  users,
  contactSubmissions,
  jobs,
  applications,
  userProfiles,
  jobAnalytics,
  jobAuditLog,
  pipelineStages,
  applicationStageHistory,
  emailTemplates,
  emailAuditLog,
  automationSettings,
  applicationFeedback,
  clients,
  clientShortlists,
  clientShortlistItems,
  clientFeedback,
  talentPool,
  talentPoolMembershipEvents,
  formInvitations,
  forms,
  formResponses,
  hiringManagerInvitations,
  jobRecruiters,
  coRecruiterInvitations,
  aiFitJobs,
  candidateResumes,
  organizationMembers,
  applicationGraphSyncJobs,
  resumeImportBatches,
  resumeImportItems,
  type User,
  type InsertUser,
  type ContactSubmission,
  type InsertContact,
  type Job,
  type InsertJob,
  type Application,
  type InsertApplication,
  type UserProfile,
  type InsertUserProfile,
  type JobAnalytics,
  type InsertJobAnalytics,
  type JobAuditLog,
  type PipelineStage,
  type InsertPipelineStage,
  type EmailTemplate,
  type InsertEmailTemplate,
  type EmailAuditLog,
  type AutomationSetting,
  consultants,
  type Consultant,
  type InsertConsultant,
  type Client,
  type InsertClient,
  type ClientShortlist,
  type ClientShortlistItem,
  type ClientFeedback,
  type InsertClientFeedback,
  type TalentPool,
  type InsertTalentPool,
  type FormInvitation,
  type HiringManagerInvitation,
  type JobRecruiter,
  type CoRecruiterInvitation,
  type AiFitJob,
  type InsertAiFitJob,
  type BatchFitResult,
  type ApplicationGraphSyncJob,
  type InsertApplicationGraphSyncJob,
  type ResumeImportBatch,
  type InsertResumeImportBatch,
  type ResumeImportItem,
  type InsertResumeImportItem,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, ilike, sql, or, inArray, count, gte, lte, isNull } from "drizzle-orm";
import { normalizeStageName } from "./lib/pipelineStageUtils";
import { pickInitialPipelineStage } from "./lib/pipelineStageSelection";
import { computeResumeImportBatchStatus } from "./lib/resumeImportFieldExtraction";

export type JobHealthStatus = 'green' | 'amber' | 'red';

// Correlated privacy fence. It is composed into WHERE before grouping/order/
// limit. Existing organization workflow can retain global-opt-out rows;
// erasure/review never exposes active candidate content.
const privacyAllowedFor = (
  subjectType: 'candidate_user' | 'application' | 'candidate_resume' | 'talent_pool' | 'job_sourced_candidate',
  subjectColumn: 'candidate_user_id' | 'application_id' | 'candidate_resume_id' | 'talent_pool_id' | 'job_sourced_candidate_id',
  subjectId: unknown,
  globalUse = false,
) => sql`NOT EXISTS (
  SELECT 1
    FROM candidate_privacy_subject_links privacy_link
    JOIN candidate_privacy_requests privacy_request
      ON privacy_request.request_id=privacy_link.request_id
    LEFT JOIN candidate_privacy_remote_projection privacy_remote
      ON privacy_remote.request_id=privacy_request.request_id
   WHERE privacy_link.subject_type=${subjectType}
     AND ${sql.raw(`privacy_link.${subjectColumn}`)}=${subjectId}
     AND privacy_request.state IN ('accepted_local','delivery_pending','memory_active','needs_review')
     AND COALESCE(
       privacy_remote.decision,
       CASE WHEN privacy_request.state='needs_review' THEN 'review'
            WHEN privacy_request.action='request_erasure' THEN 'block_all'
            ELSE 'block_global' END
     ) IN ${globalUse
       ? sql`('block_global','block_all','review')`
       : sql`('block_all','review')`}
)`;

const applicationPrivacyAllowed = (globalUse = false) => privacyAllowedFor(
  'application',
  'application_id',
  applications.id,
  globalUse,
);

const candidateUserPrivacyAllowed = (globalUse = false) => privacyAllowedFor(
  'candidate_user',
  'candidate_user_id',
  users.id,
  globalUse,
);

const talentPoolPrivacyAllowed = (globalUse = false) => privacyAllowedFor(
  'talent_pool',
  'talent_pool_id',
  talentPool.id,
  globalUse,
);

const applicationPrivacyAllowedAlias = (alias: "a", globalUse = false) => sql.raw(`NOT EXISTS (
  SELECT 1
    FROM candidate_privacy_subject_links privacy_link
    JOIN candidate_privacy_requests privacy_request
      ON privacy_request.request_id=privacy_link.request_id
    LEFT JOIN candidate_privacy_remote_projection privacy_remote
      ON privacy_remote.request_id=privacy_request.request_id
   WHERE privacy_link.subject_type='application'
     AND privacy_link.application_id=${alias}.id
     AND privacy_request.state IN ('accepted_local','delivery_pending','memory_active','needs_review')
     AND COALESCE(
       privacy_remote.decision,
       CASE WHEN privacy_request.state='needs_review' THEN 'review'
            WHEN privacy_request.action='request_erasure' THEN 'block_all'
            ELSE 'block_global' END
     ) IN ${globalUse
       ? "('block_global','block_all','review')"
       : "('block_all','review')"}
)`);

export interface JobHealthSummary {
  jobId: number;
  jobTitle: string;
  isActive: boolean;
  status: JobHealthStatus;
  reason: string;
  totalApplications: number;
  daysSincePosted: number;
  daysSinceLastApplication: number | null;
  conversionRate: number;
}

export interface StaleCandidatesSummary {
  jobId: number;
  jobTitle: string;
  count: number;
  oldestStaleDays: number;
}

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  updateUserPassword(id: number, hashedPassword: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Email verification operations
  setVerificationToken(userId: number, token: string, expires: Date): Promise<void>;
  getUserByVerificationToken(token: string): Promise<User | undefined>;
  verifyUserEmail(userId: number): Promise<User | undefined>;

  // Password reset operations
  setPasswordResetToken(userId: number, token: string, expires: Date): Promise<void>;
  getUserByPasswordResetToken(token: string): Promise<User | undefined>;
  clearPasswordResetToken(userId: number): Promise<void>;

  // Profile completion operations
  updateUserProfileSnooze(userId: number, snoozeUntil: Date): Promise<void>;
  markProfileCompleted(userId: number): Promise<void>;
  clearProfileCompletedAt(userId: number): Promise<void>;

  // Contact form operations
  createContactSubmission(submission: InsertContact): Promise<ContactSubmission>;
  getAllContactSubmissions(): Promise<ContactSubmission[]>;
  
  // Job operations
  createJob(job: InsertJob & { postedBy: number; organizationId: number }): Promise<Job>;
  getJob(id: number): Promise<Job | undefined>;
  getJobWithRecruiter(id: number): Promise<(Job & { recruiter?: { firstName: string | null; lastName: string | null; isProfilePublic: boolean; publicId: string | null }; client?: { name: string; domain: string | null } | null }) | undefined>;
  getJobBySlug(slug: string): Promise<(Job & { recruiter?: { firstName: string | null; lastName: string | null; isProfilePublic: boolean; publicId: string | null }; client?: { name: string; domain: string | null } | null }) | undefined>;
  getJobs(filters: {
    page?: number;
    limit?: number;
    location?: string;
    type?: string;
    minSalary?: number;
    maxSalary?: number;
    salaryPeriod?: string;
    search?: string;
    status?: string;
  }): Promise<{ jobs: (Job & { postedByName?: string; postedById?: number | string; isRecruiterProfilePublic?: boolean })[]; total: number }>;
  updateJobStatus(id: number, isActive: boolean, reason?: string, performedBy?: number): Promise<Job | undefined>;
  updateJob(id: number, updates: Partial<Pick<Job, 'title' | 'description' | 'location' | 'type' | 'skills' | 'hiringManagerId' | 'clientId'>>): Promise<Job | undefined>;
  logJobAction(data: { jobId: number; action: string; performedBy: number; reason?: string; metadata?: any }): Promise<JobAuditLog>;
  getJobsByUser(userId: number, organizationId?: number | null): Promise<(Job & { applicationCount: number; hiringManager?: { id: number; firstName: string | null; lastName: string | null; username: string } })[]>;
  reviewJob(id: number, status: string, reviewComments?: string, reviewedBy?: number): Promise<Job | undefined>;
  getJobsByStatus(status: string, page?: number, limit?: number): Promise<{ jobs: Job[]; total: number }>;
  getPublicJobsByRecruiter(recruiterId: number): Promise<Job[]>;
  getPublicRecruiters(): Promise<Array<{
    id: number | string;
    publicId: string | null;
    displayName: string;
    company: string | null;
    photoUrl: string | null;
    bio: string | null;
    location: string | null;
    jobCount: number;
  }>>;

  // Application operations
  createApplication(application: InsertApplication & {
    jobId: number;
    resumeUrl: string;
    status?: 'submitted';
    resumeFilename?: string | null;
    userId?: number | null;
    extractedResumeText?: string | undefined;
    submittedByRecruiter?: boolean;
    createdByUserId?: number;
    source?: string;
    sourceMetadata?: any;
    currentStage?: number;
    stageChangedAt?: Date;
    stageChangedBy?: number;
    organizationId?: number;
  }, executor?: any): Promise<Application>;
  getApplicationsByJob(jobId: number): Promise<Application[]>;
  getApplicationsByUser(email: string): Promise<Application[]>;
  getApplication(id: number): Promise<Application | undefined>;
  getApplicationForPrivacyWorker(id: number): Promise<Application | undefined>;
  getClientFeedbackCountsByApplicationIds(applicationIds: number[]): Promise<Record<number, number>>;
  updateApplicationStatus(id: number, status: string, notes?: string): Promise<Application | undefined>;
  updateApplicationsStatus(ids: number[], status: string, notes?: string): Promise<number>;
  markApplicationViewed(id: number): Promise<Application | undefined>;
  markApplicationDownloaded(id: number): Promise<Application | undefined>;
  
  // User profile operations
  getUserProfile(userId: number): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile & { userId: number }): Promise<UserProfile>;
  updateUserProfile(userId: number, profile: Partial<InsertUserProfile>): Promise<UserProfile | undefined>;
  getApplicationsByEmail(email: string): Promise<(Application & { job: Job })[]>;
  getApplicationsByUserId(userId: number, userEmail?: string): Promise<(Application & { job: Job })[]>;
  withdrawApplication(applicationId: number, userId: number): Promise<boolean>;
  getRecruiterApplications(recruiterId: number, organizationId?: number | null): Promise<(Application & { job: Job; feedbackCount?: number })[]>;
  claimApplicationsForUser(userId: number, username: string): Promise<number>;
  getCandidatesForRecruiter(recruiterId: number, filters?: {
    search?: string;
    minRating?: number;
    hasTags?: string[];
  }): Promise<Array<{
    email: string;
    name: string;
    jobsAppliedCount: number;
    lastApplicationDate: Date;
    highestRating: number | null;
    allTags: string[];
  }>>;

  // Admin operations
  getAdminStats(): Promise<{
    totalJobs: number;
    activeJobs: number;
    pendingJobs: number;
    totalApplications: number;
    totalUsers: number;
    totalRecruiters: number;
  }>;
  getAllJobsWithDetails(): Promise<any[]>;
  getAllApplicationsWithDetails(): Promise<any[]>;
  getAllUsersWithDetails(): Promise<any[]>;
  updateUserRole(userId: number, role: string): Promise<User | undefined>;
  deleteJob(jobId: number): Promise<boolean>;
  // Client operations
  getClients(organizationId?: number | null, userId?: number): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  createClient(client: InsertClient & { createdBy: number; organizationId: number }): Promise<Client>;
  updateClient(id: number, client: Partial<InsertClient>): Promise<Client | undefined>;
  
  // Job analytics operations
  getJobAnalytics(jobId: number): Promise<JobAnalytics | undefined>;
  createJobAnalytics(analytics: InsertJobAnalytics): Promise<JobAnalytics>;
  incrementJobViews(jobId: number): Promise<JobAnalytics | undefined>;
  incrementApplyClicks(jobId: number): Promise<JobAnalytics | undefined>;
  updateConversionRate(jobId: number): Promise<JobAnalytics | undefined>;
  updateJobAnalytics(jobId: number, updates: { aiScoreCache?: number; aiModelVersion?: string }): Promise<JobAnalytics | undefined>;
  getJobsWithAnalytics(userId?: number, organizationId?: number): Promise<any[]>;
  getJobHealthSummary(userId?: number, organizationId?: number): Promise<JobHealthSummary[]>;
  getAnalyticsNudges(userId?: number, organizationId?: number): Promise<{
    jobsNeedingAttention: JobHealthSummary[];
    staleCandidates: StaleCandidatesSummary[];
  }>;
  getClientAnalytics(userId?: number, organizationId?: number): Promise<Array<{
    clientId: number;
    clientName: string;
    rolesCount: number;
    totalApplications: number;
    placementsCount: number;
  }>>;
  
  // ATS: pipeline & interview
  getPipelineStages(organizationId?: number | null, userId?: number): Promise<PipelineStage[]>;
  createPipelineStage(stage: InsertPipelineStage & { createdBy?: number; organizationId?: number }): Promise<PipelineStage>;
  updateApplicationStage(appId: number, newStageId: number, changedBy: number, notes?: string): Promise<void>;
  getApplicationStageHistory(appId: number): Promise<any[]>;
  scheduleInterview(appId: number, fields: { date?: Date; time?: string; location?: string; notes?: string }): Promise<Application | undefined>;
  addRecruiterNote(appId: number, note: string): Promise<Application | undefined>;
  setApplicationRating(appId: number, rating: number): Promise<Application | undefined>;
  
  // ATS: email templates
  getEmailTemplates(organizationId?: number | null, userId?: number): Promise<EmailTemplate[]>;
  createEmailTemplate(template: InsertEmailTemplate & { createdBy?: number; organizationId?: number }): Promise<EmailTemplate>;

  // Consultant operations
  getConsultants(): Promise<Consultant[]>;
  getActiveConsultants(): Promise<Consultant[]>;
  getConsultant(id: number): Promise<Consultant | undefined>;
  createConsultant(consultant: InsertConsultant): Promise<Consultant>;
  updateConsultant(id: number, consultant: Partial<InsertConsultant>): Promise<Consultant | undefined>;
  deleteConsultant(id: number): Promise<boolean>;

  // AI cross-job matching
  getSimilarCandidatesForJob(jobId: number, recruiterId: number, options?: {
    minFitScore?: number;
    limit?: number;
  }): Promise<Array<{
    applicationId: number;
    candidateName: string;
    candidateEmail: string;
    sourceJobId: number;
    sourceJobTitle: string;
    aiFitScore: number | null;
    aiFitLabel: string | null;
    currentStage: number | null;
  }>>;

  // Hiring Manager Invitation operations
  createHiringManagerInvitation(data: {
    email: string;
    name?: string;
    tokenHash: string;
    invitedBy: number;
    inviterName: string;
    expiresAt: Date;
  }): Promise<HiringManagerInvitation>;
  getHiringManagerInvitationByToken(tokenHash: string): Promise<HiringManagerInvitation | undefined>;
  getHiringManagerInvitationByEmail(email: string, status?: string): Promise<HiringManagerInvitation | undefined>;
  getPendingHiringManagerInvitations(invitedBy?: number): Promise<HiringManagerInvitation[]>;
  markHiringManagerInvitationAccepted(id: number): Promise<HiringManagerInvitation | undefined>;
  deleteHiringManagerInvitation(id: number): Promise<boolean>;
  invalidateHiringManagerInvitation(id: number): Promise<boolean>;

  // Job Recruiters operations (co-recruiters)
  addJobRecruiter(jobId: number, recruiterId: number, addedBy: number, organizationId?: number): Promise<JobRecruiter>;
  removeJobRecruiter(jobId: number, recruiterId: number): Promise<boolean>;
  getJobRecruiters(jobId: number): Promise<User[]>;
  isRecruiterOnJob(jobId: number, userId: number, organizationId?: number | null): Promise<boolean>;

  // Co-Recruiter Invitation operations
  createCoRecruiterInvitation(data: {
    jobId: number;
    email: string;
    tokenHash: string;
    invitedBy: number;
    inviterName: string;
    jobTitle: string;
    expiresAt: Date;
    organizationId?: number;
  }): Promise<CoRecruiterInvitation>;
  getCoRecruiterInvitationByToken(tokenHash: string): Promise<CoRecruiterInvitation | undefined>;
  getCoRecruiterInvitationByEmail(email: string, jobId: number): Promise<CoRecruiterInvitation | undefined>;
  getCoRecruiterInvitation(id: number): Promise<CoRecruiterInvitation | undefined>;
  getPendingCoRecruiterInvitations(jobId: number): Promise<CoRecruiterInvitation[]>;
  updateCoRecruiterInvitationStatus(id: number, status: string): Promise<CoRecruiterInvitation | undefined>;
  markCoRecruiterInvitationAccepted(id: number): Promise<CoRecruiterInvitation | undefined>;
  deleteCoRecruiterInvitation(id: number): Promise<boolean>;

  // ActiveKG Graph Sync operations
  enqueueApplicationGraphSyncJob(input: {
    applicationId: number;
    organizationId: number | null;
    jobId: number;
    effectiveRecruiterId: number;
    activekgTenantId: string;
  }): Promise<ApplicationGraphSyncJob>;
  claimPendingApplicationGraphSyncJobs(limit: number, now: Date): Promise<ApplicationGraphSyncJob[]>;
  markApplicationGraphSyncJobSucceeded(id: number, parentNodeId: string, chunkCount: number): Promise<void>;
  markApplicationGraphSyncJobRetry(id: number, error: string, nextAttemptAt: Date): Promise<void>;
  markApplicationGraphSyncJobDeadLetter(id: number, error: string): Promise<void>;
  markApplicationGraphSyncJobPrivacyRestricted(id: number): Promise<void>;

  // Sync skip tracking
  updateApplicationSyncSkippedReason(id: number, reason: string): Promise<void>;

  // Bulk resume import operations
  createResumeImportBatch(batch: InsertResumeImportBatch): Promise<ResumeImportBatch>;
  createResumeImportItems(items: InsertResumeImportItem[]): Promise<ResumeImportItem[]>;
  getResumeImportBatch(id: number): Promise<ResumeImportBatch | undefined>;
  getResumeImportItem(id: number): Promise<ResumeImportItem | undefined>;
  getResumeImportItemsByBatch(batchId: number): Promise<ResumeImportItem[]>;
  claimPendingResumeImportItems(limit: number, now: Date): Promise<ResumeImportItem[]>;
  markResumeImportItemProcessed(id: number, updates: {
    extractedText: string | null;
    extractionMethod: string;
    parsedName: string | null;
    parsedEmail: string | null;
    parsedPhone: string | null;
    status: string;
    errorReason?: string | null;
  }): Promise<void>;
  markResumeImportItemRetry(id: number, errorReason: string, nextAttemptAt: Date): Promise<void>;
  markResumeImportItemFailed(id: number, errorReason: string, extractionMethod?: string): Promise<void>;
  markResumeImportItemDuplicate(id: number, input: {
    errorReason: string;
    parsedEmail?: string | null;
    applicationId?: number | null;
  }): Promise<void>;
  updateResumeImportItem(id: number, updates: Partial<{
    extractedText: string | null;
    extractionMethod: string;
    parsedName: string | null;
    parsedEmail: string | null;
    parsedPhone: string | null;
    status: string;
    errorReason: string | null;
    applicationId: number | null;
  }>): Promise<ResumeImportItem | undefined>;
  markResumeImportItemFinalized(id: number, applicationId: number): Promise<void>;
  refreshResumeImportBatchStats(batchId: number): Promise<ResumeImportBatch | undefined>;
  findDuplicateResumeImportItemByEmail(batchId: number, email: string, excludeItemId: number): Promise<ResumeImportItem | undefined>;

  // Semantic search / move helpers
  getApplicationsByIdsForOrg(applicationIds: number[], organizationId: number): Promise<Application[]>;
  findApplicationByJobAndEmail(jobId: number, email: string): Promise<Application | undefined>;
  getJobsByIds(ids: number[]): Promise<Job[]>;
}

function mapApplicationGraphSyncJobRow(row: any): ApplicationGraphSyncJob {
  return {
    id: row.id,
    applicationId: row.application_id,
    organizationId: row.organization_id,
    jobId: row.job_id,
    effectiveRecruiterId: row.effective_recruiter_id,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : new Date(),
    lastError: row.last_error,
    activekgTenantId: row.activekg_tenant_id,
    activekgParentNodeId: row.activekg_parent_node_id,
    chunkCount: row.chunk_count,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

function mapResumeImportBatchRow(row: any): ResumeImportBatch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    jobId: row.job_id,
    uploadedByUserId: row.uploaded_by_user_id,
    status: row.status,
    fileCount: row.file_count,
    processedCount: row.processed_count,
    readyCount: row.ready_count,
    needsReviewCount: row.needs_review_count,
    failedCount: row.failed_count,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

function mapResumeImportItemRow(row: any): ResumeImportItem {
  return {
    id: row.id,
    batchId: row.batch_id,
    organizationId: row.organization_id,
    jobId: row.job_id,
    uploadedByUserId: row.uploaded_by_user_id,
    originalFilename: row.original_filename,
    gcsPath: row.gcs_path,
    contentHash: row.content_hash,
    extractedText: row.extracted_text,
    extractionMethod: row.extraction_method,
    parsedName: row.parsed_name,
    parsedEmail: row.parsed_email,
    parsedPhone: row.parsed_phone,
    status: row.status,
    errorReason: row.error_reason,
    applicationId: row.application_id,
    sourceMetadata: row.source_metadata,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : new Date(),
    lastProcessedAt: row.last_processed_at ? new Date(row.last_processed_at) : null,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

// Database storage implementation using Drizzle ORM
export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.username);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const normalized = username.trim();
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${normalized})`);
    return user || undefined;
  }

  async updateUserPassword(id: number, hashedPassword: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Email verification methods
  async setVerificationToken(userId: number, tokenHash: string, expires: Date): Promise<void> {
    await db
      .update(users)
      .set({
        emailVerificationToken: tokenHash,
        emailVerificationExpires: expires,
      })
      .where(eq(users.id, userId));
  }

  async getUserByVerificationToken(tokenHash: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailVerificationToken, tokenHash));
    return user || undefined;
  }

  async verifyUserEmail(userId: number): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      })
      .where(eq(users.id, userId))
      .returning();
    return user || undefined;
  }

  // Password reset methods
  async setPasswordResetToken(userId: number, tokenHash: string, expires: Date): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: tokenHash,
        passwordResetExpires: expires,
      })
      .where(eq(users.id, userId));
  }

  async getUserByPasswordResetToken(tokenHash: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.passwordResetToken, tokenHash));
    return user || undefined;
  }

  async clearPasswordResetToken(userId: number): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: null,
        passwordResetExpires: null,
      })
      .where(eq(users.id, userId));
  }

  // Profile completion methods
  async updateUserProfileSnooze(userId: number, snoozeUntil: Date): Promise<void> {
    await db
      .update(users)
      .set({ profilePromptSnoozeUntil: snoozeUntil })
      .where(eq(users.id, userId));
  }

  async markProfileCompleted(userId: number): Promise<void> {
    await db
      .update(users)
      .set({ profileCompletedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async clearProfileCompletedAt(userId: number): Promise<void> {
    await db
      .update(users)
      .set({ profileCompletedAt: null })
      .where(eq(users.id, userId));
  }

  // Contact form methods
  async createContactSubmission(submission: InsertContact): Promise<ContactSubmission> {
    const [result] = await db
      .insert(contactSubmissions)
      .values(submission)
      .returning();
    return result;
  }
  
  async getAllContactSubmissions(): Promise<ContactSubmission[]> {
    return db.select().from(contactSubmissions).orderBy(contactSubmissions.submittedAt);
  }

  // Client methods
  async getClients(organizationId?: number | null, userId?: number): Promise<Client[]> {
    if (organizationId === undefined) {
      return db.select().from(clients).orderBy(clients.name);
    }

    const conditions = [] as any[];
    if (organizationId === null) {
      if (userId != null) {
        conditions.push(and(isNull(clients.organizationId), eq(clients.createdBy, userId)));
      } else {
        conditions.push(isNull(clients.organizationId));
      }
    } else {
      conditions.push(eq(clients.organizationId, organizationId));
      if (userId != null) {
        conditions.push(and(isNull(clients.organizationId), eq(clients.createdBy, userId)));
      }
    }

    const whereClause = conditions.length === 1 ? conditions[0] : or(...conditions);
    return db.select().from(clients).where(whereClause).orderBy(clients.name);
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client || undefined;
  }

  async createClient(client: InsertClient & { createdBy: number; organizationId: number }): Promise<Client> {
    const [created] = await db
      .insert(clients)
      .values({
        name: client.name,
        domain: client.domain ?? null,
        primaryContactName: client.primaryContactName ?? null,
        primaryContactEmail: client.primaryContactEmail ?? null,
        notes: client.notes ?? null,
        createdBy: client.createdBy,
        organizationId: client.organizationId,
      })
      .returning();
    return created;
  }

  async updateClient(id: number, client: Partial<InsertClient>): Promise<Client | undefined> {
    const updates: Partial<Client> = {};

    if (client.name !== undefined) updates.name = client.name;
    if (client.domain !== undefined) updates.domain = client.domain;
    if (client.primaryContactName !== undefined) updates.primaryContactName = client.primaryContactName;
    if (client.primaryContactEmail !== undefined) updates.primaryContactEmail = client.primaryContactEmail;
    if (client.notes !== undefined) updates.notes = client.notes;

    if (Object.keys(updates).length === 0) {
      const existing = await this.getClient(id);
      return existing;
    }

    const [updated] = await db
      .update(clients)
      .set(updates)
      .where(eq(clients.id, id))
      .returning();

    return updated || undefined;
  }

  // Client Shortlist methods
  async createClientShortlist(data: {
    clientId: number;
    jobId: number;
    applicationIds: number[];
    title?: string;
    message?: string;
    expiresAt?: Date;
    createdBy: number;
    organizationId?: number;
  }): Promise<ClientShortlist> {
    const { requireCandidatePrivacyAllowed } = await import('./candidate-privacy/decision');
    await Promise.all(data.applicationIds.map((applicationId) =>
      requireCandidatePrivacyAllowed(
        { type: 'application', id: applicationId },
        { globalUse: false },
      )
    ));

    // Generate secure random token (32 bytes = 64 hex chars)
    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');

    // Create shortlist
    const [shortlist] = await db
      .insert(clientShortlists)
      .values({
        organizationId: data.organizationId,
        clientId: data.clientId,
        jobId: data.jobId,
        token,
        title: data.title ?? null,
        message: data.message ?? null,
        expiresAt: data.expiresAt ?? null,
        createdBy: data.createdBy,
      })
      .returning();

    // Create shortlist items
    const itemsToInsert = data.applicationIds.map((applicationId, index) => ({
      organizationId: shortlist.organizationId ?? undefined,
      shortlistId: shortlist.id,
      applicationId,
      position: index,
      notes: null,
    }));

    await db.insert(clientShortlistItems).values(itemsToInsert);

    return shortlist;
  }

  async getClientShortlistByToken(token: string): Promise<{
    shortlist: ClientShortlist | null;
    client: Client | null;
    job: Job | null;
    items: Array<{
      application: Application;
      position: number;
      notes: string | null;
    }>;
  }> {
    // Get shortlist
    const [shortlist] = await db
      .select()
      .from(clientShortlists)
      .where(eq(clientShortlists.token, token));

    if (!shortlist) {
      return { shortlist: null, client: null, job: null, items: [] };
    }

    // Check if expired
    if (shortlist.expiresAt && new Date() > new Date(shortlist.expiresAt)) {
      // Mark as expired
      await db
        .update(clientShortlists)
        .set({ status: 'expired' })
        .where(eq(clientShortlists.id, shortlist.id));

      return { shortlist: null, client: null, job: null, items: [] };
    }

    // Get client
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, shortlist.clientId));

    // Get job
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, shortlist.jobId));

    // Get shortlist items with applications
    const itemsData = await db
      .select({
        applicationId: clientShortlistItems.applicationId,
        position: clientShortlistItems.position,
        notes: clientShortlistItems.notes,
        application: applications,
      })
      .from(clientShortlistItems)
      .innerJoin(applications, eq(applications.id, clientShortlistItems.applicationId))
      .where(and(
        eq(clientShortlistItems.shortlistId, shortlist.id),
        applicationPrivacyAllowed(false),
      ))
      .orderBy(clientShortlistItems.position);

    const items = itemsData.map((item: { applicationId: number; position: number; notes: string | null; application: Application }) => ({
      application: item.application,
      position: item.position,
      notes: item.notes,
    }));

    return {
      shortlist,
      client: client || null,
      job: job || null,
      items,
    };
  }

  async addClientFeedback(data: InsertClientFeedback & {
    clientId: number;
    shortlistId?: number;
    organizationId?: number;
  }): Promise<ClientFeedback> {
    const { requireCandidatePrivacyAllowed } = await import('./candidate-privacy/decision');
    await requireCandidatePrivacyAllowed(
      { type: 'application', id: data.applicationId },
      { globalUse: false },
    );
    const [feedback] = await db
      .insert(clientFeedback)
      .values({
        organizationId: data.organizationId,
        applicationId: data.applicationId,
        clientId: data.clientId,
        shortlistId: data.shortlistId ?? null,
        recommendation: data.recommendation,
        notes: data.notes ?? null,
        rating: data.rating ?? null,
      })
      .returning();

    return feedback;
  }

  async getClientFeedbackForApplication(applicationId: number): Promise<ClientFeedback[]> {
    const feedback = await db
      .select({ feedback: clientFeedback })
      .from(clientFeedback)
      .innerJoin(applications, eq(clientFeedback.applicationId, applications.id))
      .where(and(
        eq(clientFeedback.applicationId, applicationId),
        applicationPrivacyAllowed(false),
      ))
      .orderBy(desc(clientFeedback.createdAt));

    return feedback.map((row: { feedback: ClientFeedback }) => row.feedback);
  }

  async getClientShortlistsByJob(jobId: number): Promise<Array<ClientShortlist & { client: Client | null }>> {
    const shortlists = await db
      .select({
        shortlist: clientShortlists,
        client: clients,
      })
      .from(clientShortlists)
      .leftJoin(clients, eq(clients.id, clientShortlists.clientId))
      .where(eq(clientShortlists.jobId, jobId))
      .orderBy(desc(clientShortlists.createdAt));

    return shortlists.map((row: { shortlist: ClientShortlist; client: Client | null }) => ({
      ...row.shortlist,
      client: row.client,
    }));
  }

  // Job methods
  async createJob(job: InsertJob & { postedBy: number; organizationId: number }): Promise<Job> {
    // Generate base slug from title
    const baseSlug = slugify(job.title, {
      lower: true,
      strict: true, // Remove special characters
      trim: true
    });

    // Insert with temporary slug, then update with unique slug using job ID
    const jobData = {
      ...job,
      slug: baseSlug, // Temporary, will be updated
      deadline: job.deadline ? job.deadline.toISOString().split('T')[0] : null
    };
    const [result] = await db
      .insert(jobs)
      .values(jobData)
      .returning();

    // Update slug to include job ID for uniqueness (e.g., "123-relationship-manager")
    // ID-first format allows the router to extract ID for direct lookup
    const uniqueSlug = `${result.id}-${baseSlug}`;
    await db
      .update(jobs)
      .set({ slug: uniqueSlug })
      .where(eq(jobs.id, result.id));

    // Auto-insert primary recruiter into job_recruiters for easy querying
    await db.insert(jobRecruiters).values({
      jobId: result.id,
      recruiterId: job.postedBy,
      addedBy: job.postedBy,
      organizationId: job.organizationId,
    }).onConflictDoNothing();

    return { ...result, slug: uniqueSlug };
  }
  
  async getJob(id: number): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job || undefined;
  }

  async getJobWithRecruiter(id: number): Promise<(Job & {
    recruiter?: { firstName: string | null; lastName: string | null; isProfilePublic: boolean; publicId: string | null };
    client?: { name: string; domain: string | null } | null;
  }) | undefined> {
    const [result] = await db
      .select({
        job: jobs,
        recruiterFirstName: users.firstName,
        recruiterLastName: users.lastName,
        isProfilePublic: userProfiles.isPublic,
        recruiterPublicId: userProfiles.publicId,
        clientName: clients.name,
        clientDomain: clients.domain,
      })
      .from(jobs)
      .leftJoin(users, eq(jobs.postedBy, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(eq(jobs.id, id));

    if (!result) return undefined;

    return {
      ...result.job,
      recruiter: {
        firstName: result.recruiterFirstName,
        lastName: result.recruiterLastName,
        isProfilePublic: result.isProfilePublic ?? false,
        publicId: result.recruiterPublicId,
      },
      client: result.clientName ? { name: result.clientName, domain: result.clientDomain } : null,
    };
  }

  async getJobBySlug(slug: string): Promise<(Job & {
    recruiter?: { firstName: string | null; lastName: string | null; isProfilePublic: boolean; publicId: string | null };
    client?: { name: string; domain: string | null } | null;
  }) | undefined> {
    const [result] = await db
      .select({
        job: jobs,
        recruiterFirstName: users.firstName,
        recruiterLastName: users.lastName,
        isProfilePublic: userProfiles.isPublic,
        recruiterPublicId: userProfiles.publicId,
        clientName: clients.name,
        clientDomain: clients.domain,
      })
      .from(jobs)
      .leftJoin(users, eq(jobs.postedBy, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(eq(jobs.slug, slug));

    if (!result) return undefined;

    return {
      ...result.job,
      recruiter: {
        firstName: result.recruiterFirstName,
        lastName: result.recruiterLastName,
        isProfilePublic: result.isProfilePublic ?? false,
        publicId: result.recruiterPublicId,
      },
      client: result.clientName ? { name: result.clientName, domain: result.clientDomain } : null,
    };
  }

  async getJobs(filters: {
    page?: number;
    limit?: number;
    location?: string;
    type?: string;
    minSalary?: number;
    maxSalary?: number;
    salaryPeriod?: string;
    search?: string;
    status?: string;
    skills?: string[];
  }): Promise<{ jobs: (Job & { postedByName?: string; postedById?: number | string; isRecruiterProfilePublic?: boolean })[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const offset = (page - 1) * limit;

    let whereConditions = [eq(jobs.isActive, true)];

    if (filters.location) {
      whereConditions.push(ilike(jobs.location, `%${filters.location}%`));
    }

    if (filters.type) {
      whereConditions.push(eq(jobs.type, filters.type));
    }

    if (filters.search) {
      const searchCondition = or(
        ilike(jobs.title, `%${filters.search}%`),
        ilike(jobs.description, `%${filters.search}%`)
      );
      if (searchCondition) {
        whereConditions.push(searchCondition);
      }
    }

    // Salary Filtering with Auto-Calculation
    const filterPeriod = filters.salaryPeriod || 'per_year';
    const isFilterYearly = filterPeriod === 'per_year';

    if (filters.minSalary) {
      const minVal = filters.minSalary;
      // We want jobs where the max salary offered is at least the user's min expectation
      // Logic: job.salaryMax (normalized) >= minVal
      if (isFilterYearly) {
        whereConditions.push(or(
          and(eq(jobs.salaryPeriod, 'per_year'), gte(jobs.salaryMax, minVal))!,
          and(eq(jobs.salaryPeriod, 'per_month'), gte(sql`${jobs.salaryMax} * 12`, minVal))!
        )!);
      } else {
        whereConditions.push(or(
          and(eq(jobs.salaryPeriod, 'per_month'), gte(jobs.salaryMax, minVal))!,
          and(eq(jobs.salaryPeriod, 'per_year'), gte(sql`${jobs.salaryMax} / 12`, minVal))!
        )!);
      }
    }

    if (filters.maxSalary) {
      const maxVal = filters.maxSalary;
      // We want jobs where the min salary starts at or below the user's max budget/expectation
      // Logic: job.salaryMin (normalized) <= maxVal
      if (isFilterYearly) {
        whereConditions.push(or(
          and(eq(jobs.salaryPeriod, 'per_year'), lte(jobs.salaryMin, maxVal))!,
          and(eq(jobs.salaryPeriod, 'per_month'), lte(sql`${jobs.salaryMin} * 12`, maxVal))!
        )!);
      } else {
        whereConditions.push(or(
          and(eq(jobs.salaryPeriod, 'per_month'), lte(jobs.salaryMin, maxVal))!,
          and(eq(jobs.salaryPeriod, 'per_year'), lte(sql`${jobs.salaryMin} / 12`, maxVal))!
        )!);
      }
    }

    if (filters.status) {
        whereConditions.push(eq(jobs.status, filters.status));
    }

    if (filters.skills && filters.skills.length > 0) {
      // Check if job skills array contains any of the filter skills
      // Using OR conditions to check each skill individually
      // Also ensure skills column is not null
      const skillConditions = filters.skills.map((skill: string) =>
        sql`${jobs.skills} IS NOT NULL AND ${skill} = ANY(${jobs.skills})`
      );
      const skillsOr = or(...skillConditions);
      if (skillsOr) {
        whereConditions.push(skillsOr);
      }
    }

    const whereClause = whereConditions.length > 1 ? and(...whereConditions) : whereConditions[0];

    const [jobResults, totalResults] = await Promise.all([
      db.select({
        job: jobs,
        recruiterFirstName: users.firstName,
        recruiterLastName: users.lastName,
        isProfilePublic: userProfiles.isPublic,
        recruiterPublicId: userProfiles.publicId,
      })
        .from(jobs)
        .leftJoin(users, eq(jobs.postedBy, users.id))
        .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
        .where(whereClause)
        .orderBy(desc(jobs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(whereClause)
    ]);

    type JobRow = typeof jobResults[number];
    return {
      jobs: jobResults.map((row: JobRow) => ({
        ...row.job,
        // Use publicId if available and profile is public, otherwise fall back to numeric ID
        postedById: (row.isProfilePublic && row.recruiterPublicId) ? row.recruiterPublicId : row.job.postedBy,
        postedByName: [row.recruiterFirstName, row.recruiterLastName].filter(Boolean).join(' ') || undefined,
        isRecruiterProfilePublic: row.isProfilePublic ?? false,
      })),
      total: totalResults[0].count
    };
  }
  
  async updateJobStatus(id: number, isActive: boolean, reason?: string, performedBy?: number): Promise<Job | undefined> {
    // Get current job state
    const currentJob = await this.getJob(id);
    if (!currentJob) return undefined;

    const now = new Date();
    const updates: Partial<Job> = {
      isActive,
      updatedAt: now
    };

    // Track lifecycle transitions
    if (currentJob.isActive && !isActive) {
      // Deactivating job
      updates.deactivatedAt = now;
      updates.deactivationReason = reason || 'manual';
      updates.warningEmailSent = false; // Reset for next cycle
    } else if (!currentJob.isActive && isActive) {
      // Reactivating job
      updates.reactivatedAt = now;
      updates.reactivationCount = (currentJob.reactivationCount || 0) + 1;
      updates.deactivationReason = null; // Clear reason on reactivation
    }

    const [job] = await db
      .update(jobs)
      .set(updates)
      .where(eq(jobs.id, id))
      .returning();

    // Log audit trail if performedBy provided
    if (job && performedBy) {
      const metadata = {
        previousStatus: currentJob.isActive ? 'active' : 'inactive',
        newStatus: isActive ? 'active' : 'inactive',
        reactivationCount: job.reactivationCount || 0
      };
      if (reason) {
        await this.logJobAction({
          jobId: id,
          action: isActive ? 'reactivated' : 'deactivated',
          performedBy,
          reason,
          metadata,
        });
      } else {
        await this.logJobAction({
          jobId: id,
          action: isActive ? 'reactivated' : 'deactivated',
          performedBy,
          metadata,
        });
      }
    }

    return job || undefined;
  }

  async updateJob(
    id: number,
    updates: Partial<Pick<Job, 'title' | 'description' | 'location' | 'type' | 'skills' | 'hiringManagerId' | 'clientId' | 'jdDigest' | 'jdDigestVersion'>>
  ): Promise<Job | undefined> {
    const currentJob = await this.getJob(id);
    if (!currentJob) return undefined;

    const [job] = await db
      .update(jobs)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id))
      .returning();

    return job || undefined;
  }

  // Job audit logging for compliance and debugging
  async logJobAction(data: {
    jobId: number;
    action: 'created' | 'approved' | 'declined' | 'deactivated' | 'reactivated';
    performedBy: number;
    reason?: string;
    metadata?: any;
  }): Promise<JobAuditLog> {
    // Get job to inherit organizationId
    const job = await this.getJob(data.jobId);
    const [log] = await db
      .insert(jobAuditLog)
      .values({
        jobId: data.jobId,
        action: data.action,
        performedBy: data.performedBy,
        reason: data.reason || null,
        metadata: data.metadata || null,
        timestamp: new Date(),
        ...(job?.organizationId != null && { organizationId: job.organizationId }),
      })
      .returning();
    return log;
  }

  // Get audit log entries for a job
  async getJobAuditLog(jobId: number): Promise<(JobAuditLog & { performedByUser: { id: number; username: string; firstName: string | null; lastName: string | null } | null })[]> {
    const results = await db
      .select({
        log: jobAuditLog,
        performedByUser: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(jobAuditLog)
      .leftJoin(users, eq(jobAuditLog.performedBy, users.id))
      .where(eq(jobAuditLog.jobId, jobId))
      .orderBy(desc(jobAuditLog.timestamp));

    type AuditLogRow = typeof results[number];
    return results.map((row: AuditLogRow) => ({
      ...row.log,
      performedByUser: row.performedByUser?.id ? row.performedByUser : null,
    }));
  }

  async getJobsByUser(userId: number, organizationId?: number | null): Promise<(Job & { applicationCount: number; hiringManager?: { id: number; firstName: string | null; lastName: string | null; username: string }; clientName?: string | null })[]> {
    // Include jobs where user is primary (postedBy) OR co-recruiter (in job_recruiters)
    // If organizationId is provided, filter to only jobs from that org (enforces data isolation after leaving)
    const whereConditions = [
      or(
        eq(jobs.postedBy, userId),
        eq(jobRecruiters.recruiterId, userId)
      )
    ];

    // If org scope provided, restrict to that org plus legacy (orgId NULL)
    // When organizationId is null, only legacy jobs (orgId NULL) are shown
    if (organizationId !== undefined) {
      if (organizationId === null) {
        whereConditions.push(isNull(jobs.organizationId));
      } else {
        whereConditions.push(or(eq(jobs.organizationId, organizationId), isNull(jobs.organizationId)));
      }
    }

    const results = await db
      .select({
        job: jobs,
        applicationCount: sql<number>`COUNT(DISTINCT ${applications.id})`,
        hiringManager: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
        },
        clientName: clients.name,
      })
      .from(jobs)
      .leftJoin(applications, eq(applications.jobId, jobs.id))
      .leftJoin(users, eq(jobs.hiringManagerId, users.id))
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .leftJoin(jobRecruiters, eq(jobRecruiters.jobId, jobs.id))
      .where(and(...whereConditions, applicationPrivacyAllowed(false)))
      .groupBy(jobs.id, users.id, users.firstName, users.lastName, users.username, clients.id, clients.name)
      .orderBy(desc(jobs.createdAt));

    type JobRow = typeof results[number];
    return results.map((row: JobRow) => ({
      ...row.job,
      applicationCount: row.applicationCount ?? 0,
      hiringManager: row.hiringManager?.id ? row.hiringManager : undefined,
      clientName: row.clientName ?? null,
    }));
  }
  
  // Phase 3: Enhanced application methods with status management
  async updateApplicationStatus(id: number, status: string, notes?: string): Promise<Application | undefined> {
    const [application] = await db
      .update(applications)
      .set({ 
        status,
        notes,
        updatedAt: new Date()
      })
      .where(and(eq(applications.id, id), applicationPrivacyAllowed(false)))
      .returning();
    return application || undefined;
  }

  async updateApplicationsStatus(ids: number[], status: string, notes?: string): Promise<number> {
    const result = await db
      .update(applications)
      .set({ 
        status,
        notes,
        updatedAt: new Date()
      })
      .where(and(inArray(applications.id, ids), applicationPrivacyAllowed(false)));
    return result.rowCount || 0;
  }

  async markApplicationViewed(id: number): Promise<Application | undefined> {
    const [application] = await db
      .update(applications)
      .set({ 
        lastViewedAt: new Date(),
        status: 'reviewed',
        updatedAt: new Date()
      })
      .where(and(eq(applications.id, id), applicationPrivacyAllowed(false)))
      .returning();
    return application || undefined;
  }

  async markApplicationDownloaded(id: number): Promise<Application | undefined> {
    const [application] = await db
      .update(applications)
      .set({
        downloadedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(applications.id, id), applicationPrivacyAllowed(false)))
      .returning();
    return application || undefined;
  }

  async reviewJob(id: number, status: string, reviewComments?: string, reviewedBy?: number): Promise<Job | undefined> {
    // Get current job state to track lifecycle transitions
    const currentJob = await this.getJob(id);
    if (!currentJob) return undefined;

    const now = new Date();
    const updates: Partial<Job> = {
      status,
      ...(reviewComments !== undefined && { reviewComments }),
      ...(reviewedBy !== undefined && { reviewedBy }),
      reviewedAt: now,
      updatedAt: now,
      isActive: status === 'approved' // Only active when approved
    };

    // If approving the job, set lifecycle timestamps
    if (status === 'approved' && !currentJob.isActive) {
      updates.reactivatedAt = now;
      updates.reactivationCount = (currentJob.reactivationCount || 0) + 1;
      updates.deactivationReason = null; // Clear reason on approval/reactivation
    }

    const [job] = await db
      .update(jobs)
      .set(updates)
      .where(eq(jobs.id, id))
      .returning();

    // Create audit log entry for approval/reactivation
    if (job && reviewedBy && status === 'approved' && !currentJob.isActive) {
      await this.logJobAction({
        jobId: id,
        action: 'reactivated',
        performedBy: reviewedBy,
        reason: 'admin_approval',
        metadata: {
          previousStatus: currentJob.status,
          newStatus: status,
          reactivationCount: job.reactivationCount || 0,
          reviewComments: reviewComments || null
        }
      });
    }

    return job || undefined;
  }

  async getJobsByStatus(status: string, page = 1, limit = 10): Promise<{ jobs: Job[]; total: number }> {
    const offset = (page - 1) * limit;
    
    const [jobResults, totalResults] = await Promise.all([
      db.select().from(jobs)
        .where(eq(jobs.status, status))
        .orderBy(desc(jobs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(eq(jobs.status, status))
    ]);
    
    return {
      jobs: jobResults,
      total: totalResults[0].count
    };
  }

  async getPublicJobsByRecruiter(recruiterId: number): Promise<Job[]> {
    // Get active, approved jobs posted by this recruiter
    const result = await db.select().from(jobs)
      .where(
        and(
          eq(jobs.postedBy, recruiterId),
          eq(jobs.isActive, true),
          eq(jobs.status, 'approved')
        )
      )
      .orderBy(desc(jobs.createdAt));
    return result;
  }

  async getPublicRecruiters(): Promise<Array<{
    id: string | number; // publicId preferred, falls back to numeric id
    publicId: string | null;
    displayName: string;
    company: string | null;
    photoUrl: string | null;
    bio: string | null;
    location: string | null;
    jobCount: number;
  }>> {
    // Get all recruiters with public profiles, along with their active job count
    const result = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        company: userProfiles.company,
        photoUrl: userProfiles.photoUrl,
        bio: userProfiles.bio,
        location: userProfiles.location,
        displayName: userProfiles.displayName,
        publicId: userProfiles.publicId,
      })
      .from(users)
      .innerJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(
        and(
          or(eq(users.role, 'recruiter'), eq(users.role, 'super_admin')),
          eq(userProfiles.isPublic, true)
        )
      )
      .orderBy(users.firstName, users.lastName);

    // Get job counts for each recruiter
    type RecruiterRow = typeof result[number];
    const recruiterIds = result.map((r: RecruiterRow) => r.id);
    const jobCounts = recruiterIds.length > 0
      ? await db
          .select({
            recruiterId: jobs.postedBy,
            count: count(jobs.id),
          })
          .from(jobs)
          .where(
            and(
              inArray(jobs.postedBy, recruiterIds),
              eq(jobs.isActive, true),
              eq(jobs.status, 'approved')
            )
          )
          .groupBy(jobs.postedBy)
      : [];

    type JobCountRow = typeof jobCounts[number];
    const jobCountMap = new Map(jobCounts.map((jc: JobCountRow) => [jc.recruiterId, jc.count]));

    return result.map((r: RecruiterRow) => ({
      id: r.publicId || r.id, // Prefer publicId for URL use
      publicId: r.publicId,
      displayName: r.displayName || [r.firstName, r.lastName].filter(Boolean).join(' ') || r.username,
      company: r.company,
      photoUrl: r.photoUrl,
      bio: r.bio,
      location: r.location,
      jobCount: jobCountMap.get(r.id) || 0,
    }));
  }

  // Application methods
  async createApplication(application: InsertApplication & {
    jobId: number;
    resumeUrl: string;
    status?: 'submitted';
    resumeFilename?: string | null;
    resumeId?: number | null;
    userId?: number | null;
    extractedResumeText?: string | undefined;
    submittedByRecruiter?: boolean;
    createdByUserId?: number;
    source?: string;
    sourceMetadata?: any;
    currentStage?: number;
    stageChangedAt?: Date;
    stageChangedBy?: number;
    organizationId?: number;
  }, executor: any = db): Promise<Application> {
    const {
      requireCandidatePrivacyAllowed,
      requireNewCandidateIdentityAllowed,
    } = await import('./candidate-privacy/decision');
    if (application.userId) {
      await requireCandidatePrivacyAllowed(
        { type: 'candidate_user', id: application.userId },
        { globalUse: true, newGlobalOperation: true },
      );
    } else {
      const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [
        { identifier_type: 'email', value: application.email.trim().toLowerCase() },
      ];
      if (application.phone?.trim()) {
        identifiers.push({ identifier_type: 'phone', value: application.phone.trim() });
      }
      await requireNewCandidateIdentityAllowed(identifiers);
    }
    const [result] = await executor
      .insert(applications)
      .values({
        ...application,
        status: 'submitted',
        appliedAt: new Date(),
        updatedAt: new Date()
      })
      .returning();
    return result;
  }

  async getApplicationsByJob(jobId: number): Promise<Application[]> {
    return await db.select().from(applications)
      .where(and(eq(applications.jobId, jobId), applicationPrivacyAllowed(false)))
      .orderBy(desc(applications.appliedAt));
  }

  async getApplicationsByUser(email: string): Promise<Application[]> {
    return await db.select().from(applications)
      .where(and(eq(applications.email, email), applicationPrivacyAllowed(false)))
      .orderBy(desc(applications.appliedAt));
  }

  async getApplication(id: number): Promise<Application | undefined> {
    const [application] = await db.select().from(applications)
      .where(and(eq(applications.id, id), applicationPrivacyAllowed(false)));
    return application || undefined;
  }

  // Worker-only raw load. Callers must perform the privacy decision immediately
  // after loading and again at every provider/publication boundary.
  async getApplicationForPrivacyWorker(id: number): Promise<Application | undefined> {
    const [application] = await db.select().from(applications).where(eq(applications.id, id));
    return application || undefined;
  }

  async getClientFeedbackCountsByApplicationIds(applicationIds: number[]): Promise<Record<number, number>> {
    if (applicationIds.length === 0) return {};

    const results = await db
      .select({
        applicationId: clientFeedback.applicationId,
        count: sql<number>`count(*)::int`,
      })
      .from(clientFeedback)
      .where(inArray(clientFeedback.applicationId, applicationIds))
      .groupBy(clientFeedback.applicationId);

    const counts: Record<number, number> = {};
    for (const row of results) {
      counts[row.applicationId] = row.count;
    }
    return counts;
  }

  // Get email history for an application
  async getApplicationEmailHistory(applicationId: number): Promise<(EmailAuditLog & { sentByUser: { id: number; username: string; firstName: string | null; lastName: string | null } | null; template: { id: number; name: string } | null })[]> {
    const results = await db
      .select({
        log: emailAuditLog,
        sentByUser: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
        template: {
          id: emailTemplates.id,
          name: emailTemplates.name,
        },
      })
      .from(emailAuditLog)
      .leftJoin(users, eq(emailAuditLog.sentBy, users.id))
      .leftJoin(emailTemplates, eq(emailAuditLog.templateId, emailTemplates.id))
      .where(eq(emailAuditLog.applicationId, applicationId))
      .orderBy(desc(emailAuditLog.sentAt));

    type EmailLogRow = typeof results[number];
    return results.map((row: EmailLogRow) => ({
      ...row.log,
      sentByUser: row.sentByUser?.id ? row.sentByUser : null,
      template: row.template?.id ? row.template : null,
    }));
  }

  // Phase 4: User profile management methods
  async getUserProfile(userId: number): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return profile || undefined;
  }

  async getUserProfileByPublicId(publicId: string): Promise<(UserProfile & { user: Pick<User, 'id' | 'firstName' | 'lastName' | 'role'> }) | undefined> {
    const result = await db
      .select({
        profile: userProfiles,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        },
      })
      .from(userProfiles)
      .innerJoin(users, eq(userProfiles.userId, users.id))
      .where(eq(userProfiles.publicId, publicId));

    if (result.length === 0) return undefined;

    return {
      ...result[0].profile,
      user: result[0].user,
    };
  }

  async createUserProfile(profile: InsertUserProfile & { userId: number }): Promise<UserProfile> {
    const [result] = await db
      .insert(userProfiles)
      .values({
        ...profile,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();
    return result;
  }

  async updateUserProfile(userId: number, profile: Partial<InsertUserProfile>): Promise<UserProfile | undefined> {
    const [result] = await db
      .update(userProfiles)
      .set({
        ...profile,
        updatedAt: new Date()
      })
      .where(eq(userProfiles.userId, userId))
      .returning();
    return result || undefined;
  }

  async getApplicationsByEmail(email: string): Promise<(Application & { job: Job })[]> {
    const results = await db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        name: applications.name,
        email: applications.email,
        phone: applications.phone,
        resumeUrl: applications.resumeUrl,
        coverLetter: applications.coverLetter,
        status: applications.status,
        notes: applications.notes,
        lastViewedAt: applications.lastViewedAt,
        downloadedAt: applications.downloadedAt,
        appliedAt: applications.appliedAt,
        updatedAt: applications.updatedAt,
        job: {
          id: jobs.id,
          title: jobs.title,
          location: jobs.location,
          type: jobs.type,
          description: jobs.description,
          skills: jobs.skills,
          deadline: jobs.deadline,
          postedBy: jobs.postedBy,
          createdAt: jobs.createdAt,
          isActive: jobs.isActive,
          status: jobs.status,
          reviewComments: jobs.reviewComments,
          expiresAt: jobs.expiresAt,
          reviewedBy: jobs.reviewedBy,
          reviewedAt: jobs.reviewedAt
        }
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(and(eq(applications.email, email), applicationPrivacyAllowed(false)))
      .orderBy(desc(applications.appliedAt));

    return results.map((result: any) => ({
      ...result,
      job: result.job
    }));
  }

  async getApplicationsByUserId(userId: number, userEmail?: string): Promise<(Application & { job: Job })[]> {
    // Build WHERE clause: match by userId OR by email (for unclaimed applications)
    const whereClause = userEmail
      ? or(
          eq(applications.userId, userId),
          and(
            sql`${applications.userId} IS NULL`,
            sql`LOWER(${applications.email}) = LOWER(${userEmail})`
          )
        )
      : eq(applications.userId, userId);

    const results = await db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        userId: applications.userId,
        aiFitScore: applications.aiFitScore,
        aiFitLabel: applications.aiFitLabel,
        aiFitReasons: applications.aiFitReasons,
        aiComputedAt: applications.aiComputedAt,
        aiStaleReason: applications.aiStaleReason,
        coverLetter: applications.coverLetter,
        status: applications.status,
        appliedAt: applications.appliedAt,
        updatedAt: applications.updatedAt,
        job: {
          id: jobs.id,
          title: jobs.title,
          location: jobs.location,
          type: jobs.type,
          description: jobs.description,
          skills: jobs.skills,
          deadline: jobs.deadline,
          createdAt: jobs.createdAt,
          isActive: jobs.isActive,
          expiresAt: jobs.expiresAt,
        }
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(and(whereClause, applicationPrivacyAllowed(false)))
      .orderBy(desc(applications.appliedAt));

    return results.map((result: any) => ({
      ...result,
      job: result.job
    }));
  }

  async withdrawApplication(applicationId: number, userId: number): Promise<boolean> {
    // First verify the application belongs to the user (bound by userId, not email)
    const application = await this.getApplication(applicationId);
    if (!application || !application.userId || application.userId !== userId) return false;

    // Delete the application
    const result = await db
      .delete(applications)
      .where(eq(applications.id, applicationId));

    return (result.rowCount || 0) > 0;
  }

  async getRecruiterApplications(recruiterId: number, organizationId?: number | null): Promise<(Application & { job: Job; feedbackCount?: number })[]> {
    const conditions = [
      or(
        eq(jobs.postedBy, recruiterId),
        eq(jobRecruiters.recruiterId, recruiterId)
      )
    ];

    if (organizationId !== undefined) {
      if (organizationId === null) {
        conditions.push(isNull(jobs.organizationId));
      } else {
        conditions.push(or(eq(jobs.organizationId, organizationId), isNull(jobs.organizationId)));
      }
    }

    const whereClause = and(...conditions, applicationPrivacyAllowed(false));

    const results = await db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        name: applications.name,
        email: applications.email,
        phone: applications.phone,
        coverLetter: applications.coverLetter,
        resumeUrl: applications.resumeUrl,
        currentStage: applications.currentStage,
        rating: applications.rating,
        // AI fit fields for recruiter views
        aiFitScore: applications.aiFitScore,
        aiFitLabel: applications.aiFitLabel,
        aiFitReasons: applications.aiFitReasons,
        aiModelVersion: applications.aiModelVersion,
        aiComputedAt: applications.aiComputedAt,
        aiStaleReason: applications.aiStaleReason,
        aiDigestVersionUsed: applications.aiDigestVersionUsed,
        resumeId: applications.resumeId,
        status: applications.status,
        notes: applications.notes,
        lastViewedAt: applications.lastViewedAt,
        downloadedAt: applications.downloadedAt,
        appliedAt: applications.appliedAt,
        updatedAt: applications.updatedAt,
        interviewDate: applications.interviewDate,
        interviewTime: applications.interviewTime,
        stageChangedAt: applications.stageChangedAt,
        feedbackCount: sql<number>`COALESCE(COUNT(DISTINCT ${applicationFeedback.id}), 0)`,
        job: {
          id: jobs.id,
          title: jobs.title,
          location: jobs.location,
          type: jobs.type,
          description: jobs.description,
          skills: jobs.skills,
          deadline: jobs.deadline,
          postedBy: jobs.postedBy,
          createdAt: jobs.createdAt,
          isActive: jobs.isActive,
          status: jobs.status,
          reviewComments: jobs.reviewComments,
          expiresAt: jobs.expiresAt,
          reviewedBy: jobs.reviewedBy,
          reviewedAt: jobs.reviewedAt
        }
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(applicationFeedback, eq(applicationFeedback.applicationId, applications.id))
      .leftJoin(jobRecruiters, eq(jobRecruiters.jobId, jobs.id))
      .where(whereClause)
      .groupBy(applications.id, jobs.id)
      .orderBy(desc(applications.appliedAt));

    return results.map((result: any) => ({
      ...result,
      job: result.job,
      feedbackCount: result.feedbackCount ?? 0
    }));
  }

  async claimApplicationsForUser(userId: number, username: string): Promise<number> {
    try {
      const result: any = await db.execute(
        sql`UPDATE applications SET user_id = ${userId}
            WHERE user_id IS NULL AND LOWER(email) = LOWER(${username})
              AND ${applicationPrivacyAllowed(false)}`
      );
      // Some drivers return rowCount, fallback to 0 if unavailable
      const updated = typeof result?.rowCount === 'number' ? result.rowCount : 0;
      return updated;
    } catch (err) {
      // Non-fatal; do not block login
      console.error('[claimApplicationsForUser] error:', err);
      return 0;
    }
  }

  async getCandidatesForRecruiter(
    recruiterId: number,
    filters?: {
      search?: string;
      minRating?: number;
      hasTags?: string[];
    }
  ): Promise<Array<{
    email: string;
    name: string;
    jobsAppliedCount: number;
    lastApplicationDate: Date;
    highestRating: number | null;
    allTags: string[];
  }>> {
    // Get user's role and organization
    const user = await db.query.users.findFirst({
      where: eq(users.id, recruiterId),
      columns: { id: true, role: true },
    });

    if (!user) {
      return [];
    }

    // Build the SQL query with aggregation
    // Note: We collect tag arrays and flatten in JS since PostgreSQL can't use unnest() inside ARRAY_AGG()
    let query;

    if (user.role === 'super_admin') {
      // Super admin sees ALL candidates across all organizations
      query = sql`
        SELECT
          a.email,
          a.name,
          COUNT(DISTINCT a.job_id)::int as jobs_applied_count,
          MAX(a.applied_at) as last_application_date,
          MAX(a.rating)::int as highest_rating,
          array_agg(a.tags) FILTER (WHERE a.tags IS NOT NULL AND array_length(a.tags, 1) > 0) as all_tags_arrays
        FROM applications a
        INNER JOIN jobs j ON a.job_id = j.id
        WHERE ${applicationPrivacyAllowedAlias("a", false)}
      `;
    } else {
      const membership = await db.query.organizationMembers.findFirst({
        where: eq(organizationMembers.userId, recruiterId),
        columns: { organizationId: true },
      });

      if (membership) {
        // Recruiters see candidates from their org jobs plus their own legacy jobs
        query = sql`
          SELECT
            a.email,
            a.name,
            COUNT(DISTINCT a.job_id)::int as jobs_applied_count,
            MAX(a.applied_at) as last_application_date,
            MAX(a.rating)::int as highest_rating,
            array_agg(a.tags) FILTER (WHERE a.tags IS NOT NULL AND array_length(a.tags, 1) > 0) as all_tags_arrays
          FROM applications a
          INNER JOIN jobs j ON a.job_id = j.id
          LEFT JOIN job_recruiters jr ON jr.job_id = j.id
          WHERE ${applicationPrivacyAllowedAlias("a", false)}
            AND (j.organization_id = ${membership.organizationId}
             OR (j.organization_id IS NULL AND (j.posted_by = ${recruiterId} OR jr.recruiter_id = ${recruiterId})))
        `;
      } else {
        // Legacy recruiters without org see candidates for their own legacy jobs only
        query = sql`
          SELECT
            a.email,
            a.name,
            COUNT(DISTINCT a.job_id)::int as jobs_applied_count,
            MAX(a.applied_at) as last_application_date,
            MAX(a.rating)::int as highest_rating,
            array_agg(a.tags) FILTER (WHERE a.tags IS NOT NULL AND array_length(a.tags, 1) > 0) as all_tags_arrays
          FROM applications a
          INNER JOIN jobs j ON a.job_id = j.id
          LEFT JOIN job_recruiters jr ON jr.job_id = j.id
          WHERE ${applicationPrivacyAllowedAlias("a", false)}
            AND j.organization_id IS NULL
            AND (j.posted_by = ${recruiterId} OR jr.recruiter_id = ${recruiterId})
        `;
      }
    }

    // Add search filter
    if (filters?.search) {
      const searchTerm = `%${filters.search.toLowerCase()}%`;
      query = sql`${query} AND (LOWER(a.name) LIKE ${searchTerm} OR LOWER(a.email) LIKE ${searchTerm})`;
    }

    // Group by email and name
    query = sql`${query} GROUP BY a.email, a.name`;

    // Add filters that apply after aggregation
    if (filters?.minRating !== undefined) {
      query = sql`${query} HAVING MAX(a.rating) >= ${filters.minRating}`;
    }

    // Order by last application date (most recent first)
    query = sql`${query} ORDER BY last_application_date DESC`;

    const rawResult: any = await db.execute(query);
    const results: any[] = Array.isArray(rawResult) ? rawResult : (rawResult?.rows ?? []);

    // Post-process results to filter by tags if needed
    let candidates = results;

    if (filters?.hasTags && filters.hasTags.length > 0) {
      candidates = candidates.filter((candidate: any) => {
        const tagArrays: string[][] = candidate.all_tags_arrays || [];
        const candidateTags = tagArrays.flat().filter(Boolean);
        if (candidateTags.length === 0) return false;
        return filters.hasTags!.some(tag => candidateTags.includes(tag));
      });
    }

    return candidates.map((row: any) => {
      // Flatten array of tag arrays and deduplicate
      const tagArrays: string[][] = row.all_tags_arrays || [];
      const flatTags = tagArrays.flat().filter(Boolean);
      const uniqueTags = [...new Set(flatTags)];

      return {
        email: row.email,
        name: row.name,
        jobsAppliedCount: row.jobs_applied_count || 0,
        lastApplicationDate: new Date(row.last_application_date),
        highestRating: row.highest_rating,
        allTags: uniqueTags
      };
    });
  }

  // ============= PHASE 5: ADMIN SUPER DASHBOARD METHODS =============

  async getAdminStats(): Promise<{
    totalJobs: number;
    activeJobs: number;
    pendingJobs: number;
    totalApplications: number;
    totalUsers: number;
    totalRecruiters: number;
  }> {
    // Get job statistics
    const jobsResult = await db.select({ count: count() }).from(jobs);
    const activeJobsResult = await db.select({ count: count() }).from(jobs).where(eq(jobs.isActive, true));
    const pendingJobsResult = await db.select({ count: count() }).from(jobs).where(eq(jobs.status, 'pending'));
    
    // Get application statistics
    const applicationsResult = await db.select({ count: count() }).from(applications)
      .where(applicationPrivacyAllowed(false));
    
    // Get user statistics
    const usersResult = await db.select({ count: count() }).from(users);
    const recruitersResult = await db.select({ count: count() }).from(users).where(eq(users.role, 'recruiter'));

    return {
      totalJobs: Number(jobsResult[0]?.count) || 0,
      activeJobs: Number(activeJobsResult[0]?.count) || 0,
      pendingJobs: Number(pendingJobsResult[0]?.count) || 0,
      totalApplications: Number(applicationsResult[0]?.count) || 0,
      totalUsers: Number(usersResult[0]?.count) || 0,
      totalRecruiters: Number(recruitersResult[0]?.count) || 0,
    };
  }

  async getAllJobsWithDetails(): Promise<any[]> {
    const jobsWithDetails = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        location: jobs.location,
        type: jobs.type,
        description: jobs.description,
        status: jobs.status,
        isActive: jobs.isActive,
        createdAt: jobs.createdAt,
        expiresAt: jobs.expiresAt,
        reviewComments: jobs.reviewComments,
        postedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
        },
      })
      .from(jobs)
      .innerJoin(users, eq(jobs.postedBy, users.id))
      .orderBy(desc(jobs.createdAt));

    // Get application counts for each job
    const jobApplicationCounts = await db
      .select({
        jobId: applications.jobId,
        count: count(),
      })
      .from(applications)
      .where(applicationPrivacyAllowed(false))
      .groupBy(applications.jobId);

    const applicationCountMap = jobApplicationCounts.reduce((acc: Record<number, number>, item: any) => {
      acc[item.jobId] = Number(item.count);
      return acc;
    }, {} as Record<number, number>);

    return jobsWithDetails.map((job: any) => ({
      ...job,
      company: "VantaHire", // Default company name since field doesn't exist in schema
      applicationCount: applicationCountMap[job.id] || 0,
    }));
  }

  async getAllApplicationsWithDetails(): Promise<any[]> {
    const applicationsWithDetails = await db
      .select({
        id: applications.id,
        name: applications.name,
        email: applications.email,
        phone: applications.phone,
        coverLetter: applications.coverLetter,
        status: applications.status,
        currentStage: applications.currentStage,
        stageName: pipelineStages.name,
        stageOrder: pipelineStages.order,
        notes: applications.notes,
        appliedAt: applications.appliedAt,
        viewedAt: applications.lastViewedAt,
        downloadedAt: applications.downloadedAt,
        job: {
          id: jobs.id,
          title: jobs.title,
        },
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(pipelineStages, eq(applications.currentStage, pipelineStages.id))
      .where(applicationPrivacyAllowed(false))
      .orderBy(desc(applications.appliedAt));

    return applicationsWithDetails.map((app: any) => ({
      ...app,
      fullName: app.name, // Map name to fullName for frontend consistency
      job: {
        ...app.job,
        company: "VantaHire", // Default company name
      },
    }));
  }

  async getAllUsersWithDetails(): Promise<any[]> {
    const usersWithDetails = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        emailVerified: users.emailVerified,
        profile: {
          bio: userProfiles.bio,
          skills: userProfiles.skills,
          linkedin: userProfiles.linkedin,
          location: userProfiles.location,
          company: userProfiles.company,
          phone: userProfiles.phone,
          createdAt: userProfiles.createdAt,
        },
      })
      .from(users)
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(or(sql`${users.role} <> 'candidate'`, candidateUserPrivacyAllowed(false)))
      .orderBy(desc(users.id)); // Order by ID since createdAt doesn't exist

    // Get job counts for recruiters
    const jobCounts = await db
      .select({
        userId: jobs.postedBy,
        count: count(),
      })
      .from(jobs)
      .groupBy(jobs.postedBy);

    const jobCountMap = jobCounts.reduce((acc: Record<number, number>, item: any) => {
      acc[item.userId] = Number(item.count);
      return acc;
    }, {} as Record<number, number>);

    // Get total candidates/applications per recruiter (across all their jobs)
    const recruiterCandidateCounts = await db
      .select({
        recruiterId: jobs.postedBy,
        candidateCount: count(applications.id),
      })
      .from(jobs)
      .leftJoin(applications, eq(applications.jobId, jobs.id))
      .where(applicationPrivacyAllowed(false))
      .groupBy(jobs.postedBy);

    const recruiterCandidateMap = recruiterCandidateCounts.reduce((acc: Record<number, number>, item: any) => {
      acc[item.recruiterId] = Number(item.candidateCount) || 0;
      return acc;
    }, {} as Record<number, number>);

    // Get application counts for candidates
    const applicationCounts = await db
      .select({
        email: applications.email,
        count: count(),
      })
      .from(applications)
      .where(applicationPrivacyAllowed(false))
      .groupBy(applications.email);

    const applicationCountMap = applicationCounts.reduce((acc: Record<string, number>, item: any) => {
      acc[item.email] = Number(item.count);
      return acc;
    }, {} as Record<string, number>);

    // Get resume counts for candidates
    const resumeCounts = await db
      .select({
        userId: candidateResumes.userId,
        count: count(),
      })
      .from(candidateResumes)
      .innerJoin(users, eq(candidateResumes.userId, users.id))
      .where(candidateUserPrivacyAllowed(false))
      .groupBy(candidateResumes.userId);

    const resumeCountMap = resumeCounts.reduce((acc: Record<number, number>, item: any) => {
      acc[item.userId] = Number(item.count);
      return acc;
    }, {} as Record<number, number>);

    return usersWithDetails.map((user: any) => {
      const result: any = {
        ...user,
        email: user.username, // username is the email
        createdAt: user.profile?.createdAt?.toISOString() || new Date().toISOString(),
        profile: user.profile && (user.profile.bio || user.profile.skills || user.profile.linkedin || user.profile.location || user.profile.company)
          ? user.profile
          : undefined,
      };

      if (user.role === 'recruiter' || user.role === 'super_admin') {
        result.jobCount = jobCountMap[user.id] || 0;
        result.candidateCount = recruiterCandidateMap[user.id] || 0;
      }

      if (user.role === 'candidate') {
        result.applicationCount = applicationCountMap[user.username] || 0;
        result.resumeCount = resumeCountMap[user.id] || 0;
      }

      return result;
    });
  }

  async updateUserRole(userId: number, role: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, userId))
      .returning();

    return user || undefined;
  }

  async deleteJob(jobId: number): Promise<boolean> {
    // First delete all applications for this job
    await db.delete(applications).where(eq(applications.jobId, jobId));

    // Then delete the job itself
    const result = await db.delete(jobs).where(eq(jobs.id, jobId));

    return (result.rowCount || 0) > 0;
  }

  // Job analytics methods
  async getJobAnalytics(jobId: number): Promise<JobAnalytics | undefined> {
    const [analytics] = await db
      .select()
      .from(jobAnalytics)
      .where(eq(jobAnalytics.jobId, jobId));
    return analytics || undefined;
  }

  async createJobAnalytics(analytics: InsertJobAnalytics & { organizationId?: number }): Promise<JobAnalytics> {
    let insertData = analytics;
    if (analytics.organizationId == null) {
      const job = await this.getJob(analytics.jobId);
      if (job?.organizationId != null) {
        insertData = { ...analytics, organizationId: job.organizationId };
      }
    }

    const [result] = await db
      .insert(jobAnalytics)
      .values(insertData)
      .returning();
    return result;
  }

  async incrementJobViews(jobId: number): Promise<JobAnalytics | undefined> {
    try {
      // Try to increment existing record first (most common case)
      const [updated] = await db
        .update(jobAnalytics)
        .set({ 
          views: sql`${jobAnalytics.views} + 1`,
          updatedAt: new Date()
        })
        .where(eq(jobAnalytics.jobId, jobId))
        .returning();
      
      if (updated) {
        // Update conversion rate
        await this.updateConversionRate(jobId);
        return updated;
      }
    } catch (error) {
      // If update fails, record might not exist, continue to create
    }

    // Create new analytics record if none exists
    try {
      const analytics = await this.createJobAnalytics({ jobId, views: 1, applyClicks: 0 });
      await this.updateConversionRate(jobId);
      return analytics;
    } catch (error) {
      // Handle potential race condition where another request created the record
      // Try increment again
      const [updated] = await db
        .update(jobAnalytics)
        .set({ 
          views: sql`${jobAnalytics.views} + 1`,
          updatedAt: new Date()
        })
        .where(eq(jobAnalytics.jobId, jobId))
        .returning();
      
      if (updated) {
        await this.updateConversionRate(jobId);
      }
      return updated;
    }
  }

  async incrementApplyClicks(jobId: number): Promise<JobAnalytics | undefined> {
    try {
      // Try to increment existing record first (most common case)
      const [updated] = await db
        .update(jobAnalytics)
        .set({ 
          applyClicks: sql`${jobAnalytics.applyClicks} + 1`,
          updatedAt: new Date()
        })
        .where(eq(jobAnalytics.jobId, jobId))
        .returning();
      
      if (updated) {
        // Update conversion rate
        await this.updateConversionRate(jobId);
        return updated;
      }
    } catch (error) {
      // If update fails, record might not exist, continue to create
    }

    // Create new analytics record if none exists
    try {
      const analytics = await this.createJobAnalytics({ jobId, views: 0, applyClicks: 1 });
      await this.updateConversionRate(jobId);
      return analytics;
    } catch (error) {
      // Handle potential race condition where another request created the record
      // Try increment again
      const [updated] = await db
        .update(jobAnalytics)
        .set({ 
          applyClicks: sql`${jobAnalytics.applyClicks} + 1`,
          updatedAt: new Date()
        })
        .where(eq(jobAnalytics.jobId, jobId))
        .returning();
      
      if (updated) {
        await this.updateConversionRate(jobId);
      }
      return updated;
    }
  }

  async updateConversionRate(jobId: number): Promise<JobAnalytics | undefined> {
    const analytics = await this.getJobAnalytics(jobId);
    if (!analytics) return undefined;

    const conversionRate = analytics.views > 0 
      ? ((analytics.applyClicks / analytics.views) * 100).toFixed(2)
      : "0.00";

    const [updated] = await db
      .update(jobAnalytics)
      .set({ 
        conversionRate,
        updatedAt: new Date()
      })
      .where(eq(jobAnalytics.jobId, jobId))
      .returning();

    return updated;
  }

  async updateJobAnalytics(jobId: number, updates: { aiScoreCache?: number; aiModelVersion?: string }): Promise<JobAnalytics | undefined> {
    const [updated] = await db
      .update(jobAnalytics)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(jobAnalytics.jobId, jobId))
      .returning();

    return updated || undefined;
  }

  async getJobsWithAnalytics(userId?: number, organizationId?: number): Promise<any[]> {
    let query = db
      .select({
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
         clientId: jobs.clientId,
         clientName: clients.name,
        postedBy: jobs.postedBy,
        postedByUser: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
        },
        analytics: {
          views: jobAnalytics.views,
          applyClicks: jobAnalytics.applyClicks,
          conversionRate: jobAnalytics.conversionRate,
        }
      })
      .from(jobs)
      .innerJoin(users, eq(jobs.postedBy, users.id))
      .leftJoin(jobAnalytics, eq(jobs.id, jobAnalytics.jobId))
      .leftJoin(clients, eq(jobs.clientId, clients.id));

    // Filter by organization for org-wide analytics (owner/admin view)
    if (organizationId) {
      query = query.where(eq(jobs.organizationId, organizationId)) as any;
    } else if (userId) {
      // Include jobs where user is primary (postedBy) OR co-recruiter (in job_recruiters)
      const coRecruiterJobIds = db.select({ id: jobRecruiters.jobId }).from(jobRecruiters).where(eq(jobRecruiters.recruiterId, userId));
      query = query.where(
        or(
          eq(jobs.postedBy, userId),
          inArray(jobs.id, coRecruiterJobIds)
        )
      ) as any;
    }

    const results = await query.orderBy(desc(jobs.createdAt));

    return results.map((row: any) => ({
      ...row,
      analytics: row.analytics || { views: 0, applyClicks: 0, conversionRate: "0.00" },
      clientId: row.clientId ?? null,
      clientName: row.clientName ?? null,
    }));
  }

  async getJobHealthSummary(userId?: number, organizationId?: number): Promise<JobHealthSummary[]> {
    const now = new Date();

    let query = db
      .select({
        jobId: jobs.id,
        jobTitle: jobs.title,
        isActive: jobs.isActive,
        jobStatus: jobs.status,
        createdAt: jobs.createdAt,
        conversionRate: jobAnalytics.conversionRate,
        totalApplications: sql<number>`COUNT(${applications.id})::int`,
        lastApplicationAt: sql<Date | null>`MAX(${applications.appliedAt})`,
      })
      .from(jobs)
      .leftJoin(jobAnalytics, eq(jobs.id, jobAnalytics.jobId))
      .leftJoin(applications, eq(applications.jobId, jobs.id));

    const privacyCondition = applicationPrivacyAllowed(false);
    // Filter by organization for org-wide analytics (owner/admin view)
    if (organizationId) {
      query = query.where(and(eq(jobs.organizationId, organizationId), privacyCondition)) as any;
    } else if (userId) {
      // Include jobs where user is primary (postedBy) OR co-recruiter (in job_recruiters)
      const coRecruiterJobIds = db.select({ id: jobRecruiters.jobId }).from(jobRecruiters).where(eq(jobRecruiters.recruiterId, userId));
      query = query.where(and(
        or(
          eq(jobs.postedBy, userId),
          inArray(jobs.id, coRecruiterJobIds)
        ),
        privacyCondition,
      )) as any;
    } else {
      query = query.where(privacyCondition) as any;
    }

    const rows = await query
      .groupBy(
        jobs.id,
        jobs.title,
        jobs.isActive,
        jobs.status,
        jobs.createdAt,
        jobAnalytics.conversionRate,
      )
      .orderBy(desc(jobs.createdAt));

    return rows.map((row: any): JobHealthSummary => {
      const createdAt: Date = new Date(row.createdAt);
      const daysSincePosted = Math.max(
        0,
        Math.round((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      );

      const lastApplicationAt: Date | null = row.lastApplicationAt ? new Date(row.lastApplicationAt) : null;
      const daysSinceLastApplication = lastApplicationAt
        ? Math.max(
            0,
            Math.round(
              (now.getTime() - lastApplicationAt.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;

      const conversionRateRaw = row.conversionRate;
      const conversionRate =
        conversionRateRaw != null ? parseFloat(String(conversionRateRaw)) : 0;

      const totalApplications: number = row.totalApplications ?? 0;
      const isActive: boolean = row.isActive;
      const jobStatus: string = row.jobStatus;

      let status: JobHealthStatus = "green";
      let reason = "Healthy pipeline";

      if (!isActive) {
        status = "red";
        reason = "Job is inactive";
      } else if (jobStatus !== "approved") {
        status = "amber";
        reason = "Job not yet approved";
      } else if (totalApplications === 0 && daysSincePosted > 7) {
        status = "red";
        reason = "No applications after the first week";
      } else if (totalApplications < 3 && daysSincePosted > 14) {
        status = "red";
        reason = "Very low application volume for job age";
      } else if (
        daysSinceLastApplication !== null &&
        daysSinceLastApplication > 14
      ) {
        status = "amber";
        reason = "No new applications in the last 14 days";
      } else if (conversionRate < 5 && totalApplications >= 5) {
        status = "amber";
        reason = "Low conversion from views to applications";
      }

      return {
        jobId: row.jobId,
        jobTitle: row.jobTitle,
        isActive,
        status,
        reason,
        totalApplications,
        daysSincePosted,
        daysSinceLastApplication,
        conversionRate,
      };
    });
  }

  async getAnalyticsNudges(
    userId?: number,
    organizationId?: number,
  ): Promise<{
    jobsNeedingAttention: JobHealthSummary[];
    staleCandidates: StaleCandidatesSummary[];
  }> {
    const jobHealth = await this.getJobHealthSummary(userId, organizationId);
    const jobsNeedingAttention = jobHealth.filter((job) => job.status !== "green");

    const now = new Date();
    const STALE_DAYS = 10;
    const staleThresholdMs = STALE_DAYS * 24 * 60 * 60 * 1000;

    let query = db
      .select({
        jobId: jobs.id,
        jobTitle: jobs.title,
        applicationId: applications.id,
        status: applications.status,
        isActive: jobs.isActive,
        stageChangedAt: applications.stageChangedAt,
        appliedAt: applications.appliedAt,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id));

    const privacyCondition = applicationPrivacyAllowed(false);
    // Filter by organization for org-wide analytics (owner/admin view)
    if (organizationId) {
      query = query.where(and(eq(jobs.organizationId, organizationId), privacyCondition)) as any;
    } else if (userId) {
      // Include jobs where user is primary (postedBy) OR co-recruiter (in job_recruiters)
      const coRecruiterJobIds = db.select({ id: jobRecruiters.jobId }).from(jobRecruiters).where(eq(jobRecruiters.recruiterId, userId));
      query = query.where(and(
        or(
          eq(jobs.postedBy, userId),
          inArray(jobs.id, coRecruiterJobIds)
        ),
        privacyCondition,
      )) as any;
    } else {
      query = query.where(privacyCondition) as any;
    }

    const rows = await query;

    const staleMap = new Map<
      number,
      { jobTitle: string; count: number; oldestStaleMs: number }
    >();

    for (const row of rows as any[]) {
      if (!row.isActive) continue;
      if (row.status === "rejected") continue;

      const baseDate: Date | null = row.stageChangedAt || row.appliedAt;
      if (!baseDate) continue;

      const diffMs = now.getTime() - new Date(baseDate).getTime();
      if (diffMs < staleThresholdMs) continue;

      const existing = staleMap.get(row.jobId);
      if (!existing) {
        staleMap.set(row.jobId, {
          jobTitle: row.jobTitle,
          count: 1,
          oldestStaleMs: diffMs,
        });
      } else {
        existing.count += 1;
        if (diffMs > existing.oldestStaleMs) {
          existing.oldestStaleMs = diffMs;
        }
      }
    }

    const staleCandidates: StaleCandidatesSummary[] = Array.from(
      staleMap.entries(),
    ).map(([jobId, data]) => ({
      jobId,
      jobTitle: data.jobTitle,
      count: data.count,
      oldestStaleDays: Math.max(
        0,
        Math.round(data.oldestStaleMs / (1000 * 60 * 60 * 24)),
      ),
    }));

    staleCandidates.sort((a, b) => b.count - a.count);

    return {
      jobsNeedingAttention,
      staleCandidates,
    };
  }

  async getClientAnalytics(
    userId?: number,
    organizationId?: number,
  ): Promise<
    Array<{
      clientId: number;
      clientName: string;
      rolesCount: number;
      totalApplications: number;
      placementsCount: number;
    }>
  > {
    let query = db
      .select({
        clientId: clients.id,
        clientName: clients.name,
        rolesCount: sql<number>`COUNT(DISTINCT ${jobs.id})::int`,
        totalApplications: sql<number>`COUNT(${applications.id})::int`,
      })
      .from(clients)
      .leftJoin(jobs, eq(jobs.clientId, clients.id))
      .leftJoin(applications, eq(applications.jobId, jobs.id));

    const privacyCondition = applicationPrivacyAllowed(false);
    // Filter by organization for org-wide analytics (owner/admin view)
    if (organizationId) {
      query = query.where(and(eq(clients.organizationId, organizationId), privacyCondition)) as any;
    } else if (userId) {
      // Include jobs where user is primary (postedBy) OR co-recruiter (in job_recruiters)
      const coRecruiterJobIds = db.select({ id: jobRecruiters.jobId }).from(jobRecruiters).where(eq(jobRecruiters.recruiterId, userId));
      query = query.where(and(
        or(
          eq(jobs.postedBy, userId),
          inArray(jobs.id, coRecruiterJobIds)
        ),
        privacyCondition,
      )) as any;
    } else {
      query = query.where(privacyCondition) as any;
    }

    const rows = await query
      .groupBy(clients.id, clients.name)
      .orderBy(clients.name);

    return rows.map((row: any) => ({
      clientId: row.clientId,
      clientName: row.clientName,
      rolesCount: row.rolesCount ?? 0,
      totalApplications: row.totalApplications ?? 0,
      placementsCount: 0,
    }));
  }

  // ===== ATS: Pipeline and Interviews =====
  async getPipelineStages(organizationId?: number | null, userId?: number): Promise<PipelineStage[]> {
    if (organizationId === undefined) {
      return db.select().from(pipelineStages).orderBy(pipelineStages.order, pipelineStages.id);
    }

    const conditions = [] as any[];

    if (organizationId === null) {
      conditions.push(and(isNull(pipelineStages.organizationId), eq(pipelineStages.isDefault, true)));
      if (userId != null) {
        conditions.push(and(isNull(pipelineStages.organizationId), eq(pipelineStages.createdBy, userId)));
      }
    } else {
      conditions.push(eq(pipelineStages.organizationId, organizationId));
      conditions.push(and(isNull(pipelineStages.organizationId), eq(pipelineStages.isDefault, true)));
      if (userId != null) {
        conditions.push(and(isNull(pipelineStages.organizationId), eq(pipelineStages.createdBy, userId)));
      }
    }

    const whereClause = conditions.length === 1 ? conditions[0] : or(...conditions);
    const stages = await db.select().from(pipelineStages).where(whereClause).orderBy(pipelineStages.order, pipelineStages.id);

    type StageRow = typeof stages[number];

    if (organizationId != null) {
      const normalizedOrgStageNames = new Set<string>();
      for (const stage of stages) {
        if (stage.organizationId === organizationId) {
          normalizedOrgStageNames.add(normalizeStageName(stage.name));
        }
      }

      if (normalizedOrgStageNames.size > 0) {
        const defaultDuplicateCandidates = stages.filter(
          (stage: StageRow) => stage.organizationId == null && stage.isDefault && normalizedOrgStageNames.has(normalizeStageName(stage.name))
        );

        if (defaultDuplicateCandidates.length > 0) {
          const defaultDuplicateIds = defaultDuplicateCandidates.map((stage: StageRow) => stage.id);
          const usedDefaults = await db
            .select({ stageId: applications.currentStage, count: sql<number>`count(*)::int` })
            .from(applications)
            .innerJoin(jobs, eq(applications.jobId, jobs.id))
            .where(and(
              eq(jobs.organizationId, organizationId),
              inArray(applications.currentStage, defaultDuplicateIds),
              applicationPrivacyAllowed(false),
            ))
            .groupBy(applications.currentStage);

          const usedDefaultIds = new Set<number>();
          for (const row of usedDefaults) {
            if (row.stageId != null) usedDefaultIds.add(row.stageId);
          }

          return stages.filter((stage: StageRow) => {
            if (stage.organizationId == null && stage.isDefault && normalizedOrgStageNames.has(normalizeStageName(stage.name))) {
              return usedDefaultIds.has(stage.id);
            }
            return true;
          });
        }
      }
    }

    return stages;
  }

  async createPipelineStage(stage: InsertPipelineStage & { createdBy?: number; organizationId?: number }): Promise<PipelineStage> {
    const [result] = await db.insert(pipelineStages).values(stage).returning();
    return result;
  }

  async getPipelineStage(id: number, organizationId?: number): Promise<PipelineStage | undefined> {
    const whereClause = organizationId != null
      ? and(eq(pipelineStages.id, id), eq(pipelineStages.organizationId, organizationId))
      : eq(pipelineStages.id, id);
    const [stage] = await db.select().from(pipelineStages).where(whereClause);
    return stage || undefined;
  }

  async updatePipelineStage(
    id: number,
    updates: Partial<Pick<PipelineStage, 'name' | 'color' | 'order'>>,
    organizationId?: number
  ): Promise<PipelineStage | undefined> {
    const whereClause = organizationId != null
      ? and(eq(pipelineStages.id, id), eq(pipelineStages.organizationId, organizationId))
      : eq(pipelineStages.id, id);
    const [result] = await db
      .update(pipelineStages)
      .set(updates)
      .where(whereClause)
      .returning();
    return result || undefined;
  }

  async deletePipelineStage(id: number, organizationId?: number): Promise<boolean> {
    const whereClause = organizationId != null
      ? and(eq(pipelineStages.id, id), eq(pipelineStages.organizationId, organizationId))
      : eq(pipelineStages.id, id);
    const result = await db.delete(pipelineStages).where(whereClause);
    return (result.rowCount || 0) > 0;
  }

  async getApplicationsInStage(stageId: number): Promise<Application[]> {
    return db.select().from(applications).where(
      and(eq(applications.currentStage, stageId), applicationPrivacyAllowed(false)),
    );
  }

  async updateApplicationStage(appId: number, newStageId: number, changedBy: number, notes?: string): Promise<void> {
    // Use transaction to ensure atomicity of stage change + history insert
    await db.transaction(async (tx: any) => {
      // Get current application state
      const app = await tx.query.applications.findFirst({
        where: and(eq(applications.id, appId), applicationPrivacyAllowed(false))
      });

      if (!app) {
        throw new Error(`Application ${appId} not found`);
      }

      // Update application stage
      await tx.update(applications)
        .set({
          currentStage: newStageId,
          stageChangedAt: new Date(),
          stageChangedBy: changedBy,
          updatedAt: new Date()
        })
        .where(and(eq(applications.id, appId), applicationPrivacyAllowed(false)));

      // Insert stage history
      await tx.insert(applicationStageHistory).values({
        applicationId: appId,
        fromStage: app.currentStage || null,
        toStage: newStageId,
        changedBy,
        notes,
      });
    });
  }

  async getApplicationStageHistory(appId: number): Promise<any[]> {
    const rows = await db
      .select({ history: applicationStageHistory })
      .from(applicationStageHistory)
      .innerJoin(applications, eq(applicationStageHistory.applicationId, applications.id))
      .where(and(
        eq(applicationStageHistory.applicationId, appId),
        applicationPrivacyAllowed(false),
      ))
      .orderBy(desc(applicationStageHistory.changedAt));
    return rows.map((row: { history: typeof applicationStageHistory.$inferSelect }) => row.history);
  }

  async scheduleInterview(appId: number, fields: { date?: Date; time?: string; location?: string; notes?: string }): Promise<Application | undefined> {
    const [result] = await db.update(applications)
      .set({
        interviewDate: fields.date || null,
        interviewTime: fields.time || null,
        interviewLocation: fields.location || null,
        interviewNotes: fields.notes || null,
        updatedAt: new Date(),
      })
      .where(and(eq(applications.id, appId), applicationPrivacyAllowed(false)))
      .returning();
    return result || undefined;
  }

  // Atomic interview scheduling with optional stage update (for bulk scheduling)
  async scheduleInterviewWithStage(
    appId: number,
    interviewFields: { date?: Date; time?: string; location?: string; notes?: string },
    stageUpdate?: { targetStageId: number; changedBy: number; notes?: string; currentStageOrder: number | null; targetStageOrder: number }
  ): Promise<Application | undefined> {
    return await db.transaction(async (tx: any) => {
      // Update interview details
      const [updatedApp] = await tx.update(applications)
        .set({
          interviewDate: interviewFields.date || null,
          interviewTime: interviewFields.time || null,
          interviewLocation: interviewFields.location || null,
          interviewNotes: interviewFields.notes || null,
          updatedAt: new Date(),
        })
        .where(and(eq(applications.id, appId), applicationPrivacyAllowed(false)))
        .returning();

      if (!updatedApp) {
        throw new Error(`Application ${appId} not found`);
      }

      // Optionally update stage if needed
      if (stageUpdate) {
        const currentStageId = updatedApp.currentStage ?? null;

        // Only advance stage if current stage is before target (or no current stage)
        const shouldUpdateStage = currentStageId === null ||
          stageUpdate.currentStageOrder === null ||
          stageUpdate.currentStageOrder < stageUpdate.targetStageOrder;

        if (shouldUpdateStage) {
          // Update application stage
          await tx.update(applications)
            .set({
              currentStage: stageUpdate.targetStageId,
              stageChangedAt: new Date(),
              stageChangedBy: stageUpdate.changedBy,
              updatedAt: new Date()
            })
            .where(and(eq(applications.id, appId), applicationPrivacyAllowed(false)));

          // Insert stage history
          await tx.insert(applicationStageHistory).values({
            applicationId: appId,
            fromStage: currentStageId,
            toStage: stageUpdate.targetStageId,
            changedBy: stageUpdate.changedBy,
            notes: stageUpdate.notes,
          });
        }
      }

      return updatedApp;
    });
  }

  async addRecruiterNote(appId: number, note: string): Promise<Application | undefined> {
    const [result] = await db.update(applications)
      .set({
        // Ensure NULL-safe append: COALESCE to empty text[] then concatenate ARRAY[note]
        recruiterNotes: sql`COALESCE(${applications.recruiterNotes}, ARRAY[]::text[]) || ARRAY[${note}]`,
        updatedAt: new Date(),
      })
      .where(and(eq(applications.id, appId), applicationPrivacyAllowed(false)))
      .returning();
    return result || undefined;
  }

  async setApplicationRating(appId: number, rating: number): Promise<Application | undefined> {
    const [result] = await db.update(applications)
      .set({ rating, updatedAt: new Date() })
      .where(and(eq(applications.id, appId), applicationPrivacyAllowed(false)))
      .returning();
    return result || undefined;
  }

  // ===== ATS: Email templates =====
  async getEmailTemplates(organizationId?: number | null, userId?: number): Promise<EmailTemplate[]> {
    if (organizationId === undefined) {
      return db.select().from(emailTemplates).orderBy(desc(emailTemplates.createdAt));
    }

    const conditions = [] as any[];

    if (organizationId === null) {
      conditions.push(and(isNull(emailTemplates.organizationId), eq(emailTemplates.isDefault, true)));
      if (userId != null) {
        conditions.push(and(isNull(emailTemplates.organizationId), eq(emailTemplates.createdBy, userId)));
      }
    } else {
      conditions.push(eq(emailTemplates.organizationId, organizationId));
      conditions.push(and(isNull(emailTemplates.organizationId), eq(emailTemplates.isDefault, true)));
      if (userId != null) {
        conditions.push(and(isNull(emailTemplates.organizationId), eq(emailTemplates.createdBy, userId)));
      }
    }

    const whereClause = conditions.length === 1 ? conditions[0] : or(...conditions);
    return db.select().from(emailTemplates).where(whereClause).orderBy(desc(emailTemplates.createdAt));
  }

  async createEmailTemplate(template: InsertEmailTemplate & { createdBy?: number; organizationId?: number }): Promise<EmailTemplate> {
    const [result] = await db.insert(emailTemplates).values(template).returning();
    return result;
  }

  // ===== ATS: Automation settings =====
  async getAutomationSettings(organizationId?: number): Promise<AutomationSetting[]> {
    if (organizationId) {
      return db.select().from(automationSettings).where(eq(automationSettings.organizationId, organizationId)).orderBy(automationSettings.settingKey);
    }
    return db.select().from(automationSettings).orderBy(automationSettings.settingKey);
  }

  async getAutomationSetting(key: string, organizationId?: number): Promise<AutomationSetting | undefined> {
    const whereClause = organizationId != null
      ? and(eq(automationSettings.settingKey, key), eq(automationSettings.organizationId, organizationId))
      : and(eq(automationSettings.settingKey, key), isNull(automationSettings.organizationId));
    const [result] = await db.select().from(automationSettings).where(whereClause);
    return result;
  }

  async updateAutomationSetting(
    key: string,
    value: boolean,
    updatedBy: number,
    organizationId?: number
  ): Promise<AutomationSetting> {
    // Try to update existing setting
    const existing = await this.getAutomationSetting(key, organizationId);

    if (existing) {
      const [updated] = await db
        .update(automationSettings)
        .set({
          settingValue: value,
          updatedBy,
          updatedAt: new Date(),
        })
        .where(and(
          eq(automationSettings.settingKey, key),
          organizationId != null
            ? eq(automationSettings.organizationId, organizationId)
            : isNull(automationSettings.organizationId)
        ))
        .returning();
      return updated;
    } else {
      // Create new setting if it doesn't exist
      const [created] = await db
        .insert(automationSettings)
        .values({
          settingKey: key,
          settingValue: value,
          updatedBy,
          ...(organizationId != null && { organizationId }),
        })
        .returning();
      return created;
    }
  }

  async isAutomationEnabled(key: string, organizationId?: number): Promise<boolean> {
    // First check environment variable for global override
    const globalEnabled = process.env.EMAIL_AUTOMATION_ENABLED === 'true' || process.env.EMAIL_AUTOMATION_ENABLED === '1';
    if (!globalEnabled) return false;

    // Then check specific setting in database
    if (organizationId != null) {
      const orgSetting = await this.getAutomationSetting(key, organizationId);
      if (orgSetting) return orgSetting.settingValue;
    }
    const globalSetting = await this.getAutomationSetting(key);
    return globalSetting?.settingValue ?? true; // Default to enabled if not set
  }

  // ===== Consultant methods =====
  async getConsultants(): Promise<Consultant[]> {
    return db.select().from(consultants).orderBy(desc(consultants.createdAt));
  }

  async getActiveConsultants(): Promise<Consultant[]> {
    return db.select().from(consultants).where(eq(consultants.isActive, true)).orderBy(desc(consultants.createdAt));
  }

  async getConsultant(id: number): Promise<Consultant | undefined> {
    const [result] = await db.select().from(consultants).where(eq(consultants.id, id));
    return result;
  }

  async createConsultant(consultant: InsertConsultant): Promise<Consultant> {
    const [result] = await db.insert(consultants).values(consultant).returning();
    return result;
  }

  async updateConsultant(id: number, consultant: Partial<InsertConsultant>): Promise<Consultant | undefined> {
    const [result] = await db
      .update(consultants)
      .set({ ...consultant, updatedAt: new Date() })
      .where(eq(consultants.id, id))
      .returning();
    return result;
  }

  async deleteConsultant(id: number): Promise<boolean> {
    const result = await db.delete(consultants).where(eq(consultants.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // AI cross-job matching
  async getSimilarCandidatesForJob(
    jobId: number,
    recruiterId: number,
    options?: { minFitScore?: number; limit?: number }
  ): Promise<Array<{
    applicationId: number;
    candidateName: string;
    candidateEmail: string;
    sourceJobId: number;
    sourceJobTitle: string;
    aiFitScore: number | null;
    aiFitLabel: string | null;
    currentStage: number | null;
  }>> {
    const minFit = options?.minFitScore ?? 70;
    const limit = options?.limit ?? 20;

    // 1. Load target job, ensure it belongs to this recruiter
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    // 2. Query candidates from other jobs with overlapping skills and high fit
    const results = await db
      .select({
        applicationId: applications.id,
        candidateName: applications.name,
        candidateEmail: applications.email,
        sourceJobId: jobs.id,
        sourceJobTitle: jobs.title,
        aiFitScore: applications.aiFitScore,
        aiFitLabel: applications.aiFitLabel,
        currentStage: applications.currentStage,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(
        and(
          // Include jobs where recruiter is primary OR co-recruiter
          or(
            eq(jobs.postedBy, recruiterId),
            inArray(jobs.id, db.select({ id: jobRecruiters.jobId }).from(jobRecruiters).where(eq(jobRecruiters.recruiterId, recruiterId)))
          ),
          sql`${jobs.id} <> ${jobId}`,
          sql`${applications.aiFitScore} IS NOT NULL AND ${applications.aiFitScore} >= ${minFit}`,
          applicationPrivacyAllowed(true),
          job.skills && job.skills.length > 0
            ? sql`${jobs.skills} && ${job.skills}` // array overlap operator
            : sql`TRUE`
        )
      )
      .orderBy(desc(applications.aiFitScore))
      .limit(limit);

    return results;
  }

  // ===== TALENT POOL MANAGEMENT =====

  async getTalentPoolByRecruiter(recruiterId: number): Promise<TalentPool[]> {
    return db.select()
      .from(talentPool)
      .where(and(
        eq(talentPool.recruiterId, recruiterId),
        isNull(talentPool.removedAt),
        talentPoolPrivacyAllowed(false),
      ))
      .orderBy(desc(talentPool.createdAt));
  }

  async getTalentPoolCandidate(id: number): Promise<TalentPool | undefined> {
    const [result] = await db.select().from(talentPool).where(
      and(eq(talentPool.id, id), isNull(talentPool.removedAt), talentPoolPrivacyAllowed(false)),
    );
    return result || undefined;
  }

  async getRemovedTalentPoolCandidate(id: number): Promise<TalentPool | undefined> {
    const [result] = await db.select().from(talentPool).where(and(
      eq(talentPool.id, id),
      talentPoolPrivacyAllowed(false),
    ));
    return result || undefined;
  }

  async getTalentPoolByEmail(recruiterId: number, email: string): Promise<TalentPool | undefined> {
    const [result] = await db.select()
      .from(talentPool)
      .where(and(
        eq(talentPool.recruiterId, recruiterId),
        eq(talentPool.email, email.toLowerCase()),
        isNull(talentPool.removedAt),
        talentPoolPrivacyAllowed(false),
      ));
    return result || undefined;
  }

  async createTalentPoolCandidate(data: InsertTalentPool & { recruiterId: number }): Promise<TalentPool> {
    const { requireNewCandidateIdentityAllowed } = await import('./candidate-privacy/decision');
    const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [
      { identifier_type: 'email', value: data.email.trim().toLowerCase() },
    ];
    if (data.phone?.trim()) identifiers.push({ identifier_type: 'phone', value: data.phone.trim() });
    await requireNewCandidateIdentityAllowed(identifiers);
    const [result] = await db.insert(talentPool).values({
      ...data,
      email: data.email.toLowerCase(),
    }).returning();
    return result;
  }

  async updateTalentPoolCandidate(id: number, data: Partial<InsertTalentPool>): Promise<TalentPool | undefined> {
    const { requireCandidatePrivacyAllowed, requireNewCandidateIdentityAllowed } = await import('./candidate-privacy/decision');
    await requireCandidatePrivacyAllowed(
      { type: 'talent_pool', id },
      { globalUse: false },
    );
    if (data.email || data.phone) {
      const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
      if (data.email?.trim()) identifiers.push({ identifier_type: 'email', value: data.email.trim().toLowerCase() });
      if (data.phone?.trim()) identifiers.push({ identifier_type: 'phone', value: data.phone.trim() });
      await requireNewCandidateIdentityAllowed(identifiers);
    }
    const updateData = { ...data, updatedAt: new Date() };
    if (data.email) {
      updateData.email = data.email.toLowerCase();
    }
    const [result] = await db
      .update(talentPool)
      .set(updateData)
      .where(and(
        eq(talentPool.id, id),
        isNull(talentPool.removedAt),
        talentPoolPrivacyAllowed(false),
      ))
      .returning();
    return result || undefined;
  }

  async removeTalentPoolCandidate(
    id: number,
    actorUserId: number,
    reason: 'organization_pool_removal' | 'converted_to_application' = 'organization_pool_removal',
  ): Promise<boolean> {
    return db.transaction(async (tx: any) => {
      const [removed] = await tx.update(talentPool)
        .set({
          removedAt: new Date(),
          removedByUserId: actorUserId,
          removalReason: reason,
          updatedAt: new Date(),
        })
        .where(and(
          eq(talentPool.id, id),
          isNull(talentPool.removedAt),
          talentPoolPrivacyAllowed(false),
        ))
        .returning({ id: talentPool.id, organizationId: talentPool.organizationId });
      if (!removed) return false;
      await tx.insert(talentPoolMembershipEvents).values({
        eventId: randomUUID(),
        talentPoolId: removed.id,
        organizationId: removed.organizationId,
        actorUserId,
        eventType: 'removed',
        reasonCode: reason,
      });
      return true;
    });
  }

  async restoreTalentPoolCandidate(id: number, actorUserId: number): Promise<TalentPool | undefined> {
    return db.transaction(async (tx: any) => {
      const [restored] = await tx.update(talentPool)
        .set({
          removedAt: null,
          removedByUserId: null,
          removalReason: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(talentPool.id, id),
          sql`${talentPool.removedAt} IS NOT NULL`,
          talentPoolPrivacyAllowed(false),
        ))
        .returning();
      if (!restored) {
        const [current] = await tx.select().from(talentPool).where(and(
          eq(talentPool.id, id),
          talentPoolPrivacyAllowed(false),
        ));
        return current || undefined;
      }
      await tx.insert(talentPoolMembershipEvents).values({
        eventId: randomUUID(),
        talentPoolId: restored.id,
        organizationId: restored.organizationId,
        actorUserId,
        eventType: 'restored',
        reasonCode: 'operator_restore',
      });
      return restored;
    });
  }

  // Check if an application exists for email + job combination
  async getApplicationByEmailAndJob(email: string, jobId: number): Promise<Application | undefined> {
    const [result] = await db.select()
      .from(applications)
      .where(and(
        sql`LOWER(${applications.email}) = LOWER(${email})`,
        eq(applications.jobId, jobId),
        applicationPrivacyAllowed(false),
      ));
    return result || undefined;
  }

  // Convert talent pool candidate to job application
  async convertTalentPoolToApplication(
    talentPoolId: number,
    jobId: number,
    recruiterId: number,
    removeFromPool = false,
  ): Promise<{ application: Application; talentPool: TalentPool } | undefined> {
    const candidate = await this.getTalentPoolCandidate(talentPoolId);
    if (!candidate || candidate.recruiterId !== recruiterId) {
      return undefined;
    }

    const job = await this.getJob(jobId);
    // Use isRecruiterOnJob to check access (includes co-recruiters)
    const hasAccess = await this.isRecruiterOnJob(jobId, recruiterId);
    if (!job || !hasAccess) {
      return undefined;
    }

    const { requireCandidatePrivacyAllowed } = await import('./candidate-privacy/decision');
    await requireCandidatePrivacyAllowed(
      { type: 'talent_pool', id: talentPoolId },
      { globalUse: true, newGlobalOperation: true },
    );

    // Get first pipeline stage for initial placement
    const stages = await this.getPipelineStages(job.organizationId ?? null);
    const firstStage = pickInitialPipelineStage(stages, job.organizationId ?? null);

    return db.transaction(async (tx: any) => {
      // Create application from talent pool data and, when requested, remove
      // only this organization membership in the same transaction.
      const [application] = await tx.insert(applications).values({
        jobId,
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone || null,
        resumeUrl: candidate.resumeUrl || null,
        currentStage: firstStage?.id || null,
        source: 'talent_pool',
        status: 'submitted',
        organizationId: job.organizationId ?? undefined,
      }).returning();
      if (removeFromPool) {
        const [removed] = await tx.update(talentPool)
          .set({
            removedAt: new Date(),
            removedByUserId: recruiterId,
            removalReason: 'converted_to_application',
            updatedAt: new Date(),
          })
          .where(and(eq(talentPool.id, talentPoolId), isNull(talentPool.removedAt)))
          .returning({ id: talentPool.id, organizationId: talentPool.organizationId });
        if (!removed) throw new Error('talent_pool_removal_conflict');
        await tx.insert(talentPoolMembershipEvents).values({
          eventId: randomUUID(),
          talentPoolId: removed.id,
          organizationId: removed.organizationId,
          actorUserId: recruiterId,
          eventType: 'removed',
          reasonCode: 'converted_to_application',
        });
      }
      return { application, talentPool: candidate };
    });
  }

  // ===== EXTERNAL FORM INVITATIONS =====

  // Check if there's an active external invite for this email + form
  async getActiveExternalInvite(email: string, formId: number): Promise<FormInvitation | undefined> {
    const [result] = await db.select()
      .from(formInvitations)
      .where(and(
        eq(formInvitations.email, email.toLowerCase()),
        eq(formInvitations.formId, formId),
        sql`${formInvitations.applicationId} IS NULL`, // External invite has no applicationId
        or(
          eq(formInvitations.status, 'pending'),
          eq(formInvitations.status, 'sent'),
          eq(formInvitations.status, 'viewed')
        ),
        sql`${formInvitations.expiresAt} > NOW()`
      ));
    return result || undefined;
  }

  // Create external form invitation (for email-only invites)
  async createExternalFormInvitation(data: {
    formId: number;
    email: string;
    candidateName: string;
    jobId?: number;
    token: string;
    expiresAt: Date;
    sentBy: number;
    fieldSnapshot: string;
    customMessage?: string;
    organizationId?: number;
  }): Promise<FormInvitation> {
    const [result] = await db.insert(formInvitations).values({
      formId: data.formId,
      applicationId: null, // External invite has no application
      email: data.email.toLowerCase(),
      candidateName: data.candidateName,
      jobId: data.jobId || null,
      token: data.token,
      expiresAt: data.expiresAt,
      sentBy: data.sentBy,
      fieldSnapshot: data.fieldSnapshot,
      customMessage: data.customMessage || null,
      status: 'pending',
      organizationId: data.organizationId,
    }).returning();
    return result;
  }

  // Get external invite by token
  async getExternalInviteByToken(token: string): Promise<FormInvitation | undefined> {
    const [result] = await db.select()
      .from(formInvitations)
      .where(eq(formInvitations.token, token));
    return result || undefined;
  }

  // Process external form completion - creates application or talent pool entry
  async processExternalFormCompletion(
    invitationId: number,
    formResponseId: number
  ): Promise<{ type: 'application' | 'talent_pool'; id: number } | undefined> {
    const invitationRows = await db.select()
      .from(formInvitations)
      .where(eq(formInvitations.id, invitationId));
    const invitation = invitationRows[0];

    if (!invitation || !invitation.email || !invitation.candidateName) {
      return undefined;
    }

    // Get the form to find the recruiter
    const formRows = await db.select()
      .from(forms)
      .where(eq(forms.id, invitation.formId));
    const form = formRows[0];

    if (!form) {
      return undefined;
    }

    const recruiterId = form.recruiterId;

    const { requireNewCandidateIdentityAllowed } = await import('./candidate-privacy/decision');
    await requireNewCandidateIdentityAllowed([
      { identifier_type: 'email', value: invitation.email.trim().toLowerCase() },
    ]);

    // If invitation has a jobId, create an application
    if (invitation.jobId) {
      const job = await this.getJob(invitation.jobId);
      if (job) {
        // Get first pipeline stage
        const stages = await this.getPipelineStages(job.organizationId ?? null);
        const firstStage = pickInitialPipelineStage(stages, job.organizationId ?? null);

        const [application] = await db.insert(applications).values({
          jobId: invitation.jobId,
          name: invitation.candidateName,
          email: invitation.email,
          currentStage: firstStage?.id || null,
          source: 'external_form',
          status: 'submitted',
          organizationId: job.organizationId ?? undefined,
        }).returning();

        return { type: 'application', id: application.id };
      }
    }

    // No job association - create talent pool entry
    const [talentPoolEntry] = await db.insert(talentPool).values({
      email: invitation.email.toLowerCase(),
      name: invitation.candidateName,
      recruiterId,
      source: 'external_form',
      formResponseId,
      ...(invitation.organizationId != null && { organizationId: invitation.organizationId }),
    }).returning();

    return { type: 'talent_pool', id: talentPoolEntry.id };
  }

  // Hiring Manager Invitation methods
  async createHiringManagerInvitation(data: {
    email: string;
    name?: string;
    tokenHash: string;
    invitedBy: number;
    inviterName: string;
    expiresAt: Date;
  }): Promise<HiringManagerInvitation> {
    const [invitation] = await db.insert(hiringManagerInvitations).values({
      email: data.email.toLowerCase(),
      name: data.name || null,
      token: data.tokenHash,
      invitedBy: data.invitedBy,
      inviterName: data.inviterName,
      expiresAt: data.expiresAt,
      status: 'pending',
    }).returning();
    return invitation;
  }

  async getHiringManagerInvitationByToken(tokenHash: string): Promise<HiringManagerInvitation | undefined> {
    const [invitation] = await db.select()
      .from(hiringManagerInvitations)
      .where(eq(hiringManagerInvitations.token, tokenHash));
    return invitation || undefined;
  }

  async getHiringManagerInvitationByEmail(email: string, status?: string): Promise<HiringManagerInvitation | undefined> {
    const conditions = [eq(hiringManagerInvitations.email, email.toLowerCase())];
    if (status) {
      conditions.push(eq(hiringManagerInvitations.status, status));
    }
    const [invitation] = await db.select()
      .from(hiringManagerInvitations)
      .where(and(...conditions))
      .orderBy(desc(hiringManagerInvitations.createdAt));
    return invitation || undefined;
  }

  async getPendingHiringManagerInvitations(invitedBy?: number): Promise<HiringManagerInvitation[]> {
    const conditions = [eq(hiringManagerInvitations.status, 'pending')];
    if (invitedBy !== undefined) {
      conditions.push(eq(hiringManagerInvitations.invitedBy, invitedBy));
    }
    return await db.select()
      .from(hiringManagerInvitations)
      .where(and(...conditions))
      .orderBy(desc(hiringManagerInvitations.createdAt));
  }

  async markHiringManagerInvitationAccepted(id: number): Promise<HiringManagerInvitation | undefined> {
    const [updated] = await db.update(hiringManagerInvitations)
      .set({
        status: 'accepted',
        acceptedAt: new Date(),
      })
      .where(eq(hiringManagerInvitations.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteHiringManagerInvitation(id: number): Promise<boolean> {
    const result = await db.delete(hiringManagerInvitations)
      .where(eq(hiringManagerInvitations.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async invalidateHiringManagerInvitation(id: number): Promise<boolean> {
    const result = await db.update(hiringManagerInvitations)
      .set({ status: 'expired' })
      .where(eq(hiringManagerInvitations.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ===== Job Recruiters (Co-Recruiters) =====
  async addJobRecruiter(jobId: number, recruiterId: number, addedBy: number, organizationId?: number): Promise<JobRecruiter> {
    const [recruiter] = await db.insert(jobRecruiters).values({
      jobId,
      recruiterId,
      addedBy,
      organizationId,
    }).onConflictDoNothing().returning();

    // If conflict (already exists), fetch and return existing
    if (!recruiter) {
      const [existing] = await db.select()
        .from(jobRecruiters)
        .where(and(
          eq(jobRecruiters.jobId, jobId),
          eq(jobRecruiters.recruiterId, recruiterId)
        ));
      return existing;
    }
    return recruiter;
  }

  async removeJobRecruiter(jobId: number, recruiterId: number): Promise<boolean> {
    // Guard: cannot remove primary recruiter (check job.postedBy)
    const job = await this.getJob(jobId);
    if (job && job.postedBy === recruiterId) {
      return false; // Cannot remove primary recruiter
    }

    const result = await db.delete(jobRecruiters)
      .where(and(
        eq(jobRecruiters.jobId, jobId),
        eq(jobRecruiters.recruiterId, recruiterId)
      ));
    return (result.rowCount ?? 0) > 0;
  }

  async getJobRecruiters(jobId: number): Promise<User[]> {
    const results = await db.select({
      id: users.id,
      username: users.username,
      password: users.password,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      emailVerified: users.emailVerified,
      emailVerificationToken: users.emailVerificationToken,
      emailVerificationExpires: users.emailVerificationExpires,
      passwordResetToken: users.passwordResetToken,
      passwordResetExpires: users.passwordResetExpires,
      aiContentFreeUsed: users.aiContentFreeUsed,
      aiOnboardedAt: users.aiOnboardedAt,
    })
      .from(jobRecruiters)
      .innerJoin(users, eq(jobRecruiters.recruiterId, users.id))
      .where(eq(jobRecruiters.jobId, jobId));
    return results;
  }

  async isRecruiterOnJob(jobId: number, userId: number, organizationId?: number | null): Promise<boolean> {
    // Check both job_recruiters table AND jobs.postedBy for backward compatibility
    // Also allow super_admin
    const user = await this.getUser(userId);
    if (user?.role === 'super_admin') return true;

    // Get the job first
    const job = await this.getJob(jobId);
    if (!job) return false;

    // If organizationId provided, verify the job belongs to that org
    // This enforces data isolation - users can't access jobs from orgs they've left
    if (organizationId !== undefined) {
      if (organizationId === null) {
        if (job.organizationId !== null) return false;
      } else if (job.organizationId != null && job.organizationId !== organizationId) {
        return false;
      }
    }

    // Check primary recruiter (jobs.postedBy)
    if (job.postedBy === userId) return true;

    // Check job_recruiters table
    const [result] = await db.select({ count: count() })
      .from(jobRecruiters)
      .where(and(
        eq(jobRecruiters.jobId, jobId),
        eq(jobRecruiters.recruiterId, userId)
      ));
    return (result?.count ?? 0) > 0;
  }

  // ===== Co-Recruiter Invitations =====
  async createCoRecruiterInvitation(data: {
    jobId: number;
    email: string;
    tokenHash: string;
    invitedBy: number;
    inviterName: string;
    jobTitle: string;
    expiresAt: Date;
    organizationId?: number;
  }): Promise<CoRecruiterInvitation> {
    const [invitation] = await db.insert(coRecruiterInvitations).values({
      jobId: data.jobId,
      email: data.email.toLowerCase(),
      token: data.tokenHash,
      invitedBy: data.invitedBy,
      inviterName: data.inviterName,
      jobTitle: data.jobTitle,
      expiresAt: data.expiresAt,
      status: 'pending',
      organizationId: data.organizationId,
    }).returning();
    return invitation;
  }

  async getCoRecruiterInvitationByToken(tokenHash: string): Promise<CoRecruiterInvitation | undefined> {
    const [invitation] = await db.select()
      .from(coRecruiterInvitations)
      .where(eq(coRecruiterInvitations.token, tokenHash));
    return invitation || undefined;
  }

  async getCoRecruiterInvitationByEmail(email: string, jobId: number): Promise<CoRecruiterInvitation | undefined> {
    const [invitation] = await db.select()
      .from(coRecruiterInvitations)
      .where(and(
        eq(coRecruiterInvitations.email, email.toLowerCase()),
        eq(coRecruiterInvitations.jobId, jobId),
        eq(coRecruiterInvitations.status, 'pending')
      ))
      .orderBy(desc(coRecruiterInvitations.createdAt));
    return invitation || undefined;
  }

  async getCoRecruiterInvitation(id: number): Promise<CoRecruiterInvitation | undefined> {
    const [invitation] = await db.select()
      .from(coRecruiterInvitations)
      .where(eq(coRecruiterInvitations.id, id));
    return invitation || undefined;
  }

  async getPendingCoRecruiterInvitations(jobId: number): Promise<CoRecruiterInvitation[]> {
    return await db.select()
      .from(coRecruiterInvitations)
      .where(and(
        eq(coRecruiterInvitations.jobId, jobId),
        eq(coRecruiterInvitations.status, 'pending')
      ))
      .orderBy(desc(coRecruiterInvitations.createdAt));
  }

  async updateCoRecruiterInvitationStatus(id: number, status: string): Promise<CoRecruiterInvitation | undefined> {
    const updates: { status: string; acceptedAt?: Date } = { status };
    if (status === 'accepted') {
      updates.acceptedAt = new Date();
    }
    const [updated] = await db.update(coRecruiterInvitations)
      .set(updates)
      .where(eq(coRecruiterInvitations.id, id))
      .returning();
    return updated || undefined;
  }

  async markCoRecruiterInvitationAccepted(id: number): Promise<CoRecruiterInvitation | undefined> {
    const [updated] = await db.update(coRecruiterInvitations)
      .set({
        status: 'accepted',
        acceptedAt: new Date(),
      })
      .where(eq(coRecruiterInvitations.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteCoRecruiterInvitation(id: number): Promise<boolean> {
    const result = await db.delete(coRecruiterInvitations)
      .where(eq(coRecruiterInvitations.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // AI Fit Jobs (Async Queue Processing)
  // ============================================

  async createAiFitJob(data: {
    bullJobId: string;
    queueName: 'ai-interactive' | 'ai-batch';
    userId: number;
    applicationId?: number | null;
    applicationIds?: number[] | null;
    totalCount: number;
    result?: any;
  }): Promise<AiFitJob> {
    const [job] = await db.insert(aiFitJobs).values({
      bullJobId: data.bullJobId,
      queueName: data.queueName,
      userId: data.userId,
      applicationId: data.applicationId || null,
      applicationIds: data.applicationIds || null,
      totalCount: data.totalCount,
      status: 'pending',
      progress: 0,
      processedCount: 0,
      result: data.result || null,
    }).returning();
    return job;
  }

  async getAiFitJob(id: number): Promise<AiFitJob | undefined> {
    const [job] = await db.select()
      .from(aiFitJobs)
      .where(eq(aiFitJobs.id, id));
    return job || undefined;
  }

  async getAiFitJobForUser(id: number, userId: number): Promise<AiFitJob | undefined> {
    const [job] = await db.select()
      .from(aiFitJobs)
      .where(and(
        eq(aiFitJobs.id, id),
        eq(aiFitJobs.userId, userId)
      ));
    return job || undefined;
  }

  async getAiFitJobByBullId(bullJobId: string): Promise<AiFitJob | undefined> {
    const [job] = await db.select()
      .from(aiFitJobs)
      .where(eq(aiFitJobs.bullJobId, bullJobId));
    return job || undefined;
  }

  async getAllAiFitJobs(statuses: Array<'pending' | 'active' | 'completed' | 'failed' | 'cancelled'>): Promise<AiFitJob[]> {
    return db.select()
      .from(aiFitJobs)
      .where(inArray(aiFitJobs.status, statuses))
      .orderBy(desc(aiFitJobs.createdAt))
      .limit(100);
  }

  async updateAiFitJobStatus(
    id: number,
    status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled',
    updates?: {
      error?: string | null;
      errorCode?: string | null;
      result?: any;
      startedAt?: Date;
      completedAt?: Date;
    }
  ): Promise<AiFitJob | undefined> {
    const setData: any = { status };
    if (updates?.error !== undefined) setData.error = updates.error;
    if (updates?.errorCode !== undefined) setData.errorCode = updates.errorCode;
    if (updates?.result !== undefined) setData.result = updates.result;
    if (updates?.startedAt !== undefined) setData.startedAt = updates.startedAt;
    if (updates?.completedAt !== undefined) setData.completedAt = updates.completedAt;

    const [updated] = await db.update(aiFitJobs)
      .set(setData)
      .where(eq(aiFitJobs.id, id))
      .returning();
    return updated || undefined;
  }

  async updateAiFitJobProgress(
    id: number,
    updates: {
      processedCount?: number;
      progress?: number;
      result?: any;
    }
  ): Promise<AiFitJob | undefined> {
    const [updated] = await db.update(aiFitJobs)
      .set({
        processedCount: updates.processedCount,
        progress: updates.progress,
        result: updates.result,
      })
      .where(eq(aiFitJobs.id, id))
      .returning();
    return updated || undefined;
  }

  async updateAiFitJobBullId(id: number, bullJobId: string): Promise<AiFitJob | undefined> {
    const [updated] = await db.update(aiFitJobs)
      .set({ bullJobId })
      .where(eq(aiFitJobs.id, id))
      .returning();
    return updated || undefined;
  }

  async getUserAiFitJobs(userId: number, status?: string | string[]): Promise<AiFitJob[]> {
    if (status) {
      const statusList = Array.isArray(status) ? status : [status];
      return await db.select()
        .from(aiFitJobs)
        .where(and(
          eq(aiFitJobs.userId, userId),
          inArray(aiFitJobs.status, statusList)
        ))
        .orderBy(desc(aiFitJobs.createdAt));
    }
    return await db.select()
      .from(aiFitJobs)
      .where(eq(aiFitJobs.userId, userId))
      .orderBy(desc(aiFitJobs.createdAt));
  }

  async getUserPendingJobCount(userId: number, queueName?: string): Promise<number> {
    const conditions = [
      eq(aiFitJobs.userId, userId),
      inArray(aiFitJobs.status, ['pending', 'active']),
    ];
    if (queueName) {
      conditions.push(eq(aiFitJobs.queueName, queueName));
    }

    const result = await db.select({ count: count() })
      .from(aiFitJobs)
      .where(and(...conditions));

    return result[0]?.count || 0;
  }

  /**
   * Find existing pending/active job for the same work (deduplication)
   * For single jobs: match by applicationId
   * For batch jobs: match by applicationIds array (exact match)
   */
  async findPendingAiFitJob(
    userId: number,
    applicationId?: number,
    applicationIds?: number[]
  ): Promise<AiFitJob | undefined> {
    const baseConditions = [
      eq(aiFitJobs.userId, userId),
      inArray(aiFitJobs.status, ['pending', 'active']),
    ];

    if (applicationId && !applicationIds) {
      // Single job: match by applicationId
      const [job] = await db.select()
        .from(aiFitJobs)
        .where(and(
          ...baseConditions,
          eq(aiFitJobs.applicationId, applicationId)
        ))
        .orderBy(desc(aiFitJobs.createdAt))
        .limit(1);
      return job || undefined;
    }

    if (applicationIds && applicationIds.length > 0) {
      // Batch job: find jobs with overlapping applicationIds
      // For simplicity, we look for exact match or subset
      const pendingJobs = await db.select()
        .from(aiFitJobs)
        .where(and(
          ...baseConditions,
          eq(aiFitJobs.queueName, 'ai-batch')
        ))
        .orderBy(desc(aiFitJobs.createdAt));

      // Check for exact match (all requested IDs are already being processed)
      for (const job of pendingJobs) {
        const jobIds = job.applicationIds || [];
        const allIncluded = applicationIds.every(id => jobIds.includes(id));
        if (allIncluded) {
          return job;
        }
      }
    }

    return undefined;
  }

  async cleanupOldAiFitJobs(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db.delete(aiFitJobs)
      .where(and(
        inArray(aiFitJobs.status, ['completed', 'failed', 'cancelled']),
        sql`${aiFitJobs.createdAt} < ${cutoffDate}`
      ));

    return result.rowCount ?? 0;
  }

  async cancelAiFitJob(id: number, userId: number): Promise<AiFitJob | undefined> {
    // Only allow cancelling jobs owned by user that are pending/active
    const [updated] = await db.update(aiFitJobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(and(
        eq(aiFitJobs.id, id),
        eq(aiFitJobs.userId, userId),
        inArray(aiFitJobs.status, ['pending', 'active'])
      ))
      .returning();
    return updated || undefined;
  }

  // ============= ActiveKG Graph Sync Methods =============

  async enqueueApplicationGraphSyncJob(input: {
    applicationId: number;
    organizationId: number | null;
    jobId: number;
    effectiveRecruiterId: number;
    activekgTenantId: string;
  }): Promise<ApplicationGraphSyncJob> {
    const { requireCandidatePrivacyAllowed } = await import('./candidate-privacy/decision');
    await requireCandidatePrivacyAllowed(
      { type: 'application', id: input.applicationId },
      { globalUse: true, newGlobalOperation: true },
    );
    // Upsert: if already succeeded, keep unchanged; otherwise reset to pending
    const [job] = await db
      .insert(applicationGraphSyncJobs)
      .values({
        applicationId: input.applicationId,
        organizationId: input.organizationId,
        jobId: input.jobId,
        effectiveRecruiterId: input.effectiveRecruiterId,
        activekgTenantId: input.activekgTenantId,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .onConflictDoUpdate({
        target: applicationGraphSyncJobs.applicationId,
        set: {
          status: sql`CASE WHEN ${applicationGraphSyncJobs.status} = 'succeeded' THEN ${applicationGraphSyncJobs.status} ELSE 'pending' END`,
          attempts: sql`CASE WHEN ${applicationGraphSyncJobs.status} = 'succeeded' THEN ${applicationGraphSyncJobs.attempts} ELSE 0 END`,
          lastError: sql`CASE WHEN ${applicationGraphSyncJobs.status} = 'succeeded' THEN ${applicationGraphSyncJobs.lastError} ELSE NULL END`,
          nextAttemptAt: sql`CASE WHEN ${applicationGraphSyncJobs.status} = 'succeeded' THEN ${applicationGraphSyncJobs.nextAttemptAt} ELSE NOW() END`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return job;
  }

  async claimPendingApplicationGraphSyncJobs(limit: number, now: Date): Promise<ApplicationGraphSyncJob[]> {
    // Reclaim stale processing jobs that exceeded their lease
    const leaseMs = parseInt(process.env.ACTIVEKG_SYNC_PROCESSING_LEASE_MS || '300000', 10);
    const staleBefore = new Date(now.getTime() - leaseMs);

    // Use raw SQL for FOR UPDATE SKIP LOCKED (not supported by Drizzle ORM natively)
    const result = await db.execute(sql`
      UPDATE application_graph_sync_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id IN (
        SELECT id FROM application_graph_sync_jobs
        WHERE (status IN ('pending', 'failed') AND next_attempt_at <= ${now})
           OR (status = 'processing' AND updated_at <= ${staleBefore})
        ORDER BY next_attempt_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    const rows = (result.rows ?? []) as any[];
    return rows.map(mapApplicationGraphSyncJobRow);
  }

  async markApplicationGraphSyncJobSucceeded(
    id: number,
    parentNodeId: string,
    chunkCount: number
  ): Promise<void> {
    await db
      .update(applicationGraphSyncJobs)
      .set({
        status: 'succeeded',
        activekgParentNodeId: parentNodeId,
        chunkCount,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(applicationGraphSyncJobs.id, id));
  }

  async markApplicationGraphSyncJobRetry(
    id: number,
    error: string,
    nextAttemptAt: Date
  ): Promise<void> {
    await db
      .update(applicationGraphSyncJobs)
      .set({
        status: 'failed',
        lastError: error,
        nextAttemptAt,
        updatedAt: new Date(),
      })
      .where(eq(applicationGraphSyncJobs.id, id));
  }

  async markApplicationGraphSyncJobDeadLetter(
    id: number,
    error: string
  ): Promise<void> {
    await db
      .update(applicationGraphSyncJobs)
      .set({
        status: 'dead_letter',
        lastError: error,
        updatedAt: new Date(),
      })
      .where(eq(applicationGraphSyncJobs.id, id));
  }

  async markApplicationGraphSyncJobPrivacyRestricted(id: number): Promise<void> {
    await db.update(applicationGraphSyncJobs)
      .set({
        status: 'privacy_restricted',
        lastError: 'candidate_privacy_restricted',
        updatedAt: new Date(),
      })
      .where(eq(applicationGraphSyncJobs.id, id));
  }

  // ── Sync skip tracking ──────────────────────────────────────────

  async updateApplicationSyncSkippedReason(id: number, reason: string): Promise<void> {
    await db
      .update(applications)
      .set({
        syncSkippedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id));
  }

  // ============= Bulk Resume Import Methods =============

  async createResumeImportBatch(batch: InsertResumeImportBatch): Promise<ResumeImportBatch> {
    const [created] = await db
      .insert(resumeImportBatches)
      .values({
        ...batch,
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async createResumeImportItems(items: InsertResumeImportItem[]): Promise<ResumeImportItem[]> {
    if (items.length === 0) {
      return [];
    }

    const created = await db
      .insert(resumeImportItems)
      .values(items.map((item) => ({
        ...item,
        updatedAt: new Date(),
      })))
      .returning() as ResumeImportItem[];

    const batchIds = Array.from(new Set(created.map((item: ResumeImportItem) => item.batchId)));
    await Promise.all(batchIds.map((batchId) => this.refreshResumeImportBatchStats(batchId)));
    return created;
  }

  async getResumeImportBatch(id: number): Promise<ResumeImportBatch | undefined> {
    const [batch] = await db
      .select()
      .from(resumeImportBatches)
      .where(eq(resumeImportBatches.id, id));
    return batch || undefined;
  }

  async getResumeImportItem(id: number): Promise<ResumeImportItem | undefined> {
    const [item] = await db
      .select()
      .from(resumeImportItems)
      .where(eq(resumeImportItems.id, id));
    return item || undefined;
  }

  async getResumeImportItemsByBatch(batchId: number): Promise<ResumeImportItem[]> {
    return db
      .select()
      .from(resumeImportItems)
      .where(eq(resumeImportItems.batchId, batchId))
      .orderBy(resumeImportItems.id);
  }

  async claimPendingResumeImportItems(limit: number, now: Date): Promise<ResumeImportItem[]> {
    const leaseMs = parseInt(process.env.BULK_RESUME_IMPORT_PROCESSING_LEASE_MS || '300000', 10);
    const staleBefore = new Date(now.getTime() - leaseMs);

    const result = await db.execute(sql`
      UPDATE resume_import_items
      SET status = 'processing',
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id IN (
        SELECT id FROM resume_import_items
        WHERE (status IN ('queued', 'failed') AND next_attempt_at <= ${now})
           OR (status = 'processing' AND updated_at <= ${staleBefore})
        ORDER BY next_attempt_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    const rows = (result.rows ?? []) as any[];
    const mapped = rows.map(mapResumeImportItemRow);
    const batchIds = Array.from(new Set(mapped.map((item) => item.batchId)));
    await Promise.all(batchIds.map((batchId) => this.refreshResumeImportBatchStats(batchId)));
    return mapped;
  }

  async markResumeImportItemProcessed(id: number, updates: {
    extractedText: string | null;
    extractionMethod: string;
    parsedName: string | null;
    parsedEmail: string | null;
    parsedPhone: string | null;
    status: string;
    errorReason?: string | null;
  }): Promise<void> {
    const [row] = await db
      .update(resumeImportItems)
      .set({
        extractedText: updates.extractedText,
        extractionMethod: updates.extractionMethod,
        parsedName: updates.parsedName,
        parsedEmail: updates.parsedEmail,
        parsedPhone: updates.parsedPhone,
        status: updates.status,
        errorReason: updates.errorReason ?? null,
        lastProcessedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(resumeImportItems.id, id))
      .returning({ batchId: resumeImportItems.batchId });

    if (row?.batchId) {
      await this.refreshResumeImportBatchStats(row.batchId);
    }
  }

  async markResumeImportItemRetry(id: number, errorReason: string, nextAttemptAt: Date): Promise<void> {
    const [row] = await db
      .update(resumeImportItems)
      .set({
        status: 'queued',
        errorReason,
        nextAttemptAt,
        updatedAt: new Date(),
      })
      .where(eq(resumeImportItems.id, id))
      .returning({ batchId: resumeImportItems.batchId });

    if (row?.batchId) {
      await this.refreshResumeImportBatchStats(row.batchId);
    }
  }

  async markResumeImportItemFailed(id: number, errorReason: string, extractionMethod = 'failed'): Promise<void> {
    const [row] = await db
      .update(resumeImportItems)
      .set({
        status: 'failed',
        extractionMethod,
        errorReason,
        lastProcessedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(resumeImportItems.id, id))
      .returning({ batchId: resumeImportItems.batchId });

    if (row?.batchId) {
      await this.refreshResumeImportBatchStats(row.batchId);
    }
  }

  async markResumeImportItemDuplicate(id: number, input: {
    errorReason: string;
    parsedEmail?: string | null;
    applicationId?: number | null;
  }): Promise<void> {
    const [row] = await db
      .update(resumeImportItems)
      .set({
        status: 'duplicate',
        errorReason: input.errorReason,
        parsedEmail: input.parsedEmail ?? undefined,
        applicationId: input.applicationId ?? null,
        lastProcessedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(resumeImportItems.id, id))
      .returning({ batchId: resumeImportItems.batchId });

    if (row?.batchId) {
      await this.refreshResumeImportBatchStats(row.batchId);
    }
  }

  async updateResumeImportItem(id: number, updates: Partial<{
    extractedText: string | null;
    extractionMethod: string;
    parsedName: string | null;
    parsedEmail: string | null;
    parsedPhone: string | null;
    status: string;
    errorReason: string | null;
    applicationId: number | null;
  }>): Promise<ResumeImportItem | undefined> {
    const [row] = await db
      .update(resumeImportItems)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(resumeImportItems.id, id))
      .returning();

    if (!row) {
      return undefined;
    }

    await this.refreshResumeImportBatchStats(row.batchId);
    return row;
  }

  async markResumeImportItemFinalized(id: number, applicationId: number): Promise<void> {
    const [row] = await db
      .update(resumeImportItems)
      .set({
        status: 'finalized',
        applicationId,
        errorReason: null,
        updatedAt: new Date(),
      })
      .where(eq(resumeImportItems.id, id))
      .returning({ batchId: resumeImportItems.batchId });

    if (row?.batchId) {
      await this.refreshResumeImportBatchStats(row.batchId);
    }
  }

  async refreshResumeImportBatchStats(batchId: number): Promise<ResumeImportBatch | undefined> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS file_count,
        COUNT(*) FILTER (WHERE status IN ('processed', 'needs_review', 'failed', 'duplicate', 'finalized'))::int AS processed_count,
        COUNT(*) FILTER (
          WHERE status = 'finalized'
             OR (
               status = 'processed'
               AND gcs_path IS NOT NULL
               AND parsed_name IS NOT NULL
               AND parsed_email IS NOT NULL
               AND parsed_phone IS NOT NULL
               AND length(trim(coalesce(extracted_text, ''))) >= 50
               AND length(regexp_replace(coalesce(extracted_text, ''), '[^A-Za-z]', '', 'g')) >= 20
             )
        )::int AS ready_count,
        COUNT(*) FILTER (WHERE status = 'needs_review')::int AS needs_review_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_count,
        COUNT(*) FILTER (WHERE status = 'duplicate')::int AS duplicate_count,
        COUNT(*) FILTER (WHERE status = 'finalized')::int AS finalized_count
      FROM resume_import_items
      WHERE batch_id = ${batchId}
    `);

    const row = (result.rows?.[0] ?? null) as any;
    if (!row) {
      return this.getResumeImportBatch(batchId);
    }

    const nextStatus = computeResumeImportBatchStatus({
      fileCount: Number(row.file_count ?? 0),
      queuedCount: Number(row.queued_count ?? 0),
      processingCount: Number(row.processing_count ?? 0),
      processedCount: Number(row.processed_count ?? 0),
      needsReviewCount: Number(row.needs_review_count ?? 0),
      failedCount: Number(row.failed_count ?? 0),
      duplicateCount: Number(row.duplicate_count ?? 0),
      finalizedCount: Number(row.finalized_count ?? 0),
    });

    const [updated] = await db
      .update(resumeImportBatches)
      .set({
        status: nextStatus,
        fileCount: Number(row.file_count ?? 0),
        processedCount: Number(row.processed_count ?? 0),
        readyCount: Number(row.ready_count ?? 0),
        needsReviewCount: Number(row.needs_review_count ?? 0),
        failedCount: Number(row.failed_count ?? 0),
        updatedAt: new Date(),
      })
      .where(eq(resumeImportBatches.id, batchId))
      .returning();

    return updated || undefined;
  }

  async findDuplicateResumeImportItemByEmail(batchId: number, email: string, excludeItemId: number): Promise<ResumeImportItem | undefined> {
    const result = await db.execute(sql`
      SELECT *
      FROM resume_import_items
      WHERE batch_id = ${batchId}
        AND id <> ${excludeItemId}
        AND lower(parsed_email) = lower(${email})
        AND status IN ('processed', 'needs_review', 'finalized', 'duplicate')
      ORDER BY id ASC
      LIMIT 1
    `);

    const row = (result.rows?.[0] ?? null) as any;
    return row ? mapResumeImportItemRow(row) : undefined;
  }

  // ── Semantic search / move helpers ───────────────────────────────

  async getApplicationsByIdsForOrg(applicationIds: number[], organizationId: number): Promise<Application[]> {
    if (applicationIds.length === 0) return [];
    return db
      .select()
      .from(applications)
      .where(and(
        inArray(applications.id, applicationIds),
        eq(applications.organizationId, organizationId),
        applicationPrivacyAllowed(false),
      ));
  }

  async findApplicationByJobAndEmail(jobId: number, email: string): Promise<Application | undefined> {
    const [row] = await db
      .select()
      .from(applications)
      .where(and(
        eq(applications.jobId, jobId),
        sql`LOWER(${applications.email}) = LOWER(${email})`,
        applicationPrivacyAllowed(false),
      ))
      .limit(1);
    return row || undefined;
  }

  async getJobsByIds(ids: number[]): Promise<Job[]> {
    if (ids.length === 0) return [];
    return db.select().from(jobs).where(inArray(jobs.id, ids));
  }
}

// Export the DatabaseStorage instance
export const storage = new DatabaseStorage();
