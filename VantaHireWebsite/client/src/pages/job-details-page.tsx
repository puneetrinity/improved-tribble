import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { MapPin, Clock, Calendar, Users, FileText, Upload, Briefcase, Star, Share2, Bookmark, Sparkles, AlertTriangle, RotateCcw, History, IndianRupee, GraduationCap, ChevronRight, User, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Job, insertApplicationSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCsrfToken } from "@/lib/csrf";
import { z } from "zod";
import { differenceInDays, format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_SITE_URL, generateJobPostingJsonLd, generateJobMetaDescription, getJobCanonicalUrl } from "@/lib/seoHelpers";
import { useAIFeatures } from "@/hooks/use-ai-features";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import { sectionLabel } from "@/lib/shared-styles";

// Types for audit log
interface AuditLogEntry {
  id: number;
  action: string;
  changes: Record<string, unknown> | null;
  performedBy: { firstName: string; lastName: string; username: string } | null;
  createdAt: string;
}

const emptyStateCls = "flex flex-col items-center justify-center min-h-[60vh] text-center py-[60px] px-5 gap-3 [&>svg]:w-12 [&>svg]:h-12 [&>svg]:text-hr-text-muted [&>svg]:mb-2";
const btnApplyCls = "bg-hr-accent text-white border-none py-3 px-8 rounded-none font-dm text-[0.875rem] font-medium cursor-pointer transition-colors duration-200 whitespace-nowrap hover:bg-hr-accent-hover disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondaryCls = "flex items-center gap-1.5 bg-transparent border border-[rgba(255,255,255,0.08)] text-hr-text-secondary py-2 px-4 rounded-none font-dm text-[0.82rem] font-normal cursor-pointer transition-all duration-200 whitespace-nowrap [&>svg]:w-3.5 [&>svg]:h-3.5 hover:border-[rgba(255,255,255,0.12)] hover:text-hr-text max-md:flex-1 max-md:justify-center";
const cardCls = "bg-hr-bg-card border border-[rgba(255,255,255,0.08)] rounded-none mb-4 overflow-hidden";
const cardHeaderCls = "flex items-center gap-2.5 py-4 px-5 border-b border-[rgba(255,255,255,0.08)] font-satoshi text-base font-medium text-hr-text [&>svg]:w-[18px] [&>svg]:h-[18px] [&>svg]:text-hr-accent-hover [&>svg]:shrink-0";
const cardBodyCls = "p-5 max-md:p-4";
const sidebarCardCls = "bg-hr-bg-card border border-[rgba(255,255,255,0.08)] rounded-none p-5";
const sidebarItemCls = "flex items-start gap-3 [&>svg]:w-4 [&>svg]:h-4 [&>svg]:text-hr-accent-hover [&>svg]:shrink-0 [&>svg]:mt-0.5";
const metaItemCls = "flex items-center gap-[5px] text-[0.82rem] text-hr-text-muted [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0";
const formInputCls = "bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded-none py-2.5 px-3 font-dm text-[0.88rem] text-hr-text outline-none transition-all duration-200 resize-y w-full placeholder:text-hr-text-muted focus:border-hr-accent focus:shadow-[0_0_0_2px_rgba(124,58,237,0.3)]";
const statusBadgeBase = "inline-block py-1 px-3 rounded-full font-mono text-[0.6rem] font-medium tracking-[0.06em] uppercase whitespace-nowrap";

export default function JobDetailsPage() {
  const [match, params] = useRoute("/jobs/:id");
  const { toast } = useToast();
  const { user } = useAuth();
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    coverLetter: "",
    whatsappConsent: true,
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  // Support both numeric ID and slug in URL
  const jobIdOrSlug = params?.id || null;

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

  const { resumeAdvisor, fitScoring } = useAIFeatures();
  const aiEnabled = resumeAdvisor || fitScoring;

  const isRecruiterOrAdmin = user?.role === 'recruiter' || user?.role === 'super_admin';

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
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/jobs/${job?.id}/apply`, {
        method: "POST",
        headers: { 'x-csrf-token': csrfToken },
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
      setShowApplicationForm(false);
      setFormData({ name: "", email: "", phone: "", coverLetter: "", whatsappConsent: true });
      setResumeFile(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit application", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!resumeFile) {
      toast({ title: "Resume required", description: "Please upload your resume to continue.", variant: "destructive" });
      return;
    }

    try {
      const validatedData = insertApplicationSchema.parse({
        ...formData,
        jobId: job?.id!,
      });
      const formDataToSend = new FormData();
      Object.entries(validatedData).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formDataToSend.append(key, value.toString());
        }
      });
      if (resumeFile) {
        formDataToSend.append('resume', resumeFile);
      }
      applicationMutation.mutate(formDataToSend);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({ title: "Validation error", description: error.errors[0]?.message || "Validation failed", variant: "destructive" });
      }
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
      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased">
        <HomepageNav />
        <GridOverlay />
        <div className={emptyStateCls}>
          <Briefcase />
          <h2 className="font-satoshi text-2xl font-medium text-hr-text">Job Not Found</h2>
          <p className="text-sm text-hr-text-secondary max-w-[400px]">The job you're looking for doesn't exist.</p>
          <Link href="/jobs" className="bg-hr-accent text-white border-none py-2 px-[18px] rounded-none font-dm text-[0.82rem] font-medium cursor-pointer no-underline transition-colors duration-200 inline-block hover:bg-hr-accent-hover">Browse Jobs</Link>
        </div>
        <HomepageFooter />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased">
        <HomepageNav />
        <GridOverlay />
        <div className={emptyStateCls}>
          <div className="w-9 h-9 border-[3px] border-[rgba(255,255,255,0.08)] border-t-hr-accent rounded-full animate-hr-spin" />
          <p className="text-sm text-hr-text-secondary max-w-[400px]">Loading job details...</p>
        </div>
        <HomepageFooter />
      </div>
    );
  }

  if (error || !job) {
    const typedError = error as (Error & { status?: number; code?: string; jobInfo?: { title: string; slug: string } }) | null;
    const isExpiredOrInactive = typedError?.status === 410;

    return (
      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased">
        <HomepageNav />
        <GridOverlay />
        <div className={emptyStateCls}>
          {isExpiredOrInactive ? (
            <>
              <AlertTriangle style={{ color: '#F59E0B', width: 48, height: 48 }} />
              <h2 className="font-satoshi text-2xl font-medium text-hr-text">{typedError?.code === 'EXPIRED' ? 'Job Has Expired' : 'Job No Longer Available'}</h2>
              {typedError?.jobInfo?.title && (
                <p className="text-hr-text-muted mb-1">"{typedError.jobInfo.title}"</p>
              )}
              <p className="text-sm text-hr-text-secondary max-w-[400px]">
                {typedError?.code === 'EXPIRED'
                  ? 'This job posting has expired and is no longer accepting applications.'
                  : 'This job is no longer active. It may have been filled or removed.'}
              </p>
              <Link href="/jobs" className="bg-hr-accent text-white border-none py-2 px-[18px] rounded-none font-dm text-[0.82rem] font-medium cursor-pointer no-underline transition-colors duration-200 inline-block hover:bg-hr-accent-hover mt-4">Browse Active Jobs</Link>
            </>
          ) : (
            <>
              <AlertTriangle style={{ color: '#EF4444', width: 48, height: 48 }} />
              <h2 className="font-satoshi text-2xl font-medium text-hr-text">Error</h2>
              <p className="text-sm text-hr-text-secondary max-w-[400px]">Failed to load job details. Please try again.</p>
            </>
          )}
        </div>
        <HomepageFooter />
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
        <title>{job.title} | VantaHire</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={`${job.title} - VantaHire`} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:image" content={`${DEFAULT_SITE_URL}/og-image.jpg`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:title" content={`${job.title} - VantaHire`} />
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

      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased">
        <HomepageNav />
        <GridOverlay />

        {/* Page wrapper */}
        <div className="pt-[60px] min-h-screen">
          <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
            <div></div>
            <div className="pl-8 pr-8 max-w-[1200px] mx-auto max-md:pl-0 max-md:pr-0">

              {/* Breadcrumb */}
              <nav
                className="flex items-center gap-2 pt-7 max-md:pt-5 text-[0.82rem] text-hr-text-muted [&>a]:text-hr-text-muted [&>a]:no-underline [&>a]:transition-colors [&>a]:duration-200 hover:[&>a]:text-hr-accent-hover [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0 [&>svg]:opacity-50"
                style={{ animation: 'hr-fade-up 0.5s ease-out both' }}
              >
                <Link href="/">Home</Link>
                <ChevronRight />
                <Link href="/jobs">Jobs</Link>
                <ChevronRight />
                <span className="text-hr-text-secondary">{job.title}</span>
              </nav>

              {/* Hero header */}
              <header
                className="flex justify-between items-start gap-10 pt-10 pb-9 border-b border-[rgba(255,255,255,0.08)] mb-9 max-md:flex-col max-md:gap-6 max-md:pt-7 max-md:pb-7"
                style={{ animation: 'hr-fade-up 0.6s ease-out both' }}
              >
                <div className="flex-1 min-w-0">
                  <div className={sectionLabel}>Job Opening</div>
                  <h1 className="font-satoshi text-[clamp(1.8rem,4vw,2.6rem)] max-md:text-[1.5rem] font-medium leading-[1.2] tracking-[-0.01em] text-hr-text mb-4">{job.title}</h1>
                  <div className="flex flex-wrap gap-[18px] mb-4">
                    <span className={metaItemCls}>
                      <MapPin /> {job.location}
                    </span>
                    <span className={metaItemCls}>
                      <Clock /> Posted {formatDate(job.createdAt)}
                    </span>
                    {job.postedByName && (
                      <span className={metaItemCls}>
                        <User />
                        {job.postedById && job.isRecruiterProfilePublic ? (
                          <Link href={`/recruiters/${job.postedById}`} className="text-hr-accent-hover no-underline transition-colors duration-200 hover:underline">{job.postedByName}</Link>
                        ) : (
                          job.postedByName
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="inline-block py-1 px-3 rounded-full font-mono text-[0.62rem] font-medium tracking-[0.06em] uppercase bg-[rgba(124,58,237,0.12)] text-hr-accent-hover whitespace-nowrap">{job.type.replace('-', ' ')}</span>
                    {isExpired && <span className={`${statusBadgeBase} bg-[rgba(239,68,68,0.12)] text-hr-red`}>Expired</span>}
                    {showExpiryWarning && !isExpired && (
                      <span className={`${statusBadgeBase} bg-[rgba(245,158,11,0.12)] text-hr-yellow`}>
                        Expires {daysUntilExpiry === 0 ? 'today' : daysUntilExpiry === 1 ? 'tomorrow' : `in ${daysUntilExpiry} days`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex flex-col gap-3 shrink-0 pt-7 max-md:pt-0 max-md:flex-row max-md:flex-wrap max-md:items-center">
                  {!isExpired && (
                    <button
                      className={btnApplyCls}
                      onClick={() => {
                        setShowApplicationForm(true);
                        document.getElementById('hr-jd-apply-section')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                    >
                      Apply Now
                    </button>
                  )}
                  {isExpired && isRecruiterOrAdmin && (
                    <button
                      className="flex items-center gap-2 bg-transparent text-hr-green border border-[rgba(16,185,129,0.3)] py-2.5 px-6 rounded-none font-dm text-[0.85rem] font-medium cursor-pointer transition-all duration-200 [&>svg]:w-4 [&>svg]:h-4 hover:bg-[rgba(16,185,129,0.1)] hover:border-[rgba(16,185,129,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <button
                      className={btnSecondaryCls}
                      onClick={() => toast({ title: "Job saved", description: "We'll remind you about this opportunity" })}
                    >
                      <Bookmark /> Save
                    </button>
                  </div>
                </div>
              </header>

              {/* Expiry warning banner */}
              {showExpiryWarning && !isExpired && (
                <div
                  className="flex items-start gap-3 py-3.5 px-[18px] border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] rounded-none mb-7 [&>svg]:w-[18px] [&>svg]:h-[18px] [&>svg]:text-hr-yellow [&>svg]:shrink-0 [&>svg]:mt-0.5"
                  style={{ animation: 'hr-fade-up 0.7s ease-out 0.1s both' }}
                >
                  <AlertTriangle />
                  <div>
                    <strong className="block text-[0.88rem] text-hr-yellow font-medium mb-0.5">
                      This job posting expires {daysUntilExpiry === 0 ? 'today' : daysUntilExpiry === 1 ? 'tomorrow' : `in ${daysUntilExpiry} days`}
                    </strong>
                    <span className="text-[0.78rem] text-hr-text-muted">
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
                {/* Left column — details */}
                <main>

                  {/* Description */}
                  <section className={cardCls}>
                    <div className={cardHeaderCls}>
                      <FileText /> Job Description
                    </div>
                    <div className={cardBodyCls}>
                      <p className="text-sm leading-[1.75] text-hr-text-secondary whitespace-pre-wrap">{job.description}</p>
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
                              <span className="text-[0.78rem] text-hr-text-muted uppercase tracking-[0.06em] font-mono">Education</span>
                              <span className="text-sm text-hr-text font-medium">{job.educationRequirement}</span>
                            </div>
                          )}
                          {job.experienceYears && (
                            <div className="flex flex-col gap-1">
                              <span className="text-[0.78rem] text-hr-text-muted uppercase tracking-[0.06em] font-mono">Experience</span>
                              <span className="text-sm text-hr-text font-medium">{job.experienceYears}+ years</span>
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
                            <span key={index} className="inline-block py-[5px] px-3.5 rounded-full text-[0.78rem] font-medium border bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.2)] text-hr-red">{skill}</span>
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
                            <span key={index} className="inline-block py-[5px] px-3.5 rounded-full text-[0.78rem] font-medium border bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.2)] text-hr-green">{skill}</span>
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
                          <span className="font-satoshi text-2xl font-semibold text-hr-text">
                            {job.salaryMin && job.salaryMax
                              ? `₹${job.salaryMin.toLocaleString('en-IN')} – ₹${job.salaryMax.toLocaleString('en-IN')}`
                              : job.salaryMin
                              ? `₹${job.salaryMin.toLocaleString('en-IN')}+`
                              : `Up to ₹${job.salaryMax?.toLocaleString('en-IN')}`}
                          </span>
                          <span className="text-[0.85rem] text-hr-text-muted">
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
                              <div className="absolute -left-[19px] top-1 w-[9px] h-[9px] rounded-full bg-hr-accent border-2 border-hr-bg-card" />
                              <div className="bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded-none py-3 px-3.5">
                                <div className="flex justify-between items-center gap-3 mb-1">
                                  <span className="text-[0.85rem] font-medium text-hr-text capitalize">{entry.action.replace(/_/g, ' ')}</span>
                                  <span className="text-[0.72rem] text-hr-text-muted font-mono whitespace-nowrap">
                                    {entry.createdAt && !isNaN(new Date(entry.createdAt).getTime())
                                      ? format(new Date(entry.createdAt), "MMM d, yyyy 'at' h:mm a")
                                      : 'Unknown date'}
                                  </span>
                                </div>
                                {entry.performedBy && (
                                  <span className="text-[0.75rem] text-hr-text-muted">by {entry.performedBy.firstName} {entry.performedBy.lastName}</span>
                                )}
                                {entry.changes && Object.keys(entry.changes).length > 0 && (
                                  <div className="flex flex-wrap gap-2 mt-2 text-[0.72rem] text-hr-text-muted">
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

                {/* Right column — sidebar */}
                <aside className="sticky top-20 self-start flex flex-col gap-4 max-md:static" id="hr-jd-apply-section">
                  {/* Job summary card */}
                  <div className={sidebarCardCls}>
                    <div className="font-satoshi text-base font-medium text-hr-text mb-4">Job Summary</div>
                    <div className="flex flex-col gap-4">
                      <div className={sidebarItemCls}>
                        <MapPin />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[0.72rem] text-hr-text-muted uppercase tracking-[0.06em] font-mono">Location</span>
                          <span className="text-[0.88rem] text-hr-text font-medium">{job.location}</span>
                        </div>
                      </div>
                      <div className={sidebarItemCls}>
                        <Briefcase />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[0.72rem] text-hr-text-muted uppercase tracking-[0.06em] font-mono">Job Type</span>
                          <span className="text-[0.88rem] text-hr-text font-medium capitalize">{job.type.replace('-', ' ')}</span>
                        </div>
                      </div>
                      {job.deadline && (
                        <div className={sidebarItemCls}>
                          <Calendar />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[0.72rem] text-hr-text-muted uppercase tracking-[0.06em] font-mono">Deadline</span>
                            <span className="text-[0.88rem] text-hr-yellow font-medium">{formatDate(job.deadline)}</span>
                          </div>
                        </div>
                      )}
                      <div className={sidebarItemCls}>
                        <Clock />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[0.72rem] text-hr-text-muted uppercase tracking-[0.06em] font-mono">Posted</span>
                          <span className="text-[0.88rem] text-hr-text font-medium">{formatDate(job.createdAt)}</span>
                        </div>
                      </div>
                      {(job.salaryMin || job.salaryMax) && (
                        <div className={sidebarItemCls}>
                          <IndianRupee />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[0.72rem] text-hr-text-muted uppercase tracking-[0.06em] font-mono">Salary</span>
                            <span className="text-[0.88rem] text-hr-text font-medium">
                              {job.salaryMin && job.salaryMax
                                ? `₹${job.salaryMin.toLocaleString('en-IN')} – ₹${job.salaryMax.toLocaleString('en-IN')}`
                                : job.salaryMin
                                ? `₹${job.salaryMin.toLocaleString('en-IN')}+`
                                : `Up to ₹${job.salaryMax?.toLocaleString('en-IN')}`}
                              <span className="text-hr-text-muted font-normal text-[0.72rem] ml-1">
                                {job.salaryPeriod === 'per_month' ? '/mo' : '/yr'}
                              </span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* AI match badge */}
                  {aiEnabled && (
                    <div className="bg-[linear-gradient(135deg,rgba(124,58,237,0.1),rgba(6,182,212,0.06))] border border-[rgba(124,58,237,0.2)] rounded-none py-[18px] px-5">
                      <div className="flex items-center gap-2 text-[0.88rem] font-semibold text-hr-accent-hover mb-2 [&>svg]:w-4 [&>svg]:h-4">
                        <Sparkles /> AI Match Score
                      </div>
                      <p className="text-[0.78rem] text-hr-text-muted leading-[1.5] mb-3">Upload your resume to see your match score</p>
                      <span className="inline-block py-1 px-3 rounded-full font-mono text-[0.62rem] font-medium tracking-[0.04em] bg-[rgba(124,58,237,0.12)] text-hr-accent-hover border border-[rgba(124,58,237,0.2)]">AI-Powered Matching Available</span>
                    </div>
                  )}

                  {/* Apply card */}
                  {!showApplicationForm ? (
                    <div className={sidebarCardCls}>
                      <div className="font-satoshi text-base font-medium text-hr-text mb-4">Interested?</div>
                      <p className="text-[0.88rem] text-hr-text-secondary leading-[1.6] mb-5">
                        Submit your application and we'll get back to you.
                      </p>
                      {!isExpired && (
                        <button
                          className={`${btnApplyCls} w-full`}
                          onClick={() => setShowApplicationForm(true)}
                          data-testid="apply-button"
                        >
                          Apply Now
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className={`${sidebarCardCls} p-5`}>
                      <div className="flex justify-between items-start">
                        <div className="font-satoshi text-base font-medium text-hr-text mb-4">Submit Application</div>
                        <button className="bg-transparent border-none text-hr-text-muted cursor-pointer p-1 transition-colors duration-200 hover:text-hr-text [&>svg]:w-[18px] [&>svg]:h-[18px]" onClick={() => setShowApplicationForm(false)}>
                          <X />
                        </button>
                      </div>
                      <p className="text-[0.82rem] text-hr-text-muted mb-5">
                        Fill out the form below to apply for this position
                      </p>
                      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="name" className="text-[0.78rem] font-medium text-hr-text-secondary">Full Name *</label>
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
                          <label htmlFor="email" className="text-[0.78rem] font-medium text-hr-text-secondary">Email *</label>
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
                          <label htmlFor="phone" className="text-[0.78rem] font-medium text-hr-text-secondary">Phone *</label>
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
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="resume" className="text-[0.78rem] font-medium text-hr-text-secondary">Resume (PDF) *</label>
                          <div className="relative">
                            <input
                              id="resume"
                              type="file"
                              accept=".pdf,.doc,.docx"
                              className="bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded-none py-2.5 px-3 font-dm text-[0.82rem] text-hr-text-secondary w-full cursor-pointer file:bg-hr-accent file:text-white file:border-none file:rounded-none file:py-1.5 file:px-4 file:mr-3 file:font-dm file:text-[0.78rem] file:font-medium file:cursor-pointer"
                              onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                              required
                            />
                            <Upload className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hr-text-muted pointer-events-none" />
                          </div>
                          {resumeFile && (
                            <span className="flex items-center gap-1.5 text-[0.78rem] text-hr-green mt-1 [&>svg]:w-3.5 [&>svg]:h-3.5">
                              <Check /> {resumeFile.name}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="coverLetter" className="text-[0.78rem] font-medium text-hr-text-secondary">Cover Letter</label>
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
                          <label htmlFor="whatsappConsent" className="text-[0.78rem] text-hr-text-muted leading-[1.4] cursor-pointer">I agree to receive job updates via WhatsApp</label>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <button
                            type="submit"
                            className={`${btnApplyCls} flex-1`}
                            disabled={applicationMutation.isPending}
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

        <HomepageFooter />
      </div>
    </>
  );
}
