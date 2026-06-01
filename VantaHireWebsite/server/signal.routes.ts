/**
 * Signal sourcing routes — recruiter-facing endpoints for candidate discovery.
 *
 * POST /api/jobs/:id/find-candidates  — trigger Signal sourcing
 * GET  /api/jobs/:id/sourcing-status  — poll run status
 * GET  /api/jobs/:id/sourced-candidates — list sourced candidates
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { db } from './db';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import { jobs, organizations, jobSourcingRuns, jobSourcedCandidates, recruiterFeedbackEvents, type JobSourcingRun, type JobSourcedCandidate } from '@shared/schema';
import { requireRole } from './auth';
import { requireSeat } from './auth';
import { getUserOrganization, requireSignalTenantId } from './lib/organizationService';
import { queueMauticSourcingRunSync } from './lib/mauticService';
import { sourceJob, enrichBatch, findContact } from './lib/services/signal-client';
import {
  CONTEXT_HASH_VERSION,
  toDisplayBucket,
  isTerminalStatus,
  flattenCandidateForUI,
  type ContextHashInput,
  type SignalIdentitySummary,
  type SignalSourceRequest,
  type SourcingRunStatus,
  type SourcedCandidateForUI,
} from './lib/services/signal-contracts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generateJDDigest, CURRENT_DIGEST_VERSION } from './lib/jdDigest';

function normalizeSkillList(skills: unknown): string[] {
  if (!Array.isArray(skills)) {
    return [];
  }
  const normalized = skills
    .filter((skill): skill is string => typeof skill === 'string')
    .map((s) => s.trim().toLowerCase());
  return [...new Set(normalized)].sort();
}

function readStructuredJobDescription(description: string | null | undefined): {
  mustHaveSkills?: string[];
  niceToHaveSkills?: string[];
} | null {
  if (!description) {
    return null;
  }

  try {
    const parsed = JSON.parse(description) as {
      mustHaveSkills?: unknown;
      niceToHaveSkills?: unknown;
    };

    const mustHaveSkills = Array.isArray(parsed.mustHaveSkills)
      ? parsed.mustHaveSkills.filter((skill): skill is string => typeof skill === 'string')
      : undefined;
    const niceToHaveSkills = Array.isArray(parsed.niceToHaveSkills)
      ? parsed.niceToHaveSkills.filter((skill): skill is string => typeof skill === 'string')
      : undefined;

    return {
      ...(mustHaveSkills ? { mustHaveSkills } : {}),
      ...(niceToHaveSkills ? { niceToHaveSkills } : {}),
    };
  } catch {
    return null;
  }
}

function isIdentityDisplayStatus(value: unknown): value is SignalIdentitySummary['displayStatus'] {
  return value === 'verified' || value === 'review' || value === 'weak';
}

function readIdentitySummary(candidateSummary: unknown): SignalIdentitySummary | null {
  if (!candidateSummary || typeof candidateSummary !== 'object') {
    return null;
  }

  const identitySummary = (candidateSummary as { identitySummary?: unknown }).identitySummary;
  if (!identitySummary || typeof identitySummary !== 'object') {
    return null;
  }

  const parsed = identitySummary as { displayStatus?: unknown; platforms?: unknown };
  if (!isIdentityDisplayStatus(parsed.displayStatus)) {
    return null;
  }
  if (!Array.isArray(parsed.platforms) || parsed.platforms.some((p) => typeof p !== 'string')) {
    return null;
  }

  return identitySummary as SignalIdentitySummary;
}

function readFiniteNumber(input: Record<string, unknown> | null | undefined, key: string): number | undefined {
  if (!input) return undefined;
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(input: Record<string, unknown> | null | undefined, key: string): boolean | undefined {
  if (!input) return undefined;
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalStringOrNull(input: Record<string, unknown> | null | undefined, key: string): string | null | undefined {
  if (!input || !(key in input)) return undefined;
  const value = input[key];
  if (value == null) return null;
  return typeof value === 'string' ? value : undefined;
}

function isLikelyValidLocationHint(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 70) return false;
  if (/\b(experience|education|skills?|linkedin|connections?)\b/i.test(trimmed)) return false;
  if (/[|]/.test(trimmed)) return false;
  if ((trimmed.match(/,/g) || []).length > 2) return false;
  return true;
}

function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function sortSourcedCandidatesForDisplay(
  candidates: ReturnType<typeof flattenCandidateForUI>[],
): ReturnType<typeof flattenCandidateForUI>[] {
  return [...candidates].sort((a, b) => {
    const rankA = typeof a.signalRank === 'number' && Number.isFinite(a.signalRank) ? a.signalRank : null;
    const rankB = typeof b.signalRank === 'number' && Number.isFinite(b.signalRank) ? b.signalRank : null;
    if (rankA !== null && rankB !== null) return rankA - rankB;
    if (rankA !== null) return -1;
    if (rankB !== null) return 1;

    const fitA = typeof a.fitScoreRaw === 'number' ? a.fitScoreRaw : (typeof a.fitScore === 'number' ? a.fitScore : -1);
    const fitB = typeof b.fitScoreRaw === 'number' ? b.fitScoreRaw : (typeof b.fitScore === 'number' ? b.fitScore : -1);
    if (fitA !== fitB) return fitB - fitA;
    return a.id - b.id;
  });
}

interface SignalRouteUser {
  id: number;
  role: string;
}

interface AccessibleSignalJobContext {
  job: typeof jobs.$inferSelect;
  organizationId: number;
  signalTenantId: string | null;
}

type AccessibleSignalJobContextResult =
  | { ok: true; context: AccessibleSignalJobContext }
  | { ok: false; error: 'NO_ORGANIZATION' | 'JOB_NOT_FOUND' | 'JOB_ORG_MISSING' };

async function resolveAccessibleSignalJobContext(
  user: SignalRouteUser,
  jobId: number,
): Promise<AccessibleSignalJobContextResult> {
  const orgResult = await getUserOrganization(user.id);
  if (!orgResult) {
    return { ok: false, error: 'NO_ORGANIZATION' };
  }

  const job = await db.query.jobs.findFirst({
    where: user.role === 'super_admin'
      ? eq(jobs.id, jobId)
      : and(eq(jobs.id, jobId), eq(jobs.organizationId, orgResult.organization.id)),
  });

  if (!job) {
    return { ok: false, error: 'JOB_NOT_FOUND' };
  }

  if (!job.organizationId) {
    return { ok: false, error: 'JOB_ORG_MISSING' };
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, job.organizationId),
    columns: { id: true, signalTenantId: true },
  });

  if (!org) {
    return { ok: false, error: 'JOB_NOT_FOUND' };
  }

  return {
    ok: true,
    context: {
      job,
      organizationId: org.id,
      signalTenantId: org.signalTenantId ?? null,
    },
  };
}

/**
 * Recursively sort object keys for deterministic JSON serialization.
 * Arrays preserve element order; only object key order is normalized.
 */
export function deepSortKeys(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = deepSortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Compute deterministic context hash from job fields.
 * Uses jdDigest when available, falls back to raw fields.
 */
export function computeContextHash(job: {
  jdDigest: unknown;
  jdDigestVersion: number | null;
  title: string;
  skills: string[] | null;
  goodToHaveSkills: string[] | null;
  location: string;
  experienceYears: number | null;
  educationRequirement: string | null;
}): string {
  const skills = normalizeSkillList(job.skills);
  const goodToHaveSkills = normalizeSkillList(job.goodToHaveSkills);

  const input: ContextHashInput = {
    jdDigest: (job.jdDigest as Record<string, unknown>) ?? null,
    jdDigestVersion: job.jdDigestVersion ?? null,
    title: job.title,
    skills,
    goodToHaveSkills,
    location: job.location,
    experienceYears: job.experienceYears ?? null,
    educationRequirement: job.educationRequirement ?? null,
    contextVersion: CONTEXT_HASH_VERSION,
  };

  // Canonical JSON: deep-sort all keys for determinism (handles nested jdDigest)
  const canonical = JSON.stringify(deepSortKeys(input));
  return createHash('sha256').update(canonical).digest('hex');
}

export function registerSignalRoutes(app: Express, csrfProtection: any) {

  /**
   * POST /api/jobs/:id/find-candidates
   *
   * Triggers a Signal sourcing run for the given job.
   * - Fail-fast if org has no signal_tenant_id.
   * - Context hash dedupe: returns existing run if one is active with same hash.
   * - Creates run record, calls Signal /source, updates run status.
   */
  app.post('/api/jobs/:id/find-candidates', csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = parseInt(req.params.id || '', 10);
      if (isNaN(jobId)) {
        res.status(400).json({ error: 'Invalid job ID' });
        return;
      }

      const contextResult = await resolveAccessibleSignalJobContext(req.user as SignalRouteUser, jobId);
      if (!contextResult.ok) {
        if (contextResult.error === 'JOB_NOT_FOUND') {
          res.status(404).json({ error: 'Job not found' });
          return;
        }
        if (contextResult.error === 'JOB_ORG_MISSING') {
          res.status(400).json({ error: 'Job has no organization', code: 'JOB_ORG_MISSING' });
          return;
        }
        res.status(403).json({ error: 'Organization required', code: 'NO_ORGANIZATION' });
        return;
      }
      const { job, organizationId } = contextResult.context;
      const signalTenantId = await requireSignalTenantId(organizationId);

      const externalJobId = `vanta:jobs:${job.id}`;

      // Ensure JD digest exists before sourcing.
      // IMPORTANT: If a stale digest exists, use it immediately and regenerate in background.
      // This eliminates a ~20s LLM round-trip from the 202 response path.
      // Only block if there is NO digest at all (new job).
      let jdDigest = job.jdDigest as Record<string, unknown> | null;
      const digestSourceDescription = job.originalJD || job.description;
      const digestStale = !job.jdDigestVersion || job.jdDigestVersion < CURRENT_DIGEST_VERSION;

      if (!jdDigest) {
        // No digest at all — must generate synchronously so we have topSkills for sourcing.
        let generated = await generateJDDigest(job.title, job.description);
        if (generated.topSkills.length === 0) {
          generated = await generateJDDigest(job.title, digestSourceDescription);
        }
        await db.update(jobs).set({
          jdDigest: generated,
          jdDigestVersion: generated.version,
        }).where(eq(jobs.id, job.id));
        jdDigest = generated as unknown as Record<string, unknown>;
        (job as any).jdDigest = jdDigest;
        (job as any).jdDigestVersion = generated.version;
      } else if (digestStale) {
        // Stale digest — use existing version now, upgrade in background (non-blocking).
        setImmediate(async () => {
          try {
            let generated = await generateJDDigest(job.title, job.description);
            if (generated.topSkills.length === 0) {
              generated = await generateJDDigest(job.title, job.description);
            }
            await db.update(jobs).set({
              jdDigest: generated,
              jdDigestVersion: generated.version,
            }).where(eq(jobs.id, job.id));
          } catch (e) {
            console.error(`[find-candidates] Background JD digest refresh failed for job ${job.id}:`, e);
          }
        });
      }


      const contextHash = computeContextHash(job);

      // Check for existing active (non-terminal) run with same context
      const existingRun = await db.query.jobSourcingRuns.findFirst({
        where: and(
          eq(jobSourcingRuns.organizationId, organizationId),
          eq(jobSourcingRuns.externalJobId, externalJobId),
          eq(jobSourcingRuns.contextHash, contextHash),
        ),
        orderBy: desc(jobSourcingRuns.createdAt),
      });

      if (existingRun && !req.body.forceSourcing && !isTerminalStatus(existingRun.status as SourcingRunStatus)) {
        // Dedupe: return existing active run
        res.status(200).json({
          success: true,
          requestId: existingRun.requestId,
          status: existingRun.status,
          idempotent: true,
        });
        return;
      }

      // Build callback URL
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const callbackUrl = `${baseUrl}/api/webhooks/signal/callback`;

      // Build Signal request
      const structuredDescription = readStructuredJobDescription(job.description);
      const signalSkills = normalizeSkillList(
        structuredDescription?.mustHaveSkills?.length ? structuredDescription.mustHaveSkills : job.skills,
      );
      const signalGoodToHaveSkills = normalizeSkillList([
        ...(Array.isArray(job.goodToHaveSkills) ? job.goodToHaveSkills : []),
        ...(structuredDescription?.niceToHaveSkills ?? []),
      ]);

      const sourceRequest: SignalSourceRequest = {
        jobContext: {
          jdDigest: JSON.stringify(jdDigest),
          title: job.title,
          skills: signalSkills,
          goodToHaveSkills: signalGoodToHaveSkills,
          location: job.location,
          ...(job.experienceYears != null ? { experienceYears: job.experienceYears } : {}),
          ...(job.educationRequirement ? { education: job.educationRequirement } : {}),
          ...(req.body.refresh ? { refresh: true } : {}),
          ...(req.body.forceSourcing ? { forceSourcing: true } : {}),
        },
        callbackUrl,
      };

      // Call Signal first to get canonical requestId before persisting
      let signalResponse;
      try {
        signalResponse = await sourceJob(signalTenantId, externalJobId, sourceRequest);
      } catch (signalError: any) {
        throw signalError;
      }

      // If Signal returned an existing requestId we already have, return it
      const existingByRequestId = await db.query.jobSourcingRuns.findFirst({
        where: eq(jobSourcingRuns.requestId, signalResponse.requestId),
      });

      if (existingByRequestId) {
        if (req.body.forceSourcing) {
          await db.update(jobSourcingRuns)
            .set({
              status: 'submitted',
              candidateCount: 0,
              updatedAt: new Date()
            })
            .where(eq(jobSourcingRuns.id, existingByRequestId.id));

          res.status(200).json({
            success: true,
            requestId: existingByRequestId.requestId,
            status: 'submitted',
            candidateCount: 0,
            idempotent: false,
          });
          return;
        }

        res.status(200).json({
          success: true,
          requestId: existingByRequestId.requestId,
          status: existingByRequestId.status,
          candidateCount: existingByRequestId.candidateCount,
          idempotent: true,
        });
        return;
      }

      // Persist run with Signal's canonical requestId (upsert-safe)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      try {
        await db.insert(jobSourcingRuns).values({
          organizationId,
          jobId: job.id,
          requestId: signalResponse.requestId,
          externalJobId,
          status: 'submitted',
          contextHash,
          callbackUrl,
          expiresAt,
          submittedAt: new Date(),
          meta: { requestedLocation: job.location },
        });
      } catch (insertError: any) {
        // 23505 = unique_violation — concurrent request already inserted this requestId
        if (insertError.code === '23505') {
          const conflictRun = await db.query.jobSourcingRuns.findFirst({
            where: eq(jobSourcingRuns.requestId, signalResponse.requestId),
          });
          if (conflictRun) {
            res.status(200).json({
              success: true,
              requestId: conflictRun.requestId,
              status: conflictRun.status,
              candidateCount: conflictRun.candidateCount,
              idempotent: true,
            });
            return;
          }
        }
        throw insertError;
      }

      queueMauticSourcingRunSync(req.user!.id, organizationId);

      res.status(202).json({
        success: true,
        requestId: signalResponse.requestId,
        status: 'submitted',
        idempotent: signalResponse.idempotent,
      });
    } catch (error: any) {
      if (error.message?.includes('no Signal integration configured')) {
        res.status(400).json({
          error: 'Signal integration not configured',
          code: 'NO_SIGNAL_TENANT',
          message: 'Set signal_tenant_id in organization settings to enable candidate sourcing.',
        });
        return;
      }
      next(error);
    }
  });

  /**
   * GET /api/jobs/:id/sourcing-status
   *
   * Returns the latest sourcing run status for a job.
   * Frontend polls this every 7s until terminal status or 10m timeout.
   */
  app.get('/api/jobs/:id/sourcing-status', requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = parseInt(req.params.id || '', 10);
      if (isNaN(jobId)) {
        res.status(400).json({ error: 'Invalid job ID' });
        return;
      }

      const contextResult = await resolveAccessibleSignalJobContext(req.user as SignalRouteUser, jobId);
      if (!contextResult.ok) {
        if (contextResult.error === 'JOB_NOT_FOUND') {
          res.status(404).json({ error: 'Job not found' });
          return;
        }
        if (contextResult.error === 'JOB_ORG_MISSING') {
          res.status(400).json({ error: 'Job has no organization', code: 'JOB_ORG_MISSING' });
          return;
        }
        res.status(403).json({ error: 'Organization required', code: 'NO_ORGANIZATION' });
        return;
      }
      const { organizationId } = contextResult.context;

      const latestRun = await db.query.jobSourcingRuns.findFirst({
        where: and(
          eq(jobSourcingRuns.organizationId, organizationId),
          eq(jobSourcingRuns.jobId, jobId),
        ),
        orderBy: desc(jobSourcingRuns.createdAt),
      });

      if (!latestRun) {
        res.json({ hasRun: false });
        return;
      }

      // Lazy expiry: mark stale non-terminal runs as expired on poll
      const rawStaleMs = parseInt(process.env.SIGNAL_STALE_THRESHOLD_MS ?? '', 10);
      const STALE_THRESHOLD_MS = Number.isFinite(rawStaleMs) && rawStaleMs > 0 ? rawStaleMs : 15 * 60 * 1000;
      if (!isTerminalStatus(latestRun.status as SourcingRunStatus)) {
        const submittedMs = latestRun.submittedAt
          ? new Date(latestRun.submittedAt).getTime()
          : new Date(latestRun.createdAt).getTime();
        const isStale = Date.now() - submittedMs > STALE_THRESHOLD_MS;
        const isPastExpiry = latestRun.expiresAt &&
          new Date(latestRun.expiresAt).getTime() < Date.now();

        if (isStale || isPastExpiry) {
          const expiredMsg = isPastExpiry
            ? 'Run expired'
            : 'Run timed out (no callback received)';
          await db.update(jobSourcingRuns)
            .set({
              status: 'expired',
              errorMessage: expiredMsg,
              updatedAt: new Date(),
            })
            .where(eq(jobSourcingRuns.id, latestRun.id));

          // Mutate local object so the response below reflects the new status
          (latestRun as any).status = 'expired';
          (latestRun as any).errorMessage = expiredMsg;
        }
      }

      const runMeta = latestRun.meta && typeof latestRun.meta === 'object'
        ? latestRun.meta as Record<string, unknown>
        : null;
      const enrichmentProgressRaw = runMeta?.enrichmentProgress && typeof runMeta.enrichmentProgress === 'object'
        ? runMeta.enrichmentProgress as Record<string, unknown>
        : null;
      const enrichmentRefreshRaw = runMeta?.enrichmentRefresh && typeof runMeta.enrichmentRefresh === 'object'
        ? runMeta.enrichmentRefresh as Record<string, unknown>
        : null;
      const pendingCount = readFiniteNumber(enrichmentProgressRaw, 'pendingCount') ?? 0;
      const refreshStatus = readOptionalStringOrNull(enrichmentRefreshRaw, 'status') ?? null;
      const refreshTerminal = refreshStatus === 'completed'
        || refreshStatus === 'stopped_max_age'
        || refreshStatus === 'stopped_no_queue'
        || refreshStatus === 'stopped_enqueue_error';
      const inProgress = latestRun.status === 'completed'
        ? false  // enrichment is atomic in orchestrator; no separate phase remains
        : refreshTerminal
          ? false
          : (readBoolean(enrichmentProgressRaw, 'inProgress')
            ?? (pendingCount > 0 && latestRun.status === 'completed'));
      const queueJobId = readOptionalStringOrNull(enrichmentRefreshRaw, 'queueJobId') ?? null;
      const lastSyncedAt = readOptionalStringOrNull(enrichmentProgressRaw, 'lastSyncedAt')
        ?? readOptionalStringOrNull(runMeta, 'lastResultsSyncAt')
        ?? null;
      const lastRerankedAt = readOptionalStringOrNull(runMeta, 'lastRerankedAt') ?? null;
      const enrichment = enrichmentProgressRaw
        ? {
          totalCandidates: readFiniteNumber(enrichmentProgressRaw, 'totalCandidates') ?? 0,
          enrichedCount: readFiniteNumber(enrichmentProgressRaw, 'enrichedCount') ?? 0,
          pendingCount,
          failedCount: readFiniteNumber(enrichmentProgressRaw, 'failedCount') ?? 0,
          percent: readFiniteNumber(enrichmentProgressRaw, 'percent') ?? 0,
          inProgress,
          lastSyncedAt,
          refreshStatus,
          queueJobId,
          lastRerankedAt,
        }
        : undefined;

      res.json({
        hasRun: true,
        requestId: latestRun.requestId,
        status: latestRun.status,
        candidateCount: latestRun.candidateCount,
        submittedAt: latestRun.submittedAt,
        completedAt: latestRun.completedAt,
        errorMessage: latestRun.status === 'failed' || latestRun.status === 'expired'
          ? latestRun.errorMessage : undefined,
        enrichment,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/jobs/:id/sourced-candidates
   *
   * Returns sourced candidates for a job, grouped by UI display bucket.
   * Stores raw Signal sourceType; derives talent_pool vs newly_discovered at read time.
   */
  app.get('/api/jobs/:id/sourced-candidates', requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = parseInt(req.params.id || '', 10);
      if (isNaN(jobId)) {
        res.status(400).json({ error: 'Invalid job ID' });
        return;
      }

      const contextResult = await resolveAccessibleSignalJobContext(req.user as SignalRouteUser, jobId);
      if (!contextResult.ok) {
        if (contextResult.error === 'JOB_NOT_FOUND') {
          res.status(404).json({ error: 'Job not found' });
          return;
        }
        if (contextResult.error === 'JOB_ORG_MISSING') {
          res.status(400).json({ error: 'Job has no organization', code: 'JOB_ORG_MISSING' });
          return;
        }
        res.status(403).json({ error: 'Organization required', code: 'NO_ORGANIZATION' });
        return;
      }
      const { organizationId } = contextResult.context;

      const [candidates, latestRunForMeta] = await Promise.all([
        db.query.jobSourcedCandidates.findMany({
          where: and(
            eq(jobSourcedCandidates.organizationId, organizationId),
            eq(jobSourcedCandidates.jobId, jobId),
          ),
          orderBy: [desc(jobSourcedCandidates.fitScore), asc(jobSourcedCandidates.id)],
        }) as Promise<JobSourcedCandidate[]>,
        db.query.jobSourcingRuns.findFirst({
          where: and(
            eq(jobSourcingRuns.organizationId, organizationId),
            eq(jobSourcingRuns.jobId, jobId),
          ),
          orderBy: desc(jobSourcingRuns.createdAt),
          columns: { id: true, meta: true, submittedAt: true },
        }),
      ]);

      const runMeta = (latestRunForMeta?.meta as Record<string, unknown>) ?? {};

      // Flatten to UI shape and preserve Signal's assembly order when rank exists.
      const enriched = sortSourcedCandidatesForDisplay(
        candidates.map((c: JobSourcedCandidate) => flattenCandidateForUI(c)),
      );

      const counts = {
        total: enriched.length,
        talentPool: enriched.filter((c) => c.displayBucket === 'talent_pool').length,
        newlyDiscovered: enriched.filter((c) => c.displayBucket === 'newly_discovered').length,
      };

      // Grouping metadata for UI clarity (strict-vs-broader).
      const hasExplicitTier = enriched.some((c) => c.matchTier === 'best_matches' || c.matchTier === 'broader_pool');
      const hasLocationMatchType = enriched.some((c) => !!c.locationMatchType);

      let bestMatches = enriched.length;
      let broaderPool = 0;

      if (hasExplicitTier) {
        bestMatches = enriched.filter((c) => c.matchTier !== 'broader_pool').length;
        broaderPool = enriched.filter((c) => c.matchTier === 'broader_pool').length;
      } else if (hasLocationMatchType) {
        bestMatches = enriched.filter((c) => c.locationMatchType !== 'none').length;
        broaderPool = enriched.filter((c) => c.locationMatchType === 'none').length;
      }

      const runDiagnostics = runMeta.diagnostics && typeof runMeta.diagnostics === 'object'
        ? runMeta.diagnostics as Record<string, unknown>
        : null;
      const runDiscoveryTelemetry = runDiagnostics?.discoveryTelemetry && typeof runDiagnostics.discoveryTelemetry === 'object'
        ? runDiagnostics.discoveryTelemetry as Record<string, unknown>
        : null;
      const runMetaGroupCounts = runMeta.groupCounts && typeof runMeta.groupCounts === 'object'
        ? runMeta.groupCounts as Record<string, unknown>
        : null;

      const resolvedBestMatches =
        readFiniteNumber(runMetaGroupCounts, 'bestMatches') ??
        readFiniteNumber(runMetaGroupCounts, 'strictMatchedCount') ??
        bestMatches;
      const resolvedBroaderPool =
        readFiniteNumber(runMetaGroupCounts, 'broaderPool') ??
        readFiniteNumber(runMetaGroupCounts, 'expandedCount') ??
        broaderPool;
      const groupExpansionReason = readOptionalStringOrNull(runMetaGroupCounts, 'expansionReason');
      const metaExpansionReason = readOptionalStringOrNull(runMeta, 'expansionReason');
      const resolvedExpansionReason = groupExpansionReason !== undefined
        ? groupExpansionReason
        : metaExpansionReason !== undefined
          ? metaExpansionReason
          : (resolvedBestMatches === 0 && resolvedBroaderPool > 0
            ? 'strict_low_quality'
            : resolvedBroaderPool > 0
              ? 'expanded_location_results'
              : null);
      const groupRequestedLocation = readOptionalStringOrNull(runMetaGroupCounts, 'requestedLocation');
      const metaRequestedLocation = readOptionalStringOrNull(runMeta, 'requestedLocation');
      const resolvedRequestedLocation = groupRequestedLocation !== undefined
        ? groupRequestedLocation
        : metaRequestedLocation !== undefined
          ? metaRequestedLocation
          : null;

      const groupCounts = {
        bestMatches: resolvedBestMatches,
        broaderPool: resolvedBroaderPool,
        ...(readFiniteNumber(runMetaGroupCounts, 'strictMatchedCount') !== undefined
          ? { strictMatchedCount: readFiniteNumber(runMetaGroupCounts, 'strictMatchedCount')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'expandedCount') !== undefined
          ? { expandedCount: readFiniteNumber(runMetaGroupCounts, 'expandedCount')! }
          : {}),
        ...(groupExpansionReason !== undefined ? { expansionReason: groupExpansionReason } : {}),
        ...(groupRequestedLocation !== undefined ? { requestedLocation: groupRequestedLocation } : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'strictDemotedCount') !== undefined
          ? { strictDemotedCount: readFiniteNumber(runMetaGroupCounts, 'strictDemotedCount')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'strictRescuedCount') !== undefined
          ? { strictRescuedCount: readFiniteNumber(runMetaGroupCounts, 'strictRescuedCount')! }
          : {}),
        ...(readBoolean(runMetaGroupCounts, 'strictRescueApplied') !== undefined
          ? { strictRescueApplied: readBoolean(runMetaGroupCounts, 'strictRescueApplied')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'strictRescueMinFitScoreUsed') !== undefined
          ? { strictRescueMinFitScoreUsed: readFiniteNumber(runMetaGroupCounts, 'strictRescueMinFitScoreUsed')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'countryGuardFilteredCount') !== undefined
          ? { countryGuardFilteredCount: readFiniteNumber(runMetaGroupCounts, 'countryGuardFilteredCount')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'minDiscoveryPerRunApplied') !== undefined
          ? { minDiscoveryPerRunApplied: readFiniteNumber(runMetaGroupCounts, 'minDiscoveryPerRunApplied')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'minDiscoveredInOutputApplied') !== undefined
          ? { minDiscoveredInOutputApplied: readFiniteNumber(runMetaGroupCounts, 'minDiscoveredInOutputApplied')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'discoveredPromotedCount') !== undefined
          ? { discoveredPromotedCount: readFiniteNumber(runMetaGroupCounts, 'discoveredPromotedCount')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'discoveredPromotedInTopCount') !== undefined
          ? { discoveredPromotedInTopCount: readFiniteNumber(runMetaGroupCounts, 'discoveredPromotedInTopCount')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'discoveredOrphanCount') !== undefined
          ? { discoveredOrphanCount: readFiniteNumber(runMetaGroupCounts, 'discoveredOrphanCount')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'discoveredOrphanQueued') !== undefined
          ? { discoveredOrphanQueued: readFiniteNumber(runMetaGroupCounts, 'discoveredOrphanQueued')! }
          : {}),
        ...(runMetaGroupCounts && typeof runMetaGroupCounts.locationMatchCounts === 'object' && runMetaGroupCounts.locationMatchCounts !== null
          ? { locationMatchCounts: runMetaGroupCounts.locationMatchCounts as Record<string, number> }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'demotedStrictWithCityMatch') !== undefined
          ? { demotedStrictWithCityMatch: readFiniteNumber(runMetaGroupCounts, 'demotedStrictWithCityMatch')! }
          : {}),
        ...(readFiniteNumber(runMetaGroupCounts, 'strictBeforeDemotion') !== undefined
          ? { strictBeforeDemotion: readFiniteNumber(runMetaGroupCounts, 'strictBeforeDemotion')! }
          : {}),
        ...(readOptionalStringOrNull(runMetaGroupCounts, 'selectedSnapshotTrack') !== undefined
          ? { selectedSnapshotTrack: readOptionalStringOrNull(runMetaGroupCounts, 'selectedSnapshotTrack') }
          : {}),
      };
      const strictExecuted = readFiniteNumber(runDiscoveryTelemetry, 'strictQueriesExecuted');
      const fallbackExecuted = readFiniteNumber(runDiscoveryTelemetry, 'fallbackQueriesExecuted');
      const providerUsage = runDiscoveryTelemetry?.providerUsage && typeof runDiscoveryTelemetry.providerUsage === 'object'
        ? runDiscoveryTelemetry.providerUsage as Record<string, number>
        : null;
      const discoverySummary = runDiscoveryTelemetry
        ? {
          mode: readOptionalStringOrNull(runDiscoveryTelemetry, 'mode') ?? 'deterministic',
          strictQueriesExecuted: strictExecuted ?? 0,
          fallbackQueriesExecuted: fallbackExecuted ?? 0,
          queriesExecuted: (strictExecuted ?? 0) + (fallbackExecuted ?? 0),
          strictYield: readFiniteNumber(runDiscoveryTelemetry, 'strictYield') ?? 0,
          fallbackYield: readFiniteNumber(runDiscoveryTelemetry, 'fallbackYield') ?? 0,
          stoppedReason: readOptionalStringOrNull(runDiscoveryTelemetry, 'stoppedReason'),
          providerUsage,
          groqUsed: runDiscoveryTelemetry.groq && typeof runDiscoveryTelemetry.groq === 'object'
            ? Boolean((runDiscoveryTelemetry.groq as Record<string, unknown>).used)
            : false,
        }
        : null;

      const totalForQuality = enriched.length;
      const locationMatchedCount = enriched.filter(
        (c) => c.locationMatchType === 'city_exact' || c.locationMatchType === 'city_alias' || c.locationMatchType === 'country_only',
      ).length;
      const validLocationHintCount = enriched.filter(
        (c) => {
          const loc = c.crustdata?.location || c.crustdata?.basic_profile?.location?.full_location || c.crustdata?.basic_profile?.location?.name || c.snapshot?.location || null;
          return isLikelyValidLocationHint(loc);
        },
      ).length;
      const nonZeroSkillScoreCount = enriched.filter((c) => {
        const skillScore = c.fitBreakdown && typeof c.fitBreakdown === 'object'
          ? (c.fitBreakdown as Record<string, unknown>).skillScore
          : null;
        return typeof skillScore === 'number' && Number.isFinite(skillScore) && skillScore > 0;
      }).length;
      const qualityDebug = {
        totalCandidates: totalForQuality,
        locationMatchedCount,
        locationMatchedPct: toPercent(locationMatchedCount, totalForQuality),
        validLocationHintCount,
        validLocationHintPct: toPercent(validLocationHintCount, totalForQuality),
        nonZeroSkillScoreCount,
        nonZeroSkillScorePct: toPercent(nonZeroSkillScoreCount, totalForQuality),
      };

      // Compute KPIs server-side
      const engagementReadyCandidates = enriched.filter((c: SourcedCandidateForUI) => c.engagementReady);
      const sortedByRank = [...enriched].sort((a: SourcedCandidateForUI, b: SourcedCandidateForUI) => (a.signalRank ?? 999) - (b.signalRank ?? 999));
      const firstEngagementReadyCandidate = sortedByRank.find((c: SourcedCandidateForUI) => c.engagementReady);

      const kpis = {
        engagementReadyCount: engagementReadyCandidates.length,
        firstQualifiedCandidateRank: firstEngagementReadyCandidate?.signalRank ?? null,
      };

      // Record first_engagement_ready_seen once per run (write-once, concurrent-safe)
      if (latestRunForMeta && firstEngagementReadyCandidate && !runMeta.firstEngagementReadySeenAt) {
        db.execute(sql`
          UPDATE job_sourcing_runs SET meta = jsonb_set(
            COALESCE(meta, '{}'::jsonb),
            '{firstEngagementReadySeenAt}',
            to_jsonb(now()::text)
          ) WHERE id = ${latestRunForMeta.id} AND NOT (COALESCE(meta, '{}'::jsonb) ? 'firstEngagementReadySeenAt')
        `).catch(() => { /* non-blocking, best-effort */ });
      }

      res.json({
        candidates: enriched,
        counts,
        groupCounts,
        expansionReason: resolvedExpansionReason,
        requestedLocation: resolvedRequestedLocation,
        discoverySummary,
        qualityDebug,
        kpis,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/jobs/:id/sourced-candidates/:candidateId
   *
   * Update candidate state (shortlist/hide/unhide).
   * Blocks updates while the candidate's sourcing run is still active.
   */
  const patchStateSchema = z.object({
    state: z.enum(['new', 'shortlisted', 'hidden']),
  });

  app.patch('/api/jobs/:id/sourced-candidates/:candidateId', csrfProtection, requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = parseInt(req.params.id || '', 10);
      const candidateId = parseInt(req.params.candidateId || '', 10);
      if (isNaN(jobId) || isNaN(candidateId)) {
        res.status(400).json({ error: 'Invalid job ID or candidate ID' });
        return;
      }

      const parseResult = patchStateSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ error: 'Invalid body', details: parseResult.error.flatten() });
        return;
      }
      const { state: newState } = parseResult.data;

      const contextResult = await resolveAccessibleSignalJobContext(req.user as SignalRouteUser, jobId);
      if (!contextResult.ok) {
        if (contextResult.error === 'JOB_NOT_FOUND') {
          res.status(404).json({ error: 'Job not found' });
          return;
        }
        if (contextResult.error === 'JOB_ORG_MISSING') {
          res.status(400).json({ error: 'Job has no organization', code: 'JOB_ORG_MISSING' });
          return;
        }
        res.status(403).json({ error: 'Organization required', code: 'NO_ORGANIZATION' });
        return;
      }
      const { organizationId, signalTenantId } = contextResult.context;

      // Fetch candidate — verify it belongs to org + job
      const candidate = await db.query.jobSourcedCandidates.findFirst({
        where: and(
          eq(jobSourcedCandidates.id, candidateId),
          eq(jobSourcedCandidates.jobId, jobId),
          eq(jobSourcedCandidates.organizationId, organizationId),
        ),
      });

      if (!candidate) {
        res.status(404).json({ error: 'Candidate not found' });
        return;
      }

      // Block updates while the candidate's sourcing run is still active.
      // NOTE: We intentionally allow actions once the run is terminal, even if enrichment
      // is still in progress (up to ~6h). Blocking during enrichment is worse UX than
      // allowing recruiter actions on partially-enriched data.
      const run = await db.query.jobSourcingRuns.findFirst({
        where: eq(jobSourcingRuns.requestId, candidate.requestId),
      });
      if (run && !isTerminalStatus(run.status as SourcingRunStatus)) {
        res.status(409).json({
          error: 'Cannot update candidate while sourcing run is still active',
          code: 'RUN_NOT_TERMINAL',
        });
        return;
      }

      // Reject transition to 'converted' (separate flow)
      const currentState = candidate.state;
      if (currentState === 'converted') {
        res.status(400).json({ error: 'Cannot update converted candidates' });
        return;
      }

      if (currentState === newState) {
        // No-op — return current state
        res.json({ success: true, id: candidate.id, state: newState });
        return;
      }

      await db
        .update(jobSourcedCandidates)
        .set({ state: newState, updatedAt: new Date() })
        .where(eq(jobSourcedCandidates.id, candidateId));

      // Feedback capture (non-blocking, best-effort)
      if (process.env.FEEDBACK_CAPTURE_ENABLED === 'true'
        && ['shortlisted', 'hidden', 'converted'].includes(newState)) {
        try {
          const { randomUUID } = await import('crypto');

          // Get candidate summary fields (already on the row)
          const cs = candidate.candidateSummary as Record<string, unknown> | null;
          const snap = cs?.snapshot as Record<string, unknown> | null;

          // Get run-level context for trackDecision
          let roleFamily: string | null = null;
          let seniorityBand: string | null = null;
          let locationCountryCode: string | null = null;

          // roleFamily and seniorityBand from candidate summary
          roleFamily = (snap?.roleType as string) ?? null;
          seniorityBand = (snap?.seniorityBand as string) ?? null;

          // countryCode from candidate summary (populated by Signal results API)
          locationCountryCode = (cs?.countryCode as string) ?? null;

          const eventId = randomUUID();

          await db.insert(recruiterFeedbackEvents).values({
            organizationId,
            jobId: jobId,
            userId: req.user!.id,
            signalCandidateId: candidate.signalCandidateId,
            action: newState,
            eventId,
            rankAtTime: (cs?.rank as number) ?? null,
            fitScoreAtTime: candidate.fitScore ?? null,
            sourceTypeAtTime: (cs?.sourceType as string) ?? null,
            matchTierAtTime: (cs?.matchTier as string) ?? null,
            locationMatchAtTime: (cs?.locationMatchType as string) ?? null,
            roleFamily,
            locationCountryCode,
            seniorityBand,
          }).onConflictDoNothing();

          // Forward-sync to ActiveKG (fire-and-forget, never blocks response)
          if (signalTenantId && process.env.ACTIVEKG_BASE_URL && process.env.FEEDBACK_FORWARD_SYNC_ENABLED === 'true') {
            import('./lib/services/activekg-client').then(({ ingestFeedbackEvents }) => {
              ingestFeedbackEvents(signalTenantId, [{
                tenant_id: signalTenantId,
                job_id: String(jobId),
                recruiter_id: String(req.user!.id),
                signal_candidate_id: candidate.signalCandidateId,
                action: newState,
                rank_at_time: (cs?.rank as number) ?? null,
                fit_score_at_time: candidate.fitScore ?? null,
                source_type_at_time: (cs?.sourceType as string) ?? null,
                match_tier_at_time: (cs?.matchTier as string) ?? null,
                location_match_at_time: (cs?.locationMatchType as string) ?? null,
                role_family: roleFamily,
                location_country_code: locationCountryCode,
                seniority_band: seniorityBand,
                event_id: eventId,
              }]).catch((syncErr: unknown) => {
                console.error('[FEEDBACK] ActiveKG forward-sync failed (non-blocking):', {
                  eventId, error: syncErr instanceof Error ? syncErr.message : syncErr
                });
              });
            });
          }
        } catch (feedbackErr) {
          // Non-blocking: feedback capture failure must never break the state update
          console.error('[FEEDBACK] Failed to capture event (non-blocking):', {
            candidateId, newState, error: feedbackErr instanceof Error ? feedbackErr.message : feedbackErr
          });
        }
      }

      res.json({ success: true, id: candidate.id, state: newState });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:id/enrich-batch', requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = parseInt(req.params.id || '', 10);
      if (isNaN(jobId)) {
        res.status(400).json({ error: 'Invalid job ID' });
        return;
      }
      const { candidateIds } = req.body;
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        res.status(400).json({ error: 'Invalid or missing candidateIds' });
        return;
      }

      const contextResult = await resolveAccessibleSignalJobContext(req.user as SignalRouteUser, jobId);
      if (!contextResult.ok) {
        res.status(contextResult.error === 'JOB_NOT_FOUND' ? 404 : 403).json({ error: contextResult.error });
        return;
      }

      // Map local candidate IDs to signal candidate IDs
      const candidates = await db.query.jobSourcedCandidates.findMany({
        where: inArray(jobSourcedCandidates.id, candidateIds)
      });

      const signalCandidateIds = candidates.map((c: (typeof candidates)[number]) => c.signalCandidateId).filter((id: string | null): id is string => id !== null);

      if (signalCandidateIds.length === 0) {
        res.status(400).json({ error: 'No valid signal candidate IDs found' });
        return;
      }

      const { signalTenantId } = contextResult.context;
      if (!signalTenantId) {
        res.status(500).json({ error: 'Tenant ID is missing' });
        return;
      }
      const externalJobId = `vanta:jobs:${jobId}`;

      const response = await enrichBatch(signalTenantId, externalJobId, signalCandidateIds);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/candidates/:candidateId/find-contact', requireRole(['recruiter', 'super_admin']), requireSeat(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = parseInt(req.params.candidateId || '', 10);
      if (isNaN(candidateId)) {
        res.status(400).json({ error: 'Invalid candidate ID' });
        return;
      }

      // Need signalTenantId for the candidate. Since candidates are job-scoped, we look up the candidate.
      const candidate = await db.query.jobSourcedCandidates.findFirst({
        where: eq(jobSourcedCandidates.id, candidateId),
      });

      if (!candidate) {
        res.status(404).json({ error: 'Candidate not found' });
        return;
      }

      const contextResult = await resolveAccessibleSignalJobContext(req.user as SignalRouteUser, candidate.jobId);
      if (!contextResult.ok) {
        res.status(contextResult.error === 'JOB_NOT_FOUND' ? 404 : 403).json({ error: contextResult.error });
        return;
      }

      const { signalTenantId } = contextResult.context;
      if (!signalTenantId) {
        res.status(500).json({ error: 'Tenant ID is missing' });
        return;
      }
      const signalCandidateId = candidate.signalCandidateId;
      if (!signalCandidateId) {
        res.status(400).json({ error: 'Candidate has no signal ID' });
        return;
      }
      const response = await findContact(signalTenantId, signalCandidateId);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });
}
