import { 
  users, 
  contactSubmissions, 
  jobs, 
  applications,
  userProfiles,
  jobAnalytics,
  pipelineStages,
  applicationStageHistory,
  emailTemplates,
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
  type PipelineStage,
  type InsertPipelineStage,
  type EmailTemplate,
  type InsertEmailTemplate
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, ilike, sql, or, inArray, count } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Contact form operations
  createContactSubmission(submission: InsertContact): Promise<ContactSubmission>;
  getAllContactSubmissions(): Promise<ContactSubmission[]>;
  
  // Job operations
  createJob(job: InsertJob & { postedBy: number }): Promise<Job>;
  getJob(id: number): Promise<Job | undefined>;
  getJobs(filters: {
    page?: number;
    limit?: number;
    location?: string;
    type?: string;
    skills?: string[];
    search?: string;
    status?: string;
  }): Promise<{ jobs: Job[]; total: number }>;
  updateJobStatus(id: number, isActive: boolean): Promise<Job | undefined>;
  getJobsByUser(userId: number): Promise<Job[]>;
  reviewJob(id: number, status: string, reviewComments?: string, reviewedBy?: number): Promise<Job | undefined>;
  getJobsByStatus(status: string, page?: number, limit?: number): Promise<{ jobs: Job[]; total: number }>;
  
  // Application operations
  createApplication(application: InsertApplication & { jobId: number; resumeUrl: string }): Promise<Application>;
  getApplicationsByJob(jobId: number): Promise<Application[]>;
  getApplicationsByUser(email: string): Promise<Application[]>;
  getApplication(id: number): Promise<Application | undefined>;
  updateApplicationStatus(id: number, status: string, notes?: string): Promise<Application | undefined>;
  updateApplicationsStatus(ids: number[], status: string, notes?: string): Promise<number>;
  markApplicationViewed(id: number): Promise<Application | undefined>;
  markApplicationDownloaded(id: number): Promise<Application | undefined>;
  
  // User profile operations
  getUserProfile(userId: number): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile & { userId: number }): Promise<UserProfile>;
  updateUserProfile(userId: number, profile: Partial<InsertUserProfile>): Promise<UserProfile | undefined>;
  getApplicationsByEmail(email: string): Promise<(Application & { job: Job })[]>;
  withdrawApplication(applicationId: number, userId: number): Promise<boolean>;
  getRecruiterApplications(recruiterId: number): Promise<(Application & { job: Job })[]>;
  
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
  
  // Job analytics operations
  getJobAnalytics(jobId: number): Promise<JobAnalytics | undefined>;
  createJobAnalytics(analytics: InsertJobAnalytics): Promise<JobAnalytics>;
  incrementJobViews(jobId: number): Promise<JobAnalytics | undefined>;
  incrementApplyClicks(jobId: number): Promise<JobAnalytics | undefined>;
  updateConversionRate(jobId: number): Promise<JobAnalytics | undefined>;
  updateJobAnalytics(jobId: number, updates: { aiScoreCache?: number; aiModelVersion?: string }): Promise<JobAnalytics | undefined>;
  getJobsWithAnalytics(userId?: number): Promise<any[]>;
  
  // ATS: pipeline & interview
  getPipelineStages(): Promise<PipelineStage[]>;
  createPipelineStage(stage: InsertPipelineStage & { createdBy?: number }): Promise<PipelineStage>;
  updateApplicationStage(appId: number, newStageId: number, changedBy: number, notes?: string): Promise<void>;
  getApplicationStageHistory(appId: number): Promise<any[]>;
  scheduleInterview(appId: number, fields: { date?: Date; time?: string; location?: string; notes?: string }): Promise<Application | undefined>;
  addRecruiterNote(appId: number, note: string): Promise<Application | undefined>;
  setApplicationRating(appId: number, rating: number): Promise<Application | undefined>;
  
  // ATS: email templates
  getEmailTemplates(): Promise<EmailTemplate[]>;
  createEmailTemplate(template: InsertEmailTemplate & { createdBy?: number }): Promise<EmailTemplate>;
}

// Database storage implementation using Drizzle ORM
export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
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
  
  // Job methods
  async createJob(job: InsertJob & { postedBy: number }): Promise<Job> {
    const jobData = {
      ...job,
      deadline: job.deadline ? job.deadline.toISOString().split('T')[0] : null
    };
    const [result] = await db
      .insert(jobs)
      .values(jobData)
      .returning();
    return result;
  }
  
  async getJob(id: number): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job || undefined;
  }
  
  async getJobs(filters: {
    page?: number;
    limit?: number;
    location?: string;
    type?: string;
    skills?: string[];
    search?: string;
  }): Promise<{ jobs: Job[]; total: number }> {
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
    
    if (filters.skills && filters.skills.length > 0) {
      // Use array overlap operator for skills filtering
      whereConditions.push(sql`${jobs.skills} && ${filters.skills}`);
    }
    
    const whereClause = whereConditions.length > 1 ? and(...whereConditions) : whereConditions[0];
    
    const [jobResults, totalResults] = await Promise.all([
      db.select().from(jobs)
        .where(whereClause)
        .orderBy(desc(jobs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(whereClause)
    ]);
    
    return {
      jobs: jobResults,
      total: totalResults[0].count
    };
  }
  
  async updateJobStatus(id: number, isActive: boolean): Promise<Job | undefined> {
    const [job] = await db
      .update(jobs)
      .set({ isActive })
      .where(eq(jobs.id, id))
      .returning();
    return job || undefined;
  }
  
  async getJobsByUser(userId: number): Promise<Job[]> {
    return db.select().from(jobs)
      .where(eq(jobs.postedBy, userId))
      .orderBy(desc(jobs.createdAt));
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
      .where(eq(applications.id, id))
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
      .where(inArray(applications.id, ids));
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
      .where(eq(applications.id, id))
      .returning();
    return application || undefined;
  }

  async markApplicationDownloaded(id: number): Promise<Application | undefined> {
    const [application] = await db
      .update(applications)
      .set({ 
        downloadedAt: new Date(),
        status: 'downloaded',
        updatedAt: new Date()
      })
      .where(eq(applications.id, id))
      .returning();
    return application || undefined;
  }

  async reviewJob(id: number, status: string, reviewComments?: string, reviewedBy?: number): Promise<Job | undefined> {
    const [job] = await db
      .update(jobs)
      .set({ 
        status,
        reviewComments,
        reviewedBy,
        reviewedAt: new Date()
      })
      .where(eq(jobs.id, id))
      .returning();
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

  // Application methods
  async createApplication(application: InsertApplication & { jobId: number; resumeUrl: string }): Promise<Application> {
    const [result] = await db
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
    return await db.select().from(applications).where(eq(applications.jobId, jobId)).orderBy(desc(applications.appliedAt));
  }

  async getApplicationsByUser(email: string): Promise<Application[]> {
    return await db.select().from(applications).where(eq(applications.email, email)).orderBy(desc(applications.appliedAt));
  }

  async getApplication(id: number): Promise<Application | undefined> {
    const [application] = await db.select().from(applications).where(eq(applications.id, id));
    return application || undefined;
  }

  // Phase 4: User profile management methods
  async getUserProfile(userId: number): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return profile || undefined;
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
      .where(eq(applications.email, email))
      .orderBy(desc(applications.appliedAt));

    return results.map((result: any) => ({
      ...result,
      job: result.job
    }));
  }

  async withdrawApplication(applicationId: number, userId: number): Promise<boolean> {
    // First verify the application belongs to the user by email
    const user = await this.getUser(userId);
    if (!user) return false;

    const application = await this.getApplication(applicationId);
    if (!application || application.email !== user.username) return false;

    // Delete the application
    const result = await db
      .delete(applications)
      .where(eq(applications.id, applicationId));

    return (result.rowCount || 0) > 0;
  }

  async getRecruiterApplications(recruiterId: number): Promise<(Application & { job: Job })[]> {
    const results = await db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        name: applications.name,
        email: applications.email,
        phone: applications.phone,
        coverLetter: applications.coverLetter,
        resumeUrl: applications.resumeUrl,
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
      .where(eq(jobs.postedBy, recruiterId))
      .orderBy(desc(applications.appliedAt));

    return results.map(result => ({
      ...result,
      job: result.job
    }));
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
    const applicationsResult = await db.select({ count: count() }).from(applications);
    
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
        status: jobs.status,
        isActive: jobs.isActive,
        createdAt: jobs.createdAt,
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
      .groupBy(applications.jobId);

    const applicationCountMap = jobApplicationCounts.reduce((acc, item) => {
      acc[item.jobId] = Number(item.count);
      return acc;
    }, {} as Record<number, number>);

    return jobsWithDetails.map(job => ({
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
      .orderBy(desc(applications.appliedAt));

    return applicationsWithDetails.map(app => ({
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
        profile: {
          bio: userProfiles.bio,
          skills: userProfiles.skills,
          linkedin: userProfiles.linkedin,
          location: userProfiles.location,
        },
      })
      .from(users)
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .orderBy(desc(users.id)); // Order by ID since createdAt doesn't exist

    // Get job counts for recruiters
    const jobCounts = await db
      .select({
        userId: jobs.postedBy,
        count: count(),
      })
      .from(jobs)
      .groupBy(jobs.postedBy);

    const jobCountMap = jobCounts.reduce((acc, item) => {
      acc[item.userId] = Number(item.count);
      return acc;
    }, {} as Record<number, number>);

    // Get application counts for candidates
    const applicationCounts = await db
      .select({
        email: applications.email,
        count: count(),
      })
      .from(applications)
      .groupBy(applications.email);

    const applicationCountMap = applicationCounts.reduce((acc, item) => {
      acc[item.email] = Number(item.count);
      return acc;
    }, {} as Record<string, number>);

    return usersWithDetails.map(user => {
      const result: any = {
        ...user,
        createdAt: new Date().toISOString(), // Mock createdAt since field doesn't exist
        profile: user.profile && (user.profile.bio || user.profile.skills || user.profile.linkedin || user.profile.location) 
          ? user.profile 
          : undefined,
      };

      if (user.role === 'recruiter' || user.role === 'admin') {
        result.jobCount = jobCountMap[user.id] || 0;
      }

      if (user.role === 'candidate') {
        result.applicationCount = applicationCountMap[user.username] || 0;
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

  async createJobAnalytics(analytics: InsertJobAnalytics): Promise<JobAnalytics> {
    const [result] = await db
      .insert(jobAnalytics)
      .values(analytics)
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

  async getJobsWithAnalytics(userId?: number): Promise<any[]> {
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
      .leftJoin(jobAnalytics, eq(jobs.id, jobAnalytics.jobId));

    if (userId) {
      query = query.where(eq(jobs.postedBy, userId)) as any;
    }

    const results = await query.orderBy(desc(jobs.createdAt));

    return results.map(row => ({
      ...row,
      analytics: row.analytics || { views: 0, applyClicks: 0, conversionRate: "0.00" }
    }));
  }

  // ===== ATS: Pipeline and Interviews =====
  async getPipelineStages(): Promise<PipelineStage[]> {
    return db.select().from(pipelineStages).orderBy(pipelineStages.order);
  }

  async createPipelineStage(stage: InsertPipelineStage & { createdBy?: number }): Promise<PipelineStage> {
    const [result] = await db.insert(pipelineStages).values(stage).returning();
    return result;
  }

  async updateApplicationStage(appId: number, newStageId: number, changedBy: number, notes?: string): Promise<void> {
    // Use transaction to ensure atomicity of stage change + history insert
    await db.transaction(async (tx) => {
      // Get current application state
      const app = await tx.query.applications.findFirst({
        where: eq(applications.id, appId)
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
        .where(eq(applications.id, appId));

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
    return db.select().from(applicationStageHistory).where(eq(applicationStageHistory.applicationId, appId)).orderBy(desc(applicationStageHistory.changedAt));
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
      .where(eq(applications.id, appId))
      .returning();
    return result || undefined;
  }

  async addRecruiterNote(appId: number, note: string): Promise<Application | undefined> {
    const [result] = await db.update(applications)
      .set({
        // Ensure NULL-safe append: COALESCE to empty text[] then concatenate ARRAY[note]
        recruiterNotes: sql`COALESCE(${applications.recruiterNotes}, ARRAY[]::text[]) || ARRAY[${note}]`,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, appId))
      .returning();
    return result || undefined;
  }

  async setApplicationRating(appId: number, rating: number): Promise<Application | undefined> {
    const [result] = await db.update(applications)
      .set({ rating, updatedAt: new Date() })
      .where(eq(applications.id, appId))
      .returning();
    return result || undefined;
  }

  // ===== ATS: Email templates =====
  async getEmailTemplates(): Promise<EmailTemplate[]> {
    return db.select().from(emailTemplates).orderBy(desc(emailTemplates.createdAt));
  }

  async createEmailTemplate(template: InsertEmailTemplate & { createdBy?: number }): Promise<EmailTemplate> {
    const [result] = await db.insert(emailTemplates).values(template).returning();
    return result;
  }
}

// Export the DatabaseStorage instance
export const storage = new DatabaseStorage();
