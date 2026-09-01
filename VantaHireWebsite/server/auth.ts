import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import { getEmailService } from "./simpleEmailService";
import rateLimit from "express-rate-limit";
import { computeProfileCompletion } from "./lib/profileCompletion";
import { getOrganizationInviteByToken } from "./lib/organizationService";
import { queueMauticFirstLoginSync, queueMauticSignupSync } from "./lib/mauticService";
import {
  createAuthorizationSessionPayload,
  parseAuthorizationSessionPayload,
  resetPasswordAndAdvanceAuthorization,
} from "./lib/privilegeGrantRevocation";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

declare module "express-session" {
  interface SessionData {
    privacyReauthenticatedAt?: number;
    privacyPasswordVersion?: string;
  }
}

const scryptAsync = promisify(scrypt);

// Generate a secure verification token and its hash
function generateVerificationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

// Hash a token for lookup
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function privacyPasswordVersion(storedPassword: string): string {
  return createHash("sha256").update(storedPassword).digest("hex");
}

function getPublicBaseUrl(): string {
  const fromEnv =
    process.env.BASE_URL ||
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
    'http://localhost:5000';
  return fromEnv.replace(/\/+$/, '');
}

// Rate limiter for resend verification endpoint
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per window
  message: { error: 'Too many verification email requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for password reset endpoint
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Send verification email
async function sendVerificationEmail(
  email: string,
  token: string,
  firstName?: string | null,
  inviteToken?: string | null
): Promise<boolean> {
  const emailService = await getEmailService();
  if (!emailService) {
    console.error('Email service not available');
    return false;
  }

  const baseUrl = getPublicBaseUrl();
  const verifyUrl = inviteToken
    ? `${baseUrl}/verify-email/${token}?invite=${inviteToken}`
    : `${baseUrl}/verify-email/${token}`;
  const name = firstName || 'there';

  try {
    await emailService.sendEmail({
      to: email,
      subject: 'Verify your Ealana account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">Welcome to Ealana!</h2>
          <p>Hi ${name},</p>
          <p>Thanks for signing up. Please verify your email address to get started.</p>
          <p style="margin: 30px 0;">
            <a href="${verifyUrl}"
               style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Verify Email
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            Or copy this link: <a href="${verifyUrl}">${verifyUrl}</a>
          </p>
          <p style="color: #666; font-size: 14px;">
            This link expires in 24 hours.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 12px;">
            If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
      `,
    });
    return true;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return false;
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string) {
  const parts = stored.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid stored password format");
  }
  const [hashed, salt] = parts;
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Role-based access control middleware
export function requireRole(roles: string[]) {
  return (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Authentication check middleware
export function requireAuth(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireVerifiedCandidate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'candidate') {
    res.status(403).json({
      error: 'Candidate access required',
      code: 'INSUFFICIENT_PERMISSIONS',
    });
    return;
  }

  if (!req.user.emailVerified) {
    res.status(403).json({
      error: 'Please verify your email before continuing',
      code: 'EMAIL_NOT_VERIFIED',
      email: req.user.username,
    });
    return;
  }

  next();
}

// Middleware to require an active seat (blocks unseated members)
export function requireSeat(options?: { allowNoOrg?: boolean }) {
  return async (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Skip seat check for non-recruiter roles
    if (req.user.role !== 'recruiter') {
      return next();
    }

    try {
      const allowNoOrg = options?.allowNoOrg ?? false;
      const { getUserOrganization } = await import('./lib/organizationService');
      const orgResult = await getUserOrganization(req.user.id);

      if (!orgResult) {
        if (allowNoOrg) {
          return next();
        }
        // User not in org - block access, require onboarding first
        return res.status(403).json({
          error: 'Organization required',
          code: 'NO_ORGANIZATION',
          message: 'You must create or join an organization to continue.',
        });
      }

      if (!orgResult.membership.seatAssigned) {
        return res.status(403).json({
          error: 'Seat required',
          code: 'NO_SEAT',
          message: 'Your seat has been removed. Contact your organization owner.',
        });
      }

      req.organization = orgResult.organization;
      req.membership = orgResult.membership;
      next();
    } catch (error) {
      console.error('Error checking seat:', error);
      res.status(500).json({ error: 'Failed to verify seat status' });
    }
  };
}

export function setupAuth(app: Express) {
  // Fail fast if SESSION_SECRET is not set in production
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable must be set in production');
  }

  const PostgresSessionStore = connectPg(session);

  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'vantahire-dev-secret',
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax', // CSRF protection
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) {
          return done(null, false);
        }

        // Use secure password comparison for all users (including admin)
        if (!(await comparePasswords(password, user.password))) {
          return done(null, false);
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    const payload = createAuthorizationSessionPayload(user);
    if (!payload) {
      done(new Error("AUTHORIZATION_SESSION_SERIALIZATION_FAILED"));
      return;
    }
    done(null, payload);
  });
  passport.deserializeUser(async (payload: unknown, done) => {
    try {
      const serialized = parseAuthorizationSessionPayload(payload);
      if (!serialized) {
        done(null, false);
        return;
      }
      const user = await storage.getUser(serialized.id);
      if (!user || user.authVersion !== serialized.authVersion) {
        done(null, false);
        return;
      }
      done(null, user);
    } catch {
      done(null, false);
    }
  });

  app.post("/api/register", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        username: usernameInput,
        password,
        firstName,
        lastName,
        role = 'recruiter',
        invitationToken,
        coRecruiterInvitationToken,
        inviteToken,
      } = req.body;
      const username = typeof usernameInput === 'string' ? usernameInput.trim().toLowerCase() : '';

      if (!username || typeof password !== 'string' || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      // Handle invitation flows (hiring manager or co-recruiter)
      let finalRole = role;
      let hiringManagerInvitation = null;
      let coRecruiterInvitation = null;

      if (invitationToken) {
        // Hiring manager invitation flow
        if (typeof invitationToken !== 'string' || invitationToken.length !== 64) {
          res.status(400).json({ error: "Invalid invitation token format" });
          return;
        }

        const tokenHash = hashToken(invitationToken);
        hiringManagerInvitation = await storage.getHiringManagerInvitationByToken(tokenHash);

        if (!hiringManagerInvitation) {
          res.status(400).json({ error: "Invalid invitation token" });
          return;
        }

        // Check if invitation is expired
        if (new Date() > new Date(hiringManagerInvitation.expiresAt)) {
          await storage.invalidateHiringManagerInvitation(hiringManagerInvitation.id);
          res.status(400).json({ error: "Invitation has expired. Please request a new invitation." });
          return;
        }

        // Check if already used
        if (hiringManagerInvitation.status !== 'pending') {
          res.status(400).json({ error: "Invitation has already been used or is no longer valid." });
          return;
        }

        // Verify email matches
        if (username.toLowerCase() !== hiringManagerInvitation.email.toLowerCase()) {
          res.status(400).json({ error: "Email must match the invitation email" });
          return;
        }

        // Force hiring_manager role for invitation flow
        finalRole = 'hiring_manager';
      } else if (coRecruiterInvitationToken) {
        // Co-recruiter invitation flow
        if (typeof coRecruiterInvitationToken !== 'string' || coRecruiterInvitationToken.length !== 64) {
          res.status(400).json({ error: "Invalid invitation token format" });
          return;
        }

        const tokenHash = hashToken(coRecruiterInvitationToken);
        coRecruiterInvitation = await storage.getCoRecruiterInvitationByToken(tokenHash);

        if (!coRecruiterInvitation) {
          res.status(400).json({ error: "Invalid invitation token" });
          return;
        }

        // Check if invitation is expired
        if (new Date() > new Date(coRecruiterInvitation.expiresAt)) {
          await storage.updateCoRecruiterInvitationStatus(coRecruiterInvitation.id, 'expired');
          res.status(400).json({ error: "Invitation has expired. Please request a new invitation." });
          return;
        }

        // Check if already used
        if (coRecruiterInvitation.status !== 'pending') {
          res.status(400).json({ error: "Invitation has already been used or is no longer valid." });
          return;
        }

        // Verify email matches
        if (username.toLowerCase() !== coRecruiterInvitation.email.toLowerCase()) {
          res.status(400).json({ error: "Email must match the invitation email" });
          return;
        }

        // Force recruiter role for co-recruiter invitation flow
        finalRole = 'recruiter';
      } else {
        // Security: Only allow candidate or recruiter roles via public registration
        // super_admin and hiring_manager accounts require invitations or admin creation
        const allowedRoles = ['candidate', 'recruiter'];
        if (!allowedRoles.includes(role)) {
          res.status(403).json({ error: "Invalid role. Public registration only allows 'candidate' or 'recruiter' roles." });
          return;
        }
      }

      // Email format validation (username is used as email for verification)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(username)) {
        res.status(400).json({ error: "Please enter a valid email address" });
        return;
      }

      // Password strength validation
      if (password.length < 10) {
        res.status(400).json({ error: "Password must be at least 10 characters long" });
        return;
      }

      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const hasDigit = /\d/.test(password);
      const hasSpecial = /[^A-Za-z0-9]/.test(password);

      if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
        res.status(400).json({
          error: "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character"
        });
        return;
      }

      // Common password blacklist
      const commonPasswords = ['password', 'qwerty', '12345678', '123456789', '1234567890', 'abc123', 'password123'];
      if (commonPasswords.includes(password.toLowerCase())) {
        res.status(400).json({ error: "Password is too common. Please choose a stronger password" });
        return;
      }

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        res.status(400).json({ error: "An account with this email already exists" });
        return;
      }

      const user = await storage.createUser({
        username,
        password: await hashPassword(password),
        firstName,
        lastName,
        role: finalRole
      });
      queueMauticSignupSync(user.id);

      // Mark invitation as accepted if this was an invitation flow
      if (hiringManagerInvitation) {
        await storage.markHiringManagerInvitationAccepted(hiringManagerInvitation.id);
        console.log(`Hiring manager invitation accepted: ${hiringManagerInvitation.email} registered as user ${user.id}`);
      } else if (coRecruiterInvitation) {
        // Add user to the job's recruiters and mark invitation as accepted
        await storage.addJobRecruiter(coRecruiterInvitation.jobId, user.id, coRecruiterInvitation.invitedBy, coRecruiterInvitation.organizationId ?? undefined);
        await storage.updateCoRecruiterInvitationStatus(coRecruiterInvitation.id, 'accepted');
        console.log(`Co-recruiter invitation accepted: ${coRecruiterInvitation.email} registered as user ${user.id}, added to job ${coRecruiterInvitation.jobId}`);
      }

      // Check if user is registering via a valid organization invite
      // If so, auto-verify them since receiving the invite proves email ownership
      let validOrgInvite = false;
      if (inviteToken) {
        try {
          const orgInvite = await getOrganizationInviteByToken(inviteToken);
          if (orgInvite &&
              new Date() <= orgInvite.expiresAt &&
              orgInvite.email.toLowerCase() === username.toLowerCase()) {
            validOrgInvite = true;
            // Auto-verify user - they proved email ownership by receiving the invite
            await storage.verifyUserEmail(user.id);
            console.log(`Auto-verified user ${user.id} via org invite (invite proves email ownership)`);
          }
        } catch (err) {
          // If invite validation fails, fall through to normal verification flow
          console.log('Org invite validation failed, requiring email verification:', err);
        }
      }

      if (validOrgInvite) {
        // Auto-login since they're verified
        req.login(user, (err) => {
          if (err) {
            console.error('Auto-login failed after org invite registration:', err);
            res.status(201).json({
              message: 'Registration successful. Please log in to continue.',
              requiresVerification: false,
            });
            return;
          }
          res.status(201).json({
            message: 'Registration successful.',
            requiresVerification: false,
            user: {
              id: user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role,
              emailVerified: true,
            },
          });
          queueMauticFirstLoginSync(user.id);
        });
      } else {
        // Normal flow: require email verification
        const { token, hash } = generateVerificationToken();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await storage.setVerificationToken(user.id, hash, expires);

        // Pass inviteToken for organization invites to preserve it through verification flow.
        const emailSent = await sendVerificationEmail(username, token, firstName, inviteToken);
        if (!emailSent) {
          res.status(201).json({
            message: 'Registration successful, but we could not send the verification email right now. Please use "Resend Verification Email" on the login screen.',
            requiresVerification: true,
            emailDeliveryFailed: true,
          });
          return;
        }

        res.status(201).json({
          message: 'Registration successful. Please check your email to verify your account.',
          requiresVerification: true,
        });
      }
    } catch (error) {
      next(error);
    }
  });

  // Login with optional expectedRole gating so the wrong portal cannot be used
  app.post("/api/login", (req: Request, res: Response, next: NextFunction): void => {
    passport.authenticate("local", (err: any, user: SelectUser | false) => {
      if (err) {
        next(err);
        return;
      }
      if (!user) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }

      // Block unverified candidates and recruiters before a session or
      // application claim can be created.
      if ((user.role === 'recruiter' || user.role === 'candidate') && !user.emailVerified) {
        res.status(403).json({
          error: "Please verify your email before logging in",
          code: "EMAIL_NOT_VERIFIED",
          email: user.username,
        });
        return;
      }

      // Optional expectedRole from client (string or array of strings)
      const expected: any = (req.body as any)?.expectedRole;
      if (expected) {
        const expectedRoles = Array.isArray(expected) ? expected : [expected];
        if (!expectedRoles.includes(user.role)) {
          res.status(403).json({ error: "Please use the correct portal for your role" });
          return;
        }
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          next(loginErr);
          return;
        }
        if (user.role === "candidate") {
          req.session.privacyReauthenticatedAt = Date.now();
          req.session.privacyPasswordVersion = privacyPasswordVersion(user.password);
        } else {
          delete req.session.privacyReauthenticatedAt;
          delete req.session.privacyPasswordVersion;
        }
        queueMauticFirstLoginSync(user.id);
        // Link any existing applications (by email) to this user account for proper candidate access
        // Await to ensure immediate visibility on first dashboard load; log but do not fail login
        storage.claimApplicationsForUser(user.id, user.username)
          .then(() => {
            res.status(200).json({
              id: user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role,
              emailVerified: user.emailVerified,
            });
          })
          .catch((e) => {
            console.error('claimApplicationsForUser error:', e);
            res.status(200).json({
              id: user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role,
              emailVerified: user.emailVerified,
            });
          });
        });
    })(req, res, next);
  });

  app.post("/api/logout", (req: Request, res: Response, next: NextFunction): void => {
    delete req.session.privacyReauthenticatedAt;
    delete req.session.privacyPasswordVersion;
    req.logout((err) => {
      if (err) {
        next(err);
        return;
      }
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req: Request, res: Response): void => {
    if (!req.isAuthenticated()) {
      res.sendStatus(401);
      return;
    }
    const user = req.user!;
    res.json({
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
    });
  });

  // Profile completion status endpoint
  app.get("/api/profile-status", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.isAuthenticated()) {
        res.sendStatus(401);
        return;
      }

      const user = req.user!;
      const {
        complete,
        missingRequired,
        missingNiceToHave,
        completionPercent,
      } = await computeProfileCompletion(user);
      const snoozeUntil = user.profilePromptSnoozeUntil;
      const now = new Date();
      const shouldShowPrompt = !complete && (!snoozeUntil || new Date(snoozeUntil) < now);

      res.json({
        complete,
        role: user.role,
        missingRequired,
        missingNiceToHave,
        completionPercent,
        snoozeUntil: snoozeUntil || null,
        shouldShowPrompt,
        profileCompletedAt: user.profileCompletedAt || null,
      });
    } catch (error) {
      next(error);
    }
  });

  // Snooze profile prompt endpoint
  app.post("/api/profile-status/snooze", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.isAuthenticated()) {
        res.sendStatus(401);
        return;
      }

      const user = req.user!;
      const { days = 7 } = req.body;

      // Calculate snooze until date
      const snoozeUntil = new Date();
      snoozeUntil.setDate(snoozeUntil.getDate() + Math.min(days, 30)); // Max 30 days

      await storage.updateUserProfileSnooze(user.id, snoozeUntil);

      res.json({
        success: true,
        snoozeUntil: snoozeUntil.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // Mark profile as completed endpoint
  app.post("/api/profile-status/complete", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.isAuthenticated()) {
        res.sendStatus(401);
        return;
      }

      const user = req.user!;
      await storage.markProfileCompleted(user.id);

      res.json({
        success: true,
        profileCompletedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // Email verification endpoint
  app.get("/api/verify-email/:token", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.params;
      if (!token || token.length !== 64) {
        res.status(400).json({
          error: "Invalid verification token",
          code: "VERIFICATION_TOKEN_INVALID",
        });
        return;
      }

      const tokenHash = hashToken(token);
      const user = await storage.getUserByVerificationToken(tokenHash);

      if (!user) {
        res.status(400).json({
          error: "Invalid verification token. It may already be used or replaced by a newer link.",
          code: "VERIFICATION_TOKEN_INVALID",
        });
        return;
      }

      // Check if token has expired
      if (user.emailVerificationExpires && new Date(user.emailVerificationExpires) < new Date()) {
        res.status(400).json({
          error: "Verification token has expired. Please request a new one.",
          code: "VERIFICATION_TOKEN_EXPIRED",
        });
        return;
      }

      // Verify the email
      await storage.verifyUserEmail(user.id);

      res.json({
        message: "Email verified successfully. You can now log in.",
        verified: true,
        role: user.role,
      });
    } catch (error) {
      next(error);
    }
  });

  // Resend verification email endpoint (rate-limited)
  app.post("/api/resend-verification", resendVerificationLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email: emailInput, inviteToken } = req.body;
      const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
      if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
      }

      const user = await storage.getUserByUsername(email);
      if (!user) {
        // Don't reveal if user exists - always return success message
        res.json({ message: "If an account exists with this email, a verification link has been sent." });
        return;
      }

      if (user.emailVerified) {
        res.json({ message: "Email is already verified. You can log in." });
        return;
      }

      const previousTokenHash = user.emailVerificationToken;
      const previousExpiry = user.emailVerificationExpires ? new Date(user.emailVerificationExpires) : null;

      // Generate new verification token
      const { token, hash } = generateVerificationToken();
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await storage.setVerificationToken(user.id, hash, expires);

      // Send verification email - pass inviteToken to preserve org invite through verification
      const sent = await sendVerificationEmail(email, token, user.firstName, inviteToken);
      if (!sent) {
        // Best effort rollback: don't strand users on an unsent token if an older valid token existed.
        if (previousTokenHash && previousExpiry) {
          await storage.setVerificationToken(user.id, previousTokenHash, previousExpiry);
        }
        res.status(503).json({ error: "Unable to send verification email right now. Please try again later." });
        return;
      }

      res.json({ message: "If an account exists with this email, a verification link has been sent." });
    } catch (error) {
      next(error);
    }
  });

  // Forgot password - request password reset
  app.post("/api/forgot-password", passwordResetLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email: emailInput } = req.body;
      const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
      if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
      }

      // Always respond with success to prevent email enumeration
      const genericResponse = { message: "If an account exists with this email, a password reset link has been sent." };

      const user = await storage.getUserByUsername(email);
      if (!user) {
        res.json(genericResponse);
        return;
      }

      // Generate password reset token
      const { token, hash } = generateVerificationToken();
      const expires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour
      await storage.setPasswordResetToken(user.id, hash, expires);

      // Send password reset email
      const emailService = await getEmailService();
      if (emailService) {
        const baseUrl = getPublicBaseUrl();
        const resetUrl = `${baseUrl}/reset-password/${token}`;
        const name = user.firstName || 'there';

        await emailService.sendEmail({
          to: email,
          subject: 'Reset Your Ealana Password',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #7B38FB;">Reset Your Password</h2>
              <p>Hi ${name},</p>
              <p>We received a request to reset your password. Click the button below to create a new password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background: linear-gradient(to right, #7B38FB, #FF5BA8); color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #666;">${resetUrl}</p>
              <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
              <p style="color: #999; font-size: 12px;">© Ealana - The Neural OS for Talent</p>
            </div>
          `,
          text: `Hi ${name}, Reset your Ealana password by visiting: ${resetUrl} (expires in 1 hour)`,
        });
      }

      res.json(genericResponse);
    } catch (error) {
      next(error);
    }
  });

  // Reset password with token
  app.post("/api/reset-password", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        res.status(400).json({ error: "Token and password are required" });
        return;
      }

      if (token.length !== 64) {
        res.status(400).json({ error: "Invalid reset token" });
        return;
      }

      // Password strength validation
      if (password.length < 10) {
        res.status(400).json({ error: "Password must be at least 10 characters long" });
        return;
      }

      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const hasDigit = /\d/.test(password);
      const hasSpecial = /[^A-Za-z0-9]/.test(password);

      if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
        res.status(400).json({
          error: "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character"
        });
        return;
      }

      // Look up user by token hash
      const hash = hashToken(token);
      const user = await storage.getUserByPasswordResetToken(hash);

      if (!user) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }

      // Check if token has expired
      if (!user.passwordResetExpires || new Date() > user.passwordResetExpires) {
        await storage.clearPasswordResetToken(user.id);
        res.status(400).json({ error: "Reset token has expired. Please request a new password reset." });
        return;
      }

      // Update the credential and its authorization version in one statement.
      const passwordWrite = await resetPasswordAndAdvanceAuthorization(
        user.id,
        await hashPassword(password),
      );
      if (!passwordWrite.ok) {
        res.status(503).json({ error: "Unable to reset password right now. Please try again later." });
        return;
      }

      // Token clearing remains a separately tracked lifecycle boundary (F256).
      try {
        await storage.clearPasswordResetToken(user.id);
      } catch {
        res.status(503).json({ error: "Unable to complete password reset right now. Please try again later." });
        return;
      }

      res.json({ message: "Password has been reset successfully. You can now log in with your new password." });
    } catch (error) {
      next(error);
    }
  });
}
