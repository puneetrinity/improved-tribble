import { useCallback, useEffect, useRef, useState } from "react";
import Orb from "@/components/ui/orb";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CheckCircle2, CircleDashed, EyeOff, Lock, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CAPABILITY_COPY, needsReconfirm, RECONFIRM_NOTE, createSparkSession, describeReason, fieldLabel, GENERIC_ERROR, loadProfile, newKey, ProfileApiError, readResolution, reasonForStatus, resolutionSettled, resolveSave,
  type SaveResolution,
  type CapabilityReason, type CommandBody, type SparkSection, type ManualProfile, type PendingCommand, type Preferences, type ProfileLoad, type ProfileRead, type SparkProfileRead,
} from "@/lib/candidate-profile-api";
import { UNCERTAIN_COPY, useProfileCommand } from "@/hooks/use-profile-command";
import { ProfessionalDetailsForm, type ProfileSection } from "./ProfessionalDetailsForm";
import { CandidatePhoto, ProfileOverview } from "./ProfileOverview";
import { PreferencesSummary } from "./PreferencesSummary";
import { PreferencesForm } from "./PreferencesForm";
import { SaveStatus, type SaveState } from "./SaveStatus";
import { ReauthDialog } from "./SparkStates";
import { DEALBREAKERS_HELP, DEALBREAKERS_TITLE, DealbreakersEditor, DealbreakersSummary, dealbreakersFrom, type DealbreakerState } from "./DealbreakersPanel";

export const PROFILE_QUERY_KEY = ["candidate-product", "profile"] as const;
export const CONFIRM_NOTE = "Confirming saves this as your profile. Employers can't see it yet.";
/** Shown instead when the profile is already published: confirming changes what employers see. */
export const CONFIRM_NOTE_PUBLISHED = "Confirming updates the profile employers see.";
export const SAVE_FIRST = "Save your changes first. Confirming uses your saved details, not unsaved edits.";

type Deps = { load?: (() => Promise<ProfileLoad>) | undefined; command?: Parameters<typeof useProfileCommand>[1] | undefined;
  /** Test seam for spark commands (preference sections, promote and confirm). */
  spark?: Parameters<typeof createSparkSession>[1] | undefined;
  /** Test seam for stuck-save Retry / Discard. */
  resolution?: ResolutionDeps | undefined };
type ResolutionDeps = { fetcher?: typeof fetch | undefined; postFetcher?: typeof fetch | undefined; pollMs?: number | undefined };

/** Owner-only career profile. Renders nothing while the feature is off (404). */
export function CareerProfilePanel({ deps = {} }: { deps?: Deps | undefined }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: deps.load ?? (() => loadProfile()), staleTime: 0, retry: false });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: PROFILE_QUERY_KEY }), [qc]);
  // A privacy refusal while saving: reload, so the panel shows the restricted view.
  const onBlocked = useCallback((reason: string) => { if (reason === "candidate_privacy_restricted") void refresh(); }, [refresh]);
  const cmd = useProfileCommand(refresh, deps.command, onBlocked);
  const sparkActions = useSparkActions(refresh, cmd.setState, deps.spark);

  if (query.isLoading) return <PanelSkeleton />;
  if (query.isError) return <Unavailable onRefresh={() => query.refetch()} />;
  const data = query.data!;
  if (data.kind === "disabled") return null;
  if (data.kind === "unavailable") return <Unavailable onRefresh={() => query.refetch()} />;
  return <Ready profile={data.profile} cmd={cmd} spark={sparkActions} refresh={refresh} syncing={query.isFetching} resolution={deps.resolution} />;
}

/** spark profiles save preferences one section at a time and confirm by promoting the reviewed
 * preferences first. A save whose outcome is unknown keeps its key, so saving again re-sends
 * exactly the same commands; until then other edits and confirmation stay locked. */
function useSparkActions(refresh: () => unknown, setState: (s: SaveState) => void, deps?: Deps["spark"]) {
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  /** The one unresolved spark save: its key, session and the exact payload first submitted.
   * "Send again" re-sends exactly this (never later, unsent edits) until it settles. */
  const pending = useRef<{ key: string; session: ReturnType<typeof createSparkSession>; run: () => Promise<unknown> } | null>(null);
  function fail(e: unknown) {
    const code = e instanceof ProfileApiError ? (e.code ?? reasonForStatus(e)) : "unknown";
    if (code === "uncertain") { setUnresolved(pending.current !== null); setState({ kind: "error", message: UNCERTAIN_COPY }); return; }
    // Admitted but still running (U3-R1): not a refusal. Keep the same command and key.
    if (code === "pending_too_long") { setUnresolved(pending.current !== null); setState({ kind: "error", message: CAPABILITY_COPY.pending_changes }); return; }
    const d = describeReason(code);
    if (!d.retryable) { pending.current = null; setUnresolved(false); } else setUnresolved(pending.current !== null);
    setState({ kind: "error", message: CAPABILITY_COPY[code as CapabilityReason] ?? d.message });
  }
  async function send(): Promise<boolean> {
    if (!pending.current) return true;
    setBusy(true); setState({ kind: "sending" });
    try { await pending.current.run(); pending.current = null; setUnresolved(false); setState({ kind: "saved" }); await refresh(); return true; }
    catch (e) { fail(e); return false; } finally { setBusy(false); }
  }
  async function savePreferences(spark: SparkProfileRead, p: Preferences, sections: SparkSection[]): Promise<boolean> {
    if (pending.current) return send(); // an unresolved save goes first, exactly as submitted
    if (sections.length === 0) return true; // nothing touched, nothing to save
    const key = newKey(), session = createSparkSession(spark, deps);
    pending.current = { key, session, run: () => session.save(key, { kind: "preference_sections", preferences: p, sections }) };
    return send();
  }
  /** Deal-breakers and private notes (U3): same server path as onboarding. */
  async function saveDealbreakers(spark: SparkProfileRead, next: DealbreakerState): Promise<boolean> {
    if (pending.current) return send();
    const key = newKey(), session = createSparkSession(spark, deps);
    const desired = {
      exclusions: next.exclusions.map(e => e.kind === "exclude_company" ? { id: e.id, kind: e.kind, companyId: e.companyId } : { id: e.id, kind: e.kind }),
      notes: [...next.notes] };
    pending.current = { key, session, run: () => session.saveDealbreakers(key, desired) };
    return send();
  }
  /** Returns "reauth" when the server needs a recent password check first (nothing was confirmed). */
  async function confirm(spark: SparkProfileRead): Promise<"done" | "reauth" | "failed"> {
    setBusy(true); setState({ kind: "sending" });
    try {
      await createSparkSession(spark, deps).confirm({ profileVersion: String(spark.draftVersion), preferencesVersion: String(spark.preferenceDraft?.preferenceDraftRevision ?? 0) });
      setState({ kind: "saved" }); return "done";
    } catch (e) {
      if (e instanceof ProfileApiError && e.code === "recent_auth_required") { setState({ kind: "idle" }); return "reauth"; }
      fail(e); return "failed";
    } finally { setBusy(false); await refresh(); }
  }
  return { busy: busy || unresolved, inFlight: busy, unresolved, resend: send, savePreferences, saveDealbreakers, confirm };
}

const SECTION_TITLE: Record<ProfileSection, { title: string; hint: string }> = {
  basics: { title: "Name, headline and location", hint: "This is the first line employers read about you." },
  skills: { title: "Skills", hint: "Tools, methods and strengths you use at work." },
  employment: { title: "Work experience", hint: "Start with your current or most recent role." },
  education: { title: "Education", hint: "Degrees, diplomas or certificates." },
  projects: { title: "Projects", hint: "Work you built or led that shows what you can do." },
};
type Editing = { kind: "profile"; section: ProfileSection } | { kind: "preferences" } | { kind: "dealbreakers" } | null;

function Ready({ profile, cmd: base, spark, refresh, syncing, resolution }: { profile: ProfileRead; cmd: ReturnType<typeof useProfileCommand>; spark: ReturnType<typeof useSparkActions>; refresh: () => void; syncing: boolean; resolution?: ResolutionDeps | undefined }) {
  // One lock for both kinds of save: a spark save in flight or unresolved blocks everything else.
  const cmd = { ...base, busy: base.busy || spark.busy, inFlight: base.inFlight || spark.inFlight };
  const [dirtyDetails, setDirtyDetails] = useState(false);
  const [dirtyPrefs, setDirtyPrefs] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [reauth, setReauth] = useState(false);
  if (profile.state === "restricted") {
    return (
      <Card className="border-border">
        <CardHeader><CardTitle className="text-foreground text-xl">Career profile</CardTitle></CardHeader>
        <CardContent>
          <Alert><Lock className="h-4 w-4" aria-hidden /><AlertDescription>{describeReason(profile.code ?? "candidate_privacy_restricted").message}</AlertDescription></Alert>
        </CardContent>
      </Card>
    );
  }
  const versions = { d: profile.draftVersion ?? 0, p: profile.profileVersion ?? 0, r: profile.preferenceVersion ?? 0 };
  const body = (action: CommandBody["action"], payload: Record<string, unknown>): CommandBody => ({
    schemaVersion: 2, idempotencyKey: newKey(), expectedDraftVersion: versions.d, expectedProfileVersion: versions.p,
    expectedPreferenceVersion: versions.r, action, payload,
  });
  const caps = profile.capabilities;
  const editLocked = !caps.canEdit;
  const confirmed = profile.state === "confirmed" || versions.p > 0;
  const missing = profile.missingFields ?? [];
  const unsaved = dirtyDetails || dirtyPrefs;
  // Confirm only the exact saved snapshot on screen: no unsaved edits, no save in flight,
  // and the profile has been re-read after the last applied save.
  // spark confirmation promotes the reviewed preferences itself, so "not promoted yet" doesn't block it;
  // "needs a recent sign-in" opens the password check instead of blocking.
  const needsPassword = !!profile.spark && caps.confirmBlockedReason === "recent_auth_required";
  const canConfirm = caps.canConfirm || (!!profile.spark && (caps.confirmBlockedReason === "preferences_not_promoted" || needsPassword));
  const confirmSpark = async () => { if ((await spark.confirm(profile.spark!)) === "reauth") setReauth(true); };
  const confirmDisabled = !canConfirm || cmd.busy || syncing || unsaved || !profile.draftHash;
  const shown = profile.draft ?? profile.confirmedProfile;
  // The LinkedIn photo is the candidate's own: shown here only, never in the employer preview.
  const photoUrl = (shown as { photoUrl?: string | null } | null)?.photoUrl ?? null;
  // Close the editor only once the save is applied; otherwise keep it open with its status.
  const save = async (command: CommandBody) => { const o = await cmd.run(command); if (o.status === "applied") setEditing(null); };
  const blocked = !canConfirm && caps.confirmBlockedReason;
  const sparkUnanswered = profile.spark ? EDIT_SECTIONS.filter(k => profile.spark!.preferenceDraft?.sections[k]?.answered !== true) : [];
  const firstGap = missing.some(f => f === "preferences" || f.startsWith("preferences.") || f === "desiredRoles") ? "preferences" : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex min-w-0 items-start gap-4">
        {photoUrl && (
          <CandidatePhoto url={photoUrl} name={shown?.displayName} className="h-16 w-16 text-lg" />
        )}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-foreground">Career profile</h2>
            <Badge variant={confirmed ? "default" : "outline"} className="gap-1">
              {confirmed ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <CircleDashed className="h-3.5 w-3.5" aria-hidden />}
              {confirmed ? "Confirmed" : "Draft"}
            </Badge>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {profile.publicationActive ? <span aria-hidden className="orb-still inline-flex shrink-0"><Orb variant="globe" size={16} color="#F25C2E" /></span> : <EyeOff className="h-4 w-4 shrink-0" aria-hidden />}
            {profile.publicationActive ? "Visible to employers in the ealana network." : needsReconfirm(profile) ? RECONFIRM_NOTE : "Only you can see this. Employers can't see your profile yet."}
          </p>
        </div>
        </div>
        <div className="flex flex-col gap-1.5 md:items-end">
          <Button type="button" className="min-h-11 cursor-pointer" disabled={confirmDisabled}
            aria-describedby={blocked ? "confirm-blocked" : unsaved ? "confirm-unsaved" : "confirm-note"}
            onClick={() => void (profile.spark ? (needsPassword ? setReauth(true) : confirmSpark())
              : cmd.run(body("confirm", { draftHash: profile.draftHash, consentVersion: profile.confirmedConsentVersion ?? 0 })))}>
            <BadgeCheck className="mr-2 h-4 w-4" aria-hidden />{confirmed ? "Confirm changes" : "Confirm profile"}
          </Button>
          <p id="confirm-note" className="text-xs text-muted-foreground md:text-right">{profile.publicationActive ? CONFIRM_NOTE_PUBLISHED : CONFIRM_NOTE}</p>
          {blocked && <p id="confirm-blocked" className="text-xs text-muted-foreground md:text-right">{CAPABILITY_COPY[caps.confirmBlockedReason!] ?? CAPABILITY_COPY.feature_unavailable}</p>}
          {canConfirm && unsaved && <p id="confirm-unsaved" className="text-xs text-muted-foreground md:text-right">{SAVE_FIRST}</p>}
        </div>
      </header>

      {editLocked && caps.editBlockedReason && (
        <Alert><AlertDescription>{CAPABILITY_COPY[caps.editBlockedReason] ?? CAPABILITY_COPY.feature_unavailable}</AlertDescription></Alert>
      )}
      {missing.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Before you can confirm</p>
            <p className="text-sm text-muted-foreground">Still needed: {missing.map(fieldLabel).join(", ")}.</p>
          </div>
          {firstGap === "preferences" && !editLocked && (
            <Button type="button" className="min-h-11 shrink-0 cursor-pointer" onClick={() => setEditing({ kind: "preferences" })}>Add job preferences</Button>
          )}
        </div>
      )}
      <PendingList commands={profile.pendingCommands ?? []} more={!!profile.hasMorePendingCommands} watch={cmd.watch} active={cmd.busy} onSettled={refresh} resolution={resolution} />
      <div aria-live="polite" className="flex flex-wrap items-center gap-3 empty:hidden">
        {/* While a sheet is open it shows this save's status itself: one status, one moving indicator. */}
        {editing === null && <SaveStatus state={cmd.state} />}
        {cmd.unresolved && (
          <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={cmd.inFlight} onClick={() => void cmd.resend()}>Send again</Button>
        )}
        {spark.unresolved && editing === null && (
          <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={spark.inFlight} onClick={() => void spark.resend()}>Send again</Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-border">
          <CardHeader className="pb-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What employers will see</p>
          </CardHeader>
          <CardContent>
            <ProfileOverview profile={shown} canEdit={!editLocked && !cmd.busy}
              onEdit={section => setEditing({ kind: "profile", section })} />
          </CardContent>
        </Card>
        <Card className="h-fit border-border lg:sticky lg:top-4">
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="text-base text-foreground">What you're looking for</CardTitle>
            <CardDescription className="flex items-center gap-1.5 text-xs"><Lock className="h-3.5 w-3.5" aria-hidden />Private. Employers never see this.</CardDescription>
          </CardHeader>
          <CardContent>
            <PreferencesSummary preferences={profile.preferences} canEdit={!editLocked && !cmd.busy} onEdit={() => setEditing({ kind: "preferences" })}
              unansweredSections={profile.spark ? sparkUnanswered : undefined} />
            {profile.spark && <DealbreakersSummary state={dealbreakersFrom(profile.spark)} canEdit={!editLocked && !cmd.busy} onEdit={() => setEditing({ kind: "dealbreakers" })} />}
          </CardContent>
        </Card>
      </div>

      <Sheet open={editing !== null} onOpenChange={open => { if (!open && !cmd.inFlight) setEditing(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {editing?.kind === "profile" && (
            <>
              <SheetHeader className="mb-6 text-left">
                <SheetTitle>{SECTION_TITLE[editing.section].title}</SheetTitle>
                <SheetDescription>{SECTION_TITLE[editing.section].hint}</SheetDescription>
              </SheetHeader>
              <ProfessionalDetailsForm key={`d${versions.d}-${editing.section}`} section={editing.section} initial={shown} disabled={editLocked} busy={cmd.busy}
                onDirtyChange={setDirtyDetails} onCancel={() => setEditing(null)}
                onSave={(p: ManualProfile) => void save(body("save_draft", { profile: p }))} />
            </>
          )}
          {editing?.kind === "preferences" && (
            <>
              <SheetHeader className="mb-6 text-left">
                <SheetTitle>What you're looking for</SheetTitle>
                <SheetDescription>Private to you. We use it to find jobs that fit.</SheetDescription>
              </SheetHeader>
              <PreferencesForm key={`r${versions.r}-${profile.spark?.preferenceDraft?.preferenceDraftRevision ?? 0}`} initial={profile.preferences} disabled={editLocked || (!!profile.spark && spark.unresolved)}
                busy={profile.spark ? spark.busy : cmd.busy} onDirtyChange={setDirtyPrefs}
                spark={profile.spark ? { unanswered: sparkUnanswered, onSaveSections: (p, sections) => void spark.savePreferences(profile.spark!, p, sections).then(ok => { if (ok) setEditing(null); }) } : undefined}
                onSave={(p: Preferences) => void save(body("save_preferences", { preferences: p }))} />
            </>
          )}
          {editing?.kind === "dealbreakers" && profile.spark && (
            <>
              <SheetHeader className="mb-6 text-left">
                <SheetTitle>{DEALBREAKERS_TITLE}</SheetTitle>
                <SheetDescription className="sr-only">{DEALBREAKERS_HELP}</SheetDescription>
              </SheetHeader>
              <DealbreakersEditor key={`x${profile.spark.preferenceDraft?.preferenceDraftRevision ?? 0}`} initial={dealbreakersFrom(profile.spark)} busy={spark.busy}
                onCancel={() => setEditing(null)}
                onSave={next => void spark.saveDealbreakers(profile.spark!, next).then(ok => { if (ok) setEditing(null); })} />
            </>
          )}
          <div aria-live="polite" className="mt-4 flex flex-wrap items-center gap-3 empty:hidden">
            <SaveStatus state={cmd.state} />
            {/* An unresolved spark save is frozen as submitted; this re-sends exactly that. */}
            {spark.unresolved && (
              <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={spark.inFlight}
                onClick={() => void spark.resend().then(ok => { if (ok) setEditing(null); })}>Send again</Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ReauthDialog open={reauth} onCancel={() => setReauth(false)} onConfirmed={() => { setReauth(false); void confirmSpark(); }}
        onSignedOut={() => { setReauth(false); cmd.setState({ kind: "error", message: describeReason("authentication_changed").message }); }} />

      <Button type="button" variant="ghost" className="min-h-11 cursor-pointer text-muted-foreground" onClick={refresh}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh
      </Button>
    </div>
  );
}

/** Saves already admitted (for example before a reload). The server retries them; the page
 * watches. A held save shows the server's own Try again / Discard when it offers them; the
 * browser never resends the edit itself. */
function PendingList({ commands, more, watch, active, onSettled, resolution }: { commands: PendingCommand[]; more: boolean; watch: (id: string) => Promise<unknown>; active: boolean;
  onSettled: () => void; resolution?: ResolutionDeps | undefined }) {
  if (commands.length === 0) return null;
  return (
    <div className="space-y-2" aria-label="Edits still saving">
      {commands.map(c => <PendingRow key={c.commandId} command={c} watch={watch} paused={active} onSettled={onSettled} resolution={resolution} />)}
      {more && <p className="text-xs text-muted-foreground">More edits are still saving.</p>}
    </div>
  );
}

/** The preference questions the profile page edits (authorisation and notes live in setup). */
const EDIT_SECTIONS: SparkSection[] = ["roles", "location", "arrangement", "relocation", "employment_types", "availability", "compensation"];

const ACTION_LABEL: Record<string, string> = { save_draft: "Professional details", save_preferences: "Job preferences", save_preference_section: "Job preferences",
  promote_preferences: "Job preferences", accept_source: "Résumé suggestions", confirm: "Confirmation" };

function PendingRow({ command, watch, paused, onSettled, resolution }: { command: PendingCommand; watch: (id: string) => Promise<unknown>; paused: boolean;
  onSettled: () => void; resolution?: ResolutionDeps | undefined }) {
  const initial: SaveState = command.status === "held"
    ? (describeReason(command.reason).retryable ? { kind: "retrying", message: describeReason(command.reason).message } : { kind: "error", message: describeReason(command.reason).message })
    : { kind: "pending" };
  const [started, setStarted] = useState(false);
  // Only one poller at a time: the panel's own save takes priority.
  useEffect(() => {
    if (paused || started || initial.kind === "error") return;
    setStarted(true);
    void watch(command.commandId);
  }, [paused, started, initial.kind, watch, command.commandId]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-foreground">{ACTION_LABEL[command.action] ?? "Edit"}:</span>
      {command.status === "held" ? <StuckSave command={command} fallback={initial} onSettled={onSettled} deps={resolution} /> : <SaveStatus state={initial} />}
    </div>
  );
}

// Wording approved 3 Nov 2026.
export const DISCARD_LABEL = "Discard change";
export const DISCARD_CONFIRM = "Discard this change? If it hasn’t been saved, we’ll cancel it. If it’s already saved, it will stay in your profile.";
export const DISCARDED = "Change discarded.";
const TEAM_CHECK = "Your account needs a check by our team.";
const RESOLVE_POLLS = 20;

/** A held save: shows the server's resolution and only the actions it allows. */
function StuckSave({ command, fallback, onSettled, deps = {} }: { command: PendingCommand; fallback: SaveState; onSettled: () => void; deps?: ResolutionDeps | undefined }) {
  const [view, setView] = useState<SaveResolution | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [reauth, setReauth] = useState<null | (() => void)>(null);
  // One key per decision (action + the revision it was made on): a lost reply re-sends the same request.
  const keys = useRef(new Map<string, string>());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const poll = async (v: SaveResolution) => {
    let cur = v;
    for (let i = 0; i < RESOLVE_POLLS && alive.current && (cur.state === "retry_queued" || cur.state === "resolving"); i++) {
      await new Promise(r => setTimeout(r, deps.pollMs ?? 3000));
      try { cur = await readResolution(command.commandId, deps.fetcher); if (alive.current) setView(cur); } catch { /* keep the last answer */ }
    }
    if (alive.current && resolutionSettled(cur.state)) onSettled();
  };
  useEffect(() => {
    readResolution(command.commandId, deps.fetcher).then(v => { if (!alive.current) return; setView(v); void poll(v); }, () => undefined);
  }, [command.commandId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: "retry" | "discard") {
    if (!view || busy) return;
    const k = `${action}:${view.resolutionRevision}`;
    if (!keys.current.has(k)) keys.current.set(k, newKey());
    setBusy(true); setFailed(null);
    try {
      const v = await resolveSave(command.commandId, { idempotencyKey: keys.current.get(k)!, expectedResolutionRevision: view.resolutionRevision, action }, deps.postFetcher);
      setConfirmDiscard(false); setView(v); void poll(v);
    } catch (e) {
      const code = e instanceof ProfileApiError ? e.code : null;
      if (code === "recent_auth_required") { setReauth(() => () => void act(action)); return; }
      setFailed(code === "uncertain" ? UNCERTAIN_COPY : describeReason(code).retryable ? describeReason(code).message : GENERIC_ERROR);
    } finally { setBusy(false); }
  }

  const state: SaveState = !view ? fallback
    : view.state === "retry_queued" || view.state === "resolving" ? { kind: "pending" }
    : view.state === "applied" ? { kind: "saved" }
    : view.state === "discarded" ? { kind: "saved", message: DISCARDED }
    : view.state === "operator_review" ? { kind: "error", message: TEAM_CHECK }
    : view.state === "rejected" ? { kind: "error", message: GENERIC_ERROR }
    : fallback;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SaveStatus state={state} />
      {view?.canRetry && !confirmDiscard && (
        <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={busy} onClick={() => void act("retry")}>Try again</Button>
      )}
      {view?.canDiscard && !confirmDiscard && (
        <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" disabled={busy} onClick={() => setConfirmDiscard(true)}>{DISCARD_LABEL}</Button>
      )}
      {confirmDiscard && view?.canDiscard && (
        <span role="group" aria-label={DISCARD_CONFIRM} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">{DISCARD_CONFIRM}</span>
          <Button type="button" variant="destructive" className="min-h-11 cursor-pointer" disabled={busy} onClick={() => void act("discard")}>{DISCARD_LABEL}</Button>
          <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={busy} onClick={() => setConfirmDiscard(false)}>Cancel</Button>
        </span>
      )}
      {failed && <p role="alert" className="w-full text-sm text-destructive">{failed}</p>}
      <ReauthDialog open={reauth !== null} onCancel={() => setReauth(null)} onConfirmed={() => { const go = reauth; setReauth(null); go?.(); }}
        onSignedOut={() => { setReauth(null); setFailed(describeReason("authentication_changed").message); }} />
    </div>
  );
}

function Unavailable({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Card className="border-border">
      <CardHeader><CardTitle className="text-foreground text-xl">Career profile</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <AlertTitle>Can't load your profile right now</AlertTitle>
          <AlertDescription>Nothing has been lost. Try again in a minute.</AlertDescription>
        </Alert>
        <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={onRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Try again
        </Button>
      </CardContent>
    </Card>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading career profile">
      <Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-full max-w-md" /><Skeleton className="h-64 w-full" />
    </div>
  );
}
