// Candidate portal (ealana spark), light theme: the existing /my-dashboard reorganised into three
// sections. Reuses the existing data and behaviour (useCandidateJobState for applications, saved
// jobs and résumés; /api/ai/resume upload/delete; withdraw; CandidateTimeline; KpiCard; status
// labels; CandidateConsentPanel + CandidatePrivacyPanel). Nothing is stored twice and there is no
// second upload flow. See ealana-index/CANDIDATE_PORTAL_REUSE_MAP_20261028.md.
// Not shown here (per the reuse map): the legacy profile form (data kept) and candidate
// Compute fit / AI limits (retired by the D1 lock; historical data kept).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bookmark, BookmarkX, Briefcase, CheckCircle2, ChevronDown, ClipboardList, Clock, ExternalLink, FileText, LogOut, MapPin, Search, Shield, Trash2, UserRound, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { KpiCard } from "@/components/dashboards/KpiCard";
import { CandidateTimeline } from "@/components/dashboards/CandidateTimeline";
import { getCandidateApplicationStatus } from "@/components/candidate/CandidateJobStatusBadge";
import { CandidateConsentPanel } from "@/components/candidate/CandidateConsentPanel";
import { SparkConsentPanel } from "@/components/candidate-profile/SparkConsentPanel";
import { CandidatePrivacyPanel } from "@/components/candidate-privacy/CandidatePrivacyPanel";
import { useCandidateJobState } from "@/hooks/use-candidate-job-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchWithCsrf } from "@/lib/csrf";
import { candidateApplicationsQueryKey, candidateResumesQueryKey } from "@/hooks/use-candidate-job-state";
import { cn } from "@/lib/utils";
import ealanaLogo from "@/assets/ealana_logo.svg";
import { OfflineBanner, StillWorking } from "@/components/candidate-profile/SparkStates";

const RESUME_PROMPT_KEY = "spark.resumePromptDismissed";
export type PortalSection = "find" | "jobs" | "profile" | "privacy";
export type PublicJob = { id: number; title: string; company: string; location: string; type: string; postedAt: string };

type Props = {
  firstName: string;
  section: PortalSection;
  onNavigate: (s: PortalSection) => void;
  /** Real switches, not promises: copy and the default view depend on them. */
  discovery: "ready" | "not_ready";
  matching: "ready" | "not_ready";
  /** Shown once, right after onboarding. */
  justFinishedOnboarding?: boolean;
  /** Existing ealana vacancies (the current /jobs list). */
  publicJobs: PublicJob[];
  /** Real list status: while loading or after a failure the list says so instead of "0 jobs". */
  publicJobsState?: "loading" | "error" | "ready";
  onRetryJobs?: () => void;
  /** Server search: when given, the list is the server's results for the query (all pages), not a filter of what's loaded. */
  onSearchJobs?: ((q: string) => void) | undefined;
  publicJobsTotal?: number | undefined;
  onLoadMoreJobs?: (() => void) | undefined;
  loadingMoreJobs?: boolean | undefined;
  /** spark candidates use the v2 talent-network consent; the older panel is only for legacy candidates. */
  sparkConsent?: boolean | undefined;
  /** The last "Show more jobs" request failed; the jobs already shown stay. */
  loadMoreFailed?: boolean | undefined;
  /** The profile page (CareerProfilePanel) and, once matching is live, recommendations. */
  profile: ReactNode;
  recommendations?: ReactNode;
  onSignOut: () => void;
};

const NAV: { key: Exclude<PortalSection, "privacy">; label: string; icon: typeof Search }[] = [
  { key: "find", label: "Find jobs", icon: Search }, { key: "jobs", label: "My jobs", icon: ClipboardList }, { key: "profile", label: "My profile", icon: UserRound },
];

export function CandidatePortal(p: Props) {
  const { resumes = [], resumesQuery } = useCandidateJobState() as any;
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(RESUME_PROMPT_KEY) === "1"; } catch { return false; } });
  const [openUpload, setOpenUpload] = useState(0);
  const showReminder = !resumesQuery?.isLoading && resumes.length === 0 && !dismissed && p.section !== "privacy";
  function dismiss() { setDismissed(true); try { localStorage.setItem(RESUME_PROMPT_KEY, "1"); } catch { /* fine */ } }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <OfflineBanner />
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-8">
          <a href="#find" onClick={e => { e.preventDefault(); p.onNavigate("find"); }} className="flex shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src={ealanaLogo} alt="ealana" className="h-7 w-auto" />
            <span className="ml-2.5 rounded-md bg-spark px-2.5 pb-1 pt-0.5 font-spark text-[17px] font-normal lowercase leading-tight text-white">spark</span>
          </a>
          <nav aria-label="Main" className="ml-4 hidden gap-1 md:flex">
            {NAV.map(n => <NavLink key={n.key} active={p.section === n.key} onClick={() => p.onNavigate(n.key)} icon={n.icon}>{n.label}</NavLink>)}
          </nav>
          <div className="ml-auto"><AccountMenu firstName={p.firstName} onPrivacy={() => p.onNavigate("privacy")} onSignOut={p.onSignOut} /></div>
        </div>
      </header>

      <div className="min-h-[calc(100vh-4rem)] bg-muted/40"><main className="mx-auto max-w-6xl px-4 pb-28 pt-8 md:px-8 md:pb-12">
        {showReminder && (
          <div className="mb-6 flex flex-wrap items-start gap-3 rounded-xl border border-spark/25 bg-spark-soft p-4" role="note">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-spark" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-foreground"><span className="font-semibold">You haven't added a résumé.</span> It helps us understand your projects and responsibilities, so we can find better jobs for you. You review anything we take from it.</p>
            <div className="flex gap-2">
              <Button type="button" className="min-h-11 cursor-pointer" onClick={() => { p.onNavigate("profile"); setOpenUpload(n => n + 1); }}>Add résumé</Button>
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 cursor-pointer" aria-label="Dismiss" onClick={dismiss}><X className="h-4 w-4" aria-hidden /></Button>
            </div>
          </div>
        )}
        {p.section === "find" && <FindJobs {...p} />}
        {p.section === "jobs" && <MyJobs onBrowse={() => p.onNavigate("find")} />}
        {p.section === "profile" && <MyProfile {...p} openUpload={openUpload} />}
        {p.section === "privacy" && (
          <section className="mx-auto max-w-3xl space-y-6" aria-labelledby="privacy-title">
            <PageTitle id="privacy-title" title="Privacy & Data" sub="Control how ealana uses your profile. Withdrawing stops personalised matching and future access to your talent-network profile. It doesn't withdraw applications you've submitted or recall information employers already received." />
            {p.sparkConsent ? <SparkConsentPanel /> : <CandidateConsentPanel />}
            {/* U5: the talent-network withdrawal above is spark's one main control. The older
                requests are wider (all application data, plus erasure review), not the same thing,
                so they stay, unchanged, under their own heading. Legacy candidates see no change. */}
            {p.sparkConsent ? (
              <section className="space-y-3" aria-labelledby="other-privacy-title">
                <h2 id="other-privacy-title" className="text-base font-semibold text-foreground">Other privacy requests</h2>
                <CandidatePrivacyPanel />
              </section>
            ) : <CandidatePrivacyPanel />}
          </section>
        )}
      </main></div>

      {/* Phone: bottom navigation, thumb-reachable. */}
      <BottomNavSpace />
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-background md:hidden">
        {NAV.map(n => (
          <button key={n.key} type="button" onClick={() => p.onNavigate(n.key)} aria-current={p.section === n.key ? "page" : undefined}
            className={cn("flex min-h-14 cursor-pointer flex-col items-center justify-center gap-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", p.section === n.key ? "text-spark-ink" : "text-muted-foreground")}>
            <n.icon className="h-5 w-5" aria-hidden />{n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavLink({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Search; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-spark-soft text-spark-ink" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <Icon className="h-4 w-4" aria-hidden />{children}
    </button>
  );
}

function AccountMenu({ firstName, onPrivacy, onSignOut }: { firstName: string; onPrivacy: () => void; onSignOut: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="min-h-11 cursor-pointer gap-2 px-2">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{firstName.charAt(0)}</span>
          <span className="hidden text-sm sm:inline">{firstName}</span><ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem className="min-h-11 cursor-pointer gap-2" onSelect={onPrivacy}><Shield className="h-4 w-4" aria-hidden />Privacy &amp; Data</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 cursor-pointer gap-2" onSelect={onSignOut}><LogOut className="h-4 w-4" aria-hidden />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PageTitle({ id, title, sub }: { id: string; title: string; sub?: string }) {
  return <div className="space-y-1"><h1 id={id} className="text-2xl font-semibold text-foreground">{title}</h1>{sub && <p className="max-w-prose text-base text-muted-foreground">{sub}</p>}</div>;
}

/* ---------------- Find jobs ---------------- */
function FindJobs({ matching, publicJobs, recommendations, publicJobsState = "ready", onRetryJobs, onSearchJobs, publicJobsTotal, onLoadMoreJobs, loadingMoreJobs, loadMoreFailed }: Props) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { savedJobs, saveJob, unsaveJob } = useCandidateJobState() as any;
  const savedIds = new Set<number>((savedJobs ?? []).map((s: any) => s.job.id));
  const shown = useMemo(() => onSearchJobs ? publicJobs : publicJobs.filter(j => `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q.trim().toLowerCase())), [publicJobs, q, onSearchJobs]);
  // Debounced server search, so typing doesn't send a request per key.
  useEffect(() => { if (!onSearchJobs) return; const t = setTimeout(() => onSearchJobs(q.trim()), 300); return () => clearTimeout(t); }, [q, onSearchJobs]);
  const total = publicJobsTotal ?? shown.length;
  if (matching === "ready" && recommendations && !showAll) {
    return <div className="space-y-4">{recommendations}<div className="mx-auto w-full max-w-5xl border-t border-border pt-4"><Button type="button" variant="outline" className="min-h-11 cursor-pointer gap-2" onClick={() => setShowAll(true)}><Search className="h-4 w-4" aria-hidden />Browse all ealana jobs</Button></div></div>;
  }
  return (
    <section className="space-y-6" aria-labelledby="find-title">
      <PageTitle id="find-title" title={matching === "ready" ? "All ealana jobs" : "Find jobs"} sub="Open roles posted on ealana. Save the ones you like and apply on the job page." />
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search jobs" placeholder="Search by title, company or city" value={q} onChange={e => setQ(e.target.value)} className="min-h-11 pl-9 text-base" />
      </div>
      {publicJobsState === "loading" && <ul className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Loading jobs">{[0, 1, 2, 3].map(i => <li key={i} className="h-36 animate-pulse rounded-xl border border-border bg-card" />)}</ul>}
      <StillWorking active={publicJobsState === "loading"} />
      {publicJobsState === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-5">
          <p className="min-w-0 flex-1 text-sm text-foreground">We couldn't load jobs right now. Nothing you saved is lost.</p>
          {onRetryJobs && <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={onRetryJobs}>Try again</Button>}
        </div>
      )}
      {publicJobsState === "ready" && <>
      <p className="text-sm text-muted-foreground" aria-live="polite">{total} {total === 1 ? "job" : "jobs"}</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map(j => (
          <li key={j.id} className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Briefcase className="h-5 w-5 text-muted-foreground" /></span>
              <div className="min-w-0">
                <h2 className="font-semibold text-foreground">{j.title}</h2>
                {j.company && <p className="text-sm text-foreground/80">{j.company}</p>}
                <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{j.location}</span><span>{j.type}</span><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{j.postedAt}</span></p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11 cursor-pointer gap-2" aria-pressed={savedIds.has(j.id)} onClick={() => savedIds.has(j.id) ? unsaveJob?.(j.id) : saveJob?.(j.id)}>
                {savedIds.has(j.id) ? <><BookmarkX className="h-4 w-4" aria-hidden />Saved</> : <><Bookmark className="h-4 w-4" aria-hidden />Save</>}
              </Button>
              <Button asChild className="min-h-11 cursor-pointer gap-2"><a href={`/jobs/${j.id}`}>View and apply<ExternalLink className="h-4 w-4" aria-hidden /></a></Button>
            </div>
          </li>
        ))}
      </ul>
      {onLoadMoreJobs && shown.length < total && (
        <div className="space-y-2">
          {loadMoreFailed && !loadingMoreJobs && <p role="alert" className="text-sm text-destructive">We couldn't load more jobs.</p>}
          <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={loadingMoreJobs} onClick={onLoadMoreJobs}>
            {loadingMoreJobs ? "Loading…" : loadMoreFailed ? "Try again" : "Show more jobs"}</Button>
          <StillWorking active={!!loadingMoreJobs} />
        </div>
      )}
      {shown.length === 0 && <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">{q.trim() ? `No jobs match "${q}". Try a different word.` : "No open jobs right now. Check back soon."}</p>}
      </>}
    </section>
  );
}

/* ---------------- My jobs ---------------- */
function MyJobs({ onBrowse }: { onBrowse: () => void }) {
  const [tab, setTab] = useState<"applications" | "saved">("applications");
  const { applications = [], savedJobs = [], unsaveJob, applicationsQuery, savedJobsQuery } = useCandidateJobState() as any;
  // Same endpoint and rule as the existing dashboard; an inline confirm replaces window.confirm.
  const [confirmWithdraw, setConfirmWithdraw] = useState<number | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  async function withdraw(id: number) {
    setWithdrawError(null);
    try { await apiRequest("DELETE", `/api/applications/${id}/withdraw`); setConfirmWithdraw(null); await queryClient.invalidateQueries({ queryKey: candidateApplicationsQueryKey }); }
    catch { setWithdrawError("Couldn't withdraw that application. Please try again."); }
  }
  const stats = useMemo(() => ({
    total: applications.length,
    pending: applications.filter((a: any) => ["submitted", "reviewed", "downloaded"].includes(a.status)).length,
    shortlisted: applications.filter((a: any) => a.status === "shortlisted").length,
    rejected: applications.filter((a: any) => a.status === "rejected").length,
  }), [applications]);
  const timeline = applications.map((a: any) => ({ id: a.id, jobTitle: a.job.title, jobLocation: a.job.location, appliedAt: a.appliedAt, status: a.status }));

  return (
    <section className="space-y-6" aria-labelledby="jobs-title">
      <PageTitle id="jobs-title" title="My jobs" />
      <div role="tablist" aria-label="My jobs" className="inline-flex rounded-lg border border-border bg-muted p-1">
        {(["applications", "saved"] as const).map(t => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn("min-h-10 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {t === "applications" ? `Applications (${applications.length})` : `Saved (${savedJobs.length})`}
          </button>
        ))}
      </div>

      {tab === "applications" ? (
        applications.length === 0 && !applicationsQuery?.isLoading ? <Empty icon={ClipboardList} title="No applications yet" body="When you apply to a job, you can follow its progress here." action="Find jobs" onAction={onBrowse} /> : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Applied" value={stats.total} icon={FileText} />
              <KpiCard label="In review" value={stats.pending} icon={Clock} />
              <KpiCard label="Shortlisted" value={stats.shortlisted} icon={CheckCircle2} />
              <KpiCard label="Not selected" value={stats.rejected} icon={XCircle} />
            </div>
            {withdrawError && <p role="alert" className="text-sm text-destructive">{withdrawError}</p>}
            <ul className="space-y-3">
              {applications.map((a: any) => {
                const s = getCandidateApplicationStatus(a);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold text-foreground">{a.job.title}</h2>
                      <p className="text-sm text-muted-foreground">{a.job.location} · Applied {new Date(a.appliedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                    <StatusPill status={a.status} label={s.label} />
                    {a.status === "submitted" && confirmWithdraw !== a.id && (
                      <Button type="button" variant="ghost" className="min-h-11 cursor-pointer text-muted-foreground" onClick={() => setConfirmWithdraw(a.id)}>Withdraw</Button>
                    )}
                    {confirmWithdraw === a.id && (
                      <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm" role="group" aria-label="Confirm withdrawal">
                        <span className="flex-1">Withdraw this application? This can't be undone.</span>
                        <Button type="button" variant="destructive" className="min-h-11 cursor-pointer" onClick={() => void withdraw(a.id)}>Withdraw</Button>
                        <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => setConfirmWithdraw(null)}>Keep it</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <CandidateTimeline title="Application timeline" applications={timeline} isLoading={applicationsQuery?.isLoading} />
          </div>
        )
      ) : (
        savedJobs.length === 0 && !savedJobsQuery?.isLoading ? <Empty icon={Bookmark} title="No saved jobs" body="Save jobs you like to come back to them later." action="Find jobs" onAction={onBrowse} /> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {savedJobs.map((s: any) => (
              <li key={s.id} className="space-y-3 rounded-xl border border-border bg-card p-5">
                <div><h2 className="font-semibold text-foreground">{s.job.title}</h2><p className="text-sm text-muted-foreground">{s.job.location} · Saved {new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p></div>
                {!s.canApply && <p className="text-sm text-muted-foreground">This job is no longer taking applications.</p>}
                <div className="flex flex-wrap gap-2">
                  {s.canApply && <Button asChild className="min-h-11 cursor-pointer gap-2"><a href={`/jobs/${s.job.id}`}>View and apply<ExternalLink className="h-4 w-4" aria-hidden /></a></Button>}
                  <Button type="button" variant="outline" className="min-h-11 cursor-pointer gap-2" onClick={() => unsaveJob?.(s.job.id)}><BookmarkX className="h-4 w-4" aria-hidden />Remove</Button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}

/** Light-theme pill driven by the existing status presentation (same labels as the badge). */
function StatusPill({ status, label }: { status: string; label: string }) {
  const tone = status === "shortlisted" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status === "rejected" ? "border-rose-200 bg-rose-50 text-rose-800"
    : status === "reviewed" || status === "downloaded" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-800";
  return <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium", tone)}>{label}</span>;
}

function Empty({ icon: Icon, title, body, action, onAction }: { icon: typeof Search; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-muted"><Icon className="h-6 w-6 text-muted-foreground" /></span>
      <p className="font-medium text-foreground">{title}</p><p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={onAction}>{action}</Button>
    </div>
  );
}

/* ---------------- My profile ---------------- */
function MyProfile({ discovery, matching, justFinishedOnboarding, profile, openUpload }: Props & { openUpload: number }) {
  const { resumes = [], resumesQuery } = useCandidateJobState() as any;
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  // "Add résumé" in the reminder opens the uploader here and scrolls to it.
  useEffect(() => { if (openUpload) { setShowUpload(true); setTimeout(() => document.getElementById("resumes-title")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); } }, [openUpload]);

  async function upload() {
    if (!file) return;
    if (resumes.length >= 3) { setError("You can keep up to 3 résumés. Delete one before adding another."); return; }
    setUploading(true); setError(null);
    try {
      const form = new FormData(); form.append("resume", file); form.append("label", file.name.replace(/\.[^.]+$/, ""));
      const r = await fetchWithCsrf("/api/ai/resume", { method: "POST", body: form });
      if (!r.ok) throw new Error();
      setFile(null); setShowUpload(false); await queryClient.invalidateQueries({ queryKey: candidateResumesQueryKey });
    } catch { setError("Upload failed. Please try again."); } finally { setUploading(false); }
  }
  async function remove(id: number) {
    try { await apiRequest("DELETE", `/api/ai/resume/${id}`); await queryClient.invalidateQueries({ queryKey: candidateResumesQueryKey }); }
    catch { setError("Couldn't delete that résumé. Please try again."); }
  }

  return (
    <section className="space-y-6" aria-labelledby="profile-title">
      {justFinishedOnboarding && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
          <div className="text-sm text-emerald-900">
            <p className="font-semibold">Your profile is saved.</p>
            <p>{discovery === "ready" ? "Recruiters can now find your profile in their searches." : "Recruiter search isn't switched on yet."} {matching === "ready" ? "Your job matches are in Find jobs." : "Personalised job matches aren't switched on yet; you can browse ealana jobs in the meantime."}</p>
          </div>
        </div>
      )}
      {profile}

      <div className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="resumes-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 id="resumes-title" className="text-lg font-semibold">Résumés</h2><p className="text-sm text-muted-foreground">Up to 3. Used when you apply and to fill in your profile.</p></div>
          {!showUpload && resumes.length < 3 && <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={() => setShowUpload(true)}>Add a résumé</Button>}
        </div>
        {showUpload && (
          <div className="space-y-3">
            <FileDropzone label="Résumé" accept=".pdf,.doc,.docx" maxSizeMB={5} value={file} onChange={setFile} />
            <div className="flex gap-2">
              <Button type="button" className="min-h-11 cursor-pointer" disabled={!file || uploading} onClick={() => void upload()}>{uploading ? "Uploading…" : "Upload"}</Button>
              <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => { setShowUpload(false); setFile(null); setError(null); }}>Cancel</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {resumes.length > 0 ? (
          <ul className="divide-y divide-border">
            {resumes.map((r: any) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.label}{r.isDefault && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Default</span>}</p><p className="text-sm text-muted-foreground">Uploaded {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p></div>
                <Button type="button" variant="ghost" className="min-h-11 cursor-pointer gap-1.5 text-muted-foreground" onClick={() => void remove(r.id)} aria-label={`Delete ${r.label}`}><Trash2 className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Delete</span></Button>
              </li>
            ))}
          </ul>
        ) : !showUpload && <p className="text-sm text-muted-foreground">No résumés yet.</p>}
      </div>
    </section>
  );
}

/** While the phone tab bar is on screen, floating site banners (the cookie notice) sit above it. */
function BottomNavSpace() {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bottom-nav", "57px"); // min-h-14 tabs + 1px border
    return () => { root.style.removeProperty("--bottom-nav"); };
  }, []);
  return null;
}
