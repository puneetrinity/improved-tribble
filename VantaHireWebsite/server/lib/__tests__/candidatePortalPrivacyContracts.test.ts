// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  candidatePrivateQueryKey,
  isUserScopedQueryPath,
} from "../../../client/src/lib/candidate-query-keys";
import { getCandidateApplicationStatus } from "../../../client/src/components/candidate/CandidateJobStatusBadge";

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("candidate account cache isolation", () => {
  it("uses different private query keys for different candidate accounts", () => {
    const candidateA = candidatePrivateQueryKey("/api/my-applications", 101);
    const candidateB = candidatePrivateQueryKey("/api/my-applications", 202);
    const anonymous = candidatePrivateQueryKey("/api/my-applications", null);

    expect(candidateA).not.toEqual(candidateB);
    expect(candidateA).not.toEqual(anonymous);
    expect(candidateB).not.toEqual(anonymous);
  });

  it("keeps per-candidate async job details in separate cache entries", () => {
    const candidateA = candidatePrivateQueryKey(
      "/api/ai/match/jobs",
      101,
      77,
    );
    const candidateB = candidatePrivateQueryKey(
      "/api/ai/match/jobs",
      202,
      77,
    );

    expect(candidateA).not.toEqual(candidateB);
    expect(candidateA).toEqual([
      "/api/ai/match/jobs",
      "candidate",
      101,
      77,
    ]);
  });

  it("classifies candidate-private cache paths without clearing public jobs", () => {
    expect(isUserScopedQueryPath("/api/my-applications")).toBe(true);
    expect(isUserScopedQueryPath("/api/candidate/saved-jobs")).toBe(true);
    expect(isUserScopedQueryPath("/api/ai/resume")).toBe(true);
    expect(isUserScopedQueryPath("/api/profile")).toBe(true);
    expect(isUserScopedQueryPath("/api/jobs")).toBe(false);
  });

  it("clears private caches on both login and logout", () => {
    const authHook = read("../../../client/src/hooks/use-auth.tsx");
    expect(authHook).toContain("function clearCacheForAuthIdentity");
    expect(authHook).toContain("clearUserScopedQueryCache();");
    expect(authHook.match(/setCachedAuthUser\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("refreshes auth identity on focus before accepting a changed user", () => {
    const authHook = read("../../../client/src/hooks/use-auth.tsx");
    const authQueryStart = authHook.indexOf(
      "useQuery<SelectUser | null, Error>",
    );
    const authQueryEnd = authHook.indexOf("useEffect(() =>", authQueryStart);
    const authQuery = authHook.slice(authQueryStart, authQueryEnd);

    expect(authQuery).toContain("staleTime: 30_000");
    expect(authQuery).toContain('refetchOnWindowFocus: "always"');
    expect(authQuery.indexOf("clearCacheForAuthIdentity(nextUser)")).toBeLessThan(
      authQuery.indexOf("return nextUser"),
    );

    const candidateState = read(
      "../../../client/src/hooks/use-candidate-job-state.ts",
    );
    expect(candidateState).toContain("refetchOnWindowFocus: false");
  });

  it("fails closed in other tabs when a session-changing auth action succeeds", () => {
    const authHook = read("../../../client/src/hooks/use-auth.tsx");
    const publisherStart = authHook.indexOf(
      "function publishCrossTabAuthIdentityChange",
    );
    const publisherEnd = authHook.indexOf(
      "function clearCacheForAuthIdentity",
      publisherStart,
    );
    const publisher = authHook.slice(publisherStart, publisherEnd);

    expect(publisher).toContain("window.localStorage.setItem(");
    expect(publisher).toContain("crossTabAuthSignalStorageKey");

    const cachedUserStart = authHook.indexOf("function setCachedAuthUser");
    const cachedUserEnd = authHook.indexOf(
      "function isPublicSsrPath",
      cachedUserStart,
    );
    expect(authHook.slice(cachedUserStart, cachedUserEnd)).toContain(
      "publishCrossTabAuthIdentityChange();",
    );

    const listenerStart = authHook.indexOf(
      "const handleCrossTabAuthIdentityChange",
    );
    const listenerEnd = authHook.indexOf("const loginMutation", listenerStart);
    const listener = authHook.slice(listenerStart, listenerEnd);

    expect(listener).toContain(
      "event.key !== crossTabAuthSignalStorageKey",
    );
    expect(listener).toContain(
      'window.addEventListener("storage", handleCrossTabAuthIdentityChange)',
    );
    expect(listener.indexOf("clearUserScopedQueryCache();")).toBeLessThan(
      listener.indexOf("queryClient.setQueryData(authQueryKey, null)"),
    );
    expect(
      listener.indexOf("queryClient.setQueryData(authQueryKey, null)"),
    ).toBeLessThan(listener.indexOf("window.location.reload();"));

    const registration = authHook.slice(
      authHook.indexOf("const registerMutation"),
      authHook.indexOf("const logoutMutation"),
    );
    expect(registration).toContain(
      "publishCrossTabAuthIdentityChange();",
    );
  });

  it("keys async fit jobs by candidate and disables anonymous queries", () => {
    const asyncFitHook = read(
      "../../../client/src/hooks/use-async-fit-scoring.tsx",
    );

    expect(asyncFitHook.match(/candidatePrivateQueryKey\(/g)).toHaveLength(2);
    expect(asyncFitHook).toContain(
      "enabled: queueEnabled && candidateId !== null",
    );
    expect(asyncFitHook).toContain(
      "enabled: candidateId !== null && activeJobId !== null",
    );
    expect(asyncFitHook).toContain("refetchOnWindowFocus: false");
    expect(asyncFitHook).toMatch(
      /useEffect\(\(\) => \{\s*setActiveJobId\(null\);\s*\}, \[candidateId\]\)/,
    );
  });
});

describe("candidate authentication response", () => {
  it("returns email verification state on both successful login paths", () => {
    const authSource = read("../../auth.ts");
    const loginRoute = authSource.slice(
      authSource.indexOf('app.post("/api/login"'),
      authSource.indexOf('app.post("/api/logout"'),
    );

    expect(loginRoute.match(/emailVerified: user\.emailVerified/g)).toHaveLength(2);
  });
});

describe("candidate application privacy boundary", () => {
  it("maps the candidate response through an explicit public allowlist", () => {
    const routeSource = read("../../applications.routes.ts");
    const viewMapper = routeSource.slice(
      routeSource.indexOf("function toCandidateApplicationView"),
      routeSource.indexOf("// Validation schemas"),
    );

    expect(viewMapper).toContain("aiFitScore: application.aiFitScore");
    expect(viewMapper).toContain("coverLetter: application.coverLetter");
    expect(viewMapper).not.toMatch(
      /stageName|stageOrder|currentStage|notes|reviewComments|resumeUrl|phone|email/,
    );
    expect(routeSource).toContain(
      "res.json(applicationsList.map(toCandidateApplicationView))",
    );
  });

  it("does not load private recruiter workflow fields for the candidate endpoint", () => {
    const storageSource = read("../../storage.ts");
    const method = storageSource.slice(
      storageSource.indexOf("async getApplicationsByUserId"),
      storageSource.indexOf("async withdrawApplication"),
    );

    expect(method).not.toMatch(
      /stageName|stageOrder|currentStage|notes|reviewComments|resumeUrl|phone:|email:/,
    );
    expect(method).not.toContain(".leftJoin(pipelineStages");
  });

  it("derives candidate-facing labels only from the public application status", () => {
    const badgeSource = read(
      "../../../client/src/components/candidate/CandidateJobStatusBadge.tsx",
    );

    expect(badgeSource).not.toContain("stageName");
    expect(badgeSource).toContain("application.status.toLowerCase()");

    expect(
      getCandidateApplicationStatus({ status: "downloaded" }).label,
    ).toBe("Resume Reviewed");
    expect(
      getCandidateApplicationStatus({ status: "internal_review_hold" }).label,
    ).toBe("Applied");

    const timelineSource = read(
      "../../../client/src/components/dashboards/CandidateTimeline.tsx",
    );
    expect(timelineSource).toContain("getCandidateApplicationStatus({");
    expect(timelineSource).not.toMatch(/stageName|currentStage/);
    expect(timelineSource).not.toMatch(/>\s*\{app\.status\}\s*</);
  });

  it("resets the application form and preserves dashboard hook order on auth changes", () => {
    const jobDetails = read(
      "../../../client/src/pages/job-details-page.tsx",
    );
    const resetStart = jobDetails.indexOf(
      "useBrowserLayoutEffect(() => {\n    setShowApplicationForm(false);",
    );
    const resetEnd = jobDetails.indexOf("useEffect(() =>", resetStart + 1);
    const resetEffect = jobDetails.slice(resetStart, resetEnd);

    expect(resetStart).toBeGreaterThan(-1);
    expect(resetEffect).toContain("setFormData(createEmptyApplicationForm())");
    expect(resetEffect).toContain("setResumeFile(null)");
    expect(resetEffect).toContain("setSelectedResumeId(null)");
    expect(resetEffect).toContain("[applicationContextKey]");
    expect(jobDetails).toContain("key={applicationContextKey}");
    expect(jobDetails).toContain(
      '`${user?.id ?? "anonymous"}:${jobIdOrSlug ?? "none"}`',
    );

    const dashboard = read(
      "../../../client/src/pages/candidate-dashboard.tsx",
    );
    const contentStart = dashboard.indexOf(
      "function CandidateDashboardContent",
    );
    const guard = dashboard.slice(
      dashboard.indexOf("export default function CandidateDashboard"),
      contentStart,
    );

    expect(contentStart).toBeGreaterThan(-1);
    expect(guard).toContain(
      "return <CandidateDashboardContent key={user.id} user={user} />",
    );
    expect(guard).not.toContain("useQuery<");
  });
});
