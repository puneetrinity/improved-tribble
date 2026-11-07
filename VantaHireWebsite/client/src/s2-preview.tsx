// LOCAL PREVIEW ONLY — not part of the S2 change; do not commit.
// Renders CareerProfilePanel with fixture data and a fake save API.
// ?state=draft|held|stuck|ready|confirmed|restricted|unavailable
import { Sparkles } from "lucide-react";
import type { Exclusion, Suggestion } from "@/components/candidate-profile/SparkAssist";
import { CandidateAuthShell } from "@/components/candidate-profile/CandidateAuthShell";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/public-theme.css";
import "./index.css";
import ealanaLogo from "@/assets/ealana_logo.svg";
import { useEffect, useState } from "react";
import { OnboardingWizard, type ImportedProfile, type ResumeExtraction, type SaveCommand, type SaveResult, type ConfirmCommand } from "@/components/candidate-profile/OnboardingWizard";
import { searchCompanies, simulateSpark } from "./s2-preview-spark";
import { Button } from "@/components/ui/button";
import { CandidateSignup, CheckYourEmail } from "@/components/candidate-profile/CandidateSignup";
import { CandidatePortal, type PortalSection } from "@/components/candidate-portal/CandidatePortal";
import { AuthProvider } from "@/hooks/use-auth";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import { ConsentStep } from "@/components/candidate-profile/ConsentStep";
import { JobMatches, type Job } from "@/components/candidate-profile/JobMatches";
import { CareerProfilePanel } from "@/components/candidate-profile/CareerProfilePanel";
import type { ProfileLoad } from "@/lib/candidate-profile-api";

const qs = new URLSearchParams(location.search);
// The full journey shows matching as live (5 jobs to rate, then the list); add &matching=off for the launch-day state.
const MATCHING_LIVE = qs.get("matching") === "ready" || (qs.get("view") === "journey" && qs.get("matching") !== "off");
// The portal is reached after confirming, so its profile loads as confirmed.
const state = qs.get("state") ?? (["portal", "journey"].includes(qs.get("view") ?? "") ? "confirmed" : "draft");
const draft = {
  displayName: "Priya Sharma", headline: "Backend engineer, payments",
  linkedinUrl: "https://linkedin.com/in/priya-sharma",
  currentLocation: { city: "Bengaluru", countryCode: "IN", displayCountry: "India" },
  skills: ["Python", "PostgreSQL", "Kafka", "Distributed systems"],
  employment: [
    { id: "11111111-1111-4111-8111-111111111111", employer: "Razorpay", title: "Senior Software Engineer", description: "Built the refunds ledger and payout reconciliation.", start: { value: "2024-01", precision: "month" }, end: null, current: true },
    { id: "11111111-1111-4111-8111-111111111112", employer: "Razorpay", title: "Software Engineer", description: "Payments gateway APIs and merchant onboarding.", start: { value: "2022-04", precision: "month" }, end: { value: "2023-12", precision: "month" }, current: false },
    { id: "11111111-1111-4111-8111-111111111113", employer: "Freshworks", title: "Software Engineer", description: "", start: { value: "2019-07", precision: "month" }, end: { value: "2022-03", precision: "month" }, current: false },
  ],
  education: [{ id: "22222222-2222-4222-8222-222222222222", institution: "IIT Madras", qualification: "B.Tech, Computer Science", description: "", start: { value: "2014", precision: "year" }, end: { value: "2018", precision: "year" }, current: false }],
  projects: [],
};
const preferences = {
  desiredRoles: ["Backend engineer", "Platform engineer"], preferredSeniority: ["Senior"], workArrangements: ["remote", "hybrid"],
  locations: { mode: "specific", places: [{ city: "Bengaluru", countryCode: "IN" }] }, remoteRegions: { mode: "worldwide" },
  relocation: { mode: "discuss", destinations: [] }, employmentTypes: ["permanent"], availability: { mode: "notice_days", days: 60 },
  compensation: { mode: "target", currency: "INR", period: "annual", component: "ctc", targetMin: "4000000.00", targetMax: "5000000.00", hardMinimum: null },
  strengths: { roles: "firm", location: "flexible", workArrangement: "flexible", employmentType: "firm", compensation: "flexible" },
};
const CMD = "20000000-0000-4000-8000-000000000001";
const ready = state === "ready" || state === "confirmed";
const profile: any = {
  schemaVersion: 2, state: state === "confirmed" ? "confirmed" : "draft", draftVersion: 3, profileVersion: state === "confirmed" ? 1 : 0,
  preferenceVersion: ready ? 1 : 0, draftHash: "a".repeat(64),
  draft: state === "draft" ? { ...draft, employment: [], education: [], skills: ["Python"] } : draft,
  confirmedProfile: null, preferences: ready ? preferences : null, confirmedConsentVersion: 0,
  missingFields: ready ? [] : ["preferences"], sources: [], proposals: [],
  capabilities: ready ? { canEdit: true, canConfirm: true, canEnrich: false, canRequestResume: false }
    : { canEdit: true, canConfirm: false, confirmBlockedReason: "incomplete_profile", canEnrich: false, canRequestResume: false },
  publicationActive: false, matchingState: "not_available",
  pendingCommands: state === "held" ? [{ commandId: CMD, action: "save_preferences", status: "held", reason: "memory_unavailable" }]
    : state === "stuck" ? [{ commandId: CMD, action: "save_draft", status: "held", reason: "retry_exhausted" }] : [],
};
const load = async (): Promise<ProfileLoad> => {
  await new Promise(r => setTimeout(r, 400));
  if (state === "unavailable") return { kind: "unavailable" };
  if (state === "restricted") return { kind: "ready", profile: { ...profile, state: "restricted", code: "candidate_privacy_restricted", capabilities: { canEdit: false, canConfirm: false, canEnrich: false, canRequestResume: false } } };
  return { kind: "ready", profile };
};

// Portal sample data, served to the EXISTING hooks and panels (useCandidateJobState, consent and
// privacy panels) so the prototype exercises the real data paths.
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const job = (id: number, title: string, location: string) => ({ id, title, location, type: "Full-time", description: "", skills: [], deadline: null, createdAt: day(10), isActive: true, expiresAt: null });
const portalStore = {
  applications: [
    { id: 41, jobId: 301, status: "shortlisted", coverLetter: null, appliedAt: day(12), updatedAt: day(3), aiFitScore: null, aiFitLabel: null, aiFitReasons: null, aiComputedAt: null, aiStaleReason: null, job: job(301, "Senior Backend Engineer", "Bengaluru") },
    { id: 42, jobId: 302, status: "reviewed", coverLetter: null, appliedAt: day(6), updatedAt: day(2), aiFitScore: null, aiFitLabel: null, aiFitReasons: null, aiComputedAt: null, aiStaleReason: null, job: job(302, "Platform Engineer", "Hyderabad") },
    { id: 43, jobId: 303, status: "submitted", coverLetter: null, appliedAt: day(1), updatedAt: day(1), aiFitScore: null, aiFitLabel: null, aiFitReasons: null, aiComputedAt: null, aiStaleReason: null, job: job(303, "Payments Engineer", "Remote, India") },
  ],
  saved: [{ id: 91, createdAt: day(4), canApply: true, job: job(304, "Staff Engineer, Ledger", "Bengaluru") }, { id: 92, createdAt: day(20), canApply: false, job: job(305, "Backend Developer", "Pune") }] as any[],
  resumes: (qs.get("resumes") === "1" ? [{ id: 7, label: "Priya Sharma CV 2026", isDefault: true, createdAt: day(30), updatedAt: day(30) }] : []) as any[],
};
const PUBLIC_JOBS = [
  { id: 304, title: "Staff Engineer, Ledger", company: "Ledgerly", location: "Bengaluru", type: "Full-time", postedAt: "2 days ago" },
  { id: 306, title: "Senior Software Engineer, Payments", company: "Finmint", location: "Bengaluru", type: "Full-time", postedAt: "3 days ago" },
  { id: 307, title: "Backend Engineer", company: "Kitebyte", location: "Remote, India", type: "Full-time", postedAt: "5 days ago" },
  { id: 308, title: "Engineering Manager", company: "Orbit Commerce", location: "Mumbai", type: "Full-time", postedAt: "1 week ago" },
];
function portalApi(url: string, method: string): Response | null {
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!;
  if (path === "/api/user") return json({ id: 7, role: "candidate", emailVerified: true, firstName: "Priya", lastName: "Sharma", username: "priya@example.com" });
  if (path === "/api/my-applications") return json(portalStore.applications);
  const w = path.match(/^\/api\/applications\/(\d+)\/withdraw$/);
  if (w && method === "DELETE") { portalStore.applications = portalStore.applications.filter(a => a.id !== Number(w[1])); return json({ ok: true }); }
  if (path === "/api/candidate/saved-jobs") return json({ savedJobs: portalStore.saved });
  const sj = path.match(/^\/api\/candidate\/saved-jobs\/(\d+)$/);
  if (sj && method === "POST") { const pj = PUBLIC_JOBS.find(j => j.id === Number(sj[1])); if (pj) portalStore.saved = [{ id: Date.now(), createdAt: new Date().toISOString(), canApply: true, job: job(pj.id, pj.title, pj.location) }, ...portalStore.saved]; return json({ ok: true }); }
  if (sj && method === "DELETE") { portalStore.saved = portalStore.saved.filter(x => x.job.id !== Number(sj[1])); return json({ ok: true }); }
  if (path === "/api/ai/resume" && method === "GET") return json({ resumes: portalStore.resumes });
  if (path === "/api/ai/resume" && method === "POST") { portalStore.resumes = [...portalStore.resumes, { id: Date.now(), label: "Uploaded résumé", isDefault: portalStore.resumes.length === 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]; return json({ ok: true }, 201); }
  const rd = path.match(/^\/api\/ai\/resume\/(\d+)$/);
  if (rd && method === "DELETE") { portalStore.resumes = portalStore.resumes.filter(r => r.id !== Number(rd[1])); return json({ ok: true }); }
  if (path === "/api/profile") return json({ user: { id: 7, firstName: "Priya", lastName: "Sharma" }, profile: { displayName: "Priya Sharma", skills: ["Python", "PostgreSQL", "Kafka"], linkedin: "https://linkedin.com/in/priya-sharma", location: "Bengaluru" } });
  if (path === "/api/candidate/consent") return json({ purpose: "talent_network", copy_version: 2, copy: "Draft consent text (pending policy review).", copy_sha256: "preview", publication_active: false, saved_message: "", version: 1,
    desired: null, effective: { action: "grant", version: 1, profile: null, resume_version_id: null, profile_sha256: null }, delivery_status: "acknowledged", error_code: null, recent_auth_required: false });
  if (path === "/api/candidate/consent/sources") return json({ sources: [], next_cursor: null });
  if (path === "/api/candidate/privacy/status") return json({ intakeEnabled: true, recentAuthRequired: false, requests: [] });
  return null;
}

// Fake save API: pending for ~2s, then applied ("held" scenario stays held).
let admittedAt = 0;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/csrf-token")) return json({ token: "preview" });
  const portal = portalApi(url, (init?.method ?? "GET").toUpperCase());
  if (portal) return portal;
  if (url.endsWith("/api/candidate/product/profile/commands")) { admittedAt = Date.now(); return json({ schemaVersion: 2, commandId: CMD, status: "pending" }, 202); }
  if (url.includes("/api/candidate/product/profile/commands/")) {
    if (state === "held") return json({ schemaVersion: 2, commandId: CMD, status: "held", reason: "memory_unavailable" });
    if (state === "stuck") return json({ schemaVersion: 2, commandId: CMD, status: "held", reason: "retry_exhausted" });
    return json({ schemaVersion: 2, commandId: CMD, status: Date.now() - admittedAt > 2000 ? "applied" : "pending", reason: null });
  }
  return realFetch(input, init);
};

// Wizard: the profile lookup "returns" after 2.5 s with sample data (Crustdata via S2B later).
// Crustdata gives titles and dates but rarely what the person did, so descriptions are empty here.
const SAMPLE_SKILLS = ["Python", "PostgreSQL", "Kafka", "Distributed systems", "Payments", "AWS"];
const importedSample = (): ImportedProfile => ({ source: "professional_profile", profile: { ...draft, skills: SAMPLE_SKILLS, projects: [], employment: draft.employment.map(r => ({ ...r, description: "" })) } as any });
// LinkedIn retry: "linkedin.com/in/notfound" finds nothing; any other valid link returns the sample profile.
const lookupByLinkedin = (url: string) => new Promise<ImportedProfile | "none">(r => setTimeout(() => r(/notfound/.test(url) ? "none" : importedSample()), 2000));
// Résumé extraction (S2B later): each item has an id, source version and quoted evidence; edits
// to existing roles name the exact row. Includes an earlier role at a similarly named company,
// which must stay a separate row.
const src = { resumeVersionId: "resume-v1", extractionVersion: "x-2026-10-28" };
// Simulated: drafts a role description from the candidate's own LinkedIn/résumé text, quoting it.
const suggestRole = (row: { employer: string }, resumeVersionId: string | null) => new Promise<Suggestion | null>(r => setTimeout(() => r(
  /razorpay/i.test(row.employer) ? (resumeVersionId
    ? { source: "resume", items: [{ text: "Led the refunds and payouts platform", evidence: "Refunds & payouts platform lead" }, { text: "Rebuilt payout reconciliation", evidence: "Rebuilt payout reconciliation" }, { text: "Cut failed settlements by 40%", evidence: "failed settlements down 40%" }] }
    : { source: "linkedin", items: [{ text: "Worked on the refunds and payouts platform", evidence: "Refunds & payouts platform team" }, { text: "Payout reconciliation", evidence: "payout reconciliation" }] })
  : /freshworks/i.test(row.employer) ? { source: "linkedin", items: [{ text: "Built REST APIs for the ticketing product", evidence: "Ticketing APIs" }, { text: "Python and PostgreSQL", evidence: "Python, PostgreSQL" }] }
  : null), 700));
const readResume = (_f: File, rows: { id: string; employer: string; title: string }[]) => new Promise<ResumeExtraction>(r => setTimeout(() => {
  const fresh = rows.find(x => x.employer === "Freshworks"), rzp = rows[0];
  r({ resumeVersionId: src.resumeVersionId, items: [
    { id: "r1", source: src, kind: "employment", employer: "Freshworks Labs", title: "Engineering Intern", start: "2018", end: "2018", current: false, evidence: "Engineering Intern, Freshworks Labs (2018)" },
    ...(rzp ? [{ id: "r2", source: src, kind: "responsibility" as const, rowId: rzp.id, employer: rzp.employer, title: rzp.title, text: "On-call lead for the payouts service", evidence: "On-call lead for the payouts service" }] : []),
    { id: "r3", source: src, kind: "education", institution: "IIT Madras", qualification: "M.Tech, Computer Science", start: "2018", end: "2019", evidence: "M.Tech CS, IIT Madras, 2018–2019" },
    { id: "r4", source: src, kind: "skill", value: "Go", evidence: "Skills: Go, Redis" }, { id: "r5", source: src, kind: "skill", value: "Redis", evidence: "Skills: Go, Redis" },
    { id: "r6", source: src, kind: "project", value: "Payout reconciliation engine (open-sourced)", evidence: "Open-sourced our payout reconciliation engine" },
    ...(fresh ? [{ id: "r7", source: src, kind: "conflict" as const, rowId: fresh.id, employer: fresh.employer, title: fresh.title, field: "start" as const, profileValue: "2019", resumeValue: "2018", evidence: "Freshworks, 2018 – 2022" }] : []),
  ] });
}, 1500));
// Fake save service with idempotent receipts: a command whose key was already applied returns its
// original receipt and changes nothing. ?failsave=1: the first attempt fails BEFORE saving (timeout).
// ?failsave=lost: the first attempt IS saved but its response is lost; the retry must get the
// original receipt back, with no second edit.
let pv = 0, qv = 0;
// What the candidate confirmed as deal-breakers in setup, so the portal's job list can apply them.
let savedExclusions: Exclusion[] = [];
const saveLog: string[] = [];
const receipts = new Map<string, SaveResult>();
const attempts = new Map<string, number>();
const failMode = qs.get("failsave");
const onSave = (c: SaveCommand) => new Promise<SaveResult>((ok, fail) => setTimeout(() => {
  const k = c.idempotencyKey.slice(0, 8), n = (attempts.get(c.idempotencyKey) ?? 0) + 1; attempts.set(c.idempotencyKey, n);
  const known = receipts.get(c.idempotencyKey);
  if (known) { saveLog.push(`${c.kind} ${k}: already applied, original receipt returned (attempt ${n})`); ok(known); return; }
  if (failMode === "1" && n === 1) { saveLog.push(`${c.kind} ${k}: timed out before saving`); fail(new Error("timeout")); return; }
  // Deal-breakers and work authorisation are part of the preference draft: each change is a new revision.
  const receipt: SaveResult = c.kind === "profile_draft" ? { profileVersion: `p${++pv}` } : c.kind === "preferences_draft" || c.kind === "dealbreakers" || c.kind === "work_authorisation" ? { preferencesVersion: `q${++qv}` } : {};
  if (c.kind === "dealbreakers") savedExclusions = c.exclusions;
  receipts.set(c.idempotencyKey, receipt);
  if (failMode === "lost" && n === 1) { saveLog.push(`${c.kind} ${k}: SAVED, response lost`); fail(new Error("response lost")); return; }
  saveLog.push(`${c.kind} ${k}: saved (attempt ${n})`); ok(receipt);
}, 300));
const confirmReceipts = new Map<string, string>();
let confirmAttempts = 0;
const confirmProfile = (c: ConfirmCommand) => new Promise<void>((ok, fail) => setTimeout(() => {
  confirmAttempts++;
  const body = JSON.stringify(c);
  if (confirmReceipts.has(c.idempotencyKey)) {
    saveLog.push(confirmReceipts.get(c.idempotencyKey) === body ? `confirm ${c.idempotencyKey.slice(0, 8)}: already recorded, same command` : `confirm ${c.idempotencyKey.slice(0, 8)}: SAME KEY, DIFFERENT COMMAND (bug)`);
    ok(); return;
  }
  confirmReceipts.set(c.idempotencyKey, body);
  if (failMode === "lost" && confirmAttempts === 1) { saveLog.push(`confirm ${c.idempotencyKey.slice(0, 8)}: RECORDED, response lost`); fail(new Error("lost")); return; }
  saveLog.push(`confirm ${c.idempotencyKey.slice(0, 8)}: recorded`); ok();
}, 300));
function WizardPreview({ onDone }: { onDone?: (prefs: any) => void }) {
  const [imported, setImported] = useState<ImportedProfile | null | "none">(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setImported(state === "nomatch" ? "none" : importedSample()), 2500); return () => clearTimeout(t); }, []);
  if (done) return <pre className="mx-auto max-w-3xl whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-xs">{done}</pre>;
  return <OnboardingWizard firstName="Priya" imported={imported} lookupByLinkedin={lookupByLinkedin} readResume={readResume} interpret={simulateSpark} suggestRole={suggestRole} searchCompanies={searchCompanies}
    onSave={onSave} consentVersion="draft-v2-synthetic" discovery={qs.get("discovery") === "ready" ? "ready" : "not_ready"} matching={MATCHING_LIVE ? "ready" : "not_ready"}
    onConfirm={async c => { await confirmProfile(c); onDone ? onDone({}) : setDone(`Confirmation command: ${JSON.stringify(c, null, 2)}\n\nEdits applied: ${pv} profile, ${qv} preferences\n\nLog:\n${saveLog.join("\n")}`); }} />;
}
// Jobs page: sample jobs (fictional companies), Priya's preferences.
const sampleJobs: Job[] = [
  { id: "j1", title: "Senior Backend Engineer, Payments", company: "Ledgerly", companyId: "7d1c2f9e-0000-4000-8000-000000000001", travel: false, location: "Bengaluru", arrangement: "Hybrid", level: "Senior",
    pay: { min: "4500000", max: "6000000", currency: "INR", label: "₹45L – ₹60L a year" }, source: "Ledgerly careers (Greenhouse)", lastChecked: "3 hours ago", posted: "2 days ago", url: "https://example.com/jobs/1",
    reasons: ["You've built payment systems at Razorpay for 4 years", "Python, PostgreSQL and Kafka are all in the job", "Bengaluru, hybrid, as you asked"], gaps: [] },
  { id: "j2", title: "Staff Engineer, Platform", company: "Northstar Pay", companyId: "7d1c2f9e-0000-4000-8000-000000000002", travel: null, location: "Bengaluru", arrangement: "On-site", level: "Staff",
    pay: null, source: "Northstar Pay careers (Lever)", lastChecked: "yesterday", posted: "5 days ago", url: "https://example.com/jobs/2",
    reasons: ["Payments platform, like your work at Razorpay", "Distributed systems and Kafka match your skills"], gaps: [{ text: "Asks for 10+ years; you have about 7" }, { text: "Kubernetes isn't on your profile", skill: "Kubernetes" }] },
  { id: "j3", title: "Senior Software Engineer", company: "Cashwave", companyId: "7d1c2f9e-0000-4000-8000-000000000003", travel: true, location: "Mumbai", arrangement: "Hybrid", level: "Senior",
    pay: { min: "3500000", max: "4200000", currency: "INR", label: "₹35L – ₹42L a year" }, source: "Cashwave careers (Ashby)", lastChecked: "6 hours ago", posted: "1 week ago", url: "https://example.com/jobs/3",
    reasons: ["Senior backend role in fintech", "Python and AWS match your skills"], gaps: [{ text: "In Mumbai, not Bengaluru" }, { text: "Top of the range is below your target" }] },
  { id: "j4", title: "Backend Engineer II", company: "Kitebyte", companyId: "7d1c2f9e-0000-4000-8000-000000000004", travel: false, location: "Remote, India", arrangement: "Remote", level: "Mid-level",
    pay: { min: "2800000", max: "3600000", currency: "INR", label: "₹28L – ₹36L a year" }, source: "Kitebyte careers (Workday)", lastChecked: "2 hours ago", posted: "3 days ago", url: "https://example.com/jobs/4",
    reasons: ["Python and PostgreSQL backend work", "Fully remote in India"], gaps: [{ text: "Mid-level; you're looking at Senior roles" }] },
  { id: "j5", title: "Senior Engineer, Reconciliation", company: "Finmint", companyId: "7d1c2f9e-0000-4000-8000-000000000005", travel: null, location: "Bengaluru", arrangement: "Hybrid", level: "Senior",
    pay: { min: "4000000", max: "5200000", currency: "INR", label: "₹40L – ₹52L a year" }, source: "Finmint careers (Greenhouse)", lastChecked: "1 hour ago", posted: "4 days ago", url: "https://example.com/jobs/5",
    reasons: ["You built payout reconciliation at Razorpay", "Bengaluru, hybrid", "Pay range covers your target"], gaps: [] },
  { id: "j6", title: "Lead Engineer, Merchant APIs", company: "Orbit Commerce", companyId: "7d1c2f9e-0000-4000-8000-000000000006", travel: false, location: "Bengaluru", arrangement: "Hybrid", level: "Lead",
    pay: null, source: "Orbit Commerce careers (Lever)", lastChecked: "5 hours ago", posted: "6 days ago", url: "https://example.com/jobs/6",
    reasons: ["You built merchant onboarding APIs at Razorpay", "Bengaluru, hybrid"], gaps: [] },
];
const jobPrefs: any = { ...preferences, desiredRoles: ["Senior Software Engineer"], preferredSeniority: ["Senior"], workArrangements: ["hybrid"],
  locations: { mode: "specific", places: [{ city: "Bengaluru", countryCode: "IN" }] },
  compensation: { mode: "target", currency: "INR", period: "annual", component: "ctc", targetMin: "4000000.00", targetMax: "5000000.00", hardMinimum: null } };
function JobsPreview({ initial = jobPrefs }: { initial?: any }) {
  const [prefs, setPrefs] = useState(initial);
  return <JobMatches jobs={sampleJobs} checkedCount={1284} preferences={prefs} onPreferencesChange={setPrefs} onProposeSkill={() => undefined} interpret={simulateSpark} exclusions={[{ id: "x1", kind: "no_travel" }]} />;
}
// The whole journey in one place: consent, then setup, then jobs. (Email verification sits between
// consent and setup in the real product; it's the existing Flow screen, so it's skipped here.)
function JourneyPreview() {
  const [stage, setStage] = useState<"signup" | "declined" | "verify" | "setup" | "portal">("signup");
  useEffect(() => { if (stage === "portal") window.dispatchEvent(new CustomEvent("spark:portal")); }, [stage]);
  const [email, setEmail] = useState("");
  useEffect(() => { window.scrollTo(0, 0); }, [stage]);
  if (stage === "signup") return <CandidateAuthShell matching={MATCHING_LIVE ? "ready" : "not_ready"}><CandidateSignup consentVersion="draft-v2-synthetic" privacyUrl="/privacy-policy" termsUrl="/terms-of-service" jobsUrl="#jobs" signInUrl="#signin" draftWording
    onCreate={async e => { await new Promise(r => setTimeout(r, 700)); setEmail(e); setStage("verify"); }} onDeclined={() => setStage("declined")} /></CandidateAuthShell>;
  if (stage === "declined") return <CandidateAuthShell matching={MATCHING_LIVE ? "ready" : "not_ready"}><p className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6 text-center text-sm">No account is created. The candidate goes to the public ealana jobs list and can apply as a guest. <a href="?view=journey" className="underline">Start again</a></p></CandidateAuthShell>;
  if (stage === "verify") return (
    <CandidateAuthShell matching={MATCHING_LIVE ? "ready" : "not_ready"}><CheckYourEmail email={email} onResend={() => new Promise(r => setTimeout(r, 600))} onChangeEmail={() => setStage("signup")} lookupReady>
      <Button type="button" className="min-h-11 w-full cursor-pointer" onClick={() => setStage("setup")}>Preview only: simulate clicking the email link</Button>
    </CheckYourEmail></CandidateAuthShell>
  );
  // The lookup starts here, after consent and verification: WizardPreview starts it on mount.
  if (stage === "setup") return <Framed><WizardPreview onDone={() => setStage("portal")} /></Framed>;
  return null;
}
function PortalPreview({ initial = (qs.get("section") as PortalSection) ?? (MATCHING_LIVE ? "find" : "profile"), justFinished = false }: { initial?: PortalSection; justFinished?: boolean }) {
  const [section, setSection] = useState<PortalSection>(initial);
  const discovery = qs.get("discovery") === "ready" ? "ready" : "not_ready", matching = MATCHING_LIVE ? "ready" : "not_ready";
  useEffect(() => { window.scrollTo(0, 0); }, [section]);
  return (
    <AuthProvider>
      <CandidatePortal firstName="Priya" userId={1} section={section} onNavigate={setSection} discovery={discovery} matching={matching} justFinishedOnboarding={justFinished || qs.get("welcome") === "1"}
        publicJobs={PUBLIC_JOBS} profile={<CareerProfilePanel deps={{ load }} />}
        recommendations={<JobMatches jobs={sampleJobs} checkedCount={1284} preferences={jobPrefs} onPreferencesChange={() => undefined} onProposeSkill={() => undefined} interpret={simulateSpark} exclusions={savedExclusions} />}
        onSignOut={() => { location.href = "?view=journey"; }} />
    </AuthProvider>
  );
}
function ConsentPreview() {
  const [choice, setChoice] = useState<string | null>(null);
  if (choice) return <pre className="mx-auto max-w-xl whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-xs">{choice}</pre>;
  return <ConsentStep textVersion="draft-v2-synthetic" privacyUrl="/privacy-policy" termsUrl="/terms-of-service" privacySettingsUrl="#privacy" jobsUrl="#jobs" draftWording onDecide={c => setChoice("Would record: " + JSON.stringify(c, null, 2))} />;
}
const view = new URLSearchParams(location.search).get("view") ?? "profile";
const scenarios = ["draft", "ready", "confirmed", "held", "stuck", "restricted", "unavailable"];
const LINKS: [string, string][] = [["?view=journey", "full journey (matching live)"], ["?view=journey&matching=off", "full journey (launch day, no matching)"], ["?view=portal&welcome=1", "portal (just onboarded)"], ["?view=portal&section=jobs", "portal: my jobs"], ["?view=portal&matching=ready&discovery=ready", "portal (matching live)"],
  ["?view=consent", "consent"], ["?view=wizard", "setup wizard"], ["?view=jobs", "jobs"], ["?state=draft", "profile states"]];
function PreviewBar() {
  return (
    <nav aria-label="Preview scenarios" className="border-t border-dashed border-border bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <strong className="mr-3">Local preview, sample data:</strong>
      {LINKS.map(([href, label]) => <a key={href} href={href} className="mr-4 underline-offset-4 hover:underline">{label}</a>)}
    </nav>
  );
}
// The journey ends inside the portal, which has its own header, so it renders full-page.
function JourneyOrPortal() {
  const [inPortal, setInPortal] = useState(false);
  useEffect(() => { const h = () => setInPortal(true); window.addEventListener("spark:portal", h); return () => window.removeEventListener("spark:portal", h); }, []);
  if (inPortal) return <PortalPreview justFinished />;
  return <JourneyPreview />;
}
function Framed({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center border-b border-border bg-card px-4 py-3 md:px-8">
        <img src={ealanaLogo} alt="ealana" className="h-8 w-auto" />
        <span className="ml-2.5 rounded-md bg-spark px-2.5 pb-1 pt-0.5 font-spark text-[17px] font-normal lowercase leading-tight text-white">spark</span>
      </header>
      <main className="mx-auto max-w-6xl bg-muted/30 px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
// Brand options sheet (preview only): colour × lettering for the "spark" wordmark.
const BRAND_COLOURS: [string, string, string][] = [["Coral (current)", "#F25C2E", "#FEF0EA"], ["Violet", "#7C5CFC", "#F1EEFF"], ["Rose", "#E5486B", "#FDEEF2"], ["Magenta", "#C239B3", "#FBEEFA"], ["Deep teal", "#0F8F86", "#E8F6F5"], ["Indigo", "#4F46E5", "#EEF0FF"]];
const LETTERING: [string, string][] = [["A. Semibold, larger (current)", "text-lg font-semibold tracking-tight"], ["B. Bold, same size as ealana", "text-[17px] font-bold tracking-tight"], ["C. Medium, lighter", "text-lg font-medium"]];
const WORDMARKS: [string, React.ReactNode][] = [
  ["1. Dark text, nothing else", <span className="text-[17px] font-bold tracking-tight text-foreground">spark</span>],
  ["2. Dark text + orange dot", <span className="text-[17px] font-bold tracking-tight text-foreground">spark<span className="text-spark">.</span></span>],
  ["3. Orange spark icon + dark text", <span className="inline-flex items-center gap-1 text-[17px] font-bold tracking-tight text-foreground"><Sparkles className="h-4 w-4 text-spark" aria-hidden />spark</span>],
  ["4. Dark text, orange underline", <span className="border-b-2 border-spark pb-0.5 text-[17px] font-bold tracking-tight text-foreground">spark</span>],
  ["5. Orange pill, white text", <span className="rounded-md bg-spark px-2 py-0.5 text-[15px] font-bold tracking-tight text-white">spark</span>],
  ["6. Small caps label, orange", <span className="text-xs font-bold uppercase tracking-[0.18em] text-spark-ink">spark</span>],
];
const BUTTONS: [string, string, string][] = [["Navy (current)", "hsl(var(--primary))", "passes"], ["Brand orange #F25C2E", "#F25C2E", "3.3:1, too faint for button text"], ["Button orange #CF4416", "#CF4416", "4.7:1, passes"]];
const PILL = "rounded-md bg-spark px-2 py-0.5 text-[15px] font-bold leading-tight tracking-tight text-white";
function HeaderSample({ mark, width }: { mark: "full" | "butterfly"; width: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background" style={{ width }}>
      <div className="flex h-14 items-center px-4">
        {mark === "full" ? <img src={ealanaLogo} alt="ealana" className="h-7 w-auto" /> : <img src="/favicon.svg" alt="ealana" className="h-7 w-auto" />}
        <span className={`${mark === "full" ? "ml-2.5" : "ml-1.5"} ${PILL}`}>spark</span>
        <span className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">P</span>
      </div>
    </div>
  );
}
function BrandSheet() {
  return (
    <div className="space-y-8">
      <section className="space-y-5 rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold">Header: full ealana logo vs butterfly only</p>
        {(["full", "butterfly"] as const).map(m => (
          <div key={m} className="space-y-2">
            <p className="text-xs text-muted-foreground">{m === "full" ? "A. Current: ealana logo + spark" : "B. Butterfly + spark"}</p>
            <div className="flex flex-wrap items-start gap-4"><HeaderSample mark={m} width={560} /><HeaderSample mark={m} width={360} /></div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Left: desktop. Right: phone width.</p>
      </section>
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold">Buttons</p>
        <div className="grid gap-4 md:grid-cols-3">
          {BUTTONS.map(([label, bg, note]) => (
            <div key={label} className="space-y-3 rounded-lg border border-border bg-background p-4">
              <p className="text-xs text-muted-foreground">{label}: {note}</p>
              <div className="flex items-center gap-2"><img src={ealanaLogo} alt="" className="h-6 w-auto" /><span className="ml-2 rounded-md bg-spark px-2 py-0.5 text-[15px] font-bold leading-tight tracking-tight text-white">spark</span></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-md px-4 text-sm font-medium text-white" style={{ background: bg }}>Confirm profile</button>
                <button type="button" className="min-h-11 rounded-md border border-border bg-background px-4 text-sm font-medium">Back</button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-md px-4 text-sm font-medium text-white" style={{ background: bg }}>Save job</button>
                <span className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm text-white" style={{ background: bg, borderColor: bg }}>✓ Hybrid</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold">Wordmark options (orange #F25C2E kept as spark's colour)</p>
        <div className="grid gap-4 md:grid-cols-3">
          {WORDMARKS.map(([label, mark]) => (
            <div key={label} className="space-y-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-3"><img src={ealanaLogo} alt="" className="h-7 w-auto" /><span className="border-l border-border pl-2.5">{mark}</span></div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <span className="inline-flex min-h-10 items-center rounded-md bg-spark-soft px-3 text-sm font-medium text-spark-ink">My profile (active tab)</span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-spark text-white">✓</span>
          <span className="h-0.5 w-24 rounded bg-spark" />
          <span className="rounded-full bg-spark-soft px-3 py-1 text-xs font-medium text-spark-ink">From your professional profile</span>
        </div>
      </section>
      {BRAND_COLOURS.map(([name, c, soft]) => (
        <section key={name} className="space-y-3 rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-semibold">{name} <span className="font-normal text-muted-foreground">{c}</span></p>
          <div className="grid gap-4 md:grid-cols-3">
            {LETTERING.map(([label, cls]) => (
              <div key={label} className="space-y-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-3">
                  <img src={ealanaLogo} alt="" className="h-7 w-auto" /><span className={`border-l border-border pl-2.5 lowercase ${cls}`} style={{ color: c }}>spark</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium" style={{ background: soft, color: c }}>My profile (active tab)</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-white" style={{ background: c }}>✓</span>
            <span className="h-0.5 w-24 rounded" style={{ background: c }} />
            <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: soft, color: c }}>From your professional profile</span>
          </div>
        </section>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={appQueryClient}>
    {view === "portal" ? <PortalPreview /> : view === "journey" ? <JourneyOrPortal /> : (
      <Framed>{view === "brand" ? <BrandSheet /> : view === "consent" ? <ConsentPreview /> : view === "jobs" ? <JobsPreview /> : view === "wizard" ? <WizardPreview /> : <CareerProfilePanel deps={{ load }} />}</Framed>
    )}
    <PreviewBar />
  </QueryClientProvider>,
);
