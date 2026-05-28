// --- Source type ---
export function sourceLabel(sourceType: string): string {
  switch (sourceType) {
    case "pool_enriched": return "Verified Profile";
    case "pool": return "Known Profile";
    case "discovered": return "New Find";
    default: return "Candidate";
  }
}

// --- Tier ---
export function tierLabel(matchTier: string | null | undefined, displayBucket: string): string {
  if (matchTier === "best_matches") return "Top Match";
  if (matchTier === "broader_pool") return "Wider Search";
  return displayBucket === "talent_pool" ? "From Database" : "Newly Found";
}
export function tierColor(matchTier: string | null | undefined, displayBucket: string): string {
  if (matchTier === "best_matches") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (matchTier === "broader_pool") return "bg-amber-50 text-amber-700 border-amber-200";
  return displayBucket === "talent_pool"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-purple-50 text-purple-700 border-purple-200";
}

// --- Identity ---
export function identityLabel(status: string): string {
  switch (status) {
    case "verified": return "Confirmed";
    case "review": return "Needs Review";
    case "weak": return "Unconfirmed";
    default: return status;
  }
}

// --- Location confidence ---
export function locationConfidence(
  matchType: string | null | undefined,
  numericConfidence?: number | null,
): { label: string; color: string; dotColor: string; band: "high" | "medium" | "low" | "none" } {
  if (numericConfidence != null) {
    if (numericConfidence >= 0.8) return { label: "High location confidence", color: "text-green-700", dotColor: "bg-green-500", band: "high" };
    if (numericConfidence >= 0.6) return { label: "Moderate location confidence", color: "text-amber-700", dotColor: "bg-amber-500", band: "medium" };
    if (numericConfidence >= 0.3) return { label: "Low location confidence", color: "text-slate-500", dotColor: "bg-slate-400", band: "low" };
    return { label: "Location uncertain", color: "text-red-600", dotColor: "bg-red-500", band: "none" };
  }
  switch (matchType) {
    case "city_exact": return { label: "Exact city match", color: "text-green-700", dotColor: "bg-green-500", band: "high" };
    case "city_alias": return { label: "City match", color: "text-green-600", dotColor: "bg-green-400", band: "high" };
    case "country_only": return { label: "Same country", color: "text-amber-700", dotColor: "bg-amber-500", band: "medium" };
    case "unknown_location": return { label: "Location not confirmed", color: "text-slate-500", dotColor: "bg-slate-400", band: "low" };
    case "none": return { label: "Different location", color: "text-red-600", dotColor: "bg-red-500", band: "none" };
    default: return { label: "", color: "", dotColor: "", band: "none" };
  }
}

// --- locationLabel (Signal's computed label) -> recruiter text ---
export function locationLabelText(label: string | null | undefined): string | null {
  switch (label) {
    case "location_verified": return "Location verified";
    case "location_unverified_promoted": return "Promoted without location confirmation";
    case "location_unverified": return "Location not confirmed";
    case "location_mismatch": return "Different location than requested";
    case "location_unknown": return "Location unknown";
    default: return null;
  }
}

// --- Fit ---
export const FIT_LABELS: Record<string, string> = {
  skillScore: "Skills",
  seniorityScore: "Experience level",
  locationScore: "Location",
  activityFreshnessScore: "Profile freshness",
  roleScore: "Role relevance",
  experienceScore: "Years of experience",
};
export const FIT_INTERNAL_KEYS = new Set([
  "total",
  "locationBoost",
  "unknownLocationPromotion",
  "skillScoreMethod",
  "matchedSkills"
]);

export function fitDescription(scorePct: number): string {
  if (scorePct >= 75) return "Strong match";
  if (scorePct >= 60) return "Good match";
  if (scorePct >= 45) return "Moderate match";
  return "Weak match";
}

/** Normalize fit value to 0-100 percentage for display. */
export function toPctFitClient(val: number | null | undefined): number | null {
  if (val == null || !Number.isFinite(val)) return null;
  return val <= 1 ? Math.round(val * 100) : Math.round(val);
}

// --- Data confidence ---
export function confidenceLabel(confidence: string | null | undefined): string | null {
  switch (confidence) {
    case "high": return "High confidence profile";
    case "medium": return "Moderate confidence";
    case "low": return "Limited data available";
    default: return null;
  }
}

// --- Enrichment ---
export function enrichmentLabel(status: string | null | undefined): string {
  switch (status) {
    case "completed": case "enriched": return "Profile verified";
    case "pending": return "Verifying profile...";
    case "failed": case "error": return "Verification incomplete";
    default: return "Pending verification";
  }
}

// --- Freshness ---
export function freshnessLabel(key: string): string {
  switch (key) {
    case "enriched": return "Profile updated";
    case "identity": return "Identity verified";
    case "serp": return "Last seen online";
    case "snapshot": return "Analysis date";
    default: return key;
  }
}
