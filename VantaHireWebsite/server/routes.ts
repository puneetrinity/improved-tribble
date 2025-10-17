import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertJobSchema, insertApplicationSchema, insertPipelineStageSchema, insertEmailTemplateSchema, type InsertEmailTemplate } from "@shared/schema";
import { z } from "zod";
import { getEmailService } from "./simpleEmailService";
import { setupAuth, requireAuth, requireRole } from "./auth";
import { upload, uploadToCloudinary } from "./cloudinary";
import rateLimit from "express-rate-limit";
import { analyzeJobDescription, generateJobScore, calculateOptimizationSuggestions, isAIEnabled } from "./aiJobAnalyzer";
import { sendTemplatedEmail, sendStatusUpdateEmail, sendInterviewInvitation, sendApplicationReceivedEmail } from "./emailTemplateService";
import helmet from "helmet";
import * as spotaxis from "./integrations/spotaxis";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup security middleware with development-friendly CSP
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Allow strictly required third-party domains
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          // Apollo (optional tracker)
          "https://assets.apollo.io",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          // Google Fonts stylesheet (optional)
          "https://fonts.googleapis.com",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: [
          "'self'",
          "ws:",
          "wss:",
          // Apollo (optional tracker)
          "https://assets.apollo.io",
        ],
        fontSrc: [
          "'self'",
          "data:",
          // Google Fonts font files (optional)
          "https://fonts.gstatic.com",
        ],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  }));
  
  // Setup authentication
  setupAuth(app);
  
  // Rate limiting configurations
  const applicationRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 applications per hour per IP
    message: { error: 'Too many applications. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  const jobPostingRateLimit = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 10, // 10 job posts per day per user
    message: { error: 'Job posting limit reached. Try again tomorrow.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Rate limiting for AI analysis - 5 requests per hour per user
  const aiAnalysisRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // limit each user to 5 AI requests per hour
    message: { error: "AI analysis limit reached. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id?.toString() || req.ip || 'anonymous',
  });
  
  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Public client configuration (non-sensitive)
  app.get("/api/client-config", (_req: Request, res: Response) => {
    res.json({
      apolloAppId: process.env.APOLLO_APP_ID || null,
    });
  });

  // SpotAxis integration status and config
  app.get("/api/integrations/spotaxis", (req: Request, res: Response) => {
    res.json({
      enabled: spotaxis.isEnabled(),
      baseUrl: process.env.SPOTAXIS_BASE_URL || null,
      careersUrl: process.env.SPOTAXIS_CAREERS_URL || null,
    });
  });

  // AI features status
  app.get("/api/features/ai", (req: Request, res: Response) => {
    res.json({
      enabled: isAIEnabled(),
      features: {
        jobAnalysis: isAIEnabled(),
        jobScoring: isAIEnabled(),
      },
      message: isAIEnabled()
        ? 'AI features are available'
        : 'AI features require OPENAI_API_KEY to be configured'
    });
  });

  // Contact form submission endpoint
  app.post("/api/contact", async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extend the schema with additional validation
      const contactValidationSchema = insertContactSchema.extend({
        email: z.string().email("Please enter a valid email address"),
        message: z.string().min(1, "Please enter a message"),
      });
      
      const contactData = contactValidationSchema.parse(req.body);
      const submission = await storage.createContactSubmission(contactData);
      
      // Send email notification
      try {
        const emailService = await getEmailService();
        if (emailService) {
          const result = await emailService.sendContactNotification(submission);
          if (result) {
            console.log(`Email notification sent for submission ID: ${submission.id}`);
          } else {
            console.log(`Failed to send email notification for submission ID: ${submission.id}`);
          }
        } else {
          console.log('Email service not available. Skipping notification email.');
        }
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
        // Don't fail the request if email sending fails
      }
      
      res.status(201).json({ 
        success: true, 
        message: "Thank you for your message! We'll get back to you soon.",
        id: submission.id 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          success: false,
          error: error.errors.map(e => ({ 
            field: e.path.join('.'), 
            message: e.message 
          }))
        });
      } else {
        next(error);
      }
    }
  });
  
  // Get all contact submissions (admin access)
  app.get("/api/contact", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const submissions = await storage.getAllContactSubmissions();
      res.json(submissions);
    } catch (error) {
      next(error);
    }
  });

  // Test email notification (for admin use)
  app.get("/api/test-email", async (req: Request, res: Response) => {
    try {
      const emailService = await getEmailService();
      
      if (emailService) {
        const testSubmission = {
          id: 0,
          name: "Test User",
          email: "test@example.com",
          phone: "+1234567890",
          company: "Test Company",
          location: "Test Location",
          message: "This is a test email from VantaHire.",
          submittedAt: new Date()
        };
        
        const result = await emailService.sendContactNotification(testSubmission);
        
        if (result) {
          res.json({ success: true, message: "Test email sent successfully" });
        } else {
          res.status(500).json({ success: false, message: "Failed to send test email" });
        }
      } else {
        res.status(400).json({ 
          success: false, 
          message: "Email service not available. Please check server logs for details." 
        });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: "Error sending test email", 
        error: String(error) 
      });
    }
  });

  // ============= JOB MANAGEMENT ROUTES =============
  
  // Create a new job posting (recruiters/admins only)
  app.post("/api/jobs", jobPostingRateLimit, requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobData = insertJobSchema.parse(req.body);
      const job = await storage.createJob({
        ...jobData,
        postedBy: req.user!.id
      });
      
      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          error: 'Validation error',
          details: error.errors.map(e => ({ 
            field: e.path.join('.'), 
            message: e.message 
          }))
        });
      } else {
        next(error);
      }
    }
  });

  // Get all jobs with filtering and pagination
  app.get("/api/jobs", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const location = req.query.location as string;
      const type = req.query.type as string;
      const search = req.query.search as string;
      const skills = req.query.skills ? (req.query.skills as string).split(',') : undefined;

      if (spotaxis.isEnabled()) {
        const result = await spotaxis.fetchJobs({ page, limit, location, type, search, skills });
        res.json({
          jobs: result.jobs,
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        });
      } else {
        const result = await storage.getJobs({
          page,
          limit,
          location,
          type,
          search,
          skills
        });

        res.json({
          jobs: result.jobs,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit)
          }
        });
      }
    } catch (error) {
      next(error);
    }
  });

  // Get a specific job by ID
  app.get("/api/jobs/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      if (spotaxis.isEnabled()) {
        const job = await spotaxis.fetchJobById(jobId);
        if (!job) {
          return res.status(404).json({ error: 'Job not found' });
        }
        return res.json(job);
      } else {
        const job = await storage.getJob(jobId);
        if (!job) {
          return res.status(404).json({ error: 'Job not found' });
        }

        // Increment view count for analytics
        await storage.incrementJobViews(jobId);

        res.json(job);
      }
    } catch (error) {
      next(error);
    }
  });

  // Submit job application with resume upload
  app.post("/api/jobs/:id/apply", applicationRateLimit, upload.single('resume'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      // Check if job exists
      const job = await storage.getJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Resume file is required' });
      }

      // Increment apply click count for analytics
      await storage.incrementApplyClicks(jobId);

      // Validate application data
      const applicationData = insertApplicationSchema.parse(req.body);

      // Upload resume to Cloudinary or use placeholder if not configured
      let resumeUrl = 'placeholder-resume.pdf';
      if (req.file) {
        try {
          resumeUrl = await uploadToCloudinary(req.file.buffer, req.file.originalname);
        } catch (error) {
          console.log('Cloudinary not configured, using placeholder resume URL');
          resumeUrl = `resume-${Date.now()}-${req.file.originalname}`;
        }
      }

      // Create application record
      const application = await storage.createApplication({
        ...applicationData,
        jobId,
        resumeUrl
      });

      // Fire-and-forget: candidate confirmation (if enabled)
      const autoEmails = process.env.EMAIL_AUTOMATION_ENABLED === 'true' || process.env.EMAIL_AUTOMATION_ENABLED === '1';
      if (autoEmails) {
        sendApplicationReceivedEmail(application.id).catch(err => console.error('Application received email error:', err));
      }

      // Send notification email to recruiter
      try {
        const emailService = await getEmailService();
        if (emailService) {
          // Create a notification for the recruiter
          const recruiterNotification = {
            id: application.id,
            name: `New Application for ${job.title}`,
            email: application.email,
            phone: application.phone,
            company: `Applied for: ${job.title}`,
            location: job.location,
            message: `
New job application received:
- Applicant: ${application.name}
- Email: ${application.email}
- Phone: ${application.phone}
- Job: ${job.title}
- Resume: ${resumeUrl}
- Cover Letter: ${application.coverLetter || 'Not provided'}
            `,
            submittedAt: application.appliedAt
          };
          
          await emailService.sendContactNotification(recruiterNotification);
        }
      } catch (emailError) {
        console.error('Failed to send recruiter notification:', emailError);
      }

      res.status(201).json({
        success: true,
        message: 'Application submitted successfully',
        applicationId: application.id
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          error: 'Validation error',
          details: error.errors.map(e => ({ 
            field: e.path.join('.'), 
            message: e.message 
          }))
        });
      } else {
        next(error);
      }
    }
  });

  // Get applications for a specific job (recruiters only)
  app.get("/api/jobs/:id/applications", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      const applications = await storage.getApplicationsByJob(jobId);
      res.json(applications);
    } catch (error) {
      next(error);
    }
  });

  // Get jobs posted by current user (recruiters only)
  app.get("/api/my-jobs", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobs = await storage.getJobsByUser(req.user!.id);
      res.json(jobs);
    } catch (error) {
      next(error);
    }
  });

  // Update job status (activate/deactivate)
  app.patch("/api/jobs/:id/status", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = parseInt(req.params.id);
      const { isActive } = req.body;

      if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean' });
      }

      const job = await storage.updateJobStatus(jobId, isActive);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  // ============= ADMIN ROUTES =============
  
  // Get jobs by status for admin review
  app.get("/api/admin/jobs", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status = 'pending', page = 1, limit = 10 } = req.query;
      
      const result = await storage.getJobsByStatus(
        status as string,
        parseInt(page as string),
        parseInt(limit as string)
      );
      
      res.json({
        jobs: result.jobs,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: result.total,
          totalPages: Math.ceil(result.total / parseInt(limit as string))
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ============= ATS: PIPELINE & APPLICATION MANAGEMENT =============

  // Get pipeline stages
  app.get("/api/pipeline/stages", requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stages = await storage.getPipelineStages();
      res.json(stages);
    } catch (e) { next(e); }
  });

  // Create pipeline stage (recruiters/admin)
  app.post("/api/pipeline/stages", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = insertPipelineStageSchema.parse(req.body);
      const stage = await storage.createPipelineStage({ ...body, createdBy: req.user!.id });
      res.status(201).json(stage);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: e.errors });
      next(e);
    }
  });

  // Move application to a new stage
  app.patch("/api/applications/:id/stage", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = parseInt(req.params.id);
      const { stageId, notes } = req.body;
      if (!stageId || isNaN(appId)) return res.status(400).json({ error: 'stageId required' });
      await storage.updateApplicationStage(appId, parseInt(stageId), req.user!.id, notes);
      // Fire-and-forget: automated status email (if enabled)
      const autoEmails = process.env.EMAIL_AUTOMATION_ENABLED === 'true' || process.env.EMAIL_AUTOMATION_ENABLED === '1';
      if (autoEmails) {
        try {
          // Determine stage name for status update
          const stages = await storage.getPipelineStages();
          const target = stages.find(s => s.id === parseInt(stageId));
          if (target?.name) {
            // Do not block response
            sendStatusUpdateEmail(appId, target.name).catch(err => console.error('Status email error:', err));
          }
        } catch (e) {
          console.warn('Automated email skipped (stage lookup failed):', e);
        }
      }
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // Get application stage history
  app.get("/api/applications/:id/history", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = parseInt(req.params.id);
      const hist = await storage.getApplicationStageHistory(appId);
      res.json(hist);
    } catch (e) { next(e); }
  });

  // Schedule interview
  app.patch("/api/applications/:id/interview", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = parseInt(req.params.id);
      const { date, time, location, notes } = req.body;
      const updated = await storage.scheduleInterview(appId, { date: date ? new Date(date) : undefined, time, location, notes });
      // Fire-and-forget: interview invite (if enabled and fields provided)
      const autoEmails = process.env.EMAIL_AUTOMATION_ENABLED === 'true' || process.env.EMAIL_AUTOMATION_ENABLED === '1';
      if (autoEmails && date && time && location) {
        sendInterviewInvitation(appId, { date, time, location }).catch(err => console.error('Interview email error:', err));
      }
      res.json(updated);
    } catch (e) { next(e); }
  });

  // Add recruiter note
  app.post("/api/applications/:id/notes", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = parseInt(req.params.id);
      const { note } = req.body;
      if (!note) return res.status(400).json({ error: 'note required' });
      const updated = await storage.addRecruiterNote(appId, note);
      res.json(updated);
    } catch (e) { next(e); }
  });

  // Set rating
  app.patch("/api/applications/:id/rating", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = parseInt(req.params.id);
      const { rating } = req.body;
      if (typeof rating !== 'number' || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating 1-5' });
      const updated = await storage.setApplicationRating(appId, rating);
      res.json(updated);
    } catch (e) { next(e); }
  });

  // Email templates
  app.get("/api/email-templates", requireRole(['recruiter','admin']), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await storage.getEmailTemplates();
      res.json(list);
    } catch (e) { next(e); }
  });

  app.post("/api/email-templates", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = insertEmailTemplateSchema.parse(req.body as InsertEmailTemplate);
      const tpl = await storage.createEmailTemplate({ ...body, createdBy: req.user!.id });
      res.status(201).json(tpl);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: e.errors });
      next(e);
    }
  });

  // Send email using template
  app.post("/api/applications/:id/send-email", requireRole(['recruiter','admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = parseInt(req.params.id);
      const { templateId, customizations } = req.body as { templateId: number; customizations?: Record<string,string> };
      if (!templateId) return res.status(400).json({ error: 'templateId required' });
      const appData = await storage.getApplication(appId);
      if (!appData) return res.status(404).json({ error: 'application not found' });
      const [tpl] = (await storage.getEmailTemplates()).filter(t => t.id === templateId);
      if (!tpl) return res.status(404).json({ error: 'template not found' });
      await sendTemplatedEmail(appId, templateId, customizations || {});
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // Review a job (approve/decline)
  app.patch("/api/admin/jobs/:id/review", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = parseInt(req.params.id);
      const { status, reviewComments } = req.body;
      
      if (isNaN(jobId)) {
        return res.status(400).json({ error: "Invalid job ID" });
      }
      
      if (!['approved', 'declined'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'declined'" });
      }
      
      const job = await storage.reviewJob(jobId, status, reviewComments, req.user!.id);
      
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  // ============= PHASE 3: APPLICATION MANAGEMENT ROUTES =============
  
  // Update single application status (recruiters/admins only)
  app.patch("/api/applications/:id/status", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applicationId = parseInt(req.params.id);
      const { status, notes } = req.body;
      
      if (isNaN(applicationId)) {
        return res.status(400).json({ error: "Invalid application ID" });
      }
      
      if (!['submitted', 'reviewed', 'shortlisted', 'rejected', 'downloaded'].includes(status)) {
        return res.status(400).json({ 
          error: "Invalid status. Must be one of: submitted, reviewed, shortlisted, rejected, downloaded" 
        });
      }
      
      // Verify the recruiter owns this job if not admin
      if (req.user!.role !== 'admin') {
        const application = await storage.getApplication(applicationId);
        if (!application) {
          return res.status(404).json({ error: "Application not found" });
        }
        
        const job = await storage.getJob(application.jobId);
        if (!job || job.postedBy !== req.user!.id) {
          return res.status(403).json({ error: "Access denied" });
        }
      }
      
      const application = await storage.updateApplicationStatus(applicationId, status, notes);
      
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }
      
      res.json(application);
    } catch (error) {
      next(error);
    }
  });

  // Bulk update application statuses (recruiters/admins only)
  app.patch("/api/applications/bulk", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { applicationIds, status, notes } = req.body;
      
      if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
        return res.status(400).json({ error: "applicationIds must be a non-empty array" });
      }
      
      if (!['submitted', 'reviewed', 'shortlisted', 'rejected', 'downloaded'].includes(status)) {
        return res.status(400).json({ 
          error: "Invalid status. Must be one of: submitted, reviewed, shortlisted, rejected, downloaded" 
        });
      }
      
      // Verify all applications belong to the recruiter's jobs if not admin
      if (req.user!.role !== 'admin') {
        const applications = await Promise.all(
          applicationIds.map(id => storage.getApplication(parseInt(id)))
        );
        
        const jobIds = applications
          .filter(app => app)
          .map(app => app!.jobId);
        
        const jobs = await Promise.all(
          jobIds.map(id => storage.getJob(id))
        );
        
        const unauthorizedJob = jobs.find(job => !job || job.postedBy !== req.user!.id);
        if (unauthorizedJob) {
          return res.status(403).json({ error: "Access denied to one or more applications" });
        }
      }
      
      const updatedCount = await storage.updateApplicationsStatus(
        applicationIds.map(id => parseInt(id)), 
        status, 
        notes
      );
      
      res.json({ 
        success: true, 
        updatedCount,
        message: `${updatedCount} applications updated successfully` 
      });
    } catch (error) {
      next(error);
    }
  });

  // Mark application as viewed (automatically updates status to 'reviewed')
  app.patch("/api/applications/:id/view", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applicationId = parseInt(req.params.id);
      
      if (isNaN(applicationId)) {
        return res.status(400).json({ error: "Invalid application ID" });
      }
      
      // Verify the recruiter owns this job if not admin
      if (req.user!.role !== 'admin') {
        const application = await storage.getApplication(applicationId);
        if (!application) {
          return res.status(404).json({ error: "Application not found" });
        }
        
        const job = await storage.getJob(application.jobId);
        if (!job || job.postedBy !== req.user!.id) {
          return res.status(403).json({ error: "Access denied" });
        }
      }
      
      const application = await storage.markApplicationViewed(applicationId);
      
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }
      
      res.json(application);
    } catch (error) {
      next(error);
    }
  });

  // Mark application as downloaded (when resume is downloaded)
  app.patch("/api/applications/:id/download", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applicationId = parseInt(req.params.id);
      
      if (isNaN(applicationId)) {
        return res.status(400).json({ error: "Invalid application ID" });
      }
      
      // Verify the recruiter owns this job if not admin
      if (req.user!.role !== 'admin') {
        const application = await storage.getApplication(applicationId);
        if (!application) {
          return res.status(404).json({ error: "Application not found" });
        }
        
        const job = await storage.getJob(application.jobId);
        if (!job || job.postedBy !== req.user!.id) {
          return res.status(403).json({ error: "Access denied" });
        }
      }
      
      const application = await storage.markApplicationDownloaded(applicationId);
      
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }
      
      res.json(application);
    } catch (error) {
      next(error);
    }
  });

  // ============= PHASE 5: ADMIN SUPER DASHBOARD ROUTES =============
  
  // Get admin statistics
  app.get("/api/admin/stats", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  // Get all jobs with details for admin
  app.get("/api/admin/jobs/all", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobs = await storage.getAllJobsWithDetails();
      res.json(jobs);
    } catch (error) {
      next(error);
    }
  });

  // Get all applications with details for admin
  app.get("/api/admin/applications/all", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applications = await storage.getAllApplicationsWithDetails();
      res.json(applications);
    } catch (error) {
      next(error);
    }
  });

  // Get all users for admin
  app.get("/api/admin/users", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await storage.getAllUsersWithDetails();
      res.json(users);
    } catch (error) {
      next(error);
    }
  });

  // Update user role (admin only)
  app.patch("/api/admin/users/:id/role", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.params.id);
      const { role } = req.body;
      
      if (isNaN(userId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }
      
      if (!['candidate', 'recruiter', 'admin'].includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be candidate, recruiter, or admin" });
      }
      
      const user = await storage.updateUserRole(userId, role);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      next(error);
    }
  });

  // Delete job (admin only)
  app.delete("/api/admin/jobs/:id", requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = parseInt(req.params.id);
      
      if (isNaN(jobId)) {
        return res.status(400).json({ error: "Invalid job ID" });
      }
      
      const success = await storage.deleteJob(jobId);
      
      if (!success) {
        return res.status(404).json({ error: "Job not found" });
      }
      
      res.json({ message: "Job deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // ============= PHASE 4: CANDIDATE DASHBOARD & PROFILE ROUTES =============
  
  // Get user profile
  app.get("/api/profile", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await storage.getUserProfile(req.user!.id);
      res.json(profile || null);
    } catch (error) {
      next(error);
    }
  });

  // Create or update user profile
  app.post("/api/profile", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profileData = req.body;
      
      // Check if profile exists
      const existingProfile = await storage.getUserProfile(req.user!.id);
      
      let profile;
      if (existingProfile) {
        profile = await storage.updateUserProfile(req.user!.id, profileData);
      } else {
        profile = await storage.createUserProfile({
          ...profileData,
          userId: req.user!.id
        });
      }
      
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  // Update user profile
  app.patch("/api/profile", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profileData = req.body;
      const profile = await storage.updateUserProfile(req.user!.id, profileData);
      
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }
      
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  // Get user's applications
  app.get("/api/my-applications", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applications = await storage.getApplicationsByEmail(req.user!.username);
      res.json(applications);
    } catch (error) {
      next(error);
    }
  });

  // Get applications received for recruiter's jobs
  app.get("/api/my-applications-received", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applications = await storage.getRecruiterApplications(req.user!.id);
      res.json(applications);
    } catch (error) {
      next(error);
    }
  });

  // Withdraw application
  app.delete("/api/applications/:id/withdraw", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applicationId = parseInt(req.params.id);
      
      if (isNaN(applicationId)) {
        return res.status(400).json({ error: "Invalid application ID" });
      }
      
      const success = await storage.withdrawApplication(applicationId, req.user!.id);
      
      if (!success) {
        return res.status(404).json({ error: "Application not found or access denied" });
      }
      
      res.json({ success: true, message: "Application withdrawn successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Get job analytics for admin/recruiter
  app.get("/api/analytics/jobs", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.role === 'admin' ? undefined : req.user!.id;
      const jobsWithAnalytics = await storage.getJobsWithAnalytics(userId);
      res.json(jobsWithAnalytics);
    } catch (error) {
      next(error);
    }
  });

  // Get analytics for a specific job
  app.get("/api/analytics/jobs/:id", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      // Verify ownership if not admin
      if (req.user!.role !== 'admin') {
        const job = await storage.getJob(jobId);
        if (!job || job.postedBy !== req.user!.id) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const analytics = await storage.getJobAnalytics(jobId);
      if (!analytics) {
        return res.status(404).json({ error: 'Analytics not found' });
      }

      res.json(analytics);
    } catch (error) {
      next(error);
    }
  });

  // AI-powered job description analysis
  app.post("/api/ai/analyze-job-description", aiAnalysisRateLimit, requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if AI features are enabled
      if (!isAIEnabled()) {
        return res.status(503).json({
          error: 'AI features are not configured',
          message: 'OpenAI API key is not set. AI-powered analysis is currently unavailable.'
        });
      }

      const { title, description } = req.body;

      if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required' });
      }

      if (title.length > 200 || description.length > 5000) {
        return res.status(400).json({ error: 'Title or description too long' });
      }

      console.log(`AI analysis requested by user ${req.user!.id} for job: ${title}`);
      
      const analysis = await analyzeJobDescription(title, description);
      const suggestions = calculateOptimizationSuggestions(analysis);
      
      res.json({
        ...analysis,
        suggestions,
        analysis_timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('AI analysis error:', error);
      if (error instanceof Error && error.message.includes('AI analysis unavailable')) {
        return res.status(502).json({ error: 'AI service temporarily unavailable' });
      }
      next(error);
    }
  });

  // AI-powered job scoring
  app.post("/api/ai/score-job", aiAnalysisRateLimit, requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if AI features are enabled
      if (!isAIEnabled()) {
        return res.status(503).json({
          error: 'AI features are not configured',
          message: 'OpenAI API key is not set. AI-powered scoring is currently unavailable.'
        });
      }

      const { title, description, jobId } = req.body;

      if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required' });
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

      const score = await generateJobScore(title, description, historicalData);
      
      // Cache the score if jobId provided
      if (jobId) {
        await storage.updateJobAnalytics(jobId, {
          aiScoreCache: score,
          aiModelVersion: "gpt-4o"
        });
      }

      res.json({
        score,
        model_version: "gpt-4o",
        timestamp: new Date().toISOString(),
        factors: {
          content_analysis: true,
          historical_data: !!historicalData
        }
      });
    } catch (error) {
      console.error('AI scoring error:', error);
      next(error);
    }
  });

  // Export analytics data as CSV
  app.get("/api/analytics/export", requireRole(['recruiter', 'admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { format = 'json', dateRange = '30' } = req.query;
      const userId = req.user!.role === 'admin' ? undefined : req.user!.id;
      
      const jobs = await storage.getJobsWithAnalytics(userId);
      
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
      }
    } catch (error) {
      console.error('Export error:', error);
      next(error);
    }
  });

  // Proxy route for PyjamaHR careers page
  app.get("/careers", async (req: Request, res: Response) => {
    try {
      const targetUrl = "https://app.pyjamahr.com/careers?company=Vantahire&company_uuid=D931601ECE&isHeaderVisible=true&is_careers_page=true";
      
      // Redirect to the PyjamaHR careers page
      res.redirect(302, targetUrl);
    } catch (error) {
      console.error('Careers proxy error:', error);
      res.status(500).json({ error: "Unable to load careers page" });
    }
  });

  // SpotAxis helper redirects (avoid hardcoding in client)
  app.get("/spotaxis/admin", (req: Request, res: Response) => {
    const base = process.env.SPOTAXIS_BASE_URL;
    if (!base) return res.status(400).json({ error: "SpotAxis not configured" });
    res.redirect(302, `${base.replace(/\/$/, '')}/admin/`);
  });
  app.get("/spotaxis/recruiter", (req: Request, res: Response) => {
    const base = process.env.SPOTAXIS_BASE_URL;
    if (!base) return res.status(400).json({ error: "SpotAxis not configured" });
    res.redirect(302, `${base.replace(/\/$/, '')}/profile/employer/`);
  });
  app.get("/spotaxis/job/new", (req: Request, res: Response) => {
    const base = process.env.SPOTAXIS_BASE_URL;
    if (!base) return res.status(400).json({ error: "SpotAxis not configured" });
    res.redirect(302, `${base.replace(/\/$/, '')}/job/edit/`);
  });
  app.get("/spotaxis/jobs", (req: Request, res: Response) => {
    const careers = process.env.SPOTAXIS_CAREERS_URL;
    const base = process.env.SPOTAXIS_BASE_URL;
    if (!careers && !base) return res.status(400).json({ error: "SpotAxis not configured" });
    const target = careers || `${base!.replace(/\/$/, '')}/jobs/`;
    res.redirect(302, target);
  });

  // WhatsApp webhook routes
  // Incoming WhatsApp webhook endpoint
  app.post('/api/whatsapp/incoming', (req: Request, res: Response) => {
    console.log('Incoming WhatsApp message:', req.body);
    // Your message handling logic here
    res.type('text/xml');
    res.send('<Response></Response>');
  });

  // Status callback webhook endpoint
  app.post('/api/whatsapp/status', (req: Request, res: Response) => {
    console.log('WhatsApp status update:', req.body);
    res.sendStatus(200);
  });

  const httpServer = createServer(app);
  return httpServer;
}
