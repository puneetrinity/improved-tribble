// "Finding jobs for you": the wait after a candidate confirms their profile, while matching runs.
// The Tetris loader (21st.dev) gives the wait something to watch; the steps say what is really
// happening. Every outcome has its own state: searching, slow, found, none, error.
import { Check, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TetrisLoader } from "@/components/ui/loader-tetris";
import { cn } from "@/lib/utils";
import { useOnline } from "./SparkStates";

export type FindingJobsState =
  | { kind: "searching"; step: 1 | 2 | 3 }
  | { kind: "slow" }
  | { kind: "found"; count: number }
  | { kind: "none" }
  | { kind: "error" };

const STEPS = ["Your profile is saved", "Searching open roles", "Ranking the best fits for you"] as const;

/** Flow stores theme colours as HSL numbers, so the loader's flash and game-over colours are given explicitly. */
const LOADER_COLOURS = { flashColor: "hsl(var(--foreground))", deadColor: "hsl(var(--foreground) / 0.35)" };

export function FindingJobs({ state, onViewJobs, onRetry, onEditPreferences }: {
  state: FindingJobsState; onViewJobs: () => void; onRetry: () => void; onEditPreferences: () => void;
}) {
  const busy = state.kind === "searching" || state.kind === "slow";
  // Offline: the board pauses where it is and says so; it carries on when the connection is back.
  const online = useOnline();
  const step = state.kind === "searching" ? state.step : state.kind === "slow" ? 2 : 4;
  return (
    <section aria-labelledby="finding-title" className="mx-auto w-full max-w-xl">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:flex-row sm:items-start sm:p-8 sm:text-left">
        <div className="shrink-0 rounded-xl bg-spark-soft p-3">
          <TetrisLoader columns={8} rows={16} cellSize={7} gap={2} playing={busy && online} label={busy ? "Finding jobs for you" : "Search finished"}
            dotClassName="bg-background" {...LOADER_COLOURS} />
        </div>
        <div className="min-w-0 flex-1 space-y-4" aria-live="polite">
          <div className="space-y-1.5">
            <h2 id="finding-title" className="text-2xl font-semibold text-foreground">
              {state.kind === "found" ? `We found ${state.count} ${state.count === 1 ? "job" : "jobs"} for you`
                : state.kind === "none" ? "No matches yet"
                : state.kind === "error" ? "We couldn't finish the search"
                : "Finding jobs for you"}
            </h2>
            <p className="text-base text-muted-foreground">
              {busy && !online ? "Paused until you're back online. Your profile is saved."
                : state.kind === "searching" ? "We're checking open roles against your profile and preferences. This usually takes under a minute."
                : state.kind === "slow" ? "This is taking longer than usual. You can leave this page — your matches will be waiting in Find jobs."
                : state.kind === "found" ? "Ranked by how well each one fits your skills, experience and preferences."
                : state.kind === "none" ? "Nothing fits your preferences right now. We'll keep looking and show new matches in Find jobs."
                : "Your profile is saved. Please try again in a moment."}
            </p>
          </div>

          {(busy || state.kind === "found") && (
            <ol className="space-y-2 text-sm">
              {STEPS.map((label, i) => {
                const n = i + 1, done = n < step, current = n === step;
                return (
                  <li key={label} className={cn("flex items-center gap-2.5", done || current ? "text-foreground" : "text-muted-foreground")}>
                    <span aria-hidden className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      done ? "bg-spark text-white" : current ? "bg-spark-soft text-spark-ink" : "bg-muted text-muted-foreground")}>
                      {done ? <Check className="h-3.5 w-3.5" /> : current ? <span className="h-2 w-2 rounded-full bg-current" /> : <span className="text-xs">{n}</span>}
                    </span>
                    <span>{label}<span className="sr-only">{done ? " — done" : current ? " — in progress" : " — waiting"}</span></span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
            {state.kind === "found" && <Button type="button" className="min-h-11 cursor-pointer" onClick={onViewJobs}>See my jobs</Button>}
            {state.kind === "slow" && <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={onViewJobs}>Go to Find jobs</Button>}
            {state.kind === "none" && <>
              <Button type="button" className="min-h-11 cursor-pointer gap-1.5" onClick={onEditPreferences}><SearchX className="h-4 w-4" aria-hidden />Widen my preferences</Button>
              <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={onViewJobs}>Browse all jobs</Button>
            </>}
            {state.kind === "error" && <>
              <Button type="button" className="min-h-11 cursor-pointer gap-1.5" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden />Try again</Button>
              <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={onViewJobs}>Browse all jobs</Button>
            </>}
          </div>
        </div>
      </div>
    </section>
  );
}
