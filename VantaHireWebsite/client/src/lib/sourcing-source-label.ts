import { readCandidateOrigin } from "@/lib/sourcing-candidate-origin";

/** Where a search result came from. Previous applicants always win over the pool label they also carry. */
export type CandidateSourceGroup = "previous_applicant" | "from_memory" | "new";

export const SOURCE_GROUP_LABEL: Record<CandidateSourceGroup, string> = {
  previous_applicant: "Previous applicant",
  from_memory: "From memory",
  new: "New",
};

export function candidateSourceGroup(candidate: { candidateOrigin?: unknown; sourceType: string }): CandidateSourceGroup | null {
  const origin = readCandidateOrigin(candidate.candidateOrigin);
  if (origin.kind === "organization_candidate") return "previous_applicant";
  if (origin.kind !== "public_profile") return null; // malformed origin: never guess
  if (candidate.sourceType === "discovered") return "new";
  if (candidate.sourceType === "pool" || candidate.sourceType === "pool_enriched") return "from_memory";
  return null;
}

/** Mutually exclusive counts over the results the recruiter can see (hidden rows excluded). */
export function countSourceGroups(candidates: readonly { candidateOrigin?: unknown; sourceType: string; state: string }[]) {
  const counts: Record<CandidateSourceGroup, number> = { previous_applicant: 0, from_memory: 0, new: 0 };
  let total = 0;
  for (const candidate of candidates) {
    if (candidate.state === "hidden") continue;
    total++;
    const group = candidateSourceGroup(candidate);
    if (group) counts[group]++;
  }
  return { total, ...counts };
}
