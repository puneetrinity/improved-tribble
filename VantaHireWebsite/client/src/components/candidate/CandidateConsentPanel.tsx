/**
 * Wave 4C — Ealana-wide matching permission panel (candidate-controlled consent).
 *
 * Sole UI adopter of the candidate consent routes. The server owns identity, subject, verified email and
 * resume ownership; this panel only submits the explicit professional snapshot the candidate reviews here.
 *
 * Truth rules (lock §3, §6): approval is optional and unchecked by default; no resume is preselected; a 202 is
 * "pending", never an effective grant or withdrawal; the saved copy is never described as active matching.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CircleAlert, Clock, FileText, ShieldCheck, X } from "lucide-react";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient as defaultQueryClient } from "@/lib/queryClient";

export type ConsentProfile = {
  display_name: string;
  headline: string;
  location: string;
  skills: string[];
  linkedin: string | null;
};

type ConsentAction = "grant" | "withdraw";

export type ConsentStatus = {
  purpose: string;
  copy_version: number;
  copy: string;
  copy_sha256: string;
  publication_active: boolean;
  saved_message: string;
  version: number;
  desired: { action: ConsentAction; profile: ConsentProfile | null; resume_version_id: string | null; profile_sha256: string | null } | null;
  effective: { action: ConsentAction; version: number; profile: ConsentProfile | null; resume_version_id: string | null; profile_sha256: string | null } | null;
  delivery_status: string;
  error_code: string | null;
  recent_auth_required: boolean;
};

export type ConsentSource = { resume_version_id: string; content_sha256: string; captured_at: string; label: string };
type ConsentSources = { sources: ConsentSource[]; next_cursor: string | null };
type ProfileResponse = {
  user: { id: number; firstName?: string | null; lastName?: string | null };
  profile: { displayName?: string | null; skills?: string[] | null; linkedin?: string | null; location?: string | null };
};

export const CONSENT_STATUS_KEY = ["/api/candidate/consent"] as const;
export const CONSENT_SOURCES_PATH = "/api/candidate/consent/sources";
const PROFILE_KEY = ["/api/profile"] as const;
const PENDING_STATUSES = new Set(["pending", "leased", "retry_wait", "retrying", "queued"]);
const LIMITS = { display_name: 200, headline: 300, location: 200, skill: 100, skills: 100 } as const;

export function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

/** Server rule: no control characters, DEL/C1 range or lone surrogates. */
export function validScalars(value: string): boolean {
  return !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}

/** Mirrors the server rule: https, linkedin.com host, /in/<slug>, no query/credentials; normalized form. */
export function normalizeLinkedIn(value: string): string | null {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || !["linkedin.com", "www.linkedin.com"].includes(url.hostname)) return null;
    if (url.username || url.password || url.port || url.search || url.hash) return null;
    if (!/^\/in\/[a-zA-Z0-9_%.-]+\/?$/.test(url.pathname)) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

type FormState = { display_name: string; headline: string; location: string; skills: string[]; linkedin: string };
export type FrozenCommand = { action: ConsentAction; endpoint: string; body: Record<string, unknown>; requestId: string; version: number; profileSummary: string;
  /** false until the consent POST has actually been dispatched; only a dispatched command may have been committed. */
  sent: boolean };
type Notice = { tone: "info" | "error"; text: string; version?: number; replayable?: boolean };

export function validateForm(form: FormState): { profile: ConsentProfile | null; errors: string[] } {
  const errors: string[] = [];
  const display_name = normalizeText(form.display_name);
  const headline = normalizeText(form.headline);
  const location = normalizeText(form.location);
  const skills = form.skills.map(normalizeText).filter(Boolean);
  const chars = (value: string) => [...value].length;
  if (chars(display_name) < 1 || chars(display_name) > LIMITS.display_name) errors.push("Display name must be 1–200 characters.");
  if (chars(headline) > LIMITS.headline) errors.push("Headline must be at most 300 characters.");
  if (chars(location) > LIMITS.location) errors.push("Location must be at most 200 characters.");
  if (skills.length > LIMITS.skills) errors.push("At most 100 skills.");
  if (new Set(skills).size !== skills.length) errors.push("Skills must be distinct.");
  if (skills.some((skill) => chars(skill) > LIMITS.skill)) errors.push("Each skill must be at most 100 characters.");
  if (![display_name, headline, location, ...skills, form.linkedin].every(validScalars)) errors.push("Fields cannot contain control characters.");
  const linkedin = form.linkedin.trim() ? normalizeLinkedIn(form.linkedin) : null;
  if (form.linkedin.trim() && (!linkedin || chars(form.linkedin.trim()) > 2048)) errors.push("LinkedIn must be a public https://www.linkedin.com/in/… profile URL.");
  const profile: ConsentProfile = { display_name, headline, location, skills, linkedin };
  if (new TextEncoder().encode(JSON.stringify(profile)).length > 32 * 1024) errors.push("The profile is too large (32 KiB limit).");
  return { profile: errors.length ? null : profile, errors };
}

export const RETRYABLE_DELIVERY_CODES = new Set(["network", "timeout", "remote_retry", "privacy_review", "internal_error"]);

export function isOutstanding(status: ConsentStatus): boolean {
  return Boolean(status.desired) && (!status.effective || status.effective.version !== status.version
    || status.effective.action !== status.desired!.action);
}

/** Presentation derived from the persisted subject lifecycle (`delivery_status`), not from error styling. */
export function deliveryCopy(status: ConsentStatus): { tone: "pending" | "attention" | "none"; text: string; polling: boolean } {
  if (!isOutstanding(status)) return { tone: "none", text: "", polling: false };
  const what = status.desired?.action === "withdraw" ? "Withdrawal" : "Permission request";
  const v = status.version;
  const reasons: Record<string, string> = {
    identity_review_required: "your account identity needs review before this can take effect",
    account_changed: "your account details changed after this request; submit it again",
    source_missing: "the selected resume version is no longer available; choose again",
    remote_conflict: "the matching service holds a conflicting version; refresh and review",
    remote_denied: "the matching service refused this request",
    identity_mismatch: "the matching service returned a mismatched receipt",
    invalid_response: "the matching service returned an unreadable response",
    retry_exhausted: "delivery could not be completed after several attempts",
    superseded: "a newer request replaced it",
  };
  switch (status.delivery_status) {
    case "pending":
    case "none": {
      const transient = status.error_code && RETRYABLE_DELIVERY_CODES.has(status.error_code)
        ? (status.error_code === "privacy_review" ? " Temporarily unavailable, try again; delivery keeps retrying." : " A temporary delivery problem occurred; delivery keeps retrying.")
        : "";
      return { tone: "pending", polling: true, text: `${what} (version ${v}) is being delivered. It is not effective yet.${transient}` };
    }
    case "privacy_restricted":
      return { tone: "attention", polling: false, text: `${what} (version ${v}) did not take effect: your privacy settings currently restrict Ealana-wide matching.` };
    case "identity_review_required":
      return { tone: "attention", polling: false, text: `${what} (version ${v}) needs attention: your account identity needs review before this can take effect.` };
    case "failed":
      return { tone: "attention", polling: false, text: `${what} (version ${v}) needs attention: ${reasons[status.error_code ?? ""] ?? "delivery could not be completed"}.` };
    case "delivered":
      return { tone: "attention", polling: false, text: `${what} (version ${v}) was delivered but has not taken effect (${status.error_code ? reasons[status.error_code] ?? status.error_code.replaceAll("_", " ") : "superseded or unconfirmed"}).` };
    default:
      return { tone: "attention", polling: false, text: `${what} (version ${v}) has not taken effect (${String(status.delivery_status).replaceAll("_", " ")}).` };
  }
}

function shortDigest(value: string): string {
  return value.slice(0, 12);
}

/** The approved immutable version, identified from the current choices when present, otherwise by its exact id. */
export function approvedResumeLabel(resumeVersionId: string | null, sources: ConsentSource[]): string {
  if (!resumeVersionId) return "None (profile only)";
  const match = sources.find((source) => source.resume_version_id === resumeVersionId);
  if (match) return `${match.label} · submitted ${formatDate(match.captured_at)} · ${shortDigest(match.content_sha256)} · version ${resumeVersionId}`;
  return `Version ${resumeVersionId} (no longer among your current choices; the approved copy is unchanged)`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, `${url} ${response.status}`);
  return response.json() as Promise<T>;
}

export function CandidateConsentPanel(): JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient() ?? defaultQueryClient;
  const [form, setForm] = useState<FormState>({ display_name: "", headline: "", location: "", skills: [], linkedin: "" });
  const [seeded, setSeeded] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const [agree, setAgree] = useState(false);
  const [resumeChoice, setResumeChoice] = useState<string>("none");
  const [sources, setSources] = useState<ConsentSource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sourcesState, setSourcesState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pendingAction, setPendingAction] = useState<ConsentAction | null>(null);
  const [password, setPassword] = useState("");
  /** The complete approved command, frozen at "begin". Survives reauth retries and ambiguous transport/response
   *  failures so a retry replays exactly the same request (same id, expected version, copy, profile, resume). */
  const [command, setCommand] = useState<FrozenCommand | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const status = useQuery<ConsentStatus>({
    queryKey: CONSENT_STATUS_KEY,
    queryFn: () => readJson<ConsentStatus>(CONSENT_STATUS_KEY[0]),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && deliveryCopy(data).polling ? 5000 : false;
    },
  });
  const profile = useQuery<ProfileResponse>({ queryKey: PROFILE_KEY, queryFn: () => readJson<ProfileResponse>(PROFILE_KEY[0]) });

  // Seed the editable preview once from the candidate's own profile. Later profile edits never re-seed or re-approve.
  useEffect(() => {
    if (seeded || !profile.data) return;
    const { user, profile: p } = profile.data;
    const fallbackName = [user.firstName, user.lastName].filter(Boolean).join(" ");
    const skills = Array.from(new Set((p.skills ?? []).map(normalizeText).filter(Boolean))).slice(0, LIMITS.skills);
    setForm({
      display_name: normalizeText(p.displayName ?? "") || fallbackName,
      headline: "",
      location: normalizeText(p.location ?? ""),
      skills,
      linkedin: p.linkedin && normalizeLinkedIn(p.linkedin) ? normalizeLinkedIn(p.linkedin)! : "",
    });
    setSeeded(true);
  }, [profile.data, seeded]);

  const loadSources = async (after: string | null) => {
    setSourcesState("loading");
    try {
      const query = new URLSearchParams({ limit: "25", ...(after ? { after } : {}) });
      const page = await readJson<ConsentSources>(`${CONSENT_SOURCES_PATH}?${query.toString()}`);
      setSources((current) => (after ? [...current, ...page.sources] : page.sources));
      setNextCursor(page.next_cursor);
      setSourcesState("ready");
    } catch {
      setSourcesState("error");
    }
  };

  useEffect(() => {
    if (status.data && sourcesState === "idle") void loadSources(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, sourcesState]);

  const validation = useMemo(() => validateForm(form), [form]);

  // Reconcile an optimistic notice with persisted truth: once the server shows that version settled (effective or
  // terminal), the notice no longer speaks for it — the effective summary and delivery state do.
  useEffect(() => {
    const data = status.data;
    if (!data || !notice?.version) return;
    const settled = (data.effective?.version ?? 0) >= notice.version || (!isOutstanding(data) && data.version >= notice.version)
      || (data.version >= notice.version && data.delivery_status !== "pending" && data.delivery_status !== "none");
    if (settled) setNotice(null);
  }, [status.data, notice]);
  const delivery = status.data ? deliveryCopy(status.data) : { tone: "none" as const, text: "" };
  const activeGrant = status.data?.effective?.action === "grant" ? status.data.effective : null;
  const canWithdraw = Boolean(activeGrant) || status.data?.desired?.action === "grant";
  const busy = pendingAction !== null;

  const submit = useMutation({
    mutationFn: async (): Promise<{ status: number; body: ConsentStatus & { code: string; replayed: boolean }; sent: FrozenCommand }> => {
      if (!command) throw new Error("candidate_consent_action_required");
      await apiRequest("POST", "/api/candidate/privacy/reauth", { password });
      // From here the server may commit even if we never see the response: the command is now "sent".
      setCommand((current) => (current ? { ...current, sent: true } : current));
      const response = await apiRequest("POST", command.endpoint, command.body);
      return { status: response.status, body: await response.json(), sent: command };
    },
    onSuccess: async ({ status: httpStatus, body, sent }) => {
      await queryClient.invalidateQueries({ queryKey: CONSENT_STATUS_KEY });
      const complete = httpStatus === 200;
      const replayed = body.replayed ? " (the earlier request was found and reused)" : "";
      if (sent.action === "grant") {
        setNotice({ tone: "info", version: sent.version, text: complete ? body.saved_message + replayed : `Permission request (version ${sent.version}) saved locally${replayed}. Delivery is pending; it is not effective yet.` });
        toast({ title: complete ? "Permission saved" : "Permission pending", description: complete ? body.saved_message : "Delivery is still in progress." });
        setAgree(false);
      } else {
        setNotice({ tone: "info", version: sent.version, text: complete ? `Permission withdrawn${replayed}.` : `Withdrawal (version ${sent.version}) pending${replayed}. It is not effective until confirmed.` });
        toast({ title: complete ? "Permission withdrawn" : "Withdrawal pending", description: complete ? "Ealana-wide matching from your approved copy is withdrawn." : "Delivery is still in progress." });
      }
      setCommand(null);
      setPendingAction(null);
      setPassword("");
    },
    onError: async (error: unknown) => {
      const code = error instanceof ApiError ? error.status : 0;
      if (code === 403) {
        // Reauth failed: keep the dialog open and the frozen command untouched.
        setNotice({ tone: "error", text: "Password check did not complete. Confirm your password again; the same request is reused exactly." });
        return;
      }
      setPendingAction(null);
      setPassword("");
      if (code === 409) {
        setCommand(null);
        await queryClient.invalidateQueries({ queryKey: CONSENT_STATUS_KEY });
        setNotice({ tone: "error", text: "Your permission state changed elsewhere. Review the latest state below and try again; your edits are kept." });
      } else if (code === 451) {
        setCommand(null);
        setNotice({ tone: "error", text: "Your privacy settings currently restrict Ealana-wide matching. Review them in the privacy controls below; no permission was saved." });
      } else if (code === 404) {
        setCommand(null);
        setNotice({ tone: "error", text: "The selected resume version is no longer available. Choose again." });
        setResumeChoice("none");
        void loadSources(null);
      } else if (code === 400) {
        setCommand(null);
        setNotice({ tone: "error", text: "Some fields could not be accepted. Check the values and try again." });
      } else if (code === 503) {
        // Definitive refusal before any write (privacy authority unavailable/stale). Retrying the same request is safe.
        setNotice({ tone: "error", replayable: true, text: "Temporarily unavailable, try again" });
      } else {
        // Ambiguous: no usable response (network, timeout, 5xx). The server may have committed the request.
        // Keep the exact command; "Retry" replays it and the server returns the earlier result if it exists.
        await queryClient.invalidateQueries({ queryKey: CONSENT_STATUS_KEY });
        setNotice({ tone: "error", replayable: true, text: "The response was lost. Your request may have been saved; use Retry to resend the same request safely, or Refresh status." });
      }
    },
  });

  /** Freeze the complete command now; a later Save with the same unresolved command replays it instead of re-keying. */
  const begin = (action: ConsentAction) => {
    if (!status.data) return;
    setNotice(null);
    if (command?.sent) {
      // A possibly-committed request is retained: only its exact replay (or an explicit Discard) is offered.
      if (command.action !== action) return;
      setPendingAction(action); setPassword(""); return;
    }
    const requestId = crypto.randomUUID();
    const body = action === "grant"
      ? {
        request_id: requestId, expected_version: status.data.version, purpose: status.data.purpose,
        copy_version: status.data.copy_version, copy_sha256: status.data.copy_sha256,
        profile: validation.profile, resume_version_id: resumeChoice === "none" ? null : resumeChoice,
      }
      : { request_id: requestId, expected_version: status.data.version };
    setCommand({ action, requestId, version: status.data.version + 1, body, sent: false,
      endpoint: action === "grant" ? "/api/candidate/consent/grant" : "/api/candidate/consent/withdraw",
      profileSummary: action === "grant" && validation.profile ? validation.profile.display_name : "" });
    setPendingAction(action);
    setPassword("");
  };

  /** Cancel / Escape / dismiss: a never-sent command is dropped so the next approval freezes the edited draft;
   *  a sent command is kept (it may have been committed) and stays reachable through the retained-request card. */
  const closeDialog = () => {
    if (submit.isPending) return;
    setPendingAction(null);
    setPassword("");
    if (command && !command.sent) setCommand(null);
  };

  const discardCommand = () => { setCommand(null); setNotice(null); };

  const addSkill = () => {
    const skill = normalizeText(newSkill);
    if (!skill || form.skills.includes(skill) || form.skills.length >= LIMITS.skills) return;
    setForm({ ...form, skills: [...form.skills, skill] });
    setNewSkill("");
  };

  if (status.isLoading) {
    return (
      <Card data-testid="candidate-consent-panel">
        <CardContent className="space-y-3 py-8" aria-busy="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </CardContent>
      </Card>
    );
  }
  if (status.isError || !status.data) {
    return (
      <Alert variant="destructive" data-testid="candidate-consent-panel">
        <AlertDescription>Matching permission controls are temporarily unavailable. No permission was changed.</AlertDescription>
      </Alert>
    );
  }
  const data = status.data;

  return (
    <div className="space-y-6" data-testid="candidate-consent-panel">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" aria-hidden="true" />Ealana-wide matching permission</CardTitle>
          <CardDescription>
            Optional. Approve a specific professional profile, and optionally one resume you submitted, for matching across organizations.
            This is separate from your applications; each stays with the organization you applied to.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div role="status" aria-live="polite" className="space-y-3">
            {activeGrant ? (
              <div className="rounded-md border p-3" data-testid="consent-effective">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary"><BadgeCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Permission active · version {activeGrant.version}</Badge>
                  {activeGrant.resume_version_id ? <Badge variant="outline"><FileText className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Resume attached</Badge> : <Badge variant="outline">Profile only</Badge>}
                </div>
                {activeGrant.profile && (
                  <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2" data-testid="consent-approved-snapshot">
                    <div><dt className="text-muted-foreground">Approved name</dt><dd className="break-words">{activeGrant.profile.display_name}</dd></div>
                    <div><dt className="text-muted-foreground">Headline</dt><dd className="break-words">{activeGrant.profile.headline || "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Location</dt><dd className="break-words">{activeGrant.profile.location || "—"}</dd></div>
                    <div><dt className="text-muted-foreground">LinkedIn</dt><dd className="break-all">{activeGrant.profile.linkedin ?? "—"}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Skills</dt><dd className="break-words">{activeGrant.profile.skills.length ? activeGrant.profile.skills.join(", ") : "—"}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Approved resume version</dt>
                      <dd className="break-all" data-testid="consent-approved-resume">{approvedResumeLabel(activeGrant.resume_version_id, sources)}</dd></div>
                  </dl>
                )}
                {!data.publication_active && <p className="mt-2 text-sm text-muted-foreground">{data.saved_message}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="consent-none">No Ealana-wide matching permission is active.</p>
            )}
            {delivery.tone !== "none" && (
              <Alert variant={delivery.tone === "attention" ? "destructive" : "default"} data-testid="consent-delivery">
                {delivery.tone === "attention" ? <CircleAlert className="h-4 w-4" aria-hidden="true" /> : <Clock className="h-4 w-4" aria-hidden="true" />}
                <AlertTitle>{delivery.tone === "attention" ? "Needs attention" : "Pending"}</AlertTitle>
                <AlertDescription>{delivery.text}</AlertDescription>
              </Alert>
            )}
            {notice && (
              <Alert variant={notice.tone === "error" ? "destructive" : "default"} data-testid="consent-notice">
                <AlertDescription>{notice.text}</AlertDescription>
              </Alert>
            )}
            {command?.sent && (
              <div className="rounded-md border border-dashed p-3" data-testid="consent-retained">
                <p className="text-sm font-medium">A {command.action === "withdraw" ? "withdrawal" : "permission"} request (version {command.version}) was sent but its outcome is unconfirmed.</p>
                {command.action === "grant" && (
                  <p className="mt-1 text-sm text-muted-foreground" data-testid="consent-retained-summary">
                    Frozen content: {String((command.body.profile as ConsentProfile).display_name)}
                    {(command.body.profile as ConsentProfile).headline ? ` · ${(command.body.profile as ConsentProfile).headline}` : ""}
                    {command.body.resume_version_id ? " · with the selected resume" : " · profile only"}. Edits to the draft below are not part of it.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" className="min-h-11" onClick={() => { setNotice(null); setPendingAction(command.action); setPassword(""); }} data-testid="consent-retry">Retry the same request</Button>
                  <Button size="sm" variant="outline" className="min-h-11" onClick={discardCommand} data-testid="consent-discard">Discard it</Button>
                </div>
              </div>
            )}
          </div>

          <fieldset className="min-w-0 space-y-3" disabled={busy}>
            <legend className="text-sm font-medium">Professional profile to approve</legend>
            <p className="text-sm text-muted-foreground">Review and edit before approving. Only what is shown here is approved; later profile edits do not change it.</p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="consent-display-name">Display name</Label>
                <Input id="consent-display-name" maxLength={LIMITS.display_name} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="consent-headline">Headline</Label>
                <Input id="consent-headline" maxLength={LIMITS.headline} value={form.headline} onChange={(event) => setForm({ ...form, headline: event.target.value })} />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="consent-location">Location</Label>
                <Input id="consent-location" maxLength={LIMITS.location} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="consent-linkedin">LinkedIn profile URL (optional)</Label>
                <Input id="consent-linkedin" inputMode="url" placeholder="https://www.linkedin.com/in/…" value={form.linkedin} onChange={(event) => setForm({ ...form, linkedin: event.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="consent-skill">Skills</Label>
              <ul className="flex max-w-full list-none flex-wrap gap-2 p-0" data-testid="consent-skills">
                {form.skills.map((skill) => (
                  <li key={skill} className="flex max-w-full min-h-11 items-center gap-1 rounded-md border bg-secondary pl-3 text-sm text-secondary-foreground">
                    <span className="min-w-0 break-all py-2">{skill}</span>
                    <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove skill ${skill}`} onClick={() => setForm({ ...form, skills: form.skills.filter((s) => s !== skill) })}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {form.skills.length === 0 && <li className="text-sm text-muted-foreground">No skills listed. Leaving this empty is fine.</li>}
              </ul>
              <div className="flex gap-2">
                <Input id="consent-skill" maxLength={LIMITS.skill} value={newSkill} placeholder="Add a skill" onChange={(event) => setNewSkill(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSkill(); } }} />
                <Button type="button" variant="outline" className="min-h-11" onClick={addSkill} disabled={!newSkill.trim()}>Add</Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Resume to include (optional)</Label>
              <RadioGroup value={resumeChoice} onValueChange={setResumeChoice} aria-label="Resume to include" data-testid="consent-resume-choice">
                <div className="flex min-h-11 items-center gap-2">
                  <RadioGroupItem value="none" id="consent-resume-none" />
                  <Label htmlFor="consent-resume-none" className="font-normal">Profile only, no resume</Label>
                </div>
                {sources.map((source) => (
                  <div key={source.resume_version_id} className="flex min-h-11 items-center gap-2">
                    <RadioGroupItem value={source.resume_version_id} id={`consent-resume-${source.resume_version_id}`} />
                    <Label htmlFor={`consent-resume-${source.resume_version_id}`} className="font-normal">
                      {source.label} · submitted {formatDate(source.captured_at)} · <span className="font-mono text-xs">{shortDigest(source.content_sha256)}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              {sourcesState === "ready" && sources.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="consent-no-sources">
                  No submitted resume can be attached yet. Profile-only permission is available; you do not need to apply to a job to opt in.
                </p>
              )}
              {sourcesState === "error" && <p className="text-sm text-destructive">Submitted resumes could not be listed right now. Profile-only permission remains available.</p>}
              {nextCursor && <Button type="button" variant="ghost" className="min-h-11" onClick={() => loadSources(nextCursor)} disabled={sourcesState === "loading"}>Load more resumes</Button>}
            </div>

            <div className="rounded-md border p-3">
              <p className="break-words text-sm" data-testid="consent-copy">{data.copy}</p>
              <div className="mt-3 flex min-h-11 items-start gap-2">
                <Checkbox id="consent-agree" checked={agree} onCheckedChange={(checked) => setAgree(checked === true)} className="mt-1" />
                <Label htmlFor="consent-agree" className="font-normal leading-snug">I approve this profile{resumeChoice !== "none" ? " and the selected resume" : ""} for Ealana-wide matching.</Label>
              </div>
            </div>
            {validation.errors.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-destructive" role="alert" data-testid="consent-validation">
                {validation.errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={(!command?.sent && (!agree || !validation.profile)) || (command?.sent === true && command.action !== "grant") || busy || submit.isPending} onClick={() => begin("grant")} data-testid="consent-grant">
              {command?.sent && command.action === "grant" ? "Retry saved request" : activeGrant ? "Save new version" : "Save permission"}
            </Button>
            {canWithdraw && (
              <Button variant="outline" className="min-h-11" disabled={busy || submit.isPending || (command?.sent === true && command.action !== "withdraw")} onClick={() => begin("withdraw")} data-testid="consent-withdraw">
                {command?.sent && command.action === "withdraw" ? "Retry withdrawal" : "Withdraw permission"}
              </Button>
            )}
            <Button variant="ghost" className="min-h-11" disabled={status.isFetching} onClick={() => status.refetch()} data-testid="consent-refresh">Refresh status</Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Withdrawing this permission does not remove your applications or their resumes from the organizations you applied to.
            To stop all global matching, use the privacy controls below or see the <Link href="/privacy-policy" className="underline">privacy policy</Link>.
          </p>
        </CardContent>
      </Card>

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingAction === "withdraw" ? "Confirm withdrawal with your password" : "Confirm permission with your password"}</DialogTitle>
            <DialogDescription>
              {command?.sent ? "This resends the retained request exactly as first sent; the server returns the earlier result if it was already saved. " : ""}
              {pendingAction === "withdraw"
                ? "Withdrawal takes effect when it is confirmed by the matching service; until then it is shown as pending."
                : "This recent-authentication check protects this permission. Your password is not stored with it."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="consent-password">Password</Label>
            <Input id="consent-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" disabled={submit.isPending} onClick={closeDialog}>Cancel</Button>
            <Button className="min-h-11" disabled={!password || submit.isPending} onClick={() => submit.mutate()} data-testid="consent-confirm">
              {submit.isPending ? "Saving…" : pendingAction === "withdraw" ? "Confirm withdrawal" : "Confirm permission"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
