import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { eq, and, or, gt, isNull, sql } from "drizzle-orm";
import { insertContactSchema, jobs, users, organizationMembers, hiringManagerInvitations } from "@shared/schema";
import { z } from "zod";
import { getEmailService } from "./simpleEmailService";
import { setupAuth, requireRole } from "./auth";
import { upload } from "./gcs-storage";
import { isAIEnabled } from "./aiJobAnalyzer";
import { generateJobsSitemapXML } from "./seoUtils";
import helmet from "helmet";
import { registerFormsRoutes } from "./forms.routes";
import { registerTestRunnerRoutes } from "./testRunner.routes";
import { registerAIRoutes } from "./ai.routes";
import { registerAdminRoutes } from "./admin.routes";
import { registerClientsRoutes } from "./clients.routes";
import { registerJobsRoutes } from "./jobs.routes";
import { registerApplicationsRoutes } from "./applications.routes";
import { registerBulkResumeImportRoutes } from "./bulkResumeImport.routes";
import { registerCommunicationsRoutes } from "./communications.routes";
import { registerWhatsAppRoutes } from "./whatsapp.routes";
import { registerResumeRoutes } from "./resume.routes";
import { registerProfileRoutes } from "./profile.routes";
import { registerTalentPoolRoutes } from "./talent-pool.routes";
import { registerHiringManagerInvitationRoutes } from "./hiringManagerInvitations.routes";
import { registerCoRecruiterInvitationRoutes } from "./coRecruiterInvitations.routes";
import { doubleCsrfProtection as csrfProtectionModule, generateToken as generateTokenModule } from "./csrf";
import { registerOrganizationRoutes } from "./organization.routes";
import { registerSubscriptionRoutes } from "./subscription.routes";
import { registerBillingRoutes } from "./billing.routes";
import { registerAdminSubscriptionRoutes } from "./admin-subscription.routes";
import { registerCashfreeWebhook } from "./webhooks/cashfree.webhook";
import { registerSignalWebhook } from "./webhooks/signal.webhook";
import { registerSignalRoutes } from "./signal.routes";
import { registerColdOutreachRoutes } from "./coldOutreach.routes";
import { registerCandidateSemanticRoutes } from "./candidates.semantic.routes";
import { registerRecruiterDashboardRoutes } from "./recruiterDashboard.routes";
import { registerCandidatePortalRoutes } from "./candidatePortal.routes";
import { isExpectedDisconnectError } from "./monitoring";
import { ensureAtsSchema } from "./bootstrapSchema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup security middleware with environment-aware CSP
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Ensure body parsing is available even when registerRoutes is used directly in tests
  // Capture raw body for webhook signature verification
  app.use(express.json({
    verify: (req: any, _res, buf) => {
      if (req.url?.startsWith('/api/webhooks/')) {
        req.rawBody = buf.toString('utf-8');
      }
    }
  }));
  app.use(express.urlencoded({ extended: false }));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // scriptSrc: Some marketing pages still include inline script blocks and third-party embeds.
        // Note: 'unsafe-inline' here does not permit inline event-handler attributes such as onload=.
        // Google Tag Manager needed for analytics
        // Cashfree SDK needed for payment checkout
        scriptSrc: isDevelopment
          ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://assets.apollo.io", "https://mautic.evalmatch.app", "https://www.googletagmanager.com", "https://sdk.cashfree.com"]
          : ["'self'", "'unsafe-inline'", "https://assets.apollo.io", "https://mautic.evalmatch.app", "https://www.googletagmanager.com", "https://sdk.cashfree.com"],
        // style: allow inline styles for UI libraries and static landing pages with embedded CSS
        // 'unsafe-inline' needed in both dev and prod for inline <style> blocks
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://api.fontshare.com", "https://mautic.evalmatch.app"],
        imgSrc: ["'self'", "data:", "https:"],
        // connectSrc: Restrict WebSocket connections in production
        // Mautic form submissions require connection to mautic domain
        // Google Analytics requires connection to google-analytics.com
        // Cashfree SDK makes API calls to their servers
        connectSrc: (() => {
          const base = ["'self'", "https://assets.apollo.io", "https://mautic.evalmatch.app", "https://www.google-analytics.com", "https://region1.google-analytics.com", "https://*.cashfree.com"];
          if (isDevelopment) base.push("ws:", "wss:");
          // Allow browser Sentry SDK to post errors to GlitchTip
          const sentryDsn = process.env.VITE_SENTRY_DSN || process.env.SENTRY_DSN;
          if (sentryDsn) {
            try { base.push(new URL(sentryDsn).origin); } catch {}
          }
          return base;
        })(),
        fontSrc: [
          "'self'",
          "data:",
          "https://fonts.gstatic.com",
          "https://api.fontshare.com",
          "https://cdn.fontshare.com",
          "https://fonts.fontshare.com",
          "https://r2cdn.perplexity.ai",
        ],
        objectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        // Cashfree checkout opens in iframe
        frameSrc: ["'self'", "https://mautic.evalmatch.app", "https://sdk.cashfree.com", "https://*.cashfree.com"],
        // formAction: Allow form submissions to Mautic and Cashfree
        formAction: ["'self'", "https://mautic.evalmatch.app", "https://*.cashfree.com", "https://api.cashfree.com"],
      },
    },
  }));

  // Enable HSTS in production to enforce HTTPS (prevents protocol downgrade)
  if (!isDevelopment) {
    app.use(helmet.hsts({
      // 180 days in seconds (recommended minimum); here ~180 days
      maxAge: 60 * 60 * 24 * 180,
      includeSubDomains: true,
      preload: false,
    }));
  }
  
  // Setup authentication
  setupAuth(app);

  // CSRF protection - use module implementations
  const doubleCsrfProtection = csrfProtectionModule;
  const generateToken = generateTokenModule;

  // CSRF token endpoint - must be called before making mutating requests
  app.get("/api/csrf-token", (req: Request, res: Response) => {
    const token = generateToken(req, res);
    res.json({ token });
  });

  // Rate limiters are imported from ./rateLimit module

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Local dev helper: force ATS schema bootstrap in the running app process
  app.post("/api/dev/ensure-ats-schema", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (process.env.NODE_ENV === "production") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await ensureAtsSchema();
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Platform healthcheck endpoints (Railway, k8s, etc.)
  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.status(200).json({ status: "ok" });
    } catch (err) {
      res.status(503).json({ status: "error" });
    }
  });

  // Public client configuration (non-sensitive)
  app.get("/api/client-config", (_req: Request, res: Response) => {
    res.json({
      apolloAppId: process.env.APOLLO_APP_ID || null,
    });
  });

  // Dynamic jobs sitemap for SEO
  app.get("/sitemap-jobs.xml", async (_req: Request, res: Response): Promise<void> => {
    try {
      // Check if sitemap generation is enabled via feature flag
      const enableSitemap = process.env.SEO_ENABLE_SITEMAP_JOBS !== 'false'; // Default to true

      if (!enableSitemap) {
        res.status(404).send('Not found');
        return;
      }

      // Query only approved, active, and non-expired jobs
      const activeJobs = await db.query.jobs.findMany({
        where: and(
          eq(jobs.isActive, true),
          eq(jobs.status, 'approved'),
          or(isNull(jobs.expiresAt), gt(jobs.expiresAt, new Date()))
        ),
        columns: {
          id: true,
          slug: true,
          updatedAt: true,
          createdAt: true,
        },
        orderBy: (jobs: any, { desc }: { desc: any }) => [desc(jobs.createdAt)],
        limit: 50000, // Google sitemap limit
      });

      const baseUrl = (process.env.BASE_URL || 'https://ealana.com').replace(/\/$/, '');
      const sitemapXML = generateJobsSitemapXML(activeJobs, baseUrl);

      res.header('Content-Type', 'application/xml');
      res.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(sitemapXML);
      return;
    } catch (error) {
      console.error('Error generating jobs sitemap:', error);
      res.status(500).send('Error generating sitemap');
      return;
    }
  });

  // AI features status (DEPRECATED: use /api/ai/features instead)
  // Kept for backward compatibility - will be removed in future version
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
  app.post("/api/contact", doubleCsrfProtection, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
      return;
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: error.errors.map(e => ({
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
  
  // Get all contact submissions (admin access)
  app.get("/api/contact", requireRole(['super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const submissions = await storage.getAllContactSubmissions();
      res.json(submissions);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Test email notification (for admin use)
  app.get("/api/test-email", requireRole(['super_admin']), async (req: Request, res: Response): Promise<void> => {
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
          return;
        } else {
          res.status(500).json({ success: false, message: "Failed to send test email" });
          return;
        }
      } else {
        res.status(400).json({
          success: false,
          message: "Email service not available. Please check server logs for details."
        });
        return;
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error sending test email",
        error: String(error)
      });
      return;
    }
  });

  // ===========================
  // User Management Endpoints
  // ===========================

  /**
   * GET /api/users
   * Get list of users filtered by role
   * Query params:
   *   - role: string (optional, filter by specific role: 'hiring_manager', 'recruiter', etc.)
   */
  app.get("/api/users", requireRole(['recruiter', 'super_admin']), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { role } = req.query;

      // Fetch users from storage
      const allUsers = await storage.getUsers();

      // Filter by role if specified
      let filteredUsers = allUsers;
      if (role && typeof role === 'string') {
        filteredUsers = allUsers.filter((u: typeof allUsers[0]) => u.role === role);
      }

      // Scope hiring managers to the requester's organization (recruiters only)
      if (req.user?.role === 'recruiter' && role === 'hiring_manager') {
        const membership = await db.query.organizationMembers.findFirst({
          where: eq(organizationMembers.userId, req.user.id),
          columns: { organizationId: true },
        });

        if (!membership) {
          res.json([]);
          return;
        }

        const orgId = membership.organizationId;

        const hmFromJobs = await db.select({ id: jobs.hiringManagerId })
          .from(jobs)
          .where(and(
            eq(jobs.organizationId, orgId),
            sql`${jobs.hiringManagerId} IS NOT NULL`
          ));

        const hmFromInvites = await db.select({ id: users.id })
          .from(hiringManagerInvitations)
          .innerJoin(users, sql`LOWER(${users.username}) = LOWER(${hiringManagerInvitations.email})`)
          .innerJoin(organizationMembers, eq(organizationMembers.userId, hiringManagerInvitations.invitedBy))
          .where(and(
            eq(organizationMembers.organizationId, orgId),
            eq(hiringManagerInvitations.status, 'accepted'),
            eq(users.role, 'hiring_manager')
          ));

        const allowedIds = new Set<number>();
        for (const row of hmFromJobs) {
          if (row.id != null) allowedIds.add(row.id);
        }
        for (const row of hmFromInvites) {
          allowedIds.add(row.id);
        }

        filteredUsers = filteredUsers.filter((u: typeof allUsers[0]) => allowedIds.has(u.id));
      }

      // Return sanitized user data (exclude password)
      const sanitizedUsers = filteredUsers.map((user: typeof allUsers[0]) => ({
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      }));

      res.json(sanitizedUsers);
      return;
    } catch (error) {
      console.error('[Users] Error fetching users:', error);
      next(error);
    }
  });

  // ============= CONSULTANT SHOWCASE ROUTES =============

  // Public: Get all active consultants
  app.get("/api/consultants", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const consultants = await storage.getActiveConsultants();
      res.json(consultants);
      return;
    } catch (error) {
      next(error);
    }
  });

  // Public: Get a specific consultant
  app.get("/api/consultants/:id", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParam = req.params.id;
      if (!idParam) {
        res.status(400).json({ error: 'Missing ID parameter' });
        return;
      }
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid ID parameter" });
        return;
      }

      const consultant = await storage.getConsultant(id);
      if (!consultant || !consultant.isActive) {
        res.status(404).json({ error: "Consultant not found" });
        return;
      }

      res.json(consultant);
      return;
    } catch (error) {
      next(error);
    }
  });


  // Register admin routes (admin dashboard, stats, user management, etc.)
  registerAdminRoutes(app, doubleCsrfProtection);

  // Register clients routes (client management, shortlists, feedback)
  registerClientsRoutes(app, doubleCsrfProtection);

  // Register jobs routes (job CRUD, analytics, AI analysis)
  registerJobsRoutes(app, doubleCsrfProtection);

  // Register applications routes (applications, pipeline, candidates, profiles)
  registerApplicationsRoutes(app, doubleCsrfProtection, upload);

  // Register candidate portal routes (saved jobs)
  registerCandidatePortalRoutes(app, doubleCsrfProtection);

  // Register bulk resume import routes (staging/review/finalize flow)
  registerBulkResumeImportRoutes(app, doubleCsrfProtection, upload);

  // Register communications routes (email templates, sending, AI drafts)
  registerCommunicationsRoutes(app, doubleCsrfProtection);

  // Register WhatsApp routes (WhatsApp templates, sending, webhooks)
  registerWhatsAppRoutes(app, doubleCsrfProtection);

  // Resume text preview routes
  registerResumeRoutes(app);

  // Register profile routes (user profiles, public recruiter profiles)
  registerProfileRoutes(app, doubleCsrfProtection);

  // Register forms routes (recruiter-sent candidate forms feature)
  registerFormsRoutes(app, doubleCsrfProtection);

  // Register talent pool routes (manage external candidates)
  registerTalentPoolRoutes(app);

  // Register hiring manager invitation routes
  registerHiringManagerInvitationRoutes(app, doubleCsrfProtection);

  // Register co-recruiter invitation routes
  registerCoRecruiterInvitationRoutes(app, doubleCsrfProtection);

  // Register organization routes (org management, members, invites, join requests)
  registerOrganizationRoutes(app, doubleCsrfProtection);

  // Register subscription routes (plans, subscriptions, seats, AI credits)
  registerSubscriptionRoutes(app, doubleCsrfProtection);

  // Register billing routes (GSTIN, billing info)
  registerBillingRoutes(app, doubleCsrfProtection);

  // Register admin subscription routes (super_admin only)
  registerAdminSubscriptionRoutes(app, doubleCsrfProtection);

  // Register Cashfree webhook (payment callbacks)
  registerCashfreeWebhook(app);

  // Register Signal webhook (sourcing callbacks — no CSRF, uses JWT auth)
  registerSignalWebhook(app);

  // Register Signal sourcing routes (recruiter-facing, with CSRF)
  registerSignalRoutes(app, doubleCsrfProtection);

  // Register cold outreach routes for shortlisted sourced candidates
  registerColdOutreachRoutes(app, doubleCsrfProtection);

  // Register candidate semantic search routes (ActiveKG-powered, with CSRF)
  registerCandidateSemanticRoutes(app, doubleCsrfProtection);

  // Register recruiter dashboard action routes
  registerRecruiterDashboardRoutes(app);

  // Register AI matching routes (resume library + fit scoring)
  registerAIRoutes(app);
  console.log('✅ AI matching routes registered (controlled by AI_MATCH_ENABLED and AI_RESUME_ENABLED flags)');

  // Register test runner routes (admin testing dashboard)
  // Gated by env flag for security - prevents accidental load in production
  if (process.env.ENABLE_TEST_RUNNER === 'true') {
    registerTestRunnerRoutes(app, doubleCsrfProtection);
    console.log('✅ Test runner enabled (ENABLE_TEST_RUNNER=true)');
  } else {
    console.log('⚠️  Test runner disabled (set ENABLE_TEST_RUNNER=true to enable)');
  }

  const httpServer = createServer(app);

  // Handle HTTP parse errors gracefully (malformed requests, health checks, bots)
  httpServer.on('clientError', (err: NodeJS.ErrnoException, socket) => {
    if (isExpectedDisconnectError(err)) {
      if (!socket.destroyed) {
        socket.destroy();
      }
      return;
    }

    if (err.code !== 'ECONNRESET') {
      console.warn('HTTP client error:', err.message);
    }

    if (socket.writable && !socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  return httpServer;
}
