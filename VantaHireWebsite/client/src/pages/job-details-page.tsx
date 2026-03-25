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
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/job-detail.css";

// Types for audit log
interface AuditLogEntry {
  id: number;
  action: string;
  changes: Record<string, unknown> | null;
  performedBy: { firstName: string; lastName: string; username: string } | null;
  createdAt: string;
}

// Grid Overlay (same as homepage)
const GridOverlay = () => (
  <div className="hr-page-grid-overlay">
    <div className="hr-page-grid-overlay-inner">
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
      <div className="grid-col"></div>
      <div className="grid-col"></div>
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
    </div>
  </div>
);

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
      <>
        <div className="homepage-redesign">
          <HomepageNav />
          <GridOverlay />
          <div className="hr-jd-empty-state">
            <Briefcase />
            <h2>Job Not Found</h2>
            <p>The job you're looking for doesn't exist.</p>
            <Link href="/jobs" className="hr-btn-view-job">Browse Jobs</Link>
          </div>
          <HomepageFooter />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <div className="homepage-redesign">
          <HomepageNav />
          <GridOverlay />
          <div className="hr-jd-empty-state">
            <div className="hr-jd-spinner" />
            <p>Loading job details...</p>
          </div>
          <HomepageFooter />
        </div>
      </>
    );
  }

  if (error || !job) {
    const typedError = error as (Error & { status?: number; code?: string; jobInfo?: { title: string; slug: string } }) | null;
    const isExpiredOrInactive = typedError?.status === 410;

    return (
      <>
        <div className="homepage-redesign">
          <HomepageNav />
          <GridOverlay />
          <div className="hr-jd-empty-state">
            {isExpiredOrInactive ? (
              <>
                <AlertTriangle style={{ color: 'var(--hr-yellow)', width: 48, height: 48 }} />
                <h2>{typedError?.code === 'EXPIRED' ? 'Job Has Expired' : 'Job No Longer Available'}</h2>
                {typedError?.jobInfo?.title && (
                  <p style={{ color: 'var(--hr-text-muted)', marginBottom: 4 }}>"{typedError.jobInfo.title}"</p>
                )}
                <p>
                  {typedError?.code === 'EXPIRED'
                    ? 'This job posting has expired and is no longer accepting applications.'
                    : 'This job is no longer active. It may have been filled or removed.'}
                </p>
                <Link href="/jobs" className="hr-btn-view-job" style={{ marginTop: 16 }}>Browse Active Jobs</Link>
              </>
            ) : (
              <>
                <AlertTriangle style={{ color: 'var(--hr-red)', width: 48, height: 48 }} />
                <h2>Error</h2>
                <p>Failed to load job details. Please try again.</p>
              </>
            )}
          </div>
          <HomepageFooter />
        </div>
      </>
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

      <div className="homepage-redesign">
        <HomepageNav />
        <GridOverlay />

        {/* Page wrapper */}
        <div className="hr-jd-page">
          <div className="hr-struct-section">
            <div className="struct-gutter"></div>
            <div className="struct-body">

              {/* Breadcrumb */}
              <nav className="hr-jd-breadcrumb">
                <Link href="/">Home</Link>
                <ChevronRight />
                <Link href="/jobs">Jobs</Link>
                <ChevronRight />
                <span>{job.title}</span>
              </nav>

              {/* Hero header */}
              <header className="hr-jd-hero">
                <div className="hr-jd-hero-content">
                  <div className="hr-section-label">Job Opening</div>
                  <h1 className="hr-jd-title">{job.title}</h1>
                  <div className="hr-jd-hero-meta">
                    <span className="hr-job-meta-item">
                      <MapPin /> {job.location}
                    </span>
                    <span className="hr-job-meta-item">
                      <Clock /> Posted {formatDate(job.createdAt)}
                    </span>
                    {job.postedByName && (
                      <span className="hr-job-meta-item">
                        <User />
                        {job.postedById && job.isRecruiterProfilePublic ? (
                          <Link href={`/recruiters/${job.postedById}`}>{job.postedByName}</Link>
                        ) : (
                          job.postedByName
                        )}
                      </span>
                    )}
                  </div>
                  <div className="hr-jd-hero-tags">
                    <span className="hr-job-type-badge">{job.type.replace('-', ' ')}</span>
                    {isExpired && <span className="hr-jd-status-badge expired">Expired</span>}
                    {showExpiryWarning && !isExpired && (
                      <span className="hr-jd-status-badge warning">
                        Expires {daysUntilExpiry === 0 ? 'today' : daysUntilExpiry === 1 ? 'tomorrow' : `in ${daysUntilExpiry} days`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="hr-jd-hero-actions">
                  {!isExpired && (
                    <button
                      className="hr-jd-btn-apply"
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
                      className="hr-jd-btn-reactivate"
                      onClick={() => reactivateMutation.mutate()}
                      disabled={reactivateMutation.isPending}
                    >
                      <RotateCcw />
                      {reactivateMutation.isPending ? "Reactivating..." : "Reactivate Job"}
                    </button>
                  )}
                  <div className="hr-jd-secondary-actions">
                    <button
                      className="hr-jd-btn-secondary"
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
                      className="hr-jd-btn-secondary"
                      onClick={() => toast({ title: "Job saved", description: "We'll remind you about this opportunity" })}
                    >
                      <Bookmark /> Save
                    </button>
                  </div>
                </div>
              </header>

              {/* Expiry warning banner */}
              {showExpiryWarning && !isExpired && (
                <div className="hr-jd-expiry-banner">
                  <AlertTriangle />
                  <div>
                    <strong>
                      This job posting expires {daysUntilExpiry === 0 ? 'today' : daysUntilExpiry === 1 ? 'tomorrow' : `in ${daysUntilExpiry} days`}
                    </strong>
                    <span>
                      {job.expiresAt && `Expiry date: ${format(new Date(job.expiresAt), "MMMM d, yyyy 'at' h:mm a")}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Main content grid */}
              <div className="hr-jd-layout">
                {/* Left column — details */}
                <main className="hr-jd-main">

                  {/* Description */}
                  <section className="hr-jd-card">
                    <div className="hr-jd-card-header">
                      <FileText /> Job Description
                    </div>
                    <div className="hr-jd-card-body">
                      <p className="hr-jd-description">{job.description}</p>
                    </div>
                  </section>

                  {/* Required Skills */}
                  {job.skills && job.skills.length > 0 && (
                    <section className="hr-jd-card">
                      <div className="hr-jd-card-header">
                        <Star /> Required Skills
                      </div>
                      <div className="hr-jd-card-body">
                        <div className="hr-jd-skills">
                          {job.skills.map((skill, index) => (
                            <span key={index} className="hr-jd-skill-tag required">{skill}</span>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Good to Have Skills */}
                  {job.goodToHaveSkills && job.goodToHaveSkills.length > 0 && (
                    <section className="hr-jd-card">
                      <div className="hr-jd-card-header">
                        <Sparkles /> Good to Have
                      </div>
                      <div className="hr-jd-card-body">
                        <div className="hr-jd-skills">
                          {job.goodToHaveSkills.map((skill, index) => (
                            <span key={index} className="hr-jd-skill-tag nice-to-have">{skill}</span>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Compensation */}
                  {(job.salaryMin || job.salaryMax) && (
                    <section className="hr-jd-card">
                      <div className="hr-jd-card-header">
                        <IndianRupee /> Compensation
                      </div>
                      <div className="hr-jd-card-body">
                        <div className="hr-jd-salary">
                          <span className="hr-jd-salary-value">
                            {job.salaryMin && job.salaryMax
                              ? `₹${job.salaryMin.toLocaleString('en-IN')} – ₹${job.salaryMax.toLocaleString('en-IN')}`
                              : job.salaryMin
                              ? `₹${job.salaryMin.toLocaleString('en-IN')}+`
                              : `Up to ₹${job.salaryMax?.toLocaleString('en-IN')}`}
                          </span>
                          <span className="hr-jd-salary-period">
                            {job.salaryPeriod === 'per_month' ? '/month' : '/year'}
                          </span>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Education & Experience */}
                  {(job.educationRequirement || job.experienceYears) && (
                    <section className="hr-jd-card">
                      <div className="hr-jd-card-header">
                        <GraduationCap /> Requirements
                      </div>
                      <div className="hr-jd-card-body">
                        <div className="hr-jd-requirements">
                          {job.educationRequirement && (
                            <div className="hr-jd-req-item">
                              <span className="hr-jd-req-label">Education</span>
                              <span className="hr-jd-req-value">{job.educationRequirement}</span>
                            </div>
                          )}
                          {job.experienceYears && (
                            <div className="hr-jd-req-item">
                              <span className="hr-jd-req-label">Experience</span>
                              <span className="hr-jd-req-value">{job.experienceYears}+ years</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Activity Log (Recruiters/Admins only) */}
                  {isRecruiterOrAdmin && auditLog.length > 0 && (
                    <section className="hr-jd-card">
                      <div className="hr-jd-card-header">
                        <History /> Activity Log
                      </div>
                      <div className="hr-jd-card-body">
                        <div className="hr-jd-timeline">
                          {auditLog.slice(0, 10).map((entry) => (
                            <div key={entry.id} className="hr-jd-timeline-entry">
                              <div className="hr-jd-timeline-dot" />
                              <div className="hr-jd-timeline-content">
                                <div className="hr-jd-timeline-row">
                                  <span className="hr-jd-timeline-action">{entry.action.replace(/_/g, ' ')}</span>
                                  <span className="hr-jd-timeline-date">
                                    {entry.createdAt && !isNaN(new Date(entry.createdAt).getTime())
                                      ? format(new Date(entry.createdAt), "MMM d, yyyy 'at' h:mm a")
                                      : 'Unknown date'}
                                  </span>
                                </div>
                                {entry.performedBy && (
                                  <span className="hr-jd-timeline-by">by {entry.performedBy.firstName} {entry.performedBy.lastName}</span>
                                )}
                                {entry.changes && Object.keys(entry.changes).length > 0 && (
                                  <div className="hr-jd-timeline-changes">
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
                <aside className="hr-jd-sidebar" id="hr-jd-apply-section">
                  {/* Job summary card */}
                  <div className="hr-jd-sidebar-card">
                    <div className="hr-jd-sidebar-title">Job Summary</div>
                    <div className="hr-jd-sidebar-items">
                      <div className="hr-jd-sidebar-item">
                        <MapPin />
                        <div>
                          <span className="hr-jd-sidebar-label">Location</span>
                          <span className="hr-jd-sidebar-value">{job.location}</span>
                        </div>
                      </div>
                      <div className="hr-jd-sidebar-item">
                        <Briefcase />
                        <div>
                          <span className="hr-jd-sidebar-label">Job Type</span>
                          <span className="hr-jd-sidebar-value" style={{ textTransform: 'capitalize' }}>{job.type.replace('-', ' ')}</span>
                        </div>
                      </div>
                      {job.deadline && (
                        <div className="hr-jd-sidebar-item">
                          <Calendar />
                          <div>
                            <span className="hr-jd-sidebar-label">Deadline</span>
                            <span className="hr-jd-sidebar-value" style={{ color: 'var(--hr-yellow)' }}>{formatDate(job.deadline)}</span>
                          </div>
                        </div>
                      )}
                      <div className="hr-jd-sidebar-item">
                        <Clock />
                        <div>
                          <span className="hr-jd-sidebar-label">Posted</span>
                          <span className="hr-jd-sidebar-value">{formatDate(job.createdAt)}</span>
                        </div>
                      </div>
                      {(job.salaryMin || job.salaryMax) && (
                        <div className="hr-jd-sidebar-item">
                          <IndianRupee />
                          <div>
                            <span className="hr-jd-sidebar-label">Salary</span>
                            <span className="hr-jd-sidebar-value">
                              {job.salaryMin && job.salaryMax
                                ? `₹${job.salaryMin.toLocaleString('en-IN')} – ₹${job.salaryMax.toLocaleString('en-IN')}`
                                : job.salaryMin
                                ? `₹${job.salaryMin.toLocaleString('en-IN')}+`
                                : `Up to ₹${job.salaryMax?.toLocaleString('en-IN')}`}
                              <span style={{ color: 'var(--hr-text-muted)', fontWeight: 400, fontSize: '0.72rem', marginLeft: 4 }}>
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
                    <div className="hr-jd-ai-card">
                      <div className="hr-jd-ai-header">
                        <Sparkles /> AI Match Score
                      </div>
                      <p>Upload your resume to see your match score</p>
                      <span className="hr-jd-ai-badge">AI-Powered Matching Available</span>
                    </div>
                  )}

                  {/* Apply card */}
                  {!showApplicationForm ? (
                    <div className="hr-jd-sidebar-card">
                      <div className="hr-jd-sidebar-title">Interested?</div>
                      <p style={{ fontSize: '0.88rem', color: 'var(--hr-text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
                        Submit your application and we'll get back to you.
                      </p>
                      {!isExpired && (
                        <button
                          className="hr-jd-btn-apply full-width"
                          onClick={() => setShowApplicationForm(true)}
                          data-testid="apply-button"
                        >
                          Apply Now
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="hr-jd-sidebar-card hr-jd-form-card">
                      <div className="hr-jd-form-header">
                        <div className="hr-jd-sidebar-title">Submit Application</div>
                        <button className="hr-jd-form-close" onClick={() => setShowApplicationForm(false)}>
                          <X />
                        </button>
                      </div>
                      <p style={{ fontSize: '0.82rem', color: 'var(--hr-text-muted)', marginBottom: 20 }}>
                        Fill out the form below to apply for this position
                      </p>
                      <form onSubmit={handleSubmit} className="hr-jd-form">
                        <div className="hr-jd-form-group">
                          <label htmlFor="name">Full Name *</label>
                          <input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                            placeholder="Enter your full name"
                          />
                        </div>
                        <div className="hr-jd-form-group">
                          <label htmlFor="email">Email *</label>
                          <input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            required
                            placeholder="you@example.com"
                          />
                        </div>
                        <div className="hr-jd-form-group">
                          <label htmlFor="phone">Phone *</label>
                          <input
                            id="phone"
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            required
                            placeholder="+91 98765 43210"
                          />
                        </div>
                        <div className="hr-jd-form-group">
                          <label htmlFor="resume">Resume (PDF) *</label>
                          <div className="hr-jd-file-input">
                            <input
                              id="resume"
                              type="file"
                              accept=".pdf,.doc,.docx"
                              onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                              required
                            />
                            <Upload />
                          </div>
                          {resumeFile && (
                            <span className="hr-jd-file-name">
                              <Check /> {resumeFile.name}
                            </span>
                          )}
                        </div>
                        <div className="hr-jd-form-group">
                          <label htmlFor="coverLetter">Cover Letter</label>
                          <textarea
                            id="coverLetter"
                            value={formData.coverLetter}
                            onChange={(e) => setFormData({ ...formData, coverLetter: e.target.value })}
                            placeholder="Tell us why you're perfect for this role..."
                            rows={4}
                          />
                        </div>
                        <div className="hr-jd-checkbox-row">
                          <input
                            type="checkbox"
                            id="whatsappConsent"
                            checked={formData.whatsappConsent}
                            onChange={(e) => setFormData({ ...formData, whatsappConsent: e.target.checked })}
                          />
                          <label htmlFor="whatsappConsent">I agree to receive job updates via WhatsApp</label>
                        </div>
                        <div className="hr-jd-form-actions">
                          <button
                            type="submit"
                            className="hr-jd-btn-apply"
                            disabled={applicationMutation.isPending}
                          >
                            {applicationMutation.isPending ? "Submitting..." : "Submit Application"}
                          </button>
                          <button
                            type="button"
                            className="hr-jd-btn-secondary"
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
            <div className="struct-gutter"></div>
          </div>
        </div>

        <HomepageFooter />
      </div>
    </>
  );
}
