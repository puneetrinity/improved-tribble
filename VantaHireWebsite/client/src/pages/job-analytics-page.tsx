import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Eye, MousePointer, TrendingUp, Users, Clock, CheckCircle, XCircle, Sparkles, Calendar, AlertTriangle, Bell, ExternalLink, Send, ThumbsUp, Pause, ThumbsDown, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Job, Application, PipelineStage } from "@shared/schema";
import Layout from "@/components/Layout";
import { JobSubNav } from "@/components/JobSubNav";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageHeaderSkeleton } from "@/components/skeletons";
import { jobAnalyticsPageCopy } from "@/lib/internal-copy";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { format, subDays, eachDayOfInterval, startOfDay } from "date-fns";

interface JobAnalytics {
  views: number;
  applyClicks: number;
  conversionRate: string;
}

interface JobHealthSummary {
  jobId: number;
  jobTitle: string;
  isActive: boolean;
  status: "green" | "amber" | "red";
  reason: string;
  totalApplications: number;
  daysSincePosted: number;
  daysSinceLastApplication: number | null;
  conversionRate: number;
}

interface StaleCandidatesSummary {
  jobId: number;
  jobTitle: string;
  count: number;
  oldestStaleDays: number;
}

interface AnalyticsNudges {
  jobsNeedingAttention: JobHealthSummary[];
  staleCandidates: StaleCandidatesSummary[];
}

interface ClientFeedbackAnalytics {
  totalShortlists: number;
  totalCandidatesSent: number;
  totalFeedback: number;
  feedbackBreakdown: {
    advance: number;
    hold: number;
    reject: number;
  };
  shortlists: {
    id: number;
    title: string | null;
    status: string;
    createdAt: string;
    expiresAt: string | null;
    candidateCount: number;
    feedbackCount: number;
    fullUrl: string;
  }[];
}

const COLORS = {
  strong: "#22c55e",
  good: "#3b82f6",
  fair: "#f59e0b",
  weak: "#ef4444",
  primary: "#7c3aed",
  secondary: "#64748b",
};

export default function JobAnalyticsPage() {
  const [match, params] = useRoute("/jobs/:id/analytics");
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isVisible, setIsVisible] = useState(false);

  const jobId = params?.id ? parseInt(params.id) : null;

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if not recruiter or admin
  if (!user || !['recruiter', 'super_admin'].includes(user.role)) {
    return <Redirect to="/recruiter-auth" />;
  }

  const { data: job, isLoading: jobLoading } = useQuery<Job & { analytics?: JobAnalytics }>({
    queryKey: ["/api/jobs", jobId, "with-analytics"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch job");
      return response.json();
    },
    enabled: !!jobId,
  });

  const { data: applications = [], isLoading: appsLoading } = useQuery<Application[]>({
    queryKey: ["/api/jobs", jobId, "applications"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}/applications`);
      if (!response.ok) throw new Error("Failed to fetch applications");
      return response.json();
    },
    enabled: !!jobId,
  });

  const { data: pipelineStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
    queryFn: async () => {
      const response = await fetch("/api/pipeline/stages");
      if (!response.ok) throw new Error("Failed to fetch pipeline stages");
      return response.json();
    },
  });

  // Fetch analytics nudges
  const { data: nudges } = useQuery<AnalyticsNudges>({
    queryKey: ["/api/analytics/nudges"],
    queryFn: async () => {
      const response = await fetch("/api/analytics/nudges", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch nudges");
      return response.json();
    },
  });

  // Fetch client feedback analytics
  const { data: clientAnalytics } = useQuery<ClientFeedbackAnalytics>({
    queryKey: ["/api/jobs", jobId, "client-feedback-analytics"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}/client-feedback-analytics`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch client feedback analytics");
      return response.json();
    },
    enabled: !!jobId,
  });

  // Filter nudges for current job
  const jobHealth = nudges?.jobsNeedingAttention.find(j => j.jobId === jobId);
  const staleCandidates = nudges?.staleCandidates.find(s => s.jobId === jobId);

  // Compute analytics metrics
  const totalApplications = applications.length;
  const reviewedApplications = applications.filter(a => a.status !== 'submitted').length;
  const shortlistedApplications = applications.filter(a => a.status === 'shortlisted').length;
  const rejectedApplications = applications.filter(a => a.status === 'rejected').length;

  // AI Fit distribution
  const aiFitData = [
    { name: "Strong", value: applications.filter(a => a.aiFitLabel === 'Strong').length, color: COLORS.strong },
    { name: "Good", value: applications.filter(a => a.aiFitLabel === 'Good').length, color: COLORS.good },
    { name: "Fair", value: applications.filter(a => a.aiFitLabel === 'Fair').length, color: COLORS.fair },
    { name: "Weak", value: applications.filter(a => a.aiFitLabel === 'Weak').length, color: COLORS.weak },
  ].filter(d => d.value > 0);

  // Stage distribution for bar chart
  const sortedStages = [...pipelineStages].sort((a, b) => (a.order - b.order) || (a.id - b.id));
  const stageData = sortedStages.map(stage => ({
    name: stage.name.length > 10 ? stage.name.substring(0, 10) + '...' : stage.name,
    fullName: stage.name,
    count: applications.filter(a => a.currentStage === stage.id).length,
  }));
  const unassignedCount = applications.filter(a => !a.currentStage).length;
  if (unassignedCount > 0) {
    stageData.unshift({ name: "Unassigned", fullName: "Unassigned", count: unassignedCount });
  }

  // Applications over time (last 14 days)
  const today = new Date();
  const fourteenDaysAgo = subDays(today, 13);
  const dateRange = eachDayOfInterval({ start: fourteenDaysAgo, end: today });

  const applicationsByDate = dateRange.map(date => {
    const dayStart = startOfDay(date);
    const count = applications.filter(app => {
      const appDate = startOfDay(new Date(app.appliedAt));
      return appDate.getTime() === dayStart.getTime();
    }).length;
    return {
      date: format(date, "MMM d"),
      count,
    };
  });

  // Status breakdown for pie chart
  const statusData = [
    { name: "Submitted", value: applications.filter(a => a.status === 'submitted').length, color: "#3b82f6" },
    { name: jobAnalyticsPageCopy.sections.reviewed, value: applications.filter(a => a.status === 'reviewed').length, color: "#f59e0b" },
    { name: "Shortlisted", value: applications.filter(a => a.status === 'shortlisted').length, color: "#22c55e" },
    { name: "Downloaded", value: applications.filter(a => a.status === 'downloaded').length, color: "#8b5cf6" },
    { name: jobAnalyticsPageCopy.sections.rejected, value: applications.filter(a => a.status === 'rejected').length, color: "#ef4444" },
  ].filter(d => d.value > 0);

  const isLoading = jobLoading || appsLoading;

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 pb-10 pt-5">
          <div className="max-w-6xl mx-auto space-y-4">
            <PageHeaderSkeleton />
          </div>
        </div>
      </Layout>
    );
  }

  if (!job) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card className="shadow-sm">
            <CardContent className="p-8 text-center">
              <h3 className="text-xl font-semibold text-foreground mb-2">{jobAnalyticsPageCopy.header.notFoundTitle}</h3>
              <p className="text-muted-foreground">{jobAnalyticsPageCopy.header.notFoundDescription}</p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={`container mx-auto px-4 pb-10 pt-5 transition-opacity duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        <div className="max-w-6xl mx-auto">
          {/* Compact header: breadcrumb back-context + job title; the single job navigation follows */}
          <PageHeader
            title={job.title}
            breadcrumbs={[
              { label: "My jobs", href: "/my-jobs" },
              { label: "Applications", href: `/jobs/${jobId}/applications` },
              { label: job.title },
            ]}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation(`/jobs/${jobId}/applications`)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
                {jobAnalyticsPageCopy.header.backToJob}
              </Button>
            }
            className="mb-3"
          />
          <JobSubNav jobId={jobId!} className="mb-4" />

          {/* Overview Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-info/20 rounded-lg">
                    <Users className="h-5 w-5 text-info" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{totalApplications}</p>
                    <p className="text-sm text-muted-foreground">Total Applications</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-success/20 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-success" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{shortlistedApplications}</p>
                    <p className="text-sm text-muted-foreground">Shortlisted</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-warning/20 rounded-lg">
                    <Clock className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{reviewedApplications}</p>
                    <p className="text-sm text-muted-foreground">{jobAnalyticsPageCopy.sections.reviewed}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-destructive/20 rounded-lg">
                    <XCircle className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{rejectedApplications}</p>
                    <p className="text-sm text-muted-foreground">{jobAnalyticsPageCopy.sections.rejected}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Nudges Card - Show only if there's something to call out */}
          {(jobHealth && jobHealth.status !== "green") || staleCandidates ? (
            <Card className="shadow-sm mb-6 border-l-4 border-l-amber-400">
              <CardHeader className="pb-3">
                <CardTitle className="text-foreground flex items-center gap-2 text-base">
                  <Bell className="h-5 w-5 text-warning" />
                  {jobAnalyticsPageCopy.sections.attentionNeeded}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Job Health Alert */}
                {jobHealth && jobHealth.status !== "green" && (
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className={`p-2 rounded-full ${
                      jobHealth.status === "red" ? "bg-destructive/20" : "bg-warning/20"
                    }`}>
                      <AlertTriangle className={`h-4 w-4 ${
                        jobHealth.status === "red" ? "text-destructive" : "text-warning"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            jobHealth.status === "red"
                              ? "bg-destructive/10 text-destructive border-destructive/30"
                              : "bg-warning/10 text-warning-foreground border-warning/30"
                          }`}
                        >
                          {jobHealth.status === "red" ? "High Priority" : "Needs Review"}
                        </Badge>
                      </div>
                      <p className="text-sm text-foreground">{jobHealth.reason}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>Posted {jobHealth.daysSincePosted} days ago</span>
                        {jobHealth.daysSinceLastApplication !== null && (
                          <span>Last app: {jobHealth.daysSinceLastApplication} days ago</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation(`/jobs/${jobId}/applications`)}
                      className="shrink-0"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View
                    </Button>
                  </div>
                )}

                {/* Stale Candidates Alert */}
                {staleCandidates && staleCandidates.count > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="p-2 rounded-full bg-warning/20">
                      <Clock className="h-4 w-4 text-warning" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className="text-xs bg-warning/10 text-warning-foreground border-warning/30"
                        >
                          Stale Candidates
                        </Badge>
                      </div>
                      <p className="text-sm text-foreground">
                        {staleCandidates.count} candidate{staleCandidates.count !== 1 ? "s" : ""} waiting
                        for over {staleCandidates.oldestStaleDays} days without status update.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation(`/jobs/${jobId}/applications`)}
                      className="shrink-0"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Review
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Applications Over Time */}
          <Card className="shadow-sm mb-6">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Calendar className="h-5 w-5 text-info" />
                Applications Over Time
              </CardTitle>
              <CardDescription>Last 14 days</CardDescription>
            </CardHeader>
            <CardContent>
              {totalApplications > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={applicationsByDate}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#64748b" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#64748b" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "white",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke={COLORS.primary}
                        strokeWidth={2}
                        dot={{ fill: COLORS.primary, r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No applications yet
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Pipeline Distribution */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-info" />
                  Pipeline Distribution
                </CardTitle>
                <CardDescription>Candidates by pipeline stage</CardDescription>
              </CardHeader>
              <CardContent>
                {stageData.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stageData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} stroke="#64748b" />
                        <YAxis
                          dataKey="name"
                          type="category"
                          tick={{ fontSize: 12 }}
                          stroke="#64748b"
                          width={80}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number, name: string, props) => {
                            const payload = props?.payload as { fullName?: string } | undefined;
                            return [value, payload?.fullName ?? name];
                          }}
                        />
                        <Bar dataKey="count" fill={COLORS.primary} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    No pipeline data
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Status Breakdown */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" />
                  Status Breakdown
                </CardTitle>
                <CardDescription>Application status distribution</CardDescription>
              </CardHeader>
              <CardContent>
                {statusData.length > 0 ? (
                  <div className="h-64 flex items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    No status data
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI Fit Distribution */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Fit Analysis
              </CardTitle>
              <CardDescription>How candidates score on AI-based job fit analysis</CardDescription>
            </CardHeader>
            <CardContent>
              {aiFitData.length > 0 ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={aiFitData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {aiFitData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col justify-center space-y-4">
                    {aiFitData.map((item) => (
                      <div key={item.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-sm font-medium text-foreground">{item.name} Fit</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-foreground">{item.value}</span>
                          <span className="text-sm text-muted-foreground">
                            ({totalApplications > 0 ? Math.round((item.value / totalApplications) * 100) : 0}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Sparkles className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p>No AI fit scores available yet</p>
                    <p className="text-xs mt-1">AI scoring is applied when applications are submitted</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Client Feedback Analytics */}
          {clientAnalytics && clientAnalytics.totalShortlists > 0 && (
            <Card className="shadow-sm mt-6">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  {jobAnalyticsPageCopy.sections.clientFeedback}
                </CardTitle>
                <CardDescription>{jobAnalyticsPageCopy.sections.clientFeedbackDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-center mb-2">
                      <Send className="h-5 w-5 text-info" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{clientAnalytics.totalCandidatesSent}</p>
                    <p className="text-xs text-muted-foreground">{jobAnalyticsPageCopy.sections.sentToClients}</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-center mb-2">
                      <ThumbsUp className="h-5 w-5 text-success" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{clientAnalytics.feedbackBreakdown.advance}</p>
                    <p className="text-xs text-muted-foreground">{jobAnalyticsPageCopy.sections.advanced}</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-center mb-2">
                      <Pause className="h-5 w-5 text-warning" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{clientAnalytics.feedbackBreakdown.hold}</p>
                    <p className="text-xs text-muted-foreground">{jobAnalyticsPageCopy.sections.onHold}</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-center mb-2">
                      <ThumbsDown className="h-5 w-5 text-destructive" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{clientAnalytics.feedbackBreakdown.reject}</p>
                    <p className="text-xs text-muted-foreground">{jobAnalyticsPageCopy.sections.rejected}</p>
                  </div>
                </div>

                {/* Feedback Breakdown Chart */}
                {clientAnalytics.totalFeedback > 0 && (
                  <div className="grid md:grid-cols-2 gap-6 mb-6">
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: jobAnalyticsPageCopy.sections.advanced, value: clientAnalytics.feedbackBreakdown.advance, color: COLORS.strong },
                              { name: jobAnalyticsPageCopy.sections.onHold, value: clientAnalytics.feedbackBreakdown.hold, color: COLORS.fair },
                              { name: jobAnalyticsPageCopy.sections.rejected, value: clientAnalytics.feedbackBreakdown.reject, color: COLORS.weak },
                            ].filter(d => d.value > 0)}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {[
                              { color: COLORS.strong },
                              { color: COLORS.fair },
                              { color: COLORS.weak },
                            ].map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "white",
                              border: "1px solid #e2e8f0",
                              borderRadius: "8px",
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col justify-center space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.strong }} />
                          <span className="text-sm text-foreground">{jobAnalyticsPageCopy.sections.advanced}</span>
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          {clientAnalytics.feedbackBreakdown.advance} ({clientAnalytics.totalFeedback > 0 ? Math.round((clientAnalytics.feedbackBreakdown.advance / clientAnalytics.totalFeedback) * 100) : 0}%)
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.fair }} />
                          <span className="text-sm text-foreground">{jobAnalyticsPageCopy.sections.onHold}</span>
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          {clientAnalytics.feedbackBreakdown.hold} ({clientAnalytics.totalFeedback > 0 ? Math.round((clientAnalytics.feedbackBreakdown.hold / clientAnalytics.totalFeedback) * 100) : 0}%)
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.weak }} />
                          <span className="text-sm text-foreground">{jobAnalyticsPageCopy.sections.rejected}</span>
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          {clientAnalytics.feedbackBreakdown.reject} ({clientAnalytics.totalFeedback > 0 ? Math.round((clientAnalytics.feedbackBreakdown.reject / clientAnalytics.totalFeedback) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Shortlists List */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-medium text-foreground mb-3">{jobAnalyticsPageCopy.sections.shortlists} ({clientAnalytics.totalShortlists})</h4>
                  <div className="space-y-2">
                    {clientAnalytics.shortlists.map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border border-border rounded-md p-3 bg-muted/30"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {s.title || job.title}
                            </span>
                            <Badge className="text-xs bg-muted text-foreground border-border">
                              {s.candidateCount} candidate{s.candidateCount === 1 ? "" : "s"}
                            </Badge>
                            {s.feedbackCount > 0 && (
                              <Badge className="text-xs bg-primary/10 text-primary border-primary/30">
                                {s.feedbackCount} feedback
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Created {new Date(s.createdAt).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                            {s.expiresAt && (
                              <> · Expires {new Date(s.expiresAt).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}</>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs capitalize">
                            {s.status}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(s.fullUrl, "_blank")}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Open Link
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Job Performance */}
          {job.analytics && (
            <Card className="shadow-sm mt-6">
              <CardHeader>
                <CardTitle className="text-foreground">Job Performance</CardTitle>
                <CardDescription>Views and engagement metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-6">
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-center mb-2">
                      <Eye className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{job.analytics.views}</p>
                    <p className="text-sm text-muted-foreground">Page Views</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-center mb-2">
                      <MousePointer className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{job.analytics.applyClicks}</p>
                    <p className="text-sm text-muted-foreground">Apply Clicks</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-center mb-2">
                      <TrendingUp className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{job.analytics.conversionRate}</p>
                    <p className="text-sm text-muted-foreground">Conversion Rate</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}
