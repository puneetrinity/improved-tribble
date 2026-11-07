// /my-dashboard: the spark candidate portal (copied from the approved prototype journey),
// mounted on real data. Matching and recruiter discovery show as "not switched on" until the
// server says they are live; nothing here claims a capability the server hasn't reported.
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { CandidatePortal, type PortalSection, type PublicJob } from "@/components/candidate-portal/CandidatePortal";
import { CareerProfilePanel, PROFILE_QUERY_KEY } from "@/components/candidate-profile/CareerProfilePanel";
import { loadProfile, type ProfileLoad } from "@/lib/candidate-profile-api";
import { SessionEnded } from "@/components/candidate-profile/SparkStates";

const SECTIONS: PortalSection[] = ["find", "jobs", "profile", "privacy"];
const fromHash = (): PortalSection => {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return (SECTIONS as string[]).includes(h) ? (h as PortalSection) : "find";
};

type ApiJob = { id: number; title: string; company?: string | null; location?: string | null; type?: string | null; createdAt?: string | null };

export function toPublicJob(j: ApiJob): PublicJob {
  const posted = j.createdAt ? new Date(j.createdAt) : null;
  return {
    id: j.id, title: j.title, company: j.company ?? "", location: j.location ?? "",
    type: (j.type ?? "").replace(/-/g, " ").replace(/^./, c => c.toUpperCase()),
    postedAt: posted && !Number.isNaN(posted.getTime()) ? formatDistanceToNow(posted, { addSuffix: true }) : "",
  };
}

export default function CandidatePortalPage() {
  const { user, logoutMutation } = useAuth();
  const [, navigate] = useLocation();
  // Signed in earlier on this page and now not (and not by signing out): the session ended.
  const hadUser = useRef(false), signingOut = useRef(false);
  if (user) hadUser.current = true;
  const [section, setSection] = useState<PortalSection>(fromHash);
  // Shown once, right after onboarding hands over (?welcome=1), then dropped from the URL.
  const [welcome] = useState(() => new URLSearchParams(window.location.search).get("welcome") === "1");
  useEffect(() => {
    if (welcome) window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    const onHash = () => setSection(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [welcome]);
  const go = (s: PortalSection) => { setSection(s); window.history.replaceState(null, "", `#${s}`); window.scrollTo({ top: 0 }); };

  // Same query as the profile panel, so the page and panel share one read.
  const profile = useQuery<ProfileLoad>({ queryKey: PROFILE_QUERY_KEY, queryFn: () => loadProfile(), staleTime: 0, retry: false, enabled: !!user });
  const raw = profile.data?.kind === "ready" ? (profile.data.profile.spark as Record<string, unknown> | undefined) ?? profile.data.profile : undefined;
  const live = (v: unknown) => v === "ready" || v === "active";
  const matching = live((raw as any)?.matchingState) ? "ready" : "not_ready";
  const discovery = live((raw as any)?.discoveryState) ? "ready" : "not_ready";
  // Spark sign-ups have no account first name: greet them by the name on their profile instead.
  const profileName = ((raw as any)?.confirmedProfile?.displayName ?? (raw as any)?.draft?.displayName ?? "") as string;
  const greetingName = user?.firstName || profileName.trim().split(/\s+/)[0] || "there";
  // How library uploads are read. Until the profile read settles, uploads wait: a slow or failed
  // read must never send a Spark candidate's scan through the ordinary OCR (SF-R1b).
  const resumeRouting = profile.data?.kind === "ready" ? ((raw as any)?.capabilities?.canRequestResume === true ? "spark" : "ordinary")
    : profile.data?.kind === "disabled" ? "ordinary"
    : profile.isPending || profile.isFetching ? "checking" : "unavailable";

  // The server searches every open job; pages load on "Show more jobs".
  const [search, setSearch] = useState("");
  const jobs = useInfiniteQuery<{ jobs: ApiJob[]; pagination?: { page: number; total: number; totalPages: number } }>({
    queryKey: ["/api/jobs", { portal: true, search }],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ page: String(pageParam) }); if (search) qs.set("search", search);
      const r = await fetch(`/api/jobs?${qs}`); if (!r.ok) throw new Error("jobs"); return r.json();
    },
    getNextPageParam: last => last.pagination && last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
    enabled: !!user,
  });
  const publicJobs = useMemo(() => {
    const seen = new Set<number>();
    return (jobs.data?.pages ?? []).flatMap(p => p.jobs).filter(j => !seen.has(j.id) && !!seen.add(j.id)).map(toPublicJob);
  }, [jobs.data]);
  const total = jobs.data?.pages[0]?.pagination?.total ?? publicJobs.length;

  if (!user && hadUser.current && !signingOut.current) return <SessionEnded />;
  if (!user || user.role !== "candidate" || !user.emailVerified) return <Redirect to="/candidate-auth#signin" />;
  return (
    <CandidatePortal firstName={greetingName} section={section} onNavigate={go}
      discovery={discovery} matching={matching} justFinishedOnboarding={welcome}
      sparkConsent={profile.data?.kind === "ready" && !!profile.data.profile.spark}
      resumeRouting={resumeRouting} onRetryResumeRouting={() => void profile.refetch()}
      userId={user?.id}
      publicJobs={publicJobs} publicJobsState={jobs.isLoading ? "loading" : jobs.isError && !jobs.data ? "error" : "ready"} onRetryJobs={() => void jobs.refetch()}
      onSearchJobs={setSearch} publicJobsTotal={total} onLoadMoreJobs={jobs.hasNextPage ? () => void jobs.fetchNextPage() : undefined} loadingMoreJobs={jobs.isFetchingNextPage} loadMoreFailed={jobs.isFetchNextPageError} profile={<CareerProfilePanel />}
      onSignOut={() => { signingOut.current = true; logoutMutation.mutate(undefined, { onSettled: () => navigate("/candidate-auth#signin") }); }} />
  );
}
