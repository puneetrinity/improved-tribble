/**
 * WhatsApp Routes Module
 *
 * All WhatsApp communication endpoints:
 * - WhatsApp templates (/api/whatsapp/templates)
 * - WhatsApp message history (/api/applications/:id/whatsapp-history)
 * - Manual WhatsApp send (/api/applications/:id/send-whatsapp)
 * - Webhook handlers (/api/webhooks/whatsapp)
 */

import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { storage } from './storage';
import { requireRole } from './auth';
import { whatsappTemplates, whatsappAuditLog } from '@shared/schema';
import { queueMauticOutreachSync } from './lib/mauticService';
import {
  sendWhatsAppTemplatedMessage,
  getAllWhatsAppTemplates,
} from './whatsappTemplateService';
import { getWhatsAppService } from './whatsappService';
import type { CsrfMiddleware } from './types/routes';

// Validation schemas
const sendWhatsAppSchema = z.object({
  templateId: z.number().int().positive(),
  customizations: z.record(z.string()).optional(),
});

/**
 * Validate webhook signature from Meta
 */
function validateWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const signature = req.headers['x-hub-signature-256'] as string;
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  // Skip validation if no secret configured (test mode)
  if (!appSecret) {
    console.warn('[WhatsApp Webhook] No APP_SECRET configured, skipping signature validation');
    next();
    return;
  }

  if (!signature) {
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', appSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

  if (signature !== expectedSignature) {
    console.error('[WhatsApp Webhook] Invalid signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

/**
 * Register all WhatsApp-related routes
 */
export function registerWhatsAppRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware
): void {
  // ============= WEBHOOK ROUTES (No CSRF - called by Meta) =============

  // Webhook verification (GET)
  // Meta sends verification challenge during webhook setup
  app.get('/api/webhooks/whatsapp', (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'] as string;
    const token = req.query['hub.verify_token'] as string;
    const challenge = req.query['hub.challenge'] as string;

    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[WhatsApp Webhook] Verification successful');
      res.status(200).send(challenge);
      return;
    }

    console.warn('[WhatsApp Webhook] Verification failed');
    res.status(403).json({ error: 'Verification failed' });
  });

  // Webhook events (POST)
  // Receives message status updates and incoming messages
  app.post(
    '/api/webhooks/whatsapp',
    validateWebhookSignature,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body as {
          object?: string;
          entry?: Array<{
            changes?: Array<{
              value?: {
                statuses?: Array<{
                  id: string;
                  status: string;
                  timestamp: string;
                }>;
                messages?: Array<{
                  id: string;
                  from: string;
                  text?: { body: string };
                  type: string;
                }>;
              };
            }>;
          }>;
        };

        // Always respond quickly
        res.status(200).json({ status: 'received' });

        // Process webhook asynchronously
        if (body.object !== 'whatsapp_business_account') {
          return;
        }

        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value;
            if (!value) continue;

            // Process status updates
            if (value.statuses) {
              for (const statusUpdate of value.statuses) {
                console.log(
                  `[WhatsApp Webhook] Status update: ${statusUpdate.id} -> ${statusUpdate.status}`
                );

                // Update audit log
                const updates: { status?: string; deliveredAt?: Date; readAt?: Date } = {};

                if (statusUpdate.status === 'delivered') {
                  updates.status = 'delivered';
                  updates.deliveredAt = new Date(parseInt(statusUpdate.timestamp) * 1000);
                } else if (statusUpdate.status === 'read') {
                  updates.status = 'read';
                  updates.readAt = new Date(parseInt(statusUpdate.timestamp) * 1000);
                } else if (statusUpdate.status === 'failed') {
                  updates.status = 'failed';
                }

                if (Object.keys(updates).length > 0) {
                  await db
                    .update(whatsappAuditLog)
                    .set(updates)
                    .where(eq(whatsappAuditLog.messageId, statusUpdate.id));
                }
              }
            }

            // Log incoming messages (for future use)
            if (value.messages) {
              for (const message of value.messages) {
                console.log(
                  `[WhatsApp Webhook] Incoming message from ${message.from}: ${message.text?.body || message.type}`
                );
              }
            }
          }
        }
      } catch (error) {
        console.error('[WhatsApp Webhook] Error processing webhook:', error);
      }
    }
  );

  // ============= TEMPLATE ROUTES =============

  // Get all WhatsApp templates
  app.get(
    '/api/whatsapp/templates',
    requireRole(['recruiter', 'super_admin']),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const templates = await getAllWhatsAppTemplates();
        res.json(templates);
      } catch (e) {
        next(e);
      }
    }
  );

  // ============= MESSAGE HISTORY ROUTES =============

  // Get WhatsApp message history for an application
  app.get(
    '/api/applications/:id/whatsapp-history',
    requireRole(['recruiter', 'super_admin']),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing ID parameter' });
          return;
        }

        const appId = Number(idParam);
        if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
          res.status(400).json({ error: 'Invalid ID parameter' });
          return;
        }

        // Verify application exists
        const application = await storage.getApplication(appId);
        if (!application) {
          res.status(404).json({ error: 'Application not found' });
          return;
        }

        // Get WhatsApp history
        const history = await db.query.whatsappAuditLog.findMany({
          where: eq(whatsappAuditLog.applicationId, appId),
          with: {
            template: true,
          },
          orderBy: [desc(whatsappAuditLog.sentAt)],
        });

        res.json(history);
      } catch (e) {
        next(e);
      }
    }
  );

  // ============= MANUAL SEND ROUTES =============

  // Send WhatsApp message using template
  app.post(
    '/api/applications/:id/send-whatsapp',
    csrfProtection,
    requireRole(['recruiter', 'super_admin']),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const idParam = req.params.id;
        if (!idParam) {
          res.status(400).json({ error: 'Missing ID parameter' });
          return;
        }

        const appId = Number(idParam);
        if (!Number.isFinite(appId) || appId <= 0 || !Number.isInteger(appId)) {
          res.status(400).json({ error: 'Invalid ID parameter' });
          return;
        }

        // Validate request body
        const parsed = sendWhatsAppSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Validation error', details: parsed.error.errors });
          return;
        }

        const { templateId, customizations } = parsed.data;

        // Verify application exists
        const application = await storage.getApplication(appId);
        if (!application) {
          res.status(404).json({ error: 'Application not found' });
          return;
        }

        // Verify template exists
        const template = await db.query.whatsappTemplates.findFirst({
          where: eq(whatsappTemplates.id, templateId),
        });
        if (!template) {
          res.status(404).json({ error: 'Template not found' });
          return;
        }

        // Send message
        await sendWhatsAppTemplatedMessage(appId, templateId, customizations || {});
        queueMauticOutreachSync(req.user!.id, application.organizationId ?? null, 'whatsapp');

        res.json({ success: true });
      } catch (e) {
        next(e);
      }
    }
  );

  // ============= STATUS ROUTES =============

  // Get WhatsApp configuration status
  app.get(
    '/api/whatsapp/status',
    requireRole(['super_admin']),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const enabled = process.env.WHATSAPP_ENABLED === 'true' || process.env.WHATSAPP_ENABLED === '1';
        const provider = process.env.WHATSAPP_PROVIDER || 'test';
        const hasAccessToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
        const hasPhoneNumberId = !!process.env.WHATSAPP_PHONE_NUMBER_ID;

        // Get template counts
        const templates = await getAllWhatsAppTemplates();
        const approvedCount = templates.filter((t) => t.status === 'approved').length;
        const pendingCount = templates.filter((t) => t.status === 'pending').length;

        res.json({
          enabled,
          provider,
          configured: provider === 'test' || (hasAccessToken && hasPhoneNumberId),
          templates: {
            total: templates.length,
            approved: approvedCount,
            pending: pendingCount,
          },
        });
      } catch (e) {
        next(e);
      }
    }
  );

  console.log('✅ WhatsApp routes registered');
}
