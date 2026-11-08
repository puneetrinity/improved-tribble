// Résumé reading status for the spark journey: "Reading your résumé…", the
// server's approved failure copy, an explicit "Try again" (at most 3 tries per
// file, enforced by the server) and a way to carry on without the résumé.
// Nothing here starts work on render or on a status read: only a click does.
// The suggestion list itself waits for the proposal read/accept routes (P0).
import { RESUME_UNMATCHED_NOTE, RESUME_UNREADABLE_NOTE } from "@shared/resume-review-notes";
/** Why an empty review is empty, from the server's fixed notes. */
const emptyReason = (raw: { reviewNotes?: string[] }) => ({
  unmatched: (raw.reviewNotes ?? []).includes(RESUME_UNMATCHED_NOTE), unreadable: (raw.reviewNotes ?? []).includes(RESUME_UNREADABLE_NOTE) });
import { TetrisOrb } from "@/components/ui/tetris-orb";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, FileWarning, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportedProfile, ResumeItem } from "./OnboardingWizard";
import type { ManualProfile } from "@/lib/candidate-profile-api";
import {
  fetchSourceProposal, lookupStatus, newKey, ProfileApiError, resumeFailureCopy, resumeInProgress, startLookup, startResumeRead, tryResumeAgain, uploadLibraryResume,
  watchLookup, type LookupStatus, type ResumeRunDeps, type ResumeSourceStatus,
} from "@/lib/candidate-profile-api";

export type ResumeRead =
  | { kind: "idle" }
  | { kind: "reading"; status: ResumeSourceStatus | null }
  | { kind: "ready"; status: ResumeSourceStatus }
  | { kind: "failed"; status: ResumeSourceStatus }
  | { kind: "error"; message: string };

const REQUEST_COPY: Record<number, string> = {
  409: "This résumé changed. Please choose it again.",
  451: "This is unavailable under your current privacy settings.",
};
const REQUEST_GENERIC = "We couldn't start reading your résumé. Please try again in a moment.";
// Only for a definite unsupported/unreadable-file answer from the upload. Temporary
// OCR/server failures keep the generic copy and the bounded Try again.
const REQUEST_UNREADABLE = "We couldn't read this résumé. Try another PDF or Word file with selectable text, or fill in your profile yourself.";
export function resumeRequestCopy(e: unknown): string {
  if (e instanceof ProfileApiError && ((e.status === 400 && e.code === "Invalid resume") || (e.status === 415 && e.code === "Resume extraction failed")))
    return REQUEST_UNREADABLE;
  return REQUEST_COPY[e instanceof ProfileApiError ? e.status : 0] ?? REQUEST_GENERIC;
}

function settle(s: ResumeSourceStatus): ResumeRead {
  if (resumeInProgress(s.state)) return { kind: "reading", status: s };
  return s.state === "review_ready" ? { kind: "ready", status: s } : { kind: "failed", status: s };
}

export function useResumeRead(deps: ResumeRunDeps = {}) {
  const [read, setRead] = useState<ResumeRead>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);
  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async (go: (onUpdate: (s: ResumeSourceStatus) => void, signal: AbortSignal) => Promise<ResumeSourceStatus>) => {
    if (busy.current) return; // one click, one paid start
    busy.current = true;
    abort.current?.abort(); const ctl = new AbortController(); abort.current = ctl;
    setRead({ kind: "reading", status: null });
    try {
      const final = await go(s => { if (!ctl.signal.aborted) setRead(settle(s)); }, ctl.signal);
      if (!ctl.signal.aborted) setRead(settle(final));
    } catch (e) {
      if (ctl.signal.aborted) return;
      setRead({ kind: "error", message: resumeRequestCopy(e) });
    } finally { busy.current = false; }
  }, []);

  const start = useCallback((resumeId: number) => run((u, s) => startResumeRead(resumeId, u, s, deps)), [run, deps]);
  const retry = useCallback((commandId: string) => run((u, s) => tryResumeAgain(commandId, u, s, deps)), [run, deps]);
  const reset = useCallback(() => { abort.current?.abort(); busy.current = false; setRead({ kind: "idle" }); }, []);
  return { read, start, retry, reset };
}

type Props = {
  read: ResumeRead;
  /** The library file being read, shown as the card title. */
  fileName?: string | undefined;
  onRetry: (commandId: string) => void;
  /** Carry on without the résumé (always allowed, no penalty). */
  onContinue: () => void;
};

// Layout follows 21st.dev "Attachment States" (uiable): file title, state line,
// a state icon and the actions, reusing the journey's card and button styles.
function Card({ icon, title, line, children, role }: { icon: ReactNode; title: string; line: ReactNode; children?: ReactNode; role: "status" | "alert" }) {
  return (
    <div role={role} aria-live={role === "status" ? "polite" : undefined} className="rounded-xl border border-border bg-card p-5 text-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{title}</p>
          <div className="mt-0.5 text-muted-foreground">{line}</div>
        </div>
      </div>
      {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function ResumeReadStatus({ read, fileName, onRetry, onContinue }: Props) {
  if (read.kind === "idle") return null;
  const title = fileName ?? "Your résumé";
  if (read.kind === "reading") {
    return <Card role="status" title={title} icon={<TetrisOrb label="Reading your résumé" decorative />}
      line={<>Reading your résumé… This can take a little while. Please keep this page open.</>} />;
  }
  if (read.kind === "ready") {
    return <Card role="status" title={title} icon={<Check className="h-4 w-4 text-primary" />}
      line="Your résumé has been read. Review the details we found before anything is added to your profile." />;
  }
  const message = read.kind === "error" ? read.message : resumeFailureCopy(read.status);
  const retry = read.kind === "failed" && read.status.retry?.canRetry ? read.status.commandId : null;
  const tries = read.kind === "failed" ? read.status.retry : null;
  return (
    <Card role="alert" title={title} icon={<FileWarning className="h-4 w-4 text-destructive" />}
      line={<><span className="text-foreground">{message}</span>{tries && <span className="mt-1 block">Tries used: {tries.attemptsUsed} of {tries.maxAttempts}</span>}</>}>
      {retry && (
        <Button type="button" className="min-h-11 cursor-pointer" onClick={() => onRetry(retry)}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Try again
        </Button>
      )}
      <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={onContinue}>Fill in my profile myself</Button>
    </Card>
  );
}

// ── Résumé suggestions → the journey's review list → accept_source ─────────
// Server facts are shown with the prototype's review rows (ResumeItem). What the
// candidate keeps, edits or removes becomes ONE accept_source command; the server
// applies it to the private draft. Nothing is merged in the browser.

export type SourceFact = { factId: string; kind: string; targetRowId: string | null; value: any; evidence: { quote: string }[] };
export type SourceProposal = { schemaVersion: 1; proposalId: string; sourceId: string; sourceVersion: number; proposalHash: string;
  facts: SourceFact[]; reviewNotes: string[]; expiresAt: string };

const dateText = (d: { value: string } | null | undefined) => d?.value ?? null;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** One review row per server fact; ids are the server's fact ids. Scalar facts that would
 * replace something already in the profile say what they replace. */
export function proposalItems(p: SourceProposal): ResumeItem[] {
  const source = { resumeVersionId: p.proposalId, extractionVersion: p.proposalHash };
  return p.facts.flatMap((f): ResumeItem[] => {
    const evidence = f.evidence[0]?.quote ?? "";
    const base = { id: f.factId, source, evidence };
    switch (f.kind) {
      case "skill": return [{ ...base, kind: "skill", value: String(f.value) }];
      case "project": return [{ ...base, kind: "project", value: f.value.name }];
      case "employment": return [{ ...base, kind: "employment", employer: f.value.employer, title: f.value.title,
        start: dateText(f.value.start), end: dateText(f.value.end), current: !!f.value.current }];
      case "education": return [{ ...base, kind: "education", institution: f.value.institution, qualification: f.value.qualification,
        start: dateText(f.value.start), end: dateText(f.value.end) }];
      case "currentLocation": return [{ ...base, kind: "location", city: f.value.city ?? "", countryCode: f.value.countryCode, displayCountry: f.value.displayCountry ?? f.value.countryCode }];
      default: return []; // displayName / headline / linkedinUrl come from the professional profile in the journey
    }
  });
}

/** Build accept_source from the review choices. Kept rows are selected; an edited skill or
 * project name is sent as a correction of that fact; a kept location replaces the current one. */
export function acceptPayload(p: SourceProposal, decisions: Record<string, "keep" | "remove" | "profile" | "resume">,
  edits: Record<string, string>, profile: ManualProfile | null) {
  const shown = new Set(proposalItems(p).map(i => i.id));
  const kept = p.facts.filter(f => shown.has(f.factId) && decisions[f.factId] !== "remove");
  const corrections = kept.flatMap(f => {
    const e = edits[f.factId]?.trim();
    if (!e) return [];
    if (f.kind === "skill" && e !== f.value) return [{ factId: f.factId, kind: "skill", value: e }];
    if (f.kind === "project" && e !== f.value.name) return [{ factId: f.factId, kind: "project", value: { ...f.value, name: e } }];
    return [];
  });
  const replaceFactIds = kept.filter(f => f.kind === "currentLocation" && profile?.currentLocation && !same(profile.currentLocation, f.value)).map(f => f.factId);
  return { proposalId: p.proposalId, sourceVersion: p.sourceVersion, proposalHash: p.proposalHash,
    selectedFactIds: kept.map(f => f.factId), replaceFactIds, corrections };
}

/** Reading finished without suggestions: carries the server status for the card. */
export class ResumeReadError extends Error {
  constructor(public read: Extract<ResumeRead, { kind: "failed" | "error" }>) { super("resume_read_failed"); }
}

/** Real résumé adapters for the journey: upload to the library, read, fetch the
 * suggestions, and accept the review as one command. */
export function resumeAdapters(o: {
  session: { acceptSource: (key: string, payload: Record<string, unknown>) => Promise<ManualProfile>;
    rejectSource?: (key: string, payload: { proposalId: string; sourceVersion: number; proposalHash: string; reason: "not_needed" }) => Promise<void> };
  currentProfile: () => ManualProfile | null;
  deps?: ResumeRunDeps & { upload?: (f: File) => Promise<number>; fetchProposal?: (sourceId: string, proposalId: string) => Promise<unknown> };
}) {
  const proposals = new Map<string, SourceProposal>();
  const acceptKeys = new Map<string, string>();
  const deps = o.deps ?? {};
  async function extraction(s: ResumeSourceStatus) {
    if (s.state !== "review_ready" || !s.proposalId) throw new ResumeReadError({ kind: "failed", status: s });
    const raw = await (deps.fetchProposal ?? fetchSourceProposal)(s.sourceId, s.proposalId) as SourceProposal;
    if (!raw || raw.proposalId !== s.proposalId || raw.sourceId !== s.sourceId || !Array.isArray(raw.facts)) throw new ResumeReadError({ kind: "error", message: REQUEST_GENERIC });
    proposals.set(raw.proposalId, raw);
    return { resumeVersionId: raw.proposalId, items: proposalItems(raw), ...emptyReason(raw) };
  }
  const asReadError = (e: unknown) => e instanceof ResumeReadError ? e
    : new ResumeReadError({ kind: "error", message: resumeRequestCopy(e) });
  return {
    async readResume(file: File) {
      try {
        const id = await (deps.upload ?? uploadLibraryResume)(file);
        return await extraction(await startResumeRead(id, () => {}, undefined, deps));
      } catch (e) { throw asReadError(e); }
    },
    /** Read a résumé already in the library (the candidate's default), by its id. */
    async readResumeById(resumeId: number) {
      try { return await extraction(await startResumeRead(resumeId, () => {}, undefined, deps)); }
      catch (e) { throw asReadError(e); }
    },
    /** Returning: reopen the newest unreviewed résumé suggestion, if any (lookups are skipped). */
    async restore(summaries: { proposalId: string; kind: string; sourceId: string | null }[]) {
      for (const s of summaries) {
        if (s.kind !== "source" || !s.sourceId) continue;
        const raw = await (deps.fetchProposal ?? fetchSourceProposal)(s.sourceId, s.proposalId).catch(() => null) as SourceProposal & { sourceKind?: string } | null;
        if (!raw || raw.proposalId !== s.proposalId || raw.sourceKind !== "resume" || !Array.isArray(raw.facts)) continue;
        proposals.set(raw.proposalId, raw);
        return { resumeVersionId: raw.proposalId, items: proposalItems(raw), ...emptyReason(raw) };
      }
      return null;
    },
    async retryResume(commandId: string) {
      try { return await extraction(await tryResumeAgain(commandId, () => {}, undefined, deps)); }
      catch (e) { throw asReadError(e); }
    },
    async acceptResume(proposalId: string, decisions: Record<string, "keep" | "remove" | "profile" | "resume">, edits: Record<string, string>) {
      const p = proposals.get(proposalId);
      if (!p) throw new ProfileApiError(409, "source_not_found");
      if (!acceptKeys.has(proposalId)) acceptKeys.set(proposalId, newKey());
      const payload = acceptPayload(p, decisions, edits, o.currentProfile());
      // Nothing kept (no suggestions, or every one removed): the server refuses an empty
      // accept_source, so the review is closed as "not needed" and the draft is unchanged.
      if (payload.selectedFactIds.length === 0) {
        const current = o.currentProfile();
        if (!o.session.rejectSource || !current) throw new ProfileApiError(409, "source_not_found");
        await o.session.rejectSource(acceptKeys.get(proposalId)!, { proposalId: p.proposalId, sourceVersion: p.sourceVersion, proposalHash: p.proposalHash, reason: "not_needed" });
        return current;
      }
      return o.session.acceptSource(acceptKeys.get(proposalId)!, payload);
    },
  };
}

// ── Professional-profile lookup (RC) → "Is this you?" ──────────────────────
// The lookup's suggestions are shown as one profile. "Yes, this is me" accepts every fact
// as ONE accept_source command (the server applies it to the private draft, with
// provenance); "This isn't me" sends reject_source not_me, which is what lets the server
// open the single LinkedIn retry. Nothing is merged or discarded in the browser.

/** The profile the lookup proposes, for display only. */
export function lookupProfile(p: SourceProposal): ManualProfile {
  const of = (kind: string) => p.facts.filter(f => f.kind === kind);
  const one = (kind: string) => of(kind)[0]?.value;
  return {
    displayName: one("displayName") ?? "", headline: one("headline") ?? "", linkedinUrl: one("linkedinUrl") ?? null,
    currentLocation: one("currentLocation") ?? null,
    skills: of("skill").map(f => String(f.value)), employment: of("employment").map(f => f.value), education: of("education").map(f => f.value), projects: [],
    ...(one("photo")?.url ? { photoUrl: String(one("photo").url) } : {}),
  } as ManualProfile;
}

/** Select every lookup fact. A scalar fact that differs from the current draft replaces it. */
export function acceptAllPayload(p: SourceProposal, profile: ManualProfile | null) {
  const scalar: Record<string, keyof ManualProfile> = { displayName: "displayName", headline: "headline", linkedinUrl: "linkedinUrl", currentLocation: "currentLocation" };
  const replaceFactIds = p.facts.filter(f => scalar[f.kind] && profile && profile[scalar[f.kind]!] != null && profile[scalar[f.kind]!] !== "" && !same(profile[scalar[f.kind]!], f.value)).map(f => f.factId);
  return { proposalId: p.proposalId, sourceVersion: p.sourceVersion, proposalHash: p.proposalHash, selectedFactIds: p.facts.map(f => f.factId), replaceFactIds, corrections: [] };
}

/** What a lookup ended with. Only a genuine miss is "not_found"; an outcome the server couldn't
 * settle (held, or stopped for another reason) is "unconfirmed" and never offers a paid retry.
 * Transport failures and sign-outs are thrown (ProfileApiError), not folded into a miss. */
export type LookupOutcome =
  | { kind: "found"; imported: ImportedProfile }
  | { kind: "not_found"; canRequestLinkedin: boolean }
  | { kind: "unconfirmed" };

export function lookupAdapters(o: {
  session: { acceptSource: (key: string, payload: Record<string, unknown>) => Promise<ManualProfile>;
    rejectSource: (key: string, payload: { proposalId: string; sourceVersion: number; proposalHash: string; reason: "not_me" }) => Promise<void> };
  consentRevision: number;
  currentProfile: () => ManualProfile | null;
  deps?: { fetcher?: typeof fetch | undefined; postFetcher?: typeof fetch | undefined; wait?: ((ms: number) => Promise<void>) | undefined;
    fetchProposal?: (sourceId: string, proposalId: string) => Promise<unknown> };
}) {
  const deps = o.deps ?? {};
  let current: SourceProposal | null = null;
  let firstAttempt: string | null = null;
  const keys = new Map<string, string>();
  const keyFor = (k: string) => { if (!keys.has(k)) keys.set(k, newKey()); return keys.get(k)!; };
  // One key per request (kind + LinkedIn link): Try again re-asks for the SAME attempt, never a new purchase.
  async function run(body: { kind: "email" } | { kind: "linkedin"; url: string }): Promise<LookupOutcome> {
    const started = await startLookup({ idempotencyKey: keyFor(`start:${body.kind}:${body.kind === "linkedin" ? body.url : ""}`), expectedConsentRevision: o.consentRevision, ...body }, deps.postFetcher);
    if (body.kind === "email") firstAttempt = started.attemptId;
    const s: LookupStatus = await watchLookup(started, deps);
    current = null;
    if (s.state === "not_found") return { kind: "not_found", canRequestLinkedin: s.canRequestLinkedin };
    if (s.state !== "review_ready" || !s.proposalId) return { kind: "unconfirmed" };
    const raw = await (deps.fetchProposal ?? fetchSourceProposal)(s.attemptId, s.proposalId) as SourceProposal;
    if (!raw || raw.proposalId !== s.proposalId || !Array.isArray(raw.facts)) throw new ProfileApiError(503, "authority_unavailable");
    current = raw;
    return { kind: "found", imported: { profile: lookupProfile(raw), source: "professional_profile" } };
  }
  return {
    first: () => run({ kind: "email" }),
    byLinkedin: (url: string) => run({ kind: "linkedin", url }),
    /** The lookup suggestion on screen, for an AI correction of it (null when there isn't one). */
    currentSource(): { proposalId: string; sourceVersion: number } | null {
      return current ? { proposalId: current.proposalId, sourceVersion: current.sourceVersion } : null;
    },
    async accept(): Promise<ManualProfile> {
      if (!current) throw new ProfileApiError(409, "source_not_found");
      return o.session.acceptSource(keyFor(`accept:${current.proposalId}`), acceptAllPayload(current, o.currentProfile()));
    },
    /** Records "not me", then returns whether the server now allows the one LinkedIn retry. */
    async reject(): Promise<boolean> {
      if (!current) return false;
      const p = current;
      await o.session.rejectSource(keyFor(`reject:${p.proposalId}`), { proposalId: p.proposalId, sourceVersion: p.sourceVersion, proposalHash: p.proposalHash, reason: "not_me" });
      return firstAttempt ? (await lookupStatus(firstAttempt, deps.fetcher)).canRequestLinkedin : false;
    },
  };
}
