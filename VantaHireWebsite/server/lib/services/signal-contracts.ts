/**
 * Signal API contract types for Vanta ↔ Signal integration.
 *
 * These types match the live Signal v3 API routes:
 * - POST /api/v3/jobs/{externalJobId}/source  (pepolehub/src/app/api/v3/jobs/[id]/source/route.ts)
 * - GET  /api/v3/jobs/{externalJobId}/results (pepolehub/src/app/api/v3/jobs/[id]/results/route.ts)
 * - Callback: pepolehub/src/lib/sourcing/callback.ts + types.ts
 *
 * Raw Signal source_type values are stored as-is; fit scores are normalized at ingest.
 * UI-level derivations happen at read time.
 */

// =====================================================
// SOURCE TYPES (raw Signal values — store as-is)
// =====================================================

/** Raw Signal source type values. Never map/transform before storage. */
export type SignalSourceType = 'pool_enriched' | 'pool' | 'discovered';

/** UI display bucket — derived at read time, never stored. */
export type SourceDisplayBucket = 'talent_pool' | 'newly_discovered';

/** Derive UI bucket from raw Signal source type. */
export function toDisplayBucket(sourceType: SignalSourceType): SourceDisplayBucket {
  return sourceType === 'pool_enriched' || sourceType === 'pool'
    ? 'talent_pool'
    : 'newly_discovered';
}

// =====================================================
// SIGNAL POST /api/v3/jobs/{externalJobId}/source
// =====================================================

/** Request body for Signal POST /api/v3/jobs/{externalJobId}/source */
export interface SignalSourceRequest {
  jobContext: {
    jdDigest: string;                       // required — Vanta's pre-analyzed JD digest (JSON-stringified)
    title?: string;
    skills?: string[];
    goodToHaveSkills?: string[];
    location?: string;
    experienceYears?: number;
    education?: string;
  };
  callbackUrl: string;                      // Vanta webhook URL for async results
}

/**
 * Response from Signal POST /api/v3/jobs/{externalJobId}/source.
 *
 * Three cases:
 * - New request created:     { success, requestId, status: 'queued', idempotent: false }
 * - Idempotent hit:          { success, requestId, status: <existing>, idempotent: true }
 * - Retried failed request:  { success, requestId, status: 'queued', idempotent: false, retried: true }
 */
export interface SignalSourceResponse {
  success: boolean;
  requestId: string;                        // Signal's internal sourcing request ID
  status: string;                           // 'queued' for new, or existing status for idempotent
  idempotent: boolean;
  retried?: boolean;
  error?: string;
}

// =====================================================
// SIGNAL GET /api/v3/jobs/{externalJobId}/results
// =====================================================

/** Response from Signal GET /api/v3/jobs/{externalJobId}/results?requestId=... */
export interface SignalResultsResponse {
  requestId: string;
  externalJobId: string;
  resultCount: number | null;
  data: SignalResultCandidateV3[];
  error?: string;
  
  // These are kept optional in case we need them for back-compat or future use
  success?: boolean;
  status?: string;
  callbackStatus?: string | null;
  callbackSentAt?: string | null;
  requestedAt?: string;
  completedAt?: string | null;
  lastRerankedAt?: string | null;
  diagnostics?: Record<string, unknown> | null;
  trackDecision?: Record<string, unknown> | null;
  groupCounts?: SignalResultsGroupCounts | null;
  snapshotStats?: Record<string, unknown> | null;
}

export interface SignalResultsGroupCounts {
  bestMatches: number;
  broaderPool: number;
  strictMatchedCount?: number;
  expandedCount?: number;
  expansionReason?: string | null;
  requestedLocation?: string | null;
  strictDemotedCount?: number;
  strictRescuedCount?: number;
  strictRescueApplied?: boolean;
  strictRescueMinFitScoreUsed?: number | null;
  countryGuardFilteredCount?: number;
  minDiscoveryPerRunApplied?: number;
  minDiscoveredInOutputApplied?: number;
  discoveredPromotedCount?: number;
  discoveredPromotedInTopCount?: number;
  discoveredOrphanCount?: number;
  discoveredOrphanQueued?: number;
  locationMatchCounts?: Record<string, number> | null;
  demotedStrictWithCityMatch?: number;
  strictBeforeDemotion?: number;
  selectedSnapshotTrack?: string | null;
}

export interface SignalResultCandidateV3 {
  // --- NEW UNIFIED CARD SCHEMA ---
  candidate: {
    id: string;
    name: string | null;
    linkedinUrl: string | null;
    headline: string | null;
    location: string | null;
    company: string | null;
    
    // Legacy hints
    nameHint?: string | null;
    headlineHint?: string | null;
    locationHint?: string | null;
    companyHint?: string | null;
    enrichmentStatus?: string | null;
    confidenceScore?: number | null;
    lastEnrichedAt?: string | null;
    profilePictureUrl?: string | null;
  };
  sourcingContext: {
    rank: number;
    matchStrength: 'strong' | 'good' | 'possible';
    locationStatus: 'verified' | 'partial' | 'unverified' | 'mismatch' | 'unknown';
  };
  cardSignals: {
    skillsTopN: string[];
    summaryShort: string | null;
    emailAvailable: boolean;
    phoneAvailable?: boolean;
    activeSeeker: boolean;
    email?: string | null;
    phone?: string | null;
    github?: string | null;
    twitter?: string | null;
  };

  // --- DETAILED FIELDS FOR DETAIL VIEW ---
  candidateId?: string; // used by some legacy mapping
  sourceType?: string;
  rank?: number;
  fitScore?: number | null;
  fitBreakdown?: Record<string, unknown> | null;
  matchTier?: string | null;
  locationMatchType?: string | null;
  dataConfidence?: string | null;
  professionalValidation?: Record<string, unknown> | null;
  locationLabel?: string | null;
  snapshot?: Record<string, unknown> | null;
  identitySummary?: SignalIdentitySummary | null;
  aiSummary?: { text: string; skills: string[] } | null;
  freshness?: { lastEnrichedAt?: string | null };
}

export type IdentityDisplayStatus = 'verified' | 'review' | 'weak';

export interface SignalIdentitySummary {
  bestBridgeTier: number | null;
  maxIdentityConfidence: number | null;
  hasConfirmedIdentity: boolean;
  needsReview: boolean;
  platforms: string[];
  displayStatus: IdentityDisplayStatus;
  lastIdentityCheckAt: string | null;       // ISO 8601
}

export interface SignalCandidateDetail {
  id: string;
  linkedinUrl: string | null;
  linkedinId: string | null;
  nameHint: string | null;
  headlineHint: string | null;
  locationHint: string | null;
  companyHint: string | null;
  searchSnippet?: string | null;
  searchMeta?: Record<string, unknown> | null;
  searchProvider?: string | null;
  searchSignals?: SignalSearchSignals | null;
  enrichmentStatus: string;
  confidenceScore: number | null;
  lastEnrichedAt: string | null;            // ISO 8601
  intelligenceSnapshots: SignalIntelligenceSnapshot[];
}

export interface SignalSearchSignals {
  serpDate?: string | null;
  linkedinHost?: string | null;
  linkedinLocale?: string | null;
}

export interface SignalIntelligenceSnapshot {
  skillsNormalized: unknown;
  roleType: string;
  seniorityBand: string;
  location: string;
  computedAt: string;                       // ISO 8601
  staleAfter: string;                       // ISO 8601
}

// =====================================================
// SIGNAL CALLBACK (webhook POST to Vanta)
// =====================================================

/**
 * Callback JWT claims (from Signal's callback.ts signCallbackJWT):
 * - iss: 'signal', aud: 'vantahire', sub: 'sourcing'
 * - Custom claims (snake_case): tenant_id, request_id, scopes: 'callbacks:write'
 * - Standard: jti (uuid), iat, exp (5m)
 *
 * Verified by jwt-signer.ts verifySignalCallbackJwt().
 */

/** HTTP body of Signal callback POST (SourcingCallbackPayload from Signal types.ts) */
export interface SignalCallbackPayload {
  version: 1;
  requestId: string;                        // camelCase in body (NOT snake_case)
  externalJobId: string;
  status: 'complete' | 'partial' | 'failed';
  candidateCount: number;
  enrichedCount: number;
  error?: string;
  /** Optional event type for partial updates */
  event?: 'candidate_enriched' | 'sourcing_started' | 'discovery_completed';
  /** Optional candidate data for 'candidate_enriched' event */
  candidateData?: any;
}

// =====================================================
// CONTEXT HASH
// =====================================================

/** Fields included in context hash computation. Order is fixed for determinism. */
export interface ContextHashInput {
  jdDigest: Record<string, unknown> | null;
  jdDigestVersion: number | null;
  title: string;
  skills: string[];
  goodToHaveSkills: string[];
  location: string;
  experienceYears: number | null;
  educationRequirement: string | null;
  contextVersion: number;                   // bump to force re-run on hash logic changes
}

/** Current context hash version. Bump when hash input fields change. */
export const CONTEXT_HASH_VERSION = 4;

// =====================================================
// SOURCING RUN STATUS (Vanta-side)
// =====================================================

export type SourcingRunStatus = 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'expired';

/** Terminal statuses — no further transitions allowed. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<SourcingRunStatus> = new Set(['completed', 'failed', 'expired']);

/** Check if a run is in a terminal state. */
export function isTerminalStatus(status: SourcingRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/**
 * Map Signal callback status to Vanta run status.
 * Signal sends: 'complete' | 'partial' | 'failed'
 * Vanta stores: 'completed' | 'failed'
 * 'partial' maps to 'completed' (results are available, even if incomplete).
 */
export function mapCallbackStatusToRunStatus(callbackStatus: SignalCallbackPayload['status']): 'completed' | 'failed' {
  return callbackStatus === 'failed' ? 'failed' : 'completed';
}

// =====================================================
// UI RESPONSE TYPES
// =====================================================

export type CandidateMatchTier = 'best_matches' | 'broader_pool';
export type CandidateLocationMatchType = 'city_exact' | 'city_alias' | 'country_only' | 'unknown_location' | 'none';

/** Flattened candidate shape for UI consumption. */
export interface SourcedCandidateForUI {
  id: number;
  jobId: number;
  signalCandidateId: string;
  signalRank: number | null;
  fitScore: number | null;
  fitScoreRaw: number | null;
  fitBreakdown: Record<string, unknown> | null;
  sourceType: SignalSourceType;
  displayBucket: SourceDisplayBucket;
  state: 'new' | 'shortlisted' | 'hidden' | 'converted';
  foundEmail: string | null;
  foundEmails: string[] | null;
  emailResolvedAt: string | null;
  emailResolveStatus: 'pending' | 'resolved' | 'not_found' | 'failed' | null;
  lastOutreachAt: string | null;
  lastOutreachStatus: 'sent' | 'failed' | null;

  // Flattened from candidateSummary
  crustdata: Record<string, any> | null;
  linkedinUrl: string | null;
  profilePictureUrl: string | null;
  enrichmentStatus: string | null;
  confidenceScore: number | null;
  searchSnippet: string | null;
  searchProvider: string | null;
  searchSignals: {
    serpDate: string | null;
    serpDateDaysAgo: number | null;
    linkedinHost: string | null;
    linkedinLocale: string | null;
  };

  cardSignals: {
    email: string | null;
    phone: string | null;
    github: string | null;
    twitter: string | null;
    skillsTopN: string[];
    activeSeeker: boolean;
    summaryShort: string | null;
    emailAvailable: boolean;
    phoneAvailable: boolean;
  } | null;

  // Tiering/quality metadata (additive, null-safe)
  matchTier: CandidateMatchTier | null;
  locationMatchType: CandidateLocationMatchType | null;
  dataConfidence: 'high' | 'medium' | 'low' | null;
  roleScore: number | null;
  experienceScore: number | null;

  // Identity (extracted from candidateSummary.identitySummary)
  identitySummary: SignalIdentitySummary | null;

  // AI Summary (extracted from candidateSummary.aiSummary)
  aiSummary: { text: string; skills: string[] } | null;

  // Snapshot highlights
  snapshot: {
    skillsNormalized: unknown;
    roleType: string | null;
    seniorityBand: string | null;
    location: string | null;
    computedAt: string | null;
  } | null;

  // Freshness (computed at read time)
  freshness: {
    lastEnrichedAt: string | null;
    lastIdentityCheckAt: string | null;
    enrichedDaysAgo: number | null;
    identityCheckDaysAgo: number | null;
  };

  // Engagement readiness
  engagementReady: boolean;
  locationLabel: string | null;
  locationConfidenceNumeric: number | null;

  // Legacy blob — kept for backward compatibility
  candidateSummary: unknown;

  // Metadata
  lastSyncedAt: string | null;
  createdAt: string | null;
}

/** Normalize fit score to 0-100 integer range regardless of input scale. */
export function toPctFit(fitScore: number | null | undefined): number | null {
  if (fitScore == null || !Number.isFinite(fitScore)) return null;
  const scaled = fitScore <= 1 ? fitScore * 100 : fitScore;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/** Engagement-ready contract — version and change log any threshold changes. */
export const ENGAGEMENT_READY_THRESHOLDS = {
  version: 1,
  minFitScorePct: 55,
  strongLocationTypes: new Set<CandidateLocationMatchType>(['city_exact', 'city_alias', 'country_only']),
  minIdentityConfidence: 0.5,
  blockedEnrichmentStatuses: new Set(['pending']),
} as const;

export function isEngagementReady(opts: {
  fitScorePct: number | null;
  locationMatchType: CandidateLocationMatchType | null;
  locationConfidenceNumeric?: number | null;
  identityConfidence: number | null;
  enrichmentStatus: string | null;
}): boolean {
  const t = ENGAGEMENT_READY_THRESHOLDS;
  
  // If fitScorePct is completely missing, we skip fit criteria
  const fitOk = opts.fitScorePct == null ? true : opts.fitScorePct >= t.minFitScorePct;
  
  // If locationMatchType and confidence are missing, skip location criteria
  const locationOk = opts.locationConfidenceNumeric != null
    ? opts.locationConfidenceNumeric >= 0.6
    : opts.locationMatchType != null 
      ? t.strongLocationTypes.has(opts.locationMatchType)
      : true;
      
  const enrichmentOk = !t.blockedEnrichmentStatuses.has(opts.enrichmentStatus ?? '');
  const identityOk = opts.identityConfidence == null || opts.identityConfidence >= t.minIdentityConfidence;
  return fitOk && locationOk && enrichmentOk && identityOk;
}

function daysAgo(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

function safeString(val: unknown): string | null {
  return typeof val === 'string' ? val : null;
}

function safeNumber(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function safeRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' ? val as Record<string, unknown> : null;
}

function extractIdentitySummary(cs: Record<string, unknown>): SignalIdentitySummary | null {
  const is = cs.identitySummary;
  if (!is || typeof is !== 'object') return null;
  const parsed = is as Record<string, unknown>;
  const displayStatus = parsed.displayStatus;
  if (displayStatus !== 'verified' && displayStatus !== 'review' && displayStatus !== 'weak') return null;
  const platforms = parsed.platforms;
  if (!Array.isArray(platforms) || platforms.some((p) => typeof p !== 'string')) return null;
  return is as SignalIdentitySummary;
}

function extractSnapshot(cs: Record<string, unknown>): SourcedCandidateForUI['snapshot'] {
  const snap = cs.snapshot as Record<string, unknown> | undefined;
  if (!snap || typeof snap !== 'object') return null;
  return {
    skillsNormalized: snap.skillsNormalized ?? null,
    roleType: safeString(snap.roleType),
    seniorityBand: safeString(snap.seniorityBand),
    location: safeString(snap.location),
    computedAt: safeString(snap.computedAt),
  };
}

function extractMatchTier(cs: Record<string, unknown>): CandidateMatchTier | null {
  const val = cs.matchTier;
  return val === 'best_matches' || val === 'broader_pool' ? val : null;
}

function extractLocationMatchType(cs: Record<string, unknown>): CandidateLocationMatchType | null {
  const val = cs.locationMatchType;
  return val === 'city_exact' || val === 'city_alias' || val === 'country_only' || val === 'unknown_location' || val === 'none'
    ? val
    : null;
}

function extractSearchSignals(cs: Record<string, unknown>): SourcedCandidateForUI['searchSignals'] {
  const explicitSignals = safeRecord(cs.searchSignals);
  const explicitSerpDate = safeString(explicitSignals?.serpDate);
  const explicitLinkedinHost = safeString(explicitSignals?.linkedinHost);
  const explicitLinkedinLocale = safeString(explicitSignals?.linkedinLocale);

  const searchMeta = safeRecord(cs.searchMeta);
  const serperMeta = safeRecord(searchMeta?.serper);
  const serpDate = explicitSerpDate ?? safeString(serperMeta?.resultDate);
  const linkedinHost = explicitLinkedinHost ?? safeString(serperMeta?.linkedinHost);
  const linkedinLocale = explicitLinkedinLocale ?? safeString(serperMeta?.linkedinLocale);

  return {
    serpDate,
    serpDateDaysAgo: daysAgo(serpDate),
    linkedinHost,
    linkedinLocale,
  };
}

/** Map a DB row to the flat UI shape. Null-safe throughout. */
export function flattenCandidateForUI(row: {
  id: number;
  jobId: number;
  signalCandidateId: string;
  fitScore: number | null;
  fitBreakdown: unknown;
  sourceType: string;
  state: string;
  foundEmail?: string | null;
  foundEmails?: unknown;
  emailResolvedAt?: Date | string | null;
  emailResolveStatus?: string | null;
  lastOutreachAt?: Date | string | null;
  lastOutreachStatus?: string | null;
  candidateSummary: unknown;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string | null;
}): SourcedCandidateForUI {
  const cs: Record<string, unknown> =
    row.candidateSummary && typeof row.candidateSummary === 'object'
      ? (row.candidateSummary as Record<string, unknown>)
      : {};

  const identitySummary = extractIdentitySummary(cs);
  const snapshot = extractSnapshot(cs);
  const searchSignals = extractSearchSignals(cs);
  const normalizedFitScore = toPctFit(row.fitScore);

  const lastEnrichedAt = safeString((cs as any)?.lastEnrichedAt) ?? safeString(snapshot?.computedAt);
  const lastIdentityCheckAt = identitySummary?.lastIdentityCheckAt ?? null;

  return {
    id: row.id,
    jobId: row.jobId,
    signalCandidateId: row.signalCandidateId,
    signalRank: safeNumber(cs.rank),
    fitScore: normalizedFitScore,
    fitScoreRaw: safeNumber(cs.fitScoreRaw),
    fitBreakdown: (row.fitBreakdown && typeof row.fitBreakdown === 'object'
      ? row.fitBreakdown as Record<string, unknown>
      : null),
    sourceType: (row.sourceType as SignalSourceType) || 'discovered',
    displayBucket: toDisplayBucket((row.sourceType as SignalSourceType) || 'discovered'),
    state: (['new', 'shortlisted', 'hidden', 'converted'].includes(row.state)
      ? row.state
      : 'new') as SourcedCandidateForUI['state'],
    foundEmail: safeString(row.foundEmail),
    foundEmails: Array.isArray(row.foundEmails)
      ? row.foundEmails.filter((email): email is string => typeof email === 'string')
      : null,
    emailResolvedAt: safeString(row.emailResolvedAt),
    emailResolveStatus: (row.emailResolveStatus === 'pending'
      || row.emailResolveStatus === 'resolved'
      || row.emailResolveStatus === 'not_found'
      || row.emailResolveStatus === 'failed'
      ? row.emailResolveStatus
      : null) as SourcedCandidateForUI['emailResolveStatus'],
    lastOutreachAt: safeString(row.lastOutreachAt),
    lastOutreachStatus: (row.lastOutreachStatus === 'sent' || row.lastOutreachStatus === 'failed'
      ? row.lastOutreachStatus
      : null) as SourcedCandidateForUI['lastOutreachStatus'],

    crustdata: ((cs as any)?.candidate?.searchMeta?.crustdata as Record<string, unknown>) || null,
    linkedinUrl: safeString(cs.linkedinUrl) ?? safeString((cs.candidate as any)?.linkedinUrl),
    profilePictureUrl: safeString(cs.profilePictureUrl) ?? safeString((cs.candidate as any)?.profilePictureUrl),
    enrichmentStatus: safeString(cs.enrichmentStatus),
    confidenceScore: typeof cs.confidenceScore === 'number' ? cs.confidenceScore : null,
    searchSnippet: safeString(cs.searchSnippet),
    searchProvider: safeString(cs.searchProvider),
    searchSignals,
    matchTier: extractMatchTier(cs),
    locationMatchType: extractLocationMatchType(cs),
    dataConfidence: cs.dataConfidence === 'high' || cs.dataConfidence === 'medium' || cs.dataConfidence === 'low' ? cs.dataConfidence : null,
    roleScore: safeNumber(cs.roleScore) ?? safeNumber((row.fitBreakdown as any)?.roleScore),
    experienceScore: safeNumber(cs.experienceScore) ?? safeNumber((row.fitBreakdown as any)?.experienceScore),

    cardSignals: (cs.cardSignals && typeof cs.cardSignals === 'object') ? {
      email: safeString((cs.cardSignals as any).email),
      phone: safeString((cs.cardSignals as any).phone),
      github: safeString((cs.cardSignals as any).github),
      twitter: safeString((cs.cardSignals as any).twitter),
      skillsTopN: Array.isArray((cs.cardSignals as any).skillsTopN) ? (cs.cardSignals as any).skillsTopN : [],
      activeSeeker: Boolean((cs.cardSignals as any).activeSeeker),
      summaryShort: safeString((cs.cardSignals as any).summaryShort),
      emailAvailable: Boolean((cs.cardSignals as any).emailAvailable),
      phoneAvailable: Boolean((cs.cardSignals as any).phoneAvailable),
    } : null,

    identitySummary,
    aiSummary: cs.aiSummary && typeof cs.aiSummary === 'object' ? cs.aiSummary as { text: string; skills: string[] } : null,
    snapshot,

    freshness: {
      lastEnrichedAt,
      lastIdentityCheckAt,
      enrichedDaysAgo: daysAgo(lastEnrichedAt),
      identityCheckDaysAgo: daysAgo(lastIdentityCheckAt),
    },

    engagementReady: isEngagementReady({
      fitScorePct: normalizedFitScore,
      locationMatchType: extractLocationMatchType(cs),
      locationConfidenceNumeric: safeNumber(cs.locationConfidence),
      identityConfidence: identitySummary?.maxIdentityConfidence ?? null,
      enrichmentStatus: safeString(cs.enrichmentStatus),
    }),
    locationLabel: safeString(cs.locationLabel),
    locationConfidenceNumeric: safeNumber(cs.locationConfidence),

    candidateSummary: row.candidateSummary,

    lastSyncedAt: row.lastSyncedAt instanceof Date ? row.lastSyncedAt.toISOString() : (row.lastSyncedAt ?? null),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt ?? null),
  };
}

// =====================================================
// AUTH SCOPES (for signServiceJwt)
// =====================================================

/** Signal v3 scopes used by Vanta. */
export const SIGNAL_SCOPES = {
  SOURCE: 'jobs:source',
  RESULTS: 'jobs:results',
  ENRICH_BATCH: 'enrich:batch',
  PDL_CONTACT: 'pdl:contact',
} as const;
