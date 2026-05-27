import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Terminal,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

// ─── Phase Steps ─────────────────────────────────────────────────────────────

const PHASES: { phase: PipelinePhase; label: string; startPct: number }[] = [
  { phase: "discovery", label: "Discovering", startPct: 0 },
  { phase: "ranking", label: "Ranking", startPct: 40 },
  { phase: "finalizing", label: "Saving", startPct: 90 },
  { phase: "complete", label: "Done", startPct: 100 },
];

function PhaseIcon({ phase, currentPhase, percent }: { phase: PipelinePhase; currentPhase: PipelinePhase; percent: number }) {
  const phases = PHASES.map((p) => p.phase);
  const currentIdx = phases.indexOf(currentPhase);
  const thisIdx = phases.indexOf(phase);

  if (currentPhase === "error") {
    if (thisIdx === currentIdx) return <XCircle className="h-4 w-4 text-red-500" />;
    if (thisIdx < currentIdx) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    return <Circle className="h-4 w-4 text-muted-foreground/40" />;
  }

  if (thisIdx < currentIdx) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (thisIdx === currentIdx) return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
  return <Circle className="h-4 w-4 text-muted-foreground/30" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SourcingProgressModal({ open, progress, onClose }: SourcingProgressModalProps) {
  const [devOpen, setDevOpen] = useState(true);
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

  // Smooth animated percent display
  const [displayPct, setDisplayPct] = useState(0);
  useEffect(() => {
    const target = progress.percent;
    if (displayPct === target) return;
    const diff = target - displayPct;
    const step = diff > 0 ? Math.max(0.5, diff * 0.08) : diff;
    const timer = setTimeout(() => setDisplayPct((p) => {
      const next = p + step;
      return diff > 0 ? Math.min(next, target) : Math.max(next, target);
    }), 30);
    return () => clearTimeout(timer);
  }, [displayPct, progress.percent]);

  // Modal is closed immediately by the hook (after pre-fetching candidates).
  // No auto-close timer here — avoids the flash where candidates aren't loaded yet.

  return (
    <Dialog open={open} onOpenChange={(val) => { if ((isComplete || isError) && onClose) onClose(); }}>
      <DialogContent
        className="max-w-xl w-full p-0 overflow-hidden gap-0"
        onPointerDownOutside={(e) => {
          // Prevent closing mid-run
          if (!isComplete && !isError) e.preventDefault();
        }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold tracking-tight">Finding Candidates</h2>
            {isComplete && (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                Complete
              </Badge>
            )}
            {isError && (
              <Badge variant="destructive" className="text-xs">
                Error
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{progress.message || "Initializing pipeline..."}</p>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-4 border-b space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{Math.round(displayPct)}%</span>
            {progress.phase === "enriching" && (
              <span>{progress.enrichedCount}/{progress.totalToEnrich} enriched</span>
            )}
          </div>
          <Progress
            value={displayPct}
            className={`h-2 transition-all ${isError ? "[&>div]:bg-red-500" : isComplete ? "[&>div]:bg-green-500" : ""}`}
          />

          {/* Phase steps */}
          <div className="flex items-center justify-between mt-2">
            {PHASES.map(({ phase, label }, i) => (
              <div key={phase} className="flex items-center gap-1">
                <PhaseIcon phase={phase} currentPhase={progress.phase} percent={progress.percent} />
                <span
                  className={`text-[10px] font-medium ${
                    progress.phase === phase
                      ? "text-primary"
                      : PHASES.findIndex((p) => p.phase === progress.phase) > i
                      ? "text-green-600"
                      : "text-muted-foreground/50"
                  }`}
                >
                  {label}
                </span>
                {i < PHASES.length - 1 && (
                  <div className="w-4 h-px bg-border mx-1" />
                )}
              </div>
            ))}
          </div>

          {/* Stats row */}
          {(progress.crustdataFound || progress.replacedCount > 0) && (
            <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
              {progress.crustdataFound != null && (
                <span>🧑‍💻 {progress.crustdataFound} found by Crustdata</span>
              )}
              {progress.rankingTotal != null && (
                <span>📊 {progress.rankingTotal} locally ranked</span>
              )}
              {progress.replacedCount > 0 && (
                <span className="text-amber-600">🔄 {progress.replacedCount} replaced</span>
              )}
            </div>
          )}
        </div>

        {/* Enriched Candidates List */}
        {progress.candidates.length > 0 && (
          <div className="px-6 py-3 border-b max-h-36 overflow-y-auto space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Enriched Candidates
            </p>
            {progress.candidates.slice(-8).map((c, i) => (
              <div
                key={`${c.rank}-${i}`}
                className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${
                  c.status === "success"
                    ? "bg-green-50 dark:bg-green-950/20"
                    : c.status === "removed"
                    ? "bg-red-50 dark:bg-red-950/20"
                    : "bg-amber-50 dark:bg-amber-950/20"
                }`}
              >
                <span className="font-mono text-[10px] text-muted-foreground w-6 shrink-0">
                  #{c.rank}
                </span>
                <span className="font-medium truncate flex-1">{c.name}</span>
                <span title="Profile">{c.foundProfile ? "👤" : "—"}</span>
                <span title="Email">{c.foundEmail ? "📧" : "—"}</span>
                <span title="Phone">{c.foundPhone ? "📞" : "—"}</span>
                {c.status === "removed" && (
                  <Badge variant="destructive" className="text-[9px] py-0 h-4">Removed</Badge>
                )}
                {c.status === "replaced" && (
                  <Badge className="text-[9px] py-0 h-4 bg-amber-100 text-amber-700 border-amber-200">New</Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Dev Console */}
        <div className="px-6 py-3">
          <button
            type="button"
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-2 hover:text-foreground transition-colors"
            onClick={() => setDevOpen((v) => !v)}
          >
            <Terminal className="h-3.5 w-3.5" />
            Dev Console
            {devOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span className="font-normal text-[10px]">
              ({progress.devLogs.length} events)
            </span>
          </button>

          {devOpen && (
            <div
              ref={devConsoleRef}
              className="bg-zinc-950 dark:bg-black text-green-400 font-mono text-[10px] leading-relaxed rounded-md p-3 h-44 overflow-y-auto border border-zinc-800"
            >
              {progress.devLogs.length === 0 ? (
                <p className="text-zinc-600">Waiting for pipeline events...</p>
              ) : (
                progress.devLogs.map((log, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    <span className="text-zinc-600 select-none">[{String(i + 1).padStart(3, "0")}] </span>
                    <span
                      className={
                        log.includes("❌") || log.includes("ERROR")
                          ? "text-red-400"
                          : log.includes("⚠️")
                          ? "text-yellow-400"
                          : log.includes("✅") || log.includes("SUCCESS")
                          ? "text-green-400"
                          : log.includes("🔄") || log.includes("REPLACED")
                          ? "text-amber-400"
                          : "text-green-300"
                      }
                    >
                      {log}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(isComplete || isError) && (
          <div className="px-6 pb-5 flex justify-end">
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={onClose}
            >
              {isComplete ? "View candidates →" : "Close"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
