/**
 * Hiring Manager Invitations Routes
 *
 * Endpoints for inviting hiring managers via email:
 * - POST /api/hiring-manager-invitations - Create & send invitation
 * - GET /api/hiring-manager-invitations - List pending invitations
 * - DELETE /api/hiring-manager-invitations/:id - Cancel invitation
 * - GET /api/hiring-manager-invitations/validate/:token - Validate token (public)
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { storage } from './storage';
import { requireRole, requireSeat } from './auth';
import { getEmailService } from './simpleEmailService';
import { insertHiringManagerInvitationSchema } from '@shared/schema';
import type { CsrfMiddleware } from './types/routes';
import rateLimit from 'express-rate-limit';
import {
  cancelAuthorizedHiringManagerInvitation,
  listAuthorizedHiringManagerInvitations,
  parseReviewerShareId,
  replaceAuthorizedHiringManagerInvitation,
  resolveInvitationIssuerScope,
} from './lib/reviewerShareAuthorization';

// Rate limiting for invitation creation (10 per hour per user)
const invitationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many invitations sent. Please try again later.' },
  keyGenerator: (req: Request) => `hm-invite-${req.user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
});

// Constants
const INVITATION_EXPIRY_DAYS = 7;
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

// Hash token for storage (SHA256)
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Generate secure random token
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

// Build invitation email HTML
function buildInvitationEmail(opts: {
  inviterName: string;
  inviteeName?: string;
  token: string;
}): { subject: string; html: string; text: string } {
  const inviteUrl = `${BASE_URL}/register-hiring-manager/${opts.token}`;
  const greeting = opts.inviteeName ? `Hi ${opts.inviteeName},` : 'Hi,';

  const subject = `You're invited to join VantaHire as a Hiring Manager`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #7B38FB; margin-bottom: 24px;">You're Invited to VantaHire</h2>
      <p style="margin-bottom: 16px;">${greeting}</p>
      <p style="margin-bottom: 16px;"><strong>${opts.inviterName}</strong> has invited you to join VantaHire as a Hiring Manager.</p>
      <p style="margin-bottom: 16px;">As a Hiring Manager, you'll be able to:</p>
      <ul style="margin-bottom: 24px; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Review candidates for assigned job positions</li>
        <li style="margin-bottom: 8px;">Provide feedback and recommendations</li>
        <li style="margin-bottom: 8px;">Collaborate with recruiters on hiring decisions</li>
      </ul>
      <p style="margin: 30px 0; text-align: center;">
        <a href="${inviteUrl}" style="background: linear-gradient(to right, #7B38FB, #FF5BA8);
           color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px;
           display: inline-block; font-weight: bold;">
          Accept Invitation
        </a>
      </p>
      <p style="color: #666; font-size: 14px; margin-top: 32px;">
        This invitation expires in ${INVITATION_EXPIRY_DAYS} days.
      </p>
      <p style="color: #666; font-size: 14px;">
        If you didn't expect this invitation, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">
        VantaHire - Modern Recruiting Platform
      </p>
    </div>
  `;

  const text = `
You're Invited to VantaHire

${greeting}

${opts.inviterName} has invited you to join VantaHire as a Hiring Manager.

As a Hiring Manager, you'll be able to:
- Review candidates for assigned job positions
- Provide feedback and recommendations
- Collaborate with recruiters on hiring decisions

Accept your invitation here: ${inviteUrl}

This invitation expires in ${INVITATION_EXPIRY_DAYS} days.

If you didn't expect this invitation, you can safely ignore this email.
  `.trim();

  return { subject, html, text };
}

/**
 * Register hiring manager invitation routes
 */
export function registerHiringManagerInvitationRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware
): void {
  // ============= CREATE INVITATION =============
  app.post(
    "/api/hiring-manager-invitations",
    csrfProtection,
    invitationRateLimit,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // Validate request body
        const body = insertHiringManagerInvitationSchema.parse(req.body);
        const email = body.email.toLowerCase();

        const issuer = await resolveInvitationIssuerScope(
          req.user!.id,
          { allowPlatformAdmin: true },
        );
        if (!issuer.ok) {
          const status = issuer.reason === 'unavailable' ? 503 : 404;
          res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'INVITATION_NOT_FOUND' });
          return;
        }

        // Check if user with this email already exists
        const existingUser = await storage.getUserByUsername(email);
        if (existingUser) {
          // Send alternate email to help existing users (prevents enumeration + helps users)
          const emailService = await getEmailService();
          if (emailService) {
            await emailService.sendEmail({
              to: email,
              subject: 'VantaHire - You Already Have an Account',
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #7B38FB;">You Already Have a VantaHire Account</h2>
                  <p>Hi,</p>
                  <p>Someone tried to invite you to VantaHire as a Hiring Manager, but you already have an account.</p>
                  <p>Please <a href="${BASE_URL}/recruiter-auth" style="color: #7B38FB;">sign in here</a> to access your account.</p>
                  <p style="color: #666; font-size: 14px; margin-top: 24px;">
                    If you didn't expect this email, you can safely ignore it.
                  </p>
                </div>
              `,
              text: `You already have a VantaHire account. Please sign in at ${BASE_URL}/recruiter-auth`,
            });
          }
          res.json({
            success: true,
            message: 'If this email is not already registered, an invitation will be sent.',
          });
          return;
        }

        // Generate token
        const token = generateToken();
        const tokenHash = hashToken(token);

        // Calculate expiry
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

        const invitation = await replaceAuthorizedHiringManagerInvitation(
          issuer.value,
          email,
          body.name ?? null,
          tokenHash,
          expiresAt,
        );
        if (!invitation.ok) {
          const status = invitation.reason === 'unavailable' ? 503 : 404;
          res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'INVITATION_NOT_FOUND' });
          return;
        }

        // Send email
        const emailService = await getEmailService();
        if (emailService) {
          const emailData: {
            inviterName: string;
            inviteeName?: string;
            token: string;
          } = {
            inviterName: issuer.value.inviterName,
            token, // Send plaintext token in email
          };
          if (body.name) {
            emailData.inviteeName = body.name;
          }
          const emailContent = buildInvitationEmail(emailData);

          const sent = await emailService.sendEmail({
            to: email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          });

          if (!sent) {
            console.error('Hiring manager invitation email delivery failed');
          }
        } else {
          console.warn('Email service not available. Invitation created but email not sent.');
        }

        res.status(201).json({
          success: true,
          message: 'Invitation sent successfully.',
          invitation: {
            id: invitation.value.id,
            email: invitation.value.email,
            name: invitation.value.name,
            status: invitation.value.status,
            expiresAt: invitation.value.expiresAt,
            createdAt: invitation.value.createdAt,
          },
        });
        return;
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({
            error: 'Validation error',
            details: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          });
          return;
        }
        next(error);
      }
    }
  );

  // ============= LIST PENDING INVITATIONS =============
  app.get(
    "/api/hiring-manager-invitations",
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const issuer = await resolveInvitationIssuerScope(req.user!.id, { allowPlatformAdmin: true });
        if (!issuer.ok) {
          const status = issuer.reason === 'unavailable' ? 503 : 404;
          res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'INVITATION_NOT_FOUND' });
          return;
        }
        const invitations = await listAuthorizedHiringManagerInvitations(issuer.value);
        if (!invitations.ok) {
          res.status(503).json({ error: 'AUTHORIZATION_UNAVAILABLE' });
          return;
        }
        res.json(invitations.rows);
        return;
      } catch (error) {
        next(error);
      }
    }
  );

  // ============= CANCEL INVITATION =============
  app.delete(
    "/api/hiring-manager-invitations/:id",
    csrfProtection,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const id = parseReviewerShareId(req.params.id);
        if (!id) {
          res.status(400).json({ error: 'INVALID_INVITATION_ID' });
          return;
        }
        const issuer = await resolveInvitationIssuerScope(req.user!.id, { allowPlatformAdmin: true });
        if (!issuer.ok) {
          const status = issuer.reason === 'unavailable' ? 503 : 404;
          res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'INVITATION_NOT_FOUND' });
          return;
        }
        const deleted = await cancelAuthorizedHiringManagerInvitation(issuer.value, id);
        if (!deleted.ok) {
          const status = deleted.reason === 'unavailable' ? 503 : 404;
          res.status(status).json({ error: status === 503 ? 'AUTHORIZATION_UNAVAILABLE' : 'INVITATION_NOT_FOUND' });
          return;
        }

        res.json({ success: true, message: 'Invitation cancelled' });
        return;
      } catch (error) {
        next(error);
      }
    }
  );

  // ============= VALIDATE TOKEN (PUBLIC) =============
  app.get(
    "/api/hiring-manager-invitations/validate/:token",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { token } = req.params;
        if (!token || token.length !== 64) {
          res.status(400).json({ valid: false, error: 'Invalid token format' });
          return;
        }

        const tokenHash = hashToken(token);
        const invitation = await storage.getHiringManagerInvitationByToken(tokenHash);

        if (!invitation) {
          res.status(404).json({ valid: false, error: 'Invitation not found' });
          return;
        }

        // Check if expired
        if (new Date() > new Date(invitation.expiresAt)) {
          // Mark as expired
          await storage.invalidateHiringManagerInvitation(invitation.id);
          res.status(410).json({ valid: false, error: 'Invitation has expired' });
          return;
        }

        // Check if already accepted
        if (invitation.status === 'accepted') {
          res.status(410).json({ valid: false, error: 'Invitation has already been used' });
          return;
        }

        // Check if explicitly expired/cancelled
        if (invitation.status === 'expired') {
          res.status(410).json({ valid: false, error: 'Invitation is no longer valid' });
          return;
        }

        res.json({
          valid: true,
          email: invitation.email,
          name: invitation.name,
        });
        return;
      } catch (error) {
        next(error);
      }
    }
  );
}
