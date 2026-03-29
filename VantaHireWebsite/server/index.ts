import express, { type Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startJobScheduler } from "./jobScheduler";
import { createAdminUser, createTestRecruiter, syncAdminPasswordIfEnv } from "./createAdminUser";
import { createTestJobs } from "./createTestJobs";
import { seedAllATSDefaults } from "./seedATSDefaults";
import { ensureAtsSchema } from "./bootstrapSchema";
import { seedDefaultWhatsAppTemplates } from "./seedWhatsAppTemplates";
import { startApplicationGraphSyncProcessor, stopApplicationGraphSyncProcessor } from "./lib/applicationGraphSyncProcessor";
import { startResumeImportProcessor, stopResumeImportProcessor } from "./lib/resumeImportProcessor";
import { captureServerException, initServerMonitoring, monitoringRequestContext } from "./monitoring";

initServerMonitoring();
const app = express();

// Enable GZIP compression for all responses
app.use(compression({
  level: 6, // Compression level (0-9, 6 is default and good balance)
  threshold: 1024, // Only compress responses larger than 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Capture raw body for webhook signature verification
// The rawBody is stored on the request object for routes that need it
app.use(express.json({
  verify: (req: any, _res, buf) => {
    // Store raw body for webhook signature verification
    if (req.url?.startsWith('/api/webhooks/')) {
      req.rawBody = buf.toString('utf-8');
    }
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(monitoringRequestContext);

// WWW to non-WWW redirect for SEO (301 permanent redirect)
// Host header validation to prevent injection attacks
app.use((req, res, next) => {
  const host = req.headers.host || '';
  const path = req.path;

  // Skip host validation for health check endpoints (used by Railway, k8s, etc.)
  if (path === '/healthz' || path === '/readyz' || path === '/api/health') {
    return next();
  }

  // Define allowed hosts (customize for your domain)
  const allowedHosts = process.env.ALLOWED_HOSTS
    ? process.env.ALLOWED_HOSTS.split(',')
    : ['localhost:5000', 'www.localhost:5000']; // Default for development

  // Validate host is in allowed list
  if (host && !allowedHosts.includes(host)) {
    // Log suspicious request but continue (don't block in case of misconfiguration)
    console.warn(`⚠️  Unrecognized host header: ${host}`);
  }

  // Only redirect if host is in allowed list and starts with www.
  if (host.startsWith('www.') && allowedHosts.includes(host)) {
    const nonWwwHost = host.slice(4);
    if (allowedHosts.includes(nonWwwHost)) {
      const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      return res.redirect(301, `${protocol}://${nonWwwHost}${req.url}`);
    }
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Log only request metadata, never response bodies (GDPR/PII compliance)
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler?.(app);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // Normalize common upload/validation errors to 400 instead of 500
    let status = err.status || err.statusCode || 500;
    const isMulter = err?.name === 'MulterError' || err?.code === 'LIMIT_FILE_SIZE' || /Only PDF files/.test(err?.message || '');
    if (isMulter && status === 500) status = 400;

    const message = err.message || "Internal Server Error";

    res.status(status).json({ error: message });
    console.error('Server error:', err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    await serveStatic(app);
  }

  // Bind to platform-provided PORT (e.g., Railway/Heroku), fallback to 5000
  const port = Number(process.env.PORT) || 5000;
  const host = process.env.HOST || "0.0.0.0";
  // reusePort causes issues on macOS (darwin), so we disable it there
  const reusePort = process.platform !== 'darwin';
  
  server.listen({
    port,
    host,
    reusePort,
  }, async () => {
    log(`serving on port ${port}`);

    // Initialize database: Create schema, sync admin, seed data
    try {
      // 1. Ensure ATS tables exist (creates them if missing)
      await ensureAtsSchema();

      // 2. Create/sync admin user (production-safe)
      await createAdminUser();
      await syncAdminPasswordIfEnv();

      // 3. Seed WhatsApp templates (runs in all environments)
      await seedDefaultWhatsAppTemplates();
      console.log('✅ WhatsApp templates seeded');

      // 4. Development-only: Create test data (NEVER run in production)
      if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEFAULTS === 'true') {
        console.log('🔧 Development mode: Seeding test data...');
        await createTestRecruiter();
        await seedAllATSDefaults();
        await createTestJobs();
        console.log('✅ Test data seeded successfully');
      } else if (process.env.NODE_ENV === 'production') {
        console.log('🔒 Production mode: Skipping test data seeding');
      }
    } catch (error) {
      captureServerException(error, {
        area: "server",
        action: "startup-initialization",
      });
      console.error('Error initializing database:', error);
    }

    // Start job scheduler for automatic job expiration
    startJobScheduler();

    // Start ActiveKG graph sync processor (if enabled)
    if (process.env.ACTIVEKG_SYNC_ENABLED === 'true') {
      startApplicationGraphSyncProcessor();
      console.log('ActiveKG graph sync processor started');
    }

    if (process.env.BULK_RESUME_IMPORT_ENABLED === 'true') {
      startResumeImportProcessor();
      console.log('Bulk resume import processor started');
    }
  });

  // Graceful shutdown
  const gracefulShutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    stopApplicationGraphSyncProcessor();
    stopResumeImportProcessor();
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    captureServerException(reason, {
      area: "server",
      action: "unhandled-rejection",
    });
  });
  process.on('uncaughtException', (error) => {
    captureServerException(error, {
      area: "server",
      action: "uncaught-exception",
    });
  });
})();
