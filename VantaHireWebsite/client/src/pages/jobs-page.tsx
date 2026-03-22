import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Helmet } from "react-helmet-async";
import { Search, MapPin, Clock, Briefcase, X, User, IndianRupee, SlidersHorizontal } from "lucide-react";
import { DEFAULT_SITE_URL } from "@/lib/seoHelpers";
import { Job } from "@shared/schema";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import "@/styles/homepage-redesign.css";
import { useAIFeatures } from "@/hooks/use-ai-features";

interface JobWithRecruiter extends Job {
  postedByName?: string;
  postedById?: number | string;
  isRecruiterProfilePublic?: boolean;
}

interface JobsResponse {
  jobs: JobWithRecruiter[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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

export default function JobsPage() {
  const searchParams = new URLSearchParams(useSearch());
  const [, setUrlLocation] = useLocation();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1", 10));
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [location, setLocationFilter] = useState(searchParams.get("location") || "");
  const [type, setType] = useState(searchParams.get("type") || "all");
  const [minSalary, setMinSalary] = useState(searchParams.get("minSalary") || "");
  const [maxSalary, setMaxSalary] = useState(searchParams.get("maxSalary") || "");
  const [salaryPeriod, setSalaryPeriod] = useState(searchParams.get("salaryPeriod") || "per_year");
  const [sortBy, setSortBy] = useState<string>(searchParams.get("sortBy") || "recent");
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const { resumeAdvisor, fitScoring } = useAIFeatures();
  const aiEnabled = resumeAdvisor || fitScoring;

  // Fetch jobs
  const { data, isLoading, error } = useQuery<JobsResponse>({
    queryKey: ["/api/jobs", { page, search, location, type, minSalary, maxSalary, salaryPeriod }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      if (search) params.set("search", search);
      if (location) params.set("location", location);
      if (type && type !== "all") params.set("type", type);
      if (minSalary) params.set("minSalary", minSalary);
      if (maxSalary) params.set("maxSalary", maxSalary);
      if (salaryPeriod) params.set("salaryPeriod", salaryPeriod);
      const response = await fetch(`/api/jobs?${params}`);
      if (!response.ok) throw new Error("Failed to fetch jobs");
      return response.json();
    },
  });

  // Client-side sorting
  const sortedJobs = useMemo(() => {
    if (!data?.jobs) return [];
    const jobs = [...data.jobs];
    switch (sortBy) {
      case "recent":
        return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case "deadline":
        return jobs.sort((a, b) => {
          if (!a.deadline) return 1;
          if (!b.deadline) return -1;
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        });
      default:
        return jobs;
    }
  }, [data?.jobs, sortBy]);

  // Sync state to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (location) params.set("location", location);
    if (type && type !== "all") params.set("type", type);
    if (minSalary) params.set("minSalary", minSalary);
    if (maxSalary) params.set("maxSalary", maxSalary);
    if (salaryPeriod) params.set("salaryPeriod", salaryPeriod);
    if (sortBy && sortBy !== "recent") params.set("sortBy", sortBy);
    if (page > 1) params.set("page", page.toString());
    const queryString = params.toString();
    setUrlLocation(`/jobs${queryString ? `?${queryString}` : ''}`, { replace: true });
  }, [search, location, type, minSalary, maxSalary, salaryPeriod, sortBy, page, setUrlLocation]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  const handleApplyFilters = () => setPage(1);

  const handleResetFilters = () => {
    setSearch("");
    setLocationFilter("");
    setType("all");
    setMinSalary("");
    setMaxSalary("");
    setSalaryPeriod("per_year");
    setSortBy("recent");
    setPage(1);
  };

  const handleJobCardHover = (jobId: number) => {
    queryClient.prefetchQuery({
      queryKey: ["/api/jobs", jobId.toString()],
      queryFn: async () => {
        const response = await fetch(`/api/jobs/${jobId}`);
        if (!response.ok) throw new Error("Failed to fetch job");
        return response.json();
      },
    });
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (location) count++;
    if (type && type !== "all") count++;
    if (minSalary) count++;
    if (maxSalary) count++;
    return count;
  }, [search, location, type, minSalary, maxSalary]);

  const metaData = useMemo(() => {
    const baseUrl = DEFAULT_SITE_URL;
    const count = data?.pagination.total || 0;
    let title = "Find Jobs";
    if (location) title += ` in ${location}`;
    if (type && type !== "all") {
      const typeLabel = type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
      title += ` - ${typeLabel}`;
    }
    title += " | VantaHire";
    let description = `Browse ${count} open roles across IT, Telecom, Automotive, Fintech, Healthcare.`;
    if (location) description += ` Find opportunities in ${location}.`;
    if (search) description += ` Search: ${search}.`;
    description += " Recruiter-first ATS built for recruiting velocity.";
    const canonicalUrl = `${baseUrl}/jobs`;
    return { title, description, canonicalUrl, baseUrl };
  }, [location, type, search, data?.pagination.total]);

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatSalary = (min?: number | null, max?: number | null, period?: string | null) => {
    if (!min && !max) return null;
    const currency = "₹";
    const p = period === "per_year" ? "/yr" : period === "per_month" ? "/mo" : "";
    if (min && max) return `${currency}${min.toLocaleString()} – ${currency}${max.toLocaleString()}${p}`;
    if (min) return `From ${currency}${min.toLocaleString()}${p}`;
    if (max) return `Up to ${currency}${max.toLocaleString()}${p}`;
    return null;
  };

  // Filter panel content (shared between desktop & mobile)
  const filterPanel = (
    <>
      <div className="hr-filter-group">
        <label><Search size={12} /> Keyword</label>
        <div className="hr-filter-input-icon">
          <Search />
          <input
            className="hr-filter-input"
            placeholder="Job title, keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
        </div>
      </div>

      <div className="hr-filter-group">
        <label><MapPin size={12} /> Location</label>
        <div className="hr-filter-input-icon">
          <MapPin />
          <input
            className="hr-filter-input"
            placeholder="City, state..."
            value={location}
            onChange={(e) => setLocationFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
        </div>
      </div>

      <div className="hr-filter-divider" />

      <div className="hr-filter-group">
        <label><Briefcase size={12} /> Job Type</label>
        <select className="hr-filter-select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All Types</option>
          <option value="full-time">Full-time</option>
          <option value="part-time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
          <option value="temporary">Temporary</option>
        </select>
      </div>

      <div className="hr-filter-group">
        <label><IndianRupee size={12} /> Salary Range</label>
        <div className="hr-filter-salary-row">
          <input
            className="hr-filter-input"
            placeholder="Min"
            type="number"
            value={minSalary}
            onChange={(e) => setMinSalary(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
          <span>–</span>
          <input
            className="hr-filter-input"
            placeholder="Max"
            type="number"
            value={maxSalary}
            onChange={(e) => setMaxSalary(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
        </div>
        <select
          className="hr-filter-select"
          value={salaryPeriod}
          onChange={(e) => setSalaryPeriod(e.target.value)}
          style={{ marginTop: '8px' }}
        >
          <option value="per_year">Per Year</option>
          <option value="per_month">Per Month</option>
        </select>
      </div>

      <div className="hr-filter-divider" />

      <div className="hr-filter-actions">
        <button className="hr-btn-filter-apply" onClick={handleApplyFilters}>Apply Filters</button>
        <button className="hr-btn-filter-reset" onClick={handleResetFilters}>Reset</button>
      </div>
    </>
  );

  return (
    <>
      <Helmet>
        <title>{metaData.title}</title>
        <meta name="description" content={metaData.description} />
        <link rel="canonical" href={metaData.canonicalUrl} />
        <meta property="og:title" content={metaData.title} />
        <meta property="og:description" content={metaData.description} />
        <meta property="og:url" content={metaData.canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:image" content={`${metaData.baseUrl}/og-image.jpg`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metaData.title} />
        <meta name="twitter:description" content={metaData.description} />
        <meta name="twitter:image" content={`${metaData.baseUrl}/twitter-image.jpg`} />
      </Helmet>

      <div className="homepage-redesign">
        <GridOverlay />
        <div style={{ position: 'relative', zIndex: 10 }}>
          <HomepageNav />

          <div className="hr-jobs-page">
            {/* Header */}
            <div className="hr-struct-section">
              <div className="struct-gutter"></div>
              <div className="struct-body" style={{ borderBottom: 'none' }}>
                <div className="hr-jobs-header">
                  <div className="hr-section-label">Open Positions</div>
                  <h1 className="hr-section-title">Find Your Next<br />Opportunity</h1>
                  <p className="hr-section-desc">
                    Discover roles with leading companies across India, powered by intelligent matching.
                  </p>
                </div>
              </div>
              <div className="struct-gutter"></div>
            </div>

            {/* Main content */}
            <div className="hr-struct-section">
              <div className="struct-gutter"></div>
              <div className="struct-body">
                <div className="hr-jobs-layout" style={{ padding: '0 0 80px' }}>
                  {/* Desktop sidebar */}
                  <aside className="hr-jobs-sidebar">
                    <div className="hr-filter-panel">
                      <h3><SlidersHorizontal size={16} /> Filters</h3>
                      {filterPanel}
                    </div>
                  </aside>

                  {/* Results area */}
                  <main>
                    {/* Toolbar */}
                    <div className="hr-jobs-toolbar">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* Mobile filter trigger */}
                        <button
                          className="hr-mobile-filter-btn"
                          onClick={() => setMobileFilterOpen(true)}
                        >
                          <SlidersHorizontal />
                          Filters
                          {activeFilterCount > 0 && (
                            <span className="hr-mobile-filter-count">{activeFilterCount}</span>
                          )}
                        </button>

                        {data && (
                          <span className="hr-jobs-count">
                            <strong>{data.pagination.total}</strong> {data.pagination.total === 1 ? 'job' : 'jobs'} found
                          </span>
                        )}
                      </div>

                      <div className="hr-jobs-sort">
                        <span>Sort</span>
                        <select className="hr-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                          <option value="recent">Most Recent</option>
                          <option value="deadline">Deadline: Soonest</option>
                          {aiEnabled && <option value="relevant">AI Relevance</option>}
                        </select>
                      </div>
                    </div>

                    {/* Active filter chips */}
                    {activeFilterCount > 0 && (
                      <div className="hr-filter-chips">
                        {search && (
                          <span className="hr-filter-chip">
                            Search: {search}
                            <button onClick={() => setSearch("")}><X size={12} /></button>
                          </span>
                        )}
                        {location && (
                          <span className="hr-filter-chip">
                            Location: {location}
                            <button onClick={() => setLocationFilter("")}><X size={12} /></button>
                          </span>
                        )}
                        {type && type !== "all" && (
                          <span className="hr-filter-chip">
                            {type.replace('-', ' ')}
                            <button onClick={() => setType("all")}><X size={12} /></button>
                          </span>
                        )}
                        {minSalary && (
                          <span className="hr-filter-chip">
                            Min: ₹{Number(minSalary).toLocaleString()}
                            <button onClick={() => setMinSalary("")}><X size={12} /></button>
                          </span>
                        )}
                        {maxSalary && (
                          <span className="hr-filter-chip">
                            Max: ₹{Number(maxSalary).toLocaleString()}
                            <button onClick={() => setMaxSalary("")}><X size={12} /></button>
                          </span>
                        )}
                        <button
                          className="hr-btn-filter-reset"
                          style={{ padding: '4px 12px', fontSize: '0.72rem' }}
                          onClick={handleResetFilters}
                        >
                          Clear all
                        </button>
                      </div>
                    )}

                    {/* Results */}
                    {isLoading ? (
                      <div className="hr-jobs-loading">
                        <div className="hr-jobs-spinner" />
                        <p>Loading jobs...</p>
                      </div>
                    ) : error ? (
                      <div className="hr-jobs-empty">
                        <p style={{ color: 'var(--hr-red)' }}>Error loading jobs. Please try again.</p>
                      </div>
                    ) : data?.jobs.length === 0 ? (
                      <div className="hr-jobs-empty">
                        <Briefcase />
                        <h3>No jobs found</h3>
                        <p>Try adjusting your search criteria</p>
                      </div>
                    ) : (
                      <>
                        <div className="hr-job-cards">
                          {sortedJobs.map((job, i) => {
                            const salaryDisplay = formatSalary(job.salaryMin, job.salaryMax, job.salaryPeriod);
                            return (
                              <div
                                key={job.id}
                                className="hr-job-card"
                                data-testid="job-card"
                                style={{ animationDelay: `${i * 0.05}s` }}
                                onMouseEnter={() => handleJobCardHover(job.id)}
                              >
                                <div className="hr-job-card-top">
                                  <div>
                                    <div className="hr-job-title">
                                      <Link href={`/jobs/${job.slug || job.id}`}>{job.title}</Link>
                                    </div>
                                    <div className="hr-job-meta">
                                      <span className="hr-job-meta-item">
                                        <MapPin /> {job.location}
                                      </span>
                                      {salaryDisplay && (
                                        <span className="hr-job-meta-item">{salaryDisplay}</span>
                                      )}
                                      <span className="hr-job-meta-item">
                                        <Clock /> Posted {formatDate(job.createdAt)}
                                      </span>
                                      {job.postedByName && (
                                        <span className="hr-job-meta-item">
                                          <User />
                                          {job.postedById && job.isRecruiterProfilePublic ? (
                                            <a href={`/recruiters/${job.postedById}`}>{job.postedByName}</a>
                                          ) : (
                                            job.postedByName
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className="hr-job-type-badge">
                                    {job.type.replace('-', ' ')}
                                  </span>
                                </div>

                                <p className="hr-job-desc">
                                  {job.description.substring(0, 200)}...
                                </p>

                                <div className="hr-job-card-bottom">
                                  {job.deadline ? (
                                    <span className="hr-job-deadline">
                                      Deadline: {formatDate(job.deadline)}
                                    </span>
                                  ) : <span />}
                                  <Link href={`/jobs/${job.slug || job.id}`} className="hr-btn-view-job">
                                    View Details
                                  </Link>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Pagination */}
                        {data && data.pagination.totalPages > 1 && (
                          <div className="hr-pagination">
                            <button
                              className="hr-page-btn"
                              onClick={() => setPage(page - 1)}
                              disabled={page === 1}
                            >
                              Previous
                            </button>
                            {Array.from({ length: Math.min(5, data.pagination.totalPages) }, (_, i) => {
                              const pageNum = i + 1;
                              return (
                                <button
                                  key={pageNum}
                                  className={`hr-page-btn ${page === pageNum ? 'active' : ''}`}
                                  onClick={() => setPage(pageNum)}
                                >
                                  {pageNum}
                                </button>
                              );
                            })}
                            <button
                              className="hr-page-btn"
                              onClick={() => setPage(page + 1)}
                              disabled={page === data.pagination.totalPages}
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </main>
                </div>
              </div>
              <div className="struct-gutter"></div>
            </div>
          </div>

          <HomepageFooter />
        </div>

        {/* Mobile filter drawer */}
        {mobileFilterOpen && (
          <div className="hr-mobile-filter-overlay open" onClick={() => setMobileFilterOpen(false)}>
            <div className="hr-mobile-filter-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="hr-mobile-filter-header">
                <h3>Filter Jobs</h3>
                <button className="hr-mobile-filter-close" onClick={() => setMobileFilterOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              {filterPanel}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
