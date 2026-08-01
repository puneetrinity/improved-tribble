import { useState, useEffect, useLayoutEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useSearch } from "wouter";
import { Helmet } from "react-helmet-async";
import { MapPin, Clock, Calendar, Users, FileText, Upload, Briefcase, Star, Share2, Bookmark, Sparkles, AlertTriangle, RotateCcw, History, IndianRupee, GraduationCap, ChevronRight, User, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Job, insertApplicationSchema, type UserProfile } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchWithCsrf } from "@/lib/csrf";
import { z } from "zod";
import { differenceInDays, format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_SITE_URL, generateJobPostingJsonLd, generateJobMetaDescription, getJobCanonicalUrl } from "@/lib/seoHelpers";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import { sectionLabel } from "@/lib/shared-styles";
import {
  candidateApplicationsQueryKey,
  useCandidateJobState,
} from "@/hooks/use-candidate-job-state";
import { CandidateSaveButton } from "@/components/candidate/CandidateSaveButton";
import { CandidateJobStatusBadge } from "@/components/candidate/CandidateJobStatusBadge";
import { candidatePrivateQueryKey } from "@/lib/candidate-query-keys";

// Types for audit log
interface AuditLogEntry {
  id: number;
  action: string;
  changes: Record<string, unknown> | null;
  performedBy: { firstName: string; lastName: string; username: string } | null;
  createdAt: string;
}

type CandidateProfileResponse = {
  profile: Pick<UserProfile, "displayName" | "phone">;
};

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function createEmptyApplicationForm() {
  return {
    name: "",
    email: "",
    phone: "",
    coverLetter: "",
    whatsappConsent: true,
  };
}

const titleCase = (t: string) =>
  t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));

const normalizePhoneNumber = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
};

const emptyStateCls = "flex flex-col items-center justify-center min-h-[60vh] text-center py-[60px] px-5 gap-3 [&>svg]:w-12 [&>svg]:h-12 [&>svg]:text-e-text3 [&>svg]:mb-2";
const btnApplyCls = "bg-e-blue text-white border-none py-3 px-8 rounded-xl font-ui text-[0.875rem] font-medium cursor-pointer transition-all duration-200 whitespace-nowrap hover:brightness-110 hover:shadow-[0_10px_36px_rgba(75,142,240,0.28)] disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondaryCls = "flex items-center gap-1.5 bg-transparent border border-white/10 text-e-text2 py-2 px-4 rounded-xl font-ui text-[0.82rem] font-normal cursor-pointer transition-all duration-200 whitespace-nowrap [&>svg]:w-3.5 [&>svg]:h-3.5 hover:border-white/20 hover:text-e-text hover:bg-white/[0.03] max-md:flex-1 max-md:justify-center";
const cardCls = "rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.03)_100%)] mb-4 overflow-hidden shadow-[0_12px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl";
const cardHeaderCls = "flex items-center gap-2.5 py-4 px-5 border-b border-white/8 font-display text-base font-medium text-e-text [&>svg]:w-[18px] [&>svg]:h-[18px] [&>svg]:text-e-blue [&>svg]:shrink-0";
const cardBodyCls = "p-5 max-md:p-4";
const sidebarCardCls = "rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.03)_100%)] p-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl";
const sidebarItemCls = "flex items-start gap-3 [&>svg]:w-4 [&>svg]:h-4 [&>svg]:text-e-blue [&>svg]:shrink-0 [&>svg]:mt-0.5";
const metaItemCls = "flex items-center gap-[5px] text-[0.82rem] text-e-text3 [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0";
const formInputCls = "bg-white/[0.04] border border-white/10 rounded-xl py-2.5 px-3 font-ui text-[0.88rem] text-e-text outline-none transition-all duration-200 resize-y w-full placeholder:text-e-text3 focus:border-e-blue focus:shadow-[0_0_0_2px_rgba(75,142,240,0.22)]";
const statusBadgeBase = "inline-block py-1 px-3 rounded-full font-mono text-[0.6rem] font-medium tracking-[0.06em] uppercase whitespace-nowrap";

export default function JobDetailsPage() {
  const [match, params] = useRoute("/jobs/:id");
  const search = useSearch();
  const outreachAttributionToken = new URLSearchParams(search).get("outreach");
  const { toast } = useToast();
  const { user } = useAuth();
  const candidateJobState = useCandidateJobState();
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  const [formData, setFormData] = useState(createEmptyApplicationForm);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);

  const {
    data: candidateProfile,
    isLoading: candidateProfileLoading,
  } = useQuery<CandidateProfileResponse>({
    queryKey: candidatePrivateQueryKey(
      "/api/profile",
      candidateJobState.isVerifiedCandidate ? user!.id : null,
    ),
    queryFn: async () => {
      const response = await fetch("/api/profile", { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load your profile");
      }
      return response.json();
    },
    enabled: candidateJobState.isVerifiedCandidate,
  });

  // Support both numeric ID and slug in URL
  const jobIdOrSlug = params?.id || null;
  const applicationContextKey = `${user?.id ?? "anonymous"}:${jobIdOrSlug ?? "none"}`;

  // Extended type for job with client data for JSON-LD
  interface JobWithExtras extends Job {
    postedByName?: string;
    postedById?: number | string;
    isRecruiterProfilePublic?: boolean;
    clientName?: string | null;
    clientDomain?: string | null;
  }

  const { data: job, isLoading, error } = useQuery<JobWithExtras, Error & { status?: number; code?: string; jobInfo?: { title: string; slug: string } }>({
    queryKey: ["/api/jobs", jobIdOrSlug],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobIdOrSlug}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const err = new Error(data.error || "Failed to fetch job") as Error & { status?: number; code?: string; jobInfo?: { title: string; slug: string } };
        err.status = response.status;
        err.code = data.code;
        if (data.job) {
          err.jobInfo = { title: data.job.title, slug: data.job.slug };
        }
        throw err;
      }
      return response.json();
    },
    enabled: !!jobIdOrSlug,
    retry: (failureCount, error) => {
      if ((error as any)?.status === 410) return false;
      return failureCount < 3;
    },
  });

  const isRecruiterOrAdmin = user?.role === 'recruiter' || user?.role === 'super_admin';
  const candidateApplication = job
    ? candidateJobState.applicationByJobId.get(job.id)
    : undefined;
  const isSaved = job
    ? candidateJobState.savedJobByJobId.has(job.id)
    : false;

  useBrowserLayoutEffect(() => {
    setShowApplicationForm(false);
    setFormData(createEmptyApplicationForm());
    setResumeFile(null);
    setSelectedResumeId(null);
  }, [applicationContextKey]);

  useEffect(() => {
    if (!candidateJobState.isVerifiedCandidate) return;

    const profileName =
      candidateProfile?.profile.displayName?.trim() ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ");

    setFormData((current) => ({
      ...current,
      name: current.name || profileName,
      email: current.email || user?.username || "",
      phone: current.phone || candidateProfile?.profile.phone || "",
    }));
  }, [
    candidateJobState.isVerifiedCandidate,
    candidateProfile?.profile.displayName,
    candidateProfile?.profile.phone,
    user?.firstName,
    user?.lastName,
    user?.username,
  ]);

  useEffect(() => {
    if (!candidateJobState.isVerifiedCandidate) return;

    const selectedStillExists = candidateJobState.resumes.some(
      (resume) => resume.id === selectedResumeId,
    );
    if (!selectedStillExists) {
      setSelectedResumeId(candidateJobState.defaultResume?.id ?? null);
    }
  }, [
    candidateJobState.defaultResume?.id,
    candidateJobState.isVerifiedCandidate,
    candidateJobState.resumes,
    selectedResumeId,
  ]);

  useEffect(() => {
    if (
      new URLSearchParams(search).get("apply") !== "1" ||
      !job ||
      !candidateJobState.isVerifiedCandidate ||
      candidateJobState.applicationsQuery.isLoading ||
      candidateJobState.resumesQuery.isLoading ||
      candidateJobState.resumes.length === 0 ||
      candidateProfileLoading ||
      candidateApplication
    ) {
      return;
    }

    setShowApplicationForm(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById("hr-jd-apply-section")
        ?.scrollIntoView({ behavior: "smooth" });
    });
  }, [
    candidateApplication,
    candidateJobState.applicationsQuery.isLoading,
    candidateJobState.isVerifiedCandidate,
    candidateJobState.resumes.length,
    candidateJobState.resumesQuery.isLoading,
    candidateProfileLoading,
    job,
    search,
  ]);

  // Fetch audit log for job (recruiters/admins only)
  const { data: auditLog = [] } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/jobs", job?.id, "audit-log"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${job?.id}/audit-log`, { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!job?.id && isRecruiterOrAdmin,
  });

  // Job reactivation mutation
  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/jobs/${job?.id}/status`, { isActive: true, reason: "Reactivated from job details page" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobIdOrSlug] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job?.id, "audit-log"] });
      toast({ title: "Job reactivated", description: "The job posting is now active again." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reactivate job", description: error.message, variant: "destructive" });
    },
  });

  const isExpired = job?.expiresAt ? new Date(job.expiresAt) < new Date() : false;
  const daysUntilExpiry = job?.expiresAt ? differenceInDays(new Date(job.expiresAt), new Date()) : null;
  const showExpiryWarning = daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 7;

  const applicationMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetchWithCsrf(`/api/jobs/${job?.id}/apply`, {
        method: "POST",
        body: data,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to submit application");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Application submitted successfully", description: "We'll review your application and get back to you soon." });
      queryClient.invalidateQueries({
        queryKey: candidateApplicationsQueryKey,
      });
      setShowApplicationForm(false);
      setFormData((current) => ({
        name: candidateJobState.isVerifiedCandidate ? current.name : "",
        email: candidateJobState.isVerifiedCandidate ? current.email : "",
        phone: candidateJobState.isVerifiedCandidate ? current.phone : "",
        coverLetter: "",
        whatsappConsent: true,
      }));
      setResumeFile(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit application", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (candidateApplication) {
      toast({
        title: "Already applied",
        description: "Your application for this role is already in progress.",
      });
      return;
    }

    if (candidateJobState.isVerifiedCandidate && !selectedResumeId) {
      toast({
        title: "Resume required",
        description: "Choose one of your saved resumes to continue.",
        variant: "destructive",
      });
      return;
    }

    if (!candidateJobState.isVerifiedCandidate && !resumeFile) {
      toast({ title: "Resume required", description: "Please upload your resume to continue.", variant: "destructive" });
      return;
    }

    try {
      const validatedData = insertApplicationSchema.parse({
        ...formData,
        phone: normalizePhoneNumber(formData.phone),
        jobId: job?.id!,
      });
      const formDataToSend = new FormData();
      Object.entries(validatedData).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formDataToSend.append(key, value.toString());
        }
      });
      if (candidateJobState.isVerifiedCandidate && selectedResumeId) {
        formDataToSend.append("resumeId", selectedResumeId.toString());
      } else if (resumeFile) {
        formDataToSend.append('resume', resumeFile);
      }
      if (outreachAttributionToken) {
        formDataToSend.append("outreachAttributionToken", outreachAttributionToken);
      }
      applicationMutation.mutate(formDataToSend);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({ title: "Validation error", description: error.errors[0]?.message || "Validation failed", variant: "destructive" });
      }
    }
  };

  const handleToggleSavedJob = async () => {
    if (!job) return;

    try {
      if (isSaved) {
        await candidateJobState.unsaveJob(job.id);
        toast({ title: "Removed from saved jobs" });
      } else {
        await candidateJobState.saveJob(job.id);
        toast({ title: "Job saved" });
      }
    } catch (saveError) {
      toast({
        title: isSaved ? "Could not remove saved job" : "Could not save job",
        description:
          saveError instanceof Error ? saveError.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateString: string | Date | null | undefined) => {
    if (!dateString) return 'Not set';
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    if (isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // --- Loading state ---
  if (!match || !jobIdOrSlug) {
    return (
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme">
        <HomepageNav audience={candidateJobState.isCandidate ? "candidate" : "public"} />
        <GridOverlay />
        <div className={emptyStateCls}>
          <Briefcase />
          <h2 className="font-display text-2xl font-medium text-e-text">Job Not Found</h2>
          <p className="text-sm text-e-text2 max-w-[400px]">The job you're looking for doesn't exist.</p>
          <Link href="/jobs" className="bg-e-blue text-white border-none py-2 px-[18px] rounded-xl font-ui text-[0.82rem] font-medium cursor-pointer no-underline transition-all duration-200 inline-block hover:brightness-110">Browse Jobs</Link>
        </div>
        <HomepageFooter audience={candidateJobState.isCandidate ? "candidate" : "public"} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme">
        <HomepageNav audience={candidateJobState.isCandidate ? "candidate" : "public"} />
        <GridOverlay />
        <div className={emptyStateCls}>
          <div className="w-9 h-9 border-[3px] border-white/10 border-t-e-blue rounded-full animate-hr-spin" />
          <p className="text-sm text-e-text2 max-w-[400px]">Loading job details...</p>
        </div>
        <HomepageFooter audience={candidateJobState.isCandidate ? "candidate" : "public"} />
      </div>
    );
  }

  if (error || !job) {
    const typedError = error as (Error & { status?: number; code?: string; jobInfo?: { title: string; slug: string } }) | null;
    const isExpiredOrInactive = typedError?.status === 410;

    return (
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme">
        <HomepageNav audience={candidateJobState.isCandidate ? "candidate" : "public"} />
        <GridOverlay />
        <div className={emptyStateCls}>
          {isExpiredOrInactive ? (
            <>
              <AlertTriangle style={{ color: '#F59E0B', width: 48, height: 48 }} />
              <h2 className="font-display text-2xl font-medium text-e-text">{typedError?.code === 'EXPIRED' ? 'Job Has Expired' : 'Job No Longer Available'}</h2>
              {typedError?.jobInfo?.title && (
                <p className="text-e-text3 mb-1">"{typedError.jobInfo.title}"</p>
              )}
              <p className="text-sm text-e-text2 max-w-[400px]">
                {typedError?.code === 'EXPIRED'
                  ? 'This job posting has expired and is no longer accepting applications.'
                  : 'This job is no longer active. It may have been filled or removed.'}
              </p>
              <Link href="/jobs" className="bg-e-blue text-white border-none py-2 px-[18px] rounded-xl font-ui text-[0.82rem] font-medium cursor-pointer no-underline transition-all duration-200 inline-block hover:brightness-110 mt-4">Browse Active Jobs</Link>
            </>
          ) : (
            <>
              <AlertTriangle style={{ color: '#EF4444', width: 48, height: 48 }} />
              <h2 className="font-display text-2xl font-medium text-e-text">Error</h2>
              <p className="text-sm text-e-text2 max-w-[400px]">Failed to load job details. Please try again.</p>
            </>
          )}
        </div>
        <HomepageFooter audience={candidateJobState.isCandidate ? "candidate" : "public"} />
      </div>
    );
  }

  // Generate SEO metadata and JSON-LD
  const metaDescription = generateJobMetaDescription(job);
  const canonicalUrl = getJobCanonicalUrl(job);
  const jobPostingJsonLd = generateJobPostingJsonLd(job);
  const hasServerJobPostingJsonLd = typeof document !== "undefined" &&
    !!document.querySelector('script[type="application/ld+json"][data-schema="jobposting"]');
  const shouldRenderJobPostingJsonLd = typeof document === "undefined" || !hasServerJobPostingJsonLd;

  return (
    <>
      <Helmet>
        <title>{job.title} | ealana</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={`${job.title} - ealana`} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:image" content={`${DEFAULT_SITE_URL}/og-image.jpg`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:title" content={`${job.title} - ealana`} />
        <meta name="twitter:description" content={metaDescription} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={`${DEFAULT_SITE_URL}/twitter-image.jpg`} />
        {shouldRenderJobPostingJsonLd && jobPostingJsonLd && (
          <script type="application/ld+json">{JSON.stringify(jobPostingJsonLd)}</script>
        )}
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Home", "item": DEFAULT_SITE_URL },
              { "@type": "ListItem", "position": 2, "name": "Jobs", "item": `${DEFAULT_SITE_URL}/jobs` },
              { "@type": "ListItem", "position": 3, "name": job.title, "item": canonicalUrl }
            ]
          })}
        </script>
      </Helmet>

      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme">
        <HomepageNav audience={candidateJobState.isCandidate ? "candidate" : "public"} />
        <GridOverlay />

        {/* Page wrapper */}
        <div className="pt-[60px] min-h-screen overflow-x-clip">
          <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
            <div></div>
            <div className="pl-8 pr-8 max-w-[1200px] mx-auto max-md:pl-4 max-md:pr-4">

              {/* Breadcrumb */}
              <nav
                className="flex items-center gap-2 pt-7 max-md:pt-5 text-[0.82rem] text-e-text3 [&>a]:text-e-text3 [&>a]:no-underline [&>a]:transition-colors [&>a]:duration-200 hover:[&>a]:text-e-blue [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0 [&>svg]:opacity-50"
                style={{ animation: 'hr-fade-up 0.5s ease-out both' }}
              >
                <Link href="/">Home</Link>
                <ChevronRight />
                <Link href="/jobs">Jobs</Link>
                <ChevronRight />
                <span className="text-e-text2">{titleCase(job.title)}</span>
              </nav>

              {/* Hero header */}
              <header
                className="flex justify-between items-start gap-10 pt-10 pb-9 border-b border-[rgba(255,255,255,0.08)] mb-9 max-md:flex-col max-md:gap-6 max-md:pt-7 max-md:pb-7"
                style={{ animation: 'hr-fade-up 0.6s ease-out both' }}
              >
                <div className="flex-1 min-w-0">
                  <div className={sectionLabel}>Job Opening</div>
                  <h1 className="font-display text-[clamp(2rem,4vw,3rem)] max-md:text-[1.7rem] font-medium leading-[1.08] tracking-[-0.03em] text-e-text mb-4">{titleCase(job.title)}</h1>
                  <div className="flex flex-wrap gap-[18px] mb-4">
                    <span className={metaItemCls}>
                      <MapPin /> {titleCase(job.location)}
                    </span>
                    <span className={metaItemCls}>
                      <Clock /> Posted {formatDate(job.createdAt)}
                    </span>
                    {job.postedByName && !/system|admin/i.test(job.postedByName) && (
                      <span className={metaItemCls}>
                        <User />
                        {job.postedById && job.isRecruiterProfilePublic ? (
                          <Link href={`/recruiters/${job.postedById}`} className="text-e-blue no-underline transition-colors duration-200 hover:underline">{job.postedByName}</Link>
                        ) : (
                          job.postedByName
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="inline-block py-1 px-3 rounded-full font-mono text-[0.62rem] font-medium tracking-[0.06em] uppercase bg-[rgba(75,142,240,0.12)] border border-[rgba(75,142,240,0.16)] text-e-blue whitespace-nowrap">{job.type.replace('-', ' ')}</span>
                    {isExpired && <span className={`${statusBadgeBase} bg-[rgba(239,68,68,0.12)] text-red-400`}>Expired</span>}
                    {showExpiryWarning && !isExpired && (
                      <span className={`${statusBadgeBase} bg-[rgba(245,200,66,0.12)] text-e-amber`}>
                        Expires {daysUntilExpiry === 0 ? 'today' : daysUntilExpiry === 1 ? 'tomorrow' : `in ${daysUntilExpiry} days`}
                      </span>
                    )}
                    {candidateApplication ? (
                      <CandidateJobStatusBadge application={candidateApplication} />
                    ) : null}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex flex-col gap-3 shrink-0 pt-7 max-md:pt-0 max-md:flex-row max-md:flex-wrap max-md:items-center">
                  {!isExpired && !candidateApplication && (
                    <button
                      className={btnApplyCls}
                      onClick={() => {
                        setShowApplicationForm(true);
                        document.getElementById('hr-jd-apply-section')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      disabled={
                        candidateJobState.isVerifiedCandidate &&
                        candidateJobState.applicationsQuery.isLoading
                      }
                    >
                      {candidateJobState.isVerifiedCandidate &&
                      candidateJobState.applicationsQuery.isLoading
                        ? "Checking status..."
                        : "Apply Now"}
                    </button>
                  )}
                  {isExpired && isRecruiterOrAdmin && (
                    <button
                      className="flex items-center gap-2 bg-transparent text-e-green border border-[rgba(52,209,122,0.28)] py-2.5 px-6 rounded-xl font-ui text-[0.85rem] font-medium cursor-pointer transition-all duration-200 [&>svg]:w-4 [&>svg]:h-4 hover:bg-[rgba(52,209,122,0.08)] hover:border-[rgba(52,209,122,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => reactivateMutation.mutate()}
                      disabled={reactivateMutation.isPending}
                    >
                      <RotateCcw />
                      {reactivateMutation.isPending ? "Reactivating..." : "Reactivate Job"}
                    </button>
                  )}
                  <div className="flex gap-2 max-md:w-full">
                    <button
                      className={btnSecondaryCls}
                      onClick={() => {
                        navigator.share?.({ title: job.title, url: window.location.href }).catch(() => {
                          navigator.clipboard.writeText(window.location.href);
                          toast({ title: "Link copied to clipboard" });
                        });
                      }}
                    >
                      <Share2 /> Share
                    </button>
                    {candidateJobState.isVerifiedCandidate ? (
                      <CandidateSaveButton
                        isSaved={isSaved}
                        isPending={
                          candidateJobState.savedJobsQuery.isLoading ||
                          candidateJobState.savingJobId === job.id
                        }
                        onToggle={() => void handleToggleSavedJob()}
                        showLabel
                        className="max-md:flex-1"
                      />
                    ) : !user ? (
                      <Link
                        href="/candidate-auth"
                        className={`${btnSecondaryCls} no-underline`}
                      >
                        <Bookmark /> Sign in to save
                      </Link>
                    ) : null}
                  </div>
                </div>
              </header>

              {/* Expiry warning banner */}
              {showExpiryWarning && !isExpired && (
                <div
                  className="flex items-start gap-3 py-3.5 px-[18px] border border-[rgba(245,200,66,0.25)] bg-[rgba(245,200,66,0.06)] rounded-[20px] mb-7 [&>svg]:w-[18px] [&>svg]:h-[18px] [&>svg]:text-e-amber [&>svg]:shrink-0 [&>svg]:mt-0.5"
                  style={{ animation: 'hr-fade-up 0.7s ease-out 0.1s both' }}
                >
                  <AlertTriangle />
                  <div>
                    <strong className="block text-[0.88rem] text-e-amber font-medium mb-0.5">
                      This job posting expires {daysUntilExpiry === 0 ? 'today' : daysUntilExpiry === 1 ? 'tomorrow' : `in ${daysUntilExpiry} days`}
                    </strong>
                    <span className="text-[0.78rem] text-e-text3">
                      {job.expiresAt && `Expiry date: ${format(new Date(job.expiresAt), "MMMM d, yyyy 'at' h:mm a")}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Main content grid */}
              <div
                className="grid grid-cols-[1fr_320px] gap-8 pb-20 max-lg:grid-cols-[1fr_280px] max-lg:gap-6 max-md:grid-cols-1 max-md:gap-6"
                style={{ animation: 'hr-fade-up 0.7s ease-out 0.15s both' }}
              >
                {/* Left column â€” details */}
                <main>

                  {/* Description */}
                  <section className={cardCls}>
                    <div className={cardHeaderCls}>
                      <FileText /> Job Description
                    </div>
                    <div className={cardBodyCls}>
                      <p className="text-sm leading-[1.8] text-e-text2 whitespace-pre-wrap">{job.description}</p>
                    </div>
                  </section>

                  {/* Education & Experience */}
                  {(job.educationRequirement || job.experienceYears) && (
                    <section className={cardCls}>
                      <div className={cardHeaderCls}>
                        <GraduationCap /> Requirements
                      </div>
                      <div className={cardBodyCls}>
                        <div className="flex flex-col gap-4">
                          {job.educationRequirement && (
                            <div className="flex flex-col gap-1">
                              <span className="text-[0.78rem] text-e-text3 uppercase tracking-[0.06em] font-mono">Education</span>
                              <span className="text-sm text-e-text font-medium">{job.educationRequirement}</span>
                            </div>
                          )}
                          {job.experienceYears && (
                            <div className="flex flex-col gap-1">
                              <span className="text-[0.78rem] text-e-text3 uppercase tracking-[0.06em] font-mono">Experience</span>
                              <span className="text-sm text-e-text font-medium">{job.experienceYears}+ years</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Required Skills */}
                  {job.skills && job.skills.length > 0 && (
                    <section className={cardCls}>
                      <div className={cardHeaderCls}>
                        <Star /> Required Skills
                      </div>
                      <div className={cardBodyCls}>
                        <div className="flex flex-wrap gap-2">
                          {job.skills.map((skill, index) => (
                            <span key={index} className="inline-block py-[5px] px-3.5 rounded-full text-[0.78rem] font-medium border bg-[rgba(75,142,240,0.08)] border-[rgba(75,142,240,0.2)] text-e-blue">{skill}</span>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Good to Have Skills */}
                  {job.goodToHaveSkills && job.goodToHaveSkills.length > 0 && (
                    <section className={cardCls}>
                      <div className={cardHeaderCls}>
                        <Sparkles /> Good to Have
                      </div>
                      <div className={cardBodyCls}>
                        <div className="flex flex-wrap gap-2">
                          {job.goodToHaveSkills.map((skill, index) => (
                            <span key={index} className="inline-block py-[5px] px-3.5 rounded-full text-[0.78rem] font-medium border bg-[rgba(52,209,122,0.08)] border-[rgba(52,209,122,0.2)] text-e-green">{skill}</span>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Compensation */}
                  {(job.salaryMin || job.salaryMax) && (
                    <section className={cardCls}>
                      <div className={cardHeaderCls}>
                        <IndianRupee /> Compensation
                      </div>
                      <div className={cardBodyCls}>
                        <div className="flex items-baseline gap-2">
                          <span className="font-display text-2xl font-semibold text-e-text">
                            {job.salaryMin && job.salaryMax
                              ? `Rs.${job.salaryMin.toLocaleString('en-IN')} - Rs.${job.salaryMax.toLocaleString('en-IN')}`
                              : job.salaryMin
                              ? `Rs.${job.salaryMin.toLocaleString('en-IN')}+`
                              : `Up to Rs.${job.salaryMax?.toLocaleString('en-IN')}`}
                          </span>
                          <span className="text-[0.85rem] text-e-text3">
                            {job.salaryPeriod === 'per_month' ? '/month' : '/year'}
                          </span>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Activity Log (Recruiters/Admins only) */}
                  {isRecruiterOrAdmin && auditLog.length > 0 && (
                    <section className={cardCls}>
                      <div className={cardHeaderCls}>
                        <History /> Activity Log
                      </div>
                      <div className={cardBodyCls}>
                        <div className="relative pl-5 before:content-[''] before:absolute before:left-1 before:top-0 before:bottom-0 before:w-px before:bg-[rgba(255,255,255,0.08)]">
                          {auditLog.slice(0, 10).map((entry) => (
                            <div key={entry.id} className="relative pb-4 pl-3 last:pb-0">
                              <div className="absolute -left-[19px] top-1 w-[9px] h-[9px] rounded-full bg-e-blue border-2 border-e-bg2" />
                              <div className="bg-white/[0.04] border border-white/10 rounded-xl py-3 px-3.5">
                                <div className="flex justify-between items-center gap-3 mb-1">
                                  <span className="text-[0.85rem] font-medium text-e-text capitalize">{entry.action.replace(/_/g, ' ')}</span>
                                  <span className="text-[0.72rem] text-e-text3 font-mono whitespace-nowrap">
                                    {entry.createdAt && !isNaN(new Date(entry.createdAt).getTime())
                                      ? format(new Date(entry.createdAt), "MMM d, yyyy 'at' h:mm a")
                                      : 'Unknown date'}
                                  </span>
                                </div>
                                {entry.performedBy && (
                                  <span className="text-[0.75rem] text-e-text3">by {entry.performedBy.firstName} {entry.performedBy.lastName}</span>
                                )}
                                {entry.changes && Object.keys(entry.changes).length > 0 && (
                                  <div className="flex flex-wrap gap-2 mt-2 text-[0.72rem] text-e-text3">
                                    {Object.entries(entry.changes).map(([key, value]) => (
                                      <span key={key}>{key}: {String(value)}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}
                </main>

                {/* Right column â€” sidebar */}
                <aside className="sticky top-20 self-start flex flex-col gap-4 max-md:static" id="hr-jd-apply-section">
                  {/* Job summary card */}
                  <div className={sidebarCardCls}>
                    <div className="font-display text-base font-medium text-e-text mb-4">Job Summary</div>
                    <div className="flex flex-col gap-4">
                      <div className={sidebarItemCls}>
                        <MapPin />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[0.72rem] text-e-text3 uppercase tracking-[0.06em] font-mono">Location</span>
                          <span className="text-[0.88rem] text-e-text font-medium">{job.location}</span>
                        </div>
                      </div>
                      <div className={sidebarItemCls}>
                        <Briefcase />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[0.72rem] text-e-text3 uppercase tracking-[0.06em] font-mono">Job Type</span>
                          <span className="text-[0.88rem] text-e-text font-medium capitalize">{job.type.replace('-', ' ')}</span>
                        </div>
                      </div>
                      {job.deadline && (
                        <div className={sidebarItemCls}>
                          <Calendar />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[0.72rem] text-e-text3 uppercase tracking-[0.06em] font-mono">Deadline</span>
                            <span className="text-[0.88rem] text-e-amber font-medium">{formatDate(job.deadline)}</span>
                          </div>
                        </div>
                      )}
                      <div className={sidebarItemCls}>
                        <Clock />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[0.72rem] text-e-text3 uppercase tracking-[0.06em] font-mono">Posted</span>
                          <span className="text-[0.88rem] text-e-text font-medium">{formatDate(job.createdAt)}</span>
                        </div>
                      </div>
                      {(job.salaryMin || job.salaryMax) && (
                        <div className={sidebarItemCls}>
                          <IndianRupee />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[0.72rem] text-e-text3 uppercase tracking-[0.06em] font-mono">Salary</span>
                            <span className="text-[0.88rem] text-e-text font-medium">
                              {job.salaryMin && job.salaryMax
                                ? `Rs.${job.salaryMin.toLocaleString('en-IN')} - Rs.${job.salaryMax.toLocaleString('en-IN')}`
                                : job.salaryMin
                                ? `Rs.${job.salaryMin.toLocaleString('en-IN')}+`
                                : `Up to Rs.${job.salaryMax?.toLocaleString('en-IN')}`}
                              <span className="text-e-text3 font-normal text-[0.72rem] ml-1">
                                {job.salaryPeriod === 'per_month' ? '/mo' : '/yr'}
                              </span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Apply card */}
                  {candidateApplication ? (
                    <div className={sidebarCardCls}>
                      <div className="font-display text-base font-medium text-e-text mb-3">
                        Application status
                      </div>
                      <CandidateJobStatusBadge
                        application={candidateApplication}
                        className="mb-4"
                      />
                      <p className="mb-4 text-[0.82rem] leading-[1.6] text-e-text2">
                        You have already applied for this role.
                      </p>
                      <Link
                        href="/my-dashboard"
                        className={`${btnSecondaryCls} w-full justify-center no-underline`}
                      >
                        View application
                      </Link>
                    </div>
                  ) : !showApplicationForm ? (
                    <div className={sidebarCardCls}>
                      <div className="font-display text-base font-medium text-e-text mb-4">Interested?</div>
                      <p className="text-[0.88rem] text-e-text2 leading-[1.6] mb-5">
                        Submit your application and we'll get back to you.
                      </p>
                      {!isExpired && (
                        candidateJobState.isVerifiedCandidate &&
                        !candidateJobState.resumesQuery.isLoading &&
                        candidateJobState.resumes.length === 0 ? (
                          <Link
                            href="/my-dashboard?tab=resumes"
                            className={`${btnApplyCls} block w-full text-center no-underline`}
                          >
                            Upload a resume to apply
                          </Link>
                        ) : (
                          <button
                            className={`${btnApplyCls} w-full`}
                            onClick={() => setShowApplicationForm(true)}
                            data-testid="apply-button"
                            disabled={
                              candidateJobState.isVerifiedCandidate &&
                              (candidateJobState.applicationsQuery.isLoading ||
                                candidateJobState.resumesQuery.isLoading)
                            }
                          >
                            {candidateJobState.isVerifiedCandidate &&
                            candidateJobState.applicationsQuery.isLoading
                              ? "Checking status..."
                              : candidateJobState.isVerifiedCandidate &&
                                  candidateJobState.resumesQuery.isLoading
                              ? "Loading resumes..."
                              : "Apply Now"}
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <div className={`${sidebarCardCls} p-5`}>
                      <div className="flex justify-between items-start">
                        <div className="font-display text-base font-medium text-e-text mb-4">Submit Application</div>
                        <button className="bg-transparent border-none text-e-text3 cursor-pointer p-1 transition-colors duration-200 hover:text-e-text [&>svg]:w-[18px] [&>svg]:h-[18px]" onClick={() => setShowApplicationForm(false)}>
                          <X />
                        </button>
                      </div>
                      <p className="text-[0.82rem] text-e-text3 mb-5">
                        Fill out the form below to apply for this position
                      </p>
                      <form
                        key={applicationContextKey}
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-3.5"
                      >
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="name" className="text-[0.78rem] font-medium text-e-text2">Full Name *</label>
                          <input
                            id="name"
                            className={formInputCls}
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                            placeholder="Enter your full name"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="email" className="text-[0.78rem] font-medium text-e-text2">Email *</label>
                          <input
                            id="email"
                            type="email"
                            className={formInputCls}
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            required
                            placeholder="you@example.com"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="phone" className="text-[0.78rem] font-medium text-e-text2">Phone *</label>
                          <input
                            id="phone"
                            type="tel"
                            className={formInputCls}
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            required
                            placeholder="+91 98765 43210"
                          />
                        </div>
                        {candidateJobState.isVerifiedCandidate ? (
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="resumeId" className="text-[0.78rem] font-medium text-e-text2">
                              Resume *
                            </label>
                            <select
                              id="resumeId"
                              className={`${formInputCls} cursor-pointer [color-scheme:dark]`}
                              value={selectedResumeId ?? ""}
                              onChange={(event) =>
                                setSelectedResumeId(Number(event.target.value))
                              }
                              required
                            >
                              <option value="" disabled style={{ backgroundColor: "#111326", color: "#F4F5FA" }}>
                                Choose a resume
                              </option>
                              {candidateJobState.resumes.map((resume) => (
                                <option
                                  key={resume.id}
                                  value={resume.id}
                                  style={{ backgroundColor: "#111326", color: "#F4F5FA" }}
                                >
                                  {resume.label}
                                  {resume.isDefault ? " (Default)" : ""}
                                </option>
                              ))}
                            </select>
                            <Link
                              href="/my-dashboard?tab=resumes"
                              className="text-[0.75rem] text-e-blue no-underline hover:underline"
                            >
                              Manage resumes
                            </Link>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="resume" className="text-[0.78rem] font-medium text-e-text2">Resume (PDF) *</label>
                            <div className="relative">
                              <input
                                id="resume"
                                type="file"
                                accept=".pdf,.doc,.docx"
                                className="bg-white/[0.04] border border-white/10 rounded-xl py-2.5 px-3 font-ui text-[0.82rem] text-e-text2 w-full cursor-pointer file:bg-e-blue file:text-white file:border-none file:rounded-xl file:py-1.5 file:px-4 file:mr-3 file:font-ui file:text-[0.78rem] file:font-medium file:cursor-pointer"
                                onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                                required
                              />
                              <Upload className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-e-text3 pointer-events-none" />
                            </div>
                            {resumeFile && (
                              <span className="flex items-center gap-1.5 text-[0.78rem] text-e-green mt-1 [&>svg]:w-3.5 [&>svg]:h-3.5">
                                <Check /> {resumeFile.name}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="coverLetter" className="text-[0.78rem] font-medium text-e-text2">Cover Letter</label>
                          <textarea
                            id="coverLetter"
                            className={formInputCls}
                            value={formData.coverLetter}
                            onChange={(e) => setFormData({ ...formData, coverLetter: e.target.value })}
                            placeholder="Tell us why you're perfect for this role..."
                            rows={4}
                          />
                        </div>
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            id="whatsappConsent"
                            checked={formData.whatsappConsent}
                            onChange={(e) => setFormData({ ...formData, whatsappConsent: e.target.checked })}
                            className="mt-0.5 cursor-pointer"
                            style={{ accentColor: '#7C3AED' }}
                          />
                          <label htmlFor="whatsappConsent" className="text-[0.78rem] text-e-text3 leading-[1.4] cursor-pointer">I agree to receive job updates via WhatsApp</label>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <button
                            type="submit"
                            className={`${btnApplyCls} flex-1`}
                            disabled={
                              applicationMutation.isPending ||
                              (candidateJobState.isVerifiedCandidate &&
                                !selectedResumeId)
                            }
                          >
                            {applicationMutation.isPending ? "Submitting..." : "Submit Application"}
                          </button>
                          <button
                            type="button"
                            className={btnSecondaryCls}
                            onClick={() => setShowApplicationForm(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </aside>
              </div>

            </div>
            <div></div>
          </div>
        </div>

        <HomepageFooter audience={candidateJobState.isCandidate ? "candidate" : "public"} />
      </div>
    </>
  );
}
