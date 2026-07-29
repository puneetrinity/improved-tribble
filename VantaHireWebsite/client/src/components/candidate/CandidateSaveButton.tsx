import { Bookmark, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function CandidateSaveButton({
  isSaved,
  isPending,
  onToggle,
  showLabel = false,
  className = "",
}: {
  isSaved: boolean;
  isPending?: boolean;
  onToggle: () => void;
  showLabel?: boolean;
  className?: string;
}) {
  const label = isSaved ? "Remove from saved jobs" : "Save job";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={isSaved}
          disabled={isPending}
          onClick={onToggle}
          className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[0.82rem] text-e-text2 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-e-text disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Bookmark
              className={`h-3.5 w-3.5 ${isSaved ? "fill-e-blue text-e-blue" : ""}`}
              aria-hidden="true"
            />
          )}
          {showLabel ? (isSaved ? "Saved" : "Save") : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
