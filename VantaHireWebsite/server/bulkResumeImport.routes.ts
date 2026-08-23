import type { Express, Request, Response, NextFunction } from 'express';
import type { Multer } from 'multer';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'crypto';
import { db } from './db';
import { storage } from './storage';
import { requireRole, requireSeat } from './auth';
import { getUserOrganization } from './lib/organizationService';
import { type InsertResumeImportItem, type ResumeImportItem } from '@shared/schema';
import { downloadFromGCS, uploadToGCS } from './gcs-storage';
import { recruiterAddRateLimit } from './rateLimit';
import type { CsrfMiddleware } from './types/routes';
import {
  assessResumeImportItem,
  canFinalizeResumeImportItem,
  extractResumeFields,
  isPlausibleCandidateName,
  normalizePhone,
} from './lib/resumeImportFieldExtraction';
import { MIN_RESUME_TEXT_LENGTH } from './lib/applicationGraphSyncProcessor';
import { extractResumeTextRaw } from './lib/resumeExtractor';
import { extractResumeTextWithFallback } from './lib/resumeImportExtraction';
import { extractStructuredResumeFieldsWithGroq, isGroqAdvancedExtractionEnabled } from './lib/resumeImportAiExtraction';
import { resolveActiveKGTenantId } from './lib/activekgTenant';
import { pickInitialPipelineStage } from './lib/pipelineStageSelection';
import {
  finalizeResumeImportItemInTransaction,
  type FinalizeResumeImportItemResult,
} from './lib/resumeImportFinalize';
import {
  CandidatePrivacyRestrictedError,
  requireNewCandidateIdentityAllowed,
} from './candidate-privacy/decision';

const patchResumeImportItemSchema = z.object({
  parsedName: z.string().trim().min(1).max(100).optional().nullable(),
  parsedEmail: z.string().email().optional().nullable(),
  parsedPhone: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    return normalizePhone(String(value));
  }, z.string().regex(/^\d{10}$/).optional().nullable()),
});

const finalizeResumeImportSchema = z.object({
  itemIds: z.array(z.number().int().positive()).max(200).optional(),
});

function isBulkResumeImportEnabled(): boolean {
  return process.env.BULK_RESUME_IMPORT_ENABLED === 'true';
}

function getMaxBulkResumeFiles(): number {
  const configured = parseInt(process.env.BULK_RESUME_IMPORT_MAX_FILES || '10', 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 10;
  }
  return Math.min(configured, 25);
}

async function requireRecruiterJobAccess(req: Request, res: Response): Promise<{
  jobId: number;
  organizationId: number;
} | null> {
  const idParam = req.params.id;
  if (!idParam) {
    res.status(400).json({ error: 'Missing ID parameter' });
    return null;
  }

  const jobId = Number(idParam);
  if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isInteger(jobId)) {
    res.status(400).json({ error: 'Invalid ID parameter' });
    return null;
  }

  const job = await storage.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return null;
  }

  if (!job.organizationId) {
    res.status(400).json({ error: 'Bulk resume import requires an organization-scoped job' });
    return null;
  }

  const orgResult = await getUserOrganization(req.user!.id);
  const userOrgId = orgResult?.organization.id;
  const hasAccess = await storage.isRecruiterOnJob(jobId, req.user!.id, userOrgId);
  if (!hasAccess) {
    res.status(403).json({ error: 'Access denied: You can only bulk import resumes to your own jobs' });
    return null;
  }

  return {
    jobId,
    organizationId: job.organizationId,
  };
}

async function enqueueGraphSyncIfEligible(application: {
  id: number;
  organizationId: number | null;
  jobId: number;
  extractedResumeText: string | null;
}, effectiveRecruiterId: number): Promise<void> {
  if (process.env.ACTIVEKG_SYNC_ENABLED !== 'true' || !application.organizationId) {
    return;
  }

  const hasValidResumeText = application.extractedResumeText &&
    application.extractedResumeText.trim().length >= MIN_RESUME_TEXT_LENGTH;

  if (!hasValidResumeText) {
    await storage.updateApplicationSyncSkippedReason(
      application.id,
      !application.extractedResumeText ? 'resume_text_missing' : 'resume_text_below_threshold',
    );
    return;
  }

  const tenantId = resolveActiveKGTenantId(application.organizationId);
  await storage.enqueueApplicationGraphSyncJob({
    applicationId: application.id,
    organizationId: application.organizationId,
    jobId: application.jobId,
    effectiveRecruiterId,
    activekgTenantId: tenantId,
  });
}

function buildReviewSummary(item: ResumeImportItem): string | null {
  const assessment = assessResumeImportItem(
    {
      name: item.parsedName,
      email: item.parsedEmail,
      phone: item.parsedPhone,
    },
    item.extractedText,
  );
  return assessment.errorReason;
}

function normalizeAdvancedEmail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return z.string().email().safeParse(normalized).success ? normalized : null;
}

function pickMergedName(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const trimmed = value.trim();
    if (isPlausibleCandidateName(trimmed)) {
      return trimmed;
    }
  }

  return null;
}

function pickMergedEmail(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeAdvancedEmail(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function pickMergedPhone(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizePhone(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function registerBulkResumeImportRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware,
  upload: Multer,
): void {
  app.post(
    '/api/jobs/:id/bulk-resume-import',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    recruiterAddRateLimit,
    csrfProtection,
    upload.array('resumes', getMaxBulkResumeFiles()),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!isBulkResumeImportEnabled()) {
          res.status(404).json({ error: 'Bulk resume import is not enabled' });
          return;
        }

        const access = await requireRecruiterJobAccess(req, res);
        if (!access) {
          return;
        }

        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (files.length === 0) {
          res.status(400).json({ error: 'At least one resume file is required' });
          return;
        }

        // Bulk upload has no caller-supplied candidate identity. Extract only
        // local/native text first, derive a deterministic identity, and check
        // Memory before creating the batch, uploading to GCS, or queueing. A
        // scan that would require provider OCR is review-required rather than
        // sent to a provider before its identity is known.
        const preflightFields = new Map<string, ReturnType<typeof extractResumeFields>>();
        for (const file of files) {
          const rawExtraction = await extractResumeTextRaw(file.buffer);
          const fields = rawExtraction.success
            ? extractResumeFields(rawExtraction.text)
            : { name: null, email: null, phone: null };
          const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
          if (fields.email?.trim()) {
            identifiers.push({ identifier_type: 'email', value: fields.email.trim().toLowerCase() });
          }
          if (fields.phone?.trim()) {
            identifiers.push({ identifier_type: 'phone', value: fields.phone.trim() });
          }
          if (identifiers.length === 0) {
            throw new CandidatePrivacyRestrictedError('candidate_privacy_review_required');
          }
          await requireNewCandidateIdentityAllowed(identifiers);
          preflightFields.set(createHash('sha256').update(file.buffer).digest('hex'), fields);
        }

        const batch = await storage.createResumeImportBatch({
          organizationId: access.organizationId,
          jobId: access.jobId,
          uploadedByUserId: req.user!.id,
          status: 'queued',
          fileCount: files.length,
          processedCount: 0,
          readyCount: 0,
          needsReviewCount: 0,
          failedCount: 0,
        });

        const seenHashes = new Map<string, string>();
        const items: InsertResumeImportItem[] = [];

        for (const file of files) {
          const contentHash = createHash('sha256').update(file.buffer).digest('hex');
          const privacyCheckedFields = preflightFields.get(contentHash)!;
          const duplicatePath = seenHashes.get(contentHash);

          if (duplicatePath) {
            items.push({
              batchId: batch.id,
              organizationId: access.organizationId,
              jobId: access.jobId,
              uploadedByUserId: req.user!.id,
              originalFilename: file.originalname,
              gcsPath: duplicatePath,
              contentHash,
              extractionMethod: 'failed',
              status: 'duplicate',
              errorReason: 'Duplicate file detected in this batch',
              sourceMetadata: {
                fileSize: file.size,
                mimeType: file.mimetype,
                duplicateOfHash: contentHash,
              },
              parsedName: privacyCheckedFields.name,
              parsedEmail: privacyCheckedFields.email,
              parsedPhone: privacyCheckedFields.phone,
            });
            continue;
          }

          try {
            const gcsPath = await uploadToGCS(file.buffer, file.originalname);
            seenHashes.set(contentHash, gcsPath);
            items.push({
              batchId: batch.id,
              organizationId: access.organizationId,
              jobId: access.jobId,
              uploadedByUserId: req.user!.id,
              originalFilename: file.originalname,
              gcsPath,
              contentHash,
              extractionMethod: 'failed',
              status: 'queued',
              sourceMetadata: {
                fileSize: file.size,
                mimeType: file.mimetype,
              },
              parsedName: privacyCheckedFields.name,
              parsedEmail: privacyCheckedFields.email,
              parsedPhone: privacyCheckedFields.phone,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            items.push({
              batchId: batch.id,
              organizationId: access.organizationId,
              jobId: access.jobId,
              uploadedByUserId: req.user!.id,
              originalFilename: file.originalname,
              gcsPath: null,
              contentHash,
              extractionMethod: 'failed',
              status: 'failed',
              errorReason: message,
              sourceMetadata: {
                fileSize: file.size,
                mimeType: file.mimetype,
              },
            });
          }
        }

        const createdItems = await storage.createResumeImportItems(items);
        const refreshedBatch = await storage.refreshResumeImportBatchStats(batch.id);

        res.status(201).json({
          batch: refreshedBatch ?? batch,
          items: createdItems,
        });
        return;
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        next(error);
      }
    },
  );

  app.get(
    '/api/jobs/:id/bulk-resume-import/:batchId',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!isBulkResumeImportEnabled()) {
          res.status(404).json({ error: 'Bulk resume import is not enabled' });
          return;
        }

        const access = await requireRecruiterJobAccess(req, res);
        if (!access) {
          return;
        }

        const batchId = Number(req.params.batchId);
        if (!Number.isFinite(batchId) || batchId <= 0 || !Number.isInteger(batchId)) {
          res.status(400).json({ error: 'Invalid batch ID' });
          return;
        }

        const batch = await storage.getResumeImportBatch(batchId);
        if (!batch || batch.jobId !== access.jobId || batch.organizationId !== access.organizationId) {
          res.status(404).json({ error: 'Import batch not found' });
          return;
        }

        const items = await storage.getResumeImportItemsByBatch(batchId);

        res.json({
          batch,
          items: items.map((item) => ({
            ...item,
            canFinalize: canFinalizeResumeImportItem(
              {
                name: item.parsedName,
                email: item.parsedEmail,
                phone: item.parsedPhone,
              },
              item.gcsPath,
              item.extractedText,
            ),
            reviewSummary: buildReviewSummary(item),
          })),
        });
        return;
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    '/api/jobs/:id/bulk-resume-import/items/:itemId',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!isBulkResumeImportEnabled()) {
          res.status(404).json({ error: 'Bulk resume import is not enabled' });
          return;
        }

        const access = await requireRecruiterJobAccess(req, res);
        if (!access) {
          return;
        }

        const itemId = Number(req.params.itemId);
        if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isInteger(itemId)) {
          res.status(400).json({ error: 'Invalid item ID' });
          return;
        }

        const item = await storage.getResumeImportItem(itemId);
        if (!item || item.jobId !== access.jobId || item.organizationId !== access.organizationId) {
          res.status(404).json({ error: 'Import item not found' });
          return;
        }

        if (item.status === 'finalized') {
          res.status(400).json({ error: 'Finalized import items cannot be edited' });
          return;
        }

        const parsed = patchResumeImportItemSchema.parse(req.body);
        const nextFields = {
          name: parsed.parsedName === undefined ? item.parsedName : parsed.parsedName,
          email: parsed.parsedEmail === undefined ? item.parsedEmail : parsed.parsedEmail?.toLowerCase() ?? null,
          phone: parsed.parsedPhone === undefined ? item.parsedPhone : parsed.parsedPhone,
        };

        if (nextFields.email || nextFields.phone) {
          const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
          if (nextFields.email) identifiers.push({ identifier_type: 'email', value: nextFields.email });
          if (nextFields.phone) identifiers.push({ identifier_type: 'phone', value: nextFields.phone });
          await requireNewCandidateIdentityAllowed(identifiers);
        } else {
          throw new CandidatePrivacyRestrictedError('candidate_privacy_review_required');
        }

        if (nextFields.email) {
          const existingApplication = await storage.findApplicationByJobAndEmail(item.jobId, nextFields.email);
          if (existingApplication && existingApplication.id !== item.applicationId) {
            const duplicate = await storage.updateResumeImportItem(item.id, {
              parsedName: nextFields.name,
              parsedEmail: nextFields.email,
              parsedPhone: nextFields.phone,
              status: 'duplicate',
              errorReason: `Application with ${nextFields.email} already exists for this job`,
              applicationId: existingApplication.id,
            });
            res.json({ item: duplicate });
            return;
          }

          const duplicateItem = await storage.findDuplicateResumeImportItemByEmail(item.batchId, nextFields.email, item.id);
          if (duplicateItem) {
            const duplicate = await storage.updateResumeImportItem(item.id, {
              parsedName: nextFields.name,
              parsedEmail: nextFields.email,
              parsedPhone: nextFields.phone,
              status: 'duplicate',
              errorReason: `Another imported resume in this batch already uses ${nextFields.email}`,
              applicationId: null,
            });
            res.json({ item: duplicate });
            return;
          }
        }

        const assessment = assessResumeImportItem(nextFields, item.extractedText);
        const updated = await storage.updateResumeImportItem(item.id, {
          parsedName: nextFields.name,
          parsedEmail: nextFields.email,
          parsedPhone: nextFields.phone,
          status: assessment.status,
          errorReason: assessment.errorReason,
          applicationId: null,
        });

        res.json({ item: updated });
        return;
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        if (error instanceof z.ZodError) {
          res.status(400).json({
            error: 'Validation error',
            details: error.errors.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            })),
          });
          return;
        }
        next(error);
      }
    },
  );

  app.post(
    '/api/jobs/:id/bulk-resume-import/items/:itemId/advanced-extract',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!isBulkResumeImportEnabled()) {
          res.status(404).json({ error: 'Bulk resume import is not enabled' });
          return;
        }

        if (!isGroqAdvancedExtractionEnabled()) {
          res.status(404).json({ error: 'Advanced extraction is not enabled' });
          return;
        }

        const access = await requireRecruiterJobAccess(req, res);
        if (!access) {
          return;
        }

        const itemId = Number(req.params.itemId);
        if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isInteger(itemId)) {
          res.status(400).json({ error: 'Invalid item ID' });
          return;
        }

        const item = await storage.getResumeImportItem(itemId);
        if (!item || item.jobId !== access.jobId || item.organizationId !== access.organizationId) {
          res.status(404).json({ error: 'Import item not found' });
          return;
        }

        if (item.status === 'finalized' || item.status === 'duplicate') {
          res.status(400).json({ error: 'This import item cannot be advanced-extracted' });
          return;
        }

        if (!item.gcsPath) {
          res.status(400).json({ error: 'Resume file missing from import item' });
          return;
        }

        if (item.parsedEmail || item.parsedPhone) {
          const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
          if (item.parsedEmail) identifiers.push({ identifier_type: 'email', value: item.parsedEmail });
          if (item.parsedPhone) identifiers.push({ identifier_type: 'phone', value: item.parsedPhone });
          await requireNewCandidateIdentityAllowed(identifiers);
        } else {
          throw new CandidatePrivacyRestrictedError('candidate_privacy_review_required');
        }

        const buffer = await downloadFromGCS(item.gcsPath);
        const extraction = await extractResumeTextWithFallback(buffer, item.originalFilename, {
          gcsPath: item.gcsPath,
        });

        const canonicalText = extraction.success ? extraction.text : item.extractedText ?? '';
        const rawText = extraction.success ? (extraction.rawText || extraction.text) : item.extractedText ?? '';
        const extractionMethod = extraction.success ? extraction.method : item.extractionMethod;

        if (!canonicalText) {
          const failed = await storage.updateResumeImportItem(item.id, {
            status: 'failed',
            errorReason: extraction.error || 'No usable resume text extracted',
            extractedText: null,
            extractionMethod: extractionMethod,
            applicationId: null,
          });
          res.status(422).json({ item: failed ?? item });
          return;
        }

        const deterministicFields = extractResumeFields(rawText || canonicalText);
        if (deterministicFields.email || deterministicFields.phone) {
          const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
          if (deterministicFields.email?.trim()) {
            identifiers.push({ identifier_type: 'email', value: deterministicFields.email.trim().toLowerCase() });
          }
          if (deterministicFields.phone?.trim()) identifiers.push({ identifier_type: 'phone', value: deterministicFields.phone.trim() });
          await requireNewCandidateIdentityAllowed(identifiers);
        }
        const aiFields = await extractStructuredResumeFieldsWithGroq(rawText || canonicalText);

        const mergedFields = {
          name: pickMergedName(aiFields?.name, deterministicFields.name, item.parsedName),
          email: pickMergedEmail(item.parsedEmail, deterministicFields.email, aiFields?.email),
          phone: pickMergedPhone(item.parsedPhone, deterministicFields.phone, aiFields?.phone),
        };

        if (mergedFields.email || mergedFields.phone) {
          const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
          if (mergedFields.email?.trim()) {
            identifiers.push({ identifier_type: 'email', value: mergedFields.email.trim().toLowerCase() });
          }
          if (mergedFields.phone?.trim()) identifiers.push({ identifier_type: 'phone', value: mergedFields.phone.trim() });
          await requireNewCandidateIdentityAllowed(identifiers);
        } else {
          throw new CandidatePrivacyRestrictedError('candidate_privacy_review_required');
        }

        if (mergedFields.email) {
          const existingApplication = await storage.findApplicationByJobAndEmail(item.jobId, mergedFields.email);
          if (existingApplication && existingApplication.id !== item.applicationId) {
            const duplicate = await storage.updateResumeImportItem(item.id, {
              extractedText: canonicalText,
              extractionMethod: extractionMethod,
              parsedName: mergedFields.name,
              parsedEmail: mergedFields.email,
              parsedPhone: mergedFields.phone,
              status: 'duplicate',
              errorReason: `Application with ${mergedFields.email} already exists for this job`,
              applicationId: existingApplication.id,
            });
            res.json({ item: duplicate ?? item });
            return;
          }

          const duplicateItem = await storage.findDuplicateResumeImportItemByEmail(item.batchId, mergedFields.email, item.id);
          if (duplicateItem) {
            const duplicate = await storage.updateResumeImportItem(item.id, {
              extractedText: canonicalText,
              extractionMethod: extractionMethod,
              parsedName: mergedFields.name,
              parsedEmail: mergedFields.email,
              parsedPhone: mergedFields.phone,
              status: 'duplicate',
              errorReason: `Another imported resume in this batch already uses ${mergedFields.email}`,
              applicationId: null,
            });
            res.json({ item: duplicate ?? item });
            return;
          }
        }

        const assessment = assessResumeImportItem(mergedFields, canonicalText);
        await storage.markResumeImportItemProcessed(item.id, {
          extractedText: canonicalText,
          extractionMethod: extractionMethod,
          parsedName: mergedFields.name,
          parsedEmail: mergedFields.email,
          parsedPhone: mergedFields.phone,
          status: assessment.status,
          errorReason: assessment.errorReason,
        });

        const updated = await storage.getResumeImportItem(item.id);
        res.json({ item: updated ?? item });
        return;
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        next(error);
      }
    },
  );

  // Re-run the deterministic parser on non-finalized items that have extracted text.
  // Useful after parser improvements — no re-upload needed.
  app.post(
    '/api/jobs/:id/bulk-resume-import/:batchId/reprocess',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!isBulkResumeImportEnabled()) {
          res.status(404).json({ error: 'Bulk resume import is not enabled' });
          return;
        }

        const access = await requireRecruiterJobAccess(req, res);
        if (!access) return;

        const batchId = Number(req.params.batchId);
        if (!Number.isFinite(batchId) || batchId <= 0 || !Number.isInteger(batchId)) {
          res.status(400).json({ error: 'Invalid batch ID' });
          return;
        }

        const batch = await storage.getResumeImportBatch(batchId);
        if (!batch || batch.jobId !== access.jobId || batch.organizationId !== access.organizationId) {
          res.status(404).json({ error: 'Import batch not found' });
          return;
        }

        const allItems = await storage.getResumeImportItemsByBatch(batchId);
        const reprocessable = allItems.filter(
          (item) => item.status !== 'finalized' && item.status !== 'duplicate' && item.extractedText,
        );

        let updated = 0;
        for (const item of reprocessable) {
          const fields = extractResumeFields(item.extractedText!);
          if (!fields.email && !fields.phone) {
            throw new CandidatePrivacyRestrictedError('candidate_privacy_review_required');
          }
          const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
          if (fields.email) identifiers.push({ identifier_type: 'email', value: fields.email });
          if (fields.phone) identifiers.push({ identifier_type: 'phone', value: fields.phone });
          await requireNewCandidateIdentityAllowed(identifiers);
          const assessment = assessResumeImportItem(fields, item.extractedText);
          await storage.updateResumeImportItem(item.id, {
            parsedName: fields.name,
            parsedEmail: fields.email,
            parsedPhone: fields.phone,
            status: assessment.status,
            errorReason: assessment.errorReason,
          });
          updated++;
        }

        res.json({ reprocessed: updated, total: allItems.length });
        return;
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        next(error);
      }
    },
  );

  app.post(
    '/api/jobs/:id/bulk-resume-import/:batchId/finalize',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!isBulkResumeImportEnabled()) {
          res.status(404).json({ error: 'Bulk resume import is not enabled' });
          return;
        }

        const access = await requireRecruiterJobAccess(req, res);
        if (!access) {
          return;
        }

        const batchId = Number(req.params.batchId);
        if (!Number.isFinite(batchId) || batchId <= 0 || !Number.isInteger(batchId)) {
          res.status(400).json({ error: 'Invalid batch ID' });
          return;
        }

        const batch = await storage.getResumeImportBatch(batchId);
        if (!batch || batch.jobId !== access.jobId || batch.organizationId !== access.organizationId) {
          res.status(404).json({ error: 'Import batch not found' });
          return;
        }

        const parsedBody = finalizeResumeImportSchema.parse(req.body ?? {});
        const allItems = await storage.getResumeImportItemsByBatch(batchId);
        const items = parsedBody.itemIds?.length
          ? allItems.filter((item) => parsedBody.itemIds!.includes(item.id))
          : allItems;

        const stages = await storage.getPipelineStages(access.organizationId);
        const initialStage = pickInitialPipelineStage(stages, access.organizationId);

        const finalized: Array<{ itemId: number; applicationId: number }> = [];
        const duplicates: Array<{ itemId: number; applicationId?: number | null; reason: string }> = [];
        const needsReview: Array<{ itemId: number; reason: string }> = [];
        const syncWarnings: Array<{ itemId: number; applicationId: number; reason: string }> = [];

        for (const selectedItem of items) {
          if (selectedItem.status !== 'finalized' && selectedItem.parsedEmail) {
            const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [
              { identifier_type: 'email', value: selectedItem.parsedEmail.trim().toLowerCase() },
            ];
            if (selectedItem.parsedPhone?.trim()) {
              identifiers.push({ identifier_type: 'phone', value: selectedItem.parsedPhone.trim() });
            }
            await requireNewCandidateIdentityAllowed(identifiers);
          }
          const result = await db.transaction(async (tx: any): Promise<FinalizeResumeImportItemResult> =>
            finalizeResumeImportItemInTransaction(tx, {
              itemId: selectedItem.id,
              batchId,
              organizationId: access.organizationId,
              jobId: access.jobId,
              recruiterId: req.user!.id,
              initialStageId: initialStage?.id ?? null,
            }));

          if (result.kind === 'already_finalized') {
            finalized.push({ itemId: result.itemId, applicationId: result.applicationId });
            continue;
          }

          if (result.kind === 'duplicate') {
            duplicates.push({
              itemId: result.itemId,
              applicationId: result.applicationId,
              reason: result.reason,
            });
            continue;
          }

          if (result.kind === 'needs_review') {
            needsReview.push({
              itemId: result.itemId,
              reason: result.reason,
            });
            continue;
          }

          await storage.refreshResumeImportBatchStats(batchId);

          try {
            await enqueueGraphSyncIfEligible(result.application, req.user!.id);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.error('[BULK_RESUME_IMPORT] Graph sync enqueue failed after finalize:', {
              itemId: result.itemId,
              applicationId: result.application.id,
              error: reason,
            });
            syncWarnings.push({
              itemId: result.itemId,
              applicationId: result.application.id,
              reason,
            });
          }

          finalized.push({ itemId: result.itemId, applicationId: result.application.id });
        }

        const refreshedBatch = await storage.refreshResumeImportBatchStats(batchId);
        res.json({
          batch: refreshedBatch ?? batch,
          finalized,
          duplicates,
          needsReview,
          syncWarnings,
        });
        return;
      } catch (error) {
        if (error instanceof CandidatePrivacyRestrictedError) {
          res.status(503).json({ code: error.code });
          return;
        }
        if (error instanceof z.ZodError) {
          res.status(400).json({
            error: 'Validation error',
            details: error.errors.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            })),
          });
          return;
        }
        next(error);
      }
    },
  );
}
