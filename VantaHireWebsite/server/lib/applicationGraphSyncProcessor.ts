/**
 * Application Graph Sync Processor
 *
 * Background polling processor that syncs VantaHire application resumes
 * to ActiveKG as document-style parent + chunk nodes with DERIVED_FROM edges.
 *
 * Features:
 * - Outbox-style polling from application_graph_sync_jobs table
 * - Idempotent: checks for existing nodes by external_id before creating
 * - Exponential backoff with jitter on transient failures
 * - Dead-letter after max attempts
 * - Bounded concurrency per poll cycle
 */

import { storage } from '../storage';
import {
  createNode,
  createEdge,
  getNodeByExternalId,
  ActiveKGClientError,
} from './services/activekg-client';
import { chunkText, buildParentExternalId } from './activekgChunker';
import { resolveActiveKGTenantId } from './activekgTenant';
import { extractResumeLinks, extractResumeLinksFromBuffer, type ResumeLinks } from './resumeLinkExtractor';
import { downloadFromGCS } from '../gcs-storage';
import type { ApplicationGraphSyncJob } from '@shared/schema';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from '../candidate-privacy/decision';

/** Minimum length of extractedResumeText required for graph sync */
export const MIN_RESUME_TEXT_LENGTH = 50;

const POLL_INTERVAL_MS = parseInt(process.env.ACTIVEKG_SYNC_INTERVAL_MS || '5000', 10);
const BATCH_SIZE = parseInt(process.env.ACTIVEKG_SYNC_BATCH_SIZE || '20', 10);
const MAX_ATTEMPTS = parseInt(process.env.ACTIVEKG_SYNC_MAX_ATTEMPTS || '8', 10);
const CONCURRENCY = parseInt(process.env.ACTIVEKG_SYNC_CONCURRENCY || '2', 10);

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// Retry schedule: exponential with jitter (1m, 5m, 15m, 1h, 6h cap)
const RETRY_DELAYS_MS = [
  60_000,       // 1 minute
  300_000,      // 5 minutes
  900_000,      // 15 minutes
  3_600_000,    // 1 hour
  21_600_000,   // 6 hours
];

function computeNextAttemptAt(attempt: number): Date {
  const index = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
  const baseDelay = RETRY_DELAYS_MS[index]!;
  // Add jitter: +/- 20%
  const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
  return new Date(Date.now() + baseDelay + jitter);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ActiveKGClientError) {
    return error.retryable;
  }
  // Network errors, timeouts are retryable
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('network') ||
      msg.includes('fetch failed')
    );
  }
  return false;
}

/**
 * Process a single sync job:
 * 1. Load application + job data
 * 2. Validate prerequisites
 * 3. Ensure parent node in ActiveKG
 * 4. Chunk resume text
 * 5. Ensure chunk nodes
 * 6. Ensure DERIVED_FROM edges
 * 7. Mark success
 *
 * Exported for unit testing.
 */
export async function processJob(job: ApplicationGraphSyncJob): Promise<void> {
  // Defensive guard: dead-letter jobs with missing critical fields
  if (!job.applicationId || !job.activekgTenantId || !job.effectiveRecruiterId) {
    const missing = [
      !job.applicationId && 'applicationId',
      !job.activekgTenantId && 'activekgTenantId',
      !job.effectiveRecruiterId && 'effectiveRecruiterId',
    ].filter(Boolean).join(', ');
    await storage.markApplicationGraphSyncJobDeadLetter(
      job.id,
      `Missing required fields: ${missing}`
    );
    return;
  }

  // Step 1: Load application
  const application = await storage.getApplicationForPrivacyWorker(job.applicationId);
  if (!application) {
    await storage.markApplicationGraphSyncJobDeadLetter(
      job.id,
      `Application ${job.applicationId} not found`
    );
    return;
  }

  try {
    await requireCandidatePrivacyAllowed(
      { type: 'application', id: application.id },
      { globalUse: true, newGlobalOperation: true },
    );
  } catch (error) {
    if (error instanceof CandidatePrivacyRestrictedError) {
      await storage.markApplicationGraphSyncJobPrivacyRestricted(job.id);
      return;
    }
    throw error;
  }

  // Step 2: Validate prerequisites
  if (!application.organizationId) {
    await storage.markApplicationGraphSyncJobDeadLetter(
      job.id,
      'Application has no organizationId'
    );
    return;
  }

  if (!application.extractedResumeText || application.extractedResumeText.trim().length < MIN_RESUME_TEXT_LENGTH) {
    console.warn('[ACTIVEKG_SYNC] Job skipped at processor (defense-in-depth): resume text missing or too short', {
      jobId: job.id,
      applicationId: application.id,
      hasText: !!application.extractedResumeText,
      textLength: application.extractedResumeText?.trim().length ?? 0,
    });
    await storage.markApplicationGraphSyncJobDeadLetter(
      job.id,
      'No extracted resume text or text too short (should have been gated at enqueue)'
    );
    return;
  }

  const expectedTenantId = resolveActiveKGTenantId(application.organizationId);
  if (job.activekgTenantId !== expectedTenantId) {
    await storage.markApplicationGraphSyncJobDeadLetter(
      job.id,
      `Tenant mismatch for application ${application.id}: job=${job.activekgTenantId} expected=${expectedTenantId}`
    );
    return;
  }

  const tenantId = expectedTenantId;

  // Step 3b: Extract links from resume for ActiveKG
  // Download file from GCS to get real hyperlinks (PDF annotations / DOCX hrefs),
  // falling back to text-based regex if download fails or file has no embedded links
  let resumeLinks: ResumeLinks;
  if (application.resumeUrl) {
    await requireCandidatePrivacyAllowed(
      { type: 'application', id: application.id },
      { globalUse: true, newGlobalOperation: true },
    );
    try {
      const buffer = await downloadFromGCS(application.resumeUrl);
      resumeLinks = await extractResumeLinksFromBuffer(buffer, application.extractedResumeText);
    } catch (err) {
      resumeLinks = extractResumeLinks(application.extractedResumeText);
    }
  } else {
    resumeLinks = extractResumeLinks(application.extractedResumeText);
  }

  // Step 4: Build parent external ID
  const parentExternalId = buildParentExternalId(
    application.organizationId,
    application.id
  );

  // Step 5: Ensure parent node (idempotent)
  let parentNodeId: string;
  await requireCandidatePrivacyAllowed(
    { type: 'application', id: application.id },
    { globalUse: true, newGlobalOperation: true },
  );
  const existingParent = await getNodeByExternalId(tenantId, parentExternalId);

  if (existingParent) {
    parentNodeId = existingParent.id;
  } else {
    await requireCandidatePrivacyAllowed(
      { type: 'application', id: application.id },
      { globalUse: true, newGlobalOperation: true },
    );
    const parentResponse = await createNode(
      tenantId,
      {
        classes: ['Document', 'Resume'],
        props: {
          title: `Application Resume ${application.id}`,
          external_id: parentExternalId,
          is_parent: true,
          has_chunks: true,
          resume_text: application.extractedResumeText,
          linkedin_url: resumeLinks.linkedinUrl,
          github_url: resumeLinks.githubUrl,
          medium_url: resumeLinks.mediumUrl,
          other_links: resumeLinks.otherLinks,
          application_id: application.id,
          job_id: application.jobId,
          org_id: application.organizationId,
          resume_id: application.resumeId || null,
          effective_recruiter_id: job.effectiveRecruiterId,
          created_by_user_id: application.createdByUserId || null,
          gcs_path: application.resumeUrl || null,
          resume_gcp_url: application.resumeUrl || null,
          resume_source: 'application',
        },
        metadata: {
          source: 'vantahire',
          org_id: application.organizationId,
          job_id: application.jobId,
          application_id: application.id,
          resume_id: application.resumeId || null,
          gcs_path: application.resumeUrl || null,
          resume_gcp_url: application.resumeUrl || null,
          resume_source: 'application',
          effective_recruiter_id: job.effectiveRecruiterId,
          submitted_by_recruiter: application.submittedByRecruiter || false,
          created_by_user_id: application.createdByUserId || null,
          // Global memory provenance metadata
          provenance_type: 'platform_applicant',
          visibility: (application as any).platformDiscoveryConsent
            ? 'platform_shared'
            : 'private',
          consent_state: (application as any).platformDiscoveryConsent ? 'opted_in' : 'opted_out',
          consent_captured_at: (application as any).consentCapturedAt?.toISOString?.() || null,
          applicant_name: application.name || null,
          applicant_email: application.email || null,
          linkedin_url: resumeLinks.linkedinUrl,
          github_url: resumeLinks.githubUrl,
          medium_url: resumeLinks.mediumUrl,
          other_links: resumeLinks.otherLinks,
        },
        tenant_id: job.activekgTenantId,
      },
    );
    parentNodeId = parentResponse.id;
  }

  // Step 6: Chunk resume text
  const chunks = chunkText(application.extractedResumeText, parentExternalId);

  // Step 7: Ensure chunk nodes + edges
  for (const chunk of chunks) {
    // Check if chunk already exists
    await requireCandidatePrivacyAllowed(
      { type: 'application', id: application.id },
      { globalUse: true, newGlobalOperation: true },
    );
    const existingChunk = await getNodeByExternalId(tenantId, chunk.externalId);
    let chunkNodeId: string;

    if (existingChunk) {
      chunkNodeId = existingChunk.id;
    } else {
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: application.id },
        { globalUse: true, newGlobalOperation: true },
      );
      const chunkResponse = await createNode(
        tenantId,
        {
          classes: ['Chunk', 'Resume'],
          props: {
            text: chunk.text,
            chunk_index: chunk.chunkIndex,
            total_chunks: chunk.totalChunks,
            parent_id: parentExternalId,
            parent_title: `Application Resume ${application.id}`,
            external_id: chunk.externalId,
            application_id: application.id,
            job_id: application.jobId,
            org_id: application.organizationId,
            resume_id: application.resumeId || null,
            effective_recruiter_id: job.effectiveRecruiterId,
            created_by_user_id: application.createdByUserId || null,
            resume_source: 'application',
            linkedin_url: resumeLinks.linkedinUrl,
            github_url: resumeLinks.githubUrl,
            medium_url: resumeLinks.mediumUrl,
            other_links: resumeLinks.otherLinks,
            gcs_path: application.resumeUrl || null,
            resume_gcp_url: application.resumeUrl || null,
          },
          metadata: {
            source: 'vantahire',
            org_id: application.organizationId,
            job_id: application.jobId,
            application_id: application.id,
            resume_id: application.resumeId || null,
            gcs_path: application.resumeUrl || null,
            resume_gcp_url: application.resumeUrl || null,
            resume_source: 'application',
            effective_recruiter_id: job.effectiveRecruiterId,
            submitted_by_recruiter: application.submittedByRecruiter || false,
            created_by_user_id: application.createdByUserId || null,
          },
          tenant_id: job.activekgTenantId,
        },
      );
      chunkNodeId = chunkResponse.id;
    }

    // Ensure DERIVED_FROM edge (chunk -> parent)
    try {
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: application.id },
        { globalUse: true, newGlobalOperation: true },
      );
      await createEdge(
        tenantId,
        {
          src: chunkNodeId,
          dst: parentNodeId,
          rel: 'DERIVED_FROM',
          props: {
            chunk_index: chunk.chunkIndex,
            total_chunks: chunk.totalChunks,
          },
          tenant_id: job.activekgTenantId,
        },
      );
    } catch (edgeError) {
      // Ignore duplicate edge errors (conflict/500 with duplicate signature)
      if (
        edgeError instanceof ActiveKGClientError &&
        (edgeError.statusCode === 409 ||
          edgeError.message.includes('duplicate') ||
          edgeError.message.includes('already exists'))
      ) {
        // Edge already exists, skip
      } else {
        throw edgeError;
      }
    }
  }

  // Step 8: Mark success
  await storage.markApplicationGraphSyncJobSucceeded(
    job.id,
    parentNodeId,
    chunks.length
  );

  console.log('[ACTIVEKG_SYNC] Job succeeded:', {
    jobId: job.id,
    applicationId: application.id,
    parentNodeId,
    chunkCount: chunks.length,
  });
}

/**
 * Handle a failed job: classify error, retry or dead-letter.
 */
async function handleJobFailure(
  job: ApplicationGraphSyncJob,
  error: unknown
): Promise<void> {
  if (error instanceof CandidatePrivacyRestrictedError) {
    await storage.markApplicationGraphSyncJobPrivacyRestricted(job.id);
    return;
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  const retryable = isRetryableError(error);

  console.error('[ACTIVEKG_SYNC] Job failed:', {
    jobId: job.id,
    applicationId: job.applicationId,
    attempt: job.attempts,
    retryable,
    error: errorMessage.slice(0, 500),
  });

  if (!retryable || job.attempts >= MAX_ATTEMPTS) {
    await storage.markApplicationGraphSyncJobDeadLetter(job.id, errorMessage);
    console.error('[ACTIVEKG_SYNC] Job moved to dead_letter:', {
      jobId: job.id,
      applicationId: job.applicationId,
      totalAttempts: job.attempts,
    });
    return;
  }

  const nextAttemptAt = computeNextAttemptAt(job.attempts);
  await storage.markApplicationGraphSyncJobRetry(job.id, errorMessage, nextAttemptAt);
}

/**
 * Single poll cycle: claim jobs and process them.
 */
async function pollCycle(): Promise<void> {
  try {
    const jobs = await storage.claimPendingApplicationGraphSyncJobs(
      BATCH_SIZE,
      new Date()
    );

    if (jobs.length === 0) return;

    // Process with bounded concurrency
    const queue = [...jobs];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      // Fill up to concurrency limit
      while (queue.length > 0 && active.length < CONCURRENCY) {
        const job = queue.shift()!;
        const task = processJob(job)
          .catch((error) => handleJobFailure(job, error))
          .then(() => {
            // Remove from active
            const idx = active.indexOf(task);
            if (idx !== -1) active.splice(idx, 1);
          });
        active.push(task);
      }

      // Wait for at least one to complete
      if (active.length > 0) {
        await Promise.race(active);
      }
    }
  } catch (error) {
    console.error('[ACTIVEKG_SYNC] Poll cycle error:', error);
  }
}

/**
 * Start the background sync processor loop.
 */
export function startApplicationGraphSyncProcessor(): void {
  if (running) {
    console.warn('[ACTIVEKG_SYNC] Processor already running');
    return;
  }

  if (!process.env.VANTAHIRE_JWT_PRIVATE_KEY) {
    console.error('[ACTIVEKG_SYNC] VANTAHIRE_JWT_PRIVATE_KEY is not set, processor will not start');
    return;
  }

  running = true;
  console.log('[ACTIVEKG_SYNC] Starting background processor', {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
    concurrency: CONCURRENCY,
  });

  const poll = async () => {
    if (!running) return;
    await pollCycle();
    if (running) {
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  // Start first poll
  poll();
}

/**
 * Stop the background sync processor gracefully.
 */
export function stopApplicationGraphSyncProcessor(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[ACTIVEKG_SYNC] Processor stopped');
}
