import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from './db';
import { candidateResumes, applications } from '@shared/schema';
import { requireRole, requireAuth } from './auth';
import { downloadFromGCS } from './gcs-storage';
import { extractResumeText, validateResumeText } from './lib/resumeExtractor';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from './candidate-privacy/decision';

const resumeTextParams = z.object({ id: z.coerce.number().int().positive() });

export function registerResumeRoutes(app: Express): void {
  // GET /api/applications/:id/resume-text
  // Authenticated recruiters/super_admin; returns extracted resume text if available.
  app.get(
    '/api/applications/:id/resume-text',
    requireAuth,
    requireRole(['recruiter', 'super_admin']),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parse = resumeTextParams.safeParse(req.params);
        if (!parse.success) {
          res.status(400).json({ error: 'Invalid application id' });
          return;
        }
        const applicationId = parse.data.id;

        await requireCandidatePrivacyAllowed(
          { type: 'application', id: applicationId },
          { globalUse: false },
        );

        const application = await db.query.applications.findFirst({
          where: (apps: typeof applications, { eq }: any) => eq(apps.id, applicationId),
        });
        if (!application) {
          res.status(404).json({ error: 'Application not found' });
          return;
        }

        let resumeText = '';

        if (application.extractedResumeText) {
          resumeText = application.extractedResumeText;
        } else if (application.resumeId) {
          const resumeData = await db.query.candidateResumes.findFirst({
            where: (resumes: typeof candidateResumes, { eq }: any) => eq(resumes.id, application.resumeId),
          });
          resumeText = resumeData?.extractedText || '';
        }

        // Fallback: download from GCS and extract on the fly if text missing
        if (!resumeText && application.resumeUrl && application.resumeUrl.startsWith('gs://')) {
          try {
            await requireCandidatePrivacyAllowed(
              { type: 'application', id: applicationId },
              { globalUse: false },
            );
            const buffer = await downloadFromGCS(application.resumeUrl);
            const extraction = await extractResumeText(buffer);
            if (extraction.success && validateResumeText(extraction.text)) {
              resumeText = extraction.text;
            }
          } catch (err) {
            console.error('[Resume Text] Extract fallback failed:', err);
          }
        }

        if (!resumeText) {
          res.status(404).json({ error: 'Resume text not available' });
          return;
        }

        res.json({ text: resumeText });
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(404).json({ code: 'candidate_privacy_restricted' });
          return;
        }
        next(error);
      }
    }
  );
}
