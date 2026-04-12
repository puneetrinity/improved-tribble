import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Helmet } from "react-helmet-async";
import { Search, MapPin, Clock, Briefcase, X, User, IndianRupee, SlidersHorizontal } from "lucide-react";
import { DEFAULT_SITE_URL } from "@/lib/seoHelpers";
import { Job } from "@shared/schema";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
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

const filterInputCls = "w-full bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded px-3 py-[9px] font-dm text-[0.85rem] text-hr-text outline-none transition-colors duration-200 placeholder:text-hr-text-muted focus:border-hr-accent";
const filterSelectCls = "w-full bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded px-3 py-[9px] font-dm text-[0.85rem] text-hr-text outline-none transition-colors duration-200 cursor-pointer appearance-none focus:border-hr-accent";
const filterLabelCls = "flex items-center gap-1.5 font-mono text-[0.65rem] font-medium tracking-[0.1em] uppercase text-hr-text-muted mb-2";
const metaItemCls = "flex items-center gap-[5px] text-[0.82rem] text-hr-text-muted [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0";
const pageBtnCls = "py-2 px-3.5 rounded-none font-dm text-[0.82rem] font-medium cursor-pointer transition-all duration-200 border border-[rgba(255,255,255,0.08)] bg-transparent text-hr-text-secondary hover:enabled:border-[rgba(255,255,255,0.12)] hover:enabled:text-hr-text disabled:opacity-40 disabled:cursor-not-allowed";

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
      <div className="mb-5">
        <label className={filterLabelCls}><Search size={12} /> Keyword</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hr-text-muted pointer-events-none" />
          <input
            className={`${filterInputCls} pl-8`}
            placeholder="Job title, keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
        </div>
      </div>

      <div className="mb-5">
        <label className={filterLabelCls}><MapPin size={12} /> Location</label>
        <div className="relative">
          <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hr-text-muted pointer-events-none" />
          <input
            className={`${filterInputCls} pl-8`}
            placeholder="City, state..."
            value={location}
            onChange={(e) => setLocationFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
        </div>
      </div>

      <div className="h-px bg-[rgba(255,255,255,0.08)] my-5" />

      <div className="mb-5">
        <label className={filterLabelCls}><Briefcase size={12} /> Job Type</label>
        <select
          className={filterSelectCls}
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1L5 5L9 1\' stroke=\'%238A8A9A\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          <option value="all">All Types</option>
          <option value="full-time">Full-time</option>
          <option value="part-time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
          <option value="temporary">Temporary</option>
        </select>
      </div>

      <div className="mb-5">
        <label className={filterLabelCls}><IndianRupee size={12} /> Salary Range</label>
        <div className="flex gap-2 items-center">
          <input
            className={filterInputCls}
            placeholder="Min"
            type="number"
            value={minSalary}
            onChange={(e) => setMinSalary(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
          <span className="text-hr-text-muted text-[0.8rem]">–</span>
          <input
            className={filterInputCls}
            placeholder="Max"
            type="number"
            value={maxSalary}
            onChange={(e) => setMaxSalary(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
          />
        </div>
        <select
          className={`${filterSelectCls} mt-2`}
          value={salaryPeriod}
          onChange={(e) => setSalaryPeriod(e.target.value)}
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1L5 5L9 1\' stroke=\'%238A8A9A\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          <option value="per_year">Per Year</option>
          <option value="per_month">Per Month</option>
        </select>
      </div>

      <div className="h-px bg-[rgba(255,255,255,0.08)] my-5" />

      <div className="flex flex-col gap-2">
        <button
          className="bg-hr-accent text-white border-none py-2.5 px-5 rounded-none font-dm text-[0.85rem] font-medium cursor-pointer transition-colors duration-200 w-full hover:bg-hr-accent-hover"
          onClick={handleApplyFilters}
        >
          Apply Filters
        </button>
        <button
          className="bg-transparent text-hr-text-secondary border border-[rgba(255,255,255,0.08)] py-2.5 px-5 rounded-none font-dm text-[0.85rem] font-medium cursor-pointer transition-all duration-200 w-full hover:border-[rgba(255,255,255,0.12)] hover:text-hr-text"
          onClick={handleResetFilters}
        >
          Reset
        </button>
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

      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          <div className="pt-[60px] min-h-screen">
            {/* Header */}
            <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
              <div></div>
              <div>
                <div className="text-center pt-20 px-12 pb-[60px] animate-hr-fade-up max-md:pt-[60px] max-md:px-5 max-md:pb-10">
                  <div className="font-mono text-[0.68rem] font-medium text-hr-accent-hover tracking-[0.12em] uppercase mb-[18px]">Open Positions</div>
                  <h1 className="font-satoshi text-[clamp(2.4rem,5vw,3.4rem)] font-normal leading-[1.2] tracking-tight mb-4 text-hr-text max-w-[600px] mx-auto">Find Your Next<br />Opportunity</h1>
                  <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto text-center">
                    Discover roles with leading companies across India, powered by intelligent matching.
                  </p>
                </div>
              </div>
              <div></div>
            </div>

            {/* Main content */}
            <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
              <div></div>
              <div>
                <div className="max-w-[1100px] mx-auto pb-20 grid grid-cols-[260px_1fr] gap-8 max-lg:grid-cols-1 max-lg:pb-[60px] max-md:pb-[60px]">
                  {/* Desktop sidebar */}
                  <aside className="sticky top-20 self-start max-lg:hidden">
                    <div className="bg-hr-bg-card border border-[rgba(255,255,255,0.08)] rounded-lg p-6">
                      <h3 className="font-satoshi text-base font-medium text-hr-text mb-5 flex items-center gap-2">
                        <SlidersHorizontal size={16} /> Filters
                      </h3>
                      {filterPanel}
                    </div>
                  </aside>

                  {/* Results area */}
                  <main>
                    {/* Toolbar */}
                    <div className="flex items-center justify-between mb-5 gap-4 max-md:flex-col max-md:items-start">
                      <div className="flex items-center gap-2.5">
                        {/* Mobile filter trigger */}
                        <button
                          className="hidden max-lg:flex items-center gap-1.5 bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded-none py-2 px-4 font-dm text-[0.82rem] text-hr-text cursor-pointer transition-colors duration-200 hover:border-[rgba(255,255,255,0.12)] [&>svg]:w-4 [&>svg]:h-4"
                          onClick={() => setMobileFilterOpen(true)}
                        >
                          <SlidersHorizontal />
                          Filters
                          {activeFilterCount > 0 && (
                            <span className="bg-hr-accent text-white text-[0.6rem] font-bold w-[18px] h-[18px] rounded-full flex items-center justify-center">{activeFilterCount}</span>
                          )}
                        </button>

                        {data && (
                          <span className="text-[0.85rem] text-hr-text-secondary">
                            <strong className="text-hr-text font-semibold">{data.pagination.total}</strong> {data.pagination.total === 1 ? 'job' : 'jobs'} found
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[0.75rem] text-hr-text-muted font-mono uppercase tracking-[0.06em]">Sort</span>
                        <select
                          className="bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded px-2.5 py-1.5 pr-7 font-dm text-[0.82rem] text-hr-text outline-none cursor-pointer appearance-none"
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1L5 5L9 1\' stroke=\'%238A8A9A\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                        >
                          <option value="recent">Most Recent</option>
                          <option value="deadline">Deadline: Soonest</option>
                          {aiEnabled && <option value="relevant">AI Relevance</option>}
                        </select>
                      </div>
                    </div>

                    {/* Active filter chips */}
                    {activeFilterCount > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {search && (
                          <span className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-[rgba(124,58,237,0.12)] text-hr-accent-hover font-dm text-[0.75rem] font-medium border-none">
                            Search: {search}
                            <button className="bg-transparent border-none text-hr-accent-hover cursor-pointer p-0 flex items-center opacity-70 transition-opacity duration-200 hover:opacity-100" onClick={() => setSearch("")}><X size={12} /></button>
                          </span>
                        )}
                        {location && (
                          <span className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-[rgba(124,58,237,0.12)] text-hr-accent-hover font-dm text-[0.75rem] font-medium border-none">
                            Location: {location}
                            <button className="bg-transparent border-none text-hr-accent-hover cursor-pointer p-0 flex items-center opacity-70 transition-opacity duration-200 hover:opacity-100" onClick={() => setLocationFilter("")}><X size={12} /></button>
                          </span>
                        )}
                        {type && type !== "all" && (
                          <span className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-[rgba(124,58,237,0.12)] text-hr-accent-hover font-dm text-[0.75rem] font-medium border-none">
                            {type.replace('-', ' ')}
                            <button className="bg-transparent border-none text-hr-accent-hover cursor-pointer p-0 flex items-center opacity-70 transition-opacity duration-200 hover:opacity-100" onClick={() => setType("all")}><X size={12} /></button>
                          </span>
                        )}
                        {minSalary && (
                          <span className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-[rgba(124,58,237,0.12)] text-hr-accent-hover font-dm text-[0.75rem] font-medium border-none">
                            Min: ₹{Number(minSalary).toLocaleString()}
                            <button className="bg-transparent border-none text-hr-accent-hover cursor-pointer p-0 flex items-center opacity-70 transition-opacity duration-200 hover:opacity-100" onClick={() => setMinSalary("")}><X size={12} /></button>
                          </span>
                        )}
                        {maxSalary && (
                          <span className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-[rgba(124,58,237,0.12)] text-hr-accent-hover font-dm text-[0.75rem] font-medium border-none">
                            Max: ₹{Number(maxSalary).toLocaleString()}
                            <button className="bg-transparent border-none text-hr-accent-hover cursor-pointer p-0 flex items-center opacity-70 transition-opacity duration-200 hover:opacity-100" onClick={() => setMaxSalary("")}><X size={12} /></button>
                          </span>
                        )}
                        <button
                          className="bg-transparent text-hr-text-secondary border border-[rgba(255,255,255,0.08)] py-1 px-3 rounded-none font-dm text-[0.72rem] font-medium cursor-pointer transition-all duration-200 hover:border-[rgba(255,255,255,0.12)] hover:text-hr-text"
                          onClick={handleResetFilters}
                        >
                          Clear all
                        </button>
                      </div>
                    )}

                    {/* Results */}
                    {isLoading ? (
                      <div className="text-center py-20 px-6">
                        <div className="w-9 h-9 border-2 border-[rgba(255,255,255,0.08)] border-t-hr-accent rounded-full animate-hr-spin mx-auto mb-4" />
                        <p className="text-[0.85rem] text-hr-text-muted">Loading jobs...</p>
                      </div>
                    ) : error ? (
                      <div className="text-center py-20 px-6">
                        <p className="text-[0.875rem] text-hr-red">Error loading jobs. Please try again.</p>
                      </div>
                    ) : data?.jobs.length === 0 ? (
                      <div className="text-center py-20 px-6 [&>svg]:w-12 [&>svg]:h-12 [&>svg]:text-hr-text-muted [&>svg]:mb-4 [&>svg]:mx-auto">
                        <Briefcase />
                        <h3 className="font-satoshi text-[1.2rem] font-medium text-hr-text mb-2">No jobs found</h3>
                        <p className="text-[0.875rem] text-hr-text-secondary">Try adjusting your search criteria</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-3">
                          {sortedJobs.map((job, i) => {
                            const salaryDisplay = formatSalary(job.salaryMin, job.salaryMax, job.salaryPeriod);
                            return (
                              <div
                                key={job.id}
                                className="bg-hr-bg-card border border-[rgba(255,255,255,0.08)] rounded-lg py-5 px-6 transition-all duration-200 hover:border-[rgba(255,255,255,0.12)] hover:bg-hr-bg-elevated max-md:p-4"
                                data-testid="job-card"
                                style={{ animation: 'hr-fade-up 0.5s ease-out both', animationDelay: `${i * 0.05}s` }}
                                onMouseEnter={() => handleJobCardHover(job.id)}
                              >
                                <div className="flex justify-between items-start gap-4 mb-3 max-md:flex-col max-md:gap-2">
                                  <div>
                                    <div className="font-satoshi text-[1.1rem] font-medium text-hr-text mb-2">
                                      <Link href={`/jobs/${job.slug || job.id}`} className="text-inherit no-underline transition-colors duration-200 hover:text-hr-accent-hover">{job.title}</Link>
                                    </div>
                                    <div className="flex flex-wrap gap-4 items-center max-md:gap-2.5">
                                      <span className={metaItemCls}>
                                        <MapPin /> {job.location}
                                      </span>
                                      {salaryDisplay && (
                                        <span className={metaItemCls}>{salaryDisplay}</span>
                                      )}
                                      <span className={metaItemCls}>
                                        <Clock /> Posted {formatDate(job.createdAt)}
                                      </span>
                                      {job.postedByName && (
                                        <span className={metaItemCls}>
                                          <User />
                                          {job.postedById && job.isRecruiterProfilePublic ? (
                                            <a href={`/recruiters/${job.postedById}`} className="text-hr-accent-hover no-underline transition-colors duration-200 hover:underline">{job.postedByName}</a>
                                          ) : (
                                            job.postedByName
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className="inline-block py-1 px-3 rounded-full font-mono text-[0.62rem] font-medium tracking-[0.06em] uppercase bg-[rgba(124,58,237,0.12)] text-hr-accent-hover whitespace-nowrap shrink-0">
                                    {job.type.replace('-', ' ')}
                                  </span>
                                </div>

                                <p className="text-[0.875rem] text-hr-text-secondary leading-[1.6] mb-4 line-clamp-2">
                                  {job.description.substring(0, 200)}...
                                </p>

                                <div className="flex justify-between items-center max-md:flex-col max-md:items-start max-md:gap-3">
                                  {job.deadline ? (
                                    <span className="text-[0.78rem] text-hr-text-muted">
                                      Deadline: {formatDate(job.deadline)}
                                    </span>
                                  ) : <span />}
                                  <Link
                                    href={`/jobs/${job.slug || job.id}`}
                                    className="bg-hr-accent text-white border-none py-2 px-[18px] rounded-none font-dm text-[0.82rem] font-medium cursor-pointer no-underline transition-colors duration-200 inline-block hover:bg-hr-accent-hover max-md:w-full max-md:text-center"
                                  >
                                    View Details
                                  </Link>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Pagination */}
                        {data && data.pagination.totalPages > 1 && (
                          <div className="flex items-center justify-center gap-1.5 mt-8">
                            <button
                              className={pageBtnCls}
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
                                  className={`${pageBtnCls} ${page === pageNum ? '!bg-hr-accent !border-hr-accent !text-white' : ''}`}
                                  onClick={() => setPage(pageNum)}
                                >
                                  {pageNum}
                                </button>
                              );
                            })}
                            <button
                              className={pageBtnCls}
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
              <div></div>
            </div>
          </div>

          <HomepageFooter />
        </div>

        {/* Mobile filter drawer */}
        {mobileFilterOpen && (
          <div className="fixed inset-0 z-[1100] bg-black/60 backdrop-blur-[4px]" onClick={() => setMobileFilterOpen(false)}>
            <div
              className="fixed top-0 left-0 bottom-0 w-[300px] max-w-[85vw] bg-hr-bg border-r border-[rgba(255,255,255,0.08)] z-[1101] overflow-y-auto p-6 animate-hr-slide-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-satoshi text-[1.1rem] font-medium text-hr-text">Filter Jobs</h3>
                <button
                  className="bg-transparent border-none text-hr-text-muted cursor-pointer p-1 hover:text-hr-text"
                  onClick={() => setMobileFilterOpen(false)}
                >
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

