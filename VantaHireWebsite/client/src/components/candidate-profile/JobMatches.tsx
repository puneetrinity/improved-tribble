// Find jobs: a small first batch reviewed one card at a time ("calibration"), then the full list.
// Rules from the onboarding plan: reasons and gaps are grounded in the job and profile, never a
// match %; pay is only what the job states (no estimates); "Last checked" is shown honestly;
// external jobs open the official employer site, we never apply for the candidate. Feedback is
// recorded, but a "Not for me" alone never changes a preference: a change happens only when the
// candidate answers the single follow-up question, and every change can be undone.
import { TetrisOrb } from "@/components/ui/tetris-orb";
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, Sparkles, Bookmark, BookmarkCheck, Building2, Check, Clock, ExternalLink, MapPin, RotateCcw, SlidersHorizontal, ThumbsDown, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Preferences } from "@/lib/candidate-profile-api";
import { money } from "./PreferencesSummary";
import { SparkAssist, describeOp, type Exclusion, type Interpret } from "./SparkAssist";
import { applyPrefOps } from "./OnboardingWizard";

export type Job = {
  id: string; title: string; company: string; location: string; arrangement: "Remote" | "Hybrid" | "On-site";
  /** Only pay the employer states. Null means not disclosed: we never estimate. */
  pay: { min: string; max: string; currency: string; label: string } | null;
  level?: string; source: string; lastChecked: string; posted: string; url: string;
  reasons: string[]; gaps: { text: string; skill?: string }[];
  /** Registry id of the employer, when we know it. */
  companyId?: string;
  /** Whether the job says it needs travel. Absent or null = it doesn't say. */
  travel?: boolean | null;
};
/** Confirmed deal-breakers hide a job only when the job clearly breaks them. When the job doesn't
 * say, it stays visible with a warning (never silently hidden, never silently passed). */
export function checkExclusions(j: Job, ex: Exclusion[]): { hide: boolean; warnings: string[] } {
  let hide = false; const warnings: string[] = [];
  for (const e of ex) {
    if (e.kind === "no_travel") { if (j.travel === true) hide = true; else if (j.travel == null) warnings.push("Doesn't say whether travel is needed"); }
    if (e.kind === "remote_only" && j.arrangement !== "Remote") hide = true;
    if (e.kind === "exclude_company" && j.companyId === e.companyId) hide = true;
  }
  return { hide, warnings };
}
type Reason = "role" | "location" | "too_senior" | "too_junior" | "pay" | "skill" | "company" | "other";
const REASONS: [Reason, string][] = [["role", "Wrong kind of role"], ["location", "Wrong location"], ["too_junior", "Too junior"], ["too_senior", "Too senior"],
  ["pay", "Pay too low"], ["skill", "I don't have the skills"], ["company", "Not this company"], ["other", "Something else"]];

/** A preference change the candidate explicitly agreed to, with how to reverse it. */
type Change = { id: string; text: string; undo: (p: Preferences) => Preferences };
type Followup = { question: string; yes: string; no: string; apply?: (p: Preferences) => { prefs: Preferences; change: Change }; addSkill?: string };

type Props = {
  jobs: Job[]; preferences: Preferences; checkedCount: number;
  onPreferencesChange: (p: Preferences) => void;
  /** Adding a skill is a profile edit the candidate confirms later, never a silent change. */
  onProposeSkill: (skill: string) => void;
  interpret: Interpret;
  /** The candidate's confirmed deal-breakers. */
  exclusions?: Exclusion[] | undefined;
};

export function JobMatches({ jobs: allJobs, preferences, checkedCount, onPreferencesChange, onProposeSkill, interpret, exclusions = [] }: Props) {
  const jobs = useMemo(() => allJobs.filter(j => !checkExclusions(j, exclusions).hide), [allJobs, exclusions]);
  const [changingSearch, setChangingSearch] = useState(false);
  const [updating, setUpdating] = useState(false);
  const reduce = useReducedMotion();
  const firstBatch = jobs.slice(0, 5);
  const [i, setI] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<"reasons" | Followup | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const calibrating = i < firstBatch.length;
  const job = firstBatch[i];

  function next() { setAsking(null); setI(n => n + 1); }
  function save(j: Job) { setSaved(s => new Set(s).add(j.id)); if (calibrating) next(); }

  function followupFor(r: Reason, j: Job): Followup | null {
    const c = preferences.compensation;
    if (r === "pay" && c.mode === "target") {
      const floor = money(c.targetMin, c.currency);
      return { question: `Should we hide jobs that pay less than ${floor}?`, yes: `Yes, ${floor} is my minimum`, no: "No, keep it flexible",
        apply: p => ({ prefs: { ...p, compensation: { ...c, hardMinimum: c.targetMin } },
          change: { id: "pay", text: `Pay: hiding jobs below ${floor}`, undo: q => ({ ...q, compensation: { ...c, hardMinimum: null } }) } }) };
    }
    // Location stays a flexible preference: "Wrong location" is recorded as feedback only.
    if ((r === "too_senior" || r === "too_junior") && j.level) {
      const want = r === "too_senior" ? "Senior" : "Lead";
      return { question: `Should we focus on ${want}-level roles?`, yes: `Yes, ${want} level`, no: "No, keep levels open",
        apply: p => ({ prefs: { ...p, preferredSeniority: [want] },
          change: { id: "level", text: `Level: ${want}`, undo: q => ({ ...q, preferredSeniority: p.preferredSeniority }) } }) };
    }
    const gap = j.gaps.find(g => g.skill);
    if (r === "skill" && gap?.skill) return { question: `Do you have experience with ${gap.skill}?`, yes: "Yes, add it to my profile", no: "No", addSkill: gap.skill };
    return null;
  }

  function pickReason(r: Reason) {
    const j = job!; setNotes(n => [...n, `${j.title} at ${j.company}: ${REASONS.find(x => x[0] === r)![1].toLowerCase()}`]);
    setHidden(h => new Set(h).add(j.id));
    const f = followupFor(r, j);
    if (f) setAsking(f); else next();
  }
  function answer(yes: boolean) {
    if (yes && asking && asking !== "reasons") {
      if (asking.apply) { const { prefs, change } = asking.apply(preferences); onPreferencesChange(prefs); setChanges(c => [...c.filter(x => x.id !== change.id), change]); }
      if (asking.addSkill) { onProposeSkill(asking.addSkill); setChanges(c => [...c, { id: `skill-${asking.addSkill}`, text: `Skill: ${asking.addSkill} added to your profile draft`, undo: q => q }]); }
    }
    next();
  }
  function undo(ch: Change) { onPreferencesChange(ch.undo(preferences)); setChanges(c => c.filter(x => x !== ch)); }

  const [showHidden, setShowHidden] = useState(false);
  const list = useMemo(() => jobs.filter(j => showHidden || !hidden.has(j.id)), [jobs, hidden, showHidden]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-foreground">{calibrating ? "Your first matches" : "Jobs for you"}</h2>
        <p className="text-base text-muted-foreground">
          We checked <span className="font-medium text-foreground">{checkedCount.toLocaleString("en-IN")} open jobs</span> on official company sites. <span className="font-medium text-foreground">{jobs.length} match</span> what you're looking for.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-4">
          {calibrating && job ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Tell us what you think of these {firstBatch.length}. It helps us pick better jobs for you.</p>
                <p className="shrink-0 text-sm font-medium text-foreground" aria-live="polite">{i + 1} of {firstBatch.length}</p>
              </div>
              <div className="flex gap-1.5" aria-hidden>{firstBatch.map((_, n) => <span key={n} className={cn("h-1 flex-1 rounded-full", n <= i ? "bg-primary" : "bg-muted")} />)}</div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={job.id} initial={reduce ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
                  <JobCard job={job} expanded warnings={checkExclusions(job, exclusions).warnings}>
                    {asking === null && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button type="button" variant="outline" className="min-h-11 cursor-pointer gap-2" onClick={() => setAsking("reasons")}><ThumbsDown className="h-4 w-4" aria-hidden />Not for me</Button>
                        <Button type="button" className="min-h-11 cursor-pointer gap-2" onClick={() => save(job)}><Bookmark className="h-4 w-4" aria-hidden />Save job</Button>
                      </div>
                    )}
                    {asking === "reasons" && (
                      <fieldset className="space-y-3 rounded-lg bg-muted/50 p-4">
                        <legend className="sr-only">Why isn't it right?</legend>
                        <p className="text-sm font-medium text-foreground">What's wrong with it?</p>
                        <div className="flex flex-wrap gap-2">
                          {REASONS.map(([r, label]) => (
                            <button key={r} type="button" onClick={() => pickReason(r)}
                              className="min-h-11 cursor-pointer rounded-full border border-border bg-background px-4 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</button>
                          ))}
                        </div>
                        <Button type="button" variant="ghost" size="sm" className="min-h-11 cursor-pointer" onClick={() => setAsking(null)}>Cancel</Button>
                      </fieldset>
                    )}
                    {asking && asking !== "reasons" && (
                      <div className="space-y-3 rounded-lg bg-primary/5 p-4" role="group" aria-label="One quick question">
                        <p className="text-sm font-medium text-foreground">{asking.question}</p>
                        <p className="text-xs text-muted-foreground">{asking.addSkill ? "We'll add it to your profile draft. You confirm it before employers see it." : "We only change your preferences if you say yes. You can undo it any time."}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" className="min-h-11 cursor-pointer" onClick={() => answer(true)}>{asking.yes}</Button>
                          <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={() => answer(false)}>{asking.no}</Button>
                        </div>
                      </div>
                    )}
                  </JobCard>
                </motion.div>
              </AnimatePresence>
              <Button type="button" variant="link" className="cursor-pointer px-0 text-muted-foreground" onClick={() => setI(firstBatch.length)}>Skip and see all jobs</Button>
            </>
          ) : (
            <>
              {notes.length > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <p className="text-foreground">Thanks. We've used your answers to sort these jobs{changes.length > 0 ? " and updated your preferences where you said so" : ""}.</p>
                </div>
              )}
              {hidden.size > 0 && (
                <p className="text-sm text-muted-foreground">
                  {showHidden ? "Showing all jobs, including ones you said aren't for you." : `${hidden.size} ${hidden.size === 1 ? "job" : "jobs"} you said aren't for you ${hidden.size === 1 ? "is" : "are"} hidden.`}{" "}
                  <button type="button" className="min-h-11 cursor-pointer rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowHidden(v => !v)}>{showHidden ? "Hide them" : "Show them"}</button>
                </p>
              )}
              <ul className="space-y-3">
                {list.map(j => (
                  <li key={j.id}>
                    <JobCard job={j} warnings={checkExclusions(j, exclusions).warnings}>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" className="min-h-11 cursor-pointer gap-2" aria-pressed={saved.has(j.id)}
                          onClick={() => setSaved(s => { const n = new Set(s); n.has(j.id) ? n.delete(j.id) : n.add(j.id); return n; })}>
                          {saved.has(j.id) ? <BookmarkCheck className="h-4 w-4" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}{saved.has(j.id) ? "Saved" : "Save"}
                        </Button>
                        <Button asChild className="min-h-11 cursor-pointer gap-2">
                          <a href={j.url} target="_blank" rel="noopener noreferrer">Apply on {j.company}'s site<ExternalLink className="h-4 w-4" aria-hidden /><span className="sr-only">(opens in a new tab)</span></a>
                        </Button>
                      </div>
                    </JobCard>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <aside className="space-y-4" aria-label="What we're searching for">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />What you told us</p>
            {changes.length === 0 ? <p className="text-sm text-muted-foreground">No changes yet. Answer a question on a job card, or use Change my search.</p> : (
              <ul className="space-y-2">
                {changes.map(c => (
                  <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-foreground">{c.text}</span>
                    {!c.id.startsWith("skill-") && <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0 cursor-pointer gap-1 text-muted-foreground" onClick={() => undo(c)}><RotateCcw className="h-3.5 w-3.5" aria-hidden />Undo</Button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            {changingSearch ? (
              <div className="space-y-3">
                <SparkAssist useCase="search" interpret={interpret} context={{ baseVersion: "current" }} autoFocus label="What's changed?" placeholder="e.g. I'm moving to Hyderabad and want Lead roles" applyLabel="Update my search"
                  onApply={({ ops }) => { const before = preferences; onPreferencesChange(applyPrefOps(preferences, ops)); setChangingSearch(false);
                    setChanges(c => [...c, { id: `search-${Date.now()}`, text: ops.map(o => { const d = describeOp(o); return `${d.field}: ${d.value}`; }).join("; "), undo: () => before }]);
                    setUpdating(true); setTimeout(() => setUpdating(false), 1500); }} />
                <Button type="button" variant="ghost" className="min-h-11 w-full cursor-pointer" onClick={() => setChangingSearch(false)}>Close</Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="min-h-11 w-full cursor-pointer gap-2" onClick={() => setChangingSearch(true)}><Sparkles className="h-4 w-4 text-spark" aria-hidden />Change my search</Button>
            )}
          </div>
          {updating && <p role="status" className="flex items-center gap-2 px-1 text-sm text-foreground"><TetrisOrb label="Updating your matches" decorative />Updating your matches…</p>}
          {saved.size > 0 && <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground"><BookmarkCheck className="h-4 w-4" aria-hidden />{saved.size} saved to My jobs</p>}
        </aside>
      </div>
    </div>
  );
}

function JobCard({ job: j, expanded, warnings = [], children }: { job: Job; expanded?: boolean; warnings?: string[]; children: React.ReactNode }) {
  return (
    <article className="space-y-4 rounded-xl border border-border bg-card p-5" aria-label={`${j.title} at ${j.company}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted"><Building2 className="h-5 w-5 text-muted-foreground" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-foreground">{j.title}</h3>
          <p className="text-sm text-foreground/80">{j.company}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden />{j.location} · {j.arrangement}</span>
            {j.pay ? <span className="inline-flex items-center gap-1.5 text-foreground"><Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />{j.pay.label}</span>
              : <span className="inline-flex items-center gap-1.5"><Wallet className="h-4 w-4" aria-hidden />Salary not disclosed</span>}
          </div>
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-spark/25 bg-spark-soft px-3 py-2 text-sm text-foreground" aria-label="Check before applying">
          {warnings.map(w => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-spark-ink" aria-hidden />{w}. You said no travel, so check the job before applying.</li>)}
        </ul>
      )}
      <div className="space-y-2 text-sm">
        <p className="font-medium text-foreground">Why it fits</p>
        <ul className="space-y-1">{(expanded ? j.reasons : j.reasons.slice(0, 1)).map(r => <li key={r} className="flex gap-2 text-foreground/90"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{r}</li>)}</ul>
        {expanded && (j.gaps.length > 0 || !j.pay) && (
          <ul className="space-y-1 pt-1">
            {j.gaps.map(g => <li key={g.text} className="flex gap-2 text-muted-foreground"><X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{g.text}</li>)}
            {!j.pay && expanded && <li className="flex gap-2 text-muted-foreground"><X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Salary not disclosed. Check whether it meets your minimum.</li>}
          </ul>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />Posted {j.posted}</span>
        <span>Checked open {j.lastChecked}</span><span>From {j.source}</span>
        {expanded && <a href={j.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View the job<ArrowRight className="h-3 w-3" aria-hidden /><span className="sr-only">(opens in a new tab)</span></a>}
      </p>
      {children}
    </article>
  );
}
