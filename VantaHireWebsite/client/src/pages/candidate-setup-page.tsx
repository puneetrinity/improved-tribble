// /candidate-setup: first stop after a candidate verifies their email (spark only).
// 1. Record the consent they accepted at sign-up, once (no second checkbox while it's usable).
//    If there's no usable sign-up acceptance, they see the same approved consent text again.
// 2. Wait for Memory to acknowledge it.
// 3. Run the setup wizard on the real profile; confirming hands over to /my-dashboard?welcome=1.
// The wizard needs the professional-profile lookup (no manual-details fallback), so without one
// the candidate goes to the dashboard instead of seeing a lookup that never ran.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Redirect, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { CandidateAuthShell, SparkFrame } from "@/components/candidate-profile/CandidateAuthShell";
import { ConsentStep } from "@/components/candidate-profile/ConsentStep";
import { CONSENT_COPY_CURRENT, CONSENT_COPY_CURRENT_HASH } from "@/components/candidate-profile/consent-copy";
import { OnboardingWizard, hasProfileContent, type ImportedProfile, type PrefField, type SaveCommand } from "@/components/candidate-profile/OnboardingWizard";
import { lookupAdapters, resumeAdapters, type LookupOutcome } from "@/components/candidate-profile/SourceReview";
import { createInterpret } from "@/lib/spark-assist-adapter";
import type { Exclusion, Interpret, Proposal } from "@/components/candidate-profile/SparkAssist";
import { ReauthDialog, SessionEnded, StillWorking } from "@/components/candidate-profile/SparkStates";
import {
  ProfileApiError, SECTIONS_FOR, activateSignupConsent, ensureSparkFoundation, preferencesFromSections, consentActive, consentBlocked, createSparkSession, grantConsent, loadSparkProfile, newKey, readConsent,
  sparkVersions, uploadLibraryResume, waitForConsent, type ConsentStatus, type ManualProfile, type SparkExclusion, type SparkProfileRead, type SparkRunDeps,
} from "@/lib/candidate-profile-api";

export type SetupDeps = SparkRunDeps & { fetchProposal?: (sourceId: string, proposalId: string) => Promise<unknown>; upload?: (file: File) => Promise<number> };
type Stage =
  | { kind: "consent_checking" } | { kind: "consent_needed"; revision: number } | { kind: "consent_slow" }
  | { kind: "consent_blocked"; status: ConsentStatus["deliveryStatus"] } | { kind: "loading_profile" }
  | { kind: "error" } | { kind: "wizard"; profile: SparkProfileRead } | { kind: "signed_out" };
const signedOut = (e: unknown) => e instanceof ProfileApiError && e.status === 401;

export default function CandidateSetupRoute() {
  return <><Helmet><title>Set up your profile | ealana</title><meta name="robots" content="noindex, nofollow" /></Helmet><CandidateSetupPage /></>;
}

export function CandidateSetupPage({ deps = {} }: { deps?: SetupDeps }) {
  const { user } = useAuth();
  const config = useQuery({
    queryKey: ["/api/client-config", "candidateSparkSignupEnabled"],
    queryFn: async () => {
      const r = await fetch("/api/client-config", { credentials: "include", cache: "no-store" });
      return r.ok ? (await r.json().catch(() => null))?.candidateSparkSignupEnabled === true : false;
    },
    retry: false, staleTime: 0,
  });
  if (!user || user.role !== "candidate" || !user.emailVerified) return <Redirect to="/candidate-auth#signin" />;
  if (config.isLoading) return null;
  if (config.data !== true) return <Redirect to="/my-dashboard" />;
  return <Setup firstName={user.firstName || "there"} deps={deps} />;
}

function Setup({ firstName, deps }: { firstName: string; deps: SetupDeps }) {
  const [, navigate] = useLocation();
  const [stage, setStage] = useState<Stage>({ kind: "consent_checking" });
  const [imported, setImported] = useState<ImportedProfile | "none" | null>(null);
  const [lookupIssue, setLookupIssue] = useState<{ kind: "unconfirmed" | "failed"; retry?: () => void } | null>(null);
  const [linkedinAllowed, setLinkedinAllowed] = useState<boolean | undefined>(undefined);
  // The grant the candidate agreed to on this page; a retry re-sends exactly this, never asks again.
  const agreed = useRef<{ idempotencyKey: string; expectedConsentRevision: number; copyVersion: number; copyHash: string } | null>(null);
  const foundationKey = useRef(newKey());
  const poll = { fetcher: deps.fetcher, wait: deps.wait };
  // Password check before the wizard's confirm: resolves true once the password is accepted.
  const [reauth, setReauth] = useState<null | ((ok: boolean) => void)>(null);
  const askPassword = () => new Promise<boolean>(resolve => setReauth(() => resolve));
  // The latest draft the server has acknowledged (a résumé location replaces it only when different).
  const latestDraft = useRef<ManualProfile | null>(null);

  async function afterConsent(s: ConsentStatus) {
    if (consentBlocked(s)) return setStage({ kind: "consent_blocked", status: s.deliveryStatus });
    if (!consentActive(s)) return setStage({ kind: "consent_slow" });
    setStage({ kind: "loading_profile" });
    let loaded: Awaited<ReturnType<typeof loadSparkProfile>>;
    try { loaded = await loadSparkProfile(deps.fetcher); } catch (e) { return setStage(signedOut(e) ? { kind: "signed_out" } : { kind: "error" }); }
    if (loaded.kind === "disabled") return navigate("/my-dashboard");
    if (loaded.kind === "unavailable") return setStage({ kind: "error" });
    // Confirmed already, or saves still pending (the dashboard watches those): don't edit over them here.
    if (loaded.profile.profileVersion > 0 || loaded.profile.pendingCommands?.length) return navigate("/my-dashboard");
    latestDraft.current = loaded.profile.draft;
    setStage({ kind: "wizard", profile: loaded.profile });
    // The lookup is paid: it starts when the candidate presses "Let's start" (onStart), never on load.
  }
  const lookupStarted = useRef(false);
  function startLookup(p: SparkProfileRead) {
    // Returning with a profile already in the draft: nothing to look up again.
    if (lookupStarted.current || (p.draft && hasProfileContent(p.draft))) return;
    lookupStarted.current = true; void runFirstLookup(p);
  }

  /** The first lookup. A genuine miss is "none"; an unsettled outcome or a failure is its own state,
   * never "not found". Try again re-asks for the same request (same key), never a new purchase. */
  async function runFirstLookup(p: SparkProfileRead) {
    setLookupIssue(null); setImported(null);
    try {
      const o: LookupOutcome = await lookupFor(p, deps).first();
      if (o.kind === "found") { setImported(o.imported); return; }
      if (o.kind === "not_found") { setLinkedinAllowed(o.canRequestLinkedin); setImported("none"); return; }
      setImported("none"); setLookupIssue({ kind: "unconfirmed" });
    } catch (e) {
      // The lookup isn't switched on: carry on without it (résumé or typed details), never a lookup that never runs.
      if (e instanceof ProfileApiError && e.status === 404) { setLinkedinAllowed(false); setImported("none"); setLookupIssue({ kind: "unconfirmed" }); return; }
      if (signedOut(e)) return setStage({ kind: "signed_out" });
      setImported("none"); setLookupIssue({ kind: "failed", retry: () => void runFirstLookup(p) });
    }
  }

  async function start() {
    setStage({ kind: "consent_checking" });
    try {
      let foundation;
      try { foundation = await ensureSparkFoundation(foundationKey.current, deps); }
      catch (e) {
        if (!(e instanceof ProfileApiError) || e.code !== "recent_auth_required" || !(await askPassword())) throw e;
        foundation = await ensureSparkFoundation(foundationKey.current, deps);
      }
      if (foundation === "held") return setStage({ kind: "consent_blocked", status: "identity_review_required" });
      if (foundation !== "linked") return setStage({ kind: "consent_slow" });
      const now = await readConsent(deps.fetcher);
      if (consentActive(now) || consentBlocked(now) || now.desiredAction === "grant") return void (await afterConsent(await waitForConsent(poll)));
      const outcome = await activateSignupConsent(deps.postFetcher);
      if (outcome === "activated") return void (await afterConsent(await waitForConsent(poll)));
      // Already agreed here but the grant may not have arrived: re-send the same grant (same key).
      if (agreed.current) return void (await sendGrant());
      // No usable sign-up acceptance (none, expired, or replaced by a later choice): ask once with the same approved text.
      setStage({ kind: "consent_needed", revision: (await readConsent(deps.fetcher)).consentRevision });
    } catch (e) { setStage(signedOut(e) ? { kind: "signed_out" } : { kind: "error" }); }
  }
  useEffect(() => { void start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function agree(revision: number) {
    agreed.current ??= { idempotencyKey: newKey(), expectedConsentRevision: revision, copyVersion: CONSENT_COPY_CURRENT.copyVersion, copyHash: CONSENT_COPY_CURRENT_HASH };
    void sendGrant();
  }
  async function sendGrant() {
    setStage({ kind: "consent_checking" });
    try {
      await grantConsent(agreed.current!, deps.postFetcher);
      await afterConsent(await waitForConsent(poll));
    } catch (e) { setStage(signedOut(e) ? { kind: "signed_out" } : { kind: "error" }); }
  }

  if (stage.kind === "signed_out") return <SessionEnded />;
  if (stage.kind === "wizard") {
    const session = sessionFor(stage.profile, deps);
    const lookup = lookupFor(stage.profile, deps);
    const v = sparkVersions(stage.profile);
    // The résumé step shows only when the server says résumé reading is available.
    const resumeOn = stage.profile.capabilities.canRequestResume === true;
    const resume = resumeOn ? resumeFor(stage.profile, deps, () => latestDraft.current) : null;
    // AI help and the deal-breaker step share one server switch (the preview sits behind it).
    const aiOn = stage.profile.capabilities.canInterpret === true;
    const interpret = aiOn ? interpretFor(stage.profile, deps, () => session.versions(), () => lookup.currentSource(), askPassword, () => setStage({ kind: "signed_out" })) : undefined;
    const onSave = async (c: SaveCommand) => {
      try {
        if (c.kind === "dealbreakers") {
          const r = await session.saveDealbreakers(c.idempotencyKey, { exclusions: c.exclusions.map(toServerRule), notes: c.notes.map(n => n.text) });
          return { profileVersion: r.profileVersion, preferencesVersion: r.preferencesVersion, exclusions: r.exclusions.map(fromServerRule) };
        }
        const r = await session.save(c.idempotencyKey, toSparkEvent(c)); if (c.kind === "profile_draft") latestDraft.current = c.profile; return r;
      }
      catch (e) { if (signedOut(e)) setStage({ kind: "signed_out" }); throw e; }
    };
    const acceptKeys = acceptKeysFor(stage.profile);
    const acceptCorrection = async (pr: Proposal) => {
      if (!pr.server) throw new Error("not_server_proposal");
      if (!acceptKeys.has(pr.server.proposalId)) acceptKeys.set(pr.server.proposalId, newKey());
      try {
        const p = await session.acceptInterpretation(acceptKeys.get(pr.server.proposalId)!, pr.server);
        if (!p.draft) throw new ProfileApiError(503, "authority_unavailable");
        latestDraft.current = p.draft; return p.draft;
      } catch (e) { if (signedOut(e)) setStage({ kind: "signed_out" }); throw e; }
    };
    const signedOutToo = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      try { return await f(...a); } catch (e) { if (signedOut(e)) setStage({ kind: "signed_out" }); throw e; }
    };
    // At most one password prompt per confirm: if the server still asks, the wizard shows its retry.
    const confirm = async (reviewed: { profileVersion: string; preferencesVersion: string }, prompted = false): Promise<void> => {
      try { await session.confirm(reviewed); }
      catch (e) {
        if (signedOut(e)) { setStage({ kind: "signed_out" }); throw e; }
        // The server needs a recent password check; nothing was confirmed. Ask, then confirm once more.
        if (e instanceof ProfileApiError && e.code === "recent_auth_required" && !prompted && await askPassword()) return confirm(reviewed, true);
        throw e;
      }
    };
    return (
      <SparkFrame>
      <OnboardingWizard firstName={firstName} imported={imported} consentVersion={String(CONSENT_COPY_CURRENT.copyVersion)}
        discovery="not_ready" matching="not_ready" features={{ resume: resumeOn, dealbreakers: aiOn }}
        interpret={interpret} acceptCorrection={aiOn ? acceptCorrection : undefined}
        pendingResume={resume ? () => resume.restore(stage.profile.proposals ?? []) : undefined}
        readResume={resume ? file => resume.readResume(file) : undefined} retryResume={resume?.retryResume}
        acceptResume={resume ? signedOutToo(async (id: string, d: Parameters<typeof resume.acceptResume>[1], ed: Record<string, string>) => {
          const p = await resume.acceptResume(id, d, ed); latestDraft.current = p; return p; }) : undefined}
        lookupByLinkedin={async url => {
          try {
            const o = await lookup.byLinkedin(url);
            return o.kind === "found" ? o.imported : o.kind === "not_found" ? "none" : "unconfirmed";
          } catch (e) { if (signedOut(e)) setStage({ kind: "signed_out" }); throw e; }
        }}
        acceptLookup={async () => { const p = await lookup.accept(); latestDraft.current = p; return p; }} rejectLookup={lookup.reject}
        serverVersions={() => { const sv = session.versions(); return { profile: String(sv.draftVersion), preferences: String(sv.preferenceDraftRevision) }; }}
        lookupIssue={lookupIssue} linkedinAllowed={linkedinAllowed} profileUrl="/my-dashboard#profile" onStart={() => startLookup(stage.profile)}
        initialVersions={{ profile: String(v.draftVersion), preferences: String(v.preferenceDraftRevision) }}
        saved={savedFrom(stage.profile)}
        onSave={onSave}
        onConfirm={async c => { await confirm({ profileVersion: c.profileVersion, preferencesVersion: c.preferencesVersion }); navigate("/my-dashboard?welcome=1"); }} />
      <ReauthDialog open={reauth !== null} onCancel={() => { reauth?.(false); setReauth(null); }}
        onConfirmed={() => { reauth?.(true); setReauth(null); }} onSignedOut={() => { reauth?.(false); setReauth(null); setStage({ kind: "signed_out" }); }} />
      </SparkFrame>
    );
  }
  return (
    <CandidateAuthShell matching="not_ready">
      <ReauthDialog open={reauth !== null} onCancel={() => { reauth?.(false); setReauth(null); }}
        onConfirmed={() => { reauth?.(true); setReauth(null); }} onSignedOut={() => { reauth?.(false); setReauth(null); setStage({ kind: "signed_out" }); }} />
      {stage.kind === "consent_needed" ? (
        <ConsentStep textVersion={String(CONSENT_COPY_CURRENT.copyVersion)} privacyUrl={CONSENT_COPY_CURRENT.documents[0].url} termsUrl={CONSENT_COPY_CURRENT.documents[1].url}
          privacySettingsUrl="/my-dashboard#privacy" jobsUrl="/jobs" showMarketing={false} onDecide={c => { if (c.accepted) agree(stage.revision); }} />
      ) : stage.kind === "consent_slow" ? (
        <Notice title="This is taking longer than usual." body="Your account is ready, but profile setup is still processing." action="Check again" onAction={() => void start()} />
      ) : stage.kind === "consent_blocked" ? (
        stage.status === "failed"
          ? <Notice title="We couldn't finish profile setup." body="Please try again." action="Try again" onAction={() => void start()} />
          : <Notice title="Profile setup needs a check by our team." />
      ) : stage.kind === "error" ? (
        <Notice title="We couldn't check your setup status." body="Please try again." action="Try again" onAction={() => void start()} />
      ) : (
        <div className="space-y-2">
          <p role="status" className="flex items-center gap-2 text-base text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Setting up your profile…</p>
          <StillWorking active />
        </div>
      )}
    </CandidateAuthShell>
  );
}

const sessions = new WeakMap<SparkProfileRead, ReturnType<typeof createSparkSession>>();
const interprets = new WeakMap<SparkProfileRead, Interpret>();
/** One AI adapter per loaded profile, so its request keys survive re-renders. */
function interpretFor(p: SparkProfileRead, deps: SetupDeps, versions: () => ReturnType<typeof sparkVersions>,
  source: () => { proposalId: string; sourceVersion: number } | null, askPassword: () => Promise<boolean>, onSignedOut: () => void) {
  let i = interprets.get(p);
  if (!i) { i = createInterpret({ versions, source, askPassword, onSignedOut, postFetcher: deps.postFetcher, wait: deps.wait }); interprets.set(p, i); }
  return i;
}
const accepts = new WeakMap<SparkProfileRead, Map<string, string>>();
function acceptKeysFor(p: SparkProfileRead) { let m = accepts.get(p); if (!m) { m = new Map(); accepts.set(p, m); } return m; }
const toServerRule = (e: Exclusion) => e.kind === "exclude_company" ? { id: e.id, kind: e.kind, companyId: e.companyId } : { id: e.id, kind: e.kind };
/** The server's rule for the wizard. Company names come from the registry, which isn't live yet. */
const fromServerRule = (x: SparkExclusion): Exclusion => x.kind === "exclude_company"
  ? { id: x.id, kind: x.kind, companyId: x.companyId, companyName: "", domain: null } : { id: x.id, kind: x.kind };
const lookups = new WeakMap<SparkProfileRead, ReturnType<typeof lookupAdapters>>();
function lookupFor(p: SparkProfileRead, deps: SetupDeps) {
  let l = lookups.get(p);
  if (!l) {
    const session = sessionFor(p, deps);
    l = lookupAdapters({ session, consentRevision: p.effectiveConsentRevision ?? 0, currentProfile: () => p.draft, deps });
    lookups.set(p, l);
  }
  return l;
}
const resumes = new WeakMap<SparkProfileRead, ReturnType<typeof resumeAdapters>>();
function resumeFor(p: SparkProfileRead, deps: SetupDeps, currentProfile: () => ManualProfile | null) {
  let r = resumes.get(p);
  if (!r) {
    const upload = deps.upload ?? (deps.postFetcher ? (f: File) => uploadLibraryResume(f, deps.postFetcher) : undefined);
    r = resumeAdapters({ session: sessionFor(p, deps), currentProfile, deps: { ...deps, ...(upload ? { upload } : {}) } });
    resumes.set(p, r);
  }
  return r;
}
function sessionFor(p: SparkProfileRead, deps: SetupDeps) {
  let s = sessions.get(p);
  if (!s) { s = createSparkSession(p, deps); sessions.set(p, s); }
  return s;
}

/** The returning candidate's draft, as the wizard's starting point. A wizard question counts as
 * answered only when every section it saves is answered. */
export function savedFrom(p: SparkProfileRead) {
  const sections = p.preferenceDraft?.sections ?? {};
  const answered = (Object.keys(SECTIONS_FOR) as PrefField[]).filter(f => SECTIONS_FOR[f].every(k => sections[k]?.answered === true));
  const auth = sections.authorisation?.answered ? (sections.authorisation.value as { countryCode: string; status: "allowed" | "needs_visa" | "not_sure" }[]) : [];
  if (!p.draft && !answered.length && !p.preferenceDraft?.exclusions?.length) return undefined;
  const notes = sections.private_notes?.answered && Array.isArray(sections.private_notes.value) ? sections.private_notes.value as string[] : [];
  return { profile: p.draft ?? EMPTY_DRAFT, preferences: preferencesFromSections(sections), answered, authorisation: auth,
    exclusions: (p.preferenceDraft?.exclusions ?? []).map(fromServerRule), notes };
}
const EMPTY_DRAFT = { displayName: "", headline: "", linkedinUrl: null, currentLocation: null, skills: [], employment: [], education: [], projects: [] } as never;

/** Wizard save → spark command. Deal-breakers go through session.saveDealbreakers (preview, then accept); résumé review through accept_source. */
export function toSparkEvent(c: SaveCommand) {
  switch (c.kind) {
    case "profile_draft": return { kind: "profile_draft" as const, profile: c.profile };
    case "preferences_draft": return { kind: "preferences_draft" as const, preferences: c.preferences as never, answered: c.answered };
    case "work_authorisation": return { kind: "work_authorisation" as const, entries: c.entries };
    case "dealbreakers": throw new Error("use_saveDealbreakers");
    default: throw new Error("not_supported");
  }
}

function Notice({ title, body, action, onAction }: { title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <section className="space-y-4" role="alert">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {body && <p className="text-base text-muted-foreground">{body}</p>}
      {action && onAction && <Button type="button" className="min-h-11 cursor-pointer" onClick={onAction}>{action}</Button>}
    </section>
  );
}
