import type { ResumeImportItem } from '@shared/schema';
import { storage } from '../storage';
import { downloadFromGCS } from '../gcs-storage';
import { assessResumeImportItem, extractResumeFields } from './resumeImportFieldExtraction';
import { extractResumeTextWithFallback } from './resumeImportExtraction';
import {
  CandidatePrivacyRestrictedError,
  requireNewCandidateIdentityAllowed,
} from '../candidate-privacy/decision';

const POLL_INTERVAL_MS = parseInt(process.env.BULK_RESUME_IMPORT_POLL_INTERVAL_MS || '5000', 10);
const BATCH_SIZE = parseInt(process.env.BULK_RESUME_IMPORT_BATCH_SIZE || '10', 10);
const CONCURRENCY = parseInt(process.env.BULK_RESUME_IMPORT_CONCURRENCY || '2', 10);
const MAX_ATTEMPTS = parseInt(process.env.BULK_RESUME_IMPORT_MAX_ATTEMPTS || '5', 10);

const RETRY_DELAYS_MS = [
  30_000,
  120_000,
  600_000,
  1_800_000,
];

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function computeNextAttemptAt(attempt: number): Date {
  const index = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
  const baseDelay = RETRY_DELAYS_MS[index]!;
  const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
  return new Date(Date.now() + baseDelay + jitter);
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed')
  );
}

async function processResumeImportItem(item: ResumeImportItem): Promise<void> {
  if (!item.gcsPath) {
    await storage.markResumeImportItemFailed(item.id, 'Resume file missing from import item');
    return;
  }

  const preflightIdentifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
  if (item.parsedEmail?.trim()) {
    preflightIdentifiers.push({ identifier_type: 'email', value: item.parsedEmail.trim().toLowerCase() });
  }
  if (item.parsedPhone?.trim()) {
    preflightIdentifiers.push({ identifier_type: 'phone', value: item.parsedPhone.trim() });
  }
  if (preflightIdentifiers.length === 0) {
    await storage.markResumeImportItemFailed(item.id, 'candidate_privacy_review_required');
    return;
  }
  await requireNewCandidateIdentityAllowed(preflightIdentifiers);

  const buffer = await downloadFromGCS(item.gcsPath);
  const extraction = await extractResumeTextWithFallback(buffer, item.originalFilename, {
    gcsPath: item.gcsPath,
  });

  if (!extraction.success) {
    await storage.markResumeImportItemFailed(
      item.id,
      extraction.error || 'Resume extraction failed',
      extraction.method,
    );
    return;
  }

  const parsedFields = extractResumeFields(extraction.rawText || extraction.text);

  if (parsedFields.email || parsedFields.phone) {
    const identifiers: Array<{ identifier_type: 'email' | 'phone'; value: string }> = [];
    if (parsedFields.email?.trim()) {
      identifiers.push({ identifier_type: 'email', value: parsedFields.email.trim().toLowerCase() });
    }
    if (parsedFields.phone?.trim()) identifiers.push({ identifier_type: 'phone', value: parsedFields.phone.trim() });
    await requireNewCandidateIdentityAllowed(identifiers);
  } else {
    await storage.markResumeImportItemFailed(item.id, 'candidate_privacy_review_required');
    return;
  }

  if (parsedFields.email) {
    const existingApplication = await storage.findApplicationByJobAndEmail(item.jobId, parsedFields.email);
    if (existingApplication) {
      await storage.markResumeImportItemDuplicate(item.id, {
        errorReason: `Application with ${parsedFields.email} already exists for this job`,
        parsedEmail: parsedFields.email,
        applicationId: existingApplication.id,
      });
      return;
    }

    const duplicateImportItem = await storage.findDuplicateResumeImportItemByEmail(item.batchId, parsedFields.email, item.id);
    if (duplicateImportItem) {
      await storage.markResumeImportItemDuplicate(item.id, {
        errorReason: `Another imported resume in this batch already uses ${parsedFields.email}`,
        parsedEmail: parsedFields.email,
        applicationId: duplicateImportItem.applicationId ?? null,
      });
      return;
    }
  }

  const assessment = assessResumeImportItem(parsedFields, extraction.text);
  await storage.markResumeImportItemProcessed(item.id, {
    extractedText: extraction.text,
    extractionMethod: extraction.method,
    parsedName: parsedFields.name,
    parsedEmail: parsedFields.email,
    parsedPhone: parsedFields.phone,
    status: assessment.status,
    errorReason: assessment.errorReason,
  });
}

async function handleJobFailure(item: ResumeImportItem, error: unknown): Promise<void> {
  if (error instanceof CandidatePrivacyRestrictedError) {
    await storage.markResumeImportItemFailed(item.id, error.code);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (!isRetryableError(error) || item.attempts >= MAX_ATTEMPTS) {
    await storage.markResumeImportItemFailed(item.id, message);
    return;
  }

  const nextAttemptAt = computeNextAttemptAt(item.attempts);
  await storage.markResumeImportItemRetry(
    item.id,
    `${message} (retry scheduled for ${nextAttemptAt.toISOString()})`,
    nextAttemptAt,
  );
}

async function pollCycle(): Promise<void> {
  try {
    const items = await storage.claimPendingResumeImportItems(BATCH_SIZE, new Date());
    if (items.length === 0) {
      return;
    }

    const queue = [...items];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (queue.length > 0 && active.length < CONCURRENCY) {
        const item = queue.shift()!;
        const task = processResumeImportItem(item)
          .catch((error) => handleJobFailure(item, error))
          .then(() => {
            const index = active.indexOf(task);
            if (index !== -1) {
              active.splice(index, 1);
            }
          });
        active.push(task);
      }

      if (active.length > 0) {
        await Promise.race(active);
      }
    }
  } catch (error) {
    console.error('[BULK_RESUME_IMPORT] Poll cycle failed:', error);
  }
}

export function startResumeImportProcessor(): void {
  if (running) {
    return;
  }

  running = true;
  console.log('[BULK_RESUME_IMPORT] Starting processor', {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    maxAttempts: MAX_ATTEMPTS,
  });

  const poll = async () => {
    if (!running) return;
    await pollCycle();
    if (running) {
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  poll();
}

export function stopResumeImportProcessor(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[BULK_RESUME_IMPORT] Processor stopped');
}
