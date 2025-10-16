import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Layout from "@/components/Layout";
import { Eye, MousePointer, TrendingUp, Briefcase, Calendar, MapPin, Search, Filter } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { format } from "date-fns";

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

export default function JobAnalyticsDashboard() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTab, setSelectedTab] = useState("overview");

  // Redirect if not authorized
  if (!user || (user.role !== 'admin' && user.role !== 'recruiter')) {
    return <Redirect to="/auth" />;
  }

  const { data: jobsWithAnalytics, isLoading } = useQuery<JobWithAnalytics[]>({
    queryKey: ['/api/analytics/jobs'],
  });

  // Filter jobs based on search and status
  const filteredJobs = jobsWithAnalytics?.filter(job => {
    const matchesSearch = !searchTerm || 
      job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.location.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || 
      (statusFilter === "active" && job.isActive) ||
      (statusFilter === "inactive" && !job.isActive) ||
      job.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) || [];

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
    if (!job.isActive) return <Badge className="bg-red-500/20 text-red-300">Inactive</Badge>;
    if (job.status === 'pending') return <Badge className="bg-yellow-500/20 text-yellow-300">Pending</Badge>;
    if (job.status === 'approved') return <Badge className="bg-green-500/20 text-green-300">Active</Badge>;
    return <Badge className="bg-gray-500/20 text-gray-300">Unknown</Badge>;
  };

  const getPerformanceColor = (conversionRate: number) => {
    if (conversionRate >= 10) return "text-green-400";
    if (conversionRate >= 5) return "text-yellow-400";
    return "text-red-400";
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
          <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">Job Analytics Dashboard</h1>
            <p className="text-gray-300">Track performance metrics and insights for your job listings</p>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">Total Jobs</p>
                    <p className="text-3xl font-bold text-white">{filteredJobs.length}</p>
                  </div>
                  <Briefcase className="w-8 h-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">Total Views</p>
                    <p className="text-3xl font-bold text-white">{totalViews.toLocaleString()}</p>
                  </div>
                  <Eye className="w-8 h-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">Apply Clicks</p>
                    <p className="text-3xl font-bold text-white">{totalApplyClicks.toLocaleString()}</p>
                  </div>
                  <MousePointer className="w-8 h-8 text-purple-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">Avg Conversion</p>
                    <p className="text-3xl font-bold text-white">{averageConversionRate}%</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-orange-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card className="mb-8 bg-white/10 backdrop-blur-sm border-white/20">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <Input
                      placeholder="Search jobs..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 bg-slate-800/50 border-slate-600 text-white"
                    />
                  </div>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48 bg-slate-800/50 border-slate-600 text-white">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Analytics Tabs */}
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-white/10 border-white/20">
              <TabsTrigger value="overview" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
                Overview
              </TabsTrigger>
              <TabsTrigger value="performance" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
                Performance
              </TabsTrigger>
              <TabsTrigger value="detailed" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
                Detailed View
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Views vs Apply Clicks Chart */}
                <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                  <CardHeader>
                    <CardTitle className="text-white">Views vs Apply Clicks</CardTitle>
                    <CardDescription className="text-gray-300">
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
                            backgroundColor: '#1F2937', 
                            border: '1px solid #374151',
                            borderRadius: '8px',
                            color: '#F9FAFB'
                          }} 
                        />
                        <Bar dataKey="views" fill="#10b981" name="Views" />
                        <Bar dataKey="applyClicks" fill="#8b5cf6" name="Apply Clicks" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Job Status Distribution */}
                <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                  <CardHeader>
                    <CardTitle className="text-white">Job Status Distribution</CardTitle>
                    <CardDescription className="text-gray-300">
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
                            backgroundColor: '#1F2937', 
                            border: '1px solid #374151',
                            borderRadius: '8px',
                            color: '#F9FAFB'
                          }} 
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="performance" className="mt-6">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                <CardHeader>
                  <CardTitle className="text-white">Conversion Rate Performance</CardTitle>
                  <CardDescription className="text-gray-300">
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
                  <Card key={job.id} className="bg-white/10 backdrop-blur-sm border-white/20">
                    <CardContent className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-semibold text-white mb-2">{job.title}</h3>
                          <div className="flex items-center gap-4 mb-2 text-sm text-gray-300">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {job.location}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {format(new Date(job.createdAt), "MMM d, yyyy")}
                            </span>
                            <Badge variant="outline" className="border-purple-400/30 text-purple-300">
                              {job.type}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mb-3">
                            {getStatusBadge(job)}
                            <span className="text-sm text-gray-400">
                              Posted by: {job.postedByUser.firstName} {job.postedByUser.lastName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Analytics Metrics */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-800/30 rounded-lg">
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-2 mb-1">
                            <Eye className="h-4 w-4 text-green-400" />
                            <span className="text-sm font-medium text-gray-300">Views</span>
                          </div>
                          <p className="text-2xl font-bold text-green-400">{job.analytics.views}</p>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-2 mb-1">
                            <MousePointer className="h-4 w-4 text-purple-400" />
                            <span className="text-sm font-medium text-gray-300">Apply Clicks</span>
                          </div>
                          <p className="text-2xl font-bold text-purple-400">{job.analytics.applyClicks}</p>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-2 mb-1">
                            <TrendingUp className="h-4 w-4 text-orange-400" />
                            <span className="text-sm font-medium text-gray-300">Conversion Rate</span>
                          </div>
                          <p className={`text-2xl font-bold ${getPerformanceColor(parseFloat(job.analytics.conversionRate))}`}>
                            {job.analytics.conversionRate}%
                          </p>
                        </div>
                      </div>

                      {/* Job Skills */}
                      {job.skills && job.skills.length > 0 && (
                        <div className="mt-4">
                          <p className="text-sm font-medium text-gray-300 mb-2">Required Skills:</p>
                          <div className="flex flex-wrap gap-2">
                            {job.skills.map((skill, index) => (
                              <Badge key={index} variant="outline" className="border-slate-600 text-slate-300">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Layout>
  );
}