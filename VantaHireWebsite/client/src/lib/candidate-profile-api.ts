// S2 candidate career profile: browser client for the owner-only profile API.
// Contract: ealana-index/CANDIDATE_PRODUCT_S2_UI_CONTRACT.json and the S2 build lock.
// A 202 admission means "accepted for saving", never "saved". Only an applied
// receipt is shown as saved.
import { fetchWithCsrf } from "@/lib/csrf";
import type { z } from "zod";
import type { manualProfileSchema, preferencesSchema } from "@shared/candidate-profile";

export const PROFILE_BASE = "/api/candidate/product/profile";

export type ManualProfile = z.input<typeof manualProfileSchema>;
export type Preferences = z.input<typeof preferencesSchema>;

export type CapabilityReason =
  | "incomplete_profile" | "pending_changes" | "consent_required" | "allowance_used"
  | "source_required" | "recent_auth_required" | "candidate_privacy_restricted" | "feature_unavailable"
  /** spark only: confirming promotes the preferences first, so the page treats this as confirmable. */
  | "preferences_not_promoted";

export type Capabilities = {
  canEdit: boolean; editBlockedReason?: CapabilityReason | null | undefined;
  canConfirm: boolean; confirmBlockedReason?: CapabilityReason | null | undefined;
  canEnrich: boolean; enrichBlockedReason?: CapabilityReason | null | undefined;
  canRequestResume: boolean; resumeBlockedReason?: CapabilityReason | null | undefined;
  /** Live only when the server reports an active network publication. */
  canDiscover?: boolean | undefined; discoveryBlockedReason?: string | null | undefined;
};

export type PendingCommand = { commandId: string; action: string; status: "pending" | "held"; reason: string | null };

export type ProfileRead = {
  schemaVersion: 2;
  state: "draft" | "confirmed" | "restricted" | string;
  draftVersion?: number | undefined; profileVersion?: number | undefined; preferenceVersion?: number | undefined;
  draftHash?: string | null | undefined;
  draft: ManualProfile | null;
  confirmedProfile: ManualProfile | null;
  preferences: Preferences | null;
  confirmedConsentVersion?: number | undefined;
  missingFields?: string[] | undefined;
  sources: unknown[]; proposals: unknown[];
  capabilities: Capabilities;
  publicationActive: boolean;
  matchingState: string;
  pendingCommands?: PendingCommand[] | undefined;
  hasMorePendingCommands?: boolean | undefined;
  code?: string | undefined;
  /** Present when the server returned the spark (v3) read: preferences are saved by section. */
  spark?: SparkProfileRead | undefined;
};

export type Receipt = {
  schemaVersion: 2; commandId: string;
  status: "pending" | "applied" | "rejected" | "held";
  draftVersion?: number | undefined; profileVersion?: number | undefined; preferenceVersion?: number | undefined;
  reason: string | null;
};

type Action = "save_draft" | "save_preferences" | "confirm";
export type CommandBody = {
  schemaVersion: 2; idempotencyKey: string;
  expectedDraftVersion: number; expectedProfileVersion: number; expectedPreferenceVersion: number;
  action: Action; payload: Record<string, unknown>;
};

/** Closed reason catalogue, copied exactly from the UI contract. */
export const REASONS: Record<string, { status: "held" | "rejected"; retryable: boolean; action: string; message: string }> = {
  authority_unavailable: { status: "held", retryable: true, action: "poll_automatic_retry", message: "We couldn't save yet. We'll retry automatically." },
  memory_unavailable: { status: "held", retryable: true, action: "poll_automatic_retry", message: "We couldn't save yet. We'll retry automatically." },
  delivery_outcome_unknown: { status: "held", retryable: true, action: "poll_automatic_retry", message: "We're checking whether your edit was saved. Don't submit it again." },
  stale_edit: { status: "rejected", retryable: false, action: "refetch_and_review", message: "Your profile changed in another session. Review the latest version before saving." },
  confirmation_conflict: { status: "rejected", retryable: false, action: "refetch_and_review", message: "The details changed. Review them again before confirming." },
  incomplete_profile: { status: "rejected", retryable: false, action: "complete_missing_fields", message: "Please complete the highlighted details." },
  source_conflict: { status: "rejected", retryable: false, action: "review_replacements", message: "Some imported details differ from yours. Choose which ones to replace." },
  source_not_found: { status: "rejected", retryable: false, action: "refetch_sources", message: "This source is no longer available." },
  source_version_conflict: { status: "rejected", retryable: false, action: "refetch_sources", message: "This source changed. Review its latest details." },
  source_removed: { status: "rejected", retryable: false, action: "refetch_sources", message: "This source was removed and cannot be used." },
  consent_required: { status: "rejected", retryable: false, action: "review_consent", message: "Your permission is needed for this action." },
  consent_changed: { status: "rejected", retryable: false, action: "review_consent", message: "Your permissions changed. Review them before continuing." },
  candidate_privacy_restricted: { status: "rejected", retryable: false, action: "privacy_controls", message: "This action is unavailable under your current privacy settings." },
  identity_conflict: { status: "held", retryable: false, action: "support", message: "We couldn't safely link this profile. Please contact support." },
  idempotency_conflict: { status: "rejected", retryable: false, action: "refetch_and_review", message: "This save request conflicts with an earlier one. Refresh and review your changes." },
  invalid_request: { status: "rejected", retryable: false, action: "correct_fields", message: "Some details couldn't be saved. Check the highlighted fields." },
  payload_too_large: { status: "rejected", retryable: false, action: "reduce_input", message: "These details are too long. Please shorten them." },
  authentication_changed: { status: "held", retryable: false, action: "sign_in_and_review", message: "Please sign in again and review your pending edit." },
  retry_exhausted: { status: "held", retryable: false, action: "support", message: "We couldn't finish saving. Your pending edit needs support." },
  command_expired: { status: "rejected", retryable: false, action: "refetch_and_review", message: "This pending edit expired. Review your current profile before submitting again." },
  expiry_reconciling: { status: "held", retryable: true, action: "wait_for_server", message: "We're checking whether this older edit was saved. Please wait before submitting it again." },
};

export const GENERIC_ERROR = "Something went wrong and this edit may not have been saved. Refresh to check your profile.";

/** Unknown reasons never claim saved and never imply an automatic retry. */
export type ReasonView = { status: "held" | "rejected"; retryable: boolean; action: string; message: string };
export function describeReason(reason: string | null | undefined): ReasonView {
  const hit = reason && Object.prototype.hasOwnProperty.call(REASONS, reason) ? REASONS[reason] : undefined;
  return hit ?? { status: "rejected", retryable: false, action: "unknown", message: GENERIC_ERROR };
}

export const CAPABILITY_COPY: Record<CapabilityReason, string> = {
  incomplete_profile: "Complete the missing details first.",
  pending_changes: "Wait for your latest edit to finish saving.",
  consent_required: "This needs your permission first.",
  allowance_used: "You've already used this.",
  source_required: "Add a source first.",
  recent_auth_required: "Sign in again to continue.",
  candidate_privacy_restricted: "Unavailable under your current privacy settings.",
  feature_unavailable: "Not available yet.",
  preferences_not_promoted: "Review your job preferences, then confirm.",
};

export class ProfileApiError extends Error {
  /** Set on a rate-limited reply when the server says how long to wait. */
  retryAfterSeconds?: number | undefined;
  constructor(public status: number, public code: string | null, message?: string) { super(message ?? code ?? `HTTP ${status}`); }
}

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

export type ProfileLoad = { kind: "ready"; profile: ProfileRead } | { kind: "disabled" } | { kind: "unavailable" };

/** 404 means the feature is not deployed for this account: render nothing. */
export async function loadProfile(fetcher: typeof fetch = fetch): Promise<ProfileLoad> {
  const res = await fetcher(PROFILE_BASE, { credentials: "include", headers: { Accept: "application/json" } });
  if (res.status === 404) return { kind: "disabled" };
  if (res.status === 503) return { kind: "unavailable" };
  const body = await readJson(res);
  if (res.ok && body?.schemaVersion === 3 && typeof body.draftVersion === "number" && "preferenceDraft" in body) return { kind: "ready", profile: sparkToPanel(body) };
  if (!res.ok || !body || body.schemaVersion !== 2) throw new ProfileApiError(res.status, body?.code ?? null);
  return { kind: "ready", profile: body as ProfileRead };
}

/** The spark read has no `state`: a positive profile version means confirmed. The panel shows
 * the editable preference draft (by section), so a confirmed profile still shows the latest answers. */
export function sparkToPanel(s: SparkProfileRead & { sources?: unknown[]; proposals?: unknown[]; matchingState?: string }): ProfileRead {
  return {
    schemaVersion: 2, state: s.profileVersion > 0 ? "confirmed" : "draft",
    draftVersion: s.draftVersion, profileVersion: s.profileVersion, preferenceVersion: s.preferenceVersion,
    draftHash: s.draftHash, draft: s.draft, confirmedProfile: s.confirmedProfile,
    preferences: preferencesFromSections(s.preferenceDraft?.sections),
    missingFields: s.missingFields, sources: s.sources ?? [], proposals: s.proposals ?? [],
    capabilities: s.capabilities as Capabilities, publicationActive: (s.capabilities as Capabilities).canDiscover === true, matchingState: s.matchingState ?? "not_available",
    pendingCommands: s.pendingCommands, hasMorePendingCommands: s.hasMorePendingCommands, spark: s,
  };
}

/** v3 sections → the panel's preferences shape. Unanswered sections take neutral display
 * defaults; the summary marks those questions "Not answered" rather than implying an answer. */
export function preferencesFromSections(sections: Partial<Record<SparkSection, { answered: boolean; value: unknown }>> | undefined): Preferences | null {
  const val = (k: SparkSection): any => sections?.[k]?.answered ? sections[k]!.value : undefined;
  if (!sections || !Object.values(sections).some(x => x?.answered)) return null;
  const roles = val("roles"), arr = val("arrangement");
  return {
    desiredRoles: roles?.desiredRoles ?? [], preferredSeniority: roles?.preferredSeniority ?? [],
    workArrangements: arr?.workArrangements ?? [], remoteRegions: arr?.remoteRegions ?? null,
    locations: val("location") ?? { mode: "anywhere" }, relocation: val("relocation") ?? { mode: "discuss", destinations: [] },
    employmentTypes: val("employment_types") ?? [], availability: val("availability") ?? { mode: "unknown" },
    compensation: val("compensation") ?? { mode: "open_to_discussion" },
    strengths: { roles: "flexible", location: "flexible", workArrangement: "flexible", employmentType: "flexible", compensation: "flexible" },
  } as Preferences;
}

/** Returns the admitted command id. Throws on rejection; a network failure
 * rethrows as `uncertain` so the caller re-sends the SAME body and key. */
export async function submitCommand(body: CommandBody, fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetcher(`${PROFILE_BASE}/commands`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ProfileApiError(0, "uncertain", "Network error");
  }
  const data = await readJson(res);
  if (res.status === 202 && data?.commandId) return data.commandId as string;
  throw new ProfileApiError(res.status, data?.code ?? data?.reason ?? null);
}

export async function fetchReceipt(commandId: string, fetcher: typeof fetch = fetch): Promise<Receipt> {
  const res = await fetcher(`${PROFILE_BASE}/commands/${encodeURIComponent(commandId)}`, { credentials: "include", headers: { Accept: "application/json" } });
  const data = await readJson(res);
  if (!res.ok || !data?.status) throw new ProfileApiError(res.status, data?.code ?? null);
  return data as Receipt;
}

/** HTTP status → contract reason for a refused submission. */
export function reasonForStatus(error: unknown): string {
  if (!(error instanceof ProfileApiError)) return "unknown";
  if (error.code && REASONS[error.code]) return error.code;
  switch (error.status) {
    case 409: return error.code === "idempotency_conflict" ? "idempotency_conflict" : "stale_edit";
    case 413: return "payload_too_large";
    case 422: return "invalid_request";
    case 451: return "candidate_privacy_restricted";
    case 503: return "authority_unavailable";
    default: return "unknown";
  }
}

export function newKey(): string {
  return crypto.randomUUID();
}

/** Poll quickly at first, then back off; never faster than 2s or slower than 15s. */
export function pollDelay(attempt: number): number {
  return Math.min(15000, 2000 * Math.pow(1.5, Math.max(0, attempt)));
}

export const FIELD_LABELS: Record<string, string> = {
  profile: "Professional details",
  displayName: "Name",
  headline: "Headline",
  "currentLocation.city": "Current city",
  "currentLocation.countryCode": "Current country",
  skills: "Skills",
  preferences: "Job preferences",
  desiredRoles: "Roles you want",
  "preferences.roles": "Roles you want",
  "preferences.location": "Where you want to work",
  "preferences.arrangement": "Remote, hybrid or on-site",
  "preferences.relocation": "Whether you'd move",
  "preferences.employment_types": "Type of job",
  "preferences.availability": "When you can start",
  "preferences.compensation": "Pay",
};
export function fieldLabel(path: string): string {
  return FIELD_LABELS[path] ?? path.replace(/\./g, " › ");
}

// ── Résumé → profile suggestions (P2 routes, owner-only, mounted behind
// CANDIDATE_RESUME_SOURCE_ENABLED). The browser chooses only its own library
// résumé id, the snapshot it was given and an idempotency key. Every POST may
// start paid reading, so a lost response is re-sent with the SAME key and body.
export const RESUME_SOURCE = {
  snapshot: "/api/candidate/product/sources/resume-snapshots",
  queue: "/api/candidate/product/sources/resume",
  status: (commandId: string) => `/api/candidate/product/sources/resume/${encodeURIComponent(commandId)}`,
  retry: (commandId: string) => `/api/candidate/product/sources/resume/${encodeURIComponent(commandId)}/retry`,
} as const;

export type ResumeSnapshot = { schemaVersion: 1; sourceId: string; sourceVersion: number; contentHash: string };
export type ResumeSourceState = "queued" | "extracting" | "building" | "transferring" | "review_ready" | "unavailable" | "held";
export type ResumeRetryView = {
  attemptsUsed: number; maxAttempts: number; canRetry: boolean; canContinueWithoutResume: boolean;
  reason: "attempt_limit" | "not_retryable" | null;
  /** Approved candidate copy from the server, or null. */
  message: string | null;
};
export type ResumeSourceStatus = {
  commandId: string; sourceId: string; sourceVersion: number; state: ResumeSourceState;
  reason: string | null; proposalId: string | null; retry?: ResumeRetryView | null | undefined;
};

/** Still working: keep polling. */
export function resumeInProgress(s: ResumeSourceState): boolean {
  return s === "queued" || s === "extracting" || s === "building" || s === "transferring";
}

/** Copy for a finished-without-suggestions state when the server sent no message. */
export const RESUME_FALLBACK_COPY: Record<string, string> = {
  unsupported: "We can't read this file type. Please upload a PDF or Word document.",
  too_large: "This résumé is too long for us to read. Please upload a shorter file or fill in your profile yourself.",
  consent_changed: "Your permissions changed. Review them before continuing.",
  privacy_changed: "This is unavailable under your current privacy settings.",
  source_changed: "This résumé changed. Please choose it again.",
  budget_unavailable: "We can't read résumés right now. Please try later or fill in your profile yourself.",
};
export const RESUME_GENERIC_COPY = "We couldn't read your résumé. You can fill in your profile yourself.";

export function resumeFailureCopy(s: Pick<ResumeSourceStatus, "reason" | "retry">): string {
  return s.retry?.message ?? (s.reason && RESUME_FALLBACK_COPY[s.reason]) ?? RESUME_GENERIC_COPY;
}

async function postResume<T>(url: string, body: Record<string, unknown>, ok: number, fetcher: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(url, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ProfileApiError(0, "uncertain", "Network error");
  }
  const data = await readJson(res);
  if (res.status === ok && data) return data as T;
  throw new ProfileApiError(res.status, data?.code ?? null);
}

export function snapshotResume(resumeId: number, idempotencyKey: string, fetcher: typeof fetch = fetchWithCsrf as typeof fetch) {
  return postResume<ResumeSnapshot>(RESUME_SOURCE.snapshot, { schemaVersion: 1, idempotencyKey, resumeId }, 200, fetcher);
}
export function queueResume(snap: Pick<ResumeSnapshot, "sourceId" | "sourceVersion">, idempotencyKey: string, fetcher: typeof fetch = fetchWithCsrf as typeof fetch) {
  return postResume<ResumeSourceStatus>(RESUME_SOURCE.queue,
    { schemaVersion: 1, idempotencyKey, sourceId: snap.sourceId, sourceVersion: snap.sourceVersion }, 202, fetcher);
}
export function retryResume(commandId: string, idempotencyKey: string, fetcher: typeof fetch = fetchWithCsrf as typeof fetch) {
  return postResume<ResumeSourceStatus>(RESUME_SOURCE.retry(commandId), { schemaVersion: 1, idempotencyKey, retryOfCommandId: commandId }, 202, fetcher);
}
export async function resumeStatus(commandId: string, fetcher: typeof fetch = fetch): Promise<ResumeSourceStatus> {
  const res = await fetcher(RESUME_SOURCE.status(commandId), { credentials: "include", headers: { Accept: "application/json" } });
  const data = await readJson(res);
  if (!res.ok || !data?.state) throw new ProfileApiError(res.status, data?.code ?? null);
  return data as ResumeSourceStatus;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
});

/** A POST whose response was lost is re-sent with the same key (at most 3 times):
 * the server returns the original result, so no second paid reading starts. */
async function sameKey<T>(send: () => Promise<T>, signal?: AbortSignal, wait = sleep): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await send(); } catch (e) {
      if (!(e instanceof ProfileApiError) || e.code !== "uncertain" || attempt >= 2) throw e;
      await wait(pollDelay(attempt), signal);
    }
  }
}

export type ResumeRunDeps = { fetcher?: typeof fetch; postFetcher?: typeof fetch; wait?: typeof sleep; newKey?: () => string };

/** Poll one command until it leaves the in-progress states. GET never retries work. */
export async function watchResume(commandId: string, onUpdate: (s: ResumeSourceStatus) => void, signal?: AbortSignal, deps: ResumeRunDeps = {}): Promise<ResumeSourceStatus> {
  const wait = deps.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    let s: ResumeSourceStatus | null = null;
    try { s = await resumeStatus(commandId, deps.fetcher); } catch (e) {
      // A transient read failure is not a result: keep watching.
      if (!(e instanceof ProfileApiError) || (e.status !== 0 && e.status < 500)) throw e;
    }
    if (s) { onUpdate(s); if (!resumeInProgress(s.state)) return s; }
    await wait(pollDelay(attempt), signal);
  }
}

/** Start reading one library résumé: snapshot → queue → watch. */
export async function startResumeRead(resumeId: number, onUpdate: (s: ResumeSourceStatus) => void, signal?: AbortSignal, deps: ResumeRunDeps = {}): Promise<ResumeSourceStatus> {
  const key = (deps.newKey ?? newKey)(); const queueKey = (deps.newKey ?? newKey)();
  const snap = await sameKey(() => snapshotResume(resumeId, key, deps.postFetcher), signal, deps.wait);
  const queued = await sameKey(() => queueResume(snap, queueKey, deps.postFetcher), signal, deps.wait);
  onUpdate(queued);
  return resumeInProgress(queued.state) ? watchResume(queued.commandId, onUpdate, signal, deps) : queued;
}

/** The candidate pressed "Try again": one explicit successor, then watch it. */
export async function tryResumeAgain(commandId: string, onUpdate: (s: ResumeSourceStatus) => void, signal?: AbortSignal, deps: ResumeRunDeps = {}): Promise<ResumeSourceStatus> {
  const key = (deps.newKey ?? newKey)();
  const next = await sameKey(() => retryResume(commandId, key, deps.postFetcher), signal, deps.wait);
  onUpdate(next);
  return resumeInProgress(next.state) ? watchResume(next.commandId, onUpdate, signal, deps) : next;
}

// ── Stuck saves: the server's Retry / Discard (resolution endpoints) ───────
// The browser only names the save and the action; it never resends the edit. The
// key is fixed per decision, so a lost reply is re-sent with the same key.
export type SaveResolution = {
  schemaVersion: 1; commandId: string; commandSchemaVersion: 2 | 3; resolutionRevision: number;
  state: "none" | "retry_queued" | "resolving" | "applied" | "rejected" | "discarded" | "operator_review";
  reason: string | null; canRetry: boolean; canDiscard: boolean; blocksConfirmation: boolean;
};
const resolutionUrl = (commandId: string) => `${PROFILE_BASE}/commands/${encodeURIComponent(commandId)}/resolution`;
export async function readResolution(commandId: string, fetcher: typeof fetch = fetch): Promise<SaveResolution> {
  const res = await fetcher(resolutionUrl(commandId), { credentials: "include", headers: { Accept: "application/json" } });
  const data = await readJson(res);
  if (!res.ok || !data?.state) throw new ProfileApiError(res.status, data?.code ?? null);
  return data as SaveResolution;
}
export async function resolveSave(commandId: string, body: { idempotencyKey: string; expectedResolutionRevision: number; action: "retry" | "discard" },
  fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<SaveResolution> {
  let res: Response;
  try {
    res = await fetcher(resolutionUrl(commandId), { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ schemaVersion: 1, ...body }) });
  } catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  const data = await readJson(res);
  if (res.status === 202 && data?.state) return data as SaveResolution;
  throw new ProfileApiError(res.status, data?.code ?? null);
}
export const resolutionSettled = (s: SaveResolution["state"]) => s === "applied" || s === "rejected" || s === "discarded";

// ── spark onboarding: the wizard's saves as real commands ──────────────────
// Profile facts: v2 save_draft. Preference sections, promotion and the final
// confirm: v3. Every command carries the versions the server last acknowledged;
// a stale edit is refused by the server, never silently overwritten here.
export type SparkVersions = { draftVersion: number; profileVersion: number; preferenceVersion: number; preferenceDraftRevision: number };
export type SparkSection = "roles" | "location" | "arrangement" | "relocation" | "employment_types" | "availability" | "compensation" | "authorisation" | "private_notes";
export type SparkProfileRead = {
  draftVersion: number; profileVersion: number; preferenceVersion: number;
  draft: ManualProfile | null; confirmedProfile: ManualProfile | null; draftHash: string | null;
  preferenceDraft: { preferenceDraftRevision: number; preferenceDraftHash: string;
    sections: Partial<Record<SparkSection, { answered: boolean; value: unknown }>>;
    promotedPreferenceVersion: number | null; promotedDraftRevision: number | null;
    /** Deal-breakers the server enforces, with its own ids (absent on older reads). */
    exclusions?: SparkExclusion[] | undefined } | null;
  effectiveConsentRevision: number | null;
  missingFields: string[];
  capabilities: Capabilities & { confirmBlockedReason?: string | null | undefined;
    /** AI help (and the deal-breaker preview it shares a switch with). */
    canInterpret?: boolean | undefined; interpretBlockedReason?: string | null | undefined };
  pendingCommands: PendingCommand[]; hasMorePendingCommands: boolean;
  /** Latest 50 of each, owner-only identifiers; the exact proposal is read separately. */
  sources?: { sourceId: string; sourceVersion: number }[] | undefined;
  proposals?: SparkProposalSummary[] | undefined;
  hasMoreSources?: boolean | undefined; hasMoreProposals?: boolean | undefined;
};
export type SparkExclusion = { id: string; kind: "remote_only" } | { id: string; kind: "no_travel" } | { id: string; kind: "exclude_company"; companyId: string };
export type SparkProposalSummary = { proposalId: string; proposalHash: string; kind: "source" | "interpretation";
  sourceId: string | null; sourceVersion: number | null; expiresAt: string };
export type SparkLoad = { kind: "ready"; profile: SparkProfileRead } | { kind: "disabled" } | { kind: "unavailable" };

/** spark responses carry the v3 preference draft; a 404 means spark is switched off. */
export async function loadSparkProfile(fetcher: typeof fetch = fetch): Promise<SparkLoad> {
  const res = await fetcher(PROFILE_BASE, { credentials: "include", headers: { Accept: "application/json" } });
  if (res.status === 404) return { kind: "disabled" };
  if (res.status === 503) return { kind: "unavailable" };
  const body = await readJson(res);
  if (!res.ok || !body || typeof body.draftVersion !== "number" || !("preferenceDraft" in body)) throw new ProfileApiError(res.status, body?.code ?? null);
  return { kind: "ready", profile: body as SparkProfileRead };
}
export function sparkVersions(p: SparkProfileRead): SparkVersions {
  return { draftVersion: p.draftVersion, profileVersion: p.profileVersion, preferenceVersion: p.preferenceVersion,
    preferenceDraftRevision: p.preferenceDraft?.preferenceDraftRevision ?? 0 };
}

export type SparkCommandRead = { schemaVersion: 2 | 3; commandId: string; status: "pending" | "applied" | "rejected" | "held"; reason: string | null;
  draftVersion?: number; profileVersion?: number; preferenceVersion?: number; preferenceDraftRevision?: number; preferenceDraftHash?: string | null };

export type SparkRunDeps = { fetcher?: typeof fetch; postFetcher?: typeof fetch; wait?: typeof sleep; maxPolls?: number };
async function postCommand(body: Record<string, unknown>, fetcher: typeof fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetcher(`${PROFILE_BASE}/commands`, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  } catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  const data = await readJson(res);
  if (res.status === 202 && data?.commandId) return data.commandId as string;
  throw new ProfileApiError(res.status, data?.code ?? data?.reason ?? null);
}

/** Send one command (a lost response is re-sent with the same body and key), then
 * wait for its result. Throws ProfileApiError with the contract reason on refusal. */
export async function runSparkCommand(body: Record<string, unknown>, deps: SparkRunDeps = {}): Promise<SparkCommandRead> {
  const wait = deps.wait ?? sleep;
  const id = await sameKey(() => postCommand(body, deps.postFetcher ?? (fetchWithCsrf as typeof fetch)), undefined, wait);
  const max = deps.maxPolls ?? 40;
  for (let attempt = 0; attempt < max; attempt++) {
    let r: SparkCommandRead | null = null;
    try {
      const res = await (deps.fetcher ?? fetch)(`${PROFILE_BASE}/commands/${encodeURIComponent(id)}`, { credentials: "include", headers: { Accept: "application/json" } });
      const data = await readJson(res);
      if (res.ok && data?.status) r = data as SparkCommandRead;
      else if (res.status < 500 && res.status !== 429) throw new ProfileApiError(res.status, data?.code ?? null);
    } catch (e) { if (e instanceof ProfileApiError && e.status !== 0) throw e; }
    if (r?.status === "applied") return r;
    if (r?.status === "rejected") throw new ProfileApiError(409, r.reason ?? "unknown");
    if (r?.status === "held" && !describeReason(r.reason).retryable) throw new ProfileApiError(409, r.reason ?? "unknown");
    await wait(pollDelay(attempt));
  }
  throw new ProfileApiError(0, "pending_too_long");
}

type WizardPreferences = Preferences;
/** Which v3 sections each wizard question answers. */
export const SECTIONS_FOR: Record<"roles" | "where" | "how" | "pay", SparkSection[]> = {
  roles: ["roles"], where: ["location", "relocation"], how: ["arrangement", "employment_types", "availability"], pay: ["compensation"],
};
export function sectionValue(section: SparkSection, p: WizardPreferences): unknown {
  const q = p as any;
  switch (section) {
    case "roles": return { desiredRoles: q.desiredRoles, preferredSeniority: q.preferredSeniority ?? [] };
    case "location": return q.locations;
    case "arrangement": return { workArrangements: q.workArrangements, remoteRegions: q.remoteRegions ?? null };
    case "relocation": return q.relocation;
    case "employment_types": return q.employmentTypes;
    case "availability": return q.availability;
    case "compensation": return q.compensation;
    default: return null;
  }
}

export type SparkSaveEvent =
  | { kind: "profile_draft"; profile: ManualProfile }
  | { kind: "preferences_draft"; preferences: WizardPreferences; answered: ("roles" | "where" | "how" | "pay")[] }
  /** Exactly these sections, as answered (the profile page saves only what the candidate touched). */
  | { kind: "preference_sections"; preferences: WizardPreferences; sections: SparkSection[] }
  | { kind: "work_authorisation"; entries: { countryCode: string; status: "allowed" | "needs_visa" | "not_sure" }[] }
  | { kind: "private_notes"; notes: string[] };

/** One wizard save becomes one or more commands. Their bodies are built once per
 * wizard idempotency key, so a retry re-sends exactly the same commands and keys. */
export function createSparkSession(initial: SparkProfileRead, deps: SparkRunDeps & { newKey?: () => string } = {}) {
  let v = sparkVersions(initial);
  let preferenceDraftHash = initial.preferenceDraft?.preferenceDraftHash ?? null;
  const sent = new Map<string, Record<string, unknown>[]>();
  const done = new Map<string, number>();
  const dispatched = new WeakSet<Record<string, unknown>>();
  const key = () => (deps.newKey ?? newKey)();
  const envelope = () => ({ expectedDraftVersion: v.draftVersion, expectedProfileVersion: v.profileVersion, expectedPreferenceVersion: v.preferenceVersion });
  const v3 = (action: string, payload: unknown) => ({ schemaVersion: 3, idempotencyKey: key(), ...envelope(), expectedPreferenceDraftRevision: v.preferenceDraftRevision, action, payload });
  let serverExclusions: SparkExclusion[] = initial.preferenceDraft?.exclusions ?? [];
  let serverNotes: string[] = notesOf(initial);
  const plans = new Map<string, { removes: string[]; additions: Record<string, unknown>[]; previewKey: string; notes: string[] | null; step: number; bodies: Record<string, unknown>[] }>();
  /** Read the profile back after a multi-command change: it is the only source of server ids. */
  async function reload(fetchProfile: () => Promise<SparkLoad>): Promise<SparkProfileRead> {
    const loaded = await fetchProfile();
    if (loaded.kind !== "ready") throw new ProfileApiError(503, "authority_unavailable");
    v = sparkVersions(loaded.profile); preferenceDraftHash = loaded.profile.preferenceDraft?.preferenceDraftHash ?? null;
    serverExclusions = loaded.profile.preferenceDraft?.exclusions ?? []; serverNotes = notesOf(loaded.profile);
    return loaded.profile;
  }
  const absorb = (r: SparkCommandRead) => {
    v = { draftVersion: r.draftVersion ?? v.draftVersion, profileVersion: r.profileVersion ?? v.profileVersion,
      preferenceVersion: r.preferenceVersion ?? v.preferenceVersion, preferenceDraftRevision: r.preferenceDraftRevision ?? v.preferenceDraftRevision };
    if (r.preferenceDraftHash !== undefined) preferenceDraftHash = r.preferenceDraftHash;
  };
  function build(e: SparkSaveEvent): Record<string, unknown>[] {
    if (e.kind === "profile_draft") return [{ schemaVersion: 2, idempotencyKey: key(), ...envelope(), action: "save_draft", payload: { profile: e.profile } }];
    if (e.kind === "work_authorisation") return [v3("save_preference_section", { section: "authorisation", answered: true, value: e.entries })];
    if (e.kind === "private_notes") return [v3("save_preference_section", e.notes.length
      ? { section: "private_notes", answered: true, value: e.notes } : { section: "private_notes", answered: false, value: null })];
    const sections = e.kind === "preference_sections" ? [...new Set(e.sections)] : [...new Set(e.answered.flatMap(a => SECTIONS_FOR[a]))];
    return sections.map(section => v3("save_preference_section", { section, answered: true, value: sectionValue(section, e.preferences) }));
  }
  return {
    versions: () => ({ ...v }),
    /** Commands after the first are rebuilt on the fresh versions; the first is never rebuilt once sent. */
    async save(idempotencyKey: string, e: SparkSaveEvent): Promise<{ profileVersion: string; preferencesVersion: string }> {
      if (!sent.has(idempotencyKey)) sent.set(idempotencyKey, build(e));
      const bodies = sent.get(idempotencyKey)!;
      for (let i = done.get(idempotencyKey) ?? 0; i < bodies.length; i++) {
        // A body that may have reached the server is re-sent unchanged (same key);
        // a later one not yet sent takes the versions the previous command produced.
        if (!dispatched.has(bodies[i]!)) {
          bodies[i] = { ...bodies[i]!, ...envelope(), ...(bodies[i]!.schemaVersion === 3 ? { expectedPreferenceDraftRevision: v.preferenceDraftRevision } : {}) };
          dispatched.add(bodies[i]!);
        }
        absorb(await runSparkCommand(bodies[i]!, deps));
        done.set(idempotencyKey, i + 1);
      }
      return { profileVersion: String(v.draftVersion), preferencesVersion: String(v.preferenceDraftRevision) };
    },
    /** Accept the reviewed résumé suggestions into the private draft (one command),
     * then read the server's draft back. The key is fixed per review, like other saves. */
    async acceptSource(idempotencyKey: string, payload: Record<string, unknown>, fetchProfile: () => Promise<SparkLoad> = () => loadSparkProfile(deps.fetcher)): Promise<ManualProfile> {
      if (!sent.has(idempotencyKey)) sent.set(idempotencyKey, [v3("accept_source", payload)]);
      absorb(await runSparkCommand(sent.get(idempotencyKey)![0]!, deps));
      const loaded = await fetchProfile();
      if (loaded.kind !== "ready" || !loaded.profile.draft) throw new ProfileApiError(503, "authority_unavailable");
      v = sparkVersions(loaded.profile);
      return loaded.profile.draft;
    },
    /** Accept one reviewed AI proposal (never one that adds deal-breakers: those use the preview below).
     * The key is fixed per proposal; the server rechecks consent, expiry and every version. */
    async acceptInterpretation(idempotencyKey: string, proposal: { proposalId: string; proposalHash: string },
      fetchProfile: () => Promise<SparkLoad> = () => loadSparkProfile(deps.fetcher)): Promise<SparkProfileRead> {
      if (!sent.has(idempotencyKey)) sent.set(idempotencyKey, [v3("accept_interpretation", { proposalId: proposal.proposalId, proposalHash: proposal.proposalHash })]);
      absorb(await runSparkCommand(sent.get(idempotencyKey)![0]!, deps));
      return await reload(fetchProfile);
    },
    /** Make the server's deal-breakers match what the candidate chose: removals first, then the
     * additions through the server's preview and its exact accept, then the private notes.
     * A retry with the same key resumes where it stopped and never re-previews a sent accept. */
    async saveDealbreakers(idempotencyKey: string, desired: { exclusions: ({ id: string } & ({ kind: "remote_only" } | { kind: "no_travel" } | { kind: "exclude_company"; companyId: string }))[]; notes: string[] },
      fetchProfile: () => Promise<SparkLoad> = () => loadSparkProfile(deps.fetcher)): Promise<{ profileVersion: string; preferencesVersion: string; exclusions: SparkExclusion[] }> {
      let plan = plans.get(idempotencyKey);
      if (!plan) {
        const rk = (r: { kind: string; companyId?: string }) => r.kind === "exclude_company" ? `company:${r.companyId}` : r.kind;
        const removes = serverExclusions.filter(x => !desired.exclusions.some(d => d.id === x.id || rk(d) === rk(x))).map(x => x.id);
        const additions = desired.exclusions.filter(d => !serverExclusions.some(x => x.id === d.id || rk(x) === rk(d)))
          .map(d => d.kind === "exclude_company" ? { kind: d.kind, companyId: d.companyId } : { kind: d.kind });
        const notesChanged = JSON.stringify(serverNotes) !== JSON.stringify(desired.notes);
        plan = { removes, additions, previewKey: key(), notes: notesChanged ? desired.notes : null, step: 0, bodies: [] };
        plans.set(idempotencyKey, plan);
      }
      const steps = plan.removes.length + (plan.additions.length ? 1 : 0) + (plan.notes ? 1 : 0);
      for (let i = plan.step; i < steps; i++) {
        if (!plan.bodies[i]) {
          if (i < plan.removes.length) plan.bodies[i] = v3("remove_exclusion", { restrictionId: plan.removes[i] });
          else if (i === plan.removes.length && plan.additions.length) {
            const preview = await previewExclusions({ idempotencyKey: plan.previewKey, expectedPreferenceDraftRevision: v.preferenceDraftRevision, restrictions: plan.additions }, deps.postFetcher);
            plan.bodies[i] = v3("accept_exclusions", { proposalId: preview.proposalId, proposalHash: preview.proposalHash });
          } else plan.bodies[i] = v3("save_preference_section", plan.notes!.length
            ? { section: "private_notes", answered: true, value: plan.notes } : { section: "private_notes", answered: false, value: null });
        }
        absorb(await runSparkCommand(plan.bodies[i]!, deps));
        plan.step = i + 1;
      }
      const p = await reload(fetchProfile);
      return { profileVersion: String(p.draftVersion), preferencesVersion: String(p.preferenceDraft?.preferenceDraftRevision ?? 0), exclusions: serverExclusions };
    },
    /** "This isn't me" (or another refusal) for a proposal: one reject_source command, key fixed per proposal. */
    async rejectSource(idempotencyKey: string, payload: { proposalId: string; sourceVersion: number; proposalHash: string; reason: "not_me" | "incorrect" | "not_needed" }): Promise<void> {
      if (!sent.has(idempotencyKey)) sent.set(idempotencyKey, [v3("reject_source", payload)]);
      absorb(await runSparkCommand(sent.get(idempotencyKey)![0]!, deps));
    },
    /** Promote the reviewed preference draft (if not already), then confirm the exact
     * reviewed versions. Refuses if the server state moved on since the review. */
    async confirm(reviewed: { profileVersion: string; preferencesVersion: string }, fetchProfile: () => Promise<SparkLoad> = () => loadSparkProfile(deps.fetcher)): Promise<void> {
      if (String(v.draftVersion) !== reviewed.profileVersion || String(v.preferenceDraftRevision) !== reviewed.preferencesVersion) throw new ProfileApiError(409, "confirmation_conflict");
      let loaded = await fetchProfile();
      if (loaded.kind !== "ready") throw new ProfileApiError(503, "authority_unavailable");
      let p = loaded.profile;
      if (String(p.draftVersion) !== reviewed.profileVersion || String(p.preferenceDraft?.preferenceDraftRevision ?? 0) !== reviewed.preferencesVersion) throw new ProfileApiError(409, "confirmation_conflict");
      const pd = p.preferenceDraft;
      if (!pd || !p.draftHash) throw new ProfileApiError(409, "incomplete_profile");
      v = sparkVersions(p); preferenceDraftHash = pd.preferenceDraftHash;
      const promoted = pd.promotedDraftRevision === pd.preferenceDraftRevision && pd.promotedPreferenceVersion === p.preferenceVersion && p.preferenceVersion > 0;
      const reviewedDraftHash = p.draftHash;
      if (!promoted) {
        absorb(await runSparkCommand(v3("promote_preferences", { preferenceDraftHash }), deps));
        loaded = await fetchProfile();
        if (loaded.kind !== "ready") throw new ProfileApiError(503, "authority_unavailable");
        p = loaded.profile; v = sparkVersions(p);
        // An edit that landed during promotion was never reviewed: refuse rather than confirm it.
        const q = p.preferenceDraft;
        if (String(p.draftVersion) !== reviewed.profileVersion || p.draftHash !== reviewedDraftHash
          || String(q?.preferenceDraftRevision ?? 0) !== reviewed.preferencesVersion || q?.promotedDraftRevision !== q?.preferenceDraftRevision)
          throw new ProfileApiError(409, "confirmation_conflict");
      }
      if (p.effectiveConsentRevision === null) throw new ProfileApiError(409, "consent_required");
      if (!p.capabilities.canConfirm) throw new ProfileApiError(p.capabilities.confirmBlockedReason === "recent_auth_required" ? 403 : 409, p.capabilities.confirmBlockedReason ?? "unknown");
      await runSparkCommand(v3("confirm", { draftHash: p.draftHash, preferenceDraftHash: p.preferenceDraft!.preferenceDraftHash, consentRevision: p.effectiveConsentRevision }), deps);
    },
  };
}

/** Re-enter the password before a confirmation (the server allows 10 minutes after sign-in). */
export async function reauthenticate(password: string, fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<void> {
  const res = await fetcher("/api/candidate/privacy/reauth", { method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ password }) });
  if (!res.ok) {
    const e = new ProfileApiError(res.status, (await readJson(res))?.code ?? null);
    // Rate limited: the server says how long to wait (Retry-After, else RateLimit-Reset), in seconds.
    const wait = Number(res.headers?.get?.("Retry-After") ?? res.headers?.get?.("RateLimit-Reset"));
    if (res.status === 429 && Number.isFinite(wait) && wait > 0) e.retryAfterSeconds = Math.ceil(wait);
    throw e;
  }
}

export async function fetchSourceProposal(sourceId: string, proposalId: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  const res = await fetcher(`/api/candidate/product/sources/${encodeURIComponent(sourceId)}/proposals/${encodeURIComponent(proposalId)}`,
    { credentials: "include", headers: { Accept: "application/json" } });
  const data = await readJson(res);
  if (!res.ok || !data?.proposalId) throw new ProfileApiError(res.status, data?.code ?? null);
  return data;
}

/** Save a file to the candidate's résumé library (the existing upload, max 3). Returns its id. */
export async function uploadLibraryResume(file: File, fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<number> {
  const form = new FormData(); form.append("resume", file); form.append("label", file.name.slice(0, 100));
  // B3: Spark reads the file itself (once, budgeted); the library upload must not OCR it.
  form.append("readBy", "spark");
  let res: Response;
  try { res = await fetcher("/api/ai/resume", { method: "POST", credentials: "include", body: form }); }
  catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  const data = await readJson(res);
  if (!res.ok || typeof data?.resume?.id !== "number") throw new ProfileApiError(res.status, data?.code ?? data?.error ?? null);
  return data.resume.id as number;
}

// ── Sign-up consent: activation after email verification ────────────────────
/** The candidate's consent as the server sees it (Codex auth seam, 30 Oct). */
export type ConsentStatus = {
  schemaVersion: 2; consentRevision: number; desiredAction: "grant" | "withdraw" | null; acknowledgedRevision: number;
  acknowledgedAction: "grant" | "withdraw" | null;
  deliveryStatus: "none" | "pending" | "delivered" | "failed" | "privacy_restricted" | "identity_review_required";
};
export const CONSENT_BASE = "/api/candidate/product/consent";

/** Establish the owner binding before consent. Reads never create it; retries
 * reuse the same command key and never imply a consent grant. */
export async function ensureSparkFoundation(key: string, deps: SparkRunDeps = {}): Promise<"linked" | "pending" | "held"> {
  const get = deps.fetcher ?? fetch, post = deps.postFetcher ?? fetchWithCsrf as typeof fetch;
  const read = async () => {
    const response = await get("/api/candidate/product", { credentials: "include", cache: "no-store" });
    const data = await readJson(response);
    if (!response.ok || data?.schemaVersion !== 1 || !["not_started", "pending", "linked", "held"].includes(data?.state))
      throw new ProfileApiError(response.status, data?.code ?? "invalid_response");
    return data.state as "not_started" | "pending" | "linked" | "held";
  };
  let state = await read();
  if (state === "not_started") {
    const response = await post("/api/candidate/product/foundation", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, idempotencyKey: key }) });
    const data = await readJson(response);
    if (!response.ok) throw new ProfileApiError(response.status, data?.code ?? null);
    state = await read();
  }
  for (let i = 0; i < 20 && (state === "pending" || state === "not_started"); i++) {
    await (deps.wait ?? sleep)(pollDelay(i)); state = await read();
  }
  return state === "not_started" ? "pending" : state;
}

export async function readConsent(fetcher: typeof fetch = fetch): Promise<ConsentStatus> {
  const res = await fetcher(CONSENT_BASE, { credentials: "include", headers: { Accept: "application/json" } });
  const data = await readJson(res);
  if (!res.ok || data?.schemaVersion !== 2) throw new ProfileApiError(res.status, data?.code ?? null);
  return data as ConsentStatus;
}
/** Records the consent accepted at sign-up, once. No copy or identity is sent again. */
export async function activateSignupConsent(fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<"activated" | "none" | "expired" | "superseded"> {
  let res: Response;
  try { res = await fetcher(`${CONSENT_BASE}/signup-intent/activate`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 2 }) }); }
  catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  const data = await readJson(res);
  if (!res.ok || !["activated", "none", "expired", "superseded"].includes(data?.status)) throw new ProfileApiError(res.status, data?.code ?? null);
  return data.status;
}
/** Explicit consent when there's no usable sign-up acceptance: the exact copy version and fingerprint shown. */
export async function grantConsent(body: { idempotencyKey: string; expectedConsentRevision: number; copyVersion: number; copyHash: string }, fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<void> {
  let res: Response;
  try { res = await fetcher(CONSENT_BASE, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 2, action: "grant", ...body }) }); }
  catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  const data = await readJson(res);
  if (!res.ok) throw new ProfileApiError(res.status, data?.code ?? null);
}
/** A grant counts once Memory has acknowledged it. */
export const consentActive = (s: ConsentStatus) => s.acknowledgedAction === "grant" && s.deliveryStatus === "delivered";
export const consentBlocked = (s: ConsentStatus) => s.deliveryStatus === "failed" || s.deliveryStatus === "privacy_restricted" || s.deliveryStatus === "identity_review_required";

/** Wait for Memory to acknowledge the grant. Gives up (returns the last status) after `maxPolls`. */
export async function waitForConsent(deps: { fetcher?: typeof fetch | undefined; wait?: ((ms: number) => Promise<void>) | undefined; maxPolls?: number | undefined } = {}): Promise<ConsentStatus> {
  const wait = deps.wait ?? sleep;
  let s = await readConsent(deps.fetcher);
  for (let i = 0; i < (deps.maxPolls ?? 20) && !consentActive(s) && !consentBlocked(s); i++) { await wait(pollDelay(i)); s = await readConsent(deps.fetcher); }
  return s;
}

// ── Professional-profile lookup (RC), owner routes ──────────────────────────
export type LookupState = "queued" | "running" | "transferring" | "review_ready" | "not_found" | "held" | "rejected";
export type LookupStatus = { schemaVersion: 1; attemptId: string; state: LookupState; reason: string | null; proposalId: string | null; canRequestLinkedin: boolean; waitLimitMs: number };
export const LOOKUP_BASE = "/api/candidate/product/lookups";
export const lookupInProgress = (s: LookupState) => s === "queued" || s === "running" || s === "transferring";

/** Ask for a lookup. Never calls the provider directly; the server queues it. Asking again (any key)
 * returns the candidate's existing attempt for that kind, so a refresh never buys a second lookup. */
export async function startLookup(body: { idempotencyKey: string; expectedConsentRevision: number } & ({ kind: "email" } | { kind: "linkedin"; url: string }),
  fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<LookupStatus> {
  let res: Response;
  try { res = await fetcher(LOOKUP_BASE, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, ...body }) }); }
  catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  const data = await readJson(res);
  if (!res.ok || data?.schemaVersion !== 1 || typeof data?.attemptId !== "string") throw new ProfileApiError(res.status, data?.code ?? null);
  return data as LookupStatus;
}
export async function lookupStatus(attemptId: string, fetcher: typeof fetch = fetch): Promise<LookupStatus> {
  const res = await fetcher(`${LOOKUP_BASE}/${encodeURIComponent(attemptId)}`, { credentials: "include", headers: { Accept: "application/json" } });
  const data = await readJson(res);
  if (!res.ok || data?.attemptId !== attemptId) throw new ProfileApiError(res.status, data?.code ?? null);
  return data as LookupStatus;
}
/** Poll until the lookup finishes (review_ready, not_found, held or rejected). GET never starts work. */
export async function watchLookup(first: LookupStatus, deps: { fetcher?: typeof fetch | undefined; wait?: ((ms: number) => Promise<void>) | undefined; maxPolls?: number | undefined } = {}): Promise<LookupStatus> {
  const wait = deps.wait ?? sleep;
  let s = first;
  for (let i = 0; lookupInProgress(s.state) && i < (deps.maxPolls ?? 120); i++) { await wait(pollDelay(i)); s = await lookupStatus(s.attemptId, deps.fetcher); }
  return s;
}

const notesOf = (p: SparkProfileRead): string[] => {
  const n = p.preferenceDraft?.sections.private_notes;
  return n?.answered && Array.isArray(n.value) ? (n.value as string[]) : [];
};

// ── P6 AI help and deal-breaker preview (owner-only, default off) ───────────
// The browser never sends who it is: the server resolves the account, the source it owns,
// current versions and delivered consent. Every POST may buy one model call, so a lost
// response is re-sent with the SAME key and body; a deliberately changed request gets a new key.
export const INTERPRET_BASE = "/api/candidate/product/interpretations";
export type InterpretationUse = "source_correction" | "private_exclusions" | "change_preferences";
export type InterpretationRequest = { schemaVersion: 1; idempotencyKey: string; expectedDraftVersion: number; expectedProfileVersion: number;
  expectedPreferenceVersion: number; expectedPreferenceDraftRevision: number; use: InterpretationUse; text: string;
  sourceProposalId: string | null; sourceVersion: number | null; targetRowId: string | null };
export type InterpretationRestriction = { kind: "remote_only" } | { kind: "no_travel" } | { kind: "exclude_company"; companyId: string };
export type InterpretationChange =
  | { kind: "source_correction"; fact: { factId: string; kind: string; targetRowId: string | null; value: any; evidence: unknown[] } }
  | { kind: "preference_section"; answer: { section: SparkSection; answered: boolean; value: unknown } }
  | { kind: "exclusions"; restrictions: InterpretationRestriction[] };
export type InterpretationResponse =
  | { schemaVersion: 1; status: "proposal"; summary: string; changes: InterpretationChange[]; proposalId: string; proposalHash: string;
      expectedDraftVersion: number; expectedProfileVersion: number; expectedPreferenceVersion: number; expectedPreferenceDraftRevision: number; expiresAt: string }
  | { schemaVersion: 1; status: "clarify"; question: string }
  | { schemaVersion: 1; status: "cannot_help"; reason: "unsupported" | "insufficient_evidence" | "unsafe" | "budget_unavailable" };

async function postJson(url: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<any> {
  let res: Response;
  try {
    res = await fetcher(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  } catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  const data = await readJson(res);
  if (res.status >= 500) throw new ProfileApiError(0, "uncertain");
  if (!res.ok) throw new ProfileApiError(res.status, data?.code ?? data?.reason ?? null);
  return data;
}

export async function requestInterpretation(body: InterpretationRequest, deps: { postFetcher?: typeof fetch | undefined; wait?: typeof sleep | undefined } = {}): Promise<InterpretationResponse> {
  const data = await sameKey(() => postJson(INTERPRET_BASE, body, deps.postFetcher ?? (fetchWithCsrf as typeof fetch)), undefined, deps.wait ?? sleep);
  if (!data || data.schemaVersion !== 1 || !["proposal", "clarify", "cannot_help"].includes(data.status)) throw new ProfileApiError(502, "invalid_response");
  return data as InterpretationResponse;
}

export type ExclusionPreview = { proposalId: string; proposalHash: string; expectedPreferenceDraftRevision: number;
  restrictions: SparkExclusion[]; expiresAt: string };
export async function previewExclusions(body: { idempotencyKey: string; expectedPreferenceDraftRevision: number; restrictions: Record<string, unknown>[] }, fetcher?: typeof fetch): Promise<ExclusionPreview> {
  const data = await sameKey(() => postJson("/api/candidate/product/exclusions/preview", body, fetcher ?? (fetchWithCsrf as typeof fetch)));
  if (!data?.proposalId || !data.proposalHash || !Array.isArray(data.restrictions)) throw new ProfileApiError(502, "invalid_response");
  return data as ExclusionPreview;
}

/** Only when the server says the profile is hidden because it needs confirming again (not on errors),
 * and only for a profile confirmed before: "again" is untrue for one that was never confirmed. */
export const needsReconfirm = (p: { state: string; publicationActive: boolean; capabilities: Capabilities }): boolean =>
  p.state === "confirmed" && !p.publicationActive && p.capabilities.discoveryBlockedReason === "confirmation_required";
export const RECONFIRM_NOTE = "Your preferences are saved. Recruiters won't see your profile until you confirm it again.";
