import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Layout from "@/components/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Eye, MousePointer, TrendingUp, Briefcase, Calendar, MapPin, Search, Filter, Sparkles, Users, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { format } from "date-fns";

type JobHealthStatus = 'green' | 'amber' | 'red';

interface JobHealthSummary {
  jobId: number;
  jobTitle: string;
  status: JobHealthStatus;
  reason: string;
  totalApplications: number;
  daysSincePosted: number;
  daysSinceLastApplication: number | null;
  conversionRate: number;
}

interface JobWithAnalytics {
  id: number;
  title: string;
  location: string;
  type: string;
  description: string;
  skills: string[];
  deadline: string;
  createdAt: string;
  isActive: boolean;
  status: string;
  clientId: number | null;
  clientName: string | null;
  postedBy: number;
  postedByUser: {
    id: number;
    firstName: string;
    lastName: string;
    username: string;
  };
  analytics: {
    views: number;
    applyClicks: number;
    conversionRate: string;
  };
}

interface SimilarCandidate {
  applicationId: number;
  candidateName: string;
  candidateEmail: string;
  sourceJobId: number;
  sourceJobTitle: string;
  aiFitScore: number | null;
  aiFitLabel: string | null;
  currentStage: number | null;
}

function SimilarCandidatesSection({ jobId }: { jobId: number }) {
  const [, setLocation] = useLocation();
  const [showCandidates, setShowCandidates] = useState(false);

  const { data: similarCandidates = [], isLoading: similarLoading } = useQuery<SimilarCandidate[]>({
    queryKey: ["/api/jobs", jobId, "ai-similar-candidates"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/ai-similar-candidates?minFitScore=70`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch similar candidates");
      return res.json();
    },
    enabled: showCandidates,
  });

  if (!showCandidates) {
    return (
      <div className="mt-4 pt-4 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCandidates(true)}
          className="w-full border-primary/30 text-primary hover:bg-primary/10"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Load AI-Suggested Candidates from Other Roles
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Suggested Candidates from Other Roles
        </h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCandidates(false)}
          className="text-xs"
        >
          Hide
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        High-fit candidates from your other jobs (AI-based)
      </p>
      {similarLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading suggestions...</div>
      ) : similarCandidates.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 bg-muted/50 rounded-md p-3">
          No high-fit candidates found yet from other roles.
        </div>
      ) : (
        <div className="space-y-3">
          {similarCandidates.map((c) => (
            <div
              key={c.applicationId}
              className="flex items-center justify-between p-3 border border-border rounded-md bg-muted/50 hover:bg-muted transition-colors"
            >
              <div className="flex-1">
                <div className="font-medium text-foreground text-sm">
                  {c.candidateName}{" "}
                  <span className="text-muted-foreground text-xs font-normal">({c.candidateEmail})</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                  <span>From: {c.sourceJobTitle}</span>
                  {c.aiFitScore !== null && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-primary" />
                        Fit: {c.aiFitScore}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/jobs/${c.sourceJobId}/applications`)}
                className="ml-3"
              >
                View
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function JobAnalyticsDashboard() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTab, setSelectedTab] = useState("overview");
   const [clientFilter, setClientFilter] = useState("all");

  // Redirect if not authorized
  if (!user || (user.role !== 'super_admin' && user.role !== 'recruiter')) {
    return <Redirect to="/recruiter-auth" />;
  }

  const { data: jobsWithAnalytics, isLoading } = useQuery<JobWithAnalytics[]>({
    queryKey: ['/api/analytics/jobs'],
  });

  // Fetch job health summaries
  const { data: jobHealthData = [] } = useQuery<JobHealthSummary[]>({
    queryKey: ['/api/analytics/job-health'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/job-health', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch job health');
      return res.json();
    },
    enabled: !!user && ['super_admin', 'recruiter'].includes(user.role),
  });

  // Helper to get health data for a job
  const getJobHealth = (jobId: number): JobHealthSummary | undefined => {
    return jobHealthData.find(h => h.jobId === jobId);
  };

  // Filter jobs based on search and status, with deduplication
  const filteredJobs = Array.from(
    new Map(
      (jobsWithAnalytics?.filter(job => {
        const matchesSearch = !searchTerm ||
          job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.location.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus = statusFilter === "all" ||
          (statusFilter === "active" && job.isActive) ||
          (statusFilter === "inactive" && !job.isActive) ||
          job.status === statusFilter;

        const matchesClient =
          clientFilter === "all" ||
          (clientFilter === "no-client" && !job.clientId) ||
          (clientFilter === String(job.clientId));

        return matchesSearch && matchesStatus && matchesClient;
      }) || []).map(job => [job.id, job])
    ).values()
  );

  // Calculate aggregate statistics
  const totalViews = filteredJobs.reduce((sum, job) => sum + job.analytics.views, 0);
  const totalApplyClicks = filteredJobs.reduce((sum, job) => sum + job.analytics.applyClicks, 0);
  const averageConversionRate = filteredJobs.length > 0 
    ? (filteredJobs.reduce((sum, job) => sum + parseFloat(job.analytics.conversionRate), 0) / filteredJobs.length).toFixed(2)
    : "0.00";

  // Prepare chart data
  const chartData = filteredJobs.map(job => ({
    name: job.title.length > 20 ? job.title.substring(0, 20) + "..." : job.title,
    views: job.analytics.views,
    applyClicks: job.analytics.applyClicks,
    conversionRate: parseFloat(job.analytics.conversionRate),
  }));

  const performanceData = filteredJobs.map(job => ({
    name: job.title.length > 15 ? job.title.substring(0, 15) + "..." : job.title,
    performance: parseFloat(job.analytics.conversionRate),
  }));

  const statusData = [
    { name: 'Active', value: filteredJobs.filter(job => job.isActive).length, color: '#10b981' },
    { name: 'Inactive', value: filteredJobs.filter(job => !job.isActive).length, color: '#ef4444' },
    { name: 'Pending', value: filteredJobs.filter(job => job.status === 'pending').length, color: '#f59e0b' },
  ];

  const getStatusBadge = (job: JobWithAnalytics) => {
    if (!job.isActive) return <Badge className="bg-destructive/10 text-destructive">Inactive</Badge>;
    if (job.status === 'pending') return <Badge className="bg-warning/10 text-warning-foreground">Pending</Badge>;
    if (job.status === 'approved') return <Badge className="bg-success/10 text-success-foreground">Active</Badge>;
    return <Badge className="bg-muted/50 text-foreground">Unknown</Badge>;
  };

  const getHealthBadge = (status: JobHealthStatus) => {
    switch (status) {
      case 'green':
        return (
          <Badge className="bg-success/10 text-success-foreground border-success/30">
            <Activity className="h-3 w-3 mr-1" />
            Healthy
          </Badge>
        );
      case 'amber':
        return (
          <Badge className="bg-warning/10 text-warning-foreground border-warning/30">
            <Activity className="h-3 w-3 mr-1" />
            Watch
          </Badge>
        );
      case 'red':
        return (
          <Badge className="bg-destructive/10 text-destructive border-destructive/30">
            <Activity className="h-3 w-3 mr-1" />
            Attention
          </Badge>
        );
    }
  };

  const getPerformanceColor = (conversionRate: number) => {
    if (conversionRate >= 10) return "text-success";
    if (conversionRate >= 5) return "text-warning";
    return "text-destructive";
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto p-8">
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-6 md:px-8">
        {/* Header — shared compact page header */}
        <PageHeader
          title="Job Analytics Dashboard"
          description="Track performance metrics and insights for your job listings"
          breadcrumbs={[{ label: "My jobs", href: "/my-jobs" }, { label: "Analytics" }]}
        />

        {/* Quick Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">Total Jobs</p>
                  <p className="text-3xl font-bold text-foreground">{filteredJobs.length}</p>
                </div>
                <Briefcase className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">Total Views</p>
                  <p className="text-3xl font-bold text-foreground">{totalViews.toLocaleString()}</p>
                </div>
                <Eye className="w-8 h-8 text-success" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">Apply Clicks</p>
                  <p className="text-3xl font-bold text-foreground">{totalApplyClicks.toLocaleString()}</p>
                </div>
                <MousePointer className="w-8 h-8 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">Avg Conversion</p>
                  <p className="text-3xl font-bold text-foreground">{averageConversionRate}%</p>
                </div>
                <TrendingUp className="w-8 h-8 text-warning" />
              </div>
            </CardContent>
          </Card>
        </div>

          {/* Filters */}
          <Card className="mb-6 shadow-sm">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="Search jobs..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 bg-card border-border"
                    />
                  </div>
                </div>
                <div className="flex flex-col md:flex-row gap-4 md:gap-3">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full md:w-40 bg-card border-border">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={clientFilter} onValueChange={setClientFilter}>
                    <SelectTrigger className="w-full md:w-48 bg-card border-border">
                      <SelectValue placeholder="Filter by client" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="all">All Clients</SelectItem>
                      <SelectItem value="no-client">Internal / No client</SelectItem>
                      {Array.from(
                        new Map(
                          (jobsWithAnalytics || [])
                            .filter(job => job.clientId && job.clientName)
                            .map(job => [job.clientId, job.clientName as string]),
                        ).entries(),
                      ).map(([id, name]) => (
                        <SelectItem key={id} value={String(id)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Analytics Tabs */}
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-muted/50 border-border">
              <TabsTrigger value="overview" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                Overview
              </TabsTrigger>
              <TabsTrigger value="performance" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                Performance
              </TabsTrigger>
              <TabsTrigger value="detailed" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                Detailed View
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Views vs Apply Clicks Chart */}
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-foreground">Views vs Apply Clicks</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Comparison of job views and application clicks
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="name" stroke="#9CA3AF" />
                        <YAxis stroke="#9CA3AF" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            color: '#111827'
                          }}
                        />
                        <Bar dataKey="views" fill="#10b981" name="Views" />
                        <Bar dataKey="applyClicks" fill="#8b5cf6" name="Apply Clicks" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Job Status Distribution */}
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-foreground">Job Status Distribution</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Current status breakdown of all jobs
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, value }) => `${name}: ${value}`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            color: '#111827'
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="performance" className="mt-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground">Conversion Rate Performance</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Track how well your jobs convert views to applications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={performanceData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="name" stroke="#9CA3AF" />
                      <YAxis stroke="#9CA3AF" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1F2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px',
                          color: '#F9FAFB'
                        }} 
                      />
                      <Line 
                        type="monotone" 
                        dataKey="performance" 
                        stroke="#f59e0b" 
                        strokeWidth={3}
                        dot={{ fill: '#f59e0b' }}
                        name="Conversion Rate (%)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="detailed" className="mt-6">
              <div className="space-y-6">
                {filteredJobs.map(job => (
                  <Card key={job.id} className="shadow-sm">
                    <CardContent className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-semibold text-foreground mb-2">{job.title}</h3>
                          <div className="flex items-center gap-4 mb-2 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {job.location}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {format(new Date(job.createdAt), "MMM d, yyyy")}
                            </span>
                            <Badge variant="outline" className="border-primary/30 text-primary bg-primary/10">
                              {job.type}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mb-3">
                            {getStatusBadge(job)}
                            {(() => {
                              const health = getJobHealth(job.id);
                              if (health) {
                                return (
                                  <div className="group relative">
                                    {getHealthBadge(health.status)}
                                    {/* Tooltip on hover */}
                                    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-10 w-64 p-3 bg-slate-900 text-foreground text-xs rounded-lg shadow-lg">
                                      <p className="font-semibold mb-1">Health: {health.reason}</p>
                                      <p className="mb-1">Applications: {health.totalApplications}</p>
                                      <p className="mb-1">Posted {health.daysSincePosted} days ago</p>
                                      {health.daysSinceLastApplication !== null && (
                                        <p>Last application: {health.daysSinceLastApplication} days ago</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                            <span className="text-sm text-muted-foreground">
                              Posted by: {job.postedByUser.firstName} {job.postedByUser.lastName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Analytics Metrics */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-2 mb-1">
                            <Eye className="h-4 w-4 text-success" />
                            <span className="text-sm font-medium text-muted-foreground">Views</span>
                          </div>
                          <p className="text-2xl font-bold text-success">{job.analytics.views}</p>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-2 mb-1">
                            <MousePointer className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium text-muted-foreground">Apply Clicks</span>
                          </div>
                          <p className="text-2xl font-bold text-primary">{job.analytics.applyClicks}</p>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-2 mb-1">
                            <TrendingUp className="h-4 w-4 text-warning" />
                            <span className="text-sm font-medium text-muted-foreground">Conversion Rate</span>
                          </div>
                          <p className={`text-2xl font-bold ${getPerformanceColor(parseFloat(job.analytics.conversionRate))}`}>
                            {job.analytics.conversionRate}%
                          </p>
                        </div>
                      </div>

                      {/* Job Skills */}
                      {job.skills && job.skills.length > 0 && (
                        <div className="mt-4">
                          <p className="text-sm font-medium text-muted-foreground mb-2">Required Skills:</p>
                          <div className="flex flex-wrap gap-2">
                            {job.skills.map((skill, index) => (
                              <Badge key={index} variant="outline" className="border-border text-foreground bg-muted/50">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* AI Similar Candidates Section */}
                      <SimilarCandidatesSection jobId={job.id} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
    </Layout>
  );
}
