import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Star, MapPin, Building, Briefcase, CheckCircle2,
  Mail, Phone, Github, Twitter, Linkedin, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourcedCandidateForUI } from "@/hooks/use-sourcing";
import {
  fitDescription,
  freshnessLabel,
  locationConfidence,
} from "@/lib/sourcing-labels";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CandidateCardProps {
  candidate: SourcedCandidateForUI;
  onClick: () => void;
  onShortlist: () => void;
  isUpdating: boolean;
  displayPosition?: number;
}

// ─── Fit score badge ──────────────────────────────────────────────────────────

function FitBadge({ score }: { score: number | null }) {
  if (score == null)
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        No score
      </Badge>
    );
  const { bg, text, border } =
    score >= 75
      ? { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" }
      : score >= 50
        ? { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" }
        : { bg: "bg-rose-50", text: "text-rose-600", border: "border-rose-200" };
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-semibold tabular-nums", bg, text, border)}
    >
      {score}% &middot; {fitDescription(score)}
    </Badge>
  );
}


// ─── Freshness helpers ────────────────────────────────────────────────────────

function freshnessText(daysAgo: number | null, key: string): string | null {
  if (daysAgo == null) return null;
  const label = freshnessLabel(key);
  if (daysAgo === 0) return `${label} today`;
  return `${label} ${daysAgo}d ago`;
}

// ─── Capitalise a skill label nicely ─────────────────────────────────────────

function capSkill(s: string): string {
  return s
    .split(/[\s-]+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function CandidateCard({
  candidate,
  onClick,
  onShortlist,
  isUpdating,
  displayPosition,
}: CandidateCardProps) {
  const isShortlisted = candidate.state === "shortlisted";
  const isHidden = candidate.state === "hidden";
  const isDiscoveredPending =
    candidate.sourceType === "discovered" &&
    candidate.enrichmentStatus !== "completed" &&
    candidate.enrichmentStatus !== "enriched";

  const signals = candidate.cardSignals;
  const aiSummary = candidate.aiSummary;

  // Skill display: JD matched skills (amber) > Crustdata > fallback
  const jdMatchedSkills = ((candidate.fitBreakdown as any)?.matchedSkills as string[]) || [];
  const crustdataSkills = Array.isArray(candidate.crustdata?.skills?.professional_network_skills)
    ? (candidate.crustdata!.skills!.professional_network_skills as string[])
    : [];
  const fallbackSkills = candidate.cardSignals?.skillsTopN || [];
  const skillsToUse = jdMatchedSkills.length > 0
    ? jdMatchedSkills
    : (crustdataSkills.length > 0 ? crustdataSkills : fallbackSkills);
  const skills = skillsToUse.slice(0, 6);
  const isJdMatched = jdMatchedSkills.length > 0;

  const locConf = locationConfidence(
    candidate.locationMatchType,
    candidate.locationConfidenceNumeric,
  );

  const name = candidate.crustdata?.basic_profile?.name || "Unknown Candidate";
  const headline = candidate.crustdata?.basic_profile?.headline || null;
  const locationDisplay = candidate.crustdata?.basic_profile?.location?.full_location
    || candidate.crustdata?.basic_profile?.location?.raw || null;

  const currentRole = candidate.crustdata?.experience?.employment_details?.current?.[0];
  const pastRole = candidate.crustdata?.experience?.employment_details?.past?.[0];

  // Crustdata schema: company is .name not .company_name
  const currentTitle = candidate.crustdata?.basic_profile?.current_title
    || currentRole?.title || null;
  const company = currentRole?.name || pastRole?.name || null;
  const seniority = currentRole?.seniority_level || pastRole?.seniority_level || null;

  // Compute total relevant experience from all roles
  const allRoles = [
    ...(candidate.crustdata?.experience?.employment_details?.current || []),
    ...(candidate.crustdata?.experience?.employment_details?.past || []),
  ];
  const totalExpYears = allRoles.reduce((sum: number, r: any) => {
    const y = r.years_at_company_raw ?? 0;
    return sum + (typeof y === "number" ? y : 0);
  }, 0);
  const expYearsDisplay = totalExpYears > 0 ? `${totalExpYears} yrs` : null;

  const pictureUrl = candidate.crustdata?.professional_network?.profile_picture_permalink || candidate.crustdata?.basic_profile?.profile_picture_permalink || null;

  const initials = name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const enrichedText = freshnessText(candidate.freshness.enrichedDaysAgo, "enriched");
  const identityText = freshnessText(candidate.freshness.identityCheckDaysAgo, "identity");
  const serpText = freshnessText(candidate.searchSignals.serpDateDaysAgo, "serp");
  const freshnessLine = [enrichedText, identityText, !enrichedText ? serpText : null]
    .filter(Boolean)
    .join(" · ");


  return (
    <div
      onClick={onClick}
      className={cn(
        // Base
        "group relative rounded-xl border bg-card cursor-pointer",
        "transition-all duration-200",
        // Hover lift
        "hover:-translate-y-[1px] hover:shadow-md hover:border-primary/20",
        // States
        isHidden && "opacity-50",
        isShortlisted
          ? "border-amber-300/60 bg-gradient-to-br from-amber-50/60 to-card shadow-sm"
          : "border-border/60",
      )}
    >
      <div className="p-4 flex items-start gap-3">
        {/* ── Avatar ── */}
        <div className="shrink-0 relative">
          <Avatar
            className={cn(
              "h-14 w-14 border-2 transition-all duration-200",
              isShortlisted
                ? "border-amber-300 ring-2 ring-amber-200/60"
                : "border-border/50 group-hover:border-primary/30",
            )}
          >
            <AvatarImage
              src={pictureUrl || undefined}
              className="object-cover"
            />
            <AvatarFallback
              className={cn(
                "text-sm font-bold",
                isShortlisted
                  ? "bg-amber-100 text-amber-800"
                  : "bg-primary/8 text-primary",
              )}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          {/* rank bubble */}
          {displayPosition != null && (
            <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted border border-border text-[9px] font-bold text-muted-foreground">
              {displayPosition}
            </span>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 min-w-0 space-y-2">

          {/* Row 1: name + ready badge */}
          <div className="flex items-center gap-2 flex-wrap w-full">
            <span className="font-semibold text-lg leading-tight truncate shrink min-w-[100px] max-w-full">
              {name}
            </span>
            {candidate.engagementReady && (
              <Badge
                variant="outline"
                className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 shrink-0"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Ready
              </Badge>
            )}
          </div>

          {/* Row 2: current role @ company */}
          {(currentTitle || company) && (
            <div className="flex items-center gap-1.5 text-sm text-foreground/80 w-full min-w-0">
              {currentTitle && (
                <span className="font-medium truncate shrink min-w-0">{currentTitle}</span>
              )}
              {currentTitle && company && <span className="text-muted-foreground shrink-0">@</span>}
              {company && (
                <span className="flex items-center gap-1 text-muted-foreground truncate shrink min-w-0">
                  <Building className="h-4 w-4 shrink-0" />
                  <span className="truncate">{company}</span>
                </span>
              )}
            </div>
          )}

          {/* Row 3: seniority · exp · location */}
          <div className="flex items-center gap-x-3 gap-y-1 text-sm text-muted-foreground flex-wrap">
            {seniority && (
              <span className="inline-flex items-center gap-1 bg-primary/5 text-primary/80 border border-primary/10 rounded-full px-2.5 py-0.5 text-xs font-medium">
                <Briefcase className="h-3 w-3" />
                {seniority}
              </span>
            )}
            {expYearsDisplay && (
              <span className="text-muted-foreground">{expYearsDisplay} exp</span>
            )}
            {locationDisplay && (
              <span className="flex items-center gap-1 shrink-0">
                {locConf.dotColor && (
                  <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", locConf.dotColor)} />
                )}
                <MapPin className="h-3.5 w-3.5" />
                {locationDisplay}
              </span>
            )}
          </div>

          {/* Row 4: AI summary preview */}
          {(aiSummary?.text || signals?.summaryShort) && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-snug flex gap-1.5 pt-1">
              <Sparkles className={cn("h-4 w-4 mt-0.5 shrink-0", aiSummary?.text ? "text-violet-400" : "text-blue-400")} />
              <span>{aiSummary?.text || signals?.summaryShort}</span>
            </p>
          )}

          {/* Row 5: matched skills (green if JD-matched) + other skills */}
          {skills.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {isJdMatched && (
                <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mr-1">Matched:</span>
              )}
              {skills.map((skill) => (
                <Badge
                  key={skill}
                  variant="secondary"
                  className={cn(
                    "text-xs font-medium px-2 py-0.5",
                    isJdMatched && "bg-emerald-50 text-emerald-700 border-emerald-200 border"
                  )}
                >
                  {capSkill(skill)}
                </Badge>
              ))}
            </div>
          )}

          {/* Row 6: contact icons + freshness */}
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-border/40">
            <div className="flex items-center gap-3">
              {signals?.emailAvailable && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Mail className="h-4 w-4 text-blue-500" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {signals.email ?? "Email available"}
                  </TooltipContent>
                </Tooltip>
              )}
              {signals?.phoneAvailable && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Phone className="h-4 w-4 text-emerald-500" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {signals.phone ?? "Phone available"}
                  </TooltipContent>
                </Tooltip>
              )}
              {signals?.github && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={signals.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Github className="h-4 w-4 text-slate-600 hover:text-slate-900 transition-colors" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">GitHub</TooltipContent>
                </Tooltip>
              )}
              {signals?.twitter && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={signals.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Twitter className="h-4 w-4 text-sky-400 hover:text-sky-600 transition-colors" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">Twitter/X</TooltipContent>
                </Tooltip>
              )}
              {candidate.linkedinUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={candidate.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Linkedin className="h-4 w-4 text-[#0A66C2] hover:text-[#004182] transition-colors" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">Open LinkedIn</TooltipContent>
                </Tooltip>
              )}
            </div>

            {freshnessLine && (
              <p className="text-xs text-muted-foreground/80 uppercase tracking-tight">
                {freshnessLine}
              </p>
            )}
          </div>
        </div>

        {/* ── Shortlist button ── */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "shrink-0 h-8 w-8 rounded-lg transition-all",
            isShortlisted
              ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50"
              : "text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-50 opacity-0 group-hover:opacity-100",
          )}
          disabled={isUpdating}
          onClick={(e) => {
            e.stopPropagation();
            onShortlist();
          }}
          title={isShortlisted ? "Remove from shortlist" : "Add to shortlist"}
          aria-label={isShortlisted ? "Remove from shortlist" : "Add to shortlist"}
        >
          <Star
            className={cn(
              "h-4 w-4 transition-all",
              isShortlisted ? "fill-amber-400 text-amber-400" : "",
            )}
          />
        </Button>
      </div>
    </div>
  );
}
