// Guided first-run setup (ealana spark): one question per screen, pre-filled from the
// professional-profile lookup (Crustdata, via S2B) so the candidate mostly confirms instead of
// typing. Typing (constrained AI, see SparkAssist) appears only where controls can't do the job:
// fixing an imported profile, describing what they did in a role, and deal-breakers. Every AI
// proposal is shown before it changes anything. Imported and résumé values are proposals; nothing
// is saved until the candidate confirms at the end.
import { CandidatePhoto } from "./ProfileOverview";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Briefcase, Check, ClipboardCheck, FileText, Search, UserRound, Loader2, MapPin, MessageSquareText, Plus, Sparkles, Trash2, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ManualProfile, Preferences } from "@/lib/candidate-profile-api";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { DEFAULT_PREFERENCES } from "./PreferencesForm";
import { EMPTY_PROFILE, ProfessionalDetailsForm } from "./ProfessionalDetailsForm";
import { ResumeReadError, ResumeReadStatus, type ResumeRead } from "./SourceReview";
import { ProfileOverview, dateRange, groupByEmployer, duration } from "./ProfileOverview";
import { PreferencesSummary } from "./PreferencesSummary";
import { SegmentedControl } from "./SegmentedControl";
import { SparkAssist, describeRule, ruleKey, type Exclusion, type ExclusionRule, type Interpret, type Op, type Proposal, type Suggestion } from "./SparkAssist";
import { TagInput } from "./TagInput";
import { countryName } from "./countries";
import { STILL_WORKING, useSlowAfter } from "./SparkStates";

export type ImportedProfile = { profile: ManualProfile; source: "professional_profile" | "resume" };
/** Where a résumé proposal came from: the owned résumé version and the extraction run. */
export type ResumeSource = { resumeVersionId: string; extractionVersion: string };
/** What résumé extraction proposes (S2B). Every item has a stable id, its source and the quoted
 * evidence. New roles are always new rows (never merged into a similar employer name); edits to
 * an existing role name its exact row. Conflicts are shown side by side for the candidate to pick. */
export type ResumeItem = { id: string; source: ResumeSource; evidence: string } & (
  | { kind: "employment"; employer: string; title: string; start: string | null; end: string | null; current: boolean }
  | { kind: "responsibility"; rowId: string; employer: string; title: string; text: string }
  | { kind: "education"; institution: string; qualification: string; start: string | null; end: string | null }
  | { kind: "skill" | "project"; value: string }
  | { kind: "location"; city: string; countryCode: string; displayCountry: string }
  | { kind: "conflict"; rowId: string; employer: string; title: string; field: "start" | "end"; profileValue: string; resumeValue: string });
export type ResumeExtraction = { resumeVersionId: string; items: ResumeItem[] };
export type Authorisation = "allowed" | "needs_visa" | "not_sure";
export type PrefField = "roles" | "where" | "how" | "pay";
/** Saved as the candidate goes (private, versioned), so refreshing or leaving loses nothing.
 * Work authorisation and deal-breakers are candidate-private and part of the preference draft:
 * every change to them is a new preference draft revision. Exclusions are only the kinds we can
 * enforce; anything else is a private note that never hides a job. */
export type SaveEvent =
  | { kind: "profile_draft"; baseVersion: string; profile: ManualProfile }
  | { kind: "preferences_draft"; baseVersion: string; preferences: Preferences; answered: PrefField[] }
  | { kind: "work_authorisation"; entries: { countryCode: string; status: Authorisation }[] }
  | { kind: "dealbreakers"; baseVersion: string; exclusions: Exclusion[]; notes: { id: string; text: string }[] }
  | { kind: "resume_review"; resumeVersionId: string; status: "reviewed"; decisions: Record<string, "keep" | "remove" | "profile" | "resume">; edits: Record<string, string> };
export type SaveResult = { profileVersion?: string; preferencesVersion?: string;
  /** Real mode, deal-breaker saves: what the server now enforces, with its own ids. */
  exclusions?: Exclusion[] | undefined };
/** Every save is a command with its own idempotency key. A retry after a timeout re-sends the SAME
 * command and key (the client checks its status first), so it can never create a second edit. */
export type SaveCommand = SaveEvent & { idempotencyKey: string };
/** Final confirmation: records exactly which saved versions the candidate reviewed and agreed to. */
export type ConfirmCommand = { idempotencyKey: string; profileVersion: string; preferencesVersion: string; consentVersion: string };
type Props = {
  firstName: string;
  /** Result of the background profile lookup; null while running, "none" if nothing usable was found. */
  imported: ImportedProfile | null | "none";
  /** Persist one step's answers. The wizard waits for it before moving on. */
  onSave: (command: SaveCommand) => Promise<SaveResult>;
  /** Sends the confirmation command for the reviewed versions; resolves when it's recorded. */
  onConfirm: (command: ConfirmCommand) => Promise<void>;
  /** The consent text version the candidate agreed to at sign-up. */
  consentVersion: string;
  /** Whether recruiter search and matching are actually live for this candidate. Copy depends on it. */
  /** Whether recruiter search and job matching are actually live for this candidate. They are
   * separate switches (sourcing ships before matching); copy never promises either one early. */
  discovery: "ready" | "not_ready";
  matching: "ready" | "not_ready";
  /** Second, LinkedIn-keyed lookup. Offered once, when the first lookup found nothing or found the wrong person. */
  lookupByLinkedin?: ((url: string) => Promise<ImportedProfile | "none" | "unconfirmed">) | undefined;
  /** Real mode: the first lookup ended without a settled answer ("unconfirmed") or couldn't be
   * reached ("failed", with a retry of the same request). Never shown as "not found". */
  lookupIssue?: { kind: "unconfirmed" | "failed"; retry?: (() => void) | undefined } | null | undefined;
  /** Real mode: whether the server allows the one LinkedIn retry. */
  linkedinAllowed?: boolean | undefined;
  /** Real mode: where the candidate adds details themselves (the profile page). */
  profileUrl?: string | undefined;
  /** Résumé extraction (S2B). Null while reading. */
  readResume?: ((file: File, rows: { id: string; employer: string; title: string }[]) => Promise<ResumeExtraction>) | undefined;
  /** AI help. Absent while the AI routes aren't live: the correction box and the
   * free-text deal-breaker box are then not offered (nothing is simulated). */
  interpret?: Interpret | undefined;
  /** Steps whose backend isn't live are left out rather than shown with sample data.
   * Defaults keep the full prototype journey. */
  features?: { resume?: boolean; dealbreakers?: boolean } | undefined;
  /** Real mode: send the review choices to the server (accept_source) and return its
   * draft. Without it the prototype merges the kept items locally. */
  acceptResume?: ((resumeVersionId: string, decisions: Record<string, "keep" | "remove" | "profile" | "resume">, edits: Record<string, string>) => Promise<ManualProfile>) | undefined;
  /** Real mode: the candidate pressed Try again on a failed reading. */
  retryResume?: ((commandId: string) => Promise<ResumeExtraction>) | undefined;
  /** Drafts a role description from the candidate's LinkedIn profile or résumé (never invented). */
  suggestRole?: ((row: { id: string; employer: string; title: string }, resumeVersionId: string | null) => Promise<Suggestion | null>) | undefined;
  /** Search our own company registry (no paid lookup). The candidate must pick the exact employer;
   * text that matches nothing can only be kept as a private note. */
  searchCompanies?: ((q: string) => Promise<Company[]>) | undefined;
  /** Real mode: "Yes, this is me" accepts the lookup's suggestions on the server (accept_source)
   * and returns the server's draft. Without it the prototype saves the found profile directly. */
  acceptLookup?: (() => Promise<ManualProfile>) | undefined;
  /** Real mode: "This isn't me" is recorded on the server (reject_source not_me), which is what
   * allows the one LinkedIn retry. */
  rejectLookup?: (() => Promise<boolean | void>) | undefined;
  /** A returning candidate's saved draft. The wizard starts from it (never from empty defaults that
   * would overwrite it) and, when a profile was already accepted, skips the intro and lookup. */
  saved?: { profile: ManualProfile; preferences: Preferences | null; answered: PrefField[]; authorisation: { countryCode: string; status: Authorisation }[];
    /** Returning: the deal-breakers and private notes already saved. */
    exclusions?: Exclusion[] | undefined; notes?: string[] | undefined } | undefined;
  /** Returning: a résumé that was read but not yet reviewed (null when there's none). */
  pendingResume?: (() => Promise<ResumeExtraction | null>) | undefined;
  /** Real AI: accept a reviewed correction of the imported profile; resolves with the server's draft. */
  acceptCorrection?: ((proposal: Proposal) => Promise<ManualProfile>) | undefined;
  /** Real mode: the session's acknowledged versions, read after a server step outside the save queue
   * (accepting or rejecting suggestions) so a confirm right after it matches what's saved. */
  serverVersions?: (() => { profile: string; preferences: string }) | undefined;
  /** The server's current draft versions, so the first confirm matches what's saved. */
  initialVersions?: { profile: string; preferences: string } | undefined;
  /** Real mode: called once when the candidate presses "Let's start". The paid lookup starts here,
   * never on page load, so nobody is looked up before they begin. */
  onStart?: (() => void) | undefined;
};
export type Company = { id: string; name: string; domain: string | null };

/** linkedin.com/in/<handle>, with or without https:// and www. Returns the normalised URL or null. */
export function normaliseLinkedin(raw: string): string | null {
  const m = raw.trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]{3,100})\/?(?:[?#].*)?$/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

const SECTIONS = ["About you", "What you want", "Review"] as const;
type StepKey = "welcome" | "match" | "resume" | "resumeReview" | "details" | "impact" | "impact2" | "skills" | "roles" | "where" | "authorisation" | "pay" | "dealbreakers" | "review";
const SECTION_OF: Record<StepKey, number> = { welcome: 0, match: 0, resume: 0, resumeReview: 0, details: 0, impact: 0, impact2: 0, skills: 0, roles: 1, where: 1, authorisation: 1, pay: 1, dealbreakers: 1, review: 2 };
const ARRANGEMENTS = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"]] as const;
// Pick any that suit (several = "either"). Nothing is pre-selected: we don't assume permanent.
const JOB_TYPES = [["permanent", "Permanent"], ["contract", "Contract"], ["gig_freelance", "Gig / freelance"]] as const;
const SENIORITY = ["Junior", "Mid-level", "Senior", "Lead", "Manager", "Director"];
const MOVE_TO: [string, string][] = [["Hyderabad", "IN"], ["Mumbai", "IN"], ["Pune", "IN"], ["Dubai", "AE"], ["Singapore", "SG"], ["London", "GB"]];

/** Apply confirmed AI operations to the profile draft. */
function applyProfileOps(p: ManualProfile, ops: Op[]): ManualProfile {
  let employment = p.employment;
  for (const o of ops) {
    // Exact row only. A missing row means the proposal is stale: it changes nothing.
    if (o.op === "employment_end" || o.op === "employment_start") {
      const v = { value: o.year, precision: "year" as const };
      employment = employment.map(r => r.id !== o.rowId ? r : o.op === "employment_end" ? { ...r, end: v, current: false } : { ...r, start: v });
    }
    if (o.op === "role_description") employment = employment.map(r => r.id === o.rowId ? { ...r, description: o.text } : r);
  }
  return { ...p, employment };
}
/** Apply confirmed AI operations to preferences (search changes and deal-breakers). */
export function applyPrefOps(p: Preferences, ops: Op[]): Preferences {
  let q = p;
  for (const o of ops) {
    if (o.op === "add_place") q = { ...q, locations: { mode: "specific", places: [...(q.locations.mode === "specific" ? q.locations.places : []).filter(x => x.city !== o.city), { city: o.city, countryCode: o.countryCode }] } };
    if (o.op === "relocation") q = { ...q, relocation: { mode: o.mode, destinations: o.city && o.countryCode ? [...q.relocation.destinations.filter(d => d.city !== o.city), { city: o.city, countryCode: o.countryCode }] : q.relocation.destinations } };
    if (o.op === "add_role" && !q.desiredRoles.includes(o.role)) q = { ...q, desiredRoles: [...q.desiredRoles, o.role].slice(0, 10) };
    if (o.op === "seniority") q = { ...q, preferredSeniority: o.values };
    if (o.op === "arrangements") q = { ...q, workArrangements: o.values, remoteRegions: o.values.includes("remote") ? (q.remoteRegions ?? { mode: "worldwide" }) : null };
    if (o.op === "pay_minimum" && q.compensation.mode === "target") q = { ...q, compensation: { ...q.compensation, hardMinimum: Number(o.amount).toFixed(2) } };
  }
  return q;
}

const RESUME_KIND: Record<ResumeItem["kind"], string> = { employment: "New role", responsibility: "What you did", education: "Education", skill: "Skill", project: "Project", location: "Current location", conflict: "Date" };
function resumeLabel(it: ResumeItem): string {
  switch (it.kind) {
    case "employment": return `${it.title} at ${it.employer}${it.start ? ` · ${it.start} – ${it.current ? "Present" : it.end ?? ""}` : ""}`;
    case "responsibility": return `${it.title} at ${it.employer}: ${it.text}`;
    case "education": return `${it.qualification}, ${it.institution}${it.start ? ` · ${it.start} – ${it.end ?? ""}` : ""}`;
    case "location": return `${it.city}, ${it.displayCountry}`;
    case "conflict": return "";
    default: return it.value;
  }
}
/** Only free text is edited inline; structured items are kept or removed, then edited on the profile. */
function editable(it: ResumeItem): string | null { return it.kind === "skill" || it.kind === "project" ? it.value : it.kind === "responsibility" ? it.text : null; }

type Choice = Record<string, "keep" | "remove" | "profile" | "resume">;
/** The résumé suggestions to keep, edit or remove. Shared by the wizard and My profile. */
export function ResumeReviewList({ items, choice, setChoice, edits, setEdits }: { items: ResumeItem[];
  choice: Choice; setChoice: React.Dispatch<React.SetStateAction<Choice>>;
  edits: Record<string, string>; setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  return (
    <ul className="space-y-3">
      {items.map(it => it.kind === "conflict" ? (
        <li key={it.id} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-4">
          <p className="text-sm font-medium text-foreground">{it.title} at {it.employer}: {it.field === "start" ? "start" : "end"} date doesn't match</p>
          <p className="text-xs text-muted-foreground">From your résumé: <q className="italic">{it.evidence}</q></p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["profile", "resume"] as const).map(src => (
              <button key={src} type="button" aria-pressed={choice[it.id] === src} onClick={() => setChoice(c => ({ ...c, [it.id]: src }))}
                className={cn("min-h-11 cursor-pointer rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  choice[it.id] === src ? "border-primary bg-background ring-1 ring-primary" : "border-border bg-background hover:bg-muted")}>
                <span className="block text-xs text-muted-foreground">{src === "profile" ? "Professional profile" : "Your résumé"}</span>
                <span className="font-medium text-foreground">{src === "profile" ? it.profileValue : it.resumeValue}</span>
              </button>
            ))}
          </div>
        </li>
      ) : (
        <li key={it.id} className={cn("flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card p-4", choice[it.id] === "remove" && "opacity-60")}>
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{RESUME_KIND[it.kind]}</p>
            {edits[it.id] !== undefined
              ? <Input aria-label={`Edit ${RESUME_KIND[it.kind].toLowerCase()}`} value={edits[it.id]} onChange={e => setEdits(m => ({ ...m, [it.id]: e.target.value }))} className="mt-1 min-h-11" />
              : <p className={cn("text-sm text-foreground", choice[it.id] === "remove" && "line-through")}>{resumeLabel(it)}</p>}
            <p className="mt-1 text-xs text-muted-foreground">From your résumé: <q className="italic">{it.evidence}</q></p>
          </div>
          {choice[it.id] === "remove"
            ? <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => setChoice(c => ({ ...c, [it.id]: "keep" }))}>Keep it</Button>
            : <div className="flex gap-1">
                {edits[it.id] === undefined && editable(it) !== null && <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => setEdits(m => ({ ...m, [it.id]: editable(it)! }))}>Edit</Button>}
                <Button type="button" variant="ghost" className="min-h-11 cursor-pointer gap-1" onClick={() => setChoice(c => ({ ...c, [it.id]: "remove" }))}><Trash2 className="h-4 w-4" aria-hidden />Remove</Button>
              </div>}
        </li>
      ))}
    </ul>
  );
}
const yearDate = (y: string | null) => y ? { value: y, precision: (y.length === 4 ? "year" : "month") as "year" | "month" } : null;
const sortedRows = (p: ManualProfile) => [...p.employment].sort((a, b) => (b.current ? "9999" : b.start?.value ?? "").localeCompare(a.current ? "9999" : a.start?.value ?? ""))
  .map(r => ({ id: r.id, employer: r.employer, title: r.title }));

const NO_AI: Interpret = async () => ({ kind: "cannot_help", message: "This isn't available yet. You can change it directly." });
export function OnboardingWizard({ acceptCorrection, pendingResume, firstName, imported: firstLookup, onSave, onConfirm, consentVersion, discovery, matching, lookupByLinkedin, readResume, interpret: realInterpret, suggestRole, searchCompanies, features, acceptResume, retryResume, initialVersions, acceptLookup, rejectLookup, saved, lookupIssue, linkedinAllowed, profileUrl, serverVersions, onStart }: Props) {
  const interpret = realInterpret ?? NO_AI;
  const hasAi = !!realInterpret;
  const resumeOn = features?.resume !== false, dealbreakersOn = features?.dealbreakers !== false;
  // Resuming: a profile is already in the draft, so there's nothing to look up again.
  const resuming = !!saved && hasProfileContent(saved.profile);
  const [key, setKey] = useState<StepKey>(resuming ? "skills" : "welcome");
  const [match, setMatch] = useState<"pending" | "yes" | "no">(resuming ? "yes" : "pending");
  const [correcting, setCorrecting] = useState(false);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeItems, setResumeItems] = useState<ResumeItem[] | null>(null);
  const [resumeVersionId, setResumeVersionId] = useState<string | null>(null);
  /** Returning with résumé suggestions still to review (there's no file in this session). */
  const [restoredResume, setRestoredResume] = useState(false);
  // Real mode only: a reading that ended without suggestions, shown with Try again.
  const [resumeFailure, setResumeFailure] = useState<ResumeRead | null>(null);
  // Acknowledged versions. The ref is what logic reads (updated the moment a save is acknowledged);
  // the state copy only drives rendering.
  const [versions, setVersions] = useState(initialVersions ?? { profile: "p0", preferences: "q0" });
  const versionsRef = useRef(versions);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [answered, setAnswered] = useState<PrefField[]>(saved?.answered ?? []);
  /** While a save is in flight or has failed, nothing else may start a new edit or move on. */
  const locked = saving === "saving" || saving === "failed";
  const [resumeChoice, setResumeChoice] = useState<Record<string, "keep" | "remove" | "profile" | "resume">>({});
  const [resumeEdits, setResumeEdits] = useState<Record<string, string>>({});
  // The LinkedIn retry replaces the first lookup's result. One retry only: each lookup is a paid request.
  const [retry, setRetry] = useState<{ phase: "idle" | "asking" | "looking" | "done"; result: ImportedProfile | "none" | null; url: string; error: string | null }>({ phase: "idle", result: null, url: "", error: null });
  const imported = retry.phase === "looking" ? null : retry.result ?? firstLookup;
  const found = imported && imported !== "none" ? imported.profile : null;
  const [linkedinOk, setLinkedinOk] = useState(linkedinAllowed ?? true);
  useEffect(() => { if (linkedinAllowed !== undefined) setLinkedinOk(linkedinAllowed); }, [linkedinAllowed]);
  const [linkedinIssue, setLinkedinIssue] = useState<{ kind: "unconfirmed" | "failed"; retry?: () => void } | null>(null);
  const canRetry = !!lookupByLinkedin && retry.phase === "idle" && linkedinOk;
  const askLinkedin = canRetry && (imported === "none" || match === "no");
  // Real mode only: an unsettled or failed lookup, or a miss with no retry left. It never ends the
  // wizard: the candidate continues to the résumé and details steps.
  const matchIssue: { kind: "unconfirmed" | "failed" | "final"; retry?: (() => void) | undefined } | null = !profileUrl ? null
    : linkedinIssue ?? lookupIssue ?? (imported === "none" && !askLinkedin && retry.phase !== "looking" ? { kind: "final" } : match === "no" && !askLinkedin ? { kind: "final" } : null);
  const [profile, setProfile] = useState<ManualProfile>(saved?.profile ?? EMPTY_PROFILE);
  const [prefs, setPrefs] = useState<Preferences>(saved?.preferences ?? { ...DEFAULT_PREFERENCES, workArrangements: [], employmentTypes: [] });
  const savedPay = saved?.answered.includes("pay") ? payFromCompensation(saved.preferences?.compensation) : null;
  const [payOpen, setPayOpen] = useState(savedPay?.open ?? false);
  const [pay, setPay] = useState(savedPay?.pay ?? { min: "", max: "", firm: false });
  const [auth, setAuth] = useState<Record<string, Authorisation>>(Object.fromEntries((saved?.authorisation ?? []).map(a => [a.countryCode, a.status])));
  const [notes, setNotes] = useState<{ id: string; text: string }[]>(() => (saved?.notes ?? []).map(text => ({ id: crypto.randomUUID(), text })));
  const [exclusions, setExclusions] = useState<Exclusion[]>(saved?.exclusions ?? []);
  /** The server's deal-breakers after the last acknowledged save (real mode). */
  const serverExclusions = useRef<Exclusion[] | null>(null);
  // Deal-breakers picked directly (no AI) wait here for the same confirmation card before saving.
  const [pending, setPending] = useState<{ rules: ExclusionRule[]; notes: string[] } | null>(null);
  const [companyQ, setCompanyQ] = useState("");
  const [companies, setCompanies] = useState<Company[] | "loading" | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const city = profile.currentLocation;
  const home = city?.countryCode ?? "IN";
  const currency = home === "IN" ? "INR" : "USD";

  // Countries outside home the candidate might work in: only then do we ask about the right to work.
  const abroad = useMemo(() => {
    const cc = new Set<string>();
    if (prefs.relocation.mode !== "no") prefs.relocation.destinations.forEach(d => cc.add(d.countryCode));
    if (prefs.locations.mode === "specific") prefs.locations.places.forEach(p => cc.add(p.countryCode));
    cc.delete(home); return [...cc];
  }, [prefs, home]);
  const recentRoles = useMemo(() => groupByEmployer(profile.employment as any).slice(0, 2).map(g => g.roles[0]!), [profile.employment]);
  // What they wrote about each recent role; saved as written when they continue.
  const [roleText, setRoleText] = useState<Record<string, string>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Suggestion | "loading" | null>>({});
  const impactRow = key === "impact" ? recentRoles[0] : key === "impact2" ? recentRoles[1] : undefined;
  useEffect(() => {
    if (!impactRow || !suggestRole || impactRow.id in roleDrafts) return;
    const row = { id: impactRow.id, employer: impactRow.employer, title: impactRow.title };
    setRoleDrafts(m => ({ ...m, [row.id]: "loading" }));
    suggestRole(row, resumeVersionId ?? null).then(r => setRoleDrafts(m => ({ ...m, [row.id]: r })), () => setRoleDrafts(m => ({ ...m, [row.id]: null })));
  }, [impactRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = useMemo<StepKey[]>(() => ([
    ...(resuming ? [] : ["welcome" as const, "match" as const]), ...(resumeOn ? ["resume" as const] : []), ...(resume || restoredResume ? ["resumeReview" as const] : []),
    // No accepted lookup: the candidate types or checks their details here, so onboarding never ends at a failed lookup.
    ...(!resuming && match !== "yes" ? ["details" as const] : []), ...(recentRoles.length ? ["impact" as const] : []), ...(recentRoles.length > 1 ? ["impact2" as const] : []), "skills",
    "roles", "where", ...(abroad.length ? ["authorisation" as const] : []), "pay", ...(dealbreakersOn ? ["dealbreakers" as const] : []), "review",
  ]), [resume, restoredResume, recentRoles.length, abroad.length, resumeOn, dealbreakersOn, resuming, match]);
  useEffect(() => {
    if (!resuming || !resumeOn || !pendingResume) return;
    let live = true;
    pendingResume().then(x => { if (live && x && x.items.length) { setResumeVersionId(x.resumeVersionId); setResumeItems(x.items); setRestoredResume(true); setKey("resumeReview"); } }, () => undefined);
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const step = Math.max(0, steps.indexOf(key));
  const go = (n: number) => setKey(steps[Math.max(0, Math.min(steps.length - 1, n))]!);
  /** After the lookup is accepted the details step drops out of the list; move on from the
   * current list without it (the index-based go() would land on the step that is disappearing). */
  const afterAccepted = () => setKey(steps.slice(step + 1).find(k => k !== "details") ?? steps[steps.length - 1]!);

  // Suggestions come from the confirmed import only; they change nothing until picked.
  const roleSuggestions = useMemo(() => {
    const titles = groupByEmployer((profile.employment ?? []) as any).flatMap(g => g.roles.map(r => r.title));
    const latest = titles[0];
    const out = new Set<string>(latest ? [latest] : []);
    if (latest && !/lead|principal|head|staff/i.test(latest)) out.add(latest.replace(/^(Senior |Sr\.? )?/i, "Lead "));
    if (profile.headline) out.add(profile.headline.split(",")[0]!.trim());
    return [...out].filter(Boolean).filter(r => !prefs.desiredRoles.includes(r)).slice(0, 4);
  }, [profile, prefs.desiredRoles]);

  /** A server step outside the save queue; a failure offers the same retry as a failed save. */
  async function serverStep(work: () => Promise<void>, again: () => void) {
    setSaving("saving");
    try {
      await work();
      if (serverVersions) { versionsRef.current = serverVersions(); setVersions(versionsRef.current); confirmCmd.current = null; }
      setSaving("saved");
    }
    catch { afterSave.current = again; setSaving("failed"); }
  }
  function acceptImport() {
    if (!found) return;
    if (acceptLookup) return void serverStep(async () => { const p = await acceptLookup(); setProfile(p); setMatch("yes"); afterAccepted(); }, acceptImport);
    void saveProfile(found, () => { setProfile(found); setMatch("yes"); afterAccepted(); });
  }
  function rejectImport() {
    const local = () => { setProfile({ ...EMPTY_PROFILE }); setMatch("no"); setCorrecting(false); if (!canRetry) go(step + 1); };
    if (rejectLookup && found) return void serverStep(async () => { const ok = await rejectLookup(); if (typeof ok === "boolean") setLinkedinOk(ok); local(); }, rejectImport);
    local();
  }
  async function retryWithLinkedin() {
    const url = normaliseLinkedin(retry.url);
    if (!url) { setRetry({ ...retry, error: "Enter your LinkedIn profile link, for example linkedin.com/in/your-name" }); return; }
    setRetry({ ...retry, url, phase: "looking", error: null }); setMatch("pending"); setLinkedinIssue(null);
    let result: ImportedProfile | "none" | "unconfirmed" = "none";
    try { result = await lookupByLinkedin!(url); }
    catch {
      // Real mode: couldn't reach it. Try again asks about the same request (same link, same key).
      if (profileUrl) { setRetry(r => ({ ...r, phase: "idle" })); setLinkedinIssue({ kind: "failed", retry: () => void retryWithLinkedin() }); return; }
    }
    if (result === "unconfirmed") { setRetry(r => ({ ...r, phase: "done", result: "none" })); setLinkedinIssue({ kind: "unconfirmed" }); return; }
    setRetry(r => ({ ...r, phase: "done", result }));
    if (result !== "none") setProfile(p => ({ ...p, linkedinUrl: url }));
  }
  async function loadResume(read: () => Promise<ResumeExtraction>) {
    setResumeItems(null); setResumeFailure(null); setResumeVersionId(null); setResumeChoice({}); setResumeEdits({});
    try { const x = await read(); setResumeVersionId(x.resumeVersionId); setResumeItems(x.items); }
    catch (e) { if (e instanceof ResumeReadError) setResumeFailure(e.read); else setResumeItems([]); }
  }
  async function chooseResume(f: File | null) {
    setResume(f); setResumeItems(null); setResumeVersionId(null); setResumeChoice({}); setResumeEdits({}); setResumeFailure(null);
    if (f && readResume) await loadResume(() => readResume(f, sortedRows(profile)));
  }
  /** Turn the kept résumé proposals into a profile draft. */
  function resumeApplied(): ManualProfile {
    let p = profile;
    for (const it of resumeItems ?? []) {
      const choice = resumeChoice[it.id];
      if (it.kind === "conflict") {
        if (choice === "resume") p = applyProfileOps(p, [{ op: it.field === "start" ? "employment_start" : "employment_end", rowId: it.rowId, employer: it.employer, title: it.title, year: it.resumeValue }]);
        continue;
      }
      if (choice === "remove") continue;
      const edited = resumeEdits[it.id]?.trim();
      if (it.kind === "skill" || it.kind === "project") {
        const value = edited ?? it.value; if (!value) continue;
        if (it.kind === "skill" && !p.skills.some(s => s.toLowerCase() === value.toLowerCase())) p = { ...p, skills: [...p.skills, value] };
        if (it.kind === "project") p = { ...p, projects: [...p.projects, { id: crypto.randomUUID(), name: value, description: "", start: null, end: null, current: false }] };
      }
      if (it.kind === "responsibility") { const text = edited ?? it.text; p = { ...p, employment: p.employment.map(r => r.id !== it.rowId ? r : { ...r, description: r.description ? `${r.description}\n${text}` : text }) }; }
      if (it.kind === "employment") p = { ...p, employment: [...p.employment, { id: crypto.randomUUID(), employer: it.employer, title: it.title, description: "", start: yearDate(it.start), end: it.current ? null : yearDate(it.end), current: it.current }] };
      if (it.kind === "education") p = { ...p, education: [...p.education, { id: crypto.randomUUID(), institution: it.institution, qualification: it.qualification, description: "", start: yearDate(it.start), end: yearDate(it.end), current: false }] };
      if (it.kind === "location") p = { ...p, currentLocation: { city: it.city, countryCode: it.countryCode, displayCountry: it.displayCountry } };
    }
    return p;
  }
  /** Save, wait, and only then let the candidate move on. */
  // Commands not yet known to be saved. They are retried as-is (same key) before anything new.
  const unsaved = useRef<SaveCommand[]>([]);
  // The one immutable confirmation command; a retry re-sends exactly this object.
  const confirmCmd = useRef<ConfirmCommand | null>(null);
  const flushing = useRef<Promise<boolean> | null>(null);
  // What to do once the current saves land (move on, apply the change). Kept across a retry.
  const afterSave = useRef<(() => void) | null>(null);
  async function persist(events: SaveEvent[], then: () => void = () => undefined): Promise<void> {
    if (locked) return; // belt and braces: every control is disabled while a save is pending or failed
    unsaved.current = [...unsaved.current, ...events.map(e => ({ ...e, idempotencyKey: crypto.randomUUID() }))];
    confirmCmd.current = null; // any new edit makes an unsent confirmation stale
    afterSave.current = then;
    if (await flush()) { afterSave.current = null; then(); }
  }
  /** Send queued commands in order, one at a time. Only one flush runs at once. */
  function flush(): Promise<boolean> {
    if (flushing.current) return flushing.current;
    flushing.current = (async () => {
      setSaving("saving");
      while (unsaved.current.length) {
        const cmd = unsaved.current[0]!;
        try {
          const r = await onSave(cmd);
          if (r.exclusions) serverExclusions.current = r.exclusions;
          versionsRef.current = { profile: r.profileVersion ?? versionsRef.current.profile, preferences: r.preferencesVersion ?? versionsRef.current.preferences };
          setVersions(versionsRef.current);
          unsaved.current = unsaved.current.slice(1);
        } catch { setSaving("failed"); return false; }
      }
      setSaving("saved"); return true;
    })().finally(() => { flushing.current = null; });
    return flushing.current;
  }
  /** Retry: same commands, same keys. Then carry on with whatever the step was doing. */
  async function retrySave() {
    if (confirmCmd.current && !unsaved.current.length) { void confirm(); return; }
    if (await flush()) { const then = afterSave.current; afterSave.current = null; then?.(); }
  }
  async function confirm() {
    if (!(await flush())) { afterSave.current = () => void confirm(); return; }
    // Built once, from the versions the server acknowledged, then never rebuilt.
    confirmCmd.current ??= { idempotencyKey: crypto.randomUUID(), profileVersion: versionsRef.current.profile, preferencesVersion: versionsRef.current.preferences, consentVersion };
    setSaving("saving");
    try { await onConfirm(confirmCmd.current); setSaving("saved"); }
    catch { setSaving("failed"); }
  }
  /** A proposal made against an older version is rejected, never applied over newer edits. */
  const STALE = "Your profile changed since this suggestion was made, so we didn't use it. Please ask again.";
  const isStale = (pr: Proposal, part: "profile" | "preferences") => pr.baseVersion !== versionsRef.current[part];
  const saveProfile = (p: ManualProfile, then: () => void) => persist([{ kind: "profile_draft", baseVersion: versionsRef.current.profile, profile: p }], then);
  const savePrefs = (q: Preferences, a: PrefField[], then: () => void) => persist([{ kind: "preferences_draft", baseVersion: versionsRef.current.preferences, preferences: q, answered: a }], then);
  /** Deal-breakers are saved as one preference-draft change, the same way for AI and direct picks. */
  const saveDealbreakers = (ex: Exclusion[], ns: { id: string; text: string }[], then: () => void = () => undefined) =>
    persist([{ kind: "dealbreakers", baseVersion: versionsRef.current.preferences, exclusions: ex, notes: ns }], () => {
      // Real mode: keep the server's ids, so a later removal names the rule the server holds.
      setExclusions(serverExclusions.current ?? ex); serverExclusions.current = null; setNotes(ns); then(); });
  function addDealbreakers(rules: ExclusionRule[], texts: string[], then?: () => void) {
    const have = new Set(exclusions.map(ruleKey));
    const fresh = rules.filter(r => { const k = ruleKey(r); if (have.has(k)) return false; have.add(k); return true; });
    const ex: Exclusion[] = [...exclusions, ...fresh.map(r => ({ ...r, id: crypto.randomUUID() }))];
    const ns = [...notes, ...texts.filter(t => !notes.some(n => n.text.toLowerCase() === t.toLowerCase())).map(text => ({ id: crypto.randomUUID(), text }))];
    // Nothing new (everything is already there): no save, so the preference draft revision doesn't move.
    if (!fresh.length && ns.length === notes.length) { then?.(); return Promise.resolve(); }
    return saveDealbreakers(ex, ns, then);
  }
  const queue = (rule: ExclusionRule | null, note?: string) => setPending(p => {
    const rules = p?.rules ?? [], ns = p?.notes ?? [];
    const addRule = rule && ![...exclusions.map(ruleKey), ...rules.map(ruleKey)].includes(ruleKey(rule));
    return { rules: addRule ? [...rules, rule] : rules, notes: note && !ns.includes(note) ? [...ns, note] : ns };
  });
  async function findCompany() {
    const q = companyQ.trim(); if (!q || !searchCompanies) return;
    setCompanies("loading");
    try { setCompanies(await searchCompanies(q)); } catch { setCompanies([]); }
  }
  // Preferences as they'd be saved now (pay included), for the live preview and the finish.
  const livePrefs: Preferences = useMemo(() => {
    const compensation: Preferences["compensation"] = payOpen || !pay.min ? { mode: "open_to_discussion" }
      : { mode: "target", currency, period: "annual", component: "ctc", targetMin: amount(pay.min, currency), targetMax: amount(pay.max || pay.min, currency), hardMinimum: pay.firm ? amount(pay.min, currency) : null };
    return { ...prefs, compensation };
  }, [prefs, pay, payOpen, currency]);
  /** What each step saves when the candidate presses Continue. */
  async function continueFrom(k: StepKey) {
    const mark = (f: PrefField[]) => { const a = [...new Set([...answered, ...f])]; setAnswered(a); return a; };
    const next = () => go(step + 1);
    if (k === "welcome") { onStart?.(); return next(); }
    if (k === "resumeReview" && resumeVersionId && acceptResume) {
      // The server applies the review to the private draft; we show what it saved.
      setSaving("saving");
      try { const p = await acceptResume(resumeVersionId, resumeChoice, resumeEdits); setProfile(p); setSaving("saved"); next(); }
      catch { afterSave.current = () => void continueFrom("resumeReview"); setSaving("failed"); }
      return;
    }
    if (k === "resumeReview" && resumeVersionId) {
      const p = resumeApplied();
      return persist([{ kind: "resume_review", resumeVersionId, status: "reviewed", decisions: resumeChoice, edits: resumeEdits }, { kind: "profile_draft", baseVersion: versionsRef.current.profile, profile: p }], () => { setProfile(p); next(); });
    }
    if (k === "impact" || k === "impact2") {
      const r = recentRoles[k === "impact" ? 0 : 1];
      const t = r ? roleText[r.id] : undefined;
      if (!r || t === undefined || t.trim() === (r.description ?? "").trim()) return next();
      const p = applyProfileOps(profile, [{ op: "role_description", rowId: r.id, employer: r.employer, title: r.title, text: t.trim() }]);
      return saveProfile(p, () => { setProfile(p); next(); });
    }
    if (k === "skills") return saveProfile(profile, next);
    if (k === "roles") return savePrefs(livePrefs, mark(["roles"]), next);
    if (k === "where") return savePrefs(livePrefs, mark(["where", "how"]), next);
    if (k === "pay") return savePrefs(livePrefs, mark(["pay"]), next);
    if (k === "authorisation") return persist([{ kind: "work_authorisation", entries: abroad.map(c => ({ countryCode: c, status: auth[c]! })) }], next);
    if (k === "dealbreakers") return next(); // each change was saved when it was confirmed
    if (k === "review") return confirm();
    next();
  }
  const canContinue: Record<StepKey, boolean> = {
    welcome: true, details: true, match: imported !== null && !correcting, resume: true, resumeReview: resumeItems !== null && (resumeItems.every(i => i.kind !== "conflict" || resumeChoice[i.id])),
    impact: true, impact2: true, skills: profile.skills.length > 0, roles: prefs.desiredRoles.length > 0, where: prefs.workArrangements.length > 0 && prefs.employmentTypes.length > 0,
    authorisation: abroad.every(c => auth[c]), pay: payOpen || !!pay.min, dealbreakers: !pending, review: true,
  };
  const nextKey = steps[step + 1];
  const NEXT_LABEL: Partial<Record<StepKey, string>> = { roles: "the roles you want", where: "where you'll work", authorisation: "working abroad", pay: "pay", dealbreakers: "deal-breakers", review: "review" };
  const next = key === "welcome" ? "Let's start" : key === "review" ? "Confirm profile" : key === "match" && (askLinkedin || matchIssue) ? "Skip, I'll add my details"
    : key === "dealbreakers" ? (notes.length || exclusions.length ? "Review my profile" : "Skip, review my profile")
    : key === "impact" || key === "impact2" ? "Continue" : nextKey && NEXT_LABEL[nextKey] ? `Next: ${NEXT_LABEL[nextKey]}` : "Continue";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <StepBar locked={locked} active={SECTION_OF[key]} onBack={i => setKey(steps.find(k => SECTION_OF[k] === i)!)}
        position={steps.filter((k, n) => SECTION_OF[k] === SECTION_OF[key] && n <= step).length}
        count={steps.filter(k => SECTION_OF[k] === SECTION_OF[key]).length} />
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-live="polite" className="min-w-0">
          {/* A disabled fieldset disables every control inside it while a save is pending or failed. */}
          <fieldset disabled={locked} aria-busy={saving === "saving"} className="m-0 min-w-0 border-0 p-0">
          {key === "welcome" && (
            <Question title={`Hi ${firstName}, let's set up your profile`} why="It takes about three minutes. We'll fill in what we can, you check it, and we use it to find jobs that fit you.">
              <ol className="space-y-3 text-sm text-foreground">
                {[["Check what we found about your work", Sparkles], ["Tell us the roles, place and pay you want", Briefcase], ["Review and confirm. Recruiters never see anything you haven't confirmed", Check]].map(([t, I], n) => {
                  const Icon = I as typeof Check;
                  return <li key={n} className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-spark-soft text-spark-ink"><Icon className="h-4 w-4" aria-hidden /></span><span className="pt-1.5">{t as string}</span></li>;
                })}
              </ol>
            </Question>
          )}

          {key === "match" && matchIssue && (
            <Question title={matchIssue.kind === "final" ? "We couldn't find your profile" : "We couldn't check your professional profile"}
              why={matchIssue.kind === "failed" ? "You can try again, or add your details yourself in the next steps."
                : "No problem. Add your details yourself in the next steps, or upload a résumé and we'll read it for you."}>
              {matchIssue.kind === "failed" && matchIssue.retry && (
                <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={matchIssue.retry}>Try again</Button>
              )}
            </Question>
          )}
          {key === "match" && !matchIssue && (
            <Question
              title={imported === null ? (retry.phase === "looking" ? "Checking your LinkedIn profile…" : "Looking up your professional profile…")
                : askLinkedin ? (match === "no" ? "Let's find the right profile" : "We couldn't find your profile")
                : found && match !== "no" ? (correcting ? "What's wrong?" : "Is this you?") : "We still couldn't find you"}
              why={imported === null ? "The profile lookup can take up to 20 seconds."
                : askLinkedin ? "Paste your LinkedIn profile link and we'll look again. It's the quickest way to fill in your work history."
                : found && match !== "no" ? (correcting ? "Tell us in your own words. We'll show you exactly what we'd change." : "We found this professional profile. Check it's really you before we use any of it.")
                : "No problem. You can add your details yourself, or upload a résumé next."}>
              {imported === null && <LookupProgress />}
              {found && match !== "no" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-5"><MatchCard p={found} /></div>
                  {correcting ? (
                    <>
                      <SparkAssist useCase="correction" interpret={interpret} autoFocus label="What needs fixing?" placeholder="e.g. Freshworks ended in 2021, not 2022"
                        context={{ baseVersion: versionsRef.current.profile, rows: sortedRows(found) }}
                        applyLabel="Fix it, this is me"
                        onApply={pr => { if (isStale(pr, "profile")) return STALE;
                          if (acceptCorrection && pr.server) {
                            // Try again re-sends the same acceptance (the key is fixed per proposal).
                            const run = (): void => void serverStep(async () => { const p = await acceptCorrection(pr); setProfile(p); setMatch("yes"); setCorrecting(false); afterAccepted(); }, run);
                            run(); return undefined;
                          }
                          const p = applyProfileOps(found, pr.ops);
                          void persist([{ kind: "profile_draft", baseVersion: pr.baseVersion, profile: p }], () => { setProfile(p); setMatch("yes"); setCorrecting(false); afterAccepted(); }); return undefined; }} />
                      <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => setCorrecting(false)}>Back to the profile</Button>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button type="button" className="min-h-11 cursor-pointer gap-2" onClick={acceptImport}><UserRoundCheck className="h-4 w-4" aria-hidden />Yes, this is me</Button>
                        <Button type="button" variant="outline" className="min-h-11 cursor-pointer gap-2" onClick={rejectImport}><UserRoundX className="h-4 w-4" aria-hidden />This isn't me</Button>
                      </div>
                      {hasAi && <Button type="button" variant="link" className="h-auto min-h-11 cursor-pointer gap-1.5 px-0 text-foreground" onClick={() => setCorrecting(true)}><MessageSquareText className="h-4 w-4" aria-hidden />It's me, but something's wrong</Button>}
                      <p className="text-xs text-muted-foreground">You can change anything later. Nothing is shared until you confirm.</p>
                    </>
                  )}
                </div>
              )}
              {askLinkedin && (
                <form className="space-y-3" onSubmit={e => { e.preventDefault(); void retryWithLinkedin(); }} noValidate>
                  <Label htmlFor="linkedin-url">LinkedIn profile link</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input id="linkedin-url" type="url" inputMode="url" autoComplete="url" className="min-h-11" placeholder="linkedin.com/in/your-name"
                      value={retry.url} aria-invalid={!!retry.error} aria-describedby={retry.error ? "linkedin-error" : "linkedin-hint"}
                      onChange={e => setRetry({ ...retry, url: e.target.value, error: null })} />
                    <Button type="submit" className="min-h-11 shrink-0 cursor-pointer gap-1.5"><Search className="h-4 w-4" aria-hidden />Look me up</Button>
                  </div>
                  {retry.error ? <p id="linkedin-error" role="alert" className="text-sm text-destructive">{retry.error}</p>
                    : <p id="linkedin-hint" className="text-xs text-muted-foreground">On LinkedIn, open your profile and copy the address from your browser.</p>}
                </form>
              )}
            </Question>
          )}

          {key === "resume" && (
            <Question title="Add your résumé" optional
              why="Your professional profile may miss projects, responsibilities and career details. Your résumé helps us understand these, and you review everything we take from it.">
              <FileDropzone label="Résumé" accept=".pdf,.doc,.docx" maxSizeMB={5} value={resume} onChange={f => void chooseResume(f)} />
            </Question>
          )}

          {key === "resumeReview" && (
            <Question title="What we found in your résumé" why="Keep what's right, edit or remove the rest. Nothing is added until you continue.">
              {resumeFailure ? (
                <ResumeReadStatus read={resumeFailure} fileName={resume?.name}
                  onRetry={id => { if (retryResume) void loadResume(() => retryResume(id)); }}
                  onContinue={() => { setResume(null); setResumeFailure(null); go(step + 1); }} />
              ) : resumeItems === null ? (
                <ul className="space-y-3 rounded-xl border border-border bg-card p-5 text-sm"><li className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Reading your résumé…</li></ul>
              ) : resumeItems.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">We couldn't find anything new in your résumé. You can continue.</p>
              ) : (
                <ResumeReviewList items={resumeItems} choice={resumeChoice} setChoice={setResumeChoice} edits={resumeEdits} setEdits={setResumeEdits} />
              )}
            </Question>
          )}

          {key === "details" && (
            <Question title={hasProfileContent(profile) ? "Check your details" : "Add your details"}
              why="This is what recruiters see once you confirm. Add your name, headline, location, skills and the roles you've had.">
              <ProfessionalDetailsForm key={`details-${versions.profile}`} initial={profile} disabled={locked} busy={saving === "saving"}
                onSave={p => void saveProfile(p, () => { setProfile(p); go(step + 1); })} />
            </Question>
          )}
          {(key === "impact" || key === "impact2") && (() => {
            // One role per screen: the latest role at each of their two most recent employers.
            const r = recentRoles[key === "impact" ? 0 : 1];
            if (!r) return null;
            return (
              <Question key={key} title={`What did you do at ${r.employer}?`} optional
                why="Titles say what you were called. A sentence or two on what you built or changed helps us find jobs that need it. We keep your words and numbers exactly as you write them.">
                <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                  <div><p className="font-semibold text-foreground">{r.title}</p><p className="text-sm text-muted-foreground">{r.employer}{dateRange(r) ? ` · ${dateRange(r)}` : ""}</p></div>
                  <SparkAssist useCase="impact" interpret={interpret} context={{ baseVersion: versionsRef.current.profile, row: { id: r.id, employer: r.employer, title: r.title } }}
                    label="What did you build or change?"
                    suggestion={roleDrafts[r.id] ?? null}
                    placeholder="e.g. Led a team of 3 that rebuilt payouts; cut failed settlements by 40%"
                    value={roleText[r.id] ?? r.description ?? ""} onValueChange={v => setRoleText(m => ({ ...m, [r.id]: v }))}
                    onApply={() => undefined} />
                </div>
              </Question>
            );
          })()}

          {key === "skills" && (
            <Question title="Your skills" why="Recruiters search by skill, so this decides which jobs you're matched to. Remove anything that's out of date.">
              {match === "yes" && profile.skills.length > 0 && <SourceNote>From your professional profile{resume ? " and résumé" : ""}</SourceNote>}
              <TagInput label="Skills" values={profile.skills} max={200} placeholder="Add a skill and press Enter"
                onChange={skills => setProfile({ ...profile, skills })} />
            </Question>
          )}

          {key === "roles" && (
            <Question title="What roles do you want next?" why="We search for these titles and close variations. Add up to 10.">
              {roleSuggestions.length > 0 && <Suggest label="Based on your experience" items={roleSuggestions} onPick={r => setPrefs({ ...prefs, desiredRoles: [...prefs.desiredRoles, r] })} />}
              <TagInput label="Roles" values={prefs.desiredRoles} max={10} maxLength={200} placeholder="e.g. Backend engineer"
                onChange={desiredRoles => setPrefs({ ...prefs, desiredRoles })} />
              <ChipGroup label="Level (optional)" options={SENIORITY} selected={prefs.preferredSeniority}
                onToggle={v => setPrefs({ ...prefs, preferredSeniority: toggle(prefs.preferredSeniority, v) })} />
            </Question>
          )}

          {key === "where" && (
            <Question title="Where do you want to work?" why="We only show jobs you can actually take, so tell us how and where.">
              <ChipGroup label="How" options={ARRANGEMENTS.map(a => a[1])} selected={prefs.workArrangements.map(w => ARRANGEMENTS.find(a => a[0] === w)![1])}
                onToggle={label => { const v = ARRANGEMENTS.find(a => a[1] === label)![0];
                  const workArrangements = toggle(prefs.workArrangements, v) as Preferences["workArrangements"];
                  setPrefs({ ...prefs, workArrangements, remoteRegions: workArrangements.includes("remote") ? (prefs.remoteRegions ?? { mode: "countries", countries: [home] }) : null }); }} />
              <ChipGroup label="What kind of work? Pick any that suit you" options={JOB_TYPES.map(t => t[1])}
                selected={prefs.employmentTypes.map(e => JOB_TYPES.find(t => t[0] === e)?.[1]).filter((x): x is (typeof JOB_TYPES)[number][1] => !!x)}
                onToggle={label => { const v = JOB_TYPES.find(t => t[1] === label)![0];
                  setPrefs({ ...prefs, employmentTypes: toggle(prefs.employmentTypes, v) as Preferences["employmentTypes"] }); }} />
              {city && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Where</p>
                  <div className="flex flex-wrap gap-2">
                    <Chip selected={prefs.locations.mode === "specific"} onClick={() => setPrefs({ ...prefs, locations: { mode: "specific", places: [{ city: city.city, countryCode: city.countryCode }] } })}>
                      <MapPin className="h-3.5 w-3.5" aria-hidden />{city.city}, {city.displayCountry}
                    </Chip>
                    <Chip selected={prefs.locations.mode === "anywhere"} onClick={() => setPrefs({ ...prefs, locations: { mode: "anywhere" } })}>Anywhere</Chip>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Would you move for the right job?</p>
                <SegmentedControl label="Relocation" value={prefs.relocation.mode}
                  options={[{ value: "yes", label: "Yes" }, { value: "discuss", label: "Maybe" }, { value: "no", label: "No" }]}
                  onValueChange={v => setPrefs({ ...prefs, relocation: { ...prefs.relocation, mode: v as "yes" | "no" | "discuss" } })} />
              </div>
              {prefs.relocation.mode !== "no" && (
                <ChipGroup label="Where would you move? (optional)" options={MOVE_TO.map(m => m[0])} selected={prefs.relocation.destinations.map(d => d.city)}
                  onToggle={c => { const cc = MOVE_TO.find(m => m[0] === c)![1]; const has = prefs.relocation.destinations.some(d => d.city === c);
                    setPrefs({ ...prefs, relocation: { ...prefs.relocation, destinations: has ? prefs.relocation.destinations.filter(d => d.city !== c) : [...prefs.relocation.destinations, { city: c, countryCode: cc }] } }); }} />
              )}
            </Question>
          )}

          {key === "authorisation" && (
            <Question title="Can you work there?" why="Some jobs can't sponsor a visa. We ask only for the countries you chose, and we never guess this from your name or nationality.">
              <div className="space-y-5">
                {abroad.map(cc => (
                  <div key={cc} className="space-y-2">
                    <p className="text-sm font-medium text-foreground">{countryName(cc)}</p>
                    {/* Chips, not a segmented control: nothing may look pre-selected before they answer. */}
                    <div className="flex flex-wrap gap-2" role="group" aria-label={`Right to work in ${countryName(cc)}`}>
                      {([["allowed", "I can work there"], ["needs_visa", "I'd need a visa"], ["not_sure", "Not sure"]] as const).map(([v, l]) => (
                        <Chip key={v} selected={auth[cc] === v} onClick={() => setAuth(a => ({ ...a, [cc]: v }))}>{l}</Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Question>
          )}

          {key === "pay" && (
            <Question title="What pay are you looking for?" why="Your target for your next job, not what you earn now. Employers don't see this; we use it to skip jobs that pay too little.">
              {!payOpen && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <LakhField label="From" value={pay.min} onChange={min => setPay({ ...pay, min })} currency={currency} />
                  <LakhField label="To" value={pay.max} onChange={max => setPay({ ...pay, max })} currency={currency} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Chip selected={payOpen} onClick={() => setPayOpen(!payOpen)}>Open to discussing pay</Chip>
                {!payOpen && <Chip selected={pay.firm} onClick={() => setPay({ ...pay, firm: !pay.firm })}>Don't show me jobs below this</Chip>}
              </div>
            </Question>
          )}

          {key === "dealbreakers" && (
            <Question title="Anything that would rule a job out?" optional
              why="When job matching is available, we can hide jobs that explicitly require travel or on-site/hybrid work. Anything else stays a private note. Only you see these.">
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Hide jobs that…</p>
                <div className="flex flex-wrap gap-2">
                  {([["remote_only", "Need on-site or hybrid work"], ["no_travel", "Require travel"]] as const).map(([kind, label]) => {
                    const on = exclusions.some(e => e.kind === kind) || !!pending?.rules.some(r => r.kind === kind);
                    return <Chip key={kind} selected={on} onClick={() => { if (!on) queue({ kind }); }}>{label}</Chip>;
                  })}
                </div>
                {searchCompanies && (
                  <form className="space-y-2" onSubmit={e => { e.preventDefault(); void findCompany(); }}>
                    <Label htmlFor="exclude-company">Hide jobs at a company</Label>
                    <div className="flex gap-2">
                      <Input id="exclude-company" value={companyQ} onChange={e => { setCompanyQ(e.target.value); setCompanies(null); }} placeholder="Company name" className="min-h-11 text-base" maxLength={120} />
                      <Button type="submit" variant="outline" className="min-h-11 cursor-pointer gap-1.5" disabled={!companyQ.trim() || companies === "loading"}>
                        {companies === "loading" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}Find
                      </Button>
                    </div>
                    {Array.isArray(companies) && companies.length > 0 && (
                      <ul className="space-y-1.5" aria-label="Companies found">
                        {companies.map(c => (
                          <li key={c.id}><button type="button" onClick={() => { queue({ kind: "exclude_company", companyId: c.id, companyName: c.name, domain: c.domain }); setCompanyQ(""); setCompanies(null); }}
                            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-left text-sm hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span><span className="font-medium text-foreground">{c.name}</span>{c.domain && <span className="text-muted-foreground"> · {c.domain}</span>}</span><Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
                          </button></li>
                        ))}
                        <li className="text-xs text-muted-foreground">Pick the exact company. Not listed? Search again or keep it as a note.</li>
                      </ul>
                    )}
                    {Array.isArray(companies) && companies.length === 0 && (
                      <div className="space-y-2 rounded-lg bg-muted p-3 text-sm" role="status">
                        <p className="text-foreground">We couldn't find "{companyQ.trim()}" in our company list, so we can't hide its jobs yet.</p>
                        <Button type="button" variant="outline" className="min-h-11 cursor-pointer bg-background" onClick={() => { queue(null, `Not ${companyQ.trim()}`); setCompanyQ(""); setCompanies(null); }}>Keep it as a private note</Button>
                      </div>
                    )}
                  </form>
                )}
              </div>

              {pending && (pending.rules.length > 0 || pending.notes.length > 0) && (
                <DealbreakerCard rules={pending.rules} notes={pending.notes} busy={locked}
                  onConfirm={() => void addDealbreakers(pending.rules, pending.notes, () => setPending(null))} onCancel={() => setPending(null)} />
              )}

              {hasAi && <SparkAssist useCase="exclusions" interpret={interpret} context={{ baseVersion: versionsRef.current.preferences }} label="Or tell us in your own words" placeholder="e.g. No travel, no on-call, no early-stage startups"
                applyLabel={pr => pr.ops.some(o => o.op === "exclude") ? "Exclude these" : "Save as private notes"}
                proposalTitle="Check this before we save it"
                onApply={pr => {
                  if (isStale(pr, "preferences")) return STALE;
                  const rules = pr.ops.flatMap(o => o.op === "exclude" ? [o.rule] : []);
                  const texts = pr.ops.flatMap(o => o.op === "private_note" ? [o.text] : []);
                  void addDealbreakers(rules, texts);
                  return undefined;
                }} />}

              {exclusions.length > 0 && (
                <div className="space-y-2"><p className="text-sm font-medium text-foreground">Hidden from your matches</p>
                  <ul className="flex flex-wrap gap-2" aria-label="Hidden from your matches">
                    {exclusions.map(e => <RemovableChip key={e.id} label={describeRule(e)} disabled={locked} onRemove={() => void saveDealbreakers(exclusions.filter(x => x.id !== e.id), notes)} />)}
                  </ul>
                  {unknownNote(exclusions) && <p className="text-xs text-muted-foreground">{unknownNote(exclusions)}</p>}
                </div>
              )}
              {notes.length > 0 && (
                <div className="space-y-2"><p className="text-sm font-medium text-foreground">Private notes</p>
                  <p className="text-xs text-muted-foreground">We can't hide jobs for these yet. Only you see them.</p>
                  <ul className="flex flex-wrap gap-2" aria-label="Private notes">
                    {notes.map(n => <RemovableChip key={n.id} label={n.text} disabled={locked} onRemove={() => void saveDealbreakers(exclusions, notes.filter(x => x.id !== n.id))} />)}
                  </ul>
                </div>
              )}
            </Question>
          )}

          {key === "review" && (
            <Question title="Check your profile" why={discovery === "ready" ? "Recruiters see this once you confirm. Your job preferences stay private." : "This is what recruiters will see once recruiter search is switched on. Your job preferences stay private."}>
              {resumeOn && !resume && !reminderDismissed && (
                <div className="space-y-3 rounded-xl border border-spark/25 bg-spark-soft p-4">
                  <p className="text-sm text-foreground">Help us find the right jobs for you. Sharing your résumé gives us a fuller picture of your experience, skills and projects, so we can make more informed matches.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className="min-h-11 cursor-pointer" onClick={() => setKey("resume")}>Add my résumé</Button>
                    <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => setReminderDismissed(true)}>Continue for now</Button>
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-border bg-card p-5"><ProfileOverview profile={profile} canEdit={false} onEdit={() => undefined} /></div>
              <div className="space-y-4 rounded-xl border border-border bg-card p-5 lg:hidden">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Private: what you want</p>
                <PreferencesSummary preferences={livePrefs} notAnswered={(["roles", "where", "how", "pay"] as PrefField[]).filter(f => !answered.includes(f))} canEdit={false} onEdit={() => undefined} />
                <DealbreakerSummary exclusions={exclusions} notes={notes} />
              </div>
              <p className="text-sm text-muted-foreground">{confirmCopy(discovery, matching)} You can withdraw any time in Privacy settings.</p>
            </Question>
          )}

          </fieldset>
          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? <Button type="button" variant="ghost" className="min-h-11 cursor-pointer gap-1.5" disabled={locked} onClick={() => key === "match" && match === "no" && found ? setMatch("pending") : go(step - 1)}><ArrowLeft className="h-4 w-4" aria-hidden />Back</Button> : <span />}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SaveNote state={saving} onRetry={() => void retrySave()} />
              {key === "resume" && !resume && <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" disabled={locked} onClick={() => go(step + 1)}>Skip for now</Button>}
              {(key === "impact" || key === "impact2") && <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" disabled={locked} onClick={() => go(step + 1)}>Skip</Button>}
              {key !== "details" && (key !== "match" || !(found && match !== "no")) ? (
                <Button type="button" variant={key === "match" && askLinkedin ? "ghost" : "default"} className="min-h-11 cursor-pointer gap-1.5" disabled={!canContinue[key] || locked}
                  onClick={() => void continueFrom(key)}>
                  {next}{key !== "review" && !(key === "match" && askLinkedin) && <ArrowRight className="h-4 w-4" aria-hidden />}
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        {/* Live preview: employer-visible facts only, plus the private preferences, labelled. */}
        <aside className="hidden space-y-4 lg:block" aria-label="Preview">
          {step >= 2 && key !== "review" && <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">What recruiters will see</p>
            <MiniCard p={profile.displayName ? profile : null} fallbackName={firstName} />
          </div>}
          {SECTION_OF[key] >= 1 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Private: what you want</p>
              <PreferencesSummary preferences={livePrefs} notAnswered={(["roles", "where", "how", "pay"] as PrefField[]).filter(f => !answered.includes(f) && !(f === "roles" && prefs.desiredRoles.length))} canEdit={false} onEdit={() => undefined} />
              <DealbreakerSummary exclusions={exclusions} notes={notes} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** What we do with jobs that don't say: they stay visible, marked (never silently hidden). */
export function unknownNote(ex: ExclusionRule[]): string | null {
  const parts = [ex.some(e => e.kind === "no_travel") && "whether travel is needed", ex.some(e => e.kind === "remote_only") && "how the work is done"].filter(Boolean);
  return parts.length ? `Jobs that don't say ${parts.join(" or ")} stay in your list, marked so you can check.` : null;
}
/** The confirmation card for directly picked deal-breakers: same wording and button as the AI card. */
function DealbreakerCard({ rules, notes, busy, onConfirm, onCancel }: { rules: ExclusionRule[]; notes: string[]; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-spark/25 bg-spark-soft p-4" role="group" aria-label="Check before saving">
      <p className="text-sm font-medium text-foreground">Check this before we save it</p>
      <ul className="space-y-2">
        {rules.map(r => <li key={ruleKey(r)} className="rounded-lg bg-background p-3 text-sm"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hidden from your matches</p><p className="mt-0.5 text-foreground">{describeRule(r)}</p></li>)}
        {notes.map(t => <li key={t} className="rounded-lg bg-background p-3 text-sm"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Private note. We can't hide jobs for this yet</p><p className="mt-0.5 text-foreground">{t}</p></li>)}
      </ul>
      {unknownNote(rules) && <p className="text-xs text-muted-foreground">{unknownNote(rules)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11 cursor-pointer gap-1.5" disabled={busy} onClick={onConfirm}><Check className="h-4 w-4" aria-hidden />{rules.length ? "Exclude these" : "Save as private notes"}</Button>
        <Button type="button" variant="ghost" className="min-h-11 cursor-pointer gap-1.5" disabled={busy} onClick={onCancel}><X className="h-4 w-4" aria-hidden />Cancel</Button>
      </div>
    </div>
  );
}
function RemovableChip({ label, onRemove, disabled }: { label: string; onRemove: () => void; disabled: boolean }) {
  return (
    <li className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background pl-4 pr-1 text-sm text-foreground">{label}
      <button type="button" aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"><X className="h-4 w-4" aria-hidden /></button>
    </li>
  );
}
function DealbreakerSummary({ exclusions, notes }: { exclusions: Exclusion[]; notes: { id: string; text: string }[] }) {
  if (!exclusions.length && !notes.length) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm text-foreground">
      {exclusions.length > 0 && <p><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hidden from your matches</span><br />{exclusions.map(describeRule).join(" · ")}</p>}
      {notes.length > 0 && <p><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Private notes (not used to hide jobs)</span><br />{notes.map(n => n.text).join(" · ")}</p>}
    </div>
  );
}

/** Lakhs for INR, thousands otherwise, as the schema's decimal string. */
/** Anything in the draft that came from the candidate or an accepted lookup. */
export function hasProfileContent(p: ManualProfile): boolean {
  return !!(p.displayName || p.headline || p.currentLocation || p.skills?.length || p.employment?.length || p.education?.length);
}
/** Saved pay back into the pay step's fields (the inverse of `amount`). */
export function payFromCompensation(c: Preferences["compensation"] | undefined): { open: boolean; pay: { min: string; max: string; firm: boolean } } | null {
  if (!c) return null;
  if (c.mode !== "target") return { open: true, pay: { min: "", max: "", firm: false } };
  const unit = c.currency === "INR" ? 100000 : 1000, back = (v: string | null | undefined) => (v ? String(Number(v) / unit) : "");
  return { open: false, pay: { min: back(c.targetMin), max: back(c.targetMax), firm: c.hardMinimum != null } };
}
function amount(v: string, currency: string) { const n = Number(v); return Number.isFinite(n) ? (n * (currency === "INR" ? 100000 : 1000)).toFixed(2) : "0.00"; }
function toggle<T extends string>(list: T[], v: T): T[] { return list.includes(v) ? list.filter(x => x !== v) : [...list, v]; }

// Adapted from 21st.dev "Animated Progress Stepper" (shadcnspace stepper-03): icon circles on a
// spring-filled line with a travelling dot, a pulsing ring on the current section, and the icon
// turning into a tick when done. Changes: framer-motion (already in Flow) instead of `motion`;
// the tick uses the primary foreground colour (the original's teal fails contrast on primary);
// only finished sections are clickable, never jump ahead; the pulse stops under reduced motion.
const SECTION_ICONS = [UserRound, Briefcase, ClipboardCheck];
// The three circles are sections; the steps inside a section fill the line towards the next
// circle, and "2 of 6" under the current section says where they are within it.
function StepBar({ active, onBack, position, count, locked }: { active: number; onBack: (section: number) => void; position: number; count: number; locked: boolean }) {
  const reduce = useReducedMotion();
  const within = count > 1 ? (position - 1) / count : 0;
  const progress = Math.min(1, (active + within) / (SECTIONS.length - 1));
  const edge = 100 / (SECTIONS.length * 2); // line runs from the first circle's centre to the last
  return (
    <nav aria-label="Setup progress" className="relative">
      <div aria-hidden className="absolute top-[21px] h-0.5 bg-border" style={{ left: `${edge}%`, right: `${edge}%` }} />
      <motion.div aria-hidden className="absolute top-[21px] h-0.5 origin-left bg-spark" style={{ left: `${edge}%`, right: `${edge}%` }}
        initial={false} animate={{ scaleX: progress }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }} />
      <motion.span aria-hidden className="absolute h-2 w-2 rounded-full bg-spark" style={{ top: 22, x: "-50%", y: "-50%" }}
        initial={false} animate={{ left: `${edge + progress * (100 - 2 * edge)}%` }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }} />
      <ol className="relative flex items-start justify-between">
        {SECTIONS.map((s, i) => {
          const done = i < active, current = i === active, Icon = SECTION_ICONS[i]!;
          return (
            <li key={s} className="flex flex-1 flex-col items-center gap-2">
              <button type="button" disabled={!done || locked} onClick={() => onBack(i)} aria-current={current ? "step" : undefined}
                aria-label={`${s}${done ? ", done. Go back to this section" : current ? ", current section" : ", not started"}`}
                className="relative z-10 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default">
                {/* 44px tap target; the circle itself stays 40px. */}
                <span className={cn("absolute inset-0.5 rounded-full transition-colors duration-300", done || current ? "bg-spark" : "bg-muted")} />
                {current && !reduce && (
                  <motion.span className="absolute inset-0.5 rounded-full ring-2 ring-spark/50" initial={{ scale: 1, opacity: 1 }}
                    animate={{ scale: [1, 1.4, 1], opacity: [1, 0.2, 1] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
                )}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={done ? "done" : "icon"} className="relative flex"
                    initial={reduce ? false : { scale: 0, rotate: done ? -90 : 0, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
                    exit={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 400, damping: 22 }}>
                    {done ? <Check className="h-5 w-5 text-white" strokeWidth={3} aria-hidden />
                      : <Icon className={cn("h-5 w-5", current ? "text-white" : "text-muted-foreground")} aria-hidden />}
                  </motion.span>
                </AnimatePresence>
              </button>
              <span className={cn("text-sm font-medium", done || current ? "text-foreground" : "text-muted-foreground")}>{s}</span>
              {current && count > 1 && <span className="-mt-1.5 text-xs text-muted-foreground">{position} of {count}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Quiet save status beside the buttons. A failed save keeps them on the step with a clear retry. */
/** What confirming does, stated only for what is actually switched on. */
function confirmCopy(discovery: "ready" | "not_ready", matching: "ready" | "not_ready"): string {
  if (discovery === "ready" && matching === "ready") return "When you confirm, recruiters can find your profile and we start matching you with jobs.";
  if (discovery === "ready") return "When you confirm, recruiters can find your profile. Job matching isn't switched on yet.";
  if (matching === "ready") return "When you confirm, we start matching you with jobs. Recruiter search isn't switched on yet.";
  return "When you confirm, we save your profile. Recruiter search and job matching aren't switched on for you yet.";
}

function SaveNote({ state, onRetry }: { state: "idle" | "saving" | "saved" | "failed"; onRetry: () => void }) {
  const slow = useSlowAfter(state === "saving");
  if (state === "idle") return null;
  if (state === "failed") return (
    <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
      Couldn't save.
      <Button type="button" variant="outline" size="sm" className="min-h-11 cursor-pointer" onClick={onRetry}>Try again</Button>
    </p>
  );
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {state === "saving" && <><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{slow ? STILL_WORKING : "Saving…"}</>}
      {state === "saved" && <><Check className="h-3.5 w-3.5" aria-hidden />Saved privately</>}
    </p>
  );
}

function Question({ title, why, optional, children }: { title: string; why: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-foreground">{title}{optional && <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">Optional</span>}</h2>
        <p className="max-w-prose text-base text-muted-foreground">{why}</p>
      </div>
      {children}
    </div>
  );
}

function LookupProgress() {
  return (
    <ul className="space-y-3 rounded-xl border border-border bg-card p-5 text-sm">
      <li className="flex items-center gap-2 text-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Finding your professional profile</li>
      <li className="flex items-center gap-2 text-muted-foreground"><span className="h-4 w-4" />Reading your work history and skills</li>
      <li className="pt-1 text-xs text-muted-foreground">This can take up to 30 seconds. You can continue and come back to it.</li>
    </ul>
  );
}

function MatchCard({ p }: { p: ManualProfile }) {
  const groups = groupByEmployer(p.employment as any);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {p.photoUrl && <CandidatePhoto url={p.photoUrl} name={p.displayName} className="h-12 w-12 text-base" />}
        <div className="min-w-0">
          <p className="text-lg font-semibold text-foreground">{p.displayName}</p>
          <p className="text-sm text-foreground/80">{p.headline}</p>
          {p.currentLocation && <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" aria-hidden />{p.currentLocation.city}, {p.currentLocation.displayCountry}</p>}
        </div>
      </div>
      <ul className="space-y-2 border-t border-border pt-4">
        {groups.slice(0, 3).map(g => (
          <li key={g.employer} className="flex items-start gap-3 text-sm">
            <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span><span className="font-medium text-foreground">{g.roles[0]!.title}</span><span className="text-muted-foreground"> at {g.employer}{g.total !== null ? ` · ${duration(g.total)}` : ""}</span></span>
          </li>
        ))}
      </ul>
      {p.skills.length > 0 && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{p.skills.length} skills</span>, including {p.skills.slice(0, 3).join(", ")}</p>}
    </div>
  );
}

function MiniCard({ p, fallbackName }: { p: ManualProfile | null; fallbackName: string }) {
  const role = p ? groupByEmployer(p.employment as any)[0] : undefined;
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground">{p?.displayName || fallbackName}</p>
      <p className="text-sm text-muted-foreground">{p?.headline || "Your headline"}</p>
      {role && <p className="text-sm text-foreground/80">{role.roles[0]!.title}, {role.employer}{role.roles[0] && dateRange(role.roles[0]) ? ` · ${dateRange(role.roles[0])}` : ""}</p>}
      {p && p.skills.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">{p.skills.slice(0, 6).map(s => <span key={s} className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs text-foreground">{s}</span>)}</div>}
    </div>
  );
}

function SourceNote({ children }: { children: ReactNode }) {
  return <p className="inline-flex items-center gap-1.5 rounded-full bg-spark-soft px-3 py-1 text-xs font-medium text-spark-ink"><Sparkles className="h-3.5 w-3.5" aria-hidden />{children}</p>;
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick}
      className={cn("inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted")}>
      {selected && <Check className="h-3.5 w-3.5" aria-hidden />}{children}
    </button>
  );
}

function ChipGroup({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      <div className="flex flex-wrap gap-2">{options.map(o => <Chip key={o} selected={selected.includes(o)} onClick={() => onToggle(o)}>{o}</Chip>)}</div>
    </fieldset>
  );
}

function Suggest({ label, items, onPick }: { label: string; items: string[]; onPick: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Sparkles className="h-3.5 w-3.5 text-spark" aria-hidden />{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map(i => (
          <button key={i} type="button" onClick={() => onPick(i)}
            className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-spark/60 px-4 text-sm text-foreground transition-colors hover:bg-spark-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Plus className="h-3.5 w-3.5" aria-hidden />{i}
          </button>
        ))}
      </div>
    </div>
  );
}

function LakhField({ label, value, onChange, currency }: { label: string; value: string; onChange: (v: string) => void; currency: string }) {
  const id = `pay-${label}`;
  const unit = currency === "INR" ? "lakh a year" : "thousand a year";
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{currency === "INR" ? "₹" : "$"}</span>
        <Input id={id} inputMode="decimal" value={value} onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ""))} className="min-h-11" placeholder={currency === "INR" ? "e.g. 40" : "e.g. 120"} />
        <span className="whitespace-nowrap text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

