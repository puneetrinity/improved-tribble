/**
 * Candidate Semantic Search & Move Routes
 *
 * POST /api/candidates/semantic-search  — search org candidates via ActiveKG
 * POST /api/candidates/move-to-job      — clone a candidate application to another job
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireRole, requireSeat } from './auth';
import { getUserOrganization } from './lib/organizationService';
import { storage } from './storage';
import { getTenantStrategy, resolveActiveKGTenantId } from './lib/activekgTenant';
import { MIN_RESUME_TEXT_LENGTH } from './lib/applicationGraphSyncProcessor';
import { getSearchDefaults } from './lib/activekgSearchConfig';
import { search as activekgSearch, type ActiveKGSearchResult, type ActiveKGSearchResponse } from './lib/services/activekg-client';
import type { CsrfMiddleware } from './types/routes';
import { db } from './db';
import { applicationStageHistory, applications, organizations, type Application } from '@shared/schema';
import { and, inArray, sql } from 'drizzle-orm';
import { pickInitialPipelineStage } from './lib/pipelineStageSelection';
import { privacyAllowedSql } from './candidate-privacy/decision';

// ── Validation schemas ─────────────────────────────────────────────

const semanticSearchSchema = z.object({
  query: z.string().min(1).max(2000),
  top_k: z.number().int().min(1).max(100).optional(),
  use_reranker: z.boolean().optional(),
  metadata_filters: z.record(z.unknown()).optional(),
});

const moveToJobSchema = z.object({
  sourceApplicationId: z.number().int().positive().optional(),
  applicationId: z.number().int().positive().optional(), // backward-compat alias
  targetJobId: z.number().int().positive(),
  targetStageId: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
  searchQuery: z.string().max(2000).optional(),
}).refine((v) => Boolean(v.sourceApplicationId ?? v.applicationId), {
  message: 'sourceApplicationId (or applicationId) is required',
  path: ['sourceApplicationId'],
});

// ── Helpers ────────────────────────────────────────────────────────

interface GroupedResult {
  applicationId: number;
  bestScore: number; // ranking score returned by ActiveKG for the selected scoring mode
  bestVectorScore: number | null; // true cosine similarity when provided by ActiveKG
  matchedChunks: number;
  highlights: string[];
}

type SemanticScoreType = 'rrf_fused' | 'weighted_fusion' | 'cosine' | 'unknown';

interface SearchDiagnostics {
  mode: 'org_private' | 'super_admin_global';
  tenantIds: string[];
  activekgRawCount: number;
  groupedApplicationCount: number;
  hydratedApplicationCount: number;
  droppedApplicationCount: number;
  droppedApplicationIds: number[];
}

/**
 * Group ActiveKG search results by application_id, keeping the best
 * similarity score and collecting highlight snippets per application.
 */
function groupByApplication(results: ActiveKGSearchResult[]): GroupedResult[] {
  const map = new Map<number, GroupedResult>();

  for (const r of results) {
    const appId = Number(r.metadata?.application_id ?? r.props?.application_id);
    if (!Number.isFinite(appId) || appId <= 0) continue;
    const vectorScore = normalizeUnitScore(r.vector_similarity);

    const existing = map.get(appId);
    const snippet = String(r.props?.text ?? r.props?.chunk_text ?? '').slice(0, 300);

    if (existing) {
      if (r.similarity > existing.bestScore) {
        existing.bestScore = r.similarity;
      }
      if (vectorScore != null && (existing.bestVectorScore == null || vectorScore > existing.bestVectorScore)) {
        existing.bestVectorScore = vectorScore;
      }
      existing.matchedChunks += 1;
      if (snippet && !existing.highlights.includes(snippet) && existing.highlights.length < 3) {
        existing.highlights.push(snippet);
      }
    } else {
      map.set(appId, {
        applicationId: appId,
        bestScore: r.similarity,
        bestVectorScore: vectorScore,
        matchedChunks: 1,
        highlights: snippet ? [snippet] : [],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.bestScore - a.bestScore);
}

function scoreTypeFromSearchMode(value: unknown): SemanticScoreType {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('rrf')) return 'rrf_fused';
  if (normalized.includes('weighted')) return 'weighted_fusion';
  if (normalized.includes('cosine')) return 'cosine';
  return 'unknown';
}

function normalizeUnitScore(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function inferScoreType(useHybrid: boolean): SemanticScoreType {
  if (!useHybrid) return 'cosine';
  const rrfEnabledRaw = (process.env.HYBRID_RRF_ENABLED ?? 'true').toString().trim().toLowerCase();
  const rrfEnabled = rrfEnabledRaw !== 'false' && rrfEnabledRaw !== '0';
  return rrfEnabled ? 'rrf_fused' : 'weighted_fusion';
}

function scoreTypeFromResponse(response: ActiveKGSearchResponse): SemanticScoreType {
  const fromScoreType = scoreTypeFromSearchMode(response.score_type);
  if (fromScoreType !== 'unknown') return fromScoreType;
  return scoreTypeFromSearchMode(response.search_mode);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractEmailFromText(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractNameFromText(text: string): string | null {
  const firstLine = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return null;

  let candidate = firstLine.replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
  const delimiterMatches = [
    candidate.indexOf('|'),
    candidate.indexOf(';'),
    candidate.indexOf(','),
    candidate.indexOf(' - '),
    candidate.indexOf(' – '),
    candidate.indexOf(' — '),
  ].filter((idx) => idx > 0);
  const cutAt = delimiterMatches.length > 0 ? Math.min(...delimiterMatches) : -1;
  if (cutAt > 0) {
    candidate = candidate.slice(0, cutAt).trim();
  }

  candidate = candidate
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, ' ')
    .replace(/\+?\d[\d\s()-]{7,}\d/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!candidate || candidate.length < 3) return null;
  if (!/[A-Za-z]/.test(candidate)) return null;

  const words = candidate.split(' ');
  const upper = candidate.toUpperCase();
  const blacklist = new Set([
    'SUMMARY',
    'PROFILE',
    'RESUME',
    'CURRICULUM VITAE',
  ]);
  if (blacklist.has(upper)) return null;

  if (words.length > 6) {
    candidate = words.slice(0, 6).join(' ');
  }
  if (candidate.length > 60) {
    candidate = candidate.slice(0, 60).trim();
  }

  return candidate;
}

// ── Route registration ─────────────────────────────────────────────

export function registerCandidateSemanticRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware,
) {
  app.get(
    '/api/candidates/external-resume',
    requireRole(['recruiter', 'super_admin']),
    requireSeat({ allowNoOrg: true }),
    (_req: Request, res: Response): void => {
      res.status(410).json({ code: 'EXTERNAL_RESUME_PROXY_RETIRED' });
    },
  );

  /**
   * POST /api/candidates/semantic-search
   *
   * Search the recruiter's org candidates via ActiveKG vector search.
   * Returns hydrated application rows with match scores and highlights.
   */
  app.post(
    '/api/candidates/semantic-search',
    requireRole(['recruiter', 'super_admin']),
    requireSeat({ allowNoOrg: true }),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // ── Auth & org ─────────────────────────────────────────
        const orgResult = await getUserOrganization(req.user!.id);
        const isSuperAdmin = req.user!.role === 'super_admin';

        if (!orgResult && !isSuperAdmin) {
          res.status(403).json({ error: 'You must belong to an organization' });
          return;
        }
        const orgId = orgResult?.organization.id;

        // ── Validate body ──────────────────────────────────────
        const parsed = semanticSearchSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
          return;
        }
        const { query, top_k, use_reranker, metadata_filters } = parsed.data;

        // ── Resolve config ─────────────────────────────────────
        const defaults = getSearchDefaults();
        const tenantId = orgId != null ? resolveActiveKGTenantId(orgId) : 'default';
        const isSuperAdminGlobalSearch = isSuperAdmin && defaults.allowGlobalSuperAdmin && !orgResult;

        if (!orgId && !isSuperAdminGlobalSearch) {
          res.status(403).json({ error: 'You must belong to an organization to search candidates' });
          return;
        }

        // ── Check feature gate ─────────────────────────────────
        if (!process.env.ACTIVEKG_BASE_URL) {
          res.status(503).json({ error: 'Semantic search is not configured' });
          return;
        }

        // ── Call ActiveKG /search ──────────────────────────────
        const requestedTopK = top_k ?? defaults.topK;
        // Memory already applies its own directive fence. Flow can still have
        // a newer local restriction waiting in the outbox, so over-fetch to
        // the bounded provider maximum and apply the authoritative Flow SQL
        // fence before the caller-visible limit. If that bounded window is
        // exhausted and cannot fill the requested page, return uncertainty
        // instead of silently presenting an incomplete ranking.
        const privacyCandidateFetchLimit = 100;
        const searchPayloadBase = {
          query,
          top_k: privacyCandidateFetchLimit,
          use_hybrid: defaults.mode === 'hybrid',
          use_reranker: use_reranker ?? defaults.useReranker,
        };
        const superAdminSearchPayload = {
          ...searchPayloadBase,
          top_k: 100,
          use_reranker: false,
        };

        let activekgResults: ActiveKGSearchResult[] = [];
        let providerResultSaturated = false;
        let scoreType: SemanticScoreType = inferScoreType(searchPayloadBase.use_hybrid);
        const strategy = getTenantStrategy();
        const searchedTenants: string[] = [];
        if (isSuperAdminGlobalSearch) {
          if (strategy === 'org_scoped') {
            const orgRows = await db.select({ id: organizations.id }).from(organizations) as Array<{ id: number }>;
            const tenantIds: string[] = orgRows.map((row) => resolveActiveKGTenantId(row.id));
            // Compatibility: include shared default tenant to surface legacy indexed data.
            tenantIds.push('default');
            const uniqueTenantIds: string[] = Array.from(new Set(tenantIds));
            searchedTenants.push(...uniqueTenantIds);

            if (uniqueTenantIds.length > 0) {
              const responses = await Promise.all(
                uniqueTenantIds.map((tenant) =>
                  activekgSearch(tenant, {
                    ...superAdminSearchPayload,
                    tenant_id: tenant,
                    ...(metadata_filters && { metadata_filters }),
                  }),
                ),
              );
              const scored = responses.map((r) => scoreTypeFromResponse(r));
              const explicit = scored.find((s) => s !== 'unknown');
              if (explicit) scoreType = explicit;
              activekgResults = responses.flatMap((r) => r.results);
              providerResultSaturated = responses.some(
                (response) => response.results.length >= privacyCandidateFetchLimit,
              );
            }
          } else {
            searchedTenants.push(tenantId);
            const response = await activekgSearch(tenantId, {
              ...superAdminSearchPayload,
              tenant_id: tenantId,
              ...(metadata_filters && { metadata_filters }),
            });
            const explicit = scoreTypeFromResponse(response);
            if (explicit !== 'unknown') scoreType = explicit;
            activekgResults = response.results;
            providerResultSaturated = response.results.length >= privacyCandidateFetchLimit;
          }
        } else {
          searchedTenants.push(tenantId);
          const response = await activekgSearch(tenantId, {
            ...searchPayloadBase,
            tenant_id: tenantId,
            metadata_filters: {
              ...metadata_filters,
              source: 'vantahire',
              org_id: orgId,
            },
          });
          const explicit = scoreTypeFromResponse(response);
          if (explicit !== 'unknown') scoreType = explicit;
          activekgResults = response.results;
          providerResultSaturated = response.results.length >= privacyCandidateFetchLimit;
        }

        // ── Group by application ───────────────────────────────
        const grouped = groupByApplication(activekgResults);
        const searchDiagnostics: SearchDiagnostics = {
          mode: isSuperAdminGlobalSearch ? 'super_admin_global' : 'org_private',
          tenantIds: searchedTenants,
          activekgRawCount: activekgResults.length,
          groupedApplicationCount: grouped.length,
          hydratedApplicationCount: 0,
          droppedApplicationCount: 0,
          droppedApplicationIds: [],
        };
        if (!isSuperAdminGlobalSearch && grouped.length === 0) {
          res.json({
            query,
            count: 0,
            scoreType,
            displayScoreType: scoreType,
            searchDiagnostics,
            scoreDiagnostics: {
              topRawScore: null,
              bottomRawScore: null,
              spreadRawScore: null,
              rankingTopRawScore: null,
              rankingBottomRawScore: null,
              rankingSpreadRawScore: null,
              resultCount: 0,
            },
            results: [],
            candidates: [],
            total: 0,
          });
          return;
        }

        // ── Hydrate applications ───────────────────────────────
        const appIds = grouped.map((g) => g.applicationId);
        let apps: Application[] = [];
        if (appIds.length > 0) {
          apps = isSuperAdminGlobalSearch
            ? await db.select().from(applications).where(and(
                inArray(applications.id, appIds),
                sql.raw(privacyAllowedSql('application', 'applications.id', { globalUse: true })),
              ))
            : await storage.getApplicationsByIdsForOrg(appIds, orgId!);
        }
        const appMap = new Map(apps.map((a) => [a.id, a]));
        const droppedApplicationIds = grouped
          .map((g) => g.applicationId)
          .filter((applicationId) => !appMap.has(applicationId));
        searchDiagnostics.hydratedApplicationCount = apps.length;
        searchDiagnostics.droppedApplicationCount = droppedApplicationIds.length;
        // A filtered hit is deliberately indistinguishable from any other
        // hydration miss. Never return or log the hidden application IDs.
        searchDiagnostics.droppedApplicationIds = [];
        if (droppedApplicationIds.length > 0) {
          console.warn('[SEMANTIC_SEARCH] Dropped ActiveKG hits during hydration', {
            userId: req.user!.id,
            role: req.user!.role,
            organizationId: orgId ?? null,
            mode: searchDiagnostics.mode,
            tenantIds: searchedTenants,
            rawResultCount: activekgResults.length,
            groupedApplicationCount: grouped.length,
            hydratedApplicationCount: apps.length,
            droppedApplicationCount: droppedApplicationIds.length,
          });
        }
        const jobIds = Array.from(new Set(apps.map((a) => a.jobId)));
        const jobs = await storage.getJobsByIds(jobIds);
        const jobMap = new Map(jobs.map((j) => [j.id, j]));
        const stageMap = new Map<number, { name: string }>();
        if (isSuperAdminGlobalSearch) {
          const orgIds = Array.from(new Set(apps.map((a) => a.organizationId).filter((id): id is number => id != null)));
          const stageLists = await Promise.all(orgIds.map((id) => storage.getPipelineStages(id)));
          for (const list of stageLists) {
            for (const stage of list) {
              stageMap.set(stage.id, { name: stage.name });
            }
          }
        } else {
          const stages = await storage.getPipelineStages(orgId!);
          for (const stage of stages) {
            stageMap.set(stage.id, { name: stage.name });
          }
        }

        // ── Build response; application routes remain the only resume object selector ────────
        const results: Array<Record<string, unknown>> = [];
        let usedVectorDisplayForRrf = false;
        for (const g of grouped) {
          const app = appMap.get(g.applicationId);
          if (!app) continue; // filtered out by org isolation

          const stage = app.currentStage ? stageMap.get(app.currentStage) : undefined;
          const job = jobMap.get(app.jobId);
          const useVectorDisplay = scoreType === 'rrf_fused' && g.bestVectorScore != null;
          if (useVectorDisplay) usedVectorDisplayForRrf = true;
          const displayScoreRaw = useVectorDisplay ? g.bestVectorScore! : g.bestScore;

          results.push({
            applicationId: app.id,
            name: app.name,
            email: app.email,
            phone: app.phone,
            currentJobId: app.jobId,
            currentJobTitle: job?.title ?? null,
            currentStageId: app.currentStage ?? null,
            currentStageName: stage?.name ?? null,
            rankingScoreRaw: Number(g.bestScore.toFixed(6)),
            matchScoreRaw: Number(displayScoreRaw.toFixed(6)),
            matchScore: Math.round(displayScoreRaw * 100),
            matchedChunks: g.matchedChunks,
            highlights: g.highlights,
              resume: {
                resumeFilename: app.resumeFilename ?? null,
                previewUrl: null,
                signedUrl: null,
                expiresAt: null,
              },
            source: 'vantahire',
            isExternal: false,
            canMoveToJob: true,
            canOpenResume: Boolean(app.resumeUrl),
          });
        }

        // For super_admin global search, include non-VantaHire/non-application hits too.
        if (isSuperAdminGlobalSearch) {
          const externalMap = new Map<string, {
            bestScore: number;
            bestVectorScore: number | null;
            matchedChunks: number;
            highlights: string[];
            sample: ActiveKGSearchResult;
          }>();

          for (const r of activekgResults) {
            const appId = Number(r.metadata?.application_id ?? r.props?.application_id);
            if (Number.isFinite(appId) && appId > 0 && appMap.has(appId)) {
              continue;
            }

            const key = Number.isFinite(appId) && appId > 0 ? `app:${appId}` : `node:${r.id}`;
            const snippet = String(r.props?.text ?? r.props?.chunk_text ?? '').slice(0, 300);
            const vectorScore = normalizeUnitScore(r.vector_similarity);
            const existing = externalMap.get(key);

            if (existing) {
              if (r.similarity > existing.bestScore) existing.bestScore = r.similarity;
              if (vectorScore != null && (existing.bestVectorScore == null || vectorScore > existing.bestVectorScore)) {
                existing.bestVectorScore = vectorScore;
              }
              existing.matchedChunks += 1;
              if (snippet && !existing.highlights.includes(snippet) && existing.highlights.length < 3) {
                existing.highlights.push(snippet);
              }
            } else {
              externalMap.set(key, {
                bestScore: r.similarity,
                bestVectorScore: vectorScore,
                matchedChunks: 1,
                highlights: snippet ? [snippet] : [],
                sample: r,
              });
            }
          }

          let syntheticId = -1;
          const externalSorted = Array.from(externalMap.values()).sort((a, b) => b.bestScore - a.bestScore);
          for (const item of externalSorted) {
            const props = (item.sample.props ?? {}) as Record<string, unknown>;
            const metadata = (item.sample.metadata ?? {}) as Record<string, unknown>;
            const textForIdentity = [
              asNonEmptyString(props.text),
              asNonEmptyString(props.chunk_text),
              ...item.highlights,
            ]
              .filter((part): part is string => Boolean(part && part.trim().length > 0))
              .join('\n');
            const extractedName = extractNameFromText(textForIdentity);
            const extractedEmail = extractEmailFromText(textForIdentity);

            const name =
              asNonEmptyString(props.name) ??
              asNonEmptyString(props.full_name) ??
              extractedName ??
              asNonEmptyString(props.title) ??
              asNonEmptyString(metadata.name) ??
              'External Candidate';

            const email =
              asNonEmptyString(props.email) ??
              asNonEmptyString(props.contact_email) ??
              asNonEmptyString(metadata.email) ??
              extractedEmail;

            const phone =
              asNonEmptyString(props.phone) ??
              asNonEmptyString(props.mobile) ??
              asNonEmptyString(metadata.phone);

            const externalResumeFilename =
              asNonEmptyString(props.resume_filename) ??
              asNonEmptyString(metadata.resume_filename) ??
              asNonEmptyString(props.title) ??
              asNonEmptyString(metadata.title);
            const useVectorDisplay = scoreType === 'rrf_fused' && item.bestVectorScore != null;
            if (useVectorDisplay) usedVectorDisplayForRrf = true;
            const displayScoreRaw = useVectorDisplay ? item.bestVectorScore! : item.bestScore;

            results.push({
              applicationId: syntheticId--,
              name,
              email,
              phone,
              currentJobId: null,
              currentJobTitle: null,
              currentStageId: null,
              currentStageName: null,
              rankingScoreRaw: Number(item.bestScore.toFixed(6)),
              matchScoreRaw: Number(displayScoreRaw.toFixed(6)),
              matchScore: Math.round(displayScoreRaw * 100),
              matchedChunks: item.matchedChunks,
              highlights: item.highlights,
              resume: {
                resumeFilename: externalResumeFilename,
                previewUrl: null,
                signedUrl: null,
                expiresAt: null,
              },
              source: asNonEmptyString(metadata.source) ?? asNonEmptyString(props.source) ?? 'external',
              isExternal: true,
              canMoveToJob: false,
              canOpenResume: false,
            });
          }
        }

        const displayScoreType: SemanticScoreType = (
          scoreType === 'rrf_fused' && usedVectorDisplayForRrf
        ) ? 'cosine' : scoreType;

        // Deduplicate by email: keep highest-ranked application per candidate.
        const byEmail = new Map<string, Record<string, unknown>>();
        const withoutEmail: Array<Record<string, unknown>> = [];
        for (const r of results) {
          const email = typeof r.email === 'string' ? r.email.toLowerCase() : null;
          if (!email) {
            withoutEmail.push(r);
            continue;
          }
          const existing = byEmail.get(email);
          if (!existing) {
            byEmail.set(email, r);
            continue;
          }
          const currentScore = Number(r.rankingScoreRaw);
          const existingScore = Number(existing.rankingScoreRaw);
          if (Number.isFinite(currentScore) && currentScore > existingScore) {
            byEmail.set(email, r);
          }
        }
        const privacyFilteredResults = [...byEmail.values(), ...withoutEmail];
        privacyFilteredResults.sort((a, b) => Number(b.rankingScoreRaw) - Number(a.rankingScoreRaw));
        if (
          searchDiagnostics.droppedApplicationCount > 0
          && providerResultSaturated
          && privacyFilteredResults.length < requestedTopK
        ) {
          res.status(503).json({ code: 'candidate_privacy_reconciliation_required' });
          return;
        }
        const finalResults = privacyFilteredResults.slice(0, requestedTopK);

        const rawScores = finalResults
          .map((r) => Number(r.matchScoreRaw))
          .filter((value) => Number.isFinite(value));
        const topRawScore = rawScores.length > 0 ? Math.max(...rawScores) : null;
        const bottomRawScore = rawScores.length > 0 ? Math.min(...rawScores) : null;
        const spreadRawScore = (topRawScore != null && bottomRawScore != null)
          ? Number((topRawScore - bottomRawScore).toFixed(6))
          : null;
        const rankingRawScores = finalResults
          .map((r) => Number(r.rankingScoreRaw))
          .filter((value) => Number.isFinite(value));
        const rankingTopRawScore = rankingRawScores.length > 0 ? Math.max(...rankingRawScores) : null;
        const rankingBottomRawScore = rankingRawScores.length > 0 ? Math.min(...rankingRawScores) : null;
        const rankingSpreadRawScore = (rankingTopRawScore != null && rankingBottomRawScore != null)
          ? Number((rankingTopRawScore - rankingBottomRawScore).toFixed(6))
          : null;

        // Keep both shapes for backward compatibility with in-flight clients.
        res.json({
          query,
          count: finalResults.length,
          scoreType,
          displayScoreType,
          searchDiagnostics: {
            ...searchDiagnostics,
            dedupedCandidateCount: finalResults.length,
          },
          scoreDiagnostics: {
            topRawScore,
            bottomRawScore,
            spreadRawScore,
            rankingTopRawScore,
            rankingBottomRawScore,
            rankingSpreadRawScore,
            resultCount: finalResults.length,
          },
          results: finalResults,
          candidates: finalResults,
          total: finalResults.length,
        });
        return;
      } catch (error) {
        console.error('[SEMANTIC_SEARCH] Error:', error);
        next(error);
      }
    },
  );

  /**
   * POST /api/candidates/move-to-job
   *
   * Clone an application to a different job (within the same org).
   * Deduplicates by target job + email. Enqueues ActiveKG sync for the clone.
   */
  app.post(
    '/api/candidates/move-to-job',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // ── Auth & org ─────────────────────────────────────────
        const orgResult = await getUserOrganization(req.user!.id);
        if (!orgResult) {
          res.status(403).json({ error: 'You must belong to an organization' });
          return;
        }
        const orgId = orgResult.organization.id;

        // ── Validate body ──────────────────────────────────────
        const parsed = moveToJobSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
          return;
        }
        const sourceApplicationId = parsed.data.sourceApplicationId ?? parsed.data.applicationId!;
        const { targetJobId, targetStageId, notes, searchQuery } = parsed.data;

        // ── Load source application (org-scoped) ───────────────
        const [sourceApp] = await storage.getApplicationsByIdsForOrg([sourceApplicationId], orgId);
        if (!sourceApp) {
          res.status(404).json({ error: 'Application not found in your organization' });
          return;
        }

        // ── Validate target job belongs to same org ────────────
        const [targetJob] = await storage.getJobsByIds([targetJobId]);
        if (!targetJob || targetJob.organizationId !== orgId) {
          res.status(404).json({ error: 'Target job not found in your organization' });
          return;
        }

        // ── Dedupe: check if candidate already applied to target job
        const existing = await storage.findApplicationByJobAndEmail(targetJobId, sourceApp.email);
        if (existing) {
          res.status(200).json({
            success: true,
            existing: true,
            applicationId: existing.id,
          });
          return;
        }

        // ── Resolve initial pipeline stage for target job ──────
        let initialStageId: number | null = null;
        let moveNotes = notes;
        try {
          const stages = await storage.getPipelineStages(orgId);
          if (stages.length > 0) {
            if (targetStageId) {
              const explicit = stages.find((s) => s.id === targetStageId);
            if (!explicit) {
              res.status(400).json({ error: 'Invalid targetStageId for your organization' });
              return;
            }
            initialStageId = explicit.id;
          } else {
            const initialStage = pickInitialPipelineStage(stages, orgId);
            initialStageId = initialStage?.id ?? null;
          }
        }
      } catch {
          // non-blocking
        }

        if (!moveNotes) {
          moveNotes = 'Added to another job via semantic search';
        }

        const now = new Date();

        // ── Clone application ──────────────────────────────────
        const cloned = await storage.createApplication({
          name: sourceApp.name,
          email: sourceApp.email,
          phone: sourceApp.phone,
          jobId: targetJobId,
          resumeUrl: sourceApp.resumeUrl,
          whatsappConsent: true,
          resumeFilename: sourceApp.resumeFilename,
          coverLetter: sourceApp.coverLetter ?? undefined,
          extractedResumeText: sourceApp.extractedResumeText ?? undefined,
          submittedByRecruiter: true,
          createdByUserId: req.user!.id,
          source: 'internal_move',
          sourceMetadata: {
            movedFromApplicationId: sourceApp.id,
            movedFromJobId: sourceApp.jobId,
            movedByUserId: req.user!.id,
            movedAt: now.toISOString(),
            semanticQuery: searchQuery ?? null,
            notes: notes ?? null,
          },
          organizationId: orgId,
          ...(initialStageId !== null && {
            currentStage: initialStageId,
            stageChangedAt: now,
            stageChangedBy: req.user!.id,
          }),
        });

        // ── Record stage history if initial stage assigned ──────
        if (initialStageId !== null) {
          try {
            await db.insert(applicationStageHistory).values({
              applicationId: cloned.id,
              fromStage: null,
              toStage: initialStageId,
              changedBy: req.user!.id,
              notes: moveNotes,
            });
          } catch {
            // non-blocking
          }
        }

        // ── Enqueue ActiveKG sync for the clone (non-blocking) — only if resume text is valid ─
        if (process.env.ACTIVEKG_SYNC_ENABLED === 'true') {
          const clonedResumeText = sourceApp.extractedResumeText;
          const hasValidResumeText = clonedResumeText && clonedResumeText.trim().length >= MIN_RESUME_TEXT_LENGTH;
          if (hasValidResumeText) {
            try {
              const tenantId = resolveActiveKGTenantId(orgId);
              await storage.enqueueApplicationGraphSyncJob({
                applicationId: cloned.id,
                organizationId: orgId,
                jobId: targetJobId,
                effectiveRecruiterId: req.user!.id,
                activekgTenantId: tenantId,
              });
            } catch (syncErr) {
              console.error('[SEMANTIC_MOVE] Failed to enqueue graph sync:', {
                clonedApplicationId: cloned.id,
                error: syncErr,
              });
            }
          } else {
            // Record why sync was skipped so it can be requeued after backfill
            storage.updateApplicationSyncSkippedReason(
              cloned.id,
              !clonedResumeText ? 'resume_text_missing' : 'resume_text_below_threshold'
            ).catch(err => console.error('[SEMANTIC_MOVE] Failed to record skip reason:', err));
          }
        }

        res.status(201).json({
          success: true,
          existing: false,
          applicationId: cloned.id,
        });
        return;
      } catch (error) {
        console.error('[SEMANTIC_MOVE] Error:', error);
        next(error);
      }
    },
  );
}
