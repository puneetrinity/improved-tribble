// Tetris orb: a tiny Tetris board used as an inline status indicator (like Orb), so small
// waits and the big "finding jobs" board share one visual family. Built on TetrisLoader.
import { TetrisLoader } from "@/components/ui/loader-tetris";
import { cn } from "@/lib/utils";

/** One-colour boards: shades of a single brand colour instead of seven piece colours. */
const SPARK_SHADES = ["#F25C2E", "#F47A52", "#C2410C", "#F25C2E", "#E0552B", "#F68E6C", "#D9481F"] as const;

export type TetrisOrbProps = {
  /** Text read out, and shown when `pill`. */
  label: string;
  /** Show the label beside the board, in a pill. */
  pill?: boolean;
  /** "spark": coral shades (default). "pieces": the seven classic piece colours. */
  tone?: "spark" | "pieces";
  /** Cell size in px; the 6×6 board is about 6.5× this. Default 3.5. */
  cell?: number;
  /** Stop the game (the board freezes where it is), e.g. when the work is done or paused. */
  playing?: boolean;
  /** One still, part-built board (no motion), e.g. for empty states. */
  still?: boolean;
  /** Hide from screen readers when visible text beside it already says what is happening. */
  decorative?: boolean;
  className?: string;
};

export function TetrisOrb({ label, pill, tone = "spark", cell = 3.5, playing = true, still, decorative, className }: TetrisOrbProps) {
  const board = (
    <TetrisLoader columns={6} rows={6} cellSize={cell} gap={cell / 4} speed={55} playing={playing} still={!!still} label={label}
      {...(pill || decorative ? { "aria-hidden": true, role: undefined } : {})}
      {...(tone === "spark" ? { colors: SPARK_SHADES } : {})} dotClassName="bg-muted"
      flashColor="hsl(var(--foreground))" deadColor="hsl(var(--foreground) / 0.3)" />
  );
  if (!pill) return <span className={cn("inline-flex shrink-0", className)} {...(decorative ? { "aria-hidden": true } : {})}>{board}</span>;
  return (
    <span role="status" aria-label={label}
      className={cn("inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card py-1 pl-2 pr-3 text-xs text-muted-foreground shadow-sm", className)}>
      {board}<span className="whitespace-nowrap">{label}</span>
    </span>
  );
}
