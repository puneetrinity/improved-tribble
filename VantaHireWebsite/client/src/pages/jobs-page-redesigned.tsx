import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Search, MapPin, Clock, Filter, Briefcase, Star, Building, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Job } from "@shared/schema";
import Layout from "@/components/Layout";

interface JobsResponse {
  jobs: Job[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function JobsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [skills, setSkills] = useState("");
  const [isVisible, setIsVisible] = useState(false);

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const { data, isLoading, error } = useQuery<JobsResponse>({
    queryKey: ["/api/jobs", { page, search, location, type, skills }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      if (search) params.set("search", search);
      if (location) params.set("location", location);
      if (type && type !== "all") params.set("type", type);
      if (skills) params.set("skills", skills);

      const response = await fetch(`/api/jobs?${params}`);
      if (!response.ok) throw new Error("Failed to fetch jobs");
      return response.json();
    },
  });

  const handleSearch = () => {
    setPage(1); // Reset to first page when searching
  };

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>
        
        <div className={`container mx-auto px-4 py-8 relative z-10 transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          {/* Premium Header */}
          <div className="text-center mb-12 pt-16">
            <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6 animate-slide-right"></div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              <span className="animate-gradient-text">Find Your Next</span>
              <br />
              <span className="text-white">Dream Opportunity</span>
            </h1>
            <p className="text-lg md:text-xl text-white/80 max-w-2xl mx-auto leading-relaxed animate-slide-up" style={{ animationDelay: '0.3s' }}>
              Discover exciting career opportunities with leading companies powered by AI-driven matching
            </p>
          </div>

          {/* Premium Search and Filters */}
          <Card className="mb-12 bg-white/10 backdrop-blur-sm border-white/20 premium-card animate-slide-up" style={{ animationDelay: '0.5s' }}>
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Filter className="h-5 w-5 text-[#7B38FB]" />
                Find Your Perfect Match
              </CardTitle>
              <CardDescription className="text-white/70">
                Use our AI-powered search to discover opportunities tailored to your skills
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="relative group">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400 group-focus-within:text-[#7B38FB] transition-colors" />
                  <Input
                    placeholder="Search jobs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                  />
                </div>
                
                <div className="relative group">
                  <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400 group-focus-within:text-[#7B38FB] transition-colors" />
                  <Input
                    placeholder="Location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="pl-10 bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                  />
                </div>

                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="bg-white/5 border-white/20 text-white focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20">
                    <SelectValue placeholder="Job Type" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/20">
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="full-time">Full Time</SelectItem>
                    <SelectItem value="part-time">Part Time</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="freelance">Freelance</SelectItem>
                    <SelectItem value="internship">Internship</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  placeholder="Skills (comma separated)"
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                />

                <Button 
                  onClick={handleSearch}
                  className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:scale-105"
                >
                  Search Jobs
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Loading State */}
          {isLoading && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7B38FB]"></div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <Card className="bg-red-500/10 border-red-500/20 mb-8">
              <CardContent className="p-6 text-center">
                <p className="text-red-300">Error loading jobs: {error.message}</p>
              </CardContent>
            </Card>
          )}

          {/* No Jobs State */}
          {data && data.jobs.length === 0 ? (
            <Card className="bg-white/5 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-12 text-center">
                <Briefcase className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-white text-xl mb-2">No jobs found</h3>
                <p className="text-gray-400">Try adjusting your search criteria or check back later</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Job Count */}
              {data && (
                <div className="mb-6 animate-fade-in" style={{ animationDelay: '0.7s' }}>
                  <p className="text-white/80 text-lg">
                    Showing <span className="text-[#7B38FB] font-semibold">{data.jobs.length}</span> of <span className="text-[#FF5BA8] font-semibold">{data.pagination.total}</span> amazing opportunities
                  </p>
                </div>
              )}

              {/* Job Cards */}
              <div className="grid gap-6 mb-8">
                {data?.jobs.map((job, index) => (
                  <Card 
                    key={job.id} 
                    className="bg-white/10 backdrop-blur-sm border-white/20 premium-card hover:bg-white/15 transition-all duration-300 group animate-slide-up"
                    style={{ animationDelay: `${0.8 + index * 0.1}s` }}
                  >
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <CardTitle className="text-white text-xl mb-2 group-hover:text-[#7B38FB] transition-colors">
                            <Link href={`/jobs/${job.id}`} className="hover:underline">
                              {job.title}
                            </Link>
                          </CardTitle>
                          <CardDescription className="text-gray-300 flex flex-wrap items-center gap-4 mb-3">
                            <span className="flex items-center gap-1">
                              <Building className="h-4 w-4 text-[#7B38FB]" />
                              <span className="text-white/80">Company Name</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-4 w-4 text-[#FF5BA8]" />
                              {job.location}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-4 w-4 text-[#2D81FF]" />
                              Posted {formatDate(job.createdAt)}
                            </span>

                          </CardDescription>
                        </div>
                        <Badge 
                          variant="secondary" 
                          className="bg-[#7B38FB]/20 text-[#7B38FB] border-[#7B38FB]/30 hover:bg-[#7B38FB]/30 transition-colors"
                        >
                          {job.type}
                        </Badge>
                      </div>
                    </CardHeader>
                    
                    <CardContent>
                      <p className="text-white/80 mb-4 leading-relaxed line-clamp-3">
                        {job.description}
                      </p>

                      {/* Skills */}
                      {job.skills && job.skills.length > 0 && (
                        <div className="mb-4">
                          <div className="flex flex-wrap gap-2">
                            {job.skills.slice(0, 5).map((skill: string, idx: number) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className="bg-white/5 border-white/20 text-white/80 hover:bg-white/10 transition-colors"
                              >
                                {skill}
                              </Badge>
                            ))}
                            {job.skills.length > 5 && (
                              <Badge variant="outline" className="bg-white/5 border-white/20 text-white/60">
                                +{job.skills.length - 5} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-between items-center">
                        {job.deadline && (
                          <p className="text-sm text-gray-400">
                            Deadline: <span className="text-orange-400">{formatDate(job.deadline)}</span>
                          </p>
                        )}
                        <div className="flex gap-2 ml-auto">
                          <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                            <Star className="h-4 w-4 mr-2" />
                            Save
                          </Button>
                          <Link href={`/jobs/${job.id}`}>
                            <Button className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:scale-105">
                              View Details
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Pagination */}
              {data && data.pagination.totalPages > 1 && (
                <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                  <CardContent className="p-6">
                    <div className="flex justify-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setPage(page - 1)}
                        disabled={page === 1}
                        className="border-white/20 text-white hover:bg-white/10 disabled:opacity-50"
                      >
                        Previous
                      </Button>
                      
                      {/* Page numbers */}
                      {Array.from({ length: Math.min(5, data.pagination.totalPages) }, (_, i) => {
                        let pageNum;
                        if (data.pagination.totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (page <= 3) {
                          pageNum = i + 1;
                        } else if (page >= data.pagination.totalPages - 2) {
                          pageNum = data.pagination.totalPages - 4 + i;
                        } else {
                          pageNum = page - 2 + i;
                        }
                        
                        return (
                          <Button
                            key={pageNum}
                            variant={pageNum === page ? "default" : "outline"}
                            onClick={() => setPage(pageNum)}
                            className={pageNum === page 
                              ? "bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8]" 
                              : "border-white/20 text-white hover:bg-white/10"
                            }
                          >
                            {pageNum}
                          </Button>
                        );
                      })}

                      <Button
                        variant="outline"
                        onClick={() => setPage(page + 1)}
                        disabled={page === data.pagination.totalPages}
                        className="border-white/20 text-white hover:bg-white/10 disabled:opacity-50"
                      >
                        Next
                      </Button>
                    </div>
                    
                    <p className="text-center text-white/60 mt-4">
                      Page {page} of {data.pagination.totalPages}
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}