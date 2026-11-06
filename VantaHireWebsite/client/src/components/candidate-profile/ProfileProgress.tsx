// Setup checklist: progress bar plus icon-tile step list with separators. Adapted from
// 21st.dev "Welcome Checklist Card" (olewandowski1). Unlike the original, steps are not
// user-ticked checkboxes: status comes only from the server's missingFields.
import { BadgeCheck, Check, SlidersHorizontal, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { ProfileRead } from "@/lib/candidate-profile-api";

export type Step = { key: string; label: string; detail: string; done: boolean };
const ICONS: Record<string, LucideIcon> = { details: UserRound, skills: Wrench, preferences: SlidersHorizontal, confirm: BadgeCheck };

const DETAIL_FIELDS = ["profile", "displayName", "headline", "currentLocation"];

export function profileSteps(profile: ProfileRead): Step[] {
  const missing = profile.missingFields ?? [];
  const has = (prefix: string) => missing.some(m => m === prefix || m.startsWith(`${prefix}.`));
  const confirmed = profile.state === "confirmed" || (profile.profileVersion ?? 0) > 0;
  return [
    { key: "details", label: "Professional details", detail: "Name, headline and where you're based", done: !DETAIL_FIELDS.some(has) && !!(profile.draft ?? profile.confirmedProfile) },
    { key: "skills", label: "Skills", detail: "At least one skill", done: !has("skills") && ((profile.draft ?? profile.confirmedProfile)?.skills.length ?? 0) > 0 },
    { key: "preferences", label: "Job preferences", detail: "The roles and work you want", done: !has("preferences") && !has("desiredRoles") && !!profile.preferences },
    { key: "confirm", label: "Confirm", detail: "Review and confirm your profile", done: confirmed && missing.length === 0 },
  ];
}

export function ProfileProgress({ steps }: { steps: Step[] }) {
  const done = steps.filter(s => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <section aria-labelledby="progress-heading" className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="progress-heading" className="text-base font-semibold text-foreground">Your profile</h3>
        <span className="text-sm text-muted-foreground">{done} of {steps.length} done</span>
      </div>
      <Progress value={pct} aria-label={`Profile ${pct}% complete`} className="h-2 bg-muted [&>div]:bg-emerald-600 dark:[&>div]:bg-emerald-400" />
      <ol className="grid sm:grid-cols-2 sm:gap-x-6">
        {steps.map((s, n) => {
          const Icon = s.done ? Check : (ICONS[s.key] ?? Check);
          return (
              <li key={s.key} className={cn("flex items-start gap-3 py-3", n < steps.length - 1 && "border-b border-border sm:border-0")}>
                <span aria-hidden className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  s.done ? "bg-emerald-600 text-white dark:bg-emerald-500" : "bg-background text-muted-foreground ring-1 ring-border")}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium", s.done ? "text-muted-foreground" : "text-foreground")}>
                    {s.label}<span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{s.done ? "Done" : s.detail}</span>
                </span>
              </li>
          );
        })}
      </ol>
    </section>
  );
}
