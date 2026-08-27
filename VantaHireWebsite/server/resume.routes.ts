import type { Express, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { requireRole, requireAuth, requireSeat } from './auth';
import {
  parsePositiveDecimalApplicationId,
  readAuthorizedApplicationResumeText,
} from './lib/applicationReadAuthorization';
import { storage, type ResumeAccessActorRole, type ResumeAccessTerminalStatus } from './storage';

async function terminalizeTextAttempt(input: {
  attemptId: string;
  status: ResumeAccessTerminalStatus;
  responseStatus: number;
  failureCode?: string | null;
}): Promise<boolean> {
  try {
    return await storage.terminalizeResumeAccessAttempt({
      ...input,
      failureCode: input.failureCode ?? null,
      updateLegacyDownloadedAt: false,
    });
  } catch {
    return false;
  }
}

function bindTextResponseTerminal(res: Response, attemptId: string): void {
  let terminalScheduled = false;
  const settle = (status: ResumeAccessTerminalStatus, responseStatus: number, failureCode?: string) => {
    if (terminalScheduled) return;
    terminalScheduled = true;
    void terminalizeTextAttempt({
      attemptId,
      status,
      responseStatus,
      ...(failureCode === undefined ? {} : { failureCode }),
    });
  };
  res.once('finish', () => settle('completed', 200));
  res.once('close', () => {
    if (!res.writableFinished) settle('failed', 499, 'RESPONSE_CLOSED');
  });
}

export function registerResumeRoutes(app: Express): void {
  // GET /api/applications/:id/resume-text
  // Authenticated recruiters/super_admin; returns extracted resume text if available.
  app.get(
    '/api/applications/:id/resume-text',
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
      const applicationId = parsePositiveDecimalApplicationId(req.params.id);
      if (applicationId === null) {
        res.status(400).json({ code: 'INVALID_APPLICATION_ID' });
        return;
      }

      const authorized = await readAuthorizedApplicationResumeText(
        req.user!.id,
        applicationId,
        { allowPlatformAdmin: true },
      );
      if (!authorized.ok) {
        if (authorized.reason === 'not_found') {
          res.status(404).json({ error: 'Application not found', code: 'APPLICATION_NOT_FOUND' });
        } else {
          res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
        }
        return;
      }

      const actorRole = req.user!.role as ResumeAccessActorRole;
      const attemptId = randomUUID();
      let auditReady = false;
      try {
        auditReady = await storage.createResumeAccessAttempt({
          attemptId,
          applicationId: authorized.resume.applicationId,
          organizationId: authorized.resume.organizationId,
          actorUserId: req.user!.id,
          actorRole,
          deliveryMode: authorized.resume.text ? 'stored_text' : 'missing',
        });
      } catch {
        auditReady = false;
      }
      if (!auditReady) {
        res.status(503).json({ code: 'AUDIT_UNAVAILABLE' });
        return;
      }

      if (!authorized.resume.text) {
        const terminal = await terminalizeTextAttempt({
          attemptId,
          status: 'failed',
          responseStatus: 404,
          failureCode: 'RESUME_TEXT_MISSING',
        });
        if (!terminal) {
          res.status(503).json({ code: 'AUDIT_UNAVAILABLE' });
          return;
        }
        res.status(404).json({ code: 'RESUME_TEXT_NOT_AVAILABLE' });
        return;
      }

      bindTextResponseTerminal(res, attemptId);
      res.status(200).json({ text: authorized.resume.text });
    }
  );
}
