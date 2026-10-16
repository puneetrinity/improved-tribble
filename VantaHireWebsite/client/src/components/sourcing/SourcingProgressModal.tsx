import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  ListChecks,
  Mail,
  Search,
  Sparkles,
  Terminal,
  User,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {rcProgressPresentation,type RcProgressTone,type SignalRcProgress} from '@shared/rc-skills-progress';

// RC skills-check tones. Text colours keep >=4.5:1 on their badge backgrounds; the label
// repeats the state in words so colour is never the only signal.
const RC_TONE: Record<RcProgressTone, { label: string; badge: string; bar: string }> = {
  waiting: { label: "Waiting", badge: "border-[#E3E6F0] bg-[#F1F4FA] text-[#334155]", bar: "bg-[#94A3B8]" },
  active: { label: "In progress", badge: "border-[#CFE0FB] bg-[#EAF2FE] text-[#1D4ED8]", bar: "bg-[#4B8EF0]" },
  done: { label: "Done", badge: "border-[#C8EEDA] bg-[#E7F6EE] text-[#166534]", bar: "bg-[#1FA463]" },
  attention: { label: "Needs attention", badge: "border-amber-200 bg-amber-50 text-amber-800", bar: "bg-amber-500" },
  failed: { label: "Stopped", badge: "border-red-200 bg-red-50 text-red-700", bar: "bg-[#DC2626]" },
  unknown: { label: "Status unknown", badge: "border-[#E3E6F0] bg-[#F1F4FA] text-[#334155]", bar: "bg-[#94A3B8]" },
};

// ─── Types ─────────────────────────────────────────────────────────────────
// The state contract is owned by `useSourcingProgress` and is unchanged.

export type PipelinePhase =
  | "idle"
  | "discovery"
  | "ranking"
  | "enriching"
  | "finalizing"
  | "complete"
  | "error";

export interface EnrichmentCandidateEvent {
  rank: number;
  name: string;
  linkedinUrl: string;
  foundProfile: boolean;
  foundEmail: boolean;
  foundPhone: boolean;
  status: "success" | "removed" | "replaced";
  replacedBy?: string;
}

export interface PipelineProgressState {
  phase: PipelinePhase;
  percent: number;
  message: string;
  crustdataFound?: number;
  rankingTotal?: number;
  enrichedCount: number;
  totalToEnrich: number;
  replacedCount: number;
  candidates: EnrichmentCandidateEvent[];
  devLogs: string[];
  error?: string;
  rcProgress?: SignalRcProgress;
  rcStatusUnavailable?: boolean;
}

export const INITIAL_PROGRESS: PipelineProgressState = {
  phase: "idle",
  percent: 0,
  message: "",
  enrichedCount: 0,
  totalToEnrich: 100,
  replacedCount: 0,
  candidates: [],
  devLogs: [],
};

interface SourcingProgressModalProps {
  open: boolean;
  progress: PipelineProgressState;
  onClose?: () => void;
  /** Optional: offered on the complete/error state; starts a fresh run. */
  onRunAgain?: () => void;
  /** Internal diagnostics only (super admins). Recruiters never see the event log. */
  showDevConsole?: boolean;
}

// ─── Stages ────────────────────────────────────────────────────────────────
// Each stage maps to a REAL pipeline phase. Copy describes only what the
// current sourcing loop does (market + talent-memory search → fit ranking →
// shortlist details → shortlist). No vendor names, no unshipped features.

type Stage = { phase: PipelinePhase; label: string; tip: string; icon: typeof Search };

const STAGES: Stage[] = [
  { phase: "discovery", label: "Searching the market and saved candidate profiles", tip: "Looking across the market and the candidate profiles you already have.", icon: Search },
  { phase: "ranking", label: "Scoring candidates on fit", tip: "Ranking on experience, seniority and fit for this role.", icon: Sparkles },
  { phase: "enriching", label: "Adding profile details", tip: "Filling in profile details for your top matches.", icon: Database },
  { phase: "finalizing", label: "Preparing your results", tip: "Saving your ranked results.", icon: ListChecks },
];

const ORDER: PipelinePhase[] = ["idle", "discovery", "ranking", "enriching", "finalizing", "complete"];

function stageState(stage: Stage, current: PipelinePhase): "done" | "active" | "todo" | "failed" {
  if (current === "error") {
    return "failed";
  }
  const cur = ORDER.indexOf(current);
  const mine = ORDER.indexOf(stage.phase);
  if (cur > mine) return "done";
  if (cur === mine) return "active";
  return "todo";
}

const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Presentation-only provider neutraliser. The hook's messages and dev logs are
// unchanged; the modal simply never renders a data-provider name (product rule:
// no vendor names in the UI). Applied to the live message, the error text and
// every dev-console line at render time.
const PROVIDER_TAG = /\[(CRUSTDATA|FULLENRICH|ENRICHLAYER|PDL|REVERSECONTACT)\]/g;
const PROVIDER_WORD = /\b(crust\s?data|full\s?enrich|enrich\s?layer|people\s?data\s?labs|reverse\s?contact|pdl)\b/gi;

export function neutralizeProviderText(text: string): string {
  return text.replace(PROVIDER_TAG, "[PROVIDER]").replace(PROVIDER_WORD, "the market");
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function SourcingProgressModal({ open, progress, onClose, onRunAgain, showDevConsole = false }: SourcingProgressModalProps) {
  const [devOpen, setDevOpen] = useState(false);
  const devConsoleRef = useRef<HTMLDivElement>(null);
  const prevLogsLen = useRef(0);

  // Auto-scroll dev console when new logs arrive
  useEffect(() => {
    if (progress.devLogs.length !== prevLogsLen.current) {
      prevLogsLen.current = progress.devLogs.length;
      if (devConsoleRef.current && devOpen) {
        devConsoleRef.current.scrollTop = devConsoleRef.current.scrollHeight;
      }
    }
  }, [progress.devLogs.length, devOpen]);

  const isComplete = progress.phase === "complete";
  const isError = progress.phase === "error";
  const isRunning = open && !isComplete && !isError && !progress.rcProgress && !progress.rcStatusUnavailable;

  // Smooth animated percent display (tracks the REAL percent, never a fixed timer)
  const [displayPct, setDisplayPct] = useState(0);
  useEffect(() => {
    const target = Math.max(0, Math.min(100, progress.percent));
    if (displayPct === target) return;
    const diff = target - displayPct;
    const step = diff > 0 ? Math.max(0.5, diff * 0.08) : diff;
    const timer = setTimeout(() => setDisplayPct((p) => {
      const next = p + step;
      return diff > 0 ? Math.min(next, target) : Math.max(next, target);
    }), 30);
    return () => clearTimeout(timer);
  }, [displayPct, progress.percent]);

  // Real elapsed time for this run. The clock ticks only while the run is in
  // progress, holds its final value on complete/error (the modal stays open on
  // error), and resets only when a new run opens the modal.
  const [elapsed, setElapsed] = useState(0);
  const runStartedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!open) {
      runStartedAt.current = null;
      return;
    }
    if (runStartedAt.current === null) {
      runStartedAt.current = Date.now();
      setElapsed(0);
    }
    const startedAt = runStartedAt.current;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    if (!isRunning) {
      // Terminal state: record the final elapsed value once and stop the clock.
      tick();
      return;
    }
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [open, isRunning]);

  const ringOffset = RING_CIRCUMFERENCE * (1 - displayPct / 100);
  const activeStage = STAGES.find((s) => s.phase === progress.phase);
  // The live pipeline message is a log line ("[PIPELINE] … queued"); recruiters see the stage in plain words.
  const tip = activeStage?.tip ?? "Getting your search ready…";
  const errorText = neutralizeProviderText(progress.error ?? "") || "Something went wrong. You can run again.";
  const ringColor = isError ? "#DC2626" : isComplete ? "#1FA463" : "#4B8EF0";

  // Modal is closed by the hook after candidates are pre-fetched (unchanged behaviour).

  if (progress.rcProgress || progress.rcStatusUnavailable) {
    const rc = progress.rcStatusUnavailable ? undefined : progress.rcProgress;
    const {heading,message,tone}=rcProgressPresentation(rc,progress.rcStatusUnavailable);
    const toneStyle = RC_TONE[tone];
    // Counts only when work is actually sized; a queue with nothing sized yet shows no bar value.
    const sized = !!rc && rc.total > 0;
    const fill = sized ? (rc!.processed / rc!.total) * 100 : 0;
    return (
      <Dialog open={open} onOpenChange={value => { if (!value) onClose?.(); }}>
        <DialogContent
          data-sourcing-progress-modal=""
          data-rc-progress=""
          data-rc-tone={tone}
          className="w-full max-w-[440px] gap-0 overflow-hidden rounded-[14px] border-[#E3E6F0] p-0 motion-reduce:animate-none"
        >
          <div className="flex items-center justify-between gap-2 pl-[18px] pr-14 pt-[18px]">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#687182]">
              ealana · skills check
            </p>
            <Badge className={cn("text-[11px]", toneStyle.badge)}>{toneStyle.label}</Badge>
          </div>
          <div className="px-[18px] pt-3">
            <DialogTitle className="text-[17px] font-semibold leading-snug text-[#0F172A]">{heading}</DialogTitle>
            <div
              role="progressbar"
              aria-label="Skills check progress"
              aria-valuemin={0}
              aria-valuemax={sized ? rc!.total : undefined}
              aria-valuenow={sized ? rc!.processed : undefined}
              aria-valuetext={sized && rc ? `${rc.processed} of ${rc.total} profiles checked` : heading}
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E6EAF3]"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none",
                  toneStyle.bar,
                  tone === "waiting" && !sized && "w-1/3 animate-pulse motion-reduce:animate-none",
                )}
                style={sized ? { width: `${fill}%` } : undefined}
              />
            </div>
            {sized && (
              <p className="mt-2 font-mono text-[12px] tabular-nums text-[#475569]">
                {rc!.processed} of {rc!.total} profiles checked
              </p>
            )}
            <p className="mt-2 text-[14px] leading-relaxed text-[#334155]">{message}</p>
            {sized && (
              <p className="mt-1 text-[12px] leading-relaxed text-[#64748B]">
                This is how many profiles we checked, not how many have the skills you asked for.
              </p>
            )}
          </div>
          <div className="flex justify-end px-[18px] pb-[18px] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[88px] cursor-pointer rounded-[10px] border border-[#E3E6F0] bg-white px-4 text-[14px] font-medium text-[#0F172A] transition-colors duration-200 hover:bg-[#F5F7FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B8EF0] focus-visible:ring-offset-2"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={() => { if ((isComplete || isError) && onClose) onClose(); }}>
      <DialogContent
        className="w-full max-w-[440px] gap-0 overflow-hidden rounded-[14px] border-[#E3E6F0] p-0 motion-reduce:animate-none"
        onPointerDownOutside={(e) => {
          // Prevent closing mid-run
          if (!isComplete && !isError) e.preventDefault();
        }}
        aria-busy={isRunning}
        data-sourcing-progress-modal=""
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pl-[18px] pr-14 pt-[18px]">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#687182]">
            ealana · discover
          </p>
          <div className="flex items-center gap-2">
            {isComplete && (
              <Badge className="border-[#C8EEDA] bg-[#E7F6EE] text-[11px] text-[#166534]">Complete</Badge>
            )}
            {isError && (
              <Badge className="border-red-200 bg-red-50 text-[11px] text-red-700">Error</Badge>
            )}
            <span className="font-mono text-[11px] tabular-nums text-[#687182]" aria-label="Elapsed time">
              {formatElapsed(elapsed)}
            </span>
          </div>
        </div>

        {/* Ring + title */}
        <div className="flex items-center gap-4 px-[18px] pt-3">
          <div className="relative h-[104px] w-[104px] shrink-0" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(displayPct)} aria-label="Sourcing progress">
            <svg viewBox="0 0 104 104" className="h-full w-full -rotate-90">
              <circle cx="52" cy="52" r={RING_RADIUS} fill="none" stroke="#E6EAF3" strokeWidth="8" />
              <circle
                cx="52"
                cy="52"
                r={RING_RADIUS}
                fill="none"
                stroke={ringColor}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
                className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {isComplete ? (
                <Check className="h-7 w-7 text-[#1FA463]" aria-hidden="true" />
              ) : isError ? (
                <XCircle className="h-7 w-7 text-[#DC2626]" aria-hidden="true" />
              ) : (
                <span className="font-satoshi text-[22px] font-bold leading-none tabular-nums text-[#17203A]">
                  {Math.round(displayPct)}%
                </span>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <DialogTitle className="font-satoshi text-[17px] font-bold leading-tight tracking-[-0.02em] text-[#17203A]">
              {isComplete ? "Your results are ready" : isError ? "Search stopped" : "Finding your best-fit candidates"}
            </DialogTitle>
            <p className="mt-1 text-[13px] leading-snug text-[#5F6675]" aria-live="polite">
              {isError ? errorText : isComplete ? "Your ranked candidates are ready to review." : tip}
            </p>
          </div>
        </div>

        {/* Stages */}
        <ol className="mt-4 space-y-1 px-[18px]" aria-label="Sourcing stages">
          {STAGES.map((stage) => {
            const state = stageState(stage, progress.phase);
            const Icon = stage.icon;
            return (
              <li
                key={stage.phase}
                data-stage={stage.phase}
                data-state={state}
                className={cn(
                  "flex items-start gap-3 rounded-[10px] px-2.5 py-2 text-[13px] leading-snug transition-colors duration-300",
                  state === "active" && "bg-[#EBF2FE] text-[#17203A]",
                  state === "done" && "text-[#17203A]",
                  state === "todo" && "text-[#687182]",
                  state === "failed" && "text-[#687182]",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
                    state === "done" && "border-transparent bg-[#E7F6EE] text-[#1FA463]",
                    state === "active" && "border-transparent bg-[#4B8EF0] text-white",
                    (state === "todo" || state === "failed") && "border-transparent bg-[#E9ECF4] text-[#687182]",
                  )}
                  aria-hidden="true"
                >
                  {state === "done" ? <Check className="h-3.5 w-3.5" /> : <Icon className={cn("h-3.5 w-3.5", state === "active" && "motion-safe:animate-pulse")} />}
                </span>
                <span className={cn("min-w-0 flex-1 pt-1", state === "active" && "font-semibold")}>{stage.label}</span>
                {stage.phase === "enriching" && state === "active" && progress.totalToEnrich > 0 && (
                  <span className="shrink-0 pt-1 font-mono text-[11px] tabular-nums text-[#5F6675]">
                    {progress.enrichedCount}/{progress.totalToEnrich}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {/* Run facts (counts only — no vendor names) */}
        {(progress.crustdataFound != null || progress.rankingTotal != null || progress.replacedCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-[18px] font-mono text-[11px] tabular-nums text-[#5F6675]">
            {progress.crustdataFound != null && <span>{progress.crustdataFound} profiles found</span>}
            {progress.rankingTotal != null && <span>{progress.rankingTotal} ranked</span>}
            {progress.replacedCount > 0 && <span className="text-amber-700">{progress.replacedCount} replaced</span>}
          </div>
        )}

        {/* Shortlist details as they land */}
        {progress.candidates.length > 0 && (
          <div className="mx-[18px] mt-3 max-h-32 space-y-1 overflow-y-auto rounded-[10px] border border-[#EEF0F4] bg-[#FBFCFE] p-2">
            <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#687182]">
              Profile details
            </p>
            {progress.candidates.slice(-8).map((c, i) => (
              <div
                key={`${c.rank}-${i}`}
                className={cn(
                  "flex items-center gap-2 rounded px-2 py-1 text-xs",
                  c.status === "success" ? "bg-[#E7F6EE]" : c.status === "removed" ? "bg-red-50" : "bg-amber-50",
                )}
              >
                <span className="w-6 shrink-0 font-mono text-[10px] text-[#687182]">#{c.rank}</span>
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <User className={cn("h-3.5 w-3.5", c.foundProfile ? "text-[#17203A]" : "text-[#D5D9E4]")} aria-label={c.foundProfile ? "Profile found" : "Profile not found"} />
                <Mail className={cn("h-3.5 w-3.5", c.foundEmail ? "text-[#17203A]" : "text-[#D5D9E4]")} aria-label={c.foundEmail ? "Email found" : "Email not found"} />
                {c.status === "removed" && <Badge className="h-4 border-red-200 bg-red-50 py-0 text-[9px] text-red-700">Removed</Badge>}
                {c.status === "replaced" && <Badge className="h-4 border-amber-200 bg-amber-100 py-0 text-[9px] text-amber-700">New</Badge>}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className={cn("flex gap-2 px-[18px] pt-4", isComplete || isError ? "pb-[18px]" : "pb-4")}>
          {isComplete ? (
            <>
              {onRunAgain ? (
                <button
                  type="button"
                  onClick={onRunAgain}
                  className="min-h-11 flex-1 rounded-[10px] border border-[#E3E6F0] bg-white px-3 text-[13px] font-semibold text-[#17203A] transition-colors duration-200 hover:bg-[#F4F5FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B8EF0]/40"
                >
                  Run again
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 flex-1 rounded-[10px] bg-[#2B6CD4] px-3 text-[13px] font-semibold text-white transition-colors duration-200 hover:bg-[#1E5BD8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B8EF0]/40"
              >
                View your results
              </button>
            </>
          ) : isError ? (
            <>
              {onRunAgain ? (
                <button
                  type="button"
                  onClick={onRunAgain}
                  className="min-h-11 flex-1 rounded-[10px] bg-[#2B6CD4] px-3 text-[13px] font-semibold text-white transition-colors duration-200 hover:bg-[#1E5BD8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B8EF0]/40"
                >
                  Run again
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                data-modal-action="close"
                className="min-h-11 flex-1 rounded-[10px] border border-[#E3E6F0] bg-white px-3 text-[13px] font-semibold text-[#17203A] transition-colors duration-200 hover:bg-[#F4F5FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B8EF0]/40"
              >
                Close
              </button>
            </>
          ) : (
            <p className="w-full text-center text-[12px] text-[#5F6675]">This usually takes a couple of minutes. You can keep this open.</p>
          )}
        </div>

        {/* Internal event log: super admins only (showDevConsole). Collapsed by default. */}
        {showDevConsole && (
        <div className="border-t border-[#EEF0F4] px-[18px] py-2">
          <button
            type="button"
            className="flex min-h-9 items-center gap-2 text-[11px] font-semibold text-[#687182] transition-colors duration-200 hover:text-[#17203A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B8EF0]/40"
            onClick={() => setDevOpen((v) => !v)}
            aria-expanded={devOpen}
          >
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            Event log (internal)
            {devOpen ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
            <span className="font-normal tabular-nums">({progress.devLogs.length} events)</span>
          </button>
          {devOpen && (
            <div
              ref={devConsoleRef}
              role="log"
              aria-label="Dev console output"
              tabIndex={0}
              className="mt-2 h-36 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px] leading-relaxed text-green-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B8EF0]/60"
            >
              {progress.devLogs.length === 0 ? (
                <p className="text-zinc-400">Waiting for pipeline events...</p>
              ) : (
                progress.devLogs.map((rawLog, i) => {
                  const log = neutralizeProviderText(rawLog);
                  return (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    <span className="select-none text-zinc-400">[{String(i + 1).padStart(3, "0")}] </span>
                    <span
                      className={
                        log.includes("ERROR")
                          ? "text-red-400"
                          : log.includes("WARN")
                          ? "text-yellow-400"
                          : log.includes("SUCCESS")
                          ? "text-green-400"
                          : log.includes("REPLACED")
                          ? "text-amber-400"
                          : "text-green-300"
                      }
                    >
                      {log}
                    </span>
                  </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
